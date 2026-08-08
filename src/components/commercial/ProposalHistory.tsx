import { StatusChip } from '@/components/ui';
import type { ProposalView } from '@/lib/commercial-view';
import type { StatusDescriptor } from '@/types';

/**
 * Version history — AGT-05-AC04 ("every revision preserves previous acceptance/change
 * history") and EXP-10 ("Version history: v1/v2…, proposed_by, timestamp, state").
 * Older versions are read-only by construction: nothing here offers an edit affordance.
 */

export const PROPOSAL_STATUS_DISPLAY: Record<string, StatusDescriptor> = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'dot', detail: 'Not yet sent to the exporter.' },
  awaiting_exporter: { label: 'Awaiting your approval', tone: 'warning', icon: 'clock' },
  approved: { label: 'Accepted', tone: 'positive', icon: 'check' },
  changes_requested: { label: 'Changes requested', tone: 'info', icon: 'alert' },
  superseded: { label: 'Superseded', tone: 'neutral', icon: 'pause' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral', icon: 'x' },
};

/** The agent sees "awaiting exporter", not "awaiting your approval". */
export const AGENT_STATUS_DISPLAY: Record<string, StatusDescriptor> = {
  ...PROPOSAL_STATUS_DISPLAY,
  awaiting_exporter: { label: 'Awaiting exporter approval', tone: 'warning', icon: 'clock' },
};

function formatWhen(date: Date | string | null) {
  if (!date) return null;
  return new Date(date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ProposalHistory({
  history,
  display = PROPOSAL_STATUS_DISPLAY,
}: {
  history: ProposalView[];
  display?: Record<string, StatusDescriptor>;
}) {
  if (history.length === 0) {
    return (
      <p className="rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">
        No commercial proposals have been prepared for this deal yet.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {history.map((item) => {
        const chip = display[item.status] ?? PROPOSAL_STATUS_DISPLAY.draft;
        return (
          <li key={item.id} className="border-b border-[var(--color-border)] pb-3 last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-primary">Version {item.version}</span>
              <StatusChip {...chip} size="sm" />
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {item.proposedAt
                ? `Proposed by ${item.proposedBy ?? 'your agent'} · ${formatWhen(item.proposedAt)}`
                : 'Not yet sent'}
            </p>
            {item.approvedAt ? (
              <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                Accepted by {item.approvedBy ?? 'the exporter'} · {formatWhen(item.approvedAt)}
              </p>
            ) : null}
            {item.changesRequestedAt ? (
              <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                Changes requested by {item.changesRequestedBy ?? 'the exporter'} · {formatWhen(item.changesRequestedAt)}
                {item.changesRequestedNote ? ` — “${item.changesRequestedNote}”` : ''}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
