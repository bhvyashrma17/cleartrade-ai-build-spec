/**
 * Real Buyer Discovery from official importer lists (D-033, docs/38 §2).
 *
 * For one exporter, product and market, the `buyer_discovery` job finds the importers that the
 * market's official list shows importing the product's HS6, creates or updates a canonical `Buyer`
 * for each (one per importer across lists, keyed by `source_entity_key`), records the list as source
 * evidence, screens the names against the sanctions lists when coverage is complete, and writes one
 * `BuyerFitAssessment` per buyer that says why it was found.
 *
 * Buyer discovery is agent-curated (docs/11 §7): agents and ops request it, or a v5 run's hand-off of
 * its top markets does (D-019). Exporters do not run it.
 */
import { AuditSource, EvidenceOrigin, JobType, Prisma, SanctionsScreeningResultState, type Buyer } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { OFFICIAL_LIST_MODEL } from '@/lib/buyer-control';
import { scoringPolicyHash } from '@/lib/discovery/policy';
import { notFound, validationError } from '@/lib/errors';
import { enqueueJob } from '@/lib/jobs';
import { log } from '@/lib/observability';
import { assertCan, assertPermitted, canSearchBuyers } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { activeSnapshotEntityWhere, evaluateCandidate, SANCTIONS_SCREENING_ALGORITHM_VERSION, sanctionsCoverage } from '@/lib/sanctions/screening';
import { normalizeSanctionsName } from '@/lib/sanctions/normalize';
import { sanctionsEvidenceWhere } from '@/lib/evidence-environment';
import type { Principal } from '@/types';
import { activeImporterLists } from './importer-list-service';
import { IMPORTER_LIST_SOURCES, importerListSourceFor, periodLabel, type ImporterListSourceKey } from './importer-lists';

/** One name for the model across the scorer and the agent's control surface. */
export const BUYER_DISCOVERY_MODEL = OFFICIAL_LIST_MODEL;

/** Words in a name that mark a freight or customs intermediary rather than the buyer (as buyer-intelligence.ts). */
export const INTERMEDIARY_PATTERN = /\b(FREIGHT|FORWARDER|FORWARDING|CUSTOMS BROKER|CUSTOMS BROKERS|BROKERAGE|LOGISTICS|NVOCC|SHIPPING AGENCY)\b/i;

/**
 * The scoring policy as the code applies it. A component the source does not publish is left out
 * and the score is shared over the rest; it is never counted as zero.
 */
export const BUYER_DISCOVERY_POLICY = {
  version: 1,
  model_version: BUYER_DISCOVERY_MODEL,
  components: ['product_match', 'focus', 'india_origin', 'activity'] as const,
  points: { product_match: 40, focus: 30, india_origin: 20, activity: 10 },
  combine: 'points_over_available_components',
  product_match: 'listed with the product’s HS6, or a longer code under it (always 100 for a candidate)',
  focus: 'share of the importer’s published codes in the product’s chapter, in the newest list',
  india_origin: 'listed as importing this HS6 from India (100) or not (0); not scored where the source does not publish origins',
  activity: 'lists of the last 12 months in which the importer appears with the HS6, over the lists available',
  intermediary_pattern: INTERMEDIARY_PATTERN.source,
} as const;
export const BUYER_DISCOVERY_POLICY_HASH = scoringPolicyHash(BUYER_DISCOVERY_POLICY);

export type BuyerDiscoveryTrigger = 'hand_off' | 'requested' | 'operator';

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
const refuse = (field: string, code: string, message: string) => validationError([{ field, code, message }], message);

