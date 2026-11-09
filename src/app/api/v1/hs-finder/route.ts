/**
 * POST /api/v1/hs-finder — the product code finder (E-043; `src/lib/hs-finder/finder.ts`). The
 * exporter's own words in; at most three HS 2022 codes with their official descriptions out, and the
 * next question when a detail separates them. It reads only the public code list, no tenant data, and
 * writes nothing. It never decides a code: a picked code is proposed for an agent to confirm
 * (`product-classification.ts`).
 *
 * Members only since 9 Nov 2026 (docs/14 §3c, ledger E-052): it feeds Demand Discovery, which is a
 * paid tool, so it takes the same gate. A caller without a session gets 401, a free account
 * UPGRADE_REQUIRED, before the code list is loaded.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { loadHsIndex } from '@/lib/hs-finder/catalogue';
import { findHsCodes } from '@/lib/hs-finder/finder';
import { zodFieldErrors } from '@/lib/validators';

const bodySchema = z.object({
  description: z.string().trim().min(2).max(300),
  answers: z.record(z.string().max(40), z.string().max(40)).optional(),
}).strict();

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    assertCan(await requirePrincipal(), 'demand_discovery.run');
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const loaded = await loadHsIndex();
    if (!loaded) {
      return NextResponse.json(single({ available: false, reason: 'The product code list is not loaded in this environment yet.', candidates: [], question: null, more: 0, understood: [], note: null }));
    }
    return NextResponse.json(single({ available: true, source: loaded.version, ...findHsCodes(loaded.index, parsed.data) }));
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
