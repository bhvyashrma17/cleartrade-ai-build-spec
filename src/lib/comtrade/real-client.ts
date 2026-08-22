/** Authenticated/preview UN Comtrade client with fail-closed identity and completeness checks. */
import { createHash } from 'node:crypto';
import type { ComtradePolicy } from '@/lib/config';
import type { ComtradeClient, ComtradeFetchParams, ComtradeFetchResult, ComtradeFlowRow } from './client';
import { ComtradeRateLimitError } from './client';

const AUTH_BASE_URL = 'https://comtradeapi.un.org/data/v1/get/C/A/HS';
const PREVIEW_BASE_URL = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';
const HS_REFERENCE_URL = 'https://comtradeapi.un.org/files/v1/app/reference/HS.json';
const PARSER_VERSION = 'comtrade-parser-v2';
interface ReferenceRow { id: string; isLeaf: string | number; aggrLevel: number; }
interface ComtradeApiRow {
  reporterCode: number|string; partnerCode: number|string; partner2Code?: number|string|null;
  cmdCode: string; refYear: number; period: number|string; flowCode?: string|null; freqCode?: string|null;
  primaryValue: unknown; qty?: unknown; qtyUnitCode?: number|null; qtyUnitAbbr?: string|null;
  altQty?: unknown; altQtyUnitAbbr?: string|null; netWgt?: unknown; grossWgt?: unknown;
  customsCode?: string|null; mosCode?: string|null; isQtyEstimated?: boolean|null; isNetWgtEstimated?: boolean|null;
}
const QUANTITY_UNITS: Record<number, string|null> = { 1:null, 2:'m²', 3:'1000 kWh', 4:'m', 5:'u', 6:'2u', 7:'l', 8:'kg', 9:'1000u', 10:'packages', 11:'12u', 12:'m³', 13:'carat' };
const sleep = (ms:number) => new Promise((resolve)=>setTimeout(resolve,ms));
const checksum = (text:string) => createHash('sha256').update(text).digest('hex');

export type ProviderNumberStatus='observed'|'observed_zero'|'missing'|'suppressed'|'invalid'|'unavailable';
export function parseOptionalProviderNumber(value:unknown):{value:number|null;status:ProviderNumberStatus}{
  if(value===null||value===undefined)return {value:null,status:'missing'};
  if(typeof value==='string'){
    const trimmed=value.trim();
    if(!trimmed)return {value:null,status:'missing'};
    if(/suppressed|confidential|unavailable|n\/a|\.\./i.test(trimmed))return {value:null,status:'suppressed'};
  }
  const parsed=typeof value==='number'?value:Number(value);
  if(!Number.isFinite(parsed)||parsed<0)return {value:null,status:'invalid'};
  return {value:parsed,status:parsed===0?'observed_zero':'observed'};
}
function retryAfterMs(response:Response):number|null { const raw=response.headers.get('retry-after'); if(!raw)return null; const seconds=Number(raw); if(Number.isFinite(seconds))return Math.max(0,seconds*1000); const at=Date.parse(raw); return Number.isFinite(at)?Math.max(0,at-Date.now()):null; }
function apiError(status:number, body:unknown):Error { const r=body&&typeof body==='object'?body as Record<string,unknown>:null; const message=typeof r?.message==='string'?r.message:typeof body==='string'?body:JSON.stringify(body); return new Error(`Comtrade request failed: ${status}${message?` ${message}`:''}`); }
function revisionCode(revision:string){const normalized=revision.replace(/[^0-9]/g,'');const map:Record<string,string>={'1992':'H0','1996':'H1','2002':'H2','2007':'H3','2012':'H4','2017':'H5','2022':'H6'};return map[normalized]??revision;}
function quotaMetadata(headers:Headers){
  const number=(...names:string[])=>{for(const name of names){const raw=headers.get(name);if(raw!=null&&Number.isFinite(Number(raw)))return Number(raw);}return null;};
  const reset=headers.get('x-ratelimit-reset')??headers.get('ratelimit-reset');
  let resetAt:string|null=null;if(reset){const epoch=Number(reset);const date=Number.isFinite(epoch)?new Date(epoch*1000):new Date(reset);if(!Number.isNaN(date.getTime()))resetAt=date.toISOString();}
  return {limit:number('x-ratelimit-limit','ratelimit-limit'),remaining:number('x-ratelimit-remaining','ratelimit-remaining'),reset_at:resetAt};
}

