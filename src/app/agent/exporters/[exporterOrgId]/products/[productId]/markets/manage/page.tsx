/**
 * `/agent/exporters/:exporterOrgId/products/:productId/markets/manage` — the AI-recommendation
 * vs agent-decision control table, for ONE product.
 *
 * This used to render unconditionally on the exporter-org page, scoped to whichever product
 * happened to have that ORG's most recent DiscoveryRun — a real bug once an org has more than
 * one product, since a second product's markets would silently show under the first's run. This
 * page is scoped to the correct run: the one belonging to THIS product.
 *
 * Kept as a deliberate drill-down rather than inline on the product summary: the summary answers
 * "what needs doing", this answers "exactly how does the model's recommendation compare to what
 * an agent has decided, market by market" — a different, denser question that does not belong on
 * every visit to the product.
 */
import { notFound } from 'next/navigation';
import { requireAgentDiscoveryPrincipal, loadOrNotFound } from '@/lib/country-discovery/agent-page-auth';
import { assertOrgAccess } from '@/lib/permissions';
import { activeOnly, marketControlRows, sortByOperationalOrder } from '@/lib/demand-control';
import { prisma } from '@/lib/prisma';
import { PageHeader } from '@/components/ui';
import { DemandDiscoveryControl } from '@/components/agent/DemandDiscoveryControl';

export const dynamic = 'force-dynamic';

export default async function ManageMarketDecisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ exporterOrgId: string; productId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { exporterOrgId, productId } = await params;
  const { view } = await searchParams;
  const showAll = view === 'all';
  const principal = await requireAgentDiscoveryPrincipal();

  const product = await loadOrNotFound(async () => {
    await assertOrgAccess(principal, exporterOrgId);
    const found = await prisma.product.findFirst({ where: { id: productId, exporter_org_id: exporterOrgId }, select: { id: true, name: true } });
    if (!found) notFound();
    return found;
  });

  // THIS product's own latest run — not the org's most recent run across every product.
  const run = await prisma.discoveryRun.findFirst({
    where: { exporter_org_id: exporterOrgId, product_id: productId },
    orderBy: { created_at: 'desc' },
    select: { id: true, status: true, created_at: true },
  });

  const rows = run ? sortByOperationalOrder(await marketControlRows(run.id)) : [];
  const visibleRows = showAll ? rows : activeOnly(rows);

  return (
    <>
      <PageHeader
        eyebrow={product.name}
        title="Manage market decisions"
        description="The model's recommendation and your decision, shown separately. Agent decisions never change the AI score."
      />
      {run ? (
        <DemandDiscoveryControl rows={visibleRows} showAll={showAll} runId={run.id} />
      ) : (
        <p className="text-sm text-slate">No market analysis has run for this product yet.</p>
      )}
    </>
  );
}
