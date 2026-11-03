/**
 * Real-source staging canary for the Peru authority pack (run as canary-, not verify-, because
 * the shared Prisma guard correctly refuses generic verification scripts in real environments).
 *
 * This deliberately persists releases and snapshots, so it refuses every environment except
 * staging and requires the resource-identity pins to pass before the first network or DB write.
 */
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { OrgTier } from '@prisma/client';
import { importAuthorityRelease } from '@/lib/market-access/authority-releases';
import { acquirePeruAuthorityBundle, PERU_TARIFF_URL } from '@/lib/market-access/providers/peru-acquisition';
import {
  PERU_LEGACY_PARSER_VERSION,
  PERU_RAW_BUNDLE_READER_VERSION,
  PERU_SOURCE_AUTHORITY,
  readPeruRawSunatZip,
} from '@/lib/market-access/providers/peru-parser';
import { fetchPeruMarketAccess, importPeruRelease, reparsePeruAuthorityRelease } from '@/lib/market-access/providers/peru-service';
import { prisma } from '@/lib/prisma';
import { validateRuntimeEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  if (process.env.APP_ENV !== 'staging') throw new Error('REFUSING TO RUN: Peru canaries may persist only in APP_ENV=staging.');
  validateRuntimeEnvironment('worker');
  const user = await prisma.user.findUnique({ where: { email: process.env.PERU_CANARY_ACTOR_EMAIL ?? 'admin@cleartrade.example' } });
  if (!user) throw new Error('Seed or configure PERU_CANARY_ACTOR_EMAIL as an existing staging ops/admin user.');
  const actor: Principal = { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };

  const firstBytes = await acquirePeruAuthorityBundle();
  const secondBytes = await acquirePeruAuthorityBundle();
  if (!firstBytes.equals(secondBytes)) throw new Error('Two acquisitions of the unchanged live Peru sources were not byte-identical.');
  const acquiredSha256 = sha256(firstBytes);
  const zip = await JSZip.loadAsync(firstBytes);
  const rawTariffBytes = await zip.file('sunat-tariff.zip')?.async('nodebuffer');
  if (!rawTariffBytes) throw new Error('The live composite did not retain sunat-tariff.zip.');

  const now = new Date();
  const rawRelease = await importAuthorityRelease({
    actor,
    source: {
      source_family: 'PE_SUNAT', authority: PERU_SOURCE_AUTHORITY, destination_scope: ['PE'],
      source_distribution: 'SUNAT consolidated national tariff workbook', source_format: 'zip+xlsx', content_type: 'application/zip',
      max_bundle_bytes: 8 * 1024 * 1024, reader_version: PERU_RAW_BUNDLE_READER_VERSION, parser_version: PERU_LEGACY_PARSER_VERSION,
    },
    bytes: rawTariffBytes,
    label: 'Peru repair historical raw canary',
    release_identifier: '2026-09-11-repair-raw-canary',
    reference_date: new Date('2026-09-10T00:00:00.000Z'),
    retrieved_at: now,
    source_url: PERU_TARIFF_URL,
    correlation_id: randomUUID(),
    validate: async (bytes) => {
      const bundle = await readPeruRawSunatZip({ bytes, release_identifier: '2026-09-11-repair-raw-canary', source_url: PERU_TARIFF_URL });
      return { file_manifest: bundle.files, validation: { historical_raw_reader_canary: true, row_count: bundle.rows.length } };
    },
  });

  const compositeArgs = {
    actor,
    bytes: firstBytes,
    release_identifier: '2026-09-11-repair-composite-v3-canary',
    reference_date: new Date('2026-09-11T00:00:00.000Z'),
    retrieved_at: now,
    source_url: PERU_TARIFF_URL,
    activate: true,
    correlation_id: randomUUID(),
  };
  const compositeRelease = await importPeruRelease(compositeArgs);
  const repeatedRelease = await importPeruRelease({ ...compositeArgs, correlation_id: randomUUID() });
  if (repeatedRelease.release.id !== compositeRelease.release.id || repeatedRelease.created) {
    throw new Error('Repeated composite import was not idempotent.');
  }

  const legacySnapshot = await reparsePeruAuthorityRelease({
    actor, release_id: rawRelease.release.id, hs6: '100630', parser_version: PERU_LEGACY_PARSER_VERSION,
    now: new Date('2026-09-10T12:00:00.000Z'), correlation_id: randomUUID(),
  });
  const dates = {
    before: new Date('2026-08-19T12:00:00.000Z'),
    during: new Date('2026-09-10T12:00:00.000Z'),
    after: new Date('2027-01-01T12:00:00.000Z'),
  };
  const before = await fetchPeruMarketAccess('100630', { release_id: compositeRelease.release.id, now: dates.before });
  const during = await fetchPeruMarketAccess('100630', { release_id: compositeRelease.release.id, now: dates.during });
  const after = await fetchPeruMarketAccess('100630', { release_id: compositeRelease.release.id, now: dates.after });
  const additional = during.lines.find((line) => line.measure_kind === 'additional_duty');
  if (before.lines.some((line) => line.measure_kind === 'additional_duty')
    || after.lines.some((line) => line.measure_kind === 'additional_duty')
    || additional?.duty.specific_amount !== 142
    || additional.duty.specific_currency !== 'USD'
    || additional.duty.specific_unit !== 'TNE') {
    throw new Error('The live rice canary did not respect the RVM date window or USD 142/TNE duty.');
  }

  const snapshotArgs = { actor, release_id: compositeRelease.release.id, hs6: '100630', parser_version: compositeRelease.release.parser_version };
  const beforeSnapshot = await reparsePeruAuthorityRelease({ ...snapshotArgs, now: dates.before, correlation_id: randomUUID() });
  const duringSnapshot = await reparsePeruAuthorityRelease({ ...snapshotArgs, now: dates.during, correlation_id: randomUUID() });
  const repeatedDuringSnapshot = await reparsePeruAuthorityRelease({ ...snapshotArgs, now: dates.during, correlation_id: randomUUID() });
  const afterSnapshot = await reparsePeruAuthorityRelease({ ...snapshotArgs, now: dates.after, correlation_id: randomUUID() });
  if (duringSnapshot.id !== repeatedDuringSnapshot.id) throw new Error('Repeated live-source reparse was not idempotent.');

  console.log(JSON.stringify({
    deterministic_acquisition: { sha256: acquiredSha256, byte_length: firstBytes.length, repeated_byte_identical: true },
    releases: {
      historical_raw: { id: rawRelease.release.id, created: rawRelease.created, reader_version: rawRelease.release.reader_version, parser_version: rawRelease.release.parser_version },
      composite: { id: compositeRelease.release.id, created: compositeRelease.created, reader_version: compositeRelease.release.reader_version, parser_version: compositeRelease.release.parser_version, repeated_release_id: repeatedRelease.release.id },
    },
    canaries: {
      historical_replay_snapshot_id: legacySnapshot.id,
      before: { at: dates.before.toISOString(), snapshot_id: beforeSnapshot.id, additional_duty_present: false },
      during: { at: dates.during.toISOString(), snapshot_id: duringSnapshot.id, repeated_snapshot_id: repeatedDuringSnapshot.id, rice_duty: additional.duty },
      after: { at: dates.after.toISOString(), snapshot_id: afterSnapshot.id, additional_duty_present: false },
    },
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
