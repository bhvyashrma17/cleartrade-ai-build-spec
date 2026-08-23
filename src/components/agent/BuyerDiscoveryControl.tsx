/**
 * Buyer Discovery control surface — three layers, never collapsed.
 *
 *   A. AI recommendation      what the model concluded, read verbatim
 *   B. Canonical state        what ClearTrade is operationally doing
 *   C. Agent decision         immutable human intent, with full history
 *
 * "Selection: On shortlist" and "Pipeline: Contacted" appear side by side because they are
 * different facts about the same buyer. There is no combined status anywhere in this file, and
 * no "effective score" — the operational order column states which side its number came from.
 *
 * Evidence is presented apart from model components: `Volume fit` is the model's conclusion,
 * `12-month shipments` is a fact it drew on. Listing them together would imply the model
 * consumed each raw signal directly.
 */

import type { BuyerControlRow } from '@/lib/buyer-control';
import { StatusChip } from '@/components/ui';
import { BuyerDecisionControls } from '@/components/agent/BuyerDecisionControls';

const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(n));
const fmtDate = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d) : '—';
const titleize = (s: string | null) => (s ? s.replaceAll('_', ' ') : '—');

/** Terminal buyers show "—", never a manufactured position. */
function OperationalOrderCell({ row }: { row: BuyerControlRow }) {
  if (row.operationalOrder === null) {
    return (
      <div>
        <span className="font-semibold text-[var(--color-text-muted)]">—</span>
        <div className="text-xs text-[var(--color-text-muted)]">Excluded</div>
      </div>
    );
  }
  const source = row.current?.agent_priority != null ? 'agent priority' : 'AI position';
  return (
    <div>
      <span className="font-semibold text-primary">{row.operationalOrder}</span>
      <div className="text-xs text-[var(--color-text-muted)]">from {source}</div>
    </div>
  );
}

/** B. Canonical state — selection and pipeline shown as the separate facts they are. */
function CanonicalCell({ row }: { row: BuyerControlRow }) {
  const c = row.canonical;
  return (
    <div className="space-y-1 text-xs">
      <div>
        <span className="text-[var(--color-text-muted)]">Selection: </span>
        <span className={c.onShortlist ? 'font-medium text-primary' : 'text-[var(--color-text-secondary)]'}>
          {c.onShortlist ? 'On shortlist' : 'Not on shortlist'}
        </span>
      </div>
      <div>
        <span className="text-[var(--color-text-muted)]">Pipeline: </span>
        {c.leadStage ? (
          <span className="font-medium text-primary">{titleize(c.leadStage)}</span>
        ) : (
          // Not "not contacted" — this buyer has never entered the pipeline at all.
          <span className="text-[var(--color-text-secondary)]">No lead yet</span>
        )}
      </div>
      {c.disqualificationReason ? (
        <div>
          <span className="text-[var(--color-text-muted)]">Disqualified: </span>
          <span className="text-critical">{titleize(c.disqualificationReason)}</span>
        </div>
      ) : null}
      <div>
        <span className="text-[var(--color-text-muted)]">Outreach: </span>
        {c.outreach ? (
          <span className="text-[var(--color-text-secondary)]">
            {c.outreach.attemptCount} attempt{c.outreach.attemptCount === 1 ? '' : 's'}
            {c.outreach.lastAttemptStatus ? ` · ${titleize(c.outreach.lastAttemptStatus)}` : ''}
            {c.outreach.lastContactAt ? ` · last ${fmtDate(c.outreach.lastContactAt)}` : ''}
          </span>
        ) : (
          // No lead means no canonical outreach state. Never derived from an AgentDecision,
          // which records intent rather than delivery.
          <span className="text-[var(--color-text-muted)]">Not applicable — no lead</span>
        )}
      </div>
    </div>
  );
}

