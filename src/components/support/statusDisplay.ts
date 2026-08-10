import { DISPUTE_STATUS_LABELS } from '@/lib/state-machines/dispute';
import type { StatusDescriptor } from '@/types';

export const DISPUTE_STATUS_DISPLAY: Record<string, StatusDescriptor> = {
  open: { label: DISPUTE_STATUS_LABELS.open, tone: 'warning', icon: 'alert' },
  investigating: { label: DISPUTE_STATUS_LABELS.investigating, tone: 'info', icon: 'clock' },
  waiting_external: { label: DISPUTE_STATUS_LABELS.waiting_external, tone: 'neutral', icon: 'pause' },
  proposed_resolution: { label: DISPUTE_STATUS_LABELS.proposed_resolution, tone: 'info', icon: 'clock' },
  resolved: { label: DISPUTE_STATUS_LABELS.resolved, tone: 'positive', icon: 'check' },
  closed: { label: DISPUTE_STATUS_LABELS.closed, tone: 'positive', icon: 'check' },
};

export const DISPUTE_SEVERITY_DISPLAY: Record<string, StatusDescriptor> = {
  low: { label: 'Low', tone: 'neutral', icon: 'dot' },
  medium: { label: 'Medium', tone: 'info', icon: 'dot' },
  high: { label: 'High', tone: 'warning', icon: 'alert' },
  critical: { label: 'Critical', tone: 'critical', icon: 'alert' },
};

export const DISPUTE_TYPE_LABELS: Record<string, string> = {
  payment: 'Payment',
  quality: 'Quality',
  logistics: 'Logistics',
  document: 'Document',
  LC: 'Letter of credit',
  inspection: 'Inspection',
  other: 'Other',
};

export function supportChip(map: Record<string, StatusDescriptor>, value: string): StatusDescriptor {
  return map[value] ?? { label: value.replace(/_/g, ' '), tone: 'neutral', icon: 'dot' };
}
