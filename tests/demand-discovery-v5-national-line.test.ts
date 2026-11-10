import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { V5Breakdown } from '../src/app/app/markets/[marketAssessmentId]/V5Breakdown';
import { v5Detail } from '@/lib/demand-discovery-v5/detail';
import { EvidenceCompletenessStatus, EvidenceOrigin, OrgTier, ProductClassificationMethod, ProductClassificationStatus, UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { answersNamedIn, type CandidateLine } from '@/lib/market-access/classification-refinement';
import { chooseNationalLines, currentCandidates } from '@/lib/demand-discovery-v5/national-line';
import { resolveChosenLineDuty } from '@/lib/demand-discovery-v5/official-duty';
import { officialDuties } from '@/lib/demand-discovery-v5/run-inputs';
import { dutyInputs } from '@/lib/demand-discovery-v5/duty-inputs';
import { scoreDuty } from '@/lib/demand-discovery-v5/metrics';
import { metricSentence } from '@/lib/demand-discovery-v5/explain';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY as POLICY } from '@/lib/demand-discovery-v5/policy';
import { refreshReasons, type RefreshState } from '@/lib/demand-discovery-v5/refresh';
import { answerClassificationQuestions } from '@/lib/country-discovery/service';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '@/types';

/**
 * D-045 (owner, 10 Nov 2026: "Description, then a question"). Where a market's tariff splits the
 * product's HS6 into national lines with different duties, the answers on file choose the line, then
 * the product's own words; the chosen line's official duty is scored. Otherwise the market keeps its
 * estimate and names the question that settles it, and answering it re-runs the product.
 */

const line = (code: string, description: string, duty: string, kind: string, path: string[] = []): CandidateLine => ({
  national_tariff_code: code, description, description_path: path, duty_expression: duty, duty_kind: kind,
});
/** The United States' 1006.30 as USITC publishes it: parboiled 11.2%, everything else 1.4¢/kg. */
const US_RICE = [line('1006301000', 'Parboiled', '11.2%', 'ad_valorem'), line('1006309000', 'Other', '1.4¢/kg', 'specific')];
/** A UK-like split: Basmati lines at one duty, every other line at another. */
const UK_RICE = [
  line('1006302712', 'Basmati rice', '40.00 GBP / 1000 kg', 'specific', ['Semi-milled rice', 'Parboiled', 'Long grain', 'Aromatic rice']),
  line('1006309672', 'Basmati rice', '40.00 GBP / 1000 kg', 'specific', ['Wholly milled rice', 'Long grain', 'Aromatic rice']),
  line('1006302190', 'Other', '121.00 GBP / 1000 kg', 'specific', ['Semi-milled rice', 'Parboiled', 'Round grain']),
  line('1006309692', 'Other', '121.00 GBP / 1000 kg', 'specific', ['Wholly milled rice', 'Long grain']),
];

