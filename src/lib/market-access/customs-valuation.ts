/**
 * Customs valuation bases, from primary law.
 *
 * TWO DIFFERENT QUESTIONS live here and are deliberately never merged:
 *
 *  - `legal_customs_valuation` — what duty is actually assessed on. This is statute.
 *  - `trade_statistical_import_valuation` — what a reporter's published import VALUES mean.
 *    This is a statistical convention, and it does not follow from the legal basis. A country
 *    may assess duty on one basis and publish statistics on another; the United States does
 *    exactly that. Using one as the other puts duty on the wrong base, or compares an exporter's
 *    landed cost against a benchmark that excludes freight.
 *
 * Only jurisdictions whose basis is supported by primary law are encoded. Saudi Arabia is
 * deliberately absent: the GCC Common Customs Law is the authority, and the sources reachable
 * here describing it as CIF are commercial commentary rather than the legal text. Commentary is
 * not evidence, so Saudi Arabia stays unavailable until the primary text is cited.
 */
import { EvidenceAssertionClass, EvidenceOrigin, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const CUSTOMS_VALUATION_REFERENCE_VERSION = 'customs-valuation-reference-v1' as const;

export interface CustomsValuationReference {
  jurisdiction: string;
  country_codes: readonly string[];
  valuation_type: 'legal_customs_valuation';
  basis: 'CIF' | 'FOB';
  included_components: readonly string[];
  excluded_components: readonly string[];
  source_authority: string;
  source_reference: string;
  source_version: string;
  effective_from: string;
  /**
   * discovery_grade until a named customs professional has reviewed the determination for this
   * product and route. Primary law is a strong source; it is still not a filed entry.
   */
  verification_grade: 'discovery_grade' | 'execution_grade';
  notes: string;
}

export const CUSTOMS_VALUATION_REFERENCES: readonly CustomsValuationReference[] = Object.freeze([
  {
    jurisdiction: 'EU',
    // The Union Customs Code applies across the customs union; Germany has no national rule.
    country_codes: ['DE', 'FR', 'NL', 'IT', 'ES', 'BE', 'PL', 'SE', 'DK', 'FI', 'IE', 'AT', 'PT', 'CZ', 'GR', 'HU', 'RO', 'SK', 'BG', 'HR', 'SI', 'LT', 'LV', 'EE', 'LU', 'CY', 'MT'],
    valuation_type: 'legal_customs_valuation',
    basis: 'CIF',
    included_components: ['goods_price', 'international_freight', 'insurance', 'loading_and_handling_to_place_of_introduction'],
    excluded_components: ['transport_after_place_of_introduction', 'destination_charges', 'import_duty', 'import_vat'],
    source_authority: 'European Union — Union Customs Code, Regulation (EU) No 952/2013',
    source_reference: 'https://www.legislation.gov.uk/eur/2013/952/article/71/2013-10-09',
    source_version: 'Regulation (EU) No 952/2013, Articles 70 and 71(1)(e)',
    effective_from: '2016-05-01',
    verification_grade: 'discovery_grade',
    notes: 'Article 71(1)(e) adds transport, insurance, loading and handling costs incurred up to the place of introduction into the Union, to the extent not already in the price paid. That is a CIF-equivalent customs value.',
  },
  {
    jurisdiction: 'GB',
    country_codes: ['GB'],
    valuation_type: 'legal_customs_valuation',
    basis: 'CIF',
    included_components: ['goods_price', 'international_freight', 'insurance', 'loading_and_handling_to_place_of_importation'],
    excluded_components: ['transport_after_importation', 'destination_charges', 'import_duty', 'import_vat'],
    source_authority: 'United Kingdom — Taxation (Cross-border Trade) Act 2018 and the Customs (Import Duty) (EU Exit) Regulations 2018',
    source_reference: 'https://www.legislation.gov.uk/uksi/2018/1248/part/12',
    source_version: 'S.I. 2018/1248 Part 12 (regulation 108), under Taxation (Cross-border Trade) Act 2018 Part 1',
    effective_from: '2021-01-01',
    verification_grade: 'discovery_grade',
    notes: 'Transport and insurance up to the time the goods are imported into the United Kingdom are included; costs after importation are excluded. WTO Valuation Agreement transaction value with CIF-equivalent additions.',
  },
  {
    jurisdiction: 'US',
    country_codes: ['US'],
    valuation_type: 'legal_customs_valuation',
    // The important one, and the reason this table exists rather than a constant: the United
    // States assesses duty on an FOB-equivalent value. Treating it as CIF would apply duty to
    // freight and insurance that the statute explicitly excludes.
    basis: 'FOB',
    included_components: ['goods_price', 'packing_costs', 'assists', 'royalties', 'proceeds_of_resale'],
    excluded_components: ['international_freight', 'insurance', 'related_international_shipment_services', 'import_duty'],
    source_authority: 'United States — 19 U.S.C. § 1401a, implemented by 19 C.F.R. § 152.103',
    source_reference: 'https://www.law.cornell.edu/uscode/text/19/1401a',
    source_version: '19 U.S.C. § 1401a(b)(4)(A); 19 C.F.R. § 152.103',
    effective_from: '1981-01-01',
    verification_grade: 'discovery_grade',
    notes: 'The price actually paid or payable is defined exclusive of costs for transportation, insurance and related services incident to the international shipment from the country of exportation to the place of importation.',
  },
]);

export function customsValuationReferenceFor(countryCode: string): CustomsValuationReference | null {
  const iso2 = countryCode.trim().toUpperCase();
  return CUSTOMS_VALUATION_REFERENCES.find((entry) => entry.country_codes.includes(iso2)) ?? null;
}

/**
 * Record the encoded references as evidence rows.
 *
 * Idempotent through the natural identity (country, type, basis, effective date, citation), so
 * re-running never produces a rival statement of the same law.
 */
export async function seedCustomsValuationEvidence(args: { recorded_by_id?: string | null; now?: Date } = {}) {
  const now = args.now ?? new Date();
  const written: Array<{ country_code: string; basis: string; created: boolean }> = [];
  for (const reference of CUSTOMS_VALUATION_REFERENCES) {
    for (const country of reference.country_codes) {
      const effectiveFrom = new Date(`${reference.effective_from}T00:00:00.000Z`);
      const existing = await prisma.customsValuationBasisEvidence.findFirst({
        where: { country_code: country, valuation_type: reference.valuation_type, basis: reference.basis, effective_from: effectiveFrom, source_reference: reference.source_reference },
      });
      if (existing) { written.push({ country_code: country, basis: reference.basis, created: false }); continue; }
      try {
        await createReference(reference, country, effectiveFrom, now, args.recorded_by_id ?? null);
        written.push({ country_code: country, basis: reference.basis, created: true });
      } catch (error) {
        // A concurrent seeder won the race on the natural identity. That is the same statement of
        // the same law, so it is a no-op rather than an error.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        written.push({ country_code: country, basis: reference.basis, created: false });
      }
    }
  }
  return written;
}

function createReference(reference: CustomsValuationReference, country: string, effectiveFrom: Date, now: Date, recordedById: string | null) {
  return prisma.customsValuationBasisEvidence.create({
        data: {
          jurisdiction: reference.jurisdiction, country_code: country,
          valuation_type: reference.valuation_type, basis: reference.basis,
          included_components: [...reference.included_components], excluded_components: [...reference.excluded_components],
          source_authority: reference.source_authority, source_reference: reference.source_reference,
          source_version: reference.source_version,
          effective_from: effectiveFrom, effective_to: null,
          observed_at: effectiveFrom, retrieved_at: now,
          verification_grade: reference.verification_grade,
          assertion_class: EvidenceAssertionClass.authoritative_public,
          evidence_origin: EvidenceOrigin.public_real,
          recorded_by_id: recordedById,
          confidence: new Prisma.Decimal(1),
          status: 'verified',
          notes: reference.notes,
      raw_evidence: { schema_version: CUSTOMS_VALUATION_REFERENCE_VERSION, reference } as unknown as Prisma.InputJsonValue,
    },
  });
}
