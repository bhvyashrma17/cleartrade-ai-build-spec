import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import { INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST, validateIndonesiaRemedyManifest, type IndonesiaTradeRemedyManifest } from './indonesia-remedies';
import { INDONESIA_EXPECTED_AIFTA_CODES, INDONESIA_EXPECTED_AIFTA_SCHEDULE_ENTRIES, INDONESIA_EXPECTED_MFN_ROWS, parseIndonesiaAiftaPdf, parseIndonesiaMfnPdfs } from './indonesia-parser';

export const INDONESIA_ACQUISITION_VERSION = 'id-official-government-mirror-btki-aifta-remedies-v1' as const;
export const INDONESIA_BUNDLE_READER_VERSION = 'id-btki-legal-chain-bundle-reader-v1' as const;
export const INDONESIA_RIGHTS_STATUS = 'STATUTORY_FACTS_AND_LEGAL_INSTRUMENTS_REUSE_CLEARED' as const;

export interface IndonesiaTariffLine { code: string; description: string; duty: ParsedDuty; raw_duty: string; source_pages: readonly number[]; variant_count?: number }
export interface IndonesiaBundleArtifact { name: string; role: string; url: string; issuing_authority: string; publication_repository: string; instrument_number: string; instrument_title: string; publication_date: string; effective_from: string; bytes: Buffer }
export interface IndonesiaAmendmentOperation { instrument: string; effective_from: string; precedence: number; operation: 'REPLACE' | 'ADD' | 'DELETE' | 'CORRECTION' | 'AMEND_APPLICABILITY'; source_artifact: string; note: string }

interface Manifest {
  acquisition_version: string; release_identifier: string; source_url: string; reference_date: string; rights_status: string;
  mfn_row_count: number; aifta_unique_code_count: number; aifta_schedule_entry_count: number;
  files: Array<Omit<IndonesiaBundleArtifact, 'bytes'> & { size_bytes: number; sha256: string }>;
  amendment_operations: IndonesiaAmendmentOperation[];
  rights: Record<string, unknown>;
}

export interface IndonesiaAuthorityBundle {
  checksum: string; size_bytes: number; release_identifier: string; source_url: string;
  mfn: ReadonlyMap<string, IndonesiaTariffLine>; aifta: ReadonlyMap<string, IndonesiaTariffLine>; aifta_schedule_entries: number;
  remedies: IndonesiaTradeRemedyManifest; files: Manifest['files']; amendment_operations: readonly IndonesiaAmendmentOperation[];
  rights: Record<string, unknown>; reader_version: typeof INDONESIA_BUNDLE_READER_VERSION;
}

export class IndonesiaBundleError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'IndonesiaBundleError'; } }
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const sortedLines = (lines: ReadonlyMap<string, IndonesiaTariffLine>) => [...lines.values()].sort((a, b) => a.code.localeCompare(b.code));

export const INDONESIA_AMENDMENT_CHAIN: readonly IndonesiaAmendmentOperation[] = Object.freeze([
  { instrument: 'PMK 26/PMK.010/2022', effective_from: '2022-04-01', precedence: 0, operation: 'ADD', source_artifact: '26_PMK.010_2022.pdf', note: 'Controlling HS 2022/AHTN 2022 baseline.' },
  { instrument: 'PMK 10/2024', effective_from: '2024-02-15', precedence: 1, operation: 'AMEND_APPLICABILITY', source_artifact: '2024pmkeuangan010.pdf', note: 'Temporary battery-electric-vehicle Chapter 98 facility; it expired on 31 December 2025 and does not alter the current ordinary MFN row.' },
  { instrument: 'PMK 62/2025', effective_from: '2025-09-15', precedence: 2, operation: 'REPLACE', source_artifact: '2025pmkeuangan062.pdf', note: 'Second amendment; replacement schedule state is applied before PMK 50/2026.' },
  { instrument: 'PMK 50/2026', effective_from: '2026-07-28', precedence: 3, operation: 'REPLACE', source_artifact: '2026pmkeuangan050.pdf', note: 'Third amendment Annex II is a complete numbered current snapshot. Diff against the baseline is retained as ADD/DELETE/REPLACE/CORRECTION operations.' },
]);

