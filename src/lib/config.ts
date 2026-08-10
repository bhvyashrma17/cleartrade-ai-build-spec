/**
 * Runtime business configuration.
 *
 * docs/01 §2 is explicit: fees, agent share, SLA durations, thresholds and the document
 * type registry are business settings, NOT constants. Nothing in this file is imported
 * as a literal by feature code — callers read through `getConfig()` / `getFeePolicy()`,
 * which hit the ConfigSetting / FeePolicy tables.
 *
 * The DEFAULTS below exist only to seed the database and to keep a freshly cloned dev
 * environment bootable. They are the "current/default assumption" column of docs/01 §2,
 * not a source of truth at runtime.
 */

import { prisma } from '@/lib/prisma';
import type { Money } from '@/types';

// ---------------------------------------------------------------------------
// Config keys and their value shapes
// ---------------------------------------------------------------------------

export interface SlaThreshold {
  /** Hours from creation until due_at. */
  due_in_hours: number;
  /** Hours from creation until the "due soon" warning fires. */
  warning_in_hours: number;
  /** Hours past due_at before the task escalates to Ops. */
  escalate_after_hours: number;
}

export interface DocTypeRegistryEntry {
  doc_type: string;
  /** Plain-language label first; the technical term goes in helper text (docs/10 §5). */
  label: string;
  technical_label: string;
  default_owner_role: string;
  approval_required: boolean;
  filing_applicable: boolean;
}

export interface UploadPolicy {
  max_size_mb: number;
  allowed_mime_types: string[];
}

export interface PaginationPolicy {
  default_per_page: number;
  max_per_page: number;
}

export interface FitScoreWeights {
  country_match: number;
  category_match: number;
  verification: number;
  import_recency: number;
  /** Below this, the UI should not present the buyer as a recommended match. */
  min_display_score: number;
}

export interface ConfigShape {
  'sla.thresholds': Record<string, SlaThreshold>;
  'documents.registry': DocTypeRegistryEntry[];
  'uploads.policy': UploadPolicy;
  'pagination.policy': PaginationPolicy;
  'buyers.fit_score_weights': FitScoreWeights;
  'leads.outreach': {
    /** Days without activity before a lead is flagged stale (AGT-03 "stale lead"). */
    stale_after_days: number;
    /** Auto-created follow-up task offset after an outreach activity (docs/13 E5). */
    follow_up_due_in_hours: number;
  };
  'guest.policy': GuestPolicy;
  'jobs.policy': JobsPolicy;
}

/**
 * Background job execution policy (docs/09 §3). Retry counts and timeouts are operational
 * settings Ops must be able to retune when a provider degrades, so they live here rather
 * than as constants in the worker.
 */
export interface JobsPolicy {
  /**
   * How long a job may sit in `processing` before it is considered abandoned and
   * reclaimable. This is what stops a worker crash from stranding a job forever — it
   * must be comfortably longer than the slowest legitimate run.
   */
  stale_after_seconds: number;
  /** Default attempt ceiling; a job may override it at enqueue time. */
  max_attempts: number;
  /** Base delay for exponential backoff between attempts. */
  retry_backoff_seconds: number;
  /** How often the worker polls for claimable work when idle. */
  worker_poll_interval_ms: number;
  /** Suggested client polling interval, returned to the UI so backoff is server-driven. */
  client_poll_interval_ms: number;
}

/**
 * Guest-tier limits. These bound real money — an anonymous caller triggering an AI job
 * spends on every run — so they are business settings that Ops must be able to retune
 * under load without a deploy, exactly like fees and SLAs (docs/01 §2).
 */
export interface GuestPolicy {
  /** Discovery runs allowed per IP per window. */
  discovery_runs_per_ip: number;
  /**
   * Window length. Rolling rather than lifetime on purpose: Indian mobile carriers use
   * CGNAT, so one address fronts very large numbers of real users and a lifetime cap
   * would permanently lock out legitimate prospects in the primary market.
   */
  quota_window_hours: number;
  /** How long an unconverted guest org and its runs are retained before the purge job deletes them. */
  run_retention_days: number;
  /** Guest session lifetime. Longer than a login — it is a low-value credential. */
  session_days: number;
  /** Max rows a guest may page through, to blunt scraping of the buyer dataset. */
  max_buyer_results: number;
}

