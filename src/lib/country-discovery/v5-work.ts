/**
 * The agent's Demand Discovery work for a v5 run (E-061).
 *
 * v5 rows carry none of the Country Truth pillars, so the v4 readings — "Classification needed" on
 * every market, four ClearTrade tasks per market (872 on Lappu Exports' basmati run) — describe
 * work the v5 engine never reads. What an agent can change in a v5 result is the tariff line: where
 * the product's HS code splits into national lines with different duties, the score carries an
 * estimated duty until someone answers which line the product is. So that is the work, and only
 * for the markets the run handed on to buyer search; everything else is the engine's own status.
 */
import type { ImprovementAction } from './improve';

/** The classification state this module reads (`ClassificationQuestionView` in `service.ts`). */
export interface TariffLineState {
  state: 'not_applicable' | 'no_evidence_yet' | 'questions' | 'agent_classification_required' | 'resolved';
  remaining: number;
  questions: readonly unknown[];
}

export type V5StatusTone = 'ready' | 'needs_evidence' | 'needs_classification' | 'incomplete';

/**
 * Whether the stored v5 score used an official duty or a published rule (`metrics.ts`: the duty
 * metric's `inputs.basis`). Then the tariff line is not what the result is missing, and no
 * question is put to the agent for it.
 */
export function v5DutyIsOfficial(scoreBreakdown: unknown): boolean {
  const metrics = scoreBreakdown && typeof scoreBreakdown === 'object' ? (scoreBreakdown as { metrics?: unknown }).metrics : null;
  if (!Array.isArray(metrics)) return false;
  const duty = metrics.find((metric) => metric && typeof metric === 'object' && (metric as { key?: unknown }).key === 'duty') as { score?: unknown; inputs?: { basis?: unknown } } | undefined;
  return duty != null && typeof duty.score === 'number' && (duty.inputs?.basis === 'official' || duty.inputs?.basis === 'rule');
}

/** A v5 market's one-line status for the agent: the tariff line first, then the engine's status and hand-off. */
export function v5MarketStatus(
  row: { market_status?: string | null; handed_off?: boolean | null },
  classification?: TariffLineState | null,
): { status: string; status_tone: V5StatusTone } {
  if (classification?.state === 'questions') {
    const n = classification.questions.length;
    return { status: `Tariff line needs ${n} ${n === 1 ? 'answer' : 'answers'}`, status_tone: 'needs_classification' };
  }
  if (classification?.state === 'agent_classification_required') return { status: 'Needs ClearTrade classification', status_tone: 'needs_classification' };
  if (row.market_status === 'excluded') return { status: 'Excluded', status_tone: 'incomplete' };
  if (row.market_status !== 'ranked') return { status: 'Not ranked', status_tone: 'incomplete' };
  return row.handed_off ? { status: 'Handed on to buyer search', status_tone: 'ready' } : { status: 'Ranked', status_tone: 'ready' };
}

/** The ClearTrade task for one handed-on v5 market: answer the tariff-line questions, when there are any. */
export function v5AgentActions(classification: TariffLineState | null | undefined): ImprovementAction[] {
  if (classification?.state !== 'questions' || classification.questions.length === 0) return [];
  const n = classification.questions.length;
  return [{
    code: 'answer_tariff_line_questions',
    label: `Answer ${n} tariff-line ${n === 1 ? 'question' : 'questions'}`,
    owner: 'cleartrade',
    unlocks: 'Official duty',
    href: null,
    detail: `The product's HS code splits into ${classification.remaining} national lines here, and the score uses an estimated duty until the line is known. Answer only what the exporter has confirmed.`,
  }];
}
