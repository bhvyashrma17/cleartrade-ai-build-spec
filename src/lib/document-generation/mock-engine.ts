/**
 * Deterministic mock document engine.
 *
 * Retained after Phase 6 rather than deleted: it is the safe default, it keeps tests that do
 * not care about rendering fast, and it is the fallback if `DOCUMENT_ENGINE` is unset. It
 * renders plain text and says so (`text/plain`) — it never pretends to be a PDF.
 *
 * Deterministic on purpose: the same frozen context always produces the same bytes and
 * therefore the same checksum.
 */

import type {
  DocumentGenerationEngine, DocumentOutputFormat,
  DocumentRenderRequest, DocumentRenderResult,
} from './engine';
import { UnsupportedDocumentError } from './engine';
import type { ContextMoney } from '@/lib/document-data';

const DOC_TITLES: Record<string, string> = {
  PI: 'PROFORMA INVOICE',
  CI: 'COMMERCIAL INVOICE',
  packing_list: 'PACKING LIST',
  shipping_bill_draft: 'SHIPPING BILL (DRAFT)',
  COO_draft: 'CERTIFICATE OF ORIGIN (DRAFT)',
  declaration: 'EXPORT DECLARATION',
  insurance_declaration: 'INSURANCE DECLARATION',
};

const money = (value: ContextMoney | null) => (value ? `${value.currency} ${value.amount}` : 'Not specified');
const line = (label: string, value: string | null) => `${label.padEnd(24)}${value ?? 'Not specified'}`;

export function renderDocumentText(request: DocumentRenderRequest): string {
  const c = request.context;
  const rows = [
    DOC_TITLES[request.doc_type] ?? request.doc_type.toUpperCase(),
    request.metadata.draft ? 'DRAFT — not an issued document' : '',
    '='.repeat(60),
    line('Exporter', c.exporter.legal_name ?? c.exporter.display_name),
    line('IEC', c.exporter.iec_number),
    line('Buyer', c.buyer.document_name),
    line('Invoice no', c.references.invoice_number),
    line('Version', String(request.version)),
    line('Incoterm', c.deal.incoterm),
    line('Total', money(c.deal.goods_total)),
    line('Port of loading', c.shipment.port_of_loading.name),
    line('Port of discharge', c.shipment.port_of_discharge.name),
    line('Packages', String(c.shipment.package_totals.package_count)),
    '='.repeat(60),
    `${request.metadata.brand_name} · Doc ${request.metadata.audit_id} · Integrity ${request.content_hash}`,
  ];
  return rows.filter((r) => r !== '').join('\n');
}

export class MockDocumentEngine implements DocumentGenerationEngine {
  readonly name = 'mock';
  readonly version = '2.0.0';

  /** Text only. Claiming PDF support would produce a file that is not a PDF. */
  supports(docType: string, format: DocumentOutputFormat): boolean {
    return format === 'html' && docType in DOC_TITLES;
  }

  async render(request: DocumentRenderRequest): Promise<DocumentRenderResult> {
    if (!(request.doc_type in DOC_TITLES)) {
      throw new UnsupportedDocumentError(request.doc_type, request.format, this.name);
    }
    const content = renderDocumentText(request);
    return {
      bytes: Buffer.from(content, 'utf8'),
      mime_type: 'text/plain; charset=utf-8',
      file_extension: 'txt',
      provenance: {
        engine: this.name,
        engine_version: this.version,
        doc_type: request.doc_type,
        format: request.format,
        snapshot_id: request.snapshot_id,
        content_hash: request.content_hash,
        draft: request.metadata.draft,
      },
    };
  }
}
