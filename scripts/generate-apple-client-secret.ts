/**
 * Generate the Apple `client_secret` for Sign in with Apple.
 *
 * Apple is the odd one out among OAuth providers: it does not issue a long-lived client
 * secret. The secret is an ES256 JWT that *you* sign with a private key downloaded from the
 * Apple Developer portal, and Apple caps its lifetime at 6 months. That has two consequences
 * this script exists to handle:
 *
 *   1. The `.p8` private key must never enter the repository. It is a long-lived signing key
 *      that can mint credentials for your Services ID until it is revoked, so it belongs in a
 *      secret manager or on an operator's machine — never in git, and never in an env var
 *      committed anywhere. This script reads it from a path you supply and never prints it.
 *   2. `AUTH_APPLE_SECRET` expires. Whatever is in Railway today stops working within six
 *      months, so rotation is a scheduled operational task, not a one-time setup step. The
 *      script prints the exact expiry so the rotation can be diarised.
 *
 * Usage (the .p8 stays outside the repo):
 *
 *   npm run secrets:apple -- \
 *     --key-file ~/secure/AuthKey_ABC1234567.p8 \
 *     --team-id  A1B2C3D4E5 \
 *     --key-id   ABC1234567 \
 *     --client-id com.cleartrade.staging.signin
 *
 * Writes a 0600 file (default `.env.apple.secret`, gitignored) containing only
 * `AUTH_APPLE_SECRET=...`, and prints a fingerprint plus the expiry — never the value, and
 * never the key. Transfer the value into Railway, then delete the file.
 *
 * This script fabricates nothing. Every input is something Apple issued to you; if you have
 * not completed the Apple Developer setup, it will tell you what is missing and stop.
 */

import { createHash, createSign, createPrivateKey } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Apple's hard ceiling. Requesting longer makes Apple reject the secret outright. */
const MAX_LIFETIME_SECONDS = 15_777_000; // ~6 months, per Apple's documented maximum.

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')
    ? process.argv[index + 1]
    : undefined;
}

/**
 * Sign the JWT with ES256.
 *
 * `dsaEncoding: 'ieee-p1363'` is the load-bearing detail: Node's default for EC signatures is
 * ASN.1/DER, but JWS requires the raw fixed-width R||S concatenation. Without this the token
 * is a structurally valid JWT that Apple rejects with an opaque `invalid_client`.
 */
function signES256(header: object, payload: object, privateKeyPem: string): string {
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ec') {
    throw new Error(`Expected an EC private key from Apple; got ${key.asymmetricKeyType ?? 'unknown'}.`);
  }
  const signature = createSign('SHA256').update(signingInput).sign({ key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${base64url(signature)}`;
}

function main() {
  const keyFile = arg('key-file') ?? process.env.APPLE_AUTH_KEY_FILE;
  const teamId = arg('team-id') ?? process.env.APPLE_TEAM_ID;
  const keyId = arg('key-id') ?? process.env.APPLE_KEY_ID;
  const clientId = arg('client-id') ?? process.env.AUTH_APPLE_ID;
  const outPath = arg('out') ?? '.env.apple.secret';

  const missing = [
    !keyFile && '--key-file (path to the AuthKey_XXXXXXXXXX.p8 downloaded from Apple)',
    !teamId && '--team-id (Apple Developer team ID, 10 chars)',
    !keyId && '--key-id (the Key ID shown next to the .p8 in Certificates, Identifiers & Profiles)',
    !clientId && '--client-id (your Services ID, e.g. com.cleartrade.staging.signin)',
  ].filter(Boolean);

  if (missing.length) {
    console.error('Cannot generate an Apple client secret — the following are required:\n');
    for (const item of missing) console.error(`  - ${item}`);
    console.error('\nThese come from the Apple Developer portal. See docs/29-social-authentication.md §Apple.');
    process.exit(1);
  }

  if (!existsSync(keyFile!)) {
    console.error(`Private key not found at ${keyFile}.`);
    process.exit(1);
  }
  if (existsSync(outPath) && !process.argv.includes('--force')) {
    console.error(`Refusing to overwrite ${outPath}. Pass --force to regenerate.`);
    process.exit(1);
  }

  // Read, use, and never echo. The .p8 stays in memory only for the signing call.
  const privateKeyPem = readFileSync(keyFile!, 'utf8');
  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) {
    console.error('That file does not look like an Apple .p8 private key (no PEM PRIVATE KEY block).');
    process.exit(1);
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + MAX_LIFETIME_SECONDS;

  let token: string;
  try {
    token = signES256(
      { alg: 'ES256', kid: keyId },
      { iss: teamId, iat: issuedAt, exp: expiresAt, aud: 'https://appleid.apple.com', sub: clientId },
      privateKeyPem,
    );
  } catch (error) {
    console.error(`Signing failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  writeFileSync(
    outPath,
    [
      '# Apple client secret for Sign in with Apple (an ES256 JWT).',
      `# Generated ${new Date(issuedAt * 1000).toISOString()} — EXPIRES ${new Date(expiresAt * 1000).toISOString()}.`,
      '# Transfer into the platform secret manager, then DELETE this file. Never commit.',
      '',
      `AUTH_APPLE_SECRET=${token}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  chmodSync(outPath, 0o600);

  console.log('\nApple client secret generated.\n');
  console.log(`  client_id (sub)   ${clientId}`);
  console.log(`  team_id   (iss)   ${teamId}`);
  console.log(`  key_id    (kid)   ${keyId}`);
  console.log(`  fingerprint       sha256:${createHash('sha256').update(token).digest('hex').slice(0, 12)}`);
  console.log(`  expires           ${new Date(expiresAt * 1000).toISOString()}`);
  console.log(`  written to        ${outPath} (0600)\n`);
  console.log('Next: set AUTH_APPLE_ID and AUTH_APPLE_SECRET in the target environment, then delete the file.');
  console.log('Diarise a rotation before the expiry above — Apple will reject the secret after it.\n');
}

main();
