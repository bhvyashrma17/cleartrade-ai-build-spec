import { createHash } from 'node:crypto';
import { buildMalaysiaLocalBundle, parseMalaysiaOrderPdf } from './malaysia-bundle';
import { MALAYSIA_ACTIVE_TRADE_REMEDY_MANIFEST, type MalaysiaTradeRemedyManifest } from './malaysia-remedies';

export const MALAYSIA_ORDER_URL = 'https://www.customs.gov.my/images/06-prosedur/perintah-kastam/perintah/PUA_384.pdf' as const;
export const MALAYSIA_CUSTOMS_REGISTRY_URL = 'https://www.customs.gov.my/en/procedure/customs/customs' as const;
export const MALAYSIA_RIGHTS_URL = 'https://mycieds.customs.gov.my/safety-policy/' as const;
export const MALAYSIA_MICECA_URL = 'https://fta.miti.gov.my/index.php/pages/view/Malaysia-India' as const;
export const MALAYSIA_MYSST_URL = 'https://mysst.customs.gov.my/sst-orders/' as const;
export const MALAYSIA_ORDER_SHA256 = 'e51c740cf95290cb71cd473596adc21ef159d1aa4f2a0282c73b4b3815beea99' as const;

const ALLOWED_HOSTS = new Set(['www.customs.gov.my', 'customs.gov.my', 'mycieds.customs.gov.my', 'fta.miti.gov.my', 'www.miti.gov.my', 'miti.gov.my', 'mysst.customs.gov.my', 'traderemedies.miti.gov.my', 'www.parlimen.gov.my', 'parlimen.gov.my', 'data.gov.my']);
const MAX_BYTES = 40 * 1024 * 1024;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function malaysiaOfficialUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Malaysia acquisition rejects non-authority host ${url.hostname}.`);
  return url.toString();
}

async function fetchOfficial(url: string, fetchImpl: typeof fetch, attempts: number, accept: string) {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(malaysiaOfficialUrl(url), { redirect: 'follow', signal: AbortSignal.timeout(90_000), headers: { accept, connection: 'close', 'user-agent': 'ClearTrade-Customs-Atlas/1.0' } });
      if (!response.ok) { if (response.status < 500 && response.status !== 429) throw new Error(`non-retryable HTTP ${response.status}`); throw new Error(`retryable HTTP ${response.status}`); }
      if (response.url && !ALLOWED_HOSTS.has(new URL(response.url).hostname)) throw new Error(`redirect outside official allowlist: ${response.url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_BYTES) throw new Error(`invalid byte length ${bytes.length}`);
      return bytes;
    } catch (error) {
      last = error;
      if (attempt === attempts || /non-retryable|outside official|invalid byte/.test(String(error))) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
  throw new Error(`Malaysia official acquisition failed for ${url}: ${last instanceof Error ? last.message : String(last)}`, { cause: last });
}

function text(bytes: Buffer) { return bytes.toString('utf8').replace(/\s+/g, ' '); }

/**
 * Build-only acquisition. The returned bytes may be used for local validation, but the service
 * layer refuses retention or activation until JKDM written commercial-reuse permission is
 * evidenced. No browser/private HS Explorer endpoint is used.
 */
export async function acquireMalaysiaLocalBundle(args: { release_identifier: string; remedies?: MalaysiaTradeRemedyManifest; fetch_impl?: typeof fetch; attempts?: number }) {
  const fetchImpl = args.fetch_impl ?? fetch; const attempts = args.attempts ?? 3;
  const sources = [
    ['customs-duties-order-2025.pdf', 'official_principal_customs_duties_order', MALAYSIA_ORDER_URL, 'application/pdf'],
    ['jkdm-customs-order-registry.html', 'official_currentness_and_amendment_registry', MALAYSIA_CUSTOMS_REGISTRY_URL, 'text/html'],
    ['jkdm-commercial-reuse-notice.html', 'official_commercial_reuse_rights_notice', MALAYSIA_RIGHTS_URL, 'text/html'],
    ['miti-miceca.html', 'official_miceca_existence_and_origin_evidence', MALAYSIA_MICECA_URL, 'text/html'],
    ['mysst-orders.html', 'official_separate_sales_tax_instrument_registry', MALAYSIA_MYSST_URL, 'text/html'],
  ] as const;
  const artifacts: Array<{ name: string; role: string; url: string; bytes: Buffer }> = [];
  for (const [name, role, url, accept] of sources) artifacts.push({ name, role, url, bytes: await fetchOfficial(url, fetchImpl, attempts, accept) });
  const order = artifacts[0]!.bytes;
  if (sha256(order) !== MALAYSIA_ORDER_SHA256) throw new Error('Malaysia Customs Duties Order 2025 bytes changed; review and pin the new official artifact before parsing.');
  const registry = text(artifacts[1]!.bytes); const rights = text(artifacts[2]!.bytes); const miceca = text(artifacts[3]!.bytes); const mysst = text(artifacts[4]!.bytes);
  if (!/Customs Duties Order 2025/i.test(registry)) throw new Error('JKDM registry no longer identifies Customs Duties Order 2025.');
  if (!/commercial/i.test(rights) || !/(permission|written)/i.test(rights)) throw new Error('JKDM rights page no longer exposes the reviewed commercial-use permission restriction.');
  if (!/MICECA|Malaysia.India Comprehensive Economic Cooperation Agreement/i.test(miceca)) throw new Error('MITI no longer exposes the reviewed MICECA evidence.');
  if (!/Sales Tax/i.test(mysst)) throw new Error('MySST no longer exposes the sales-tax order registry.');
  const parsed = await parseMalaysiaOrderPdf(order);
  return buildMalaysiaLocalBundle({ release_identifier: args.release_identifier, source_url: MALAYSIA_ORDER_URL, artifacts, lines: parsed.lines, trq: parsed.trq, remedies: args.remedies ?? MALAYSIA_ACTIVE_TRADE_REMEDY_MANIFEST });
}
