/**
 * The checked-in Natural Earth geography snapshot (D-048, docs/38 §3): for each of the 218
 * markets, its places of 300,000 people or more, its first-level divisions with their ISO 3166-2
 * codes, and its ports and civil airports, each placed in a division.
 *
 * Facts only, as Natural Earth gives them. The shape rule, the hand-set shapes and the territory
 * policy are applied when the registry is read (`registry.ts`), so changing a decision never needs
 * the source files again. `scripts/build-regional-geography.ts` writes this file from source files
 * pinned by sha256 (`source.ts`); rebuilding from the same files gives the same bytes.
 */
import { z } from 'zod';

export const GEOGRAPHY_SNAPSHOT_SCHEMA_VERSION = 'natural-earth-geography-v1';

/** Places below this are not stored: the shape rule counts only places this large (D-048). */
export const MINIMUM_PLACE_POPULATION = 300_000;

const iso2 = z.string().regex(/^[A-Z]{2}$/);
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
/** Natural Earth's code: ISO 3166-2 where one exists, else its own placeholder (e.g. `TK-X01~`). */
const divisionCode = z.string().min(3).max(12);

export const snapshotPlaceSchema = z.object({
  ne_id: z.number().int().positive(),
  name: z.string().min(1),
  lat: latitude,
  lon: longitude,
  /** Natural Earth's `pop_max`: the urban area's population, estimated in various years. */
  population: z.number().int().min(MINIMUM_PLACE_POPULATION),
  division: divisionCode.nullable(),
});
export type SnapshotPlace = z.infer<typeof snapshotPlaceSchema>;

export const snapshotDivisionSchema = z.object({
  code: divisionCode,
  /** English name (`name_en`), else Natural Earth's own name. */
  name: z.string().min(1),
  /** Natural Earth's own name where it differs from the English one (e.g. "Al Qahirah" for Cairo). */
  local_name: z.string().min(1).nullable(),
  type: z.string().min(1).nullable(),
});
export type SnapshotDivision = z.infer<typeof snapshotDivisionSchema>;

export const snapshotGatewaySchema = z.object({
  ne_id: z.number().int().positive(),
  kind: z.enum(['port', 'airport']),
  name: z.string().min(1),
  /** Airports only, where Natural Earth records one. */
  iata: z.string().regex(/^[A-Z0-9]{3}$/).nullable(),
  lat: latitude,
  lon: longitude,
  /** Always set: a gateway outside every division of the 218 markets is not kept. */
  division: divisionCode,
  /** Natural Earth's `scalerank`: how early the feature is drawn on a map. Not cargo volume. */
  map_rank: z.number().int().min(0).max(10),
});
export type SnapshotGateway = z.infer<typeof snapshotGatewaySchema>;

export const snapshotMarketSchema = z.object({
  iso2,
  places: z.array(snapshotPlaceSchema),
  divisions: z.array(snapshotDivisionSchema),
  gateways: z.array(snapshotGatewaySchema),
}).superRefine((market, context) => {
  const codes = new Set<string>();
  for (const division of market.divisions) {
    if (codes.has(division.code)) context.addIssue({ code: z.ZodIssueCode.custom, message: `${market.iso2} lists division ${division.code} twice.` });
    codes.add(division.code);
  }
  for (const item of [...market.places, ...market.gateways]) {
    if (item.division !== null && !codes.has(item.division)) context.addIssue({ code: z.ZodIssueCode.custom, message: `${market.iso2}: ${item.name} names division ${item.division}, which the market does not list.` });
  }
});
export type SnapshotMarket = z.infer<typeof snapshotMarketSchema>;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const geographySnapshotSchema = z.object({
  schema_version: z.literal(GEOGRAPHY_SNAPSHOT_SCHEMA_VERSION),
  source: z.object({
    provider: z.literal('Natural Earth'),
    release: z.string().min(2),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    layers: z.array(z.object({ layer: z.string().min(3), sha256, bytes: z.number().int().positive() })).length(4),
  }),
  /** The screening universe the markets were taken from; a different universe needs a rebuild. */
  universe: z.object({ version: z.string().min(3), checksum: z.string().min(16), size: z.number().int().positive() }),
  minimum_place_population: z.literal(MINIMUM_PLACE_POPULATION),
  markets: z.array(snapshotMarketSchema).min(1),
}).superRefine((snapshot, context) => {
  if (snapshot.markets.length !== snapshot.universe.size) context.addIssue({ code: z.ZodIssueCode.custom, message: `${snapshot.markets.length} markets for a universe of ${snapshot.universe.size}.` });
  const seen = new Set<string>();
  for (const market of snapshot.markets) {
    if (seen.has(market.iso2)) context.addIssue({ code: z.ZodIssueCode.custom, message: `${market.iso2} appears twice.` });
    seen.add(market.iso2);
  }
});
export type GeographySnapshot = z.infer<typeof geographySnapshotSchema>;

/** Parses the snapshot, refusing any file that does not match the schema exactly. */
export function parseGeographySnapshot(body: unknown): GeographySnapshot {
  const parsed = geographySnapshotSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Not a ${GEOGRAPHY_SNAPSHOT_SCHEMA_VERSION} snapshot: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'invalid'}`.trim());
  }
  return parsed.data;
}

/**
 * The file's one canonical form: header fields on their own lines, then each market with one place,
 * division or gateway per line, so a rebuild's diff shows exactly which items changed. Rebuilding
 * from the same sources gives the same bytes, and the tests refuse a file not in this form.
 */
export function serializeGeographySnapshot(snapshot: GeographySnapshot): string {
  const json = (value: unknown) => JSON.stringify(value);
  const list = (items: readonly unknown[]) => (items.length ? `[\n${items.map(json).join(',\n')}\n]` : '[]');
  const markets = snapshot.markets.map((market) => [
    `{"iso2":${json(market.iso2)},`,
    `"places":${list(market.places)},`,
    `"divisions":${list(market.divisions)},`,
    `"gateways":${list(market.gateways)}}`,
  ].join('\n'));
  return [
    '{',
    `"schema_version":${json(snapshot.schema_version)},`,
    `"source":${json(snapshot.source)},`,
    `"universe":${json(snapshot.universe)},`,
    `"minimum_place_population":${json(snapshot.minimum_place_population)},`,
    `"markets":[\n${markets.join(',\n')}\n]`,
    '}',
    '',
  ].join('\n');
}
