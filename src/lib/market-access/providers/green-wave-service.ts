import { UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, validationError } from '@/lib/errors';
import { activeAuthorityRelease, AUTHORITY_RELEASE_IMPORT_PRINCIPALS, importAuthorityRelease, loadAuthorityReleaseArtifact, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import type { Principal } from '@/types';
import { acquireGreenWaveAuthorityBundle } from './green-wave-acquisition';
import { GREEN_WAVE_CONFIGS, type GreenWaveCountry } from './green-wave-config';
import { buildGreenWaveMarketAccess } from './green-wave-parser';
import { PDF_TABLE_READER_VERSION, PdfTableBundleError, readPdfAuthorityBundle, readPdfAuthorityRelease, type PdfAuthorityBundle } from './pdf-table-family';

const caches = new Map<GreenWaveCountry, SharedBudgetBundleCache<PdfAuthorityBundle>>();
const cacheFor = (country: GreenWaveCountry) => {
  let cache = caches.get(country);
  if (!cache) { cache = new SharedBudgetBundleCache<PdfAuthorityBundle>(GREEN_WAVE_CONFIGS[country].source_family, 28 * 1024 * 1024); caches.set(country, cache); }
  return cache;
};
const expectedRoles = (country: GreenWaveCountry) => Object.fromEntries(GREEN_WAVE_CONFIGS[country].artifacts.map((artifact) => [artifact.name, artifact.role]));

/** Reads a retained release against the current artifact set, then against each retired edition's. */
async function readRetainedGreenWaveRelease(country: GreenWaveCountry, args: Omit<Parameters<typeof readPdfAuthorityRelease>[0], 'expected_roles' | 'country_code'>) {
  const roleSets = [expectedRoles(country), ...(GREEN_WAVE_CONFIGS[country].retired_artifact_sets ?? [])];
  for (const [index, expected_roles] of roleSets.entries()) {
    try { return await readPdfAuthorityRelease({ ...args, country_code: country, expected_roles }); }
    catch (error) {
      if (!(error instanceof PdfTableBundleError) || error.code !== 'unexpected_manifest' || index === roleSets.length - 1) throw error;
    }
  }
  throw new Error(`No ${country} artifact set is configured.`);
}

export function greenWaveReleaseSource(country: GreenWaveCountry): AuthorityReleaseSource {
  const config = GREEN_WAVE_CONFIGS[country];
  return Object.freeze({ source_family: config.source_family, authority: config.authority, destination_scope: [country],
    source_distribution: `${config.family}: ${config.dataset}, retained rights and India-treatment evidence`, source_format: 'zip+pdf+html+json',
    content_type: 'application/zip', max_bundle_bytes: (country === 'LK' ? 160 : 96) * 1024 * 1024, reader_version: PDF_TABLE_READER_VERSION, parser_version: config.parser_version });
}

export async function importGreenWaveRelease(country: GreenWaveCountry, args: { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }) {
  const config = GREEN_WAVE_CONFIGS[country];
  return importAuthorityRelease({ ...args, source: greenWaveReleaseSource(country), label: `${config.dataset} — acquired ${args.release_identifier.trim()}`, validate: async (bytes) => {
    let bundle: PdfAuthorityBundle;
    try { bundle = await readPdfAuthorityBundle({ bytes, release_identifier: args.release_identifier.trim(), country_code: country, expected_roles: expectedRoles(country) }); }
    catch (error) { if (error instanceof PdfTableBundleError) throw validationError([{ field: 'bundle', code: error.code, message: error.message }]); throw error; }
    const tariff = bundle.files.find((file) => file.url === config.tariff_url);
    // Mauritius' 1 October 2026 edition already incorporates every published change (no post-baseline layer).
    const expectedAmendments = country === 'LK' ? 3 : 0;
    if (bundle.line_count !== config.profile.expected_line_count || tariff?.sha256 !== config.tariff_sha256
      || bundle.amendment_operations.length !== expectedAmendments) {
      throw validationError([{ field: 'bundle', code: 'qualification_controls_changed', message: `${country} bundle does not match the qualified tariff checksum, row count or amendment count.` }]);
    }
    return { file_manifest: bundle.files, validation: { family: config.family, exact_layout_checked: true, tariff_line_count: bundle.line_count,
      per_file_sha256_validated: true, rights_evidence_retained: true, india_preference_semantics_separate: true,
      amendment_operations: bundle.amendment_operations, tariff_treatment_complete: true, regulatory_coverage_complete: false } };
  } });
}

export async function acquireAndImportGreenWaveRelease(country: GreenWaveCountry, args: Omit<Parameters<typeof importGreenWaveRelease>[1], 'bytes' | 'source_url'> & { fetch_impl?: typeof fetch }) {
  const bytes = await acquireGreenWaveAuthorityBundle(country, { fetch_impl: args.fetch_impl, release_identifier: args.release_identifier });
  return importGreenWaveRelease(country, { ...args, bytes, source_url: GREEN_WAVE_CONFIGS[country].tariff_url });
}

export function activeGreenWaveRelease(country: GreenWaveCountry) {
  const config = GREEN_WAVE_CONFIGS[country];
  return activeAuthorityRelease(config.source_family, config.authority);
}

async function loadBundle(country: GreenWaveCountry, releaseId?: string) {
  const config = GREEN_WAVE_CONFIGS[country];
  const release = releaseId ? (await loadAuthorityReleaseArtifact(releaseId)).release : await activeGreenWaveRelease(country);
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: `No active ${config.authority} authority release exists.` }]);
  if (release.source_family !== config.source_family || release.authority !== config.authority) throw validationError([{ field: 'release', code: 'wrong_authority', message: `That release is not a ${config.authority} tariff release.` }]);
  const cache = cacheFor(country); const cached = cache.get(release.checksum); if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readRetainedGreenWaveRelease(country, { bytes: loaded.bytes, release_identifier: release.release_identifier, reader_version: release.reader_version });
  if (bundle.checksum !== release.checksum) throw new Error(`Decoded ${country} bundle ${release.id} does not match its recorded checksum.`);
  cache.set(release.checksum, bundle); return { release, bundle };
}

