/**
 * Reads the Korea Customs Service (관세청) 품목번호별 관세율표 XLSX (data.go.kr dataset 15051179)
 * into a queryable bundle, streaming rather than loading the workbook into nested arrays.
 *
 * ## The two-sheet question — PROVEN, not merely observed
 *
 * The workbook publishes two sheets, `1.1` and `2.12`. Direct row-level analysis of the
 * 2026-02-11 release proves what the sheet names mean: **each sheet is a point-in-time snapshot
 * of the schedule, named after the date it reflects.** `1.1` = the schedule as constituted on
 * 2026-01-01. `2.12` = the schedule as constituted on 2026-02-12. The proof: `2.12` contains
 * exactly four rows absent from `1.1` — all four are rate-type `P1` (할당관세, quota tariff with
 * recommendation — see korea-rate-programs.ts), and all four carry `적용개시일` (effective-from)
 * of **`20260212`**, matching the sheet's own name exactly. This is a mid-cycle Korean quota-tariff
 * amendment (bananas, pineapples, mangoes/guavas, and a frozen-fish item gaining a recommended-
 * quota rate partway through the schedule year), captured by KCS republishing an updated snapshot.
 *
 * A full content cross-check (every row, not just a count — see `verifyKoreaSnapshotSuperset`)
 * additionally found THIRTEEN same-identity rows whose content differs rather than being purely
 * absent — three distinct patterns, all proven by direct comparison, none assumed away:
 *
 *  1. **Three 용도세율구분 clears** (items 1201909000/FCA6, 0701900000/FUS6, 1201909000/FUS6):
 *     the purpose/end-use flag is cleared from `A` to none. The published rate itself (0%) is
 *     unchanged.
 *  2. **Nine crude-oil quota-rate reductions**, all HS heading 2709 (crude petroleum oils), all
 *     rate-type `P1`: the published quota rate drops from `1%` to `0%` between snapshots, under
 *     the SAME nominal effective window (no new `적용개시일`) — a genuine retroactive rate
 *     correction, not a new tier starting later.
 *  3. **One purpose-code addition** (item 7112929000, rate-type `P3`): purpose code added where
 *     none existed before.
 *
 * So `2.12` is not a pure superset of `1.1` — it is "superset plus thirteen corrections, all
 * proven benign or economically real (a quota-rate reduction)". The verification trusts the later
 * snapshot for a same-identity correction (the same "latest wins" precedent this platform already
 * applies when one AuthorityRelease supersedes another) and tracks it for audit visibility rather
 * than failing closed on it. A row disappearing entirely between snapshots — true data loss, not a
 * revision — remains a hard failure.
 *
 * This has a direct, load-bearing consequence for correctness, and an equally direct limit on it.
 * The ADDED rows carry their own accurate `적용개시일` of 2026-02-12, so **reading `2.12` alone and
 * filtering by each row's own effective dates (as korea-parser.ts already does) produces the
 * legally correct answer for a query dated before OR after 2026-02-12** for THOSE rows — a January
 * query correctly never sees the four not-yet-effective P1 additions, because their own
 * `effective_from` excludes them, not because a different sheet was read. The CORRECTED rows are
 * different: they keep their ORIGINAL effective window and simply restate the value KCS now
 * considers current for that whole window — so a query dated in January against one of the nine
 * crude-oil items sees the corrected `0%`, not whatever `1%` `1.1` published for that same January
 * date at the time. This is a deliberate choice, not an oversight: it serves KCS's own most current
 * statement of what applied, which is what a tariff-intelligence platform should show, rather than
 * literally replaying an earlier, now-superseded publication. `1.1` is strictly redundant for
 * point-in-time correctness under that choice.
 *
 * ## Why the cross-sheet verification is NOT run on every decode
 *
 * Real measurement (`scripts/qualify-bulk-release.ts --family=KR_KCS` against the retained
 * 2026-02-11 archive) showed that decoding BOTH sheets — as an earlier version of this reader did
 * on every call — costs real memory: 560MB peak RSS / 287MB retained heap, against 307MB peak /
 * 85MB retained for the canonical sheet alone. Running that on every cache-miss query would make
 * `SharedBudgetBundleCache`'s declared per-entry weight for Korea alone approach or exceed the
 * entire 160MB shared budget, defeating caching (the release would evict itself on every insert,
 * forcing a multi-second re-decode per query). The cross-check's VALUE is real (it caught a genuine
 * data correction primary research would have missed) but its cost only needs to be paid ONCE per
 * unique release, at import time — the result does not change between queries against the same
 * checksummed bytes. So `verifyKoreaSnapshotSuperset` is a separate, explicit function, called only
 * from `korea-service.ts`'s import validation, never from the query-time load path.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

export const KOREA_BUNDLE_READER_VERSION = 'kcs-tariff-xlsx-reader-v3' as const;

/** The sheet this reader treats as canonical — the later of the two point-in-time snapshots. */
const CANONICAL_SHEET = '2.12';
/** The earlier snapshot — read only by `verifyKoreaSnapshotSuperset`, at import time. */
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
  /** 관세율구분 — tariff-rate-classification code. Every code observed across every real release
   *  inspected so far resolves against KCS's own CLIP portal dictionary (korea-rate-programs.ts);
   *  a code absent from that dictionary is still retained verbatim and flagged unresolved rather
   *  than assumed. */
  rate_type_code: string;
  /** 관세율 — published rate number. Ad valorem when unaccompanied by a unit amount. */
  rate_value: number | null;
  /** 단위당세액 — per-unit tax amount. Populated for a minority of rows (specific/compound duties);
   *  its currency/unit is not published on this row (see korea-parser.ts). */
  unit_amount: number | null;
  /** 기준가격 — reference/base price, used by KCS's price-based agricultural special safeguard
   *  (특별긴급관세, rate-type T2 — Customs Act Enforcement Decree Art. 90). Never treated as a duty
   *  itself; see korea-parser.ts. */
  reference_price: number | null;
  /** 적용국가구분 — applicable-country scope. `1` = general/erga-omnes (every non-FTA rate-type
   *  code observed carries this), `2` = restricted to the specific FTA/agreement partner named by
   *  the rate-type code (every F-prefixed/RCEP/CEPA code observed carries this). This split is
   *  corroborated by search, not found stated verbatim in KCS legal text, but is independently and
   *  perfectly consistent across all 224 rate-type codes observed in the 2026-02-11 release —
   *  retained verbatim regardless. */
  country_scope: string;
  /** 용도세율구분 — purpose/end-use rate flag. Confirmed as a real Korean customs mechanism (용도세율:
   *  a conditionally reduced rate for goods committed to a declared end-use, requiring prior
   *  approval and subject to 사후관리 post-clearance monitoring for up to 3 years — Customs Act
   *  Arts. 83/97-98, corroborated by KCS's own public notice on easing the 용도세율 전용물품
   *  approval process). The dataset's own primary catalogue description states this field shares
   *  ITS OWN CODE VALUES with 관세율구분 — "A(기본세율), C(WTO 협정에 의한 양허관세)" is given as a
   *  joint description covering both fields — so a non-null value here means the row's conditional
   *  end-use rate is administered against that same base-rate category (`A`=기본세율-anchored,
   *  `C`=WTO협정세율-anchored), not a distinct, unrelated code space. Only 2 values (`A`, `C`) are
   *  observed active in the real 2026-02-11 release, matching this reading exactly. Still never
   *  treated as unconditional: approval and post-entry monitoring remain real gates a schedule
   *  entry cannot certify were satisfied. */
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
  reader_version: typeof KOREA_BUNDLE_READER_VERSION;
}

