import { promises as fs } from 'node:fs';
import path from 'node:path';
import { acquireTunisiaAuthorityBundle } from '@/lib/market-access/providers/tunisia-acquisition';
import { readTunisiaAuthorityBundle } from '@/lib/market-access/providers/tunisia-bundle';
import { buildTunisiaMarketAccess } from '@/lib/market-access/providers/tunisia-parser';

const ROOT = path.resolve(process.cwd(), '.artifacts/customs-atlas/tunisia');
const RELEASE = '2026-09-24';
const LINE_PAGE = /\/tarifwebnew\/getresultat\.php\?choix=&chap=&sel=(\d{11})$/;

/**
 * A run-scoped cache of Tarifweb line pages (under .artifacts, never committed), so a run interrupted by the
 * host sleeping resumes instead of refetching 17,541 pages. Each run uses its own directory, keeping the two
 * determinism runs independent; every page is still hashed into the bundle manifest.
 */
function resumableFetch(dir: string): typeof fetch {
  return async (input, init) => {
    const code = LINE_PAGE.exec(String(input))?.[1];
    if (!code) return fetch(input, init);
    const file = path.join(dir, `${code}.html`);
    const cached = await fs.readFile(file).catch(() => null);
    if (cached) return new Response(cached, { headers: { 'content-type': 'text/html; charset=UTF-8' } });
    const response = await fetch(input, init);
    if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') ?? '')) return response;
    const bytes = Buffer.from(await response.arrayBuffer());
    // Only a page that names its own code is kept; error pages are never cached.
    if (bytes.includes(Buffer.from(`N° de la nomenclature: ${code}`))) await fs.writeFile(file, bytes);
    return new Response(bytes, { status: response.status, headers: response.headers });
  };
}

async function main() {
  // www.douane.gov.tn omits its TLS intermediate; the verified Sectigo DV R36 intermediate must be supplied (operational note), never skipped.
  if (!process.env.NODE_EXTRA_CA_CERTS) throw new Error('Set NODE_EXTRA_CA_CERTS to the verified "Sectigo Public Server Authentication CA DV R36" intermediate before acquiring from www.douane.gov.tn.');
  await fs.mkdir(ROOT, { recursive: true });
  const cache = path.join(ROOT, `line-cache-${process.env.TN_RUN_ID ?? 'default'}`);
  await fs.mkdir(cache, { recursive: true });
  const started = Date.now();
  const bytes = await acquireTunisiaAuthorityBundle({ release_identifier: RELEASE, fetch_impl: resumableFetch(cache), line_concurrency: 5, on_progress: (done, total) => { if (done % 1000 === 0 || done === total) console.error(`lines ${done}/${total}`); } });
  const elapsed_ms = Date.now() - started;
  const out = path.join(ROOT, process.env.TN_BUNDLE_NAME ?? 'tunisia-authority-bundle.zip');
  await fs.writeFile(out, bytes);

  const bundle = await readTunisiaAuthorityBundle({ bytes, release_identifier: RELEASE });
  const at = new Date(`${RELEASE}T00:00:00.000Z`);
  const build = (hs6: string, origin = 'IN', on = at) => buildTunisiaMarketAccess({ bundle, release_id: 'qualify-run', release_reference_date: at, retrieved_at: new Date(), hs6, at: on, origin_country: origin });
  const kind = (result: ReturnType<typeof build>, measure: string) => result.lines.filter(line => line.measure_kind === measure).map(line => [line.national_tariff_code, line.duty.kind, line.duty.expression, line.declarable]);
  const third = (result: ReturnType<typeof build>) => kind(result, 'third_country_duty');
  const requirement = (result: ReturnType<typeof build>, code: string) => result.requirements.filter(entry => entry.requirement_code === code).map(entry => [entry.national_tariff_code, entry.effective_to?.toISOString().slice(0, 10) ?? null]);
  const frames = build('900311'), hybrids = build('870220'), chargers = build('850440'), wire = build('721710'), wireAfter = build('721710', 'IN', new Date('2026-12-01T00:00:00.000Z'));
  const chargers2029 = build('850440', 'IN', new Date('2029-01-01T00:00:00.000Z')), crude = build('270900'), cheese = build('040690'), alcohol = build('220830'), machines = build('847130'), before = build('900311', 'IN', new Date('2025-12-31T00:00:00.000Z'));
  const components = (result: ReturnType<typeof build>, code: string) => ((result.lines.find(line => line.national_tariff_code === code)?.conditions as { other_import_components?: { code: string; parsed: { kind: string; expression: string; specific_currency: string | null } }[] })?.other_import_components ?? []).map(entry => [entry.code, entry.parsed.kind, entry.parsed.expression]);
  const manifest = JSON.parse(await (await (await import('jszip')).default.loadAsync(bytes)).file('acquisition.json')!.async('string'));

  console.log(JSON.stringify({
    status: 'LOCAL_QUALIFIED_STAGING_PENDING',
    release_identifier: RELEASE,
    acquisition_elapsed_ms: elapsed_ms,
    bundle_bytes: bytes.length,
    bundle_sha256: bundle.checksum,
    bundle_artifacts: bundle.files.length,
    normalized_sha256: bundle.files.find(file => file.name === 'normalized.json')?.sha256,
    tarifweb_lines: bundle.schedule_lines.size,
    declarable_lines: [...bundle.schedule_lines.values()].filter(line => line.customs_duty.length === 1).length,
    preference_tables: bundle.preference_tables.size,
    remedy_register_enumeration_complete: bundle.remedies.register_enumeration_complete,
    currentness: manifest.currentness_evidence,
    canaries: {
      conventional_rate_profile: manifest.currentness_evidence.canaries,
      frames_900311_lf2026_art72: third(frames),
      plug_in_hybrids_870220_lf2026_art47_3: third(hybrids).slice(0, 6),
      ev_chargers_850440_art47_4_overlay: kind(chargers, 'other'),
      ev_chargers_850440_general: third(chargers),
      ev_chargers_overlay_after_2028: kind(chargers2029, 'other').length,
      legal_zero_847130: third(machines).slice(0, 3),
      blank_not_zero_270900: third(crude).filter(line => line[0] === '27090090967'),
      specific_components_220830: components(alcohol, alcohol.lines[0]?.national_tariff_code ?? '').filter(entry => entry[1] === 'specific'),
      cheese_040690_trq: kind(cheese, 'tariff_quota').slice(0, 2),
      steel_wire_721710_safeguard_quota: requirement(wire, 'TN_SAFEGUARD_QUOTA'),
      steel_wire_721710_after_expiry: requirement(wireAfter, 'TN_SAFEGUARD_QUOTA'),
      steel_wire_additional_duty_lines: wire.lines.filter(line => line.measure_kind === 'additional_duty').length,
      before_base_2025_lines: before.lines.length,
      india_preference: frames.india_preference.applicability,
      tariff_treatment_complete_frames: (frames.raw_evidence as Record<string, unknown>).tariff_treatment_complete,
      tariff_treatment_complete_cheese: (cheese.raw_evidence as Record<string, unknown>).tariff_treatment_complete,
    },
    output: out,
  }, null, 2));
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: 'BLOCKED', error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
