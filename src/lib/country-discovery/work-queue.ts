/**
 * Prioritising ClearTrade's own Demand Discovery work.
 *
 * The problem this solves: a 20-market analysis produces up to four ClearTrade-owned actions per
 * market — confirm the tariff line, collect freight quotes, verify certifications, establish a
 * route — which is eighty tasks presented as one undifferentiated list. An agent reading it top
 * to bottom sources freight for Angola before the exporter has shown any interest in Angola.
 *
 * The ordering below is commercial, not alphabetical or by score alone:
 *
 *   1. **The selected market.** The exporter has committed. Everything else is speculative.
 *   2. **Markets the agent or exporter has explicitly marked** — promoted, or given an
 *      operational priority. A human has already said this one matters.
 *   3. **Top-ranked markets**, because that is where interest usually lands next.
 *   4. **Tasks that unblock more than one pillar** ahead of single-pillar ones at the same market.
 *   5. **Everything else**, which is real work but must not be presented as due now.
 *
 * A market the agent has rejected or marked not-selected produces no tasks at all: chasing
 * evidence for a market somebody has explicitly removed is pure waste.
 */
import type { ImprovementAction } from './improve';

export type WorkPriority = 'selected' | 'marked' | 'top_ranked' | 'backlog';

/** Coarse grouping used for the summary counts an agent sees before any list. */
export type WorkCategory = 'classification' | 'quotes' | 'certification' | 'route' | 'other';

export interface WorkTask {
  /** Stable id: market + action, so a task keeps identity across reloads. */
  code: string;
  country_code: string;
  country: string;
  /** AI rank of the market this task belongs to. */
  rank: number;
  label: string;
  detail: string;
  category: WorkCategory;
  priority: WorkPriority;
  /** Pillars this single task unblocks. More than one is worth doing first. */
  unlocks: string[];
  /** True when the market carries an explicit human decision to pursue it. */
  market_marked: boolean;
  market_selected: boolean;
}

const CATEGORY_OF: Record<string, WorkCategory> = {
  confirm_tariff_line: 'classification',
  collect_cost_quotes: 'quotes',
  verify_certifications: 'certification',
  establish_route: 'route',
};

export const CATEGORY_LABELS: Record<WorkCategory, string> = {
  classification: 'Tariff & classification',
  quotes: 'Freight & handling quotes',
  certification: 'Certification checks',
  route: 'Route confirmations',
  other: 'Other',
};

const PRIORITY_RANK: Record<WorkPriority, number> = { selected: 0, marked: 1, top_ranked: 2, backlog: 3 };

export const PRIORITY_LABELS: Record<WorkPriority, string> = {
  selected: 'Selected market',
  marked: 'Marked by ClearTrade',
  top_ranked: 'Top-ranked market',
  backlog: 'Backlog',
};

/** Markets outside this rank are backlog unless a human has marked them. */
export const TOP_RANKED_CUTOFF = 5;

export interface MarketWorkInput {
  country_code: string;
  country: string;
  rank: number;
  is_selected: boolean;
  /** An explicit agent decision to pursue: promoted, or carrying an operational priority. */
  is_marked: boolean;
  /** Rejected or marked not-selected — produces no work at all. */
  is_excluded: boolean;
  actions: readonly ImprovementAction[];
}

function priorityFor(market: MarketWorkInput): WorkPriority {
  if (market.is_selected) return 'selected';
  if (market.is_marked) return 'marked';
  if (market.rank > 0 && market.rank <= TOP_RANKED_CUTOFF) return 'top_ranked';
  return 'backlog';
}

/**
 * Build the ordered queue.
 *
 * Only ClearTrade-owned actions appear. The exporter's own missing facts belong on the
 * exporter's surface — duplicating them here would have an agent chase an exporter for data the
 * product is already asking them for directly.
 */
export function buildWorkQueue(markets: readonly MarketWorkInput[]): WorkTask[] {
  const tasks: WorkTask[] = [];
  for (const market of markets) {
    // A market somebody explicitly removed generates no work.
    if (market.is_excluded) continue;
    const priority = priorityFor(market);
    for (const action of market.actions) {
      if (action.owner !== 'cleartrade') continue;
      tasks.push({
        code: `${market.country_code}:${action.code}`,
        country_code: market.country_code,
        country: market.country,
        rank: market.rank,
        label: action.label,
        detail: action.detail,
        category: CATEGORY_OF[action.code] ?? 'other',
        priority,
        unlocks: [action.unlocks],
        market_marked: market.is_marked,
        market_selected: market.is_selected,
      });
    }
  }

  // Collapse the same action repeated across markets into one task per market, then order:
  // priority band, then how much the task unblocks, then AI rank, then a stable tiebreak.
  return tasks.sort((left, right) => {
    const band = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
    if (band !== 0) return band;
    const unlocks = right.unlocks.length - left.unlocks.length;
    if (unlocks !== 0) return unlocks;
    const rank = (left.rank || 999) - (right.rank || 999);
    if (rank !== 0) return rank;
    return left.code.localeCompare(right.code);
  });
}

