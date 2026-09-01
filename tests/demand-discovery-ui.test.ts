import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  availableDecisions, buildWorkQueue, summariseWork, TOP_RANKED_CUTOFF,
  type MarketWorkInput,
} from '@/lib/country-discovery/work-queue';
import type { ImprovementAction } from '@/lib/country-discovery/improve';

/**
 * Demand Discovery UI behaviour.
 *
 * The defects these pin are the ones that made the previous surface unusable rather than
 * incorrect: eighty undifferentiated tasks presented as due, and nine market controls rendered
 * unconditionally including pairs that can never both apply.
 */

const CLEARTRADE_ACTIONS: ImprovementAction[] = [
  { code: 'confirm_tariff_line', label: 'Confirm the destination tariff line and duty', owner: 'cleartrade', unlocks: 'Market access', href: null, detail: 'x' },
  { code: 'collect_cost_quotes', label: 'Collect freight, handling and insurance quotes', owner: 'cleartrade', unlocks: 'Export economics', href: null, detail: 'x' },
  { code: 'verify_certifications', label: 'Verify your certifications', owner: 'cleartrade', unlocks: 'Exporter fit', href: null, detail: 'x' },
  { code: 'establish_route', label: 'Establish a shipping route to this destination', owner: 'cleartrade', unlocks: 'Logistics', href: null, detail: 'x' },
];
const EXPORTER_ACTION: ImprovementAction = {
  code: 'add_export_price', label: 'Add your target export price', owner: 'exporter',
  unlocks: 'Export economics', href: '/app/products/p/facts', detail: 'x',
};

const market = (over: Partial<MarketWorkInput> & { country_code: string; rank: number }): MarketWorkInput => ({
  country: over.country ?? over.country_code,
  is_selected: false, is_marked: false, is_excluded: false,
  actions: [...CLEARTRADE_ACTIONS, EXPORTER_ACTION],
  ...over,
});

/** The real shape: twenty analysed markets, four ClearTrade actions each. */
const TWENTY = Array.from({ length: 20 }, (_, i) =>
  market({ country_code: `C${String(i).padStart(2, '0')}`, country: `Country ${i}`, rank: i + 1 }));

describe('work queue prioritisation', () => {
  test('the selected market comes first, whatever its AI rank', () => {
    const markets = TWENTY.map((m, i) => (i === 14 ? { ...m, is_selected: true } : m));
    const queue = buildWorkQueue(markets);
    // Rank 15 outranks rank 1 once the exporter has committed to it.
    expect(queue[0]!.country_code).toBe('C14');
    expect(queue[0]!.priority).toBe('selected');
    expect(queue.slice(0, 4).every((task) => task.country_code === 'C14')).toBe(true);
  });

  test('a market a human marked outranks a higher-ranked market nobody marked', () => {
    const markets = TWENTY.map((m, i) => (i === 11 ? { ...m, is_marked: true } : m));
    const queue = buildWorkQueue(markets);
    expect(queue[0]!.priority).toBe('marked');
    expect(queue[0]!.country_code).toBe('C11');
    // The untouched rank-1 market is still ahead of the rest, but behind the marked one.
    expect(queue.find((task) => task.priority === 'top_ranked')!.country_code).toBe('C00');
  });

  test('only the leading markets are "due"; the rest are backlog, not demanded', () => {
    const queue = buildWorkQueue(TWENTY);
    const summary = summariseWork(queue);
    // 20 markets x 4 ClearTrade actions.
    expect(summary.total).toBe(80);
    // This is the whole point: 80 exists, but 20 is what is actually due.
    expect(summary.needs_attention).toBe(TOP_RANKED_CUTOFF * 4);
    expect(summary.needs_attention).toBeLessThan(summary.total);
  });

  test('a rejected market generates no work at all', () => {
    const markets = TWENTY.map((m, i) => (i === 0 ? { ...m, is_excluded: true } : m));
    const queue = buildWorkQueue(markets);
    expect(queue.some((task) => task.country_code === 'C00')).toBe(false);
    // Chasing evidence for a market somebody explicitly removed is pure waste.
    expect(queue).toHaveLength(19 * 4);
  });

  test('exporter-owned actions never enter the agent queue', () => {
    const queue = buildWorkQueue(TWENTY);
    expect(queue.some((task) => task.label.includes('Add your target export price'))).toBe(false);
    expect(queue.every((task) => CLEARTRADE_ACTIONS.some((a) => a.label === task.label))).toBe(true);
  });

  test('the category breakdown sums to what is prioritised, not to the raw total', () => {
    // This is the Part 3 fix: a category row reading "20" beside a headline of "20 need
    // attention" while 60 more of that category sit in the backlog is the exact ambiguity that
    // made "80 outstanding" unreadable. `by_category` must sum to `needs_attention`.
    const summary = summariseWork(buildWorkQueue(TWENTY));
    const labels = summary.by_category.map((entry) => entry.label);
    expect(labels).toEqual(expect.arrayContaining([
      'Tariff & classification', 'Freight & handling quotes', 'Certification checks', 'Route confirmations',
    ]));
    expect(summary.by_category.reduce((sum, entry) => sum + entry.count, 0)).toBe(summary.needs_attention);
    expect(summary.by_category.reduce((sum, entry) => sum + entry.count, 0)).not.toBe(summary.total);
    // The backlog-inclusive breakdown is still available, just separately labelled.
    expect(summary.by_category_all.reduce((sum, entry) => sum + entry.count, 0)).toBe(summary.total);
  });

  test('ordering is total and stable', () => {
    const first = buildWorkQueue(TWENTY).map((task) => task.code);
    const shuffled = buildWorkQueue([...TWENTY].reverse()).map((task) => task.code);
    expect(shuffled).toEqual(first);
  });
});

