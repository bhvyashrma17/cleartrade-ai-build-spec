import { UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, validationError } from '@/lib/errors';
import { activeAuthorityRelease, AUTHORITY_RELEASE_IMPORT_PRINCIPALS, importAuthorityRelease, loadAuthorityReleaseArtifact, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import type { Principal } from '@/types';
import { acquireSingaporeAuthorityBundle, SINGAPORE_ORDER_URL } from './singapore-acquisition';
import { readSingaporeAuthorityBundle, readSingaporeAuthorityRelease, SINGAPORE_BUNDLE_READER_VERSION, SingaporeBundleError, type SingaporeAuthorityBundle } from './singapore-bundle';
import { buildSingaporeMarketAccess, SINGAPORE_PARSER_VERSION, SINGAPORE_SOURCE_AUTHORITY } from './singapore-parser';

const SOURCE_FAMILY = 'SG_SSO_CUSTOMS_DUTIES';
export const SINGAPORE_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: SOURCE_FAMILY, authority: SINGAPORE_SOURCE_AUTHORITY, destination_scope: ['SG'],
  source_distribution: 'SSO current consolidated Customs (Duties) Order First Schedule, S 49/2026 and S 67/2026 provenance, SSO terms, and Singapore Customs classification/dutiable-category evidence',
  source_format: 'zip+html+json', content_type: 'application/zip', max_bundle_bytes: 64 * 1024 * 1024,
  reader_version: SINGAPORE_BUNDLE_READER_VERSION, parser_version: SINGAPORE_PARSER_VERSION,
});

export async function importSingaporeRelease(args: { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }) {
  return importAuthorityRelease({ ...args, source: SINGAPORE_RELEASE_SOURCE, label: `Singapore Customs (Duties) Order — ${args.release_identifier.trim()}`, validate: async (bytes) => {
    let bundle: SingaporeAuthorityBundle;
    try { bundle = await readSingaporeAuthorityBundle({ bytes, release_identifier: args.release_identifier.trim() }); }
    catch (error) { if (error instanceof SingaporeBundleError) throw validationError([{ field: 'bundle', code: error.code, message: error.message }]); throw error; }
    return { file_manifest: bundle.files, validation: {
      exact_layout_checked: true, tariff_line_count: bundle.lines.size, canonical_tariff_checksum: bundle.canonical_tariff_checksum,
      per_artifact_sha256_validated: true, deterministic_normalization_replayed: true,
      consolidated_as_at: bundle.consolidated_as_at, consolidated_effective_version: bundle.consolidated_effective_version,
      amendments: bundle.amendments, rights_and_attribution_retained: true, automated_extraction_window_sgt: '03:00-07:00',
      customs_and_excise_components_separate: true, india_origin_proof_required: true,
      tariff_treatment_complete: true, regulatory_coverage_complete: false,
    } };
  } });
}

export async function acquireAndImportSingaporeRelease(args: Omit<Parameters<typeof importSingaporeRelease>[0], 'bytes' | 'source_url'> & { fetch_impl?: typeof fetch; now?: Date }) {
  const bytes = await acquireSingaporeAuthorityBundle({ release_identifier: args.release_identifier, fetch_impl: args.fetch_impl, now: args.now });
  return importSingaporeRelease({ ...args, bytes, source_url: SINGAPORE_ORDER_URL, retrieved_at: args.retrieved_at ?? args.now });
}

export function activeSingaporeRelease() { return activeAuthorityRelease(SOURCE_FAMILY, SINGAPORE_SOURCE_AUTHORITY); }
const bundleCache = new SharedBudgetBundleCache<SingaporeAuthorityBundle>(SOURCE_FAMILY, 64 * 1024 * 1024);

async function loadSingaporeBundle(releaseId?: string) {
  const release = releaseId ? (await loadAuthorityReleaseArtifact(releaseId)).release : await activeSingaporeRelease();
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: 'No official Singapore SSO tariff release has been imported and activated.' }]);
  if (release.source_family !== SOURCE_FAMILY || release.authority !== SINGAPORE_SOURCE_AUTHORITY) throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not a Singapore SSO Customs (Duties) release.' }]);
  const cached = bundleCache.get(release.checksum); if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readSingaporeAuthorityRelease({ bytes: loaded.bytes, release_identifier: release.release_identifier, reader_version: release.reader_version });
  if (bundle.checksum !== release.checksum) throw new Error(`Decoded Singapore bundle ${release.id} does not match its recorded checksum.`);
  bundleCache.set(release.checksum, bundle); return { release, bundle };
}

export async function fetchSingaporeMarketAccess(hs6: string, options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {}) {
  if (!/^\d{6}$/.test(hs6)) throw validationError([{ field: 'hs6', code: 'invalid', message: 'Singapore Market Access requires an exact six-digit HS code.' }]);
  const loaded = await loadSingaporeBundle(options.release_id);
  return buildSingaporeMarketAccess({ bundle: loaded.bundle, release_id: loaded.release.id, release_reference_date: loaded.release.reference_date,
    retrieved_at: loaded.release.retrieved_at, hs6, at: options.now ?? new Date(), origin_country: options.origin_country,
    parser_version: options.parser_version ?? loaded.release.parser_version });
}

export async function reparseSingaporeAuthorityRelease(args: { actor: Principal; release_id: string; hs6: string; parser_version: string; now?: Date; origin_country?: string; correlation_id: string }) {
  if (!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(args.actor.role as UserRole)) throw forbidden('Only ClearTrade operations staff can reparse an official authority release.');
  assertCan(args.actor, 'demand_discovery.run');
  const result = await fetchSingaporeMarketAccess(args.hs6, { release_id: args.release_id, parser_version: args.parser_version, now: args.now, origin_country: args.origin_country });
  const snapshot = await persistMarketAccessIngest(result, { source_run_id: `authority-reparse:${args.release_id}:${args.parser_version}` });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.generate, object_type: 'market_access_authority_reparse', object_id: snapshot.id,
    exporter_org_id: null, after_summary: { authority_release_id: args.release_id, parser_version: args.parser_version, hs6: args.hs6, snapshot_id: snapshot.id }, correlation_id: args.correlation_id });
  return snapshot;
}

export const __test__ = { bundleCache };
