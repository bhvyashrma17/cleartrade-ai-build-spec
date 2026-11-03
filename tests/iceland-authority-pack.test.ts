import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { OrgTier, UserRole } from '@prisma/client';
import { describe, expect, test, vi } from 'vitest';
import {
  acquireIcelandAuthorityBundle,
  ICELAND_KEYS_URL,
  icelandKeysUrlForRelease,
} from '@/lib/market-access/providers/iceland-acquisition';
import { ICELAND_BUNDLE_READER_VERSION, IcelandBundleError, readIcelandAuthorityBundle, readIcelandAuthorityRelease } from '@/lib/market-access/providers/iceland-bundle';
import { buildIcelandMarketAccess } from '@/lib/market-access/providers/iceland-parser';
import { importIcelandRelease, reparseIcelandAuthorityRelease } from '@/lib/market-access/providers/iceland-service';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const AT = new Date('2026-09-14T00:00:00.000Z');
const RELEASE = '2026-09-01';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type Measure = { code: string; percent?: number; specific?: number };

function dutyRecord(type: '1' | '2' | '3', code: string, measures: Measure[]) {
  const slots = measures.map((item) => `${item.code.padEnd(2)}${String(item.percent ?? 0).padStart(5, '0')}${String(item.specific ?? 0).padStart(6, '0')}`);
  while (slots.length < 18) slots.push(' '.repeat(13));
  return `${type}${code}${slots.join('')}${type === '1' ? 'I' : ' '}`.padEnd(250, '\0');
}

function controlRecord(code: string, options: { fee?: Measure; permit?: string; prohibition?: string; base?: 'K' | 'E'; litres?: boolean; net?: boolean } = {}) {
  const fees = options.fee
    ? `${options.fee.code.padEnd(2)}${String(options.fee.percent ?? 0).padStart(5, '0')}${String(options.fee.specific ?? 0).padStart(9, '0')}`
    : ' '.repeat(16);
  const tenFees = fees + ' '.repeat(16 * 9);
  const controls = (options.permit ?? '').padEnd(21) + (options.prohibition ?? '').padEnd(9) + ' '.repeat(15);
  const tail = '  ' + '00000' + '000000' + (options.base ?? 'K') + (options.litres ? 'L' : ' ') + (options.net ? 'N' : ' ');
  return `4${code}${tenFees}${controls}${tail}`.padEnd(250, '\0');
}

function quantityRecord(code: string, quantity = 'KGM') { return `5${code}${quantity}`.padEnd(250, ' '); }

async function rawTariffZip(lines: string[], entryName = 'Tollsk20260901.txt') {
  const zip = new JSZip();
  zip.file(entryName, Buffer.from(`${lines.join('\r\n')}\r\n`, 'latin1'), { date: new Date('1980-01-01T00:00:00.000Z') });
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' }));
}

async function fixtureBytes(chrome = 'fixture', options: { entry_name?: string; release_identifier?: string } = {}) {
  const keysUrl = options.release_identifier ? icelandKeysUrlForRelease(options.release_identifier) : ICELAND_KEYS_URL;
  const keys = await rawTariffZip([
    dutyRecord('1', '61091000', [{ code: 'A', percent: 1000 }, { code: 'YX' }]),
    controlRecord('61091000', { fee: { code: 'RF', percent: 250 }, permit: 'MST', prohibition: 'TKR', base: 'K', net: true }),
    quantityRecord('61091000'),
    dutyRecord('1', '02011000', [{ code: 'A', percent: 3000, specific: 35700 }, { code: 'YX', percent: 1800, specific: 21400 }]),
    controlRecord('02011000'),
    dutyRecord('1', '29339900', [{ code: 'A', specific: 1250 }]),
    controlRecord('29339900', { base: 'E' }),
    dutyRecord('1', '10063001', [{ code: 'A' }, { code: 'YX' }]),
    controlRecord('10063001'),
    dutyRecord('1', '10063009', [{ code: 'A', percent: 500 }]),
    controlRecord('10063009'),
    dutyRecord('1', '99999999', [{ code: 'YX' }]),
    controlRecord('99999999'),
  ], options.entry_name);
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === keysUrl) return new Response(keys, { status: 200 });
    if (url.includes('india') || url.includes('indland')) return new Response(`<html><div id="${chrome}"></div><!-- eplica-contentid 1-5534-MainContent --><div class="article box" data-aid="5534"><p>Indland 1. október 2025</p></div><hr class="stream" /><div id="dynamic-${chrome}"></div></html>`, { status: 200 });
    if (url.endsWith('.pdf')) return new Response(Buffer.from('%PDF-1.7 reviewed Iceland authority fixture'), { status: 200 });
    return new Response(`<html><div id="${chrome}"></div><!-- eplica-contentid 1-3430-MainContent --><div class="article box" data-aid="3430"><p>tollskrárlyklar release history</p></div><hr class="stream" /><div id="dynamic-${chrome}"></div></html>`, { status: 200 });
  }) as typeof fetch;
  return { bytes: await acquireIcelandAuthorityBundle({ fetch_impl: fetchImpl, ...(options.release_identifier ? { release_identifier: options.release_identifier } : {}) }), fetchImpl };
}

