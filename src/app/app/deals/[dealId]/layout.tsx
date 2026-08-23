/**
 * EXP-09 Deal Workspace shell. Everything here renders on every tab, which is what
 * makes AC04 ("blocked risk remains visible across workspace tabs") structural rather
 * than something each tab has to remember to repeat: the risk banner lives in the
 * layout, not in the Overview page.
 */

import { JourneyProgress, StatusChip, UpgradeNotice } from '@/components/ui';
import { DEAL_STAGE_LABELS } from '@/lib/state-machines/deal';
import { DealWorkspaceTabs } from './DealWorkspaceTabs';
import { dealStageForRail, isMaterialRisk } from './dealRail';
import { loadDealForWorkspace } from './loadDeal';

const RISK_DISPLAY: Record<string, { label: string; tone: 'positive' | 'info' | 'warning' | 'critical' }> = {
  normal: { label: 'Normal', tone: 'positive' },
  watch: { label: 'Watch', tone: 'info' },
  at_risk: { label: 'At risk', tone: 'warning' },
  blocked: { label: 'Blocked', tone: 'critical' },
};

function money(amount: unknown, currency: string | null) {
  if (amount === null || amount === undefined) return '—';
  return `${currency ?? ''} ${Number(amount).toLocaleString('en-IN')}`.trim();
}

export default async function DealWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const { deal, tierBlocked } = await loadDealForWorkspace(dealId);

  if (tierBlocked || !deal) {
    return (
      <div className="mx-auto max-w-3xl py-4 md:py-6">
        <UpgradeNotice
          title="Deal Workspace is on the agent-assisted plan"
          requiredTier="paid"
          description="Once your account is upgraded, every deal's commercial terms, tasks, documents and shipment status live here."
        />
      </div>
    );
  }

  const riskDisplay = RISK_DISPLAY[deal.risk_state] ?? RISK_DISPLAY.normal;
  const showRiskBanner = isMaterialRisk(deal.risk_state);
  const railStage = dealStageForRail(deal.stage);

  return (
    <div className="py-4 md:py-6">
      {/* Deal header — buyer, product, country, stage, value, agent, risk (docs/04 EXP-09). */}
      <header className="mb-4 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card md:sticky md:top-16 md:z-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-normal text-primary">Deal workspace</p>
            <h1 className="font-serif text-title-page text-primary">{deal.buyer.display_name}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {deal.product?.name ?? 'No product on record'} · {deal.buyer.country_code}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-normal uppercase tracking-wide text-[var(--color-text-secondary)]">
              {DEAL_STAGE_LABELS[deal.stage]}
            </p>
            <p className="mt-0.5 text-xl font-semibold text-primary">{money(deal.value_amount, deal.value_currency)}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-[var(--color-text-secondary)]">Agent: {deal.owner_agent?.name ?? 'Unassigned'}</span>
          <StatusChip
            label={riskDisplay.label}
            tone={riskDisplay.tone}
            icon={riskDisplay.tone === 'critical' || riskDisplay.tone === 'warning' ? 'alert' : 'dot'}
            detail={deal.risk_reason ?? undefined}
            size="sm"
          />
        </div>

        <div className="mt-5">
          <JourneyProgress currentStage={railStage} />
        </div>
      </header>

      {/* AC04: material risk stays visible on every tab, not just Overview. */}
      {showRiskBanner ? (
        <div className="mb-4 rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_6%,transparent)] p-4">
          <p className="text-sm font-semibold text-[var(--color-critical-text)]">
            {riskDisplay.label === 'Blocked' ? 'This deal is blocked' : 'This deal is at risk'}
          </p>
          <p className="mt-1 text-sm text-primary">{deal.risk_reason ?? 'No reason recorded yet.'}</p>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Owner: {deal.owner_agent?.name ?? 'Unassigned'}
          </p>
        </div>
      ) : null}

      {/* Tabs are routes, not client-only state (docs/12 §B) — every one deep-links. */}
      <DealWorkspaceTabs dealId={deal.id} />

      {children}
    </div>
  );
}
