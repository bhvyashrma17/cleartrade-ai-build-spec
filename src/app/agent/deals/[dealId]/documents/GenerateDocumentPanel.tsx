'use client';

/**
 * Generate buttons for one document type.
 *
 * Deliberately cannot create a document row. Document rows are created from the registry when
 * the deal is locked, which is ClearTrade's existing lifecycle — adding a second creation path
 * here would mean two places decide which documents a deal needs, and they would disagree the
 * first time the registry changed.
 *
 * `router.refresh()` after each action: whether a document is now generated, and what artifacts
 * exist, is decided on the server. This component never predicts it.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

type Format = 'pdf' | 'docx' | 'html';

export function GenerateDocumentPanel({
  dealId, documentId, formats, disabled = false,
}: {
  dealId: string;
  documentId: string | null;
  formats: Format[];
  /** An approved version's artifacts are frozen — regenerating means amending. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: Format) => {
    setBusy(format);
    setError(null);
    try {
      await apiPost(`/api/v1/deals/${dealId}/documents/${documentId}/render`, { format });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not generate the document.');
    } finally {
      setBusy(null);
    }
  };

  if (disabled) {
    return (
      <p className="max-w-xs text-right text-xs text-[var(--color-text-muted)]">
        Approved — its files are frozen. Create an amendment to produce a corrected version.
      </p>
    );
  }

  if (!documentId) {
    return (
      <p className="max-w-xs text-right text-xs text-[var(--color-text-muted)]">
        Created when the deal is locked. The checklist comes from the document registry, not
        from this page.
      </p>
    );
  }

  if (formats.length === 0) {
    return (
      <p className="max-w-xs text-xs text-[var(--color-text-muted)]">
        The configured renderer cannot produce this document. Set{' '}
        <span className="font-mono">DOCUMENT_ENGINE=legacy</span> to enable PDF and DOCX output.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {formats.map((format) => (
          <Button
            key={format}
            type="button"
            variant={format === 'pdf' ? 'primary' : 'secondary'}
            className="min-h-9 px-3 text-sm"
            onClick={() => run(format)}
            disabled={busy !== null || disabled}
          >
            {busy === format ? 'Generating…' : format === 'html' ? 'Preview' : `Generate ${format.toUpperCase()}`}
          </Button>
        ))}
      </div>
      {error ? <p role="alert" className="max-w-xs text-right text-xs text-[var(--crit-text)]">{error}</p> : null}
    </div>
  );
}
