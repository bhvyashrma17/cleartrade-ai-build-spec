/**
 * The buyer action catalogue: what each control is called, what it does, and what it does NOT do.
 *
 * Extracted out of the component so it can be asserted as data rather than as source text. A
 * test that greps a `.tsx` file for the phrase "Automation paused" passes just as happily when
 * that phrase sits in a comment explaining why it must never be shown — which is exactly the
 * false positive this module removes. Here the strings ARE the rendered copy, so a test that
 * reads them is testing what an agent sees.
 *
 * The consequence wording is not decoration. An agent needs to know, before clicking, whether
 * an action moves operational state or merely records an opinion, and the automation entries
 * have to stay honest about gating nothing (see AUTOMATION_IS_ADVISORY in buyer-commands.ts).
 */

export type BuyerActionName =
  | 'promote' | 'demote' | 'qualify' | 'unqualify' | 'request_review'
  | 'shortlist' | 'disqualify' | 'restore'
  | 'pause_automation' | 'resume_automation';

/**
 * Mirrors `BuyerActionCategory` in buyer-commands.ts, and must stay identical to it — a test
 * asserts every action's UI consequence equals the service's category. Two names for one
 * concept is how a label ends up promising something the service does not do.
 */
export type BuyerActionConsequence = 'decision' | 'canonical' | 'automation';

export interface BuyerActionSpec {
  action: BuyerActionName;
  label: string;
  consequence: BuyerActionConsequence;
  /** Whether an operational priority input is offered — the service rejects it otherwise. */
  priority?: boolean;
  /** Whether the canonical disqualification reason must be collected. */
  needsDisqualificationReason?: boolean;
  /** Shown before the agent commits, so the effect is never a surprise. */
  consequenceNote: string;
}

export const BUYER_CONSEQUENCE_LABEL: Record<BuyerActionConsequence, string> = {
  decision: 'Decision only',
  canonical: 'Changes pipeline state',
  automation: 'Records an instruction',
};

/**
 * Wording for the automation controls.
 *
 * Nothing outside the decision layer reads `AgentDecision`, so no worker, route or scheduler
 * consults a pause. Claiming otherwise would let an agent believe they had stopped outreach
 * that is still running — the most damaging thing this surface could get wrong.
 */
export const BUYER_ADVISORY_NOTE =
  'Records the instruction and flags this buyer for the team. No backend job reads it yet, so outreach and automation do NOT stop on their own.';

export const BUYER_ACTION_SPECS: readonly BuyerActionSpec[] = [
  {
    action: 'promote', label: 'Promote', consequence: 'decision', priority: true,
    consequenceNote: 'Sets your operational priority above the AI ordering. Does not change the pipeline stage or the AI score.',
  },
  {
    action: 'demote', label: 'Demote', consequence: 'decision', priority: true,
    consequenceNote: 'Lowers your operational priority. Does not change the pipeline stage or the AI score.',
  },
  {
    action: 'qualify', label: 'Qualify', consequence: 'decision',
    consequenceNote: 'Records your judgement that this buyer is suitable. There is no canonical "qualified" pipeline stage, so nothing moves.',
  },
  {
    action: 'unqualify', label: 'Unqualify', consequence: 'decision',
    consequenceNote: 'Records your judgement that this buyer is not suitable. Nothing moves in the pipeline — use Disqualify for that.',
  },
  {
    action: 'request_review', label: 'Request review', consequence: 'decision',
    consequenceNote: 'Flags this buyer for compliance or Ops attention. Stays in the working order.',
  },
  {
    action: 'shortlist', label: 'Shortlist', consequence: 'canonical', priority: true,
    consequenceNote: 'Adds this buyer to the shortlist AND puts them in the pipeline: if no lead exists one is created and moved to Shortlisted. A lead already further along is not moved back.',
  },
  {
    action: 'disqualify', label: 'Disqualify', consequence: 'canonical', needsDisqualificationReason: true,
    consequenceNote: 'Moves the canonical lead to Disqualified and records the reason. The buyer leaves the active working order. The AI score and evidence are kept and stay visible.',
  },
  {
    action: 'restore', label: 'Restore', consequence: 'canonical',
    consequenceNote: 'Returns a disqualified lead to Shortlisted and clears the disqualification reason.',
  },
  { action: 'pause_automation', label: 'Pause automation', consequence: 'automation', consequenceNote: BUYER_ADVISORY_NOTE },
  { action: 'resume_automation', label: 'Resume automation', consequence: 'automation', consequenceNote: BUYER_ADVISORY_NOTE },
] as const;

export const DISQUALIFICATION_REASON_OPTIONS = [
  'no_response', 'not_importing_category', 'volume_too_small',
  'price_mismatch', 'risk_flag', 'duplicate', 'other',
] as const;
