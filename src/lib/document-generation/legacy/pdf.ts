/**
 * PDF rendering with `pdf-lib`. No browser, no Puppeteer, no Chromium.
 *
 * The legacy project had two PDF paths: an HTML template rendered through headless Chromium,
 * and a `pdf-lib` fallback used when Chromium failed. This integration keeps only the
 * deterministic library path — but the legacy fallback could not simply be lifted, because it
 * had no pagination at all. It drew at a running `y` that decremented past zero, so a document
 * with more than about twenty lines silently drew its remaining content off the bottom of the
 * page and lost it. A packing list with forty carton lines was unrenderable.
 *
 * So the layout decisions are preserved — A4, 50pt margins, Helvetica, the section ordering,
 * the audit footer, the watermark — and the mechanism is rebuilt around a cursor that starts a
 * new page when a block does not fit, wraps long text, and repeats table headers.
 *
 * Purity: this file imports `pdf-lib` and the document model. No Prisma, no env, no I/O.
 */

import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { Align, Block, DocumentModel, TableBlock } from './model';
import { ABSENT } from './format';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const CONTENT_WIDTH = A4[0] - MARGIN * 2;
const FOOTER_HEIGHT = 42;
const BOTTOM_LIMIT = MARGIN + FOOTER_HEIGHT;

const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0.85, 0.85, 0.87);
const BAND = rgb(0.95, 0.95, 0.96);

/**
 * pdf-lib's standard fonts are WinAnsi-encoded and throw on characters outside that set.
 * A buyer name with a CJK or Devanagari character would crash the render, so unsupported
 * characters are replaced with `?` — visibly wrong rather than a failed generation, and never
 * silently dropped. Full Unicode needs an embedded TrueType font, which is a font-licensing
 * decision rather than an integration one.
 */
function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[^\x00-\xFF]/g, '?').replace(/[\r\n\t]+/g, ' ');
}

interface Ctx {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  model: DocumentModel;
  pageNumber: number;
}

const widthOf = (font: PDFFont, text: string, size: number) => font.widthOfTextAtSize(sanitize(text), size);

/** Greedy word wrap. A single word longer than the column is broken rather than overflowing. */
function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const clean = sanitize(text);
  if (!clean) return [''];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (widthOf(font, candidate, size) <= maxWidth) { line = candidate; continue; }
    if (line) lines.push(line);
    if (widthOf(font, word, size) <= maxWidth) { line = word; continue; }
    let chunk = '';
    for (const char of word) {
      if (widthOf(font, chunk + char, size) > maxWidth) { lines.push(chunk); chunk = char; }
      else chunk += char;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

function drawWatermark(ctx: Ctx) {
  if (!ctx.model.watermark) return;
  const text = sanitize(ctx.model.watermark);
  ctx.page.drawText(text, {
    x: A4[0] / 2 - widthOf(ctx.bold, text, 64) / 2.2,
    y: A4[1] / 2 - 40,
    size: 64, font: ctx.bold, color: rgb(0.75, 0.1, 0.1), opacity: 0.11, rotate: degrees(32),
  });
}

/**
 * Footer, on every page.
 *
 * Carries the brand, the artifact's audit id, the integrity hash of the frozen input, and the
 * page number. The hash is the honest version of the legacy footer, which printed a hash it
 * had computed over an untyped invoice object at render time.
 */
function drawFooter(ctx: Ctx, totalPages?: number) {
  const y = MARGIN + 18;
  ctx.page.drawLine({ start: { x: MARGIN, y: y + 12 }, end: { x: A4[0] - MARGIN, y: y + 12 }, thickness: 0.5, color: RULE });
  const left = `${ctx.model.footer.brand} · Doc ${ctx.model.footer.auditId} · Integrity ${ctx.model.footer.contentHash.slice(0, 8)}…${ctx.model.footer.contentHash.slice(-4)}`;
  ctx.page.drawText(sanitize(left), { x: MARGIN, y, size: 7, font: ctx.font, color: MUTED });
  const right = totalPages ? `Page ${ctx.pageNumber} of ${totalPages}` : `Page ${ctx.pageNumber}`;
  ctx.page.drawText(right, { x: A4[0] - MARGIN - widthOf(ctx.font, right, 7), y, size: 7, font: ctx.font, color: MUTED });
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.pdf.addPage(A4);
  ctx.pageNumber += 1;
  ctx.y = A4[1] - MARGIN;
  drawWatermark(ctx);
  // Continuation pages carry the title so a detached sheet is still identifiable.
  ctx.page.drawText(sanitize(ctx.model.title), { x: MARGIN, y: ctx.y - 10, size: 9, font: ctx.bold, color: MUTED });
  ctx.y -= 28;
}

/** Reserve vertical space, starting a new page when the block would run past the footer. */
function reserve(ctx: Ctx, height: number) {
  if (ctx.y - height < BOTTOM_LIMIT) newPage(ctx);
}

function text(ctx: Ctx, value: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; maxWidth?: number } = {}) {
  const size = opts.size ?? 9;
  const font = opts.bold ? ctx.bold : ctx.font;
  const x = opts.x ?? MARGIN;
  const lines = wrap(font, value, size, opts.maxWidth ?? CONTENT_WIDTH - (x - MARGIN));
  for (const line of lines) {
    reserve(ctx, size + 4);
    ctx.page.drawText(line, { x, y: ctx.y - size, size, font, color: opts.color ?? INK });
    ctx.y -= size + 4;
  }
}