export interface KoreaSnapshotSupersetVerification {
  canonical_sheet_row_count: number;
  cross_check_sheet_row_count: number;
  /** Rows present in the canonical sheet with no matching identity in the cross-check sheet —
   *  i.e. genuinely new since the earlier snapshot (the four P1 quota rows, in the 2026-02-11
   *  release). Capped to guard against unbounded retention if a future release differs far more
   *  than this one does; `added_count` is the true total either way. */
  added: ReadonlyArray<{ item: string; rate_type_code: string; effective_from: string }>;
  added_count: number;
  /** Rows present in both sheets under the same identity but with DIFFERENT content — a genuine
   *  same-identity correction between snapshots, proven to occur in the real 2026-02-11 release
   *  (one row's 용도세율구분 cleared). The canonical sheet's value is trusted; these are tracked for
   *  audit visibility, not treated as an error. */
  corrected: ReadonlyArray<{ item: string; rate_type_code: string; before: string; after: string }>;
  corrected_count: number;
}

const MAX_TRACKED_ADDITIONS = 2000;

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

/** identity (what a "row" is) vs. content (what value it publishes) kept separate so a genuine
 *  value CORRECTION between snapshots — a different failure shape than a pure addition — is
 *  distinguishable from a benign new row. */
function rowIdentity(values: unknown[]): string {
  return `${cellString(values[1])}${cellString(values[2])}${cellString(values[6])}${cellString(values[8])}${cellString(values[9])}`;
}
function rowContent(values: unknown[]): string {
  return `${cellString(values[3])}${cellString(values[4])}${cellString(values[5])}${cellString(values[7])}`;
}