export async function fetchGreenWaveMarketAccess(country: GreenWaveCountry, hs6: string, options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {}) {
  if (!/^\d{6}$/.test(hs6)) throw validationError([{ field: 'hs6', code: 'invalid', message: `${country} Market Access requires an exact six-digit HS code.` }]);
  const loaded = await loadBundle(country, options.release_id);
  return buildGreenWaveMarketAccess({ country, bundle: loaded.bundle, release_id: loaded.release.id, release_reference_date: loaded.release.reference_date,
    retrieved_at: loaded.release.retrieved_at, hs6, at: options.now ?? new Date(), origin_country: options.origin_country,
    parser_version: options.parser_version ?? loaded.release.parser_version });
}

export async function reparseGreenWaveAuthorityRelease(args: { actor: Principal; country: GreenWaveCountry; release_id: string; hs6: string; parser_version: string; now?: Date; origin_country?: string; correlation_id: string }) {
  if (!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(args.actor.role as UserRole)) throw forbidden('Only ClearTrade operations staff can reparse an official authority release.');
  assertCan(args.actor, 'demand_discovery.run');
  const result = await fetchGreenWaveMarketAccess(args.country, args.hs6, { release_id: args.release_id, parser_version: args.parser_version, now: args.now, origin_country: args.origin_country });
  const snapshot = await persistMarketAccessIngest(result, { source_run_id: `authority-reparse:${args.release_id}:${args.parser_version}` });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.generate, object_type: 'market_access_authority_reparse', object_id: snapshot.id,
    exporter_org_id: null, after_summary: { authority_release_id: args.release_id, country: args.country, parser_version: args.parser_version, hs6: args.hs6, snapshot_id: snapshot.id }, correlation_id: args.correlation_id });
  return snapshot;
}

export const fetchNepalMarketAccess = (hs6: string, options?: Parameters<typeof fetchGreenWaveMarketAccess>[2]) => fetchGreenWaveMarketAccess('NP', hs6, options);
export const fetchBhutanMarketAccess = (hs6: string, options?: Parameters<typeof fetchGreenWaveMarketAccess>[2]) => fetchGreenWaveMarketAccess('BT', hs6, options);
export const fetchAlbaniaMarketAccess = (hs6: string, options?: Parameters<typeof fetchGreenWaveMarketAccess>[2]) => fetchGreenWaveMarketAccess('AL', hs6, options);
export const fetchMauritiusMarketAccess = (hs6: string, options?: Parameters<typeof fetchGreenWaveMarketAccess>[2]) => fetchGreenWaveMarketAccess('MU', hs6, options);
export const fetchSriLankaMarketAccess = (hs6: string, options?: Parameters<typeof fetchGreenWaveMarketAccess>[2]) => fetchGreenWaveMarketAccess('LK', hs6, options);

export const __test__ = { caches, readRetainedGreenWaveRelease };
