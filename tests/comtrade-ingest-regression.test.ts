import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { IngestStatus, JobStatus, Prisma, TradeDataSource, TradeFlowDirection, TradeSourceMode } from '@prisma/client';
import { ComtradeApiClient } from '../src/lib/comtrade/real-client';
import { MockComtradeClient } from '../src/lib/comtrade/mock-client';
import { setComtradeClient } from '../src/lib/comtrade';
import { __test__ as ingestTest, runComtradeIngest } from '../src/lib/job-handlers/comtrade';
import { __test__ as scoringTest, type ScoringRow } from '../src/lib/discovery/scoring';
import { CONFIG_DEFAULTS, type DiscoveryScoringPolicy } from '../src/lib/config';
import { prisma } from '../src/lib/prisma';
import { providerDailyWindow, reserveProviderQuota } from '../src/lib/provider-quota';

process.loadEnvFile?.('.env');
const fingerprints:string[]=[];
afterAll(async()=>{
  await prisma.providerQuotaWindow.deleteMany({where:{credential_fingerprint:{in:fingerprints}}});
  await prisma.$disconnect();
});

describe('Comtrade source identity and quantity boundary',()=>{
  const policy={request_delay_ms:0,max_retries:0,retry_backoff_ms:0,hs_codes_per_request:50,daily_request_budget:10,chapter_priority:['09']};
  test('mock, preview, authenticated, and fixture modes remain distinct',()=>{
    expect(new MockComtradeClient().identity.mode).toBe('mock');
    expect(new ComtradeApiClient(null,policy,true).identity.mode).toBe('preview');
    const authenticated=new ComtradeApiClient('high-entropy-test-key',policy,false);
    expect(authenticated.identity.mode).toBe('authenticated');
    expect(authenticated.identity.credential_fingerprint).not.toContain('high-entropy-test-key');
    const fixture={mode:'fixture' as const};
    expect(new Set([new MockComtradeClient().identity.mode,new ComtradeApiClient(null,policy,true).identity.mode,authenticated.identity.mode,fixture.mode]).size).toBe(4);
  });

  test.each([null,undefined,0,-1,Number.NaN,Number.POSITIVE_INFINITY,'not-a-number'])(
    'quantity %s becomes null',value=>expect(ingestTest.finitePositiveQuantity(value)).toBeNull(),
  );
  test('finite positive quantity survives',()=>expect(ingestTest.finitePositiveQuantity('2.5')).toBe(2.5));

  test('explicit HS6 ingest preserves unknown unit and suppresses unit value',async()=>{
    const fingerprint=`unknown-unit-${randomUUID()}`;fingerprints.push(fingerprint);
    const reporter=String(900+Math.floor(Math.random()*90));
    setComtradeClient({name:'unknown-unit-test',identity:{provider:'un_comtrade',mode:'fixture',authenticated:false,credential_fingerprint:fingerprint,source_dataset:'unit-test',source_dataset_version:'v1'},async resolveChapter(){throw new Error('explicit codes must not resolve a chapter');},async fetchChapter(){return {request_count:1,retrieved_at:new Date(),rows:[{reporter,partner:'0',hs_code:'090111',year:2094,period:'2094',value:100,quantity:10,unit:null}]};}});
    let runId:string|undefined;
    try{
      const outcome=await runComtradeIngest({job_id:randomUUID(),attempt_no:1,payload:{hs_chapter:'09',hs_codes:['090111'],reporter,partner:'0',year:2094,flow_direction:'import'},exporter_org_id:null,target_id:null,correlation_id:randomUUID(),reportProgress:async()=>undefined});
      runId=String((outcome.result as {ingest_run_id:string}).ingest_run_id);
      const flow=await prisma.tradeFlow.findFirstOrThrow({where:{ingest_run_id:runId}});
      expect(flow.quantity?.toString()).toBe('10');
      expect(flow.unit).toBeNull();
      expect(flow.unit_value).toBeNull();
    }finally{
      setComtradeClient(null);
      if(runId){await prisma.tradeFlowAcquisition.deleteMany({where:{ingest_run_id:runId}});await prisma.tradeFlow.deleteMany({where:{ingest_run_id:runId}});await prisma.ingestRun.delete({where:{id:runId}});}
    }
  });

  test.each([
    ['fixture',false,2095],['preview',false,2096],['authenticated',true,2097],
  ] as const)('ingest persists %s mode without conflating authentication',async(mode,authenticated,year)=>{
    const fingerprint=`mode-${mode}-${randomUUID()}`;fingerprints.push(fingerprint);
    const run=await prisma.ingestRun.create({data:{source:TradeDataSource.comtrade,provider:'un_comtrade',client_mode:mode,authenticated,credential_fingerprint:fingerprint,source_dataset:'mode-test',status:IngestStatus.partial,params:{hs_chapter:'09',reporter:'998',partner:'0',year,flow_direction:'import'},total_codes:1,progress:{hs_codes:['090111'],next_index:0}}});
    setComtradeClient({name:`${mode}-test`,identity:{provider:'un_comtrade',mode,authenticated,credential_fingerprint:fingerprint,source_dataset:'mode-test',source_dataset_version:'v1'},async resolveChapter(chapter){return {chapter,hs_codes:['090111']};},async fetchChapter(){return {request_count:1,retrieved_at:new Date(),rows:[{reporter:'998',partner:'0',hs_code:'090111',year,period:String(year),value:100,quantity:10,unit:'kg'}]};}});
    try{
      const outcome=await runComtradeIngest({job_id:randomUUID(),attempt_no:1,payload:{hs_chapter:'09',reporter:'998',partner:'0',year,flow_direction:'import',ingest_run_id:run.id},exporter_org_id:null,target_id:null,correlation_id:randomUUID(),reportProgress:async()=>undefined});
      const flow=await prisma.tradeFlow.findFirstOrThrow({where:{ingest_run_id:run.id}});
      const acquisition=await prisma.tradeFlowAcquisition.findFirstOrThrow({where:{ingest_run_id:run.id}});
      expect(outcome.status).toBe('completed');expect(flow.source_mode).toBe(mode);expect(acquisition.source_mode).toBe(mode);
      expect((await prisma.ingestRun.findUniqueOrThrow({where:{id:run.id}})).authenticated).toBe(authenticated);
    }finally{
      setComtradeClient(null);await prisma.tradeFlowAcquisition.deleteMany({where:{ingest_run_id:run.id}});await prisma.tradeFlow.deleteMany({where:{ingest_run_id:run.id}});await prisma.ingestRun.delete({where:{id:run.id}});
    }
  });

  test('resume starts at the persisted code index',async()=>{
    const fingerprint=`resume-${randomUUID()}`;fingerprints.push(fingerprint);
    const run=await prisma.ingestRun.create({data:{source:TradeDataSource.comtrade,provider:'un_comtrade',client_mode:TradeSourceMode.fixture,authenticated:false,credential_fingerprint:fingerprint,source_dataset:'resume-test',status:IngestStatus.throttled,params:{hs_chapter:'09'},total_codes:2,completed_codes:1,progress:{hs_codes:['090111','090112'],next_index:1}}});
    const requested:string[][]=[];
    setComtradeClient({name:'resume-test',identity:{provider:'un_comtrade',mode:'fixture',authenticated:false,credential_fingerprint:fingerprint,source_dataset:'resume-test',source_dataset_version:'v1'},async resolveChapter(){throw new Error('resume must use persisted codes');},async fetchChapter(params){requested.push(params.hs_codes);return {request_count:1,retrieved_at:new Date(),rows:[{reporter:'997',partner:'0',hs_code:params.hs_codes[0],year:2093,period:'2093',value:20,quantity:2,unit:'kg'}]};}});
    try{
      const outcome=await runComtradeIngest({job_id:randomUUID(),attempt_no:2,payload:{hs_chapter:'09',reporter:'997',partner:'0',year:2093,flow_direction:'import',ingest_run_id:run.id},exporter_org_id:null,target_id:null,correlation_id:randomUUID(),reportProgress:async()=>undefined});
      expect(outcome.status).toBe(JobStatus.completed);
      expect(requested).toEqual([['090112']]);
      expect(await prisma.tradeFlow.count({where:{ingest_run_id:run.id}})).toBe(1);
    }finally{setComtradeClient(null);await prisma.tradeFlowAcquisition.deleteMany({where:{ingest_run_id:run.id}});await prisma.tradeFlow.deleteMany({where:{ingest_run_id:run.id}});await prisma.ingestRun.delete({where:{id:run.id}});}
  });

  test('client failure marks both ingest and worker outcome failed',async()=>{
    const fingerprint=`failure-${randomUUID()}`;fingerprints.push(fingerprint);
    setComtradeClient({name:'failure-test',identity:{provider:'un_comtrade',mode:'fixture',authenticated:false,credential_fingerprint:fingerprint,source_dataset:'failure-test',source_dataset_version:'v1'},async resolveChapter(){throw new Error('explicit codes must bypass resolution');},async fetchChapter(){throw new Error('provider contract failure');}});
    let runId:string|undefined;
    try{
      const outcome=await runComtradeIngest({job_id:randomUUID(),attempt_no:1,payload:{hs_chapter:'09',hs_codes:['090111'],reporter:'996',partner:'0',year:2092,flow_direction:'import'},exporter_org_id:null,target_id:null,correlation_id:randomUUID(),reportProgress:async()=>undefined});
      runId=String((outcome.result as {ingest_run_id:string}).ingest_run_id);
      expect(outcome.status).toBe(JobStatus.failed);
      expect(await prisma.ingestRun.findUniqueOrThrow({where:{id:runId}})).toMatchObject({status:IngestStatus.failed,error:'provider contract failure'});
    }finally{setComtradeClient(null);if(runId)await prisma.ingestRun.delete({where:{id:runId}});}
  });
});

