'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { UserRole } from '@prisma/client';
import { Wordmark } from '@/components/brand/Wordmark';
import { buttonClass } from '@/components/ui/Button';
import { ProfileMenu } from './ProfileMenu';

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

/**
 * Every href here must resolve to a real page — `tests/navigation.test.ts` walks this table
 * against src/app and fails on a dead link.
 *
 * Removed in Phase 4 rather than left pointing at 404s: /ops/compliance, /ops/settings,
 * /app/documents, /app/shipments, /app/payments and /app/support. None of those routes exist,
 * and shipping navigation to a missing page is worse than omitting the entry — it reads as a
 * broken product rather than an unbuilt one. They return when the surfaces are built.
 */
const NAVIGATION: Record<Portal, NavItem[]> = {
  exporter: [
    { label: 'Overview', href: '/app/overview', minTier: 'free' },
    { label: 'Readiness', href: '/app/readiness', minTier: 'free' },
    { label: 'Markets', href: '/app/markets', minTier: 'guest' },
    { label: 'Buyers', href: '/app/buyers', minTier: 'guest' },
    { label: 'Deals', href: '/app/deals', minTier: 'paid' },
    { label: 'Tasks', href: '/app/tasks', minTier: 'paid' },
    { label: 'Messages', href: '/app/messages', minTier: 'paid' },
    { label: 'Notifications', href: '/app/notifications', minTier: 'free' },
  ],
  agent: [
    { label: 'My Day', href: '/agent', minTier: 'paid' },
    { label: 'Exporters', href: '/agent/exporters', minTier: 'paid' },
    { label: 'Outreach', href: '/agent/outreach', minTier: 'paid' },
    { label: 'Deals', href: '/agent/deals', minTier: 'paid' },
    { label: 'Tasks', href: '/agent/tasks', minTier: 'paid' },
    { label: 'Escalations', href: '/agent/escalations', minTier: 'paid' },
    // AGT-08's route is `/agent/performance` in both docs/05 and the docs/12 registry —
    // this nav entry previously pointed at `/agent/payout`, which no route ever served.
    { label: 'Performance', href: '/agent/performance', minTier: 'paid' },
  ],
  ops: [
    { label: 'Control Tower', href: '/ops', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Assignments', href: '/ops/assignments', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Agents', href: '/ops/agents', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Exceptions', href: '/ops/exceptions', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Finance', href: '/ops/finance', minTier: 'paid', roles: ['ops_finance', 'admin'] },
    { label: 'Disputes', href: '/ops/disputes', minTier: 'paid', roles: ['ops_supervisor', 'ops_finance', 'admin'] },
    { label: 'Settings', href: '/ops/settings', minTier: 'paid', roles: ['admin'] },
    { label: 'Audit', href: '/ops/audit', minTier: 'paid', roles: ['ops_supervisor', 'ops_finance', 'admin'] },
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

/**
 * The eyebrow over the nav list. A person with access to more than one portal has, until
 * now, had nothing on screen telling them which one they are in — the three shells were
 * pixel-identical apart from the nav labels.
 */
const PORTAL_LABEL: Record<Portal, string> = {
  exporter: 'Exporter portal',
  agent: 'Agent console',
  ops: 'Operations',
};

/**
 * Density is a shell property, not a component variant.
 *
 * The exporter portal is read by one person planning one export, so it gets air: 15px
 * body, 24px card inset, 52px rows. Agent and Ops are worked as queues by people who need
 * to see thirty rows without scrolling, so they get 13px body, 16px inset, 36px rows.
 * Components never opt in — they read the CSS variables this attribute re-points, which
 * is what keeps the three portals one product at two densities instead of two designs.
 */
const DENSITY: Record<Portal, 'comfortable' | 'compact'> = {
  exporter: 'comfortable',
  agent: 'compact',
  ops: 'compact',
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
  userEmail,
  tier,
  role,
}: {
  children: ReactNode;
  portal: Portal;
  userName: string | null;
  userEmail: string | null;
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
    <div className="min-h-screen bg-paper" data-density={DENSITY[portal]}>
      {/* The chrome is ink and the mark is bone — the inversion the brand is built on.
          The top bar carries the lockup, not the string "ClearTrade AI" set in bold
          interface sans, which is what sat in the strongest position on every screen in
          the product until now. */}
      <header className="on-ink fixed inset-x-0 top-0 z-30 flex h-topbar items-center justify-between border-b border-[color-mix(in_srgb,var(--bone)_12%,transparent)] bg-ink-900 px-4 md:px-6">
        <Link href={navigation[0]?.href ?? '/'} className="focus-visible-ring -m-1 rounded p-1" aria-label="ClearTrade AI — home">
          <Wordmark tone="bone" />
        </Link>
        <div className="flex items-center gap-3">
          {isGuest ? (
            // The tier boundary has to be legible, not implied by absence: a guest should
            // always be able to see that they are browsing anonymously and what fixes it.
            <>
              <span className="hidden items-center gap-1.5 rounded-sm border border-[color-mix(in_srgb,var(--bone)_20%,transparent)] px-2 py-1 text-xs text-slate sm:inline-flex">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-slate" />
                Browsing as guest
              </span>
              <Link href="/register" className={buttonClass('inverse', 'sm')}>
                Create free account
              </Link>
            </>
          ) : (
            <>
              <button
                type="button"
                className="focus-visible-ring hidden rounded-sm px-2.5 py-1.5 text-xs font-medium text-slate transition-colors duration-fast hover:bg-[color-mix(in_srgb,var(--bone)_10%,transparent)] hover:text-bone sm:block"
              >
                {UTILITY_LABEL[portal]}
              </button>
              {userEmail ? <ProfileMenu name={userName} email={userEmail} portal={portal} role={role} /> : null}
            </>
          )}
        </div>
      </header>

      {/* The nav sits on `--paper-sunk` so the active item's white card actually reads as
          raised. Previously the aside and the page were both `--color-surface-muted`, so
          the "raised white card" active state specified in docs/00 §4 was a white card on
          a white-ish ground — a no-op, and the reason the current page was hard to find.
          The seal bar at the left edge is the accent's one job in the shell. */}
      <aside className="fixed bottom-0 left-0 top-topbar z-20 hidden w-leftnav overflow-y-auto border-r border-line bg-paper-sunk px-3 py-4 md:block">
        <p className="eyebrow px-3 pb-2">{PORTAL_LABEL[portal]}</p>
        <nav aria-label={`${portal} navigation`} className="space-y-0.5">
          {navigation.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'focus-visible-ring relative block rounded-lg px-3 py-2 text-sm transition-colors duration-fast',
                  active
                    ? 'bg-card font-semibold text-ink-900 shadow-raised'
                    : 'font-medium text-ink-300 hover:bg-[color-mix(in_srgb,var(--card)_60%,transparent)] hover:text-ink-900',
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-seal-600"
                  />
                ) : null}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className={clsx('min-h-screen pt-topbar', portal === 'exporter' ? 'pb-16 md:ml-leftnav md:pb-0' : 'md:ml-leftnav')}>
        {children}
      </main>

      {portal === 'exporter' && mobileNav.length > 0 ? (
        <nav
          aria-label="Exporter mobile navigation"
          // Column count follows the filtered list — a fixed grid-cols-5 would leave dead
          // space for a guest, who only has two of the five destinations.
          style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}
          className="fixed inset-x-0 bottom-0 z-30 grid h-16 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {mobileNav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'focus-visible-ring relative flex items-center justify-center px-1 text-center text-xs font-semibold transition-colors duration-fast',
                  active ? 'text-ink-900' : 'text-ink-300',
                )}
              >
                {active ? (
                  <span aria-hidden="true" className="absolute inset-x-4 top-0 h-[2px] rounded-full bg-seal-600" />
                ) : null}
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
