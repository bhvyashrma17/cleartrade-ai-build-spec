import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { AgentCapacityForm } from '@/components/ops/AgentCapacityForm';
import { FeePolicyForm } from '@/components/ops/FeePolicyForm';
import { PageHeader, StatusChip, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { adminIntegrationStatuses } from '@/lib/admin-settings';
import { BUYER_FIT_POLICY, BUYER_FIT_POLICY_HASH } from '@/lib/buyer-intelligence';
import { getConfigWithVersion } from '@/lib/config';
import { isAdmin } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { STAFF_INVITE_TTL_DAYS } from '@/lib/staff-provisioning';

const fmt = (date: Date) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
const tone = (status: string) => status === 'Ready' || status === 'Configured' ? 'positive' as const : status === 'Degraded' ? 'warning' as const : 'critical' as const;

export default async function OpsSettingsPage() {
  const principal = await requirePortalAccess('/ops');
  if (!isAdmin(principal)) return <AccessDenied message="Settings are available to administrators only." />;

  const [feePolicies, capacity, integrations] = await Promise.all([
    prisma.feePolicy.findMany({ orderBy: { version: 'desc' } }),
    getConfigWithVersion('agent.capacity'),
    adminIntegrationStatuses(),
  ]);
  const active = feePolicies.find((policy) => policy.is_active) ?? null;

  return (
    <div className="space-y-4 py-4 md:py-6">
      <PageHeader eyebrow="Administration" title="Settings" description="Current operational configuration. Historical actors and changes remain in Audit." />

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Configuration status</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-md border border-[var(--color-border)] p-3"><p className="text-xs text-[var(--color-text-secondary)]">Commercial policy</p><StatusChip label={active ? 'Configured' : 'Not configured'} tone={active ? 'positive' : 'critical'} icon={active ? 'check' : 'alert'} size="sm" /></div>
          <div className="rounded-md border border-[var(--color-border)] p-3"><p className="text-xs text-[var(--color-text-secondary)]">Agent capacity</p><StatusChip label="Configured" tone="positive" icon="check" size="sm" /></div>
          {integrations.slice(2, 5).map((item) => <div key={item.name} className="rounded-md border border-[var(--color-border)] p-3"><p className="text-xs text-[var(--color-text-secondary)]">{item.name}</p><StatusChip label={item.status} tone={tone(item.status)} icon={item.status === 'Ready' || item.status === 'Configured' ? 'check' : 'alert'} size="sm" /></div>)}
        </div>
      </section>

      <section id="commercial" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Commercial</h2>
        {active ? <><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-[var(--color-text-secondary)]">Commitment fee</dt><dd className="font-medium">{active.commitment_fee_currency} {active.commitment_fee_amount.toString()} · default {active.commitment_fee_status}</dd></div>
          <div><dt className="text-xs text-[var(--color-text-secondary)]">Success fee</dt><dd className="font-medium">{Number(active.success_fee_rate) * 100}%</dd></div>
          <div><dt className="text-xs text-[var(--color-text-secondary)]">Small shipment threshold</dt><dd className="font-medium">{active.small_shipment_threshold_currency} {active.small_shipment_threshold_amount.toString()}</dd></div>
          <div><dt className="text-xs text-[var(--color-text-secondary)]">Small shipment terms</dt><dd className="font-medium">{Number(active.small_shipment_rate) * 100}% · flat {active.small_shipment_flat_amount.toString()}</dd></div>
          <div><dt className="text-xs text-[var(--color-text-secondary)]">Agent share</dt><dd className="font-medium">{Number(active.agent_share_rate) * 100}%</dd></div>
          <div><dt className="text-xs text-[var(--color-text-secondary)]">Minimum shipment</dt><dd className="font-medium">{active.minimum_shipment_currency} {active.minimum_shipment_amount.toString()}</dd></div>
          <div><dt className="text-xs text-[var(--color-text-secondary)]">Active version</dt><dd className="font-medium">v{active.version} · {fmt(active.effective_from)}</dd></div>
        </dl><FeePolicyForm initial={{ commitment_fee_amount: active.commitment_fee_amount.toString(), commitment_fee_currency: active.commitment_fee_currency, success_fee_rate: active.success_fee_rate.toString(), small_shipment_threshold_amount: active.small_shipment_threshold_amount.toString(), small_shipment_threshold_currency: active.small_shipment_threshold_currency, small_shipment_rate: active.small_shipment_rate.toString(), small_shipment_flat_amount: active.small_shipment_flat_amount.toString(), agent_share_rate: active.agent_share_rate.toString(), minimum_shipment_amount: active.minimum_shipment_amount.toString(), minimum_shipment_currency: active.minimum_shipment_currency }} /></> : <p className="mt-3 text-sm text-[var(--color-critical-text)]">No active FeePolicy is configured.</p>}
        <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Version history ({feePolicies.length})</summary><ul className="mt-2 space-y-1 text-xs text-[var(--color-text-secondary)]">{feePolicies.map((policy) => <li key={policy.id}>v{policy.version} · {policy.is_active ? 'Active' : 'Superseded'} · effective {fmt(policy.effective_from)}</li>)}</ul></details>
      </section>

      <section id="agent-operations" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card"><h2 className="text-lg font-semibold text-primary">Agent Operations</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Current version v{capacity.version}. The target is a workload signal, not an assignment limit.</p><AgentCapacityForm currentTarget={capacity.value.target_exporters_per_agent} /></section>

      <section id="provisioning" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card"><h2 className="text-lg font-semibold text-primary">Provisioning</h2><dl className="mt-3 text-sm"><dt className="text-xs text-[var(--color-text-secondary)]">Bearer Agent invitation expiry</dt><dd className="font-medium">{STAFF_INVITE_TTL_DAYS} days · read-only security policy</dd></dl><p className="mt-2 text-sm text-[var(--color-text-secondary)]">Bearer invitations are single-use credentials. Anyone with the link can claim it.</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">Direct StaffAccessGrant remains email-bound. Its lifecycle is managed by the provisioning workflow, not runtime configuration.</p></section>

      <section id="notifications" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card"><h2 className="text-lg font-semibold text-primary">Notifications</h2>{integrations.filter((item) => item.name === 'Email').map((item) => <dl key={item.name} className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-xs text-[var(--color-text-secondary)]">Provider</dt><dd className="font-medium">{item.provider}</dd></div><div><dt className="text-xs text-[var(--color-text-secondary)]">Environment</dt><dd className="font-medium">{item.mode}</dd></div><div><dt className="text-xs text-[var(--color-text-secondary)]">Provider configured</dt><dd className="font-medium">{item.status}</dd></div><div><dt className="text-xs text-[var(--color-text-secondary)]">Sender identity</dt><dd className="font-medium">{item.detail}</dd></div></dl>)}</section>

      <section id="integrations" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card"><h2 className="text-lg font-semibold text-primary">Integrations / System Status</h2><div className="mt-3 overflow-x-auto"><Table><Thead><Tr className="border-b border-[var(--color-border)]"><Th>Integration</Th><Th>Status</Th><Th>Provider / mode</Th><Th>Safe detail</Th></Tr></Thead><Tbody>{integrations.map((item) => <Tr key={item.name} className="border-b border-[var(--color-border)]"><Td className="font-medium">{item.name}</Td><Td><StatusChip label={item.status} tone={tone(item.status)} icon={item.status === 'Ready' || item.status === 'Configured' ? 'check' : 'alert'} size="sm" /></Td><Td className="text-[var(--color-text-secondary)]">{[item.provider, item.mode].filter(Boolean).join(' · ') || '—'}</Td><Td className="text-[var(--color-text-secondary)]">{item.lastSuccessfulRefresh ? `Last successful refresh ${fmt(new Date(item.lastSuccessfulRefresh))}` : item.detail ?? '—'}</Td></Tr>)}</Tbody></Table></div></section>

      <section id="policy" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card"><h2 className="text-lg font-semibold text-primary">Read-only code-owned policy</h2><p className="mt-2 text-sm text-[var(--color-text-secondary)]">BuyerFit policy v{BUYER_FIT_POLICY.version} · model {BUYER_FIT_POLICY.model_version} · hash <code>{BUYER_FIT_POLICY_HASH.slice(0, 16)}…</code>. It is not operator-editable. The deprecated buyers.fit_score_weights setting is not exposed.</p></section>

      <section id="history" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card"><h2 className="text-lg font-semibold text-primary">Configuration History / Audit</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Settings changes current configuration. Audit inspects historical changes, actors, versions, and evidence.</p><Link href="/ops/audit" className="focus-visible-ring mt-3 inline-block text-sm font-medium text-primary underline underline-offset-2">Open Audit</Link></section>
    </div>
  );
}
