/** UN Comtrade free-key/preview client. Only explicit HS6 leaves are requested. */
import { createHash } from 'node:crypto';
import type { ComtradePolicy } from '@/lib/config';
import type { ComtradeClient, ComtradeFetchParams, ComtradeFetchResult, ComtradeFlowRow } from './client';
import { ComtradeRateLimitError } from './client';

const AUTH_BASE_URL = 'https://comtradeapi.un.org/data/v1/get/C/A/HS';
const PREVIEW_BASE_URL = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';
const HS_REFERENCE_URL = 'https://comtradeapi.un.org/files/v1/app/reference/HS.json';
interface ReferenceRow { id: string; isLeaf: string | number; aggrLevel: number; }
interface ComtradeApiRow { reporterCode: number|string; partnerCode: number|string; partner2Code?: number|string|null; cmdCode: string; refYear: number; period: number|string; primaryValue: number|null; qty?: number|null; qtyUnitCode?: number|null; qtyUnitAbbr?: string|null; customsCode?: string|null; mosCode?: string|null; }
const QUANTITY_UNITS: Record<number, string|null> = { 1:null, 2:'m²', 3:'1000 kWh', 4:'m', 5:'u', 6:'2u', 7:'l', 8:'kg', 9:'1000u', 10:'packages', 11:'12u', 12:'m³', 13:'carat' };
const sleep = (ms:number) => new Promise((resolve)=>setTimeout(resolve,ms));
function retryAfterMs(response:Response):number|null { const raw=response.headers.get('retry-after'); if(!raw)return null; const seconds=Number(raw); if(Number.isFinite(seconds))return Math.max(0,seconds*1000); const at=Date.parse(raw); return Number.isFinite(at)?Math.max(0,at-Date.now()):null; }
function apiError(status:number, body:unknown):Error { const r=body&&typeof body==='object'?body as Record<string,unknown>:null; const message=typeof r?.message==='string'?r.message:typeof body==='string'?body:JSON.stringify(body); return new Error(`Comtrade request failed: ${status}${message?` ${message}`:''}`); }

export class ComtradeApiClient implements ComtradeClient {
  readonly name:string; readonly identity; private readonly baseUrl:string;
  constructor(private readonly apiKey:string|null, private readonly policy:ComtradePolicy, preview=false) { this.name=preview?'comtrade-preview':'comtrade-api'; this.baseUrl=preview?PREVIEW_BASE_URL:(process.env.COMTRADE_BASE_URL??AUTH_BASE_URL); if(!preview&&!apiKey)throw new Error('The authenticated Comtrade client requires COMTRADE_API_KEY.'); this.identity={provider:'un_comtrade' as const,mode:preview?'preview' as const:'authenticated' as const,authenticated:!preview,credential_fingerprint:preview?'public-preview':createHash('sha256').update(apiKey!).digest('hex'),source_dataset:'un-comtrade-api',source_dataset_version:null}; }
  async resolveChapter(hsChapter:string) { if(!/^\d{2}$/.test(hsChapter))throw new Error(`Invalid HS chapter: ${hsChapter}`); const response=await fetch(HS_REFERENCE_URL); if(!response.ok)throw apiError(response.status,await response.text().catch(()=>'')); const body=await response.json() as {results?:ReferenceRow[]}; const hs_codes=(body.results??[]).filter(r=>r.aggrLevel===6&&String(r.isLeaf)==='1'&&r.id.startsWith(hsChapter)).map(r=>r.id).sort(); if(!hs_codes.length)throw new Error(`Comtrade HS reference returned no HS6 leaves for chapter ${hsChapter}.`); return {chapter:hsChapter,hs_codes}; }
  async fetchChapter(params:ComtradeFetchParams):Promise<ComtradeFetchResult> {
    if(!params.hs_codes.length||params.hs_codes.some(c=>!/^\d{6}$/.test(c)||!c.startsWith(params.hs_chapter)))throw new Error('Comtrade fetch requires explicit six-digit codes from the requested chapter.');
    const url=new URL(this.baseUrl); url.searchParams.set('reporterCode',params.reporter); url.searchParams.set('partnerCode',params.partner); url.searchParams.set('period',String(params.year)); url.searchParams.set('cmdCode',params.hs_codes.join(',')); url.searchParams.set('flowCode',params.flow_direction==='export'?'X':'M');
    let lastError:unknown;
    for(let attempt=0;attempt<=this.policy.max_retries;attempt++) { if(attempt)await sleep(this.policy.retry_backoff_ms*2**(attempt-1)); let response:Response; try{response=await fetch(url,{headers:this.apiKey?{'Ocp-Apim-Subscription-Key':this.apiKey}:undefined});}catch(error){lastError=error;continue;} if(response.status===429){const wait=retryAfterMs(response);lastError=new ComtradeRateLimitError(`Comtrade rate limited request ${attempt+1}.`,wait);if(attempt<this.policy.max_retries&&wait!=null&&wait<=60_000)await sleep(wait);continue;} if(response.status>=500){lastError=apiError(response.status,await response.text().catch(()=>''));continue;} const body=await response.json().catch(()=>null) as {data?:ComtradeApiRow[]}|Record<string,unknown>|null; if(!response.ok)throw apiError(response.status,body); if(!body||!Array.isArray((body as {data?:unknown}).data))throw new Error('Comtrade response has no data array.');
      const requested=new Set(params.hs_codes),seen=new Set<string>(),rows:ComtradeFlowRow[]=[];
      for(const row of (body as {data:ComtradeApiRow[]}).data){if(!requested.has(row.cmdCode)||(row.partner2Code!=null&&String(row.partner2Code)!=='0'))continue;if(row.customsCode&&row.customsCode!=='C00')continue;if(row.mosCode&&row.mosCode!=='0')continue;const key=`${row.reporterCode}:${row.partnerCode}:${row.cmdCode}:${row.refYear}`;if(seen.has(key))continue;seen.add(key);const value=Number(row.primaryValue);const raw=row.qty==null?null:Number(row.qty);const quantity=raw!=null&&Number.isFinite(raw)&&raw>0?raw:null;if(!Number.isFinite(value))continue;rows.push({reporter:String(row.reporterCode),partner:String(row.partnerCode),hs_code:row.cmdCode,year:Number(row.refYear),period:String(row.period),value,quantity,unit:quantity==null?null:(row.qtyUnitAbbr?.trim()||(row.qtyUnitCode?QUANTITY_UNITS[row.qtyUnitCode]:null)||null)});}
      return {rows,request_count:1,retrieved_at:new Date(),source_dataset_version:response.headers.get('last-modified')??response.headers.get('etag')};
    }
    throw lastError instanceof Error?lastError:new Error('Comtrade request failed after retries.');
  }
}
