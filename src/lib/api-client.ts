/**
 * Typed fetch wrapper — docs/09 §2 envelope handling, in exactly one place (AGENTS.md
 * "Error handling is centralized in src/lib/api-client.ts").
 *
 * Every route handler under /api/v1 returns either the envelope's success shape or
 * `ErrorResponse` (src/lib/errors.ts `errorResponse()`). `apiGet`/`apiPost` unwrap the
 * success case and throw `ApiClientError` for the failure case, so a screen can `catch`
 * once and read `.code` / `.fields` / `.blockers` instead of re-parsing the envelope.
 */

import type { ErrorCode, ErrorResponse, FieldError, Blocker } from '@/types';

export class ApiClientError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldError[];
  readonly blockers?: Blocker[];
  readonly correlationId: string;

  constructor(envelope: ErrorResponse, status: number) {
    super(envelope.error.message);
    this.name = 'ApiClientError';
    this.code = envelope.error.code;
    this.status = status;
    this.fields = envelope.error.fields;
    this.blockers = envelope.error.blockers;
    this.correlationId = envelope.correlation_id;
  }
}

/** True for the shape errors.ts always sends — as opposed to a network-level failure. */
function isErrorEnvelope(body: unknown): body is ErrorResponse {
  return typeof body === 'object' && body !== null && 'error' in body && 'correlation_id' in body;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    // Network failure, not a server response — docs/03 §7 "Network failure" state.
    throw new ApiClientError(
      {
        error: { code: 'INTERNAL_ERROR', message: 'Could not reach the server. Check your connection and retry.' },
        correlation_id: 'client_offline',
      },
      0,
    );
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || isErrorEnvelope(body)) {
    if (isErrorEnvelope(body)) throw new ApiClientError(body, response.status);
    throw new ApiClientError(
      {
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.' },
        correlation_id: 'client_unknown',
      },
      response.status,
    );
  }

  return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export function apiPost<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(payload) });
}
