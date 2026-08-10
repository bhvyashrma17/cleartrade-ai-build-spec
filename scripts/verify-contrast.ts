/**
 * Full-app WCAG AA contrast sweep.
 *
 * Crawls every rendered surface as each relevant role/tier and measures the *computed*
 * colour of every visible text node against its *effective* (alpha-composited)
 * background. Source-level grepping for a class name cannot do this: it misses which
 * background a token actually lands on, and it cannot see tinted surfaces like
 * `bg-action/10` or translucent text like `rgba(11,23,57,0.7)`.
 *
 *   npx tsx --env-file=.env scripts/verify-contrast.ts
 */

import {
  BASE,
  aaThreshold,
  contrast,
  launch,
  loggedInContext,
  NON_TEXT_THRESHOLD,
  parseRgb,
  preflight,
  PreflightError,
  sampleIconContrast,
  sampleTextContrast,
  sleep,
  guestContext,
  type Browser,
  type IconSample,
  type Page,
  type TextSample,
} from './verify-harness';
import { prisma } from '../src/lib/prisma';

interface Finding {
  surface: string;
  ratio: number;
  threshold: number;
  sample: TextSample;
}

interface IconFinding {
  surface: string;
  ratio: number;
  sample: IconSample;
}

const failures: Finding[] = [];
const nearMisses: Finding[] = [];
let measured = 0;

const iconFailures: IconFinding[] = [];
const iconPairs = new Map<string, IconFinding>();
let iconsMeasured = 0;

/**
 * A page that fails to render (auth redirect, 500, a component throwing, a selector
 * that no longer matches) contributes ZERO samples to `sweep()` — and a sweep with zero
 * samples has nothing to fail on, so it silently reports as clean. That is a false
 * green: the surface was never actually checked. Every registered surface below must
 * clear a minimum text-node count, or the sweep fails loudly rather than passing by
 * omission. Defaults are deliberately low (real pages sample in the dozens to hundreds)
 * so this only catches "the page rendered basically nothing," not routine content
 * variation between runs.
 */
const DEFAULT_MIN_TEXT_NODES = 3;

/** Per-surface overrides, keyed by the exact surface label passed to `sweep()`. */
const MIN_TEXT_NODES: Record<string, number> = {
  // Deliberately minimal states — asserting a floor here still catches "rendered
  // nothing at all," without demanding the dozens of nodes a populated page has.
  'guest /app/markets (empty)': 5,
  'not-found /nope': 3,
  // EXP-16 / AGT-06 / OPS-06 — the newest and densest surfaces, where a silent
  // zero-node pass would be the easiest way to ship an unverified regression.
  'paid /app/deals/:id/support': 25,
  'ops /ops/disputes/:id': 15,
  'agent /agent/deals/:id (execution)': 80,
  'agent /agent/deals/:id/commercial': 10,
  // EXP-17 / EXP-03 / EXP-07 — measured baselines were 138 / 79 / 44 / 32 nodes;
  // minimums set well below that so routine content variation never false-positives,
  // while a page that silently fails to render (auth redirect, thrown component) still
  // gets caught.
  'paid /app/notifications': 60,
  'paid /app/readiness/tasks': 40,
  'paid /app/buyers/:id': 20,
  'guest /app/buyers/:id (locked contacts)': 15,
};

interface CoverageRow {
  surface: string;
  textNodes: number;
  iconNodes: number;
  minRequired: number;
}

const coverage: CoverageRow[] = [];
const coverageFailures: string[] = [];

