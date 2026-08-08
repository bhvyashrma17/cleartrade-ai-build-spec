import type { StatusDescriptor } from '@/types';

/**
 * Four independent dimensions, four independent display maps (docs/07 §7.3 / EXP-12-AC02:
 * "Generation state is separate from approval and filing state" — never one combined
 * chip). Each map is deliberately its own object, not a shared "status" lookup, so it is
 * structurally impossible to accidentally collapse two dimensions into one label.
 */

export const GENERATION_STATUS_DISPLAY: Record<string, StatusDescriptor> = {
  queued: { label: 'Not generated', tone: 'neutral', icon: 'dot' },
  processing: { label: 'Generating…', tone: 'info', icon: 'clock', detail: 'Prevents a duplicate request while this runs.' },
  generated: { label: 'Generated', tone: 'positive', icon: 'check' },
  failed: { label: 'Generation failed', tone: 'critical', icon: 'alert' },
};

export const REVIEW_STATUS_DISPLAY: Record<string, StatusDescriptor> = {
  not_reviewed: { label: 'Not reviewed', tone: 'neutral', icon: 'dot' },
  agent_reviewed: { label: 'Agent reviewed', tone: 'positive', icon: 'check' },
  changes_requested: { label: 'Changes requested', tone: 'warning', icon: 'alert' },
};

export const APPROVAL_STATUS_DISPLAY: Record<string, StatusDescriptor> = {
  not_required: { label: 'Not required', tone: 'neutral', icon: 'dot' },
  pending: { label: 'Awaiting your approval', tone: 'warning', icon: 'clock' },
  exporter_approved: { label: 'Approved', tone: 'positive', icon: 'check' },
  rejected: { label: 'Changes requested', tone: 'critical', icon: 'alert' },
};

export const FILING_STATUS_DISPLAY: Record<string, StatusDescriptor> = {
  not_applicable: { label: 'Not applicable', tone: 'neutral', icon: 'dot' },
  draft: { label: 'Not yet filed', tone: 'neutral', icon: 'dot' },
  ready: { label: 'Ready to file', tone: 'info', icon: 'clock' },
  filed: { label: 'Filed', tone: 'info', icon: 'check' },
  accepted: { label: 'Accepted', tone: 'positive', icon: 'check' },
  rejected: { label: 'Rejected by authority', tone: 'critical', icon: 'alert' },
};

export function docChip(map: Record<string, StatusDescriptor>, value: string): StatusDescriptor {
  return map[value] ?? { label: value, tone: 'neutral', icon: 'dot' };
}
