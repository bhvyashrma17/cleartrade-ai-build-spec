/**
 * D-030 — tariff-schedule releases through the shared authority-release lifecycle: import (the bundle
 * and every official file in it are authenticated before anything is stored), activation, and one
 * market's access read from the active release of its schedule. A market whose schedule has no active
 * release gets the shared "nothing imported" error, which a run records as `no_release`, never a zero.
 */
import { validationError } from '@/lib/errors';
import { activeAuthorityRelease, importAuthorityRelease, loadAuthorityReleaseArtifact, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import type { Principal } from '@/types';
import { readTariffScheduleBundle, readTariffScheduleRelease, TARIFF_SCHEDULE_READER_VERSION, TariffScheduleBundleError, type TariffScheduleBundle } from './tariff-schedule-bundle';
import { buildTariffScheduleMarketAccess, TARIFF_SCHEDULE_PARSER_VERSION } from './tariff-schedule-market-access';
import { TARIFF_SCHEDULE_SOURCES, type TariffScheduleKey, type TariffScheduleSource } from './tariff-schedule-sources';

const overrides = new Map<TariffScheduleKey, TariffScheduleSource>();

/** Test seam: a release definition pinned to fixture files instead of the official ones. */
export function setTariffScheduleSourceForTesting(key: TariffScheduleKey, source: TariffScheduleSource | null) {
  if (source) overrides.set(key, source); else overrides.delete(key);
}

export function tariffScheduleSource(key: TariffScheduleKey): TariffScheduleSource {
  return overrides.get(key) ?? TARIFF_SCHEDULE_SOURCES[key];
}

export function tariffScheduleReleaseSource(key: TariffScheduleKey): AuthorityReleaseSource {
  const source = tariffScheduleSource(key);
  return {
    source_family: source.source_family, authority: source.authority, destination_scope: Object.keys(source.countries),
    source_distribution: source.name, source_format: key === 'MERCOSUR' || key === 'BR' ? 'zip+xlsx+json' : 'zip+pdf+json', content_type: 'application/zip',
    max_bundle_bytes: 96 * 1024 * 1024, reader_version: TARIFF_SCHEDULE_READER_VERSION, parser_version: TARIFF_SCHEDULE_PARSER_VERSION,
  };
}

export async function importTariffScheduleRelease(key: TariffScheduleKey, args: { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }) {
  const source = tariffScheduleSource(key);
  return importAuthorityRelease({ ...args, source: tariffScheduleReleaseSource(key), label: `${source.name} — ${args.release_identifier.trim()}`, validate: async (bytes) => {
    let bundle: TariffScheduleBundle;
    try { bundle = await readTariffScheduleBundle({ bytes, source, release_identifier: args.release_identifier.trim(), verify_files: true }); }
    catch (error) { if (error instanceof TariffScheduleBundleError) throw validationError([{ field: 'bundle', code: error.code, message: error.message }]); throw error; }
    return { file_manifest: bundle.files, validation: {
      schedule: key, countries: source.countries, tariff_line_count: bundle.lines.size, exception_count: bundle.exception_count, india_preference_count: bundle.india_preference_count,
      effective_from: bundle.effective_from, valid_until: bundle.valid_until, per_artifact_sha256_validated: true, source_checksums_pinned: true,
      provenance: bundle.provenance, rights_basis: bundle.rights_basis, trade_remedies_modelled: false, tariff_treatment_complete: false, regulatory_coverage_complete: false,
    } };
  } });
}

export function activeTariffScheduleRelease(key: TariffScheduleKey) {
  const source = tariffScheduleSource(key);
  return activeAuthorityRelease(source.source_family, source.authority);
}

/** The weight is the measured order of the parsed lines (≈ 13k GCC lines with CEPA staging at most). */
const caches: Record<TariffScheduleKey, SharedBudgetBundleCache<TariffScheduleBundle>> = {
  GCC: new SharedBudgetBundleCache('TARIFF_SCHEDULE_GCC', 32 * 1024 * 1024),
  MERCOSUR: new SharedBudgetBundleCache('TARIFF_SCHEDULE_MERCOSUR', 16 * 1024 * 1024),
  CN: new SharedBudgetBundleCache('TARIFF_SCHEDULE_CN', 24 * 1024 * 1024),
  BR: new SharedBudgetBundleCache('TARIFF_SCHEDULE_BR', 16 * 1024 * 1024),
};

async function loadBundle(key: TariffScheduleKey, releaseId?: string) {
  const source = tariffScheduleSource(key);
  const release = releaseId ? (await loadAuthorityReleaseArtifact(releaseId)).release : await activeTariffScheduleRelease(key);
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: `No ${source.label} release has been imported and activated.` }]);
  if (release.source_family !== source.source_family || release.authority !== source.authority) throw validationError([{ field: 'release', code: 'wrong_authority', message: `That release is not a ${source.label} release.` }]);
  const cached = caches[key].get(release.checksum);
  if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readTariffScheduleRelease({ bytes: loaded.bytes, source, release_identifier: release.release_identifier, reader_version: release.reader_version });
  if (bundle.checksum !== release.checksum) throw new Error(`Decoded ${source.key} bundle ${release.id} does not match its recorded checksum.`);
  caches[key].set(release.checksum, bundle);
  return { release, bundle };
}

export async function fetchTariffScheduleMarketAccess(key: TariffScheduleKey, countryCode: string, hs6: string, options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {}) {
  if (!/^\d{6}$/.test(hs6)) throw validationError([{ field: 'hs6', code: 'invalid', message: 'Tariff-schedule market access requires an exact six-digit HS code.' }]);
  const source = tariffScheduleSource(key);
  const loaded = await loadBundle(key, options.release_id);
  return buildTariffScheduleMarketAccess({
    source, bundle: loaded.bundle, release_id: loaded.release.id, release_reference_date: loaded.release.reference_date,
    retrieved_at: loaded.release.retrieved_at, country: countryCode, hs6, at: options.now ?? new Date(),
    origin_country: options.origin_country, parser_version: options.parser_version ?? loaded.release.parser_version,
  });
}

export const __test__ = { clearCaches: () => { for (const cache of Object.values(caches)) cache.clear(); } };
