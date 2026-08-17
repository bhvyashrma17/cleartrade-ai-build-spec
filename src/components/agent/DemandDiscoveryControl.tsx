/**
 * Demand Discovery control surface — the AI recommendation and the agent decision, side by
 * side, never merged.
 *
 * The interface rule this component exists to hold: **two distinct concepts, always both
 * visible.** The left group is what the model produced (rank, score, components, weights,
 * confidence, provenance, policy identity). The right group is what a human decided (action,
 * operational priority, reason, actor, timestamp, state). "Operational order" appears as its
 * own labelled column and is never called an effective score or an effective AI rank — it is a
 * workflow position, and the number it happens to equal is stated next to it.
 *
 * Every value here is read from `MarketAssessment` and `AgentDecision` as stored. Nothing is
 * recomputed — weights least of all, since renormalisation is a decision the scoring engine
 * made per assessment and re-deriving it would produce a number that merely resembles the one
 * that made the score.
 */

import type { MarketControlRow } from '@/lib/demand-control';
import { StatusChip } from '@/components/ui';
import { MarketDecisionControls } from '@/components/agent/MarketDecisionControls';

const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
const num = (n: number | null) => (n === null ? '—' : String(n));
const fmtDate = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d) : '—';

/** Terminal candidates show "—", never a manufactured position. */
function OperationalOrderCell({ row }: { row: MarketControlRow }) {
  if (row.operationalOrder === null) {
    return (
      <div>
        <span className="font-semibold text-[var(--color-text-muted)]">—</span>
        <div className="text-xs text-[var(--color-text-muted)]">Excluded</div>
      </div>
    );
  }
  // Say WHERE the number came from, so the column is never mistaken for a score.
  const source = row.current?.agent_priority != null ? 'agent priority' : 'AI rank';
  return (
    <div>
      <span className="font-semibold text-primary">{row.operationalOrder}</span>
      <div className="text-xs text-[var(--color-text-muted)]">from {source}</div>
    </div>
  );
}

function DecisionCell({ row }: { row: MarketControlRow }) {
  const decision = row.current ?? row.latest;
  if (!decision) {
    return <span className="text-xs text-[var(--color-text-muted)]">No agent decision</span>;
  }
  const stale = !row.current;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip
          label={decision.action.replaceAll('_', ' ')}
          tone={row.bucket === 'terminal' ? 'critical' : row.bucket === 'flagged' ? 'warning' : 'positive'}
          icon={row.bucket === 'terminal' ? 'block' : row.bucket === 'flagged' ? 'pause' : 'check'}
          size="sm"
        />
        {/* A lapsed decision is shown as lapsed rather than hidden — otherwise an expired
            instruction is indistinguishable from none ever having been made. */}
        {stale ? (
          <StatusChip label={decision.state} tone="neutral" icon="clock" size="sm" detail="No longer in force." />
        ) : null}
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">{decision.reason}</p>
      <p className="text-xs text-[var(--color-text-muted)]">
        {decision.agent_priority != null ? `Priority ${decision.agent_priority} · ` : ''}
        {fmtDate(decision.created_at)}
        {decision.expires_at ? ` · expires ${fmtDate(decision.expires_at)}` : ''}
      </p>
    </div>
  );
}

