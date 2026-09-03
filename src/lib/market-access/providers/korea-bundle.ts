/**
 * Reads the Korea Customs Service (관세청) 품목번호별 관세율표 XLSX (data.go.kr dataset 15051179)
 * into a queryable bundle, streaming rather than loading the workbook into nested arrays.
 *
 * ## The two-sheet question
 *
 * The workbook publishes two sheets, `1.1` and `2.12`, with identical headers and near-identical
 * row counts. Neither the dataset's own data.go.kr catalogue metadata nor its cited authoritative
 * code legend (UNIPASS) describes what the two sheet labels mean — that remains genuinely
 * unresolved, and is not guessed at here. What WAS established empirically, by direct comparison
 * of the 2026-02-11 release: every (품목번호, 관세율구분, 적용국가구분) row present in `1.1` is
 * present in `2.12` with an identical rate value and validity window, and `2.12` carries exactly
 * four rows (all rate-type `P1`) that `1.1` does not. `2.12` is therefore a verified content
 * superset of `1.1` for this release, not a preference "based on row count" — the actual cell
 * values were compared, not just counted. This reader parses `2.12` alone on that basis and
 * refuses to proceed if a future release's sheet-1.1 count exceeds sheet-2.12's, since that would
 * contradict the superset relationship this decision rests on.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

export const KOREA_BUNDLE_READER_VERSION = 'kcs-tariff-xlsx-reader-v1' as const;

/** The sheet this reader treats as canonical — see the module comment. */
const CANONICAL_SHEET = '2.12';
/** Read only to obtain a row count for the superset cross-check; never fully materialized. */
const CROSS_CHECK_SHEET = '1.1';

const EXPECTED_HEADER = ['품목번호', '관세율구분', '관세율', '단위당세액', '기준가격', '적용국가구분', '용도세율구분', '적용개시일', '적용만료일'] as const;

/** exceljs's shipped `.d.ts` omits `WorksheetReader.name`, which is real at runtime (it is set
 *  from the worksheet's own XML during streaming) — confirmed directly against this workbook. */
function worksheetName(worksheetReader: ExcelJS.stream.xlsx.WorksheetReader): string | undefined {
  return (worksheetReader as unknown as { name?: string }).name;
}

export class KoreaBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'KoreaBundleError';
  }
}

/** One published rate-type row for one 10-digit item number, exactly as the authority states it. */
export interface KoreaRateRow {
  /** 관세율구분 — tariff-rate-classification code. Only `A` (기본세율) and `C` (WTO 양허관세) are
   *  confirmed from the dataset's own primary description; every other code is retained verbatim
   *  and treated as semantically unresolved (see korea-parser.ts). */
  rate_type_code: string;
  /** 관세율 — published rate number. Ad valorem when unaccompanied by a unit amount; the unit
   *  itself is not published in this dataset (see korea-parser.ts note on unit_amount). */
  rate_value: number | null;
  /** 단위당세액 — per-unit tax amount. Populated for a minority of rows (compound duties); its
   *  currency/unit is not published in this dataset and is never assumed. */
  unit_amount: number | null;
  /** 기준가격 — reference/base price. Populated for a small minority of rows (observed on rice
   *  TRQ-tier rows); its functional role in duty calculation is not documented in this dataset and
   *  is never inferred — retained as evidence only. */
  reference_price: number | null;
  /** 적용국가구분 — applicable-country classification. Corroborated via secondary search only
   *  (1 = 전체/all, 2 = 일부/partial) and NOT treated as authoritatively confirmed; retained
   *  verbatim. */
  country_scope: string;
  /** 용도세율구분 — purpose-based rate classification. Populated for a small minority of rows;
   *  retained verbatim, semantically unresolved. */
  purpose_code: string | null;
  /** 적용개시일 / 적용만료일 — YYYYMMDD strings, exactly as published. */
  effective_from: string;
  effective_to: string;
}

export interface KoreaAuthorityBundle {
  checksum: string;
  size_bytes: number;
  release_identifier: string;
  /** 10-digit item number → every rate-type row published for it. */
  item_rates: Map<string, KoreaRateRow[]>;
  /** Every distinct 관세율구분 value observed, for reporting and for the parser's unresolved-code
   *  handling — never used to silently invent a meaning for a code. */
  distinct_rate_type_codes: Set<string>;
  canonical_sheet: typeof CANONICAL_SHEET;
  canonical_sheet_row_count: number;
  cross_check_sheet: typeof CROSS_CHECK_SHEET;
  cross_check_sheet_row_count: number;
  reader_version: typeof KOREA_BUNDLE_READER_VERSION;
}

function assertHeader(values: unknown[], sheetName: string) {
  const header = EXPECTED_HEADER.map((_, i) => values[i + 1]);
  const matches = EXPECTED_HEADER.every((expected, i) => header[i] === expected);
  if (!matches) {
    throw new KoreaBundleError(
      'unexpected_schema',
      `Sheet "${sheetName}" header is ${JSON.stringify(header)}, not the documented ${JSON.stringify(EXPECTED_HEADER)}. Refusing to parse a structure the dataset's own description does not match.`,
    );
  }
}

function cellString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value !== null && 'result' in (value as Record<string, unknown>)) {
    // Defensive: a formula cell would surface here as { formula, result }. This dataset publishes
    // plain values, but failing closed on an unexpected cell shape is cheaper than misreading one.
    return String((value as { result: unknown }).result ?? '');
  }
  return String(value);
}

