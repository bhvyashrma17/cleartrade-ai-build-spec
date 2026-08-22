import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { ComtradeApiClient, parseOptionalProviderNumber } from '../src/lib/comtrade/real-client';
import { setComtradeClient } from '../src/lib/comtrade';
import { canonicalComtradeRequest, comtradeRequestFingerprint } from '../src/lib/comtrade/request';
import { runComtradeIngest } from '../src/lib/job-handlers/comtrade';
import { prisma } from '../src/lib/prisma';
import { providerDailyWindow, reconcileProviderQuota, reserveProviderQuota } from '../src/lib/provider-quota';

const policy={request_timeout_ms:20,evidence_cache_ttl_hours:168,request_delay_ms:0,max_retries:1,retry_backoff_ms:0,hs_codes_per_request:50,daily_request_budget:100,chapter_priority:['09']};
const baseRequest=canonicalComtradeRequest({provider:'un_comtrade',dataset:'goods-trade',source_mode:'authenticated',purpose:'country_truth',reporter_code:'276',partner_code:'0',partner2_code:'0',flow_direction:'import',frequency:'A',period:'2024',hs_codes:['090111'],hs_revision:'HS2022',customs_code:'C00',mode_of_supply:'0'});
const params={hs_chapter:'09',reporter:'276',partner:'0',partner2:'0',year:2024,flow_direction:'import' as const,frequency:'A' as const,hs_revision:'HS2022',customs_code:'C00',mode_of_supply:'0',purpose:'country_truth' as const,hs_codes:['090111']};
const row={reporterCode:276,partnerCode:0,partner2Code:0,cmdCode:'090111',refYear:2024,period:'2024',flowCode:'M',freqCode:'A',primaryValue:100,qty:10,qtyUnitAbbr:'kg',customsCode:'C00',mosCode:'0'};
const response=(data:unknown[],count=data.length,headers:Record<string,string>={})=>new Response(JSON.stringify({count,data}),{status:200,headers:{'content-type':'application/json',...headers}});

afterEach(()=>{vi.unstubAllGlobals();setComtradeClient(null);});
afterAll(()=>prisma.$disconnect());

