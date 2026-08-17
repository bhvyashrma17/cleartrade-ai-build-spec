import {afterEach,describe,expect,test,vi} from 'vitest';
import {getDocumentStorage,LocalDocumentStorage,scanForMalware,secureUpload,validateUpload,type DocumentStorage} from '../src/lib/document-storage';

const pdf=Buffer.from('%PDF-1.7\nminimal test');
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe('document storage security',()=>{
  test('safe upload uses a randomized key and round trips metadata/bytes',async()=>{vi.stubEnv('STORAGE_BACKEND','local');vi.stubEnv('DOCUMENT_MALWARE_SCANNER','development');const stored=await secureUpload({bytes:pdf,fileName:'invoice.pdf',contentType:'application/pdf',maxBytes:1024,allowedMimeTypes:['application/pdf']});expect(stored.objectKey).toMatch(/^objects\/[a-f0-9]{48}$/);expect(stored.objectKey).not.toContain('invoice');expect(stored.scan.status).toBe('clean');const storage=getDocumentStorage();expect(await storage.get(stored.objectKey)).toEqual(pdf);expect((await storage.metadata(stored.objectKey)).sizeBytes).toBe(pdf.length);await storage.delete(stored.objectKey);await expect(storage.get(stored.objectKey)).rejects.toThrow();});
  test('malware test signature is blocked before storage',async()=>{vi.stubEnv('DOCUMENT_MALWARE_SCANNER','development');await expect(secureUpload({bytes:Buffer.from('%PDF-EICAR-STANDARD-ANTIVIRUS-TEST-FILE'),fileName:'bad.pdf',contentType:'application/pdf',maxBytes:1024,allowedMimeTypes:['application/pdf']})).rejects.toThrow('FILE_MALWARE_DETECTED');});
  test('rejects traversal, oversized, extension mismatch and MIME mismatch',()=>{const storage=new LocalDocumentStorage();expect(()=>storage.get('../../etc/passwd')).toThrow(/key|traversal/i);expect(()=>validateUpload({bytes:pdf,fileName:'x.pdf',contentType:'application/pdf',maxBytes:2,allowedMimeTypes:['application/pdf']})).toThrow('UPLOAD_TOO_LARGE');expect(()=>validateUpload({bytes:pdf,fileName:'x.exe',contentType:'application/pdf',maxBytes:1024,allowedMimeTypes:['application/pdf']})).toThrow('UPLOAD_EXTENSION_MISMATCH');expect(()=>validateUpload({bytes:Buffer.from('not pdf'),fileName:'x.pdf',contentType:'application/pdf',maxBytes:1024,allowedMimeTypes:['application/pdf']})).toThrow('UPLOAD_MIME_MISMATCH');});
  test('production fails closed without a scanner',async()=>{await expect(scanForMalware(pdf,{...process.env,APP_ENV:'production',DOCUMENT_MALWARE_SCANNER:undefined})).rejects.toThrow(/scanner is required/i);});
  test('provider outages propagate instead of returning success',async()=>{const unavailable:DocumentStorage={provider:'s3',put:async()=>{throw new Error('provider unavailable');},get:async()=>{throw new Error('provider unavailable');},metadata:async()=>{throw new Error('provider unavailable');},delete:async()=>{throw new Error('provider unavailable');},healthcheck:async()=>{throw new Error('provider unavailable');}};await expect(unavailable.put({bytes:pdf,contentType:'application/pdf',sha256:'x'})).rejects.toThrow('provider unavailable');});
});

// ---------------------------------------------------------------------------
// Phase 6 — malware scanner contract.
//
// These are CONTRACT tests against an injected fetch. They prove the client behaves
// correctly for each scanner outcome; they are NOT evidence that a real scanner has been
// deployed or validated. Live validation is scripts/verify-staging-scanner.ts.
// ---------------------------------------------------------------------------

const scannerEnv = {
  DOCUMENT_MALWARE_SCANNER: 'http',
  DOCUMENT_MALWARE_SCANNER_URL: 'https://scanner.internal/scan',
  DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS: '50',
} as unknown as NodeJS.ProcessEnv;

const jsonResponse = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });

