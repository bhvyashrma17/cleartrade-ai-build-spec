import { UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, validationError } from '@/lib/errors';
import { activeAuthorityRelease, AUTHORITY_RELEASE_IMPORT_PRINCIPALS, importAuthorityRelease, loadAuthorityReleaseArtifact, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import type { Principal } from '@/types';
import { acquireOmanAuthorityBundle, OMAN_TARIFF_URL } from './oman-acquisition';
import { OMAN_BUNDLE_READER_VERSION, OmanBundleError, readOmanAuthorityBundle, readOmanAuthorityRelease, type OmanAuthorityBundle } from './oman-bundle';
import { buildOmanMarketAccess, OMAN_PARSER_VERSION, OMAN_SOURCE_AUTHORITY } from './oman-parser';

const SOURCE_FAMILY = 'OM_ROP_CUSTOMS';
export const OMAN_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: SOURCE_FAMILY, authority: OMAN_SOURCE_AUTHORITY, destination_scope: ['OM'],
  source_distribution: 'Oman Customs Tariff 2026, GCC/Oman ceramic anti-dumping instruments, Oman–India CEPA agreement materials and WIPO Lex article 4 evidence',
  source_format: 'zip+pdf+xlsx+html+txt', content_type: 'application/zip', max_bundle_bytes: 56 * 1024 * 1024,
  reader_version: OMAN_BUNDLE_READER_VERSION, parser_version: OMAN_PARSER_VERSION,
});

export async function importOmanRelease(args: { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }) {
  // The external release identifier is the acquisition-date snapshot key. The
  // AuthorityRelease database id is assigned only when this bundle is imported.
  return importAuthorityRelease({ ...args, source: OMAN_RELEASE_SOURCE, label: `Oman Customs Tariff 2026 — acquired ${args.release_identifier.trim()}`, validate: async (bytes) => {
    let bundle: OmanAuthorityBundle;
    try { bundle = await readOmanAuthorityBundle({ bytes, release_identifier: args.release_identifier.trim() }); }
    catch (error) { if (error instanceof OmanBundleError) throw validationError([{ field: 'bundle', code: error.code, message: error.message }]); throw error; }
    return { file_manifest: bundle.files, validation: {
      exact_layout_checked: true, tariff_line_count: bundle.lines.size,
      physical_row_count: bundle.physical_row_count, per_file_sha256_validated: true,
      current_anti_dumping_schedule_and_gcc_extension_validated: true,
      legacy_anti_dumping_workbook_cross_checked_with_documented_70_vs_70_2_difference: true,
      producer_or_exporter_identity_required_for_anti_dumping_rate: true,
      india_cepa_categories_retained: ['A', 'B', 'C', 'E', 'X'],
      india_origin_proof_required: true,
      india_product_specific_origin_rule_must_be_resolved: true,
      tariff_treatment_complete: true,
      regulatory_coverage_complete: false,
    } };
  } });
}

export async function acquireAndImportOmanRelease(args: Omit<Parameters<typeof importOmanRelease>[0], 'bytes' | 'source_url'> & { fetch_impl?: typeof fetch }) {
  const bytes = await acquireOmanAuthorityBundle({ fetch_impl: args.fetch_impl, release_identifier: args.release_identifier });
  return importOmanRelease({ ...args, bytes, source_url: OMAN_TARIFF_URL });
}

export function activeOmanRelease() { return activeAuthorityRelease(SOURCE_FAMILY, OMAN_SOURCE_AUTHORITY); }
const bundleCache = new SharedBudgetBundleCache<OmanAuthorityBundle>(SOURCE_FAMILY, 64 * 1024 * 1024);

async function loadOmanBundle(releaseId?: string) {
  const release = releaseId ? (await loadAuthorityReleaseArtifact(releaseId)).release : await activeOmanRelease();
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: 'No official Oman Customs authority release has been imported and activated.' }]);
  if (release.source_family !== SOURCE_FAMILY || release.authority !== OMAN_SOURCE_AUTHORITY) throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not an Oman Customs tariff release.' }]);
  const cached = bundleCache.get(release.checksum); if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readOmanAuthorityRelease({ bytes: loaded.bytes, release_identifier: release.release_identifier, reader_version: release.reader_version });
  if (bundle.checksum !== release.checksum) throw new Error(`Decoded Oman bundle ${release.id} does not match its recorded checksum.`);
  bundleCache.set(release.checksum, bundle); return { release, bundle };
}

export async function fetchOmanMarketAccess(hs6: string, options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {}) {
  if (!/^\d{6}$/.test(hs6)) throw validationError([{ field: 'hs6', code: 'invalid', message: 'Oman Market Access requires an exact six-digit HS code.' }]);
  const loaded = await loadOmanBundle(options.release_id);
  return buildOmanMarketAccess({ bundle: loaded.bundle, release_id: loaded.release.id, release_reference_date: loaded.release.reference_date,
    retrieved_at: loaded.release.retrieved_at, hs6, at: options.now ?? new Date(), origin_country: options.origin_country,
    parser_version: options.parser_version ?? loaded.release.parser_version });
}

export async function reparseOmanAuthorityRelease(args: { actor: Principal; release_id: string; hs6: string; parser_version: string; now?: Date; origin_country?: string; correlation_id: string }) {
  if (!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(args.actor.role as UserRole)) throw forbidden('Only ClearTrade operations staff can reparse an official authority release.');
  assertCan(args.actor, 'demand_discovery.run');
  const result = await fetchOmanMarketAccess(args.hs6, { release_id: args.release_id, parser_version: args.parser_version, now: args.now, origin_country: args.origin_country });
  const snapshot = await persistMarketAccessIngest(result, { source_run_id: `authority-reparse:${args.release_id}:${args.parser_version}` });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.generate, object_type: 'market_access_authority_reparse', object_id: snapshot.id,
    exporter_org_id: null, after_summary: { authority_release_id: args.release_id, parser_version: args.parser_version, hs6: args.hs6, snapshot_id: snapshot.id }, correlation_id: args.correlation_id });
  return snapshot;
}

export const __test__ = { bundleCache };
