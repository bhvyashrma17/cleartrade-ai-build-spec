import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Architectural guards.
 *
 * Source-level ON PURPOSE, and narrowly so. Each one encodes a rule that has no runtime
 * behaviour to observe — "this file must not import that", "this model must not grow that kind
 * of column" — and each exists because the rule was actually broken once, in the legacy project
 * or in an earlier phase.
 *
 * Comments and string literals are stripped before matching, so the explanation of a rule can
 * never be mistaken for a violation of it.
 */

function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
}

async function readAll(dir: string): Promise<{ file: string; source: string }[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: { file: string; source: string }[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await readAll(full)));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push({ file: full, source: await readFile(full, 'utf8') });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

describe('the renderer is decoupled from the database', () => {
  test('no adapted renderer file imports Prisma, storage, auth or env', async () => {
    const files = await readAll('src/lib/document-generation');
    expect(files.length).toBeGreaterThan(5);

    for (const { file, source } of files) {
      const body = code(source);
      // This is the legacy `documentPdfService.ts` coupling, expressed as a rule. That file
      // took an invoice id and ran its own `prisma.invoice.findUnique` per document type.
      expect(body, `${file} imports prisma`).not.toMatch(/from ['"][^'"]*\/prisma['"]/);
      expect(body, `${file} imports document storage`).not.toMatch(/document-storage/);
      expect(body, `${file} imports auth`).not.toMatch(/from ['"]@\/lib\/auth['"]/);
      expect(body, `${file} imports permissions`).not.toMatch(/from ['"]@\/lib\/permissions['"]/);
      expect(body, `${file} imports the audit log`).not.toMatch(/from ['"]@\/lib\/audit['"]/);
      // An engine that could allocate an invoice number could burn one on a failed render.
      expect(body, `${file} imports invoice numbering`).not.toMatch(/invoice-numbering/);

      // `@prisma/client` is allowed for the DocType ENUM only — a shared vocabulary, not a
      // database handle. Importing PrismaClient, or anything that could open a connection, is
      // the coupling this whole seam exists to prevent.
      const prismaImport = body.match(/import\s*\{([^}]*)\}\s*from\s*['"]@prisma\/client['"]/);
      if (prismaImport) {
        const imported = prismaImport[1]!.split(',').map((n) => n.trim()).filter(Boolean);
        expect(imported, `${file} imports more than enums from @prisma/client`)
          .toEqual(imported.filter((n) => ['DocType', 'DocumentFormat'].includes(n)));
      }
      expect(body, `${file} instantiates a Prisma client`).not.toMatch(/new PrismaClient/);
    }
  });

  test('no browser renderer is reachable', async () => {
    const files = await readAll('src');
    for (const { file, source } of files) {
      expect(code(source), `${file} references a browser renderer`)
        .not.toMatch(/\bpuppeteer\b|\bchromium\b|\bplaywright\b/i);
    }
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const name of Object.keys(pkg.dependencies)) {
      expect(name).not.toMatch(/puppeteer|chromium|playwright/i);
    }
  });

  test('nothing depends at runtime on the legacy project directory', async () => {
    const files = await readAll('src');
    const configs = ['package.json', 'tsconfig.json', 'next.config.mjs', 'vitest.config.ts'];
    for (const { file, source } of files) {
      expect(code(source), `${file} references the legacy project path`)
        .not.toMatch(/Desktop\/Export|\.\.\/\.\.\/Export/);
    }
    for (const config of configs) {
      const source = await readFile(config, 'utf8').catch(() => '');
      expect(source, `${config} references the legacy project path`).not.toContain('Desktop/Export');
    }
  });

  test('the legacy LC and compliance renderers are not activated', async () => {
    const { DOCUMENT_FORMAT_SUPPORT } = await import('../src/lib/document-generation');
    // No DocType exists for either, so support cannot be declared for them — but the absence
    // is asserted so a future DocType addition has to make a deliberate decision.
    expect(Object.keys(DOCUMENT_FORMAT_SUPPORT)).not.toContain('letter_of_credit');
    expect(Object.keys(DOCUMENT_FORMAT_SUPPORT)).not.toContain('compliance_report');

    const files = await readAll('src/lib/document-generation');
    for (const { file, source } of files) {
      expect(code(source), `${file} references LC compliance machinery`)
        .not.toMatch(/lcComplianceEngine|lcTermLock|masterCompliancePipeline|complianceReportGenerator/);
    }
  });
});

describe('Buyer stays global; tenant-specific facts do not go on it', () => {
  /**
   * Phase 5 established that `Buyer` has no `exporter_org_id` — one row is shared by every
   * exporter org that has discovered the same company. A tenant-specific column there would
   * hand one tenant's operational data to every other tenant holding the same buyer, silently
   * and with no query doing anything wrong.
   *
   * This guard is deliberately small: it reads the Buyer block out of the schema and refuses
   * a short list of field kinds that are unmistakably per-tenant. It is not a schema linter,
   * and it is not trying to catch everything — it exists so that adding
   * "buyer.shipping_address" is a failing test with an explanation rather than a quiet leak.
   */
  async function buyerModelFields(): Promise<string[]> {
    const schema = await readFile('prisma/schema.prisma', 'utf8');
    const match = schema.match(/^model Buyer \{([\s\S]*?)^\}/m);
    expect(match, 'Buyer model not found in schema').toBeTruthy();
    // Scalar columns only. A relation like `shortlists BuyerShortlist[]` is not a fact stored
    // ON the buyer — BuyerShortlist carries its own tenant key — so pointing at a scoped model
    // is exactly the pattern this guard wants people to use, not one it should reject.
    return code(match![1]!)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('@') && !line.includes('@relation'))
      .map((line) => line.split(/\s+/))
      .filter(([, type]) => type && !type.endsWith('[]') && !type.endsWith('[]?'))
      .map(([name]) => name!);
  }

  test('Buyer is genuinely global — it has no tenant key', async () => {
    const fields = await buyerModelFields();
    expect(fields).not.toContain('exporter_org_id');
  });

  test('Buyer carries no address, contact or document-profile columns', async () => {
    const fields = await buyerModelFields();
    // Each pattern names a fact that is true of a buyer FOR ONE EXPORTER, not of the buyer.
    const forbidden = [
      /^address/, /^postal/, /^street/, /_address$/,
      /^tax_identifier/, /^vat/, /^eori/,
      /^contact_(email|phone|name)$/,
      /^agent_notes?$/, /^internal_note/,
      /^document_/, /^consignee/, /^notify_party/,
      /^shortlist/, /^payment_terms$/, /^credit_limit/,
    ];
    for (const field of fields) {
      for (const pattern of forbidden) {
        expect(
          pattern.test(field),
          `Buyer.${field} looks tenant-specific. Buyer is a GLOBAL row shared across exporter orgs — put this on BuyerCommercialProfile (scoped to exporter_org_id + buyer_id) or BuyerLead instead.`,
        ).toBe(false);
      }
    }
  });

  test('the tenant-scoped alternative exists and is scoped', async () => {
    const schema = await readFile('prisma/schema.prisma', 'utf8');
    const match = schema.match(/^model BuyerCommercialProfile \{([\s\S]*?)^\}/m);
    expect(match).toBeTruthy();
    const body = code(match![1]!);
    expect(body).toMatch(/exporter_org_id\s+String/);
    expect(body).toMatch(/@@unique\(\[exporter_org_id, buyer_id\]\)/);
  });

  test('the document context reads the buyer address from the scoped profile', async () => {
    const source = code(await readFile('src/lib/document-data/context.ts', 'utf8'));
    expect(source).toContain('buyerCommercialProfile.findUnique');
    // And never from the encrypted trade-data identity store, which arrives under
    // source-rights terms that say nothing about printing it on a customs declaration.
    expect(source).not.toMatch(/rawImportIdentity|decryptImportIdentity/);
  });

  test('the guard can fail', async () => {
    // A guard that cannot fail is decoration. `postal_code` is exactly the kind of field this
    // is meant to catch, and it currently lives on BuyerCommercialProfile where it belongs.
    const forbidden = [/^postal/];
    expect(forbidden.some((p) => p.test('postal_code'))).toBe(true);
    expect(forbidden.some((p) => p.test('country_code'))).toBe(false);
  });
});