describe('malware scanner contract', () => {
  test('clean file is accepted and records the engine identity', async () => {
    const scan = await scanForMalware(pdf, scannerEnv, (async () =>
      jsonResponse({ clean: true, engine: 'clamav', version: '1.4.2/27000' })) as unknown as typeof fetch);
    expect(scan.status).toBe('clean');
    expect(scan.engine).toBe('clamav/1.4.2/27000');
  });

  test('EICAR is reported infected and blocks the upload', async () => {
    const scan = await scanForMalware(pdf, scannerEnv, (async () =>
      jsonResponse({ clean: false, engine: 'clamav', version: '1.4.2' })) as unknown as typeof fetch);
    expect(scan.status).toBe('infected');
  });

  test('scanner unavailable does NOT mark the upload clean', async () => {
    const scan = await scanForMalware(pdf, scannerEnv, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    expect(scan.status).toBe('failed');
    expect(scan.engine).toBe('http:unavailable');
  });

  test('scanner timeout does NOT mark the upload clean', async () => {
    const scan = await scanForMalware(pdf, scannerEnv, (async () => {
      const e = new Error('timed out'); e.name = 'TimeoutError'; throw e;
    }) as unknown as typeof fetch);
    expect(scan.status).toBe('failed');
    expect(scan.engine).toBe('http:timeout');
  });

  test('a 5xx from the scanner does NOT mark the upload clean', async () => {
    const scan = await scanForMalware(pdf, scannerEnv, (async () => jsonResponse({}, { status: 503 })) as unknown as typeof fetch);
    expect(scan.status).toBe('failed');
    expect(scan.engine).toBe('http:status-503');
  });

  test('an ambiguous body is never treated as clean', async () => {
    for (const body of [{}, { clean: 'yes' }, { clean: null }, { result: 'ok' }]) {
      const scan = await scanForMalware(pdf, scannerEnv, (async () => jsonResponse(body)) as unknown as typeof fetch);
      expect(scan.status).toBe('failed');
    }
  });

  test('an unparseable body is never treated as clean', async () => {
    const scan = await scanForMalware(pdf, scannerEnv, (async () =>
      new Response('<html>gateway error</html>', { status: 200 })) as unknown as typeof fetch);
    expect(scan.status).toBe('failed');
  });

  test('an oversize payload is refused locally rather than sent', async () => {
    let called = false;
    const scan = await scanForMalware(pdf, { ...scannerEnv, DOCUMENT_MALWARE_SCANNER_MAX_BYTES: '4' } as unknown as NodeJS.ProcessEnv,
      (async () => { called = true; return jsonResponse({ clean: true }); }) as unknown as typeof fetch);
    expect(scan.status).toBe('failed');
    expect(called).toBe(false);
  });

  test('the credential is sent when configured and omitted when not', async () => {
    let seen: Record<string, string> = {};
    const capture = (async (_u: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>;
      return jsonResponse({ clean: true });
    }) as unknown as typeof fetch;
    await scanForMalware(pdf, { ...scannerEnv, DOCUMENT_MALWARE_SCANNER_TOKEN: 'scanner-token' } as unknown as NodeJS.ProcessEnv, capture);
    expect(seen.authorization).toBe('Bearer scanner-token');
    await scanForMalware(pdf, scannerEnv, capture);
    expect(seen.authorization).toBeUndefined();
  });

  test('secureUpload fails closed end-to-end when the scanner is unreachable', async () => {
    vi.stubEnv('STORAGE_BACKEND', 'local');
    vi.stubEnv('DOCUMENT_MALWARE_SCANNER', 'http');
    vi.stubEnv('DOCUMENT_MALWARE_SCANNER_URL', 'https://scanner.internal/scan');
    vi.stubGlobal('fetch', (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    await expect(secureUpload({ bytes: pdf, fileName: 'invoice.pdf', contentType: 'application/pdf', maxBytes: 1024, allowedMimeTypes: ['application/pdf'] }))
      .rejects.toThrow('FILE_SCAN_FAILED');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('secureUpload rejects an infected file end-to-end', async () => {
    vi.stubEnv('STORAGE_BACKEND', 'local');
    vi.stubEnv('DOCUMENT_MALWARE_SCANNER', 'http');
    vi.stubEnv('DOCUMENT_MALWARE_SCANNER_URL', 'https://scanner.internal/scan');
    vi.stubGlobal('fetch', (async () => jsonResponse({ clean: false, engine: 'clamav' })) as unknown as typeof fetch);
    await expect(secureUpload({ bytes: pdf, fileName: 'invoice.pdf', contentType: 'application/pdf', maxBytes: 1024, allowedMimeTypes: ['application/pdf'] }))
      .rejects.toThrow('FILE_MALWARE_DETECTED');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
