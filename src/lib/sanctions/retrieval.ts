/**
 * Durable sanctions artifact retrieval (Phase 3) + raw artifact integrity (Phase 4).
 *
 * The governing rule: **a 200 is not evidence.** Every one of the three sources can and
 * does return a 200 carrying something that is not the dataset — an HTML error page, a
 * JSON 403 body, a CDN challenge, a truncated file. Retrieval therefore succeeds only when
 * the body is positively identified as the expected artifact.
 *
 * Retrieval failure and parse failure are kept strictly apart: "we could not obtain the
 * artifact" and "we obtained it and could not understand it" are different operational
 * problems with different fixes, and collapsing them is how a broken parser gets misread as
 * a provider outage.
 */

import { createHash } from 'node:crypto';
import { SanctionsFailureStage } from '@prisma/client';
import { resolveSourceUrl, type SanctionsSourceContractWithUrl } from './sources';

export interface RetrievalSuccess {
  ok: true;
  body: string;
  /** Bytes actually received, measured on the raw buffer — not `body.length` (UTF-16). */
  byte_length: number;
  sha256: string;
  media_type: string | null;
  http_status: number;
  etag: string | null;
  last_modified: string | null;
  retrieved_at: Date;
  /** Final URL after redirects, with any token stripped so it is safe to persist/log. */
  final_url: string;
  /** True when the provider answered 304 to a conditional request. */
  not_modified: false;
}

export interface RetrievalNotModified {
  ok: true;
  not_modified: true;
  http_status: 304;
  retrieved_at: Date;
  etag: string | null;
}

export interface RetrievalFailure {
  ok: false;
  stage: SanctionsFailureStage;
  reason: string;
  http_status: number | null;
  media_type: string | null;
  byte_length: number | null;
  retrieved_at: Date;
}

export type RetrievalOutcome = RetrievalSuccess | RetrievalNotModified | RetrievalFailure;

export interface RetrievalOptions {
  timeout_ms?: number;
  max_attempts?: number;
  backoff_ms?: number;
  /** Conditional retrieval — provider decides whether anything changed. */
  if_none_match?: string | null;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

/** Strip credential-shaped query params so a URL is safe to persist and display. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|key|secret|signature|credential|x-amz/i.test(key)) parsed.searchParams.set(key, 'REDACTED');
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&](?:token|key|secret)=)[^&]*/gi, '$1REDACTED');
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `Retry-After`, in either RFC 7231 form: delta-seconds, or an HTTP-date.
 *
 * Capped at 10 minutes. An absurd or hostile value must not park a worker (and its refresh
 * lease) indefinitely — past the cap we give up this attempt cycle and let the scheduler
 * come back on its own cadence, which is the safer failure mode.
 */
export function parseRetryAfterMs(header: string | null, now: Date = new Date()): number | null {
  if (!header) return null;
  const cap = 600_000;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds)) return seconds <= 0 ? null : Math.min(seconds * 1000, cap);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  const delta = date - now.getTime();
  return delta <= 0 ? null : Math.min(delta, cap);
}

/** Retryable: transient transport/server conditions. 4xx other than 429 is not retryable. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Positively identify the body as the expected sanctions artifact.
 *
 * Ordered cheapest-first, and deliberately checks for the *specific* impostors these
 * providers actually return rather than a generic "looks like XML" test.
 */
