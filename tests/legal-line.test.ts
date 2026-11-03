import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { COMPANY_CONTACT_EMAIL, COMPANY_LEGAL_NAME, LegalLine } from '../src/components/brand/LegalLine';

/** The company line on every page (owner, 2–3 Nov 2026). */
describe('the company line', () => {
  test('names the LLP and links its mailbox', () => {
    const html = renderToStaticMarkup(createElement(LegalLine));
    expect(html).toContain(`© ${new Date().getFullYear()} Trade Flux AI Solutions LLP · ClearTrade`);
    expect(html).toContain('href="mailto:hello@cleartrade.in"');
    expect([COMPANY_LEGAL_NAME, COMPANY_CONTACT_EMAIL]).toEqual(['Trade Flux AI Solutions LLP', 'hello@cleartrade.in']);
  });

  test('every page carries it: the homepage, the sign-in shell, all three portals, and the 404 and error pages', () => {
    const placements = [
      'src/app/page.tsx', // landing page
      'src/app/(auth)/layout.tsx', // sign in, register, accept invitation
      'src/components/shell/AppShell.tsx', // every /app, /agent and /ops page
      'src/app/not-found.tsx',
      'src/app/error.tsx',
    ];
    for (const file of placements) expect(readFileSync(file, 'utf8'), file).toContain('<LegalLine');
    // The three portal layouts all render through AppShell, so none of them can miss the line.
    for (const layout of ['src/app/app/layout.tsx', 'src/app/agent/layout.tsx', 'src/app/ops/layout.tsx']) {
      expect(readFileSync(layout, 'utf8'), layout).toContain('<AppShell');
    }
  });
});