async function sweep(page: Page, surface: string) {
  const samples = await sampleTextContrast(page);
  const minRequired = MIN_TEXT_NODES[surface] ?? DEFAULT_MIN_TEXT_NODES;
  if (samples.length < minRequired) {
    const msg = `COVERAGE FAILURE: "${surface}" sampled only ${samples.length} text node(s), minimum is ${minRequired}. The page likely failed to render — this is NOT a passing surface.`;
    console.error(`  ✗ ${msg}`);
    coverageFailures.push(msg);
  }

  for (const s of samples) {
    const fg = parseRgb(s.color);
    const bg = parseRgb(s.background);
    if (!fg || !bg) continue;
    measured += 1;
    const ratio = contrast(fg, bg);
    const threshold = aaThreshold(s.fontSize, s.fontWeight);
    if (ratio < threshold) failures.push({ surface, ratio, threshold, sample: s });
    else if (ratio < threshold + 1) nearMisses.push({ surface, ratio, threshold, sample: s });
  }

  // SC 1.4.11 — graphical objects. Same surfaces, different rule and different
  // measurement path (stroke/fill, flat 3:1, no size relaxation).
  const icons = await sampleIconContrast(page);
  for (const s of icons) {
    const fg = parseRgb(s.color);
    const bg = parseRgb(s.background);
    if (!fg || !bg) continue;
    iconsMeasured += 1;
    const ratio = contrast(fg, bg);
    const key = `${s.color} on ${s.background}`;
    const prev = iconPairs.get(key);
    if (!prev || ratio < prev.ratio) iconPairs.set(key, { surface, ratio, sample: s });
    if (ratio < NON_TEXT_THRESHOLD) iconFailures.push({ surface, ratio, sample: s });
  }

  coverage.push({ surface, textNodes: samples.length, iconNodes: icons.length, minRequired });
}