export class ComtradeApiClient implements ComtradeClient {
  readonly name:string; readonly identity; private readonly baseUrl:string;
  constructor(private readonly apiKey:string|null, private readonly policy:ComtradePolicy, preview=false) { this.name=preview?'comtrade-preview':'comtrade-api'; this.baseUrl=preview?PREVIEW_BASE_URL:(process.env.COMTRADE_BASE_URL??AUTH_BASE_URL); if(!preview&&!apiKey)throw new Error('The authenticated Comtrade client requires COMTRADE_API_KEY.'); this.identity={provider:'un_comtrade' as const,mode:preview?'preview' as const:'authenticated' as const,authenticated:!preview,credential_fingerprint:preview?'public-preview':createHash('sha256').update(apiKey!).digest('hex'),source_dataset:'un-comtrade-api',source_dataset_version:null}; }
  async resolveChapter(hsChapter:string) { if(!/^\d{2}$/.test(hsChapter))throw new Error(`Invalid HS chapter: ${hsChapter}`); const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.policy.request_timeout_ms??20_000);let response:Response;try{response=await fetch(HS_REFERENCE_URL,{signal:controller.signal});}finally{clearTimeout(timer);} const raw=await response.text();if(!response.ok)throw apiError(response.status,raw);const body=JSON.parse(raw) as {results?:ReferenceRow[]}; const hs_codes=(body.results??[]).filter(r=>r.aggrLevel===6&&String(r.isLeaf)==='1'&&r.id.startsWith(hsChapter)).map(r=>r.id).sort(); if(!hs_codes.length)throw new Error(`Comtrade HS reference returned no HS6 leaves for chapter ${hsChapter}.`); return {chapter:hsChapter,hs_codes,raw_response_text:raw,response_checksum:checksum(raw),retrieved_at:new Date(),dataset_version:response.headers.get('last-modified')??response.headers.get('etag')}; }
  async fetchChapter(params:ComtradeFetchParams):Promise<ComtradeFetchResult> {
    if(!params.hs_codes.length||params.hs_codes.some(c=>!/^\d{6}$/.test(c)||!c.startsWith(params.hs_chapter)))throw new Error('Comtrade fetch requires explicit six-digit codes from the requested chapter.');
    const frequency=params.frequency??'A',partner2=params.partner2??'0',customs=params.customs_code??'C00',mos=params.mode_of_supply??'0',revision=params.hs_revision??'unknown';
    if(params.purpose==='country_truth'&&revision==='unknown')throw new Error('Country Truth requests require an explicit HS revision.');
    const url=new URL(this.baseUrl); url.searchParams.set('reporterCode',params.reporter); url.searchParams.set('partnerCode',params.partner);url.searchParams.set('partner2Code',partner2); url.searchParams.set('period',String(params.year)); url.searchParams.set('cmdCode',params.hs_codes.join(',')); url.searchParams.set('flowCode',params.flow_direction==='export'?'X':'M');url.searchParams.set('freqCode',frequency);url.searchParams.set('clCode',revisionCode(revision));url.searchParams.set('customsCode',customs);url.searchParams.set('mosCode',mos);url.searchParams.set('aggregateBy','none');url.searchParams.set('breakdownMode','classic');
    let lastError:unknown,physicalCalls=0;
    for(let attempt=0;attempt<=this.policy.max_retries;attempt++) {
      if(attempt)await sleep(this.policy.retry_backoff_ms*2**(attempt-1));
      await params.before_physical_request?.();
      physicalCalls++;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.policy.request_timeout_ms??20_000);let response:Response;
      try{response=await fetch(url,{headers:this.apiKey?{'Ocp-Apim-Subscription-Key':this.apiKey}:undefined,signal:controller.signal});}
      catch(error){lastError=error;continue;}
      finally{clearTimeout(timer);}
      const retrievedAt=new Date();await params.after_physical_response?.({status:response.status,headers:response.headers,retrieved_at:retrievedAt});
      if(response.status===429){const wait=retryAfterMs(response);lastError=new ComtradeRateLimitError(`Comtrade rate limited request ${attempt+1}.`,wait,physicalCalls);if(attempt<this.policy.max_retries&&wait!=null&&wait<=60_000)await sleep(wait);continue;}
      const raw=await response.text();
      if(response.status>=500){lastError=apiError(response.status,raw);continue;}
      let body:{data?:ComtradeApiRow[];count?:number}|Record<string,unknown>|null=null;try{body=JSON.parse(raw) as typeof body;}catch{throw new Error('Comtrade response is not valid JSON.');}
      if(!response.ok)throw apiError(response.status,body); if(!body||!Array.isArray((body as {data?:unknown}).data))throw new Error('Comtrade response has no data array.');
      const data=(body as {data:ComtradeApiRow[];count?:number}).data,providerCount=Number.isFinite(Number((body as {count?:number}).count))?Number((body as {count?:number}).count):null;
      const requested=new Set(params.hs_codes),seen=new Set<string>(),rows:ComtradeFlowRow[]=[];let rejected=0;
      for(const row of data){
        const expectedFlow=params.flow_direction==='export'?'X':'M';
        const mismatch=String(row.reporterCode)!==params.reporter||String(row.partnerCode)!==params.partner||String(row.partner2Code??'0')!==partner2||Number(row.refYear)!==params.year||String(row.period)!==String(params.year)||!requested.has(row.cmdCode)||(row.flowCode!=null&&row.flowCode!==expectedFlow)||(row.freqCode!=null&&row.freqCode!==frequency)||(row.customsCode!=null&&row.customsCode!==customs)||(row.mosCode!=null&&row.mosCode!==mos);
        if(mismatch){rejected++;continue;}
        const key=`${row.reporterCode}:${row.partnerCode}:${row.partner2Code??0}:${row.cmdCode}:${row.refYear}:${expectedFlow}:${frequency}:${customs}:${mos}`;if(seen.has(key)){rejected++;continue;}seen.add(key);
        const trade=parseOptionalProviderNumber(row.primaryValue),qty=parseOptionalProviderNumber(row.qty),alt=parseOptionalProviderNumber(row.altQty),net=parseOptionalProviderNumber(row.netWgt),gross=parseOptionalProviderNumber(row.grossWgt);
        const quantity=qty.value!=null&&qty.value>0?qty.value:null;
        rows.push({reporter:String(row.reporterCode),partner:String(row.partnerCode),partner2:String(row.partner2Code??'0'),hs_code:row.cmdCode,year:Number(row.refYear),period:String(row.period),flow_code:row.flowCode??expectedFlow,frequency:row.freqCode??frequency,customs_code:row.customsCode??customs,mode_of_supply:row.mosCode??mos,value:trade.value,value_status:trade.status,quantity,unit:quantity==null?null:(row.qtyUnitAbbr?.trim()||(row.qtyUnitCode?QUANTITY_UNITS[row.qtyUnitCode]:null)||null),alternate_quantity:alt.value,alternate_quantity_unit:row.altQtyUnitAbbr??null,net_weight:net.value,gross_weight:gross.value,estimate_flag:Boolean(row.isQtyEstimated||row.isNetWgtEstimated),suppression_flag:trade.status==='suppressed',confidentiality_flag:trade.status==='suppressed'});
      }
      const truncated=providerCount!=null&&providerCount>data.length,complete=providerCount!=null&&!truncated&&rejected===0;
      return {rows,request_count:physicalCalls,retrieved_at:retrievedAt,source_dataset_version:response.headers.get('last-modified')??response.headers.get('etag'),evidence_pages:[{http_status:response.status,raw_response_text:raw,response_checksum:checksum(raw),redacted_request:url.toString(),provider_row_count:providerCount,returned_row_count:data.length,completeness:complete?'COMPLETE':'PARTIAL',completeness_metadata:{provider_count:providerCount,response_rows:data.length,accepted_rows:rows.length,rejected_rows:rejected,truncated,pagination_supported:false,parser_version:PARSER_VERSION},quota_metadata:quotaMetadata(response.headers),retrieved_at:retrievedAt}]};
    }
    throw lastError instanceof Error?lastError:new Error('Comtrade request failed after retries.');
  }
}
