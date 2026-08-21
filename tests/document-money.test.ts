import { inflateRawSync } from 'node:zlib';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { DocType, Prisma } from '@prisma/client';
import { buildDocumentContext } from '../src/lib/document-data';
import {
  DOCUMENT_MONEY_POLICY_VERSION, DOCUMENT_MONEY_ROUNDING_NAME, UNKNOWN_CURRENCY_MINOR_UNITS,
  currencyMinorUnits, formatDocumentMoney, formatDocumentUnitPrice, formatExchangeRate,
  isKnownCurrency, moneyPolicySnapshot, resolveMoneyPolicy, roundDocumentMoney,
} from '../src/lib/document-money';
import { LegacyDocumentEngine, setDocumentGenerationEngine } from '../src/lib/document-generation';
import { readDocumentArtifact, renderDocumentArtifact } from '../src/lib/document-rendering';
import { prisma } from '../src/lib/prisma';
import { buildPilotWorld, corr, type PilotWorld } from './pilot/fixtures';

/**
 * Phase 8.1 — document monetary presentation.
 *
 * The rule under test: canonical precision is never touched, and rounding happens once, at the
 * presentation boundary, under a versioned policy that the snapshot freezes.
 */

afterAll(async () => { await prisma.$disconnect(); });
afterEach(() => { setDocumentGenerationEngine(null); });

function docxText(buffer: Buffer): string {
  let offset = 0;
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) { offset += 1; continue; }
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    if (name === 'word/document.xml' && size > 0) {
      const data = buffer.subarray(start, start + size);
      return method === 0 ? data.toString('utf8') : inflateRawSync(data).toString('utf8');
    }
    offset = start + (size > 0 ? size : 1);
  }
  return '';
}

// ---------------------------------------------------------------------------

describe('money policy v1', () => {
  test('the policy states its own version, mode and minor units', () => {
    const snapshot = moneyPolicySnapshot();
    expect(snapshot.version).toBe('v1');
    expect(snapshot.rounding_mode).toBe('ROUND_HALF_UP');
    expect(snapshot.minor_units.USD).toBe(2);
    expect(snapshot.minor_units.JPY).toBe(0);
    expect(snapshot.unknown_currency_minor_units).toBe(2);
  });

  test('the Phase 8 finding is fixed: 1250 x 1.2345 presents as 1,543.13', () => {
    const exact = new Prisma.Decimal('1250').mul(new Prisma.Decimal('1.2345'));
    expect(exact.toString()).toBe('1543.125');
    expect(formatDocumentMoney(exact.toString(), 'USD')).toBe('USD 1,543.13');
  });

  test('rounds half away from zero, not to even', () => {
    // The distinction matters: banker's rounding sends 1543.125 DOWN to .12, and inheriting a
    // library default is exactly how that would happen unnoticed.
    expect(roundDocumentMoney('1543.125', 'USD')).toBe('1543.13');
    expect(roundDocumentMoney('1543.135', 'USD')).toBe('1543.14');
    expect(roundDocumentMoney('-1543.125', 'USD')).toBe('-1543.13');
    expect(DOCUMENT_MONEY_ROUNDING_NAME).toBe('ROUND_HALF_UP');
  });

  test('rounds down when the next digit is below half', () => {
    expect(formatDocumentMoney('1543.124', 'USD')).toBe('USD 1,543.12');
    expect(formatDocumentMoney('0.004', 'USD')).toBe('USD 0.00');
  });

  test('rounds up when the next digit is above half', () => {
    expect(formatDocumentMoney('1543.126', 'USD')).toBe('USD 1,543.13');
    expect(formatDocumentMoney('0.009', 'USD')).toBe('USD 0.01');
  });

  test('pads to the currency minor units rather than printing a short decimal', () => {
    expect(formatDocumentMoney('1543', 'USD')).toBe('USD 1,543.00');
    expect(formatDocumentMoney('1543.1', 'USD')).toBe('USD 1,543.10');
  });

  test('INR behaves as a two-decimal currency', () => {
    expect(currencyMinorUnits('INR')).toBe(2);
    expect(formatDocumentMoney('136451.4159375', 'INR')).toBe('INR 136,451.42');
    expect(formatDocumentMoney('1234567.005', 'INR')).toBe('INR 1,234,567.01');
  });

  test('a zero-minor-unit currency gets no decimal point at all', () => {
    expect(currencyMinorUnits('JPY')).toBe(0);
    expect(formatDocumentMoney('1543.125', 'JPY')).toBe('JPY 1,543');
    expect(formatDocumentMoney('1543.5', 'JPY')).toBe('JPY 1,544');
    expect(formatDocumentMoney('1543.4', 'JPY')).toBe('JPY 1,543');
    expect(formatDocumentMoney('1543', 'KRW')).toBe('KRW 1,543');
  });

  test('an unknown currency follows the stated fallback rather than guessing silently', () => {
    expect(isKnownCurrency('USD')).toBe(true);
    expect(isKnownCurrency('XYZ')).toBe(false);
    // Documented policy: two places. Refusing would block a document over presentation; zero
    // would drop real minor units.
    expect(currencyMinorUnits('XYZ')).toBe(UNKNOWN_CURRENCY_MINOR_UNITS);
    expect(formatDocumentMoney('10.005', 'XYZ')).toBe('XYZ 10.01');
  });

  test('currency codes are matched case- and whitespace-insensitively', () => {
    expect(currencyMinorUnits(' jpy ')).toBe(0);
    expect(currencyMinorUnits('usd')).toBe(2);
  });

  test('an unknown policy version refuses rather than falling back to current', () => {
    expect(() => resolveMoneyPolicy('v99')).toThrow(/Unknown document money policy/);
    // An absent version means a snapshot frozen before the field existed, under v1.
    expect(resolveMoneyPolicy(undefined).version).toBe('v1');
    expect(resolveMoneyPolicy(null).version).toBe('v1');
  });
});

