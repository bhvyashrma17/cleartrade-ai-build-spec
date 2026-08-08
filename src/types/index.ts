/**
 * Shared API and domain types.
 *
 * The response envelope shapes come from docs/09-api-platform-contract.md §2.
 * Domain enums are re-exported from the generated Prisma client so there is exactly
 * one definition of every enum value in the codebase.
 */

import type { OrgTier, UserRole } from '@prisma/client';

export type {
  ApprovalStatus,
  AuditSource,
  BrcStatus,
  BuyerLeadStage,
  DealStage,
  DisputeSeverity,
  DisputeStatus,
  DisputeType,
  DocType,
  DocumentSource,
  ExceptionState,
  FilingStatus,
  GenerationStatus,
  IecStatus,
  InterestLevel,
  JobStatus,
  JobType,
  JourneyStage,
  NotificationSeverity,
  PaymentSource,
  PaymentStatus,
  ReadinessStatus,
  ReviewStatus,
  RiskState,
  ScopeType,
  ShipmentMode,
  ShipmentStatus,
  SlaState,
  TaskPriority,
  TaskState,
  UserRole,
  VerificationStatus,
  Visibility,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Money & quantity — never a bare number (docs/09 §1)
// ---------------------------------------------------------------------------

export interface Money {
  /** Precise decimal serialized as a string; never a JS float. */
  amount: string;
  /** ISO-4217 code. Do not assume INR — deals are frequently USD/EUR/AED (docs/10 §5). */
  currency: string;
}

export interface Quantity {
  value: string;
  unit: string;
}

// ---------------------------------------------------------------------------
// Response envelopes
// ---------------------------------------------------------------------------

export interface PageMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  sort?: string;
  /** Cursor for the next page where cursor pagination is used. */
  next_cursor?: string | null;
}

export interface SingleResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ListResponse<T> {
  data: T[];
  meta: PageMeta & Record<string, unknown>;
}

/** 202 Accepted — long-running work is a job, never a held request (docs/09 §3). */
export interface AcceptedResponse {
  job_id: string;
  status: string;
  target?: { type: string; id: string };
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/**
 * The blockers[] pattern: what lets the UI render "you can't do this yet, and here is
 * exactly what to fix, with a link" instead of a dead end (docs/09 §2).
 */
export interface Blocker {
  object_type: string;
  object_id: string;
  reason: string;
  deep_link?: string;
}

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    fields?: FieldError[];
    blockers?: Blocker[];
  };
  /** Present on VERSION_CONFLICT. */
  current_version?: number;
  current_updated_at?: string;
  /** Present on UPGRADE_REQUIRED — the tier that would unlock the action. */
  required_tier?: OrgTier;
  correlation_id: string;
}

export type ApiResponse<T> = SingleResponse<T> | ListResponse<T> | ErrorResponse;

// ---------------------------------------------------------------------------
// Error codes (docs/09 §4) — the UI maps each of these to a global state
// ---------------------------------------------------------------------------

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  DUPLICATE_LEAD: 'DUPLICATE_LEAD',
  DUPLICATE_DEAL: 'DUPLICATE_DEAL',
  PREREQUISITES_NOT_MET: 'PREREQUISITES_NOT_MET',
  JOB_ALREADY_RUNNING: 'JOB_ALREADY_RUNNING',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_SCAN_FAILED: 'FILE_SCAN_FAILED',
  EXTERNAL_PARTNER_ERROR: 'EXTERNAL_PARTNER_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** Specialization of PREREQUISITES_NOT_MET for the deal-lock gate. */
  DEAL_LOCK_PREREQUISITES_NOT_MET: 'DEAL_LOCK_PREREQUISITES_NOT_MET',
  /** A state-machine transition that no guard allows. */
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /**
   * The role permits this, but the tenant's tier does not. Distinct from FORBIDDEN on
   * purpose: FORBIDDEN means "your role will never allow this", UPGRADE_REQUIRED means
   * "buy this and it works". Collapsing them would make it impossible to render an
   * upsell without re-deriving the reason on the client.
   */
  UPGRADE_REQUIRED: 'UPGRADE_REQUIRED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ---------------------------------------------------------------------------
// Principal — the authenticated actor every server-side check receives
// ---------------------------------------------------------------------------

export interface Principal {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** Non-null only for exporter roles. This is the tenant key. */
  exporter_org_id: string | null;
  /**
   * Commercial tier of the principal's tenant — the second axis of every permission
   * decision. `role` says whether this kind of user may do a thing; `tier` says whether
   * this tenant has paid for it. Both must pass (src/lib/permissions.ts `permits()`).
   *
   * Staff principals (agent / ops / admin) have no tenant, so they resolve to `paid`:
   * their access stays governed entirely by the role matrix, exactly as before.
   */
  tier: OrgTier;
}

export type PortalRoot = '/app' | '/agent' | '/ops';

// ---------------------------------------------------------------------------
// Status presentation — color is never the only cue (docs/10 §4)
// ---------------------------------------------------------------------------

export type StatusTone = 'positive' | 'info' | 'warning' | 'critical' | 'neutral';

export type StatusIconName =
  | 'check'
  | 'clock'
  | 'alert'
  | 'block'
  | 'spark'
  | 'dot'
  | 'pause'
  | 'x';

export interface StatusDescriptor {
  /** Human label naming who owes what — "Waiting for exporter approval", not "Pending". */
  label: string;
  tone: StatusTone;
  icon: StatusIconName;
  /** Optional longer explanation for helper text / tooltips. */
  detail?: string;
}
