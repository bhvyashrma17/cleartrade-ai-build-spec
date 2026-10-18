/**
 * US Treasury Reporting Rates of Exchange (Bureau of the Fiscal Service), via the Fiscal Data API.
 *
 * Source: https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/rates_of_exchange
 * Each row is units of a foreign currency per ONE US dollar. Rates are published quarterly (the
 * record date is the quarter's end) and amended inside a quarter when a currency moves 10% or more:
 * an amendment is a further row under the same record date with a later effective date. The data
 * are a work of the US Government and in the public domain (17 U.S.C. § 105).
 *
 * D-028: v5 uses these only for a currency the ECB does not publish and no published peg covers
 * (`demand-discovery-v5/fx.ts`). They are quarterly reporting rates, not market rates, and every
 * use says so. The rows name a country and a currency rather than an ISO code, so
 * `TREASURY_CURRENCY_CODES` maps each description accepted; any other row is skipped and reported,
 * never guessed. US-dollar descriptions (Ecuador, El Salvador, Panama…) and the euro are left out.
 */
import { createHash } from 'node:crypto';
import { EvidenceCompletenessStatus, EvidenceOrigin, Prisma } from '@prisma/client';
import { appEnvironment } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';

export const TREASURY_RATES_URL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/rates_of_exchange';
export const TREASURY_AUTHORITY = 'U.S. Department of the Treasury, Bureau of the Fiscal Service';
export const TREASURY_DATASET = 'Treasury Reporting Rates of Exchange';
export const TREASURY_PROVIDER = 'us_treasury_rates_of_exchange';
export const TREASURY_PARSER_VERSION = 'treasury-rates-of-exchange-v1';
export const TREASURY_NORMALIZATION_VERSION = 'treasury-fx-normalization-v1';
/** Every Treasury rate is foreign currency per one US dollar. */
export const TREASURY_BASE_CURRENCY = 'USD';
const MAX_PAGES = 5;

/**
 * Fiscal Data `country_currency_desc` → ISO 4217, checked against the record of 30 Sep 2026.
 * Several descriptions share a currency (the CFA francs, the East Caribbean dollar); the rate is the
 * same currency's, and the first description in key order is used when two disagree on one day.
 */