describe('persistent shared provider quota',()=>{
  test('concurrent workers cannot overspend a shared window',async()=>{
    const fingerprint=`quota-${randomUUID()}`;fingerprints.push(fingerprint);
    const results=await Promise.all(Array.from({length:8},()=>reserveProviderQuota({provider:'un_comtrade',credential_fingerprint:fingerprint,configured_limit:3})));
    expect(results.filter(result=>result.allowed)).toHaveLength(3);
    expect(await prisma.providerQuotaWindow.findFirstOrThrow({where:{credential_fingerprint:fingerprint}})).toMatchObject({requests_reserved:3});
  });

  test('a new provider window has an independent budget',async()=>{
    const fingerprint=`reset-${randomUUID()}`;fingerprints.push(fingerprint);
    const first=new Date('2030-01-01T12:00:00Z'),second=new Date('2030-01-02T00:00:00Z');
    expect((await reserveProviderQuota({provider:'un_comtrade',credential_fingerprint:fingerprint,configured_limit:1,at:first})).allowed).toBe(true);
    expect((await reserveProviderQuota({provider:'un_comtrade',credential_fingerprint:fingerprint,configured_limit:1,at:first})).allowed).toBe(false);
    expect((await reserveProviderQuota({provider:'un_comtrade',credential_fingerprint:fingerprint,configured_limit:1,at:second})).allowed).toBe(true);
    expect(providerDailyWindow(second).window_start.toISOString()).toBe('2030-01-02T00:00:00.000Z');
  });
});