export async function buildIndonesiaAuthorityBundle(args: { release_identifier: string; source_url: string; artifacts: readonly IndonesiaBundleArtifact[]; remedies?: IndonesiaTradeRemedyManifest }) {
  const byName = new Map(args.artifacts.map((artifact) => [artifact.name, artifact]));
  const required = ['26_PMK.010_2022.pdf','2024pmkeuangan010.pdf','2025pmkeuangan062.pdf','2026pmkeuangan050.pdf','47_PMK.010_2022.pdf','92_PMK.010_2022.pdf','2023pmkeuangan035.pdf'];
  for (const name of required) if (!byName.has(name)) throw new IndonesiaBundleError('missing_artifact', `Indonesia acquisition is missing ${name}.`);
  const parsed = await parseIndonesiaMfnPdfs(byName.get('26_PMK.010_2022.pdf')!.bytes, byName.get('2025pmkeuangan062.pdf')!.bytes, byName.get('2026pmkeuangan050.pdf')!.bytes);
  const aifta = await parseIndonesiaAiftaPdf(byName.get('47_PMK.010_2022.pdf')!.bytes);
  const remedies = validateIndonesiaRemedyManifest(args.remedies ?? INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST);
  for (const remedy of remedies.remedies) {
    const artifact = byName.get(remedy.artifact_name);
    if (!artifact || sha256(artifact.bytes) !== remedy.artifact_sha256) throw new IndonesiaBundleError('remedy_artifact_mismatch', `${remedy.instrument} is absent or does not match its reviewed SHA-256.`);
  }
  const generated = [
    { name:'normalized-mfn.json',role:'deterministic_current_mfn_replay',url:args.source_url,issuing_authority:'Kementerian Keuangan Republik Indonesia',publication_repository:'ClearTrade derived artifact',instrument_number:'PMK 26/2022 chain through PMK 50/2026',instrument_title:'Current normalized MFN schedule',publication_date:'2026-07-21',effective_from:'2026-07-28',bytes:json(sortedLines(parsed.current)) },
    { name:'normalized-aifta.json',role:'deterministic_aifta_replay',url:args.source_url,issuing_authority:'Kementerian Keuangan Republik Indonesia',publication_repository:'ClearTrade derived artifact',instrument_number:'PMK 47/2022 as amended by PMK 92/2022',instrument_title:'Current normalized AIFTA schedule',publication_date:'2022-06-22',effective_from:'2022-07-06',bytes:json(sortedLines(aifta.lines)) },
    { name:'active-trade-remedies.json',role:'complete_active_remedy_manifest_as_of_2026-09-21',url:args.source_url,issuing_authority:'Kementerian Keuangan Republik Indonesia',publication_repository:'ClearTrade derived artifact',instrument_number:'24 active PMK measures',instrument_title:'Anti-dumping and safeguard manifest',publication_date:'2026-09-21',effective_from:'2026-09-21',bytes:json(remedies) },
    { name:'mfn-amendment-diff.json',role:'ordered_add_delete_replace_correction_replay',url:args.source_url,issuing_authority:'Kementerian Keuangan Republik Indonesia',publication_repository:'ClearTrade derived artifact',instrument_number:'PMK 26/2022 through PMK 50/2026',instrument_title:'Typed MFN amendment diff',publication_date:'2026-07-21',effective_from:'2026-07-28',bytes:json(parsed.operations) },
  ] satisfies IndonesiaBundleArtifact[];
  const all = [...args.artifacts, ...generated];
  const files = all.map(({ bytes, ...item }) => ({ ...item, size_bytes: bytes.length, sha256: sha256(bytes) }));
  const rights = { statute: 'Undang-Undang Nomor 28 Tahun 2014 tentang Hak Cipta', articles: [41,42], conclusion: 'Official tariff facts/data and laws/regulations may be normalized and retained.', exclusions: ['BPK/JDIH site design','database arrangement','software','logos','third-party or WCO expression'] };
  const manifest: Manifest = { acquisition_version: INDONESIA_ACQUISITION_VERSION, release_identifier: args.release_identifier.trim(), source_url: args.source_url, reference_date:'2026-09-21', rights_status:INDONESIA_RIGHTS_STATUS,
    mfn_row_count:parsed.current.size,aifta_unique_code_count:aifta.lines.size,aifta_schedule_entry_count:aifta.schedule_entries,files,amendment_operations:[...INDONESIA_AMENDMENT_CHAIN],rights };
  const zip = new JSZip(); const options = { date:new Date('1980-01-01T00:00:00.000Z'),createFolders:false } as const;
  for (const artifact of all) zip.file(artifact.name, artifact.bytes, options);
  zip.file('acquisition.json', json(manifest), options);
  return Buffer.from(await zip.generateAsync({ type:'nodebuffer',compression:'DEFLATE',compressionOptions:{ level:9 },platform:'UNIX' }));
}

