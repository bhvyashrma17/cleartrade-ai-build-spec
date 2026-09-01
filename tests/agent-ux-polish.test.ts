import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { marketStatus } from '@/lib/country-discovery/service';
import { summariseWork, buildWorkQueue, type MarketWorkInput } from '@/lib/country-discovery/work-queue';
import type { MarketDetailView } from '@/lib/country-discovery/market-view';
import type { ClassificationQuestionView } from '@/lib/country-discovery/service';

/**
 * "FINAL Demand Discovery Agent UX Polish" — coverage for the parts of that task that are not
 * already exercised by tests/exporter-facts-authorization.test.ts (provenance, tenancy, agent
 * authorization at the service layer, all reused unchanged) or tests/demand-discovery-ui.test.ts
 * (the by_category / by_category_all split). This file pins the remaining UI-surface claims:
 * no duplicated 20-market table on the parent page, a per-product "manage decisions" drill-down,
 * the compact empty scan-request state, real classification-question counts, the
 * tariff-treatment-available banner, and the evidence-coverage tooltip.
 */

const orgPage = readFileSync('src/app/agent/exporters/[exporterOrgId]/page.tsx', 'utf8');
const countryTruthWork = readFileSync('src/components/agent/CountryTruthWork.tsx', 'utf8');
const scanQueue = readFileSync('src/components/agent/MarketScanQueue.tsx', 'utf8');
const marketResults = readFileSync('src/app/app/products/[productId]/markets/MarketResults.tsx', 'utf8');
const countryTruth = readFileSync('src/app/app/products/[productId]/markets/[country]/CountryTruth.tsx', 'utf8');
const discoveryComponents = readFileSync('src/components/discovery/index.tsx', 'utf8');
const manageDecisionsPage = readFileSync('src/app/agent/exporters/[exporterOrgId]/products/[productId]/markets/manage/page.tsx', 'utf8');
const factsPage = readFileSync('src/app/agent/exporters/[exporterOrgId]/products/[productId]/facts/page.tsx', 'utf8');
const agentPageAuth = readFileSync('src/lib/country-discovery/agent-page-auth.ts', 'utf8');

describe('agent org page no longer embeds the full 20-market control table', () => {
  test('the org overview page does not render DemandDiscoveryControl', () => {
    expect(orgPage).not.toContain('DemandDiscoveryControl');
    expect(orgPage).not.toContain('marketControlRows');
  });

  test('the product panel offers a scoped drill-down instead', () => {
    expect(countryTruthWork).toContain('Manage market decisions');
    expect(countryTruthWork).toContain('/markets/manage');
    // The link is built per-product, off the same basePath used for the rest of the agent's
    // product surface — not a bare org-wide path.
    expect(countryTruthWork).toMatch(/basePath\}\/\$\{view\.product\.id\}\/markets\/manage/);
  });
});

describe('"Manage market decisions" is scoped to one product, not the org\'s latest run', () => {
  test('the manage-decisions page queries discoveryRun by exporter_org_id AND product_id', () => {
    // The pre-existing org page queried findFirst({ where: { exporter_org_id } }) only, which
    // silently showed a second product's markets under the wrong product for a multi-product
    // org. The fix must filter on both.
    expect(manageDecisionsPage).toMatch(/where:\s*\{\s*exporter_org_id:\s*exporterOrgId,\s*product_id:\s*productId\s*\}/);
  });

  test('the page enforces org access before returning any row', () => {
    expect(manageDecisionsPage).toContain('assertOrgAccess');
    expect(manageDecisionsPage).toContain('loadOrNotFound');
  });
});

