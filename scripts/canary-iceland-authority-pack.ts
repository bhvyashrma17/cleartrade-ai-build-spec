/**
 * Real-source staging canary for the Iceland Skatturinn authority pack.
 *
 * It writes an immutable release and evidence snapshots, so it refuses every environment except
 * staging. Runtime identity pins are validated before the first network or database write.
 */
import { createHash, randomUUID } from 'node:crypto';
import { OrgTier } from '@prisma/client';
import { acquireIcelandAuthorityBundle, ICELAND_KEYS_URL } from '@/lib/market-access/providers/iceland-acquisition';
import { readIcelandAuthorityBundle } from '@/lib/market-access/providers/iceland-bundle';
import { fetchIcelandMarketAccess, importIcelandRelease, reparseIcelandAuthorityRelease } from '@/lib/market-access/providers/iceland-service';
import { prisma } from '@/lib/prisma';
import { validateRuntimeEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const RELEASE = '2026-09-01';
const EXPECTED_KEYS_SHA256 = 'fc664a01b46622ab282e1c37935d163a193d6fd6df4e0f42c1be051518e6f48f';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  if (process.env.APP_ENV !== 'staging') throw new Error('REFUSING TO RUN: Iceland canaries may persist only in APP_ENV=staging.');
  validateRuntimeEnvironment('worker');
  const user = await prisma.user.findUnique({ where: { email: process.env.ICELAND_CANARY_ACTOR_EMAIL ?? 'admin@cleartrade.example' } });
  if (!user) throw new Error('Seed or configure ICELAND_CANARY_ACTOR_EMAIL as an existing staging ops/admin user.');
  const actor: Principal = { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };

  const firstBytes = await acquireIcelandAuthorityBundle();
  const secondBytes = await acquireIcelandAuthorityBundle();
  if (!firstBytes.equals(secondBytes)) throw new Error('Two acquisitions of the unchanged live Iceland sources were not byte-identical.');
  const bundle = await readIcelandAuthorityBundle({ bytes: firstBytes, release_identifier: RELEASE });
  const keys = bundle.files.find((file) => file.name === 'tariff-keys.zip');
  if (keys?.sha256 !== EXPECTED_KEYS_SHA256 || bundle.lines.size !== 9_442 || bundle.physical_record_count !== 29_671) {
    throw new Error('The live Skatturinn release no longer matches the qualified 1 September 2026 controls.');
  }

  const now = new Date();
  const importArgs = {
    actor, bytes: firstBytes, release_identifier: RELEASE,
    reference_date: new Date(`${RELEASE}T00:00:00.000Z`), retrieved_at: now,
    source_url: ICELAND_KEYS_URL, activate: true, correlation_id: randomUUID(),
  };
  const imported = await importIcelandRelease(importArgs);
  const repeated = await importIcelandRelease({ ...importArgs, correlation_id: randomUUID() });
  if (repeated.release.id !== imported.release.id || repeated.created) throw new Error('Repeated Iceland authority import was not idempotent.');

  const shirts = await fetchIcelandMarketAccess('610910', { release_id: imported.release.id, now, origin_country: 'IN' });
  const beef = await fetchIcelandMarketAccess('020110', { release_id: imported.release.id, now, origin_country: 'IN' });
  const rice = await fetchIcelandMarketAccess('100630', { release_id: imported.release.id, now, origin_country: 'IN' });
  if (shirts.general_duty?.ad_valorem_rate_percent !== 0 || shirts.india_preference.applicability !== 'potentially_applicable_requires_origin_proof') {
    throw new Error('The live Iceland legal-zero/India-TEPA canary failed.');
  }
  if (beef.general_duty?.kind !== 'compound' || beef.general_duty.ad_valorem_rate_percent !== 30 || beef.general_duty.specific_amount !== 357) {
    throw new Error('The live Iceland compound-duty canary failed.');
  }
  if (rice.resolution.resolution !== 'all_children_equivalent' || rice.resolution.candidate_count !== 2) {
    throw new Error('The live Iceland national-line resolution canary failed.');
  }

  const reparseArgs = { actor, release_id: imported.release.id, hs6: '610910', parser_version: imported.release.parser_version, now, origin_country: 'IN' };
  const snapshot = await reparseIcelandAuthorityRelease({ ...reparseArgs, correlation_id: randomUUID() });
  const repeatedSnapshot = await reparseIcelandAuthorityRelease({ ...reparseArgs, correlation_id: randomUUID() });
  if (snapshot.id !== repeatedSnapshot.id) throw new Error('Repeated Iceland reparse was not idempotent.');

  console.log(JSON.stringify({
    deterministic_acquisition: { sha256: sha256(firstBytes), byte_length: firstBytes.length, repeated_byte_identical: true },
    source_controls: { tariff_key_sha256: keys.sha256, tariff_line_count: bundle.lines.size, physical_record_count: bundle.physical_record_count, record_type_counts: bundle.record_type_counts },
    release: { id: imported.release.id, created: imported.created, repeated_release_id: repeated.release.id, checksum: imported.release.checksum, reader_version: imported.release.reader_version, parser_version: imported.release.parser_version },
    canaries: {
      legal_zero_and_tepa: { hs6: '610910', general: shirts.general_duty, india_preference: shirts.india_preference },
      compound: { hs6: '020110', general: beef.general_duty },
      national_resolution: { hs6: '100630', resolution: rice.resolution.resolution, candidate_count: rice.resolution.candidate_count },
      idempotent_snapshot: { id: snapshot.id, repeated_id: repeatedSnapshot.id },
    },
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
