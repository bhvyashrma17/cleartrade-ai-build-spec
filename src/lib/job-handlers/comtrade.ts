/** Durable, provenance-preserving UN Comtrade warehouse ingest. */
import { createHash } from 'node:crypto';
import { IngestStatus, JobStatus, Prisma, TradeDataSource, TradeFlowDirection, TradeSourceMode } from '@prisma/client';
import { ComtradeProviderRequestError, ComtradeRateLimitError, getComtradeClient } from '@/lib/comtrade';
import type { FlowDirection } from '@/lib/comtrade';
import { getConfig } from '@/lib/config';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { reconcileProviderQuota, reserveProviderQuota } from '@/lib/provider-quota';
import { appEnvironment, isRealWorkflowEnvironment, tradeSourceModeToEvidenceOrigin } from '@/lib/evidence-environment';
import { canonicalComtradeRequest, comtradeRequestFingerprint } from '@/lib/comtrade/request';
import { toIso2, WORLD_PARTNER } from '@/lib/comtrade/areas';

interface ComtradeIngestPayload { hs_chapter:string; hs_codes?:string[]; reporter?:string; partner?:string; partner2?:string; year?:number; flow_direction?:FlowDirection; hs_revision?:string; frequency?:'A'|'M'; customs_code?:string; mode_of_supply?:string; purpose?:'country_truth'|'general_ingest'; ingest_run_id?:string }
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
  const params={hs_chapter:payload.hs_chapter,reporter:payload.reporter??DEFAULT_REPORTER,partner:payload.partner??DEFAULT_PARTNER,partner2:payload.partner2??'0',year:payload.year??new Date().getFullYear()-1,flow_direction:payload.flow_direction??'export',hs_revision:payload.hs_revision??'unknown',frequency:payload.frequency??'A',customs_code:payload.customs_code??'C00',mode_of_supply:payload.mode_of_supply??'0',purpose:payload.purpose??'general_ingest'};
  if(params.purpose==='country_truth'&&(!payload.reporter||!payload.partner||!payload.year||!payload.flow_direction||!payload.hs_revision))throw new Error('Country Truth ingest requires explicit reporter, partner, year, import flow, and HS revision.');
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

  const reserve=()=>identity.mode==='mock'||identity.mode==='fixture'
    ?Promise.resolve({allowed:true,window_start:new Date(),window_end:new Date(Date.now()+86_400_000),requests_reserved:0,configured_limit:policy.daily_request_budget??450})
    :reserveProviderQuota({provider:identity.provider,credential_fingerprint:identity.credential_fingerprint,configured_limit:policy.daily_request_budget??450});

  try{
    if(!progress?.hs_codes&&explicitCodes){
      progress={hs_codes:explicitCodes,next_index:0};
      ingestRun=await prisma.ingestRun.update({where:{id:ingestRun.id},data:{total_codes:explicitCodes.length,progress:progress as Prisma.InputJsonValue}});
    }else if(!progress?.hs_codes){
      const reference=params.hs_revision!=='unknown'?await prisma.hsReferenceSnapshot.findFirst({where:{provider:identity.provider,revision:params.hs_revision,retrieved_at:{gte:new Date(Date.now()-30*86_400_000)}},orderBy:{retrieved_at:'desc'}}):null;
      let resolution;
      if(reference){const body=JSON.parse(reference.raw_response_text) as {results?:Array<{id:string;isLeaf:string|number;aggrLevel:number}>};resolution={chapter:params.hs_chapter,hs_codes:(body.results??[]).filter(row=>row.aggrLevel===6&&String(row.isLeaf)==='1'&&row.id.startsWith(params.hs_chapter)).map(row=>row.id).sort()};}
      else{resolution=await client.resolveChapter(params.hs_chapter);if(params.hs_revision!=='unknown'&&resolution.raw_response_text&&resolution.response_checksum)await prisma.hsReferenceSnapshot.create({data:{provider:identity.provider,nomenclature:'HS',revision:params.hs_revision,source_url:'https://comtradeapi.un.org/files/v1/app/reference/HS.json',response_checksum:resolution.response_checksum,raw_response_text:resolution.raw_response_text,retrieved_at:resolution.retrieved_at??new Date(),dataset_version:resolution.dataset_version,parser_version:'comtrade-hs-reference-v1'}});}
      progress={hs_codes:resolution.hs_codes,next_index:0};
      ingestRun=await prisma.ingestRun.update({where:{id:ingestRun.id},data:{total_codes:resolution.hs_codes.length,progress:progress as Prisma.InputJsonValue}});
    }
    const codes=progress.hs_codes!;let nextIndex=progress.next_index??0;
    while(nextIndex<codes.length){
      if(ingestRun.request_count>0&&policy.request_delay_ms>0)await new Promise(resolve=>setTimeout(resolve,policy.request_delay_ms));
      const hsCodes=codes.slice(nextIndex,nextIndex+batchSize),batchId=`${ingestRun.id}:${nextIndex}-${nextIndex+hsCodes.length}`;
      const request=canonicalComtradeRequest({provider:'un_comtrade',dataset:'goods-trade',source_mode:identity.mode,purpose:params.purpose,reporter_code:params.reporter,partner_code:params.partner,partner2_code:params.partner2,flow_direction:params.flow_direction,frequency:params.frequency,period:String(params.year),hs_codes:hsCodes,hs_revision:params.hs_revision,customs_code:params.customs_code,mode_of_supply:params.mode_of_supply});
      const requestFingerprint=comtradeRequestFingerprint(request),freshAfter=new Date(Date.now()-(policy.evidence_cache_ttl_hours??168)*3_600_000);
      const cached=params.purpose==='country_truth'?await prisma.sourceEvidence.findFirst({where:{request_fingerprint:requestFingerprint,source_origin:tradeSourceModeToEvidenceOrigin(clientMode),completeness:'COMPLETE',status:'accepted',parser_version:'comtrade-parser-v2',retrieved_at:{gte:freshAfter}},include:{observations:true},orderBy:{retrieved_at:'desc'}}):null;
      let fetched;
      try{fetched=cached?{rows:cached.observations.map(row=>({reporter:row.reporter_code,partner:row.partner_code,partner2:row.partner2_code,hs_code:row.hs_code,year:row.ref_year,period:row.period,value:row.trade_value==null?null:Number(row.trade_value),value_status:row.trade_value_status as 'observed',quantity:row.quantity==null?null:Number(row.quantity),quantity_status:row.quantity_status as 'observed',unit:row.quantity_unit,flow_code:row.flow_direction==='import'?'M':'X',frequency:row.frequency,customs_code:row.customs_code,mode_of_supply:row.mode_of_supply,alternate_quantity:row.alternate_quantity==null?null:Number(row.alternate_quantity),alternate_quantity_unit:row.alternate_quantity_unit,net_weight:row.net_weight==null?null:Number(row.net_weight),gross_weight:row.gross_weight==null?null:Number(row.gross_weight),estimate_flag:row.estimate_flag,suppression_flag:row.suppression_flag,confidentiality_flag:row.confidentiality_flag})),request_count:0,retrieved_at:cached.retrieved_at,source_dataset_version:cached.dataset_version,evidence_pages:[]} :await client.fetchChapter({...params,hs_codes:hsCodes,before_physical_request:async()=>{const quota=await reserve();if(!quota.allowed)throw new ComtradeRateLimitError('Persistent daily Comtrade request budget reached.',quota.window_end.getTime()-Date.now(),0);},after_physical_response:async({headers,retrieved_at})=>{const number=(name:string)=>{const raw=headers.get(name);return raw!=null&&Number.isFinite(Number(raw))?Number(raw):null;};const rawReset=headers.get('x-ratelimit-reset')??headers.get('ratelimit-reset');const reset=rawReset?(Number.isFinite(Number(rawReset))?new Date(Number(rawReset)*1000):new Date(rawReset)):null;await reconcileProviderQuota({provider:identity.provider,credential_fingerprint:identity.credential_fingerprint,at:retrieved_at,limit:number('x-ratelimit-limit')??number('ratelimit-limit'),remaining:number('x-ratelimit-remaining')??number('ratelimit-remaining'),reset_at:reset&&!Number.isNaN(reset.getTime())?reset:null});}});}
      catch(error){
        const physicalRequestCount=error instanceof ComtradeRateLimitError||error instanceof ComtradeProviderRequestError?error.physicalRequestCount:0;
        if(physicalRequestCount>0)await prisma.ingestRun.update({where:{id:ingestRun.id},data:{request_count:{increment:physicalRequestCount}}});
        if(error instanceof ComtradeRateLimitError){
          const retryAt=new Date(Date.now()+(error.retryAfterMs??86_400_000));
          await prisma.ingestRun.update({where:{id:ingestRun.id},data:{status:IngestStatus.throttled,throttle_count:{increment:1},provider_throttle_count:{increment:1},last_throttled_at:new Date(),retry_after:retryAt,completed_codes:nextIndex,progress:{hs_codes:codes,next_index:nextIndex},error:error.message}});
          return {status:JobStatus.partial,result:{ingest_run_id:ingestRun.id,records_written:recordsWritten,ingest_status:'throttled',throttled:true,throttle_source:'provider',retry_after:retryAt.toISOString(),...params}};
        }throw error;
      }
      const retrievedAt=fetched.retrieved_at??new Date();
      let sourceEvidenceId=cached?.id??null;
      if(params.purpose==='country_truth'&&!sourceEvidenceId){const page=fetched.evidence_pages?.[0];const raw=page?.raw_response_text??JSON.stringify({rows:fetched.rows});const created=await prisma.sourceEvidence.create({data:{ingest_run_id:ingestRun.id,provider:identity.provider,dataset:identity.source_dataset,dataset_version:fetched.source_dataset_version??identity.source_dataset_version,source_origin:tradeSourceModeToEvidenceOrigin(clientMode),environment:appEnvironment(),request_fingerprint:requestFingerprint,request_parameters:request as unknown as Prisma.InputJsonValue,redacted_request:page?.redacted_request??`comtrade://${requestFingerprint}`,http_status:page?.http_status??200,response_checksum:page?.response_checksum??createHash('sha256').update(raw).digest('hex'),raw_response_text:raw,retrieved_at:page?.retrieved_at??retrievedAt,provider_row_count:page?.provider_row_count,returned_row_count:page?.returned_row_count??fetched.rows.length,completeness:page?.completeness??'COMPLETE',completeness_metadata:(page?.completeness_metadata??{synthetic_client_contract:true}) as Prisma.InputJsonValue,quota_metadata:page?.quota_metadata as Prisma.InputJsonValue|undefined,parser_version:'comtrade-parser-v2',status:(page?.completeness??'COMPLETE')==='COMPLETE'?'accepted':'partial'}});sourceEvidenceId=created.id;}
      for(const row of fetched.rows){
        const quantity=finitePositiveQuantity(row.quantity),normalizedQuantity=typeof row.quantity==='number'&&Number.isFinite(row.quantity)&&row.quantity>=0?row.quantity:null,value=Number(row.value),unit=typeof row.unit==='string'&&row.unit.trim()?row.unit.trim():null;
        const observationKey=sourceEvidenceId?createHash('sha256').update(JSON.stringify({sourceEvidenceId,reporter:row.reporter,partner:row.partner,partner2:row.partner2??params.partner2,hs:row.hs_code,year:row.year,flow:params.flow_direction,frequency:params.frequency,customs:params.customs_code,mos:params.mode_of_supply})).digest('hex'):null;
        if(sourceEvidenceId&&observationKey)await prisma.normalizedTradeObservation.createMany({data:[{source_evidence_id:sourceEvidenceId,observation_key:observationKey,reporter_code:row.reporter,reporter_iso2:toIso2(row.reporter),partner_code:row.partner,partner_iso2:toIso2(row.partner),partner_is_world:row.partner===WORLD_PARTNER,partner2_code:row.partner2??params.partner2,flow_direction:params.flow_direction,frequency:params.frequency,period:row.period,ref_year:row.year,hs_code:row.hs_code,hs_level:6,hs_revision:params.hs_revision,customs_code:row.customs_code??params.customs_code,mode_of_supply:row.mode_of_supply??params.mode_of_supply,trade_value:row.value==null?null:new Prisma.Decimal(row.value),trade_value_status:row.value_status??(row.value==null?'missing':row.value===0?'observed_zero':'observed'),quantity:normalizedQuantity==null?null:new Prisma.Decimal(normalizedQuantity),quantity_status:row.quantity_status??(row.quantity==null?'missing':normalizedQuantity==null?'invalid':row.quantity===0?'observed_zero':'observed'),quantity_unit:unit,alternate_quantity:row.alternate_quantity==null?null:new Prisma.Decimal(row.alternate_quantity),alternate_quantity_unit:row.alternate_quantity_unit,net_weight:row.net_weight==null?null:new Prisma.Decimal(row.net_weight),gross_weight:row.gross_weight==null?null:new Prisma.Decimal(row.gross_weight),estimate_flag:row.estimate_flag,suppression_flag:row.suppression_flag,confidentiality_flag:row.confidentiality_flag,normalization_version:'comtrade-normalization-v1',retrieved_at:retrievedAt,source_origin:tradeSourceModeToEvidenceOrigin(clientMode)}],skipDuplicates:true});
        if(row.value==null||!Number.isFinite(value))continue;
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
