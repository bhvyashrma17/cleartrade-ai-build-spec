import { randomUUID } from 'node:crypto';
import { OrgTier, ProductClassificationMethod, ProductClassificationStatus, UserRole } from '@prisma/client';
import { afterAll, describe, expect, test } from 'vitest';
import {
  currentRefinement,
  deriveRefinementQuestions,
  narrowCandidates,
  recordClassificationRefinement,
  type CandidateLine,
} from '../src/lib/market-access/classification-refinement';
import { prisma } from '../src/lib/prisma';

afterAll(() => prisma.$disconnect());

/** The real UK shape: one Basmati line among packing-size and grain-length siblings. */
const UK_CANDIDATES: CandidateLine[] = [
  { national_tariff_code: '1006302110', description: 'In immediate packings of a net content not exceeding 5 kg', description_path: ['Semi-milled rice', 'Parboiled', 'Round grain'], duty_expression: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
  { national_tariff_code: '1006302190', description: 'Other', description_path: ['Semi-milled rice', 'Parboiled', 'Round grain'], duty_expression: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
  { national_tariff_code: '1006302712', description: 'Basmati rice', description_path: ['Semi-milled rice', 'Parboiled', 'Long grain', 'Aromatic rice', 'In immediate packings of a net content not exceeding 5 kg'], duty_expression: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
  { national_tariff_code: '1006309692', description: 'Other', description_path: ['Wholly milled rice', 'Long grain'], duty_expression: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
];

/** The real US shape: parboiled versus other, with genuinely different duties. */
const US_CANDIDATES: CandidateLine[] = [
  { national_tariff_code: '10063010', description: 'Parboiled', duty_expression: '11.2%', duty_kind: 'ad_valorem' },
  { national_tariff_code: '10063090', description: 'Other', duty_expression: '1.4¢/kg', duty_kind: 'specific' },
];

async function fixture(role: UserRole = UserRole.agent) {
  const marker = `refine-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const actor = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Actor', role } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Basmati' } });
  const now = new Date();
  await prisma.product.update({ where: { id: product.id }, data: { hs_code: '100630', hs_nomenclature: 'HS', hs_nomenclature_version: 'HS2022', hs_classification_method: ProductClassificationMethod.exporter_supplied, hs_classification_status: ProductClassificationStatus.confirmed, hs_confirmed_by_id: actor.id, hs_confirmed_at: now, hs_classification_revision: 1 } });
  const classification = await prisma.productClassification.create({ data: { product_id: product.id, revision: 1, hs6_code: '100630', nomenclature: 'HS', nomenclature_version: 'HS2022', method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: {}, evidence: {}, rationale: 'test', source_references: [], confidence: 0.99, status: ProductClassificationStatus.confirmed, proposed_by_id: actor.id, confirmed_by_id: actor.id, confirmed_at: now } });
  return { org, actor, product, classification, principal: { id: actor.id, role } };
}

const baseArgs = (f: Awaited<ReturnType<typeof fixture>>, over: Record<string, unknown> = {}) => ({
  actor: f.principal,
  exporter_org_id: f.org.id,
  product_id: f.product.id,
  product_classification_id: f.classification.id,
  destination_country: 'GB',
  national_code_system: 'UK_COMMODITY',
  source_authority: 'HMRC UK Integrated Online Tariff',
  source_reference: 'https://www.trade-tariff.service.gov.uk/uk/api/search?q=100630',
  candidates: UK_CANDIDATES,
  state: 'refinement_required' as const,
  ...over,
});

describe('minimal questions engine', () => {
  test('derives product questions from the candidate descriptions, not tariff nomenclature', () => {
    const questions = deriveRefinementQuestions(UK_CANDIDATES);
    const asked = questions.map((question) => question.attribute);
    // An exporter is asked about their rice, never asked to choose among 108 commodity codes.
    expect(asked).toContain('basmati');
    expect(asked).toContain('grain_length');
    expect(asked).toContain('wholly_milled');
    expect(questions.every((question) => question.origin === 'derived')).toBe(true);
    expect(questions.find((question) => question.attribute === 'basmati')!.question).toBe('Is this Basmati rice?');
  });

  test('mines the ancestor chain, not just the leaf description', () => {
    // Real UK leaves are mostly "Other"; the qualifiers that separate them ("Parboiled",
    // "Long grain", "Aromatic rice", "Wholly milled rice") live on the ancestors. Reading only
    // the leaf found no distinction and produced an unanswerable 108-candidate set.
    const leavesOnly = UK_CANDIDATES.map((line) => ({ ...line, description_path: undefined }));
    const fromLeaves = deriveRefinementQuestions(leavesOnly).map((question) => question.attribute);
    const fromAncestry = deriveRefinementQuestions(UK_CANDIDATES).map((question) => question.attribute);
    expect(fromAncestry.length).toBeGreaterThan(fromLeaves.length);
    for (const attribute of ['grain_length', 'wholly_milled', 'aromatic']) {
      expect(fromLeaves).not.toContain(attribute);
      expect(fromAncestry).toContain(attribute);
    }
  });

  test('never asks a question the candidates do not actually distinguish', () => {
    const questions = deriveRefinementQuestions(UK_CANDIDATES).map((question) => question.attribute);
    // Every UK candidate here is parboiled or inherits it, and none mentions organic, so neither
    // question can separate them and neither is asked.
    expect(questions).not.toContain('organic');
    // A single candidate needs no questions at all.
    expect(deriveRefinementQuestions([UK_CANDIDATES[0]!])).toHaveLength(0);
  });

  test('the US candidate set produces exactly the parboiled question', () => {
    const questions = deriveRefinementQuestions(US_CANDIDATES);
    expect(questions.map((question) => question.attribute)).toEqual(['parboiled']);
    expect(questions[0]!.options.find((option) => option.value === 'yes')!.keeps_codes).toEqual(['10063010']);
    expect(questions[0]!.options.find((option) => option.value === 'no')!.keeps_codes).toEqual(['10063090']);
  });

  test('answers narrow the set and a single survivor is reported, not selected', () => {
    const narrowed = narrowCandidates(UK_CANDIDATES, { basmati: 'yes' });
    expect(narrowed.remaining.map((line) => line.national_tariff_code)).toEqual(['1006302712']);
    expect(narrowed.determined_code).toBe('1006302712');
    expect(narrowed.outstanding_questions).toHaveLength(0);
    expect(narrowed.applied).toEqual([{ attribute: 'basmati', answer: 'yes', remaining_after: 1 }]);
  });

  test('an unknown answer leaves the set intact and keeps asking', () => {
    const narrowed = narrowCandidates(UK_CANDIDATES, { basmati: undefined, organic: 'yes' });
    expect(narrowed.remaining).toHaveLength(4);
    expect(narrowed.determined_code).toBeNull();
    expect(narrowed.outstanding_questions.length).toBeGreaterThan(0);
  });

  test('an answer that would eliminate every candidate is not applied', () => {
    // No US candidate is Basmati; answering "yes" must not empty the set.
    const narrowed = narrowCandidates(US_CANDIDATES, { basmati: 'yes' });
    expect(narrowed.remaining).toHaveLength(2);
    expect(narrowed.determined_code).toBeNull();
  });
});

describe('recording a refinement', () => {
  test('records the candidate set and its questions without choosing a line', async () => {
    const f = await fixture();
    const record = await recordClassificationRefinement(baseArgs(f));
    expect(record).toMatchObject({ state: 'refinement_required', selected_national_code: null, candidate_count: 4, hs6_code: '100630', destination_country: 'GB' });
    const questions = record.outstanding_questions as Array<{ attribute: string }>;
    expect(questions.map((question) => question.attribute)).toContain('basmati');
  });

  test('a client cannot inject a tariff code the authority did not return', async () => {
    const f = await fixture();
    await expect(recordClassificationRefinement(baseArgs(f, { state: 'agent_verified_selection', selected_national_code: '1006309999', selection_rationale: 'because' })))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ code: 'not_a_candidate' })] });
  });

  test('a selected line must sit beneath the frozen HS6 and be a national line', async () => {
    const f = await fixture();
    await expect(recordClassificationRefinement(baseArgs(f, { candidates: [{ national_tariff_code: '1006401010', description: 'Broken rice', duty_expression: '0%', duty_kind: 'ad_valorem' }] })))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ message: expect.stringContaining('does not sit beneath HS6 100630') })] });
    // The HS6 itself is not a declarable line.
    await expect(recordClassificationRefinement(baseArgs(f, { candidates: [{ national_tariff_code: '100630', description: 'Rice', duty_expression: '0%', duty_kind: 'ad_valorem' }] })))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ message: expect.stringContaining('not the HS6 itself') })] });
  });

  test('an exporter cannot file an agent-verified selection', async () => {
    const f = await fixture(UserRole.exporter_owner);
    await expect(recordClassificationRefinement(baseArgs(f, { state: 'agent_verified_selection', selected_national_code: '1006302712', selection_rationale: 'It is Basmati.' })))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The same exporter may declare its own selection, which is recorded as exporter_declared.
    const declared = await recordClassificationRefinement(baseArgs(f, { state: 'exporter_declared_selection', selected_national_code: '1006302712', selection_rationale: 'Our rice is Basmati, long grain, aromatic.' }));
    expect(declared).toMatchObject({ state: 'exporter_declared_selection', assertion_class: 'exporter_declared', selected_national_code: '1006302712' });
    expect(declared.decided_by_id).toBe(f.actor.id);
  });

  test('a selection must record why, and a non-selection may not carry a line', async () => {
    const f = await fixture();
    await expect(recordClassificationRefinement(baseArgs(f, { state: 'agent_verified_selection', selected_national_code: '1006302712' })))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ field: 'selection_rationale' })] });
    await expect(recordClassificationRefinement(baseArgs(f, { state: 'refinement_required', selected_national_code: '1006302712' })))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ field: 'selected_national_code' })] });
  });

  test('an expired candidate line cannot be selected', async () => {
    const f = await fixture();
    const expired = [{ ...UK_CANDIDATES[2]!, effective_to: '2026-01-01T00:00:00.000Z' }];
    await expect(recordClassificationRefinement(baseArgs(f, { candidates: expired, state: 'agent_verified_selection', selected_national_code: '1006302712', selection_rationale: 'Basmati.' })))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ code: 'expired' })] });
  });

  test('a refinement for another tenant\'s classification is refused', async () => {
    const owner = await fixture();
    const other = await fixture();
    await expect(recordClassificationRefinement(baseArgs(owner, { exporter_org_id: other.org.id })))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ code: 'mismatch' })] });
  });

  test('a revision supersedes rather than rewrites, and history stays readable', async () => {
    const f = await fixture();
    const first = await recordClassificationRefinement(baseArgs(f));
    const second = await recordClassificationRefinement(baseArgs(f, { state: 'agent_verified_selection', selected_national_code: '1006302712', selection_rationale: 'Confirmed Basmati against the certificate of origin.' }));

    const original = await prisma.productClassificationRefinement.findUniqueOrThrow({ where: { id: first.id } });
    expect(original.state).toBe('refinement_required');
    expect(original.selected_national_code).toBeNull();
    expect(original.superseded_by_id).toBe(second.id);
    expect(original.superseded_at).not.toBeNull();

    // The database refuses to rewrite what a past assessment may have cited.
    await expect(prisma.productClassificationRefinement.update({ where: { id: first.id }, data: { selected_national_code: '1006302110' } })).rejects.toThrow(/immutable/);
    await expect(prisma.productClassificationRefinement.delete({ where: { id: first.id } })).rejects.toThrow(/immutable/);
  });

  test('the refinement in force is resolved at a frozen clock', async () => {
    const f = await fixture();
    const first = await recordClassificationRefinement(baseArgs(f));
    const beforeSecond = new Date();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await recordClassificationRefinement(baseArgs(f, { state: 'agent_verified_selection', selected_national_code: '1006302712', selection_rationale: 'Confirmed Basmati.' }));

    // An assessment frozen before the revision still sees the state it was frozen against.
    expect((await currentRefinement({ product_id: f.product.id, destination_country: 'GB', as_of: beforeSecond }))?.id).toBe(first.id);
    expect((await currentRefinement({ product_id: f.product.id, destination_country: 'GB', as_of: new Date() }))?.id).toBe(second.id);
  });

  test('an agent may attach a curated question the taxonomy could not derive', async () => {
    const f = await fixture();
    const record = await recordClassificationRefinement(baseArgs(f, {
      curated_questions: [{ key: 'milling_degree_certificate', question: 'Does your mill certificate state the degree of milling?', attribute: 'milling_degree_certificate', origin: 'derived', options: [{ value: 'yes', label: 'Yes', keeps_codes: ['1006302712'] }, { value: 'no', label: 'No', keeps_codes: ['1006309692'] }] }],
    }));
    const questions = record.outstanding_questions as Array<{ attribute: string; origin: string; authored_by_id: string | null }>;
    const curated = questions.find((question) => question.attribute === 'milling_degree_certificate')!;
    // A curated question carries its author; it is never presented as machine-derived.
    expect(curated.origin).toBe('curated');
    expect(curated.authored_by_id).toBe(f.actor.id);
  });
});
