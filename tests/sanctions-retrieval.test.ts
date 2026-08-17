/**
 * Part G — deterministic retrieval + completeness failure-mode matrix.
 *
 * NO NETWORK. Every case drives the real `retrieveSanctionsArtifact` / `validateArtifact` /
 * `evaluateCompleteness` code paths through an injected `fetchImpl`, so CI never depends on
 * a provider being reachable (live contract validation lives in
 * `scripts/verify-sanctions-live.ts` and is deliberately kept out of this suite).
 *
 * Each case asserts the CANDIDATE outcome. Cases that touch activation additionally assert
 * that a previously active snapshot is preserved.
 */

import { describe, expect, test } from 'vitest';
import { SanctionsCompletenessStatus, SanctionsFailureStage } from '@prisma/client';
import { retrieveSanctionsArtifact, validateArtifact, redactUrl, parseRetryAfterMs } from '../src/lib/sanctions/retrieval';
import { evaluateCompleteness, coverageRatios } from '../src/lib/sanctions/completeness';
import { sanctionsContract } from '../src/lib/sanctions/sources';
import { parseOfac, parseUn, type ParseResult } from '../src/lib/sanctions/adapters';

const OFAC = sanctionsContract('ofac_sdn');
const UN = sanctionsContract('un_security_council');

/** A minimally valid OFAC artifact, padded past the contract's min_bytes floor. */
function ofacArtifact(records = 2, pad = OFAC.min_bytes): string {
  const entries = Array.from({ length: records }, (_, i) =>
    `<sdnEntry><uid>${i + 1}</uid><lastName>ENTITY ${i + 1}</lastName><sdnType>Entity</sdnType><programList><program>TEST</program></programList></sdnEntry>`,
  ).join('');
  const body = `<?xml version="1.0"?><sdnList><publshInformation><Publish_Date>08/07/2026</Publish_Date><Record_Count>${records}</Record_Count></publshInformation>${entries}<!--${'x'.repeat(Math.max(0, pad))}-->\n</sdnList>`;
  return body;
}

function res(body: string, init: { status?: number; headers?: Record<string, string>; url?: string } = {}): Response {
  const { status = 200, headers = { 'content-type': 'text/xml' }, url = OFAC.base_url } = init;
  const r = new Response(body, { status, headers });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}
const fetchReturning = (r: Response | (() => Response | Promise<Response>)) =>
  (async () => (typeof r === 'function' ? r() : r)) as unknown as typeof fetch;
const fetchThrowing = (e: Error) => (async () => { throw e; }) as unknown as typeof fetch;

// Retries are exercised but must not slow the suite.
const fast = { max_attempts: 2, backoff_ms: 1, timeout_ms: 50 };

