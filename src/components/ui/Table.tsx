import clsx from 'clsx';

/**
 * Bare structural primitives for a server-rendered table.
 *
 * `DataTable` stays for the six client-paginated flows that own sort and page state
 * (Buyers, Tasks, Deals, Messages, Outreach, Audit). This is the other half: the ~17
 * hand-rolled Ops/Agent queue tables, which the audit found using four different cell
 * paddings, now share one padding, one border treatment and one header look instead of
 * restating each per file.
 *
 * The header is the change worth naming. Roughly half those tables shipped a solid ink
 * header row, which put a heavy black band across every queue in the product and made a
 * page of three tables read as three separate applications. The header is now the `label`
 * token on `--paper-sunk`: quieter than the data it introduces, which is the correct
 * relationship — the header is furniture, the rows are the content.
 */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={clsx('w-full border-collapse text-left text-sm', className)} {...props} />;
}

export function Thead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={clsx('border-b border-line bg-paper-sunk', className)} {...props} />;
}

export function Tbody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={clsx('divide-y divide-line', className)} {...props} />;
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={className} {...props} />;
}

const ALIGN_CLASS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export interface CellProps {
  align?: 'left' | 'right' | 'center';
}

export function Th({ className, align, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <th
      scope="col"
      className={clsx('eyebrow whitespace-nowrap px-4 py-2.5 text-ink-500', align && ALIGN_CLASS[align], className)}
      {...props}
    />
  );
}

export function Td({ className, align, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <td
      className={clsx('px-4 py-[var(--cell-y)] align-middle', align && ALIGN_CLASS[align], className)}
      {...props}
    />
  );
}
