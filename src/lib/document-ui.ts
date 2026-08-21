import { DocType } from '@prisma/client';
import type { DocumentApplicability } from './document-data/applicability';
import type { CanonicalOwner } from './document-data/readiness';

export const DOCUMENT_UI_GROUPS = [
  {
    id: 'commercial',
    label: 'Commercial',
    documentTypes: [DocType.PI, DocType.CI, DocType.bill_of_exchange],
  },
  {
    id: 'shipping',
    label: 'Shipping',
    documentTypes: [
      DocType.packing_list,
      DocType.shipping_bill_draft,
      DocType.shipping_instructions,
      DocType.carrier_instructions,
      DocType.vgm_declaration,
    ],
  },
  {
    id: 'certificates-and-declarations',
    label: 'Certificates & declarations',
    documentTypes: [DocType.COO_draft, DocType.declaration, DocType.insurance_declaration],
  },
  {
    id: 'banking',
    label: 'Banking',
    documentTypes: [DocType.bank_collection_letter],
  },
] as const;

const FRIENDLY_LABELS: Partial<Record<DocType, string>> = {
  [DocType.PI]: 'Proforma Invoice',
  [DocType.CI]: 'Commercial Invoice',
  [DocType.packing_list]: 'Packing List',
  [DocType.shipping_bill_draft]: 'Shipping Bill Draft',
  [DocType.COO_draft]: 'Certificate of Origin Draft',
  [DocType.declaration]: 'Declaration / Undertaking',
  [DocType.insurance_declaration]: 'Insurance Declaration',
  [DocType.shipping_instructions]: 'Shipping Instructions',
  [DocType.vgm_declaration]: 'VGM Declaration',
  [DocType.bill_of_exchange]: 'Bill of Exchange',
  [DocType.bank_collection_letter]: 'Bank Document Presentation / Collection Cover Letter',
};

export function documentDisplayName(
  documentType: DocType,
  applicability?: DocumentApplicability,
): string {
  if (documentType === DocType.carrier_instructions) {
    if (applicability?.variant === 'bill_of_lading_instructions') return 'Bill of Lading Instructions';
    if (applicability?.variant === 'air_waybill_instructions') return 'Air Waybill Instructions';
    return 'Carrier Instructions';
  }
  return FRIENDLY_LABELS[documentType] ?? 'Document';
}

export function notApplicableMessage(
  documentType: DocType,
  applicability: DocumentApplicability,
): string {
  if (documentType === DocType.vgm_declaration) {
    return 'Not applicable — shipment is not a packed sea-container movement.';
  }
  if (documentType === DocType.bill_of_exchange) {
    return 'Not applicable — current payment terms do not require a draft.';
  }
  if (documentType === DocType.bank_collection_letter) {
    return 'Not applicable — documents are not being presented through a bank workflow.';
  }
  return `Not applicable — ${applicability.reason}`;
}

const OWNER_ANCHORS: Record<CanonicalOwner, string> = {
  exporter_org: 'party-data',
  buyer_commercial_profile: 'party-data',
  deal: 'commercial-data',
  shipment: 'shipment-instructions',
  shipment_packages: 'shipment-instructions',
  shipment_containers: 'container-vgm',
  trade_finance_instruction: 'payment-draft',
  exporter_bank_account: 'bank-presentation',
  bank_presentation: 'bank-presentation',
  insurance_case: 'certificates-data',
  exchange_rate_quote: 'commercial-data',
  invoice_number: 'invoice-numbering',
};

export function documentDataAnchor(owner: CanonicalOwner): string {
  return OWNER_ANCHORS[owner];
}