describe('which national line', () => {
  test('the product’s own words answer what they state, and nothing they leave unsaid', () => {
    expect(answersNamedIn('Basmati rice 1121')).toEqual({ basmati: 'yes' });
    expect(answersNamedIn('Non-basmati long grain rice, not parboiled')).toEqual({ basmati: 'no', parboiled: 'no', grain_length: 'yes' });
    // Said both ways: left unanswered.
    expect(answersNamedIn('Parboiled rice (also sold not parboiled)')).toEqual({});
    expect(answersNamedIn('')).toEqual({});
  });

  test('the trade’s own words count: "sella" is parboiled, "semi-milled" is not wholly milled', () => {
    // Production, 10 Nov 2026: Lappu Exports' product, whose US line stayed open on "Is the rice parboiled?".
    expect(answersNamedIn('Basmati rice, 1121 sella, semi-milled')).toEqual({ parboiled: 'yes', basmati: 'yes', wholly_milled: 'no' });
    expect(answersNamedIn('1121 Golden Sella Basmati')).toEqual({ parboiled: 'yes', basmati: 'yes' });
    expect(answersNamedIn('Semi milled rice')).toEqual({ wholly_milled: 'no' });
    // The HS heading says both: nothing is answered. "Not semi-milled" does not say wholly milled.
    expect(answersNamedIn('Semi-milled or wholly milled rice, whether or not polished or glazed')).toEqual({});
    expect(answersNamedIn('Rice, not semi-milled')).toEqual({});
    // Stated both ways across the trade word and the plain one: unanswered.
    expect(answersNamedIn('1121 sella, not parboiled')).toEqual({});
    // Only the product's words are read: official lines are never matched on the trade word.
    expect(chooseNationalLines({ candidates: US_RICE, product_text: 'Basmati rice, 1121 sella, semi-milled' }))
      .toMatchObject({ status: 'chosen', choice: { basis: 'description', codes: ['1006301000'], from_description: { parboiled: 'yes' }, from_answers: {} } });
    // The exporter's answer still comes first.
    expect(chooseNationalLines({ candidates: US_RICE, product_text: '1121 sella', answers: { parboiled: 'no' } }))
      .toMatchObject({ status: 'chosen', choice: { basis: 'answers', codes: ['1006309000'] } });
  });

  test('one duty on every line settles it before any question', () => {
    const same = UK_RICE.map((candidate) => ({ ...candidate, duty_expression: '121.00 GBP / 1000 kg' }));
    expect(chooseNationalLines({ candidates: same, product_text: 'Rice' })).toMatchObject({ status: 'chosen', choice: { basis: 'one_duty', codes: same.map((c) => c.national_tariff_code).sort() } });
  });

  test('the description settles a line it names; it never answers what it does not say', () => {
    const uk = chooseNationalLines({ candidates: UK_RICE, product_text: 'Basmati rice 1121. Basmati rice' });
    expect(uk).toMatchObject({ status: 'chosen', choice: { basis: 'description', codes: ['1006302712', '1006309672'], from_description: { basmati: 'yes' }, from_answers: {} } });
    // "Basmati rice" says nothing about parboiling, and US lines split only on that: the question stays.
    expect(chooseNationalLines({ candidates: US_RICE, product_text: 'Basmati rice' })).toEqual({ status: 'open', remaining: US_RICE, question: 'Is the rice parboiled?', questions: 1 });
    expect(chooseNationalLines({ candidates: US_RICE, product_text: 'Basmati rice, not parboiled' })).toMatchObject({ status: 'chosen', choice: { basis: 'description', codes: ['1006309000'] } });
  });

  test('answers on file come first, and settle what the words cannot', () => {
    expect(chooseNationalLines({ candidates: US_RICE, product_text: 'Basmati rice', answers: { parboiled: 'no' } })).toMatchObject({ status: 'chosen', choice: { basis: 'answers', codes: ['1006309000'], from_answers: { parboiled: 'no' } } });
    // The exporter says it is not Basmati, whatever the name says.
    expect(chooseNationalLines({ candidates: UK_RICE, product_text: 'Basmati rice', answers: { basmati: 'no' } })).toMatchObject({ status: 'chosen', choice: { basis: 'answers', codes: ['1006302190', '1006309692'] } });
    // An answer that would leave nothing is ignored, as on the questions page.
    expect(chooseNationalLines({ candidates: US_RICE, product_text: '', answers: { organic: 'yes', parboiled: 'maybe' } })).toMatchObject({ status: 'open' });
  });

  test('a line out of force is not a candidate', () => {
    const asOf = new Date('2026-11-10T00:00:00Z');
    expect(currentCandidates([{ ...US_RICE[0]!, effective_to: '2026-07-01T00:00:00.000Z' }, US_RICE[1]!], asOf).map((c) => c.national_tariff_code)).toEqual(['1006309000']);
    expect(currentCandidates([{ ...US_RICE[0]!, effective_from: '2027-01-01T00:00:00.000Z' }], asOf)).toEqual([]);
  });

  test('the chosen line’s official duty, with India’s own preference scored when it is not a quota', () => {
    const usd = (currency: string) => (currency === 'USD' ? 1 : currency === 'GBP' ? 1.25 : null);
    const choice = { basis: 'answers' as const, codes: ['1006309000'], from_answers: { parboiled: 'no' }, from_description: {} };
    expect(resolveChosenLineDuty({ lines: [US_RICE[1]!], choice, source_authority: 'USITC HTS', snapshot_id: 's1', india_preference: null, usd_per_unit: usd }))
      .toMatchObject({ status: 'specific', usd_per_kg: expect.closeTo(0.014, 12), expression: '1.4¢/kg', basis: 'standard', national_line: '1006309000', source: 'USITC HTS 1006309000', line_choice: choice, snapshot_ids: ['s1'] });
    const basmati = { basis: 'description' as const, codes: ['1006302712', '1006309672'], from_answers: {}, from_description: { basmati: 'yes' } };
    const preferred = resolveChosenLineDuty({ lines: UK_RICE.slice(0, 2), choice: basmati, source_authority: 'UK Trade Tariff', snapshot_id: 's2', india_preference: { duty_expression: '0.00%', is_quota: false }, usd_per_unit: usd, score_india_preference: true });
    expect(preferred).toMatchObject({ status: 'percent', duty_percent: 0, basis: 'india_preference', national_line: null, standard: { duty_percent: null, expression: '40.00 GBP / 1000 kg' }, preference: { applicability: 'potentially_applicable_requires_origin_proof', percent: 0 } });
    // A quota is said, never scored: the ordinary rate stands.
    expect(resolveChosenLineDuty({ lines: UK_RICE.slice(0, 2), choice: basmati, source_authority: 'UK Trade Tariff', snapshot_id: 's2', india_preference: { duty_expression: '0.00%', is_quota: true }, usd_per_unit: usd, score_india_preference: true }))
      .toMatchObject({ status: 'specific', usd_per_kg: 0.05, basis: 'standard', preference: { quota: true } });
  });

  test('the duty measure says how the line was chosen, and an open split names its question', () => {
    const official = new Map([['US', resolveChosenLineDuty({ lines: [US_RICE[1]!], choice: { basis: 'answers', codes: ['1006309000'], from_answers: { parboiled: 'no' }, from_description: {} }, source_authority: 'USITC HTS', snapshot_id: 's1', india_preference: null, usd_per_unit: () => 1 })],
      ['GB', { status: 'none' as const, reason: 'splits', line_question: 'Is the rice parboiled?' }]]);
    const inputs = dutyInputs({ markets: ['US', 'GB'], hs6: '100630', as_of: new Date('2026-11-10T00:00:00Z'), official, primary_tariffs: new Map([['GB', { value: 3.2, year: 2022 }]]), manufactured_tariffs: new Map(), agreements: [], policy: POLICY });
    const us = scoreDuty(inputs.get('US')!, POLICY, { official: 1, estimate: 0.5 }, 1.4);
    expect(us.inputs).toMatchObject({ basis: 'official', line_choice: 'answers', national_line: '1006309000', national_lines: 1 });
    expect(metricSentence(us)).toBe("Duty on Indian goods is about 1% (1.4¢/kg at this market's prices) on the tariff line the answers about the goods point to.");
    const gb = scoreDuty(inputs.get('GB')!, POLICY, { official: 1, estimate: 0.5 });
    expect(gb).toMatchObject({ estimated: true, inputs: { basis: 'estimate', line_question: 'Is the rice parboiled?' } });
  });

  test('the market page asks the open question where it can be answered', () => {
    const detail = v5Detail({
      model_version: 'market-opportunity-v5', market_status: 'ranked', rank: 2, overall_score: 80, confidence_score: 70, live_points: 100, data_year: 2024,
      labels: [], reasons: [], flag_reasons: [], handed_off: true, as_of_date: new Date('2026-11-10T13:49:00Z'),
      score_breakdown: { parts: [{ part: 'access', points: 20, live_points: 20, score: 80 }], metrics: [{ key: 'duty', score: 94, quality: 0.5, reason: null, estimated: true, inputs: { basis: 'estimate', duty_percent: 1.6, sector_average_percent: 3.2, sector_average_year: 2022, agreement_scope: 'comprehensive', agreement: 'India–UK CETA', line_question: 'Is the rice parboiled?' } }] },
    }, 217)!;
    const member = renderToStaticMarkup(createElement(V5Breakdown, { detail, tariffLineHref: '/app/products/p1/markets/GB/classification' }));
    expect(member).toContain('The official tariff splits this product&#x27;s code into lines with different duties here, so the duty is estimated.');
    expect(member).toContain('href="/app/products/p1/markets/GB/classification"');
    expect(member).toContain('Answer “Is the rice parboiled?”');
    // Without a place to answer (the agent's control table), it still says what would settle it.
    expect(renderToStaticMarkup(createElement(V5Breakdown, { detail }))).toContain('Answering “Is the rice parboiled?”');
  });

  test('an answer recorded after a run that kept a split estimate re-runs the product', () => {
    const state: RefreshState = {
      baci: { HS17: null, HS22: null }, reference: new Map(), tariff_releases: [],
      tariff_line_answers: new Map([['p1', [{ country: 'US', recorded_at: new Date('2026-11-10T12:00:00Z') }, { country: 'DE', recorded_at: new Date('2026-11-10T12:00:00Z') }]]]),
    };
    const frozen = { official_duty: { markets: {
      US: { status: 'none', reason: "This HS6 splits into national lines with different duties in this market; the official duty needs the product's declarable line." },
      DE: { status: 'percent', duty_percent: 0 },
    } } };
    const asOf = new Date('2026-11-10T10:00:00Z');
    expect(refreshReasons({ frozen_inputs: frozen, as_of: asOf, product_id: 'p1' }, state)).toEqual(['Tariff-line answers recorded since the run: US.']);
    expect(refreshReasons({ frozen_inputs: frozen, as_of: new Date('2026-11-10T13:00:00Z'), product_id: 'p1' }, state)).toEqual([]);
    expect(refreshReasons({ frozen_inputs: frozen, as_of: asOf, product_id: 'p2' }, state)).toEqual([]);
  });
});