export async function readIndonesiaAuthorityBundle(args: { bytes: Buffer; release_identifier: string }): Promise<IndonesiaAuthorityBundle> {
  let zip: JSZip; try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new IndonesiaBundleError('corrupt_archive','Indonesia authority bundle is not a ZIP archive.'); }
  const manifestFile = zip.file('acquisition.json'); if (!manifestFile) throw new IndonesiaBundleError('missing_manifest','Indonesia authority bundle has no acquisition.json.');
  const manifest = JSON.parse(await manifestFile.async('text')) as Manifest;
  if (manifest.acquisition_version !== INDONESIA_ACQUISITION_VERSION || manifest.release_identifier !== args.release_identifier || manifest.reference_date !== '2026-09-21' || manifest.rights_status !== INDONESIA_RIGHTS_STATUS) throw new IndonesiaBundleError('unexpected_manifest','Indonesia bundle identity, reference date or rights basis changed.');
  for (const file of manifest.files) { const entry=zip.file(file.name); if(!entry) throw new IndonesiaBundleError('missing_artifact',`Indonesia bundle is missing ${file.name}.`); const bytes=Buffer.from(await entry.async('nodebuffer')); if(bytes.length!==file.size_bytes||sha256(bytes)!==file.sha256) throw new IndonesiaBundleError('artifact_hash_mismatch',`${file.name} failed checksum validation.`); }
  const mfnRows=JSON.parse(await zip.file('normalized-mfn.json')!.async('text')) as IndonesiaTariffLine[];
  const aiftaRows=JSON.parse(await zip.file('normalized-aifta.json')!.async('text')) as IndonesiaTariffLine[];
  const mfn=new Map(mfnRows.map((line)=>[line.code,line])); const aifta=new Map(aiftaRows.map((line)=>[line.code,line]));
  if(mfn.size!==INDONESIA_EXPECTED_MFN_ROWS||aifta.size!==INDONESIA_EXPECTED_AIFTA_CODES||manifest.aifta_schedule_entry_count!==INDONESIA_EXPECTED_AIFTA_SCHEDULE_ENTRIES) throw new IndonesiaBundleError('row_count_changed','Indonesia normalized row totals changed.');
  const remedies=validateIndonesiaRemedyManifest(JSON.parse(await zip.file('active-trade-remedies.json')!.async('text')) as IndonesiaTradeRemedyManifest);
  return { checksum:sha256(args.bytes),size_bytes:args.bytes.length,release_identifier:args.release_identifier,source_url:manifest.source_url,mfn,aifta,aifta_schedule_entries:manifest.aifta_schedule_entry_count,remedies,files:manifest.files,amendment_operations:manifest.amendment_operations,rights:manifest.rights,reader_version:INDONESIA_BUNDLE_READER_VERSION };
}

export function readIndonesiaAuthorityRelease(args: Parameters<typeof readIndonesiaAuthorityBundle>[0] & { reader_version: string }) {
  if(args.reader_version!==INDONESIA_BUNDLE_READER_VERSION) throw new IndonesiaBundleError('unsupported_reader_version',`Unsupported Indonesia bundle reader ${args.reader_version}.`);
  return readIndonesiaAuthorityBundle(args);
}
