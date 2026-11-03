import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { DESTINATION_ADAPTERS } from '../src/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '../src/lib/market-access/unconfigured-sources';
import { __test__ as acquisition, acquireVietnamAuthorityBundle, vietnamOfficialUrl } from '../src/lib/market-access/providers/vietnam-acquisition';
import {
  parseVietnamAifta,
  parseVietnamDuty,
  parseVietnamRateTable,
  readVietnamAuthorityBundle,
  VIETNAM_BUNDLE_READER_VERSION,
  VIETNAM_EXPECTED_AIFTA_ENTRIES,
  VIETNAM_EXPECTED_SECTION_I_LINES,
  VIETNAM_PARSER_VERSION,
  type VietnamAiftaLine,
  type VietnamAuthorityBundle,
  type VietnamPage,
  type VietnamRateVersion,
  type VietnamTariffLine,
} from '../src/lib/market-access/providers/vietnam-bundle';
import { VIETNAM_TRAV_REVIEWED_MEASURE_NOTICES } from '../src/lib/market-access/providers/vietnam-evidence';
import { buildVietnamMarketAccess, replayVietnamTariff } from '../src/lib/market-access/providers/vietnam-parser';
import { VIETNAM_TRADE_REMEDY_MANIFEST, validateVietnamRemedyManifest, type VietnamTradeRemedyManifest } from '../src/lib/market-access/providers/vietnam-remedies';

const FUEL = 'Decree 72/2026/NĐ-CP, extended by Resolutions 25/2026/NQ-CP and 34/2026/NQ-CP';
const line = (code: string, base: string, extra: Partial<VietnamTariffLine> = {}): VietnamTariffLine => ({ code, description: `line ${code}`, base_expression: base, versions: [], import_condition: null, out_of_quota_expression: null, used_vehicle_annex_iii: false, ...extra });
const version = (from: string, expression: string, until: string | null = null, instrument = 'Decree 73/2025/NĐ-CP'): VietnamRateVersion => ({ from, until, expression, instrument });
const aifta = (code: string, rate2026: string): VietnamAiftaLine => ({ code, rates: ['9', '8', '7', '6', rate2026, '0'] });

function fixture(): VietnamAuthorityBundle {
  const lines = [
    line('69072110', '20'), ...['21', '22', '23', '24'].map(suffix => line(`690721${suffix}`, '45')), ...['91', '92', '93', '94'].map(suffix => line(`690721${suffix}`, '35')),
    line('29054400', '5'), line('54023310', '3'), line('54023390', '3'),
    line('27101920', '7', { versions: [version('2026-03-09', '5', '2026-09-30', FUEL), version('2026-05-01', '0', '2026-09-30', 'Resolution 25/2026/NQ-CP art. 2')] }),
    line('04072100', '40', { out_of_quota_expression: '80' }),
    line('24041210', '50', { import_condition: 'Decree 144/2024 art. 2(2): permitted imports only.' }),
    line('87032210', '64', { used_vehicle_annex_iii: true }),
    line('72091810', '0', { versions: [version('2025-07-08', '0', null, 'Decree 199/2025/NĐ-CP'), version('2025-09-01', '7', null, 'Decree 199/2025/NĐ-CP')] }),
    line('84713020', '0'), line('17019990', '40'),
    line('87089999', 'Theo hướng dẫn tại điểm b.5.3 và b.5.4 khoản 2.2 Mục I Chương 98'), line('39011099', ''),
  ];
  return {
    checksum: 'fixture-sha256', size_bytes: 1, release_identifier: '2026-09-23', source_url: 'https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-26-2023-nd-cp-39522.htm', files: [],
    schedule_lines: new Map(lines.map(item => [item.code, item])),
    chapter98: [{ code: '98402500', description: '', corresponding_codes: ['27101920'], expression: '0', instrument: 'Decree 26/2023/NĐ-CP Annex II Section II' }],
    aifta: new Map([
      ...['69072110', '69072121', '69072122', '69072123', '69072124', '69072191', '69072192', '69072193', '69072194'].map(code => aifta(code, '5')),
      aifta('29054400', '0'), aifta('54023310', '*'), aifta('54023390', '*'), aifta('27101920', '*'), aifta('04072100', '*'), aifta('24041210', '*'), aifta('87032210', '*'),
      aifta('8471302010', '0'), aifta('8471302090', '5'), aifta('17019990', '30'),
    ].map(entry => [entry.code, entry])),
    remedies: VIETNAM_TRADE_REMEDY_MANIFEST, reader_version: VIETNAM_BUNDLE_READER_VERSION, parser_version: VIETNAM_PARSER_VERSION,
  };
}
const build = (hs6: string, at = '2026-09-23', origin = 'IN') => buildVietnamMarketAccess({ bundle: fixture(), release_id: 'release-1', release_reference_date: new Date('2026-09-23T00:00:00Z'), retrieved_at: new Date('2026-09-23T00:00:00Z'), hs6, at: new Date(`${at}T00:00:00Z`), origin_country: origin });
const item = (str: string, x: number, y: number, w = str.length * 5) => ({ str, x, y, w });
const page = (page_number: number, items: ReturnType<typeof item>[]): VietnamPage => ({ page_number, width: 595, height: 842, text: items.map(entry => entry.str).join(''), items });
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

