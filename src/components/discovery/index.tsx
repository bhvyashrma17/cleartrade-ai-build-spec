'use client';

/**
 * Shared Demand Discovery presentation.
 *
 * Exporter, agent and ops all render markets, statuses and summaries. Before this they each
 * reimplemented that markup, which is how the exporter surface and the agent surface drifted
 * into describing the same market two different ways. The pieces here are presentational only —
 * they take data and render it — and the ROLE differences live in what each caller passes in,
 * never in a fork of the markup.
 *
 * Two rules every component holds:
 *
 *   - **Status is never colour alone.** Every state carries a word and an icon, so it survives
 *     greyscale, colour blindness and a bad monitor.
 *   - **Attractiveness and evidence confidence are rendered differently on purpose.** One is a
 *     large numeral, the other a small labelled figure. A reader who conflates them misreads
 *     every row on the page.
 */
import Link from 'next/link';
import { useId, useState } from 'react';
import { Card, StatusChip } from '@/components/ui';
import type { StatusTone, StatusIconName } from '@/types';

// ---------------------------------------------------------------------------
// Summary header
// ---------------------------------------------------------------------------

export interface SummaryStat {
  label: string;
  value: React.ReactNode;
  /** Small print under the value — a unit, a caveat, or what the number is not. */
  hint?: string;
}

/**
 * The compact "where does this stand" block every product surface opens with.
 *
 * The rule it enforces: a page never opens with its longest list. Before this the agent page
 * began with eighty tasks and the answer to "what is happening with this product" was nine
 * screens away.
 */
export function SummaryHeader({ title, subtitle, stats, actions }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  stats: SummaryStat[];
  actions?: React.ReactNode;
}) {
  return (
    <Card as="section" ticked>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-bone">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-xs text-muted">{stat.label}</dt>
            <dd className="mt-0.5 text-lg font-medium text-bone">{stat.value}</dd>
            {stat.hint ? <p className="mt-0.5 text-xs text-muted">{stat.hint}</p> : null}
          </div>
        ))}
      </dl>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Info affordance
// ---------------------------------------------------------------------------

/**
 * A small, keyboard-reachable explanation attached to a label.
 *
 * Native `title` alone is not reliably reachable by keyboard or announced consistently by
 * screen readers, so this pairs a focusable button with `aria-describedby` pointing at a
 * visually-hidden-until-shown description — the explanation is always in the DOM and always
 * programmatically associated, whether or not it happens to be visibly open.
 */
export function InfoTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line-strong text-[10px] leading-none text-muted hover:text-bone focus-visible:outline focus-visible:outline-2"
      >
        i
      </button>
      <span
        id={id}
        role="tooltip"
        className={
          open
            ? 'absolute bottom-full left-1/2 z-30 mb-1.5 w-56 -translate-x-1/2 rounded-md border border-line-strong bg-surface-2 p-2 text-xs text-slate shadow-lg'
            : 'sr-only'
        }
      >
        {children}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Market status
// ---------------------------------------------------------------------------

export type MarketStatusTone = 'ready' | 'needs_evidence' | 'needs_classification' | 'incomplete';

const STATUS_STYLE: Record<MarketStatusTone, { tone: StatusTone; icon: StatusIconName }> = {
  ready: { tone: 'positive', icon: 'check' },
  needs_classification: { tone: 'warning', icon: 'alert' },
  needs_evidence: { tone: 'info', icon: 'clock' },
  incomplete: { tone: 'neutral', icon: 'dot' },
};

export function MarketStatus({ status, tone, size = 'sm' }: { status: string; tone: MarketStatusTone; size?: 'sm' | 'md' }) {
  const style = STATUS_STYLE[tone];
  return <StatusChip label={status} tone={style.tone} icon={style.icon} size={size} />;
}

// ---------------------------------------------------------------------------
// Market table
// ---------------------------------------------------------------------------

export interface MarketRow {
  country_code: string;
  country: string;
  rank: number;
  attractiveness: number | null;
  confidence: number;
  status: string;
  status_tone: MarketStatusTone;
  /** Rendered in the last cell — a link, an overflow menu, or nothing. */
  action?: React.ReactNode;
  /** Shown beside the AI rank when a human has ruled on this market. */
  decision?: React.ReactNode;
}

/**
 * The market list.
 *
 * Wide screens get a table; narrow ones get cards carrying the same facts, because dropping
 * columns on mobile would mean the phone user is shown a different analysis. The table scrolls
 * inside its own container so the page body never scrolls sideways.
 */
