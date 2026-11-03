import { promises as fs } from 'node:fs';
import path from 'node:path';
import { acquireKuwaitAuthorityBundle } from '@/lib/market-access/providers/kuwait-acquisition';
import { readKuwaitAuthorityBundle } from '@/lib/market-access/providers/kuwait-bundle';
import { buildKuwaitMarketAccess } from '@/lib/market-access/providers/kuwait-parser';

const ROOT = path.resolve(process.cwd(), '.artifacts/customs-atlas/kuwait');
const RELEASE = '2026-09-23';

async function main() {
  await fs.mkdir(ROOT, { recursive: true });
  const started = Date.now();
  const bytes = await acquireKuwaitAuthorityBundle({ release_identifier: RELEASE });
  const elapsed_ms = Date.now() - started;
  const out = path.join(ROOT, 'kuwait-authority-bundle.zip');
  await fs.writeFile(out, bytes);

  const bundle = await readKuwaitAuthorityBundle({ bytes, release_identifier: RELEASE });

  const steel = buildKuwaitMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: new Date(`${RELEASE}T00:00:00.000Z`), retrieved_at: new Date(), hs6: '721310', at: new Date(`${RELEASE}T00:00:00.000Z`), origin_country: 'IN' });
  const zero = buildKuwaitMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: new Date(`${RELEASE}T00:00:00.000Z`), retrieved_at: new Date(), hs6: '120110', at: new Date(`${RELEASE}T00:00:00.000Z`), origin_country: 'IN' });
  const battery = buildKuwaitMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: new Date(`${RELEASE}T00:00:00.000Z`), retrieved_at: new Date(), hs6: '850710', at: new Date(`${RELEASE}T00:00:00.000Z`), origin_country: 'KR' });

  console.log(JSON.stringify({
    status: 'LOCAL_QUALIFIED_STAGING_PENDING',
    release_identifier: RELEASE,
    acquisition_elapsed_ms: elapsed_ms,
    bundle_bytes: bytes.length,
    bundle_sha256: bundle.checksum,
    bundle_artifacts: bundle.files.length,
    schedule_unique_12digit_codes: bundle.schedule_lines.size,
    active_remedy_measures: bundle.remedies.measures.length,
    remedy_register_enumeration_complete: bundle.remedies.register_enumeration_complete,
    canaries: {
      steel_721310_current_portal_rate: steel.lines.find((l) => l.national_tariff_code.startsWith('721310'))?.duty,
      zero_120110: zero.lines.find((l) => l.national_tariff_code === '120110000000')?.duty,
      india_preference: zero.india_preference.applicability,
      korea_battery_remedy_status: battery.raw_evidence && (battery.raw_evidence as Record<string, unknown>).remedy_status,
    },
    output: out,
  }, null, 2));
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: 'BLOCKED', error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
