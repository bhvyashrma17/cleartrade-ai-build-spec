/**
 * `/app/more` — the fifth item in docs/00 §4's mobile bottom nav. Holds everything that
 * doesn't fit in the four primary tabs: secondary destinations already built, tier-gated
 * ones the account hasn't unlocked yet, and screens the product hasn't built yet.
 *
 * Every row here is either a real link or an explicit "not built yet" / "upgrade to
 * unlock" state — never a link to a 404 (AGENTS.md: don't hide the gap, don't fake it).
 */

import Link from 'next/link';
import { OrgTier } from '@prisma/client';
import { getPrincipal } from '@/lib/auth';
import { UpgradeNotice } from '@/components/ui';

interface MenuLink {
  label: string;
  href: string;
  description: string;
}

const EXPLORE: MenuLink[] = [
  { label: 'Markets', href: '/app/markets', description: 'Demand discovery and market scoring.' },
  { label: 'Buyers', href: '/app/buyers', description: 'Search and shortlist verified buyers.' },
];

const MANAGE_FREE: MenuLink[] = [
  { label: 'Readiness', href: '/app/readiness', description: 'Your export-readiness assessment and score.' },
];

const PAID_ONLY: { label: string; description: string }[] = [
  { label: 'Deals', description: 'Every deal your agent is working, across every buyer.' },
  { label: 'Tasks', description: 'Cross-deal task queue, owner and due time.' },
  { label: 'Messages', description: 'Conversations with your agent and buyers.' },
];

const NOT_BUILT: { label: string; description: string }[] = [
  { label: 'Documents', description: 'Generated, reviewed and filed documents across your deals.' },
  { label: 'Shipments', description: 'Milestone tracking and exceptions across active shipments.' },
  { label: 'Payments', description: 'Due and overdue buyer payments across your deals.' },
  { label: 'Support', description: 'Contact ClearTrade support.' },
];

function LinkRow({ item }: { item: MenuLink }) {
  return (
    <Link
      href={item.href}
      className="focus-visible-ring flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-surface px-4 py-3 hover:bg-surface-muted"
    >
      <div>
        <p className="font-medium text-primary">{item.label}</p>
        <p className="text-sm text-[var(--color-text-secondary)]">{item.description}</p>
      </div>
      <ChevronRight />
    </Link>
  );
}

function LockedRow({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface px-4 py-3">
      <div>
        <p className="font-medium text-primary">{label}</p>
        <p className="text-sm text-[var(--color-text-secondary)]">{description}</p>
      </div>
      <UpgradeNotice title="Paid plan" requiredTier="paid" variant="inline" />
    </div>
  );
}

function ComingSoonRow({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-3 opacity-80">
      <div>
        <p className="font-medium text-primary">{label}</p>
        <p className="text-sm text-[var(--color-text-secondary)]">{description}</p>
      </div>
      <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
        Coming soon
      </span>
    </div>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-[var(--color-text-secondary)]">
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export default async function MorePage() {
  const principal = await getPrincipal();
  const tier = principal?.tier ?? OrgTier.guest;
  const isPaid = tier === OrgTier.paid;
  const isAtLeastFree = tier === OrgTier.free || tier === OrgTier.paid;

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <header className="mb-6">
        <p className="text-sm font-medium text-primary">More</p>
        <h1 className="text-2xl font-semibold text-primary">Everything else</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Secondary destinations not on the primary tab bar.</p>
      </header>

      <Section title="Explore">
        {EXPLORE.map((item) => (
          <LinkRow key={item.href} item={item} />
        ))}
      </Section>

      <Section title="Manage">
        {isAtLeastFree ? (
          MANAGE_FREE.map((item) => <LinkRow key={item.href} item={item} />)
        ) : (
          <LockedRow label="Readiness" description="Your export-readiness assessment and score." />
        )}
        {!isPaid ? PAID_ONLY.map((item) => <LockedRow key={item.label} label={item.label} description={item.description} />) : null}
      </Section>

      <Section title="Coming soon">
        {NOT_BUILT.map((item) => (
          <ComingSoonRow key={item.label} label={item.label} description={item.description} />
        ))}
      </Section>
    </div>
  );
}
