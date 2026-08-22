import { afterEach, describe, expect, test, vi } from 'vitest';
import { ComtradeApiClient } from '../src/lib/comtrade/real-client';

const policy={request_delay_ms:0,max_retries:0,retry_backoff_ms:0,hs_codes_per_request:50,daily_request_budget:10,chapter_priority:['09']};
const params={hs_chapter:'09',reporter:'842',partner:'0',year:2024,flow_direction:'import' as const,hs_codes:['090111']};
const base={reporterCode:842,partnerCode:0,partner2Code:0,cmdCode:'090111',refYear:2024,period:'2024',primaryValue:123.456,qty:10,qtyUnitCode:8,qtyUnitAbbr:null,customsCode:'C00',mosCode:'0'};

afterEach(()=>vi.unstubAllGlobals());
function response(data:unknown[],status=200,headers:Record<string,string>={}){return new Response(JSON.stringify({elapsedTime:'0.01',count:data.length,data,error:''}),{status,headers:{'content-type':'application/json',...headers}});}

describe('authenticated Comtrade response transformation',()=>{
  test('maps the live row shape, unit-code fallback, types, and precision',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(response([base],200,{etag:'dataset-v1'}));vi.stubGlobal('fetch',fetchMock);
    const client=new ComtradeApiClient('test-key-never-logged',policy);
    const result=await client.fetchChapter(params);
    expect(result.rows).toHaveLength(1);expect(result.rows[0]).toMatchObject({reporter:'842',partner:'0',hs_code:'090111',year:2024,period:'2024',value:123.456,value_status:'observed',quantity:10,unit:'kg'});
    expect(result.source_dataset_version).toBe('dataset-v1');
    const request=fetchMock.mock.calls[0];expect(String(request[0])).toContain('cmdCode=090111');expect(request[1].headers).toHaveProperty('Ocp-Apim-Subscription-Key','test-key-never-logged');
  });

  test.each([null,0,-2,'not-a-number'])(`quantity %s becomes null`,async(qty)=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([{...base,qty}])));
    const result=await new ComtradeApiClient('key',policy).fetchChapter(params);
    expect(result.rows[0]).toMatchObject({quantity:null,unit:null});
  });

  test('filters non-total partner2, customs, mode-of-supply, duplicate, and unrequested rows',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([base,{...base,partner2Code:36},{...base,customsCode:'C01'},{...base,mosCode:'1'},{...base,cmdCode:'090112'},base])));
    const result=await new ComtradeApiClient('key',policy).fetchChapter(params);
    expect(result.rows).toHaveLength(1);
  });

  test('malformed and provider error responses fail rather than returning invented rows',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'bad request'}),{status:400,headers:{'content-type':'application/json'}})));
    await expect(new ComtradeApiClient('key',policy).fetchChapter(params)).rejects.toThrow(/400/);
  });
});
