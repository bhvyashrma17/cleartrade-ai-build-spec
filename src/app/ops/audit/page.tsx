/**
 * OPS-07 Audit Log & Admin Configuration (docs/06).
 *
 * AC01 is structural, not a UI restriction: `AuditSearch` (client) only ever calls
 * `GET /api/v1/audit`, and that route file exports no PATCH/PUT/DELETE — there is no
 * server code path that could mutate an `AuditEvent` even if this page tried to.
 *
 * Config registry writes (`ConfigVersionForm`, `FeePolicyForm`, partner directory
 * forms) render only for admins — everyone else in Ops sees the same version history,
 * read-only, matching "Admin-only write" in the anatomy table.
 */

import { UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { ConfigVersionForm } from '@/components/ops/ConfigVersionForm';
import { FeePolicyForm } from '@/components/ops/FeePolicyForm';
import { CreatePartnerForm, PartnerStatusForm } from '@/components/ops/PartnerDirectoryForms';
import { StatusChip } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { CONFIG_DEFAULTS, type ConfigKey } from '@/lib/config';
import { BUYER_FIT_POLICY, BUYER_FIT_POLICY_HASH } from '@/lib/buyer-intelligence';
import { isAdmin } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { AuditSearch } from './AuditSearch';

const CONFIG_KEYS: ConfigKey[] = [
  'sla.thresholds',
  'payout.eligibility',
  'documents.registry',
  'uploads.policy',
  'pagination.policy',
  // Not listed: 'buyers.fit_score_weights'. See DEPRECATED_CONFIG_KEYS in src/lib/config.ts —
  // it is dead configuration, and showing it beside real settings implied it was live.
  'leads.outreach',
  'guest.policy',
  'jobs.policy',
];

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);
}