async function parsed() {
  const { bytes } = await fixtureBytes();
  const bundle = await readIcelandAuthorityBundle({ bytes, release_identifier: RELEASE });
  return { bytes, bundle };
}

describe('Iceland retained authority bundle', () => {
  test('is deterministic, host-pinned and authenticates every retained artifact', async () => {
    const first = await fixtureBytes();
    const second = await fixtureBytes('different-request-chrome');
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(sha256(first.bytes)).toBe(sha256(second.bytes));
    expect(first.fetchImpl).toHaveBeenCalledTimes(8);
    const bundle = await readIcelandAuthorityBundle({ bytes: first.bytes, release_identifier: RELEASE });
    expect(bundle.lines.size).toBe(6);
    expect(bundle.files).toHaveLength(9);
    expect(bundle.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);

    await expect(acquireIcelandAuthorityBundle({ fetch_impl: (async (input) => {
      const url = String(input);
      if (url === ICELAND_KEYS_URL) return new Response('not a zip');
      if (url.endsWith('.pdf')) return new Response('%PDF-');
      const aid = url.includes('indland') ? '5534' : '3430';
      return new Response(`<!-- eplica-contentid 1-${aid}-MainContent --><div class="article box" data-aid="${aid}">Indland 1. október</div><hr class="stream" />`);
    }) as typeof fetch, attempts: 1 }))
      .rejects.toThrow(/tariff-key ZIP/);
  });

  test('fails closed on malformed source, tampered manifests and unsupported readers', async () => {
    const { bytes } = await fixtureBytes();
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file('acquisition.json')!.async('text'));

    manifest.acquisition_version = 'skatturinn-tollskrarlyklar-acquisition-v1';
    zip.file('acquisition.json', JSON.stringify(manifest), { date: new Date('1980-01-01T00:00:00.000Z') });
    const legacy = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    await expect(readIcelandAuthorityBundle({ bytes: legacy, release_identifier: RELEASE })).resolves.toMatchObject({ release_identifier: RELEASE });

    manifest.artifacts[0].sha256 = '0'.repeat(64);
    zip.file('acquisition.json', JSON.stringify(manifest), { date: new Date('1980-01-01T00:00:00.000Z') });
    const tampered = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    await expect(readIcelandAuthorityBundle({ bytes: tampered, release_identifier: RELEASE })).rejects.toEqual(expect.objectContaining<Partial<IcelandBundleError>>({ code: 'artifact_hash_mismatch' }));
    expect(() => readIcelandAuthorityRelease({ bytes, release_identifier: RELEASE, reader_version: 'future-reader' })).toThrow(expect.objectContaining({ code: 'unsupported_reader_version' }));
  });
  test("accepts Skatturinn's later entry naming only for the release's own effective date", async () => {
    const october = await fixtureBytes('fixture', { entry_name: 'TollskIP20261001.txt', release_identifier: '2026-10-01' });
    await expect(readIcelandAuthorityBundle({ bytes: october.bytes, release_identifier: '2026-10-01' })).resolves.toMatchObject({ release_identifier: '2026-10-01' });
    const reissue = await fixtureBytes('fixture', { entry_name: 'TollskIR20260901A.txt' });
    await expect(readIcelandAuthorityBundle({ bytes: reissue.bytes, release_identifier: RELEASE })).resolves.toMatchObject({ release_identifier: RELEASE });

    for (const entry_name of ['TollskIP20261001.txt', 'Tollsk20260901.csv', 'TollskIPX20260901.txt', 'Tollsk20260901AB.txt', 'other.txt']) {
      const { bytes } = await fixtureBytes('fixture', { entry_name });
      await expect(readIcelandAuthorityBundle({ bytes, release_identifier: RELEASE })).rejects.toEqual(expect.objectContaining<Partial<IcelandBundleError>>({ code: 'unexpected_tariff_key_manifest' }));
    }
  });
});

