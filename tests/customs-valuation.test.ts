import { afterAll, describe, expect, test } from 'vitest';
import {
  CUSTOMS_VALUATION_REFERENCES,
  customsValuationReferenceFor,
  seedCustomsValuationEvidence,
} from '../src/lib/market-access/customs-valuation';
import { prisma } from '../src/lib/prisma';

afterAll(() => prisma.$disconnect());

describe('customs valuation basis', () => {
  test('the United States is FOB and the EU and UK are CIF, each from primary law', () => {
    expect(customsValuationReferenceFor('US')).toMatchObject({ basis: 'FOB', jurisdiction: 'US' });
    expect(customsValuationReferenceFor('DE')).toMatchObject({ basis: 'CIF', jurisdiction: 'EU' });
    expect(customsValuationReferenceFor('GB')).toMatchObject({ basis: 'CIF', jurisdiction: 'GB' });
    // The US is the reason this is a table and not a constant: assessing duty on a CIF value
    // there would tax freight and insurance the statute explicitly excludes.
    expect(customsValuationReferenceFor('US')!.excluded_components).toContain('international_freight');
    expect(customsValuationReferenceFor('US')!.excluded_components).toContain('insurance');
    expect(customsValuationReferenceFor('DE')!.included_components).toContain('international_freight');
  });

  test('Saudi Arabia stays unavailable because only commentary was reachable', () => {
    // The GCC Common Customs Law is the authority. Commercial commentary describing it is not
    // evidence, so no basis is encoded and the destination remains unknown.
    expect(customsValuationReferenceFor('SA')).toBeNull();
    expect(CUSTOMS_VALUATION_REFERENCES.some((entry) => entry.country_codes.includes('SA'))).toBe(false);
  });

  test('every encoded reference cites a source and states its verification grade', () => {
    for (const reference of CUSTOMS_VALUATION_REFERENCES) {
      expect(reference.source_authority.trim().length).toBeGreaterThan(0);
      expect(reference.source_reference).toMatch(/^https?:\/\//);
      expect(reference.source_version.trim().length).toBeGreaterThan(0);
      expect(reference.valuation_type).toBe('legal_customs_valuation');
      // Primary law is a strong source and still not a filed entry for this shipment.
      expect(reference.verification_grade).toBe('discovery_grade');
    }
  });

  test('Germany is covered by the EU reference rather than a German national rule', () => {
    const eu = customsValuationReferenceFor('DE')!;
    expect(eu.jurisdiction).toBe('EU');
    expect(eu.country_codes).toContain('FR');
    expect(eu.source_version).toMatch(/952\/2013/);
  });

  test('seeding is idempotent and records the legal type only', async () => {
    await seedCustomsValuationEvidence({ now: new Date('2026-08-31T00:00:00Z') });
    // Re-seeding never produces a rival statement of the same law, whichever caller got there
    // first — including a concurrent one.
    const second = await seedCustomsValuationEvidence({ now: new Date('2026-08-31T00:00:00Z') });
    expect(second.every((entry) => !entry.created)).toBe(true);
    expect(await prisma.customsValuationBasisEvidence.count({ where: { country_code: 'US', valuation_type: 'legal_customs_valuation' } })).toBe(1);

    const us = await prisma.customsValuationBasisEvidence.findFirst({ where: { country_code: 'US', valuation_type: 'legal_customs_valuation' } });
    expect(us).toMatchObject({ basis: 'FOB', status: 'verified', assertion_class: 'authoritative_public' });
    // The trade-statistical basis is a different question and is never written by this seed.
    expect(await prisma.customsValuationBasisEvidence.count({ where: { valuation_type: 'trade_statistical_import_valuation' } })).toBe(0);
    expect(await prisma.customsValuationBasisEvidence.count({ where: { country_code: 'SA' } })).toBe(0);
  });
});