function sectionTitle(ctx: Ctx, title: string) {
  reserve(ctx, 30);
  ctx.y -= 8;
  ctx.page.drawText(sanitize(title.toUpperCase()), { x: MARGIN, y: ctx.y - 9, size: 8.5, font: ctx.bold, color: MUTED });
  ctx.y -= 13;
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: A4[0] - MARGIN, y: ctx.y }, thickness: 0.6, color: RULE });
  ctx.y -= 10;
}

function drawHeader(ctx: Ctx) {
  ctx.page.drawText(sanitize(ctx.model.title), { x: MARGIN, y: ctx.y - 18, size: 17, font: ctx.bold, color: INK });
  if (ctx.model.subtitle) {
    ctx.page.drawText(sanitize(ctx.model.subtitle), { x: MARGIN, y: ctx.y - 32, size: 9, font: ctx.bold, color: rgb(0.7, 0.15, 0.15) });
  }

  // Reference block, right-aligned against the margin.
  let refY = ctx.y - 14;
  for (const row of ctx.model.reference) {
    const line = `${row.label}: ${row.value ?? ABSENT}`;
    ctx.page.drawText(sanitize(line), {
      x: A4[0] - MARGIN - widthOf(ctx.font, line, 8.5), y: refY, size: 8.5, font: ctx.font, color: INK,
    });
    refY -= 12;
  }

  ctx.y = Math.min(ctx.y - (ctx.model.subtitle ? 46 : 34), refY - 8);
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: A4[0] - MARGIN, y: ctx.y }, thickness: 1, color: INK });
  ctx.y -= 14;
}

function drawParties(ctx: Ctx, block: Extract<Block, { kind: 'parties' }>) {
  const colWidth = CONTENT_WIDTH / 2 - 10;
  const height = 16 + Math.max(block.left.lines.length, block.right.lines.length) * 12;
  reserve(ctx, height + 10);
  const top = ctx.y;

  const column = (heading: string, lines: string[], x: number) => {
    ctx.page.drawText(sanitize(heading.toUpperCase()), { x, y: top - 9, size: 8, font: ctx.bold, color: MUTED });
    let y = top - 24;
    for (const line of lines) {
      for (const wrapped of wrap(ctx.font, line, 9, colWidth)) {
        ctx.page.drawText(wrapped, { x, y, size: 9, font: ctx.font, color: INK });
        y -= 12;
      }
    }
    return y;
  };

  const leftEnd = column(block.left.heading, block.left.lines, MARGIN);
  const rightEnd = column(block.right.heading, block.right.lines, MARGIN + CONTENT_WIDTH / 2 + 10);
  ctx.y = Math.min(leftEnd, rightEnd) - 4;
}

function drawKeyValues(ctx: Ctx, block: Extract<Block, { kind: 'key_values' }>) {
  if (block.rows.length === 0) return;
  if (block.title) sectionTitle(ctx, block.title);

  const columns = block.columns ?? 1;
  const cellWidth = CONTENT_WIDTH / columns - 12;
  const labelWidth = cellWidth * 0.42;

  for (let i = 0; i < block.rows.length; i += columns) {
    const group = block.rows.slice(i, i + columns);
    const heights = group.map((row) =>
      wrap(ctx.font, row.value ?? ABSENT, 9, cellWidth - labelWidth).length * 12);
    const rowHeight = Math.max(12, ...heights);
    reserve(ctx, rowHeight + 4);
    const top = ctx.y;

    group.forEach((row, index) => {
      const x = MARGIN + index * (CONTENT_WIDTH / columns);
      ctx.page.drawText(sanitize(row.label), { x, y: top - 9, size: 8.5, font: ctx.bold, color: MUTED });
      let y = top - 9;
      for (const line of wrap(ctx.font, row.value ?? ABSENT, 9, cellWidth - labelWidth)) {
        ctx.page.drawText(line, { x: x + labelWidth, y, size: 9, font: ctx.font, color: row.value === null ? MUTED : INK });
        y -= 12;
      }
    });

    ctx.y = top - rowHeight - 3;
  }
}

