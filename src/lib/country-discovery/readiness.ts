/**
 * Is this product ready to discover markets with, and what would improve the answer?
 *
 * The load-bearing rule: **a missing commercial detail never blocks global discovery.** Demand,
 * growth and competition are computed from destination trade statistics and the product's HS6
 * alone — they do not need the exporter's price, capacity or packaging. Gating the whole
 * journey on facts that only affect later pillars would mean an exporter cannot see a single
 * market until they have filled in a form, which is both false (we CAN answer the demand
 * question) and the fastest way to lose them.
 *
 * So requirements are graded three ways:
 *   - `blocking`     — discovery genuinely cannot run (no confirmed HS6).
 *   - `improves_now` — the fact unlocks a pillar that is currently unavailable.
 *   - `later`        — useful further down the journey; no current pillar depends on it.
 */
import type { Product, ProductClassification } from '@prisma/client';

export type RequirementLevel = 'blocking' | 'improves_now' | 'later';
export type RequirementOwner = 'exporter' | 'cleartrade';

export interface ProductRequirement {
  code: string;
  label: string;
  level: RequirementLevel;
  owner: RequirementOwner;
  /** Plain-language reason this is being asked for. Never jargon. */
  why: string;
  satisfied: boolean;
  /** Which pillar this unlocks, when it unlocks one. */
  unlocks: string | null;
}

export interface ProductReadiness {
  /** True when a global screen can be run right now. */
  can_discover: boolean;
  /** Why not, when `can_discover` is false. */
  blocked_because: string | null;
  classification_ready: boolean;
  hs6: string | null;
  requirements: ProductRequirement[];
  missing_now: number;
  missing_later: number;
}

type ProductFacts = Pick<
  Product,
  | 'price_target_amount' | 'price_target_currency' | 'price_target_quantity_unit' | 'price_target_incoterm'
  | 'capacity_value' | 'capacity_unit' | 'moq_value' | 'moq_unit' | 'lead_time_days'
  | 'packaging_format' | 'shipment_quantity_value' | 'shipment_quantity_unit' | 'origin_gateway_code'
>;

export function assessProductReadiness(
  product: ProductFacts,
  classification: Pick<ProductClassification, 'hs6_code' | 'status'> | null,
): ProductReadiness {
  const classificationReady = classification?.status === 'confirmed' && Boolean(classification.hs6_code);

  const requirements: ProductRequirement[] = [
    {
      code: 'hs_classification',
      label: 'Confirmed HS classification',
      level: 'blocking',
      owner: 'cleartrade',
      why: 'Every market comparison is built from trade recorded against this product’s customs code. Without a confirmed code there is nothing to compare.',
      satisfied: classificationReady,
      unlocks: null,
    },
    {
      code: 'export_price',
      label: 'Target export price',
      level: 'improves_now',
      owner: 'exporter',
      // The economics pillar cannot be computed at all without a priced offer, so this is the
      // one commercial fact that changes an "unavailable" into a number.
      why: 'Your asking price, and what it includes, is what a landed cost is built on. Without it ClearTrade cannot work out what you would actually earn in a market.',
      satisfied: product.price_target_amount != null && Boolean(product.price_target_currency) && Boolean(product.price_target_quantity_unit) && Boolean(product.price_target_incoterm),
      unlocks: 'Export economics',
    },
    {
      code: 'capacity',
      label: 'Production capacity',
      level: 'improves_now',
      owner: 'exporter',
      why: 'Whether you can serve a market depends on how much you can actually make. This is compared against what buyers in each market typically order.',
      satisfied: product.capacity_value != null && Boolean(product.capacity_unit),
      unlocks: 'Exporter fit',
    },
    {
      code: 'moq',
      label: 'Minimum order quantity',
      level: 'improves_now',
      owner: 'exporter',
      why: 'A minimum order larger than what buyers in a market usually buy will rule that market out, and ClearTrade should tell you before you spend time on it.',
      satisfied: product.moq_value != null && Boolean(product.moq_unit),
      unlocks: 'Exporter fit',
    },
    {
      code: 'packaging',
      label: 'Packaging format',
      level: 'improves_now',
      owner: 'exporter',
      why: 'Some destinations set packaging and retail-pack rules, and the pack size can decide which tariff line your goods fall under.',
      satisfied: Boolean(product.packaging_format),
      unlocks: 'Exporter fit',
    },
    {
      code: 'lead_time',
      label: 'Production lead time',
      level: 'later',
      owner: 'exporter',
      why: 'Used later to check whether you can meet the delivery windows buyers in a market expect.',
      satisfied: product.lead_time_days != null,
      unlocks: 'Exporter fit',
    },
    {
      code: 'shipment_size',
      label: 'Typical shipment size',
      level: 'later',
      owner: 'exporter',
      why: 'Freight and handling are quoted per shipment or per container. Without a shipment size those quotes cannot be turned into a per-unit cost.',
      satisfied: product.shipment_quantity_value != null && Boolean(product.shipment_quantity_unit),
      unlocks: 'Export economics',
    },
    {
      code: 'origin_gateway',
      label: 'Departure port or airport',
      level: 'later',
      owner: 'exporter',
      why: 'Shipping routes and transit times are specific to where the goods leave from.',
      satisfied: Boolean(product.origin_gateway_code),
      unlocks: 'Logistics',
    },
  ];

  const unsatisfied = requirements.filter((requirement) => !requirement.satisfied);
  return {
    can_discover: classificationReady,
    blocked_because: classificationReady
      ? null
      : classification?.hs6_code
        ? 'This product’s HS classification is still being confirmed. ClearTrade will confirm it before markets can be compared.'
        : 'This product does not have an HS classification yet. ClearTrade needs one before it can compare markets.',
    classification_ready: classificationReady,
    hs6: classification?.hs6_code ?? null,
    requirements,
    missing_now: unsatisfied.filter((requirement) => requirement.level === 'improves_now').length,
    missing_later: unsatisfied.filter((requirement) => requirement.level === 'later').length,
  };
}
