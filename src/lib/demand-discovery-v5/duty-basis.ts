/**
 * How a market's duty was found, read from the duty metric v5 stored with it (docs/36, docs/37).
 * Pure: the Phase 1 gate's evaluator uses it without loading the services that run v5.
 */

export type DutyBasis = 'official' | 'common_tariff' | 'schedule_read' | 'agent_recorded' | 'rule' | 'estimate' | 'none';

export const DUTY_BASES: readonly DutyBasis[] = ['official', 'common_tariff', 'schedule_read', 'agent_recorded', 'rule', 'estimate', 'none'];

export function dutyBasisOf(scoreBreakdown: unknown): { basis: DutyBasis; union: string | null; schedule?: string } {
  const metrics = (scoreBreakdown as { metrics?: { key?: string; score?: number | null; inputs?: Record<string, unknown> }[] } | null)?.metrics ?? [];
  const duty = metrics.find((metric) => metric.key === 'duty');
  if (!duty || duty.score == null) return { basis: 'none', union: null };
  const inputs = duty.inputs ?? {};
  if (inputs.basis === 'official') {
    if (typeof inputs.common_tariff === 'string' && inputs.common_tariff) return { basis: 'common_tariff', union: inputs.common_tariff };
    if (typeof inputs.schedule_read === 'string' && inputs.schedule_read) return { basis: 'schedule_read', union: null, schedule: inputs.schedule_read };
    return { basis: inputs.recorded_by_agent === 'yes' ? 'agent_recorded' : 'official', union: null };
  }
  if (inputs.basis === 'rule') return { basis: 'rule', union: null };
  if (inputs.basis === 'estimate') return { basis: 'estimate', union: null };
  return { basis: 'none', union: null };
}
