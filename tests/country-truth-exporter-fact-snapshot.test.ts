import { describe, expect, test } from 'vitest';
import {
  buildCountryTruthExporterFactSnapshot,
  COUNTRY_TRUTH_EXPORTER_FACTS_SCHEMA_VERSION,
  type CountryTruthExporterFactSnapshotInput,
} from '@/lib/country-truth/exporter-fact-snapshot';

function fixture(): CountryTruthExporterFactSnapshotInput {
  return {
    captured_at: new Date('2026-08-29T08:30:00.000Z'),
    exporter_org: {
      id: 'org_1',
      country: ' in ',
      state: ' Gujarat ',
      city: ' Surat ',
      pickup_location_code: ' in-stv ',
      preferred_origin_gateway: ' in-nsa ',
      updated_at: new Date('2026-08-28T10:00:00.000Z'),
    },
    product: {
      id: 'product_1',
      exporter_org_id: 'org_1',
      updated_at: new Date('2026-08-28T11:00:00.000Z'),
      evidence_origin: 'authenticated_real',
      hs_code: '090111',
      hs_nomenclature_version: 'hs2022',
      hs_classification_revision: 3,
      hs_classification_status: 'confirmed',
      price_target_amount: '0012.5000',
      price_target_currency: ' usd ',
      price_target_quantity_unit: ' KGS ',
      price_target_incoterm: ' cif ',
      capacity_value: '1000.0000',
      capacity_unit: 'KGS / MONTH',
      moq_value: 10,
      moq_unit: 'Kilograms',
      lead_time_days: 21,
      delivery_commitment_days: 35,
      logistics_constraint_codes: [' hazmat ', 'cold_chain', 'HAZMAT'],
      logistics_constraints_confirmed: false,
      desired_order_size_amount: '25000.00',
      desired_order_size_currency: 'eur',
      customization_capability: ' Private label ',
      packaging_capability: ' Retail-ready cartons ',
      packaging: ' 20 kg lined bags ',
    },
    classification: {
      id: 'classification_3',
      product_id: 'product_1',
      revision: 3,
      hs6_code: '090111',
      nomenclature_version: 'HS2022',
      status: 'confirmed',
      confirmed_by_id: 'agent_1',
      confirmed_at: new Date('2026-08-27T09:00:00.000Z'),
      evidence_refs: ['catalogue:z', 'catalogue:a'],
    },
    certifications: [
      {
        id: 'cert_iso',
        product_id: 'product_1',
        code: ' iso 22000 ',
        name: ' ISO 22000 ',
        status: 'held',
        evidence_ref: 'file:iso-certificate',
        valid_until: new Date('2027-12-31T00:00:00.000Z'),
        updated_at: new Date('2026-08-28T12:00:00.000Z'),
      },
      {
        id: 'cert_brc',
        product_id: 'product_1',
        code: 'brc',
        name: 'BRCGS Food Safety',
        status: 'not_started',
        declared_absent: true,
        declaration_state: 'declared_absent',
        updated_at: new Date('2026-08-28T13:00:00.000Z'),
      },
    ],
    attributions: {
      exporter_org: {
        pickup_location_code: { actor_user_id: 'exporter_1' },
      },
      product: {
        price_target_amount: {
          actor_user_id: 'exporter_1',
          evidence_refs: ['task:price-z', 'task:price-a'],
        },
      },
    },
  };
}

