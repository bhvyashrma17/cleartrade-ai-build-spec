import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Navigation must not point at pages that do not exist.
 *
 * Source-level ON PURPOSE, and one of the few places it is the right tool: the nav table is a
 * static list of hrefs, and the question — "does a route file exist for each?" — is answered by
 * the filesystem, not by any runtime behaviour a test could drive. Rendering the shell would
 * prove which links appear for a role, not whether their targets resolve.
 *
 * The route-existence half IS behavioural: it checks the App Router's own resolution rule
 * (a `page.tsx` at the matching path), not a string in a file.
 */

const APP_DIR = path.resolve('src/app');

/** Hrefs declared in the portal navigation table. */
async function navHrefs(): Promise<string[]> {
  const shell = await readFile(path.resolve('src/components/shell/AppShell.tsx'), 'utf8');
  // Strip comments so an href named in an explanation (e.g. "removed /ops/settings") is not
  // mistaken for a live nav entry — the exact false positive this suite exists to avoid.
  const code = shell
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  return [...new Set([...code.matchAll(/href: '(\/[^']*)'/g)].map((m) => m[1]!))];
}

/** Whether the App Router can resolve this path to a page. */
function routeExists(href: string): boolean {
  const segments = href.replace(/^\//, '').split('/').filter(Boolean);
  if (segments.length === 0) return existsSync(path.join(APP_DIR, 'page.tsx'));
  // Try the literal path, then any route-group wrapper — `(auth)/login` serves `/login`.
  if (existsSync(path.join(APP_DIR, ...segments, 'page.tsx'))) return true;
  const groups = ['(auth)', '(app)', '(admin)'];
  return groups.some((group) => existsSync(path.join(APP_DIR, group, ...segments, 'page.tsx')));
}

describe('portal navigation', () => {
  test('every navigation link resolves to a real page', async () => {
    const hrefs = await navHrefs();
    expect(hrefs.length).toBeGreaterThan(10);
    const dead = hrefs.filter((href) => !routeExists(href));
    // Shipping a link to a 404 reads as a broken product rather than an unbuilt one. Phase 4
    // removed /ops/compliance, /ops/settings, /app/documents, /app/shipments, /app/payments and
    // /app/support for exactly this reason, and built /agent/deals and /agent/escalations.
    expect(dead, `dead navigation links: ${dead.join(', ')}`).toEqual([]);
  });

  test('the routes Phase 4 added are present', () => {
    for (const href of ['/agent/deals', '/agent/escalations', '/agent/exporters', '/ops/agents']) {
      expect(routeExists(href), href).toBe(true);
    }
  });

  test('the guard would catch a dead link', () => {
    // Proves the check can fail — a route-existence test that never returns false is not a test.
    expect(routeExists('/agent/definitely-not-a-route')).toBe(false);
    expect(routeExists('/ops/settings')).toBe(false);
  });
});
