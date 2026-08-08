'use client';

/**
 * AGT-05 deal-lock gate (AC03: "Deal lock checks prerequisites server-side").
 *
 * The blockers rendered here are exactly what `collectDealLockBlockers()` returned from
 * the server — this component never computes its own opinion of whether a lock is
 * allowed, it just displays the server's and lets the agent try. Clicking Lock when
 * blockers exist is still safe: the server re-checks and returns
 * DEAL_LOCK_PREREQUISITES_NOT_MET with the same list.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, StatusChip } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import type { Blocker } from '@/types';

export function LockPanel({
  dealId,
  dealVersion,
  blockers: initialBlockers,
  canLock,
}: {
  dealId: string;
  dealVersion: number;
  blockers: Blocker[];
  canLock: boolean;
}) {
  const router = useRouter();
  const [blockers, setBlockers] = useState<Blocker[]>(initialBlockers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const lock = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiPost<{ data: { snapshot_version: number; documents_created: number; tasks_created: number } }>(
        `/api/v1/deals/${dealId}/lock`,
        { deal_version: dealVersion },
      );
      setBlockers([]);
      setResult(
        `Locked. Snapshot v${res.data.snapshot_version} frozen, ${res.data.documents_created} documents queued, ${res.data.tasks_created} execution tasks created.`,
      );
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
        // The server returns the authoritative blocker list; replace ours with it rather
        // than keeping a stale client-side copy.
        if (e.blockers?.length) setBlockers(e.blockers);
      } else {
        setError('Could not lock the deal. Please retry.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-primary">Deal lock</h2>
        <StatusChip
          label={blockers.length === 0 ? 'Ready to lock' : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`}
          tone={blockers.length === 0 ? 'positive' : 'warning'}
          icon={blockers.length === 0 ? 'check' : 'alert'}
          size="sm"
        />
      </div>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Locking freezes the deal snapshot every document generates from, snapshots the fee policy, and
        creates the execution tasks and document checklist.
      </p>

      {result ? (
        <div className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--color-action)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-action)_8%,transparent)] p-3 text-sm text-primary">
          {result}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-3 text-sm text-[var(--color-critical-text)]"
        >
          <p className="font-medium">{error}</p>
        </div>
      ) : null}

      {blockers.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {blockers.map((b, i) => (
            <li
              key={`${b.object_type}-${b.object_id}-${i}`}
              className="rounded-md border border-[color-mix(in_srgb,var(--color-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] p-3"
            >
              <p className="text-sm text-primary">{b.reason}</p>
              {b.deep_link ? (
                <Link href={b.deep_link} className="mt-1 inline-block text-sm font-semibold text-primary underline underline-offset-2">
                  Resolve this
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5">
        <Button disabled={busy || !canLock} onClick={() => void lock()}>
          {busy ? 'Locking…' : 'Lock deal'}
        </Button>
        {!canLock ? (
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            This deal is already locked or past locking.
          </p>
        ) : null}
      </div>
    </div>
  );
}
