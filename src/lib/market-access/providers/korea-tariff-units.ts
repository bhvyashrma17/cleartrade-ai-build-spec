/**
 * Korea Customs Service (관세청) HS-line unit mapping — resolves the quantity/weight denominator
 * for every 관세율구분 row that carries a specific/compound duty (`단위당세액` populated) in the
 * real 2026-02-11 품목번호별 관세율표 release.
 *
 * ## Source
 *
 * `관세청_HS부호_20260101.xlsx` (data.go.kr dataset 15049722, same KOGL Type 1 licence as the
 * tariff schedule itself), manually downloaded the same way the main file was — an official KCS
 * XLSX, not an API response. It publishes `수량단위코드` (quantity-unit code) and `중량단위코드`
 * (weight-unit code) per HS10 line. Cross-referenced against every one of the 108 distinct items
 * carrying a compound-duty row in the real release (942 rows total): **zero missing** — every
 * item resolves to at least one candidate unit.
 *
 * ## What "resolved" means here, precisely
 *
 * 105 of 108 items publish `중량단위코드` = `KG` and NO quantity-unit code at all — unambiguous:
 * there is exactly one candidate, so it is the denominator. These are marked `confidence:
 * 'unambiguous'`.
 *
 * 3 items (`3706100000`, `3706900000` — photographic film; `8523292020` — recorded video media)
 * publish BOTH a quantity-unit code AND `KG` — genuinely two candidates, and no source states
 * which one the specific duty actually keys to. For these, the SAME dataset's own product-name
 * field is the deciding evidence, not external general knowledge: 3706's own official name is
 * "폭이 35밀리미터 이상인 것" ("of a width of 35mm or more") — the product is DEFINED by a linear
 * dimension, so its quantity-unit code `M` (metre) is used, matching the item's own stated basis
 * for existing as a separate tariff line; 8523292020's own name is "비디오 녹화된 것" ("recorded
 * video") — a discrete recorded item, matching its quantity-unit code `U` (piece). These are
 * marked `confidence: 'probable_from_item_description'`, and the OTHER candidate (`KG` in both
 * cases) is retained in `alternative_candidate_unit` rather than discarded, so a reviewer can see
 * exactly what was not chosen and why. No row asserts a resolved unit beyond what one of these two
 * confidence tiers supports; there is no "no evidence, guessed anyway" case in this table.
 */

export const KOREA_UNIT_SOURCE_AUTHORITY = 'Korea Customs Service — 관세청_HS부호 (data.go.kr dataset 15049722)' as const;
export const KOREA_UNIT_SOURCE_REFERENCE = 'https://www.data.go.kr/data/15049722/fileData.do (수량단위코드/중량단위코드 columns)' as const;
export const KOREA_UNIT_VERIFIED_AT = '2026-09-04' as const;

/** UN/ECE-style unit codes as published by KCS. Labels are standard trade-unit meanings, not
 *  Korea-specific inventions. */
const UNIT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  KG: 'kilogram', U: 'piece', M: 'metre', M2: 'square metre', M3: 'cubic metre', L: 'litre',
  '2U': 'pair', CR: 'carat', GR: 'gross', ML: 'millilitre', EA: 'each', MW: 'megawatt',
  DRM: 'drum', TU: 'tube',
});

export function koreaUnitLabel(code: string): string {
  return UNIT_LABELS[code] ?? code;
}

export type KoreaUnitConfidence = 'unambiguous' | 'probable_from_item_description';

export interface KoreaTariffUnit {
  item: string;
  /** The resolved denominator code (e.g. `KG`, `M`, `U`). */
  unit_code: string;
  unit_label: string;
  confidence: KoreaUnitConfidence;
  /** The other candidate unit this item's own HS-code record also publishes, when one exists —
   *  present only for `probable_from_item_description` rows, so the un-chosen candidate is never
   *  silently discarded. */
  alternative_candidate_unit: string | null;
  /** The item's own official Korean name, as published in the source — the deciding evidence for
   *  the 3 ambiguous items, kept for every item for auditability. */
  official_item_name_ko: string;
  source_authority: typeof KOREA_UNIT_SOURCE_AUTHORITY;
  source_reference: typeof KOREA_UNIT_SOURCE_REFERENCE;
  verified_at: typeof KOREA_UNIT_VERIFIED_AT;
}

