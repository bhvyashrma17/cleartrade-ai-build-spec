'use client';

/**
 * DataTable — docs/03 §3 & §5: server-side pagination, sort, filters, row actions,
 * empty state, mobile fallback.
 *
 * Fully controlled: this component owns no page/sort state of its own. The caller
 * fetches from the server (docs/09 §1 pagination) and passes the current page back
 * in via `page` (the `PageMeta` envelope shape) plus `onPageChange` / `onSortChange`.
 *
 * "No data yet" and "filters returned zero" are visually and textually distinct
 * (docs/03 §5) — pass `hasActiveFilters` and the right empty state is picked for you
 * rather than the two being conflated into one generic "No results."
 */

import clsx from 'clsx';
import type { PageMeta } from '@/types';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

export interface DataTableColumn<T> {
  /** Stable key; also the sort key sent to the server unless `sortKey` overrides it. */
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  /** Drop this column in the mobile card fallback (e.g. an internal ID). */
  hideOnMobile?: boolean;
  className?: string;
}

export interface DataTableSort {
  key: string;
  direction: 'asc' | 'desc';
}

export interface DataTableEmptyState {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

const DEFAULT_FILTERED_EMPTY: DataTableEmptyState = {
  title: 'No results for these filters',
  description: 'Try adjusting or resetting your filters.',
};

function ChevronIcon({ direction, className }: { direction: 'up' | 'down' | 'left' | 'right'; className?: string }) {
  const rotation = { up: 180, down: 0, left: 90, right: -90 }[direction];
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: `rotate(${rotation}deg)` }}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

const ALIGN_CLASSES = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  page: PageMeta;
  onPageChange: (page: number) => void;
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort) => void;
  hasActiveFilters?: boolean;
  emptyState: DataTableEmptyState;
  filteredEmptyState?: DataTableEmptyState;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  page,
  onPageChange,
  sort,
  onSortChange,
  hasActiveFilters = false,
  emptyState,
  filteredEmptyState = DEFAULT_FILTERED_EMPTY,
  onRowClick,
  rowActions,
  className,
}: DataTableProps<T>) {
  const isEmpty = !loading && rows.length === 0;
  const activeEmptyState = hasActiveFilters ? filteredEmptyState : emptyState;
  const colSpan = columns.length + (rowActions ? 1 : 0);

  const handleSort = (col: DataTableColumn<T>) => {
    if (!col.sortable || !onSortChange) return;
    const key = col.sortKey ?? col.key;
    const direction: DataTableSort['direction'] =
      sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key, direction });
  };

  const skeletonRowCount = Math.min(page.per_page || 5, 8);

  return (
    <div className={clsx('rounded-lg border border-[var(--color-border)] bg-surface shadow-card', className)}>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-[var(--color-text-inverse)]">
              {columns.map((col) => {
                const key = col.sortKey ?? col.key;
                const isSorted = sort?.key === key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={clsx(
                      'whitespace-nowrap px-4 py-3 font-medium',
                      ALIGN_CLASSES[col.align ?? 'left'],
                      col.className,
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col)}
                        className="inline-flex items-center gap-1 hover:opacity-80 focus-visible-ring"
                        aria-label={`Sort by ${col.header}${isSorted ? `, currently ${sort!.direction}ending` : ''}`}
                      >
                        {col.header}
                        <ChevronIcon
                          direction={isSorted && sort!.direction === 'asc' ? 'up' : 'down'}
                          className={isSorted ? 'opacity-100' : 'opacity-40'}
                        />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
              {rowActions ? (
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRowCount }).map((_, i) => (
                  <tr key={i} className="border-t border-[var(--color-border)]">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3">
                        <Skeleton height="0.9rem" width="80%" />
                      </td>
                    ))}
                    {rowActions ? (
                      <td className="px-4 py-3">
                        <Skeleton height="0.9rem" width="60%" />
                      </td>
                    ) : null}
                  </tr>
                ))
              : isEmpty
                ? (
                  <tr>
                    <td colSpan={colSpan} className="px-4 py-10">
                      <EmptyStateBlock state={activeEmptyState} />
                    </td>
                  </tr>
                )
                : rows.map((row) => (
                    <tr
                      key={rowKey(row)}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={clsx(
                        'border-t border-[var(--color-border)]',
                        onRowClick && 'cursor-pointer hover:bg-surface-muted',
                      )}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={clsx('px-4 py-3 text-primary', ALIGN_CLASSES[col.align ?? 'left'], col.className)}
                        >
                          {col.render(row)}
                        </td>
                      ))}
                      {rowActions ? (
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {rowActions(row)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card fallback (docs/10 §3: tables become cards on small screens) */}
      <div className="divide-y divide-[var(--color-border)] md:hidden">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4">
              <Skeleton height="0.9rem" width="70%" />
              <div className="mt-2">
                <Skeleton height="0.8rem" width="50%" />
              </div>
            </div>
          ))
        ) : isEmpty ? (
          <div className="p-6">
            <EmptyStateBlock state={activeEmptyState} />
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={clsx('p-4', onRowClick && 'cursor-pointer active:bg-surface-muted')}
            >
              <dl className="space-y-1.5">
                {columns
                  .filter((col) => !col.hideOnMobile)
                  .map((col) => (
                    <div key={col.key} className="flex items-baseline justify-between gap-3 text-sm">
                      <dt className="text-[var(--color-text-secondary)]">{col.header}</dt>
                      <dd className="text-right text-primary">{col.render(row)}</dd>
                    </div>
                  ))}
              </dl>
              {rowActions ? (
                <div className="mt-3 flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                  {rowActions(row)}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      {!isEmpty ? <Pagination page={page} onPageChange={onPageChange} loading={loading} /> : null}
    </div>
  );
}

function EmptyStateBlock({ state }: { state: DataTableEmptyState }) {
  return <EmptyState title={state.title} description={state.description} action={state.action} />;
}

function Pagination({
  page,
  onPageChange,
  loading,
}: {
  page: PageMeta;
  onPageChange: (page: number) => void;
  loading: boolean;
}) {
  const from = page.total === 0 ? 0 : (page.page - 1) * page.per_page + 1;
  const to = Math.min(page.page * page.per_page, page.total);
  const disablePrev = loading || page.page <= 1;
  const disableNext = loading || page.page >= page.total_pages;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
      <span>
        {page.total > 0 ? `Showing ${from}–${to} of ${page.total}` : 'No rows'}
      </span>
      <div className="flex items-center gap-1">
        <PageButton label="First page" disabled={disablePrev} onClick={() => onPageChange(1)}>
          <ChevronIcon direction="left" />
          <ChevronIcon direction="left" className="-ml-2" />
        </PageButton>
        <PageButton label="Previous page" disabled={disablePrev} onClick={() => onPageChange(page.page - 1)}>
          <ChevronIcon direction="left" />
        </PageButton>
        <span className="px-2 text-primary">
          Page {page.page} of {page.total_pages}
        </span>
        <PageButton label="Next page" disabled={disableNext} onClick={() => onPageChange(page.page + 1)}>
          <ChevronIcon direction="right" />
        </PageButton>
        <PageButton label="Last page" disabled={disableNext} onClick={() => onPageChange(page.total_pages)}>
          <ChevronIcon direction="right" />
          <ChevronIcon direction="right" className="-ml-2" />
        </PageButton>
      </div>
    </div>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="focus-visible-ring inline-flex items-center rounded-md border border-[var(--color-border)] p-1.5 text-primary disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-surface-muted"
    >
      {children}
    </button>
  );
}
