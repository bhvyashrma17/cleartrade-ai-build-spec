import type { StatusDescriptor } from '@/types';

export const NOTIFICATION_SEVERITY_DISPLAY: Record<string, StatusDescriptor> = {
  info: { label: 'Info', tone: 'info', icon: 'dot' },
  action_required: { label: 'Action needed', tone: 'warning', icon: 'alert' },
  warning: { label: 'Warning', tone: 'warning', icon: 'alert' },
  critical: { label: 'Critical', tone: 'critical', icon: 'alert' },
};

export function notificationChip(value: string): StatusDescriptor {
  return NOTIFICATION_SEVERITY_DISPLAY[value] ?? { label: value, tone: 'neutral', icon: 'dot' };
}