async function main() {
  await preflight();
  const browser: Browser = await launch();

  try {
    // ---- Public surfaces (no session) ----
    const pub = await browser.newContext();
    const pubPage = await pub.newPage();
    for (const [surface, path] of [
      ['landing /', '/'],
      ['login /login', '/login'],
      ['register /register', '/register'],
      ['not-found /nope', '/definitely-not-a-route'],
    ] as const) {
      await pubPage.goto(BASE + path, { waitUntil: 'networkidle' });
      await sweep(pubPage, surface);
    }
    await pub.close();

    // ---- Guest surfaces (runs a real search so results/market detail render) ----
    const guestCtx = await guestContext(browser, 'contrast-guest');
    const gp = await guestCtx.newPage();
    await gp.goto(BASE + '/app/markets', { waitUntil: 'networkidle' });
    await sweep(gp, 'guest /app/markets (empty)');
    await gp.getByLabel('What do you export?').fill('Organic turmeric powder, food grade');
    await gp.getByRole('button', { name: /Find markets/i }).click();
    await gp.getByText(/Markets ranked|Ranked, with gaps/i).waitFor({ timeout: 40_000 });
    await gp.locator('ol li a[href^="/app/markets/"]').first().waitFor({ timeout: 15_000 });
    await sweep(gp, 'guest /app/markets (results)');
    await gp.locator('ol li a[href^="/app/markets/"]').first().click();
    await gp.waitForLoadState('networkidle');
    await sweep(gp, 'guest market detail (UpgradeNotice)');
    await gp.goto(BASE + '/app/buyers', { waitUntil: 'networkidle' });
    await sleep(1200);
    await sweep(gp, 'guest /app/buyers (locked contacts)');
    // EXP-07. The guest-tier UpgradeNotice replacing the contacts list and the
    // relationship CTA are new semantic surfaces distinct from the buyer LIST's own
    // locked-contacts state above.
    await gp.goto(BASE + '/app/buyers/seed-buyer-3', { waitUntil: 'networkidle' });
    await sleep(1200);
    await sweep(gp, 'guest /app/buyers/:id (locked contacts)');
    await guestCtx.close();

    // ---- Paid exporter ----
    const paid = await loggedInContext(browser, 'owner@sunriseagro.example');
    for (const [surface, path] of [
      ['paid /app/overview', '/app/overview'],
      ['paid /app/readiness', '/app/readiness'],
      ['paid /app/markets', '/app/markets'],
      ['paid /app/buyers', '/app/buyers'],
      // The cross-deal index views (docs/13 A1). /app/tasks in particular renders a
      // StatusChip per row, which is the densest icon-on-tint surface in the product.
      ['paid /app/tasks', '/app/tasks'],
      ['paid /app/deals', '/app/deals'],
      ['paid /app/messages', '/app/messages'],
      // EXP-16. Conversation bubbles, dispute severity/status chips and the proposed-
      // resolution accept panel are all new semantic-colour surfaces.
      ['paid /app/deals/:id/support', '/app/deals/seed-deal-locked/support'],
      // EXP-17. Notification severity chips, the "always on" locked-preference badge,
      // and the "Invite pending" status chip are all new semantic-colour surfaces.
      ['paid /app/notifications', '/app/notifications'],
      // EXP-03. Task state chips, the evidence review-outcome chip (approved/pending/
      // rejected) and the required/recommended section split all carry semantic colour.
      ['paid /app/readiness/tasks', '/app/readiness/tasks'],
      // EXP-07, paid view: verification/risk/lead-stage chips plus the unlocked
      // contacts list — distinct content from the guest-tier locked view above.
      ['paid /app/buyers/:id', '/app/buyers/seed-buyer-1'],
      ['paid /app/more', '/app/more'],
    ] as const) {
      await paid.page.goto(BASE + path, { waitUntil: 'networkidle' });
      await sleep(1200); // let client-side lists populate
      await sweep(paid.page, surface);
    }
    await paid.ctx.close();

    // ---- Free exporter (gated modules render UpgradeNotice) ----
    const free = await loggedInContext(browser, 'free@deccanspice.example');
    await free.page.goto(BASE + '/app/overview', { waitUntil: 'networkidle' });
    await sweep(free.page, 'free /app/overview (gated)');
    await free.ctx.close();

    // ---- Agent ----
    const agent = await loggedInContext(browser, 'agent@cleartrade.example');
    for (const [surface, path] of [
      ['agent /agent', '/agent'],
      ['agent /agent/outreach', '/agent/outreach'],
      // AGT-06. The densest surface in the product — status chips, gate states, blocker
      // text and the internal-only panel all carry semantic colour, so it is exactly the
      // page where a contrast regression would be easiest to miss by eye.
      ['agent /agent/deals/:id (execution)', '/agent/deals/seed-deal-locked'],
      ['agent /agent/deals/:id/commercial', '/agent/deals/seed-deal-locked/commercial'],
    ] as const) {
      await agent.page.goto(BASE + path, { waitUntil: 'networkidle' });
      await sleep(1200);
      await sweep(agent.page, surface);
    }
    await agent.ctx.close();

    // ---- Ops (supervisor sees the tower, exceptions and assignments) ----
    const ops = await loggedInContext(browser, 'ops@cleartrade.example');
    for (const [surface, path] of [
      ['ops /ops', '/ops'],
      ['ops /ops/exceptions', '/ops/exceptions'],
      ['ops /ops/assignments', '/ops/assignments'],
      ['ops /ops/disputes', '/ops/disputes'],
      // OPS-06 case detail: the visibility-segmented internal-notes block plus the
      // resolution-workflow action forms.
      ['ops /ops/disputes/:id', '/ops/disputes/seed-dispute-locked-proposed'],
    ] as const) {
      await ops.page.goto(BASE + path, { waitUntil: 'networkidle' });
      await sleep(1200);
      await sweep(ops.page, surface);
    }
    await ops.ctx.close();

    // ---- Ops finance (a distinct role: /ops/finance denies the supervisor) ----
    const finance = await loggedInContext(browser, 'finance@cleartrade.example');
    await finance.page.goto(BASE + '/ops/finance', { waitUntil: 'networkidle' });
    await sleep(1200);
    await sweep(finance.page, 'ops-finance /ops/finance');
    await finance.ctx.close();
  } finally {
    await browser.close();
  }

  // ---- Report ----
  console.log(`\n================ CONTRAST SWEEP ================`);
  console.log(`  Measured ${measured} visible text nodes across all surfaces.\n`);

  if (failures.length === 0) {
    console.log('  ✓ No WCAG AA failures.');
  } else {
    // Group identical colour pairs — one root cause usually explains many nodes.
    const byPair = new Map<string, Finding[]>();
    for (const f of failures) {
      const key = `${f.sample.color} on ${f.sample.background}`;
      byPair.set(key, [...(byPair.get(key) ?? []), f]);
    }
    console.log(`  ✗ ${failures.length} failing text nodes, ${byPair.size} distinct colour pairs:\n`);
    for (const [pair, group] of [...byPair.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const worst = group.reduce((a, b) => (a.ratio < b.ratio ? a : b));
      console.log(`  FAIL  ${pair}`);
      console.log(
        `        ${worst.ratio.toFixed(2)}:1 (needs ${worst.threshold}:1) · ${group.length} node(s) · ${worst.sample.fontSize}px`,
      );
      const surfaces = [...new Set(group.map((g) => g.surface))];
      console.log(`        surfaces: ${surfaces.join(' | ')}`);
      const texts = [...new Set(group.map((g) => `<${g.sample.selectorHint}> "${g.sample.text}"`))];
      texts.slice(0, 12).forEach((t) => console.log(`          - ${t}`));
      if (texts.length > 12) console.log(`          ... and ${texts.length - 12} more`);
      console.log('');
    }
  }

  if (nearMisses.length) {
    const byPair = new Map<string, Finding>();
    for (const f of nearMisses) {
      const key = `${f.sample.color} on ${f.sample.background}`;
      const prev = byPair.get(key);
      if (!prev || f.ratio < prev.ratio) byPair.set(key, f);
    }
    console.log(`  Near-threshold (passing, within 1.0 of the limit) — worth knowing:`);
    for (const [pair, f] of byPair) {
      console.log(`    ${f.ratio.toFixed(2)}:1 (needs ${f.threshold}:1)  ${pair}  e.g. "${f.sample.text}"`);
    }
  }

  // ---- Non-text contrast (SC 1.4.11) ----
  console.log(`\n================ NON-TEXT CONTRAST (WCAG 1.4.11, 3:1) ================`);
  console.log(`  Measured ${iconsMeasured} visible SVG icons across all surfaces.\n`);

  // Every distinct colour pair, pass or fail — the point of this pass is to put a
  // measured number on combinations that were previously only reasoned about.
  const sortedPairs = [...iconPairs.values()].sort((a, b) => a.ratio - b.ratio);
  for (const f of sortedPairs) {
    const verdict = f.ratio < NON_TEXT_THRESHOLD ? 'FAIL' : 'PASS';
    console.log(
      `  ${verdict}  ${f.ratio.toFixed(2)}:1  ${f.sample.paint} ${f.sample.color} on ${f.sample.background}` +
        ` · ${f.sample.size}px · ${f.sample.selectorHint}`,
    );
    console.log(`        e.g. "${f.sample.label}" · ${f.surface}`);
  }

  if (iconFailures.length === 0) {
    console.log(`\n  ✓ No WCAG 1.4.11 non-text failures.`);
  } else {
    const distinct = new Set(iconFailures.map((f) => `${f.sample.color} on ${f.sample.background}`));
    console.log(`\n  ✗ ${iconFailures.length} failing icon(s), ${distinct.size} distinct colour pair(s).`);
  }

  // ---- Coverage ----
  // A contrast pass only means something if every registered surface actually rendered.
  // This section is what makes that an assertion rather than an assumption.
  console.log(`\n================ COVERAGE (${coverage.length} surfaces registered) ================`);
  for (const row of coverage) {
    const ok = row.textNodes >= row.minRequired;
    console.log(
      `  ${ok ? '✓' : '✗'} ${row.surface.padEnd(42)} text=${String(row.textNodes).padStart(4)} (min ${row.minRequired})  icons=${row.iconNodes}`,
    );
  }
  if (coverageFailures.length === 0) {
    console.log('\n  ✓ Every registered surface cleared its minimum sample count.');
  } else {
    console.log(`\n  ✗ ${coverageFailures.length} surface(s) failed to clear their minimum sample count — see COVERAGE FAILURE lines above.`);
  }

  process.exitCode = failures.length || iconFailures.length || coverageFailures.length ? 1 : 0;
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) {
      console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    } else {
      console.error('SWEEP CRASHED:', e);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
