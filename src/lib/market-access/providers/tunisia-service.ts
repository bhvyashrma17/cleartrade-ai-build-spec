import { UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, validationError } from '@/lib/errors';
import { activeAuthorityRelease, AUTHORITY_RELEASE_IMPORT_PRINCIPALS, importAuthorityRelease, loadAuthorityReleaseArtifact, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import type { Principal } from '@/types';
import { acquireTunisiaAuthorityBundle } from './tunisia-acquisition';
import { TUNISIA_BUNDLE_READER_VERSION, TUNISIA_PARSER_VERSION, TunisiaBundleError, readTunisiaAuthorityBundle, type TunisiaAuthorityBundle } from './tunisia-bundle';
import { buildTunisiaMarketAccess, TUNISIA_SOURCE_AUTHORITY } from './tunisia-parser';

export const TUNISIA_SOURCE_FAMILY = 'TN_DOUANE_TARIFWEB' as const;
export const TUNISIA_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({ source_family: TUNISIA_SOURCE_FAMILY, authority: TUNISIA_SOURCE_AUTHORITY, destination_scope: ['TN'], source_distribution: 'Official Tunisian Customs Tarifweb 2026 line pages with Finance Law 2026 overlays, the WTO-notified trade-remedy and tariff-quota record and the 2026 customs bulletin enumeration at 2026-09-24', source_format: 'zip+json+html+pdf', content_type: 'application/zip', max_bundle_bytes: 48 * 1024 * 1024, reader_version: TUNISIA_BUNDLE_READER_VERSION, parser_version: TUNISIA_PARSER_VERSION });
export async function importTunisiaRelease(args: { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }) {
  return importAuthorityRelease({
    ...args, source: TUNISIA_RELEASE_SOURCE, label: `Tunisia Tarifweb import tariff — ${args.release_identifier.trim()}`,
    validate: async bytes => {
      let bundle: TunisiaAuthorityBundle;
      try { bundle = await readTunisiaAuthorityBundle({ bytes, release_identifier: args.release_identifier.trim() }); } catch (error) { if (error instanceof TunisiaBundleError) throw validationError([{ field: 'bundle', code: error.code, message: error.message }]); throw error; }
      return { file_manifest: bundle.files, validation: { exact_layout_checked: true, per_file_sha256_validated: true, schedule_unique_code_count: bundle.schedule_lines.size, india_preference: 'unknown', remedy_register_enumeration_complete: bundle.remedies.register_enumeration_complete, regulatory_coverage_complete: false } };
    },
  });
}
export async function acquireAndImportTunisiaRelease(args: Omit<Parameters<typeof importTunisiaRelease>[0], 'bytes' | 'source_url'> & { fetch_impl?: typeof fetch }) {
  const bytes = await acquireTunisiaAuthorityBundle({ release_identifier: args.release_identifier, fetch_impl: args.fetch_impl });
  return importTunisiaRelease({ ...args, bytes, source_url: 'https://www.douane.gov.tn/tarifweb2026/' });
}
export function activeTunisiaRelease() { return activeAuthorityRelease(TUNISIA_SOURCE_FAMILY, TUNISIA_SOURCE_AUTHORITY); }
const cache = new SharedBudgetBundleCache<TunisiaAuthorityBundle>(TUNISIA_SOURCE_FAMILY, 32 * 1024 * 1024);
async function load(release_id?: string) {
  const release = release_id ? (await loadAuthorityReleaseArtifact(release_id)).release : await activeTunisiaRelease();
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: 'No official Tunisian Customs authority release has been imported and activated.' }]);
  if (release.source_family !== TUNISIA_SOURCE_FAMILY || release.authority !== TUNISIA_SOURCE_AUTHORITY) throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not a Tunisian Customs authority release.' }]);
  const cached = cache.get(release.checksum); if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id), bundle = await readTunisiaAuthorityBundle({ bytes: loaded.bytes, release_identifier: release.release_identifier });
  if (bundle.checksum !== release.checksum) throw new Error(`Decoded Tunisia bundle ${release.id} does not match its recorded checksum.`);
  cache.set(release.checksum, bundle); return { release, bundle };
}
export async function fetchTunisiaMarketAccess(hs6: string, options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {}) {
  if (!/^\d{6}$/.test(hs6)) throw validationError([{ field: 'hs6', code: 'invalid', message: 'Tunisia Market Access requires an exact six-digit HS code.' }]);
  const loaded = await load(options.release_id);
  return buildTunisiaMarketAccess({ bundle: loaded.bundle, release_id: loaded.release.id, release_reference_date: loaded.release.reference_date, retrieved_at: loaded.release.retrieved_at, hs6, at: options.now ?? new Date(), origin_country: options.origin_country, parser_version: options.parser_version ?? loaded.release.parser_version });
}
export async function reparseTunisiaAuthorityRelease(args: { actor: Principal; release_id: string; hs6: string; parser_version: string; now?: Date; origin_country?: string; correlation_id: string }) {
  if (!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(args.actor.role as UserRole)) throw forbidden('Only ClearTrade operations staff can reparse an official authority release.');
  assertCan(args.actor, 'demand_discovery.run');
  const result = await fetchTunisiaMarketAccess(args.hs6, { release_id: args.release_id, parser_version: args.parser_version, now: args.now, origin_country: args.origin_country }), snapshot = await persistMarketAccessIngest(result, { source_run_id: `authority-reparse:${args.release_id}:${args.parser_version}` });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.generate, object_type: 'market_access_authority_reparse', object_id: snapshot.id, exporter_org_id: null, after_summary: { authority_release_id: args.release_id, parser_version: args.parser_version, hs6: args.hs6, snapshot_id: snapshot.id }, correlation_id: args.correlation_id });
  return snapshot;
}
export const __test__ = { cache };