export interface WorkSummary {
  total: number;
  /** Tasks a human has already prioritised — the honest "needs attention" figure. */
  needs_attention: number;
  /**
   * Category breakdown of the PRIORITISED tasks only. This must sum to `needs_attention`, never
   * to `total` — a category row reading "20" beside a headline of "20 need attention" while 60
   * more of that same category sit in the backlog is exactly the ambiguity that made "80
   * outstanding" unreadable. Backlog-inclusive counts live in `by_category_all`, shown only
   * behind an explicit disclosure.
   */
  by_category: Array<{ category: WorkCategory; label: string; count: number }>;
  /** The same breakdown across every task, backlog included. */
  by_category_all: Array<{ category: WorkCategory; label: string; count: number }>;
  by_priority: Array<{ priority: WorkPriority; label: string; count: number }>;
}

function categoryCounts(tasks: readonly WorkTask[]) {
  const byCategory = new Map<WorkCategory, number>();
  for (const task of tasks) byCategory.set(task.category, (byCategory.get(task.category) ?? 0) + 1);
  return [...byCategory].map(([category, count]) => ({ category, label: CATEGORY_LABELS[category], count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

/**
 * Summarise the queue for the page header.
 *
 * `needs_attention` deliberately excludes the backlog. "12 need attention" out of 80 total is a
 * truthful statement about what is actually due; presenting 80 as the outstanding figure is what
 * made the previous surface unusable.
 */
export function summariseWork(tasks: readonly WorkTask[]): WorkSummary {
  const byPriority = new Map<WorkPriority, number>();
  for (const task of tasks) byPriority.set(task.priority, (byPriority.get(task.priority) ?? 0) + 1);
  const prioritised = tasks.filter((task) => task.priority !== 'backlog');
  return {
    total: tasks.length,
    needs_attention: prioritised.length,
    by_category: categoryCounts(prioritised),
    by_category_all: categoryCounts(tasks),
    by_priority: (['selected', 'marked', 'top_ranked', 'backlog'] as const)
      .map((priority) => ({ priority, label: PRIORITY_LABELS[priority], count: byPriority.get(priority) ?? 0 }))
      .filter((entry) => entry.count > 0),
  };
}

/**
 * Which market-decision actions make sense right now.
 *
 * The previous control surface rendered all nine unconditionally, so "Pause automation" sat next
 * to "Resume automation" and "Reject" next to "Restore". The decision model already answers this
 * — `bucketFor()` derives the state and the current action says whether automation is paused — so
 * this is a read of existing data, not new state.
 */
export interface DecisionAvailability {
  primary: string[];
  overflow: string[];
  hidden: string[];
}

export function availableDecisions(input: {
  bucket: 'active' | 'flagged' | 'terminal';
  current_action: string | null;
}): DecisionAvailability {
  const terminal = input.bucket === 'terminal';
  const paused = input.current_action === 'pause_automation';
  const selected = input.current_action === 'mark_selected';
  const underReview = input.current_action === 'request_review';

  const hidden: string[] = [];
  const primary: string[] = [];
  const overflow: string[] = [];

  // A removed market offers exactly one sensible move: put it back.
  if (terminal) {
    primary.push('restore');
    hidden.push('promote', 'demote', 'mark_selected', 'mark_not_selected', 'reject', 'pause_automation', 'resume_automation', 'request_review');
    return { primary, overflow, hidden };
  }
  hidden.push('restore');

  if (selected) hidden.push('mark_selected');
  else primary.push('mark_selected');

  if (underReview) hidden.push('request_review');
  else primary.push('request_review');

  overflow.push('promote', 'demote');
  // Exactly one of pause/resume, never both.
  overflow.push(paused ? 'resume_automation' : 'pause_automation');
  hidden.push(paused ? 'pause_automation' : 'resume_automation');
  overflow.push(selected ? 'mark_not_selected' : 'reject');
  if (!selected) hidden.push('mark_not_selected');
  else hidden.push('reject');

  return { primary, overflow, hidden };
}