export type ConfigKey = keyof ConfigShape;

/**
 * Seed values only. docs/01 §2 "current/default assumption" column, plus the concrete
 * SLA starting values from AGT-07 (docs/13 E4).
 */
export const CONFIG_DEFAULTS: ConfigShape = {
  'sla.thresholds': {
    default: { due_in_hours: 24, warning_in_hours: 18, escalate_after_hours: 24 },
    buyer_outreach_first_contact: { due_in_hours: 24, warning_in_hours: 16, escalate_after_hours: 24 },
    buyer_lead_follow_up: { due_in_hours: 48, warning_in_hours: 36, escalate_after_hours: 48 },
    exporter_document_approval: { due_in_hours: 48, warning_in_hours: 36, escalate_after_hours: 24 },
    agent_document_review: { due_in_hours: 8, warning_in_hours: 4, escalate_after_hours: 8 },
    exporter_input_request: { due_in_hours: 24, warning_in_hours: 18, escalate_after_hours: 24 },
    shipment_exception: { due_in_hours: 4, warning_in_hours: 2, escalate_after_hours: 4 },
    payment_overdue_follow_up: { due_in_hours: 24, warning_in_hours: 12, escalate_after_hours: 24 },
    dispute_response: { due_in_hours: 24, warning_in_hours: 12, escalate_after_hours: 24 },
  },
  'documents.registry': [
    {
      doc_type: 'PI',
      label: 'Proforma invoice',
      technical_label: 'PI',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: false,
    },
    {
      doc_type: 'CI',
      label: 'Commercial invoice',
      technical_label: 'CI',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: false,
    },
    {
      doc_type: 'packing_list',
      label: 'Packing list',
      technical_label: 'Packing List',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: false,
    },
    {
      doc_type: 'shipping_bill_draft',
      label: 'Customs shipping bill (draft)',
      technical_label: 'Shipping Bill / ICEGATE filing',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: true,
    },
    {
      doc_type: 'COO_draft',
      label: 'Certificate of origin (draft)',
      technical_label: 'COO',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: true,
    },
    {
      doc_type: 'declaration',
      label: 'Export declaration',
      technical_label: 'Declaration',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: true,
    },
    {
      doc_type: 'insurance_declaration',
      label: 'Insurance declaration',
      technical_label: 'Insurance Declaration',
      default_owner_role: 'agent',
      approval_required: false,
      filing_applicable: false,
    },
  ],
  'uploads.policy': {
    max_size_mb: 25,
    allowed_mime_types: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ],
  },
  'pagination.policy': { default_per_page: 25, max_per_page: 100 },
  'buyers.fit_score_weights': {
    country_match: 40,
    category_match: 30,
    verification: 20,
    import_recency: 10,
    min_display_score: 0,
  },
  'leads.outreach': { stale_after_days: 14, follow_up_due_in_hours: 48 },
  'guest.policy': {
    discovery_runs_per_ip: 2,
    quota_window_hours: 24,
    run_retention_days: 30,
    session_days: 30,
    max_buyer_results: 50,
  },
  'jobs.policy': {
    stale_after_seconds: 300,
    max_attempts: 3,
    retry_backoff_seconds: 15,
    worker_poll_interval_ms: 1000,
    client_poll_interval_ms: 1500,
  },
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Read the active version of a config key. Falls back to the seed default only when the
 * row is missing, so a fresh environment still boots — a production deployment should
 * fail its config check rather than silently run on defaults.
 */
export async function getConfig<K extends ConfigKey>(key: K): Promise<ConfigShape[K]> {
  const row = await prisma.configSetting.findFirst({
    where: { key, is_active: true },
    orderBy: { version: 'desc' },
  });
  if (!row) return CONFIG_DEFAULTS[key];
  return row.value as ConfigShape[K];
}