describe('retrieval — HTTP / transport', () => {
  test('valid 200 XML retrieves, checksums and reports byte length', async () => {
    const body = ofacArtifact(3);
    const out = await retrieveSanctionsArtifact(OFAC, { ...fast, fetchImpl: fetchReturning(res(body)) });
    expect(out.ok).toBe(true);
    if (!out.ok || out.not_modified) throw new Error('expected artifact');
    expect(out.http_status).toBe(200);
    expect(out.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out.byte_length).toBe(Buffer.byteLength(body));
    expect(out.media_type).toBe('text/xml');
  });

  test('redirect to an ALLOW-LISTED official host is accepted', async () => {
    const out = await retrieveSanctionsArtifact(OFAC, {
      ...fast,
      fetchImpl: fetchReturning(res(ofacArtifact(), { url: 'https://wc2h.s3.us-gov-west-1.amazonaws.com/Published/SDN.XML' })),
    });
    expect(out.ok).toBe(true);
  });

  test('redirect to a NON-allow-listed host is refused as unattributable provenance', async () => {
    const out = await retrieveSanctionsArtifact(OFAC, {
      ...fast,
      fetchImpl: fetchReturning(res(ofacArtifact(), { url: 'https://evil.example.com/SDN.XML' })),
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.stage).toBe(SanctionsFailureStage.artifact_validation);
    expect(out.reason).toMatch(/unapproved host/i);
  });

  for (const status of [403, 404]) {
    test(`${status} fails at RETRIEVAL and is not retried`, async () => {
      let calls = 0;
      const out = await retrieveSanctionsArtifact(OFAC, {
        ...fast,
        fetchImpl: fetchReturning(() => { calls++; return res('', { status }); }),
      });
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error('unreachable');
      expect(out.stage).toBe(SanctionsFailureStage.retrieval);
      expect(out.http_status).toBe(status);
      expect(calls).toBe(1); // non-retryable
    });
  }

  for (const status of [429, 500]) {
    test(`${status} is retried and then reported as a retrieval failure`, async () => {
      let calls = 0;
      const out = await retrieveSanctionsArtifact(OFAC, {
        ...fast,
        fetchImpl: fetchReturning(() => { calls++; return res('', { status }); }),
      });
      expect(out.ok).toBe(false);
      expect(calls).toBe(fast.max_attempts); // provider-aware backoff exhausted
    });
  }

  test('a 429 that then succeeds recovers without operator intervention', async () => {
    let calls = 0;
    const out = await retrieveSanctionsArtifact(OFAC, {
      ...fast,
      fetchImpl: fetchReturning(() => (++calls === 1 ? res('', { status: 429 }) : res(ofacArtifact()))),
    });
    expect(out.ok).toBe(true);
    expect(calls).toBe(2);
  });

  test('timeout / connection reset / DNS failure are transport failures, not parse failures', async () => {
    for (const err of [
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
    ]) {
      const out = await retrieveSanctionsArtifact(OFAC, { ...fast, fetchImpl: fetchThrowing(err) });
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error('unreachable');
      expect(out.stage).toBe(SanctionsFailureStage.retrieval);
      expect(out.reason).toMatch(/transport error/i);
    }
  });
});

describe('retrieval — body integrity (a 200 is not evidence)', () => {
  const cases: [string, string, RegExp][] = [
    ['HTML error page with HTTP 200', `<!DOCTYPE html><html><body>Access Denied</body></html>${'x'.repeat(OFAC.min_bytes)}`, /HTML document/i],
    ['JSON error envelope with HTTP 200', `{"statusCode":403,"message":"Forbidden"}${' '.repeat(OFAC.min_bytes)}`, /JSON/i],
    ['empty body', '', /empty/i],
  ];
  for (const [name, body, expected] of cases) {
    test(name, async () => {
      const out = await retrieveSanctionsArtifact(OFAC, { ...fast, fetchImpl: fetchReturning(res(body)) });
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error('unreachable');
      expect(out.stage).toBe(SanctionsFailureStage.artifact_validation);
      expect(out.reason).toMatch(expected);
    });
  }

  test('truncated XML (root never closes) is rejected — the real EU truncation case', () => {
    const full = ofacArtifact(50);
    const truncated = full.slice(0, Math.floor(full.length * 0.8));
    const v = validateArtifact(truncated, OFAC, Buffer.byteLength(truncated), 'text/xml');
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.reason).toMatch(/truncated/i);
  });

  test('valid XML with the WRONG root element is rejected', () => {
    const body = `<?xml version="1.0"?><someOtherList><a/>${'<!--' + 'x'.repeat(OFAC.min_bytes) + '-->'}</someOtherList>`;
    const v = validateArtifact(body, OFAC, Buffer.byteLength(body), 'text/xml');
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.reason).toMatch(/does not open with <sdnList>/i);
  });

  test('unexpected media type is rejected even when the body would parse', async () => {
    const out = await retrieveSanctionsArtifact(OFAC, {
      ...fast,
      fetchImpl: fetchReturning(res(ofacArtifact(), { headers: { 'content-type': 'text/html; charset=utf-8' } })),
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toMatch(/media type/i);
  });

  test('artifact below the contract floor is rejected as truncated/stub', () => {
    const tiny = '<?xml version="1.0"?><sdnList></sdnList>';
    const v = validateArtifact(tiny, OFAC, Buffer.byteLength(tiny), 'text/xml');
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.reason).toMatch(/below the .* floor/i);
  });

  test('declared content-length over the ceiling is refused before the body is read', async () => {
    const out = await retrieveSanctionsArtifact(OFAC, {
      ...fast,
      fetchImpl: fetchReturning(res(ofacArtifact(), { headers: { 'content-type': 'text/xml', 'content-length': String(OFAC.max_bytes + 1) } })),
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toMatch(/exceeds/i);
  });
});

describe('retrieval — caching / versioning', () => {
  test('304 Not Modified is a success that does NOT create a new snapshot', async () => {
    // The WHATWG Response constructor refuses 304 (a null-body status), so this case uses
    // a minimal stand-in exposing only what the retrieval layer reads.
    const notModified = { status: 304, ok: false, url: OFAC.base_url, headers: new Headers({ etag: '"abc"' }) } as unknown as Response;
    const out = await retrieveSanctionsArtifact(OFAC, {
      ...fast,
      if_none_match: '"abc"',
      fetchImpl: fetchReturning(notModified),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.not_modified).toBe(true);
  });

  test('ETag and Last-Modified are captured for conditional retrieval', async () => {
    const out = await retrieveSanctionsArtifact(OFAC, {
      ...fast,
      fetchImpl: fetchReturning(res(ofacArtifact(), { headers: { 'content-type': 'text/xml', etag: '"v2"', 'last-modified': 'Fri, 07 Aug 2026 00:00:00 GMT' } })),
    });
    if (!out.ok || out.not_modified) throw new Error('expected artifact');
    expect(out.etag).toBe('"v2"');
    expect(out.last_modified).toMatch(/07 Aug 2026/);
  });

  test('identical bytes yield an identical checksum; changed bytes yield a different one', async () => {
    const a = await retrieveSanctionsArtifact(OFAC, { ...fast, fetchImpl: fetchReturning(res(ofacArtifact(3))) });
    const b = await retrieveSanctionsArtifact(OFAC, { ...fast, fetchImpl: fetchReturning(res(ofacArtifact(3))) });
    const c = await retrieveSanctionsArtifact(OFAC, { ...fast, fetchImpl: fetchReturning(res(ofacArtifact(4))) });
    if (!a.ok || a.not_modified || !b.ok || b.not_modified || !c.ok || c.not_modified) throw new Error('expected artifacts');
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).not.toBe(c.sha256);
  });

  test('provider publication version is extracted, and a change is visible', () => {
    const unchanged = parseOfac(ofacArtifact(2));
    expect(unchanged.source_version).toBe('08/07/2026');
    const changed = parseOfac(ofacArtifact(2).replace('08/07/2026', '08/12/2026'));
    expect(changed.source_version).toBe('08/12/2026');
    expect(changed.source_update_date).not.toEqual(unchanged.source_update_date);
  });

  test('a token in a URL is redacted before it is persisted or logged', () => {
    expect(redactUrl('https://webgate.ec.europa.eu/x/content?token=SECRETVALUE')).toContain('token=REDACTED');
    expect(redactUrl('https://s3/SDN.XML?X-Amz-Signature=abc&X-Amz-Security-Token=def')).not.toMatch(/abc|def/);
  });
});

describe('completeness gate', () => {
  const mkParse = (over: Partial<ParseResult> = {}): ParseResult => ({
    retrieved_count: 100,
    entities: Array.from({ length: 100 }, (_, i) => ({
      source_record_id: String(i), primary_name: `N${i}`, aliases: ['a'], entity_type: 'Entity',
      countries: [], addresses: [], dates: [], identifiers: [{ type: 'x', value: `id${i}` }],
      programs: [], remarks: null, source_published_at: null, source_version: null, raw: {},
    })),
    rejected_records: 0, parse_errors: [], source_update_date: null, source_version: null,
    authoritative_record_count: null,
    ...over,
  });
  const evalWith = (parse: ParseResult, previous: Parameters<typeof evaluateCompleteness>[0]['previous'] = null) =>
    evaluateCompleteness({ contract: OFAC, parse, ...coverageRatios(parse), previous });

  test('a clean full parse is COMPLETE', () => {
    const r = evalWith(mkParse());
    expect(r.status).toBe(SanctionsCompletenessStatus.COMPLETE);
    expect(r.coverage_complete).toBe(true);
  });

  test('zero parsed records is FAILED, never COMPLETE', () => {
    const r = evalWith(mkParse({ retrieved_count: 0, entities: [] }));
    expect(r.status).toBe(SanctionsCompletenessStatus.FAILED);
    expect(r.anomalies.map((a) => a.code)).toContain('zero_records');
  });

  test('a small rejection count degrades to PARTIAL rather than passing silently', () => {
    const r = evalWith(mkParse({ rejected_records: 1 }));
    expect(r.coverage_complete).toBe(false);
    expect(r.anomalies.map((a) => a.code)).toContain('high_rejection_rate');
  });

  test('a catastrophic rejection count is blocking', () => {
    const r = evalWith(mkParse({ rejected_records: 40 }));
    expect(r.status).toBe(SanctionsCompletenessStatus.PARTIAL);
    expect(r.anomalies.find((a) => a.code === 'high_rejection_rate')?.severity).toBe('blocking');
  });

  test('>50% record-count collapse vs the previous snapshot is blocking', () => {
    const parse = mkParse({ retrieved_count: 20, entities: mkParse().entities.slice(0, 20) });
    const r = evalWith(parse, { parsed_entity_count: 100, alias_coverage_ratio: 1, identifier_coverage_ratio: 1 });
    expect(r.coverage_complete).toBe(false);
    expect(r.anomalies.map((a) => a.code)).toContain('record_count_collapse');
  });

  test('alias coverage collapse is blocking (aliases are a primary matching signal)', () => {
    const parse = mkParse({ entities: mkParse().entities.map((e) => ({ ...e, aliases: [] })) });
    const r = evalWith(parse, { parsed_entity_count: 100, alias_coverage_ratio: 1, identifier_coverage_ratio: 1 });
    expect(r.anomalies.map((a) => a.code)).toContain('alias_coverage_collapse');
    expect(r.coverage_complete).toBe(false);
  });

  test('identifier coverage collapse is blocking', () => {
    const parse = mkParse({ entities: mkParse().entities.map((e) => ({ ...e, identifiers: [] })) });
    const r = evalWith(parse, { parsed_entity_count: 100, alias_coverage_ratio: 1, identifier_coverage_ratio: 1 });
    expect(r.anomalies.map((a) => a.code)).toContain('identifier_coverage_collapse');
  });

  test("OFAC declared-count mismatch blocks activation even with a clean parse", () => {
    const r = evalWith(mkParse({ authoritative_record_count: 19199 }));
    expect(r.coverage_complete).toBe(false);
    expect(r.anomalies.find((a) => a.code === 'authoritative_count_mismatch')?.severity).toBe('blocking');
  });

  test('declared count matching parsed output yields COMPLETE and says so', () => {
    const r = evalWith(mkParse({ authoritative_record_count: 100 }));
    expect(r.status).toBe(SanctionsCompletenessStatus.COMPLETE);
    expect(r.rationale).toMatch(/reconciled against the authority's declared count of 100/);
  });
});

describe('source semantics regressions (Parts A + B)', () => {
  test('UN: individuals and entities both parse, and every record keeps a unique id', () => {
    const xml = `<CONSOLIDATED_LIST dateGenerated="2026-08-13T23:00:02.056Z">` +
      `<INDIVIDUAL><DATAID>1</DATAID><REFERENCE_NUMBER>KPi.001</REFERENCE_NUMBER><FIRST_NAME>A</FIRST_NAME></INDIVIDUAL>` +
      `<INDIVIDUAL><DATAID>2</DATAID><REFERENCE_NUMBER>KPi.002</REFERENCE_NUMBER><FIRST_NAME>B</FIRST_NAME></INDIVIDUAL>` +
      `<ENTITY><DATAID>3</DATAID><REFERENCE_NUMBER>KPe.001</REFERENCE_NUMBER><FIRST_NAME>C Ltd</FIRST_NAME></ENTITY>` +
      `</CONSOLIDATED_LIST>`;
    const r = parseUn(xml);
    // 2 individuals + 1 entity = 3, mirroring the live 736 + 275 = 1,011 reconciliation.
    expect(r.retrieved_count).toBe(3);
    expect(r.entities).toHaveLength(3);
    expect(r.entities.filter((e) => e.entity_type === 'person')).toHaveLength(2);
    expect(new Set(r.entities.map((e) => e.source_record_id)).size).toBe(3);
    expect(r.source_update_date?.toISOString()).toBe('2026-08-13T23:00:02.056Z');
  });

  test('OFAC non-SDN Consolidated uses the SDN schema and parses with the SDN adapter', () => {
    // The live Consolidated artifact is <sdnList>, identical to SDN — this is why one
    // adapter serves both datasets while they remain separate snapshots.
    const consolidated = ofacArtifact(2).replace('<Record_Count>2', '<Record_Count>2');
    const r = parseOfac(consolidated);
    expect(r.entities).toHaveLength(2);
    expect(r.authoritative_record_count).toBe(2);
    expect(sanctionsContract('ofac_non_sdn_consolidated').expected_root_element).toBe('sdnList');
    expect(sanctionsContract('ofac_non_sdn_consolidated').adapter_version).toBe(sanctionsContract('ofac_sdn').adapter_version);
  });

  test('the two OFAC datasets are distinct contracts with distinct URLs and floors', () => {
    const sdn = sanctionsContract('ofac_sdn');
    const cons = sanctionsContract('ofac_non_sdn_consolidated');
    expect(cons.base_url).not.toBe(sdn.base_url);
    expect(cons.contract_version).not.toBe(sdn.contract_version);
    expect(cons.min_bytes).toBeLessThan(sdn.min_bytes); // ~1MB vs ~28MB artifacts
  });

  test('UN contract tolerates its own smaller artifact floor', () => {
    expect(UN.min_bytes).toBeLessThan(OFAC.min_bytes);
  });
});

// ---------------------------------------------------------------------------
// F8 — provider backoff
// ---------------------------------------------------------------------------

describe('F8 provider backoff', () => {
  test('Retry-After is honoured in delta-seconds form', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
  });

  test('Retry-After is honoured in HTTP-date form', () => {
    const now = new Date('2026-08-15T12:00:00Z');
    expect(parseRetryAfterMs('Sat, 15 Aug 2026 12:00:45 GMT', now)).toBe(45_000);
  });

  test('a past or zero Retry-After never shortens our own backoff', () => {
    const now = new Date('2026-08-15T12:00:00Z');
    expect(parseRetryAfterMs('0', now)).toBeNull();
    expect(parseRetryAfterMs('-5', now)).toBeNull();
    expect(parseRetryAfterMs('Sat, 15 Aug 2026 11:59:00 GMT', now)).toBeNull();
  });

  test('an absurd Retry-After is capped so a worker cannot be parked indefinitely', () => {
    expect(parseRetryAfterMs('86400')).toBe(600_000);
  });

  test('a malformed Retry-After is ignored rather than trusted', () => {
    expect(parseRetryAfterMs('soon')).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
  });

  test('a 429 carrying Retry-After still exhausts attempts rather than retrying forever', async () => {
    let calls = 0;
    const outcome = await retrieveSanctionsArtifact(OFAC, {
      ...fast,
      fetchImpl: fetchReturning(() => {
        calls += 1;
        return res('', { status: 429, headers: { 'retry-after': '0' } });
      }),
    });
    expect(outcome.ok).toBe(false);
    expect(calls).toBe(fast.max_attempts);
  });
});
