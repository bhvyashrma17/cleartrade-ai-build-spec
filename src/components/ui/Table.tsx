import clsx from 'clsx';

/**
 * docs/27-ui-redesign.md §7.1 — the audit's premise here doesn't hold against the current
 * codebase: it claimed `DataTable` was imported by zero pages, but it's actually the live,
 * correctly-architected component behind six real client-side paginated flows (Buyers,
 * Tasks, Deals, Messages, Outreach, Audit — all fetch a page of rows from the server and
 * own sort/page state). Forcing those into something else, or forcing the ~17 server-
 * rendered, unpaginated Ops/Agent queue tables into `DataTable`'s client/pagination
 * contract, would be a architecture change, not a consolidation.
 *
 * So: `DataTable` stays for paginated data. This is the other half — bare structural
 * primitives for a plain server-rendered table, so the ~17 hand-rolled tables (which the
 * audit found using four different cell paddings) share one padding and border treatment
 * instead of restating it per file.
 */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={clsx('w-full text-left text-sm', className)} {...props} />;
}

/**
 * No default styling — the 17 hand-rolled tables this replaces split roughly evenly
 * between a dark `bg-primary` header row and a plain uppercase-muted one, and neither
 * is the bug the audit named (that was cell padding). Forcing one here would be a
 * visual change this pass isn't making; the header look stays whatever the caller's
 * `Tr`/`Th` classes already say.
 */
export function Thead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={className} {...props} />;
}

export function Tbody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={clsx('divide-y divide-[var(--color-border)]', className)} {...props} />;
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={className} {...props} />;
}

const ALIGN_CLASS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export interface CellProps {
  align?: 'left' | 'right' | 'center';
}

export function Th({ className, align, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return <th scope="col" className={clsx('px-4 py-3 font-normal', align && ALIGN_CLASS[align], className)} {...props} />;
}

export function Td({ className, align, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return <td className={clsx('px-4 py-3', align && ALIGN_CLASS[align], className)} {...props} />;
}