describe('unit prices keep their agreed precision', () => {
  test('a four-decimal price is printed in full, not rounded to the currency', () => {
    expect(formatDocumentUnitPrice('1.2345', 'USD')).toBe('USD 1.2345');
    expect(formatDocumentUnitPrice('0.0125', 'USD')).toBe('USD 0.0125');
  });

  test('a low-precision price is still padded to minor units', () => {
    expect(formatDocumentUnitPrice('1.2', 'USD')).toBe('USD 1.20');
    expect(formatDocumentUnitPrice('12', 'USD')).toBe('USD 12.00');
  });

  test('a zero-minor-unit currency shows a whole unit price with no decimals', () => {
    expect(formatDocumentUnitPrice('150', 'JPY')).toBe('JPY 150');
    // But a genuinely fractional JPY price is not truncated away.
    expect(formatDocumentUnitPrice('150.25', 'JPY')).toBe('JPY 150.25');
  });
});

describe('exchange rates are not money', () => {
  test('a multi-decimal rate keeps every digit', () => {
    expect(formatExchangeRate('83.7425')).toBe('83.7425');
    expect(formatExchangeRate('88.42537500')).toBe('88.425375');
    expect(formatExchangeRate('0.5917')).toBe('0.5917');
  });

  test('a rate is never processed through the money formatter', () => {
    // The bug this prevents: rounding a rate to the quote currency's minor units makes the
    // conversion it states fail to reproduce.
    expect(formatExchangeRate('83.7425')).not.toBe('83.74');
    expect(formatDocumentMoney('83.7425', 'INR')).toBe('INR 83.74');
  });

  test('large rates are grouped without losing precision', () => {
    expect(formatExchangeRate('1234.56789')).toBe('1,234.56789');
  });
});

// ---------------------------------------------------------------------------

