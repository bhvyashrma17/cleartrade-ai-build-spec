import { promises as fs } from 'node:fs';
import path from 'node:path';
import { acquireSaudiAuthorityBundle } from '@/lib/market-access/providers/saudi-acquisition';
import { readSaudiAuthorityBundle } from '@/lib/market-access/providers/saudi-bundle';
import { buildSaudiMarketAccess } from '@/lib/market-access/providers/saudi-parser';

const ROOT = path.resolve(process.cwd(), '.artifacts/customs-atlas/saudi-arabia');
const RELEASE = '2026-09-22';

async function main() {
  await fs.mkdir(ROOT, { recursive: true });
  const started = Date.now();
  const bytes = await acquireSaudiAuthorityBundle({ release_identifier: RELEASE });
  const elapsed_ms = Date.now() - started;
  const out = path.join(ROOT, 'saudi-authority-bundle.zip');
  await fs.writeFile(out, bytes);

  const bundle = await readSaudiAuthorityBundle({ bytes, release_identifier: RELEASE });

  const ordinary = buildSaudiMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: new Date(`${RELEASE}T00:00:00.000Z`), retrieved_at: new Date(), hs6: '841810', at: new Date(`${RELEASE}T00:00:00.000Z`), origin_country: 'IN' });
  const zero = buildSaudiMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: new Date(`${RELEASE}T00:00:00.000Z`), retrieved_at: new Date(), hs6: '120110', at: new Date(`${RELEASE}T00:00:00.000Z`), origin_country: 'IN' });
  const poultry = buildSaudiMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: new Date(`${RELEASE}T00:00:00.000Z`), retrieved_at: new Date(), hs6: '020712', at: new Date(`${RELEASE}T00:00:00.000Z`), origin_country: 'IN' });
  const remedy = buildSaudiMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: new Date(`${RELEASE}T00:00:00.000Z`), retrieved_at: new Date(), hs6: '730300', at: new Date(`${RELEASE}T00:00:00.000Z`), origin_country: 'IN' });

  console.log(JSON.stringify({
    status: 'LOCAL_QUALIFIED_STAGING_PENDING',
    release_identifier: RELEASE,
    acquisition_elapsed_ms: elapsed_ms,
    bundle_bytes: bytes.length,
    bundle_sha256: bundle.checksum,
    bundle_artifacts: bundle.files.length,
    portal_unique_12digit_codes: bundle.portal_lines.size,
    structural_2025_operations: bundle.operations_2025.length,
    structural_2026_operations: bundle.operations_2026.length,
    national_rate_workbook_rows: bundle.protected_rates.size,
    june_2026_rate_rows: bundle.june_rates.length,
    august_2026_rate_rows: bundle.august_rates.length,
    active_remedy_measures: bundle.remedies.measures.length,
    canaries: {
      ordinary_841810: ordinary.lines.find((l) => l.national_tariff_code.startsWith('841810'))?.duty,
      zero_120110: zero.lines.find((l) => l.national_tariff_code === '120110000000')?.duty,
      poultry_minimum_020712: poultry.lines.find((l) => l.national_tariff_code.startsWith('020712'))?.duty,
      india_preference: ordinary.india_preference.applicability,
      remedy_status_730300: remedy.raw_evidence && (remedy.raw_evidence as Record<string, unknown>).remedy_status,
    },
    output: out,
  }, null, 2));
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: 'BLOCKED', error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
