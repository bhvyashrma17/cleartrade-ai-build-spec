import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { productionConfirmationProblem } from '@/lib/production-confirmation';
import { isReservedTestEmail } from '@/lib/reserved-test-domains';

/** Operator scripts that may write to production name the database first (docs/39, E-049). */
describe('production confirmation', () => {
  const production = { environment: 'production', database_fingerprint: '62587019d354aa11bb22cc33' };
  const staging = { environment: 'staging', database_fingerprint: '0123456789abcdef' };

  test('production needs the exact fingerprint prefix, once', () => {
    expect(productionConfirmationProblem(production, ['--confirm-production=62587019d354'], 'x', {})).toBeNull();
    expect(productionConfirmationProblem(production, [], 'x', {})).toContain('--confirm-production=62587019d354');
    expect(productionConfirmationProblem(production, ['--confirm-production=0123456789ab'], 'x', {})).toContain('writes to production only');
    expect(productionConfirmationProblem(production, ['--confirm-production=62587019d354', '--confirm-production=62587019d354'], 'x', {})).not.toBeNull();
  });

  test('DATABASE_ENVIRONMENT=production alone counts as production', () => {
    expect(productionConfirmationProblem(staging, [], 'x', { DATABASE_ENVIRONMENT: 'production' })).toContain('--confirm-production=0123456789ab');
  });

  test('outside production nothing is needed, and the flag is refused so a copied command cannot run elsewhere', () => {
    expect(productionConfirmationProblem(staging, [], 'x', {})).toBeNull();
    expect(productionConfirmationProblem(staging, ['--confirm-production=0123456789ab'], 'x', {})).toContain('not production');
  });

  test('reserved test domains: nobody can receive mail there, and real domains never match', () => {
    for (const email of ['qa@cleartrade.test', 'a@pilot.invalid', 'dev@app.localhost', 'x@shop.example', 'Owner@Example.com', 'b@example.org']) {
      expect(isReservedTestEmail(email), email).toBe(true);
    }
    for (const email of ['hello@cleartrade.in', 'someone@gmail.com', 'x@test.com', 'y@mytest.co', 'z@example.co.in', 'not-an-email', 'a@examples.com']) {
      expect(isReservedTestEmail(email), email).toBe(false);
    }
  });

  test('the two scripts that may write to production use it; the pilot seed still refuses production', () => {
    for (const file of ['scripts/import-importer-list.ts', 'scripts/staging-pilot.ts']) {
      expect(readFileSync(file, 'utf8'), file).toContain('productionConfirmationProblem(');
    }
    const pilot = readFileSync('scripts/staging-pilot.ts', 'utf8');
    expect(pilot).toContain("if (mode === 'write') throw new Error('staging-pilot refuses to run against production.')");
    for (const command of ['seed', 'promote', 'seedDiscovery']) {
      expect(pilot, command).toMatch(new RegExp(`async function ${command}\\([^)]*\\) \\{\\n\\s+const env = assertSafeEnvironment\\(\\);`));
    }
  });
});