describe('Vietnam authority pack', () => {
  test('parses published rates without inventing numbers; blank is never zero and Chapter 98 references stay non-declarable', () => {
    expect(parseVietnamDuty('0')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseVietnamDuty('12,5')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 12.5 });
    expect(parseVietnamDuty('')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(parseVietnamDuty('Theo hướng dẫn tại điểm 1.1 Chương 98')).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null, note: expect.stringMatching(/CKD/) });
    expect(parseVietnamDuty('5% hoặc 10.000 USD')).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null });
  });

  test('reads the code | description | rate table, skips national-note prose in the rate column and fails closed on unpaired rows', () => {
    const header = [item('Mã hàng', 60, 780), item('Mô tả hàng hóa', 140, 780), item('Thuế suất', 480, 786), item('(%)', 490, 772)];
    const rows = [
      item('0101.21.00', 60, 700), item('- - Loại thuần chủng', 140, 700), item('0', 492, 700),
      item('Chú giải: mặt hàng tại phân nhóm này áp dụng', 60, 660), item('5', 492, 660),
      item('0101.29', 60, 620), item('.00', 95, 620), item('- - Loại khác', 140, 620), item('Theo hướng dẫn tại điểm 1.1', 470, 626), item('Chương 98', 470, 614),
    ];
    const table = parseVietnamRateTable([page(1, [...header, ...rows])], { start: /Mã hàng/, stop: /$^/, label: 'fixture' });
    expect([...table].map(([code, row]) => [code, row.expression, row.description])).toEqual([['0101.21.00', '0', '- - Loại thuần chủng'], ['0101.29.00', 'Theo hướng dẫn tại điểm 1.1 Chương 98', '- - Loại khác']]);
    expect(() => parseVietnamRateTable([page(1, [...header, item('0101.21.00', 60, 700), item('x', 140, 700)])], { start: /Mã hàng/, stop: /$^/, label: 'fixture' })).toThrow(/has 1 codes but 0 rate cells/);
  });

  test('reads the AIFTA period columns by position and excludes parents published only as ten-digit sub-lines', () => {
    const heads = ['30/12/2022', '31/12/2022', '31/12/2023', '31/12/2024', '01/01/2026', '01/01/2027'].map((label, index) => item(label, 250 + index * 50, 780, 40));
    const cells = (y: number, values: string[]) => values.map((value, index) => item(value, 268 + index * 50, y, 4));
    const parsed = parseVietnamAifta([page(1, [...heads,
      item('0101.21.00', 60, 700), ...cells(700, ['5', '4', '3', '2', '1', '0']),
      item('8471.30.20', 60, 660),
      item('8471.30.20.10', 60, 640), ...cells(640, ['*', '*', '*', '*', '*', '*']),
      item('8471.30.20.90', 60, 620), ...cells(620, ['5', '5', '5', '5', '5', '5']),
    ])]);
    expect([...parsed.keys()]).toEqual(['01012100', '8471302010', '8471302090']);
    expect(parsed.get('01012100')?.rates).toEqual(['5', '4', '3', '2', '1', '0']);
    expect(() => parseVietnamAifta([page(1, [...heads, item('0101.21.00', 60, 700), ...cells(700, ['5', '4', '3', '2', '1'])])])).toThrow(/missing a period rate/);
  });

  test('replays phased and temporary amendments by date: temporary rates expire, future phases are not current', () => {
    const at = (day: string) => replayVietnamTariff(fixture(), new Date(`${day}T00:00:00Z`));
    expect(at('2023-07-14').size).toBe(0);
    expect(at('2025-08-01').get('72091810')).toMatchObject({ expression: '0', instrument: 'Decree 199/2025/NĐ-CP' });
    expect(at('2025-09-01').get('72091810')?.duty.ad_valorem_rate_percent).toBe(7);
    expect(at('2026-04-01').get('27101920')).toMatchObject({ expression: '5', effective_to: '2026-09-30', instrument: FUEL });
    expect(at('2026-09-30').get('27101920')).toMatchObject({ expression: '0', effective_to: '2026-09-30' });
    expect(at('2026-10-01').get('27101920')).toMatchObject({ expression: '7', effective_to: null, instrument: 'Decree 26/2023/NĐ-CP' });
    expect(at('2026-09-23').get('87089999')).toMatchObject({ declarable: false, duty: { kind: 'unparsed' } });
    expect(at('2026-09-23').get('39011099')).toMatchObject({ declarable: false, duty: { kind: 'none', ad_valorem_rate_percent: null } });
  });

  test('India ceramic tiles: AIFTA only with origin proof, and the 2174/QĐ-BCT duty is never selected from origin alone', () => {
    const result = build('690721');
    expect(result.resolution).toMatchObject({ resolution: 'classification_refinement_required', resolved_line: null });
    expect(result.india_preference).toMatchObject({ applicability: 'potentially_applicable_requires_origin_proof', duty: { ad_valorem_rate_percent: 5 } });
    const remedies = result.lines.filter(entry => entry.measure_kind === 'additional_duty');
    expect(remedies.map(entry => entry.national_tariff_code)).toEqual(['69072121', '69072122', '69072123', '69072124', '69072191', '69072192', '69072193', '69072194']);
    expect(remedies[0]).toMatchObject({ applies_to_origin_country: 'IN', duty: { kind: 'mixed', ad_valorem_rate_percent: null, expression: '5.55%–45.30% depending on producer/exporter' }, conditions: { producer_or_exporter_identity_required: true } });
    expect(remedies[0]!.duty.note).toMatch(/22\.27%.*5\.55%.*45\.30%.*18\.29%/);
    expect(result.requirements.map(entry => entry.requirement_code)).toEqual(['VN_TRADE_REMEDY_PRODUCER_EVIDENCE']);
    expect(result.raw_evidence).toMatchObject({ remedy_status: 'producer_refinement_required', tariff_treatment_complete: false });
    expect(result.regulatory_coverage_complete).toBe(false);
    expect(build('690721', '2026-09-21').lines.some(entry => entry.measure_kind === 'additional_duty')).toBe(false);
    expect(build('690721', '2026-09-23', 'CN').lines.some(entry => entry.measure_kind === 'additional_duty')).toBe(false);
    expect(build('690721', '2026-09-23', 'CN').india_preference).toMatchObject({ applicability: 'not_applicable' });
  });

  test('sorbitol carries one origin-wide India rate, and expired or unextended measures are never presumed to continue', () => {
    const sorbitol = build('290544').lines.find(entry => entry.measure_kind === 'additional_duty');
    expect(sorbitol).toMatchObject({ duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 52.75 }, conditions: { producer_or_exporter_identity_required: false } });
    expect(build('290544', '2026-11-23').lines.some(entry => entry.measure_kind === 'additional_duty')).toBe(false);
    expect(build('540233').lines.filter(entry => entry.measure_kind === 'additional_duty')).toHaveLength(1);
    expect(build('540233', '2026-10-16').lines.some(entry => entry.measure_kind === 'additional_duty')).toBe(false);
    expect(build('540233').india_preference).toMatchObject({ applicability: 'not_applicable', duty: null });
  });

  test('tariff quotas, conditional imports, used vehicles and Chapter 98 alternatives are never declared as the plain rate', () => {
    const eggs = build('040721');
    expect(eggs.general_duty?.ad_valorem_rate_percent).toBe(80);
    expect(eggs.lines.find(entry => entry.measure_kind === 'tariff_quota')).toMatchObject({ declarable: false, duty: { ad_valorem_rate_percent: 40 }, conditions: { quota_availability_not_established: true } });
    const vape = build('240412');
    expect(vape.resolution.resolved_line).toBeNull();
    expect(vape.requirements).toEqual([expect.objectContaining({ requirement_code: 'VN_IMPORT_PERMISSION_CONDITION', requirement_obtainable: false })]);
    expect(build('870322').lines.find(entry => entry.measure_kind === 'other')).toMatchObject({ declarable: false, duty: { kind: 'unparsed', ad_valorem_rate_percent: null } });
    expect(build('271019').lines.find(entry => entry.national_tariff_code === '98402500')).toMatchObject({ declarable: false, conditions: { chapter_98_criteria_must_be_met: true } });
  });

  test('AIFTA sub-lines with different rates leave the preferential duty unselected', () => {
    const result = build('847130');
    expect(result.lines.filter(entry => entry.measure_kind === 'tariff_preference').map(entry => entry.national_tariff_code)).toEqual(['8471302010', '8471302090']);
    expect(result.india_preference).toMatchObject({ applicability: 'potentially_applicable_requires_origin_proof', duty: null, basis: expect.stringMatching(/0, 5/) });
  });

  test('the remedy manifest refuses an India measure without a producer table, an origin without rates, or an incomplete enumeration', () => {
    expect(() => validateVietnamRemedyManifest(VIETNAM_TRADE_REMEDY_MANIFEST)).not.toThrow();
    const measures = VIETNAM_TRADE_REMEDY_MANIFEST.measures;
    const tiles = measures.find(measure => measure.case_code === 'AD23')!;
    expect(() => validateVietnamRemedyManifest({ ...VIETNAM_TRADE_REMEDY_MANIFEST, measures: [{ ...tiles, evidence_grade: 'published_range_confirmed' }] })).toThrow(/producer table/);
    expect(() => validateVietnamRemedyManifest({ ...VIETNAM_TRADE_REMEDY_MANIFEST, measures: [{ ...tiles, origin_countries: ['IN', 'CN'] }] })).toThrow(/every origin/);
    expect(() => validateVietnamRemedyManifest({ ...VIETNAM_TRADE_REMEDY_MANIFEST, register_enumeration_complete: false } as unknown as VietnamTradeRemedyManifest)).toThrow(/complete enumeration/);
    expect(VIETNAM_TRADE_REMEDY_MANIFEST.pending.find(entry => entry.case_code === 'AD24')).toMatchObject({ status: 'INVESTIGATION' });
    expect(measures.some(measure => measure.case_code === 'AD24')).toBe(false);
    expect(build('170199', '2026-09-23', 'TH').lines.find(entry => entry.measure_kind === 'additional_duty')?.duty.kind).toBe('mixed');
  });

  test('the bundle reader enforces identity, per-artifact hashes and complete schedules', async () => {
    const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const zipOf = async (manifest: Record<string, unknown>, normalized: Record<string, unknown>, tamper = false) => {
      const zip = new JSZip(), body = Buffer.from(JSON.stringify(normalized));
      zip.file('normalized.json', tamper ? Buffer.concat([body, Buffer.from(' ')]) : body);
      zip.file('acquisition.json', JSON.stringify({ ...manifest, artifacts: [{ name: 'normalized.json', role: 'normalized', size_bytes: body.length, sha256: sha(body) }] }));
      return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    };
    const manifest = { acquisition_version: 'vn-congbao-public-acquisition-v1', release_identifier: '2026-09-23', rights_evidence: { law_article: 'Vietnam Law on Intellectual Property article 15(2)' }, scope: { tariff_treatment_complete: true } };
    const code = (index: number) => String(10_000_000 + index);
    const normalized = {
      schedule_lines: Array.from({ length: VIETNAM_EXPECTED_SECTION_I_LINES }, (_, index) => line(code(index), '5')), chapter98: [],
      aifta: Array.from({ length: VIETNAM_EXPECTED_AIFTA_ENTRIES }, (_, index) => aifta(code(index), '0')), remedies: VIETNAM_TRADE_REMEDY_MANIFEST,
    };
    const bundle = await readVietnamAuthorityBundle({ bytes: await zipOf(manifest, normalized), release_identifier: '2026-09-23' });
    expect(bundle.schedule_lines.size).toBe(VIETNAM_EXPECTED_SECTION_I_LINES);
    await expect(readVietnamAuthorityBundle({ bytes: await zipOf(manifest, normalized, true), release_identifier: '2026-09-23' })).rejects.toMatchObject({ code: 'artifact_hash_mismatch' });
    await expect(readVietnamAuthorityBundle({ bytes: await zipOf({ ...manifest, rights_evidence: {} }, normalized), release_identifier: '2026-09-23' })).rejects.toMatchObject({ code: 'unexpected_acquisition' });
    await expect(readVietnamAuthorityBundle({ bytes: await zipOf(manifest, { ...normalized, schedule_lines: normalized.schedule_lines.slice(1) }), release_identifier: '2026-09-23' })).rejects.toMatchObject({ code: 'incomplete_schedule' });
  });

  test('accepts only allowlisted HTTPS authority hosts, pinned artifacts and whitespace-insensitive markers', () => {
    expect(vietnamOfficialUrl('https://congbaocdn.chinhphu.vn/x.pdf')).toBe('https://congbaocdn.chinhphu.vn/x.pdf');
    expect(() => vietnamOfficialUrl('http://congbao.chinhphu.vn/van-ban/x.htm')).toThrow(/rejects/);
    expect(() => vietnamOfficialUrl('https://www.customs.gov.vn/')).toThrow(/rejects www\.customs\.gov\.vn/);
    expect(() => acquisition.pinned('unknown.pdf', Buffer.from('x'), {})).toThrow(/no reviewed pin/);
    expect(() => acquisition.pinned('a.pdf', Buffer.from('x'), { 'a.pdf': { bytes: 1, sha256: '0'.repeat(64) } })).toThrow(/no longer matches/);
    expect(acquisition.phasedVersions('0%. Từ ngày 01/9/2025 áp dụng mức thuế suất 7%.', '2025-07-08', 'Decree 199/2025/NĐ-CP')).toEqual([version('2025-07-08', '0', null, 'Decree 199/2025/NĐ-CP'), version('2025-09-01', '7', null, 'Decree 199/2025/NĐ-CP')]);
    expect(() => acquisition.phasedVersions('0% hoặc theo quy định khác', '2025-07-08', 'x')).toThrow(/unrecognised rate cell/);
    expect(() => acquisition.requireMarkers('x', 'cácmặthàngcómãHS8543.40.00', ['các mặt hàng có mã HS 8543.40.00'])).not.toThrow();
    expect(() => acquisition.requireMarkers('x', 'khác', ['thuế xuất khẩu'])).toThrow(/no longer supports/);
  });

  test('the TRAV walk fails closed on an unreviewed measure notice and on a truncated stream', async () => {
    const reviewed = [...VIETNAM_TRAV_REVIEWED_MEASURE_NOTICES];
    const anchor = (id: string, title: string) => `<a href="./default.aspx?page=news-detail&do=detail&category_id=91b07cf1-3658-4f39-b688-73b9e8ff8a05&id=${id}">${title}</a>`;
    const stream = (pages: string[][]) => (async (input: RequestInfo | URL) => { const index = Number(/&p=(\d+)/.exec(String(input))?.[1]) - 1; return html(`<main>${pages[index]?.join('') ?? ''}</main>`); }) as typeof fetch;
    const known = reviewed.map(id => anchor(id, 'Bộ Công Thương áp dụng thuế chống bán phá giá chính thức đối với sản phẩm X'));
    const fresh = anchor('11111111-2222-3333-4444-555555555555', 'Bộ Công Thương áp dụng thuế chống bán phá giá chính thức đối với sản phẩm Y có xuất xứ từ Ấn Độ');
    await expect(acquisition.travEnumeration(stream([known.slice(0, 40), [...known.slice(40), fresh]]), 1)).rejects.toThrow(/not yet reviewed: .*sản phẩm Y/);
    await expect(acquisition.travEnumeration(stream([known.slice(0, 40)]), 1)).rejects.toThrow(/only 40 of 81/);
    await expect(acquisition.travEnumeration(stream([known.slice(0, 40), known.slice(40)]), 1)).resolves.toMatchObject({ measure_notices: 81 });
  });

  test('an unreviewed instrument in the official Decree 26/2023 search fails before any schedule is trusted', async () => {
    const form = '<form><input type="hidden" name="__VIEWSTATE" value="v" /><input name="ctrl$txtSearchKeyword" type="text" /><input type="submit" name="ctrl$btnSearch" value="Tìm kiếm" /><select name="ctrl$drdDocYear"><option value="0">All</option></select><select name="ctrl$drdRecordPerPage"><option value="20">20</option></select></form>';
    const results = ['208020', '211569', '212714', '213245', '213700', '214494', '215575', '217144', '217967', '218369', '219999'].map(id => `<a href="/?docid=${id}">${id === '219999' ? '999/2026/NĐ-CP sửa đổi Nghị định số 26/2023/NĐ-CP' : id}</a>`).join('');
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = new URLSearchParams(String(init.body));
        expect(body.get('ctrl$txtSearchKeyword')).toBe('26/2023/NĐ-CP');
        expect(body.get('ctrl$drdRecordPerPage')).toBe('200');
        return html(results);
      }
      return new Response(form, { headers: { 'content-type': 'text/html', 'set-cookie': 'ASP.NET_SessionId=abc; path=/' } });
    }) as typeof fetch;
    await expect(acquireVietnamAuthorityBundle({ fetch_impl: fetchImpl, attempts: 1 })).rejects.toThrow(/amendment chain changed.*999\/2026/);
    await expect(acquireVietnamAuthorityBundle({ release_identifier: '2026-09-24', fetch_impl: fetchImpl })).rejects.toThrow(/bounded 2026-09-23/);
  });

  test('routes VN to the Official Gazette provider and removes the stale unconfigured entry', () => {
    expect(DESTINATION_ADAPTERS.VN?.provider_key).toBe('vn_congbao_tariff');
    expect(unconfiguredSourceForCountry('VN')).toBeNull();
  });
});
