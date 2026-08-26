'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClientError, apiGet, apiPost } from '@/lib/api-client';
import { COUNTRY_TRUTH_PILOT_COUNTRIES, countryTruthStage, type CountryTruthAssessmentView, type MetricView } from '@/lib/country-truth-ui';
import { Button, StatusChip } from '@/components/ui';

type ProductOption = { id: string; name: string; classificationStatus: string; canRun: boolean };
type JobResponse = { data: { job_id: string; status: string; progress: number; progress_stage: string | null; result: { country_analysis?: { assessments: CountryTruthAssessmentView[] } } | null; error: { code: string; message: string | null } | null }; meta?: { poll_after_ms?: number | null; is_terminal?: boolean; is_partial?: boolean } };

function metricText(metric: MetricView, kind: 'money' | 'percent' | 'hhi') {
  if (metric.value == null) return metric.reason ? `Unavailable — ${metric.reason}` : 'Unavailable';
  if (kind === 'money') return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(metric.value);
  if (kind === 'percent') return `${metric.value.toFixed(1)}%`;
  return metric.value.toFixed(3);
}

export function CountryAnalysis({ exporterOrgId, products }: { exporterOrgId: string; products: ProductOption[] }) {
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [countries, setCountries] = useState<string[]>(COUNTRY_TRUTH_PILOT_COUNTRIES.map(country => country.name));
  const [job, setJob] = useState<JobResponse['data'] | null>(null);
  const [partial, setPartial] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedProduct = products.find(product => product.id === productId);
  const terminal = job ? ['completed', 'partial', 'failed', 'cancelled'].includes(job.status) : false;
  const canSubmit = Boolean(selectedProduct?.canRun && countries.length && !submitting && (!job || terminal));

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function poll(jobId: string) {
    try {
      const response = await apiGet<JobResponse>(`/api/v1/jobs/${jobId}`);
      setJob(response.data);
      setPartial(Boolean(response.meta?.is_partial));
      if (!response.meta?.is_terminal) timer.current = setTimeout(() => void poll(jobId), response.meta?.poll_after_ms ?? 1500);
    } catch {
      setError('We could not refresh this analysis. Check your connection and retry.');
    }
  }

  async function run() {
    if (!canSubmit) return;
    setSubmitting(true); setError(null); setNotice(null); setJob(null); setPartial(false);
    try {
      const response = await apiPost<{ data: { job_id: string; status: string; duplicate: boolean } }>(`/api/v1/exporters/${exporterOrgId}/country-truth-discovery`, { product_id: productId, candidate_countries: countries });
      setNotice(response.data.duplicate ? 'An active analysis already exists. Monitoring that run now.' : 'Country analysis queued.');
      setJob({ job_id: response.data.job_id, status: response.data.status, progress: 0, progress_stage: null, result: null, error: null });
      await poll(response.data.job_id);
    } catch (caught) {
      const fieldMessage = caught instanceof ApiClientError ? caught.fields?.find(field => field.field === 'product_id')?.message : null;
      setError(fieldMessage ?? (caught instanceof Error ? caught.message : 'Country analysis could not be started. Review the selections and retry.'));
    } finally { setSubmitting(false); }
  }

  const assessments = useMemo(() => job?.result?.country_analysis?.assessments ?? [], [job]);

  return <section aria-labelledby="country-analysis-heading" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
    <h2 id="country-analysis-heading" className="text-lg font-semibold text-primary">Country Analysis</h2>
    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Compare the pilot markets using verified trade evidence for one confirmed product classification.</p>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <label className="text-sm font-medium text-primary">Product
        <select value={productId} onChange={event => setProductId(event.target.value)} className="focus-visible-ring mt-1 block min-h-control w-full rounded-md border border-[var(--color-border)] bg-surface px-3">
          {products.length ? products.map(product => <option key={product.id} value={product.id}>{product.name} — {product.classificationStatus.replaceAll('_', ' ')}</option>) : <option value="">No products available</option>}
        </select>
      </label>
      <fieldset><legend className="text-sm font-medium text-primary">Candidate countries</legend><div className="mt-2 flex flex-wrap gap-4">
        {COUNTRY_TRUTH_PILOT_COUNTRIES.map(country => <label key={country.code} className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={countries.includes(country.name)} onChange={event => setCountries(current => event.target.checked ? [...current, country.name] : current.filter(value => value !== country.name))}/>{country.name}</label>)}
      </div></fieldset>
    </div>
    {!selectedProduct?.canRun ? <div role="alert" className="mt-4 rounded-md border border-[color-mix(in_srgb,var(--color-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] p-3 text-sm text-primary"><strong>Analysis blocked.</strong> Confirm a valid HS 2022 or ITC-HS classification for this product before running country analysis.</div> : null}
    {notice ? <p role="status" className="mt-3 text-sm text-[var(--color-info-text)]">{notice}</p> : null}
    {error ? <div role="alert" className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--color-critical)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_8%,transparent)] p-3 text-sm text-[var(--color-critical-text)]">{error}</div> : null}
    <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="accent" disabled={!canSubmit} onClick={() => void run()}>{submitting ? 'Starting analysis…' : 'Run country analysis'}</Button>{job && job.status !== 'failed' ? <StatusChip label={countryTruthStage(job.status, job.progress_stage)} tone={terminal ? (partial ? 'warning' : 'positive') : 'info'} icon={terminal ? (partial ? 'alert' : 'check') : 'clock'} detail={terminal ? undefined : `${job.progress}% complete`} /> : null}{job?.status === 'failed' ? <Button variant="secondary" onClick={() => void run()} disabled={submitting}>Retry analysis</Button> : null}</div>
    {job?.status === 'failed' ? <p className="mt-3 text-sm text-[var(--color-critical-text)]">The analysis could not finish. Retry now; completed evidence may be reused. If it fails again, share the reference from the error with Ops.</p> : null}
    {assessments.length ? <div className="mt-5 grid gap-3 xl:grid-cols-3">{assessments.map(result => <article key={result.country_code} className="rounded-md border border-[var(--color-border)] bg-surface-muted p-4">
      <div className="flex items-start justify-between gap-2"><h3 className="font-semibold text-primary">{result.country}</h3><StatusChip label={result.status === 'rankable' ? 'Rankable' : result.status === 'partial' ? 'Partial evidence' : 'Not rankable'} tone={result.status === 'rankable' ? 'positive' : 'warning'} icon={result.status === 'rankable' ? 'check' : 'alert'} /></div>
      <p className="mt-2 text-2xl font-semibold text-primary">{result.score == null ? 'No score' : result.score}<span className="ml-2 text-xs font-normal text-[var(--color-text-secondary)]">Confidence {result.confidence}%</span></p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-[var(--color-text-muted)]">Market size</dt><dd className="text-primary">{metricText(result.market_size, 'money')}</dd></div><div><dt className="text-[var(--color-text-muted)]">Growth</dt><dd className="text-primary">{metricText(result.growth, 'percent')}</dd></div><div><dt className="text-[var(--color-text-muted)]">India share</dt><dd className="text-primary">{metricText(result.india_share, 'percent')}</dd></div><div><dt className="text-[var(--color-text-muted)]">Competition (HHI)</dt><dd className="text-primary">{metricText(result.competition_hhi, 'hhi')}</dd></div></dl>
      <p className="mt-3 text-xs leading-5 text-[var(--color-text-secondary)]">{result.rationale}</p>
    </article>)}</div> : null}
  </section>;
}
