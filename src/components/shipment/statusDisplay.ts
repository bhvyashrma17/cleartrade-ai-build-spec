import { SHIPMENT_STATUS_LABELS } from '@/lib/state-machines/shipment';
import type { StatusDescriptor } from '@/types';

/**
 * Shipment pipeline status — EXP-14-AC01: this is a direct render of `Shipment.status`,
 * never a derived/inferred label.
 */
export const SHIPMENT_STATUS_DISPLAY: Record<string, StatusDescriptor> = {
  planning: { label: SHIPMENT_STATUS_LABELS.planning, tone: 'neutral', icon: 'dot' },
  booking: { label: SHIPMENT_STATUS_LABELS.booking, tone: 'info', icon: 'clock' },
  pickup: { label: SHIPMENT_STATUS_LABELS.pickup, tone: 'info', icon: 'clock' },
  customs: { label: SHIPMENT_STATUS_LABELS.customs, tone: 'info', icon: 'clock' },
  loaded: { label: SHIPMENT_STATUS_LABELS.loaded, tone: 'info', icon: 'clock' },
  in_transit: { label: SHIPMENT_STATUS_LABELS.in_transit, tone: 'info', icon: 'clock' },
  arrived: { label: SHIPMENT_STATUS_LABELS.arrived, tone: 'info', icon: 'clock' },
  delivered: { label: SHIPMENT_STATUS_LABELS.delivered, tone: 'positive', icon: 'check' },
  exception: { label: SHIPMENT_STATUS_LABELS.exception, tone: 'critical', icon: 'alert' },
};

/** Milestone row state — separate from the shipment-level pipeline status above. */
export const MILESTONE_STATE_DISPLAY: Record<string, StatusDescriptor> = {
  pending: { label: 'Pending', tone: 'neutral', icon: 'dot' },
  in_progress: { label: 'In progress', tone: 'info', icon: 'clock' },
  complete: { label: 'Complete', tone: 'positive', icon: 'check' },
  skipped: { label: 'Skipped', tone: 'neutral', icon: 'dot' },
  exception: { label: 'Exception', tone: 'critical', icon: 'alert' },
};

/** exception_state — the severity signal, distinct from `status` (see shipment.ts header). */
export const EXCEPTION_STATE_DISPLAY: Record<string, StatusDescriptor> = {
  none: { label: 'No issues', tone: 'positive', icon: 'check' },
  watch: { label: 'Watch', tone: 'warning', icon: 'alert' },
  blocked: { label: 'Blocked', tone: 'critical', icon: 'alert' },
};

export function shipmentChip(map: Record<string, StatusDescriptor>, value: string): StatusDescriptor {
  return map[value] ?? { label: value, tone: 'neutral', icon: 'dot' };
}
