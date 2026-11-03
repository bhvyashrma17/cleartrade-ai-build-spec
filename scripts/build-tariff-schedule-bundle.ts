/**
 * D-030 — build a tariff-schedule release bundle from the official files, on any machine, without a
 * database. The files are recognised by their checksums (pinned in `tariff-schedule-sources.ts`), read
 * with the schedule's own readers (`tariff-schedule-readers.ts`), and packed with the lines read from
 * them; the bundle's bytes depend only on the files, so a build on another machine can be compared with
 * the checksum recorded in the ledger. Import it with
 * `import-retained-authority-release.ts --family=<schedule>`.
 *
 *   npx tsx scripts/build-tariff-schedule-bundle.ts --schedule=GCC --file=<IntegratedCustomsTariff.pdf> --file=<Schedule-of-UAE.pdf> --out=<gcc.zip>
 *   npx tsx scripts/build-tariff-schedule-bundle.ts --schedule=MERCOSUR --file=<CAMEX Annexes I–X .xlsx> --out=<mercosur.zip>
 *   npx tsx scripts/build-tariff-schedule-bundle.ts --schedule=BR --file=<CAMEX Annexes I–X .xlsx> --out=<brazil.zip>
 *   npx tsx scripts/build-tariff-schedule-bundle.ts --schedule=CN --file=<CN-2026-import-export-tariff.pdf> --file=<CN-2026-annex1-provisional-import-rates.pdf> --out=<china.zip>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { extractPdfTablePages } from '@/lib/market-access/providers/pdf-table-family';
import { buildTariffScheduleBundle } from '@/lib/market-access/providers/tariff-schedule-bundle';
import {
  parseBrazilCamexWorkbook, parseChinaProvisionalAnnexPages, parseChinaTariffPages, parseGccIntegratedTariffPages, parseUaeCepaSchedulePages,
} from '@/lib/market-access/providers/tariff-schedule-readers';
import {
  assembleBrazilLines, assembleChinaLines, assembleGccLines, assembleMercosurLines, TARIFF_SCHEDULE_SOURCES, type ScheduleLine, type TariffScheduleKey,
} from '@/lib/market-access/providers/tariff-schedule-sources';

const values = (name: string) => process.argv.filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3).trim());
const one = (name: string) => { const found = values(name); if (found.length !== 1) throw new Error(`Give --${name}=... once.`); return found[0]!; };

async function main() {
  const key = one('schedule').toUpperCase() as TariffScheduleKey;
  const source = TARIFF_SCHEDULE_SOURCES[key];
  if (!source) throw new Error(`Unknown --schedule=${key}. Use ${Object.keys(TARIFF_SCHEDULE_SOURCES).join(', ')}.`);
  const files = values('file').map((path) => {
    const bytes = readFileSync(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const pinned = source.release.files.find((file) => file.sha256 === sha256);
    if (!pinned) throw new Error(`${path} (SHA-256 ${sha256}) is not a file of the ${key} release ${source.release.identifier}; expected ${source.release.files.map((file) => `${file.name} ${file.sha256}`).join(', ')}.`);
    return { name: pinned.name, role: pinned.role, bytes };
  });
  const file = (role: string) => { const found = files.find((item) => item.role === role); if (!found) throw new Error(`The ${key} release needs its ${role.replaceAll('_', ' ')} file.`); return found.bytes; };

  let lines: ScheduleLine[];
  let detail: Record<string, unknown> = {};
  if (key === 'GCC') {
    const rows = parseGccIntegratedTariffPages(await extractPdfTablePages(file('official_common_tariff')));
    const cepa = parseUaeCepaSchedulePages(await extractPdfTablePages(file('official_preference_schedule')));
    lines = assembleGccLines(rows, cepa);
    detail = { cepa_rows: cepa.length, lines_without_a_printed_rate: rows.filter((row) => !row.raw_rate).map((row) => `${row.code} (${row.locator})`) };
  } else if (key === 'MERCOSUR' || key === 'BR') {
    const data = await parseBrazilCamexWorkbook(file('official_tariff_workbook'));
    lines = key === 'MERCOSUR' ? assembleMercosurLines(data) : assembleBrazilLines(data);
    detail = { workbook_updated_through: data.updated_through, tec_rows: data.tec.length, annex_ii_rows: data.applied.length, exception_rows: data.exceptions.length };
  } else {
    const rows = parseChinaTariffPages(await extractPdfTablePages(file('official_tariff')));
    const annex = parseChinaProvisionalAnnexPages(await extractPdfTablePages(file('official_provisional_rates')));
    lines = assembleChinaLines(rows, annex);
    detail = { provisional_entries: annex.length, provisional_ex_entries: annex.filter((entry) => entry.ex).length };
  }
  const bytes = await buildTariffScheduleBundle({ source, files: files.map(({ name, bytes: content }) => ({ name, bytes: content })), lines });
  const out = one('out');
  writeFileSync(out, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const kinds = lines.reduce<Record<string, number>>((counts, line) => ({ ...counts, [line.duty.kind]: (counts[line.duty.kind] ?? 0) + 1 }), {});
  console.log(JSON.stringify({
    schedule: key, release_identifier: source.release.identifier, countries: Object.fromEntries(Object.entries(source.countries).map(([code, country]) => [code, country.basis])),
    file: out, bytes: bytes.length, sha256, lines: lines.length, duty_kinds: kinds,
    exceptions: lines.filter((line) => line.exception).length, india_preferences: lines.filter((line) => line.india_preference).length,
    dated_rates: lines.filter((line) => line.dated?.length).length, lines_with_notes: lines.filter((line) => line.notes?.length).length, ...detail,
    import_with: `npx tsx --env-file=<env> scripts/import-retained-authority-release.ts --family=${key} --file=${out} --expect-sha256=${sha256} --release=${source.release.identifier} --reference-date=${source.release.reference_date} --retrieved-at=2026-10-19 --source-url=${source.release.source_url} --actor-email=<ops supervisor or admin> --activate`,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
