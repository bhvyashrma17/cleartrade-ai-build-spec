import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  acquireKoreaTariffPage,
  KOREA_SERVICE_KEY_ENV_VAR,
  KoreaCredentialNotConfiguredError,
} from '@/lib/market-access/providers/korea-acquisition';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';

/**
 * Korea Customs' rights are cleared (KOGL Type 1, confirmed against the exact tariff dataset —
 * see unconfigured-sources.ts), but acquisition needs a data.go.kr service key this environment
 * does not have. This is an operational gate, not a rights one, and the two must stay
 * distinguishable — see the routing test's `credential_not_provisioned` assertion.
 */

const original = process.env[KOREA_SERVICE_KEY_ENV_VAR];
afterEach(() => {
  if (original === undefined) delete process.env[KOREA_SERVICE_KEY_ENV_VAR];
  else process.env[KOREA_SERVICE_KEY_ENV_VAR] = original;
});

describe('Korea Customs acquisition fails closed without a credential', () => {
  test('throws a named, distinguishable error rather than falling back to a guess or a scrape', async () => {
    delete process.env[KOREA_SERVICE_KEY_ENV_VAR];
    const fetchImpl = vi.fn();
    await expect(acquireKoreaTariffPage({ endpoint_uddi: 'uddi:test' }, { fetch_impl: fetchImpl }))
      .rejects.toBeInstanceOf(KoreaCredentialNotConfiguredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('calls the real odcloud endpoint with the configured key once provisioned', async () => {
    process.env[KOREA_SERVICE_KEY_ENV_VAR] = 'test-key';
    let calledUrl = '';
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      calledUrl = String(input);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    await acquireKoreaTariffPage({ endpoint_uddi: 'uddi:test' }, { fetch_impl: fetchImpl });
    expect(calledUrl).toContain('api.odcloud.kr');
    expect(calledUrl).toContain('serviceKey=test-key');
  });

  test('the registry records this as a credential gate, distinct from a legal/licensing one', () => {
    const source = unconfiguredSourceForCountry('KR');
    expect(source).not.toBeNull();
    expect(source!.reason).toBe('credential_not_provisioned');
    expect(source!.determination).toMatch(/KOGL Type 1/);
    expect(source!.determination).not.toMatch(/no permission|blocked|prohibited/i);
  });
});
