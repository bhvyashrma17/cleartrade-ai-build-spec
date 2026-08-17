import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { EvidenceOrigin, TradeDataSource, TradeFlowDirection, TradeSourceMode } from '@prisma/client';
import {
  allowedEvidenceOrigins,
  assertFixtureMutationAllowed,
  buyerOutcomeEvidenceWhere,
} from '../src/lib/evidence-environment';
import { getComtradeClient, setComtradeClient } from '../src/lib/comtrade';
import { MockComtradeClient } from '../src/lib/comtrade/mock-client';
import { ComtradeApiClient } from '../src/lib/comtrade/real-client';
import { runComtradeIngest } from '../src/lib/job-handlers/comtrade';
import { runCbpManifestIngest } from '../src/lib/job-handlers/cbp-manifest';
import { WarehouseDiscoveryEngine } from '../src/lib/discovery/warehouse-engine';
import { prisma } from '../src/lib/prisma';

const originalAppEnv=process.env.APP_ENV,originalClient=process.env.COMTRADE_CLIENT;
const policy={request_delay_ms:0,max_retries:0,retry_backoff_ms:0,hs_codes_per_request:50,daily_request_budget:10,chapter_priority:['09']};
const env=(APP_ENV:string)=>({NODE_ENV:'test',APP_ENV} as NodeJS.ProcessEnv);
afterEach(()=>{if(originalAppEnv===undefined)delete process.env.APP_ENV;else process.env.APP_ENV=originalAppEnv;if(originalClient===undefined)delete process.env.COMTRADE_CLIENT;else process.env.COMTRADE_CLIENT=originalClient;setComtradeClient(null);});
afterAll(()=>prisma.$disconnect());

describe('environment evidence matrix',()=>{
  test('fixtures are allowed in test and explicit demo environments',()=>{
    expect(allowedEvidenceOrigins(env('test'))).toContain(EvidenceOrigin.fixture);
    expect(allowedEvidenceOrigins(env('demo'))).toContain(EvidenceOrigin.fixture);
  });

  test('production fixture seed and fixture ingestion fail closed',async()=>{
    expect(()=>assertFixtureMutationAllowed('seed',env('production'))).toThrow(/disabled in production/);
    process.env.APP_ENV='production';
    setComtradeClient(new MockComtradeClient());
    await expect(runComtradeIngest({job_id:randomUUID(),attempt_no:1,payload:{hs_chapter:'09'},exporter_org_id:null,target_id:null,correlation_id:randomUUID(),reportProgress:async()=>{}})).rejects.toThrow(/mock evidence is forbidden/);
    await expect(runCbpManifestIngest({job_id:randomUUID(),attempt_no:1,payload:{file_path:'unused',license_file_path:'unused',evidence_origin:'fixture'},exporter_org_id:null,target_id:null,correlation_id:randomUUID(),reportProgress:async()=>{}})).rejects.toThrow(/fixture evidence is forbidden/);
  });

  test('mock cannot be a silent production default and preview stays non-real',()=>{
    process.env.APP_ENV='production';delete process.env.COMTRADE_CLIENT;setComtradeClient(null);
    expect(()=>getComtradeClient(policy)).toThrow(/explicitly set to real/);
    const preview=new ComtradeApiClient(null,policy,true);
    expect(preview.identity.mode).toBe('preview');
    expect(allowedEvidenceOrigins(env('production'))).not.toContain(EvidenceOrigin.preview);
  });

  test('production warehouse discovery ignores fixture TradeFlow evidence',async()=>{
    const hs=`09${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
    const base={partner:'0',hs_code:hs,period:'2092',quantity:null,unit:null,unit_value:null,flow_direction:TradeFlowDirection.import,source:TradeDataSource.comtrade,retrieved_at:new Date(),source_dataset:'isolation-test'};
    await prisma.tradeFlow.createMany({data:[
      ...[2090,2091,2092].map((year,index)=>({...base,reporter:'842',year,period:String(year),value:1_000_000+index*100_000,provider:'un_comtrade',source_mode:TradeSourceMode.authenticated})),
      ...[2090,2091,2092].map((year,index)=>({...base,reporter:'826',year,period:String(year),value:9_000_000+index*100_000,provider:'fixture',source_mode:TradeSourceMode.fixture})),
    ]});
    try{
      process.env.APP_ENV='production';
      const result=await new WarehouseDiscoveryEngine().rank({description:'isolation test',hs_code:hs,target_countries:['US','GB'],origin_country:'IN'});
      expect(result.assessments.map(item=>item.country_code)).toEqual(['US']);
      expect(result.assessments[0].evidence_origins).toEqual(['authenticated_real']);
    }finally{await prisma.tradeFlow.deleteMany({where:{hs_code:hs,source_dataset:'isolation-test'}});}
  });

  test('fixture BuyerOutcome is excluded from the real-learning predicate',()=>{
    const where=buyerOutcomeEvidenceWhere(env('production'));
    expect(where).toEqual({evidence_origin:{in:[EvidenceOrigin.authenticated_real,EvidenceOrigin.public_real,EvidenceOrigin.imported_real,EvidenceOrigin.manually_entered_real]}});
    expect((where.evidence_origin as {in:EvidenceOrigin[]}).in).not.toContain(EvidenceOrigin.fixture);
  });
});
