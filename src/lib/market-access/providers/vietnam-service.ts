import { UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, validationError } from '@/lib/errors';
import { activeAuthorityRelease, AUTHORITY_RELEASE_IMPORT_PRINCIPALS, importAuthorityRelease, loadAuthorityReleaseArtifact, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import type { Principal } from '@/types';
import { acquireVietnamAuthorityBundle } from './vietnam-acquisition';
import { VIETNAM_BUNDLE_READER_VERSION, VIETNAM_PARSER_VERSION, VietnamBundleError, readVietnamAuthorityBundle, type VietnamAuthorityBundle } from './vietnam-bundle';
import { buildVietnamMarketAccess, VIETNAM_SOURCE_AUTHORITY } from './vietnam-parser';

export const VIETNAM_SOURCE_FAMILY = 'VN_CONGBAO_CUSTOMS_TARIFF' as const;
export const VIETNAM_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({ source_family: VIETNAM_SOURCE_FAMILY, authority: VIETNAM_SOURCE_AUTHORITY, destination_scope: ['VN'], source_distribution: 'Official Gazette (Công báo) text layers: Decree 26/2023/NĐ-CP Annex II with Decrees 144/2024, 73/2025, 199/2025 and temporary 72/2026 (Resolutions 25/2026 and 34/2026), AIFTA Decree 122/2022/NĐ-CP, MOIT/TRAV trade-remedy decisions at 2026-09-23', source_format: 'zip+json+pdf+doc', content_type: 'application/zip', max_bundle_bytes: 96 * 1024 * 1024, reader_version: VIETNAM_BUNDLE_READER_VERSION, parser_version: VIETNAM_PARSER_VERSION });
export async function importVietnamRelease(args: { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }) {
  return importAuthorityRelease({
    ...args, source: VIETNAM_RELEASE_SOURCE, label: `Vietnam Decree 26/2023 import tariff — ${args.release_identifier.trim()}`,
    validate: async bytes => {
      let bundle: VietnamAuthorityBundle;
      try { bundle = await readVietnamAuthorityBundle({ bytes, release_identifier: args.release_identifier.trim() }); } catch (error) { if (error instanceof VietnamBundleError) throw validationError([{ field: 'bundle', code: error.code, message: error.message }]); throw error; }
      return { file_manifest: bundle.files, validation: { exact_layout_checked: true, per_file_sha256_validated: true, schedule_unique_code_count: bundle.schedule_lines.size, aifta_entry_count: bundle.aifta.size, chapter98_entry_count: bundle.chapter98.length, india_preference: 'potentially_applicable_requires_origin_proof', active_remedy_count: bundle.remedies.measures.length, remedy_register_enumeration_complete: bundle.remedies.register_enumeration_complete, regulatory_coverage_complete: false } };
    },
  });
}
export async function acquireAndImportVietnamRelease(args: Omit<Parameters<typeof importVietnamRelease>[0], 'bytes' | 'source_url'> & { fetch_impl?: typeof fetch }) {
  const bytes = await acquireVietnamAuthorityBundle({ release_identifier: args.release_identifier, fetch_impl: args.fetch_impl });
  return importVietnamRelease({ ...args, bytes, source_url: 'https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-26-2023-nd-cp-39522.htm' });
}
export function activeVietnamRelease() { return activeAuthorityRelease(VIETNAM_SOURCE_FAMILY, VIETNAM_SOURCE_AUTHORITY); }
const cache = new SharedBudgetBundleCache<VietnamAuthorityBundle>(VIETNAM_SOURCE_FAMILY, 48 * 1024 * 1024);
async function load(release_id?: string) {
  const release = release_id ? (await loadAuthorityReleaseArtifact(release_id)).release : await activeVietnamRelease();
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: 'No official Vietnam Official Gazette authority release has been imported and activated.' }]);
  if (release.source_family !== VIETNAM_SOURCE_FAMILY || release.authority !== VIETNAM_SOURCE_AUTHORITY) throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not a Vietnam Official Gazette authority release.' }]);
  const cached = cache.get(release.checksum); if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id), bundle = await readVietnamAuthorityBundle({ bytes: loaded.bytes, release_identifier: release.release_identifier });
  if (bundle.checksum !== release.checksum) throw new Error(`Decoded Vietnam bundle ${release.id} does not match its recorded checksum.`);
  cache.set(release.checksum, bundle); return { release, bundle };
}
export async function fetchVietnamMarketAccess(hs6: string, options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {}) {
  if (!/^\d{6}$/.test(hs6)) throw validationError([{ field: 'hs6', code: 'invalid', message: 'Vietnam Market Access requires an exact six-digit HS code.' }]);
  const loaded = await load(options.release_id);
  return buildVietnamMarketAccess({ bundle: loaded.bundle, release_id: loaded.release.id, release_reference_date: loaded.release.reference_date, retrieved_at: loaded.release.retrieved_at, hs6, at: options.now ?? new Date(), origin_country: options.origin_country, parser_version: options.parser_version ?? loaded.release.parser_version });
}
export async function reparseVietnamAuthorityRelease(args: { actor: Principal; release_id: string; hs6: string; parser_version: string; now?: Date; origin_country?: string; correlation_id: string }) {
  if (!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(args.actor.role as UserRole)) throw forbidden('Only ClearTrade operations staff can reparse an official authority release.');
  assertCan(args.actor, 'demand_discovery.run');
  const result = await fetchVietnamMarketAccess(args.hs6, { release_id: args.release_id, parser_version: args.parser_version, now: args.now, origin_country: args.origin_country }), snapshot = await persistMarketAccessIngest(result, { source_run_id: `authority-reparse:${args.release_id}:${args.parser_version}` });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.generate, object_type: 'market_access_authority_reparse', object_id: snapshot.id, exporter_org_id: null, after_summary: { authority_release_id: args.release_id, parser_version: args.parser_version, hs6: args.hs6, snapshot_id: snapshot.id }, correlation_id: args.correlation_id });
  return snapshot;
}
export const __test__ = { cache };