/** The eight components with their score and BOTH weights, plus any unavailable reason. */
function ComponentBreakdown({ row }: { row: MarketControlRow }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="text-left text-[var(--color-text-secondary)]">
          <th scope="col" className="py-1 font-medium">Component</th>
          <th scope="col" className="py-1 text-right font-medium">Score</th>
          <th scope="col" className="py-1 text-right font-medium">Base weight</th>
          <th scope="col" className="py-1 text-right font-medium">Effective weight</th>
        </tr>
      </thead>
      <tbody>
        {row.components.map((component) => (
          <tr key={component.field} className="border-t border-[var(--color-border)]">
            <td className="py-1 text-primary">
              {component.label}
              {component.unavailableReason ? (
                // The engine's own reason, verbatim. A missing component is never rendered as
                // a zero — that would read as a genuine score of zero.
                <div className="text-[var(--color-text-muted)]">Unavailable: {component.unavailableReason}</div>
              ) : null}
            </td>
            <td className="py-1 text-right text-primary">{num(component.score)}</td>
            <td className="py-1 text-right text-[var(--color-text-secondary)]">{num(component.baseWeight)}</td>
            <td className="py-1 text-right text-[var(--color-text-secondary)]">{pct(component.effectiveWeight)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Provenance({ row }: { row: MarketControlRow }) {
  const p = row.provenance;
  const items: [string, string][] = [
    ['Model', p.modelVersion],
    ['Weight profile', `${p.weightProfileKey} v${p.weightProfileVersion}`],
    ['Scoring policy', p.scoringPolicyVersion != null ? `v${p.scoringPolicyVersion}` : '—'],
    ['Policy hash', p.scoringPolicyHash ?? '—'],
    ['As of', fmtDate(p.asOfDate)],
    ['Generated', fmtDate(p.generatedAt)],
    ['Reproducibility', p.reproducibilityStatus],
    ['Evidence origins', p.evidenceOrigins.join(', ') || '—'],
    ['Eligibility', p.eligibilityStatus],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[var(--color-text-muted)]">{label}</dt>
          <dd className="break-words text-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}


/**
 * Full decision history for one market.
 *
 * Superseded and expired decisions stay listed with their state rather than disappearing —
 * they are the record of what was believed and when, and the frozen AI snapshot on each row is
 * what makes an override reviewable long after the assessment has been recomputed.
 */
function DecisionHistory({ row }: { row: MarketControlRow }) {
  if (row.history.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)]">No decisions recorded yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {row.history.map((entry) => (
        <li key={entry.id} className="border-l-2 border-[var(--color-border)] pl-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-primary">{entry.action.replaceAll('_', ' ')}</span>
            <StatusChip
              label={entry.state}
              tone={entry.state === 'active' ? 'positive' : 'neutral'}
              icon={entry.state === 'active' ? 'check' : 'clock'}
              size="sm"
              detail={entry.state === 'superseded' ? 'Replaced by a later decision.' : undefined}
            />
            {entry.agent_priority != null ? (
              <span className="text-xs text-[var(--color-text-secondary)]">priority {entry.agent_priority}</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{entry.reason}</p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {fmtDate(entry.created_at)}
            {entry.expires_at ? ` · expires ${fmtDate(entry.expires_at)}` : ''}
            {entry.supersedes_id ? ' · supersedes an earlier decision' : ''}
          </p>
          {/* What the model said at the moment of the decision — not what it says now. */}
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            AI at decision time: score {num(entry.original_score)} · rank {num(entry.original_rank)}
            {entry.original_model_version ? ` · ${entry.original_model_version}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function DemandDiscoveryControl({
  rows,
  showAll,
  runId,
}: {
  rows: MarketControlRow[];
  showAll: boolean;
  runId: string | null;
}) {
  if (!runId) {
    return (
      <p className="rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">
        No Demand Discovery run yet for this exporter. Scores appear here once a run completes.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">
        The latest run produced no market assessments.
      </p>
    );
  }

  const excluded = rows.filter((r) => r.bucket === 'terminal').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-text-secondary)]">
          {rows.length} market{rows.length === 1 ? '' : 's'} from the latest run
          {excluded > 0 ? ` · ${excluded} excluded by an agent decision` : ''}
        </p>
        {/* Server-driven toggle: the excluded set is a filter over the same data, not a
            different query shape. */}
        <a
          href={`?tab=demand&view=${showAll ? 'active' : 'all'}`}
          className="focus-visible-ring rounded text-xs font-medium text-primary underline underline-offset-2"
        >
          {showAll ? 'Show active only' : `Show all (including ${excluded} excluded)`}
        </a>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-surface shadow-card">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-[var(--color-text-inverse)]">
              <th scope="col" className="px-3 py-2 text-left font-medium">Market</th>
              {/* The two concepts are visually grouped and separately headed, so a reader can
                  never mistake one column's number for the other's. */}
              <th scope="col" className="px-3 py-2 text-right font-medium">AI rank</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">AI score</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Confidence</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Operational order</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Agent decision</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.assessment.id}
                className={`border-t border-[var(--color-border)] align-top ${row.bucket === 'terminal' ? 'opacity-70' : ''}`}
              >
                <td className="px-3 py-3">
                  <div className="font-medium text-primary">{row.assessment.country_code}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {row.assessment.eligibility_status}
                  </div>
                </td>
                <td className="px-3 py-3 text-right text-primary">{num(row.modelRank)}</td>
                <td className="px-3 py-3 text-right text-primary">{num(row.assessment.overall_score)}</td>
                <td className="px-3 py-3 text-right text-[var(--color-text-secondary)]">
                  {num(row.assessment.confidence_score)}
                </td>
                <td className="px-3 py-3"><OperationalOrderCell row={row} /></td>
                <td className="px-3 py-3"><DecisionCell row={row} /></td>
                <td className="px-3 py-3">
                  <MarketDecisionControls
                    assessmentId={row.assessment.id}
                    countryCode={row.assessment.country_code}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <summary className="cursor-pointer text-sm font-semibold text-primary">
          Component scores, weights and provenance
        </summary>
        <div className="mt-3 space-y-5">
          {rows.map((row) => (
            <section key={row.assessment.id}>
              <h4 className="text-sm font-semibold text-primary">
                {row.assessment.country_code}
                <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                  AI score {num(row.assessment.overall_score)} · AI rank {num(row.modelRank)}
                </span>
              </h4>
              <div className="mt-2"><ComponentBreakdown row={row} /></div>
              <div className="mt-2"><Provenance row={row} /></div>
              <div className="mt-3">
                <h5 className="text-xs font-semibold text-primary">Decision history</h5>
                <div className="mt-1"><DecisionHistory row={row} /></div>
              </div>
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}
