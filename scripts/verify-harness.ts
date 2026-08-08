/**
 * Shared harness for the browser verification suites.
 *
 * Extracted because the previous single-file suite died mid-run twice — once when a
 * scenario exhausted the shared guest quota and threw, once when a scenario timed out —
 * and in both cases every *later* scenario silently never ran while the summary still
 * printed a pass count. A partial run that looks like a complete one is worse than no
 * run at all, so the three properties below are enforced structurally.
 *
 *   1. **Scenario isolation.** `scenario()` catches. One failure records a FAIL and the
 *      suite continues, so the summary always covers every scenario.
 *   2. **Environment preflight.** Dev server, database, seed fixtures and a *functionally
 *      verified* worker are checked before any scenario runs, and fail loudly with a
 *      specific remedy rather than surfacing later as a confusing scenario timeout.
 *   3. **Quota isolation.** Every scenario that can mint a guest gets its own IP bucket,
 *      so the 2-runs-per-IP cap can never leak across scenarios and abort the run.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { JobType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';

export const BASE = 'http://localhost:3000';
export const PASSWORD = 'Password123!';

export type Status = 'PASS' | 'FAIL' | 'UNVERIFIED';

export interface Result {
  id: string;
  name: string;
  status: Status;
  detail: string;
}

export const results: Result[] = [];

export function record(id: string, name: string, status: Status, detail: string) {
  results.push({ id, name, status, detail });
  const mark = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '?';
  console.log(`${mark} [${id}] ${name}\n    ${detail}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one scenario in isolation.
 *
 * A throw becomes a recorded FAIL rather than aborting the process, so a broken
 * scenario never hides the results of the ones after it.
 */
export async function scenario(id: string, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    record(id, name, 'FAIL', `threw: ${message}`);
  }
}

/**
 * A distinct, deterministic client IP per scenario.
 *
 * The guest quota is keyed on hashed client IP. Sharing one bucket across scenarios is
 * what killed an earlier run: scenario 5 deliberately exhausts its cap, and every later
 * guest scenario then hit RATE_LIMITED and threw. Deriving the address from the scenario
 * id gives each one an independent allowance while staying reproducible between runs.
 */
export function ipFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 60000;
  // 198.18.0.0/15 is reserved for benchmarking (RFC 2544) — never a real client.
  return `198.18.${Math.floor(hash / 250) % 250}.${(hash % 250) + 1}`;
}

export async function guestContext(browser: Browser, id: string, extra: Record<string, unknown> = {}) {
  return browser.newContext({ extraHTTPHeaders: { 'x-real-ip': ipFor(id) }, ...extra });
}

/**
 * Log in through the real form and wait for the whole redirect chain to settle.
 *
 * The chain is form action -> "/" -> role home. Waiting only for "not /login" resolves at
 * "/" mid-chain and reads the wrong destination, so this waits for a *settled* URL: one
 * that is neither /login nor "/" and stops changing. A previous fixed `sleep(3500)` was
 * a coin flip under load — it flaked on the ops login during a five-suite back-to-back
 * run, reporting a redirect failure that did not reproduce in isolation. Polling for the
 * settled state is both faster in the common case and correct in the slow one.
 */
export async function loginAs(page: Page, email: string): Promise<string> {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /^Sign in$/i }).click();

  const deadline = Date.now() + 20_000;
  let lastPath = '';
  let stableSince = 0;
  while (Date.now() < deadline) {
    const path = new URL(page.url()).pathname;
    // Landed somewhere that isn't the login form or the bare root hop.
    if (path !== '/login' && path !== '/') {
      if (path === lastPath) {
        // Same destination twice ~400ms apart: the chain has stopped moving.
        if (stableSince && Date.now() - stableSince >= 400) return path;
        if (!stableSince) stableSince = Date.now();
      } else {
        stableSince = Date.now();
      }
    } else {
      stableSince = 0;
    }
    lastPath = path;
    await sleep(200);
  }
  return new URL(page.url()).pathname;
}

export async function loggedInContext(browser: Browser, email: string, extra: Record<string, unknown> = {}) {
  const ctx = await browser.newContext(extra);
  const page = await ctx.newPage();
  await loginAs(page, email);
  return { ctx, page };
}

// ---------------------------------------------------------------------------
// Contrast measurement (WCAG 2.1)
// ---------------------------------------------------------------------------