export default async function OpsAuditPage() {
  const principal = await requirePortalAccess('/ops');
  if (!([UserRole.ops_supervisor, UserRole.ops_finance, UserRole.admin] as readonly UserRole[]).includes(principal.role)) {
    return <AccessDenied message="Audit and configuration are available to Ops and administrators." />;
  }
  const admin = isAdmin(principal);

  const [configRows, feePolicyVersions, partners, exampleLockedDeal] = await Promise.all([
    prisma.configSetting.findMany({ where: { key: { in: CONFIG_KEYS } }, orderBy: [{ key: 'asc' }, { version: 'desc' }] }),
    prisma.feePolicy.findMany({ orderBy: { version: 'desc' } }),
    prisma.partner.findMany({ orderBy: [{ partner_status: 'asc' }, { display_name: 'asc' }] }),
    prisma.deal.findFirst({ where: { locked_at: { not: null }, quoted_fee_policy: { not: undefined } }, orderBy: { locked_at: 'desc' }, select: { id: true, locked_at: true, quoted_fee_policy: true } }),
  ]);

  const byKey = new Map<string, typeof configRows>();
  for (const row of configRows) {
    byKey.set(row.key, [...(byKey.get(row.key) ?? []), row]);
  }

  const activeFeePolicy = feePolicyVersions.find((v) => v.is_active) ?? feePolicyVersions[0];

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <header>
        <p className="text-sm font-medium text-primary">Operations</p>
        <h1 className="text-2xl font-semibold text-primary">Audit log &amp; admin configuration</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Immutable traceability for material changes, plus a controlled place for business configuration.
        </p>
      </header>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Audit search</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Read-only. No mutation is possible through this UI.</p>
        <div className="mt-3">
          <AuditSearch />
        </div>
      </section>

      <section id="config" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Config registry</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Fee policy, SLA thresholds, document type registry and platform config. {admin ? 'You can create new versions.' : 'Read-only — Admin-only write.'}
        </p>

        {/* Fee policy */}
        <div className="mt-4 rounded-md border border-[var(--color-border)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-primary">Fee policy</h3>
            {admin && activeFeePolicy ? (
              <FeePolicyForm
                initial={{
                  commitment_fee_amount: activeFeePolicy.commitment_fee_amount.toString(),
                  commitment_fee_currency: activeFeePolicy.commitment_fee_currency,
                  success_fee_rate: activeFeePolicy.success_fee_rate.toString(),
                  small_shipment_threshold_amount: activeFeePolicy.small_shipment_threshold_amount.toString(),
                  small_shipment_threshold_currency: activeFeePolicy.small_shipment_threshold_currency,
                  small_shipment_rate: activeFeePolicy.small_shipment_rate.toString(),
                  small_shipment_flat_amount: activeFeePolicy.small_shipment_flat_amount.toString(),
                  agent_share_rate: activeFeePolicy.agent_share_rate.toString(),
                  minimum_shipment_amount: activeFeePolicy.minimum_shipment_amount.toString(),
                  minimum_shipment_currency: activeFeePolicy.minimum_shipment_currency,
                }}
              />
            ) : null}
          </div>
          {activeFeePolicy ? (
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              Active: v{activeFeePolicy.version} · success fee {Number(activeFeePolicy.success_fee_rate) * 100}% · agent share {Number(activeFeePolicy.agent_share_rate) * 100}% · effective {fmt(activeFeePolicy.effective_from)}
            </p>
          ) : null}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-[var(--color-text-secondary)]">Version history ({feePolicyVersions.length})</summary>
            <ul className="mt-1.5 space-y-1 text-xs text-[var(--color-text-secondary)]">
              {feePolicyVersions.map((v) => (
                <li key={v.id}>
                  v{v.version} {v.is_active ? <StatusChip label="Active" tone="positive" icon="check" size="sm" /> : <StatusChip label="Superseded" tone="neutral" icon="dot" size="sm" />} — effective {fmt(v.effective_from)}
                </li>
              ))}
            </ul>
          </details>
          {/* AC03: a historical deal's snapshot never moves even after a newer version exists. */}
          {exampleLockedDeal ? (
            <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
              Example: deal {exampleLockedDeal.id.slice(-6)} locked {fmt(exampleLockedDeal.locked_at)} keeps its own quoted fee policy snapshot regardless of later versions above.
            </p>
          ) : null}
        </div>

        {/* Generic config keys */}
        {/* Read-only, because BuyerFit is code-owned. Ops asked for visibility, and the honest
            answer is to show the policy that actually scored — not a tuning control that
            changes nothing. See DEPRECATED_CONFIG_KEYS in src/lib/config.ts. */}
        <div className="mt-3 rounded-md border border-[var(--color-border-strong)] bg-surface-muted p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-primary">BuyerFit scoring policy</h3>
            <span className="rounded bg-[color-mix(in_srgb,var(--color-primary)_8%,transparent)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
              Read-only · code-owned
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Version {BUYER_FIT_POLICY.version} · model {BUYER_FIT_POLICY.model_version} · hash{' '}
            <code className="break-all">{BUYER_FIT_POLICY_HASH.slice(0, 16)}…</code>
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Not operator-tunable. Changing it requires a code change, which bumps the version and
            hash recorded on every assessment scored afterwards.
          </p>
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs text-[var(--color-text-secondary)]">Policy snapshot</summary>
            <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 text-xs text-primary">
              {JSON.stringify(BUYER_FIT_POLICY, null, 2)}
            </pre>
          </details>
        </div>

        {CONFIG_KEYS.map((key) => {
          const versions = byKey.get(key) ?? [];
          const active = versions.find((v) => v.is_active);
          const value = active?.value ?? CONFIG_DEFAULTS[key];
          return (
            <div key={key} className="mt-3 rounded-md border border-[var(--color-border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-primary">{key}</h3>
                {admin ? <ConfigVersionForm configKey={key} currentValue={value} /> : null}
              </div>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {active ? `Active: v${active.version} · effective ${fmt(active.effective_from)}` : 'No DB row yet — running on the seed default.'}
              </p>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-xs text-[var(--color-text-secondary)]">Current value</summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-surface-muted p-2 text-xs text-primary">{JSON.stringify(value, null, 2)}</pre>
              </details>
              {versions.length > 0 ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs text-[var(--color-text-secondary)]">Version history ({versions.length})</summary>
                  <ul className="mt-1 space-y-1 text-xs text-[var(--color-text-secondary)]">
                    {versions.map((v) => (
                      <li key={v.id}>
                        v{v.version} {v.is_active ? <StatusChip label="Active" tone="positive" icon="check" size="sm" /> : <StatusChip label="Superseded" tone="neutral" icon="dot" size="sm" />} — {fmt(v.effective_from)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          );
        })}
      </section>

      <section id="partners" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary">Partner directory</h2>
          {admin ? <CreatePartnerForm /> : null}
        </div>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          The approved CHA/freight/insurance/inspection/bank directory — assignment and performance are surfaced in{' '}
          <a href="/ops/execution" className="focus-visible-ring underline underline-offset-2">CHA &amp; compliance oversight</a>.
        </p>
        {partners.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">No partners onboarded yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {partners.map((p) => (
              <li key={p.id} className="rounded-md border border-[var(--color-border)] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-primary">{p.display_name} <span className="text-xs text-[var(--color-text-secondary)]">({p.type} · {p.country_code})</span></span>
                  <StatusChip
                    label={p.partner_status}
                    tone={p.partner_status === 'active' ? 'positive' : p.partner_status === 'suspended' ? 'warning' : 'neutral'}
                    icon={p.partner_status === 'active' ? 'check' : 'block'}
                    size="sm"
                  />
                </div>
                {admin ? <PartnerStatusForm partnerId={p.id} currentStatus={p.partner_status} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

