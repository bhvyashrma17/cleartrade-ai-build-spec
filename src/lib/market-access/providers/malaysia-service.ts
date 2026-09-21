import { validationError } from '@/lib/errors';
import type { Principal } from '@/types';
import { acquireMalaysiaLocalBundle } from './malaysia-acquisition';
import { MALAYSIA_BUNDLE_READER_VERSION, MALAYSIA_EXPECTED_LINE_COUNT, MALAYSIA_EXPECTED_TRQ_LINE_COUNT, MALAYSIA_RIGHTS_STATUS, readMalaysiaAuthorityBundle } from './malaysia-bundle';
import { MALAYSIA_PARSER_VERSION, MALAYSIA_SOURCE_AUTHORITY } from './malaysia-parser';
import type { MalaysiaTradeRemedyManifest } from './malaysia-remedies';

export const MALAYSIA_SOURCE_FAMILY = 'MY_JKDM_CUSTOMS_DUTIES_ORDER';
export const MALAYSIA_LOCAL_IMPLEMENTATION_STATE = 'LOCAL_IMPLEMENTATION_READY_RIGHTS_PENDING' as const;

export async function validateMalaysiaLocalBundle(args: { bytes: Buffer; release_identifier: string }) {
  const bundle = await readMalaysiaAuthorityBundle(args);
  if (bundle.lines.size !== MALAYSIA_EXPECTED_LINE_COUNT || bundle.trq.size !== MALAYSIA_EXPECTED_TRQ_LINE_COUNT) throw new Error('Malaysia real-release row totals do not match the qualified order.');
  return { state: MALAYSIA_LOCAL_IMPLEMENTATION_STATE, rights_status: MALAYSIA_RIGHTS_STATUS, authority: MALAYSIA_SOURCE_AUTHORITY,
    reader_version: MALAYSIA_BUNDLE_READER_VERSION, parser_version: MALAYSIA_PARSER_VERSION, tariff_line_count: bundle.lines.size, trq_line_count: bundle.trq.size, checksum: bundle.checksum };
}

export async function acquireAndValidateMalaysiaLocalBundle(args: { release_identifier: string; remedies: MalaysiaTradeRemedyManifest; fetch_impl?: typeof fetch; attempts?: number }) {
  const bytes = await acquireMalaysiaLocalBundle(args); return { bytes, validation: await validateMalaysiaLocalBundle({ bytes, release_identifier: args.release_identifier }) };
}

/** Hard rights gate: no AuthorityRelease row or retained normalized cache may be created yet. */
export async function importMalaysiaRelease(_args: { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string }) {
  throw validationError([{ field: 'rights_evidence', code: 'commercial_reuse_permission_pending',
    message: 'JKDM prior written permission for commercial copying, distribution and use has not been evidenced. Malaysia may be parsed transiently for local qualification, but it may not be retained, staged, activated, routed or commercially displayed.' }]);
}

/** Kept explicit so generic activation tooling cannot accidentally grow a Malaysia code path. */
export async function activateMalaysiaRelease(_args: { actor: Principal; release_id: string; correlation_id: string }) {
  throw validationError([{ field: 'rights_evidence', code: 'commercial_reuse_permission_pending',
    message: 'Malaysia activation is locked until exact written JKDM permission is attached and independently reviewed.' }]);
}
