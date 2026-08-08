'use client';

import { useEffect, useState } from 'react';

/** docs/03 §5: search/filter inputs debounce 250-400ms before triggering a fetch. */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

// ---------------------------------------------------------------------------
// Background job polling (docs/09 §3)
// ---------------------------------------------------------------------------

export type JobPollStatus = 'queued' | 'processing' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface JobSnapshot {
  job_id: string;
  status: JobPollStatus;
  progress: number;
  target: { type: string; id: string } | null;
  result: unknown;
  error: { code: string; message: string | null } | null;
  attempts: number;
  correlation_id: string;
}

/**
 * Poll a background job until it reaches a terminal state.
 *
 * Two things this deliberately does NOT do:
 *
 *   - **Hardcode an interval.** The server returns `poll_after_ms`, so pacing can be
 *     retuned centrally under load rather than by shipping a new client.
 *   - **Keep polling forever.** `poll_after_ms` comes back null once the job is terminal,
 *     which stops the loop. A client that polled a finished job indefinitely would be a
 *     slow, permanent load on the API.
 *
 * Because job state lives in the database rather than in this component, a refresh or a
 * different device resumes the same job — which is the durability requirement in
 * docs/09 §3, not an incidental property of this hook.
 */
export function useJobPoll(jobId: string | null) {
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setError(null);
      return;
    }

    // Guards against a late response from a previous job id overwriting the current one.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/jobs/${jobId}`, { headers: { 'Content-Type': 'application/json' } });
        const body = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setError(body?.error?.message ?? 'Could not check progress.');
          return;
        }

        setJob(body.data as JobSnapshot);
        const nextIn = body.meta?.poll_after_ms as number | null | undefined;
        if (nextIn != null) timer = setTimeout(poll, nextIn);
      } catch {
        if (!cancelled) setError('Lost connection while checking progress.');
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  return { job, error };
}
