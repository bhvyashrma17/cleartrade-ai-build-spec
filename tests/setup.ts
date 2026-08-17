import { afterEach, vi } from 'vitest';

const nativeFetch=globalThis.fetch;
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
  if(url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname==='::1')return nativeFetch(input,init);
  throw new Error(`External network is disabled in npm test: ${url.origin}`);
}) as typeof fetch;

afterEach(()=>vi.restoreAllMocks());
