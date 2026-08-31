/**
 * "Improve this analysis" — turn an unavailable pillar into something someone can actually do.
 *
 * Country Truth is not a static report: confidence is low because specific evidence is missing,
 * and each missing item has an owner. Getting the owner right is the whole point of this file.
 *
 * ClearTrade owns everything the exporter has no way to establish and should never be asked
 * for: FX rates, the ClearTrade fee, customs valuation law, authoritative tariff data, freight
 * and CHA quotes, and verification of anything. Asking an SME exporter to "supply the customs
 * valuation basis" is both impossible and a tell that the product does not know its own job.
 *
 * The exporter owns exactly two things: facts about their own product and business, and
 * answers to questions about their own goods.
 */
import type { PillarView } from './market-view';
import type { ProductReadiness } from './readiness';

export type ActionOwner = 'exporter' | 'cleartrade';

export interface ImprovementAction {
  code: string;
  label: string;
  owner: ActionOwner;
  /** What this unblocks, in exporter language. */
  unlocks: string;
  /** Where the exporter goes to do it, when they own it. Null for ClearTrade-owned work. */
  href: string | null;
  detail: string;
}

export interface ImprovementPlan {
  evidence_confidence: number;
  actions: ImprovementAction[];
  exporter_actions: number;
  cleartrade_actions: number;
}

interface Context {
  product_id: string;
  country_code: string;
  /** Outstanding classification questions for this destination, if any. */
  open_classification_questions: number;
  readiness: ProductReadiness;
}

/**
 * Which pillar failures the exporter can actually fix, and with what.
 *
 * A pillar can be unavailable for more than one reason at once (economics needs both a price
 * and freight). Both actions are emitted, correctly owned, rather than one composite item that
 * would be half-actionable.
 */
function actionsForPillar(pillar: PillarView, context: Context): ImprovementAction[] {
  const productHref = `/app/products/${context.product_id}`;
  const actions: ImprovementAction[] = [];

  if (pillar.key === 'market_access') {
    if (context.open_classification_questions > 0) {
      actions.push({
        code: 'answer_classification_questions',
        label: `Answer ${context.open_classification_questions} ${context.open_classification_questions === 1 ? 'question' : 'questions'} about your product`,
        owner: 'exporter',
        unlocks: 'Market access',
        href: `${productHref}/markets/${context.country_code}/classification`,
        detail: 'Your product could fall under more than one tariff line in this destination. A few questions about the goods themselves narrow it down.',
      });
    }
    actions.push({
      code: 'confirm_tariff_line',
      label: 'Confirm the destination tariff line and duty',
      owner: 'cleartrade',
      unlocks: 'Market access',
      href: null,
      detail: 'ClearTrade reads the destination’s official tariff and establishes the duty and any import controls that apply.',
    });
  }

  if (pillar.key === 'export_economics') {
    if (!context.readiness.requirements.find((entry) => entry.code === 'export_price')?.satisfied) {
      actions.push({
        code: 'add_export_price',
        label: 'Add your target export price',
        owner: 'exporter',
        unlocks: 'Export economics',
        href: `${productHref}/facts`,
        detail: 'Your asking price, its currency, the quantity it covers and the Incoterm it is quoted on.',
      });
    }
    if (!context.readiness.requirements.find((entry) => entry.code === 'shipment_size')?.satisfied) {
      actions.push({
        code: 'add_shipment_size',
        label: 'Add your typical shipment size',
        owner: 'exporter',
        unlocks: 'Export economics',
        href: `${productHref}/facts`,
        detail: 'Freight and handling are quoted per shipment or container; a shipment size turns those into a per-unit cost.',
      });
    }
    actions.push({
      code: 'collect_cost_quotes',
      label: 'Collect freight, handling and insurance quotes',
      owner: 'cleartrade',
      unlocks: 'Export economics',
      href: null,
      detail: 'ClearTrade sources these from its partner network. Currency conversion, customs valuation and the ClearTrade fee are handled by ClearTrade and are never asked of you.',
    });
  }

  if (pillar.key === 'exporter_market_fit') {
    for (const code of ['capacity', 'moq', 'packaging', 'lead_time'] as const) {
      const requirement = context.readiness.requirements.find((entry) => entry.code === code);
      if (requirement && !requirement.satisfied) {
        actions.push({
          code: `add_${code}`,
          label: `Add ${requirement.label.toLowerCase()}`,
          owner: 'exporter',
          unlocks: 'Exporter fit',
          href: `${productHref}/facts`,
          detail: requirement.why,
        });
      }
    }
    actions.push({
      code: 'verify_certifications',
      label: 'Verify your certifications',
      owner: 'cleartrade',
      unlocks: 'Exporter fit',
      href: null,
      detail: 'ClearTrade checks your certificates against what this destination requires. You can upload them; verification is ClearTrade’s job.',
    });
  }

  if (pillar.key === 'logistics_feasibility') {
    if (!context.readiness.requirements.find((entry) => entry.code === 'origin_gateway')?.satisfied) {
      actions.push({
        code: 'add_origin_gateway',
        label: 'Confirm your departure port or airport',
        owner: 'exporter',
        unlocks: 'Logistics',
        href: `${productHref}/facts`,
        detail: 'Routes and transit times depend on where the goods leave India from.',
      });
    }
    actions.push({
      code: 'establish_route',
      label: 'Establish a shipping route to this destination',
      owner: 'cleartrade',
      unlocks: 'Logistics',
      href: null,
      detail: 'ClearTrade confirms a sailing or flight route, its transit time and its equipment with a carrier or forwarder.',
    });
  }

  return actions;
}

export function buildImprovementPlan(
  pillars: readonly PillarView[],
  evidenceConfidence: number,
  context: Context,
): ImprovementPlan {
  const actions: ImprovementAction[] = [];
  const seen = new Set<string>();
  for (const pillar of pillars) {
    if (pillar.state !== 'not_established') continue;
    for (const action of actionsForPillar(pillar, context)) {
      // One action can unblock two pillars (a price serves economics and fit). It is listed
      // once, under the first pillar that needs it, so the list is a to-do list and not a
      // restatement of the pillar table.
      if (seen.has(action.code)) continue;
      seen.add(action.code);
      actions.push(action);
    }
  }
  // Exporter-actionable items first: the list exists to be acted on, and the things the
  // exporter can do right now are the only part they can act on.
  actions.sort((left, right) => (left.owner === right.owner ? 0 : left.owner === 'exporter' ? -1 : 1));
  return {
    evidence_confidence: evidenceConfidence,
    actions,
    exporter_actions: actions.filter((action) => action.owner === 'exporter').length,
    cleartrade_actions: actions.filter((action) => action.owner === 'cleartrade').length,
  };
}
