import clsx from 'clsx';

/**
 * Bare structural primitives for a server-rendered table.
 *
 * `DataTable` stays for the six client-paginated flows that own sort and page state
 * (Buyers, Tasks, Deals, Messages, Outreach, Audit). This is the other half: the ~17
 * hand-rolled Ops/Agent queue tables, which the audit found using four different cell
 * paddings, now share one treatment.
 *
 * The header is a tracked label on the bare ground with a rule under it — not a filled
 * band. Roughly half of those tables used to ship a solid dark header row, which put a
 * heavy bar across every queue and made a page of three tables read as three separate
 * applications. The header is furniture; the rows are the content.
 */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={clsx('w-full border-collapse text-left text-sm', className)} {...props} />;
}

export function Thead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={clsx('border-b border-line-strong', className)} {...props} />;
}

export function Tbody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={clsx('divide-y divide-line', className)} {...props} />;
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={clsx('transition-colors duration-fast', className)} {...props} />;
}

const ALIGN_CLASS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export interface CellProps {
  align?: 'left' | 'right' | 'center';
}

export function Th({ className, align, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <th
      scope="col"
      className={clsx('eyebrow whitespace-nowrap px-3 pb-2.5 pt-1', align && ALIGN_CLASS[align], className)}
      {...props}
    />
  );
}

export function Td({ className, align, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <td
      className={clsx('px-3 py-[var(--cell-y)] align-middle', align && ALIGN_CLASS[align], className)}
      {...props}
    />
  );
}
