import Link from 'next/link';
import { buttonClass } from './Button';

/**
 * The standard way a tier boundary is shown to the user.
 *
 * docs/03 §5 and docs/00 §6: an empty or withheld state must explain *why* it is empty
 * and give the next action. A tier boundary rendered as a blank space, a disabled
 * control with no label, or a bare "no access" is a UX failure here — the whole point of
 * the freemium tier is that the user can see what they are not getting and how to get it.
 *
 * Pair with the `UPGRADE_REQUIRED` envelope from the API, whose `required_tier` tells you
 * which plan to name.
 */

export type UpgradeTier = 'free' | 'paid';

// Since 9 Nov 2026 an account alone runs no tools (docs/14 §3c), so the `free` step is
// "create an account on the way to membership": registration lands on the plans page.
const TIER_COPY: Record<UpgradeTier, { name: string; cta: string; href: string }> = {
  free: { name: 'an account', cta: 'Create an account', href: '/register?callbackUrl=/app/plans' },
  paid: { name: 'Premium', cta: 'See plans', href: '/app/plans' },
};

/**
 * Which step to name for someone who may not run a tool: a visitor or guest needs an account
 * first, a free account needs a membership. Paid callers never reach a notice.
 */
export function upgradeTierFor(tier: 'guest' | 'free' | 'paid' | null | undefined): UpgradeTier {
  return tier === 'free' ? 'paid' : 'free';
}

interface UpgradeNoticeBase {
  /** What is withheld, in the user's terms. */
  title: string;
  requiredTier: UpgradeTier;
}

/**
 * `block` requires the explanation; `inline` has no room to render one, so it must not
 * ask callers for prose that would be silently dropped.
 */
export type UpgradeNoticeProps =
  | (UpgradeNoticeBase & { variant?: 'block'; description: string })
  | (UpgradeNoticeBase & { variant: 'inline'; description?: never });

export function UpgradeNotice(props: UpgradeNoticeProps) {
  const { title, requiredTier, variant = 'block' } = props;
  const copy = TIER_COPY[requiredTier];

  if (variant === 'inline') {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
        <LockIcon />
        <span>{title}</span>
        <Link href={copy.href} className="focus-visible-ring rounded font-semibold text-primary underline underline-offset-2">
          {copy.cta}
        </Link>
      </span>
    );
  }

  return (
    <section className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-6 text-center">
      <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-surface-muted text-primary">
        <LockIcon />
      </div>
      <h3 className="text-base font-semibold text-primary">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-text-secondary)]">{props.description}</p>
      <Link
        href={copy.href}
        className={buttonClass('primary', 'md', 'mt-4')}
      >
        {copy.cta}
      </Link>
    </section>
  );
}

/** Label always accompanies this icon — it is never the only cue (docs/10 §4). */
function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="7" width="10" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
