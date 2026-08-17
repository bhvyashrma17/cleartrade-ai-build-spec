/**
 * API error envelope — docs/09-api-platform-contract.md §2 and §4.
 *
 * Every route handler throws (or returns) one of these. The envelope is built in
 * exactly one place so the client-side handling in src/lib/api-client.ts can be
 * written once, generically, rather than per screen.
 */

import { NextResponse } from 'next/server';
import type { OrgTier } from '@prisma/client';
import {reportError} from '@/lib/observability';
import { ERROR_CODES, type Blocker, type ErrorCode, type ErrorResponse, type FieldError, type ListResponse, type PageMeta, type SingleResponse } from '@/types';

/** HTTP status for each error code. */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  DUPLICATE_LEAD: 409,
  DUPLICATE_DEAL: 409,
  PREREQUISITES_NOT_MET: 422,
  DEAL_LOCK_PREREQUISITES_NOT_MET: 422,
  INVALID_TRANSITION: 422,
  JOB_ALREADY_RUNNING: 409,
  FILE_TYPE_NOT_ALLOWED: 415,
  FILE_TOO_LARGE: 413,
  FILE_SCAN_FAILED: 422,
  EXTERNAL_PARTNER_ERROR: 502,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  UNAUTHENTICATED: 401,
  // 402 Payment Required — rarely used, and exactly what this means.
  UPGRADE_REQUIRED: 402,
};

export interface ApiErrorOptions {
  message?: string;
  fields?: FieldError[];
  blockers?: Blocker[];
  currentVersion?: number;
  currentUpdatedAt?: Date | string;
  /** The tier that would unlock the action. Only meaningful on UPGRADE_REQUIRED. */
  requiredTier?: OrgTier;
  /** Non-user-facing context for logs only. Never serialized to the client. */
  cause?: unknown;
}

/** Default human-safe messages. These never leak internals or record existence. */
const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Some details need attention before this can be saved.',
  FORBIDDEN: 'You do not have access to this.',
  NOT_FOUND: 'This item is not available.',
  VERSION_CONFLICT: 'This record changed since you opened it.',
  DUPLICATE_LEAD: 'A lead already exists for this buyer and product.',
  DUPLICATE_DEAL: 'A deal already exists for this lead.',
  PREREQUISITES_NOT_MET: 'This action is not available yet.',
  DEAL_LOCK_PREREQUISITES_NOT_MET: 'This deal cannot be locked yet.',
  INVALID_TRANSITION: 'That status change is not allowed from the current state.',
  JOB_ALREADY_RUNNING: 'This is already running. We will show the result when it finishes.',
  FILE_TYPE_NOT_ALLOWED: 'That file type is not accepted.',
  FILE_TOO_LARGE: 'That file is larger than the allowed size.',
  FILE_SCAN_FAILED: 'We could not scan that file. Please upload it again.',
  EXTERNAL_PARTNER_ERROR: 'A partner service did not respond. You can retry shortly.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  INTERNAL_ERROR: 'Something went wrong on our side.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  UPGRADE_REQUIRED: 'This is available on a higher plan.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldError[];
  readonly blockers?: Blocker[];
  readonly currentVersion?: number;
  readonly currentUpdatedAt?: string;
  readonly requiredTier?: OrgTier;

  constructor(code: ErrorCode, options: ApiErrorOptions = {}) {
    super(options.message ?? DEFAULT_MESSAGE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fields = options.fields;
    this.blockers = options.blockers;
    this.currentVersion = options.currentVersion;
    this.currentUpdatedAt =
      options.currentUpdatedAt instanceof Date
        ? options.currentUpdatedAt.toISOString()
        : options.currentUpdatedAt;
    this.requiredTier = options.requiredTier;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  toEnvelope(correlationId: string): ErrorResponse {
    const envelope: ErrorResponse = {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields?.length ? { fields: this.fields } : {}),
        ...(this.blockers?.length ? { blockers: this.blockers } : {}),
      },
      correlation_id: correlationId,
    };
    if (this.currentVersion !== undefined) envelope.current_version = this.currentVersion;
    if (this.currentUpdatedAt !== undefined) envelope.current_updated_at = this.currentUpdatedAt;
    if (this.requiredTier !== undefined) envelope.required_tier = this.requiredTier;
    return envelope;
  }
}

// ---------------------------------------------------------------------------
// Constructors for the codes with a specific shape
// ---------------------------------------------------------------------------

export const unauthenticated = () => new ApiError(ERROR_CODES.UNAUTHENTICATED);

export const forbidden = (message?: string) => new ApiError(ERROR_CODES.FORBIDDEN, { message });

