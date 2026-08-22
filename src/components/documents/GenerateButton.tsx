'use client';

/**
 * EXP-12 "Generate" action. Missing-input failures (EXP-12-AC05) come back as
 * `blockers[]` with a deep link to the exact field — rendered inline, not as a generic
 * error, so the CTA the docs table asks for ("Missing inputs: CTA opens missing fields")
 * is literally a link to where the field lives.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import type { Blocker } from '@/types';

export function GenerateButton({
  dealId,
  documentId,
  label = 'Generate',
  compact = false,
}: {
  dealId: string;
  documentId: string;
  label?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setBlockers([]);
    try {
      await apiPost(`/api/v1/deals/${dealId}/documents/${documentId}/generate`, {});
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError && e.blockers?.length) {
        setBlockers(e.blockers);
        setError(e.message);
      } else {
        setError(e instanceof ApiClientError ? e.message : 'Could not start generation. Please retry.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button
        disabled={busy}
        onClick={() => void run()}
        className={compact ? 'min-h-8 px-3 text-xs' : undefined}
      >
        {busy ? 'Starting…' : label}
      </Button>
      {error ? (
        <div className="mt-2 max-w-xs rounded-md border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-2 text-xs text-[var(--color-critical-text)]">
          <p className="font-normal">{error}</p>
          {blockers.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {blockers.map((b, i) => (
                <li key={i}>
                  {b.reason}{' '}
                  {b.deep_link ? (
                    <Link href={b.deep_link} className="font-semibold underline underline-offset-2">
                      Fix this
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