describe('warehouse identity and configurable scoring history',()=>{
  test('import and export records coexist and retain ingest lineage',async()=>{
    const run=await prisma.ingestRun.create({data:{source:TradeDataSource.comtrade,provider:'un_comtrade',client_mode:TradeSourceMode.fixture,authenticated:false,credential_fingerprint:`flow-${randomUUID()}`,source_dataset:'test-fixture',status:IngestStatus.running,params:{test:true}}});
    try{
      const common={reporter:'999',partner:'0',hs_code:'099999',year:2098,period:'2098',value:new Prisma.Decimal(100),quantity:new Prisma.Decimal(10),unit:'kg',unit_value:new Prisma.Decimal(10),source:TradeDataSource.comtrade,provider:'un_comtrade',source_mode:TradeSourceMode.fixture,ingest_run_id:run.id,retrieved_at:new Date(),source_dataset:'test-fixture'};
      await prisma.tradeFlow.createMany({data:[{...common,flow_direction:TradeFlowDirection.import},{...common,flow_direction:TradeFlowDirection.export}]});
      const rows=await prisma.tradeFlow.findMany({where:{ingest_run_id:run.id}});
      expect(rows.map(row=>row.flow_direction).sort()).toEqual(['export','import']);
      expect(rows.every(row=>row.source_mode==='fixture'&&row.ingest_run_id===run.id)).toBe(true);
    }finally{await prisma.tradeFlow.deleteMany({where:{ingest_run_id:run.id}});await prisma.ingestRun.delete({where:{id:run.id}});}
  });

  test('growth_window_years changes the actual scoring window',()=>{
    const rows:ScoringRow[]=[2020,2021,2022,2023,2024,2025].map((year,index)=>({reporter:'1',partner:'0',hs_code:'090111',year,value:[1000,100,110,120,130,140][index],quantity:null,unit_value:null,ingested_at:new Date(`${year}-12-31T00:00:00Z`)}));
    const base:DiscoveryScoringPolicy={...CONFIG_DEFAULTS['discovery.scoring'],model_version:'test',archetype_profiles:{},volume_floor_usd:0,growth_window_years:5,rationale_top_n:0};
    const long=scoringTest.growthMomentum(rows,base),short=scoringTest.growthMomentum(rows,{...base,growth_window_years:2});
    expect(long.score).not.toBe(short.score);
    expect(long.provenance).toMatchObject({row_count:6});
    expect(short.provenance).toMatchObject({row_count:3});
  });
});
