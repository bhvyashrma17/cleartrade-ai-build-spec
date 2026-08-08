/**
 * JourneyProgress — the shared rail from docs/13 A4.
 *
 * The PRD's data model has 8 canonical states; the Blueprint's wireframe shows 7 rail
 * segments. Resolution: 8 states drive the logic, 7 segments render — `onboarding` and
 * `ready` are two states of the same first segment ("Readiness"). One component, used
 * here on the exporter dashboard and later by the Deal Workspace (EXP-09's progress
 * rail) — never two rails computing "how far along" differently.
 *
 * Deliberately decoupled from Prisma: `JourneyStageValue` is a plain string union, not an
 * import from `@prisma/client`, so this stays a framework-agnostic UI primitive like its
 * siblings (StatusChip, MetricCard). The caller (a server component) is where the Prisma
 * enum — identical strings — gets used; this component never touches the database.
 *
 * docs/00 §4: "filled dots for completed/current, hollow for future, connected by a
 * line. Future stages are non-actionable." That non-actionable rule is enforced here,
 * not left to the caller: `getHref` is only ever consulted for a reached segment.
 */

import clsx from 'clsx';
import Link from 'next/link';

export type JourneyStageValue =
  | 'onboarding'
  | 'ready'
  | 'market_selected'
  | 'buyer_engaged'
  | 'deal_locked'
  | 'docs_cleared'
  | 'shipped'
  | 'payment_realized';

interface Segment {
  key: string;
  label: string;
  /** Which of the 8 states collapse into this one rail position. */
  states: JourneyStageValue[];
}

/** Canonical order — docs/13 A4. Also the single source of truth for "how far along". */
const SEGMENTS: Segment[] = [
  { key: 'readiness', label: 'Readiness', states: ['onboarding', 'ready'] },
  { key: 'market', label: 'Market', states: ['market_selected'] },
  { key: 'buyers', label: 'Buyers', states: ['buyer_engaged'] },
  { key: 'deal', label: 'Deal', states: ['deal_locked'] },
  { key: 'docs', label: 'Docs', states: ['docs_cleared'] },
  { key: 'ship', label: 'Ship', states: ['shipped'] },
  { key: 'paid', label: 'Paid', states: ['payment_realized'] },
];

function segmentIndexFor(stage: JourneyStageValue): number {
  const index = SEGMENTS.findIndex((s) => s.states.includes(stage));
  return index === -1 ? 0 : index;
}

export interface JourneyProgressProps {
  currentStage: JourneyStageValue;
  /**
   * Deep-link target for a REACHED segment (completed or current). Return `null` to keep
   * a reached segment non-actionable anyway (e.g. "Deal" is reached but there's no single
   * deal id to link to from an org-wide dashboard). Never consulted for a future segment.
   */
  getHref?: (segmentKey: string, segmentIndex: number) => string | null;
  className?: string;
}

export function JourneyProgress({ currentStage, getHref, className }: JourneyProgressProps) {
  const currentIndex = segmentIndexFor(currentStage);

  return (
    <ol className={clsx('flex items-center', className)} aria-label="Export journey progress">
      {SEGMENTS.map((segment, index) => {
        const completed = index < currentIndex;
        const isCurrent = index === currentIndex;
        const reached = completed || isCurrent;
        const href = reached ? (getHref?.(segment.key, index) ?? null) : null;

        // A checkmark on the CURRENT segment would claim it's done when it's in
        // progress — the same "never collapse two states into one chip" rule docs/03 §2
        // applies to journey vs. completion, not just to different status layers.
        //
        // Colors here are deliberately never teal-on-white or white-on-teal: measured at
        // 2.49:1, which fails WCAG AA for text (4.5:1) and even the 3:1 floor for a
        // graphical UI component. Both marks use navy instead — navy-on-teal (7.05:1) for
        // the completed check, navy-on-white for the current ring — the only two
        // navy/teal pairings this codebase has verified as accessible.
        const dot = (
          <span
            className={clsx(
              'flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-bold transition duration-fast',
              completed
                ? 'border-action bg-action text-primary'
                : isCurrent
                  ? 'border-primary bg-surface text-primary'
                  : 'border-[var(--color-border-strong)] bg-surface text-transparent',
            )}
          >
            {completed ? '✓' : isCurrent ? '●' : ''}
          </span>
        );

        const label = (
          <span
            className={clsx(
              'mt-1.5 whitespace-nowrap text-xs font-medium',
              isCurrent ? 'text-primary' : reached ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]',
            )}
          >
            {segment.label}
          </span>
        );

        return (
          <li key={segment.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              {href ? (
                <Link
                  href={href}
                  className="focus-visible-ring flex flex-col items-center rounded"
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {dot}
                  {label}
                </Link>
              ) : (
                <div aria-current={isCurrent ? 'step' : undefined}>
                  {dot}
                  {label}
                </div>
              )}
            </div>
            {index < SEGMENTS.length - 1 ? (
              <span
                className={clsx(
                  'mx-1.5 h-0.5 flex-1 rounded transition duration-fast',
                  index < currentIndex ? 'bg-action' : 'bg-[var(--color-border-strong)]',
                )}
                aria-hidden="true"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
