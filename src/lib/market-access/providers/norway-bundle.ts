import { createHash } from 'node:crypto';
import JSZip from 'jszip';

export const NORWAY_BUNDLE_READER_VERSION = 'tolletaten-bundle-reader-v1' as const;

export class NorwayBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'NorwayBundleError';
  }
}

/** One published rate for one (commodity, country group) pair, with its own validity window. */
export interface NorwayRate {
  /** Verbatim rate value as published, e.g. "10,70" — Norwegian decimal comma preserved. */
  value: string;
  /** P = percent of value, K = per kg, L = per litre, S = per piece. */
  unit: string;
  unit_description: string | null;
  valid_from: string;
  valid_to: string;
}

export interface NorwayCommodityRates {
  /** Eight-digit Norwegian commodity number (varenummer). */
  code: string;
  statistical_unit: string | null;
  supplementary_unit: string | null;
  /** Country-group code → its published rates. `TALL` is the general (MFN) group. */
  groups: Record<string, NorwayRate[]>;
}

export interface NorwayCountryGroup {
  code: string;
  name: string;
  /** Tolletaten's own classification: "P" preferential, "G" GSP, "N" non-preferential. */
  preference_code: string;
  valid_from: string;
  valid_to: string;
}

export interface NorwayGoodsLine {
  code: string;
  unit: string | null;
  unit_description: string | null;
  valid_from: string;
  valid_to: string;
}

/** The authority's own statement of which agreements name a country, per commodity. */
export interface NorwayAgreementEntry {
  /** FREE, NA, or TARIFF. */
  classifier: string;
  value: string | null;
  type: string | null;
  land_codes: string[];
}

export interface NorwayAuthorityBundle {
  checksum: string;
  size_bytes: number;
  files: Array<{ name: string; sha256: string; size_bytes: number; role: string }>;
  release_identifier: string;
  rates_version: string;
  /** Commodity code → rates. A map, not an array: every query is a code lookup. */
  rates: Map<string, NorwayCommodityRates>;
  goods: Map<string, NorwayGoodsLine>;
  country_groups: Map<string, NorwayCountryGroup>;
  agreements: Map<string, NorwayAgreementEntry[]>;
  reader_version: typeof NORWAY_BUNDLE_READER_VERSION;
}

const REQUIRED_FILES = ['tollavgiftssats.json', 'varenummer.json', 'landgruppe.json', 'ratetradeagreements.json', 'acquisition.json'] as const;

function parseJson(name: string, bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new NorwayBundleError('invalid_json', `The retained Tolletaten file ${name} is not valid JSON.`);
  }
}

function requireArray(value: unknown, name: string, field: string): unknown[] {
  const container = value as Record<string, unknown> | null;
  const rows = container?.[field];
  if (!Array.isArray(rows)) {
    throw new NorwayBundleError(
      'unexpected_schema',
      `${name} does not contain the documented "${field}" array; refusing to parse a structure the Tolletaten schema does not describe.`,
    );
  }
  return rows;
}

