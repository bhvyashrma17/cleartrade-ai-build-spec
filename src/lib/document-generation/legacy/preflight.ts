/**
 * PDF glyph preflight.
 *
 * `pdf-lib`'s standard fonts are WinAnsi (CP1252) encoded. A character outside that set has no
 * glyph, and `drawText` throws — so Phase 6's renderer substituted `?` to keep generation
 * working. That is acceptable for a draft an agent is eyeballing. It is not acceptable for a
 * document somebody approves and a bank reads: a buyer whose legal name is written in CJK or
 * Devanagari would appear on an approved commercial invoice as a row of question marks, and
 * nothing downstream would know.
 *
 * So the substitution stays for drafts, clearly warned, and the final path fails closed. This
 * module is the detector: given the document model that is about to be drawn, it reports every
 * value carrying characters the PDF font cannot represent, with the label the reader would see.
 *
 * DOCX and HTML are UTF-8 and have no such limit. They are deliberately not gated by this.
 */

import type { Block, Cell, DocumentModel } from './model';

/**
 * The WinAnsi (CP1252) repertoire above Latin-1, as code points.
 *
 * Written out rather than approximated by a range test, because the obvious approximation is
 * wrong in both directions: accepting U+0080 to U+009F is wrong (CP1252 maps that byte range
 * to entirely different characters, and pdf-lib rejects the raw code points), while rejecting
 * everything above U+00FF wrongly excludes the curly quotes, dashes and euro sign at U+2018,
 * U+2019, U+201C, U+201D, U+2013, U+2014 and U+20AC that CP1252 does encode — and those appear
 * in ordinary English company names.
 */
const CP1252_HIGH = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function isPdfRenderable(char: string): boolean {
  const code = char.codePointAt(0)!;
  // Tab and the newlines the renderer normalises away itself.
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  // Printable ASCII.
  if (code >= 0x20 && code <= 0x7e) return true;
  // Latin-1 supplement, skipping the unassigned C1 control block below U+00A0.
  if (code >= 0xa0 && code <= 0xff) return true;
  return CP1252_HIGH.has(code);
}

/** Every character in `value` the PDF font cannot represent, de-duplicated and in order. */
export function unrenderableCharacters(value: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const char of value) {
    if (isPdfRenderable(char) || seen.has(char)) continue;
    seen.add(char);
    found.push(char);
  }
  return found;
}

export interface GlyphIssue {
  /** What the reader would see this value labelled as, e.g. "Buyer / Consignee line 1". */
  label: string;
  /** The offending value, truncated. Shown only through authorised UI, never in audit. */
  sample: string;
  /** The specific characters that cannot be drawn. */
  characters: string[];
  /** e.g. `U+682A` — safe for an audit payload, unlike the sample. */
  code_points: string[];
}

const codePoint = (char: string) =>
  `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

function inspect(label: string, value: Cell, into: GlyphIssue[]) {
  if (value === null) return;
  const characters = unrenderableCharacters(value);
  if (characters.length === 0) return;
  into.push({
    label,
    sample: value.length > 80 ? `${value.slice(0, 77)}…` : value,
    characters,
    code_points: characters.map(codePoint),
  });
}

function inspectBlock(block: Block, into: GlyphIssue[]) {
  switch (block.kind) {
    case 'parties':
      for (const side of [block.left, block.right]) {
        side.lines.forEach((line, i) => inspect(`${side.heading} line ${i + 1}`, line, into));
      }
      return;
    case 'key_values':
      for (const row of block.rows) inspect(row.label, row.value, into);
      return;
    case 'table':
      block.rows.forEach((row, rowIndex) => {
        row.forEach((cell, columnIndex) => {
          inspect(
            `${block.title ?? 'Table'} row ${rowIndex + 1} · ${block.columns[columnIndex]?.header ?? ''}`,
            cell, into,
          );
        });
      });
      for (const total of block.totals ?? []) inspect(total.label, total.value, into);
      return;
    case 'note':
      block.paragraphs.forEach((paragraph, i) =>
        inspect(`${block.title ?? 'Note'} paragraph ${i + 1}`, paragraph, into));
      return;
    case 'signature':
      inspect('Signature', block.forParty, into);
      return;
  }
}

/**
 * Every value in this document that the PDF renderer cannot draw faithfully.
 *
 * Runs over the MODEL rather than the raw context on purpose: the model is exactly what gets
 * drawn, so a context field the adapter never renders cannot produce a false blocker, and a
 * field it does render cannot slip past.
 */
export function preflightPdfGlyphs(model: DocumentModel): GlyphIssue[] {
  const issues: GlyphIssue[] = [];
  inspect('Title', model.title, issues);
  for (const row of model.reference) inspect(row.label, row.value, issues);
  for (const block of model.blocks) inspectBlock(block, issues);
  return issues;
}

/** Thrown when a final (non-draft) PDF would contain characters the font cannot represent. */
export class UnrenderableTextError extends Error {
  readonly issues: GlyphIssue[];
  constructor(issues: GlyphIssue[]) {
    const labels = issues.slice(0, 3).map((i) => i.label).join(', ');
    super(
      `This PDF cannot be finalised: ${issues.length} value${issues.length === 1 ? '' : 's'} ` +
      `(${labels}${issues.length > 3 ? ', and others' : ''}) contain characters the PDF font ` +
      'cannot render faithfully. Generate DOCX instead, or transliterate the affected values ' +
      'in the canonical record.',
    );
    this.name = 'UnrenderableTextError';
    this.issues = issues;
  }
}