export function validateArtifact(
  body: string,
  contract: SanctionsSourceContractWithUrl,
  byteLength: number,
  mediaType: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (byteLength === 0) return { ok: false, reason: 'Empty response body.' };

  if (byteLength < contract.min_bytes) {
    return {
      ok: false,
      reason: `Artifact is ${byteLength} bytes, below the ${contract.min_bytes}-byte floor for ${contract.dataset_name} — likely truncated or a stub error body.`,
    };
  }

  const head = body.slice(0, 4096);
  const lowered = head.toLowerCase();

  // HTML masquerading as a successful download (UN's obsolete path does exactly this).
  if (/^\s*(<!doctype\s+html|<html\b)/i.test(head)) {
    return { ok: false, reason: 'Response body is an HTML document, not the sanctions artifact (error/login/challenge page).' };
  }
  // JSON error envelope (the EU FSF 403 shape).
  if (/^\s*[{[]/.test(head) && !contract.expected_media_types.includes('application/json')) {
    return { ok: false, reason: 'Response body is JSON, not the expected XML sanctions artifact (likely an error envelope).' };
  }
  if (/access denied|forbidden|not authoriz|sign in|log in to continue|captcha|are you a robot/i.test(lowered)) {
    return { ok: false, reason: 'Response body contains access-denied/challenge text rather than sanctions data.' };
  }

  // Media type, when the provider supplies one. Absence is tolerated; a *wrong* type is not.
  if (mediaType) {
    const base = mediaType.split(';')[0].trim().toLowerCase();
    if (!contract.expected_media_types.includes(base)) {
      return { ok: false, reason: `Unexpected media type "${base}"; expected one of ${contract.expected_media_types.join(', ')}.` };
    }
  }

  // The decisive check: the artifact's own root element.
  if (!new RegExp(`<${contract.expected_root_element}\\b`, 'i').test(head)) {
    return { ok: false, reason: `Artifact does not open with <${contract.expected_root_element}> — not the expected ${contract.dataset_name} schema.` };
  }

  // Truncation: XML must close its root. Catches a connection cut mid-stream, which
  // otherwise parses "successfully" into a silently short record set.
  if (!new RegExp(`</${contract.expected_root_element}\\s*>\\s*$`, 'i').test(body.trimEnd())) {
    return { ok: false, reason: `Artifact does not terminate with </${contract.expected_root_element}> — truncated download.` };
  }

  return { ok: true };
}

export async function retrieveSanctionsArtifact(
  contract: SanctionsSourceContractWithUrl,
  options: RetrievalOptions = {},
): Promise<RetrievalOutcome> {
  const {
    timeout_ms = 300_000,
    max_attempts = 3,
    backoff_ms = 2_000,
    if_none_match = null,
    fetchImpl = fetch,
    env = process.env,
  } = options;

  const url = resolveSourceUrl(contract, env);
  let lastFailure: RetrievalFailure | null = null;

  // When a provider states how long to wait, that instruction outranks our own schedule.
  // Only ever used to wait LONGER — a provider cannot talk us into retrying sooner than our
  // own exponential backoff, which is what keeps this from becoming a throttling bypass.
  let providerRetryAfterMs: number | null = null;

  for (let attempt = 1; attempt <= max_attempts; attempt++) {
    if (attempt > 1) await sleep(Math.max(backoff_ms * 2 ** (attempt - 2), providerRetryAfterMs ?? 0));
    providerRetryAfterMs = null;
    const retrievedAt = new Date();

    let response: Response;
    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeout_ms),
        redirect: contract.allow_redirects ? 'follow' : 'manual',
        headers: {
          accept: contract.expected_media_types.join(','),
          ...(if_none_match ? { 'if-none-match': if_none_match } : {}),
        },
      });
    } catch (error) {
      lastFailure = {
        ok: false,
        stage: SanctionsFailureStage.retrieval,
        reason: `Transport error: ${error instanceof Error ? error.message : String(error)}`,
        http_status: null,
        media_type: null,
        byte_length: null,
        retrieved_at: retrievedAt,
      };
      continue;
    }

    if (response.status === 304) {
      return { ok: true, not_modified: true, http_status: 304, retrieved_at: retrievedAt, etag: response.headers.get('etag') };
    }

    if (!response.ok) {
      lastFailure = {
        ok: false,
        stage: SanctionsFailureStage.retrieval,
        reason: `Provider returned HTTP ${response.status}.`,
        http_status: response.status,
        media_type: response.headers.get('content-type'),
        byte_length: null,
        retrieved_at: retrievedAt,
      };
      if (!isRetryableStatus(response.status)) return lastFailure;
      providerRetryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), retrievedAt);
      continue;
    }

    // Redirect host allow-list. `redirect: 'follow'` means we only see the final URL, so
    // this is checked after the fact — a redirect to an unapproved host must not be
    // treated as authoritative provenance even though the bytes arrived.
    if (contract.allowed_redirect_hosts?.length) {
      try {
        const finalHost = new URL(response.url || url).hostname;
        const permitted = contract.allowed_redirect_hosts.some((h) => finalHost === h || finalHost.endsWith(`.${h}`));
        if (!permitted) {
          return {
            ok: false,
            stage: SanctionsFailureStage.artifact_validation,
            reason: `Artifact served from unapproved host "${finalHost}"; provenance cannot be attributed to ${contract.authority}.`,
            http_status: response.status,
            media_type: response.headers.get('content-type'),
            byte_length: null,
            retrieved_at: retrievedAt,
          };
        }
      } catch {
        /* Non-parseable final URL falls through to content validation. */
      }
    }

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (declaredLength && declaredLength > contract.max_bytes) {
      return {
        ok: false,
        stage: SanctionsFailureStage.retrieval,
        reason: `Declared content-length ${declaredLength} exceeds the ${contract.max_bytes}-byte ceiling.`,
        http_status: response.status,
        media_type: response.headers.get('content-type'),
        byte_length: declaredLength,
        retrieved_at: retrievedAt,
      };
    }

    // The body read must be inside the try: `AbortSignal.timeout` can fire DURING the
    // download of a large artifact (SDN is ~28 MB), and an unguarded arrayBuffer() would
    // throw past the caller instead of being recorded as a retrieval failure.
    let buffer: Buffer;
    try {
      buffer = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastFailure = {
        ok: false,
        stage: SanctionsFailureStage.retrieval,
        reason: `Body read failed: ${error instanceof Error ? error.message : String(error)}`,
        http_status: response.status,
        media_type: response.headers.get('content-type'),
        byte_length: null,
        retrieved_at: retrievedAt,
      };
      continue;
    }
    if (buffer.byteLength > contract.max_bytes) {
      return {
        ok: false,
        stage: SanctionsFailureStage.retrieval,
        reason: `Artifact of ${buffer.byteLength} bytes exceeds the ${contract.max_bytes}-byte ceiling.`,
        http_status: response.status,
        media_type: response.headers.get('content-type'),
        byte_length: buffer.byteLength,
        retrieved_at: retrievedAt,
      };
    }

    const body = buffer.toString('utf8');
    const mediaType = response.headers.get('content-type');
    const validation = validateArtifact(body, contract, buffer.byteLength, mediaType);
    if (!validation.ok) {
      // An invalid artifact is NOT retried: the provider answered successfully and gave us
      // the wrong thing, so retrying returns the same wrong thing.
      return {
        ok: false,
        stage: SanctionsFailureStage.artifact_validation,
        reason: validation.reason,
        http_status: response.status,
        media_type: mediaType,
        byte_length: buffer.byteLength,
        retrieved_at: retrievedAt,
      };
    }

    return {
      ok: true,
      not_modified: false,
      body,
      byte_length: buffer.byteLength,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      media_type: mediaType,
      http_status: response.status,
      etag: response.headers.get('etag'),
      last_modified: response.headers.get('last-modified'),
      retrieved_at: retrievedAt,
      final_url: redactUrl(response.url || url),
    };
  }

  return (
    lastFailure ?? {
      ok: false,
      stage: SanctionsFailureStage.retrieval,
      reason: 'Retrieval exhausted all attempts without a response.',
      http_status: null,
      media_type: null,
      byte_length: null,
      retrieved_at: new Date(),
    }
  );
}
