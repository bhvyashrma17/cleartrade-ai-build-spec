/** Authenticated/preview UN Comtrade client with fail-closed identity and completeness checks. */
import { createHash } from 'node:crypto';
import type { ComtradePolicy } from '@/lib/config';
import type { ComtradeClient, ComtradeFetchParams, ComtradeFetchResult } from './client';
import { ComtradeProviderRequestError, ComtradeRateLimitError } from './client';
import { COMTRADE_PARSER_VERSION, isComtradeResponseBody, parseComtradeResponseBody, parseOptionalProviderNumber, revisionCode } from './parser';

// Re-exported so existing importers of the parser primitives keep working; `parser.ts` owns them.
export { parseOptionalProviderNumber };
export type { ProviderNumberStatus } from './parser';

const AUTH_BASE_URL = 'https://comtradeapi.un.org/data/v1/get/C/A/HS';
const PREVIEW_BASE_URL = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';
const HS_REFERENCE_URL = 'https://comtradeapi.un.org/files/v1/app/reference/HS.json';
interface ReferenceRow { id: string; isLeaf: string | number; aggrLevel: number; }
const sleep = (ms:number) => new Promise((resolve)=>setTimeout(resolve,ms));
const checksum = (text:string) => createHash('sha256').update(text).digest('hex');

function retryAfterMs(response:Response):number|null { const raw=response.headers.get('retry-after'); if(!raw)return null; const seconds=Number(raw); if(Number.isFinite(seconds))return Math.max(0,seconds*1000); const at=Date.parse(raw); return Number.isFinite(at)?Math.max(0,at-Date.now()):null; }
function apiError(status:number, body:unknown):Error { const r=body&&typeof body==='object'?body as Record<string,unknown>:null; const message=typeof r?.message==='string'?r.message:typeof body==='string'?body:JSON.stringify(body); return new Error(`Comtrade request failed: ${status}${message?` ${message}`:''}`); }
function providerRequestError(error:unknown,physicalRequestCount:number){
  if(error instanceof ComtradeProviderRequestError||error instanceof ComtradeRateLimitError)return error;
  return new ComtradeProviderRequestError(error instanceof Error?error.message:String(error),physicalRequestCount,{cause:error});
}
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
    const url=new URL(this.baseUrl); url.searchParams.set('reporterCode',params.reporter);if(params.partner!=='all')url.searchParams.set('partnerCode',params.partner);url.searchParams.set('partner2Code',partner2); url.searchParams.set('period',String(params.year)); url.searchParams.set('cmdCode',params.hs_codes.join(',')); url.searchParams.set('flowCode',params.flow_direction==='export'?'X':'M');url.searchParams.set('freqCode',frequency);url.searchParams.set('clCode',revisionCode(revision));url.searchParams.set('customsCode',customs);url.searchParams.set('mosCode',mos);url.searchParams.set('breakdownMode','classic');
    let lastError:unknown,physicalCalls=0;
    for(let attempt=0;attempt<=this.policy.max_retries;attempt++) {
      if(attempt)await sleep(this.policy.retry_backoff_ms*2**(attempt-1));
      await params.before_physical_request?.();
      physicalCalls++;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.policy.request_timeout_ms??20_000);let response:Response;
      try{response=await fetch(url,{headers:this.apiKey?{'Ocp-Apim-Subscription-Key':this.apiKey}:undefined,signal:controller.signal});}
      catch(error){lastError=error;continue;}
      finally{clearTimeout(timer);}
      const retrievedAt=new Date();try{await params.after_physical_response?.({status:response.status,headers:response.headers,retrieved_at:retrievedAt});}catch(error){throw providerRequestError(error,physicalCalls);}
      if(response.status===429){const wait=retryAfterMs(response);lastError=new ComtradeRateLimitError(`Comtrade rate limited request ${attempt+1}.`,wait,physicalCalls);if(attempt<this.policy.max_retries&&wait!=null&&wait<=60_000)await sleep(wait);continue;}
      const raw=await response.text();
      if(response.status>=500){lastError=apiError(response.status,raw);continue;}
      let body:unknown=null;try{body=JSON.parse(raw);}catch(error){throw providerRequestError(new Error('Comtrade response is not valid JSON.',{cause:error}),physicalCalls);}
      if(!response.ok)throw providerRequestError(apiError(response.status,body),physicalCalls); if(!isComtradeResponseBody(body))throw providerRequestError(new Error('Comtrade response has no data array.'),physicalCalls);
      // One parser, used here and again by re-normalization, so the two can never disagree.
      const parsed=parseComtradeResponseBody(body,{reporter:params.reporter,partner:params.partner,partner2,year:params.year,flow_direction:params.flow_direction,frequency,customs_code:customs,mode_of_supply:mos,hs_revision:revision,hs_codes:params.hs_codes});
      return {rows:parsed.rows,request_count:physicalCalls,retrieved_at:retrievedAt,source_dataset_version:response.headers.get('last-modified')??response.headers.get('etag'),evidence_pages:[{http_status:response.status,raw_response_text:raw,response_checksum:checksum(raw),redacted_request:url.toString(),provider_row_count:parsed.provider_row_count,returned_row_count:parsed.returned_row_count,completeness:parsed.complete?'COMPLETE':'PARTIAL',completeness_metadata:{provider_count:parsed.provider_row_count,response_rows:parsed.returned_row_count,accepted_rows:parsed.accepted_rows,rejected_rows:parsed.rejected_rows,truncated:parsed.truncated,pagination_supported:false,parser_version:COMTRADE_PARSER_VERSION},quota_metadata:quotaMetadata(response.headers),retrieved_at:retrievedAt}]};
    }
    if(lastError instanceof ComtradeRateLimitError)throw lastError;
    const message=lastError instanceof Error?lastError.message:'Comtrade request failed after retries.';
    throw new ComtradeProviderRequestError(message,physicalCalls,{cause:lastError});
  }
}
