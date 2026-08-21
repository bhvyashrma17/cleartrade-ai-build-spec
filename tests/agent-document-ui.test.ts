import { readFileSync } from 'node:fs';
import { DocType } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import {
  DOCUMENT_UI_GROUPS,
  documentDataAnchor,
  documentDisplayName,
  notApplicableMessage,
} from '@/lib/document-ui';

const documentsPage = readFileSync('src/app/agent/deals/[dealId]/documents/page.tsx', 'utf8');
const dataPage = readFileSync('src/app/agent/deals/[dealId]/document-data/page.tsx', 'utf8');
const fixPanel = readFileSync('src/app/agent/deals/[dealId]/document-data/FixCanonicalDataPanel.tsx', 'utf8');

describe('Agent document workspace information architecture', () => {
  test('groups all 12 capabilities once in the approved four sections', () => {
    expect(DOCUMENT_UI_GROUPS.map((group) => group.label)).toEqual([
      'Commercial', 'Shipping', 'Certificates & declarations', 'Banking',
    ]);
    const types = DOCUMENT_UI_GROUPS.flatMap((group) => [...group.documentTypes]);
    expect(types).toHaveLength(12);
    expect(new Set(types).size).toBe(12);
    expect(types).not.toContain(DocType.other);
  });

  test('uses human carrier variants and never presents internal identifiers as titles', () => {
    expect(documentDisplayName(DocType.carrier_instructions, {
      status: 'applicable', code: 'sea', reason: 'Sea', variant: 'bill_of_lading_instructions',
    })).toBe('Bill of Lading Instructions');
    expect(documentDisplayName(DocType.carrier_instructions, {
      status: 'applicable', code: 'air', reason: 'Air', variant: 'air_waybill_instructions',
    })).toBe('Air Waybill Instructions');
    for (const type of DOCUMENT_UI_GROUPS.flatMap((group) => [...group.documentTypes])) {
      expect(documentDisplayName(type)).not.toBe(type);
    }
  });

  test('has explicit conditional copy without false blockers', () => {
    expect(notApplicableMessage(DocType.vgm_declaration, {
      status: 'not_applicable', code: 'not_sea', reason: 'internal reason',
    })).toBe('Not applicable — shipment is not a packed sea-container movement.');
    expect(notApplicableMessage(DocType.bill_of_exchange, {
      status: 'not_applicable', code: 'payment_advance', reason: 'internal reason',
    })).toBe('Not applicable — current payment terms do not require a draft.');
    expect(documentsPage).toContain("row.readiness.status === 'ready' ? (");
    expect(documentsPage).toContain("row.readiness.status !== 'not_applicable'");
  });

  test('deep-links each blocker owner to a structured canonical-data section', () => {
    expect(documentDataAnchor('shipment')).toBe('shipment-instructions');
    expect(documentDataAnchor('shipment_containers')).toBe('container-vgm');
    expect(documentDataAnchor('trade_finance_instruction')).toBe('payment-draft');
    expect(documentDataAnchor('bank_presentation')).toBe('bank-presentation');
    for (const anchor of ['shipment-instructions', 'container-vgm', 'payment-draft', 'bank-presentation']) {
      expect(fixPanel).toContain(`id="${anchor}"`);
    }
    expect(documentsPage).toContain('href={fixDataHref}');
  });

  test('cards expose lifecycle and artifacts with existing design tokens', () => {
    expect(documentsPage).toContain('Applicability');
    expect(documentsPage).toContain('Readiness');
    expect(documentsPage).toContain('Generation:');
    expect(documentsPage).toContain('Review:');
    expect(documentsPage).toContain('Approval:');
    expect(documentsPage).toContain('Artifacts');
    expect(documentsPage).toContain("artifact.format === 'html' ? 'Preview'");
    expect(documentsPage).toContain('border-[var(--color-border)]');
    expect(documentsPage).toContain('bg-surface');
    expect(documentsPage).not.toMatch(/(?:bg|text|border)-(?:red|blue|green|yellow)-\d+/);
  });

  test('Document Data is structured and explains canonical ownership', () => {
    expect(dataPage).toContain('aria-label="Document data sections"');
    expect(fixPanel).toContain('Package weights are never substituted for VGM.');
    expect(fixPanel).toContain('Exporter approval does not mean drawee acceptance.');
    expect(fixPanel).toContain('tenant-scoped bank and trade-finance records');
  });
});