describe('Country Truth provider boundary',()=>{
  test.each([[null,'missing'],[undefined,'missing'],['','missing'],['suppressed','suppressed'],['unavailable','unavailable'],['N/A','unavailable'],['x','invalid'],[0,'observed_zero'],['0','observed_zero'],[2.5,'observed']])('parses %s without null-to-zero coercion',(input,status)=>expect(parseOptionalProviderNumber(input)).toMatchObject({status}));

  test('canonical fingerprints are stable and dimension-complete',()=>{
    expect(comtradeRequestFingerprint(baseRequest)).toBe(comtradeRequestFingerprint({...baseRequest,hs_codes:['090111']}));
    for(const changed of [{reporter_code:'842'},{partner_code:'699'},{period:'2023'},{flow_direction:'export' as const,purpose:'general_ingest' as const},{hs_revision:'HS2017'}])expect(comtradeRequestFingerprint({...baseRequest,...changed})).not.toBe(comtradeRequestFingerprint(baseRequest));
    expect(()=>canonicalComtradeRequest({...baseRequest,flow_direction:'export'})).toThrow(/imports/);
  });

  test.each([
    ['reporter',{reporterCode:842}],['partner',{partnerCode:699}],['year',{refYear:2023}],['flow',{flowCode:'X'}],['frequency',{freqCode:'M'}],['HS revision',{clCode:'H5'}],
  ])('rejects a mismatched %s row into partial evidence',async(_name,change)=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([{...row,...change}])));
    const result=await new ComtradeApiClient('key',policy).fetchChapter(params);
    expect(result.rows).toEqual([]);expect(result.evidence_pages?.[0]).toMatchObject({completeness:'PARTIAL',completeness_metadata:{rejected_rows:1}});
  });

  test('null trade value is retained as missing while real zero remains observed zero',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([{...row,primaryValue:null},{...row,cmdCode:'090112',primaryValue:0}],2)));
    const result=await new ComtradeApiClient('key',policy).fetchChapter({...params,hs_codes:['090111','090112']});
    expect(result.rows.map(item=>[item.value,item.value_status])).toEqual([[null,'missing'],[0,'observed_zero']]);
  });

  test('explicit all-suppliers scope accepts distinct partner rows without weakening other dimensions',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([{...row,partnerCode:156},{...row,partnerCode:699}],2)));
    const result=await new ComtradeApiClient('key',policy).fetchChapter({...params,partner:'all'});
    expect(result.rows.map(item=>item.partner)).toEqual(['156','699']);
    expect(result.evidence_pages?.[0]).toMatchObject({completeness:'COMPLETE',completeness_metadata:{rejected_rows:0}});
  });

  test('real zero quantity remains observed zero without becoming a unit-value denominator',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([{...row,qty:0}])))
    const result=await new ComtradeApiClient('key',policy).fetchChapter(params);
    expect(result.rows[0]).toMatchObject({quantity:0,quantity_status:'observed_zero'});
  });

  test('response checksum/raw round trip, quota metadata and truncation are explicit',async()=>{
    const raw=JSON.stringify({count:2,data:[row]});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(raw,{status:200,headers:{'x-ratelimit-limit':'500','x-ratelimit-remaining':'499'}})));
    const result=await new ComtradeApiClient('key',policy).fetchChapter(params);const page=result.evidence_pages![0];
    expect(page.raw_response_text).toBe(raw);expect(page.response_checksum).toBe(createHash('sha256').update(raw).digest('hex'));expect(page.completeness).toBe('PARTIAL');expect(page.quota_metadata).toMatchObject({limit:500,remaining:499});
  });

  test('each physical retry invokes quota hooks and timeout aborts',async()=>{
    const before=vi.fn(async()=>undefined),after=vi.fn(async()=>undefined),fetchMock=vi.fn().mockResolvedValueOnce(new Response('bad',{status:500})).mockResolvedValueOnce(response([row]));vi.stubGlobal('fetch',fetchMock);
    await new ComtradeApiClient('key',policy).fetchChapter({...params,before_physical_request:before,after_physical_response:after});
    expect(before).toHaveBeenCalledTimes(2);expect(after).toHaveBeenCalledTimes(2);
    vi.stubGlobal('fetch',vi.fn((_url:unknown,init?:RequestInit)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))));
    await expect(new ComtradeApiClient('key',{...policy,max_retries:0}).fetchChapter(params)).rejects.toThrow(/abort/i);
  });

  test('Retry-After is honored and terminal provider errors retain every physical call',async()=>{
    const before=vi.fn(async()=>undefined);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('',{status:429,headers:{'retry-after':'0'}})).mockResolvedValueOnce(response([row])));
    await new ComtradeApiClient('key',policy).fetchChapter({...params,before_physical_request:before});
    expect(before).toHaveBeenCalledTimes(2);

    vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(new Response('down',{status:503}))));
    await expect(new ComtradeApiClient('key',policy).fetchChapter(params)).rejects.toMatchObject({physicalRequestCount:2});
  });
});

describe('provider quota reconciliation',()=>{
  test('provider headers are retained without erasing physical reservations',async()=>{
    const credential=`quota-${randomUUID()}`,at=new Date('2031-04-05T12:00:00Z');
    await reserveProviderQuota({provider:'un_comtrade',credential_fingerprint:credential,configured_limit:100,at});
    await reconcileProviderQuota({provider:'un_comtrade',credential_fingerprint:credential,at,limit:500,remaining:417,reset_at:new Date('2031-04-06T00:00:00Z')});
    const row=await prisma.providerQuotaWindow.findUniqueOrThrow({where:{provider_credential_fingerprint_window_start:{provider:'un_comtrade',credential_fingerprint:credential,window_start:providerDailyWindow(at).window_start}}});
    expect(row).toMatchObject({requests_reserved:1,provider_reported_limit:500,provider_reported_remaining:417});
  });
});

