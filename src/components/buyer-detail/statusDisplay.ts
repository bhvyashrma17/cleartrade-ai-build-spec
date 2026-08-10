import type { StatusDescriptor } from '@/types';

export const VERIFICATION_DISPLAY: Record<string, StatusDescriptor> = {
  unverified: { label: 'Unverified', tone: 'neutral', icon: 'dot', detail: 'No verification performed yet.' },
  partially_verified: {
    label: 'Partially verified',
    tone: 'warning',
    icon: 'clock',
    detail: 'Some details confirmed — treat contact details with caution.',
  },
  verified: { label: 'Verified', tone: 'positive', icon: 'check' },
};

export const LEAD_STAGE_DISPLAY: Record<string, StatusDescriptor> = {
  new: { label: 'New', tone: 'neutral', icon: 'dot' },
  shortlisted: { label: 'Shortlisted', tone: 'info', icon: 'dot' },
  contacted: { label: 'Contacted', tone: 'info', icon: 'clock' },
  replied: { label: 'Replied', tone: 'info', icon: 'clock' },
  interested: { label: 'Interested', tone: 'positive', icon: 'check' },
  negotiation: { label: 'In negotiation', tone: 'positive', icon: 'check' },
  disqualified: { label: 'Disqualified', tone: 'neutral', icon: 'x' },
  converted: { label: 'Converted to deal', tone: 'positive', icon: 'check' },
};

export function buyerChip(map: Record<string, StatusDescriptor>, value: string): StatusDescriptor {
  return map[value] ?? { label: value.replace(/_/g, ' '), tone: 'neutral', icon: 'dot' };
}