/** [item, quantity_unit_code_or_null, weight_unit_code_or_null, official_korean_item_name] —
 *  extracted directly from dataset 15049722 for every item carrying a compound-duty row in the
 *  2026-02-11 tariff release. Not a general-purpose HS->unit table; scoped to what this release's
 *  compound rows actually need, per the task that requested this be a narrow update. */
const RAW_UNIT_ROWS: ReadonlyArray<readonly [string, string | null, string | null, string]> = [
  ['0301922000', null, 'KG', '새끼뱀장어(한 마리당 0.3그램 초과 50그램 이하인 것으로서 양식용으로 한정한다)'],
  ['0301929010', null, 'KG', '실뱀장어(양식용은 제외한다)'],
  ['0301929090', null, 'KG', '기타'],
  ['0301994091', null, 'KG', '참돔[파그루스 마조르(Pagrus major)] '],
  ['0301994099', null, 'KG', '기타'],
  ['0306951030', null, 'KG', '염장이나 염수장한 것'],
  ['0306959030', null, 'KG', '염장이나 염수장한 것'],
  ['0409000000', null, 'KG', '천연꿀'],
  ['0703101010', null, 'KG', '껍질을 벗긴 것'],
  ['0703101090', null, 'KG', '기타'],
  ['0703201000', null, 'KG', '껍질을 깐 것'],
  ['0703209000', null, 'KG', '기타'],
  ['0706101000', null, 'KG', '당근'],
  ['0709517000', null, 'KG', '양송이 버섯'],
  ['0709519000', null, 'KG', '기타'],
  ['0709520000', null, 'KG', '볼레투스(Boletus)속의 버섯'],
  ['0709530000', null, 'KG', '칸타렐루스(Cantharellus)속의 버섯'],
  ['0709540000', null, 'KG', '표고버섯(Lentinus edodes)'],
  ['0709550000', null, 'KG', '송이버섯(Tricholoma matsutake, Tricholoma magnivelare, Tricholoma anatolicum, Tricholoma dulciolens, Tricholoma caligatum)'],
  ['0709593000', null, 'KG', '영지버섯'],
  ['0709594010', null, 'KG', '큰느타리버섯'],
  ['0709594090', null, 'KG', '기타'],
  ['0709595000', null, 'KG', '팽이버섯'],
  ['0709599000', null, 'KG', '기타'],
  ['0709601000', null, 'KG', '단고추(벨타입으로 한정한다)'],
  ['0709609000', null, 'KG', '기타'],
  ['0709991000', null, 'KG', '고사리'],
  ['0710805000', null, 'KG', '고사리'],
  ['0711400000', null, 'KG', '오이류'],
  ['0711510000', null, 'KG', '아가리쿠스(Agaricus)속의 버섯'],
  ['0711599000', null, 'KG', '기타'],
  ['0711901000', null, 'KG', '마늘'],
  ['0711905010', null, 'KG', '고사리'],
  ['0711905091', null, 'KG', '고추류[캡시컴(Capsicum)속]의 열매나 피멘타(Pimenta)속의 열매'],
  ['0712200000', null, 'KG', '양파'],
  ['0712311000', null, 'KG', '양송이 버섯'],
  ['0712319000', null, 'KG', '기타'],
  ['0712320000', null, 'KG', '목이버섯[오리쿨라리아(Auricularia)속]'],
  ['0712330000', null, 'KG', '젤리균류[트레멜라(Tremella)속]'],
  ['0712340000', null, 'KG', '표고버섯(Lentinus edodes)'],
  ['0712391010', null, 'KG', '송이버섯'],
  ['0712391030', null, 'KG', '영지버섯'],
  ['0712391040', null, 'KG', '느타리버섯'],
  ['0712391050', null, 'KG', '팽이버섯'],
  ['0712391090', null, 'KG', '기타'],
  ['0712901000', null, 'KG', '마늘'],
  ['0712902010', null, 'KG', '고사리'],
  ['0712902020', null, 'KG', '무'],
  ['0712902030', null, 'KG', '대파'],
  ['0712902040', null, 'KG', '당근'],
  ['0712902050', null, 'KG', '호박'],
  ['0712902060', null, 'KG', '양배추'],
  ['0712902070', null, 'KG', '토란줄기'],
  ['0712902094', null, 'KG', '고비'],
  ['0714201000', null, 'KG', '신선한 것'],
  ['0802410000', null, 'KG', '껍데기를 벗기지 않은 것'],
  ['0802420000', null, 'KG', '껍데기를 벗긴 것'],
  ['0802910000', null, 'KG', '잣(껍데기를 벗기지 않은 것)'],
  ['0802920000', null, 'KG', '잣(껍데기를 벗긴 것)'],
  ['0802991010', null, 'KG', '껍데기를 벗기지 않은 것'],
  ['0802991020', null, 'KG', '껍데기를 벗긴 것'],
  ['0810903000', null, 'KG', '대추'],
  ['0813401000', null, 'KG', '감'],
  ['0813402000', null, 'KG', '대추'],
  ['0904210000', null, 'KG', '건조한 것(부수지도 잘게 부수지도 않은 것)'],
  ['0904220000', null, 'KG', '부수거나 잘게 부순 것'],
  ['0910111000', null, 'KG', '신선한 것이나 냉장한 것'],
  ['0910112000', null, 'KG', '건조한 것'],
  ['0910113000', null, 'KG', '냉동한 것 '],
  ['0910119000', null, 'KG', '기타'],
  ['0910121000', null, 'KG', '신선한 것이나 냉장한 것'],
  ['0910122000', null, 'KG', '건조한 것'],
  ['0910123000', null, 'KG', '냉동한 것 '],
  ['0910129000', null, 'KG', '기타'],
  ['1003102000', null, 'KG', '겉보리'],
  ['1003103000', null, 'KG', '쌀보리'],
  ['1003902000', null, 'KG', '겉보리'],
  ['1003903000', null, 'KG', '쌀보리'],
  ['1201101000', null, 'KG', '콩나물용'],
  ['1201109000', null, 'KG', '기타'],
  ['1201901000', null, 'KG', '채유용과 탈지대두박(脫脂大豆粕)용'],
  ['1201902000', null, 'KG', '사료용'],
  ['1201903000', null, 'KG', '콩나물용'],
  ['1201909000', null, 'KG', '기타'],
  ['1207400000', null, 'KG', '참깨'],
  ['1207991000', null, 'KG', '들깨'],
  ['1515500000', null, 'KG', '참기름과 그 분획물'],
  ['1701910000', null, 'KG', '향미제(香味劑)나 착색제가 첨가된 것'],
  ['1701990000', null, 'KG', '기타'],
  ['1902192000', null, 'KG', '당면'],
  ['2003104000', null, 'KG', '양송이 버섯'],
  ['2003109000', null, 'KG', '기타'],
  ['2003909000', null, 'KG', '기타'],
  ['2103909040', null, 'KG', '메주'],
  ['2306901000', null, 'KG', '참깨에서 나온 것'],
  ['2308001000', null, 'KG', '도토리'],
  ['3706100000', 'M', 'KG', '폭이 35밀리미터 이상인 것'],
  ['3706900000', 'M', 'KG', '기타'],
  ['3822900020', null, 'KG', '기타'],
  ['5001000000', null, 'KG', '누에고치(생사를 뽑는 데에 적합한 것으로 한정한다)'],
  ['5002001010', null, 'KG', '20데시텍스 이하인 것'],
  ['5002001020', null, 'KG', '20데시텍스 초과 25.56데시텍스 이하인 것'],
  ['5002001030', null, 'KG', '25.56데시텍스 초과 28.89데시텍스 이하인 것'],
  ['5002001040', null, 'KG', '28.89데시텍스 초과 36.67데시텍스 이하인 것'],
  ['5002001050', null, 'KG', '36.67데시텍스를 초과하는 것'],
  ['5002002000', null, 'KG', '옥사(doupion silk)'],
  ['5002009000', null, 'KG', '기타'],
  ['8523292020', 'U', 'KG', '비디오 녹화된 것'],
];

