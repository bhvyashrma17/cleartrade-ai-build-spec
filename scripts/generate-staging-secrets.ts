/**
 * Phase 2 — generate the staging secrets that ClearTrade itself owns.
 *
 * Scope: only secrets we mint. Provider credentials (Comtrade key, object-storage keys,
 * scanner and notification credentials) are issued by those providers and are deliberately
 * NOT generated here — inventing a value for them would produce a config that fails at first
 * use rather than at startup.
 *
 * Output goes to a 0600 file that .gitignore already excludes. Values are never printed;
 * the console shows only a name, a length and a SHA-256 fingerprint prefix so two
 * environments can be compared for accidental reuse WITHOUT either value being disclosed.
 *
 * These are generated for transfer into the platform's secret manager (Phase 3). The file is
 * a transport artifact, not the system of record — delete it once the secrets are stored.
 */

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';

/** URL/env-safe high-entropy string. base64url of 24 bytes → 32 chars, ~192 bits. */
const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
/** Exactly 32 bytes of AES-256 key material, base64 — the form runtime-config now demands. */
const aes256Key = () => randomBytes(32).toString('base64');

const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12);

const GENERATED: { name: string; value: string; note: string }[] = [
  { name: 'AUTH_SECRET', value: token(), note: 'NextAuth JWT signing' },
  { name: 'GUEST_IP_HASH_SECRET', value: token(), note: 'HMAC key for guest IP hashing' },
  { name: 'IMPORT_BUYER_REF_SECRET', value: token(), note: 'HMAC key for buyer reference derivation' },
  { name: 'OPERATIONS_TOKEN', value: token(), note: 'Bearer token for /api/metrics' },
  { name: 'IMPORT_RAW_IDENTITY_ENCRYPTION_KEY', value: aes256Key(), note: 'AES-256-GCM raw identity encryption' },
];

/** Non-secret, but must be set alongside the keys for rotation to be unambiguous. */
const VERSIONS: { name: string; value: string }[] = [
  { name: 'IMPORT_BUYER_REF_KEY_VERSION', value: 'v1' },
  { name: 'IMPORT_RAW_IDENTITY_KEY_VERSION', value: 'v1' },
];

function main() {
  const outPath = process.argv[2] ?? '.env.staging.secrets';
  if (existsSync(outPath) && !process.argv.includes('--force')) {
    console.error(`Refusing to overwrite ${outPath}. Pass --force if you intend to REGENERATE every secret.`);
    console.error('Regenerating invalidates existing sessions and makes previously derived buyer references unresolvable');
    console.error('unless the old values are moved into the PREVIOUS_* rotation maps first.');
    process.exit(1);
  }

  const lines = [
    '# ClearTrade-generated staging secrets.',
    '# Transfer into the platform secret manager, then DELETE this file.',
    '# Never commit. Never paste into a ticket, chat or log.',
    '',
    ...GENERATED.map((s) => `${s.name}=${s.value}`),
    '',
    ...VERSIONS.map((s) => `${s.name}=${s.value}`),
    '',
  ];
  writeFileSync(outPath, lines.join('\n'), { mode: 0o600 });
  chmodSync(outPath, 0o600);

  console.log(`Wrote ${GENERATED.length} generated secrets + ${VERSIONS.length} key versions to ${outPath} (mode 0600).\n`);
  console.log('name                                 bytes  sha256:12    purpose');
  console.log('-'.repeat(96));
  for (const s of GENERATED) {
    console.log(`${s.name.padEnd(36)} ${String(s.value.length).padStart(5)}  ${fingerprint(s.value)}  ${s.note}`);
  }
  console.log('\nFingerprints are SHA-256 prefixes, printed so you can confirm staging differs from');
  console.log('development WITHOUT revealing either value. Two environments sharing a fingerprint');
  console.log('are sharing a secret.\n');
  console.log('Still required from providers (NOT generated here):');
  console.log('  COMTRADE_API_KEY, object-storage access key/secret, DOCUMENT_MALWARE_SCANNER_URL +');
  console.log('  credential, NOTIFICATION_PROVIDER_API_KEY/URL, error-reporting DSN if a vendor is chosen.');
}

main();