describe('the policy reaches every rendered document', () => {
  let world: PilotWorld;

  async function renderAll(docType: DocType) {
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    const documentId = world.A.documentIds[docType]!;
    for (const format of ['pdf', 'docx', 'html'] as const) {
      await renderDocumentArtifact({
        actor: world.agent, dealId: world.A.dealId, documentId, format, correlationId: corr(),
      });
    }
    const html = (await readDocumentArtifact({ actor: world.agent, dealId: world.A.dealId, documentId, format: 'html' })).bytes.toString('utf8');
    const docx = docxText((await readDocumentArtifact({ actor: world.agent, dealId: world.A.dealId, documentId, format: 'docx' })).bytes);
    const pdf = (await readDocumentArtifact({ actor: world.agent, dealId: world.A.dealId, documentId, format: 'pdf' })).bytes;
    return { html, docx, pdf };
  }

  test('the commercial invoice presents the rounded total in all three formats', async () => {
    world = await buildPilotWorld();
    const { html, docx, pdf } = await renderAll(DocType.CI);

    // The Phase 8 regression, pinned. Previously `USD 1,543.125`.
    expect(html).toContain('USD 1,543.13');
    expect(html).not.toContain('1,543.125');
    expect(docx).toContain('USD 1,543.13');
    expect(docx).not.toContain('1,543.125');

    const { PDFDocument } = await import('pdf-lib');
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);

    // The unit price keeps its four decimals — an invoice whose price x quantity does not
    // reproduce its own total would be worse than an unrounded total.
    expect(html).toContain('USD 1.2345');
    expect(docx).toContain('USD 1.2345');
  });

  test('the exchange rate keeps its precision on the same document', async () => {
    const html = (await readDocumentArtifact({
      actor: world.agent, dealId: world.A.dealId, documentId: world.A.documentIds[DocType.CI]!, format: 'html',
    })).bytes.toString('utf8');
    expect(html).toContain('88.425375');
    expect(html).not.toMatch(/1 USD = INR 88\.43\b/);

    // And the converted value IS money, so it rounds.
    const exact = new Prisma.Decimal('1543.125').mul(new Prisma.Decimal('88.425375'));
    expect(html).toContain(formatDocumentMoney(exact.toString(), 'INR'));
  });

  test('FOB and CIF follow the same policy', async () => {
    const { html, docx } = await renderAll(DocType.shipping_bill_draft);
    // FOB terms: FOB is the goods total, rounded the same way.
    expect(html).toContain('USD 1,543.13');
    expect(docx).toContain('USD 1,543.13');
    expect(html).not.toContain('1,543.125');
    // Freight is money and is presented at minor units.
    expect(html).toContain('USD 212.50');
  });

  test('PDF, DOCX and HTML agree on every monetary value', async () => {
    const { html, docx } = await renderAll(DocType.insurance_declaration);
    for (const amount of ['USD 1,697.44', 'USD 38.75']) {
      expect(html, `HTML missing ${amount}`).toContain(amount);
      expect(docx, `DOCX missing ${amount}`).toContain(amount);
    }
  });
});

// ---------------------------------------------------------------------------

describe('canonical data and snapshot reproducibility', () => {
  test('rendering never writes a rounded value back into canonical data', async () => {
    const world = await buildPilotWorld();
    const before = await prisma.deal.findUniqueOrThrow({
      where: { id: world.A.dealId },
      select: { unit_price_amount: true, total_amount: true, quantity: true },
    });
    const rateBefore = await prisma.exchangeRateQuote.findFirstOrThrow({
      where: { exporter_org_id: world.A.orgId }, select: { rate: true },
    });
    const insuranceBefore = await prisma.insuranceCase.findFirstOrThrow({
      where: { deal_id: world.A.dealId }, select: { premium_amount: true, covered_amount: true },
    });

    setDocumentGenerationEngine(new LegacyDocumentEngine());
    for (const format of ['pdf', 'docx', 'html'] as const) {
      await renderDocumentArtifact({
        actor: world.agent, dealId: world.A.dealId,
        documentId: world.A.documentIds[DocType.CI]!, format, correlationId: corr(),
      });
    }

    const after = await prisma.deal.findUniqueOrThrow({
      where: { id: world.A.dealId },
      select: { unit_price_amount: true, total_amount: true, quantity: true },
    });
    // The unit price is still 1.2345, not 1.23. The total is still 1543.125, not 1543.13.
    expect(after.unit_price_amount!.equals(before.unit_price_amount!)).toBe(true);
    expect(after.total_amount!.equals(before.total_amount!)).toBe(true);
    expect(after.quantity!.equals(before.quantity!)).toBe(true);
    expect(after.unit_price_amount!.toString()).toBe('1.2345');

    const rateAfter = await prisma.exchangeRateQuote.findFirstOrThrow({
      where: { exporter_org_id: world.A.orgId }, select: { rate: true },
    });
    expect(rateAfter.rate.equals(rateBefore.rate)).toBe(true);

    const insuranceAfter = await prisma.insuranceCase.findFirstOrThrow({
      where: { deal_id: world.A.dealId }, select: { premium_amount: true, covered_amount: true },
    });
    expect(insuranceAfter.premium_amount!.equals(insuranceBefore.premium_amount!)).toBe(true);
    expect(insuranceAfter.covered_amount!.equals(insuranceBefore.covered_amount!)).toBe(true);
  });

  test('the frozen context carries full precision and the policy that presents it', async () => {
    const world = await buildPilotWorld();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await renderDocumentArtifact({
      actor: world.agent, dealId: world.A.dealId,
      documentId: world.A.documentIds[DocType.CI]!, format: 'html', correlationId: corr(),
    });

    const snapshot = await prisma.documentInputSnapshot.findFirstOrThrow({
      where: { deal_id: world.A.dealId, doc_type: DocType.CI },
    });
    const context = snapshot.context as unknown as {
      money_policy_version: string; builder_version: number;
      deal: { goods_total: { amount: string } };
    };

    expect(context.money_policy_version).toBe(DOCUMENT_MONEY_POLICY_VERSION);
    expect(context.builder_version).toBe(3);
    // The snapshot stores the EXACT value. Rounding is presentation, so it is not baked in.
    expect(new Prisma.Decimal(context.deal.goods_total.amount).equals(new Prisma.Decimal('1543.125'))).toBe(true);
  });

  test('a historical snapshot renders under the policy it was frozen with', async () => {
    const world = await buildPilotWorld();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await renderDocumentArtifact({
      actor: world.agent, dealId: world.A.dealId,
      documentId: world.A.documentIds[DocType.CI]!, format: 'html', correlationId: corr(),
    });
    const snapshot = await prisma.documentInputSnapshot.findFirstOrThrow({
      where: { deal_id: world.A.dealId, doc_type: DocType.CI },
    });
    const frozen = snapshot.context as unknown as { money_policy_version: string };

    // A later policy version exists. The frozen document does not use it.
    expect(() => resolveMoneyPolicy('v2')).toThrow(/Unknown document money policy/);
    expect(resolveMoneyPolicy(frozen.money_policy_version).version).toBe('v1');

    // Rendering reads the version off the snapshot, so the amount is the v1 amount.
    const { buildDocumentModel } = await import('../src/lib/document-generation');
    const model = buildDocumentModel(
      DocType.CI, snapshot.context as never,
      { brand_name: 'ClearTrade AI', generated_at: new Date(), audit_id: 'X', draft: false },
      snapshot.content_hash,
    );
    expect(JSON.stringify(model)).toContain('USD 1,543.13');
  });

  test('a snapshot predating the policy field still renders, under v1', async () => {
    // Snapshots frozen before Phase 8.1 have no `money_policy_version`. They must not fail, and
    // they must not silently adopt whatever policy ships later.
    const legacyShape = { money_policy_version: undefined as unknown as string };
    expect(resolveMoneyPolicy(legacyShape.money_policy_version).version).toBe('v1');
    expect(formatDocumentMoney('1543.125', 'USD', legacyShape.money_policy_version)).toBe('USD 1,543.13');
  });

  test('the snapshot remains immutable', async () => {
    const world = await buildPilotWorld();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await renderDocumentArtifact({
      actor: world.agent, dealId: world.A.dealId,
      documentId: world.A.documentIds[DocType.CI]!, format: 'html', correlationId: corr(),
    });
    const snapshot = await prisma.documentInputSnapshot.findFirstOrThrow({
      where: { deal_id: world.A.dealId, doc_type: DocType.CI },
    });
    await expect(prisma.documentInputSnapshot.update({
      where: { id: snapshot.id }, data: { content_hash: 'a'.repeat(64) },
    })).rejects.toThrow(/immutable/i);
  });
});

