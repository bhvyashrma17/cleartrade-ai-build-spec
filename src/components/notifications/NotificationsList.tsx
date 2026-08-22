'use client';

/**
 * EXP-17 Notification list — AC01 "deep-link resolve", AC02 "read status syncs across
 * sessions".
 *
 * AC01 concretely: clicking a deep-linked row awaits the mark-read PATCH, THEN
 * navigates via `router.push()`. It is tempting to fire the PATCH without awaiting it
 * and let a plain `<a href>` navigate immediately — but that is a real bug, not just a
 * theoretical one: a same-origin `<a>` click still triggers a full document navigation
 * unless prevented, and a browser is free to abort an in-flight `fetch` when the page
 * unloads. Preventing the default and awaiting the write first is what makes AC02 true
 * for THIS click, not just in principle: a second tab's next `GET /api/v1/notifications`
 * must see the `read_at` this click wrote, and a request the browser cancelled write
 * nothing to see.
 *
 * "If object unavailable, safe fallback" (docs/04): a `deep_link` is followed as a plain
 * `<a>` navigation, so a stale/404 target renders the app's normal not-found page rather
 * than this component trying to guess whether the target still exists.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { StatusChip } from '@/components/ui';
import { notificationChip } from './statusDisplay';
import { ApiClientError, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { ListResponse, PageMeta } from '@/types';

const PER_PAGE = 15;
const EMPTY_PAGE: PageMeta = { page: 1, per_page: PER_PAGE, total: 0, total_pages: 1 };

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: string;
  object_type: string | null;
  object_id: string | null;
  deep_link: string | null;
  read_at: string | null;
  dedupe_key: string | null;
  created_at: string;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function NotificationsList() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>(EMPTY_PAGE);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (unreadOnly) params.set('unread', 'true');
      const res = await apiGet<ListResponse<NotificationRow> & { meta: { unread_count: number } }>(
        `/api/v1/notifications?${params.toString()}`,
      );
      setRows(res.data);
      setPageMeta(res.meta);
      setUnreadCount(res.meta.unread_count ?? 0);
    } catch (error) {
      setLoadError(error instanceof ApiClientError ? error.message : 'Could not load notifications. Please retry.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, unreadOnly]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  // Optimistic local update so the row stops looking bold immediately; a failed PATCH
  // re-fetches to recover the true state.
  const markReadLocally = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, read_at: r.read_at ?? new Date().toISOString() } : r)));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markRead = async (id: string) => {
    markReadLocally(id);
    try {
      await apiPatch(`/api/v1/notifications/${id}`, {});
    } catch {
      await fetchNotifications();
    }
  };

  /** Deep-linked rows: await the write, THEN navigate — see file header for why this
   * cannot be fire-and-forget. */
  const openAndMarkRead = async (id: string, deepLink: string) => {
    await markRead(id);
    router.push(deepLink);
  };

  const markAllRead = async () => {
    try {
      await apiPost('/api/v1/notifications/mark-all-read', {});
      await fetchNotifications();
    } catch {
      // Non-fatal — the list still reflects individually-read state on next fetch.
    }
  };

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-primary">Notifications</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => { setPage(1); setUnreadOnly(e.target.checked); }}
              className="focus-visible-ring rounded"
            />
            Unread only
          </label>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="focus-visible-ring font-medium text-primary underline underline-offset-2"
            >
              Mark all read
            </button>
          ) : null}
        </div>
      </div>

      {loadError ? <p className="mt-4 text-sm text-[var(--color-critical-text)]">{loadError}</p> : null}

      {loading ? (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          {unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-border)]">
          {rows.map((n) => {
            const chip = notificationChip(n.severity);
            const isUnread = !n.read_at;
            const content = (
              <div className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {isUnread ? <span className="h-2 w-2 shrink-0 rounded-full bg-action" aria-hidden="true" /> : null}
                    <p className={isUnread ? 'font-semibold text-primary' : 'font-normal text-primary'}>{n.title}</p>
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{n.body}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{formatWhen(n.created_at)}</p>
                </div>
                <StatusChip {...chip} size="sm" />
              </div>
            );
            return (
              <li key={n.id}>
                {n.deep_link ? (
                  <a
                    href={n.deep_link}
                    onClick={(e) => {
                      e.preventDefault();
                      void openAndMarkRead(n.id, n.deep_link as string);
                    }}
                    className="focus-visible-ring -mx-2 block rounded px-2 hover:bg-surface-muted"
                  >
                    {content}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => void markRead(n.id)}
                    className="focus-visible-ring -mx-2 block w-full rounded px-2 text-left hover:bg-surface-muted"
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pageMeta.total_pages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="focus-visible-ring rounded border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-[var(--color-text-secondary)]">Page {pageMeta.page} of {pageMeta.total_pages}</span>
          <button
            type="button"
            disabled={page >= pageMeta.total_pages}
            onClick={() => setPage((p) => Math.min(pageMeta.total_pages, p + 1))}
            className="focus-visible-ring rounded border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
