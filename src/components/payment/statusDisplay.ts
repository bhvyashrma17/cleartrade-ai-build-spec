import { BRC_STATUS_LABELS, INSURANCE_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/lib/state-machines/payment';
import type { StatusDescriptor } from '@/types';

export const PAYMENT_STATUS_DISPLAY: Record<string, StatusDescriptor> = {
  not_due: { label: PAYMENT_STATUS_LABELS.not_due, tone: 'neutral', icon: 'dot' },
  due: { label: PAYMENT_STATUS_LABELS.due, tone: 'info', icon: 'clock' },
  partially_received: { label: PAYMENT_STATUS_LABELS.partially_received, tone: 'warning', icon: 'clock' },
  received: { label: PAYMENT_STATUS_LABELS.received, tone: 'positive', icon: 'check' },
  realized: { label: PAYMENT_STATUS_LABELS.realized, tone: 'positive', icon: 'check' },
  overdue: { label: PAYMENT_STATUS_LABELS.overdue, tone: 'critical', icon: 'alert' },
  disputed: { label: PAYMENT_STATUS_LABELS.disputed, tone: 'critical', icon: 'alert' },
};

/// brc_status — EXP-15-AC04: rendered from its own map, never derived from payment status.
export const BRC_STATUS_DISPLAY: Record<string, StatusDescriptor> = {
  not_applicable: { label: BRC_STATUS_LABELS.not_applicable, tone: 'neutral', icon: 'dot' },
  pending: { label: BRC_STATUS_LABELS.pending, tone: 'warning', icon: 'clock' },
  available: { label: BRC_STATUS_LABELS.available, tone: 'info', icon: 'check' },
  verified: { label: BRC_STATUS_LABELS.verified, tone: 'positive', icon: 'check' },
};

export const INSURANCE_STATUS_DISPLAY: Record<string, StatusDescriptor> = {
  not_started: { label: INSURANCE_STATUS_LABELS.not_started, tone: 'neutral', icon: 'dot' },
  quote_requested: { label: INSURANCE_STATUS_LABELS.quote_requested, tone: 'info', icon: 'clock' },
  quoted: { label: INSURANCE_STATUS_LABELS.quoted, tone: 'info', icon: 'clock' },
  bound: { label: INSURANCE_STATUS_LABELS.bound, tone: 'positive', icon: 'check' },
  claim_open: { label: INSURANCE_STATUS_LABELS.claim_open, tone: 'warning', icon: 'alert' },
  claim_settled: { label: INSURANCE_STATUS_LABELS.claim_settled, tone: 'positive', icon: 'check' },
  declined: { label: INSURANCE_STATUS_LABELS.declined, tone: 'critical', icon: 'alert' },
};

/// EXP-15-AC02: every milestone (Payment row) shows where the update came from.
export const PROVENANCE_DISPLAY: Record<string, StatusDescriptor> = {
  exporter_update: { label: 'Exporter update', tone: 'neutral', icon: 'dot' },
  AA: { label: 'AA-verified', tone: 'info', icon: 'check' },
  bank_partner: { label: 'Bank partner', tone: 'info', icon: 'check' },
  manual_ops: { label: 'Ops (manual)', tone: 'neutral', icon: 'dot' },
};

export function paymentChip(map: Record<string, StatusDescriptor>, value: string): StatusDescriptor {
  return map[value] ?? { label: value, tone: 'neutral', icon: 'dot' };
}