export const TREASURY_CURRENCY_CODES: Readonly<Record<string, string>> = Object.freeze({
  'Afghanistan-Afghani': 'AFN', 'Albania-Lek': 'ALL', 'Algeria-Dinar': 'DZD', 'Angola-Kwanza': 'AOA',
  'Antigua & Barbuda-East Caribbean Dollar': 'XCD', 'Argentina-Peso': 'ARS', 'Armenia-Dram': 'AMD', 'Australia-Dollar': 'AUD',
  'Azerbaijan-Manat': 'AZN', 'Bahamas-Dollar': 'BSD', 'Bahrain-Dinar': 'BHD', 'Bangladesh-Taka': 'BDT',
  'Barbados-Dollar': 'BBD', 'Belarus-New Ruble': 'BYN', 'Belize-Dollar': 'BZD', 'Benin-Cfa Franc': 'XOF',
  'Bermuda-Dollar': 'BMD', 'Bolivia-Boliviano': 'BOB', 'Bosnia-Marka': 'BAM', 'Botswana-Pula': 'BWP',
  'Brazil-Real': 'BRL', 'Brunei-Dollar': 'BND', 'Burkina Faso-Cfa Franc': 'XOF', 'Burundi-Franc': 'BIF',
  'Cambodia-Riel': 'KHR', 'Cameroon-Cfa Franc': 'XAF', 'Canada-Dollar': 'CAD', 'Cape Verde-Escudo': 'CVE',
  'Cayman Islands-Dollar': 'KYD', 'Central African Republic-Cfa Franc': 'XAF', 'Chad-Cfa Franc': 'XAF', 'Chile-Peso': 'CLP',
  'China-Renminbi': 'CNY', 'Colombia-Peso': 'COP', 'Comoros-Franc': 'KMF', 'Congo-Cfa Franc': 'XAF',
  'Costa Rica-Colon': 'CRC', "Cote D'Ivoire-Cfa Franc": 'XOF', 'Cuba-Peso': 'CUP', 'Curacao-Caribbean Guilder': 'XCG',
  'Czech Republic-Koruna': 'CZK', 'Democratic Republic Of Congo-Congolese Franc': 'CDF', 'Denmark-Krone': 'DKK', 'Djibouti-Franc': 'DJF',
  'Dominican Republic-Peso': 'DOP', 'Egypt-Pound': 'EGP', 'Equatorial Guinea-Cfa Franc': 'XAF', 'Eritrea-Nakfa': 'ERN',
  'Eswatini-Lilangeni': 'SZL', 'Ethiopia-Birr': 'ETB', 'Fiji-Dollar': 'FJD', 'Gabon-Cfa Franc': 'XAF',
  'Gambia-Dalasi': 'GMD', 'Georgia-Lari': 'GEL', 'Ghana-Cedi': 'GHS', 'Grenada-East Caribbean Dollar': 'XCD',
  'Guatemala-Quetzal': 'GTQ', 'Guinea Bissau-Cfa Franc': 'XOF', 'Guinea-Franc': 'GNF', 'Guyana-Dollar': 'GYD',
  'Haiti-Gourde': 'HTG', 'Honduras-Lempira': 'HNL', 'Hong Kong-Dollar': 'HKD', 'Hungary-Forint': 'HUF',
  'Iceland-Krona': 'ISK', 'India-Rupee': 'INR', 'Indonesia-Rupiah': 'IDR', 'Iran-Rial': 'IRR',
  'Iraq-Dinar': 'IQD', 'Israel-Shekel': 'ILS', 'Jamaica-Dollar': 'JMD', 'Japan-Yen': 'JPY',
  'Jordan-Dinar': 'JOD', 'Kazakhstan-Tenge': 'KZT', 'Kenya-Shilling': 'KES', 'Korea-Won': 'KRW',
  'Kuwait-Dinar': 'KWD', 'Kyrgyzstan-Som': 'KGS', 'Laos-Kip': 'LAK', 'Lebanon-Pound': 'LBP',
  'Lesotho-Maloti': 'LSL', 'Liberia-Dollar': 'LRD', 'Libya-Dinar': 'LYD', 'Madagascar-Ariary': 'MGA',
  'Malawi-Kwacha': 'MWK', 'Malaysia-Ringgit': 'MYR', 'Maldives-Rufiyaa': 'MVR', 'Mali-Cfa Franc': 'XOF',
  'Mauritania-Ouguiya': 'MRU', 'Mauritius-Rupee': 'MUR', 'Mexico-Peso': 'MXN', 'Moldova-Leu': 'MDL',
  'Mongolia-Tugrik': 'MNT', 'Morocco-Dirham': 'MAD', 'Mozambique-Metical': 'MZN', 'Myanmar-Kyat': 'MMK',
  'Namibia-Dollar': 'NAD', 'Nepal-Rupee': 'NPR', 'New Zealand-Dollar': 'NZD', 'Nicaragua-Cordoba': 'NIO',
  'Niger-Cfa Franc': 'XOF', 'Nigeria-Naira': 'NGN', 'Norway-Krone': 'NOK', 'Oman-Rial': 'OMR',
  'Pakistan-Rupee': 'PKR', 'Papua New Guinea-Kina': 'PGK', 'Paraguay-Guarani': 'PYG', 'Peru-Sol': 'PEN',
  'Philippines-Peso': 'PHP', 'Poland-Zloty': 'PLN', 'Qatar-Riyal': 'QAR', 'Republic Of North Macedonia-Denar': 'MKD',
  'Romania-New Leu': 'RON', 'Russia-Ruble': 'RUB', 'Rwanda-Franc': 'RWF', 'Sao Tome & Principe-New Dobras': 'STN',
  'Saudi Arabia-Riyal': 'SAR', 'Senegal-Cfa Franc': 'XOF', 'Serbia-Dinar': 'RSD', 'Seychelles-Rupee': 'SCR',
  'Sierra Leone-Leone': 'SLE', 'Singapore-Dollar': 'SGD', 'Solomon Islands-Dollar': 'SBD', 'Somali-Shilling': 'SOS',
  'South Africa-Rand': 'ZAR', 'South Sudan-Sudanese Pound': 'SSP', 'Sri Lanka-Rupee': 'LKR', 'St. Lucia-East Caribbean Dollar': 'XCD',
  'Sudan-Pound': 'SDG', 'Suriname-Dollar': 'SRD', 'Sweden-Krona': 'SEK', 'Switzerland-Franc': 'CHF',
  'Taiwan-Dollar': 'TWD', 'Tajikistan-Somoni': 'TJS', 'Tanzania-Shilling': 'TZS', 'Thailand-Baht': 'THB',
  'Togo-Cfa Franc': 'XOF', "Tonga-Pa'Anga": 'TOP', 'Trinidad & Tobago-Dollar': 'TTD', 'Tunisia-Dinar': 'TND',
  'Turkey-New Lira': 'TRY', 'Turkmenistan-New Manat': 'TMT', 'Uganda-Shilling': 'UGX', 'Ukraine-Hryvnia': 'UAH',
  'United Arab Emirates-Dirham': 'AED', 'United Kingdom-Pound': 'GBP', 'Uruguay-Peso': 'UYU', 'Uzbekistan-Som': 'UZS',
  'Vanuatu-Vatu': 'VUV', 'Venezuela-Bolivar Soberano': 'VES', 'Vietnam-Dong': 'VND', 'Western Samoa-Tala': 'WST',
  'Yemen-Rial': 'YER', 'Zambia-New Kwacha': 'ZMW', 'Zimbabwe-Gold': 'ZWG',
});

