'use client';

/**
 * AGT-03 Outreach CRM pipeline table.
 *
 * Stage labels/order are redefined locally rather than imported from
 * src/lib/state-machines/buyer-lead.ts: that module pulls in src/lib/errors.ts, which
 * imports `next/server` — fine for a route handler, not something to drag into a
 * client bundle. This file only needs the display strings, not the transition guard.
 */

import type { VerificationStatus } from '@prisma/client';
import { format } from 'date-fns';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, StatusChip, type DataTableColumn } from '@/components/ui';
import { ApiClientError, apiGet } from '@/lib/api-client';
import type { ListResponse, PageMeta, StatusDescriptor } from '@/types';

const PER_PAGE = 20;

interface LeadRow {
  id: string;
  stage: string;
  next_action: string | null;
  next_action_at: string | null;
  last_contact_at: string | null;
  buyer: {
    id: string;
    display_name: string;
    country_code: string;
    verification_status: VerificationStatus;
    risk_flags: { code: string; severity: string; summary: string }[];
  };
  product: { id: string; name: string };
  exporter_org: { id: string; display_name: string };
}

const STAGE_DISPLAY: Record<string, StatusDescriptor> = {
  new: { label: 'New', tone: 'neutral', icon: 'dot' },
  shortlisted: { label: 'Shortlisted', tone: 'neutral', icon: 'dot' },
  contacted: { label: 'Contacted', tone: 'info', icon: 'clock' },
  replied: { label: 'Replied', tone: 'info', icon: 'check' },
  interested: { label: 'Qualified', tone: 'positive', icon: 'check' },
  negotiation: { label: 'In negotiation', tone: 'warning', icon: 'clock' },
  disqualified: { label: 'Disqualified', tone: 'critical', icon: 'x' },
  converted: { label: 'Converted to deal', tone: 'positive', icon: 'check' },
};

const STAGE_OPTIONS = Object.keys(STAGE_DISPLAY);

/** Stages docs/07 §7.1 / AGT-03-AC01 requires an explicit next action for. */
const REQUIRES_NEXT_ACTION = new Set(['contacted', 'replied', 'interested']);

const VERIFICATION_DISPLAY: Record<VerificationStatus, StatusDescriptor> = {
  unverified: { label: 'Unverified', tone: 'neutral', icon: 'dot' },
  partially_verified: { label: 'Partially verified', tone: 'warning', icon: 'clock' },
  verified: { label: 'Verified', tone: 'positive', icon: 'check' },
};

const EMPTY_PAGE: PageMeta = { page: 1, per_page: PER_PAGE, total: 0, total_pages: 1 };

function NextActionCell({ lead }: { lead: LeadRow }) {
  if (lead.next_action_at) {
    const due = new Date(lead.next_action_at);
    const overdue = due.getTime() < Date.now();
    return (
      <div className="space-y-1">
        <StatusChip
          label={overdue ? 'Overdue' : format(due, 'dd MMM yyyy')}
          tone={overdue ? 'critical' : 'neutral'}
          icon={overdue ? 'alert' : 'clock'}
          detail={lead.next_action ?? undefined}
          size="sm"
        />
        {lead.next_action ? <div className="text-xs text-[var(--color-text-secondary)]">{lead.next_action}</div> : null}
      </div>
    );
  }
  if (REQUIRES_NEXT_ACTION.has(lead.stage)) {
    return <StatusChip label="No next action set" tone="warning" icon="alert" size="sm" />;
  }
  return <span className="text-xs text-[var(--color-text-secondary)]">—</span>;
}

