import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, prerequisitesNotMet } from '@/lib/errors';

/**
 * Closed (owner, 30 Oct 2026, D-037). Agents used to record the official duty read from a market's
 * own tariff here (D-024). Demand Discovery now takes duty only from official sources the system
 * reads itself, or from a labelled estimate, so this refuses every request. Lines recorded before
 * stay in the evidence store but are no longer read by runs.
 */
export async function POST() {
  const correlationId = newCorrelationId();
  try {
    await requirePrincipal();
    throw prerequisitesNotMet(
      [{ object_type: 'market_access_manual_capture', object_id: 'agent_recorded_duty', reason: 'RETIRED: agents no longer record tariff lines (D-037).' }],
      'Agents no longer record tariff lines. A market without an automatically read official tariff shows a labelled estimate.',
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
