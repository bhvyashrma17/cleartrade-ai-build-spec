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
    <div className={clsx('flex items-center gap-5', className)}>
      {/* The signature device, carrying the same count the rail spells out. Redundant on
          purpose: the glyph is what a person recognises across a table of thirty deals,
          the rail is what they read once they have stopped on one. */}
      <JourneyFrame
        value={currentIndex + 1}
        total={SEGMENTS.length}
        size={30}
        label={`Stage ${currentIndex + 1} of ${SEGMENTS.length}: ${SEGMENTS[currentIndex]!.label}`}
        className="hidden shrink-0 text-bone sm:block"
      />

      {/* Segmented bars rather than dots joined by connectors.
          The dot rail could not be made to behave: each connector had to be centred
          against a column that also held the label, so the line ran through the text, and
          a centred label on the final stage clipped at the container edge. A segment per
          stage has neither problem, survives any width, and reads as a progress track at
          a glance instead of as a row of checkboxes. */}
      <div className="min-w-0 flex-1">
      <ol className="flex min-w-0 gap-1.5" aria-label="Export journey progress">
        {SEGMENTS.map((segment, index) => {
          const completed = index < currentIndex;
          const isCurrent = index === currentIndex;
          const reached = completed || isCurrent;
          // Future stages stay non-actionable — docs/00 §4. `getHref` is only ever
          // consulted for a segment that has been reached.
          const href = reached ? (getHref?.(segment.key, index) ?? null) : null;

          const content = (
            <>
              <span
                aria-hidden="true"
                className={clsx(
                  'block h-1 rounded-sm transition-colors duration-fast',
                  completed ? 'bg-bone' : isCurrent ? 'bg-accent' : 'bg-line-strong',
                )}
              />
              {/* Seven labels across a phone gives each one ~39px, which turned
                  "Readiness" into "Rea…" and "Buyers" into "Buy…" — measured at
                  375px. A truncated label is worse than no label: it still costs
                  the row height and reads as a rendering fault. Below `md` the bars
                  carry the progress on their own and the stage is named once, in
                  full, beneath the track. */}
              <span
                className={clsx(
                  'mt-2.5 hidden truncate text-xs transition-colors duration-fast md:block',
                  isCurrent ? 'font-medium text-bone' : reached ? 'text-slate' : 'text-muted',
                )}
              >
                {segment.label}
              </span>
            </>
          );

          return (
            <li key={segment.key} className="min-w-0 flex-1">
              {href ? (
                // Hiding the label on mobile left this link 4px tall — a 1px bar plus
                // margins — which is not a target anyone can hit. The padding is added
                // and then pulled back out with a negative margin, so the tap area grows
                // to 44px while the bar stays exactly where it was drawn.
                <Link
                  href={href}
                  aria-current={isCurrent ? 'step' : undefined}
                  className="focus-visible-ring -my-5 block rounded-sm py-5 md:my-0 md:py-0"
                >
                  {content}
                </Link>
              ) : (
                <div aria-current={isCurrent ? 'step' : undefined}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>

      {/* The phone's replacement for the seven labels above: one line that names the
          stage in full and says where it sits in the sequence. `aria-hidden` because
          the <ol> already exposes the same information to a screen reader through
          `aria-current="step"` and the segment labels — announcing it twice would be
          noise, not help. */}
      <p aria-hidden="true" className="mt-2 text-xs text-slate md:hidden">
        <span className="font-medium text-bone">{SEGMENTS[currentIndex]!.label}</span>
        <span className="text-muted"> · stage {currentIndex + 1} of {SEGMENTS.length}</span>
      </p>
      </div>
    </div>
  );
}
