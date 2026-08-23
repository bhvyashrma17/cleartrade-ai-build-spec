'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { UserRole } from '@prisma/client';
import { Wordmark } from '@/components/brand/Wordmark';
import { buttonClass } from '@/components/ui/Button';
import { CommandPalette } from './CommandPalette';
import { ProfileMenu } from './ProfileMenu';

export type Portal = 'exporter' | 'agent' | 'ops';
export type Tier = 'guest' | 'free' | 'paid';

export const TIER_RANK: Record<Tier, number> = { guest: 0, free: 1, paid: 2 };

export interface NavItem {
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
export const NAVIGATION: Record<Portal, NavItem[]> = {
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
    <div className="min-h-screen bg-ground" data-density={DENSITY[portal]}>
      {/* One bar, not two.
          The product used to spend a 56px top bar AND a 256px sidebar on chrome before a
          single pixel of content — roughly a fifth of a laptop screen given over to
          furniture, on every page. Navigation is horizontal here and the content gets the
          full width back. Anything the bar cannot hold lives in the command palette. */}
      <header className="fixed inset-x-0 top-0 z-40 h-topbar border-b border-line bg-[color-mix(in_srgb,var(--ground)_82%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-shell items-center gap-6 px-4 sm:px-6">
          <Link href={navigation[0]?.href ?? '/'} className="focus-visible-ring -m-1 shrink-0 rounded p-1" aria-label="ClearTrade — home">
            <Wordmark size="sm" />
          </Link>

          <nav aria-label={`${portal} navigation`} className="hidden min-w-0 flex-1 items-center gap-0.5 lg:flex">
            {navigation.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'focus-visible-ring relative rounded-md px-3 py-2 text-sm transition-colors duration-fast',
                    active ? 'text-bone' : 'text-muted hover:text-bone',
                  )}
                >
                  {item.label}
                  {/* The active marker is the accent's one job in the chrome. */}
                  {active ? (
                    <span aria-hidden="true" className="absolute inset-x-3 -bottom-[13px] h-[2px] bg-accent" />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <CommandPalette portal={portal} navigation={navigation} />
            {isGuest ? (
              <>
                <span className="hidden items-center gap-1.5 rounded-sm border border-line-strong px-2 py-1 text-xs text-slate sm:inline-flex">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-slate" />
                  Guest
                </span>
                <Link href="/register" className={buttonClass('primary', 'sm')}>
                  Create free account
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="focus-visible-ring hidden rounded-md px-2.5 py-1.5 text-xs text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-bone sm:block"
                >
                  {UTILITY_LABEL[portal]}
                </button>
                {userEmail ? <ProfileMenu name={userName} email={userEmail} portal={portal} role={role} /> : null}
              </>
            )}
          </div>
        </div>

        {/* Below lg the horizontal nav would overflow, so it becomes a scrolling rail
            rather than collapsing into a hamburger — a queue worker on a tablet should
            not have to open a menu to change surface. */}
        <nav
          aria-label={`${portal} navigation, compact`}
          className="flex items-center gap-1 overflow-x-auto border-t border-line bg-ground px-4 py-1.5 lg:hidden"
        >
          {navigation.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'focus-visible-ring shrink-0 rounded-md px-2.5 py-1.5 text-xs transition-colors duration-fast',
                  active ? 'bg-surface-2 text-bone' : 'text-muted hover:text-bone',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main
        className={clsx(
          'mx-auto min-h-screen max-w-shell px-4 sm:px-6',
          // The compact nav rail adds a second row under the bar below lg.
          'pt-[calc(var(--topbar-height)+40px)] lg:pt-topbar',
          portal === 'exporter' && 'pb-20 md:pb-0',
        )}
      >
        {children}
      </main>

      {portal === 'exporter' && mobileNav.length > 0 ? (
        <nav
          aria-label="Exporter mobile navigation"
          style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}
          className="fixed inset-x-0 bottom-0 z-40 grid h-16 border-t border-line bg-[color-mix(in_srgb,var(--ground)_90%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
        >
          {mobileNav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'focus-visible-ring relative flex items-center justify-center px-1 text-center text-xs font-medium transition-colors duration-fast',
                  active ? 'text-bone' : 'text-muted',
                )}
              >
                {active ? <span aria-hidden="true" className="absolute inset-x-5 top-0 h-[2px] bg-accent" /> : null}
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
