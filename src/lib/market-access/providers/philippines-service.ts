import { validationError } from '@/lib/errors';
import { activeAuthorityRelease, importAuthorityRelease, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import type { Principal } from '@/types';
import { PHILIPPINES_BUNDLE_READER_VERSION, PhilippinesBundleError, readPhilippinesAuthorityBundle, type PhilippinesAuthorityBundle } from './philippines-bundle';

export const PHILIPPINES_SOURCE_FAMILY = 'PH_TARIFF_COMMISSION';
export const PHILIPPINES_SOURCE_AUTHORITY = 'Philippine Tariff Commission';
export const PHILIPPINES_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: PHILIPPINES_SOURCE_FAMILY, authority: PHILIPPINES_SOURCE_AUTHORITY, destination_scope: ['PH'],
  source_distribution: 'Controlled manual composite: AHTN 2022 Tariff Book baseline, MFN Executive Order overlays, and annual AIFTA schedule',
  source_format: 'zip+pdf+xls/xlsx', content_type: 'application/zip', max_bundle_bytes: 100 * 1024 * 1024,
  reader_version: PHILIPPINES_BUNDLE_READER_VERSION,
  // This is deliberately a preflight version, not a tariff parser claim. Real tariff parsing is
  // blocked until the current official artifacts have been acquired and their schemas observed.
  parser_version: 'ph-tc-tariff-parser-blocked-pending-real-artifact',
});

export interface ImportPhilippinesReleaseArgs { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }

export async function importPhilippinesRelease(args: ImportPhilippinesReleaseArgs) {
  if (args.activate) throw validationError([{ field: 'activate', code: 'parser_blocked', message: 'The Philippines composite may be retained for provenance, but cannot be activated until the current official artifact schemas have been implemented and real-file qualified.' }]);
  return importAuthorityRelease({ ...args, source: PHILIPPINES_RELEASE_SOURCE, label: `Philippine Tariff Commission ${args.release_identifier.trim()}`, validate: async (bytes) => {
    let bundle: PhilippinesAuthorityBundle;
    try { bundle = await readPhilippinesAuthorityBundle(bytes); }
    catch (error) { if (error instanceof PhilippinesBundleError) throw validationError([{ field: 'bundle', code: error.code, message: error.message }]); throw error; }
    if (bundle.release_identifier !== args.release_identifier.trim()) throw validationError([{ field: 'release_identifier', code: 'bundle_mismatch', message: 'The supplied release identifier does not match acquisition.json.' }]);
    return { file_manifest: bundle.files, validation: { manual_acquisition_checked: true, official_component_count: bundle.components.length, required_roles_checked: true, eo_62_overlap_review_confirmed: true, aifta_form_ai_gate_recorded: true, tariff_rows_parsed: false, parser_blocker: 'Acquire the current official MFN and AIFTA artifacts, then establish and test their actual schemas before tariff rows can be emitted.' } };
  } });
}

export function activePhilippinesRelease() { return activeAuthorityRelease(PHILIPPINES_SOURCE_FAMILY, PHILIPPINES_SOURCE_AUTHORITY); }
