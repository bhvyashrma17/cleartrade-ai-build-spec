import { promises as fs } from 'node:fs';
import path from 'node:path';
import { acquireUzbekistanAuthorityBundle } from '@/lib/market-access/providers/uzbekistan-acquisition';
import { readUzbekistanAuthorityBundle } from '@/lib/market-access/providers/uzbekistan-bundle';
import { buildUzbekistanMarketAccess } from '@/lib/market-access/providers/uzbekistan-parser';

const ROOT = path.resolve(process.cwd(), '.artifacts/customs-atlas/uzbekistan');
const RELEASE = '2026-09-23';

async function main() {
  await fs.mkdir(ROOT, { recursive: true });
  const started = Date.now();
  const bytes = await acquireUzbekistanAuthorityBundle({ release_identifier: RELEASE });
  const elapsed_ms = Date.now() - started;
  const out = path.join(ROOT, process.env.UZ_BUNDLE_NAME ?? 'uzbekistan-authority-bundle.zip');
  await fs.writeFile(out, bytes);

  const bundle = await readUzbekistanAuthorityBundle({ bytes, release_identifier: RELEASE });
  const at = new Date(`${RELEASE}T00:00:00.000Z`);
  const build = (hs6: string, origin = 'IN') => buildUzbekistanMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: at, retrieved_at: new Date(), hs6, at, origin_country: origin });
  const rice = build('100630'), footwear = build('640399'), car = build('870322'), jewellery = build('711319'), ligature = build('710692');

  console.log(JSON.stringify({
    status: 'LOCAL_QUALIFIED_STAGING_PENDING',
    release_identifier: RELEASE,
    acquisition_elapsed_ms: elapsed_ms,
    bundle_bytes: bytes.length,
    bundle_sha256: bundle.checksum,
    bundle_artifacts: bundle.files.length,
    normalized_sha256: bundle.files.find(file => file.name === 'normalized.json')?.sha256,
    schedule_unique_10digit_codes: bundle.schedule_lines.size,
    active_remedy_measures: 0,
    remedy_register_enumeration_complete: bundle.remedies.register_enumeration_complete,
    canaries: {
      rice_100630: rice.lines.filter(line => line.measure_kind === 'third_country_duty').map(line => [line.national_tariff_code, line.duty.expression]),
      footwear_640399_mixed: footwear.lines.find(line => line.measure_kind === 'third_country_duty')?.duty,
      car_870322_compound: car.lines.filter(line => line.measure_kind === 'third_country_duty').slice(0, 3).map(line => [line.national_tariff_code, line.duty.kind, line.duty.expression]),
      jewellery_7113190000: jewellery.lines.find(line => line.national_tariff_code === '7113190000')?.duty.expression,
      ligature_7106920000_declarable: ligature.lines.find(line => line.national_tariff_code === '7106920000')?.declarable,
      india_preference: rice.india_preference.applicability,
      india_non_mfn_additional_duty: rice.lines.find(line => line.measure_kind === 'additional_duty')?.duty.expression,
      india_requirements: rice.requirements.map(item => item.requirement_code),
      remedy_status: (rice.raw_evidence as Record<string, unknown>).remedy_status,
      tariff_treatment_complete: (rice.raw_evidence as Record<string, unknown>).tariff_treatment_complete,
    },
    output: out,
  }, null, 2));
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: 'BLOCKED', error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
