import { DocType } from '@prisma/client';
import type { DocumentGenerationContext } from './types';

export type ApplicabilityStatus = 'applicable' | 'not_applicable' | 'undetermined';

export interface DocumentApplicability {
  status: ApplicabilityStatus;
  code: string;
  reason: string;
  /** Carrier instructions use one DocType; mode selects the honest document variant. */
  variant?: 'bill_of_lading_instructions' | 'air_waybill_instructions';
}

export function paymentMechanism(value: unknown): string | null {
  if (!value) return null;
  const raw = typeof value === 'string'
    ? value
    : typeof value === 'object'
      ? ((value as Record<string, unknown>).type ?? (value as Record<string, unknown>).kind)
      : null;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

const BANK_DOCUMENT_MECHANISMS = new Set(['LC', 'LETTER_OF_CREDIT', 'DA', 'D_A', 'DP', 'D_P']);
const NO_BANK_DOCUMENT_MECHANISMS = new Set([
  'TT', 'T_T', 'ADVANCE', 'OPEN_ACCOUNT', 'CASH', 'WIRE_TRANSFER',
]);

export function documentApplicability(
  context: DocumentGenerationContext,
  docType: DocType,
): DocumentApplicability {
  if (docType === DocType.shipping_instructions) {
    return context.shipment.shipment_id
      ? { status: 'applicable', code: 'shipment_exists', reason: 'A shipment exists and needs operational shipping instructions.' }
      : { status: 'not_applicable', code: 'no_shipment', reason: 'No shipment exists for this deal.' };
  }

  if (docType === DocType.vgm_declaration) {
    if (!context.shipment.shipment_id) {
      return { status: 'not_applicable', code: 'no_shipment', reason: 'No shipment exists for this deal.' };
    }
    if (context.shipment.mode && context.shipment.mode !== 'sea') {
      return { status: 'not_applicable', code: 'not_sea', reason: 'VGM applies only to relevant packed sea containers.' };
    }
    if (!context.shipment.mode) {
      return { status: 'undetermined', code: 'shipment_mode_missing', reason: 'Record the shipment mode to determine VGM applicability.' };
    }
    if (context.shipment.containerized === false) {
      return { status: 'not_applicable', code: 'not_containerized', reason: 'The sea shipment is explicitly non-containerized.' };
    }
    if (context.shipment.containerized === null || context.shipment.containerized === undefined) {
      return { status: 'undetermined', code: 'containerization_missing', reason: 'Confirm whether the sea shipment is containerized.' };
    }
    return { status: 'applicable', code: 'containerized_sea', reason: 'VGM is required for the recorded containerized sea shipment.' };
  }

  if (docType === DocType.carrier_instructions) {
    if (!context.shipment.shipment_id) {
      return { status: 'not_applicable', code: 'no_shipment', reason: 'No shipment exists for this deal.' };
    }
    if (context.shipment.mode === 'sea') {
      return {
        status: 'applicable', code: 'sea', reason: 'Sea mode requires Bill of Lading instructions.',
        variant: 'bill_of_lading_instructions',
      };
    }
    if (context.shipment.mode === 'air') {
      return {
        status: 'applicable', code: 'air', reason: 'Air mode requires Air Waybill instructions.',
        variant: 'air_waybill_instructions',
      };
    }
    if (!context.shipment.mode) {
      return { status: 'undetermined', code: 'shipment_mode_missing', reason: 'Record the shipment mode to select the carrier-instruction variant.' };
    }
    return { status: 'not_applicable', code: 'unsupported_mode', reason: 'Carrier B/L or AWB instructions apply only to sea or air shipments.' };
  }

  if (docType === DocType.bill_of_exchange || docType === DocType.bank_collection_letter) {
    const mechanism = context.trade_finance?.payment_mechanism ?? paymentMechanism(context.deal.payment_terms);
    if (!mechanism) {
      return { status: 'undetermined', code: 'payment_mechanism_missing', reason: 'Record the payment mechanism to determine trade-finance document applicability.' };
    }
    if (BANK_DOCUMENT_MECHANISMS.has(mechanism)) {
      return {
        status: 'applicable', code: `payment_${mechanism.toLowerCase()}`,
        reason: docType === DocType.bill_of_exchange
          ? 'The recorded documentary payment mechanism uses a bill or draft.'
          : 'The recorded documentary payment mechanism uses bank presentation.',
      };
    }
    if (NO_BANK_DOCUMENT_MECHANISMS.has(mechanism)) {
      return {
        status: 'not_applicable', code: `payment_${mechanism.toLowerCase()}`,
        reason: docType === DocType.bill_of_exchange
          ? 'The recorded payment mechanism does not use a bill or draft.'
          : 'The recorded payment mechanism does not use document presentation through a bank.',
      };
    }
    return {
      status: 'undetermined', code: 'payment_mechanism_unknown',
      reason: `Payment mechanism "${mechanism}" is not classified for this document.`,
    };
  }

  return { status: 'applicable', code: 'unconditional', reason: 'This document is part of the existing document set.' };
}
