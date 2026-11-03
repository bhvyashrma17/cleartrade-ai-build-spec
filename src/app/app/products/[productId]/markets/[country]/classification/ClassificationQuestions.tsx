'use client';

/**
 * Classification refinement, as questions about goods.
 *
 * What this component deliberately never renders: a tariff code. The exporter is asked "is the
 * rice parboiled?", not "is your product 1006302712 or 1006302722?" — a question no
 * manufacturer can answer and every manufacturer will guess at. What it posts is
 * `{ answers: { parboiled: 'yes' } }`; the narrowing happens on the server against the
 * immutable authority snapshot, and the server sends back the recomputed question set.
 *
 * Only unresolved questions are shown, and answers already on file are preserved by the
 * service rather than re-asked.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Button, buttonClass, Card, EmptyState, SectionHeading, StatusChip } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import type { ClassificationQuestionView } from '@/lib/country-discovery/service';

export function ClassificationQuestions({
  exporterOrgId,
  productId,
  countryCode,
  initial,
  basePath = '/app/products',
}: {
  exporterOrgId: string;
  productId: string;
  countryCode: string;
  initial: ClassificationQuestionView;
  /** Lets the agent surface reuse this component under its own route tree. */
  basePath?: string;
}) {
  const [view, setView] = useState(initial);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backHref = `${basePath}/${productId}/markets/${countryCode}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!Object.keys(answers).length) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiPost<ClassificationQuestionView>(
        `/api/v1/exporters/${exporterOrgId}/products/${productId}/markets/${countryCode}/classification`,
        { answers },
      );
      setView(next);
      setAnswers({});
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not save your answers.');
    } finally {
      setBusy(false);
    }
  }

  if (view.state === 'agent_classification_required') {
    return (
      <EmptyState
        title="A ClearTrade specialist will classify this"
        description={`Your product could fall under ${view.remaining} different tariff lines in this destination, and the published descriptions do not contain a distinction we can fairly ask you about. Rather than have you guess — which would change the duty ClearTrade calculates — a specialist will establish the correct line.`}
        action={<Link href={backHref} className={buttonClass('secondary', 'md')}>Back to market</Link>}
      />
    );
  }

  if (view.state === 'no_evidence_yet' || view.state === 'not_applicable') {
    return (
      <EmptyState
        title="No tariff questions yet"
        description="ClearTrade has not yet gathered the destination's official tariff for this product. Once it has, any questions needed to pin down your exact duty will appear here."
        action={<Link href={backHref} className={buttonClass('secondary', 'md')}>Back to market</Link>}
      />
    );
  }

  if (view.state === 'resolved') {
    return (
      <Card ticked>
        <StatusChip label="Product classification narrowed" tone="positive" icon="check" />
        <p className="mt-3 text-sm text-bone">ClearTrade has identified the destination tariff line.</p>
        <p className="mt-2 text-sm text-slate">{view.resolved_line?.description}</p>
        <p className="mt-3 text-xs text-muted">Verification status: {view.resolved_line?.verification}</p>
        <p className="mt-1 text-xs text-muted">
          Source: {view.source?.authority}. This narrowing is based on what you have told us about the
          goods; it is not a customs ruling and does not clear the goods for import.
        </p>
        <div className="mt-4">
          <Link href={backHref} className={buttonClass('primary', 'md')}>Back to market</Link>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <SectionHeading
          title={`${view.remaining} possible tariff lines remain`}
          description={`Your product could be classified in ${view.remaining} different ways in this destination, and each can carry a different duty. Each answer narrows it.`}
        />
        <fieldset className="mt-4 space-y-5 border-0 p-0">
          <legend className="sr-only">Questions about your product</legend>
          {view.questions.map((question) => (
            <div key={question.attribute}>
              <p id={`q-${question.attribute}`} className="text-sm font-medium text-bone">
                {question.question}
              </p>
              <div className="mt-2 flex flex-wrap gap-4" role="radiogroup" aria-labelledby={`q-${question.attribute}`}>
                {question.options.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm text-slate">
                    <input
                      type="radio"
                      name={question.attribute}
                      value={option.value}
                      checked={answers[question.attribute] === option.value}
                      onChange={() => setAnswers((current) => ({ ...current, [question.attribute]: option.value }))}
                    />
                    <span>{option.label}</span>
                    <span className="text-xs text-muted">({option.keeps} {option.keeps === 1 ? 'line' : 'lines'})</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
        <p className="mt-4 text-xs text-muted">
          Leave anything you are unsure about unanswered. A wrong answer here changes the duty ClearTrade
          calculates, so an unanswered question is always better than a guess.
        </p>
        {error ? <p className="mt-3 text-sm text-[var(--crit)]" role="alert">{error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !Object.keys(answers).length}>
            {busy ? 'Saving…' : 'Save answers'}
          </Button>
          <Link href={backHref} className={buttonClass('ghost', 'md')}>Back to market</Link>
        </div>
      </Card>
      {view.source ? (
        <p className="text-xs text-muted">
          Questions derived from {view.source.authority}, read{' '}
          {new Date(view.source.retrieved_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.
        </p>
      ) : null}
    </form>
  );
}
