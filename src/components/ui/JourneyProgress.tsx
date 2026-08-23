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
import { JourneyFrame } from './JourneyFrame';

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
    <div className={clsx('flex items-center gap-4', className)}>
      {/* The signature device, carrying the same number the rail spells out. Redundant on
          purpose: the glyph is what a person recognises across a table of thirty deals,
          the rail is what they read once they have stopped on one. */}
      <JourneyFrame
        value={currentIndex + 1}
        total={SEGMENTS.length}
        size={26}
        label={`Stage ${currentIndex + 1} of ${SEGMENTS.length}: ${SEGMENTS[currentIndex]!.label}`}
        className="hidden shrink-0 sm:block"
      />
      <ol className="flex flex-1 items-center" aria-label="Export journey progress">
      {SEGMENTS.map((segment, index) => {
        const completed = index < currentIndex;
        const isCurrent = index === currentIndex;
        const reached = completed || isCurrent;
        const href = reached ? (getHref?.(segment.key, index) ?? null) : null;

        // Square markers, not circles. The mark is built from hard corners and
        // registration ticks; a row of soft dots is the one shape in the system that
        // belongs to somebody else's product. The current stage is a seal square inside a
        // ring — never a checkmark, which would claim a stage in progress is done, the
        // same "never collapse two states into one" rule docs/03 §2 applies to chips.
        //
        // Colours are ink and seal only. The previous rail painted completed segments in
        // `--color-action`, which is the brand accent — so a half-finished journey read
        // as five brand-coloured beads, and the accent meant "done" here and "current"
        // everywhere else.
        const dot = (
          <span
            className={clsx(
              'flex size-3.5 items-center justify-center rounded-[2px] border transition-colors duration-fast',
              completed
                ? 'border-ink-900 bg-ink-900'
                : isCurrent
                  ? 'border-seal-600 bg-seal-600 ring-2 ring-[color-mix(in_srgb,var(--seal-600)_22%,transparent)]'
                  : 'border-line-strong bg-card',
            )}
          >
            {completed ? (
              <svg viewBox="0 0 10 10" className="size-2.5 text-bone" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 5.2 4.1 7.4 8 2.9" />
              </svg>
            ) : null}
          </span>
        );

        const label = (
          <span
            className={clsx(
              'mt-2 whitespace-nowrap text-xs',
              isCurrent ? 'font-semibold text-ink-900' : reached ? 'font-medium text-ink-500' : 'text-ink-300',
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
                  'mx-2 h-px flex-1 transition-colors duration-fast',
                  index < currentIndex ? 'bg-ink-900' : 'bg-line-strong',
                )}
                aria-hidden="true"
              />
            ) : null}
          </li>
        );
        })}
      </ol>
    </div>
  );
}
