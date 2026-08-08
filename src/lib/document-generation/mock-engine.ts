/**
 * Deterministic mock document engine.
 *
 * There is no real template/PDF renderer wired up yet, and the checklist dead-ends
 * without *something* behind "Generate". This produces a plain-text rendering so the
 * whole pipeline — precheck, enqueue, job, generation_status, download — is exercisable
 * end to end, exactly the same reasoning as `MockDiscoveryEngine`.
 *
 * Deterministic on purpose: the SAME (doc_type, deal_id, version, snapshot) always
 * produces the SAME content and therefore the SAME checksum. That is what lets the
 * download route re-render on demand instead of needing a blob store for generated
 * documents — a generated document's "storage" is just its own recipe. An upload is
 * different (arbitrary exporter-supplied bytes) and does go through
 * `src/lib/document-storage.ts`, which actually writes to disk.
 *
 * The output is plain text, honestly labelled as such (`mime_type: text/plain`) — it
 * does not pretend to be a PDF. Swapping in a real renderer touches only
 * `getDocumentGenerationEngine()`.
 */

import type { DocumentGenerationEngine, DocumentGenerationInput, DocumentGenerationResult } from './engine';

const DOC_TITLES: Record<string, string> = {
  PI: 'PROFORMA INVOICE',
  CI: 'COMMERCIAL INVOICE',
  packing_list: 'PACKING LIST',
  shipping_bill_draft: 'SHIPPING BILL (DRAFT)',
  COO_draft: 'CERTIFICATE OF ORIGIN (DRAFT)',
  declaration: 'EXPORT DECLARATION',
  insurance_declaration: 'INSURANCE DECLARATION',
};

function money(amount: string | null, currency: string | null): string {
  if (!amount) return 'Not specified';
  return `${currency ?? ''} ${amount}`.trim();
}

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : 'Not specified';
}

function paymentTermsLine(terms: unknown): string {
  if (!terms || typeof terms !== 'object') return 'Not specified';
  const t = terms as { type?: string; description?: string };
  return [t.type, t.description].filter(Boolean).join(' — ') || 'Not specified';
}

/**
 * Plain-text rendering, deterministic in every field. This is what the download route
 * re-derives on demand for a generated document rather than reading it back from disk.
 */
export function renderDocumentText(input: DocumentGenerationInput): string {
  const { snapshot } = input;
  const title = DOC_TITLES[input.doc_type] ?? input.doc_type;
  const lines = [
    title,
    '='.repeat(title.length),
    '',
    `Document version: v${input.version}`,
    `Deal: ${input.deal_id}`,
    '',
    `Buyer: ${snapshot.buyer_legal_name}`,
    `Product: ${snapshot.product_name ?? 'Not specified'}${snapshot.sku ? ` (SKU ${snapshot.sku})` : ''}`,
    `Quantity: ${snapshot.quantity ?? 'Not specified'} ${snapshot.unit ?? ''}`.trim(),
    `Unit price: ${money(snapshot.unit_price_amount, snapshot.unit_price_currency)}`,
    `Total value: ${money(snapshot.total_amount, snapshot.total_currency)}`,
    `Incoterm: ${snapshot.incoterm ?? 'Not specified'}${snapshot.incoterm_place ? ` (${snapshot.incoterm_place})` : ''}`,
    `Payment terms: ${paymentTermsLine(snapshot.payment_terms)}`,
    `Ship window: ${formatDate(snapshot.ship_window_start)} to ${formatDate(snapshot.ship_window_end)}`,
  ];
  if (snapshot.special_conditions) lines.push(`Special conditions: ${snapshot.special_conditions}`);
  lines.push(
    '',
    '--',
    'Generated from the deal snapshot frozen at lock time. This is a mock rendering for',
    'development — no real template engine is wired up yet (see',
    'src/lib/document-generation/mock-engine.ts).',
  );
  return lines.join('\n');
}

export class MockDocumentEngine implements DocumentGenerationEngine {
  readonly name = 'mock-document-engine-v1';

  async render(input: DocumentGenerationInput): Promise<DocumentGenerationResult> {
    return {
      content: renderDocumentText(input),
      mime_type: 'text/plain',
      file_extension: 'txt',
      provenance: { engine: this.name },
    };
  }
}