describe('immutable evidence persistence and cache',()=>{
  test('persists raw evidence and normalized missingness, then reuses fresh exact evidence',async()=>{
    const reporter=String(910+Math.floor(Math.random()*80)),year=2088,calls=vi.fn();
    const raw=JSON.stringify({count:2,data:[{kind:'fixture'}]});
    setComtradeClient({name:'country-truth-fixture',identity:{provider:'un_comtrade',mode:'fixture',authenticated:false,credential_fingerprint:`fixture-${randomUUID()}`,source_dataset:'fixture-country-truth',source_dataset_version:'v1'},async resolveChapter(){throw new Error('explicit HS6 must bypass reference');},async fetchChapter(_input){calls();return {request_count:1,retrieved_at:new Date(),source_dataset_version:'v1',rows:[{reporter,partner:'0',partner2:'0',hs_code:'090111',year,period:String(year),value:null,value_status:'suppressed',quantity:null,unit:null,flow_code:'M',frequency:'A',customs_code:'C00',mode_of_supply:'0',suppression_flag:true}],evidence_pages:[{http_status:200,raw_response_text:raw,response_checksum:createHash('sha256').update(raw).digest('hex'),redacted_request:'https://comtradeapi.un.org/redacted',provider_row_count:1,returned_row_count:1,completeness:'COMPLETE',completeness_metadata:{truncated:false},quota_metadata:null,retrieved_at:new Date()}]};}});
    const payload={hs_chapter:'09',hs_codes:['090111'],reporter,partner:'0',year,flow_direction:'import',hs_revision:'HS2022',frequency:'A',purpose:'country_truth'};
    const context=()=>({job_id:randomUUID(),attempt_no:1,payload,exporter_org_id:null,target_id:null,correlation_id:randomUUID(),reportProgress:async()=>undefined});
    const first=await runComtradeIngest(context()),second=await runComtradeIngest(context());
    expect(first.status).toBe('completed');expect(second.status).toBe('completed');expect(calls).toHaveBeenCalledTimes(1);
    const evidence=await prisma.sourceEvidence.findFirstOrThrow({where:{request_parameters:{path:['reporter_code'],equals:reporter}}});
    expect(evidence.raw_response_text).toBe(raw);expect(evidence.response_checksum).toBe(createHash('sha256').update(raw).digest('hex'));
    const observation=await prisma.normalizedTradeObservation.findFirstOrThrow({where:{source_evidence_id:evidence.id}});
    expect(observation).toMatchObject({trade_value:null,trade_value_status:'suppressed',hs_revision:'HS2022',suppression_flag:true});
    expect(await prisma.tradeFlow.count({where:{reporter,year}})).toBe(0);
    await expect(prisma.sourceEvidence.update({where:{id:evidence.id},data:{status:'rewritten'}})).rejects.toThrow(/immutable/);
  });

  test('stale and wrong-origin evidence cannot satisfy a fixture acquisition',async()=>{
    const reporter=String(810+Math.floor(Math.random()*80)),year=2087,calls=vi.fn(),retrievedAt=new Date();
    const request=canonicalComtradeRequest({...baseRequest,source_mode:'fixture',reporter_code:reporter,period:String(year)});
    const fingerprint=comtradeRequestFingerprint(request);
    const evidenceBase={provider:'un_comtrade',dataset:'fixture-country-truth',dataset_version:'v1',environment:'development',request_fingerprint:fingerprint,request_parameters:JSON.parse(JSON.stringify(request)) as Prisma.InputJsonValue,redacted_request:'comtrade://redacted',http_status:200,response_checksum:createHash('sha256').update('{}').digest('hex'),raw_response_text:'{}',provider_row_count:1,returned_row_count:1,completeness:'COMPLETE' as const,parser_version:'comtrade-parser-v2',status:'accepted'};
    await prisma.sourceEvidence.createMany({data:[
      {...evidenceBase,id:randomUUID(),source_origin:'fixture',retrieved_at:new Date(Date.now()-200*3_600_000)},
      {...evidenceBase,id:randomUUID(),source_origin:'authenticated_real',retrieved_at:new Date()},
    ]});
    setComtradeClient({name:'cache-isolation-fixture',identity:{provider:'un_comtrade',mode:'fixture',authenticated:false,credential_fingerprint:`fixture-${randomUUID()}`,source_dataset:'fixture-country-truth',source_dataset_version:'v1'},async resolveChapter(){throw new Error('explicit HS6 must bypass reference');},async fetchChapter(){calls();return {request_count:1,retrieved_at:retrievedAt,source_dataset_version:'v1',rows:[{reporter,partner:'0',partner2:'0',hs_code:'090111',year,period:String(year),value:10,value_status:'observed',quantity:1,quantity_status:'observed',unit:'kg',flow_code:'M',frequency:'A',customs_code:'C00',mode_of_supply:'0'}],evidence_pages:[{http_status:200,raw_response_text:'{"count":1}',response_checksum:createHash('sha256').update('{"count":1}').digest('hex'),redacted_request:'comtrade://redacted',provider_row_count:1,returned_row_count:1,completeness:'COMPLETE',completeness_metadata:{truncated:false},quota_metadata:null,retrieved_at:retrievedAt}]};}});
    const outcome=await runComtradeIngest({job_id:randomUUID(),attempt_no:1,payload:{hs_chapter:'09',hs_codes:['090111'],reporter,partner:'0',year,flow_direction:'import',hs_revision:'HS2022',frequency:'A',purpose:'country_truth'},exporter_org_id:null,target_id:null,correlation_id:randomUUID(),reportProgress:async()=>undefined});
    expect(outcome.status).toBe('completed');
    expect(calls).toHaveBeenCalledTimes(1);
    expect(await prisma.sourceEvidence.count({where:{request_fingerprint:fingerprint}})).toBe(3);
  });
});
