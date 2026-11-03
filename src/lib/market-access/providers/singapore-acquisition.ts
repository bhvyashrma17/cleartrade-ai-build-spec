import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { parseSingaporeScheduleHtml, serializeSingaporeLines, SINGAPORE_QUALIFICATION_MINIMUM_ROWS } from './singapore-bundle';

export const SINGAPORE_ACQUISITION_VERSION = 'sg-sso-customs-duties-acquisition-v1' as const;
export const SINGAPORE_ORDER_URL = 'https://sso.agc.gov.sg/SL/CA1960-OR4?ProvIds=Sc4-XX-Sc4-&ViewType=Print' as const;
export const SINGAPORE_S49_URL = 'https://sso.agc.gov.sg/SL-Supp/S49-2026/Published/20260130?DocDate=20260130&ViewType=Print' as const;
export const SINGAPORE_S67_URL = 'https://sso.agc.gov.sg/SL-Supp/S67-2026/Published/20260212?DocDate=20260212&ViewType=Print' as const;
export const SINGAPORE_TERMS_URL = 'https://sso.agc.gov.sg/Terms-of-Use' as const;
export const SINGAPORE_CLASSIFICATION_URL = 'https://www.customs.gov.sg/doing-business/business-resources/hs-classification-of-goods/classifying-my-products/' as const;
export const SINGAPORE_DUTIABLE_GOODS_URL = 'https://www.customs.gov.sg/doing-business/valuation-duties-and-fees/duties-and-dutiable-goods/duties-and-dutiable-goods-overview/' as const;

const ALLOWED_HOSTS = new Set(['sso.agc.gov.sg', 'www.customs.gov.sg']);
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export class SingaporeAcquisitionWindowError extends Error {
  readonly code = 'outside_sso_automation_window';
  constructor(readonly retry_at: Date) {
    super(`SSO automated extraction is allowed only from 03:00 to 07:00 Singapore Time; schedule this refresh for ${retry_at.toISOString()}.`);
    this.name = 'SingaporeAcquisitionWindowError';
  }
}

function singaporeParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

export function singaporeSsoAcquisitionWindow(now: Date) {
  if (Number.isNaN(now.getTime())) throw new Error('Singapore acquisition requires a valid clock value.');
  const sg = singaporeParts(now);
  const allowed = sg.hour >= 3 && sg.hour < 7;
  const currentSgAsUtc = Date.UTC(sg.year, sg.month - 1, sg.day, sg.hour, sg.minute, sg.second);
  const nextDay = sg.hour >= 7 ? 1 : 0;
  const nextLocalAsUtc = Date.UTC(sg.year, sg.month - 1, sg.day + nextDay, 3, 0, 0);
  // Singapore is UTC+08:00 year-round.
  const retryAt = new Date(nextLocalAsUtc - 8 * 60 * 60 * 1000);
  return { allowed, singapore_hour: sg.hour, retry_at: allowed ? now : retryAt, singapore_clock_epoch: currentSgAsUtc };
}

export function assertSingaporeSsoAcquisitionWindow(now: Date) {
  const decision = singaporeSsoAcquisitionWindow(now);
  if (!decision.allowed) throw new SingaporeAcquisitionWindowError(decision.retry_at);
  return decision;
}

function officialUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Singapore authority acquisition does not accept ${url.hostname}.`);
  return url.toString();
}

async function fetchBytes(url: string, fetchImpl: typeof fetch, attempts: number) {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(officialUrl(url), {
        headers: { accept: 'text/html,application/xhtml+xml', connection: 'close', 'user-agent': 'ClearTrade-Customs-Atlas/1.0' },
        redirect: 'follow', signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) throw new Error(`non-retryable HTTP ${response.status}`);
        throw new Error(`retryable HTTP ${response.status}`);
      }
      if (response.url && !ALLOWED_HOSTS.has(new URL(response.url).hostname)) throw new Error(`redirected outside the authority allowlist to ${response.url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_ARTIFACT_BYTES) throw new Error(`invalid byte length ${bytes.length}`);
      return bytes;
    } catch (error) {
      last = error;
      if (attempt === attempts || /non-retryable|outside the authority allowlist|invalid byte length/.test(String(error))) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`Singapore authority acquisition failed for ${url} after ${attempts} attempt(s): ${last instanceof Error ? last.message : String(last)}`, { cause: last });
}

