import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,normalize,resolve} from 'node:path';
import {DeleteObjectCommand,GetObjectCommand,HeadBucketCommand,HeadObjectCommand,PutObjectCommand,S3Client} from '@aws-sdk/client-s3';

export type StorageProvider='local'|'s3';
export type MalwareScanStatus='pending'|'clean'|'infected'|'failed';
export interface StoredObject {provider:StorageProvider;objectKey:string;contentType:string;sizeBytes:number;sha256:string;etag?:string;versionId?:string;}
/** `objectKey` is optional: callers that need a semantic key (sanctions artifacts) supply one; user uploads keep the random default. */
export interface DocumentStorage {readonly provider:StorageProvider;put(input:{bytes:Buffer;contentType:string;sha256:string;objectKey?:string}):Promise<StoredObject>;get(objectKey:string):Promise<Buffer>;metadata(objectKey:string):Promise<Omit<StoredObject,'sha256'>&{sha256?:string}>;delete(objectKey:string):Promise<void>;healthcheck():Promise<void>;}

const STORAGE_ROOT=resolve(process.cwd(),'.data','uploads');
const newKey=()=>`objects/${randomBytes(24).toString('hex')}`;
function assertObjectKey(objectKey:string){if(!objectKey||objectKey.length>512||objectKey.startsWith('/')||objectKey.includes('..')||objectKey.includes('\\')||!/^[-A-Za-z0-9._/]+$/.test(objectKey))throw new Error('Invalid storage object key.');}
function localPath(objectKey:string){assertObjectKey(objectKey);const absolute=resolve(STORAGE_ROOT,normalize(objectKey));if(!absolute.startsWith(`${STORAGE_ROOT}/`))throw new Error('Storage path traversal rejected.');return absolute;}

export class LocalDocumentStorage implements DocumentStorage {
  readonly provider='local' as const;
  async put(input:{bytes:Buffer;contentType:string;sha256:string;objectKey?:string}){const objectKey=input.objectKey??newKey(),path=localPath(objectKey);await mkdir(dirname(path),{recursive:true});await writeFile(path,input.bytes,{flag:'wx'});return {provider:this.provider,objectKey,contentType:input.contentType,sizeBytes:input.bytes.length,sha256:input.sha256};}
  get(objectKey:string){return readFile(localPath(objectKey));}
  async metadata(objectKey:string){const info=await stat(localPath(objectKey));return {provider:this.provider,objectKey,contentType:'application/octet-stream',sizeBytes:info.size};}
  async delete(objectKey:string){await rm(localPath(objectKey));}
  async healthcheck(){await mkdir(STORAGE_ROOT,{recursive:true});}
}

let s3Client:S3Client|undefined;
const bucket=()=>{if(!process.env.STORAGE_BUCKET)throw new Error('STORAGE_BUCKET is required.');return process.env.STORAGE_BUCKET;};
const client=()=>s3Client??=new S3Client({region:process.env.STORAGE_REGION,endpoint:process.env.STORAGE_ENDPOINT||undefined,forcePathStyle:process.env.STORAGE_FORCE_PATH_STYLE==='true'});
export class S3DocumentStorage implements DocumentStorage {
  readonly provider='s3' as const;
  async put(input:{bytes:Buffer;contentType:string;sha256:string;objectKey?:string}){const objectKey=input.objectKey??newKey();const encryption=process.env.STORAGE_SERVER_SIDE_ENCRYPTION==='aws:kms'?'aws:kms' as const:'AES256' as const;const result=await client().send(new PutObjectCommand({Bucket:bucket(),Key:objectKey,Body:input.bytes,ContentType:input.contentType,Metadata:{sha256:input.sha256},ServerSideEncryption:encryption}));return {provider:this.provider,objectKey,contentType:input.contentType,sizeBytes:input.bytes.length,sha256:input.sha256,etag:result.ETag,versionId:result.VersionId};}
  async get(objectKey:string){assertObjectKey(objectKey);const result=await client().send(new GetObjectCommand({Bucket:bucket(),Key:objectKey}));if(!result.Body)throw new Error('Stored object has no body.');return Buffer.from(await result.Body.transformToByteArray());}
  async metadata(objectKey:string){assertObjectKey(objectKey);const result=await client().send(new HeadObjectCommand({Bucket:bucket(),Key:objectKey}));return {provider:this.provider,objectKey,contentType:result.ContentType??'application/octet-stream',sizeBytes:result.ContentLength??0,sha256:result.Metadata?.sha256,etag:result.ETag,versionId:result.VersionId};}
  async delete(objectKey:string){assertObjectKey(objectKey);await client().send(new DeleteObjectCommand({Bucket:bucket(),Key:objectKey}));}
  async healthcheck(){await client().send(new HeadBucketCommand({Bucket:bucket()}));}
}
export function getDocumentStorage(env:NodeJS.ProcessEnv=process.env):DocumentStorage{return env.STORAGE_BACKEND==='s3'?new S3DocumentStorage():new LocalDocumentStorage();}