function columnXs(columns: TableBlock['columns']): { x: number; w: number }[] {
  const declared = columns.map((c) => c.width ?? 0);
  const total = declared.reduce((a, b) => a + b, 0);
  const weights = total > 0 ? declared : columns.map(() => 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  let x = MARGIN;
  return weights.map((w) => {
    const width = (w / sum) * CONTENT_WIDTH;
    const entry = { x, w: width };
    x += width;
    return entry;
  });
}

function alignedX(value: string, font: PDFFont, size: number, box: { x: number; w: number }, align: Align) {
  const width = widthOf(font, value, size);
  if (align === 'right') return box.x + box.w - width - 4;
  if (align === 'center') return box.x + (box.w - width) / 2;
  return box.x + 4;
}

function drawTable(ctx: Ctx, block: TableBlock) {
  if (block.title) sectionTitle(ctx, block.title);
  const boxes = columnXs(block.columns);

  const header = () => {
    reserve(ctx, 22);
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 15, width: CONTENT_WIDTH, height: 15, color: BAND });
    block.columns.forEach((col, i) => {
      const x = alignedX(col.header, ctx.bold, 8, boxes[i]!, col.align ?? 'left');
      ctx.page.drawText(sanitize(col.header), { x, y: ctx.y - 11, size: 8, font: ctx.bold, color: INK });
    });
    ctx.y -= 17;
  };

  header();

  for (const row of block.rows) {
    const cellLines = row.map((value, i) => wrap(ctx.font, value ?? ABSENT, 8.5, boxes[i]!.w - 8));
    const rowHeight = Math.max(...cellLines.map((l) => l.length)) * 11 + 4;

    if (ctx.y - rowHeight < BOTTOM_LIMIT) {
      newPage(ctx);
      // Repeat the header so a continued table is readable on its own page.
      header();
    }

    const top = ctx.y;
    cellLines.forEach((lines, i) => {
      const align = block.columns[i]?.align ?? 'left';
      const absent = row[i] === null;
      lines.forEach((line, lineIndex) => {
        ctx.page.drawText(line, {
          x: alignedX(line, ctx.font, 8.5, boxes[i]!, align),
          y: top - 9 - lineIndex * 11, size: 8.5, font: ctx.font, color: absent ? MUTED : INK,
        });
      });
    });
    ctx.y = top - rowHeight;
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y + 1 }, end: { x: A4[0] - MARGIN, y: ctx.y + 1 }, thickness: 0.4, color: RULE });
  }

  if (block.totals?.length) {
    reserve(ctx, block.totals.length * 14 + 8);
    ctx.y -= 4;
    for (const total of block.totals) {
      const label = sanitize(total.label);
      const value = sanitize(total.value ?? ABSENT);
      const valueWidth = widthOf(ctx.bold, value, 9.5);
      ctx.page.drawText(label, { x: A4[0] - MARGIN - valueWidth - 12 - widthOf(ctx.bold, label, 9), y: ctx.y - 10, size: 9, font: ctx.bold, color: MUTED });
      ctx.page.drawText(value, { x: A4[0] - MARGIN - valueWidth, y: ctx.y - 10, size: 9.5, font: ctx.bold, color: total.value === null ? MUTED : INK });
      ctx.y -= 14;
    }
  }
}

function drawNote(ctx: Ctx, block: Extract<Block, { kind: 'note' }>) {
  if (block.title) sectionTitle(ctx, block.title);
  else ctx.y -= 6;
  for (const paragraph of block.paragraphs) {
    text(ctx, paragraph, { size: block.muted ? 8 : 9, color: block.muted ? MUTED : INK });
    ctx.y -= 4;
  }
}

function drawSignature(ctx: Ctx, block: Extract<Block, { kind: 'signature' }>) {
  reserve(ctx, 78);
  ctx.y -= 24;
  const x = A4[0] - MARGIN - 190;
  ctx.page.drawText(sanitize(block.forParty), { x, y: ctx.y, size: 9, font: ctx.font, color: INK });
  ctx.y -= 46;
  ctx.page.drawLine({ start: { x, y: ctx.y }, end: { x: A4[0] - MARGIN, y: ctx.y }, thickness: 0.8, color: INK });
  ctx.y -= 12;
  ctx.page.drawText(sanitize(block.caption), { x, y: ctx.y, size: 8, font: ctx.bold, color: MUTED });
  ctx.y -= 10;
}

/**
 * Render a document model to PDF bytes.
 *
 * `generated_at` is written into the PDF metadata explicitly rather than left to pdf-lib's
 * defaults, so the only time-varying content in the file is a value the caller supplied. Given
 * the same model and the same timestamp the bytes are identical — which is what makes the
 * determinism test possible.
 */
export async function renderPdf(model: DocumentModel): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ctx: Ctx = { pdf, page: pdf.addPage(A4), y: A4[1] - MARGIN, font, bold, model, pageNumber: 1 };
  drawWatermark(ctx);
  drawHeader(ctx);

  for (const block of model.blocks) {
    switch (block.kind) {
      case 'parties': drawParties(ctx, block); break;
      case 'key_values': drawKeyValues(ctx, block); break;
      case 'table': drawTable(ctx, block); break;
      case 'note': drawNote(ctx, block); break;
      case 'signature': drawSignature(ctx, block); break;
    }
  }

  // Footers last, so every page can state the true total.
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    drawFooter({ ...ctx, page, pageNumber: index + 1 }, pages.length);
  });

  pdf.setTitle(sanitize(model.title));
  pdf.setProducer(model.footer.brand);
  pdf.setCreator(model.footer.brand);
  pdf.setCreationDate(model.footer.generatedAt);
  pdf.setModificationDate(model.footer.generatedAt);

  return Buffer.from(await pdf.save());
}
