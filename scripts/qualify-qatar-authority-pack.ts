import { promises as fs } from 'node:fs';
import path from 'node:path';
import { acquireQatarAuthorityBundle } from '@/lib/market-access/providers/qatar-acquisition';
import { readQatarAuthorityBundle } from '@/lib/market-access/providers/qatar-bundle';
import { buildQatarMarketAccess } from '@/lib/market-access/providers/qatar-parser';

const ROOT = path.resolve(process.cwd(), '.artifacts/customs-atlas/qatar');
const RELEASE = '2026-09-23';

async function main() {
  await fs.mkdir(ROOT, { recursive: true });
  const started = Date.now();
  const bytes = await acquireQatarAuthorityBundle({ release_identifier: RELEASE });
  const elapsed_ms = Date.now() - started;
  const out = path.join(ROOT, 'qatar-authority-bundle.zip');
  await fs.writeFile(out, bytes);

  const bundle = await readQatarAuthorityBundle({ bytes, release_identifier: RELEASE });

  const ordinary = buildQatarMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: new Date(`${RELEASE}T00:00:00.000Z`), retrieved_at: new Date(), hs6: '850710', at: new Date(`${RELEASE}T00:00:00.000Z`), origin_country: 'IN' });
  const zero = buildQatarMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: new Date(`${RELEASE}T00:00:00.000Z`), retrieved_at: new Date(), hs6: '120110', at: new Date(`${RELEASE}T00:00:00.000Z`), origin_country: 'IN' });
  const wiring = buildQatarMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: new Date(`${RELEASE}T00:00:00.000Z`), retrieved_at: new Date(), hs6: '853650', at: new Date(`${RELEASE}T00:00:00.000Z`), origin_country: 'CN' });

  console.log(JSON.stringify({
    status: 'LOCAL_QUALIFIED_STAGING_PENDING',
    release_identifier: RELEASE,
    acquisition_elapsed_ms: elapsed_ms,
    bundle_bytes: bytes.length,
    bundle_sha256: bundle.checksum,
    bundle_artifacts: bundle.files.length,
    schedule_unique_12digit_codes: bundle.schedule_lines.size,
    decree_63_2025_operations: bundle.operations_2025.length,
    decree_31_2026_tables_machine_available: bundle.decree_31_2026.tables_machine_available,
    active_remedy_measures: bundle.remedies.measures.length,
    remedy_register_enumeration_complete: bundle.remedies.register_enumeration_complete,
    canaries: {
      ordinary_battery_850710: ordinary.lines.find((l) => l.national_tariff_code.startsWith('850710'))?.duty,
      zero_120110: zero.lines.find((l) => l.national_tariff_code === '120110000000')?.duty,
      india_preference: ordinary.india_preference.applicability,
      wiring_remedy_status_cn: wiring.raw_evidence && (wiring.raw_evidence as Record<string, unknown>).remedy_status,
    },
    output: out,
  }, null, 2));
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: 'BLOCKED', error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