function srgbToLinear(c: number) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: number[]) {
  return 0.2126 * srgbToLinear(r!) + 0.7152 * srgbToLinear(g!) + 0.0722 * srgbToLinear(b!);
}
export function contrast(fg: number[], bg: number[]) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/**
 * Accepts both `rgb()/rgba()` and Chrome's `color(srgb r g b / a)` — the form it uses
 * when serialising a `color-mix()` result. The browser-side samplers already normalise
 * to rgb() before returning, but this is also called directly on raw computed values
 * (e.g. browser-verify's spot checks), where the color-mix form does appear.
 */
export function parseRgb(s: string): number[] | null {
  const mix = s.match(/color\(srgb\s+([^)]+)\)/);
  if (mix) {
    const channels = mix[1]!.split('/')[0]!.trim().split(/\s+/).map(parseFloat);
    if (channels.length < 3 || channels.some((n) => Number.isNaN(n))) return null;
    return [channels[0]! * 255, channels[1]! * 255, channels[2]! * 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1]!.split(',').map((p) => parseFloat(p.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

export interface TextSample {
  text: string;
  color: string;
  background: string;
  fontSize: number;
  fontWeight: string;
  selectorHint: string;
}

/**
 * Every visible text node on the page with its computed colour and *effective*
 * background — walking ancestors past transparent backgrounds, which is the step a
 * naive check skips (it reads `rgba(0,0,0,0)` and computes a meaningless ratio).
 *
 * Alpha is composited against the resolved backdrop rather than ignored: this codebase
 * uses `rgba(11,23,57,0.7)` for secondary text and tinted `bg-action/10` surfaces, and
 * treating either as opaque gives a wrong number.
 */
/**
 * Passed to `page.evaluate` as a STRING, not a function.
 *
 * tsx/esbuild compiles with `keepNames`, which injects a `__name` helper call around
 * every named function. `page.evaluate(fn)` serialises the function source and runs it
 * in the browser, where that helper does not exist — so any named inner function throws
 * `ReferenceError: __name is not defined`. A string is never touched by the compiler.
 */
const SAMPLE_TEXT_CONTRAST_JS = `(() => {
  // Handles both rgba() and Chrome's "color(srgb r g b / a)" serialisation of
  // color-mix(). Without the latter branch, every color-mix() tint parses as null and
  // the backdrop walk skips straight past it to the opaque parent — understating the
  // real backdrop on StatusChip and every other tinted surface.
  const parse = (s) => {
    if (!s) return null;
    const mix = s.match(/color\\(srgb\\s+([^)]+)\\)/);
    if (mix) {
      const body = mix[1].split('/');
      const ch = body[0].trim().split(/\\s+/).map(parseFloat);
      const a = body.length > 1 ? parseFloat(body[1]) : 1;
      if (ch.length < 3 || ch.some(Number.isNaN)) return null;
      return [ch[0] * 255, ch[1] * 255, ch[2] * 255, Number.isNaN(a) ? 1 : a];
    }
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return p.length >= 3 ? [p[0], p[1], p[2], p.length > 3 ? p[3] : 1] : null;
  };
  const composite = (fg, bg) => [0, 1, 2].map((i) => fg[i] * (fg[3] === undefined ? 1 : fg[3]) + bg[i] * (1 - (fg[3] === undefined ? 1 : fg[3])));
  // Two-pass: collect layers nearest-to-farthest, stopping at the first opaque one (or
  // the root, with white as an implicit opaque base), then fold FARTHEST-to-NEAREST.
  //
  // The single-pass version this replaced composited each newly-found ancestor layer
  // directly as "bg" using its raw (undiluted) channel values — correct only when that
  // layer is itself opaque. When two translucent layers of the SAME hue stack (e.g. a
  // StatusChip's 12% tint nested inside a banner's 5% tint of the same colour — a
  // pattern that exists in this codebase but had never been exercised/rendered before),
  // fg[i] === bg[i] for every channel and fg*a + bg*(1-a) collapses to that shared value
  // regardless of either alpha — reporting the pure, fully-saturated hue as the backdrop
  // instead of the true, much lighter blended tint. Folding outward-in first guarantees
  // every composite step's backdrop is already fully resolved/opaque, which is what the
  // "over" formula actually requires.
  const effectiveBackground = (el) => {
    const layers = [];
    let node = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
      node = node.parentElement;
    }
    layers.reverse();
    let acc = [255, 255, 255];
    for (const c of layers) {
      const a = c[3] === undefined ? 1 : c[3];
      acc = [0, 1, 2].map((i) => c[i] * a + acc[i] * (1 - a));
    }
    return acc;
  };

  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walker.nextNode())) {
    const text = (n.textContent || '').trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width === 0 || rect.height === 0) continue;
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
    if (el.closest('nextjs-portal, [data-nextjs-dialog], #__next_route_announcer__')) continue;
    // Screen-reader-only text is never painted, so its colour contrast is meaningless.
    // .sr-only sizes itself 1x1 and clips, so the zero-size check above does not catch
    // it — without this, invisible text reports as a colour-contrast failure.
    if (el.closest('.sr-only')) continue;
    if (style.clip === 'rect(0px, 0px, 0px, 0px)') continue;
    seen.add(el);

    const fgRaw = parse(style.color);
    if (!fgRaw) continue;
    const bg = effectiveBackground(el);
    const fg = fgRaw[3] < 1 ? composite(fgRaw, bg) : fgRaw.slice(0, 3);
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).slice(0, 2).join('.') : '';

    out.push({
      text: text.slice(0, 45),
      color: 'rgb(' + fg.map((v) => Math.round(v)).join(', ') + ')',
      background: 'rgb(' + bg.map((v) => Math.round(v)).join(', ') + ')',
      fontSize: parseFloat(style.fontSize),
      fontWeight: style.fontWeight,
      selectorHint: el.tagName.toLowerCase() + cls,
    });
  }
  return out;
})()`;

export async function sampleTextContrast(page: Page): Promise<TextSample[]> {
  return page.evaluate(SAMPLE_TEXT_CONTRAST_JS) as Promise<TextSample[]>;
}

/** WCAG AA threshold: 3:1 for large text (>=24px, or >=18.66px bold), else 4.5:1. */
export function aaThreshold(fontSize: number, fontWeight: string): number {
  const large = fontSize >= 24 || (fontSize >= 18.66 && Number(fontWeight) >= 700);
  return large ? 3 : 4.5;
}

// ---------------------------------------------------------------------------
// Non-text (graphical object) contrast — WCAG 2.1 SC 1.4.11, fixed 3:1
// ---------------------------------------------------------------------------

export interface IconSample {
  /** Accessible/owning label, so a failure is identifiable in the UI. */
  label: string;
  /** The painted colour: stroke for line icons, fill for solid ones. */
  color: string;
  /** Which SVG paint property supplied `color`. */
  paint: 'stroke' | 'fill';
  background: string;
  size: number;
  selectorHint: string;
}

/**
 * Every visible SVG icon with its painted colour against its *composited* backdrop.
 *
 * The text crawler cannot cover this: SC 1.4.11 governs graphical objects, whose colour
 * lives in `stroke`/`fill` rather than `color`, and which carry no font size — so they
 * are invisible to a TreeWalker over text nodes and to the 4.5:1 text threshold.
 *
 * This matters specifically for `StatusChip`. Its label was moved to navy for AA while
 * the icon deliberately kept the full-saturation hue (the palette hue is the colour cue
 * that pairs with the label, per docs/00 §2). That icon is then painted on a 12%
 * `color-mix()` tint of the same hue — a case nothing had ever measured, and the one
 * combination where a hue-on-its-own-tint could quietly fall under 3:1.
 *
 * `getComputedStyle` on the <svg> resolves `currentColor` to the inherited text colour,
 * which is exactly what gets painted, so no manual colour-inheritance walk is needed.
 */
const SAMPLE_ICON_CONTRAST_JS = `(() => {
  // Must handle BOTH serialisations. Chrome returns a color-mix() result as
  // "color(srgb r g b / a)" with 0-1 channels and space separators — not as rgba().
  // An rgba-only regex silently returns null for exactly the tinted surfaces this pass
  // exists to measure, and the walk then continues past the tint to the white parent,
  // reporting the icon as sitting on plain white. Measured, that understated every
  // StatusChip backdrop in the app.
  const parse = (s) => {
    if (!s) return null;
    const mix = s.match(/color\\(srgb\\s+([^)]+)\\)/);
    if (mix) {
      const body = mix[1].split('/');
      const ch = body[0].trim().split(/\\s+/).map(parseFloat);
      const a = body.length > 1 ? parseFloat(body[1]) : 1;
      if (ch.length < 3 || ch.some(Number.isNaN)) return null;
      return [ch[0] * 255, ch[1] * 255, ch[2] * 255, Number.isNaN(a) ? 1 : a];
    }
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return p.length >= 3 ? [p[0], p[1], p[2], p.length > 3 ? p[3] : 1] : null;
  };
  const composite = (fg, bg) => [0, 1, 2].map((i) => fg[i] * (fg[3] === undefined ? 1 : fg[3]) + bg[i] * (1 - (fg[3] === undefined ? 1 : fg[3])));
  // Start from the icon's PARENT: the tint the icon sits on is painted by an ancestor
  // (the chip), never by the <svg> itself, which is always transparent.
  //
  // Two-pass: collect layers nearest-to-farthest, stopping at the first opaque one (or
  // the root, with white as an implicit opaque base), then fold FARTHEST-to-NEAREST. The
  // single-pass version this replaced composited each newly-found ancestor layer
  // directly as "bg" using its raw (undiluted) channel values — correct only when that
  // layer is itself opaque. When two translucent layers of the SAME hue stack (e.g. a
  // StatusChip's 12% tint nested inside a banner's 5% tint of the same colour — exactly
  // what /app/overview's risk banner does, and which had never been rendered before
  // seeding a deal with risk_state=blocked), fg[i] === bg[i] for every channel and
  // fg*a + bg*(1-a) collapses to that shared value regardless of either alpha —
  // reporting the pure, fully-saturated hue (measured: a false 2.20:1 "failure") instead
  // of the true, much lighter blended tint (the real ratio is 6.24:1). Folding
  // outward-in first guarantees every composite step's backdrop is already fully
  // resolved/opaque, which is what the "over" formula actually requires.
  const effectiveBackground = (el) => {
    const layers = [];
    let node = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
      node = node.parentElement;
    }
    layers.reverse();
    let acc = [255, 255, 255];
    for (const c of layers) {
      const a = c[3] === undefined ? 1 : c[3];
      acc = [0, 1, 2].map((i) => c[i] * a + acc[i] * (1 - a));
    }
    return acc;
  };
  const labelFor = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.slice(0, 40);
    // The chip's own text is the icon's meaning-partner; use it to identify the row.
    let node = el.parentElement;
    for (let i = 0; i < 3 && node; i++) {
      const t = (node.textContent || '').trim();
      if (t) return t.slice(0, 40);
      node = node.parentElement;
    }
    return '(unlabelled icon)';
  };

  const out = [];
  for (const svg of document.querySelectorAll('svg')) {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const style = getComputedStyle(svg);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
    if (svg.closest('nextjs-portal, [data-nextjs-dialog], #__next_route_announcer__')) continue;
    if (svg.closest('.sr-only')) continue;

    // Decorative-only icons are exempt from 1.4.11: they convey nothing, so there is no
    // information to lose. Everything in this codebase marks them aria-hidden AND pairs
    // them with a visible text label — but only skip when the icon is genuinely
    // redundant, i.e. its labelled container also renders text.
    const container = svg.parentElement;
    const containerText = container ? (container.textContent || '').trim() : '';
    const purelyDecorative = svg.getAttribute('aria-hidden') === 'true' && containerText.length > 0;

    // Line icons paint with stroke; solid ones with fill. Prefer whichever is actually
    // painted — reading fill on a stroke-only icon yields "none" and a bogus ratio.
    const strokeRaw = parse(style.stroke);
    const fillRaw = parse(style.fill);
    const strokePainted = strokeRaw && style.stroke !== 'none';
    const paint = strokePainted ? 'stroke' : 'fill';
    const raw = strokePainted ? strokeRaw : fillRaw;
    if (!raw) continue;

    const bg = effectiveBackground(svg.parentElement || svg);
    const fg = raw[3] < 1 ? composite(raw, bg) : raw.slice(0, 3);
    const cls = svg.className && typeof svg.className.baseVal === 'string' && svg.className.baseVal
      ? '.' + svg.className.baseVal.split(/\\s+/).slice(0, 2).join('.')
      : '';

    out.push({
      label: labelFor(svg),
      color: 'rgb(' + fg.map((v) => Math.round(v)).join(', ') + ')',
      paint: paint,
      background: 'rgb(' + bg.map((v) => Math.round(v)).join(', ') + ')',
      size: Math.round(Math.min(rect.width, rect.height)),
      selectorHint: 'svg' + cls + (purelyDecorative ? ' [decorative]' : ''),
    });
  }
  return out;
})()`;

export async function sampleIconContrast(page: Page): Promise<IconSample[]> {
  return page.evaluate(SAMPLE_ICON_CONTRAST_JS) as Promise<IconSample[]>;
}

/**
 * WCAG 2.1 SC 1.4.11 Non-text Contrast: a flat 3:1, with no large-size relaxation —
 * unlike text, a graphical object gets no easier threshold for being bigger.
 */
export const NON_TEXT_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export class PreflightError extends Error {}

/**
 * Verify the environment BEFORE any scenario runs, and say exactly how to fix it.
 *
 * The worker check is functional rather than a process-list grep: it enqueues a probe
 * job for a type with no registered handler and waits for the worker to claim it and
 * fail it with NO_HANDLER. That proves jobs are actually being drained — a `pgrep` hit
 * would only prove a process exists, which is not the same thing and is exactly the kind
 * of false assurance that made a previous run hang.
 */
export async function preflight(): Promise<void> {
  // 1. Dev server
  try {
    const res = await fetch(BASE + '/login', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (error) {
    throw new PreflightError(
      `Dev server not reachable at ${BASE} (${error instanceof Error ? error.message : error}).\n` +
        `  Fix: npm run dev`,
    );
  }

  // 2. Database + seed fixtures
  let orgs;
  try {
    orgs = await prisma.exporterOrg.findMany({ select: { id: true, tier: true } });
  } catch (error) {
    throw new PreflightError(
      `Database not reachable (${error instanceof Error ? error.message : error}).\n  Fix: start Postgres, then npm run db:seed`,
    );
  }
  const tiers = new Set(orgs.map((o) => o.tier));
  for (const required of ['paid', 'free'] as const) {
    if (!tiers.has(required)) {
      throw new PreflightError(
        `Seed fixture missing: no '${required}' tier org in the database.\n  Fix: npm run db:seed`,
      );
    }
  }
  const users = await prisma.user.count({ where: { email: { endsWith: '@cleartrade.example' } } });
  if (users < 2) {
    throw new PreflightError(`Seed fixture missing: agent/ops users absent.\n  Fix: npm run db:seed`);
  }

  // 3. Worker liveness — functional probe, not a process check.
  const probeKey = `preflight-probe-${Date.now()}`;
  const probe = await prisma.job.create({
    data: {
      type: JobType.report_export, // deliberately has no handler -> fails fast when claimed
      payload: {},
      dedupe_key: probeKey,
      correlation_id: probeKey,
      // One attempt only: with the default budget, NO_HANDLER *requeues* the job, so its
      // status flips processing -> queued again and polling on status alone would miss
      // the claim entirely and wrongly report the worker as dead.
      max_attempts: 1,
    },
  });
  const deadline = Date.now() + 15_000;
  let claimed = false;
  while (Date.now() < deadline) {
    // `attempts` is monotonic and only the worker increments it — an unambiguous
    // "something claimed this" signal regardless of where the status settles.
    const row = await prisma.job.findUnique({ where: { id: probe.id }, select: { attempts: true } });
    if (row && row.attempts > 0) {
      claimed = true;
      break;
    }
    await sleep(400);
  }
  await prisma.jobAttempt.deleteMany({ where: { job_id: probe.id } });
  await prisma.job.delete({ where: { id: probe.id } }).catch(() => undefined);
  if (!claimed) {
    throw new PreflightError(
      `Worker is not draining the job queue — a probe job sat in 'queued' for 15s.\n` +
        `  Every job-dependent scenario (discovery, readiness) would hang or time out.\n` +
        `  Fix: npm run worker`,
    );
  }

  // 4. Guest quota — cleared so a previous run's exhausted buckets cannot abort this one.
  await prisma.guestRunQuota.deleteMany({});

  console.log('✓ preflight: dev server up, DB seeded, worker draining, guest quota cleared\n');
}

export async function launch(): Promise<Browser> {
  return chromium.launch();
}

export function summarize(title: string) {
  console.log(`\n================ ${title} ================`);
  const pass = results.filter((r) => r.status === 'PASS');
  const fail = results.filter((r) => r.status === 'FAIL');
  const unver = results.filter((r) => r.status === 'UNVERIFIED');
  console.log(`  PASS ${pass.length} · FAIL ${fail.length} · UNVERIFIED ${unver.length}  (of ${results.length})`);
  if (fail.length) {
    console.log('\n  FAILED:');
    fail.forEach((f) => console.log(`    [${f.id}] ${f.name}\n        ${f.detail}`));
  }
  if (unver.length) {
    console.log('\n  UNVERIFIED:');
    unver.forEach((f) => console.log(`    [${f.id}] ${f.name}\n        ${f.detail}`));
  }
  // A completed run is the point: exit non-zero only on real failures.
  process.exitCode = fail.length ? 1 : 0;
}

export type { Browser, BrowserContext, Page };