export interface FeePolicySnapshot {
  version: number;
  commitment_fee: Money;
  commitment_fee_status: string;
  success_fee_rate: string;
  small_shipment_threshold: Money;
  small_shipment_rate: string;
  small_shipment_flat: Money;
  agent_share_rate: string;
  minimum_shipment: Money;
  effective_from: string;
}

/** The fee policy in force right now. Snapshotted onto a Deal at lock time. */
export async function getFeePolicy(): Promise<FeePolicySnapshot> {
  const policy = await prisma.feePolicy.findFirst({
    where: { is_active: true },
    orderBy: { version: 'desc' },
  });
  if (!policy) {
    throw new Error(
      'No active FeePolicy. Run `npm run db:seed` — fee terms must never fall back to a hardcoded constant.',
    );
  }
  return {
    version: policy.version,
    commitment_fee: {
      amount: policy.commitment_fee_amount.toString(),
      currency: policy.commitment_fee_currency,
    },
    commitment_fee_status: policy.commitment_fee_status,
    success_fee_rate: policy.success_fee_rate.toString(),
    small_shipment_threshold: {
      amount: policy.small_shipment_threshold_amount.toString(),
      currency: policy.small_shipment_threshold_currency,
    },
    small_shipment_rate: policy.small_shipment_rate.toString(),
    small_shipment_flat: {
      amount: policy.small_shipment_flat_amount.toString(),
      currency: policy.small_shipment_flat_amount ? policy.small_shipment_threshold_currency : 'INR',
    },
    agent_share_rate: policy.agent_share_rate.toString(),
    minimum_shipment: {
      amount: policy.minimum_shipment_amount.toString(),
      currency: policy.minimum_shipment_currency,
    },
    effective_from: policy.effective_from.toISOString(),
  };
}

/**
 * Fee calculation returns source amount, rate AND result — docs/01 §2 requires the UI to
 * render the quoted terms rather than recalculate them.
 */
export interface FeeCalculation {
  basis: Money;
  rule: 'success_fee' | 'small_shipment_rate' | 'small_shipment_flat';
  rate?: string;
  result: Money;
  policy_version: number;
}

export async function calculateSuccessFee(shipmentValue: Money): Promise<FeeCalculation> {
  const policy = await getFeePolicy();
  const value = Number(shipmentValue.amount);
  const threshold = Number(policy.small_shipment_threshold.amount);

  // Below the small-shipment threshold the policy is "rate or flat, whichever is greater".
  if (shipmentValue.currency === policy.small_shipment_threshold.currency && value < threshold) {
    const byRate = value * Number(policy.small_shipment_rate);
    const flat = Number(policy.small_shipment_flat.amount);
    return byRate >= flat
      ? {
          basis: shipmentValue,
          rule: 'small_shipment_rate',
          rate: policy.small_shipment_rate,
          result: { amount: byRate.toFixed(2), currency: shipmentValue.currency },
          policy_version: policy.version,
        }
      : {
          basis: shipmentValue,
          rule: 'small_shipment_flat',
          result: { amount: flat.toFixed(2), currency: policy.small_shipment_flat.currency },
          policy_version: policy.version,
        };
  }

  return {
    basis: shipmentValue,
    rule: 'success_fee',
    rate: policy.success_fee_rate,
    result: {
      amount: (value * Number(policy.success_fee_rate)).toFixed(2),
      currency: shipmentValue.currency,
    },
    policy_version: policy.version,
  };
}

/** Resolve pagination params against the configured policy — no magic numbers in handlers. */
export async function resolvePagination(params: {
  page?: string | number | null;
  per_page?: string | number | null;
}): Promise<{ page: number; per_page: number; skip: number; take: number }> {
  const policy = await getConfig('pagination.policy');
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const requested = Number(params.per_page ?? policy.default_per_page) || policy.default_per_page;
  const per_page = Math.min(Math.max(1, requested), policy.max_per_page);
  return { page, per_page, skip: (page - 1) * per_page, take: per_page };
}
