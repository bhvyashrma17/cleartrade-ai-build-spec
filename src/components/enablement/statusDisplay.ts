import type { StatusDescriptor } from '@/types';

export const TASK_STATE_DISPLAY: Record<string, StatusDescriptor> = {
  not_started: { label: 'Not started', tone: 'neutral', icon: 'dot' },
  in_progress: { label: 'In progress', tone: 'info', icon: 'clock' },
  waiting: { label: 'Waiting on you', tone: 'warning', icon: 'alert' },
  done: { label: 'Complete', tone: 'positive', icon: 'check' },
  cancelled: { label: 'No longer needed', tone: 'neutral', icon: 'dot' },
};

export const EVIDENCE_REVIEW_DISPLAY: Record<string, StatusDescriptor> = {
  pending: { label: 'Waiting on review', tone: 'warning', icon: 'clock' },
  approved: { label: 'Approved', tone: 'positive', icon: 'check' },
  rejected: { label: 'Changes requested', tone: 'critical', icon: 'alert' },
};

export function enablementChip(map: Record<string, StatusDescriptor>, value: string): StatusDescriptor {
  return map[value] ?? { label: value.replace(/_/g, ' '), tone: 'neutral', icon: 'dot' };
}
