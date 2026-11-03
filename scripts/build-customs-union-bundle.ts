/**
 * D-028 — build a customs-union release bundle from the official files, on any machine, without a
 * database. The files are recognised by their checksums (pinned in `customs-union-sources.ts`), read
 * with the union's own reader, and packed with the lines read from them; the bundle's bytes depend
 * only on the files, so two builds can be compared. Import it with
 * `import-retained-authority-release.ts --family=<union>`.
 *
 *   npx tsx scripts/build-customs-union-bundle.ts --union=ECOWAS --file=<UEMOA_TEC2022_V4.pdf> --out=<ecowas.zip>
 *   npx tsx scripts/build-customs-union-bundle.ts --union=EAC --file=<CET 2022 updated June 2025.pdf> --file=<EAC Gazette 30 June 2026.pdf> --out=<eac.zip>
 *   npx tsx scripts/build-customs-union-bundle.ts --union=EAEU --file=<adilet H21EV000080 JSON> --out=<eaeu.zip>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildCustomsUnionBundle } from '@/lib/market-access/providers/customs-union-bundle';
import { parseEacCetPages, parseEacGazettePages, parseEaeuCctHtml, parseUemoaTecPages } from '@/lib/market-access/providers/customs-union-parsers';
import { assembleEacLines, assembleEaeuLines, assembleEcowasLines, CUSTOMS_UNION_SOURCES, type CustomsUnionKey, type CustomsUnionLine } from '@/lib/market-access/providers/customs-union-sources';
import { extractPdfTablePages } from '@/lib/market-access/providers/pdf-table-family';

const values = (name: string) => process.argv.filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3).trim());
const one = (name: string) => { const found = values(name); if (found.length !== 1) throw new Error(`Give --${name}=... once.`); return found[0]!; };

async function main() {
  const union = one('union').toUpperCase() as CustomsUnionKey;
  const source = CUSTOMS_UNION_SOURCES[union];
  if (!source) throw new Error(`Unknown --union=${union}. Use EAEU, ECOWAS or EAC.`);
  const files = values('file').map((path) => {
    const bytes = readFileSync(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const pinned = source.release.files.find((file) => file.sha256 === sha256);
    if (!pinned) throw new Error(`${path} (SHA-256 ${sha256}) is not a file of the ${union} release ${source.release.identifier}; expected ${source.release.files.map((file) => `${file.name} ${file.sha256}`).join(', ')}.`);
    return { name: pinned.name, role: pinned.role, bytes };
  });
  const file = (role: string) => { const found = files.find((item) => item.role === role); if (!found) throw new Error(`The ${union} release needs its ${role.replaceAll('_', ' ')} file.`); return found.bytes; };

  let lines: CustomsUnionLine[];
  let detail: Record<string, unknown> = {};
  if (union === 'ECOWAS') {
    const parsed = parseUemoaTecPages(await extractPdfTablePages(file('official_common_external_tariff')));
    lines = assembleEcowasLines(parsed.lines);
    detail = { tariff_pages: parsed.data_pages };
  } else if (union === 'EAC') {
    const cet = parseEacCetPages(await extractPdfTablePages(file('official_common_external_tariff')));
    const measures = parseEacGazettePages(await extractPdfTablePages(file('official_gazette_yearly_measures')), 'EAC/160/2026');
    const known = new Set(cet.schedule_1.map((line) => line.code));
    const strays = measures.amendments.filter((item) => !known.has(item.code));
    if (!measures.amendments.length || strays.length) throw new Error(`The Gazette amendment table was not read cleanly (${measures.amendments.length} rows; not in Schedule 1: ${strays.map((item) => item.code).join(', ') || 'none'}).`);
    lines = assembleEacLines(cet.schedule_1, cet.schedule_2, measures);
    detail = { schedule_1: cet.schedule_1.length, schedule_2: cet.schedule_2.length, amendments: measures.amendments.map((item) => `${item.code}: ${item.raw_rate}`), stay_codes: new Set(measures.stays.map((item) => item.code)).size };
  } else {
    const json = JSON.parse(file('official_consolidated_legal_text').toString('utf8')) as { document?: { text_content?: string } };
    if (!json.document?.text_content) throw new Error('The EAEU file has no document.text_content.');
    lines = assembleEaeuLines(parseEaeuCctHtml(json.document.text_content));
  }
  const bytes = await buildCustomsUnionBundle({ source, files: files.map(({ name, bytes: content }) => ({ name, bytes: content })), lines });
  const out = one('out');
  writeFileSync(out, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const kinds = lines.reduce<Record<string, number>>((counts, line) => ({ ...counts, [line.duty.kind]: (counts[line.duty.kind] ?? 0) + 1 }), {});
  console.log(JSON.stringify({
    union, release_identifier: source.release.identifier, members: source.members, file: out, bytes: bytes.length, sha256,
    lines: lines.length, duty_kinds: kinds, exceptions: lines.filter((line) => line.exception).length, ...detail,
    import_with: `npx tsx --env-file=<env> scripts/import-retained-authority-release.ts --family=${union} --file=${out} --expect-sha256=${sha256} --release=${source.release.identifier} --reference-date=${source.release.reference_date} --retrieved-at=2026-10-18 --source-url=${source.release.source_url} --actor-email=<ops supervisor or admin> --activate`,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
