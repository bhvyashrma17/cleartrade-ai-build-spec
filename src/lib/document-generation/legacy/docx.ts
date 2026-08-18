/**
 * DOCX rendering with the `docx` library.
 *
 * Adapted from the legacy `lib/docx/layout.ts` helpers, which were the strongest part of that
 * project's rendering code — real tables, sensible borders, Calibri, header/heading treatment,
 * numeric column alignment inferred from the header text. Those decisions are preserved.
 *
 * What changed: the legacy helpers took `partyDetailsTable(invoice: any)` and each generator
 * reached into a Prisma aggregate, so the DOCX and the PDF for the same invoice could and did
 * disagree about which fields appeared. Here both render the same `DocumentModel`, so they
 * cannot.
 *
 * The legacy `lib/docx/packing.ts` and `lib/docx/shipping-bill.ts` were 50-byte re-export
 * stubs — verified, not assumed — so nothing was lost by not porting them.
 *
 * Purity: imports `docx` and the document model. No Prisma, no env, no I/O.
 */

import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, Paragraph,
  Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import type { Align, Block, DocumentModel, TableBlock } from './model';
import { ABSENT } from './format';

const FONT = 'Calibri';
const BORDER_OUTER = 'D9D9D9';
const BORDER_INNER = 'E5E5E5';
const MUTED = '6B6B70';
const INK = '17171C';

const borders = () => ({
  top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_OUTER },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_OUTER },
  left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_OUTER },
  right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_OUTER },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: BORDER_INNER },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: BORDER_INNER },
});

/** Absent values render as an em dash in muted grey — never as an empty cell. */
function cellText(value: string | null, opts: { bold?: boolean; size?: number; align?: Align } = {}) {
  const absent = value === null;
  return new Paragraph({
    children: [new TextRun({
      text: absent ? ABSENT : value,
      bold: opts.bold ?? false,
      size: opts.size ?? 19,
      font: FONT,
      color: absent ? MUTED : INK,
    })],
    alignment: opts.align === 'right' ? AlignmentType.RIGHT
      : opts.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: 20 },
  });
}

const heading = (text: string) => new Paragraph({
  children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 18, font: FONT, color: MUTED })],
  spacing: { before: 200, after: 80 },
});

function partiesBlock(block: Extract<Block, { kind: 'parties' }>): Table {
  const column = (side: { heading: string; lines: string[] }) => [
    new Paragraph({ children: [new TextRun({ text: side.heading.toUpperCase(), bold: true, size: 16, font: FONT, color: MUTED })] }),
    ...side.lines.map((line) => new Paragraph({
      children: [new TextRun({ text: line, size: 19, font: FONT, color: INK })],
      spacing: { after: 20 },
    })),
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [
        new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: column(block.left) }),
        new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: column(block.right) }),
      ],
    })],
    borders: borders(),
  });
}

function keyValuesBlock(block: Extract<Block, { kind: 'key_values' }>): (Paragraph | Table)[] {
  if (block.rows.length === 0) return [];
  const columns = block.columns ?? 1;
  const groups: typeof block.rows[] = [];
  for (let i = 0; i < block.rows.length; i += columns) groups.push(block.rows.slice(i, i + columns));

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: groups.map((group) => new TableRow({
      children: Array.from({ length: columns }).flatMap((_, index) => {
        const row = group[index];
        return [
          new TableCell({
            width: { size: Math.floor(40 / columns), type: WidthType.PERCENTAGE },
            children: [cellText(row ? row.label : '', { bold: true })],
          }),
          new TableCell({
            width: { size: Math.floor(60 / columns), type: WidthType.PERCENTAGE },
            children: [row ? cellText(row.value) : cellText('')],
          }),
        ];
      }),
    })),
    borders: borders(),
  });

  return block.title ? [heading(block.title), table] : [table];
}

function tableBlock(block: TableBlock): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  if (block.title) out.push(heading(block.title));

  out.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true, // repeats across page breaks
        children: block.columns.map((col) => new TableCell({
          width: { size: col.width ?? Math.floor(100 / block.columns.length), type: WidthType.PERCENTAGE },
          shading: { fill: 'F2F2F4' },
          children: [cellText(col.header, { bold: true, size: 17, align: col.align })],
        })),
      }),
      ...block.rows.map((row) => new TableRow({
        children: row.map((value, i) => new TableCell({
          children: [cellText(value, { size: 18, align: block.columns[i]?.align })],
        })),
      })),
    ],
    borders: borders(),
  }));

  if (block.totals?.length) {
    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: block.totals.map((total) => new TableRow({
        children: [
          new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, children: [cellText(total.label, { bold: true, align: 'right' })] }),
          new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: [cellText(total.value, { bold: true, align: 'right' })] }),
        ],
      })),
      borders: borders(),
    }));
  }
  return out;
}

function noteBlock(block: Extract<Block, { kind: 'note' }>): Paragraph[] {
  const out: Paragraph[] = [];
  if (block.title) out.push(heading(block.title));
  for (const paragraph of block.paragraphs) {
    out.push(new Paragraph({
      children: [new TextRun({ text: paragraph, size: block.muted ? 17 : 19, font: FONT, color: block.muted ? MUTED : INK })],
      spacing: { after: 100 },
    }));
  }
  return out;
}

function signatureBlock(block: Extract<Block, { kind: 'signature' }>): Paragraph[] {
  return [
    new Paragraph({ text: '', spacing: { before: 400 } }),
    new Paragraph({
      children: [new TextRun({ text: block.forParty, size: 19, font: FONT, color: INK })],
      alignment: AlignmentType.RIGHT,
    }),
    new Paragraph({ text: '', spacing: { before: 600 } }),
    new Paragraph({
      children: [new TextRun({ text: block.caption, bold: true, size: 17, font: FONT, color: MUTED })],
      alignment: AlignmentType.RIGHT,
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: INK } },
    }),
  ];
}

export async function renderDocx(model: DocumentModel): Promise<Buffer> {
  const header: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: model.title, bold: true, size: 34, font: FONT, color: INK })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
    }),
  ];
  if (model.subtitle) {
    header.push(new Paragraph({
      children: [new TextRun({ text: model.subtitle, bold: true, size: 19, font: FONT, color: 'B32626' })],
      spacing: { after: 80 },
    }));
  }
  header.push(new Paragraph({
    children: model.reference.map((row, i) => new TextRun({
      text: `${i > 0 ? '    ' : ''}${row.label}: ${row.value ?? ABSENT}`,
      size: 18, font: FONT, color: INK,
    })),
    spacing: { after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: INK } },
  }));

  const body: (Paragraph | Table)[] = [];
  for (const block of model.blocks) {
    switch (block.kind) {
      case 'parties': body.push(partiesBlock(block)); break;
      case 'key_values': body.push(...keyValuesBlock(block)); break;
      case 'table': body.push(...tableBlock(block)); break;
      case 'note': body.push(...noteBlock(block)); break;
      case 'signature': body.push(...signatureBlock(block)); break;
    }
  }

  const footerText = `${model.footer.brand} · Doc ${model.footer.auditId} · Integrity ${model.footer.contentHash.slice(0, 8)}…${model.footer.contentHash.slice(-4)}`;

  const doc = new Document({
    creator: model.footer.brand,
    title: model.title,
    description: `${model.title} — ${model.footer.auditId}`,
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [new TextRun({ text: footerText, size: 14, font: FONT, color: MUTED })],
            alignment: AlignmentType.LEFT,
          })],
        }),
      },
      children: [...header, ...body],
    }],
  });

  return Packer.toBuffer(doc);
}
