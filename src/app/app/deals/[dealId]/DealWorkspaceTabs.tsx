'use client';

/**
 * Tab nav for the Deal Workspace. A server layout has no access to the current
 * pathname, so active-tab highlighting needs a client component — same reason
 * `AppShell`'s nav is a client component (`usePathname`).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { key: '', label: 'Overview' },
  { key: 'messages', label: 'Messages' },
  { key: 'commercial', label: 'Commercial' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'documents', label: 'Documents' },
  { key: 'shipment', label: 'Shipment' },
  { key: 'payment', label: 'Payment' },
  { key: 'activity', label: 'Activity' },
];

export function DealWorkspaceTabs({ dealId }: { dealId: string }) {
  const pathname = usePathname();
  const basePath = `/app/deals/${dealId}`;

  return (
    <nav aria-label="Deal workspace tabs" className="mb-5 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
      {TABS.map((tab) => {
        const href = `${basePath}${tab.key ? `/${tab.key}` : ''}`;
        const active = tab.key === '' ? pathname === basePath : pathname.startsWith(href);
        return (
          <Link
            key={tab.key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`focus-visible-ring -mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition duration-fast ${
              active ? 'border-action text-primary' : 'border-transparent text-[var(--color-text-secondary)] hover:text-primary'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