/** C. Agent decision — current state only; full chain lives in the history panel. */
function DecisionCell({ row }: { row: BuyerControlRow }) {
  const decision = row.current ?? row.latest;
  if (!decision) return <span className="text-xs text-[var(--color-text-muted)]">No agent decision</span>;
  const stale = !row.current;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip
          label={titleize(decision.action)}
          tone={row.bucket === 'terminal' ? 'critical' : row.bucket === 'flagged' ? 'warning' : 'positive'}
          icon={row.bucket === 'terminal' ? 'block' : row.bucket === 'flagged' ? 'pause' : 'check'}
          size="sm"
        />
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

/** A. AI recommendation — components and provenance, exactly as persisted. */
function AiPanel({ row }: { row: BuyerControlRow }) {
  const p = row.provenance;
  return (
    <div>
      <h5 className="text-xs font-semibold text-primary">AI recommendation</h5>
      <p className="text-xs text-[var(--color-text-muted)]">What the model concluded. Read-only.</p>
      <table className="mt-1.5 w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-[var(--color-text-secondary)]">
            <th scope="col" className="py-1 font-medium">Component</th>
            <th scope="col" className="py-1 text-right font-medium">Score</th>
          </tr>
        </thead>
        <tbody>
          {row.components.map((c) => (
            <tr key={c.key} className="border-t border-[var(--color-border)]">
              <td className="py-1 text-primary">
                {c.label}
                {c.score === null ? (
                  // A gap is shown as a gap. Rendering it as 0 would read as a genuine score.
                  <div className="text-[var(--color-text-muted)]">
                    Not computed{c.unavailableReason ? `: ${c.unavailableReason}` : '.'}
                  </div>
                ) : null}
              </td>
              <td className="py-1 text-right text-primary">{num(c.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {([
          ['Model', p.modelVersion],
          ['Confidence', String(p.confidenceScore)],
          ['Computed', fmtDate(p.computedAt)],
          ['Evidence origins', p.evidenceOrigins.join(', ') || '—'],
          // Legacy assessments predate policy capture. Shown as unknown, never back-filled
          // with today's policy, which would claim a provenance we cannot prove.
          ['Policy version', p.scoringPolicyVersion != null ? `v${p.scoringPolicyVersion}` : 'Unknown (legacy)'],
          ['Policy hash', p.scoringPolicyHash ? `${p.scoringPolicyHash.slice(0, 12)}…` : 'Unknown (legacy)'],
          ['Reproducibility', titleize(p.reproducibilityStatus)],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label}>
            <dt className="text-[var(--color-text-muted)]">{label}</dt>
            <dd className="break-words text-primary">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Supporting evidence — explicitly NOT model components. */
function EvidencePanel({ row }: { row: BuyerControlRow }) {
  const e = row.evidence;
  const rows: [string, string][] = [
    ['12-month shipments', num(e.shipmentCount12m)],
    ['Last shipment', fmtDate(e.lastShipmentDate)],
    ['Import frequency / yr', e.importFrequencyPerYear ?? '—'],
    ['Typical shipment size', e.typicalShipmentSize ? `${e.typicalShipmentSize} ${e.quantityUnit ?? ''}`.trim() : '—'],
    ['India sourcing history', e.indiaSourcingHistory === null ? 'Unknown' : e.indiaSourcingHistory ? 'Yes' : 'No'],
    ['Purchasing trend', e.purchasingTrend ?? '—'],
    ['Supplier concentration', e.supplierConcentration ?? '—'],
    ['Source evidence rows', String(e.sourceEvidenceCount)],
    ['Features computed', fmtDate(e.featureComputedAt)],
  ];
  return (
    <div>
      <h5 className="text-xs font-semibold text-primary">Supporting evidence</h5>
      <p className="text-xs text-[var(--color-text-muted)]">
        Facts about the buyer. These are inputs and context — not the model&rsquo;s components above.
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[var(--color-text-muted)]">{label}</dt>
            <dd className="text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-xs">
        <span className="text-[var(--color-text-muted)]">Sanctions: </span>
        {e.sanctions ? (
          <span className={e.sanctions.resultState === 'clear' ? 'text-primary' : 'text-critical'}>
            {titleize(e.sanctions.resultState)} · {e.sanctions.algorithmVersion} · {fmtDate(e.sanctions.screenedAt)}
          </span>
        ) : (
          <span className="text-[var(--color-text-muted)]">Not screened</span>
        )}
      </p>
    </div>
  );
}

/**
 * C. Decision history.
 *
 * Every entry carries the model values FROZEN at that decision. BuyerFitAssessment is updated
 * in place, so the current assessment cannot tell you what an agent was looking at last month —
 * these columns are the only surviving record, and are never reconstructed from live data.
 */
function DecisionHistory({ row }: { row: BuyerControlRow }) {
  if (row.history.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)]">No decisions recorded yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {row.history.map((entry) => {
        const frozen = entry.original_components as Record<string, { score?: number | null }> | null;
        return (
          <li key={entry.id} className="border-l-2 border-[var(--color-border)] pl-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-primary">{titleize(entry.action)}</span>
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
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              AI at decision time: score {num(entry.original_score)} · confidence{' '}
              {num(entry.original_confidence_score)}
              {entry.original_model_version ? ` · ${entry.original_model_version}` : ''}
              {entry.original_policy_version != null ? ` · policy v${entry.original_policy_version}` : ' · policy unknown'}
              {entry.original_computed_at ? ` · computed ${fmtDate(entry.original_computed_at)}` : ''}
            </p>
            {frozen ? (
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                Frozen components:{' '}
                {Object.entries(frozen)
                  .map(([key, value]) => `${key.replaceAll('_', ' ')} ${value?.score ?? '—'}`)
                  .join(' · ')}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function BuyerDiscoveryControl({
  rows,
  showAll,
  totalCount,
}: {
  rows: BuyerControlRow[];
  showAll: boolean;
  totalCount: number;
}) {
  if (totalCount === 0) {
    return (
      <p className="rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">
        No BuyerFit assessments for this exporter yet. Buyers appear here once buyer intelligence has run.
      </p>
    );
  }
  const excluded = totalCount - rows.filter((r) => r.bucket !== 'terminal').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-text-secondary)]">
          {rows.length} of {totalCount} buyer{totalCount === 1 ? '' : 's'}
          {excluded > 0 ? ` · ${excluded} excluded by an agent decision` : ''}
        </p>
        <a
          href={`?tab=buyers&view=${showAll ? 'active' : 'all'}`}
          className="focus-visible-ring rounded text-xs font-medium text-primary underline underline-offset-2"
        >
          {showAll ? 'Show active only' : `Show all (including ${excluded} excluded)`}
        </a>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-surface shadow-card">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-paper-sunk">
              <th scope="col" className="eyebrow px-3 py-2 text-left text-ink-500">Buyer</th>
              {/* Group A */}
              <th scope="col" className="eyebrow px-3 py-2 text-right text-ink-500">AI score</th>
              <th scope="col" className="eyebrow px-3 py-2 text-right text-ink-500">Confidence</th>
              <th scope="col" className="eyebrow px-3 py-2 text-right text-ink-500">AI position</th>
              {/* Ordering */}
              <th scope="col" className="eyebrow px-3 py-2 text-left text-ink-500">Operational order</th>
              {/* Group B */}
              <th scope="col" className="eyebrow px-3 py-2 text-left text-ink-500">Canonical state</th>
              {/* Group C */}
              <th scope="col" className="eyebrow px-3 py-2 text-left text-ink-500">Agent decision</th>
              <th scope="col" className="eyebrow px-3 py-2 text-left text-ink-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.fitId}
                className={`border-t border-[var(--color-border)] align-top ${row.bucket === 'terminal' ? 'opacity-70' : ''}`}
              >
                <td className="px-3 py-3">
                  <div className="font-medium text-primary">{row.buyerName}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {row.countryCode}
                    {row.lastMeaningfulActivityAt ? ` · active ${fmtDate(row.lastMeaningfulActivityAt)}` : ''}
                  </div>
                </td>
                <td className="px-3 py-3 text-right text-primary">{num(row.fit.score)}</td>
                <td className="px-3 py-3 text-right text-[var(--color-text-secondary)]">{num(row.fit.confidence_score)}</td>
                <td className="px-3 py-3 text-right text-[var(--color-text-secondary)]">{num(row.modelRank)}</td>
                <td className="px-3 py-3"><OperationalOrderCell row={row} /></td>
                <td className="px-3 py-3"><CanonicalCell row={row} /></td>
                <td className="px-3 py-3"><DecisionCell row={row} /></td>
                <td className="px-3 py-3">
                  <BuyerDecisionControls assessmentId={row.fitId} buyerName={row.buyerName} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <summary className="cursor-pointer text-sm font-semibold text-primary">
          Evidence, provenance and decision history
        </summary>
        <div className="mt-3 space-y-6">
          {rows.map((row) => (
            <section key={row.fitId} className="border-t border-[var(--color-border)] pt-3 first:border-t-0 first:pt-0">
              <h4 className="text-sm font-semibold text-primary">
                {row.buyerName}
                <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                  {row.countryCode} · AI score {num(row.fit.score)}
                </span>
              </h4>
              <div className="mt-2 grid gap-4 md:grid-cols-2">
                <AiPanel row={row} />
                <EvidencePanel row={row} />
              </div>
              <div className="mt-3">
                <h5 className="text-xs font-semibold text-primary">Decision history</h5>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Superseded and expired decisions stay listed. Each shows what the model said at
                  that moment, which the current assessment can no longer tell you.
                </p>
                <div className="mt-1.5"><DecisionHistory row={row} /></div>
              </div>
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}