export function OutreachPipeline({ initialExporterOrgId = null }: { initialExporterOrgId?: string | null } = {}) {
  const [stage, setStage] = useState('');
  const [exporterOrgId, setExporterOrgId] = useState(initialExporterOrgId);
  const [page, setPage] = useState(1);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [stage, exporterOrgId]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (stage) params.set('stage', stage);
      if (exporterOrgId) params.set('exporter', exporterOrgId);
      const res = await apiGet<ListResponse<LeadRow>>(`/api/v1/leads?${params.toString()}`);
      setLeads(res.data);
      setPageMeta(res.meta);
    } catch (error) {
      setLoadError(error instanceof ApiClientError ? error.message : 'Could not load the pipeline. Please retry.');
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [page, stage, exporterOrgId]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const hasActiveFilters = Boolean(stage) || Boolean(exporterOrgId);

  const columns: DataTableColumn<LeadRow>[] = [
    {
      key: 'buyer',
      header: 'Buyer',
      render: (lead) => (
        <Link href={`/agent/leads/${lead.id}`} className="focus-visible-ring block">
          <div className="font-medium text-primary underline underline-offset-2">{lead.buyer.display_name}</div>
          <div className="text-xs text-[var(--color-text-secondary)]">{lead.buyer.country_code}</div>
        </Link>
      ),
    },
    {
      key: 'exporter_product',
      header: 'Exporter / product',
      render: (lead) => (
        <div>
          <div className="text-primary">{lead.exporter_org.display_name}</div>
          <div className="text-xs text-[var(--color-text-secondary)]">{lead.product.name}</div>
        </div>
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      render: (lead) => <StatusChip {...(STAGE_DISPLAY[lead.stage] ?? STAGE_DISPLAY.new)} size="sm" />,
    },
    {
      key: 'last_contact',
      header: 'Last contact',
      render: (lead) =>
        lead.last_contact_at ? format(new Date(lead.last_contact_at), 'dd MMM yyyy') : 'No contact logged',
    },
    {
      key: 'next_action',
      header: 'Next action',
      render: (lead) => <NextActionCell lead={lead} />,
    },
    {
      key: 'verification',
      header: 'Verification',
      hideOnMobile: true,
      render: (lead) => <StatusChip {...VERIFICATION_DISPLAY[lead.buyer.verification_status]} size="sm" />,
    },
    {
      key: 'risk',
      header: 'Risk',
      hideOnMobile: true,
      render: (lead) =>
        lead.buyer.risk_flags.length > 0 ? (
          <StatusChip
            label="Risk flagged"
            tone="critical"
            icon="alert"
            detail={lead.buyer.risk_flags.map((f) => f.summary).join(' ')}
            size="sm"
          />
        ) : (
          <span className="text-xs text-[var(--color-text-secondary)]">No flags</span>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-primary">Outreach pipeline</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Buyer leads across your assigned exporters, from shortlist through conversion.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <div>
          <label className="block text-sm font-medium text-primary" htmlFor="stage-filter">
            Stage
          </label>
          <select
            id="stage-filter"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring"
          >
            <option value="">All active stages</option>
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STAGE_DISPLAY[s].label}
              </option>
            ))}
          </select>
        </div>
        {exporterOrgId ? (
          <span className="rounded-full border border-[var(--color-border)] bg-surface-muted px-3 py-1.5 text-sm text-primary">
            Filtered to one exporter
          </span>
        ) : null}
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => {
              setStage('');
              setExporterOrgId(null);
            }}
            className="text-sm font-medium text-primary underline underline-offset-2"
          >
            Reset filters
          </button>
        ) : null}
      </div>

      {loadError ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-4 text-sm text-critical">
          <p className="font-medium">{loadError}</p>
          <button type="button" onClick={fetchLeads} className="mt-2 font-medium underline underline-offset-2">
            Retry
          </button>
        </div>
      ) : (
        <DataTable<LeadRow>
          columns={columns}
          rows={leads}
          rowKey={(lead) => lead.id}
          loading={loading}
          page={pageMeta}
          onPageChange={setPage}
          hasActiveFilters={hasActiveFilters}
          emptyState={{
            title: 'No leads yet',
            description: 'Leads created for your assigned exporters will appear here.',
          }}
          filteredEmptyState={{
            title: 'No leads at this stage',
            description: 'Try a different stage filter.',
            action: (
              <button type="button" onClick={() => setStage('')} className="text-sm font-medium text-primary underline underline-offset-2">
                Reset filters
              </button>
            ),
          }}
        />
      )}
    </div>
  );
}
