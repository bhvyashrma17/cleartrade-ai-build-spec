export const UZBEKISTAN_REMEDY_REFERENCE_DATE = '2026-09-23' as const;
export const UZBEKISTAN_REMEDY_MANIFEST_VERSION = 'uz-lex-trade-remedies-2026-09-23-v1' as const;

/** A future or draft trade-defence instruction recorded so it is never mistaken for a duty. */
export interface UzbekistanPendingRemedyWork {
  instrument: string;
  status: 'DRAFT_LEGISLATION_TASK';
  due: string;
  summary: string;
  source_url: string;
}

export interface UzbekistanTradeRemedyManifest {
  version: typeof UZBEKISTAN_REMEDY_MANIFEST_VERSION;
  complete_as_of: typeof UZBEKISTAN_REMEDY_REFERENCE_DATE;
  register_enumeration_complete: true;
  enumeration_basis: string;
  active_anti_dumping_count: 0;
  active_countervailing_count: 0;
  active_safeguard_count: 0;
  pending_work: readonly UzbekistanPendingRemedyWork[];
}

/**
 * Uzbekistan's special (anti-dumping, countervailing and safeguard) customs duties can only be
 * imposed by a normative act (Customs Code art. 290 lists them as "особые" duties applied "in the
 * procedure established by legislation"), and every normative act must be published in the National
 * Database of Legislation (lex.uz) to take effect. Full-text searches of that database for
 * антидемпинговая/компенсационная/специальная защитная пошлина return only general framework acts
 * (the Customs Code, ministry statutes, declaration-filling instructions) and no act imposing such a
 * duty on any product. PF-175 of 2026-08-27 only schedules a *draft* law and Cabinet resolution on
 * anti-dumping measures for November 2026: it is future work, not a duty.
 */
export const UZBEKISTAN_TRADE_REMEDY_MANIFEST: UzbekistanTradeRemedyManifest = Object.freeze({
  version: UZBEKISTAN_REMEDY_MANIFEST_VERSION,
  complete_as_of: UZBEKISTAN_REMEDY_REFERENCE_DATE,
  register_enumeration_complete: true,
  enumeration_basis: 'National Database of Legislation (lex.uz) full-text search for anti-dumping, countervailing and special-safeguard duties returned no act imposing a duty; PF-175 (2026-08-27) item 37 schedules only a draft anti-dumping law/resolution for November 2026.',
  active_anti_dumping_count: 0,
  active_countervailing_count: 0,
  active_safeguard_count: 0,
  pending_work: Object.freeze([{
    instrument: 'PF-175 of 2026-08-27, annex item 37',
    status: 'DRAFT_LEGISLATION_TASK',
    due: '2026-11',
    summary: 'Draft law and Cabinet resolution "on additional measures for applying anti-dumping measures" against low-quality and dumped imports; no product, origin or rate is set.',
    source_url: 'https://lex.uz/docs/8442717',
  }]),
}) as UzbekistanTradeRemedyManifest;

export function validateUzbekistanRemedyManifest(manifest: UzbekistanTradeRemedyManifest) {
  if (manifest.version !== UZBEKISTAN_REMEDY_MANIFEST_VERSION || manifest.register_enumeration_complete !== true) throw new Error('Uzbekistan trade-remedy manifest is not the reviewed complete enumeration.');
  if (manifest.active_anti_dumping_count !== 0 || manifest.active_countervailing_count !== 0 || manifest.active_safeguard_count !== 0) throw new Error('Uzbekistan trade-remedy manifest reports active measures without rate evidence.');
  if (manifest.pending_work.some(item => item.status !== 'DRAFT_LEGISLATION_TASK')) throw new Error('Uzbekistan pending trade-remedy work must never be represented as an imposed duty.');
}

/** Investigation or draft work is never a duty; with no imposed measure, remedies are not applicable. */
export function selectUzbekistanTradeRemedies(_args: { manifest: UzbekistanTradeRemedyManifest; code: string; origin_country: string; at: Date }) {
  return { status: 'not_applicable' as const, candidates: [] as const, pending_work: _args.manifest.pending_work };
}
