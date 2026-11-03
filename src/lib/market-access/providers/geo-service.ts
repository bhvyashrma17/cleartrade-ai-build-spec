import { UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, validationError } from '@/lib/errors';
import { activeAuthorityRelease, AUTHORITY_RELEASE_IMPORT_PRINCIPALS, importAuthorityRelease, loadAuthorityReleaseArtifact, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import type { Principal } from '@/types';
import { buildGeorgiaMarketAccess, GEORGIA_BUNDLE_READER_VERSION, GeorgiaBundleError, GEORGIA_PARSER_VERSION, GEORGIA_SOURCE_AUTHORITY, readGeorgiaAuthorityText, type GeorgiaAuthorityTextBundle } from './geo-parser';

const SOURCE_FAMILY = 'GE_TAX_CODE';
export const GEORGIA_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: SOURCE_FAMILY, authority: GEORGIA_SOURCE_AUTHORITY, destination_scope: ['GE'],
  source_distribution: 'Official consolidated Tax Code of Georgia, Article 197', source_format: 'html', content_type: 'text/html',
  max_bundle_bytes: 5 * 1024 * 1024, reader_version: GEORGIA_BUNDLE_READER_VERSION, parser_version: GEORGIA_PARSER_VERSION,
});
export interface ImportGeorgiaReleaseArgs { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }

export async function importGeorgiaRelease(args: ImportGeorgiaReleaseArgs) {
  return importAuthorityRelease({ ...args, source: GEORGIA_RELEASE_SOURCE, label: `Georgia Tax Code ${args.release_identifier.trim()}`, validate: async (bytes) => {
    let bundle: GeorgiaAuthorityTextBundle;
    try { bundle = readGeorgiaAuthorityText({ bytes, release_identifier: args.release_identifier.trim(), source_url: args.source_url }); }
    catch (error) { if (error instanceof GeorgiaBundleError) throw validationError([{ field: 'bundle', code: error.code, message: error.message }]); throw error; }
    return { file_manifest: bundle.files, validation: { article_boundary_checked: true, rule_count: bundle.rules.length, paragraph_1_count: bundle.rules.filter((r) => r.paragraph === '1').length, paragraph_2_count: bundle.rules.filter((r) => r.paragraph === '2').length, paragraph_3_count: bundle.rules.filter((r) => r.paragraph === '3').length, vehicle_formula_checked: true, residual_zero_checked: true } };
  } });
}
export function activeGeorgiaRelease() { return activeAuthorityRelease(SOURCE_FAMILY, GEORGIA_SOURCE_AUTHORITY); }
const bundleCache = new SharedBudgetBundleCache<GeorgiaAuthorityTextBundle>(SOURCE_FAMILY, 8 * 1024 * 1024);

async function loadGeorgiaBundle(releaseId?: string) {
  const release = releaseId ? (await loadAuthorityReleaseArtifact(releaseId)).release : await activeGeorgiaRelease();
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: 'No official Matsne Tax Code release has been imported and activated.' }]);
  if (release.source_family !== SOURCE_FAMILY || release.authority !== GEORGIA_SOURCE_AUTHORITY) throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not a Matsne Tax Code release.' }]);
  const cached = bundleCache.get(release.checksum); if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = readGeorgiaAuthorityText({ bytes: loaded.bytes, release_identifier: release.release_identifier, source_url: release.source_url });
  if (bundle.checksum !== release.checksum) throw new Error(`Decoded Georgia bundle ${release.id} does not match its recorded checksum.`);
  bundleCache.set(release.checksum, bundle); return { release, bundle };
}

export async function fetchGeorgiaMarketAccess(hs6: string, options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {}) {
  if (!/^\d{6}$/.test(hs6)) throw validationError([{ field: 'hs6', code: 'invalid', message: 'Georgia Market Access requires an exact six-digit HS code.' }]);
  const loaded = await loadGeorgiaBundle(options.release_id);
  return buildGeorgiaMarketAccess({ bundle: loaded.bundle, release_id: loaded.release.id, release_reference_date: loaded.release.reference_date, retrieved_at: loaded.release.retrieved_at, hs6, at: options.now ?? new Date(), origin_country: options.origin_country, parser_version: options.parser_version });
}

export async function reparseGeorgiaAuthorityRelease(args: { actor: Principal; release_id: string; hs6: string; parser_version: string; now?: Date; origin_country?: string; correlation_id: string }) {
  if (!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(args.actor.role as UserRole)) throw forbidden('Only ClearTrade operations staff can reparse an official authority release.');
  assertCan(args.actor, 'demand_discovery.run');
  const result = await fetchGeorgiaMarketAccess(args.hs6, { release_id: args.release_id, parser_version: args.parser_version, now: args.now, origin_country: args.origin_country });
  const snapshot = await persistMarketAccessIngest(result, { source_run_id: `authority-reparse:${args.release_id}:${args.parser_version}` });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.generate, object_type: 'market_access_authority_reparse', object_id: snapshot.id, exporter_org_id: null, after_summary: { authority_release_id: args.release_id, parser_version: args.parser_version, hs6: args.hs6, snapshot_id: snapshot.id }, correlation_id: args.correlation_id });
  return snapshot;
}
export const __test__ = { bundleCache };