function currentAsAt(html: string) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ');
  const match = /Current version\s+as at\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(text);
  if (!match) throw new Error('The current SSO page did not expose its consolidated as-at identity.');
  return match[1]!;
}

export async function acquireSingaporeAuthorityBundle(args: {
  release_identifier: string;
  now?: Date;
  fetch_impl?: typeof fetch;
  attempts?: number;
  qualification_minimum_rows?: number;
}) {
  const now = args.now ?? new Date();
  assertSingaporeSsoAcquisitionWindow(now);
  const fetchImpl = args.fetch_impl ?? fetch;
  const attempts = args.attempts ?? 2;
  const sources = [
    ['customs-duties-order-current.html', 'official_current_consolidated_first_schedule', SINGAPORE_ORDER_URL],
    ['s49-2026.html', 'official_amendment_provenance', SINGAPORE_S49_URL],
    ['s67-2026.html', 'official_tariff_amendment_provenance', SINGAPORE_S67_URL],
    ['terms-of-use.html', 'official_reuse_and_automation_terms', SINGAPORE_TERMS_URL],
    ['classification.html', 'singapore_customs_8_digit_classification_evidence', SINGAPORE_CLASSIFICATION_URL],
    ['dutiable-goods.html', 'singapore_customs_blank_and_duty_category_evidence', SINGAPORE_DUTIABLE_GOODS_URL],
  ] as const;
  // Deliberately sequential and bounded: one small request per reviewed public artifact.
  const artifacts: Array<{ name: string; role: string; url: string; bytes: Buffer; size_bytes: number; sha256: string }> = [];
  for (const [name, role, url] of sources) {
    const bytes = await fetchBytes(url, fetchImpl, attempts);
    artifacts.push({ name, role, url, bytes, size_bytes: bytes.length, sha256: sha256(bytes) });
  }
  const order = artifacts[0]!.bytes.toString('utf8');
  const lines = parseSingaporeScheduleHtml(order, { minimum_rows: args.qualification_minimum_rows ?? SINGAPORE_QUALIFICATION_MINIMUM_ROWS });
  const normalized = serializeSingaporeLines(lines);
  artifacts.push({ name: 'normalized-lines.json', role: 'deterministic_canonical_tariff_artifact', url: SINGAPORE_ORDER_URL, bytes: normalized, size_bytes: normalized.length, sha256: sha256(normalized) });
  const attribution = 'Singapore legislation is subject to copyright of the Singapore Government and is used/reproduced with the permission of the Attorney-General’s Chambers of Singapore. Check Singapore Statutes Online for the latest version. ClearTrade is not associated with, affiliated with or endorsed by AGC or SSO.';
  const manifest = {
    acquisition_version: SINGAPORE_ACQUISITION_VERSION, release_identifier: args.release_identifier.trim(),
    acquired_at: now.toISOString(), consolidated_as_at: currentAsAt(order), consolidated_effective_version: '2026-02-12T17:00:00+08:00',
    artifacts: artifacts.map(({ bytes: _bytes, ...artifact }) => artifact),
    amendments: [
      { instrument: 'S 49/2026', effective_from: '2026-02-01T00:00:00+08:00', url: SINGAPORE_S49_URL },
      { instrument: 'S 67/2026', effective_from: '2026-02-12T17:00:00+08:00', url: SINGAPORE_S67_URL },
    ],
    rights: { electronic_platform_reproduction_permitted: true, automated_extraction_window_sgt: '03:00-07:00', required_attribution: attribution },
    scope: { tariff_treatment_complete: true, regulatory_coverage_complete: false },
  };
  const zip = new JSZip(); const fileOptions = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  for (const artifact of artifacts) zip.file(artifact.name, artifact.bytes, fileOptions);
  zip.file('acquisition.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), fileOptions);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' }));
}