describe('Country Truth exporter fact snapshot', () => {
  test('builds an immutable JSON snapshot without promoting real master data to verified evidence', () => {
    const input = fixture();
    const built = buildCountryTruthExporterFactSnapshot(input);

    expect(built.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(built.snapshot).toMatchObject({
      schema_version: COUNTRY_TRUTH_EXPORTER_FACTS_SCHEMA_VERSION,
      captured_at: '2026-08-29T08:30:00.000Z',
      identity: {
        exporter_org_id: 'org_1',
        product_id: 'product_1',
        product_classification_id: 'classification_3',
        classification_revision: 3,
        hs6: '090111',
        hs_revision: 'HS2022',
      },
      source_records: {
        exporter_org: { updated_at: '2026-08-28T10:00:00.000Z' },
        product: {
          updated_at: '2026-08-28T11:00:00.000Z',
          evidence_origin: 'authenticated_real',
        },
      },
      hs_classification: {
        state: 'present',
        provenance: {
          assertion_class: 'agent_verified',
          verification_status: 'verified',
          actor_user_id: 'agent_1',
          evidence_refs: ['catalogue:a', 'catalogue:z'],
          verified_at: '2026-08-27T09:00:00.000Z',
        },
      },
      origin: {
        country: { state: 'present', value: 'IN' },
        pickup_location_code: {
          state: 'present',
          value: 'IN-STV',
          provenance: {
            assertion_class: 'exporter_declared',
            verification_status: 'unverified',
            actor_user_id: 'exporter_1',
          },
        },
      },
      commercial: {
        price_target: {
          amount: {
            state: 'present',
            value: '12.5',
            provenance: {
              assertion_class: 'exporter_declared',
              verification_status: 'unverified',
              actor_user_id: 'exporter_1',
              evidence_refs: ['task:price-a', 'task:price-z'],
            },
          },
          currency: { state: 'present', value: 'USD' },
          quantity_unit: { state: 'present', value: 'kg' },
          incoterm: { state: 'present', value: 'CIF' },
        },
        capacity: {
          value: { state: 'present', value: '1000' },
          unit: { state: 'present', value: 'kg/month' },
        },
        minimum_order_quantity: {
          value: { state: 'present', value: '10' },
          unit: { state: 'present', value: 'kg' },
        },
        logistics_constraints: {
          state: 'present',
          value: ['COLD_CHAIN', 'HAZMAT'],
        },
      },
    });

    const held = built.snapshot.certifications.items.find(item => item.code === 'ISO 22000');
    const notStarted = built.snapshot.certifications.items.find(item => item.code === 'BRC');
    expect(built.snapshot.certifications.items.map(item => item.code)).toEqual(['BRC', 'ISO 22000']);
    expect(held).toMatchObject({
      holding: {
        state: 'present',
        value: 'held',
        provenance: { assertion_class: 'exporter_declared', verification_status: 'unverified' },
      },
      evidence_ref: { state: 'present', value: 'file:iso-certificate' },
    });
    expect(notStarted?.holding).toMatchObject({
      state: 'confirmed_absent',
      provenance: { assertion_class: 'exporter_declared', verification_status: 'unverified' },
    });

    expect(JSON.parse(JSON.stringify(built.snapshot))).toEqual(built.snapshot);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.snapshot)).toBe(true);
    expect(Object.isFrozen(built.snapshot.certifications.items)).toBe(true);
    expect(input.product.logistics_constraint_codes).toEqual([' hazmat ', 'cold_chain', 'HAZMAT']);
    expect(input.certifications.map(item => item.code)).toEqual([' iso 22000 ', 'brc']);
  });

  test('uses unknown rather than zero or absence and requires explicit constraint confirmation', () => {
    const missing = fixture();
    missing.product.price_target_amount = null;
    missing.product.logistics_constraint_codes = [];
    missing.certifications = [];
    const missingBuilt = buildCountryTruthExporterFactSnapshot(missing);

    expect(missingBuilt.snapshot.commercial.price_target.amount).toEqual({ state: 'unknown', value: null });
    expect(missingBuilt.snapshot.commercial.logistics_constraints).toEqual({ state: 'unknown', value: null });
    expect(missingBuilt.snapshot.certifications).toEqual({
      state: 'unknown',
      unlisted_certifications_state: 'unknown',
      items: [],
    });

    const undeclared = fixture();
    undeclared.certifications = [{
      id: 'cert_unknown', product_id: 'product_1', code: 'UNKNOWN CERT', name: 'Unknown certificate',
      status: 'not_started', updated_at: new Date('2026-08-28T13:00:00.000Z'),
    }];
    expect(buildCountryTruthExporterFactSnapshot(undeclared).snapshot.certifications.items[0]!.holding)
      .toEqual({ state: 'unknown', value: null });

    const heldInProgress = fixture();
    heldInProgress.certifications = [{
      id: 'cert_progress', product_id: 'product_1', code: 'HACCP', name: 'HACCP',
      status: 'in_progress', declaration_state: 'declared_held', updated_at: new Date('2026-08-28T13:00:00.000Z'),
    }];
    const progressFact = buildCountryTruthExporterFactSnapshot(heldInProgress).snapshot.certifications.items[0]!;
    expect(progressFact.declaration_state).toMatchObject({ state: 'present', value: 'declared_held' });
    expect(progressFact.holding).toEqual({ state: 'unknown', value: null });

    const zero = fixture();
    zero.product.price_target_amount = 0;
    const zeroBuilt = buildCountryTruthExporterFactSnapshot(zero);
    expect(zeroBuilt.snapshot.commercial.price_target.amount).toMatchObject({ state: 'present', value: '0' });
    expect(zeroBuilt.checksum).not.toBe(missingBuilt.checksum);

    const confirmedNoConstraints = fixture();
    confirmedNoConstraints.product.logistics_constraint_codes = [];
    confirmedNoConstraints.product.logistics_constraints_confirmed = true;
    expect(buildCountryTruthExporterFactSnapshot(confirmedNoConstraints).snapshot.commercial.logistics_constraints)
      .toMatchObject({ state: 'confirmed_absent', value: null });
  });

  test('keeps certification evidence exporter-declared until an explicit agent verification is supplied', () => {
    const unverified = buildCountryTruthExporterFactSnapshot(fixture());
    const unverifiedHeld = unverified.snapshot.certifications.items.find(item => item.code === 'ISO 22000');
    expect(unverifiedHeld?.holding).toMatchObject({
      provenance: { assertion_class: 'exporter_declared', verification_status: 'unverified' },
    });

    const verifiedInput = fixture();
    verifiedInput.certifications = verifiedInput.certifications.map(item => item.code.trim().toUpperCase() === 'ISO 22000'
      ? {
          ...item,
          verification: {
            verification_status: 'verified' as const,
            verified_at: '2026-08-29T07:00:00.000Z',
            actor_user_id: 'agent_2',
            evidence_refs: ['review:z', 'review:a'],
          },
        }
      : item);
    const verified = buildCountryTruthExporterFactSnapshot(verifiedInput);
    const verifiedHeld = verified.snapshot.certifications.items.find(item => item.code === 'ISO 22000');
    expect(verifiedHeld?.holding).toMatchObject({
      provenance: {
        assertion_class: 'agent_verified',
        verification_status: 'verified',
        actor_user_id: 'agent_2',
        evidence_refs: ['file:iso-certificate', 'review:a', 'review:z'],
        verified_at: '2026-08-29T07:00:00.000Z',
      },
    });
    expect(verified.checksum).not.toBe(unverified.checksum);
  });

  test('canonicalizes every set-like array while source record revisions remain part of identity', () => {
    const firstInput = fixture();
    const secondInput = fixture();
    secondInput.certifications = [...secondInput.certifications].reverse();
    secondInput.product.logistics_constraint_codes = [...secondInput.product.logistics_constraint_codes].reverse();
    secondInput.classification.evidence_refs = [...(secondInput.classification.evidence_refs ?? [])].reverse();
    secondInput.attributions!.product!.price_target_amount!.evidence_refs = [
      ...(secondInput.attributions!.product!.price_target_amount!.evidence_refs ?? []),
    ].reverse();

    const first = buildCountryTruthExporterFactSnapshot(firstInput);
    const reordered = buildCountryTruthExporterFactSnapshot(secondInput);
    expect(reordered.snapshot).toEqual(first.snapshot);
    expect(reordered.checksum).toBe(first.checksum);

    const revisedProduct = fixture();
    revisedProduct.product.updated_at = '2026-08-28T11:00:00.001Z';
    expect(buildCountryTruthExporterFactSnapshot(revisedProduct).checksum).not.toBe(first.checksum);

    const revisedCertification = fixture();
    revisedCertification.certifications = revisedCertification.certifications.map((item, index) => index === 0
      ? { ...item, updated_at: '2026-08-28T12:00:00.001Z' }
      : item);
    expect(buildCountryTruthExporterFactSnapshot(revisedCertification).checksum).not.toBe(first.checksum);
  });

  test('rejects non-finite values, invalid dates, stale classifications and ambiguous duplicates', () => {
    const nonFinite = fixture();
    nonFinite.product.price_target_amount = Number.NaN;
    expect(() => buildCountryTruthExporterFactSnapshot(nonFinite)).toThrow(/finite/i);

    const invalidDate = fixture();
    invalidDate.product.updated_at = 'not-a-date';
    expect(() => buildCountryTruthExporterFactSnapshot(invalidDate)).toThrow(/updated_at.*invalid/i);

    const normalizedByJavaScriptButInvalid = fixture();
    normalizedByJavaScriptButInvalid.captured_at = '2026-02-30T08:30:00.000Z';
    expect(() => buildCountryTruthExporterFactSnapshot(normalizedByJavaScriptButInvalid)).toThrow(/captured_at.*invalid/i);

    const stale = fixture();
    stale.product.hs_classification_revision = 4;
    expect(() => buildCountryTruthExporterFactSnapshot(stale)).toThrow(/revision does not match/i);

    const duplicates = fixture();
    duplicates.certifications = [
      ...duplicates.certifications,
      { ...duplicates.certifications[0]!, id: 'cert_duplicate', code: 'ISO 22000' },
    ];
    expect(() => buildCountryTruthExporterFactSnapshot(duplicates)).toThrow(/duplicate certification code/i);
  });
});
