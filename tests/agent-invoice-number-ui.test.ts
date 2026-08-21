import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const documentsPage = readFileSync('src/app/agent/deals/[dealId]/documents/page.tsx', 'utf8');
const documentDataPage = readFileSync('src/app/agent/deals/[dealId]/document-data/page.tsx', 'utf8');
const fixPanel = readFileSync('src/app/agent/deals/[dealId]/document-data/FixCanonicalDataPanel.tsx', 'utf8');
const issueAction = readFileSync('src/app/agent/deals/[dealId]/InvoiceNumberAction.tsx', 'utf8');
const stagingPilot = readFileSync('scripts/staging-pilot.ts', 'utf8');

describe('agent Commercial Invoice number UX', () => {
  test('the sole invoice blocker gets a specific action and no active generation panel', () => {
    expect(documentsPage).toContain("blockers.length === 1 && blockers[0]?.field === 'references.invoice_number'");
    expect(documentsPage).toContain('Official invoice number required');
    expect(documentsPage).toContain('Commercial Invoice cannot be finalized until an invoice number is issued.');
    expect(documentsPage).toContain("row.readiness.status === 'ready' ? (");
    expect(documentsPage).toContain('<InvoiceNumberAction');
  });

  test('the documents header links directly to the invoice section', () => {
    expect(documentsPage).toContain('document-data#invoice-numbering');
    expect(fixPanel).toContain('id="invoice-numbering"');
  });

  test('issuance is explicit, confirmed, and uses the existing endpoint', () => {
    expect(issueAction).toContain('Issue official invoice number?');
    expect(issueAction).toContain('will be permanently allocated to this Commercial Invoice');
    expect(issueAction).toContain('Cancel');
    expect(issueAction).toContain("apiPost(`/api/v1/deals/${dealId}/invoice-number`, {})");
    expect(issueAction).toContain('router.refresh()');
  });

  test('document data shows the official number audit metadata without internal IDs', () => {
    expect(fixPanel).toContain('No official invoice number issued');
    expect(fixPanel).toContain('Official invoice number');
    expect(fixPanel).toContain('Issued at');
    expect(fixPanel).toContain('Issued by');
    expect(documentDataPage).toContain('issuedBy={issuer?.name ?? issuer?.email ?? null}');
    expect(fixPanel).not.toContain('issued_by_id');
  });

  test('the Alpha staging fixture remains intentionally unissued', () => {
    expect(stagingPilot).not.toContain('issueInvoiceNumber');
    expect(stagingPilot).not.toContain('IssuedInvoiceNumber');
  });
});