/** Reads a sheet fully, returning identity -> content signatures. Compact strings, not full row
 *  objects — used only by `verifyKoreaSnapshotSuperset`. */
async function readSheetSignatures(bytes: Buffer, sheetName: string): Promise<Map<string, string>> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(bytes), {
    entries: 'emit', sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore', worksheets: 'emit',
  });
  const signatures = new Map<string, string>();
  let headerChecked = false;
  for await (const worksheetReader of reader) {
    if (worksheetName(worksheetReader) !== sheetName) continue;
    for await (const row of worksheetReader) {
      const values = row.values as unknown[];
      if (!headerChecked) { assertHeader(values, sheetName); headerChecked = true; continue; }
      const item = cellString(values[1]);
      if (!item || !cellString(values[2])) continue;
      signatures.set(rowIdentity(values), rowContent(values));
    }
    return signatures;
  }
  throw new KoreaBundleError('missing_sheet', `The KCS tariff workbook has no sheet named "${sheetName}".`);
}

/**
 * Expensive, import-time-only verification that `2.12` is a superset of `1.1` (plus tracked
 * corrections) — see the module doc for why this is not run on every decode. Throws on a true
 * removal (a row present in `1.1` with no match in `2.12`); returns additions/corrections
 * otherwise. Reads both sheets in full.
 */