describe('market decision controls are state-aware', () => {
  test('pause and resume never appear together', () => {
    const idle = availableDecisions({ bucket: 'active', current_action: null });
    expect(idle.overflow).toContain('pause_automation');
    expect(idle.overflow).not.toContain('resume_automation');

    const paused = availableDecisions({ bucket: 'flagged', current_action: 'pause_automation' });
    expect(paused.overflow).toContain('resume_automation');
    expect(paused.overflow).not.toContain('pause_automation');
    expect(paused.hidden).toContain('pause_automation');
  });

  test('a removed market offers only Restore', () => {
    const terminal = availableDecisions({ bucket: 'terminal', current_action: 'reject' });
    expect(terminal.primary).toEqual(['restore']);
    expect(terminal.overflow).toHaveLength(0);
    for (const impossible of ['promote', 'demote', 'reject', 'mark_selected', 'pause_automation']) {
      expect(terminal.hidden).toContain(impossible);
    }
  });

  test('Restore is hidden while a market is live', () => {
    expect(availableDecisions({ bucket: 'active', current_action: null }).hidden).toContain('restore');
    expect(availableDecisions({ bucket: 'flagged', current_action: 'request_review' }).hidden).toContain('restore');
  });

  test('a selected market offers "not selected", never "reject", and never re-selection', () => {
    const selected = availableDecisions({ bucket: 'active', current_action: 'mark_selected' });
    expect(selected.primary).not.toContain('mark_selected');
    expect(selected.hidden).toContain('mark_selected');
    expect(selected.overflow).toContain('mark_not_selected');
    expect(selected.overflow).not.toContain('reject');
  });

  test('at most two primary actions; everything else is behind the overflow', () => {
    for (const state of [
      { bucket: 'active' as const, current_action: null },
      { bucket: 'flagged' as const, current_action: 'request_review' },
      { bucket: 'active' as const, current_action: 'mark_selected' },
    ]) {
      const available = availableDecisions(state);
      expect(available.primary.length).toBeLessThanOrEqual(2);
      // No action is ever offered in two places at once.
      expect(available.primary.filter((a) => available.overflow.includes(a))).toHaveLength(0);
      expect(available.primary.filter((a) => available.hidden.includes(a))).toHaveLength(0);
    }
  });
});

