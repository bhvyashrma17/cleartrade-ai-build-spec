/**
 * `/agent/escalations` — the agent's exception queue.
 *
 * A read model over canonical exception state (see src/lib/agent-escalations.ts), not a new
 * table. Every row points at the model that owns the fact, so resolving an exception means
 * acting on the source — this page never becomes a second place where "is it resolved?" is
 * answered.
 *
 * Categories are limited to the four the schema genuinely supports. There is no "payment
 * exception" or "document exception" tab, because no column distinguishes those today.
 */

import Link from 'next/link';
import { StatusChip } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import {
  agentEscalations,
  escalationCounts,
  type EscalationSeverity,
  type EscalationSource,
} from '@/lib/agent-escalations';

const SOURCES: { key: EscalationSource | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'task', label: 'Tasks' },
  { key: 'dispute', label: 'Disputes' },
  { key: 'shipment', label: 'Shipments' },
  { key: 'sanctions', label: 'Sanctions' },
];

const SEVERITY_TONE: Record<EscalationSeverity, 'critical' | 'warning' | 'info' | 'neutral'> = {
  critical: 'critical', high: 'critical', medium: 'warning', low: 'info', unknown: 'neutral',
};

const fmtDate = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d) : '—';
const ageDays = (from: Date) => Math.max(0, Math.floor((Date.now() - from.getTime()) / 86_400_000));

export default async function AgentEscalationsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const principal = await requirePortalAccess('/agent');
  const { source } = await searchParams;
  const activeSource = SOURCES.find((s) => s.key === source)?.key ?? 'all';

  const rows = await agentEscalations(
    principal,
    activeSource === 'all' ? {} : { source: activeSource },
  );
  // Counts come from an unfiltered read so the tabs show real totals rather than the
  // current view's size.
  const counts = escalationCounts(activeSource === 'all' ? rows : await agentEscalations(principal));

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="mb-4">
        <p className="text-sm font-medium text-primary">Agent workspace</p>
        <h1 className="text-2xl font-semibold text-primary">Escalations</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Open exceptions across your assigned exporters, worst first. Each row links to the
          record that owns it — resolve it there, not here.
        </p>
      </header>

      <nav aria-label="Escalation sources" className="mb-3 flex flex-wrap gap-1">
        {SOURCES.map((s) => (
          <Link
            key={s.key}
            href={`/agent/escalations${s.key === 'all' ? '' : `?source=${s.key}`}`}
            aria-current={activeSource === s.key ? 'page' : undefined}
            className={`focus-visible-ring rounded border px-2.5 py-1 text-xs font-medium ${
              activeSource === s.key
                ? 'border-primary bg-primary text-[var(--color-text-inverse)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-surface-muted'
            }`}
          >
            {s.label} ({s.key === 'all' ? counts.total : counts[s.key]})
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">
          No open exceptions across your assigned exporters. Nothing needs you here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-surface shadow-card">
          <table className="w-full min-w-[58rem] border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-[var(--color-text-inverse)]">
                <th scope="col" className="px-3 py-2 text-left font-medium">What happened</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Exporter</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Source</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Severity</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Owner</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Due</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--color-border)] align-top hover:bg-surface-muted">
                  <td className="px-3 py-3">
                    {row.href ? (
                      <Link href={row.href} className="focus-visible-ring rounded font-medium text-primary underline underline-offset-2">
                        {row.title}
                      </Link>
                    ) : (
                      <span className="font-medium text-primary">{row.title}</span>
                    )}
                    {row.detail ? (
                      <div className="text-xs text-[var(--color-text-secondary)]">{row.detail}</div>
                    ) : null}
                    <div className="text-xs text-[var(--color-text-muted)]">state: {row.state}</div>
                  </td>
                  <td className="px-3 py-3 text-[var(--color-text-secondary)]">{row.exporterName}</td>
                  <td className="px-3 py-3 text-[var(--color-text-secondary)]">{row.source}</td>
                  <td className="px-3 py-3">
                    <StatusChip
                      label={row.severity}
                      tone={SEVERITY_TONE[row.severity]}
                      icon={row.severity === 'critical' || row.severity === 'high' ? 'alert' : 'dot'}
                      size="sm"
                    />
                  </td>
                  <td className="px-3 py-3 text-[var(--color-text-secondary)]">
                    {/* Null where the source tracks no owner — never defaulted to the reader. */}
                    {row.ownerName ?? <span className="text-[var(--color-text-muted)]">Unassigned</span>}
                  </td>
                  <td className="px-3 py-3 text-[var(--color-text-secondary)]">
                    {row.dueAt ? fmtDate(row.dueAt) : <span className="text-[var(--color-text-muted)]">No due date</span>}
                  </td>
                  <td className="px-3 py-3 text-right text-[var(--color-text-secondary)]">{ageDays(row.raisedAt)}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        Sources: overdue/escalated or blocked tasks, open disputes, shipments on watch or blocked,
        and sanctions cases needing review. Disputes not attached to a deal are not listed —
        they carry no tenant of their own.
      </p>
    </div>
  );
}
