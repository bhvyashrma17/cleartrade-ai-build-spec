/**
 * The intermediate document model every format renders.
 *
 * The legacy project had three parallel implementations per document — an HTML template, a
 * pdf-lib generator and a docx generator — each independently deciding which fields to show
 * and in what order. They had already drifted: the HTML invoice printed an exchange-rate
 * reference and a PO number that the PDF did not, and the PDF derived the exchange rate by
 * dividing the INR total by the foreign total rather than using the recorded rate.
 *
 * Here an adapter turns the frozen context into ONE block model, and the three renderers turn
 * that model into bytes. The formats can differ in typography — they cannot differ in content,
 * which is the guarantee the phase spec asks for when it says preview and final output must
 * not disagree.
 *
 * The model is intentionally small: titles, key-value pairs, tables, notes, a signature block.
 * Everything the target documents need, and no layout primitive without a document behind it.
 */

/** A rendered value. `null` means "not present", and every renderer shows that as an em dash. */
export type Cell = string | null;

export type Align = 'left' | 'right' | 'center';

export interface KeyValueBlock {
  kind: 'key_values';
  title?: string;
  /** Two columns side by side where the format allows it; one column otherwise. */
  columns?: 1 | 2;
  rows: { label: string; value: Cell }[];
}

export interface TableBlock {
  kind: 'table';
  title?: string;
  columns: { header: string; align?: Align; width?: number }[];
  rows: Cell[][];
  /** Rendered emphasised beneath the body, and repeated on the last page only. */
  totals?: { label: string; value: Cell }[];
}

export interface NoteBlock {
  kind: 'note';
  title?: string;
  /** Each string is a paragraph. Long text wraps and paginates. */
  paragraphs: string[];
  /** Renders in a muted style — provenance, disclaimers, draft warnings. */
  muted?: boolean;
}

export interface PartiesBlock {
  kind: 'parties';
  left: { heading: string; lines: string[] };
  right: { heading: string; lines: string[] };
}

export interface SignatureBlock {
  kind: 'signature';
  /** "For <exporter legal name>" — never a fabricated signatory name. */
  forParty: string;
  caption: string;
}

export type Block = KeyValueBlock | TableBlock | NoteBlock | PartiesBlock | SignatureBlock;

export interface DocumentModel {
  /** e.g. "COMMERCIAL INVOICE". Uppercased by the adapter, not by a renderer. */
  title: string;
  /** e.g. "Draft — not an issued document". Absent on a final rendering. */
  subtitle?: string;
  /** Top-right identification block: invoice number, date, version. */
  reference: { label: string; value: Cell }[];
  blocks: Block[];
  /** Footer line carrying brand, audit id and integrity hash. */
  footer: { brand: string; auditId: string; contentHash: string; generatedAt: Date };
  /** Draft renderings are watermarked and say so. */
  watermark?: string;
}
