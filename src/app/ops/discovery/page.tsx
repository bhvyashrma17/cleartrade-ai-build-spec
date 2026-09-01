/**
 * `/ops/discovery` — the Demand Discovery operations view.
 *
 * Answers one question on open: is anything stuck? Counts first, detail behind tabs. System
 * controls live here rather than inside ordinary product pages, so an exporter-facing surface
 * never carries operational machinery it has no business showing.
 */
import { redirect } from 'next/navigation';
import { getPrincipal } from '@/lib/auth';
import { demandDiscoveryOperations } from '@/lib/country-discovery/scan-requests';
import { isOps } from '@/lib/permissions';
import { PageHeader } from '@/components/ui';
import { SummaryHeader } from '@/components/discovery';
import { MarketScanQueue } from '@/components/agent/MarketScanQueue';

export const dynamic = 'force-dynamic';

export default async function DemandDiscoveryOpsPage() {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  // UI visibility is not authorization — the service re-checks the role too.
  if (!isOps(principal)) redirect('/app/overview');
  const overview = await demandDiscoveryOperations(principal);

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Demand Discovery"
        description="Scan requests, running analyses and evidence awaiting review."
      />
      <div className="space-y-6">
        <SummaryHeader
          title="Right now"
          stats={[
            { label: 'Pending scan requests', value: overview.pending_scan_requests, hint: overview.pending_scan_requests ? 'Awaiting a ClearTrade decision' : 'Nothing waiting' },
            { label: 'Running scans', value: overview.running_scans },
            { label: 'Products with analysis', value: overview.products_with_analysis },
            { label: 'Classifications to review', value: overview.evidence_requiring_review, hint: 'Products whose destination tariff line is unresolved' },
          ]}
        />
        <p className="text-xs text-muted">
          Active EU tariff release: {overview.active_taric_release ?? 'none imported'}
        </p>
        <MarketScanQueue />
      </div>
    </>
  );
}
