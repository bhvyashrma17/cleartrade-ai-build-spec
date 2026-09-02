import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { importTaricRelease, listTaricReleases } from '@/lib/market-access/taric/service';
import { errorResponse, list, newCorrelationId, pageMeta, single, validationError } from '@/lib/errors';

export const runtime = 'nodejs';
/** The official extraction is ~27 MB of xlsx. */
export const maxDuration = 300;

/** Imported TARIC releases, newest first. Staff-only, like the import itself. */
export async function GET(_request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const { TARIC_IMPORT_PRINCIPALS } = await import('@/lib/market-access/taric/service');
    const { forbidden } = await import('@/lib/errors');
    if (!TARIC_IMPORT_PRINCIPALS.includes(actor.role)) throw forbidden('Only ClearTrade operations staff can view TARIC releases.');
    const releases = await listTaricReleases();
    return NextResponse.json(
      list(releases.map((r) => ({
        id: r.id, label: r.label, reference_date: r.reference_date, status: r.status,
        bundle_sha256: r.checksum, bundle_size_bytes: r.size_bytes,
        parser_version: r.parser_version, imported_at: r.imported_at,
      })), { ...pageMeta({ page: 1, per_page: releases.length || 1, total: releases.length }) }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

/**
 * Upload one official TARIC monthly extraction.
 *
 * Takes the ORIGINAL zip as multipart form data — the whole bundle, not fifteen transcribed
 * forms. The archive is validated before anything is stored, so a corrupt, incomplete or
 * non-TARIC upload never becomes a release.
 */
export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const form = await request.formData().catch(() => null);
    const file = form?.get('bundle');
    const referenceMonth = String(form?.get('reference_month') ?? '');
    if (!(file instanceof File)) {
      throw validationError([{ field: 'bundle', code: 'required', message: 'Attach the official TARIC extraction archive.' }]);
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const { release, created } = await importTaricRelease({
      actor, bytes, reference_month: referenceMonth,
      activate: String(form?.get('activate') ?? '') === 'true',
      correlation_id: correlationId,
    });
    return NextResponse.json(
      single({
        id: release.id, label: release.label, status: release.status,
        bundle_sha256: release.checksum, reference_date: release.reference_date,
        file_manifest: release.file_manifest, created,
      }),
      { status: created ? 201 : 200, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
