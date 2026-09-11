import { UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, validationError } from '@/lib/errors';
import { activeAuthorityRelease, AUTHORITY_RELEASE_IMPORT_PRINCIPALS, importAuthorityRelease, loadAuthorityReleaseArtifact, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import type { Principal } from '@/types';
import { acquirePeruAuthorityBundle, PERU_TARIFF_URL } from './peru-acquisition';
import { buildPeruMarketAccess, PERU_BUNDLE_READER_VERSION, PeruBundleError, PERU_PARSER_VERSION, PERU_SOURCE_AUTHORITY, readPeruAuthorityZip, type PeruAuthorityBundle } from './peru-parser';

const SOURCE_FAMILY = 'PE_SUNAT';
export const PERU_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: SOURCE_FAMILY, authority: PERU_SOURCE_AUTHORITY, destination_scope: ['PE'],
  source_distribution: 'SUNAT consolidated national tariff workbook plus El Peruano current price-band decision', source_format: 'zip+xlsx+html', content_type: 'application/zip',
  max_bundle_bytes: 8 * 1024 * 1024, reader_version: PERU_BUNDLE_READER_VERSION, parser_version: PERU_PARSER_VERSION,
});

export async function importPeruRelease(args: { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }) {
  return importAuthorityRelease({ ...args, source: PERU_RELEASE_SOURCE, label: `Peru SUNAT ${args.release_identifier.trim()}`, validate: async (bytes) => {
    let bundle: PeruAuthorityBundle;
    try { bundle = await readPeruAuthorityZip({ bytes, release_identifier: args.release_identifier.trim(), source_url: args.source_url }); }
    catch (error) { if (error instanceof PeruBundleError) throw validationError([{ field: 'bundle', code: error.code, message: error.message }]); throw error; }
    return { file_manifest: bundle.files, validation: { exact_schema_checked: true, tariff_row_count: bundle.rows.length, mef_current_line_count_reconciled: true, ds_163_code_present: bundle.rows.some((row) => row.code === '9811000000'), ds_194_codes_present: ['0208900010', '0208900090'].every((code) => bundle.rows.some((row) => row.code === code)), franja_overlay_version: 'RVM 016-2026-EF/15.01' } };
  } });
}

export async function acquireAndImportPeruRelease(args: Omit<Parameters<typeof importPeruRelease>[0], 'bytes' | 'source_url'> & { fetch_impl?: typeof fetch }) {
  const bytes = await acquirePeruAuthorityBundle({ fetch_impl: args.fetch_impl });
  return importPeruRelease({ ...args, bytes, source_url: PERU_TARIFF_URL });
}

export function activePeruRelease() { return activeAuthorityRelease(SOURCE_FAMILY, PERU_SOURCE_AUTHORITY); }
const bundleCache = new SharedBudgetBundleCache<PeruAuthorityBundle>(SOURCE_FAMILY, 12 * 1024 * 1024);

async function loadPeruBundle(releaseId?: string) {
  const release = releaseId ? (await loadAuthorityReleaseArtifact(releaseId)).release : await activePeruRelease();
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: 'No official SUNAT consolidated tariff release has been imported and activated.' }]);
  if (release.source_family !== SOURCE_FAMILY || release.authority !== PERU_SOURCE_AUTHORITY) throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not a Peru SUNAT tariff release.' }]);
  const cached = bundleCache.get(release.checksum); if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readPeruAuthorityZip({ bytes: loaded.bytes, release_identifier: release.release_identifier, source_url: release.source_url });
  if (bundle.checksum !== release.checksum) throw new Error(`Decoded Peru bundle ${release.id} does not match its recorded checksum.`);
  bundleCache.set(release.checksum, bundle); return { release, bundle };
}

export async function fetchPeruMarketAccess(hs6: string, options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {}) {
  if (!/^\d{6}$/.test(hs6)) throw validationError([{ field: 'hs6', code: 'invalid', message: 'Peru Market Access requires an exact six-digit HS code.' }]);
  const loaded = await loadPeruBundle(options.release_id);
  return buildPeruMarketAccess({ bundle: loaded.bundle, release_id: loaded.release.id, release_reference_date: loaded.release.reference_date, retrieved_at: loaded.release.retrieved_at, hs6, at: options.now ?? new Date(), origin_country: options.origin_country, parser_version: options.parser_version });
}

export async function reparsePeruAuthorityRelease(args: { actor: Principal; release_id: string; hs6: string; parser_version: string; now?: Date; origin_country?: string; correlation_id: string }) {
  if (!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(args.actor.role as UserRole)) throw forbidden('Only ClearTrade operations staff can reparse an official authority release.');
  assertCan(args.actor, 'demand_discovery.run');
  const result = await fetchPeruMarketAccess(args.hs6, { release_id: args.release_id, parser_version: args.parser_version, now: args.now, origin_country: args.origin_country });
  const snapshot = await persistMarketAccessIngest(result, { source_run_id: `authority-reparse:${args.release_id}:${args.parser_version}` });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.generate, object_type: 'market_access_authority_reparse', object_id: snapshot.id, exporter_org_id: null, after_summary: { authority_release_id: args.release_id, parser_version: args.parser_version, hs6: args.hs6, snapshot_id: snapshot.id }, correlation_id: args.correlation_id });
  return snapshot;
}

export const __test__ = { bundleCache };
