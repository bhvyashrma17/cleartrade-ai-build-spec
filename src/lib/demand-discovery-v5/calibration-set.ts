/**
 * Stage 1, item 6: the calibration set. Each product's v5 top 10 is compared with India's real export
 * destinations by the docs/36 §8 check (`calibration.ts`): India's top destinations over the years the
 * size measure averages, and a pass when the run's top 10 holds at least half of them.
 *
 * The three Phase 1 archetypes plus fifteen more, one HS 2022 subheading each, chosen to cover the
 * sectors Indian manufacturers export in — food, marine, textiles and apparel, gems and jewellery,
 * pharmaceuticals, engineering, leather, building materials and handicrafts — and destination patterns
 * the score has to read differently: hubs (diamonds and jewellery through Hong Kong, the UAE and
 * Belgium), neighbours (rice, cumin), long-haul buyers (shrimp, pumps). Each run tests for itself
 * whether BACI's HS 2017 years describe the same goods as its HS 2022 years (docs/36 §3.4).
 *
 * A proposed set (E-038): the owner may change it before the staging runs.
 */
import { PHASE_1_GATE_POLICY_V2, type Phase1GateArchetype } from '@/lib/phase-1-gate/policy';

export type CalibrationProduct = Pick<Phase1GateArchetype, 'key' | 'label' | 'hs6' | 'hs_revision'> & { sector: string };

const ARCHETYPE_SECTORS: Readonly<Record<string, string>> = { rice: 'food', brassware: 'handicrafts', carpets: 'textiles' };

export const CALIBRATION_PRODUCTS: readonly CalibrationProduct[] = [
  // The archetypes keep their gate labels, so their test products and runs are shared.
  ...PHASE_1_GATE_POLICY_V2.archetypes.value.map((archetype) => ({ key: archetype.key, label: archetype.label, hs6: archetype.hs6, hs_revision: archetype.hs_revision, sector: ARCHETYPE_SECTORS[archetype.key] ?? 'other' })),
  { key: 'black_tea', label: 'Black tea in packages over 3 kg', hs6: '090240', hs_revision: 'HS2022', sector: 'food' },
  { key: 'cumin', label: 'Cumin seeds, neither crushed nor ground', hs6: '090931', hs_revision: 'HS2022', sector: 'food' },
  { key: 'cashew', label: 'Cashew nuts, shelled', hs6: '080132', hs_revision: 'HS2022', sector: 'food' },
  { key: 'shrimp', label: 'Frozen shrimps and prawns', hs6: '030617', hs_revision: 'HS2022', sector: 'marine' },
  { key: 'cotton_yarn', label: 'Single cotton yarn of uncombed fibres, 232.56–714.29 decitex', hs6: '520512', hs_revision: 'HS2022', sector: 'textiles' },
  { key: 't_shirts', label: 'T-shirts and vests of cotton, knitted', hs6: '610910', hs_revision: 'HS2022', sector: 'apparel' },
  { key: 'bed_linen', label: 'Bed linen of cotton', hs6: '630231', hs_revision: 'HS2022', sector: 'textiles' },
  { key: 'diamonds', label: 'Diamonds, non-industrial, worked', hs6: '710239', hs_revision: 'HS2022', sector: 'gems and jewellery' },
  { key: 'jewellery', label: 'Jewellery of precious metal other than silver', hs6: '711319', hs_revision: 'HS2022', sector: 'gems and jewellery' },
  { key: 'medicaments', label: 'Medicaments in measured doses or retail packs, other', hs6: '300490', hs_revision: 'HS2022', sector: 'pharmaceuticals' },
  { key: 'auto_parts', label: 'Parts and accessories of motor vehicles, other', hs6: '870899', hs_revision: 'HS2022', sector: 'engineering' },
  { key: 'pumps', label: 'Centrifugal pumps, other', hs6: '841370', hs_revision: 'HS2022', sector: 'engineering' },
  { key: 'leather_footwear', label: 'Footwear with leather uppers, other', hs6: '640399', hs_revision: 'HS2022', sector: 'leather' },
  { key: 'ceramic_tiles', label: 'Ceramic tiles absorbing 0.5% of water or less', hs6: '690721', hs_revision: 'HS2022', sector: 'building materials' },
  { key: 'granite', label: 'Granite, worked', hs6: '680293', hs_revision: 'HS2022', sector: 'building materials' },
];
