'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { UserRole } from '@prisma/client';

type Portal = 'exporter' | 'agent' | 'ops';
type Tier = 'guest' | 'free' | 'paid';

const TIER_RANK: Record<Tier, number> = { guest: 0, free: 1, paid: 2 };

interface NavItem {
  label: string;
  href: string;
  roles?: readonly UserRole[];
  /**
   * Minimum tier that may reach this route. docs/03 §1: "Navigation must not expose
   * routes the current role cannot access" — which now also means the current *tier*.
   * Linking a guest to /app/deals would be a dead end, not an upsell; the upgrade
   * prompt belongs on the surface that motivated it, not in the sidebar.
   *
   * Defaults to 'guest' (visible to everyone) only where explicitly set below.
   */
  minTier: Tier;
}

const NAVIGATION: Record<Portal, NavItem[]> = {
  exporter: [
    { label: 'Overview', href: '/app/overview', minTier: 'free' },
    { label: 'Readiness', href: '/app/readiness', minTier: 'free' },
    { label: 'Markets', href: '/app/markets', minTier: 'guest' },
    { label: 'Buyers', href: '/app/buyers', minTier: 'guest' },
    { label: 'Deals', href: '/app/deals', minTier: 'paid' },
    { label: 'Tasks', href: '/app/tasks', minTier: 'paid' },
    { label: 'Messages', href: '/app/messages', minTier: 'paid' },
    { label: 'Documents', href: '/app/documents', minTier: 'paid' },
    { label: 'Shipments', href: '/app/shipments', minTier: 'paid' },
    { label: 'Payments', href: '/app/payments', minTier: 'paid' },
    { label: 'Support', href: '/app/support', minTier: 'free' },
  ],
  agent: [
    { label: 'My Day', href: '/agent', minTier: 'paid' },
    { label: 'Exporters', href: '/agent/exporters', minTier: 'paid' },
    { label: 'Outreach', href: '/agent/outreach', minTier: 'paid' },
    { label: 'Deals', href: '/agent/deals', minTier: 'paid' },
    { label: 'Tasks', href: '/agent/tasks', minTier: 'paid' },
    { label: 'Escalations', href: '/agent/escalations', minTier: 'paid' },
    { label: 'Payout', href: '/agent/payout', minTier: 'paid' },
  ],
  ops: [
    { label: 'Control Tower', href: '/ops', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Assignments', href: '/ops/assignments', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Exceptions', href: '/ops/exceptions', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Compliance / CHA', href: '/ops/compliance', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Finance', href: '/ops/finance', minTier: 'paid', roles: ['ops_finance', 'admin'] },
    { label: 'Disputes', href: '/ops/disputes', minTier: 'paid', roles: ['ops_supervisor', 'ops_finance', 'admin'] },
    { label: 'Audit', href: '/ops/audit', minTier: 'paid', roles: ['ops_supervisor', 'ops_finance', 'admin'] },
    { label: 'Settings', href: '/ops/settings', minTier: 'paid', roles: ['admin'] },
  ],
};

/**
 * docs/00 §4 specifies exactly Home / Deals / Tasks / Messages / More for exporter
 * mobile. That set assumes paid-tier surfaces a guest or free account can't reach, so
 * a single filtered list doesn't work: filtering `minTier` alone let a *paid* principal
 * satisfy every item's threshold at once — Markets/Buyers (minTier guest) stayed visible
 * alongside the five paid items, rendering seven tabs instead of five. Each tier gets
 * its own complete, spec-sized bar instead of one list filtered down.
 */
