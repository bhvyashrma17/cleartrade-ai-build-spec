import { UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, validationError } from '@/lib/errors';
import { activeAuthorityRelease, AUTHORITY_RELEASE_IMPORT_PRINCIPALS, importAuthorityRelease, loadAuthorityReleaseArtifact, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import type { Principal } from '@/types';
import { acquireIcelandAuthorityBundle, icelandKeysUrlForRelease } from './iceland-acquisition';
import { ICELAND_BUNDLE_READER_VERSION, IcelandBundleError, readIcelandAuthorityBundle, readIcelandAuthorityRelease, type IcelandAuthorityBundle } from './iceland-bundle';
import { buildIcelandMarketAccess, ICELAND_PARSER_VERSION, ICELAND_SOURCE_AUTHORITY } from './iceland-parser';

const SOURCE_FAMILY = 'IS_SKATTURINN';
export const ICELAND_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: SOURCE_FAMILY, authority: ICELAND_SOURCE_AUTHORITY, destination_scope: ['IS'],
  source_distribution: 'Skatturinn effective-dated tollskrárlyklar plus official schema, legal tariff, deviation and EFTA–India evidence',
  source_format: 'zip+fixed-width+pdf+html', content_type: 'application/zip', max_bundle_bytes: 48 * 1024 * 1024,
  reader_version: ICELAND_BUNDLE_READER_VERSION, parser_version: ICELAND_PARSER_VERSION,
});

export async function importIcelandRelease(args: { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }) {
  return importAuthorityRelease({ ...args, source: ICELAND_RELEASE_SOURCE, label: `Skatturinn ${args.release_identifier.trim()}`, validate: async (bytes) => {
    let bundle: IcelandAuthorityBundle;
    try { bundle = await readIcelandAuthorityBundle({ bytes, release_identifier: args.release_identifier.trim() }); }
    catch (error) { if (error instanceof IcelandBundleError) throw validationError([{ field: 'bundle', code: error.code, message: error.message }]); throw error; }
    return { file_manifest: bundle.files, validation: {
      tariff_line_count: bundle.lines.size, physical_record_count: bundle.physical_record_count,
      record_type_counts: bundle.record_type_counts, general_measure_code: 'A', india_measure_code: 'YX',
      per_file_sha256_validated: true, descriptions_retained_in_controlling_tariff: true,
      regulatory_coverage_complete: false,
    } };
  } });
}

export async function acquireAndImportIcelandRelease(args: Omit<Parameters<typeof importIcelandRelease>[0], 'bytes' | 'source_url'> & { fetch_impl?: typeof fetch }) {
  const bytes = await acquireIcelandAuthorityBundle({ fetch_impl: args.fetch_impl, release_identifier: args.release_identifier });
  return importIcelandRelease({ ...args, bytes, source_url: icelandKeysUrlForRelease(args.release_identifier) });
}

export function activeIcelandRelease() { return activeAuthorityRelease(SOURCE_FAMILY, ICELAND_SOURCE_AUTHORITY); }
const bundleCache = new SharedBudgetBundleCache<IcelandAuthorityBundle>(SOURCE_FAMILY, 64 * 1024 * 1024);

async function loadIcelandBundle(releaseId?: string) {
  const release = releaseId ? (await loadAuthorityReleaseArtifact(releaseId)).release : await activeIcelandRelease();
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: 'No official Skatturinn authority release has been imported and activated.' }]);
  if (release.source_family !== SOURCE_FAMILY || release.authority !== ICELAND_SOURCE_AUTHORITY) throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not a Skatturinn tariff-key release.' }]);
  const cached = bundleCache.get(release.checksum); if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readIcelandAuthorityRelease({ bytes: loaded.bytes, release_identifier: release.release_identifier, reader_version: release.reader_version });
  if (bundle.checksum !== release.checksum) throw new Error(`Decoded Iceland bundle ${release.id} does not match its recorded checksum.`);
  bundleCache.set(release.checksum, bundle); return { release, bundle };
}

export async function fetchIcelandMarketAccess(hs6: string, options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {}) {
  if (!/^\d{6}$/.test(hs6)) throw validationError([{ field: 'hs6', code: 'invalid', message: 'Iceland Market Access requires an exact six-digit HS code.' }]);
  const loaded = await loadIcelandBundle(options.release_id);
  return buildIcelandMarketAccess({ bundle: loaded.bundle, release_id: loaded.release.id, release_reference_date: loaded.release.reference_date,
    retrieved_at: loaded.release.retrieved_at, hs6, at: options.now ?? new Date(), origin_country: options.origin_country,
    parser_version: options.parser_version ?? loaded.release.parser_version });
}

export async function reparseIcelandAuthorityRelease(args: { actor: Principal; release_id: string; hs6: string; parser_version: string; now?: Date; origin_country?: string; correlation_id: string }) {
  if (!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(args.actor.role as UserRole)) throw forbidden('Only ClearTrade operations staff can reparse an official authority release.');
  assertCan(args.actor, 'demand_discovery.run');
  const result = await fetchIcelandMarketAccess(args.hs6, { release_id: args.release_id, parser_version: args.parser_version, now: args.now, origin_country: args.origin_country });
  const snapshot = await persistMarketAccessIngest(result, { source_run_id: `authority-reparse:${args.release_id}:${args.parser_version}` });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.generate, object_type: 'market_access_authority_reparse', object_id: snapshot.id,
    exporter_org_id: null, after_summary: { authority_release_id: args.release_id, parser_version: args.parser_version, hs6: args.hs6, snapshot_id: snapshot.id }, correlation_id: args.correlation_id });
  return snapshot;
}

export const __test__ = { bundleCache };
