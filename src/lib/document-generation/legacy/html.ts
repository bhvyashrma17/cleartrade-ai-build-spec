/**
 * HTML rendering — presentation only.
 *
 * The styling is adapted from the legacy `renderDocumentLayout.ts` shared stylesheet, which was
 * the visual reference the whole legacy document set was built against. What is NOT carried
 * over is the legacy pipeline around it: those templates were rendered through headless
 * Chromium to produce the actual PDFs, which is the dependency this integration removes.
 *
 * Here HTML is a preview format that renders the SAME `DocumentModel` as the PDF and DOCX.
 * That is the guarantee the phase spec asks for — a preview cannot show one thing and the
 * downloaded PDF another, because neither reads any data the other cannot see.
 *
 * Everything interpolated is escaped. The document contains buyer-supplied names and
 * addresses, and an HTML preview is served to a browser.
 */

import type { Block, DocumentModel, TableBlock } from './model';
import { ABSENT } from './format';

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** An absent value is muted and dashed, exactly as in the PDF and DOCX. */
const val = (value: string | null): string =>
  value === null ? `<span class="absent">${ABSENT}</span>` : esc(value);

const STYLES = `
  :root { --ink:#17171c; --muted:#6b6b70; --rule:#d9d9dd; --band:#f2f2f4; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:#f6f6f8; color:var(--ink);
         font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size:13px; line-height:1.45; }
  .sheet { max-width:820px; margin:0 auto; background:#fff; padding:44px 46px 34px;
           box-shadow:0 1px 3px rgba(0,0,0,.08); position:relative; }
  .watermark { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
               font-size:92px; font-weight:700; color:rgba(179,38,38,.11); transform:rotate(-32deg);
               pointer-events:none; letter-spacing:6px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; gap:24px;
          border-bottom:1.5px solid var(--ink); padding-bottom:12px; }
  h1 { margin:0; font-size:22px; letter-spacing:.5px; }
  .subtitle { margin:4px 0 0; font-size:12px; font-weight:700; color:#b32626; }
  .reference { text-align:right; font-size:12px; }
  .reference div { margin-bottom:3px; }
  .reference span.label { color:var(--muted); }
  h2 { font-size:11px; letter-spacing:.7px; text-transform:uppercase; color:var(--muted);
       margin:22px 0 6px; padding-bottom:5px; border-bottom:1px solid var(--rule); }
  .parties { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:16px; }
  .parties h3 { font-size:10px; letter-spacing:.6px; text-transform:uppercase; color:var(--muted); margin:0 0 5px; }
  .parties p { margin:0 0 2px; }
  .kv { display:grid; gap:2px 14px; }
  .kv.cols-1 { grid-template-columns:max-content 1fr; }
  .kv.cols-2 { grid-template-columns:max-content 1fr max-content 1fr; }
  .kv .label { color:var(--muted); font-weight:600; font-size:12px; }
  table { width:100%; border-collapse:collapse; margin-top:4px; }
  th { background:var(--band); text-align:left; font-size:11px; padding:6px 7px; border:1px solid var(--rule); }
  td { padding:6px 7px; border:1px solid var(--rule); font-size:12px; vertical-align:top; }
  td.right, th.right { text-align:right; } td.center, th.center { text-align:center; }
  .totals { margin-top:8px; margin-left:auto; width:min(340px,100%); }
  .totals td { border:0; padding:3px 0; font-weight:700; }
  .totals td:last-child { text-align:right; }
  .note { margin-top:12px; } .note.muted { color:var(--muted); font-size:11.5px; }
  .signature { margin-top:44px; text-align:right; }
  .signature .rule { margin:44px 0 6px auto; width:220px; border-top:1px solid var(--ink); }
  .signature .caption { font-size:11px; font-weight:700; color:var(--muted); }
  .absent { color:var(--muted); }
  footer { margin-top:26px; padding-top:8px; border-top:1px solid var(--rule);
           font-size:10px; color:var(--muted); display:flex; justify-content:space-between; }
  @media print { body { background:#fff; padding:0; } .sheet { box-shadow:none; padding:0; } }
`;

function renderTable(block: TableBlock): string {
  const head = block.columns
    .map((c) => `<th class="${c.align ?? 'left'}">${esc(c.header)}</th>`).join('');
  const body = block.rows.map((row) =>
    `<tr>${row.map((cell, i) => `<td class="${block.columns[i]?.align ?? 'left'}">${val(cell)}</td>`).join('')}</tr>`,
  ).join('');
  const totals = block.totals?.length
    ? `<table class="totals">${block.totals.map((t) => `<tr><td>${esc(t.label)}</td><td>${val(t.value)}</td></tr>`).join('')}</table>`
    : '';
  return `${block.title ? `<h2>${esc(block.title)}</h2>` : ''}
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${totals}`;
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'parties':
      return `<section class="parties">
        ${[block.left, block.right].map((side) =>
          `<div><h3>${esc(side.heading)}</h3>${side.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`).join('')}
      </section>`;
    case 'key_values': {
      if (block.rows.length === 0) return '';
      const cells = block.rows
        .map((r) => `<div class="label">${esc(r.label)}</div><div>${val(r.value)}</div>`).join('');
      return `${block.title ? `<h2>${esc(block.title)}</h2>` : ''}
        <div class="kv cols-${block.columns ?? 1}">${cells}</div>`;
    }
    case 'table': return renderTable(block);
    case 'note':
      return `${block.title ? `<h2>${esc(block.title)}</h2>` : ''}
        ${block.paragraphs.map((p) => `<p class="note${block.muted ? ' muted' : ''}">${esc(p)}</p>`).join('')}`;
    case 'signature':
      return `<div class="signature"><div>${esc(block.forParty)}</div>
        <div class="rule"></div><div class="caption">${esc(block.caption)}</div></div>`;
  }
}

export function renderHtml(model: DocumentModel): Buffer {
  const reference = model.reference
    .map((r) => `<div><span class="label">${esc(r.label)}:</span> ${val(r.value)}</div>`).join('');
  const hash = `${model.footer.contentHash.slice(0, 8)}…${model.footer.contentHash.slice(-4)}`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)}</title><style>${STYLES}</style></head>
<body><div class="sheet">
  ${model.watermark ? `<div class="watermark">${esc(model.watermark)}</div>` : ''}
  <div class="head">
    <div><h1>${esc(model.title)}</h1>
      ${model.subtitle ? `<p class="subtitle">${esc(model.subtitle)}</p>` : ''}</div>
    <div class="reference">${reference}</div>
  </div>
  ${model.blocks.map(renderBlock).join('\n')}
  <footer><span>${esc(model.footer.brand)} · Doc ${esc(model.footer.auditId)} · Integrity ${esc(hash)}</span>
    <span>${esc(model.footer.generatedAt.toISOString())}</span></footer>
</div></body></html>`;

  return Buffer.from(html, 'utf8');
}
