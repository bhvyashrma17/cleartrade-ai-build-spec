import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const pilot = readFileSync('scripts/staging-pilot.ts', 'utf8');

describe('12-document staging pilot fixture contract', () => {
  test('Alpha and Bravo receive all five new queued lifecycle rows without lifecycle shortcuts', () => {
    for (const type of [
      'shipping_instructions', 'vgm_declaration', 'bill_of_exchange',
      'carrier_instructions', 'bank_collection_letter',
    ]) expect(pilot).toContain(`DocType.${type}`);
    expect(pilot).toContain("const documentUatFixture = spec.key === 'A' || spec.key === 'B'");
    expect(pilot).toContain('generation_status: GenerationStatus.queued');
    expect(pilot).not.toContain('prisma.agentDecision.create');
    expect(pilot).not.toContain('reviewed_by_id:');
    expect(pilot).not.toContain('approved_by_id:');
    expect(pilot).not.toContain('prisma.documentArtifact.create');
  });

  test('Alpha is a canonical sea-container documentary-collection scenario', () => {
    expect(pilot).toContain('containerized: true');
    expect(pilot).toContain('freight_partner_id: freightPartner!.id');
    expect(pilot).toContain('freight_payment_term: FreightPaymentTerm.prepaid');
    expect(pilot).toContain("vgm_method: VgmMethod.method_2");
    expect(pilot).toContain("vgm_verified_gross_mass_kg: new Prisma.Decimal('5070.000')");
    expect(pilot).toContain("vgm_method_2_component_mass_kg: new Prisma.Decimal('1270.000')");
    expect(pilot).toContain("? { kind: 'DP', label: 'Documents against payment' }");
    expect(pilot).toContain('bank_presentation_type: BankPresentationType.collection');
    expect(pilot).toContain('documents.get(DocType.CI)!.id');
    expect(pilot).toContain('documents.get(DocType.packing_list)!.id');
  });

  test('Bravo has deliberate VGM and bank-only gaps rather than fabricated values', () => {
    expect(pilot).toContain("spec.key === 'A' ? {");
    expect(pilot).toContain("collection_instructions: spec.key === 'A'");
    expect(pilot).toContain(': null');
    expect(pilot).toContain('no verified value/method/person');
    expect(pilot).toContain("Bravo's bank-only gap");
    expect(pilot).toContain("buyer_reference: 'PO-B-AIR-CONTROL'");
    expect(pilot).toContain('mode: ShipmentMode.air');
    expect(pilot).toContain('containerized: false');
    expect(pilot).toContain('Bravo N/A control');
  });

  test('Charlie remains outside the document-UAT fixture and keeps its isolation assignment', () => {
    expect(pilot).toContain("spec.key === 'A' || spec.key === 'B'");
    expect(pilot).toContain("seedExporter({ key: 'C', name: 'Charlie', complete: true }");
    expect(pilot).toContain('agent_user_id: agentC.id, exporter_org_id: c.orgId');
    expect(pilot).toContain('Charlie remains the populated, differently assigned isolation tenant');
  });

  test('reset remains scoped and removes only labelled pilot partner rows', () => {
    expect(pilot).toContain("prisma.partner.deleteMany({ where: { display_name: { startsWith: LABEL } } })");
    expect(pilot).toContain("env === 'production'");
  });
});
