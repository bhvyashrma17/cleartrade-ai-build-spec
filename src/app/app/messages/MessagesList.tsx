'use client';

import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui';
import { ApiClientError, apiGet } from '@/lib/api-client';
import type { ListResponse, PageMeta } from '@/types';

const PER_PAGE = 20;
const EMPTY_PAGE: PageMeta = { page: 1, per_page: PER_PAGE, total: 0, total_pages: 1 };

interface MessageRow {
  id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  author_name: string;
  thread_label: string;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function MessagesList() {
  const [page, setPage] = useState(1);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      const res = await apiGet<ListResponse<MessageRow>>(`/api/v1/messages?${params.toString()}`);
      setMessages(res.data);
      setPageMeta(res.meta);
    } catch (error) {
      setLoadError(error instanceof ApiClientError ? error.message : 'Could not load your messages. Please retry.');
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const columns: DataTableColumn<MessageRow>[] = [
    {
      key: 'thread',
      header: 'Conversation',
      render: (message) => <span className="font-medium text-primary">{message.thread_label}</span>,
    },
    {
      key: 'body',
      header: 'Message',
      render: (message) => <span className="line-clamp-2 text-[var(--color-text-secondary)]">{message.body}</span>,
    },
    {
      key: 'author',
      header: 'From',
      render: (message) => message.author_name,
    },
    {
      key: 'when',
      header: 'Sent',
      render: (message) => (
        <span className={message.read_at ? undefined : 'font-semibold text-primary'}>{formatWhen(message.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-6">
        <p className="text-sm font-normal text-primary">Conversations</p>
        <h1 className="font-serif text-title-page text-primary">Messages</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Every conversation across your deals and buyer leads, newest first.
        </p>
      </header>

      {loadError ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-4 text-sm text-[var(--color-critical-text)]">
          <p className="font-normal">{loadError}</p>
          <button type="button" onClick={fetchMessages} className="mt-2 font-medium underline underline-offset-2">
            Retry
          </button>
        </div>
      ) : (
        <>
          <DataTable<MessageRow>
            columns={columns}
            rows={messages}
            rowKey={(message) => message.id}
            loading={loading}
            page={pageMeta}
            onPageChange={setPage}
            emptyState={{
              title: 'No messages yet',
              description: 'Conversations with your agent and buyers will appear here.',
            }}
          />
          {messages.length > 0 ? (
            <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
              Thread detail pages aren&apos;t built yet — this list is read-only for now.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
