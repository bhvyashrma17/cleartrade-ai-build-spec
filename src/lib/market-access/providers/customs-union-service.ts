/**
 * D-028 — customs-union releases through the shared authority-release lifecycle: import (the bundle
 * is authenticated before anything is stored), activation, and one member's market access read from
 * the active release of its union. A member whose union has no active release gets the shared
 * "nothing imported" error, which a run records as `no_release`, never as a zero.
 */
import { validationError } from '@/lib/errors';
import { activeAuthorityRelease, importAuthorityRelease, loadAuthorityReleaseArtifact, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import type { Principal } from '@/types';
import { CUSTOMS_UNION_READER_VERSION, CustomsUnionBundleError, readCustomsUnionBundle, readCustomsUnionRelease, type CustomsUnionBundle } from './customs-union-bundle';
import { buildCustomsUnionMarketAccess, CUSTOMS_UNION_PARSER_VERSION } from './customs-union-market-access';
import { CUSTOMS_UNION_SOURCES, type CustomsUnionKey, type CustomsUnionSource } from './customs-union-sources';

const overrides = new Map<CustomsUnionKey, CustomsUnionSource>();

/** Test seam: a release definition pinned to fixture files instead of the official ones. */
export function setCustomsUnionSourceForTesting(union: CustomsUnionKey, source: CustomsUnionSource | null) {
  if (source) overrides.set(union, source); else overrides.delete(union);
}

export function customsUnionSource(union: CustomsUnionKey): CustomsUnionSource {
  return overrides.get(union) ?? CUSTOMS_UNION_SOURCES[union];
}

export function customsUnionReleaseSource(union: CustomsUnionKey): AuthorityReleaseSource {
  const source = customsUnionSource(union);
  return {
    source_family: source.source_family, authority: source.authority, destination_scope: source.members,
    source_distribution: source.name, source_format: union === 'EAEU' ? 'zip+json' : 'zip+pdf+json', content_type: 'application/zip',
    max_bundle_bytes: 64 * 1024 * 1024, reader_version: CUSTOMS_UNION_READER_VERSION, parser_version: CUSTOMS_UNION_PARSER_VERSION,
  };
}

export async function importCustomsUnionRelease(union: CustomsUnionKey, args: { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }) {
  const source = customsUnionSource(union);
  return importAuthorityRelease({ ...args, source: customsUnionReleaseSource(union), label: `${source.name} — ${args.release_identifier.trim()}`, validate: async (bytes) => {
    let bundle: CustomsUnionBundle;
    try { bundle = await readCustomsUnionBundle({ bytes, source, release_identifier: args.release_identifier.trim() }); }
    catch (error) { if (error instanceof CustomsUnionBundleError) throw validationError([{ field: 'bundle', code: error.code, message: error.message }]); throw error; }
    return { file_manifest: bundle.files, validation: {
      union, members: [...source.members], tariff_line_count: bundle.lines.size, exception_count: bundle.exception_count,
      effective_from: bundle.effective_from, valid_until: bundle.valid_until, per_artifact_sha256_validated: true, source_checksums_pinned: true,
      provenance: bundle.provenance, national_exceptions_modelled: false, tariff_treatment_complete: false, regulatory_coverage_complete: false,
    } };
  } });
}

export function activeCustomsUnionRelease(union: CustomsUnionKey) {
  const source = customsUnionSource(union);
  return activeAuthorityRelease(source.source_family, source.authority);
}

/** A union bundle retains ~13k lines at most (EAEU); the weight is the measured order, not a live size. */
const caches: Record<CustomsUnionKey, SharedBudgetBundleCache<CustomsUnionBundle>> = {
  EAEU: new SharedBudgetBundleCache('CUSTOMS_UNION_EAEU', 24 * 1024 * 1024),
  ECOWAS: new SharedBudgetBundleCache('CUSTOMS_UNION_ECOWAS', 12 * 1024 * 1024),
  EAC: new SharedBudgetBundleCache('CUSTOMS_UNION_EAC', 12 * 1024 * 1024),
};

async function loadBundle(union: CustomsUnionKey, releaseId?: string) {
  const source = customsUnionSource(union);
  const release = releaseId ? (await loadAuthorityReleaseArtifact(releaseId)).release : await activeCustomsUnionRelease(union);
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: `No ${source.label} release has been imported and activated.` }]);
  if (release.source_family !== source.source_family || release.authority !== source.authority) throw validationError([{ field: 'release', code: 'wrong_authority', message: `That release is not a ${source.label} release.` }]);
  const cached = caches[union].get(release.checksum);
  if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readCustomsUnionRelease({ bytes: loaded.bytes, source, release_identifier: release.release_identifier, reader_version: release.reader_version });
  if (bundle.checksum !== release.checksum) throw new Error(`Decoded ${source.key} bundle ${release.id} does not match its recorded checksum.`);
  caches[union].set(release.checksum, bundle);
  return { release, bundle };
}

export async function fetchCustomsUnionMarketAccess(union: CustomsUnionKey, countryCode: string, hs6: string, options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {}) {
  if (!/^\d{6}$/.test(hs6)) throw validationError([{ field: 'hs6', code: 'invalid', message: 'Customs-union market access requires an exact six-digit HS code.' }]);
  const source = customsUnionSource(union);
  const loaded = await loadBundle(union, options.release_id);
  return buildCustomsUnionMarketAccess({
    source, bundle: loaded.bundle, release_id: loaded.release.id, release_reference_date: loaded.release.reference_date,
    retrieved_at: loaded.release.retrieved_at, country: countryCode, hs6, at: options.now ?? new Date(),
    origin_country: options.origin_country, parser_version: options.parser_version ?? loaded.release.parser_version,
  });
}

export const __test__ = { clearCaches: () => { for (const cache of Object.values(caches)) cache.clear(); } };