/**
 * Descriptions deliberately not mapped: US-dollar economies and the euro (never needed from this
 * source), Cuba's discontinued convertible peso, and Syria's pound, published at 11,000 per dollar
 * until an amendment effective 15 Feb 2026 set 110 (a redenomination whose ISO code is not confirmed
 * here). A row under any other unmapped description is reported as unrecognised.
 */
export const TREASURY_UNMAPPED_DESCRIPTIONS: ReadonlySet<string> = new Set([
  'Ecuador-Dolares', 'El Salvador-Dollar', 'Marshall Islands-U.S. Dollar', 'Micronesia-U.S. Dollar', 'Palau-Dollar',
  'Panama-Dolares', 'Timor-Leste-Dili', 'Euro Zone-Euro', 'Cuba-Chavito', 'Syria-Pound',
]);

export interface TreasuryRateRow {
  country_currency_desc: string;
  currency: string;
  /** Units of `currency` per one US dollar, as published. */
  units_per_usd: string;
  /** The day the rate applies from: the quarter's end, or an amendment's own date. */
  effective_date: string;
  record_date: string;
}

export interface ParsedTreasuryRates {
  rows: TreasuryRateRow[];
  unrecognised: string[];
  skipped: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse one Fiscal Data response body. Malformed bodies throw; individual unusable rows are counted, not guessed. */
export function parseTreasuryRates(body: string): ParsedTreasuryRates & { total_count: number; next: string | null } {
  let json: { data?: unknown; meta?: { 'total-count'?: unknown }; links?: { next?: unknown } };
  try { json = JSON.parse(body); } catch { throw new Error('The Treasury rates response is not JSON.'); }
  if (!Array.isArray(json.data)) throw new Error('The Treasury rates response has no data array.');
  const rows: TreasuryRateRow[] = [];
  const unrecognised = new Set<string>();
  let skipped = 0;
  for (const item of json.data as Record<string, unknown>[]) {
    const desc = typeof item.country_currency_desc === 'string' ? item.country_currency_desc.trim() : '';
    const rate = typeof item.exchange_rate === 'string' ? item.exchange_rate.trim() : '';
    const effective = typeof item.effective_date === 'string' ? item.effective_date : '';
    const record = typeof item.record_date === 'string' ? item.record_date : '';
    const currency = TREASURY_CURRENCY_CODES[desc];
    if (!currency) {
      if (desc && !TREASURY_UNMAPPED_DESCRIPTIONS.has(desc)) unrecognised.add(desc);
      skipped += 1;
      continue;
    }
    if (!DAY.test(effective) || !DAY.test(record) || !(Number(rate) > 0) || !Number.isFinite(Number(rate))) { skipped += 1; continue; }
    rows.push({ country_currency_desc: desc, currency, units_per_usd: rate, effective_date: effective, record_date: record });
  }
  rows.sort((a, b) => a.effective_date.localeCompare(b.effective_date) || a.country_currency_desc.localeCompare(b.country_currency_desc));
  const total = Number(json.meta?.['total-count']);
  const next = typeof json.links?.next === 'string' && json.links.next ? json.links.next : null;
  return { rows, unrecognised: [...unrecognised].sort(), skipped, total_count: Number.isFinite(total) ? total : (json.data as unknown[]).length, next };
}

export const treasurySeriesKey = (desc: string) => `rates_of_exchange:${desc}`;

export function treasuryRequestUrl(since: string, page = 1) {
  if (!DAY.test(since)) throw new Error('The Treasury request needs a YYYY-MM-DD start date.');
  // Written out rather than URL-encoded: the form verified against the live API on 18 Oct 2026.
  return `${TREASURY_RATES_URL}?fields=country_currency_desc,exchange_rate,effective_date,record_date&filter=record_date:gte:${since}&sort=-record_date,country_currency_desc&page[size]=10000&page[number]=${page}`;
}

/**
 * Fetch every rate recorded since `since` and keep it: one snapshot per response page with the raw
 * body, one observation per currency row (immutable; a second retrieval of the same row is skipped).
 */
export async function ingestTreasuryRates(options: { since: string; now?: Date; fetch_impl?: typeof fetch }) {
  const fetchImpl = options.fetch_impl ?? fetch;
  const requestedAt = options.now ?? new Date();
  const environment = appEnvironment();
  const snapshots: string[] = [];
  let observations = 0;
  const unrecognised = new Set<string>();
  let lastStatus = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = treasuryRequestUrl(options.since, page);
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
    const text = await response.text();
    lastStatus = response.status;
    if (!response.ok) {
      return { status: 'failed' as const, http_status: response.status, snapshot_ids: snapshots, observations, unrecognised: [...unrecognised].sort(), reason: `The Treasury rates API returned ${response.status}.` };
    }
    const parsed = parseTreasuryRates(text);
    parsed.unrecognised.forEach((desc) => unrecognised.add(desc));
    const retrievedAt = new Date();
    const snapshot = await prisma.authoritativeFxSnapshot.create({
      data: {
        provider: TREASURY_PROVIDER, source_authority: TREASURY_AUTHORITY, source_dataset: TREASURY_DATASET, source_dataset_version: null,
        series_key: 'rates_of_exchange', request_reference: url, requested_at: requestedAt, retrieved_at: retrievedAt,
        http_status: response.status, raw_response_checksum: createHash('sha256').update(text).digest('hex'), raw_response_text: text,
        parser_version: TREASURY_PARSER_VERSION, normalization_version: TREASURY_NORMALIZATION_VERSION,
        environment, evidence_origin: EvidenceOrigin.public_real,
        completeness: parsed.rows.length ? EvidenceCompletenessStatus.COMPLETE : EvidenceCompletenessStatus.PARTIAL,
        status: parsed.rows.length ? 'accepted' : 'partial',
      },
    });
    snapshots.push(snapshot.id);
    if (parsed.rows.length) {
      const created = await prisma.authoritativeFxObservation.createMany({
        data: parsed.rows.map((row) => ({
          snapshot_id: snapshot.id, provider: TREASURY_PROVIDER, series_key: treasurySeriesKey(row.country_currency_desc),
          base_currency: TREASURY_BASE_CURRENCY, quote_currency: row.currency, rate: new Prisma.Decimal(row.units_per_usd),
          observation_date: new Date(`${row.effective_date}T00:00:00.000Z`),
          // An amendment applies from its own date inside the quarter it amends.
          observation_status: row.effective_date === row.record_date ? 'A' : 'amended',
          normalization_version: TREASURY_NORMALIZATION_VERSION, parser_version: TREASURY_PARSER_VERSION,
          environment, evidence_origin: EvidenceOrigin.public_real, retrieved_at: retrievedAt,
        })),
        skipDuplicates: true,
      });
      observations += created.count;
    }
    if (!parsed.next) break;
  }
  return { status: 'stored' as const, http_status: lastStatus, snapshot_ids: snapshots, observations, unrecognised: [...unrecognised].sort(), reason: null };
}