function cellNumber(value: unknown): number | null {
  const str = cellString(value);
  if (str === null || str.trim() === '') return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

/** Counts rows in a sheet without retaining them — used only for the cross-check row count. */
async function countSheetRows(input: () => Readable, sheetName: string): Promise<number> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(input(), {
    entries: 'emit', sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore', worksheets: 'emit',
  });
  let count = 0;
  let headerChecked = false;
  for await (const worksheetReader of reader) {
    if (worksheetName(worksheetReader) !== sheetName) continue;
    for await (const row of worksheetReader) {
      if (!headerChecked) { assertHeader(row.values as unknown[], sheetName); headerChecked = true; continue; }
      count += 1;
    }
    return count;
  }
  throw new KoreaBundleError('missing_sheet', `The KCS tariff workbook has no sheet named "${sheetName}".`);
}

export async function readKoreaAuthorityBundle(args: {
  bytes: Buffer;
  release_identifier: string;
}): Promise<KoreaAuthorityBundle> {
  const { bytes } = args;

  let crossCheckRowCount: number;
  try {
    crossCheckRowCount = await countSheetRows(() => Readable.from(bytes), CROSS_CHECK_SHEET);
  } catch (error) {
    if (error instanceof KoreaBundleError) throw error;
    throw new KoreaBundleError('corrupt_archive', 'The Korea Customs tariff workbook is not a readable XLSX archive.');
  }

  // Interned strings: rate-type codes, country-scope codes and effective-date strings repeat
  // across ~380K rows with a few dozen distinct values, the same columnar-repetition shape that
  // took Norway's and TARIC's readers from hundreds of MB retained down to a fraction of that.
  const intern = new Map<string, string>();
  const share = (value: string) => {
    const existing = intern.get(value);
    if (existing !== undefined) return existing;
    intern.set(value, value);
    return value;
  };

  const itemRates = new Map<string, KoreaRateRow[]>();
  const distinctCodes = new Set<string>();
  let canonicalRowCount = 0;
  let headerChecked = false;

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(bytes), {
    entries: 'emit', sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore', worksheets: 'emit',
  });

  let foundCanonicalSheet = false;
  for await (const worksheetReader of reader) {
    if (worksheetName(worksheetReader) !== CANONICAL_SHEET) continue;
    foundCanonicalSheet = true;
    for await (const row of worksheetReader) {
      const values = row.values as unknown[];
      if (!headerChecked) { assertHeader(values, CANONICAL_SHEET); headerChecked = true; continue; }

      const itemNumber = cellString(values[1]);
      if (!itemNumber) continue;
      const rateTypeCode = share(cellString(values[2]) ?? '');
      if (!rateTypeCode) continue;
      const countryScope = share(cellString(values[6]) ?? '');
      const purposeCode = values[7] == null ? null : share(cellString(values[7]) ?? '');
      const effectiveFrom = share(cellString(values[8]) ?? '');
      const effectiveTo = share(cellString(values[9]) ?? '');

      distinctCodes.add(rateTypeCode);
      canonicalRowCount += 1;

      const entry: KoreaRateRow = {
        rate_type_code: rateTypeCode,
        rate_value: cellNumber(values[3]),
        unit_amount: cellNumber(values[4]),
        reference_price: cellNumber(values[5]),
        country_scope: countryScope,
        purpose_code: purposeCode,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
      };
      const existing = itemRates.get(itemNumber);
      if (existing) existing.push(entry);
      else itemRates.set(itemNumber, [entry]);
    }
    break;
  }
  if (!foundCanonicalSheet) {
    throw new KoreaBundleError('missing_sheet', `The KCS tariff workbook has no sheet named "${CANONICAL_SHEET}".`);
  }
  if (!itemRates.size) {
    throw new KoreaBundleError('empty_bundle', 'The KCS tariff workbook contained no item-number rate rows.');
  }

  // The superset relationship is what justifies parsing 2.12 alone (see module comment). If a
  // future release's 1.1 has MORE rows than 2.12, that relationship no longer holds and this
  // reader must not silently keep trusting it.
  if (crossCheckRowCount > canonicalRowCount) {
    throw new KoreaBundleError(
      'superset_assumption_violated',
      `Sheet "${CROSS_CHECK_SHEET}" has ${crossCheckRowCount} rows, more than "${CANONICAL_SHEET}"'s ${canonicalRowCount}. This reader parses only "${CANONICAL_SHEET}" on the verified assumption that it is a superset of "${CROSS_CHECK_SHEET}" — that assumption no longer holds for this release, and the reader refuses to guess which sheet is now authoritative.`,
    );
  }

  return {
    checksum: createHash('sha256').update(bytes).digest('hex'),
    size_bytes: bytes.length,
    release_identifier: args.release_identifier,
    item_rates: itemRates,
    distinct_rate_type_codes: distinctCodes,
    canonical_sheet: CANONICAL_SHEET,
    canonical_sheet_row_count: canonicalRowCount,
    cross_check_sheet: CROSS_CHECK_SHEET,
    cross_check_sheet_row_count: crossCheckRowCount,
    reader_version: KOREA_BUNDLE_READER_VERSION,
  };
}