describe('agent-scoped pages reject principals without access', () => {
  test('requireAgentDiscoveryPrincipal redirects only on a missing session, never on org membership', () => {
    // Agents never carry exporter_org_id — the actual tenancy check happens downstream in
    // assertOrgAccess against the route-param org, not against principal.exporter_org_id. The
    // only redirect in this function is the "no session at all" case.
    expect(agentPageAuth).toContain("if (!principal) redirect('/login');");
    expect(agentPageAuth.match(/redirect\(/g)).toHaveLength(1);
  });

  test('loadOrNotFound turns a service-layer NOT_FOUND into a 404, not a leak', () => {
    expect(agentPageAuth).toContain('isNotFound(error)');
    expect(agentPageAuth).toContain('notFound()');
  });

  test('every new agent product route funnels through assertOrgAccess, directly or via the shared service', () => {
    // markets/ and markets/[country]/ call marketResults()/countryDetail() from service.ts, and
    // both route through the shared loadProduct() helper, which is the one place assertOrgAccess
    // is actually called for the discovery surface (the same choke point the exporter-facing
    // pages already rely on) — so the check is on that helper for those two, and directly on the
    // page for manage/ and facts/, which query prisma themselves.
    const service = readFileSync('src/lib/country-discovery/service.ts', 'utf8');
    expect(service).toContain('export async function marketResults');
    expect(service).toContain('export async function countryDetail');
    expect(service).toMatch(/async function loadProduct\([\s\S]{0,100}assertOrgAccess/);
    expect(service).toMatch(/marketResults[\s\S]{0,200}loadProduct/);
    expect(service).toMatch(/countryDetail[\s\S]{0,200}loadProduct/);

    for (const file of [
      'src/app/agent/exporters/[exporterOrgId]/products/[productId]/markets/manage/page.tsx',
      'src/app/agent/exporters/[exporterOrgId]/products/[productId]/facts/page.tsx',
    ]) {
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain('assertOrgAccess');
    }
  });
});

describe('an agent records exporter facts through the exact existing Phase 1H endpoint', () => {
  test('the agent facts page reuses ProductFactsForm, not a parallel form or mutation path', () => {
    expect(factsPage).toContain('ProductFactsForm');
    expect(factsPage).toContain("from '@/app/app/products/[productId]/facts/ProductFactsForm'");
    // No fetch/apiPost of its own — every write goes through the one shared form component,
    // which posts to the one existing exporter-facts endpoint regardless of who is signed in.
    expect(factsPage).not.toContain('apiPost');
    expect(factsPage).not.toContain('fetch(');
  });

  test('provenance to the agent is read from the existing audit trail, not a new column', () => {
    expect(factsPage).toContain("object_type: 'product_operational_facts'");
    expect(factsPage).toContain('auditEvent.findFirst');
  });
});

describe('the parent page compresses an empty scan-request queue to one line', () => {
  test('zero pending requests renders a one-line row, not a full card', () => {
    expect(scanQueue).toMatch(/entries\.length === 0/);
    expect(scanQueue).toContain('None pending');
  });

  test('a non-empty queue still renders the full approval card unchanged', () => {
    expect(scanQueue).toContain('Market scan requests');
    expect(scanQueue).toContain('Approve');
    expect(scanQueue).toContain('Decline');
  });
});

describe('prioritised vs backlog counts are never ambiguous', () => {
  const TWENTY: MarketWorkInput[] = Array.from({ length: 20 }, (_, i) => ({
    country_code: `C${i}`, country: `Country ${i}`, rank: i + 1,
    is_selected: false, is_marked: false, is_excluded: false,
    actions: [
      { code: 'confirm_tariff_line', owner: 'cleartrade', label: 'Confirm tariff line', detail: '', unlocks: 'market_access' },
      { code: 'collect_cost_quotes', owner: 'cleartrade', label: 'Collect quotes', detail: '', unlocks: 'export_economics' },
      { code: 'verify_certifications', owner: 'cleartrade', label: 'Verify certs', detail: '', unlocks: 'exporter_market_fit' },
      { code: 'establish_route', owner: 'cleartrade', label: 'Establish route', detail: '', unlocks: 'logistics_feasibility' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any,
  }));

  test('by_category sums to needs_attention, not to the raw total', () => {
    const summary = summariseWork(buildWorkQueue(TWENTY));
    expect(summary.by_category.reduce((sum, e) => sum + e.count, 0)).toBe(summary.needs_attention);
    expect(summary.needs_attention).toBeLessThan(summary.total);
  });

  test('by_category_all sums to the true total and is a superset of by_category', () => {
    const summary = summariseWork(buildWorkQueue(TWENTY));
    expect(summary.by_category_all.reduce((sum, e) => sum + e.count, 0)).toBe(summary.total);
    for (const row of summary.by_category) {
      const all = summary.by_category_all.find((r) => r.category === row.category);
      expect(all!.count).toBeGreaterThanOrEqual(row.count);
    }
  });

  test('the summary panel labels which figure is which, never a bare total', () => {
    expect(discoveryComponents).toContain('prioritised');
    expect(discoveryComponents).toContain('byCategoryBacklog');
    // The old ambiguous "ClearTrade actions" heading with an unlabelled "N need attention" is gone.
    expect(discoveryComponents).toContain('ClearTrade work');
  });
});

describe('classification status language names the real refinement state', () => {
  const pillars = (missingKey: string) => ([
    { key: 'market_access', state: missingKey === 'market_access' ? 'not_established' : 'available' },
    { key: 'export_economics', state: 'available' },
    { key: 'exporter_market_fit', state: 'available' },
    { key: 'logistics_feasibility', state: 'available' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);

  const detail = (missingKey: string) => ({ pillars: pillars(missingKey) }) as unknown as MarketDetailView;

  const classification = (over: Partial<ClassificationQuestionView>): ClassificationQuestionView => ({
    state: 'questions', destination_country: 'DE', remaining: 24, candidate_total: 108,
    questions: [], answers_on_file: {}, resolved_line: null, source: null, ...over,
  });

  test('a real question count reads "Classification needs N answers", never the candidate count', () => {
    const result = marketStatus(detail('market_access'), classification({
      state: 'questions',
      questions: [
        { attribute: 'a', question: 'q1', options: [] },
        { attribute: 'b', question: 'q2', options: [] },
        { attribute: 'c', question: 'q3', options: [] },
      ],
      remaining: 24, // deliberately different from questions.length — must not leak into the text
    }));
    expect(result.status).toBe('Classification needs 3 answers');
    expect(result.status).not.toContain('24');
  });

  test('a single outstanding question is singular', () => {
    const result = marketStatus(detail('market_access'), classification({
      state: 'questions', questions: [{ attribute: 'a', question: 'q1', options: [] }],
    }));
    expect(result.status).toBe('Classification needs 1 answer');
  });

  test('a case ClearTrade must classify itself never claims a question is available', () => {
    const result = marketStatus(detail('market_access'), classification({ state: 'agent_classification_required' }));
    expect(result.status).toBe('Needs ClearTrade classification');
  });

  test('no authoritative snapshot yet is distinguished from a resolvable classification', () => {
    const result = marketStatus(detail('market_access'), classification({ state: 'no_evidence_yet' }));
    expect(result.status).toBe('Awaiting tariff evidence');
  });

  test('never names a raw tariff code in any classification status', () => {
    for (const state of ['questions', 'agent_classification_required', 'no_evidence_yet', 'resolved'] as const) {
      const result = marketStatus(detail('market_access'), classification({ state }));
      expect(result.status).not.toMatch(/\b\d{6,10}\b/);
    }
  });
});

describe('tariff treatment available is distinguished from exact classification unresolved', () => {
  test('CountryTruth renders a banner when an authoritative snapshot exists, independent of resolution', () => {
    expect(countryTruth).toContain('classification.source');
    expect(countryTruth).toMatch(/Tariff treatment/i);
  });

  test('the unresolved-classification heading never implies zero market-access evidence', () => {
    expect(countryTruth).toContain('Complete product classification');
    expect(countryTruth).not.toMatch(/no (market access )?evidence.*classification unresolved/i);
  });
});

describe('evidence coverage carries an accessible explanatory affordance', () => {
  test('InfoTooltip is exported with the accessible pattern, not a bare title attribute', () => {
    expect(discoveryComponents).toContain('export function InfoTooltip');
    expect(discoveryComponents).toContain('aria-describedby');
    expect(discoveryComponents).toContain('role="tooltip"');
  });

  test('the display label reads "Evidence coverage" while the underlying score is untouched', () => {
    expect(marketResults).toContain('Evidence coverage');
    expect(countryTruth).toContain('Evidence coverage');
    // The canonical field name evidence_confidence is still what is read from the projection —
    // only the display label changed.
    expect(marketResults).toContain('evidence_confidence');
  });

  test('the tooltip explains coverage is not a prediction of commercial success', () => {
    const explanations = readFileSync('src/lib/country-discovery/explanations.ts', 'utf8');
    expect(explanations).toMatch(/CONFIDENCE_MEANING\s*=\s*\n?\s*'[^']*not a prediction of commercial success/);
    expect(marketResults).toContain('CONFIDENCE_MEANING');
    expect(countryTruth).toContain('CONFIDENCE_MEANING');
  });
});
