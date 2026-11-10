/**
 * POST /api/v1/products — a member adds a product, confirms its HS code, and Demand Discovery starts.
 *
 * Demand Discovery runs only for a saved product with a confirmed classification (docs/36, the
 * `discovery-runs` route), but nothing let an exporter save a product: the only path was the guest
 * registration hand-over, which no longer exists (D-039). Found by the production check on 9 Nov
 * 2026 (E-053): a member signed up with Google could not start a single run.
 *
 * One call does what the journey needs, in order:
 *   1. the product row (`manually_entered_real`, the same provenance registration used);
 *   2. the exporter's classification, `exporter_supplied` at full confidence — the code is the
 *      exporter's own statement, checked against the official HS 2022 list the code finder reads;
 *   3. the exporter's confirmation (`confirm_hs_code: true` is the human confirmation the
 *      classification route also requires), which auto-starts Demand Discovery v5;
 *   4. if auto-start is switched off, the run is started the way `POST /api/v1/discovery-runs` does.
 *
 * Paid members only, like every tool (docs/14 §3c): 401 without a session, 402 below paid, before
 * anything is read or written.
 */
import { EvidenceOrigin, ProductClassificationMethod } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { requirePrincipal } from '@/lib/auth';
import { demandDiscoveryV5Availability, startDemandDiscoveryV5 } from '@/lib/demand-discovery-v5/service';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { loadHsIndex } from '@/lib/hs-finder/catalogue';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { confirmClassification, proposeClassification } from '@/lib/product-classification';
import { zodFieldErrors } from '@/lib/validators';

const bodySchema = z
  .object({
    name: z.string().trim().min(3, 'Describe your product in a few words.').max(120, 'Keep the name under 120 characters.'),
    description: z.string().trim().max(500).optional(),
    hs_code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit HS code, or find it from your description.'),
    confirm_hs_code: z.literal(true, { errorMap: () => ({ message: 'Confirm that this code describes your product.' }) }),
    /** Where the code came from when it was picked in the code finder, e.g. "CEPII BACI product codes HS22". */
    code_list: z.string().trim().max(200).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'demand_discovery.run');
    const orgId = principal.exporter_org_id;
    if (!orgId) throw validationError([{ field: 'exporter_org_id', code: 'required', message: 'Only an exporter account can add products.' }]);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const list = await loadHsIndex();
    if (!list) throw validationError([{ field: 'hs_code', code: 'list_unavailable', message: 'The official code list is not loaded yet, so the code cannot be checked. Try again later.' }]);
    if (!list.index.codes.has(input.hs_code)) {
      throw validationError([{ field: 'hs_code', code: 'unknown_code', message: `${input.hs_code} is not a subheading in the HS 2022 list. Use the code finder to pick one.` }]);
    }
    const duplicate = await prisma.product.findFirst({ where: { exporter_org_id: orgId, name: { equals: input.name, mode: 'insensitive' } }, select: { id: true } });
    if (duplicate) throw validationError([{ field: 'name', code: 'duplicate', message: 'You already have a product with this name. Choose it from your products.' }]);

    const product = await prisma.$transaction(async (tx) => {
      const row = await tx.product.create({
        data: { exporter_org_id: orgId, name: input.name, description: input.description || input.name, evidence_origin: EvidenceOrigin.manually_entered_real },
        select: { id: true },
      });
      await writeAuditEvent({ db: tx, actor: principal, action: AUDIT_ACTIONS.create, object_type: 'product', object_id: row.id, exporter_org_id: orgId, after_summary: { name: input.name, hs_code: input.hs_code }, correlation_id: correlationId });
      return row;
    });

    const source = input.code_list ?? list.version;
    const candidate = await proposeClassification(
      {
        product_id: product.id, hs6_code: input.hs_code, itc_hs_code: null, nomenclature: 'HS', nomenclature_version: '2022',
        method: ProductClassificationMethod.exporter_supplied, confidence: 1,
        rationale: `HS 2022 subheading ${input.hs_code}, chosen and confirmed by the exporter.`,
        evidence: { submitted_from: 'add_product', code_list: source },
        source_references: [{ label: 'Official HS 2022 code list', reference: source }],
      },
      principal,
      correlationId,
    );
    await confirmClassification({ classification_id: candidate.id, product_id: product.id }, principal, correlationId);

    // Confirmation auto-starts the run when config allows; otherwise start it here, as the run route does.
    let run = await prisma.discoveryRun.findFirst({ where: { product_id: product.id }, orderBy: { created_at: 'desc' }, select: { id: true, job_id: true, status: true } });
    let notStarted: string | null = null;
    if (!run) {
      const availability = await demandDiscoveryV5Availability();
      if (availability.available) {
        const started = await startDemandDiscoveryV5({ product_id: product.id, actor: principal, trigger: 'manual', correlation_id: correlationId });
        run = { id: started.run_id, job_id: started.job_id, status: started.status };
      } else {
        notStarted = `${availability.reason} The product is saved; start the search once Demand Discovery is available.`;
      }
    }

    return NextResponse.json(
      single({ product_id: product.id, classification_id: candidate.id, hs_code: input.hs_code, run: run ? { id: run.id, job_id: run.job_id, status: run.status } : null, not_started_reason: notStarted }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