export async function requestBuyerDiscovery(args: {
  exporter_org_id: string;
  product_id: string;
  country_code: string;
  hs6?: string | null;
  actor: Principal | null;
  trigger: BuyerDiscoveryTrigger;
  correlation_id: string;
}) {
  if (args.actor) {
    assertCan(args.actor, 'buyer_discovery.run');
    await assertPermitted(canSearchBuyers(args.actor, { exporter_org_id: args.exporter_org_id }));
  }
  const country = args.country_code.toUpperCase();
  const source = importerListSourceFor(country);
  if (!source) throw refuse('country_code', 'not_available', `Buyer lists for ${country} are not connected yet. They are available for ${Object.values(IMPORTER_LIST_SOURCES).map((s) => s.country_code).join(', ')}.`);
  const product = await prisma.product.findFirst({ where: { id: args.product_id, exporter_org_id: args.exporter_org_id }, select: { id: true, hs_code: true, hs_classification_status: true } });
  if (!product) throw notFound('That product is not available.');
  const hs6 = args.hs6 ?? (product.hs_classification_status === 'confirmed' ? product.hs_code : null);
  if (!hs6 || !/^\d{6}$/.test(hs6)) throw refuse('product_id', 'hs6_required', 'This product needs a confirmed six-digit HS code before buyers can be looked up.');

  const job = await enqueueJob({
    type: JobType.buyer_discovery,
    payload: { exporter_org_id: args.exporter_org_id, product_id: product.id, country_code: country, hs6, source_key: source.key, trigger: args.trigger },
    exporter_org_id: args.exporter_org_id, requested_by_id: args.actor?.id ?? null, target_type: 'product', target_id: product.id,
    dedupe_key: `buyer_discovery:${args.exporter_org_id}:${product.id}:${country}`, correlation_id: args.correlation_id,
  });
  await writeAuditEvent({
    actor: args.actor, action: AUDIT_ACTIONS.create, object_type: 'buyer_discovery_request', object_id: job.id, exporter_org_id: args.exporter_org_id,
    after_summary: { product_id: product.id, country_code: country, hs6, source_key: source.key, trigger: args.trigger, job_id: job.id },
    correlation_id: args.correlation_id, source: args.actor ? AuditSource.web : AuditSource.job,
  });
  return job;
}

/** D-019: a finished v5 run's handed-off markets with a buyer list go on to buyer discovery. Never throws. */
export async function requestHandOffBuyerDiscovery(discoveryRunId: string, correlationId: string): Promise<{ requested: string[]; refused: { country_code: string; reason: string }[] }> {
  const requested: string[] = [];
  const refused: { country_code: string; reason: string }[] = [];
  const countries = Object.values(IMPORTER_LIST_SOURCES).map((source) => source.country_code);
  const run = await prisma.discoveryRun.findUnique({ where: { id: discoveryRunId }, select: { exporter_org_id: true, product_id: true } });
  if (!run?.product_id) return { requested, refused };
  const markets = await prisma.marketAssessment.findMany({
    where: { run_id: discoveryRunId, handed_off: true, country_code: { in: countries } },
    select: { country_code: true, classification_hs6_code: true },
    orderBy: { rank: 'asc' },
  });
  for (const market of markets) {
    try {
      await requestBuyerDiscovery({ exporter_org_id: run.exporter_org_id, product_id: run.product_id, country_code: market.country_code, hs6: market.classification_hs6_code, actor: null, trigger: 'hand_off', correlation_id: correlationId });
      requested.push(market.country_code);
    } catch (error) {
      refused.push({ country_code: market.country_code, reason: describe(error) });
      log('warn', 'buyer_discovery_hand_off_refused', { discovery_run_id: discoveryRunId, country_code: market.country_code, reason: describe(error) });
    }
  }
  return { requested, refused };
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

const periodEnd = (period: string) => (/^\d{4}-\d{2}$/.test(period)
  ? new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0))
  : new Date(Date.UTC(Number(period.slice(0, 4)), 11, 31)));