describe('role-appropriate rendering', () => {
  const agent = readFileSync('src/components/agent/CountryTruthWork.tsx', 'utf8');
  const controls = readFileSync('src/components/agent/MarketDecisionControls.tsx', 'utf8');
  const exporterResults = readFileSync('src/app/app/products/[productId]/markets/MarketResults.tsx', 'utf8');
  const exporterDetail = readFileSync('src/app/app/products/[productId]/markets/[country]/CountryTruth.tsx', 'utf8');
  const opsPage = readFileSync('src/app/ops/discovery/page.tsx', 'utf8');

  test('the agent page opens with a summary, not with the task list', () => {
    expect(agent).toContain('SummaryHeader');
    expect(agent).toContain('WorkSummaryPanel');
    // The queue is revealed, not the landing content.
    expect(agent).toContain('View tasks');
    expect(agent).toContain("useState(false)");
    // The old headline is gone.
    expect(agent).not.toContain('ClearTrade actions outstanding');
  });

  test('the exporter never sees staff vocabulary or operational controls', () => {
    for (const source of [exporterResults, exporterDetail]) {
      for (const staffTerm of [
        'Promote', 'Demote', 'Mark not selected', 'Pause automation', 'Resume automation',
        'Request review', 'operational order', 'agent_priority', 'MarketDecisionControls',
      ]) {
        expect(source).not.toContain(staffTerm);
      }
      // No raw engineering state reaches the exporter.
      expect(source).not.toMatch(/potentially_applicable_requires_origin_proof|insufficient_exporter_data|ExporterFitBenchmark/);
    }
  });

  test('the exporter results page shows a shortlist first, not all twenty', () => {
    expect(exporterResults).toContain('results.markets.slice(0, 5)');
    expect(exporterResults).toContain('View all');
    expect(exporterResults).toContain('SummaryHeader');
  });

  test('ops controls live on the ops route, not inside exporter product pages', () => {
    expect(opsPage).toContain('isOps');
    expect(opsPage).toContain('MarketScanQueue');
    expect(exporterResults).not.toContain('MarketScanQueue');
    expect(exporterDetail).not.toContain('MarketScanQueue');
  });

  test('decision controls render primary actions plus one overflow', () => {
    expect(controls).toContain('availableDecisions');
    expect(controls).toContain('OverflowMenu');
    // The unconditional nine-button map is gone.
    expect(controls).not.toContain('{ACTIONS.map((a) => (');
  });

  test('AI recommendation and agent decision stay separate', () => {
    const control = readFileSync('src/components/agent/DemandDiscoveryControl.tsx', 'utf8');
    expect(control).toContain('OperationalOrderCell');
    expect(control).toContain('DecisionCell');
    // The operational order says where its number came from, so it is never read as a score.
    expect(control).toContain('from {source}');
  });
});

describe('status is never colour alone, and layout is responsive', () => {
  const shared = readFileSync('src/components/discovery/index.tsx', 'utf8');

  test('every market status carries a word and an icon', () => {
    expect(shared).toContain('STATUS_STYLE');
    for (const tone of ['ready', 'needs_classification', 'needs_evidence', 'incomplete']) {
      expect(shared).toContain(tone);
    }
    // StatusChip is the shared label+icon+colour treatment; no bare coloured dot exists.
    expect(shared).toContain('StatusChip');
  });

  test('wide tables scroll inside their own container and become cards on mobile', () => {
    expect(shared).toContain('overflow-x-auto');
    expect(shared).toContain('hidden');
    expect(shared).toContain('md:hidden');
  });

  test('tables carry semantic headers and a caption', () => {
    expect(shared).toContain('<caption');
    expect(shared).toContain('scope="col"');
    expect(shared).toContain('sr-only');
  });

  test('the overflow menu is keyboard-operable and labelled', () => {
    expect(shared).toContain('aria-label');
    // <details>/<summary> gives keyboard operation and focus handling natively.
    expect(shared).toContain('<details');
    expect(shared).toContain('focus-visible:outline');
  });
});