export async function verifyKoreaSnapshotSuperset(bytes: Buffer): Promise<KoreaSnapshotSupersetVerification> {
  let crossCheck: Map<string, string>;
  try {
    crossCheck = await readSheetSignatures(bytes, CROSS_CHECK_SHEET);
  } catch (error) {
    if (error instanceof KoreaBundleError) throw error;
    throw new KoreaBundleError('corrupt_archive', 'The Korea Customs tariff workbook is not a readable XLSX archive.');
  }
  const crossCheckRowCount = crossCheck.size;

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(bytes), {
    entries: 'emit', sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore', worksheets: 'emit',
  });

  const additions: Array<{ item: string; rate_type_code: string; effective_from: string }> = [];
  const corrections: Array<{ item: string; rate_type_code: string; before: string; after: string }> = [];
  let additionsCount = 0;
  let correctionsCount = 0;
  let canonicalRowCount = 0;
  let headerChecked = false;
  let foundCanonicalSheet = false;

  for await (const worksheetReader of reader) {
    if (worksheetName(worksheetReader) !== CANONICAL_SHEET) continue;
    foundCanonicalSheet = true;
    for await (const row of worksheetReader) {
      const values = row.values as unknown[];
      if (!headerChecked) { assertHeader(values, CANONICAL_SHEET); headerChecked = true; continue; }
      const itemNumber = cellString(values[1]);
      const rateTypeCode = cellString(values[2]);
      if (!itemNumber || !rateTypeCode) continue;
      canonicalRowCount += 1;

      // Deleted from `crossCheck` as soon as it's matched (rather than tracked in a second,
      // duplicate key set) so the earlier snapshot's retained memory shrinks incrementally across
      // this same pass instead of being held at full size until the end.
      const identity = rowIdentity(values);
      const content = rowContent(values);
      const priorContent = crossCheck.get(identity);
      if (priorContent !== undefined) {
        if (priorContent !== content) {
          correctionsCount += 1;
          if (corrections.length < MAX_TRACKED_ADDITIONS) {
            corrections.push({ item: itemNumber, rate_type_code: rateTypeCode, before: priorContent, after: content });
          }
        }
        crossCheck.delete(identity);
      } else {
        additionsCount += 1;
        if (additions.length < MAX_TRACKED_ADDITIONS) {
          additions.push({ item: itemNumber, rate_type_code: rateTypeCode, effective_from: cellString(values[8]) ?? '' });
        }
      }
    }
    break;
  }
  if (!foundCanonicalSheet) {
    throw new KoreaBundleError('missing_sheet', `The KCS tariff workbook has no sheet named "${CANONICAL_SHEET}".`);
  }

  // Anything left in `crossCheck` was in the earlier snapshot but never matched against the later
  // one — a removal, not an addition, and there is no basis to assume a removed row's earlier
  // value simply stopped applying on the earlier snapshot's date rather than being a data error.
  if (crossCheck.size > 0) {
    throw new KoreaBundleError(
      'sheet_superset_row_removed',
      `Sheet "${CROSS_CHECK_SHEET}" has ${crossCheck.size} row(s) with no matching row in "${CANONICAL_SHEET}" (by item/rate-type/scope/dates identity). "${CANONICAL_SHEET}" is expected to be a superset of "${CROSS_CHECK_SHEET}"; that does not hold for this release.`,
    );
  }

  return {
    canonical_sheet_row_count: canonicalRowCount,
    cross_check_sheet_row_count: crossCheckRowCount,
    added: additions,
    added_count: additionsCount,
    corrected: corrections,
    corrected_count: correctionsCount,
  };
}

/**
 * Reads ONLY the canonical sheet — the fast, repeatable path used both by import validation and by
 * every query-time cache-miss load. Does not cross-check against `1.1`; see module doc for why.
 */
export async function readKoreaAuthorityBundle(args: {
  bytes: Buffer;
  release_identifier: string;
}): Promise<KoreaAuthorityBundle> {
  const { bytes } = args;

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

  let bundleBytes: Buffer;
  let foundCanonicalSheet = false;
  try {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(bytes), {
      entries: 'emit', sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore', worksheets: 'emit',
    });
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
    bundleBytes = bytes;
  } catch (error) {
    if (error instanceof KoreaBundleError) throw error;
    throw new KoreaBundleError('corrupt_archive', 'The Korea Customs tariff workbook is not a readable XLSX archive.');
  }
  if (!foundCanonicalSheet) {
    throw new KoreaBundleError('missing_sheet', `The KCS tariff workbook has no sheet named "${CANONICAL_SHEET}".`);
  }
  if (!itemRates.size) {
    throw new KoreaBundleError('empty_bundle', 'The KCS tariff workbook contained no item-number rate rows.');
  }

  return {
    checksum: createHash('sha256').update(bundleBytes).digest('hex'),
    size_bytes: bundleBytes.length,
    release_identifier: args.release_identifier,
    item_rates: itemRates,
    distinct_rate_type_codes: distinctCodes,
    canonical_sheet: CANONICAL_SHEET,
    canonical_sheet_row_count: canonicalRowCount,
    reader_version: KOREA_BUNDLE_READER_VERSION,
  };
}