/** Items where the SAME dataset publishes both a quantity-unit and a weight-unit candidate —
 *  resolved from the item's own official name, not asserted with the same confidence as the
 *  105 unambiguous (weight-only) items. See module doc for the reasoning per item. */
const AMBIGUOUS_ITEM_RESOLUTION: Readonly<Record<string, { chosen: string; reason: string }>> = Object.freeze({
  '3706100000': { chosen: 'M', reason: 'Official item name "폭이 35밀리미터 이상인 것" (width 35mm or more) defines the line by a linear dimension.' },
  '3706900000': { chosen: 'M', reason: 'Same 3706 heading as 3706100000; the sibling line for width under 35mm, same width-based basis.' },
  '8523292020': { chosen: 'U', reason: 'Official item name "비디오 녹화된 것" (recorded video) names a discrete recorded item.' },
});

const REGISTRY: ReadonlyMap<string, KoreaTariffUnit> = new Map(
  RAW_UNIT_ROWS.map(([item, qtyCode, wgtCode, koreanName]) => {
    let unitCode: string;
    let confidence: KoreaUnitConfidence;
    let alternative: string | null;
    if (qtyCode && wgtCode) {
      const resolution = AMBIGUOUS_ITEM_RESOLUTION[item];
      // Fails closed rather than silently picking one: if a future release adds a compound row
      // for an item with two candidates this table has not reasoned through, it must not resolve.
      if (!resolution) {
        return [item, null] as const;
      }
      unitCode = resolution.chosen;
      confidence = 'probable_from_item_description';
      alternative = unitCode === qtyCode ? wgtCode : qtyCode;
    } else {
      const only = qtyCode ?? wgtCode;
      if (!only) return [item, null] as const;
      unitCode = only;
      confidence = 'unambiguous';
      alternative = null;
    }
    const unit: KoreaTariffUnit = {
      item, unit_code: unitCode, unit_label: koreaUnitLabel(unitCode), confidence,
      alternative_candidate_unit: alternative, official_item_name_ko: koreanName,
      source_authority: KOREA_UNIT_SOURCE_AUTHORITY, source_reference: KOREA_UNIT_SOURCE_REFERENCE,
      verified_at: KOREA_UNIT_VERIFIED_AT,
    };
    return [item, unit] as const;
  }).filter((entry): entry is [string, KoreaTariffUnit] => entry[1] !== null),
);

export type KoreaTariffUnitResolution =
  | { resolved: true; unit: KoreaTariffUnit }
  | { resolved: false; item: string };

export function allKoreaTariffUnits(): readonly KoreaTariffUnit[] {
  return [...REGISTRY.values()];
}

/** Look up the resolved specific-duty unit for one 10-digit item number. Never throws and never
 *  guesses: an item outside this table (i.e. a future release's compound row this table has not
 *  been extended to cover) returns `resolved: false` rather than defaulting to KG or anything
 *  else. */
export function resolveKoreaTariffUnit(item: string): KoreaTariffUnitResolution {
  const unit = REGISTRY.get(item);
  return unit ? { resolved: true, unit } : { resolved: false, item };
}
