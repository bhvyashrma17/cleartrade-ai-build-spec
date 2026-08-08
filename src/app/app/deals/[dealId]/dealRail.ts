import { DealStage, RiskState } from '@prisma/client';
import type { JourneyStageValue } from '@/components/ui';

/**
 * Maps a Deal's own 9-state stage onto `JourneyProgress`'s 8-state rail so the Deal
 * Workspace reuses the exact same component the dashboard does — one rail
 * implementation, not two computing "how far along" differently.
 *
 * The fit is not perfect and that's worth being explicit about: `JourneyProgress` has no
 * segment for "terms agreed" (docs/04 EXP-09 asks for Buyer engaged -> terms -> deal
 * locked -> docs -> shipment -> payment, a 6-step deal-specific rail). Rather than fork
 * the shared component for one caller, `qualifying`/`negotiating`/`terms_agreed` all
 * collapse into the rail's `buyer_engaged` segment — true to "not yet locked," not to
 * "which pre-lock step." The exact stage is never hidden: the deal header renders
 * `DEAL_STAGE_LABELS[deal.stage]` as text right next to the rail.
 */
export function dealStageForRail(stage: DealStage): JourneyStageValue {
  switch (stage) {
    case DealStage.qualifying:
    case DealStage.negotiating:
    case DealStage.terms_agreed:
      return 'buyer_engaged';
    case DealStage.deal_locked:
      return 'deal_locked';
    case DealStage.executing:
      return 'docs_cleared';
    case DealStage.shipped:
      return 'shipped';
    case DealStage.closed_won:
      return 'payment_realized';
    // Terminal-but-not-successful states have no forward position on a progress rail —
    // freezing at the segment reached before termination is the least misleading choice
    // (never claim more progress than happened), and the header's stage label plus a
    // dedicated StatusChip make the terminal state explicit rather than implied by the rail alone.
    case DealStage.closed_lost:
    case DealStage.cancelled:
      return 'buyer_engaged';
    default:
      return 'buyer_engaged';
  }
}

/** Only material risk states get a persistent banner (docs/00 §6, EXP-01: "only material blockers"). */
export function isMaterialRisk(risk: RiskState): boolean {
  return risk === RiskState.at_risk || risk === RiskState.blocked;
}
