'use client';

/**
 * The product code finder screen (E-043, E-046; the owner's option B: no AI). The exporter's own words
 * go in; at most three HS 2022 codes come out with their official descriptions, plus the one question
 * that separates them. It calls `POST /api/v1/hs-finder`, which reads only the public code list and
 * needs no session. A pick fills the code field beside it. It never decides a code: what happens to the
 * code next is the form's business, and the form says so in `pickNote`.
 */
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import type { HsCandidate, HsFinderResult } from '@/lib/hs-finder/finder';

export interface HsFinderResponse extends HsFinderResult {
  available: boolean;
  /** Why the finder cannot answer here, when `available` is false. */
  reason?: string;
  /** The code list's version, e.g. "CEPII BACI product codes HS22 (5609 codes)". */
  source?: string;
}

/** What a pick carries, so a form can record how the code was found. */
export interface HsFinderPick {
  hs6: string;
  description: string;
  query: string;
  answers: Record<string, string>;
  source: string | null;
}

interface Answered { dimension: string; value: string; label: string }

/** The finder's answer, drawn. Pure, so a test can render each state. */
export function HsFinderResultView({ result, answered, pending, onAnswer, onPick, onReset }: {
  result: HsFinderResponse;
  answered: Answered[];
  pending: boolean;
  onAnswer: (answer: Answered) => void;
  onPick: (candidate: HsCandidate) => void;
  onReset: () => void;
}) {
  if (!result.available) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        {result.reason ?? 'The product code list is not available here yet.'} Enter the code yourself, or ask a ClearTrade agent.
      </p>
    );
  }
  const read = [...result.understood.map((item) => item.label), ...answered.map((item) => item.label)];
  return (
    <div className="space-y-3">
      {read.length ? (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Taken into account: {read.join(' · ')}
          {answered.length ? (
            <>
              {' '}
              <button type="button" onClick={onReset} disabled={pending} className="font-semibold text-primary underline underline-offset-2">
                Start over
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {result.question ? (
        <fieldset disabled={pending}>
          <legend className="text-sm font-medium text-primary">{result.question.text}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {result.question.options.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onAnswer({ dimension: result.question!.dimension, value: option.value, label: option.label })}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {result.candidates.length ? (
        <div>
          <p className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
            {result.question ? 'Closest codes so far' : result.candidates.length === 1 ? 'The code that fits' : 'Closest codes'}
          </p>
          <ol className="space-y-2">
            {result.candidates.map((candidate) => (
              <li key={candidate.hs6} className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-surface p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="record font-semibold text-primary">{candidate.hs6}</p>
                  <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{candidate.description}</p>
                  {candidate.matched.length ? (
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Matched: {candidate.matched.join(', ')}</p>
                  ) : null}
                </div>
                <Button type="button" size="sm" onClick={() => onPick(candidate)} disabled={pending} aria-label={`Use code ${candidate.hs6}`} className="shrink-0">
                  Use this code
                </Button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {result.more ? (
        <p className="text-xs text-[var(--color-text-secondary)]">
          {result.more} more {result.more === 1 ? 'code also matches' : 'codes also match'}.{' '}
          {result.question ? 'Answering the question narrows them.' : 'Add a detail to your description to narrow them.'}
        </p>
      ) : null}
      {result.note ? <p className="text-sm text-[var(--color-text-secondary)]">{result.note}</p> : null}
      {result.source ? <p className="text-xs text-[var(--color-text-muted)]">From the official code list: {result.source}</p> : null}
    </div>
  );
}

/**
 * The finder as a panel under a code field. `description` seeds the search with what the exporter
 * already typed; they can change it here without touching the form above.
 */
export function HsFinder({ description, onPick, pickNote, idPrefix }: {
  description: string;
  onPick: (pick: HsFinderPick) => void;
  /** What happens to a picked code, in this form's terms. */
  pickNote: string;
  idPrefix: string;
}) {
  const [query, setQuery] = useState(description);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [result, setResult] = useState<HsFinderResponse | null>(null);
  const [searched, setSearched] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(text: string, nextAnswered: Answered[]) {
    setPending(true);
    setError(null);
    try {
      const answers = Object.fromEntries(nextAnswered.map((item) => [item.dimension, item.value]));
      const response = await apiPost<{ data: HsFinderResponse }>('/api/v1/hs-finder', {
        description: text,
        ...(nextAnswered.length ? { answers } : {}),
      });
      setAnswered(nextAnswered);
      setSearched(text);
      setResult(response.data);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not search the code list. Please retry.');
    } finally {
      setPending(false);
    }
  }

  const text = query.trim();
  const canSearch = text.length >= 2 && text.length <= 300 && !pending;

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-surface-muted p-4">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSearch) void search(text, []);
        }}
      >
        <label htmlFor={`${idPrefix}-finder-query`} className="block flex-1 text-sm font-medium text-primary">
          Describe the product in your own words
          <input
            id={`${idPrefix}-finder-query`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={300}
            placeholder="Brass pooja thali, jeera, cotton bedsheets…"
            className="mt-1.5 block min-h-control w-full rounded-md border border-[var(--color-border-strong)] bg-surface px-3 text-sm font-normal text-primary"
          />
        </label>
        <Button type="submit" size="sm" disabled={!canSearch} className="sm:mb-0.5">
          {pending ? 'Searching…' : 'Find codes'}
        </Button>
      </form>
      <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
        Everyday names work: material, use, Hindi names. {pickNote}
      </p>

      <div aria-live="polite" className="mt-3">
        {error ? (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        ) : null}
        {result ? (
          <HsFinderResultView
            result={result}
            answered={answered}
            pending={pending}
            onAnswer={(answer) => void search(searched, [...answered.filter((item) => item.dimension !== answer.dimension), answer])}
            onPick={(candidate) =>
              onPick({
                hs6: candidate.hs6,
                description: candidate.description,
                query: searched,
                answers: Object.fromEntries(answered.map((item) => [item.dimension, item.value])),
                source: result.source ?? null,
              })
            }
            onReset={() => void search(searched, [])}
          />
        ) : null}
      </div>
    </div>
  );
}