const signatures:Record<string,(bytes:Buffer)=>boolean>={'application/pdf':b=>b.subarray(0,5).toString()==='%PDF-','image/png':b=>b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/jpeg':b=>b[0]===0xff&&b[1]===0xd8&&b[2]===0xff,'text/plain':b=>!b.subarray(0,512).includes(0)};
const extensions:Record<string,string[]>={'application/pdf':['pdf'],'image/png':['png'],'image/jpeg':['jpg','jpeg'],'text/plain':['txt']};
export function validateUpload(input:{bytes:Buffer;fileName:string;contentType:string;maxBytes:number;allowedMimeTypes:string[]}){if(input.bytes.length>input.maxBytes)throw new Error('UPLOAD_TOO_LARGE');if(!input.allowedMimeTypes.includes(input.contentType))throw new Error('UPLOAD_MIME_NOT_ALLOWED');const ext=input.fileName.toLowerCase().split('.').pop()??'';if(!extensions[input.contentType]?.includes(ext))throw new Error('UPLOAD_EXTENSION_MISMATCH');if(!signatures[input.contentType]?.(input.bytes))throw new Error('UPLOAD_MIME_MISMATCH');}
/**
 * Malware scan (Phase 6).
 *
 * Response contract — the scanner MUST return JSON `{clean: boolean, engine?, version?}`:
 *   clean:true   -> `clean`     upload proceeds
 *   clean:false  -> `infected`  upload rejected as malware
 *   anything else, non-2xx, timeout, transport failure, oversize -> `failed`
 *
 * `failed` is NOT `clean`. Every non-clean status makes `secureUpload` throw, so a scanner
 * that is down, slow, unreachable or ambiguous blocks the upload rather than waving it
 * through. That is the whole point of the control, and it is asserted in tests.
 *
 * A timeout is caught and mapped to `failed` rather than escaping as a raw fetch rejection,
 * so callers get the documented contract instead of a transport-specific exception.
 */
export async function scanForMalware(bytes:Buffer,env:NodeJS.ProcessEnv=process.env,fetchImpl:typeof fetch=fetch):Promise<{status:MalwareScanStatus;scannedAt:Date;engine:string}>{
  const scanner=env.DOCUMENT_MALWARE_SCANNER??(['production','staging'].includes(env.APP_ENV??'')?'':'development');
  if(scanner==='development')return {status:bytes.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))?'infected':'clean',scannedAt:new Date(),engine:'development-signature-v1'};
  if(scanner==='http'){
    const url=env.DOCUMENT_MALWARE_SCANNER_URL;
    if(!url)throw new Error('Malware scanner URL is not configured.');
    // Request size limit: refuse locally rather than pushing a payload the scanner will drop.
    const maxBytes=Number(env.DOCUMENT_MALWARE_SCANNER_MAX_BYTES??32*1024*1024);
    if(bytes.length>maxBytes)return {status:'failed',scannedAt:new Date(),engine:'http:oversize'};
    const timeoutMs=Number(env.DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS??30_000);
    try{
      const response=await fetchImpl(url,{
        method:'POST',
        headers:{
          'content-type':'application/octet-stream',
          // Private/authenticated endpoint. Absent credential is allowed only because some
          // deployments authenticate at the mesh/network layer instead.
          ...(env.DOCUMENT_MALWARE_SCANNER_TOKEN?{authorization:`Bearer ${env.DOCUMENT_MALWARE_SCANNER_TOKEN}`}:{}),
        },
        body:new Uint8Array(bytes),
        signal:AbortSignal.timeout(timeoutMs),
      });
      // Scanner identity, so a scan result can be traced to the engine that produced it.
      const headerEngine=response.headers?.get?.('x-scanner-version')??null;
      if(!response.ok)return {status:'failed',scannedAt:new Date(),engine:`http:status-${response.status}`};
      let result:{clean?:unknown;engine?:unknown;version?:unknown};
      try{result=await response.json() as typeof result;}
      catch{return {status:'failed',scannedAt:new Date(),engine:'http:unparseable-response'};}
      const engine=[result.engine,result.version].filter(v=>typeof v==='string'&&v).join('/')||headerEngine||'http';
      if(result.clean===true)return {status:'clean',scannedAt:new Date(),engine};
      if(result.clean===false)return {status:'infected',scannedAt:new Date(),engine};
      // Ambiguous body (missing/!boolean `clean`) is never treated as clean.
      return {status:'failed',scannedAt:new Date(),engine:`${engine}:ambiguous`};
    }catch(error){
      const timedOut=error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError');
      return {status:'failed',scannedAt:new Date(),engine:timedOut?'http:timeout':'http:unavailable'};
    }
  }
  throw new Error('Malware scanner is required.');
}
export async function secureUpload(input:{bytes:Buffer;fileName:string;contentType:string;maxBytes:number;allowedMimeTypes:string[]}){validateUpload(input);const scan=await scanForMalware(input.bytes);if(scan.status!=='clean')throw new Error(scan.status==='infected'?'FILE_MALWARE_DETECTED':'FILE_SCAN_FAILED');const sha256=createHash('sha256').update(input.bytes).digest('hex');const object=await getDocumentStorage().put({bytes:input.bytes,contentType:input.contentType,sha256});return {...object,scan};}

// Compatibility wrappers for other evidence models; authorization remains at their routes.
export async function saveUploadedFile(bytes:Buffer,originalName:string,contentType:string){const object=await secureUpload({bytes,fileName:originalName,contentType,maxBytes:Number(process.env.UPLOAD_MAX_BYTES??25*1024*1024),allowedMimeTypes:['application/pdf','image/png','image/jpeg','text/plain']});return {file_ref:object.objectKey,checksum:object.sha256,size_bytes:object.sizeBytes};}
export function readStoredFile(fileRef:string){return getDocumentStorage().get(fileRef);}
export function deleteStoredFile(fileRef:string){return getDocumentStorage().delete(fileRef);}
export async function storageHealthcheck(){const storage=getDocumentStorage();await storage.healthcheck();return {backend:storage.provider,ready:true};}