export async function readNorwayAuthorityBundle(args: {
  bytes: Buffer;
  release_identifier: string;
}): Promise<NorwayAuthorityBundle> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(args.bytes);
  } catch {
    throw new NorwayBundleError('corrupt_archive', 'The Norwegian authority bundle is not a readable archive.');
  }

  const contents = new Map<string, Buffer>();
  for (const name of REQUIRED_FILES) {
    const entry = zip.file(name);
    if (!entry) throw new NorwayBundleError('unexpected_bundle_files', `The Norwegian authority bundle is missing ${name}.`);
    contents.set(name, Buffer.from(await entry.async('nodebuffer')));
  }

  const ratesDoc = parseJson('tollavgiftssats.json', contents.get('tollavgiftssats.json')!) as Record<string, unknown>;
  const ratesRows = requireArray(ratesDoc, 'tollavgiftssats.json', 'varer');

  // Interned strings: Norway's rate table is columnar and highly repetitive — the same group codes,
  // units and dates recur across ~291K rate rows. Sharing one instance per distinct value keeps the
  // decoded bundle's object count proportional to distinct values rather than to cells, the same
  // property that took the TARIC reader from ~505MB retained to ~148MB.
  const intern = new Map<string, string>();
  const share = (value: string) => {
    const existing = intern.get(value);
    if (existing !== undefined) return existing;
    intern.set(value, value);
    return value;
  };

  const rates = new Map<string, NorwayCommodityRates>();
  for (const row of ratesRows as Array<Record<string, unknown>>) {
    const code = String(row.id ?? '').trim();
    if (!code) continue;
    const groups: Record<string, NorwayRate[]> = {};
    for (const agreement of (row.avtalesatser as Array<Record<string, unknown>> | undefined) ?? []) {
      const group = share(String(agreement.landgruppe ?? '').trim());
      if (!group) continue;
      const list: NorwayRate[] = [];
      for (const rate of (agreement.sats as Array<Record<string, unknown>> | undefined) ?? []) {
        list.push({
          value: share(String(rate.satsVerdi ?? '').trim()),
          unit: share(String(rate.satsEnhet ?? '').trim()),
          unit_description: rate.satsEnhetBeskrivelse == null ? null : share(String(rate.satsEnhetBeskrivelse)),
          valid_from: share(String(rate.fomdato ?? '').trim()),
          valid_to: share(String(rate.tomdato ?? '').trim()),
        });
      }
      groups[group] = list;
    }
    rates.set(code, {
      code,
      statistical_unit: row.enhet == null ? null : share(String(row.enhet)),
      supplementary_unit: row.annenEnhet == null ? null : share(String(row.annenEnhet)),
      groups,
    });
  }
  if (!rates.size) throw new NorwayBundleError('empty_rates', 'The Tolletaten duty-rate dataset contained no commodities.');

  const goods = new Map<string, NorwayGoodsLine>();
  for (const row of requireArray(parseJson('varenummer.json', contents.get('varenummer.json')!), 'varenummer.json', 'varenummer') as Array<Record<string, unknown>>) {
    const code = String(row.id ?? '').trim();
    if (!code) continue;
    goods.set(code, {
      code,
      unit: row.enhet == null ? null : share(String(row.enhet)),
      unit_description: row.enhetBeskrivelse == null ? null : share(String(row.enhetBeskrivelse)),
      valid_from: share(String(row.fomdato ?? '').trim()),
      valid_to: share(String(row.tomdato ?? '').trim()),
    });
  }

  const countryGroups = new Map<string, NorwayCountryGroup>();
  for (const row of requireArray(parseJson('landgruppe.json', contents.get('landgruppe.json')!), 'landgruppe.json', 'landgrupper') as Array<Record<string, unknown>>) {
    const code = String(row.landgruppekode ?? '').trim();
    if (!code) continue;
    countryGroups.set(code, {
      code,
      name: String(row.landgruppenavn ?? ''),
      preference_code: String(row.preferansekode ?? '').trim(),
      valid_from: String(row.fomdato ?? '').trim(),
      valid_to: String(row.tomdato ?? '').trim(),
    });
  }

  const agreements = new Map<string, NorwayAgreementEntry[]>();
  for (const row of requireArray(parseJson('ratetradeagreements.json', contents.get('ratetradeagreements.json')!), 'ratetradeagreements.json', 'commodities') as Array<Record<string, unknown>>) {
    const code = String(row.id ?? '').trim();
    if (!code) continue;
    const entries: NorwayAgreementEntry[] = [];
    for (const entry of (row.rateTradeAgreements as Array<Record<string, unknown>> | undefined) ?? []) {
      const duty = (entry.customDuty as Record<string, unknown> | undefined) ?? {};
      entries.push({
        classifier: share(String(duty.classifier ?? '').trim()),
        value: duty.value == null ? null : String(duty.value),
        type: duty.type == null ? null : share(String(duty.type)),
        land_codes: ((entry.landCodes as string[] | undefined) ?? []).map((c) => share(String(c))),
      });
    }
    agreements.set(code, entries);
  }

  const file = (name: string, role: string) => {
    const data = contents.get(name)!;
    return { name, sha256: createHash('sha256').update(data).digest('hex'), size_bytes: data.length, role };
  };

  return {
    checksum: createHash('sha256').update(args.bytes).digest('hex'),
    size_bytes: args.bytes.length,
    files: [
      file('tollavgiftssats.json', 'official_duty_rates'),
      file('varenummer.json', 'official_commodity_numbers'),
      file('landgruppe.json', 'official_country_groups'),
      file('ratetradeagreements.json', 'official_trade_agreements'),
      file('acquisition.json', 'acquisition_manifest'),
    ],
    release_identifier: args.release_identifier,
    rates_version: String(ratesDoc.versjon ?? ''),
    rates,
    goods,
    country_groups: countryGroups,
    agreements,
    reader_version: NORWAY_BUNDLE_READER_VERSION,
  };
}
