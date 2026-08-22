'use client';

/**
 * EXP-04 Demand Discovery input + run state.
 *
 * Guest tier types product context straight in (description + HS code) and no Product
 * row is created for them. Free/paid pick a saved product. The tier boundary is shown,
 * never merely implied by a missing control (docs/03 §5).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Input, Skeleton, StatusChip, UpgradeNotice } from '@/components/ui';
import { ApiClientError, apiGet, apiPost } from '@/lib/api-client';
import { useJobPoll } from '@/hooks';
import type { ListResponse } from '@/types';
import {ProductClassificationForm} from '@/components/agent/ProductClassificationForm';

type Tier = 'guest' | 'free' | 'paid';

interface ProductOption {
  id: string;
  name: string;
  hs_code: string | null;
  hs_classification_status:string|null;
}

interface RecentRun {
  id: string;
  status: string;
  created_at: string;
  label: string;
}

interface RunAccepted {
  job_id: string | null;
  status: string;
  target: { type: string; id: string };
  meta?: {
    tier?: Tier;
    guest_session_started?: boolean;
    runs_used?: number;
    runs_limit?: number;
    resets_at?: string;
  };
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'accepted'; result: RunAccepted }
  | { kind: 'blocked'; message: string; requiredTier: 'free' | 'paid' }
  | { kind: 'error'; message: string; fields: Record<string, string> };

export function DemandDiscovery({
  tier,
  products,
  recentRuns,
  guestRunLimit,
  latestRun,
}: {
  tier: Tier;
  products: ProductOption[];
  recentRuns: RecentRun[];
  guestRunLimit: number;
  /** Most recent run for this tenant, so leaving and returning resumes it (docs/09 §3). */
  latestRun: { runId: string; jobId: string } | null;
}) {
  const isGuest = tier === 'guest';
  const [productId, setProductId] = useState('');
  const [description, setDescription] = useState('');
  const [hsCode, setHsCode] = useState('');
  // Seeded from the server so a returning user picks up whatever was last running or
  // finished, instead of an empty page that silently discards their search.
  const [phase, setPhase] = useState<Phase>(
    latestRun
      ? { kind: 'accepted', result: { job_id: latestRun.jobId, status: 'queued', target: { type: 'discovery_run', id: latestRun.runId } } }
      : { kind: 'idle' },
  );

  const useAdHoc = isGuest || products.length === 0;

  async function run() {
    setPhase({ kind: 'running' });
    try {
      const payload = useAdHoc
        ? { product_description: description.trim(), hs_code: hsCode.trim() || undefined }
        : { product_id: productId };
      const result = await apiPost<RunAccepted>('/api/v1/discovery-runs', payload);
      setPhase({ kind: 'accepted', result });
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.code === 'UPGRADE_REQUIRED' || error.code === 'RATE_LIMITED') {
          setPhase({
            kind: 'blocked',
            message: error.message,
            requiredTier: error.code === 'RATE_LIMITED' ? 'free' : 'paid',
          });
          return;
        }
        setPhase({
          kind: 'error',
          message: error.message,
          fields: Object.fromEntries((error.fields ?? []).map((f) => [f.field, f.message])),
        });
        return;
      }
      setPhase({ kind: 'error', message: 'Could not start the search. Please retry.', fields: {} });
    }
  }

  // Polled here, not inside RunProgress, so this component knows whether a job is still
  // active and can disable the form — "prevent duplicate submissions" (docs/03 §7) has
  // to live where the submit button is, not one level down.
  const activeJobId = phase.kind === 'accepted' ? phase.result.job_id : null;
  const { job: activeJob, error: jobError } = useJobPoll(activeJobId);
  const jobIsActive = Boolean(activeJobId) && activeJob != null && !isTerminalStatus(activeJob.status);
  // Before the first poll response lands, assume active — a queued job that hasn't been
  // polled yet must still block a second submit.
  const jobPending = Boolean(activeJobId) && activeJob == null;

  const fieldErrors = phase.kind === 'error' ? phase.fields : {};
  const submitting = phase.kind === 'running';
  const locked = submitting || jobIsActive || jobPending;
  const canSubmit = (useAdHoc ? description.trim().length >= 3 : Boolean(productId)) && !locked;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <h1 className="font-serif text-title-page text-primary">Find your best export markets</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Tell us what you make. We rank destination countries by demand, tariffs, competition and
          logistics — with the reasoning shown, not just a score.
        </p>
      </header>

      {isGuest ? (
        <div className="mb-5 rounded-lg border border-[var(--color-info)]/30 bg-[var(--color-info)]/5 p-4 text-sm">
          <p className="font-normal text-primary">
            You&rsquo;re browsing as a guest — no account needed.
          </p>
          <p className="mt-1 text-[var(--color-text-secondary)]">
            You get {guestRunLimit} free searches. Results aren&rsquo;t saved to a history you can
            come back to, and buyer contact details stay hidden.{' '}
            <Link href="/register" className="font-semibold text-primary underline underline-offset-2">
              Create a free account
            </Link>{' '}
            to keep your searches and unlock contacts — anything you search now carries over.
          </p>
        </div>
      ) : null}

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        {useAdHoc ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-primary">
                What do you export?
              </label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Organic turmeric powder, food grade"
                error={fieldErrors.product_description}
              />
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                A plain description is enough — you don&rsquo;t need to know the customs code.
              </p>
            </div>
            <div>
              <label htmlFor="hs" className="mb-1.5 block text-sm font-medium text-primary">
                HS code <span className="font-normal text-[var(--color-text-secondary)]">(optional)</span>
              </label>
              <Input
                id="hs"
                value={hsCode}
                onChange={(e) => setHsCode(e.target.value)}
                placeholder="091030"
                inputMode="numeric"
                error={fieldErrors.hs_code}
              />
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                The tariff classification for your product. Add it if you know it — it sharpens the
                tariff and duty figures.
              </p>
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="product" className="mb-1.5 block text-sm font-medium text-primary">
              Product
            </label>
            <select
              id="product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="focus-visible-ring block w-full rounded border border-[var(--color-border-strong)] bg-surface px-3 py-2 text-sm text-primary"
            >
              <option value="">Choose a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.hs_code ? ` · HS ${p.hs_code}` : ''}
                </option>
              ))}
            </select>
            {productId?<ProductClassificationForm productId={productId} status={products.find(product=>product.id===productId)?.hs_classification_status??null} method="exporter_supplied"/>:null}
          </div>
        )}

        {phase.kind === 'error' && !Object.keys(fieldErrors).length ? (
          <p role="alert" className="mt-3 text-sm text-critical">
            {phase.message}
          </p>
        ) : null}

        <Button onClick={run} disabled={!canSubmit} className="mt-5 w-full sm:w-auto">
          {submitting ? 'Starting search…' : 'Find markets'}
        </Button>
        {jobIsActive || jobPending ? (
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            A search is already running below — wait for it to finish before starting another.
          </p>
        ) : null}
      </section>

      {phase.kind === 'accepted' ? (
        <RunProgress
          job={activeJob}
          pollError={jobError}
          runId={phase.result.target.id}
          quota={
            phase.result.meta?.runs_limit
              ? { used: phase.result.meta.runs_used ?? 0, limit: phase.result.meta.runs_limit }
              : null
          }
          onRetry={run}
        />
      ) : null}

      {phase.kind === 'blocked' ? (
        <div className="mt-5">
          <UpgradeNotice
            title="You&rsquo;ve used your free searches"
            description={phase.message}
            requiredTier={phase.requiredTier}
          />
        </div>
      ) : null}

      {/* Saved history is a free-tier feature. Guests see the boundary explained rather
          than an unexplained absence. */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Your recent searches
        </h2>
        {isGuest ? (
          <UpgradeNotice
            title="Searches aren't saved for guests"
            description="Create a free account and your search history is kept — including the searches you've already run in this session."
            requiredTier="free"
          />
        ) : recentRuns.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-6 text-center text-sm text-[var(--color-text-secondary)]">
            No searches yet. Run one above and it will be saved here.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-surface">
            {recentRuns.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="text-primary">{r.label}</span>
                <span className="text-xs text-[var(--color-text-secondary)]">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job progress + results
// ---------------------------------------------------------------------------

interface AssessmentRow {
  id: string;
  country_code: string;
  overall_score: number;
  demand_score: number | null;
  growth_score: number | null;
  competition_score: number | null;
  rationale: string | null;
  price_band: { min: string; max: string | null; currency: string | null } | null;
  evidence_warning?: string;
}

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => {
  try {
    return REGION_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
};

const TERMINAL_JOB_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);
function isTerminalStatus(status: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

/**
 * Renders every job state docs/09 §3 requires, not just the happy path:
 * queued, processing (with progress), completed, partial (results + what's missing),
 * failed (human-safe message + correlation id + retry), cancelled.
 */
function RunProgress({
  job,
  pollError,
  runId,
  quota,
  onRetry,
}: {
  job: ReturnType<typeof useJobPoll>['job'];
  pollError: string | null;
  runId: string;
  quota: { used: number; limit: number } | null;
  onRetry: () => void;
}) {
  const error = pollError;
  const [rows, setRows] = useState<AssessmentRow[] | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);

  const status = job?.status ?? 'queued';
  const finished = status === 'completed' || status === 'partial';

  // Results are fetched once the job finishes — not on every poll, which would re-send
  // the whole ranking repeatedly.
  useEffect(() => {
    if (!finished || rows || loadingRows) return;
    setLoadingRows(true);
    apiGet<ListResponse<AssessmentRow>>(`/api/v1/discovery-runs/${runId}/market-assessments`)
      .then((res) => setRows(res.data))
      .catch(() => setRows([]))
      .finally(() => setLoadingRows(false));
  }, [finished, runId, rows, loadingRows]);

  const result = job?.result as { provenance?: { note?: string }; missing?: string[] } | null;

  return (
    <section className="mt-5 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        {status === 'queued' ? (
          <StatusChip label="Search queued" tone="info" icon="clock" size="sm" />
        ) : status === 'processing' ? (
          <StatusChip label={`Searching markets — ${job?.progress ?? 0}%`} tone="info" icon="clock" size="sm" />
        ) : status === 'completed' ? (
          <StatusChip label="Markets ranked" tone="positive" icon="check" size="sm" />
        ) : status === 'partial' ? (
          <StatusChip label="Ranked, with gaps" tone="warning" icon="alert" size="sm" />
        ) : status === 'cancelled' ? (
          <StatusChip label="Search cancelled" tone="neutral" icon="x" size="sm" />
        ) : (
          <StatusChip label="Search failed" tone="critical" icon="x" size="sm" />
        )}

        {!finished && status !== 'failed' && status !== 'cancelled' ? (
          <span className="text-sm text-[var(--color-text-secondary)]">
            You can leave this page — we&rsquo;ll keep working and the result will be here when you
            come back.
          </span>
        ) : null}
      </div>

      {status === 'processing' ? (
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded bg-surface-muted"
          role="progressbar"
          aria-valuenow={job?.progress ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-action transition-all" style={{ width: `${job?.progress ?? 0}%` }} />
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-critical">{error}</p> : null}

      {status === 'failed' ? (
        <div className="mt-3 text-sm">
          {/* Human-safe message, reference id, and a retry — docs/09 §3 failed-state row. */}
          <p className="text-[var(--color-text-secondary)]">
            {job?.error?.message ?? 'We could not complete this search.'}
          </p>
          {job?.correlation_id ? (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Reference: <span className="record">{job.correlation_id}</span></p>
          ) : null}
          <Button onClick={onRetry} className="mt-3">
            Try again
          </Button>
        </div>
      ) : null}

      {/* `partial` renders what came back AND names what didn't — never silently short. */}
      {status === 'partial' && result?.missing?.length ? (
        <ul className="mt-3 list-inside list-disc text-sm text-[var(--color-text-secondary)]">
          {result.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}

      {quota ? (
        <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
          Free search {quota.used} of {quota.limit} used.
        </p>
      ) : null}

      {finished ? (
        <div className="mt-5">
          {loadingRows && !rows ? (
            <Skeleton variant="text" lines={3} />
          ) : rows && rows.length > 0 ? (
            <>
              <ol className="space-y-3">
                {rows.map((row, index) => (
                  <li key={row.id}>
                    <Link
                      href={`/app/markets/${row.id}`}
                      className="focus-visible-ring block rounded-lg border border-[var(--color-border)] bg-surface-muted p-4 transition duration-fast hover:border-[var(--color-action)]/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="text-sm font-semibold text-primary">
                            {index + 1}. {countryName(row.country_code)}
                          </span>
                          <span className="ml-2 text-xs text-[var(--color-text-secondary)]">
                            {row.country_code}
                          </span>
                        </div>
                        <span className="shrink-0 text-sm font-bold text-primary">
                          {row.overall_score}
                          <span className="text-xs font-normal text-[var(--color-text-secondary)]">/100</span>
                        </span>
                      </div>
                      {row.rationale ? (
                        <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">{row.rationale}</p>
                      ) : null}
                      {row.evidence_warning ? <p className="mt-2 rounded border border-warning bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] px-2 py-1 text-xs font-normal text-primary">Test evidence · {row.evidence_warning}</p> : null}
                      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                        {row.demand_score != null ? (
                          <div>
                            <dt className="inline">Demand </dt>
                            <dd className="inline font-medium text-primary">{row.demand_score}</dd>
                          </div>
                        ) : null}
                        {row.growth_score != null ? (
                          <div>
                            <dt className="inline">Growth </dt>
                            <dd className="inline font-medium text-primary">{row.growth_score}</dd>
                          </div>
                        ) : null}
                        {row.competition_score != null ? (
                          <div>
                            <dt className="inline">Competition </dt>
                            <dd className="inline font-medium text-primary">{row.competition_score}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </Link>
                  </li>
                ))}
              </ol>
              {/* docs/00 §6: AI output is always labelled as generated, never presented
                  as researched fact. */}
              {result?.provenance?.note ? (
                <p className="mt-4 rounded border border-[var(--color-info)]/30 bg-[var(--color-info)]/5 px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                  {result.provenance.note}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No markets matched this search. Try a broader product description.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