describe('rounding happens once, at the boundary', () => {
  test('intermediate derivations are not rounded', async () => {
    const world = await buildPilotWorld();
    const context = await buildDocumentContext(world.agent, world.A.dealId, DocType.CI);

    // Line total, goods total and FOB all still carry the exact 1543.125 in the context.
    for (const value of [
      context.deal.items[0]!.line_total!.amount,
      context.deal.goods_total!.amount,
      context.financial.fob_value!.amount,
    ]) {
      expect(new Prisma.Decimal(value).equals(new Prisma.Decimal('1543.125'))).toBe(true);
    }

    // And the INR conversion multiplies the UNROUNDED value, so rounding once at the end is
    // not the same as rounding twice along the way.
    const roundedFirst = new Prisma.Decimal(roundDocumentMoney('1543.125', 'USD')).mul(new Prisma.Decimal('88.425375'));
    const exactChain = new Prisma.Decimal('1543.125').mul(new Prisma.Decimal('88.425375'));
    expect(new Prisma.Decimal(context.financial.invoice_total_in_quote_currency!.amount).equals(exactChain)).toBe(true);
    expect(roundedFirst.equals(exactChain)).toBe(false);
  });

  test('a single-line deal keeps its total equal to its line amount', async () => {
    const world = await buildPilotWorld();
    const context = await buildDocumentContext(world.agent, world.A.dealId, DocType.CI);
    // The data model carries one product line per deal, so the total IS the line amount and
    // there is no sum-of-rounded-lines question to answer. If multi-line deals ever arrive,
    // that sequence has to be decided then rather than guessed now.
    expect(context.deal.items).toHaveLength(1);
    expect(formatDocumentMoney(context.deal.items[0]!.line_total!.amount, 'USD'))
      .toBe(formatDocumentMoney(context.deal.goods_total!.amount, 'USD'));
  });
});