describe('a run reads split markets from stored evidence', () => {
  const marker = `split-${randomUUID().slice(0, 8)}`;
  // Market-access evidence is shared and immutable, and other suites store 100630 snapshots; this
  // suite keys its candidates to an HS6 no other suite uses, so the newest snapshot is its own.
  const hs6 = '100119';
  /** The same lines, beneath this suite's HS6 (a refinement checks every candidate sits beneath it). */
  const rebase = (lines: CandidateLine[]) => lines.map((candidate) => ({ ...candidate, national_tariff_code: `${hs6}${candidate.national_tariff_code.slice(6)}` }));
  let agent: Principal;
  let orgId = '';
  let productId = '';
  const retrieved = new Date(Date.now() - 3_600_000);
  const usd = async (currency: string) => ({ rate: currency === 'GBP' ? 1.25 : currency === 'USD' ? 1 : null, frozen: { currency } });

  async function splitSnapshot(country: string, candidates: CandidateLine[], authority: string) {
    const snapshot = await prisma.marketAccessEvidenceSnapshot.create({ data: {
      jurisdiction: country, country_code: country, hs_code_scope: hs6, hs6_code: hs6, national_code_system: `${country}_TEST`,
      classification_resolution: 'classification_refinement_required', candidate_line_count: candidates.length,
      resolution_detail: { declarable_candidates: candidates.map((c) => ({ code: c.national_tariff_code, description: c.description, description_path: c.description_path ?? [], duty: c.duty_expression, duty_kind: c.duty_kind, effective_from: null, effective_to: null })) },
      source_authority: authority, source_reference: `https://example.test/${marker}/${country}`, retrieved_at: retrieved,
      completeness_status: EvidenceCompletenessStatus.PARTIAL, tariff_coverage: false, regulatory_coverage: false, parser_version: 'test', evidence_origin: EvidenceOrigin.fixture, provider: `test_${country.toLowerCase()}`, raw_evidence: { marker },
    } });
    return snapshot.id;
  }

  beforeAll(async () => {
    const org = await prisma.exporterOrg.create({ data: { display_name: `${marker} exporter`, tier: OrgTier.paid } });
    const agentUser = await prisma.user.create({ data: { email: `${marker}-agent@example.test`, name: 'Agent', role: UserRole.agent } });
    await prisma.agentAssignment.create({ data: { agent_user_id: agentUser.id, exporter_org_id: org.id, status: 'active' } });
    agent = { id: agentUser.id, email: agentUser.email, name: 'Agent', role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid };
    orgId = org.id;
    const now = new Date();
    const product = await prisma.product.create({ data: {
      exporter_org_id: org.id, name: 'Basmati rice 1121', description: 'Basmati rice', hs_code: hs6, hs_nomenclature: 'HS', hs_nomenclature_version: 'HS2022',
      hs_classification_method: ProductClassificationMethod.exporter_supplied, hs_classification_status: ProductClassificationStatus.confirmed, hs_confirmed_by_id: agentUser.id, hs_confirmed_at: now, hs_classification_revision: 1,
    } });
    productId = product.id;
    await prisma.productClassification.create({ data: { product_id: product.id, revision: 1, hs6_code: hs6, nomenclature: 'HS', nomenclature_version: 'HS2022', method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: {}, evidence: {}, rationale: 'test', source_references: [], confidence: 0.99, status: ProductClassificationStatus.confirmed, proposed_by_id: agentUser.id, confirmed_by_id: agentUser.id, confirmed_at: now } });

    // Great Britain: the Basmati lines carry one duty, with India's own preference on each.
    const gb = await splitSnapshot('GB', rebase(UK_RICE), 'UK Trade Tariff');
    await prisma.marketAccessTariffLine.createMany({ data: [`${hs6}2712`, `${hs6}9672`].map((code) => ({
      snapshot_id: gb, jurisdiction: 'GB', country_code: 'GB', hs6_code: hs6, hs_revision: 'HS2022', national_tariff_code: code, national_code_system: 'GB_TEST', description: 'Basmati rice', declarable: true,
      measure_kind: 'tariff_preference', origin_geographic_area_id: 'IN', origin_scope: 'country', applies_to_origin_country: 'IN', duty_expression: '0.00%', duty_kind: 'ad_valorem', conditions: { excludes_india: false }, source_reference: `https://example.test/${marker}/GB#${code}`, raw_measure: {},
    })) });
    // The United States: parboiled or not, which "Basmati rice" does not say.
    await splitSnapshot('US', rebase(US_RICE), 'USITC HTS');
  });

  afterAll(() => prisma.$disconnect());

  const read = () => officialDuties({ markets: ['GB', 'US'], hs6, as_of: new Date(), exporter_org_id: orgId, hs_revision: 'HS2022', minimum_confidence: 50, usd, score_india_preference: true, product: { id: productId, text: 'Basmati rice 1121. Basmati rice' } });

  test('the description settles Great Britain; the United States asks its question until it is answered', async () => {
    const first = await read();
    expect(first.resolutions.get('GB')).toMatchObject({ status: 'percent', duty_percent: 0, basis: 'india_preference', standard: { expression: '40.00 GBP / 1000 kg' }, line_choice: { basis: 'description', codes: [`${hs6}2712`, `${hs6}9672`] } });
    expect(first.resolutions.get('US')).toMatchObject({ status: 'none', line_question: 'Is the rice parboiled?' });
    expect((first.frozen.markets as Record<string, unknown>).US).toMatchObject({ status: 'none', line_question: 'Is the rice parboiled?' });
    expect((first.frozen.markets as Record<string, unknown>).GB).toMatchObject({ status: 'percent', line_choice: { basis: 'description' } });
    expect(first.official_count).toBe(1);

    // The agent answers on the exporter's behalf; the next read uses the official duty.
    await answerClassificationQuestions({ actor: agent, exporter_org_id: orgId, product_id: productId, country_code: 'US', answers: { parboiled: 'no' }, correlation_id: randomUUID() });
    const second = await read();
    expect(second.resolutions.get('US')).toMatchObject({ status: 'specific', usd_per_kg: expect.closeTo(0.014, 12), national_line: `${hs6}9000`, basis: 'standard', line_choice: { basis: 'answers', from_answers: { parboiled: 'no' } } });
    expect(second.official_count).toBe(2);
  });
});
