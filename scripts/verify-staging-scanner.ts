/**
 * Phase 6 — REAL malware scanner validation against the configured endpoint.
 *
 * Runs the four required cases against the actual scanner:
 *   1. clean harmless file        -> accepted
 *   2. EICAR standard test string -> blocked
 *   3. scanner unavailable        -> NOT clean
 *   4. scanner timeout            -> NOT clean
 *
 * Cases 3 and 4 are induced by pointing the client at an unroutable address and at a
 * 1 ms timeout respectively — the real client code path is exercised in both.
 *
 * Run against staging:
 *   APP_ENV=staging tsx --env-file=.env.staging scripts/verify-staging-scanner.ts
 *
 * The EICAR string is assembled at runtime from fragments so this source file does not itself
 * trip endpoint protection on developer machines.
 */

import { scanForMalware } from '../src/lib/document-storage';

const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${detail}`);
};

/** EICAR test file — the industry-standard harmless malware probe. */
const eicar = () =>
  Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE', '!$H+H*'].join(''));

const cleanPdf = () => Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n');

async function main() {
  const env = process.env;
  console.log('Malware scanner validation');
  console.log(`  mode              ${env.DOCUMENT_MALWARE_SCANNER ?? '(unset)'}`);
  console.log(`  endpoint          ${env.DOCUMENT_MALWARE_SCANNER_URL ?? '(unset)'}`);
  console.log(`  credential        ${env.DOCUMENT_MALWARE_SCANNER_TOKEN ? 'configured' : 'not set (mesh auth assumed)'}`);
  console.log(`  timeout           ${env.DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS ?? '30000'} ms`);
  console.log('');

  if (env.DOCUMENT_MALWARE_SCANNER !== 'http' || !env.DOCUMENT_MALWARE_SCANNER_URL) {
    console.error('REFUSING TO RUN: DOCUMENT_MALWARE_SCANNER must be "http" with a URL set.');
    console.error('The development signature scanner is not evidence of a deployed scanner.');
    process.exit(2);
  }
  if (!/^https:\/\//i.test(env.DOCUMENT_MALWARE_SCANNER_URL)) {
    console.error('REFUSING TO RUN: scanner URL must be https — customer documents are sent to it.');
    process.exit(2);
  }

  // 1. Clean file.
  const clean = await scanForMalware(cleanPdf(), env);
  record('clean file accepted', clean.status === 'clean', `status=${clean.status} engine=${clean.engine}`);
  record('scanner reports version identity', clean.engine !== 'http' && clean.engine.length > 0, `engine=${clean.engine}`);

  // 2. EICAR.
  const infected = await scanForMalware(eicar(), env);
  record('EICAR blocked', infected.status === 'infected', `status=${infected.status} engine=${infected.engine}`);
  record('EICAR is not reported clean', infected.status !== 'clean', `status=${infected.status}`);

  // 3. Unavailable — unroutable address, real client path.
  const unavailable = await scanForMalware(cleanPdf(), {
    ...env,
    DOCUMENT_MALWARE_SCANNER_URL: 'https://127.0.0.1:9/scan',
    DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS: '2000',
  } as NodeJS.ProcessEnv);
  record('unavailable is not clean', unavailable.status !== 'clean', `status=${unavailable.status} engine=${unavailable.engine}`);

  // 4. Timeout — real endpoint, 1 ms budget.
  const timedOut = await scanForMalware(cleanPdf(), { ...env, DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS: '1' } as NodeJS.ProcessEnv);
  record('timeout is not clean', timedOut.status !== 'clean', `status=${timedOut.status} engine=${timedOut.engine}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) console.log('A failure here means uploads are not protected. Do not proceed to pilot.');
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