export function MarketTable({ rows, href, caption }: {
  rows: readonly MarketRow[];
  /** Builds the destination for a market; omit to render the name as plain text. */
  href?: (row: MarketRow) => string;
  caption: string;
}) {
  const name = (row: MarketRow) =>
    href ? <Link href={href(row)} className="font-medium text-bone hover:underline">{row.country}</Link>
      : <span className="font-medium text-bone">{row.country}</span>;

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line-strong">
              <th scope="col" className="w-16 py-2.5 text-left text-xs font-medium text-muted">Rank</th>
              <th scope="col" className="py-2.5 text-left text-xs font-medium text-muted">Market</th>
              <th scope="col" className="w-32 py-2.5 text-right text-xs font-medium text-muted">Attractiveness</th>
              <th scope="col" className="w-32 py-2.5 text-right text-xs font-medium text-muted">Evidence coverage</th>
              <th scope="col" className="py-2.5 text-left text-xs font-medium text-muted">Status</th>
              <th scope="col" className="w-24 py-2.5 text-right text-xs font-medium text-muted">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.country_code} className="border-b border-line last:border-0">
                <td className="py-3 align-middle text-slate">#{row.rank}</td>
                <td className="py-3 align-middle">
                  {name(row)}
                  {row.decision ? <div className="mt-0.5">{row.decision}</div> : null}
                </td>
                <td className="py-3 text-right align-middle">
                  {row.attractiveness == null
                    ? <span className="text-sm text-slate">Not rankable</span>
                    : <span className="text-lg font-medium text-bone">{row.attractiveness}</span>}
                </td>
                <td className="py-3 text-right align-middle text-sm text-slate">{row.confidence}% coverage</td>
                <td className="py-3 align-middle"><MarketStatus status={row.status} tone={row.status_tone} /></td>
                <td className="py-3 text-right align-middle">{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.country_code}>
            <Card as="article" inset="md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted">#{row.rank}</p>
                  {name(row)}
                  {row.decision ? <div className="mt-1">{row.decision}</div> : null}
                </div>
                <div className="shrink-0 text-right">
                  {row.attractiveness == null
                    ? <p className="text-sm text-slate">Not rankable</p>
                    : <p className="text-xl font-medium text-bone">{row.attractiveness}</p>}
                  <p className="text-xs text-muted">{row.confidence}% evidence coverage</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <MarketStatus status={row.status} tone={row.status_tone} />
                {row.action}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// Overflow menu
// ---------------------------------------------------------------------------

export interface OverflowItem {
  key: string;
  label: string;
  onSelect: () => void;
  hint?: string;
}

/**
 * Secondary actions, behind one control.
 *
 * The surface this replaces rendered nine buttons per market row unconditionally, including
 * pairs that cannot both be valid. Callers now pass only the actions that make sense for the
 * row's current state, and everything beyond the one or two primary moves lives in here.
 *
 * `<details>` gives keyboard operation, focus handling and escape-to-close without a
 * dialog library, and degrades to an open list if scripting fails.
 */
export function OverflowMenu({ label = 'More actions', items }: { label?: string; items: readonly OverflowItem[] }) {
  if (!items.length) return null;
  return (
    <details className="relative inline-block text-left">
      <summary
        className="inline-flex h-8 min-w-8 cursor-pointer select-none items-center justify-center rounded-sm border border-line-strong px-2 text-sm text-slate marker:content-none hover:text-bone focus-visible:outline focus-visible:outline-2"
        aria-label={label}
      >
        <span aria-hidden="true">•••</span>
      </summary>
      <ul className="absolute right-0 z-20 mt-1 w-60 rounded-md border border-line-strong bg-surface-2 p-1 shadow-lg">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={item.onSelect}
              className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-bone hover:bg-surface focus-visible:outline focus-visible:outline-2"
            >
              {item.label}
              {item.hint ? <span className="block text-xs text-muted">{item.hint}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Work queue summary
// ---------------------------------------------------------------------------

/**
 * The counts an agent reads before any list.
 *
 * `needs_attention` is the headline rather than the total, because "12 need attention" is a
 * truthful statement about what is due while "80 outstanding" is a statement about how much
 * data exists. The total stays visible so nothing is hidden.
 */
export function WorkSummaryPanel({ total, needsAttention, byCategory, byCategoryBacklog, action }: {
  total: number;
  needsAttention: number;
  /** Category breakdown of the PRIORITISED count only — must sum to `needsAttention`, not `total`. */
  byCategory: ReadonlyArray<{ label: string; count: number }>;
  /** The remaining category totals, backlog included — only shown once the backlog is revealed. */
  byCategoryBacklog?: ReadonlyArray<{ label: string; count: number }>;
  action?: React.ReactNode;
}) {
  const backlog = total - needsAttention;
  return (
    <Card as="section">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-bone">ClearTrade work</h3>
          {/* Every number here is labelled with what it counts, so "20" and "60" are never read
              as two versions of the same total — one is what to do now, the other is deferred. */}
          <p className="mt-1 text-2xl font-medium text-bone">
            {needsAttention} <span className="text-sm font-normal text-slate">prioritised {needsAttention === 1 ? 'task' : 'tasks'}</span>
          </p>
          {backlog > 0 ? (
            <p className="mt-0.5 text-sm text-slate">
              {backlog} in <span className="font-medium text-bone">backlog</span>
              <span className="text-xs text-muted"> — for markets nobody has prioritised yet</span>
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {byCategory.length ? (
        <>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Prioritised now</p>
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {byCategory.map((entry) => (
              <div key={entry.label} className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
                <dt className="text-sm text-slate">{entry.label}</dt>
                <dd className="text-sm font-medium text-bone">{entry.count}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="mt-3 text-sm text-slate">Nothing prioritised for ClearTrade on this product yet.</p>
      )}
      {byCategoryBacklog?.length ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted marker:content-none">
            All markets, including backlog ({total})
          </summary>
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {byCategoryBacklog.map((entry) => (
              <div key={entry.label} className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
                <dt className="text-sm text-slate">{entry.label}</dt>
                <dd className="text-sm font-medium text-bone">{entry.count}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </Card>
  );
}
