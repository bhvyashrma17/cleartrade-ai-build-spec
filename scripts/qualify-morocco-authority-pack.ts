import { promises as fs } from 'node:fs';
import path from 'node:path';
import { acquireMoroccoAuthorityBundle } from '@/lib/market-access/providers/morocco-acquisition';
import { readMoroccoAuthorityBundle } from '@/lib/market-access/providers/morocco-bundle';
import { buildMoroccoMarketAccess } from '@/lib/market-access/providers/morocco-parser';

const ROOT = path.resolve(process.cwd(), '.artifacts/customs-atlas/morocco');
const RELEASE = '2026-09-23';

async function main() {
  await fs.mkdir(ROOT, { recursive: true });
  const started = Date.now();
  const bytes = await acquireMoroccoAuthorityBundle({ release_identifier: RELEASE });
  const elapsed_ms = Date.now() - started;
  const out = path.join(ROOT, process.env.MA_BUNDLE_NAME ?? 'morocco-authority-bundle.zip');
  await fs.writeFile(out, bytes);

  const bundle = await readMoroccoAuthorityBundle({ bytes, release_identifier: RELEASE });
  const at = new Date(`${RELEASE}T00:00:00.000Z`);
  const build = (hs6: string, origin = 'IN', on = at) => buildMoroccoMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: at, retrieved_at: new Date(), hs6, at: on, origin_country: origin });
  const third = (result: ReturnType<typeof build>) => result.lines.filter(line => line.measure_kind === 'third_country_duty').map(line => [line.national_tariff_code, line.duty.expression, line.declarable]);
  const saffron = build('091020'), wheat = build('100199'), wheatJuly = build('100199', 'IN', new Date('2026-07-15T00:00:00.000Z')), cattle = build('010229'), lamb = build('020442');
  const hotRolled = build('720851'), hotRolledTunisia = build('720851', 'TN'), tubes = build('730661'), tiles = build('690721'), pvcUs = build('390410', 'US'), phones = build('851713');

  console.log(JSON.stringify({
    status: 'LOCAL_QUALIFIED_STAGING_PENDING',
    release_identifier: RELEASE,
    acquisition_elapsed_ms: elapsed_ms,
    bundle_bytes: bytes.length,
    bundle_sha256: bundle.checksum,
    bundle_artifacts: bundle.files.length,
    normalized_sha256: bundle.files.find(file => file.name === 'normalized.json')?.sha256,
    tdi_lines: bundle.schedule_lines.size,
    declarable_on_reference_date: [...bundle.schedule_lines.values()].filter(line => ['same_row', 'wrapped', 'centred'].includes(line.pairing)).length,
    active_remedy_measures: bundle.remedies.measures.length,
    remedy_register_enumeration_complete: bundle.remedies.register_enumeration_complete,
    canaries: {
      saffron_091020_lf2026: third(saffron),
      soft_wheat_100199_suspended: third(wheat),
      soft_wheat_100199_restored_2026_07_15: third(wheatJuly),
      cattle_010229_quota: cattle.lines.filter(line => line.measure_kind === 'tariff_quota').map(line => [line.national_tariff_code, line.duty.expression, line.declarable]),
      lamb_020442_suspended: third(lamb),
      hot_rolled_720851_india_safeguard: hotRolled.lines.filter(line => line.measure_kind === 'additional_duty').map(line => [line.national_tariff_code, line.duty.kind, line.duty.expression]),
      hot_rolled_720851_tunisia_exempt: hotRolledTunisia.lines.some(line => line.measure_kind === 'additional_duty'),
      tubes_730661_india_exempt: tubes.lines.some(line => line.measure_kind === 'additional_duty'),
      tiles_690721_india_investigation_not_duty: tiles.lines.some(line => line.measure_kind === 'additional_duty'),
      pvc_390410_us: pvcUs.lines.filter(line => line.measure_kind === 'additional_duty').map(line => [line.national_tariff_code, line.duty.expression]),
      smartphones_851713: third(phones),
      india_preference: saffron.india_preference.applicability,
      tariff_treatment_complete_hot_rolled: (hotRolled.raw_evidence as Record<string, unknown>).tariff_treatment_complete,
      tariff_treatment_complete_saffron: (saffron.raw_evidence as Record<string, unknown>).tariff_treatment_complete,
    },
    output: out,
  }, null, 2));
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: 'BLOCKED', error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