/**
 * The role allows this but the tenant's tier does not — i.e. the answer is "upgrade",
 * not "never". Carries the tier that would unlock it so the client can render the right
 * upsell without re-deriving the reason.
 */
export const upgradeRequired = (requiredTier: OrgTier, message?: string) =>
  new ApiError(ERROR_CODES.UPGRADE_REQUIRED, { message, requiredTier });

/**
 * 404 is also what an out-of-tenant read returns. Returning FORBIDDEN there would
 * confirm the record exists — docs/09 §4: "do not leak an inaccessible record".
 */
export const notFound = (message?: string) => new ApiError(ERROR_CODES.NOT_FOUND, { message });

export const validationError = (fields: FieldError[], message?: string) =>
  new ApiError(ERROR_CODES.VALIDATION_ERROR, { fields, message });

/** A business-rule block the UI can render as an actionable checklist. */
export const prerequisitesNotMet = (blockers: Blocker[], message?: string) =>
  new ApiError(ERROR_CODES.PREREQUISITES_NOT_MET, { blockers, message });

export const dealLockPrerequisitesNotMet = (blockers: Blocker[]) =>
  new ApiError(ERROR_CODES.DEAL_LOCK_PREREQUISITES_NOT_MET, { blockers });

export const versionConflict = (currentVersion: number, currentUpdatedAt: Date) =>
  new ApiError(ERROR_CODES.VERSION_CONFLICT, { currentVersion, currentUpdatedAt });

/**
 * `deepLink` is caller-supplied rather than hardcoded: the same duplicate lands an
 * agent on `/agent/leads/:id` (AGT-04) but an exporter — who has no lead detail route
 * — on the buyer's own page (EXP-07), where the existing relationship is shown.
 */
export const duplicateLead = (existingLeadId: string, deepLink: string) =>
  new ApiError(ERROR_CODES.DUPLICATE_LEAD, {
    blockers: [
      {
        object_type: 'buyer_lead',
        object_id: existingLeadId,
        reason: 'This buyer is already a lead for this product.',
        deep_link: deepLink,
      },
    ],
  });

export const duplicateDeal = (existingDealId: string) =>
  new ApiError(ERROR_CODES.DUPLICATE_DEAL, {
    blockers: [
      {
        object_type: 'deal',
        object_id: existingDealId,
        reason: 'This lead already converted to a deal.',
        deep_link: `/app/deals/${existingDealId}`,
      },
    ],
  });

export const jobAlreadyRunning = (jobId: string) =>
  new ApiError(ERROR_CODES.JOB_ALREADY_RUNNING, {
    blockers: [
      { object_type: 'job', object_id: jobId, reason: 'An equivalent job is already running.' },
    ],
  });

/** Thrown by state-machine guards. Carries the attempted transition for the audit trail. */
export class InvalidTransitionError extends ApiError {
  readonly machine: string;
  readonly from: string;
  readonly to: string;

  constructor(machine: string, from: string, to: string, reason?: string) {
    super(ERROR_CODES.INVALID_TRANSITION, {
      message: reason ?? `A ${machine} cannot move from "${from}" to "${to}".`,
    });
    this.name = 'InvalidTransitionError';
    this.machine = machine;
    this.from = from;
    this.to = to;
  }
}

// ---------------------------------------------------------------------------
// Correlation IDs — trace one user action through jobs and downstream mutations
// ---------------------------------------------------------------------------

export function newCorrelationId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

// ---------------------------------------------------------------------------
// Envelope builders
// ---------------------------------------------------------------------------

export function single<T>(data: T, meta?: Record<string, unknown>): SingleResponse<T> {
  return meta ? { data, meta } : { data };
}

export function list<T>(
  data: T[],
  meta: PageMeta & Record<string, unknown>,
): ListResponse<T> {
  return { data, meta };
}

export function pageMeta(args: {
  page: number;
  per_page: number;
  total: number;
  sort?: string;
}): PageMeta {
  return {
    page: args.page,
    per_page: args.per_page,
    total: args.total,
    total_pages: Math.max(1, Math.ceil(args.total / args.per_page)),
    ...(args.sort ? { sort: args.sort } : {}),
  };
}

export function errorResponse(error: unknown, correlationId: string): NextResponse {
  const apiError = toApiError(error);
  if (apiError.status >= 500) {
    // Log the cause, never the payload — no secrets, document contents or
    // payment evidence in application logs (docs/10 §1).
    reportError(apiError.cause??apiError,{request_id:correlationId,error_code:apiError.code});
  }
  return NextResponse.json(apiError.toEnvelope(correlationId), {
    status: apiError.status,
    headers: { 'x-correlation-id': correlationId },
  });
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(ERROR_CODES.INTERNAL_ERROR, { cause: error });
}

export { ERROR_CODES };
