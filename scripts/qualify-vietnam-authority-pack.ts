import { promises as fs } from 'node:fs';
import path from 'node:path';
import { acquireVietnamAuthorityBundle } from '@/lib/market-access/providers/vietnam-acquisition';
import { readVietnamAuthorityBundle } from '@/lib/market-access/providers/vietnam-bundle';
import { buildVietnamMarketAccess } from '@/lib/market-access/providers/vietnam-parser';

const ROOT = path.resolve(process.cwd(), '.artifacts/customs-atlas/vietnam');
const RELEASE = '2026-09-23';

async function main() {
  await fs.mkdir(ROOT, { recursive: true });
  const started = Date.now();
  const bytes = await acquireVietnamAuthorityBundle({ release_identifier: RELEASE });
  const elapsed_ms = Date.now() - started;
  const out = path.join(ROOT, process.env.VN_BUNDLE_NAME ?? 'vietnam-authority-bundle.zip');
  await fs.writeFile(out, bytes);

  const bundle = await readVietnamAuthorityBundle({ bytes, release_identifier: RELEASE });
  const at = new Date(`${RELEASE}T00:00:00.000Z`);
  const build = (hs6: string, origin = 'IN', on = at) => buildVietnamMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: at, retrieved_at: new Date(), hs6, at: on, origin_country: origin });
  const third = (result: ReturnType<typeof build>) => result.lines.filter(line => line.measure_kind === 'third_country_duty').map(line => [line.national_tariff_code, line.duty.expression, line.declarable]);
  const tiles = build('690721'), sorbitol = build('290544'), yarn = build('540233'), fuel = build('271019'), fuelAfter = build('271019', 'IN', new Date('2026-10-01T00:00:00.000Z'));
  const eggs = build('040721'), vape = build('240412'), cars = build('870322'), rice = build('100630'), sugarTh = build('170199', 'TH');

  console.log(JSON.stringify({
    status: 'LOCAL_QUALIFIED_STAGING_PENDING',
    release_identifier: RELEASE,
    acquisition_elapsed_ms: elapsed_ms,
    bundle_bytes: bytes.length,
    bundle_sha256: bundle.checksum,
    bundle_artifacts: bundle.files.length,
    normalized_sha256: bundle.files.find(file => file.name === 'normalized.json')?.sha256,
    section_i_lines: bundle.schedule_lines.size,
    aifta_entries: bundle.aifta.size,
    chapter98_entries: bundle.chapter98.length,
    active_remedy_measures: bundle.remedies.measures.length,
    remedy_register_enumeration_complete: bundle.remedies.register_enumeration_complete,
    canaries: {
      tiles_690721_remedy: tiles.lines.filter(line => line.measure_kind === 'additional_duty').map(line => [line.national_tariff_code, line.duty.kind, line.duty.expression]),
      tiles_india_preference: [tiles.india_preference.applicability, tiles.india_preference.duty?.expression ?? null],
      tiles_requirements: tiles.requirements.map(item => item.requirement_code),
      sorbitol_290544_origin_wide: sorbitol.lines.filter(line => line.measure_kind === 'additional_duty').map(line => [line.duty.kind, line.duty.expression]),
      yarn_540233_remedy: yarn.lines.filter(line => line.measure_kind === 'additional_duty').map(line => [line.national_tariff_code, line.duty.kind]),
      fuel_271019_2026_09_23: third(fuel).slice(0, 6),
      fuel_271019_2026_10_01: third(fuelAfter).slice(0, 6),
      eggs_040721_quota: eggs.lines.map(line => [line.measure_kind, line.duty.expression, line.declarable]),
      vape_240412_conditional: [third(vape), vape.requirements.map(item => item.requirement_code)],
      cars_870322_lines: cars.lines.map(line => line.measure_kind).filter((kind, index, all) => all.indexOf(kind) === index),
      rice_100630: [third(rice), rice.india_preference.applicability, rice.india_preference.duty?.expression ?? null],
      sugar_170199_thailand: sugarTh.lines.filter(line => line.measure_kind === 'additional_duty').map(line => line.duty.expression),
      tariff_treatment_complete_tiles: (tiles.raw_evidence as Record<string, unknown>).tariff_treatment_complete,
      tariff_treatment_complete_rice: (rice.raw_evidence as Record<string, unknown>).tariff_treatment_complete,
    },
    output: out,
  }, null, 2));
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: 'BLOCKED', error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