const dotted = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}.${code.slice(4, 6)}.${code.slice(6)}` : code.length === 6 ? `${code.slice(0, 4)}.${code.slice(4)}` : code);
const listOf = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

interface Candidate {
  entity_key: string;
  name: string;
  address_lines: string[];
  town: string | null;
  postcode: string | null;
  region_code: string | null;
  region_name: string | null;
  /** Codes under the HS6, newest list. */
  product_codes: string[];
  /** All published codes, newest list. */
  all_codes: string[];
  india: boolean | null;
  periods: string[];
  releases: string[];
  notes: string[];
}

type Component = { score: number | null; reason?: string; evidence: Record<string, unknown> };

export function scoreCandidate(candidate: Candidate, hs6: string, listsAvailable: number, origins: 'published' | 'not_published') {
  const chapter = hs6.slice(0, 2);
  const inChapter = candidate.all_codes.filter((code) => code.startsWith(chapter)).length;
  const components: Record<(typeof BUYER_DISCOVERY_POLICY.components)[number], Component> = {
    product_match: { score: 100, evidence: { hs6, codes: candidate.product_codes } },
    focus: candidate.all_codes.length
      ? { score: Math.round((100 * inChapter) / candidate.all_codes.length), evidence: { chapter, codes_in_chapter: inChapter, codes_published: candidate.all_codes.length } }
      : { score: null, reason: 'The list publishes no codes for this importer.', evidence: {} },
    india_origin: origins === 'published'
      ? { score: candidate.india ? 100 : 0, evidence: { listed_from_india: Boolean(candidate.india) } }
      : { score: null, reason: 'This list does not say where the importer buys from.', evidence: {} },
    activity: listsAvailable > 1
      ? { score: Math.round((100 * candidate.periods.length) / listsAvailable), evidence: { lists_listed: candidate.periods.length, lists_available: listsAvailable, periods: candidate.periods } }
      : { score: null, reason: 'Only one list is available, so how often it imports cannot be compared yet.', evidence: { periods: candidate.periods } },
  };
  const points = BUYER_DISCOVERY_POLICY.points;
  const available = (Object.keys(components) as (keyof typeof components)[]).filter((key) => components[key].score != null);
  const total = available.reduce((sum, key) => sum + points[key], 0);
  const score = total ? Math.round(available.reduce((sum, key) => sum + points[key] * components[key].score!, 0) / total) : null;
  const confidence = Math.round((100 * available.length) / BUYER_DISCOVERY_POLICY.components.length);
  return { components, score, confidence, in_chapter: inChapter };
}

function summaryLines(candidate: Candidate, hs6: string, sourceKey: ImporterListSourceKey, inChapter: number): string[] {
  const source = IMPORTER_LIST_SOURCES[sourceKey];
  const periods = listOf(candidate.periods.map(periodLabel));
  const lines = sourceKey === 'uk_hmrc_importers'
    ? [`Imported ${listOf(candidate.product_codes.map(dotted))} in ${periods} (${source.short_label}).`]
    : [`A major importer of HS ${dotted(hs6)}${candidate.india ? ' from India' : ''} in ${periods} (${source.short_label}).`];
  const total = candidate.all_codes.length;
  const chapter = hs6.slice(0, 2);
  if (total === 1 && inChapter === 1) lines.push('It is listed with this code only.');
  else if (total > 0 && inChapter === total) lines.push(`All ${total} codes it is listed with are in chapter ${chapter}.`);
  else if (total > 0) lines.push(`${inChapter} of the ${total} codes it is listed with ${inChapter === 1 ? 'is' : 'are'} in chapter ${chapter}.`);
  if (INTERMEDIARY_PATTERN.test(candidate.name)) lines.push('The name suggests a freight or customs intermediary rather than the buyer itself.');
  return lines;
}

async function candidatesFor(sourceKey: ImporterListSourceKey, hs6: string) {
  const lists = await activeImporterLists(sourceKey);
  if (lists.length === 0) return { lists, candidates: [] as Candidate[] };
  const releaseIds = lists.map((list) => list.id);
  const periodOf = new Map(lists.map((list) => [list.id, list.period]));
  const entries = await prisma.importerListEntry.findMany({
    where: { release_id: { in: releaseIds }, OR: [{ hs6_codes: { has: hs6 } }, { origin_hs6: { has: `${hs6}:IN` } }] },
    orderBy: { name: 'asc' },
  });
  const byKey = new Map<string, Candidate>();
  for (const entry of entries) {
    const period = periodOf.get(entry.release_id)!;
    const existing = byKey.get(entry.entity_key);
    const newer = !existing || period > existing.periods[0]!;
    const productCodes = entry.hs_codes.filter((code) => code.startsWith(hs6));
    const candidate: Candidate = existing ?? {
      entity_key: entry.entity_key, name: entry.name, address_lines: entry.address_lines, town: entry.town, postcode: entry.postcode, region_code: entry.region_code,
      region_name: entry.region_name, product_codes: productCodes, all_codes: entry.hs_codes, india: null, periods: [], releases: [], notes: (entry.notes as string[]) ?? [],
    };
    if (existing && newer) Object.assign(candidate, { name: entry.name, address_lines: entry.address_lines, town: entry.town, postcode: entry.postcode, region_code: entry.region_code, region_name: entry.region_name, product_codes: productCodes, all_codes: entry.hs_codes });
    if (entry.origin_hs6.includes(`${hs6}:IN`)) candidate.india = true;
    else if (candidate.india === null && entry.origin_hs6.length) candidate.india = false;
    if (!candidate.periods.includes(period)) candidate.periods.push(period);
    candidate.periods.sort().reverse();
    candidate.releases.push(entry.release_id);
    byKey.set(entry.entity_key, candidate);
  }
  return { lists, candidates: [...byKey.values()] };
}

async function sanctionsScreener() {
  const coverage = await sanctionsCoverage();
  if (!coverage.complete) return { complete: false as const, screen: null };
  const entities = await prisma.sanctionsEntity.findMany({ where: { is_active: true, ...sanctionsEvidenceWhere(), ...activeSnapshotEntityWhere() } });
  return {
    complete: true as const,
    screen: (name: string, country: string) => {
      let best: { entity: (typeof entities)[number]; result: NonNullable<ReturnType<typeof evaluateCandidate>> } | null = null;
      for (const entity of entities) {
        // Names in these lists can be companies or people (sole traders), so every listed type is compared.
        const result = evaluateCandidate({ name, country, entity_type: null }, entity);
        if (result && (!best || result.score > best.result.score)) best = { entity, result };
      }
      return best;
    },
  };
}

export async function runBuyerDiscoveryJob(payload: { exporter_org_id: string; product_id: string; country_code: string; hs6: string; source_key: ImporterListSourceKey }, correlationId: string) {
  const source = IMPORTER_LIST_SOURCES[payload.source_key];
  if (!source || source.country_code !== payload.country_code) throw new Error(`No importer list ${payload.source_key} for ${payload.country_code}.`);
  const product = await prisma.product.findFirst({ where: { id: payload.product_id, exporter_org_id: payload.exporter_org_id }, select: { id: true } });
  if (!product) throw new Error(`Product ${payload.product_id} no longer belongs to exporter ${payload.exporter_org_id}.`);

  const { lists, candidates } = await candidatesFor(source.key, payload.hs6);
  if (lists.length === 0) return { outcome: 'no_list' as const, reason: `No ${source.label} list has been imported on this environment.`, importers_found: 0 };
  const origins = source.key === 'ca_cid_major_importers' ? 'published' as const : 'not_published' as const;
  const screener = await sanctionsScreener();
  const now = new Date();
  let created = 0;
  let blocked = 0;
  for (const candidate of candidates) {
    const sourceEntityKey = `${source.key}:${candidate.entity_key}`;
    const intermediary = INTERMEDIARY_PATTERN.test(candidate.name);
    const newest = candidate.periods[0]!;
    const summary = {
      scope: 'official_importer_list', source_key: source.key, source_label: source.label, periods: candidate.periods, address_lines: candidate.address_lines,
      town: candidate.town, postcode: candidate.postcode, region_code: candidate.region_code, region_name: candidate.region_name, notes: candidate.notes,
    };
    const existing = await prisma.buyer.findUnique({ where: { source_entity_key: sourceEntityKey } });
    let buyer: Buyer;
    if (existing) {
      buyer = await prisma.buyer.update({
        where: { id: existing.id },
        data: { legal_name: candidate.name, display_name: candidate.name, import_activity_summary: summary as Prisma.InputJsonValue, last_activity_at: periodEnd(newest), ...(intermediary ? { buyer_type: 'intermediary', deprioritized: true, deprioritization_reasons: ['intermediary'] } : {}) },
      });
    } else {
      buyer = await prisma.buyer.create({
        data: {
          legal_name: candidate.name, display_name: candidate.name, country_code: source.country_code, buyer_type: intermediary ? 'intermediary' : 'importer', source_entity_key: sourceEntityKey,
          import_activity_summary: summary as Prisma.InputJsonValue, last_activity_at: periodEnd(newest), deprioritized: intermediary, deprioritization_reasons: intermediary ? ['intermediary'] : [],
        },
      });
      created += 1;
    }
    for (const releaseId of new Set(candidate.releases)) {
      const already = await prisma.buyerSourceEvidence.findFirst({ where: { buyer_id: buyer.id, source_type: source.key, source_ref: releaseId }, select: { id: true } });
      const period = lists.find((list) => list.id === releaseId)?.period ?? newest;
      if (!already) {
        await prisma.buyerSourceEvidence.create({ data: { buyer_id: buyer.id, source_type: source.key, source_ref: releaseId, summary: `Listed in the ${source.short_label} for ${periodLabel(period)}.`, observed_at: periodEnd(period) } });
      }
    }

    // Sanctions: screened when every required list is current; otherwise flagged as not screened.
    let riskFlags: Prisma.InputJsonValue = [];
    let sanctionsBlocked = false;
    if (screener.complete) {
      const match = screener.screen(candidate.name, source.country_code);
      if (match) {
        const screeningCase = await prisma.sanctionsScreeningCase.create({
          data: {
            buyer_id: buyer.id, searched_name: candidate.name, normalized_name: normalizeSanctionsName(candidate.name), searched_country: source.country_code,
            searched_address: [...candidate.address_lines, candidate.postcode].filter(Boolean).join(', ') || null, searched_entity_type: null,
            result_state: match.result.state, source_entity_id: match.entity.id, evidence: { ...match.result.evidence, source: match.entity.source, source_record_id: match.entity.source_record_id } as Prisma.InputJsonValue,
            algorithm_version: SANCTIONS_SCREENING_ALGORITHM_VERSION,
          },
        });
        sanctionsBlocked = true;
        blocked += 1;
        riskFlags = [{ code: match.result.state === SanctionsScreeningResultState.confirmed_match ? 'sanctions_confirmed_match' : 'sanctions_possible_match', severity: 'critical', summary: match.result.state === SanctionsScreeningResultState.confirmed_match ? 'Confirmed sanctions match' : 'Possible sanctions match — Ops review required', screening_case_id: screeningCase.id }];
      }
    } else {
      riskFlags = [{ code: 'SCREENING_INCOMPLETE', severity: 'warning', summary: 'Not screened yet: the sanctions lists on this environment are incomplete or stale. Screen before any outreach.' }];
    }
    await prisma.buyer.update({ where: { id: buyer.id }, data: { risk_flags: riskFlags, sanctions_blocked: sanctionsBlocked } });

    const scored = scoreCandidate(candidate, payload.hs6, source.period_kind === 'month' ? lists.length : 1, origins);
    const components = { ...scored.components, summary_lines: summaryLines(candidate, payload.hs6, source.key, scored.in_chapter), source: { key: source.key, label: source.label, url: source.url, periods: candidate.periods } };
    const inputSnapshot = { hs6: payload.hs6, country_code: source.country_code, source_key: source.key, entity_key: candidate.entity_key, release_ids: [...new Set(candidate.releases)].sort() };
    const evidenceOrigins = [...new Set(lists.filter((list) => candidate.releases.includes(list.id)).map((list) => list.evidence_origin))];
    const data = {
      score: sanctionsBlocked ? null : scored.score, confidence_score: scored.confidence, components: components as unknown as Prisma.InputJsonValue, input_snapshot: inputSnapshot as Prisma.InputJsonValue,
      model_version: BUYER_DISCOVERY_MODEL, evidence_origins: evidenceOrigins.length ? evidenceOrigins : [EvidenceOrigin.public_real], scoring_policy_version: BUYER_DISCOVERY_POLICY.version,
      scoring_policy_hash: BUYER_DISCOVERY_POLICY_HASH, scoring_policy_snapshot: BUYER_DISCOVERY_POLICY as unknown as Prisma.InputJsonValue, reproducibility_status: 'reproducible',
    };
    await prisma.buyerFitAssessment.upsert({
      where: { buyer_id_product_id_exporter_org_id: { buyer_id: buyer.id, product_id: product.id, exporter_org_id: payload.exporter_org_id } },
      create: { buyer_id: buyer.id, product_id: product.id, exporter_org_id: payload.exporter_org_id, ...data },
      update: { ...data, computed_at: now },
    });
  }
  log('info', 'buyer_discovery_completed', { correlation_id: correlationId, country_code: source.country_code, hs6: payload.hs6, importers_found: candidates.length, buyers_created: created });
  return {
    outcome: 'completed' as const, source_key: source.key, country_code: source.country_code, hs6: payload.hs6, lists: lists.map((list) => list.period),
    importers_found: candidates.length, buyers_created: created, buyers_updated: candidates.length - created, sanctions: screener.complete ? 'screened' : 'not_screened_coverage_incomplete', sanctions_blocked: blocked,
  };
}
