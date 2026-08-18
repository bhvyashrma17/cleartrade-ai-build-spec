/**
 * Builds the immutable input a document generator consumes.
 *
 * The whole flow the phase spec asks for lives here:
 *
 *   canonical data -> this builder -> validated immutable input -> engine -> artifact
 *
 * and never `renderer -> Prisma`. This is the only module that reads the database on behalf
 * of a document; everything downstream sees `DocumentGenerationContext` and nothing else.
 *
 * Tenant scoping happens on the way in via `assertOrgAccess`, so an agent building a context
 * for an exporter they are not assigned to gets a 404, not a document.
 *
 * Buyer identity: this reads `Buyer` and the tenant-scoped `BuyerCommercialProfile`. It never
 * touches `RawImportIdentity` — the AES-GCM encrypted trade-data identities behind
 * `src/lib/import-identity.ts` — because that data arrives under source-rights terms that say
 * nothing about printing it on a customs declaration. If a document ever needs it, it goes
 * through the authorised access service and gets audited there, not copied here.
 */

import { createHash } from 'node:crypto';
import type { DocType } from '@prisma/client';
import { assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';
import {
  convertMoney, deriveCif, deriveFob, lineTotal, money, shipmentPackageTotals, sumMoney,
} from './derive';
import {
  DOCUMENT_CONTEXT_BUILDER_VERSION,
  type ContextAddress, type ContextLocation, type ContextPackageLine,
  type DocumentGenerationContext,
} from './types';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
/** Trims to null so an empty string never reaches a document as a present-but-blank field. */
const text = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

function address(parts: {
  line1?: string | null; line2?: string | null; city?: string | null;
  region?: string | null; postal_code?: string | null; country_code?: string | null;
}): ContextAddress {
  return {
    line1: text(parts.line1), line2: text(parts.line2), city: text(parts.city),
    region: text(parts.region), postal_code: text(parts.postal_code),
    country_code: text(parts.country_code),
  };
}

function location(name: string | null, unlocode: string | null, country: string | null): ContextLocation {
  return { name: text(name), unlocode: text(unlocode), country_code: text(country) };
}

/**
 * The exchange rate that applies to a deal's currency.
 *
 * "Applies" means: the most recent quote for this org and currency pair whose `rate_date` is
 * on or before the reference date. Choosing the latest quote outright would let a rate
 * recorded next week retroactively apply to a document dated today.
 */
async function applicableExchangeRate(exporterOrgId: string, baseCurrency: string | null, on: Date) {
  if (!baseCurrency || baseCurrency === 'INR') return null;
  return prisma.exchangeRateQuote.findFirst({
    where: {
      exporter_org_id: exporterOrgId,
      base_currency: baseCurrency,
      quote_currency: 'INR',
      rate_date: { lte: on },
    },
    orderBy: [{ rate_date: 'desc' }, { created_at: 'desc' }],
  });
}

export async function buildDocumentContext(
  principal: Principal,
  dealId: string,
  docType: DocType,
  options: { on?: Date; documentVersion?: number } = {},
): Promise<DocumentGenerationContext> {
  const on = options.on ?? new Date();

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      exporter_org: true,
      buyer: true,
      product: true,
      shipments: { orderBy: { created_at: 'asc' }, take: 1, include: { packages: { orderBy: { sequence: 'asc' } } } },
      insurance_cases: { orderBy: { created_at: 'desc' }, take: 1 },
    },
  });
  if (!deal) throw new Error(`Deal ${dealId} not found.`);
  await assertOrgAccess(principal, deal.exporter_org_id);

  const org = deal.exporter_org;
  const profile = await prisma.buyerCommercialProfile.findUnique({
    where: { exporter_org_id_buyer_id: { exporter_org_id: deal.exporter_org_id, buyer_id: deal.buyer_id } },
  });

  const shipment = deal.shipments[0] ?? null;
  const insurance = deal.insurance_cases[0] ?? null;
  const currency = deal.total_currency ?? deal.value_currency ?? deal.unit_price_currency ?? null;

  // A deal carries one product line today. Modelled as an array because every renderer
  // iterates line items, so a future multi-line deal does not change the contract.
  const items = deal.product
    ? [{
        description: text(deal.product.description) ?? deal.product.name,
        hs_code: text(deal.product.hs_code),
        itc_hs_code: text(deal.product.itc_hs_code),
        quantity: deal.quantity !== null ? { value: deal.quantity.toString(), unit: text(deal.unit) } : null,
        unit_price: money(deal.unit_price_amount, deal.unit_price_currency),
        line_total: lineTotal(deal.quantity, deal.unit_price_amount, deal.unit_price_currency),
      }]
    : [];

  // Prefer the summed line items over the stored contract total: the sum is derived from the
  // quantities and prices the document itself prints, so the two can never disagree on the
  // page. The stored total is the fallback for a deal with no product line.
  const goodsTotal = sumMoney(items.map((i) => i.line_total)) ?? money(deal.total_amount, deal.total_currency);

  const packages: ContextPackageLine[] = (shipment?.packages ?? []).map((p) => ({
    sequence: p.sequence,
    package_type: p.package_type,
    package_count: p.package_count,
    net_weight_kg: p.net_weight_kg?.toString() ?? null,
    gross_weight_kg: p.gross_weight_kg?.toString() ?? null,
    volume_cbm: p.volume_cbm?.toString() ?? null,
    dimensions_cm:
      p.length_cm || p.width_cm || p.height_cm
        ? {
            length: p.length_cm?.toString() ?? null,
            width: p.width_cm?.toString() ?? null,
            height: p.height_cm?.toString() ?? null,
          }
        : null,
    contents_description: text(p.contents_description),
  }));

  const freight = money(shipment?.freight_amount ?? null, shipment?.freight_currency ?? null);
  // Insurance comes from InsuranceCase, which already owns it — not from a second copy on
  // Shipment. `premium_amount` is the cost that enters a CIF valuation; `covered_amount` is
  // the sum insured, which is a different fact and belongs to the insurance declaration.
  const insurancePremium = money(insurance?.premium_amount ?? null, insurance?.premium_currency ?? null);
  const otherCharges = money(shipment?.other_charges_amount ?? null, shipment?.other_charges_currency ?? null);

  const fob = deriveFob(goodsTotal, deal.incoterm, freight, insurancePremium);
  const cif = deriveCif(fob, freight, insurancePremium);

  const rate = await applicableExchangeRate(deal.exporter_org_id, currency, on);
  const issuedNumber = await prisma.issuedInvoiceNumber.findFirst({
    where: { deal_id: deal.id, voided_at: null },
  });

  return {
    builder_version: DOCUMENT_CONTEXT_BUILDER_VERSION,
    doc_type: docType,
    built_at: on.toISOString(),

    exporter: {
      org_id: org.id,
      legal_name: text(org.legal_name),
      display_name: org.display_name,
      address: address({
        line1: org.address_line1, line2: org.address_line2, city: org.city,
        region: org.state, postal_code: org.postal_code, country_code: org.country,
      }),
      iec_number: text(org.iec_number),
      iec_status: org.iec,
      gstin: text(org.gstin),
      ad_code: text(org.ad_code),
      // Country of origin of the goods. Taken from the exporter's country because ClearTrade
      // is an India-export product and no model asserts a different origin; the moment a
      // product can be re-exported this needs its own owner rather than this shortcut.
      country_of_origin: text(org.country),
    },

    buyer: {
      buyer_id: deal.buyer.id,
      document_name: text(profile?.document_name) ?? deal.buyer.legal_name,
      legal_name: deal.buyer.legal_name,
      address: address({
        line1: profile?.address_line1, line2: profile?.address_line2, city: profile?.city,
        region: profile?.region, postal_code: profile?.postal_code,
        country_code: profile?.country_code ?? deal.buyer.country_code,
      }),
      tax_identifier: text(profile?.tax_identifier),
      tax_identifier_type: text(profile?.tax_identifier_type),
      contact_email: text(profile?.contact_email),
      contact_phone: text(profile?.contact_phone),
    },

    deal: {
      deal_id: deal.id,
      stage: deal.stage,
      incoterm: text(deal.incoterm),
      incoterm_place: text(deal.incoterm_place),
      payment_terms: deal.payment_terms ?? null,
      buyer_reference: text(deal.buyer_reference),
      currency,
      goods_total: goodsTotal,
      items,
    },

    shipment: {
      shipment_id: shipment?.id ?? null,
      status: shipment?.status ?? null,
      mode: shipment?.mode ?? null,
      port_of_loading: location(
        shipment?.port_of_loading_name ?? null,
        shipment?.port_of_loading_unlocode ?? null,
        shipment?.port_of_loading_country ?? null,
      ),
      port_of_discharge: location(
        shipment?.port_of_discharge_name ?? null,
        shipment?.port_of_discharge_unlocode ?? null,
        shipment?.port_of_discharge_country ?? null,
      ),
      final_destination_country: text(shipment?.final_destination_country),
      vessel_or_flight_no: text(shipment?.vessel_or_flight_no),
      voyage_no: text(shipment?.voyage_no),
      container_no: text(shipment?.container_no),
      container_type: text(shipment?.container_type),
      seal_no: text(shipment?.seal_no),
      transport_document_type: shipment?.transport_document_type ?? null,
      transport_document_no: text(shipment?.transport_document_no),
      transport_document_date: iso(shipment?.transport_document_date),
      shipping_bill_no: text(shipment?.shipping_bill_no),
      shipping_bill_date: iso(shipment?.shipping_bill_date),
      marks_and_numbers: text(shipment?.marks_and_numbers),
      shipped_on_date: iso(shipment?.shipped_on_date),
      packages,
      package_totals: shipmentPackageTotals(packages),
    },

    financial: {
      freight,
      insurance: insurancePremium,
      insurance_policy: insurance
        ? {
            policy_ref: text(insurance.policy_ref),
            provider_name: text(insurance.provider_name),
            status: insurance.status,
            covered_amount: money(insurance.covered_amount, insurance.covered_currency),
          }
        : null,
      other_charges: otherCharges,
      fob_value: fob,
      cif_value: cif,
      invoice_total: goodsTotal,
      exchange_rate: rate
        ? {
            base_currency: rate.base_currency,
            quote_currency: rate.quote_currency,
            rate: rate.rate.toString(),
            source: rate.source,
            source_reference: text(rate.source_reference),
            rate_date: rate.rate_date.toISOString(),
          }
        : null,
      invoice_total_in_quote_currency: convertMoney(
        goodsTotal, rate?.rate.toString() ?? null, rate?.quote_currency ?? null,
      ),
    },

    references: {
      // Present only when formally issued. Building a context never allocates one.
      invoice_number: issuedNumber?.formatted_number ?? null,
      invoice_date: iso(issuedNumber?.issued_at),
      deal_id: deal.id,
      document_version: options.documentVersion ?? null,
    },
  };
}

/**
 * SHA-256 over the context, with object keys sorted at every level.
 *
 * Key order in JSON is an artefact of how the object was built, not part of its meaning, so
 * hashing the raw `JSON.stringify` output would report a change when nothing changed. Sorting
 * makes the hash a property of the DATA — which is what "the snapshot hash remains stable"
 * has to mean.
 *
 * `built_at` is excluded for the same reason: it says when the context was assembled, not
 * what it contains. Including it would give two snapshots of identical canonical data
 * different hashes, which destroys the one question the hash is good at answering — "has
 * anything actually changed since the last version?"
 */
export function hashContext(context: DocumentGenerationContext): string {
  const { built_at: _built_at, ...hashable } = context;
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>).sort()
          .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
      );
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical(hashable))).digest('hex');
}