function exporterMobileNav(tier: Tier): NavItem[] {
  if (tier === 'paid') {
    return [
      { label: 'Home', href: '/app/overview', minTier: 'free' },
      { label: 'Deals', href: '/app/deals', minTier: 'paid' },
      { label: 'Tasks', href: '/app/tasks', minTier: 'paid' },
      { label: 'Messages', href: '/app/messages', minTier: 'paid' },
      { label: 'More', href: '/app/more', minTier: 'free' },
    ];
  }
  if (tier === 'free') {
    // Deals/Tasks/Messages aren't reachable yet — Markets/Buyers back-fill so the bar
    // isn't empty, and More surfaces the upgrade path plus everything else.
    return [
      { label: 'Home', href: '/app/overview', minTier: 'free' },
      { label: 'Markets', href: '/app/markets', minTier: 'guest' },
      { label: 'Buyers', href: '/app/buyers', minTier: 'guest' },
      { label: 'More', href: '/app/more', minTier: 'free' },
    ];
  }
  // Guest: no Home (no dashboard to land on) and no More (nothing further to unlock
  // without an account) — just the two surfaces a guest actually has.
  return [
    { label: 'Markets', href: '/app/markets', minTier: 'guest' },
    { label: 'Buyers', href: '/app/buyers', minTier: 'guest' },
  ];
}

const UTILITY_LABEL: Record<Portal, string> = {
  exporter: 'Your agent',
  agent: 'SLA watch',
  ops: 'Exceptions',
};

function isActive(pathname: string, href: string) {
  return href === '/agent' || href === '/ops'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  children,
  portal,
  userName,
  tier,
  role,
}: {
  children: ReactNode;
  portal: Portal;
  userName: string | null;
  tier: Tier;
  role: UserRole;
}) {
  const pathname = usePathname();
  const visible = (item: NavItem) =>
    TIER_RANK[tier] >= TIER_RANK[item.minTier] && (!item.roles || item.roles.includes(role));
  const navigation = NAVIGATION[portal].filter(visible);
  const mobileNav = portal === 'exporter' ? exporterMobileNav(tier) : [];
  const isGuest = tier === 'guest';

  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between bg-primary px-4 text-white shadow-card md:px-6">
        <Link href={navigation[0]?.href ?? '/'} className="focus-visible-ring rounded text-base font-bold tracking-tight">
          ClearTrade AI
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {isGuest ? (
            // The tier boundary has to be legible, not implied by absence: a guest should
            // always be able to see that they are browsing anonymously and what fixes it.
            <>
              <span className="hidden rounded bg-white/10 px-2 py-1 text-xs sm:inline">Browsing as guest</span>
              <Link
                href="/register"
                className="focus-visible-ring rounded bg-action px-3 py-1.5 text-xs font-semibold text-primary transition duration-fast hover:brightness-95"
              >
                Create free account
              </Link>
            </>
          ) : (
            <>
              <button type="button" className="focus-visible-ring hidden rounded px-2 py-1 hover:bg-white/10 sm:block">{UTILITY_LABEL[portal]}</button>
              <span className="rounded bg-white/10 px-2 py-1" aria-label={`Signed in as ${userName ?? 'user'}`}>
                {userName ?? 'Profile'}
              </span>
            </>
          )}
        </div>
      </header>

      {/* docs/00 §4: "left nav: light surface; active item rendered as a raised white
          card" — the aside stays on the muted page background so the active link's
          bg-surface + shadow-raised actually reads as a raised card, not a no-op. */}
      <aside className="fixed bottom-0 left-0 top-14 z-20 hidden w-64 overflow-y-auto border-r border-[var(--color-border)] bg-surface-muted p-3 md:block">
        <nav aria-label={`${portal} navigation`} className="space-y-1">
          {navigation.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`focus-visible-ring block rounded px-3 py-2.5 text-sm font-medium transition duration-fast ${active ? 'bg-surface text-primary shadow-raised' : 'text-[var(--color-text-secondary)] hover:bg-surface-muted hover:text-primary'}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className={`min-h-screen pt-14 ${portal === 'exporter' ? 'pb-16 md:ml-64 md:pb-0' : 'md:ml-64'}`}>
        {children}
      </main>

      {portal === 'exporter' && mobileNav.length > 0 ? (
        <nav
          aria-label="Exporter mobile navigation"
          // Column count follows the filtered list — a fixed grid-cols-5 would leave dead
          // space for a guest, who only has two of the five destinations.
          style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}
          className="fixed inset-x-0 bottom-0 z-30 grid h-16 border-t border-[var(--color-border)] bg-surface md:hidden"
        >
          {mobileNav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={`focus-visible-ring flex items-center justify-center px-1 text-center text-xs font-semibold ${active ? 'text-[var(--color-action-text)]' : 'text-[var(--color-text-secondary)]'}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
