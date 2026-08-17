/** Durable, provenance-preserving UN Comtrade warehouse ingest. */
import { IngestStatus, JobStatus, Prisma, TradeDataSource, TradeFlowDirection, TradeSourceMode } from '@prisma/client';
import { ComtradeRateLimitError, getComtradeClient } from '@/lib/comtrade';
import type { FlowDirection } from '@/lib/comtrade';
import { getConfig } from '@/lib/config';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { reserveProviderQuota } from '@/lib/provider-quota';
import { isRealWorkflowEnvironment } from '@/lib/evidence-environment';

interface ComtradeIngestPayload { hs_chapter:string; hs_codes?:string[]; reporter?:string; partner?:string; year?:number; flow_direction?:FlowDirection; ingest_run_id?:string }
type Progress = { hs_codes?:string[]; next_index?:number };
const DEFAULT_REPORTER='699', DEFAULT_PARTNER='0';

function finitePositiveQuantity(value:unknown):number|null {
  if(typeof value!=='number'&&typeof value!=='string')return null;
  const number=Number(value);
  return Number.isFinite(number)&&number>0?number:null;
}

export async function runComtradeIngest(ctx:JobContext):Promise<JobOutcome>{
  const payload=ctx.payload as unknown as ComtradeIngestPayload;
  if(!payload?.hs_chapter)throw new Error('comtrade_ingest job has no hs_chapter parameter.');
  const explicitCodes=payload.hs_codes?.map(code=>String(code));
  if(explicitCodes&&(explicitCodes.length===0||explicitCodes.some(code=>!/^[0-9]{6}$/.test(code)||!code.startsWith(payload.hs_chapter))))throw new Error('Explicit Comtrade codes must be HS6 leaves in the requested chapter.');
  const params={hs_chapter:payload.hs_chapter,reporter:payload.reporter??DEFAULT_REPORTER,partner:payload.partner??DEFAULT_PARTNER,year:payload.year??new Date().getFullYear()-1,flow_direction:payload.flow_direction??'export'};
  const policy=await getConfig('comtrade.policy'),client=getComtradeClient(policy),identity=client.identity;
  if(isRealWorkflowEnvironment()&&identity.mode!=='authenticated')throw new Error(`Comtrade ${identity.mode} evidence is forbidden in staging/production.`);
  const clientMode=identity.mode as TradeSourceMode,batchSize=policy.hs_codes_per_request??50;
  let ingestRun=payload.ingest_run_id?await prisma.ingestRun.findUnique({where:{id:payload.ingest_run_id}}):null;
  if(ingestRun?.status===IngestStatus.completed)throw new Error(`IngestRun ${ingestRun.id} is already complete.`);
  if(ingestRun&&(ingestRun.provider!==identity.provider||ingestRun.client_mode!==clientMode||ingestRun.credential_fingerprint!==identity.credential_fingerprint))throw new Error('Resume client identity differs from the original ingest run.');
  let recordsWritten=ingestRun?.records_written??0,progress=ingestRun?.progress as Progress|null;
  ingestRun=ingestRun
    ?await prisma.ingestRun.update({where:{id:ingestRun.id},data:{status:IngestStatus.running,error:null,retry_after:null,completed_at:null}})
    :await prisma.ingestRun.create({data:{source:TradeDataSource.comtrade,provider:identity.provider,client_mode:clientMode,authenticated:identity.authenticated,credential_fingerprint:identity.credential_fingerprint,source_dataset:identity.source_dataset,source_dataset_version:identity.source_dataset_version,code_range:explicitCodes?.join(',')??params.hs_chapter,batch_size:batchSize,status:IngestStatus.running,params:{...params,...(explicitCodes?{hs_codes:explicitCodes}:{})} as unknown as Prisma.InputJsonValue}});

  const throttleLocally=async(nextIndex:number,codes:string[],retryAt:Date,message:string):Promise<JobOutcome>=>{
    await prisma.ingestRun.update({where:{id:ingestRun!.id},data:{status:IngestStatus.throttled,throttle_count:{increment:1},local_quota_throttle_count:{increment:1},last_throttled_at:new Date(),retry_after:retryAt,completed_codes:nextIndex,progress:{hs_codes:codes,next_index:nextIndex},error:message}});
    return {status:JobStatus.partial,result:{ingest_run_id:ingestRun!.id,records_written:recordsWritten,ingest_status:'throttled',throttled:true,throttle_source:'local_quota',retry_after:retryAt.toISOString(),...params}};
  };
  const reserve=()=>identity.mode==='mock'
    ?Promise.resolve({allowed:true,window_start:new Date(),window_end:new Date(Date.now()+86_400_000),requests_reserved:0,configured_limit:policy.daily_request_budget??450})
    :reserveProviderQuota({provider:identity.provider,credential_fingerprint:identity.credential_fingerprint,configured_limit:policy.daily_request_budget??450});

  try{
    if(!progress?.hs_codes&&explicitCodes){
      progress={hs_codes:explicitCodes,next_index:0};
      ingestRun=await prisma.ingestRun.update({where:{id:ingestRun.id},data:{total_codes:explicitCodes.length,progress:progress as Prisma.InputJsonValue}});
    }else if(!progress?.hs_codes){
      const quota=await reserve();
      if(!quota.allowed)return throttleLocally(0,[],quota.window_end,'Persistent daily Comtrade request budget reached; resume after retry_after.');
      await prisma.ingestRun.update({where:{id:ingestRun.id},data:{request_count:{increment:1}}});
      const resolution=await client.resolveChapter(params.hs_chapter);
      progress={hs_codes:resolution.hs_codes,next_index:0};
      ingestRun=await prisma.ingestRun.update({where:{id:ingestRun.id},data:{total_codes:resolution.hs_codes.length,progress:progress as Prisma.InputJsonValue}});
    }
    const codes=progress.hs_codes!;let nextIndex=progress.next_index??0;
    while(nextIndex<codes.length){
      const quota=await reserve();
      if(!quota.allowed)return throttleLocally(nextIndex,codes,quota.window_end,'Persistent daily Comtrade request budget reached; resume after retry_after.');
      if(ingestRun.request_count>0&&policy.request_delay_ms>0)await new Promise(resolve=>setTimeout(resolve,policy.request_delay_ms));
      const hsCodes=codes.slice(nextIndex,nextIndex+batchSize),batchId=`${ingestRun.id}:${nextIndex}-${nextIndex+hsCodes.length}`;
      let fetched;
      try{fetched=await client.fetchChapter({...params,hs_codes:hsCodes});}
      catch(error){
        await prisma.ingestRun.update({where:{id:ingestRun.id},data:{request_count:{increment:1}}});
        if(error instanceof ComtradeRateLimitError){
          const retryAt=new Date(Date.now()+(error.retryAfterMs??86_400_000));
          await prisma.ingestRun.update({where:{id:ingestRun.id},data:{status:IngestStatus.throttled,throttle_count:{increment:1},provider_throttle_count:{increment:1},last_throttled_at:new Date(),retry_after:retryAt,completed_codes:nextIndex,progress:{hs_codes:codes,next_index:nextIndex},error:error.message}});
          return {status:JobStatus.partial,result:{ingest_run_id:ingestRun.id,records_written:recordsWritten,ingest_status:'throttled',throttled:true,throttle_source:'provider',retry_after:retryAt.toISOString(),...params}};
        }throw error;
      }
      const retrievedAt=fetched.retrieved_at??new Date();
      for(const row of fetched.rows){
        const quantity=finitePositiveQuantity(row.quantity),value=Number(row.value),unit=typeof row.unit==='string'&&row.unit.trim()?row.unit.trim():null;
        if(!Number.isFinite(value))continue;
        const unitValue=quantity==null||unit==null?null:value/quantity;
        const data={period:row.period,value:new Prisma.Decimal(value),quantity:quantity==null?null:new Prisma.Decimal(quantity),unit,unit_value:unitValue==null?null:new Prisma.Decimal(unitValue),flow_direction:params.flow_direction as TradeFlowDirection,source:TradeDataSource.comtrade,provider:identity.provider,source_mode:clientMode,ingest_run_id:ingestRun.id,retrieved_at:retrievedAt,request_batch_id:batchId,source_dataset:identity.source_dataset,source_dataset_version:fetched.source_dataset_version??identity.source_dataset_version};
        const flow=await prisma.tradeFlow.upsert({where:{reporter_partner_hs_code_year_flow_direction_source:{reporter:row.reporter,partner:row.partner,hs_code:row.hs_code,year:row.year,flow_direction:params.flow_direction as TradeFlowDirection,source:TradeDataSource.comtrade}},create:{reporter:row.reporter,partner:row.partner,hs_code:row.hs_code,year:row.year,...data},update:{...data,ingested_at:new Date()}});
        const acquisition={trade_flow_id:flow.id,ingest_run_id:ingestRun.id,reporter:row.reporter,partner:row.partner,hs_code:row.hs_code,year:row.year,period:row.period,flow_direction:params.flow_direction as TradeFlowDirection,source:TradeDataSource.comtrade,value:new Prisma.Decimal(value),quantity:quantity==null?null:new Prisma.Decimal(quantity),unit,unit_value:unitValue==null?null:new Prisma.Decimal(unitValue),provider:identity.provider,source_mode:clientMode,retrieved_at:retrievedAt,request_batch_id:batchId,source_dataset:identity.source_dataset,source_dataset_version:fetched.source_dataset_version??identity.source_dataset_version};
        await prisma.tradeFlowAcquisition.upsert({where:{ingest_run_id_reporter_partner_hs_code_year_flow_direction_source:{ingest_run_id:ingestRun.id,reporter:row.reporter,partner:row.partner,hs_code:row.hs_code,year:row.year,flow_direction:params.flow_direction as TradeFlowDirection,source:TradeDataSource.comtrade}},create:acquisition,update:{}});
        recordsWritten++;
      }
      nextIndex+=hsCodes.length;
      ingestRun=await prisma.ingestRun.update({where:{id:ingestRun.id},data:{records_written:recordsWritten,completed_codes:nextIndex,request_count:{increment:fetched.request_count},source_dataset_version:fetched.source_dataset_version??ingestRun.source_dataset_version,progress:{hs_codes:codes,next_index:nextIndex}}});
      void ctx.reportProgress(nextIndex/codes.length*100).catch(()=>undefined);
    }
    await prisma.ingestRun.update({where:{id:ingestRun.id},data:{status:IngestStatus.completed,records_written:recordsWritten,completed_codes:codes.length,completed_at:new Date(),retry_after:null}});
    return {status:JobStatus.completed,result:{ingest_run_id:ingestRun.id,records_written:recordsWritten,ingest_status:'completed',...params}};
  }catch(error){
    const message=error instanceof Error?error.message:String(error),status=recordsWritten>0?IngestStatus.partial:IngestStatus.failed;
    await prisma.ingestRun.update({where:{id:ingestRun.id},data:{status,records_written:recordsWritten,error:message.slice(0,1000),completed_at:new Date()}});
    return {status:status===IngestStatus.partial?JobStatus.partial:JobStatus.failed,result:{ingest_run_id:ingestRun.id,records_written:recordsWritten,ingest_status:status,error:message,...params}};
  }
}

export const __test__={finitePositiveQuantity};