describe('Iceland duty, preference and classification semantics', () => {
  test('keeps ad-valorem, legal zero, specific and compound duties distinct', async () => {
    const { bundle } = await parsed();
    const common = { bundle, release_id: 'is-release', release_reference_date: new Date(`${RELEASE}T00:00:00Z`), retrieved_at: AT, at: AT };
    const adValorem = buildIcelandMarketAccess({ ...common, hs6: '610910' });
    expect(adValorem.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 10 });
    expect(adValorem.india_preference).toMatchObject({ applicability: 'potentially_applicable_requires_origin_proof', geographic_area_id: 'YX' });
    expect(adValorem.requirements.map((item) => item.requirement_code)).toEqual(expect.arrayContaining(['TKR', 'MST', 'KGM', 'NET_WEIGHT']));
    expect(adValorem.lines.find((item) => item.measure_kind === 'other')?.duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 2.5 });

    const specific = buildIcelandMarketAccess({ ...common, hs6: '293399' });
    expect(specific.general_duty).toMatchObject({ kind: 'specific', specific_amount: 12.5, specific_currency: 'ISK', specific_unit: 'piece', ad_valorem_rate_percent: null });
    const compound = buildIcelandMarketAccess({ ...common, hs6: '020110' });
    expect(compound.general_duty).toMatchObject({ kind: 'compound', ad_valorem_rate_percent: 30, specific_amount: 357, specific_currency: 'ISK' });
    expect(compound.general_duty?.note).toMatch(/neither is converted/);
  });

  test('preserves national-line ambiguity, observed zero, effective date and regulatory incompleteness', async () => {
    const { bundle } = await parsed();
    const common = { bundle, release_id: 'is-release', release_reference_date: new Date(`${RELEASE}T00:00:00Z`), retrieved_at: AT };
    const current = buildIcelandMarketAccess({ ...common, hs6: '100630', at: AT });
    expect(current.resolution.resolution).toBe('classification_refinement_required');
    expect(current.general_duty).toBeNull();
    expect(current.regulatory_coverage_complete).toBe(false);
    expect(current.lines.find((item) => item.national_tariff_code === '10063001' && item.measure_kind === 'third_country_duty')?.duty)
      .toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    const before = buildIcelandMarketAccess({ ...common, hs6: '610910', at: new Date('2026-08-31T23:59:59.999Z') });
    expect(before.resolution.resolution).toBe('unavailable');
    expect(before.lines).toEqual([]);
    const missing = buildIcelandMarketAccess({ ...common, hs6: '999999', at: AT });
    expect(missing.general_duty).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(missing.general_duty?.note).toMatch(/not reported as zero/);
  });

  test('is a real routed provider, no longer an unconfigured-source blocker', () => {
    expect(DESTINATION_ADAPTERS.IS?.provider_key).toBe('is_skatturinn_tollskrarlyklar');
    expect(unconfiguredSourceForCountry('IS')).toBeNull();
  });
});

describe('Iceland immutable replay', () => {
  test('imports idempotently and reparses retained bytes idempotently', async () => {
    const { bytes } = await fixtureBytes();
    const user = await prisma.user.create({ data: { email: `iceland-pack-${Date.now()}@cleartrade.test`, name: 'Iceland Pack Test', role: UserRole.admin } });
    const actor: Principal = { id: user.id, email: user.email, name: user.name, role: user.role, exporter_org_id: null, tier: OrgTier.paid };
    const args = { actor, bytes, release_identifier: RELEASE, reference_date: new Date(`${RELEASE}T00:00:00Z`), retrieved_at: AT, source_url: ICELAND_KEYS_URL, correlation_id: `is-${Date.now()}` };
    const first = await importIcelandRelease(args);
    const second = await importIcelandRelease({ ...args, correlation_id: `${args.correlation_id}-repeat` });
    expect(second.created).toBe(false);
    expect(second.release.id).toBe(first.release.id);
    expect(first.release).toMatchObject({ reader_version: ICELAND_BUNDLE_READER_VERSION, parser_version: 'skatturinn-tollskrarlyklar-parser-v1' });
    const replay = { actor, release_id: first.release.id, hs6: '610910', parser_version: first.release.parser_version, now: AT };
    const one = await reparseIcelandAuthorityRelease({ ...replay, correlation_id: `reparse-${Date.now()}` });
    const two = await reparseIcelandAuthorityRelease({ ...replay, correlation_id: `reparse-${Date.now()}-repeat` });
    expect(two.id).toBe(one.id);
  });
});
