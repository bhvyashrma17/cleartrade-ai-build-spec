'use client';

import { buttonClass } from '@/components/ui/Button';
import { useEffect, useState } from 'react';
import { apiPost } from '@/lib/api-client';

export function BugReportForm() {
  const [subject, setSubject] = useState(''); const [happened, setHappened] = useState('');
  const [expected, setExpected] = useState(''); const [pageUrl, setPageUrl] = useState('');
  const [busy, setBusy] = useState(false); const [submitted, setSubmitted] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { const referrer = document.referrer; setPageUrl(referrer && new URL(referrer).origin === window.location.origin ? referrer : window.location.href); }, []);
  if (submitted) return <div role="status" className="rounded-lg border border-[var(--color-border)] bg-surface p-6 shadow-card"><h2 className="text-lg font-semibold text-primary">Thanks — your report has been received.</h2><p className="mt-2 text-sm text-[var(--color-text-secondary)]">ClearTrade support can now review the details you submitted.</p></div>;
  return (
    <form className="space-y-5 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card md:p-6" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(null); try { await apiPost('/api/v1/bug-reports', { subject, what_happened: happened, expected, page_url: pageUrl }); setSubmitted(true); } catch { setError('We could not submit your report. Please try again.'); } finally { setBusy(false); } }}>
      <label className="block text-sm font-medium text-primary">Subject<input required minLength={3} maxLength={160} value={subject} onChange={(e) => setSubject(e.target.value)} className="focus-visible-ring mt-1.5 min-h-10 w-full rounded border border-[var(--color-border-strong)] bg-surface px-3" /></label>
      <label className="block text-sm font-medium text-primary">What happened?<textarea required minLength={10} rows={5} value={happened} onChange={(e) => setHappened(e.target.value)} className="focus-visible-ring mt-1.5 w-full rounded border border-[var(--color-border-strong)] bg-surface px-3 py-2" /></label>
      <label className="block text-sm font-medium text-primary">What did you expect?<textarea required minLength={3} rows={4} value={expected} onChange={(e) => setExpected(e.target.value)} className="focus-visible-ring mt-1.5 w-full rounded border border-[var(--color-border-strong)] bg-surface px-3 py-2" /></label>
      <label className="block text-sm font-medium text-primary">Page / URL <span className="font-normal text-[var(--color-text-secondary)]">(optional)</span><input type="url" maxLength={2048} value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} className="focus-visible-ring mt-1.5 min-h-10 w-full rounded border border-[var(--color-border-strong)] bg-surface px-3" /></label>
      {error ? <p role="alert" className="text-sm text-[var(--color-critical-text)]">{error}</p> : null}
      <button disabled={busy} type="submit" className={buttonClass('primary')}>{busy ? 'Submitting…' : 'Submit report'}</button>
    </form>
  );
}
