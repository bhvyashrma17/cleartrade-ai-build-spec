/**
 * Regional demand from an official importer list (D-033, docs/38 §1.2): for the UK and Canada, where
 * the businesses that import the product are, counted by region from the newest active list. A count
 * of importers, not a value: these lists publish who imports, never how much.
 */
import { activeImporterLists } from '@/lib/buyer-discovery/importer-list-service';
import { IMPORTER_LIST_SOURCES, periodLabel, type ImporterListSourceKey } from '@/lib/buyer-discovery/importer-lists';
import { prisma } from '@/lib/prisma';
import type { ImporterArea, RegionalDemandResultV1 } from './census';

const ATTRIBUTION: Record<ImporterListSourceKey, string> = {
  uk_hmrc_importers: 'Contains public sector information licensed under the Open Government Licence v3.0.',
  ca_cid_major_importers: 'Contains information licensed under the Open Government Licence – Canada.',
};

export async function readImporterRegions(args: { source_key: ImporterListSourceKey; hs6: string; now: Date; top?: number }): Promise<{ result: RegionalDemandResultV1 | null; reason: string | null }> {
  const source = IMPORTER_LIST_SOURCES[args.source_key];
  const lists = await activeImporterLists(source.key);
  if (lists.length === 0) return { result: null, reason: `No ${source.label} list has been imported on this environment yet.` };
  const newest = lists[0]!;
  const entries = await prisma.importerListEntry.findMany({
    where: { release_id: newest.id, OR: [{ hs6_codes: { has: args.hs6 } }, { origin_hs6: { has: `${args.hs6}:IN` } }] },
    select: { entity_key: true, region_code: true, region_name: true, town: true, origin_hs6: true },
  });
  const originsPublished = source.key === 'ca_cid_major_importers';
  const byRegion = new Map<string, ImporterArea & { townCounts: Map<string, number> }>();
  for (const entry of entries) {
    const code = entry.region_code ?? 'unknown';
    let area = byRegion.get(code);
    if (!area) {
      area = { code, name: entry.region_name ?? 'Region not identified', importer_count: 0, india_importer_count: originsPublished ? 0 : null, towns: [], townCounts: new Map() };
      byRegion.set(code, area);
    }
    area.importer_count += 1;
    if (originsPublished && entry.origin_hs6.includes(`${args.hs6}:IN`)) area.india_importer_count = (area.india_importer_count ?? 0) + 1;
    if (entry.town) area.townCounts.set(entry.town, (area.townCounts.get(entry.town) ?? 0) + 1);
  }
  const top = args.top ?? 15;
  const areas = [...byRegion.values()]
    .map(({ townCounts, ...area }) => ({ ...area, towns: [...townCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([town]) => town) }))
    .sort((a, b) => b.importer_count - a.importer_count || a.name.localeCompare(b.name));
  const rest = areas.slice(top);
  const indiaCount = originsPublished ? entries.filter((entry) => entry.origin_hs6.includes(`${args.hs6}:IN`)).length : null;
  const notes = source.key === 'uk_hmrc_importers'
    ? [
        'Each business is placed in a region by the postcode HMRC publishes for it; a few postcode areas cross a regional boundary.',
        'The list names businesses importing from outside the EU, and into Great Britain from the EU. Businesses can opt out, so it is not every importer.',
        'Where fewer than three businesses import a code in a month, HMRC publishes only the chapter, so those businesses are not counted here.',
      ]
    : ['The database lists the major importers that together account for most of the product’s imports; it does not list every importer.'];
  return {
    reason: null,
    result: {
      version: 1,
      country_code: source.country_code,
      hs6: args.hs6,
      source: { key: source.key, label: source.label, url: source.url, attribution: ATTRIBUTION[source.key], retrieved_at: newest.retrieved_at.toISOString(), requests: [newest.source_url] },
      period: { from: newest.period, to: newest.period, months: source.period_kind === 'month' ? 1 : 12, label: periodLabel(newest.period) },
      totals: { india_value_usd: null, world_value_usd: null, india_share_percent: null, container_share_percent: null, air_share_percent: null, importer_count: entries.length, india_importer_count: indiaCount },
      views: [{
        kind: source.key === 'uk_hmrc_importers' ? 'region' : 'province', measure: 'importers', title: source.key === 'uk_hmrc_importers' ? 'Regions' : 'Provinces',
        areas: areas.slice(0, top), others: rest.length ? { count: rest.length, importer_count: rest.reduce((sum, area) => sum + area.importer_count, 0) } : null,
      }],
      notes,
    },
  };
}
