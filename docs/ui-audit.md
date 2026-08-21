# ClearTrade AI — UI Audit

Inventory and observation only. No opinions, no recommendations, no fixes. All counts were produced by exact grep/read against the repository at the time of writing; occurrence counts are className-string occurrences (a value used twice in one file counts twice), not deduplicated by file.

---

## Section 1 — Design Tokens

### `src/app/globals.css` (in full, 165 lines)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --font-inter: 'Inter', system-ui, sans-serif;

  --color-primary: #0B1739;
  --color-action: #14B8A6;
  --color-info: #27C2E8;
  --color-warning: #F59E0B;
  --color-critical: #EF4444;
  --color-accent: #7C3AED;
  --color-surface-raised: #132654;
  --color-surface-muted: #F4F7FB;
  --color-surface: #FFFFFF;

  --color-border: rgba(11, 23, 57, 0.12);
  --color-border-strong: rgba(11, 23, 57, 0.24);
  --color-text-primary: #0B1739;
  --color-text-secondary: rgba(11, 23, 57, 0.7);
  --color-text-muted: rgba(11, 23, 57, 0.64);
  --color-text-inverse: #FFFFFF;

  --color-action-text: color-mix(in srgb, var(--color-action) 55%, var(--color-primary));
  --color-info-text: color-mix(in srgb, var(--color-info) 55%, var(--color-primary));
  --color-warning-text: color-mix(in srgb, var(--color-warning) 55%, var(--color-primary));
  --color-critical-text: color-mix(in srgb, var(--color-critical) 55%, var(--color-primary));

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 10px;
  --radius-full: 9999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --text-4xl: 2.25rem;

  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;

  --shadow-card: 0 1px 3px rgba(11, 23, 57, 0.08), 0 1px 2px rgba(11, 23, 57, 0.06);
  --shadow-raised: 0 4px 12px rgba(11, 23, 57, 0.12), 0 2px 4px rgba(11, 23, 57, 0.08);

  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;

  --topbar-height: 56px;
  --leftnav-width: 256px;
  --leftnav-width-collapsed: 72px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: #0B1739;
    --color-surface-raised: #0F1F44;
    --color-surface-muted: #0D1B3A;
    --color-surface: #132654;
    --color-border: rgba(255, 255, 255, 0.12);
    --color-border-strong: rgba(255, 255, 255, 0.24);
    --color-text-primary: #F4F7FB;
    --color-text-secondary: rgba(244, 247, 251, 0.7);
    --color-text-muted: rgba(244, 247, 251, 0.64);
    --color-text-inverse: #0B1739;
    --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
    --shadow-raised: 0 4px 12px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.2);
  }
}

* {
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

html,
body {
  max-width: 100vw;
  overflow-x: hidden;
  font-family: var(--font-inter);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--color-text-primary);
  background-color: var(--color-surface-muted);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  font-family: inherit;
}

input,
textarea,
select {
  font-family: inherit;
  font-size: inherit;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.focus-visible-ring:focus-visible {
  outline: none;
  ring: 2px;
  ring-color: var(--color-action);
  ring-offset: 2px;
  ring-offset-color: var(--color-surface);
}

@layer utilities {
  .text-balance {
    text-wrap: balance;
  }
}
```

Note: `--color-text-secondary`/`--color-text-muted` carry inline comments in the source explaining an AA-contrast fix (0.64 alpha chosen over 0.48 to clear 4.5:1). `--color-action-text`/`-info-text`/`-warning-text`/`-critical-text` carry a comment explaining they exist because the raw hue tokens fail AA contrast as text and must be used for any semantic-colored words, keeping the raw tokens for fills/borders/icons only.

### `tailwind.config.ts` (in full, 79 lines)

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        action: 'var(--color-action)',
        info: 'var(--color-info-text)',
        warning: 'var(--color-warning)',
        critical: 'var(--color-critical-text)',
        accent: 'var(--color-accent)',
        'surface-raised': 'var(--color-surface-raised)',
        'surface-muted': 'var(--color-surface-muted)',
        surface: 'var(--color-surface)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      spacing: {
        '1': 'var(--space-1)', '2': 'var(--space-2)', '3': 'var(--space-3)',
        '4': 'var(--space-4)', '5': 'var(--space-5)', '6': 'var(--space-6)',
        '8': 'var(--space-8)', '10': 'var(--space-10)', '12': 'var(--space-12)',
        '16': 'var(--space-16)', '20': 'var(--space-20)', '24': 'var(--space-24)',
      },
      fontSize: {
        xs: ['var(--text-xs)', { lineHeight: 'var(--leading-tight)' }],
        sm: ['var(--text-sm)', { lineHeight: 'var(--leading-normal)' }],
        base: ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        lg: ['var(--text-lg)', { lineHeight: 'var(--leading-normal)' }],
        xl: ['var(--text-xl)', { lineHeight: 'var(--leading-snug)' }],
        '2xl': ['var(--text-2xl)', { lineHeight: 'var(--leading-snug)' }],
        '3xl': ['var(--text-3xl)', { lineHeight: 'var(--leading-tight)' }],
        '4xl': ['var(--text-4xl)', { lineHeight: 'var(--leading-tight)' }],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
      },
    },
  },
  plugins: [],
};

export default config;
```

Note (from an inline comment in this file): `info`/`critical` are deliberately mapped to their AA-safe `-text` color-mix blends rather than the raw brand hue, because bare `text-info`/`text-critical`/`border-critical` classes are used as body text in ~11 places with no `[var(--color-x-text)]` override. `warning` stays mapped to the raw hue because no bare `text-warning`/`border-warning` usage exists in the codebase today.

### Bare Tailwind color-token class usage (count of `text-`, `bg-`, `border-`, `ring-` + token name, across `src/app` and `src/components`)

| Token | Occurrences |
|---|---|
| `primary` | 896 |
| `surface` | 465 |
| `surface-muted` | 128 |
| `critical` | 34 |
| `action` | 20 |
| `warning` | 3 |
| `info` | 1 |
| `accent` | 0 |
| `surface-raised` | 0 |

### Arbitrary `[var(--color-x)]` bracket usage (top values, across `src/app` and `src/components`)

| Value | Occurrences |
|---|---|
| `[var(--color-text-secondary)]` | 637 |
| `[var(--color-border)]` | 462 |
| `[var(--color-text-muted)]` | 157 |
| `[var(--color-critical-text)]` | 79 |
| `[var(--color-border-strong)]` | 47 |
| `[var(--color-text-inverse)]` | 19 |
| `[var(--color-info)]` | 10 |
| `[var(--color-danger)]` | 5 |
| `[var(--color-warning)]` | 4 |
| `[var(--color-action-text)]` | 4 |
| `[var(--color-action)]` | 4 |
| `[var(--color-warning-text)]` | 3 |
| `[var(--color-info-text)]` | 2 |

`[var(--color-danger)]` (5 occurrences) does not correspond to any variable defined in `globals.css` — there is no `--color-danger` declaration in the file shown in full above. This is flagged as a bypass/undefined-token usage; see Section 7.

### Colors used that bypass the token system (hardcoded hex/rgb outside `globals.css`)

**Hex literals**, by file:

| File | Line | Value |
|---|---|---|
| `src/app/layout.tsx` | 10 | `#0B1739` |
| `src/app/(auth)/login/SocialSignInButtons.tsx` | 56 | `#4285F4` |
| `src/app/(auth)/login/SocialSignInButtons.tsx` | 57 | `#34A853` |
| `src/app/(auth)/login/SocialSignInButtons.tsx` | 58 | `#FBBC05` |
| `src/app/(auth)/login/SocialSignInButtons.tsx` | 59 | `#EA4335` |
| `src/lib/document-generation/legacy/html.ts` | 29 | `#17171c`, `#6b6b70`, `#d9d9dd` |
| `src/lib/document-generation/legacy/html.ts` | 31 | `#f6f6f8` |
| `src/lib/document-generation/legacy/html.ts` | 29 | `#f2f2f4` |
| `src/lib/document-generation/legacy/html.ts` | 33, 68 | `#fff` |
| `src/lib/document-generation/legacy/html.ts` | 41 | `#b32626` |

**`rgb()`/`rgba()` literals**, by file:

| File | Line | Value |
|---|---|---|
| `src/components/ui/StatusChip.tsx` | 22 | `rgba(0,0,0,0)` |
| `src/lib/document-generation/legacy/html.ts` | 34 | `rgba(0,0,0,.08)` |
| `src/lib/document-generation/legacy/html.ts` | 36 | `rgba(179,38,38,.11)` |
| `src/lib/document-generation/legacy/pdf.ts` | 28 | `rgb(0.09, 0.09, 0.11)` |
| `src/lib/document-generation/legacy/pdf.ts` | 29 | `rgb(0.42, 0.42, 0.45)` |
| `src/lib/document-generation/legacy/pdf.ts` | 30 | `rgb(0.85, 0.85, 0.87)` |
| `src/lib/document-generation/legacy/pdf.ts` | 31 | `rgb(0.95, 0.95, 0.96)` |
| `src/lib/document-generation/legacy/pdf.ts` | 87 | `rgb(0.75, 0.1, 0.1)` |
| `src/lib/document-generation/legacy/pdf.ts` | 146 | `rgb(0.7, 0.15, 0.15)` |

Of these, `src/lib/document-generation/legacy/html.ts` and `src/lib/document-generation/legacy/pdf.ts` are the legacy PDF/HTML document-artifact renderer (generated shipping documents), not app UI chrome — their color values are independent of the Tailwind/CSS-variable system by construction (PDF drawing uses `rgb(r,g,b)` in 0–1 float form; HTML uses an inline `<style>` block). `src/app/layout.tsx` line 10 is the `<meta name="theme-color">` tag. `SocialSignInButtons.tsx` renders the four Google brand-mark colors for the "Sign in with Google" icon.

**Default Tailwind palette classes** (bypassing the custom token palette entirely — `red-`, `blue-`, `gray-`, etc.), across `src/app` and `src/components`:

| File | Line | Class |
|---|---|---|
| `src/app/(auth)/login/LoginForm.tsx` | 25 | `bg-red-50` |
| `src/app/(auth)/register/RegisterForm.tsx` | 77 | `bg-red-50` |
| `src/components/agent/BuyerDecisionControls.tsx` | 176 | `bg-red-50` |
| `src/components/agent/MarketDecisionControls.tsx` | 176 | `bg-red-50` |

No inline `style={{ color: ... }}` or `style={{ backgroundColor: ... }}` was found anywhere in `src/app` or `src/components` (one `style={{ width: ... }}` and one `style={{ gridTemplateColumns: ... }}` exist, both non-color, in `src/app/ops/page.tsx` and `src/components/shell/AppShell.tsx` respectively).

---

## Section 2 — Typography and Spacing Reality

Counts are class-string occurrences across all `.tsx` files in `src/` (className scanning), not deduplicated by file.

### Font size

| Class | Count |
|---|---|
| `text-sm` | 725 |
| `text-xs` | 697 |
| `text-lg` | 114 |
| `text-2xl` | 47 |
| `text-base` | 6 |
| `text-xl` | 3 |
| `text-3xl` | 2 |
| `text-4xl` | 1 |

8 distinct sizes are in use, all declared as tokens; no arbitrary `text-[…]` font-size values were found. `text-sm` and `text-xs` account for 1,422 of 1,595 occurrences (~89%).

### Font weight

| Class | Count |
|---|---|
| `font-medium` | 424 |
| `font-semibold` | 284 |
| `font-normal` | 22 |
| `font-bold` | 11 |

4 distinct weights in use out of Tailwind's 9 possible weight utilities.

### Padding (all `p-`/`px-`/`py-`/`pt-`/`pb-`/`pl-`/`pr-` values found)

| Class | Count | | Class | Count |
|---|---|---|---|---|
| `px-3` | 176 | | `pr-3` | 11 |
| `py-3` | 161 | | `pb-3` | 10 |
| `px-2` | 132 | | `py-10` | 7 |
| `p-5` | 127 | | `pt-0` | 6 |
| `p-4` | 99 | | `py-2.5` | 5 |
| `px-4` | 96 | | `pt-2` | 5 |
| `pb-2` | 84 | | `pt-3` | 3 |
| `py-2` | 83 | | `py-8` | 2 |
| `py-1` | 79 | | `px-8` | 2 |
| `py-1.5` | 76 | | `px-6` | 2 |
| `px-2.5` | 65 | | `pl-4` | 2 |
| `p-3` | 60 | | `pl-3` | 2 |
| `p-6` | 58 | | `pb-0` | 2 |
| `p-2.5` | 30 | | `py-4` | 1 |
| `p-2` | 20 | | `py-24` | 1 |
| `py-6` | 16 | | `py-16` | 1 |
| `p-8` | 12 | | `py-0.5` | 1 |
| | | | `px-1` | 1 |
| | | | `pt-4` | 1 |
| | | | `pt-14` | 1 |
| | | | `pl-2` | 1 |
| | | | `pb-16` | 1 |
| | | | `p-1.5` | 1 |

38 distinct padding values in active use.

### Margin (all `m-`/`mx-`/`my-`/`mt-`/`mb-`/`ml-`/`mr-` values found)

| Class | Count | | Class | Count |
|---|---|---|---|---|
| `mt-1` | 367 | | `mb-2` | 10 |
| `mt-2` | 224 | | `ml-1` | 7 |
| `mt-4` | 140 | | `mb-5` | 6 |
| `mt-3` | 115 | | `mb-1` | 5 |
| `mt-0.5` | 109 | | `mt-8` | 3 |
| `mt-1.5` | 88 | | `mr-2` | 3 |
| `mb-6` | 31 | | `mx-2` | 2 |
| `mt-6` | 23 | | `ml-64` | 2 |
| `mb-4` | 21 | | `ml-1.5` | 2 |
| `mt-5` | 18 | | `mx-1.5` | 1 |
| `ml-2` | 15 | | `mt-7` | 1 |
| `mb-3` | 15 | | `mt-16` | 1 |
| `mb-1.5` | 14 | | `mr-3` | 1 |

26 distinct margin values in active use. `mt-1` alone accounts for 367 of roughly 1,357 total margin-class occurrences (~27%).

### Gap

| Class | Count |
|---|---|
| `gap-2` | 109 |
| `gap-3` | 68 |
| `gap-1.5` | 56 |
| `gap-4` | 13 |
| `gap-1` | 16 |
| `gap-y-1` | 12 |
| `gap-6` | 12 |
| `gap-x-6` | 11 |
| `gap-x-4` | 7 |
| `gap-y-2` | 6 |
| `gap-y-3` | 4 |
| `gap-x-3` | 3 |
| `gap-x-5` | 1 |

13 distinct gap values in active use.

### Border radius

| Class | Count |
|---|---|
| `rounded-lg` | 215 |
| `rounded-md` (includes both explicit `rounded-md` and the `DEFAULT` `rounded` alias — see below) | — |
| `rounded` (the bare utility, resolving to the `DEFAULT` token `--radius-md`) | 169 |
| `rounded-full` | 16 |
| `rounded-sm` | 2 |

Raw grep produced `rounded-md` (170) and `rounded` (169) as separate strings; note `rounded-md` and bare `rounded` both resolve to the same `--radius-md` (6px) token via the Tailwind config's `borderRadius.DEFAULT`, so 339 total occurrences render identically despite being two different class strings. `rounded-xl` (the fourth declared token, 10px) was not found in any className in `src/`. 5 distinct radius class-strings in use (`rounded`, `rounded-md`, `rounded-lg`, `rounded-full`, `rounded-sm`), collapsing to 4 distinct rendered radii.

### Shadow

| Class | Count |
|---|---|
| `shadow-card` | 167 |
| `shadow-raised` | 2 |
| `shadow-sm` (Tailwind's built-in default shadow, not a project token) | 1 |

3 distinct shadow classes in use. `shadow-raised` (the token intended for the active-nav-item "raised card" treatment per an `AppShell.tsx` comment) appears in exactly 2 places in the entire codebase.

---

## Section 5 — Shell and Navigation

### `src/components/shell/AppShell.tsx` (in full, 213 lines)

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { UserRole } from '@prisma/client';

type Portal = 'exporter' | 'agent' | 'ops';
type Tier = 'guest' | 'free' | 'paid';

const TIER_RANK: Record<Tier, number> = { guest: 0, free: 1, paid: 2 };

interface NavItem {
  label: string;
  href: string;
  roles?: readonly UserRole[];
  minTier: Tier;
}

const NAVIGATION: Record<Portal, NavItem[]> = {
  exporter: [
    { label: 'Overview', href: '/app/overview', minTier: 'free' },
    { label: 'Readiness', href: '/app/readiness', minTier: 'free' },
    { label: 'Markets', href: '/app/markets', minTier: 'guest' },
    { label: 'Buyers', href: '/app/buyers', minTier: 'guest' },
    { label: 'Deals', href: '/app/deals', minTier: 'paid' },
    { label: 'Tasks', href: '/app/tasks', minTier: 'paid' },
    { label: 'Messages', href: '/app/messages', minTier: 'paid' },
    { label: 'Notifications', href: '/app/notifications', minTier: 'free' },
  ],
  agent: [
    { label: 'My Day', href: '/agent', minTier: 'paid' },
    { label: 'Exporters', href: '/agent/exporters', minTier: 'paid' },
    { label: 'Outreach', href: '/agent/outreach', minTier: 'paid' },
    { label: 'Deals', href: '/agent/deals', minTier: 'paid' },
    { label: 'Tasks', href: '/agent/tasks', minTier: 'paid' },
    { label: 'Escalations', href: '/agent/escalations', minTier: 'paid' },
    { label: 'Performance', href: '/agent/performance', minTier: 'paid' },
  ],
  ops: [
    { label: 'Control Tower', href: '/ops', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Assignments', href: '/ops/assignments', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Agents', href: '/ops/agents', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Exceptions', href: '/ops/exceptions', minTier: 'paid', roles: ['ops_supervisor', 'admin'] },
    { label: 'Finance', href: '/ops/finance', minTier: 'paid', roles: ['ops_finance', 'admin'] },
    { label: 'Disputes', href: '/ops/disputes', minTier: 'paid', roles: ['ops_supervisor', 'ops_finance', 'admin'] },
    { label: 'Audit', href: '/ops/audit', minTier: 'paid', roles: ['ops_supervisor', 'ops_finance', 'admin'] },
  ],
};

function exporterMobileNav(tier: Tier): NavItem[] {
  if (tier === 'paid') {
    return [
      { label: 'Home', href: '/app/overview', minTier: 'free' },
      { label: 'Deals', href: '/app/deals', minTier: 'paid' },
      { label: 'Tasks', href: '/app/tasks', minTier: 'paid' },
      { label: 'Messages', href: '/app/messages', minTier: 'paid' },
      { label: 'More', href: '/app/more', minTier: 'free' },
    ];
  }
  if (tier === 'free') {
    return [
      { label: 'Home', href: '/app/overview', minTier: 'free' },
      { label: 'Markets', href: '/app/markets', minTier: 'guest' },
      { label: 'Buyers', href: '/app/buyers', minTier: 'guest' },
      { label: 'More', href: '/app/more', minTier: 'free' },
    ];
  }
  return [
    { label: 'Markets', href: '/app/markets', minTier: 'guest' },
    { label: 'Buyers', href: '/app/buyers', minTier: 'guest' },
  ];
}

const UTILITY_LABEL: Record<Portal, string> = {
  exporter: 'Your agent',
  agent: 'SLA watch',
  ops: 'Exceptions',
};

function isActive(pathname: string, href: string) {
  return href === '/agent' || href === '/ops'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children, portal, userName, tier, role }: {
  children: ReactNode; portal: Portal; userName: string | null; tier: Tier; role: UserRole;
}) {
  const pathname = usePathname();
  const visible = (item: NavItem) =>
    TIER_RANK[tier] >= TIER_RANK[item.minTier] && (!item.roles || item.roles.includes(role));
  const navigation = NAVIGATION[portal].filter(visible);
  const mobileNav = portal === 'exporter' ? exporterMobileNav(tier) : [];
  const isGuest = tier === 'guest';

  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between bg-primary px-4 text-white shadow-card md:px-6">
        <Link href={navigation[0]?.href ?? '/'} className="focus-visible-ring rounded text-base font-bold tracking-tight">
          ClearTrade AI
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {isGuest ? (
            <>
              <span className="hidden rounded bg-white/10 px-2 py-1 text-xs sm:inline">Browsing as guest</span>
              <Link href="/register" className="focus-visible-ring rounded bg-action px-3 py-1.5 text-xs font-semibold text-primary transition duration-fast hover:brightness-95">
                Create free account
              </Link>
            </>
          ) : (
            <>
              <button type="button" className="focus-visible-ring hidden rounded px-2 py-1 hover:bg-white/10 sm:block">{UTILITY_LABEL[portal]}</button>
              <span className="rounded bg-white/10 px-2 py-1" aria-label={`Signed in as ${userName ?? 'user'}`}>
                {userName ?? 'Profile'}
              </span>
            </>
          )}
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 top-14 z-20 hidden w-64 overflow-y-auto border-r border-[var(--color-border)] bg-surface-muted p-3 md:block">
        <nav aria-label={`${portal} navigation`} className="space-y-1">
          {navigation.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
                className={`focus-visible-ring block rounded px-3 py-2.5 text-sm font-medium transition duration-fast ${active ? 'bg-surface text-primary shadow-raised' : 'text-[var(--color-text-secondary)] hover:bg-surface-muted hover:text-primary'}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className={`min-h-screen pt-14 ${portal === 'exporter' ? 'pb-16 md:ml-64 md:pb-0' : 'md:ml-64'}`}>
        {children}
      </main>

      {portal === 'exporter' && mobileNav.length > 0 ? (
        <nav aria-label="Exporter mobile navigation"
          style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}
          className="fixed inset-x-0 bottom-0 z-30 grid h-16 border-t border-[var(--color-border)] bg-surface md:hidden">
          {mobileNav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
                className={`focus-visible-ring flex items-center justify-center px-1 text-center text-xs font-semibold ${active ? 'text-[var(--color-action-text)]' : 'text-[var(--color-text-secondary)]'}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
```

### Nav item sets per role/tier

**Exporter portal** (desktop, `NAVIGATION.exporter`, filtered by `minTier`):
| Label | href | minTier |
|---|---|---|
| Overview | /app/overview | free |
| Readiness | /app/readiness | free |
| Markets | /app/markets | guest |
| Buyers | /app/buyers | guest |
| Deals | /app/deals | paid |
| Tasks | /app/tasks | paid |
| Messages | /app/messages | paid |
| Notifications | /app/notifications | free |

No `roles` restriction on exporter nav items — filtering is tier-only. A guest sees only Markets/Buyers; free adds Overview/Readiness/Notifications; paid adds Deals/Tasks/Messages (full 8 items).

**Agent portal** (`NAVIGATION.agent`), all items `minTier: 'paid'`, no `roles` restriction: My Day, Exporters, Outreach, Deals, Tasks, Escalations, Performance (7 items, always all 7 for any agent).

**Ops portal** (`NAVIGATION.ops`), all items `minTier: 'paid'`, each item independently role-gated:
| Label | href | roles |
|---|---|---|
| Control Tower | /ops | ops_supervisor, admin |
| Assignments | /ops/assignments | ops_supervisor, admin |
| Agents | /ops/agents | ops_supervisor, admin |
| Exceptions | /ops/exceptions | ops_supervisor, admin |
| Finance | /ops/finance | ops_finance, admin |
| Disputes | /ops/disputes | ops_supervisor, ops_finance, admin |
| Audit | /ops/audit | ops_supervisor, ops_finance, admin |

An `ops_finance` principal sees only Finance, Disputes, Audit (3 of 7). An `admin` sees all 7. An `ops_supervisor` sees Control Tower, Assignments, Agents, Exceptions, Disputes, Audit (6 of 7, missing Finance).

### Active-state rendering

Desktop left nav: `isActive()` returns true for an exact match on `/agent` or `/ops` (no sub-path matching for those two portal roots), and for exact-match-or-starts-with-`href/` for every other href. The active link gets `bg-surface text-primary shadow-raised`; inactive links get `text-[var(--color-text-secondary)] hover:bg-surface-muted hover:text-primary`. `aria-current="page"` is set on the active link.

Mobile bottom nav (exporter only): active item gets `text-[var(--color-action-text)]`; inactive gets `text-[var(--color-text-secondary)]`. No background/weight change on mobile active state (weight is `font-semibold` for both active and inactive mobile items — the className is identical `font-semibold` regardless of `active`).

### Mobile nav structure and breakpoint

Desktop left `<aside>` is `hidden md:block` (Tailwind `md` = 768px). Main content shifts with `md:ml-64` (matches the aside's `w-64`). The exporter-only mobile bottom nav is `fixed inset-x-0 bottom-0 ... md:hidden`, a CSS grid with `gridTemplateColumns` set inline to `repeat(<mobileNav.length>, minmax(0, 1fr))` — 5 columns for paid tier, 4 for free tier, 2 for guest tier. Agent and Ops portals render no mobile nav at all (`mobileNav = portal === 'exporter' ? exporterMobileNav(tier) : []`); on a narrow viewport an agent or ops user has no bottom nav and no visible way to reach the sidebar links except the "ClearTrade AI" home link in the header, since the aside is `hidden` below `md`.

Top header: `fixed inset-x-0 top-0`, height `h-14` (56px, matches `--topbar-height`), `bg-primary`. Contains the "ClearTrade AI" wordmark (linking to the first visible nav item's href, or `/` if none) and a right-hand cluster that is either the guest CTA pair ("Browsing as guest" pill + "Create free account" button) or the signed-in pair (a `UTILITY_LABEL[portal]` button — "Your agent" / "SLA watch" / "Exceptions" — hidden below `sm`, plus a "Signed in as …" pill showing `userName` or "Profile").

### Header / breadcrumb / page-title pattern

`AppShell` itself renders no per-page title or breadcrumb — the header only ever shows the "ClearTrade AI" wordmark. Page-level titles are each page's own responsibility (see Section 3's per-page `<h1>` findings; a majority of pages open with a `<header>` containing a small `text-sm font-medium text-primary` eyebrow line naming the portal/section, then an `<h1 className="text-2xl font-semibold text-primary">`, then a `text-sm text-[var(--color-text-secondary)]` one-line description — see Section 7 for where this pattern is and is not followed identically). No breadcrumb component exists anywhere in `src/components/`.

---

## Section 6 — Density Comparison

One representative page per portal, read in full.

### `/app/overview` (exporter, `src/app/app/overview/page.tsx` + `src/app/app/overview/modules.tsx`)

Composed of 6 independently-loaded `<Suspense>` modules in one column (plus a 2-up grid for the last two): Risk banner (renders nothing when there is nothing wrong — 0 or 1 sections), Journey rail, Next actions (up to 6 cards), Health summary (up to 4 `MetricCard`s in a `grid-cols-2 sm:grid-cols-4`, or 2 `MetricCard`s + 1 `UpgradeNotice` for free tier), Deal pipeline (5-stage `<dl>` grid, paid only; `UpgradeNotice` for free), Assigned agent (1 card, paid only; `UpgradeNotice` for free).

- **Distinct visual sections:** 6 for a paid-tier account with an active risk (Risk banner, Journey, Next actions, Health summary, Deal pipeline, Assigned agent); 5 for a paid-tier account with no risk; for free tier the last two sections are each replaced by a single `UpgradeNotice` block (still 6 section slots, 2 of them upsell cards instead of data).
- **Data points above the fold at 1440px:** not rendered/measured directly (no browser instrumentation was run for this audit), but by DOM order the Journey rail (a multi-stage progress strip, 1 element) and part or all of "Next actions" (up to 6 `NextActionCard`s, each carrying title + owner + due-date + urgency chip + optional blocker reason — 4 data fields per card) would be the first content below the fixed 56px header and the page's own `<h1>`+description. Health summary's 4 `MetricCard`s (each 1 label + 1 value + optional secondary text = up to 3 data points per card, so up to 12) follow below that.
- **Table:** none. No `<table>` element appears anywhere on this page or its modules; all lists are `<ul>`/`<li>` or `<dl>`/`<dt>`/`<dd>`.

### `/agent` (agent, `src/app/agent/page.tsx`, 49 lines, single file)

- **Distinct visual sections:** 5 (Portfolio summary — 4 `MetricCard`s in one `grid-cols-2 sm:grid-cols-2 xl:grid-cols-4` row; Today queue; Risk panel; Follow-up lane; Execution lane), plus one trailing summary sentence below the last grid row ("N active leads across your assigned exporters.") that is not inside a bordered section.
- **Data points above the fold at 1440px:** the 4 portfolio `MetricCard`s (label + value + optional secondary text) render first, immediately followed by the two-column `xl:grid-cols-5` row holding "Today queue" (up to 8 tasks, each rendering title, exporter/deal context, blocked-reason if any, owner name, due-date text, a visibility `StatusChip`, and an SLA `StatusChip` — 6 potential data fields per row) and "Risk panel" (up to 5 items, each org name + risk reason, 2 fields per row) side by side. At a 1440px width all of this — 4 metric cards plus the two side-by-side panels' headers and several list rows — would typically be visible without scrolling, though exact fold position depends on browser chrome height, which was not measured.
- **Table:** none. All data is rendered as `<ul>`/`<li>` rows, not `<table>`.

### `/ops` (ops, `src/app/ops/page.tsx`, 87 lines, single file)

- **Distinct visual sections:** 5 (Exception KPIs — 7 `MetricCard`s in a `grid-cols-2 xl:grid-cols-4` grid, each wrapped in a `<Link>`; Risk queue — a `<table>`; Stage funnel — an 8-row horizontal bar list; Agent capacity; Recent escalations).
- **Data points above the fold at 1440px:** the 7 KPI `MetricCard`s (label + numeric value + "Open filtered queue" secondary text = 3 fields × 7 = 21 data points) render first, followed by the `xl:grid-cols-5` row holding the Risk queue table (up to 8 rows × 5 columns = 40 cells) beside the Stage funnel (8 stages × a label + a proportional bar + a count = up to 24 data points). At 1440px the KPI row plus at least the table header and several risk-queue rows would typically be visible without scrolling; exact fold position not measured.
- **Table:** yes — the Risk queue table is the only `<table>` among the three representative pages.
  - Header row: `<thead className="text-xs uppercase text-[var(--color-text-muted)]">`, column headers wrapped in `<th className="pb-2">` (bottom padding only, `8px`; no horizontal padding, no background, no border on the header cells).
  - Body rows: `<tr className="border-t border-[var(--color-border)]">` (a 1px top border between rows, no zebra striping, no row background change).
  - Body cells: `<td className="py-3 ...">` — vertical padding `12px` top and bottom (`py-3` = `--space-3`), no horizontal cell padding class present (cells rely on the table's own left/right inset from the parent `<div className="overflow-x-auto">` and natural cell content flow).
  - Font size: `text-sm` on the `<table>` element itself (inherited by all cells except the header, which is explicitly `text-xs`).
  - Columns: Reference, Issue (rendered as a `StatusChip`, not plain text), Category, Owner, Age — 5 columns, `min-w-[600px]` on the table to force horizontal scroll on narrow viewports.

---

## Section 3 — Page Inventory

Grouped by portal. 51 `page.tsx` routes total confirmed under `src/app/` (14 agent, 21 exporter, 12 ops, 3 auth, 1 root — see per-portal counts below).

### Agent portal (14 pages)

#### /agent (AGT-01)
**Description:** Agent's SLA-ordered "My Day" command centre — urgent task queue, risk panel, follow-up lane, execution lane.
**Layout skeleton:**
```
div.mx-auto.max-w-7xl
  header
    p "Agent workspace"
    h1 "My Day"
    p "Prioritized by escalation, SLA and risk."
  section[aria-label="Portfolio summary"] .grid (4 MetricCards)
  div.grid.xl:grid-cols-5
    section (Today queue) .xl:col-span-3
    section (Risk panel) .xl:col-span-2
  div.grid.xl:grid-cols-2
    section (Follow-up lane)
    section (Execution lane)
  p (active leads count)
```
**components/ui used:** MetricCard ×4, StatusChip (multiple, per task/risk row)
**All visible strings:**
"Agent workspace"; "My Day"; "Prioritized by escalation, SLA and risk."; "Assigned exporters"; "Due today / overdue" / "Your active urgent queue"; "Active deals"; "At risk" / "Blocked or at risk"; "Today queue"; "Escalated, overdue, due soon and blocked work."; "No urgent work. Keep an eye on your upcoming follow-ups and portfolio health below."; task row (title, exporter/deal name, "· Blocked: {reason}", "Owner: {name or 'Unassigned'} · {due}"); "Internal" (detail "Internal task — not visible to the exporter."); "Exporter-visible" (detail "This task is visible to the exporter."); SLA labels "On time", "Due soon", "Overdue", "Escalated"; "Due {date}" or "No due date set"; "Risk panel"; "Open the relevant workspace to take action."; "No assigned exporters or deals are at risk."; risk row (exporter name, risk_reason or "Risk needs review"); "Follow-up lane"; "Buyer outreach with a scheduled next touch."; "No follow-ups are scheduled for your assigned accounts."; lead row ("{buyer} · {exporter} · next touch {date}"); "Execution lane"; "Document, shipment and payment work for active deals."; "No active execution tasks are assigned to you."; task row (title, "Blocked: {reason}" or exporter name or "Deal work"); "{N} active leads across your assigned exporters."
**States:** Loading: none. Empty: "No urgent work. Keep an eye on your upcoming follow-ups and portfolio health below." (Today queue); "No assigned exporters or deals are at risk." (Risk panel); "No follow-ups are scheduled for your assigned accounts." (Follow-up lane); "No active execution tasks are assigned to you." (Execution lane). Filtered-empty: none (no filters). Error: none rendered on this page.

#### /agent/exporters (AGT-02 index)
**Description:** Triage list of the agent's assigned exporter accounts, ordered by what needs attention.
**Layout skeleton:**
```
div.mx-auto.max-w-7xl
  header (p "Agent workspace", h1 "Exporters", p summary)
  [empty state OR table: Exporter | Journey | Readiness | Active deals | Open tasks | Needs you next]
```
**components/ui used:** StatusChip (one per row, or plain "Nothing outstanding" text)
**All visible strings:**
"Agent workspace"; "Exporters"; "All exporter accounts. Ops sees every account by role." (ops) or "{N} exporter(s) assigned to you. Needing attention first."; empty: "No exporters are assigned to you yet. Ops assigns accounts from the assignments queue."; table headers "Exporter", "Journey", "Readiness", "Active deals", "Open tasks", "Needs you next"; row subline "{legal_name or —} · {tier} · updated {date}"; journey labels "Onboarding", "Ready", "Market selected", "Buyer engaged", "Deal locked", "Docs cleared", "Shipped", "Payment realized"; next-action labels "{N} escalated task(s)", "{N} deal(s) at risk", "{N} overdue task(s)", "No market selected yet", "No active deal"; "Nothing outstanding"; "—" placeholders.
**States:** Loading: none. Empty: "No exporters are assigned to you yet. Ops assigns accounts from the assignments queue." Filtered-empty: none. Error: none.

#### /agent/exporters/[exporterOrgId] (AGT-02 Exporter 360)
**Description:** Single exporter's full workspace — header, tabbed Overview/Demand Discovery/Buyer Discovery, products, discovery summary, execution readiness, buyer pipeline, deals, tasks, history, communication, timeline.
**Layout skeleton:**
```
div.mx-auto.max-w-7xl.space-y-4
  header (name + health chip, assignment/readiness/journey/last-contact line, CreateTaskForm)
  nav[aria-label="Exporter sections"] (tabs: Overview | Demand Discovery | Buyer Discovery)
  [tab=demand] section → DemandDiscoveryControl
  [tab=buyers] section → BuyerDiscoveryControl
  [tab=overview]
    div.grid.xl:grid-cols-3
      section (Products & commercial profile) .xl:col-span-2 — li per product, ProductQuickEditForm, ProductClassificationForm
      section (Discovery summary)
    section (Execution readiness)
    section (Buyer pipeline) — link "Open in Outreach CRM"
    section (Deals)
    section (Tasks & blockers) — 3 lanes Agent/Exporter/Ops
    section (History) — 3 MetricCards
    section (Communication) — MessageForm, InternalNoteForm
    section (Timeline)
```
**components/ui used:** MetricCard ×3 (Shipments, Disputes, Deals total), StatusChip (health, task visibility, market chips, blockers, lead-stage counts, deal stage). Non-ui inline: CreateTaskForm, InternalNoteForm, MessageForm, ProductQuickEditForm, ProductClassificationForm, DemandDiscoveryControl, BuyerDiscoveryControl.
**All visible strings:**
"Exporter 360"; display_name; "{city}, {state} · {country}"; health labels "Blocked", "At risk", "Normal"; "Assignment: {agent name}" / "Unassigned"; "Readiness: {status}({score})"; "Journey: {label}"; "Latest contact: {date}"; tabs "Overview", "Demand Discovery", "Buyer Discovery"; "Demand Discovery control"; "The model's recommendation and your decision, shown separately. Agent decisions never change the AI score."; "Buyer Discovery control"; "Three separate layers: what the model recommends, what ClearTrade is operationally doing, and what agents have decided. Agent decisions never change the AI score."; "Products & commercial profile"; "No products on record."; product dl labels "Capacity", "MOQ", "Target price", "Lead time", "Desired order", "Customization", "Packaging capability" ("—" default); "Certifications: {name (status)}, ..."; "Discovery summary"; "Latest run: {status} · {date}"; "No discovery runs yet."; "No markets saved/selected yet."; "Execution readiness"; "IEC: {value}"; "GSTIN: {value or 'Not on file'}"; "No open readiness gaps on the current assessment."; "Buyer pipeline"; "Open in Outreach CRM"; "No leads yet."; lead row "{buyer} · {product} · {stage}"; "Deals"; "No negotiating or executing deals."; deal row "{buyer} · {product or 'No product'}"; "Tasks & blockers"; lane headers "Agent (N)", "Exporter (N)", "Ops (N)"; "None."; "Internal"; "Blocked: {reason}"; "History"; "Shipments" / "{N} delivered"; "Disputes" / "{N} open"; "Deals total"; "Communication"; note "{body}" "{author} · {date}"; "Timeline"; "No recorded account events yet."; timeline entry (capitalized label, "{date} · {actor/detail}").
**States:** Loading: none. Empty: "No products on record.", "No discovery runs yet.", "No markets saved/selected yet.", "No open readiness gaps on the current assessment.", "No leads yet.", "No negotiating or executing deals.", "None." (per task lane), "No recorded account events yet." Filtered-empty: none (tabs switch data, no distinct empty copy). Error: none directly on this page.

#### /agent/outreach (AGT-03)
**Description:** Outreach CRM — buyer lead pipeline table across assigned exporters, filterable by stage.
**Layout skeleton:**
```
div.mx-auto.max-w-6xl.p-6
  header (h1 "Outreach pipeline", p description)
  div (filter bar: stage select, "Filtered to one exporter" note, "Reset filters" button)
  [loadError ? error box : DataTable]
```
**components/ui used:** DataTable (1), StatusChip (per row cell ×4: stage, verification, risk, next-action)
**All visible strings:**
"Outreach pipeline"; "Buyer leads across your assigned exporters, from shortlist through conversion."; "Stage"; "All active stages"; stage options "New", "Shortlisted", "Contacted", "Replied", "Qualified", "In negotiation", "Disqualified", "Converted to deal"; "Filtered to one exporter"; "Reset filters"; error box message (default "Could not load the pipeline. Please retry.") + "Retry"; table headers "Buyer", "Exporter / product", "Stage", "Last contact", "Next action", "Verification", "Risk"; "No contact logged"; "Overdue" / date / "No next action set" / "—"; verification labels "Unverified", "Partially verified", "Verified"; "Risk flagged" / "No flags"; DataTable emptyState title "No leads yet" description "Leads created for your assigned exporters will appear here."; DataTable filteredEmptyState title "No leads at this stage" description "Try a different stage filter." action "Reset filters".
**States:** Loading: DataTable's internal `loading` prop (no custom copy read here). Empty: "No leads yet" / "Leads created for your assigned exporters will appear here." Filtered-empty: "No leads at this stage" / "Try a different stage filter." + "Reset filters". Error: "Could not load the pipeline. Please retry." (or specific message) + "Retry".

#### /agent/deals (no screen-ID comment found)
**Description:** Agent's cross-exporter deal queue table with filter tabs.
**Layout skeleton:**
```
div.mx-auto.max-w-7xl.p-4.md:p-6
  header (p "Agent workspace", h1 "Deals", p description)
  nav[aria-label="Deal filters"] (Active | Blocked / at risk | Negotiating | Executing | Closed | All)
  [empty ? message : table: Exporter / buyer | Product | Stage | Value | Next action | Risk | Age]
  p (owner-column caveat)
```
**components/ui used:** StatusChip (per row: risk)
**All visible strings:**
"Agent workspace"; "Deals"; "Every deal across your assigned exporters. At-risk first, then most recently updated."; filters "Active", "Blocked / at risk", "Negotiating", "Executing", "Closed", "All"; empty "No deals match this filter across your assigned exporters."; table headers "Exporter / buyer", "Product", "Stage", "Value", "Next action", "Risk", "Age"; "—"; "due {date}" / "no due date"; "No open task"; risk chip raw stage value, or "Normal"; "{N}d" age, "upd {date}"; "Owner column omitted where a deal records no owning agent — {N} of {N} shown have none."
**States:** Loading: none. Empty: "No deals match this filter across your assigned exporters." Filtered-empty: same message (filters are the only view). Error: none.

#### /agent/deals/[dealId] (AGT-06 Deal Execution Workspace)
**Description:** Agent's execution surface for one deal — dependency checklist, documents, CHA/freight, task board, shipment, payment, internal-only layer.
**Layout skeleton:**
```
div.mx-auto.max-w-7xl.p-4.md:p-6
  header (breadcrumb, buyer name h1, subline, chips, risk alert, links: Commercial/Document data/Documents)
  div.grid.xl:grid-cols-3
    section (Dependency checklist) .xl:col-span-1 — ol of gates, blockers, EscalateBlockerButton
    div.xl:col-span-2
      section#documents — table: Document|Generation|Exporter approval|Filing|Controls
      section#cha — CHA/freight blocks, Handoff log
      section#tasks — 3 TaskColumns: Yours (agent)/Exporter/Ops
      section#shipment — milestones list
      section#payment — payment milestones list
      section (Internal only, dashed border) — cases, internal tasks, internal notes + InternalNoteForm
```
**components/ui used:** StatusChip (very many: gate/risk/SLA/task-state/generation/approval/filing/handoff/shipment/payment status). Non-ui inline: GatedAction, TaskActions, AssignPartnerForm, EscalateBlockerButton, FileDocumentForm, HandoffStatusForm, InternalNoteForm, GenerateButton.
**All visible strings (abridged, high-volume page):**
"Agent workspace" / "Execution"; buyer name; "{exporter} · {product or 'No product'} · {country}"; risk_reason alert; "Commercial", "Document data", "Documents"; "Dependency checklist"; "Prerequisites are evaluated on the server. Downstream actions stay disabled until their gate clears."; gate states "Done", "Ready", "Blocked", "Waiting"; "Go there"; "Current step: {label}"; "Documents"; "The same document records the exporter sees. Approval is theirs — you prepare and file."; table headers "Document", "Generation", "Exporter approval", "Filing", "Controls"; "v{version}"; "Generate" / "Retry"; "File with customs"; "CHA & freight"; "Partners come from the approved directory. Every handoff records who sent it, when, and the reference back."; "CHA partner" / "Freight partner"; "Not assigned"; "Assign CHA" / "Assign freight"; "Handoff log"; "No handoffs recorded yet."; handoff row ("{partner} · {lane}", "Owner: {name} · Sent {date}", "Reference: {ref or 'not yet issued'}"); "Task board"; "Grouped by who owns the work. Internal tasks are separated below and never reach the exporter."; column titles "Yours (agent)", "Exporter", "Ops"; column empty notes "Nothing assigned to you.", "Nothing waiting on the exporter.", "No Ops tasks."; task item ("Due {date}", "Owner: {name}", "Waiting on: {reason}"); "Shipment"; "{mode or 'Mode not set'} · Booking {ref or —} · SB {no or —}"; milestone rows; "Open the exporter's shipment view"; "No shipment record yet."; "Payment"; "No payment milestones yet."; "BRC: {status}"; "Insurance: {status}"; "Open the exporter's payment view"; "Internal only"; "Never shown to the exporter. Notes live in a separate table from exporter messages."; "Internal tasks ({N})"; "None."; "Internal notes ({N})".
**States:** Loading: none. Empty: "Nothing assigned to you.", "Nothing waiting on the exporter.", "No Ops tasks.", "No handoffs recorded yet.", "No shipment record yet.", "No payment milestones yet.", "None." Filtered-empty: none. Error: none rendered directly on this page (delegated to unopened child forms).

#### /agent/deals/[dealId]/commercial (AGT-05)
**Description:** Negotiation & deal conversion — terms editor, exporter approval status, buyer status, deal lock gate, version history.
**Layout skeleton:**
```
div.mx-auto.max-w-6xl.p-4.md:p-6
  header (breadcrumb, buyer name h1, subline, chips)
  section (warning box, conditional)
  div.grid.xl:grid-cols-5
    div.xl:col-span-3 — TermsEditor, ProposalDiff (conditional)
    div.xl:col-span-2 — Exporter approval, Buyer status, LockPanel
  section (Version history) → ProposalHistory
```
**components/ui used:** StatusChip (multiple), Button ×3 (Save draft/Send, Lock deal). Non-ui: ProposalDiff, ProposalHistory, TermsEditor, LockPanel.
**All visible strings (abridged):**
"Agent workspace" / "Commercial"; buyer name; "Check before you propose or lock"; "Buyer verification is {status} — confirm identity before relying on these terms."; "Terms editor"; locked: "These terms are locked by the deal snapshot. Changing them requires an amendment, which writes a new snapshot version rather than editing the frozen one."; editable chip "Editing draft" / "Will create a new version"; field labels "Quantity", "Unit", "Unit price", "Unit price currency", "Total value", "Total currency", "Incoterm", "Incoterm place", "Payment type" (options TT/LC/DA/DP/open_account/advance), "Payment terms", "Ship window start", "Ship window end", "Special conditions", "Note to the exporter"; "Buyer status"; "What the buyer has actually committed to. Verbal interest is not acceptance — record it as what it is."; buyer position options "Not recorded", "No response yet", "Verbal interest only", "Negotiating", "Accepted in writing", "Declined"; "Evidence / note"; buttons "Save draft" / "Saving…", "Send to exporter for approval" / "Sending…"; "Sending freezes this version and creates the exporter's approval task. You cannot approve it yourself."; "Exporter approval" section states: "Accepted" chip + "Version {v} accepted by {name} on {date}."; "Awaiting exporter approval" chip + "Version {v} is with the exporter. You cannot approve it on their behalf — the exporter must approve their own terms."; "Changes requested" chip; "Nothing has been sent to the exporter yet."; "Verbal interest is not acceptance — do not treat this as a commitment."; "No buyer position recorded yet."; "Deal lock"; "Ready to lock" / "{N} blocker(s)"; "Locking freezes the deal snapshot every document generates from, snapshots the fee policy, and creates the execution tasks and document checklist."; "Locked. Snapshot v{n} frozen, {n} documents queued, {n} execution tasks created."; "Resolve this"; "Lock deal" / "Locking…"; "This deal is already locked or past locking."; "Version history"; "Every revision is preserved — an accepted version is never mutated."
**States:** Loading: none page-level (inline busy text "Saving…"/"Sending…"/"Locking…"). Empty: "Nothing has been sent to the exporter yet." / "No buyer position recorded yet." Filtered-empty: none. Error: TermsEditor error box + field errors list; LockPanel `role="alert"` error box.

#### /agent/deals/[dealId]/document-data (no screen-ID comment)
**Description:** Document readiness table plus correction forms for the canonical records (exporter, buyer, shipment, exchange rate, invoice number).
**Layout skeleton:**
```
div.mx-auto.max-w-5xl.p-4.md:p-6
  header (breadcrumb, h1 "Document readiness", description)
  section (readiness table: Document|Status|What is missing)
  p (gap-count summary or all-ready message)
  FixCanonicalDataPanel
    section "Exporter record"
    section "Buyer record"
    section "Shipment" (or placeholder if no shipment)
    section "Exchange rate ({cur} → INR)" (conditional)
    section "Invoice number"
```
**components/ui used:** StatusChip (per readiness row), Button (per-section Save, "Record rate", "Issue invoice number"), Input (multiple per section)
**All visible strings (abridged):**
"Document readiness"; "Every field below is corrected on the record that owns it. Nothing is stored against a document, so fixing it once fixes it for every document that needs it."; table headers "Document", "Status", "What is missing"; doc labels "Proforma Invoice", "Commercial Invoice", "Packing List", "Shipping Bill (draft)", "Certificate of Origin (draft)", "Declaration", "Insurance declaration"; chip labels "Ready", "Blocked", "Missing {N}"; "Nothing outstanding."; owner labels "Exporter record", "Buyer record", "Deal & commercial terms", "Shipment", "Packages", "Insurance", "Exchange rate", "Invoice number"; "{N} distinct fact(s) are outstanding across these documents."; "Every supported document has the canonical data it needs."; "Exporter record" / "Corrects the exporter organisation itself, so every document and every deal sees the fix."; fields "Address line 1/2", "City", "State", "Postal code", "AD code"; "Buyer record" / "Held against this exporter and this buyer. The shared buyer profile other tenants see is not touched."; fields "Name on documents", "Address line 1/2", "City", "State / region", "Postal code", "Country code", "Tax identifier", "Identifier type"; "Shipment" / "Ports, transport references and freight. Leave a UN/LOCODE blank rather than guessing it."; fields "Port of loading", "Loading UN/LOCODE", "Port of discharge", "Discharge UN/LOCODE", "Marks and numbers", "Vessel / flight", "Container number", "Freight amount", "Freight currency"; placeholder "Shipment fields become editable once this deal has a shipment. Ports and transport references belong to the shipment, so there is nowhere correct to put them yet."; "Exchange rate ({cur} → INR)"; "Recorded, never edited — a later correction supersedes this one and leaves documents already issued against it explainable. A rate attributed to RBI or customs must cite the notification."; fields "Rate", "Source" (options "Bank quoted", "RBI reference", "Customs notified", "Manual entry"), "Citation", "Rate date"; "Record rate"; "Invoice number"; "Issued: {number}"; "Nothing has been allocated yet. Previewing or rendering a document never consumes a number — issuing is this button and nothing else. Next in the series would be {preview}, which is an estimate until it is actually issued."; "Issue invoice number" / "Issuing…"; "Save" / "Saving…" / "Saved."
**States:** Loading: none (inline "Saving…"/"Issuing…"). Empty: "Every supported document has the canonical data it needs." (readiness); "Nothing has been allocated yet…" (invoice); shipment placeholder. Filtered-empty: none. Error: per-section `role="alert"` text ("Could not save." / ApiClientError message); "Could not record the rate."; "Could not issue the number."

#### /agent/deals/[dealId]/documents (no screen-ID comment)
**Description:** Dense per-document-type workspace: readiness, generation, review/approval/filing status, version history, generate/regenerate controls.
**Layout skeleton:**
```
div.mx-auto.max-w-6xl.p-4.md:p-6
  header (breadcrumb, h1 "Documents", description w/ renderer name@version)
  section (invoice number banner)
  div.space-y-3
    section (per document row: title/version link/action chip/why text/status chips/snapshot hash/authority note, Fix-data link + GenerateDocumentPanel, issues lists, version history)
```
**components/ui used:** StatusChip (per document: action chip + gen/review/approval/filing chips)
**All visible strings (abridged):**
"Documents"; "Every version renders from a frozen snapshot and stays reproducible. Correcting canonical data never changes a version that already exists — it becomes the basis for the next one. Renderer: {engine}@{version}."; invoice issued "Invoice {number}" + "Issued {date}"; invoice draft "Draft invoice" + "No official invoice number issued. Next in the series would be {preview}, which is an estimate until issued on the document data page."; action labels "Fix data", "Awaiting deal lock", "Regenerate", "Generate", "Approved", "Amend", "Review", "With exporter" (each with a "why" reason string); "v{version} · open"; chip texts "gen: {status}", "review: {status}", "approval: {status}", "filing: {status}"; "snap {hash}"; GenerateDocumentPanel: disabled "Approved — its files are frozen. Create an amendment to produce a corrected version."; no documentId "Created when the deal is locked. The checklist comes from the document registry, not from this page."; no formats "The configured renderer cannot produce this document. Set DOCUMENT_ENGINE=legacy to enable PDF and DOCX output."; buttons "Generate {FORMAT}" / "Preview" / "Generating…"; error "Could not generate the document."; issue list item "{label} — {detail}"; "Worth checking:"; version history row ("v{n}", "· current"/"· superseded", status text, "— amended from v{n}: {reason}", format links or "no file").
**States:** Loading: none. Empty: "no file" per missing artifact (no page-level empty state — rows always render). Filtered-empty: none. Error: GenerateDocumentPanel inline error ("Could not generate the document." or ApiClientError message).

#### /agent/deals/[dealId]/documents/[documentId] (no screen-ID comment)
**Description:** Detailed single-version document review page — identity, artifacts, canonical drift since generation, approval readiness, agent review actions, version history.
**Layout skeleton:**
```
div.mx-auto.max-w-5xl.p-4.md:p-6
  header (breadcrumb, h1 "{label} v{n}", status chips, authority note)
  section (Identity) — dl grid
  section (Artifacts) — list or empty, glyph-issue alert (conditional)
  section (Canonical data since this version) — conditional
  section (Approval readiness) — approvable message or blockers, advisory list
  ReviewPanel
  section (Version history)
```
**components/ui used:** StatusChip (version state, gen/review/approval status)
**All visible strings (abridged):**
"Documents" (link); "{exporter_name}"; "{label} v{version}"; chips "Current version"/"Superseded", "gen:", "review:", "approval:"; "What approval means here:"; "Identity"; field labels "Version", "Generated", "Snapshot hash", "Recorded checksum", "Reviewed by", "Approved by" ("—" defaults); "(amended from v{n})"; "Amendment reason: {reason}"; "Artifacts"; "No file has been generated for this version."; artifact row ("{format} · {size} kB · {engine} · {date}", "sha256 {hash}… · snap {hash}", "Download"); glyph alert "This PDF cannot be approved" / "The PDF font cannot represent every character in this document, so a PDF rendering would substitute them. Use the DOCX output, which represents them correctly, or transliterate the values in the canonical record." / issue items "{label}: {sample} ({code_points})"; "Canonical data since this version"; "Nothing this document reads has changed since it was generated."; "Current data has changed since v{n} was generated. That does not make this version incorrect — it was generated from what was true at the time. Create an amendment if the shipment needs a corrected document."; drift entry "{label} ({kind}): {from} → {to}"; "Approval readiness"; "Nothing is blocking approval. The exporter can approve this version."; "Worth checking — none of these block approval"; ReviewPanel: "Agent review"; "Your review says this version is fit to put in front of the exporter. Approval is the exporter's decision — agents cannot approve on their behalf."; "Internal note (optional)" (placeholder "Visible to agents and Ops only. Never printed on the document."); buttons "Mark reviewed" / "Saving…", "Flag changes needed" / "Saving…"; "This version is approved and frozen. Create an amendment to correct it."; "Review is available once this version is generated (currently {status})."; "Create amendment"; "Produces the next version from current canonical data. This version stays exactly as it is, with its files and approval intact."; "Reason" (placeholder "Buyer address corrected"); "Create amendment" / "Creating…"; error "That did not work. Try again."; "Version history".
**States:** Loading: none. Empty: "No file has been generated for this version." Filtered-empty: none. Error: ReviewPanel `role="alert"` "That did not work. Try again." or specific API message.

#### /agent/leads/[buyerLeadId] (AGT-04)
**Description:** Lead/buyer workspace — buyer intelligence & evidence, exporter offer, next action, conversion controls, activity/note timeline.
**Layout skeleton:**
```
div.mx-auto.max-w-6xl.space-y-4.p-4.md:p-6
  header (buyer name h1, exporter/product link, stage chip, risk chip, owner line, conversion link)
  section (Buyer intelligence) — import_activity_summary dl, Source evidence list, Contacts list + VerifyContactForm
  section (Exporter offer) — dl + certifications + fit score
  section (Next action)
  section (Conversion) — ConvertLeadForm / DisqualifyLeadForm / status text
  section (Timeline) — LogOutreachForm, Outreach activities list, Internal notes (conditional) + InternalNoteForm
```
**components/ui used:** StatusChip (lead stage, risk flagged, verification ×2, outreach type, visibility)
**All visible strings (abridged):**
"Lead workspace"; buyer name; "{exporter} · {product}"; "Risk flagged"; "Owner: {agent name or 'Unassigned'}"; "Converted — open the deal ({stage})"; "Buyer intelligence"; verification chip "Verified"/"Partially verified"/"Unverified"; "Source evidence"; "No sourced evidence on record."; evidence item "{source_type} · {source_ref}, {summary} · observed {date}"; "Contacts"; "No contacts on record."; contact card ("{name} · {role_title}", "{email or —} {phone}", "Provenance: {provenance or 'Not recorded'} · verified {date}"); "Exporter offer"; dl labels "Capacity", "MOQ", "Target price", "Packaging", "Exporter readiness"; "Certifications: {name (status)}, ..."; "Fit score: {score} (scored at lead creation)"; "Next action"; "{next_action} — owner {name}, due {date}" or "No next action set — log an activity below to set one."; "Conversion"; "Already converted — see the deal link in the header."; "This lead is disqualified."; "Conversion opens once the lead reaches \"In negotiation\"."; "Timeline"; "Outreach activities ({N})"; "No activity logged yet."; activity card (type chip, "Exporter-visible"/"Internal" chip, summary, "{actor} · {date}"); "Internal notes ({N}) — never shown to the exporter"; note card ("{body}", "{author} · {date}").
**States:** Loading: none. Empty: "No sourced evidence on record.", "No contacts on record.", "No activity logged yet.", "No next action set — log an activity below to set one." Filtered-empty: none. Error: none directly on page (delegated to unopened child forms).

#### /agent/tasks (AGT-07)
**Description:** Cross-deal task queue for tasks the agent role owns, with view tabs (My open / Overdue / Due soon / Waiting / Escalated / Completed).
**Layout skeleton:**
```
div.mx-auto.max-w-7xl.p-4.md:p-6
  header (p "Agent workspace", h1 "Tasks, SLAs & escalations", p description, p unowned-count banner)
  nav[aria-label="Task views"] (6 view pills)
  section (h2 "{view} (N)", [empty ? message : table: Task|Exporter/deal|Type|Owner|State|Priority|Due|SLA|Blocker|Actions])
```
**components/ui used:** StatusChip (priority, SLA, per row)
**All visible strings:**
"Agent workspace"; "Tasks, SLAs & escalations"; "Every task you own across every assigned exporter, in one queue — not memory or WhatsApp."; "{N} active task(s) across your book have no named owner yet — claim them below."; view labels "My open", "Overdue", "Due soon", "Waiting", "Escalated", "Completed"; "{view} (N)"; empty "Nothing in this view right now."; table headers "Task", "Exporter / deal", "Type", "Owner", "State", "Priority", "Due", "SLA", "Blocker", "Actions"; "Unassigned"; "—"; priority labels "Low", "Normal", "High", "Urgent"; SLA labels "On time", "Due soon", "Overdue", "Escalated"; due formatted or "No due date set".
**States:** Loading: none. Empty: "Nothing in this view right now." Filtered-empty: same message (views are the filters). Error: none rendered here.

#### /agent/escalations (no screen-ID comment)
**Description:** Read-only exception queue (tasks, disputes, shipments, sanctions) across assigned exporters, filterable by source.
**Layout skeleton:**
```
div.mx-auto.max-w-7xl.p-4.md:p-6
  header (p "Agent workspace", h1 "Escalations", p description)
  nav[aria-label="Escalation sources"] (All | Tasks | Disputes | Shipments | Sanctions, with counts)
  [empty ? message : table: What happened|Exporter|Source|Severity|Owner|Due|Age]
  p (sources caveat footer)
```
**components/ui used:** StatusChip (severity, per row)
**All visible strings:**
"Agent workspace"; "Escalations"; "Open exceptions across your assigned exporters, worst first. Each row links to the record that owns it — resolve it there, not here."; source tabs "All (N)", "Tasks (N)", "Disputes (N)", "Shipments (N)", "Sanctions (N)"; empty "No open exceptions across your assigned exporters. Nothing needs you here."; table headers "What happened", "Exporter", "Source", "Severity", "Owner", "Due", "Age"; "Unassigned"; "No due date"; "{N}d"; footer "Sources: overdue/escalated or blocked tasks, open disputes, shipments on watch or blocked, and sanctions cases needing review. Disputes not attached to a deal are not listed — they carry no tenant of their own."
**States:** Loading: none. Empty: "No open exceptions across your assigned exporters. Nothing needs you here." Filtered-empty: same message applies per source tab. Error: none.

#### /agent/performance (AGT-08)
**Description:** Agent performance metrics (workload, outcome/quality) and payout records with adjustments and dispute links.
**Layout skeleton:**
```
div.mx-auto.max-w-7xl.space-y-4.p-4.md:p-6
  header (p "Agent workspace", h1 "Performance & payout", p description)
  section[aria-label="Workload"] .grid (4 MetricCards)
  div.grid.xl:grid-cols-2
    section (Performance) — ul of MetricRow
    section (Quality) — ul of MetricRow
  section (Payouts) — [empty ? message : ul of payout li: header/dl/snapshot/adjustments/paid/disputed-link/details/RaisePayoutQueryButton]
```
**components/ui used:** MetricCard ×4, StatusChip (low-sample warning per metric, payout state per payout)
**All visible strings (abridged):**
"Agent workspace"; "Performance & payout"; "Your workload, outcome quality and commission records. Every metric states the period it covers and what it is measured against — there is no single overall score."; MetricCard labels "Assigned exporters" ("Current book"), "Active leads" ("Across assigned exporters"), "Active deals" ("Qualifying through executing"), "Overdue tasks" ("Owned by you, past SLA"; comparison "Needs attention"); "Performance"; "Outreach and commercial outcomes over the {window}."; "Quality"; "Service and execution quality. These are reported separately on purpose — no composite score."; MetricRow ("Window: {window} · Denominator: X" or "· Count, no denominator"); chip "Small sample — under {MIN_SAMPLE}" (detail "Too few data points to read this as a trend."); "Payouts"; "Read-only. Amounts are frozen at the moment each payout became eligible and are never recalculated — a later fee-policy change does not move them. Finance approves and pays."; empty "No payout records yet" / "A commission record is created once one of your deals is locked. It becomes eligible when the buyer payment realizes and no dispute is open on the deal."; payout header "{exporter} · {buyer}", "Deal {last6}"; not-eligible "{reason or 'Not eligible yet.'}"; dl labels "Eligible basis", "ClearTrade fee", "Your share", "Amount"; "Snapshot: fee policy v{n} · rule X · frozen {date}"; adjustments "+{amount} {currency} — {reason} · {name}, {date}"; "Originally quoted {cur} {amount} · Net payable {cur} {amount}"; "Paid {date} · reference {X}"; "Open the linked finance case on this deal"; "Calculation breakdown" (details/pre JSON).
**States:** Loading: none. Empty: "No payout records yet" + explanatory copy. Filtered-empty: none. Error: none rendered directly on this page.

---

---

## Section 4 — Component Library

Rendered structures below are normalized JSX trees. Attribute names are shown; runtime values and conditional branches retain their source-level component/tag identity. Usage counts count importing files under `src/app`; components used only by other components are identified separately.

### `src/components/access-denied.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `state: "Human-readable no-access page`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/layout.tsx`, `src/app/app/layout.tsx`, `src/app/ops/agents/[agentId]/page.tsx`, `src/app/ops/agents/page.tsx`, `src/app/ops/assignments/page.tsx`, `src/app/ops/audit/page.tsx`, `src/app/ops/disputes/[disputeId]/page.tsx`, `src/app/ops/disputes/page.tsx`, `src/app/ops/exceptions/page.tsx`, `src/app/ops/execution/page.tsx`, `src/app/ops/finance/page.tsx`, `src/app/ops/layout.tsx`, `src/app/ops/page.tsx`, `src/app/ops/sanctions/page.tsx` (14 importing files). **Component use:** none (0).

### `src/components/agent/BuyerDecisionControls.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** `src/components/agent/BuyerDiscoveryControl.tsx` (1).

### `src/components/agent/BuyerDiscoveryControl.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
span [className]
p [className]
```

**Page use:** `src/app/agent/exporters/[exporterOrgId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/agent/ConvertLeadForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/leads/[buyerLeadId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/agent/CreateTaskForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `role: ownerRole,`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/exporters/[exporterOrgId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/agent/DemandDiscoveryControl.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
span [className]
p [className]
```

**Page use:** `src/app/agent/exporters/[exporterOrgId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/agent/DisqualifyLeadForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
option [key, value]
```

**Page use:** `src/app/agent/leads/[buyerLeadId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/agent/InternalNoteForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/exporters/[exporterOrgId]/page.tsx`, `src/app/agent/leads/[buyerLeadId]/page.tsx` (2 importing files). **Component use:** none (0).

### `src/components/agent/LogOutreachForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/leads/[buyerLeadId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/agent/MarketDecisionControls.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** `src/components/agent/DemandDiscoveryControl.tsx` (1).

### `src/components/agent/MessageForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/exporters/[exporterOrgId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/agent/ProductClassificationForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `status:string|null`, `status??'not classified'}</p><p className`

**Rendered markup structure**

```text
div [className]
  p [className]
  p [className]
  div [className]
    input [aria-label, value, onChange, placeholder, className]
    input [aria-label, value, onChange, placeholder, inputMode, …]
    textarea [aria-label, value, onChange, placeholder, className]
  div [className]
    Button [onClick, className]
```

**Page use:** `src/app/agent/exporters/[exporterOrgId]/page.tsx`, `src/app/app/markets/DemandDiscovery.tsx` (2 importing files). **Component use:** none (0).

### `src/components/agent/ProductQuickEditForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/exporters/[exporterOrgId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/agent/RaisePayoutQueryButton.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/performance/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/agent/TaskEscalationActions.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/tasks/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/agent/VerifyContactForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `status: status, evidence: evidence.trim() })`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/leads/[buyerLeadId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/buyer-detail/RelationshipActions.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
p [className]
```

**Page use:** `src/app/app/buyers/[buyerId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/commercial/ProposalDiff.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/deals/[dealId]/commercial/page.tsx`, `src/app/app/deals/[dealId]/commercial/page.tsx` (2 importing files). **Component use:** none (0).

### `src/components/commercial/ProposalHistory.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `tone: 'neutral', icon: 'dot', detail: 'Not yet sent to the exporter.' },`, `tone: 'warning', icon: 'clock' },`, `tone: 'positive', icon: 'check' },`, `tone: 'info', icon: 'alert' },`, `tone: 'neutral', icon: 'pause' },`, `tone: 'neutral', icon: 'x' },`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/deals/[dealId]/commercial/page.tsx`, `src/app/app/deals/[dealId]/commercial/page.tsx` (2 importing files). **Component use:** none (0).

### `src/components/documents/DocumentApprovalPanel.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/documents/GenerateButton.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/deals/[dealId]/page.tsx`, `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx`, `src/app/app/deals/[dealId]/documents/page.tsx` (3 importing files). **Component use:** none (0).

### `src/components/documents/UploadReplacement.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/enablement/AskAgentButton.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/tasks/page.tsx`, `src/app/app/readiness/tasks/page.tsx` (2 importing files). **Component use:** none (0).

### `src/components/enablement/EvidenceUploadForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `status: string`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/tasks/page.tsx`, `src/app/app/readiness/tasks/page.tsx` (2 importing files). **Component use:** none (0).

### `src/components/enablement/SelfCompleteButton.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/readiness/tasks/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/execution/AssignPartnerForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/deals/[dealId]/page.tsx`, `src/app/ops/execution/page.tsx` (2 importing files). **Component use:** none (0).

### `src/components/execution/EscalateBlockerButton.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/deals/[dealId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/execution/FileDocumentForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `status: to,`

**Rendered markup structure**

```text
p [className]
```

**Page use:** `src/app/agent/deals/[dealId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/execution/GatedAction.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
Fragment
```

**Page use:** `src/app/agent/deals/[dealId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/execution/HandoffStatusForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `status: string`, `status: to,`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/deals/[dealId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/execution/InternalNoteForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/deals/[dealId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/execution/TaskActions.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `state: string }) {`, `kind: 'blocked' | 'cancel' } | null>(null)`, `kind: o.needsReason }) : void run(o.value))}`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/deals/[dealId]/page.tsx`, `src/app/agent/tasks/page.tsx`, `src/app/app/deals/[dealId]/tasks/page.tsx` (3 importing files). **Component use:** none (0).

### `src/components/notifications/NotificationsList.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/notifications/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/notifications/OrgProfileForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `state: string | null`, `state ?? '')`, `state: state.trim() || null,`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/notifications/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/notifications/PreferencesPanel.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/notifications/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/notifications/TeamPanel.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `role: string`, `status: string`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/notifications/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops-disputes/DisputeActions.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `role: string`, `status: string`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/disputes/[disputeId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/AddAgentForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `role: string`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/agents/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/AgentActivationControl.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/agents/[agentId]/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/AssignAgentToExporterForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/assignments/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/AssignExporterForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/agents/[agentId]/page.tsx`, `src/app/ops/assignments/page.tsx` (2 importing files). **Component use:** none (0).

### `src/components/ops/ConfigVersionForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/audit/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/FeePolicyForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/audit/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/GenerateInvitationLinkForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/agents/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/OverrideRequirementForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/execution/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/PartnerDirectoryForms.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `status: status, reason: reason.trim() })`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/audit/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/PayoutActions.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `state: string }) {`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/finance/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/ReassignExporterForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/agents/[agentId]/page.tsx`, `src/app/ops/assignments/page.tsx` (2 importing files). **Component use:** none (0).

### `src/components/ops/RecordFilingForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `status: target,`

**Rendered markup structure**

```text
option [key, value]
```

**Page use:** `src/app/ops/execution/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/RevokeGrantButton.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/agents/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/RevokeInvitationButton.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/ops/agents/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ops/SanctionsSourceHealthPanel.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `tone:StatusTone`, `tone:'positive',icon:'check',label:'Screening READY',blurb:'All required datasets are complete, fresh and active. Buyer screening is operating on full coverage.'},`, `tone:'warning',icon:'clock',label:'Screening DEGRADED',blurb:'Screening still has complete coverage, but at least one dataset failed its most recent refresh and is serving an older snapshot.'},`, `tone:'critical',icon:'block',label:'Screening BLOCKED',blurb:'Required coverage is incomplete. Buyer screening fails closed — it will not return clear results until this is resolved.'},`, `tone:'critical',icon:'block',label:'No active snapshot'}`, `tone:'critical',icon:'alert',label:d.completeness??'UNKNOWN'}`, `tone:'critical',icon:'alert',label:'STALE'}`, `tone:'warning',icon:'clock',label:'COMPLETE · refresh failed'}`, `tone:'positive',icon:'check',label:'COMPLETE'}`, `state??'none'}/>`

**Rendered markup structure**

```text
div
  dt [className]
  dd [className]
section [className]
  div [className]
    div
      h2 [className]
      p [className]
    StatusChip [label, tone, icon]
  div [className]
  div [className]
  p [className]
    strong
li [key]
StatusChip [key, size, tone, icon, label, …]
article [key, className]
  div [className]
    div
      p [className]
        span [className]
      p [className]
    StatusChip [size, label, tone, icon]
  dl [className]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value]
    Field [label, value, muted]
  p [className]
li [key]
```

**Page use:** `src/app/ops/sanctions/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/payment/BrcStatusControl.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/payment/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/payment/InsuranceQuoteButton.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/payment/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/payment/OpenDisputeButton.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/payment/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/payment/PaymentEvidenceUpload.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/payment/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/payment/PaymentStatusForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/payment/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/shell/AppShell.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** `portal: Portal`, `role: UserRole`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/agent/layout.tsx`, `src/app/app/layout.tsx`, `src/app/ops/layout.tsx` (3 importing files). **Component use:** none (0).

### `src/components/shipment/ConfirmPickupForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/shipment/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/shipment/MilestoneEvidenceUpload.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/shipment/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/shipment/RaiseIssueButton.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/shipment/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/support/AcceptResolutionButton.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/support/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/support/CreateCaseForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/support/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/support/SendMessageForm.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** `src/app/app/deals/[dealId]/support/page.tsx` (1 importing file). **Component use:** none (0).

### `src/components/ui/Button.tsx`

**Props**

```ts
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}
```

**Variants/states declared:** `variant?: ButtonVariant`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** none (0).

### `src/components/ui/DataTable.tsx`

**Props**

```ts
export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  page: PageMeta;
  onPageChange: (page: number) => void;
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort) => void;
  hasActiveFilters?: boolean;
  emptyState: DataTableEmptyState;
  filteredEmptyState?: DataTableEmptyState;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => React.ReactNode;
  className?: string;
}
```

**Variants/states declared:** `state: DataTableEmptyState }) {`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** none (0).

### `src/components/ui/Input.tsx`

**Props**

```ts
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
}
```

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** none (0).

### `src/components/ui/JourneyProgress.tsx`

**Props**

```ts
export interface JourneyProgressProps {
  currentStage: JourneyStageValue;
  /**
   * Deep-link target for a REACHED segment (completed or current). Return `null` to keep
   * a reached segment non-actionable anyway (e.g. "Deal" is reached but there's no single
   * deal id to link to from an org-wide dashboard). Never consulted for a future segment.
   */
  getHref?: (segmentKey: string, segmentIndex: number) => string | null;
  className?: string;
}
```

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** none (0).

### `src/components/ui/MetricCard.tsx`

**Props**

```ts
export interface MetricCardProps {
  label: string;
  value: string | number;
  /** Extra context under the value — e.g. "vs. 12 last month". */
  secondaryText?: string;
  comparison?: MetricCardComparison;
  loading?: boolean;
  className?: string;
}
```

**Variants/states declared:** `tone?: StatusTone`, `tone ?? 'neutral'])}>`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** none (0).

### `src/components/ui/NextActionCard.tsx`

**Props**

```ts
export interface NextActionCardProps {
  title: string;
  owner?: string | null;
  dueAt?: Date | string | null;
  /** SLA/priority urgency, rendered as a StatusChip — never color alone (docs/00 §2). */
  urgency: StatusDescriptor;
  /** What is stopping this action, if anything, with its own deep link to resolve it. */
  blocker?: Blocker | null;
  /** Deep-link CTA target (docs/03 §1: every object page supports deep linking). */
  href: string;
  ctaLabel?: string;
  loading?: boolean;
  className?: string;
}
```

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** none (0).

### `src/components/ui/NotBuiltYet.tsx`

**Props**

No named `*Props` type/interface; props are absent or typed inline.

**Variants/states declared:** none detected as typed variant/state props; conditional runtime branches may still render feedback.

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** none (0).

### `src/components/ui/Skeleton.tsx`

**Props**

```ts
export interface SkeletonProps {
  variant?: 'text' | 'circle' | 'rect';
  width?: string | number;
  height?: string | number;
  /** Stacked lines for a text block; the last line is shorter, like real copy. */
  lines?: number;
  className?: string;
}
```

**Variants/states declared:** `variant?: 'text' | 'circle' | 'rect'`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** none (0).

### `src/components/ui/StatusChip.tsx`

**Props**

```ts
export interface StatusChipProps extends StatusDescriptor {
  size?: 'sm' | 'md';
  className?: string;
}
```

**Variants/states declared:** `size: number }) {`, `size?: 'sm' | 'md'`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** none (0).

### `src/components/ui/UpgradeNotice.tsx`

**Props**

```ts
export type UpgradeNoticeProps =
  | (UpgradeNoticeBase & { variant?: 'block'; description: string })
  | (UpgradeNoticeBase & { variant: 'inline'; description?: never });
```

**Variants/states declared:** `variant?: 'block'`, `variant: 'inline'`

**Rendered markup structure**

```text
(no JSX return; helper/module only)
```

**Page use:** none directly (0 importing files). **Component use:** none (0).


---

## Section 3 — Page Inventory (remaining portals and unregistered routes)

The agent-portal inventory appears earlier in this file. Trees below are normalized from JSX return structures; child components named in a tree supply their own markup documented in Section 4. Strings include static JSX text plus user-facing `aria-label`, `placeholder`, and `title` literals in the page module; strings emitted by child components are catalogued in Sections 4 and 8.

### `/accept-staff-invitation` — no registered screen ID

**Description:** Page headed or introduced by “ClearTrade AI”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** none directly in the page module.

**User-visible strings in the page module:** “ClearTrade AI”; “Go to sign in”; “This invitation is not valid”; “This invitation has expired”; “This invitation has already been used”; “Agent invitation”; “You've received a single-use invitation to join ClearTrade as an Agent. Sign in with an existing account, or create a new one — either way, you'll come straight back here to confirm.”; “Sign in”; “Create an account”; “Accept agent invitation”; “This account cannot become an Agent”; “You are signed in as”; “You are already an Agent”; “This account already has the Agent role. There is nothing to accept.”; “Open the Agent workspace”; “This account cannot be converted”; “, which is an internal ClearTrade account. Staff roles are changed through Ops, not by accepting an invitation.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: rendered or delegated in this module.

### `/login` — no registered screen ID

**Description:** Page headed or introduced by “ClearTrade AI”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** none directly in the page module.

**User-visible strings in the page module:** “ClearTrade AI”; “Sign in to your workspace”; “Use Google, Apple, or your ClearTrade email and password.”.

**States:** Loading: none in this page module. Empty: none in this page module. Filtered-empty: none in this page module. Error: rendered or delegated in this module.

### `/register` — no registered screen ID

**Description:** Page headed or introduced by “ClearTrade AI”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** none directly in the page module.

**User-visible strings in the page module:** “ClearTrade AI”; “Create your free account”; “Save your searches, see buyer contacts, and track leads.”; “Your”; “search”; “from this session will be kept and become your saved history.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/billing` — no registered screen ID

**Description:** Page headed or introduced by “Commitment fee”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** none directly in the page module.

**User-visible strings in the page module:** “Commitment fee”; “A one-time fee that unlocks full ranked Demand Discovery, Buyer Discovery contacts, and the agent-assisted workflow.”.

**States:** Loading: none in this page module. Empty: none in this page module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/buyers/[buyerId]` — EXP-07

**Description:** Page headed or introduced by “Test evidence · Non-real evidence:”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** StatusChip, UpgradeNotice.

**User-visible strings in the page module:** “Test evidence · Non-real evidence:”; “This buyer is not fully verified. We recommend agent verification before outreach.”; “Risk”; “No risk flags on record.”; “Fit”; “Algorithmic relevance based on buyer activity and market context.”; “No activity summary on record for this buyer.”; “Fit score for your product:”; “(algorithmic, scored at lead creation)”; “Evidence”; “No sourced evidence on record.”; “Observed”; “Contacts”; “Verified contacts need a free account”; “Source:”; “No contacts listed for this buyer.”; “Your relationship with this buyer”; “Not shortlisted. No lead yet.”; “Agent:”; “Converted to a deal.”; “Shortlisted, no lead created yet.”; “Saving a lead needs a free account”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/buyers` — EXP-06

**Description:** Page headed or introduced by “buyers”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** none directly in the page module.

**User-visible strings in the page module:** none; rendered strings come from delegated child components.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: rendered or delegated in this module.

### `/app/deals/[dealId]/activity` — no registered screen ID

**Description:** Page headed or introduced by “Activity”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Activity”; “Material changes on this deal — stage, approvals, documents, shipment and payment.”; “No recorded activity yet. Material changes to this deal will appear here as they happen.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/deals/[dealId]/commercial` — EXP-10

**Description:** Page headed or introduced by “No terms to review yet”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “No terms to review yet”; “Your agent hasn't sent commercial terms for this deal yet. When they do, you'll get a task and can approve or request changes here.”; “Current proposal”; “Version”; “Note from your agent”; “Changes you requested”; “These terms are locked”; “The deal snapshot is frozen and every document generates from it. Changing a locked term needs an amendment, which your agent raises and you approve — the original version stays on record either way.”; “Waiting on an authorized approver”; “is ready for approval, but your account isn't authorized to approve commercial terms. The account owner needs to approve it.”; “Terms accepted”; “You accepted version”; “. Your agent will prepare the documents and lock the deal.”; “Version history”; “Every version is kept. A revision never edits a version you already acted on.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/deals/[dealId]/documents/[documentId]` — EXP-13

**Description:** Page headed or introduced by “Document checklist”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Document checklist”; “Version”; “Generated”; “Reviewed”; “Approved”; “Filed”; “Preview”; “Download”; “Version history”; “Prior versions are read-only.”; “(viewing)”; “Superseded version”; “This is a historical version and cannot be approved (EXP-13-AC01). Open the current version to act on it.”; “This version was filed and is read-only. Reference:”; “Awaiting an authorized approver”; “This document is ready for approval, but your account isn't authorized to approve it.”; “Approved by”; “— an immutable record bound to this checksum.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: rendered or delegated in this module.

### `/app/deals/[dealId]/documents` — EXP-12

**Description:** Page headed or introduced by “No documents yet”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “No documents yet”; “Documents generate from the deal snapshot, which is created when the deal is locked. There is nothing to show until then.”; “Document checklist”; “Generation, review, approval and filing are tracked independently for every document.”; “Document”; “Version”; “Generation”; “Review”; “Approval”; “Filing”; “Exception”; “Action”; “Not yet created for this deal.”; “v”; “versions)”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: rendered or delegated in this module.

### `/app/deals/[dealId]` — EXP-09

**Description:** Page headed or introduced by “Commercial terms”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Commercial terms”; “Quantity”; “Unit price”; “Total value”; “Incoterm”; “Payment terms”; “Delivery”; “Recent activity”; “Full history lives in the Activity tab.”; “No material events recorded for this deal yet.”; “Your next actions”; “Nothing outstanding on your side for this deal right now.”; “Waiting on ClearTrade”; “High-level status only — internal work is never shown here.”; “Nothing is currently waiting on your agent for this deal.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/deals/[dealId]/payment` — EXP-15

**Description:** Page headed or introduced by “No payment milestones yet”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “No payment milestones yet”; “Payment tracking begins once your agent sets up the payment schedule for this deal. There is nothing to show until then.”; “payment”; “overdue from the buyer.”; “This tracks what the buyer owes you directly. ClearTrade does not hold or settle these funds — follow up with the buyer or your bank, and record what you learn below.”; “Payment milestones”; “Tracks what the buyer owes and has paid you directly — a visibility record, not funds ClearTrade holds.”; “Provenance:”; “via”; “Insurance”; “Trade credit / cargo cover for this deal, tracked separately from payment status.”; “Provider”; “Policy ref”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/deals/[dealId]/shipment` — EXP-14

**Description:** Page headed or introduced by “No shipment yet”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “No shipment yet”; “Shipment tracking begins once your agent creates the shipment record for this deal. There is nothing to show until then.”; “This shipment has an open issue.”; “Shipment”; “CHA partner”; “Freight partner”; “Booking ref”; “Customs ref”; “Shipping bill no.”; “Filing references are set by your CHA/agent and shown here read-only.”; “Milestone timeline”; “ETA and actual are tracked separately for every milestone.”; “Milestone”; “State”; “ETA”; “Actual”; “Evidence”; “Uploaded”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/deals/[dealId]/support` — EXP-16

**Description:** Page headed or introduced by “Conversation”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Conversation”; “Messages with your agent and ClearTrade support.”; “No messages yet — send the first one below.”; “Open cases”; “Structured issues, tracked separately from the conversation above.”; “No open cases. If something needs attention beyond a message, open a case above.”; “· Case”; “Owner:”; “· Updated”; “Waiting on”; “. Next update expected”; “Proposed resolution”; “Resolved history”; “Immutable — closed cases are never edited.”; “Closed”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/deals/[dealId]/tasks` — EXP-11

**Description:** Page headed or introduced by “Owner:”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Owner:”; “Due:”; “Waiting on”; “My actions”; “Work only you can complete.”; “Nothing needs your action right now.”; “Blocked dependency”; “Cannot be marked done until the dependency clears.”; “Nothing is blocked.”; “Waiting on ClearTrade”; “High-level status only — internal steps on ClearTrade's side aren't shown here.”; “Nothing pending on ClearTrade's side.”; “Completed (”; “Completed”; “· Owner:”; “No tasks on this deal yet”; “Tasks appear here as the deal moves forward.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/deals` — EXP-08

**Description:** Page headed or introduced by “Deal tracking is on the agent-assisted plan”.

**Layout skeleton**

```text
DealsList [initialFilters]
```

**components/ui used:** UpgradeNotice.

**User-visible strings in the page module:** “Deal tracking is on the agent-assisted plan”.

**States:** Loading: none in this page module. Empty: none in this page module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/markets/[marketAssessmentId]` — EXP-05

**Description:** Page headed or introduced by “[marketAssessmentId]”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** none directly in the page module.

**User-visible strings in the page module:** none; rendered strings come from delegated child components.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/markets` — EXP-04

**Description:** Page headed or introduced by “markets”.

**Layout skeleton**

```text
MarketEstimate [tier, guestRunLimit]
```

**components/ui used:** none directly in the page module.

**User-visible strings in the page module:** none; rendered strings come from delegated child components.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: rendered or delegated in this module.

### `/app/messages` — no registered screen ID

**Description:** Page headed or introduced by “Messaging is on the agent-assisted plan”.

**Layout skeleton**

```text
MessagesList
```

**components/ui used:** UpgradeNotice.

**User-visible strings in the page module:** “Messaging is on the agent-assisted plan”.

**States:** Loading: none in this page module. Empty: none in this page module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/more` — no registered screen ID

**Description:** Page headed or introduced by “Paid plan”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** UpgradeNotice.

**User-visible strings in the page module:** “Paid plan”; “Coming soon”; “More”; “Everything else”; “Secondary destinations not on the primary tab bar.”; “Explore”; “Manage”.

**States:** Loading: none in this page module. Empty: none in this page module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/notifications` — EXP-17

**Description:** Page headed or introduced by “Notifications & account settings need a free account”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** UpgradeNotice.

**User-visible strings in the page module:** “Notifications & account settings need a free account”; “Notifications & Account”; “Your alerts, notification preferences, organization profile and team.”.

**States:** Loading: none in this page module. Empty: none in this page module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/overview` — EXP-01

**Description:** Page headed or introduced by “Overview”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** Skeleton.

**User-visible strings in the page module:** “Overview”; “Where you are, what needs you next, and who to ask for help.”.

**States:** Loading: rendered or delegated in this module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: rendered or delegated in this module.

### `/app/readiness` — EXP-02

**Description:** Page headed or introduced by “Export readiness is available with a free account”.

**Layout skeleton**

```text
div [className]
  UpgradeNotice [title, requiredTier, description]
```

**components/ui used:** UpgradeNotice.

**User-visible strings in the page module:** “Export readiness is available with a free account”.

**States:** Loading: none in this page module. Empty: none in this page module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/readiness/tasks` — EXP-03

**Description:** Page headed or introduced by “The Enablement Center needs a free account”.

**Layout skeleton**

```text
(page delegates its rendered body to an imported page component)
```

**components/ui used:** StatusChip, UpgradeNotice.

**User-visible strings in the page module:** “The Enablement Center needs a free account”; “Owner:”; “Due”; “Waiting on you:”; “Why it matters:”; “Verified from”; “Enablement Center”; “One checklist for becoming export-ready — requirements ClearTrade can guide, evidence you upload, and items your agent owns.”; “Readiness score:”; “Readiness achieved”; “Nothing is blocking you from buyer outreach. The items below are recommended improvements, not requirements.”; “Required before outreach”; “These block your readiness score until resolved.”; “Recommended”; “Not required, but strengthens your position with buyers.”; “No enablement tasks yet”; “Complete your readiness assessment to generate a checklist.”; “Help”; “ClearTrade assists with these steps and reviews what you upload — we do not file or register anything on your behalf. For regulated items like IEC, GST or AD code, the filing itself happens with the relevant authority or your bank; upload the evidence once you have it and your agent will confirm it.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/app/tasks` — no registered screen ID

**Description:** Page headed or introduced by “Cross-deal task tracking is on the agent-assisted plan”.

**Layout skeleton**

```text
TasksList
```

**components/ui used:** UpgradeNotice.

**User-visible strings in the page module:** “Cross-deal task tracking is on the agent-assisted plan”.

**States:** Loading: none in this page module. Empty: none in this page module. Filtered-empty: none in this page module. Error: none in this page module.

### `/ops/agents/[agentId]` — no registered screen ID

**Description:** Page headed or introduced by “← All agents”.

**Layout skeleton**

```text
AccessDenied [message]
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “← All agents”; “· joined”; “Assigned exporters:”; “/ target ~”; “Administrative actions”; “Assign an exporter”; “Exporter”; “Status”; “Started”; “Ended”; “Assigned by”; “Action”; “No assignments yet.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/ops/agents` — no registered screen ID

**Description:** Page headed or introduced by “Ops”.

**Layout skeleton**

```text
AccessDenied [message]
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Ops”; “Agents”; “Internal staff. Agents are provisioned by invitation only — there is no self-registration path to this role.”; “Generate invitation link”; “Creates a single-use Agent invitation link. Anyone with this link can claim the invitation, so send it only to the intended person.”; “Add agent directly”; “No link, no email sent. Converts an existing ClearTrade account directly, or pre-authorizes an email that hasn't signed up yet.”; “Pending invitation links”; “Bearer links — not bound to any email address.”; “Agent invitation”; “created by”; “· created”; “· expires”; “Pending direct access grants”; “Pre-authorized emails with no account yet. Claimed automatically at their next verified sign-in.”; “· granted by”; “Agent”; “Status”; “Assigned”; “Exporters”; “No agents yet. Invite one above.”; “/ target ~”; “over target”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/ops/assignments` — OPS-02

**Description:** Page headed or introduced by “Operations”.

**Layout skeleton**

```text
AccessDenied [message]
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Operations”; “Assignments & agent capacity”; “Every exporter, lead and deal must have a visible owner. No hard capacity cap — advisory load only.”; “Unassigned queue”; “Exporters with no assigned agent, oldest first.”; “No newly active exporter is currently unassigned.”; “Exporter”; “Journey stage”; “Readiness”; “Age”; “Action”; “No active agents”; “Current assignments”; “Every exporter with a live agent, and the controls to move them.”; “No active assignments yet.”; “Agent”; “Started”; “Assigned by”; “Reason”; “Actions”; “Agent capacity”; “Advisory load signal — not a hard cap.”; “No active agents are available for assignment.”; “exporters ·”; “active deals ·”; “overdue”; “Assignment history”; “Audit-backed — who assigned or reassigned, and why.”; “No assignments have been recorded yet.”; “→”; “· assigned by”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/ops/audit` — OPS-07

**Description:** Page headed or introduced by “Operations”.

**Layout skeleton**

```text
AccessDenied [message]
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Operations”; “Audit log & admin configuration”; “Immutable traceability for material changes, plus a controlled place for business configuration.”; “Audit search”; “Read-only. No mutation is possible through this UI.”; “Config registry”; “Fee policy, SLA thresholds, document type registry and platform config.”; “Fee policy”; “Active: v”; “· success fee”; “% · agent share”; “% · effective”; “Version history (”; “v”; “— effective”; “Example: deal”; “locked”; “keeps its own quoted fee policy snapshot regardless of later versions above.”; “BuyerFit scoring policy”; “Read-only · code-owned”; “Version”; “· model”; “· hash”; “…”; “Not operator-tunable. Changing it requires a code change, which bumps the version and hash recorded on every assessment scored afterwards.”; “Policy snapshot”; “Current value”; “Partner directory”; “The approved CHA/freight/insurance/inspection/bank directory — assignment and performance are surfaced in”; “CHA & compliance oversight”; “No partners onboarded yet.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/ops/disputes/[disputeId]` — OPS-06 detail

**Description:** Page headed or introduced by “Dispute oversight”.

**Layout skeleton**

```text
AccessDenied [message]
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Dispute oversight”; “· Case”; “case”; “Facts”; “Owner”; “Opened”; “Linked shipment”; “Linked payment”; “Waiting on”; “· follow up”; “Resolution”; “Closed”; “Messages”; “The deal's exporter-visible conversation — the same thread the exporter sees.”; “No messages on this deal yet.”; “) ·”; “Internal notes”; “Never shown to the exporter.”; “None.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/ops/disputes` — OPS-06

**Description:** Page headed or introduced by “Operations”.

**Layout skeleton**

```text
AccessDenied [message]
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Operations”; “Dispute oversight”; “Intake through investigation, resolution and closure.”; “Open cases”; “All cases”; “Case queue”; “Sorted by severity, then oldest first.”; “Case”; “Type”; “Severity”; “Exporter”; “Owner”; “Status”; “Next update”; “Age”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/ops/exceptions` — OPS-03

**Description:** Page headed or introduced by “Operations”.

**Layout skeleton**

```text
AccessDenied [message]
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Operations”; “Exceptions & escalations”; “Blocked, overdue, rejected and exception work across every domain, centralized in one queue.”; “Exception filters”; “Sorted oldest first — age drives priority alongside severity.”; “No active exceptions in this view. New and aging exceptions will be listed here with type, owner, reason and age.”; “Type”; “Object”; “Reason”; “Category”; “Owner”; “Age”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/ops/execution` — OPS-04

**Description:** Page headed or introduced by “Operations”.

**Layout skeleton**

```text
AccessDenied [message]
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Operations”; “CHA, compliance & document oversight”; “ClearTrade coordinates filing with CHAs — it does not file directly with ICEGATE.”; “Ready to file (”; “Documents cleared and waiting on CHA/external action.”; “Nothing waiting to file.”; “Rejected / missing (”; “Document and compliance blockers — reason and owner.”; “No rejected or failed documents.”; “v”; “Current version”; “. Full history in the audit log.”; “CHA / freight assignments”; “Partner, deal/shipment, SLA and reference status — assigned from the approved directory only.”; “No active shipments.”; “open deal”; “CHA:”; “Unassigned”; “Freight:”; “Recent handoffs”; “No handoffs recorded yet.”; “Partner”; “Exporter”; “Status”; “Reference”; “Sent”; “Partner performance”; “Handoff counts by outcome — no composite score.”; “Acknowledged”; “Completed”; “Rejected”; “Manage the partner directory (onboarding, status changes) in”; “Audit & Config”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: rendered or delegated in this module.

### `/ops/finance` — OPS-05

**Description:** Page headed or introduced by “Operations”.

**Layout skeleton**

```text
AccessDenied [message]
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Operations”; “Finance, fees & payouts”; “Commercial fee and buyer payment are separate records — never mixed into one figure.”; “Fee records”; “Snapshot of the fee policy in force at lock time — later config changes never rewrite these.”; “No deals have been locked yet, so there are no fee snapshots to show.”; “Deal”; “Exporter”; “Deal value”; “Locked”; “Fee snapshot”; “Buyer payments”; “All”; “Overdue only”; “Separate from ClearTrade's own fee — this tracks money owed by the buyer to the exporter.”; “Amount”; “Due”; “Status”; “Agent payout”; “Eligible basis, share snapshot, amount and status. Figures are frozen at eligibility — approving or adjusting never recalculates them from current config (AC02).”; “No payout records yet. One is created per agent-owned deal from lock onward, and becomes eligible once the configured policy is satisfied.”; “Agent”; “Deal / exporter”; “Eligible basis”; “Share”; “Actions”; “fee policy v”; “adjustment(s) — net”; “Ref”; “Open finance case”; “Exceptions”; “Disputed fee or payment, or missing realization.”; “No disputed payments.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/ops` — OPS-01

**Description:** Page headed or introduced by “Operations”.

**Layout skeleton**

```text
li [key, className]
  span [className]
  div [className]
    div [className, style]
  span [className]
```

**components/ui used:** MetricCard, StatusChip.

**User-visible strings in the page module:** “Operations”; “Control Tower”; “Portfolio flow, ownership and exceptions.”; “Exception KPIs”; “Risk queue”; “Highest severity and oldest first.”; “Healthy portfolio — no active risks or shipment exceptions. New and aging work will appear here.”; “Reference”; “Issue”; “Category”; “Owner”; “Age”; “Stage funnel”; “Exporter journey stages, not activity volume.”; “Agent capacity”; “Advisory load signal — not a hard cap.”; “No active agents are available for assignment.”; “exporters ·”; “active deals ·”; “overdue”; “Recent escalations”; “Open items awaiting an Ops decision.”; “No open escalations. Escalated tasks will be listed here with their owner and context.”; “· escalated”; “ago”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.

### `/ops/sanctions` — no registered screen ID

**Description:** Page headed or introduced by “Sanctions review”.

**Layout skeleton**

```text
main [className]
  div
    h1 [className]
    p [className]
  SanctionsSourceHealthPanel [health]
  section [className]
    h2 [className]
```

**components/ui used:** StatusChip.

**User-visible strings in the page module:** “Sanctions review”; “Possible matches require human determination. Decisions are append-only.”; “Review queue”; “No unresolved possible matches.”; “· candidate”; “Algorithm”; “. Submit a decision through the sanctions review API; prior decisions are retained.”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: rendered or delegated in this module. Error: none in this page module.

### `/` — no registered screen ID

**Description:** Page headed or introduced by “ClearTrade AI”.

**Layout skeleton**

```text
LandingPage
```

**components/ui used:** none directly in the page module.

**User-visible strings in the page module:** “ClearTrade AI”; “Sign in”; “Find buyers for what you export — before you sign up for anything”; “ClearTrade helps Indian manufacturers find export markets and buyers, then pairs you with a human agent to handle the deal, paperwork, shipping and payment.”; “Find your export markets — free, no account needed”; “Already have an account?”; “Create a free account”.

**States:** Loading: none in this page module. Empty: rendered or delegated in this module. Filtered-empty: none in this page module. Error: none in this page module.


---

## Section 8 — Microcopy Register

This register is mechanically extracted from rendered JSX text, user-facing JSX attributes, conditional render literals, and named copy/label properties in `src/**/*.tsx`. Locations are source line numbers. “Owner compliance” applies only to waiting/pending language: it is `complies` when that string names the responsible actor, `does not comply` when it says only pending/waiting/awaiting, and `not applicable` for other statuses.

### Status strings (408 located occurrences)

| Verbatim string | Location | Owner compliance |
|---|---|---|
| ? They immediately lose portal access. Their history (decisions, assignments, audit trail) is preserved and stays attributed to them. Any active assignments must be reassigned or unassigned first. | `src/components/ops/AgentActivationControl.tsx:72` | not applicable |
| · escalated | `src/app/ops/page.tsx:82` | not applicable |
| · Generated | `src/app/app/markets/[marketAssessmentId]/MarketDetail.tsx:174` | not applicable |
| · open | `src/app/agent/deals/[dealId]/documents/page.tsx:116` | not applicable |
| · Sent | `src/app/agent/deals/[dealId]/page.tsx:343` | not applicable |
| · superseded | `src/app/agent/deals/[dealId]/documents/page.tsx:206` | not applicable |
| · Superseded | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:193` | not applicable |
| A commission record is created once one of your deals is locked. It becomes eligible when the buyer payment realizes and no dispute is open on the deal. | `src/app/agent/performance/page.tsx:143` | not applicable |
| A number is recorded separately from its verification. We will never mark it verified just because it is filled in. | `src/app/app/readiness/ReadinessForm.tsx:23` | not applicable |
| AA-verified | `src/components/payment/PaymentStatusForm.tsx:24` | not applicable |
| Acknowledged | `src/app/agent/deals/[dealId]/page.tsx:68` | not applicable |
| Acknowledged | `src/app/ops/execution/page.tsx:30` | not applicable |
| Acknowledged | `src/app/ops/execution/page.tsx:229` | not applicable |
| active | `src/components/agent/BuyerDiscoveryControl.tsx:296` | not applicable |
| active | `src/components/agent/DemandDiscoveryControl.tsx:218` | not applicable |
| active | `src/components/ops/PartnerDirectoryForms.tsx:91` | not applicable |
| Active | `src/app/agent/deals/page.tsx:33` | not applicable |
| Active | `src/app/ops/agents/[agentId]/page.tsx:53` | not applicable |
| Active | `src/app/ops/agents/page.tsx:150` | not applicable |
| Active | `src/app/ops/assignments/page.tsx:220` | not applicable |
| Active | `src/components/ops/PartnerDirectoryForms.tsx:124` | not applicable |
| Active deals | `src/app/agent/exporters/page.tsx:167` | not applicable |
| active deals · | `src/app/ops/assignments/page.tsx:197` | not applicable |
| active deals · | `src/app/ops/page.tsx:81` | not applicable |
| active leads across your assigned exporters. | `src/app/agent/page.tsx:47` | not applicable |
| active task | `src/app/agent/tasks/page.tsx:104` | not applicable |
| Active: v | `src/app/ops/audit/page.tsx:101` | not applicable |
| All active stages | `src/app/agent/outreach/OutreachPipeline.tsx:205` | not applicable |
| Already converted — see the deal link in the header. | `src/app/agent/leads/[buyerLeadId]/page.tsx:214` | not applicable |
| already has a pending pre-authorization awaiting their sign-in. | `src/components/ops/AddAgentForm.tsx:131` | does not comply |
| Approved | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:231` | not applicable |
| Approved | `src/app/agent/deals/[dealId]/documents/page.tsx:35` | not applicable |
| Approved | `src/app/agent/deals/[dealId]/documents/page.tsx:209` | not applicable |
| Approved | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:132` | not applicable |
| Approved | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:228` | not applicable |
| Approved — its files are frozen. Create an amendment to produce a corrected version. | `src/app/agent/deals/[dealId]/documents/GenerateDocumentPanel.tsx:51` | not applicable |
| Approved by | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:230` | not applicable |
| At risk | `src/app/agent/deals/[dealId]/page.tsx:54` | not applicable |
| At risk | `src/app/agent/exporters/[exporterOrgId]/page.tsx:128` | not applicable |
| At risk | `src/app/app/deals/[dealId]/layout.tsx:17` | not applicable |
| At risk | `src/app/app/deals/DealsList.tsx:60` | not applicable |
| At risk | `src/app/app/deals/DealsList.tsx:67` | not applicable |
| Authority rejected | `src/components/execution/FileDocumentForm.tsx:16` | not applicable |
| Awaiting an authorized approver | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:221` | complies |
| Awaiting deal lock | `src/app/agent/deals/[dealId]/documents/page.tsx:31` | does not comply |
| Awaiting exporter approval | `src/components/commercial/ProposalHistory.tsx:23` | complies |
| Awaiting your approval | `src/components/commercial/ProposalHistory.tsx:13` | complies |
| blocked | `src/app/app/overview/modules.tsx:404` | not applicable |
| Blocked | `src/app/agent/deals/[dealId]/document-data/page.tsx:102` | not applicable |
| Blocked | `src/app/agent/deals/[dealId]/page.tsx:47` | not applicable |
| Blocked | `src/app/agent/deals/[dealId]/page.tsx:55` | not applicable |
| Blocked | `src/app/agent/exporters/[exporterOrgId]/page.tsx:126` | not applicable |
| Blocked | `src/app/app/deals/[dealId]/layout.tsx:18` | not applicable |
| Blocked | `src/app/app/deals/DealsList.tsx:61` | not applicable |
| Blocked | `src/app/app/deals/DealsList.tsx:68` | not applicable |
| Blocked — this is halting the shipment | `src/components/shipment/RaiseIssueButton.tsx:67` | not applicable |
| Blocked / at risk | `src/app/agent/deals/page.tsx:34` | not applicable |
| Blocked by “ | `src/components/execution/GatedAction.tsx:45` | not applicable |
| Blocked deals | `src/app/ops/exceptions/page.tsx:14` | not applicable |
| Blocked deals | `src/app/ops/page.tsx:55` | not applicable |
| Blocked dependency | `src/app/app/deals/[dealId]/tasks/page.tsx:120` | not applicable |
| Blocked, overdue, rejected and exception work across every domain, centralized in one queue. | `src/app/ops/exceptions/page.tsx:150` | not applicable |
| Blocked: | `src/app/agent/exporters/[exporterOrgId]/page.tsx:409` | not applicable |
| Blocked: | `src/app/app/tasks/TasksList.tsx:91` | not applicable |
| cancelled | `src/app/agent/deals/page.tsx:89` | not applicable |
| cancelled | `src/app/app/markets/DemandDiscovery.tsx:308` | not applicable |
| cancelled | `src/app/app/overview/modules.tsx:209` | not applicable |
| cancelled | `src/app/ops/assignments/page.tsx:47` | not applicable |
| cancelled | `src/app/ops/page.tsx:44` | not applicable |
| Cancelled | `src/app/app/deals/DealsList.tsx:53` | not applicable |
| Cancelled | `src/app/app/tasks/TasksList.tsx:33` | not applicable |
| closed | `src/app/agent/exporters/[exporterOrgId]/page.tsx:424` | not applicable |
| closed | `src/app/app/deals/[dealId]/support/page.tsx:51` | not applicable |
| closed | `src/app/app/deals/[dealId]/support/page.tsx:52` | not applicable |
| closed | `src/app/ops/disputes/page.tsx:48` | not applicable |
| closed | `src/app/ops/page.tsx:40` | not applicable |
| Closed | `src/app/agent/deals/page.tsx:37` | not applicable |
| Closed | `src/app/app/deals/[dealId]/support/page.tsx:165` | not applicable |
| Closed | `src/app/ops/disputes/[disputeId]/page.tsx:124` | not applicable |
| Closed — lost | `src/app/app/deals/DealsList.tsx:52` | not applicable |
| Closed — won | `src/app/app/deals/DealsList.tsx:51` | not applicable |
| Commitment fee paid | `src/app/app/billing/CommitmentFeeCard.tsx:82` | not applicable |
| COMPLETE | `src/components/ops/SanctionsSourceHealthPanel.tsx:31` | not applicable |
| COMPLETE · refresh failed | `src/components/ops/SanctionsSourceHealthPanel.tsx:30` | not applicable |
| Complete the assessment to receive your score and plan. | `src/app/app/readiness/ReadinessForm.tsx:29` | not applicable |
| Complete your readiness assessment to generate a checklist. | `src/app/app/readiness/tasks/page.tsx:174` | not applicable |
| completed | `src/app/app/markets/DemandDiscovery.tsx:308` | not applicable |
| Completed | `src/app/agent/deals/[dealId]/page.tsx:69` | not applicable |
| Completed | `src/app/agent/tasks/page.tsx:33` | not applicable |
| Completed | `src/app/app/deals/[dealId]/tasks/page.tsx:157` | not applicable |
| Completed | `src/app/ops/execution/page.tsx:31` | not applicable |
| Completed | `src/app/ops/execution/page.tsx:229` | not applicable |
| Completed ( | `src/app/app/deals/[dealId]/tasks/page.tsx:151` | not applicable |
| Confirm paid | `src/components/ops/PayoutActions.tsx:65` | not applicable |
| Confirm reviewed code | `src/components/agent/ProductClassificationForm.tsx:8` | not applicable |
| converted | `src/app/agent/exporters/[exporterOrgId]/page.tsx:94` | not applicable |
| Converted — | `src/app/agent/leads/[buyerLeadId]/page.tsx:105` | not applicable |
| Converted to a deal. | `src/app/app/buyers/[buyerId]/page.tsx:217` | not applicable |
| Converted to deal | `src/app/agent/outreach/OutreachPipeline.tsx:47` | not applicable |
| Could not complete that action. Please retry. | `src/app/app/deals/[dealId]/commercial/ApprovalPanel.tsx:46` | not applicable |
| Could not complete that action. Please retry. | `src/components/documents/DocumentApprovalPanel.tsx:45` | not applicable |
| Could not complete that action. Please retry. | `src/components/ops-disputes/DisputeActions.tsx:52` | not applicable |
| Could not complete that. Please retry. | `src/components/ops/PayoutActions.tsx:40` | not applicable |
| Could not mark this complete. Please retry. | `src/components/enablement/SelfCompleteButton.tsx:23` | not applicable |
| Could not open a case. Please retry. | `src/components/support/CreateCaseForm.tsx:65` | not applicable |
| Could not open a dispute. Please retry. | `src/components/payment/OpenDisputeButton.tsx:31` | not applicable |
| Could not send that message. It has been kept as a draft — please retry. | `src/components/support/SendMessageForm.tsx:28` | not applicable |
| Could not send that message. Your draft is kept below — please retry. | `src/components/enablement/AskAgentButton.tsx:25` | not applicable |
| Created when the deal is locked. The checklist comes from the document registry, not from this page. | `src/app/agent/deals/[dealId]/documents/GenerateDocumentPanel.tsx:59` | not applicable |
| Deal at risk | `src/app/app/overview/modules.tsx:417` | not applicable |
| Deal locked | `src/app/app/deals/DealsList.tsx:48` | not applicable |
| Deal locked | `src/app/app/overview/modules.tsx:321` | not applicable |
| Deal locked | `src/app/ops/page.tsx:12` | not applicable |
| disqualified | `src/app/agent/exporters/[exporterOrgId]/page.tsx:94` | not applicable |
| Disqualified | `src/app/agent/outreach/OutreachPipeline.tsx:46` | not applicable |
| Disqualified: | `src/components/agent/BuyerDiscoveryControl.tsx:67` | not applicable |
| Document, shipment and payment work for active deals. | `src/app/agent/page.tsx:45` | not applicable |
| Documents cleared and waiting on CHA/external action. | `src/app/ops/execution/page.tsx:100` | complies |
| Documents generate from the deal snapshot, which is created when the deal is locked. There is nothing to show until then. | `src/app/app/deals/[dealId]/documents/page.tsx:55` | not applicable |
| Documents rejected | `src/app/ops/exceptions/page.tsx:16` | not applicable |
| Documents rejected | `src/app/ops/page.tsx:56` | not applicable |
| Draft | `src/components/commercial/ProposalHistory.tsx:12` | not applicable |
| Draft invoice | `src/app/agent/deals/[dealId]/documents/page.tsx:84` | not applicable |
| Due and overdue buyer payments across your deals. | `src/app/app/more/page.tsx:40` | not applicable |
| Due soon | `src/app/agent/deals/[dealId]/page.tsx:60` | not applicable |
| Due soon | `src/app/agent/tasks/page.tsx:30` | not applicable |
| Due soon | `src/app/agent/tasks/page.tsx:38` | not applicable |
| Due soon | `src/app/app/deals/[dealId]/page.tsx:15` | not applicable |
| Due soon | `src/app/app/deals/[dealId]/tasks/page.tsx:28` | not applicable |
| Due soon | `src/app/app/deals/DealsList.tsx:73` | not applicable |
| Due soon | `src/app/app/overview/modules.tsx:158` | not applicable |
| Due soon | `src/app/app/tasks/TasksList.tsx:38` | not applicable |
| Editing draft | `src/app/agent/deals/[dealId]/commercial/TermsEditor.tsx:137` | not applicable |
| escalated | `src/app/ops/assignments/page.tsx:47` | not applicable |
| escalated | `src/app/ops/page.tsx:44` | not applicable |
| Escalated | `src/app/agent/deals/[dealId]/page.tsx:62` | not applicable |
| Escalated | `src/app/agent/tasks/page.tsx:32` | not applicable |
| Escalated | `src/app/agent/tasks/page.tsx:40` | not applicable |
| Escalated | `src/app/app/deals/[dealId]/page.tsx:17` | not applicable |
| Escalated | `src/app/app/deals/[dealId]/tasks/page.tsx:30` | not applicable |
| Escalated | `src/app/app/deals/DealsList.tsx:75` | not applicable |
| Escalated | `src/app/app/overview/modules.tsx:154` | not applicable |
| Escalated | `src/app/app/tasks/TasksList.tsx:40` | not applicable |
| Escalated, overdue, due soon and blocked work. | `src/app/agent/page.tsx:40` | not applicable |
| expired | `src/app/app/readiness/ReadinessForm.tsx:24` | not applicable |
| Expired | `src/app/app/readiness/ReadinessForm.tsx:24` | not applicable |
| failed | `src/app/app/markets/DemandDiscovery.tsx:308` | not applicable |
| filed | `src/app/ops/execution/page.tsx:116` | not applicable |
| Filed | `src/app/agent/deals/[dealId]/page.tsx:257` | not applicable |
| Filed | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:136` | not applicable |
| Filed | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:212` | not applicable |
| Filing complete. | `src/components/execution/FileDocumentForm.tsx:40` | not applicable |
| Generated | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:233` | not applicable |
| Generated | `src/app/agent/deals/[dealId]/documents/page.tsx:211` | not applicable |
| Generated | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:109` | not applicable |
| Generated | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:124` | not applicable |
| Generated | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:192` | not applicable |
| Generated | `src/components/agent/DemandDiscoveryControl.tsx:119` | not applicable |
| Generated, reviewed and filed documents across your deals. | `src/app/app/more/page.tsx:38` | not applicable |
| Healthy portfolio | `src/app/ops/page.tsx:65` | not applicable |
| Healthy portfolio — no active risks or shipment exceptions. New and aging work will appear here. | `src/app/ops/page.tsx:75` | not applicable |
| High-risk: this becomes the active fee policy for every deal locked from now on. | `src/components/ops/FeePolicyForm.tsx:81` | not applicable |
| High-risk: this creates a new active version immediately. | `src/components/ops/ConfigVersionForm.tsx:55` | not applicable |
| I've paid — unlock my account | `src/app/app/billing/CommitmentFeeCard.tsx:112` | not applicable |
| Immutable — closed cases are never edited. | `src/app/app/deals/[dealId]/support/page.tsx:154` | not applicable |
| In progress | `src/app/app/readiness/ReadinessForm.tsx:24` | not applicable |
| In progress | `src/app/app/tasks/TasksList.tsx:30` | not applicable |
| in progress now | `src/components/ops/SanctionsSourceHealthPanel.tsx:102` | not applicable |
| is ready for approval, but your account isn't authorized to approve commercial terms. The account owner needs to approve it. | `src/app/app/deals/[dealId]/commercial/page.tsx:95` | not applicable |
| Lead created — pending agent assignment | `src/app/app/buyers/BuyersExplorer.tsx:383` | complies |
| Linked to the case already open for this payment. | `src/components/payment/OpenDisputeButton.tsx:45` | not applicable |
| Linked to the case already open for this shipment. | `src/components/shipment/RaiseIssueButton.tsx:50` | not applicable |
| Linked to the Ops case already open for this deal. | `src/components/execution/EscalateBlockerButton.tsx:51` | not applicable |
| locked | `src/app/ops/audit/page.tsx:117` | not applicable |
| Locked | `src/app/ops/finance/page.tsx:92` | not applicable |
| Mark complete | `src/components/enablement/SelfCompleteButton.tsx:32` | not applicable |
| Mark complete | `src/components/execution/HandoffStatusForm.tsx:17` | not applicable |
| Mark filed | `src/components/execution/FileDocumentForm.tsx:13` | not applicable |
| Mark filed | `src/components/ops/RecordFilingForm.tsx:16` | not applicable |
| Mark paid | `src/components/ops/PayoutActions.tsx:142` | not applicable |
| Mark ready to file | `src/components/execution/FileDocumentForm.tsx:11` | not applicable |
| Mark ready to file | `src/components/execution/FileDocumentForm.tsx:12` | not applicable |
| Mark ready to file | `src/components/ops/RecordFilingForm.tsx:15` | not applicable |
| Mark rejected | `src/components/ops/RecordFilingForm.tsx:18` | not applicable |
| Mark reviewed | `src/app/agent/deals/[dealId]/documents/[documentId]/ReviewPanel.tsx:87` | not applicable |
| Mark sent | `src/components/execution/HandoffStatusForm.tsx:11` | not applicable |
| Milestone tracking and exceptions across active shipments. | `src/app/app/more/page.tsx:39` | not applicable |
| Most recent attempt failed at the | `src/components/ops/SanctionsSourceHealthPanel.tsx:80` | not applicable |
| My open | `src/app/agent/tasks/page.tsx:28` | not applicable |
| No active | `src/components/execution/AssignPartnerForm.tsx:57` | not applicable |
| No active agents | `src/app/ops/assignments/page.tsx:117` | not applicable |
| No active agents are available for assignment. | `src/app/ops/assignments/page.tsx:189` | not applicable |
| No active agents are available for assignment. | `src/app/ops/page.tsx:81` | not applicable |
| No active assignments yet. | `src/app/ops/assignments/page.tsx:137` | not applicable |
| No active deal | `src/app/agent/exporters/page.tsx:54` | not applicable |
| No active exceptions in this view. New and aging exceptions will be listed here with type, owner, reason and age. | `src/app/ops/exceptions/page.tsx:182` | not applicable |
| No active execution tasks are assigned to you. | `src/app/agent/page.tsx:45` | not applicable |
| No active shipments. | `src/app/ops/execution/page.tsx:170` | not applicable |
| No active snapshot | `src/components/ops/SanctionsSourceHealthPanel.tsx:27` | not applicable |
| No assigned exporters or deals are at risk. | `src/app/agent/page.tsx:41` | not applicable |
| No deals have been locked yet, so there are no fee snapshots to show. | `src/app/ops/finance/page.tsx:82` | not applicable |
| No file has been generated for this version. | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:104` | not applicable |
| No link, no email sent. Converts an existing ClearTrade account directly, or pre-authorizes an email that hasn't signed up yet. | `src/app/ops/agents/page.tsx:62` | not applicable |
| No newly active exporter is currently unassigned. | `src/app/ops/assignments/page.tsx:92` | not applicable |
| No open cases. If something needs attention beyond a message, open a case above. | `src/app/app/deals/[dealId]/support/page.tsx:106` | not applicable |
| No open disputes. Every case has been resolved or closed. | `src/app/ops/disputes/page.tsx:88` | not applicable |
| No open escalations. Escalated tasks will be listed here with their owner and context. | `src/app/ops/page.tsx:82` | not applicable |
| No open exceptions across your assigned exporters. Nothing needs you here. | `src/app/agent/escalations/page.tsx:86` | not applicable |
| No open readiness gaps on the current assessment. | `src/app/agent/exporters/[exporterOrgId]/page.tsx:343` | not applicable |
| No open task | `src/app/agent/deals/page.tsx:172` | not applicable |
| No payments are currently overdue. | `src/app/ops/finance/page.tsx:139` | not applicable |
| No rejected or failed documents. | `src/app/ops/execution/page.tsx:129` | not applicable |
| Not started | `src/app/app/readiness/ReadinessForm.tsx:24` | not applicable |
| Not started | `src/app/app/tasks/TasksList.tsx:29` | not applicable |
| Not yet locked — terms may still change during negotiation. | `src/app/app/deals/[dealId]/page.tsx:67` | not applicable |
| Not yet sent | `src/components/commercial/ProposalHistory.tsx:59` | not applicable |
| Nothing has been sent to the exporter yet. | `src/app/agent/deals/[dealId]/commercial/page.tsx:166` | not applicable |
| Nothing is blocked. | `src/app/app/deals/[dealId]/tasks/page.tsx:123` | not applicable |
| Nothing is currently waiting on your agent for this deal. | `src/app/app/deals/[dealId]/page.tsx:158` | complies |
| Nothing pending on ClearTrade's side. | `src/app/app/deals/[dealId]/tasks/page.tsx:139` | complies |
| Nothing this document reads has changed since it was generated. | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:153` | not applicable |
| Nothing waiting on you right now. | `src/app/app/overview/modules.tsx:131` | complies |
| Nothing waiting to file. | `src/app/ops/execution/page.tsx:102` | does not comply |
| On time | `src/app/agent/deals/[dealId]/page.tsx:59` | not applicable |
| On time | `src/app/agent/tasks/page.tsx:37` | not applicable |
| On time | `src/app/app/deals/[dealId]/page.tsx:14` | not applicable |
| On time | `src/app/app/deals/[dealId]/tasks/page.tsx:27` | not applicable |
| On time | `src/app/app/deals/DealsList.tsx:72` | not applicable |
| On time | `src/app/app/overview/modules.tsx:159` | not applicable |
| On time | `src/app/app/tasks/TasksList.tsx:37` | not applicable |
| One checklist for becoming export-ready — requirements ClearTrade can guide, evidence you upload, and items your agent owns. | `src/app/app/readiness/tasks/page.tsx:126` | not applicable |
| Open | `src/app/app/deals/[dealId]/documents/page.tsx:145` | not applicable |
| Open | `src/app/app/tasks/TasksList.tsx:181` | not applicable |
| Open (not done) | `src/app/app/tasks/TasksList.tsx:28` | not applicable |
| Open a case | `src/components/support/CreateCaseForm.tsx:74` | not applicable |
| Open case | `src/components/execution/EscalateBlockerButton.tsx:53` | not applicable |
| Open cases | `src/app/agent/deals/[dealId]/page.tsx:447` | not applicable |
| Open cases | `src/app/app/deals/[dealId]/support/page.tsx:92` | not applicable |
| Open cases | `src/app/ops/disputes/page.tsx:70` | not applicable |
| open deal | `src/app/ops/execution/page.tsx:178` | not applicable |
| Open disputes | `src/app/ops/page.tsx:58` | not applicable |
| Open exceptions across your assigned exporters, worst first. Each row links to the record that owns it — resolve it there, not here. | `src/app/agent/escalations/page.tsx:62` | not applicable |
| Open finance case | `src/app/ops/finance/page.tsx:267` | not applicable |
| Open in Outreach CRM | `src/app/agent/exporters/[exporterOrgId]/page.tsx:352` | not applicable |
| Open items awaiting an Ops decision. | `src/app/ops/page.tsx:82` | complies |
| Open payment dispute | `src/components/payment/OpenDisputeButton.tsx:41` | not applicable |
| Open tasks | `src/app/agent/exporters/page.tsx:168` | not applicable |
| Open the Agent workspace | `src/app/(auth)/accept-staff-invitation/page.tsx:148` | not applicable |
| open the deal ( | `src/app/agent/leads/[buyerLeadId]/page.tsx:107` | not applicable |
| open the deal workspace | `src/components/agent/ConvertLeadForm.tsx:52` | not applicable |
| Open the Enablement Center | `src/app/app/readiness/ReadinessForm.tsx:29` | not applicable |
| Open the exporter’s payment view | `src/app/agent/deals/[dealId]/page.tsx:432` | not applicable |
| Open the exporter’s shipment view | `src/app/agent/deals/[dealId]/page.tsx:400` | not applicable |
| Open the linked finance case on this deal | `src/app/agent/performance/page.tsx:235` | not applicable |
| Open the relevant workspace to take action. | `src/app/agent/page.tsx:41` | not applicable |
| overdue | `src/app/ops/assignments/page.tsx:47` | not applicable |
| overdue | `src/app/ops/assignments/page.tsx:197` | not applicable |
| overdue | `src/app/ops/page.tsx:44` | not applicable |
| overdue | `src/app/ops/page.tsx:81` | not applicable |
| Overdue | `src/app/agent/deals/[dealId]/page.tsx:61` | not applicable |
| Overdue | `src/app/agent/outreach/OutreachPipeline.tsx:70` | not applicable |
| Overdue | `src/app/agent/tasks/page.tsx:29` | not applicable |
| Overdue | `src/app/agent/tasks/page.tsx:39` | not applicable |
| Overdue | `src/app/app/deals/[dealId]/page.tsx:16` | not applicable |
| Overdue | `src/app/app/deals/[dealId]/tasks/page.tsx:29` | not applicable |
| Overdue | `src/app/app/deals/DealsList.tsx:74` | not applicable |
| Overdue | `src/app/app/overview/modules.tsx:156` | not applicable |
| Overdue | `src/app/app/tasks/TasksList.tsx:39` | not applicable |
| Overdue | `src/components/payment/PaymentStatusForm.tsx:18` | not applicable |
| overdue from the buyer. | `src/app/app/deals/[dealId]/payment/page.tsx:80` | not applicable |
| Overdue only | `src/app/ops/finance/page.tsx:132` | not applicable |
| Overdue payments | `src/app/ops/page.tsx:57` | not applicable |
| Overdue SLAs | `src/app/ops/exceptions/page.tsx:15` | not applicable |
| Overdue SLAs | `src/app/ops/page.tsx:55` | not applicable |
| paid | `src/app/app/markets/DemandDiscovery.tsx:97` | not applicable |
| Paid | `src/app/agent/performance/page.tsx:227` | not applicable |
| Paid | `src/components/ui/JourneyProgress.tsx:48` | not applicable |
| Paid plan | `src/app/app/more/page.tsx:66` | not applicable |
| Partially verified | `src/app/agent/leads/[buyerLeadId]/page.tsx:39` | not applicable |
| Partially verified | `src/app/agent/outreach/OutreachPipeline.tsx:57` | not applicable |
| Partially verified | `src/app/app/buyers/BuyersExplorer.tsx:51` | not applicable |
| Partially verified | `src/app/app/buyers/BuyersExplorer.tsx:312` | not applicable |
| Partially verified | `src/components/agent/VerifyContactForm.tsx:47` | not applicable |
| Partner acknowledged | `src/components/execution/HandoffStatusForm.tsx:13` | not applicable |
| partner is in the approved directory. Ops must onboard one before this can be assigned. | `src/components/execution/AssignPartnerForm.tsx:57` | not applicable |
| Partner, deal/shipment, SLA and reference status — assigned from the approved directory only. | `src/app/ops/execution/page.tsx:168` | not applicable |
| Partners come from the approved directory. Every handoff records who sent it, when, and the reference back. | `src/app/agent/deals/[dealId]/page.tsx:294` | not applicable |
| Payment realized | `src/app/ops/page.tsx:13` | not applicable |
| pending | `src/app/app/readiness/ReadinessForm.tsx:23` | does not comply |
| Pending | `src/app/agent/deals/[dealId]/page.tsx:66` | does not comply |
| Pending | `src/app/ops/execution/page.tsx:28` | does not comply |
| Pending direct access grants | `src/app/ops/agents/page.tsx:101` | does not comply |
| Pending invitation links | `src/app/ops/agents/page.tsx:70` | does not comply |
| Pending invitations | `src/components/notifications/TeamPanel.tsx:119` | does not comply |
| Pre-authorize this email as Agent? No password is created and no email is sent — the moment this exact, verified email signs in, ClearTrade recognizes the grant and provisions the account as Agent instead of an ordinary exporter. | `src/components/ops/AddAgentForm.tsx:139` | not applicable |
| Pre-authorized emails with no account yet. Claimed automatically at their next verified sign-in. | `src/app/ops/agents/page.tsx:103` | not applicable |
| Qualified | `src/app/agent/outreach/OutreachPipeline.tsx:44` | not applicable |
| Quote requested. No insurance partner is currently active, so this will need manual follow-up. | `src/components/payment/InsuranceQuoteButton.tsx:26` | not applicable |
| Readiness blocked | `src/app/app/overview/modules.tsx:417` | not applicable |
| ready | `src/app/app/readiness/ReadinessForm.tsx:24` | not applicable |
| ready | `src/app/ops/execution/page.tsx:155` | not applicable |
| ready | `src/app/ops/page.tsx:11` | not applicable |
| ready | `src/components/ui/JourneyProgress.tsx:42` | not applicable |
| Ready | `src/app/agent/deals/[dealId]/document-data/page.tsx:102` | not applicable |
| Ready | `src/app/agent/deals/[dealId]/page.tsx:46` | not applicable |
| Ready | `src/app/ops/page.tsx:11` | not applicable |
| Ready to continue | `src/app/app/readiness/ReadinessForm.tsx:29` | not applicable |
| Ready to file ( | `src/app/ops/execution/page.tsx:99` | not applicable |
| Ready to lock | `src/app/agent/deals/[dealId]/commercial/LockPanel.tsx:70` | not applicable |
| Ready to re-file | `src/components/execution/FileDocumentForm.tsx:19` | not applicable |
| Rejected | `src/app/ops/execution/page.tsx:32` | not applicable |
| Rejected | `src/app/ops/execution/page.tsx:229` | not applicable |
| Rejected / missing ( | `src/app/ops/execution/page.tsx:126` | not applicable |
| resolved | `src/app/agent/exporters/[exporterOrgId]/page.tsx:424` | not applicable |
| resolved | `src/app/app/deals/[dealId]/support/page.tsx:51` | not applicable |
| resolved | `src/app/app/deals/[dealId]/support/page.tsx:52` | not applicable |
| resolved | `src/app/ops/disputes/page.tsx:48` | not applicable |
| resolved | `src/app/ops/page.tsx:40` | not applicable |
| Resolved history | `src/app/app/deals/[dealId]/support/page.tsx:153` | not applicable |
| Reviewed | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:128` | not applicable |
| Save draft | `src/app/agent/deals/[dealId]/commercial/TermsEditor.tsx:245` | not applicable |
| Save draft | `src/app/app/readiness/ReadinessForm.tsx:29` | not applicable |
| Screening BLOCKED | `src/components/ops/SanctionsSourceHealthPanel.tsx:21` | not applicable |
| Screening READY | `src/components/ops/SanctionsSourceHealthPanel.tsx:19` | not applicable |
| Search and shortlist verified buyers. | `src/app/app/more/page.tsx:23` | not applicable |
| Sent | `src/app/agent/deals/[dealId]/page.tsx:67` | not applicable |
| Sent | `src/app/ops/execution/page.tsx:29` | not applicable |
| Sent | `src/app/ops/execution/page.tsx:201` | not applicable |
| Sent | `src/app/ops/execution/page.tsx:229` | not applicable |
| Sent — check Messages for a reply. | `src/components/enablement/AskAgentButton.tsx:37` | not applicable |
| Serving previous COMPLETE snapshot — the latest refresh failed at the | `src/components/ops/SanctionsSourceHealthPanel.tsx:76` | not applicable |
| Show active only | `src/components/agent/BuyerDiscoveryControl.tsx:299` | not applicable |
| Show active only | `src/components/agent/DemandDiscoveryControl.tsx:221` | not applicable |
| Shown once. Store or send this link now — it cannot be recovered. Anyone who opens it can claim it, so share it only with the intended person. If it is lost or sent to the wrong person, revoke it and generate a new one. | `src/components/ops/GenerateInvitationLinkForm.tsx:73` | not applicable |
| Sources: overdue/escalated or blocked tasks, open disputes, shipments on watch or blocked, and sanctions cases needing review. Disputes not attached to a deal are not listed — they carry no tenant of their own. | `src/app/agent/escalations/page.tsx:144` | not applicable |
| Superseded | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:67` | not applicable |
| Superseded | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:230` | not applicable |
| Superseded | `src/components/commercial/ProposalHistory.tsx:16` | not applicable |
| Superseded and expired decisions stay listed. Each shows what the model said at that moment, which the current assessment can no longer tell you. | `src/components/agent/BuyerDiscoveryControl.tsx:369` | not applicable |
| Superseded version | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:204` | not applicable |
| Task escalated | `src/app/ops/exceptions/page.tsx:70` | not applicable |
| Task overdue | `src/app/ops/exceptions/page.tsx:70` | not applicable |
| The approved CHA/freight/insurance/inspection/bank directory — assignment and performance are surfaced in | `src/app/ops/audit/page.tsx:189` | not applicable |
| The commitment fee applies once you&rsquo;ve registered — it&rsquo;s what unlocks the paid plan from there. | `src/app/app/billing/CommitmentFeeCard.tsx:65` | not applicable |
| The current version was already sent, so saving creates a new version instead of editing it. | `src/app/agent/deals/[dealId]/commercial/TermsEditor.tsx:144` | not applicable |
| The deal snapshot is frozen and every document generates from it. Changing a locked term needs an amendment, which your agent raises and you approve — the original version stays on record either way. | `src/app/app/deals/[dealId]/commercial/page.tsx:84` | not applicable |
| These block your readiness score until resolved. | `src/app/app/readiness/tasks/page.tsx:150` | not applicable |
| These terms are locked | `src/app/app/deals/[dealId]/commercial/page.tsx:82` | not applicable |
| These terms are locked by the deal snapshot. Changing them requires an amendment, which writes a new snapshot version rather than editing the frozen one. | `src/app/agent/deals/[dealId]/commercial/TermsEditor.tsx:125` | not applicable |
| This account cannot be converted | `src/app/(auth)/accept-staff-invitation/page.tsx:157` | not applicable |
| This buyer is not fully verified. We recommend agent verification before outreach. | `src/app/app/buyers/[buyerId]/page.tsx:97` | not applicable |
| This deal is already locked or past locking. | `src/app/agent/deals/[dealId]/commercial/LockPanel.tsx:120` | not applicable |
| This deal is at risk | `src/app/app/deals/[dealId]/layout.tsx:92` | not applicable |
| This deal is blocked | `src/app/app/deals/[dealId]/layout.tsx:92` | not applicable |
| This document is ready for approval, but your account isn't authorized to approve it. | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:223` | not applicable |
| This draft has not been sent to the exporter yet. | `src/app/agent/deals/[dealId]/commercial/TermsEditor.tsx:143` | not applicable |
| This invitation has expired | `src/app/(auth)/accept-staff-invitation/page.tsx:76` | not applicable |
| This is a historical version and cannot be approved (EXP-13-AC01). Open the current version to act on it. | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:206` | not applicable |
| This lead is disqualified. | `src/app/agent/leads/[buyerLeadId]/page.tsx:216` | not applicable |
| This looked like a case you already have open — linked to it instead of opening a duplicate. | `src/components/support/CreateCaseForm.tsx:77` | not applicable |
| This PDF cannot be approved | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:130` | not applicable |
| This shipment has an open issue. | `src/app/app/deals/[dealId]/shipment/page.tsx:68` | not applicable |
| This version is approved and frozen. Create an amendment to correct it. | `src/app/agent/deals/[dealId]/documents/[documentId]/ReviewPanel.tsx:97` | not applicable |
| This version was filed and is read-only. Reference: | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:214` | not applicable |
| Tracks what the buyer owes and has paid you directly — a visibility record, not funds ClearTrade holds. | `src/app/app/deals/[dealId]/payment/page.tsx:92` | not applicable |
| Unverified | `src/app/agent/leads/[buyerLeadId]/page.tsx:40` | not applicable |
| Unverified | `src/app/agent/outreach/OutreachPipeline.tsx:56` | not applicable |
| Unverified | `src/app/app/buyers/BuyersExplorer.tsx:49` | not applicable |
| Unverified | `src/app/app/buyers/BuyersExplorer.tsx:311` | not applicable |
| Unverified | `src/components/agent/VerifyContactForm.tsx:48` | not applicable |
| Upload failed. | `src/components/documents/UploadReplacement.tsx:28` | not applicable |
| Upload failed. | `src/components/enablement/EvidenceUploadForm.tsx:40` | not applicable |
| Upload failed. | `src/components/payment/PaymentEvidenceUpload.tsx:24` | not applicable |
| Upload failed. | `src/components/shipment/MilestoneEvidenceUpload.tsx:24` | not applicable |
| Verification pending | `src/app/app/readiness/ReadinessForm.tsx:23` | does not comply |
| verified | `src/app/app/readiness/ReadinessForm.tsx:23` | not applicable |
| Verified | `src/app/agent/leads/[buyerLeadId]/page.tsx:38` | not applicable |
| Verified | `src/app/agent/outreach/OutreachPipeline.tsx:58` | not applicable |
| Verified | `src/app/app/buyers/BuyersExplorer.tsx:56` | not applicable |
| Verified | `src/app/app/buyers/BuyersExplorer.tsx:313` | not applicable |
| Verified | `src/app/app/readiness/ReadinessForm.tsx:23` | not applicable |
| Verified | `src/components/agent/VerifyContactForm.tsx:46` | not applicable |
| Verified contacts need a free account | `src/app/app/buyers/[buyerId]/page.tsx:172` | not applicable |
| Verified from | `src/app/app/readiness/tasks/page.tsx:115` | not applicable |
| Waiting | `src/app/agent/deals/[dealId]/page.tsx:48` | does not comply |
| Waiting | `src/app/agent/tasks/page.tsx:31` | does not comply |
| Waiting | `src/app/app/tasks/TasksList.tsx:31` | does not comply |
| Waiting | `src/components/execution/TaskActions.tsx:17` | does not comply |
| Waiting | `src/components/execution/TaskActions.tsx:22` | does not comply |
| Waiting on | `src/app/app/deals/[dealId]/support/page.tsx:131` | does not comply |
| Waiting on | `src/app/app/deals/[dealId]/tasks/page.tsx:87` | does not comply |
| Waiting on | `src/app/ops/disputes/[disputeId]/page.tsx:112` | does not comply |
| Waiting on | `src/components/ops-disputes/DisputeActions.tsx:121` | does not comply |
| Waiting on an authorized approver | `src/app/app/deals/[dealId]/commercial/page.tsx:93` | complies |
| Waiting on ClearTrade | `src/app/app/deals/[dealId]/page.tsx:154` | complies |
| Waiting on ClearTrade | `src/app/app/deals/[dealId]/tasks/page.tsx:134` | complies |
| Waiting on external party | `src/components/ops-disputes/DisputeActions.tsx:72` | does not comply |
| Waiting on you: | `src/app/app/readiness/tasks/page.tsx:98` | complies |
| Waiting on: | `src/app/agent/deals/[dealId]/page.tsx:106` | does not comply |
| was generated. That does not make this version incorrect — it was generated from what was true at the time. Create an amendment if the shipment needs a corrected document. | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:159` | not applicable |
| We could not complete that request. Please try again. If this continues, share the reference ID below with ClearTrade support. | `src/app/error.tsx:48` | not applicable |
| What do you make, and what makes it export-ready? | `src/app/app/readiness/ReadinessForm.tsx:21` | not applicable |
| What is it waiting on? | `src/components/execution/TaskActions.tsx:70` | does not comply |
| What is it waiting on? | `src/components/execution/TaskActions.tsx:71` | does not comply |
| What you sent them | `src/components/execution/AssignPartnerForm.tsx:85` | not applicable |
| Work only you can complete. | `src/app/app/deals/[dealId]/tasks/page.tsx:107` | not applicable |
| Your agent hasn't sent commercial terms for this deal yet. When they do, you'll get a task and can approve or request changes here. | `src/app/app/deals/[dealId]/commercial/page.tsx:39` | not applicable |
| Your evidence is waiting on review — you'll see the outcome here. | `src/components/enablement/EvidenceUploadForm.tsx:69` | complies |

### Empty strings (141 located occurrences)

| Verbatim string | Location | Owner compliance |
|---|---|---|
| A commission record is created once one of your deals is locked. It becomes eligible when the buyer payment realizes and no dispute is open on the deal. | `src/app/agent/performance/page.tsx:143` | not applicable |
| No active | `src/components/execution/AssignPartnerForm.tsx:57` | not applicable |
| No active agents | `src/app/ops/assignments/page.tsx:117` | not applicable |
| No active agents are available for assignment. | `src/app/ops/assignments/page.tsx:189` | not applicable |
| No active agents are available for assignment. | `src/app/ops/page.tsx:81` | not applicable |
| No active assignments yet. | `src/app/ops/assignments/page.tsx:137` | not applicable |
| No active deal | `src/app/agent/exporters/page.tsx:54` | not applicable |
| No active exceptions in this view. New and aging exceptions will be listed here with type, owner, reason and age. | `src/app/ops/exceptions/page.tsx:182` | not applicable |
| No active execution tasks are assigned to you. | `src/app/agent/page.tsx:45` | not applicable |
| No active shipments. | `src/app/ops/execution/page.tsx:170` | not applicable |
| No active snapshot | `src/components/ops/SanctionsSourceHealthPanel.tsx:27` | not applicable |
| No activity logged yet. | `src/app/agent/leads/[buyerLeadId]/page.tsx:236` | not applicable |
| No activity recorded | `src/app/app/buyers/BuyersExplorer.tsx:227` | not applicable |
| No activity summary on record for this buyer. | `src/app/app/buyers/[buyerId]/page.tsx:139` | not applicable |
| No agent assigned yet. Ops assigns one shortly after you upgrade. | `src/app/app/overview/modules.tsx:385` | not applicable |
| No agent decision | `src/components/agent/BuyerDiscoveryControl.tsx:92` | not applicable |
| No agent decision | `src/components/agent/DemandDiscoveryControl.tsx:50` | not applicable |
| No agents yet. Invite one above. | `src/app/ops/agents/page.tsx:138` | not applicable |
| No assigned exporters or deals are at risk. | `src/app/agent/page.tsx:41` | not applicable |
| No assignments have been recorded yet. | `src/app/ops/assignments/page.tsx:210` | not applicable |
| No assignments yet. | `src/app/ops/agents/[agentId]/page.tsx:90` | not applicable |
| No audit events | `src/app/ops/audit/AuditSearch.tsx:164` | not applicable |
| No buyer position recorded yet. | `src/app/agent/deals/[dealId]/commercial/page.tsx:189` | not applicable |
| No BuyerFit assessments for this exporter yet. Buyers appear here once buyer intelligence has run. | `src/components/agent/BuyerDiscoveryControl.tsx:282` | not applicable |
| No buyers match these filters | `src/app/app/buyers/BuyersExplorer.tsx:344` | not applicable |
| No buyers yet | `src/app/app/buyers/BuyersExplorer.tsx:340` | not applicable |
| No changes | `src/components/commercial/ProposalDiff.tsx:29` | not applicable |
| No ClearTrade account exists yet for | `src/components/ops/AddAgentForm.tsx:137` | not applicable |
| No commercial proposals have been prepared for this deal yet. | `src/components/commercial/ProposalHistory.tsx:41` | not applicable |
| No contact logged | `src/app/agent/outreach/OutreachPipeline.tsx:153` | not applicable |
| No contacts listed for this buyer. | `src/app/app/buyers/[buyerId]/page.tsx:193` | not applicable |
| No contacts on record. | `src/app/agent/leads/[buyerLeadId]/page.tsx:148` | not applicable |
| No DB row yet — running on the seed default. | `src/app/ops/audit/page.tsx:160` | not applicable |
| No deals have been locked yet, so there are no fee snapshots to show. | `src/app/ops/finance/page.tsx:82` | not applicable |
| No deals in motion yet. | `src/app/app/overview/modules.tsx:310` | not applicable |
| No deals match these filters | `src/app/app/deals/DealsList.tsx:379` | not applicable |
| No deals match this filter across your assigned exporters. | `src/app/agent/deals/page.tsx:126` | not applicable |
| No deals yet | `src/app/app/deals/DealsList.tsx:370` | not applicable |
| No decisions recorded yet. | `src/components/agent/BuyerDiscoveryControl.tsx:221` | not applicable |
| No decisions recorded yet. | `src/components/agent/DemandDiscoveryControl.tsx:146` | not applicable |
| No Demand Discovery run yet for this exporter. Scores appear here once a run completes. | `src/components/agent/DemandDiscoveryControl.tsx:194` | not applicable |
| No discovery runs yet. | `src/app/agent/exporters/[exporterOrgId]/page.tsx:315` | not applicable |
| No disputed payments. | `src/app/ops/finance/page.tsx:289` | not applicable |
| No disputes have been raised yet. | `src/app/ops/disputes/page.tsx:88` | not applicable |
| No documents yet | `src/app/app/deals/[dealId]/documents/page.tsx:53` | not applicable |
| no due date | `src/app/agent/deals/page.tsx:168` | not applicable |
| No due date | `src/app/agent/escalations/page.tsx:133` | not applicable |
| No due date | `src/app/app/deals/DealsList.tsx:84` | not applicable |
| No due date | `src/components/ui/NextActionCard.tsx:77` | not applicable |
| No due date set | `src/app/agent/page.tsx:19` | not applicable |
| No due date set | `src/app/agent/tasks/page.tsx:51` | not applicable |
| No due date set | `src/app/app/deals/[dealId]/page.tsx:26` | not applicable |
| No due date set | `src/app/app/deals/[dealId]/tasks/page.tsx:34` | not applicable |
| No due date set | `src/app/app/tasks/TasksList.tsx:44` | not applicable |
| No enablement tasks yet | `src/app/app/readiness/tasks/page.tsx:172` | not applicable |
| No exporters are assigned to you yet. Ops assigns accounts from the assignments queue. | `src/app/agent/exporters/page.tsx:157` | not applicable |
| no file | `src/app/agent/deals/[dealId]/documents/page.tsx:229` | not applicable |
| No file has been generated for this version. | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:104` | not applicable |
| No flags | `src/app/agent/outreach/OutreachPipeline.tsx:180` | not applicable |
| No flags | `src/app/app/buyers/BuyersExplorer.tsx:189` | not applicable |
| No follow-ups are scheduled for your assigned accounts. | `src/app/agent/page.tsx:44` | not applicable |
| No handoffs recorded yet. | `src/app/agent/deals/[dealId]/page.tsx:330` | not applicable |
| No handoffs recorded yet. | `src/app/ops/execution/page.tsx:196` | not applicable |
| No lead yet | `src/components/agent/BuyerDiscoveryControl.tsx:62` | not applicable |
| No leads at this stage | `src/app/agent/outreach/OutreachPipeline.tsx:253` | not applicable |
| No leads yet | `src/app/agent/outreach/OutreachPipeline.tsx:249` | not applicable |
| No leads yet. | `src/app/agent/exporters/[exporterOrgId]/page.tsx:359` | not applicable |
| No link, no email sent. Converts an existing ClearTrade account directly, or pre-authorizes an email that hasn't signed up yet. | `src/app/ops/agents/page.tsx:62` | not applicable |
| No market selected yet | `src/app/agent/exporters/page.tsx:53` | not applicable |
| No markets matched this search. Try a broader product description. | `src/app/app/markets/DemandDiscovery.tsx:485` | not applicable |
| No markets saved/selected yet. | `src/app/agent/exporters/[exporterOrgId]/page.tsx:324` | not applicable |
| No material events recorded for this deal yet. | `src/app/app/deals/[dealId]/page.tsx:110` | not applicable |
| No messages on this deal yet. | `src/app/ops/disputes/[disputeId]/page.tsx:139` | not applicable |
| No messages yet | `src/app/app/messages/MessagesList.tsx:103` | not applicable |
| No messages yet — send the first one below. | `src/app/app/deals/[dealId]/support/page.tsx:62` | not applicable |
| No negotiating or executing deals. | `src/app/agent/exporters/[exporterOrgId]/page.tsx:379` | not applicable |
| No newly active exporter is currently unassigned. | `src/app/ops/assignments/page.tsx:92` | not applicable |
| No next action set — log an activity below to set one. | `src/app/agent/leads/[buyerLeadId]/page.tsx:202` | not applicable |
| No notifications yet. | `src/components/notifications/NotificationsList.tsx:153` | not applicable |
| No official invoice number issued. Next in the series would be | `src/app/agent/deals/[dealId]/documents/page.tsx:86` | not applicable |
| No open cases. If something needs attention beyond a message, open a case above. | `src/app/app/deals/[dealId]/support/page.tsx:106` | not applicable |
| No open disputes. Every case has been resolved or closed. | `src/app/ops/disputes/page.tsx:88` | not applicable |
| No open escalations. Escalated tasks will be listed here with their owner and context. | `src/app/ops/page.tsx:82` | not applicable |
| No open exceptions across your assigned exporters. Nothing needs you here. | `src/app/agent/escalations/page.tsx:86` | not applicable |
| No open readiness gaps on the current assessment. | `src/app/agent/exporters/[exporterOrgId]/page.tsx:343` | not applicable |
| No open task | `src/app/agent/deals/page.tsx:172` | not applicable |
| No ownership gaps | `src/app/ops/assignments/page.tsx:84` | not applicable |
| No partners onboarded yet. | `src/app/ops/audit/page.tsx:193` | not applicable |
| No payment milestones yet | `src/app/app/deals/[dealId]/payment/page.tsx:59` | not applicable |
| No payment milestones yet. | `src/app/agent/deals/[dealId]/page.tsx:412` | not applicable |
| No payment records exist yet. | `src/app/ops/finance/page.tsx:139` | not applicable |
| No payments are currently overdue. | `src/app/ops/finance/page.tsx:139` | not applicable |
| No payout records yet | `src/app/agent/performance/page.tsx:141` | not applicable |
| No payout records yet. One is created per agent-owned deal from lock onward, and becomes eligible once the configured policy is satisfied. | `src/app/ops/finance/page.tsx:191` | not applicable |
| No products on record. | `src/app/agent/exporters/[exporterOrgId]/page.tsx:255` | not applicable |
| No recorded account events yet. | `src/app/agent/exporters/[exporterOrgId]/page.tsx:453` | not applicable |
| No recorded activity yet. Material changes to this deal will appear here as they happen. | `src/app/app/deals/[dealId]/activity/page.tsx:127` | not applicable |
| No recorded history at HS | `src/app/app/markets/MarketEstimate.tsx:226` | not applicable |
| No recorded import history above our reporting threshold for this HS code yet. | `src/app/app/markets/MarketEstimate.tsx:215` | not applicable |
| No rejected or failed documents. | `src/app/ops/execution/page.tsx:129` | not applicable |
| No response | `src/components/agent/DisqualifyLeadForm.tsx:11` | not applicable |
| No response yet | `src/app/agent/deals/[dealId]/commercial/TermsEditor.tsx:39` | not applicable |
| No results for these filters | `src/components/ui/DataTable.tsx:45` | not applicable |
| No risk flags on record. | `src/app/app/buyers/[buyerId]/page.tsx:107` | not applicable |
| No rows | `src/components/ui/DataTable.tsx:294` | not applicable |
| No searches yet. Run one above and it will be saved here. | `src/app/app/markets/DemandDiscovery.tsx:266` | not applicable |
| No shipment record yet. | `src/app/agent/deals/[dealId]/page.tsx:405` | not applicable |
| No shipment yet | `src/app/app/deals/[dealId]/shipment/page.tsx:46` | not applicable |
| No sourced evidence on record. | `src/app/agent/leads/[buyerLeadId]/page.tsx:132` | not applicable |
| No sourced evidence on record. | `src/app/app/buyers/[buyerId]/page.tsx:152` | not applicable |
| No stage change | `src/components/agent/LogOutreachForm.tsx:87` | not applicable |
| No tasks in this status | `src/app/app/tasks/TasksList.tsx:170` | not applicable |
| No tasks on this deal yet | `src/app/app/deals/[dealId]/tasks/page.tsx:167` | not applicable |
| No tasks yet | `src/app/app/tasks/TasksList.tsx:166` | not applicable |
| No terms to review yet | `src/app/app/deals/[dealId]/commercial/page.tsx:37` | not applicable |
| No unread notifications. | `src/components/notifications/NotificationsList.tsx:153` | not applicable |
| No unresolved possible matches. | `src/app/ops/sanctions/page.tsx:20` | not applicable |
| No urgent work. Keep an eye on your upcoming follow-ups and portfolio health below. | `src/app/agent/page.tsx:40` | not applicable |
| none | `src/app/app/readiness/ReadinessForm.tsx:26` | not applicable |
| None. | `src/app/agent/deals/[dealId]/page.tsx:462` | not applicable |
| None. | `src/app/agent/exporters/[exporterOrgId]/page.tsx:402` | not applicable |
| None. | `src/app/ops/disputes/[disputeId]/page.tsx:159` | not applicable |
| Not documented yet | `src/app/app/readiness/ReadinessForm.tsx:24` | not applicable |
| Not shortlisted. No lead yet. | `src/app/app/buyers/[buyerId]/page.tsx:203` | not applicable |
| Nothing has been allocated yet. Previewing or rendering a document never consumes a number — issuing is this button and nothing else. Next in the series would be | `src/app/agent/deals/[dealId]/document-data/FixCanonicalDataPanel.tsx:244` | not applicable |
| Nothing has been sent to the exporter yet. | `src/app/agent/deals/[dealId]/commercial/page.tsx:166` | not applicable |
| Nothing in this view right now. | `src/app/agent/tasks/page.tsx:136` | not applicable |
| Nothing is blocked. | `src/app/app/deals/[dealId]/tasks/page.tsx:123` | not applicable |
| Nothing is blocking approval. The exporter can approve this version. | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:184` | not applicable |
| Nothing is blocking you from buyer outreach. The items below are recommended improvements, not requirements. | `src/app/app/readiness/tasks/page.tsx:140` | not applicable |
| Nothing is currently waiting on your agent for this deal. | `src/app/app/deals/[dealId]/page.tsx:158` | complies |
| Nothing needs your action right now. | `src/app/app/deals/[dealId]/tasks/page.tsx:109` | not applicable |
| Nothing outstanding | `src/app/agent/exporters/page.tsx:202` | not applicable |
| Nothing outstanding | `src/app/app/deals/DealsList.tsx:218` | not applicable |
| Nothing outstanding on your side for this deal right now. | `src/app/app/deals/[dealId]/page.tsx:130` | not applicable |
| Nothing outstanding. | `src/app/agent/deals/[dealId]/document-data/page.tsx:110` | not applicable |
| Nothing pending on ClearTrade's side. | `src/app/app/deals/[dealId]/tasks/page.tsx:139` | complies |
| Nothing this document reads has changed since it was generated. | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:153` | not applicable |
| Nothing waiting on you right now. | `src/app/app/overview/modules.tsx:131` | complies |
| Nothing waiting to file. | `src/app/ops/execution/page.tsx:102` | does not comply |
| Quote requested. No insurance partner is currently active, so this will need manual follow-up. | `src/components/payment/InsuranceQuoteButton.tsx:26` | not applicable |

### Error strings (63 located occurrences)

| Verbatim string | Location | Owner compliance |
|---|---|---|
| Accepting closes this case. This cannot be undone. | `src/components/support/AcceptResolutionButton.tsx:44` | not applicable |
| Access denied | `src/components/access-denied.tsx:17` | not applicable |
| Approving records your acceptance of this exact version. Your agent cannot approve terms on your behalf. | `src/app/app/deals/[dealId]/commercial/ApprovalPanel.tsx:57` | not applicable |
| blocked | `src/app/app/overview/modules.tsx:404` | not applicable |
| Blocked | `src/app/agent/deals/[dealId]/document-data/page.tsx:102` | not applicable |
| Blocked | `src/app/agent/deals/[dealId]/page.tsx:47` | not applicable |
| Blocked | `src/app/agent/deals/[dealId]/page.tsx:55` | not applicable |
| Blocked | `src/app/agent/exporters/[exporterOrgId]/page.tsx:126` | not applicable |
| Blocked | `src/app/app/deals/[dealId]/layout.tsx:18` | not applicable |
| Blocked | `src/app/app/deals/DealsList.tsx:61` | not applicable |
| Blocked | `src/app/app/deals/DealsList.tsx:68` | not applicable |
| Blocked — this is halting the shipment | `src/components/shipment/RaiseIssueButton.tsx:67` | not applicable |
| Blocked / at risk | `src/app/agent/deals/page.tsx:34` | not applicable |
| Blocked by “ | `src/components/execution/GatedAction.tsx:45` | not applicable |
| Blocked deals | `src/app/ops/exceptions/page.tsx:14` | not applicable |
| Blocked deals | `src/app/ops/page.tsx:55` | not applicable |
| Blocked dependency | `src/app/app/deals/[dealId]/tasks/page.tsx:120` | not applicable |
| Blocked, overdue, rejected and exception work across every domain, centralized in one queue. | `src/app/ops/exceptions/page.tsx:150` | not applicable |
| Blocked: | `src/app/agent/exporters/[exporterOrgId]/page.tsx:409` | not applicable |
| Blocked: | `src/app/app/tasks/TasksList.tsx:91` | not applicable |
| Cannot be marked done until the dependency clears. | `src/app/app/deals/[dealId]/tasks/page.tsx:121` | not applicable |
| COMPLETE · refresh failed | `src/components/ops/SanctionsSourceHealthPanel.tsx:30` | not applicable |
| Data unavailable | `src/app/app/markets/[marketAssessmentId]/MarketDetail.tsx:159` | not applicable |
| Escalated, overdue, due soon and blocked work. | `src/app/agent/page.tsx:40` | not applicable |
| expired | `src/app/app/readiness/ReadinessForm.tsx:24` | not applicable |
| Expired | `src/app/app/readiness/ReadinessForm.tsx:24` | not applicable |
| failed | `src/app/app/markets/DemandDiscovery.tsx:308` | not applicable |
| is with the exporter. You cannot approve it on their behalf — the exporter must approve their own terms. | `src/app/agent/deals/[dealId]/commercial/page.tsx:153` | not applicable |
| login-error | `src/app/(auth)/login/LoginForm.tsx:31` | not applicable |
| Most recent attempt failed at the | `src/components/ops/SanctionsSourceHealthPanel.tsx:80` | not applicable |
| No rejected or failed documents. | `src/app/ops/execution/page.tsx:129` | not applicable |
| Not found | `src/app/not-found.tsx:21` | not applicable |
| Nothing is blocked. | `src/app/app/deals/[dealId]/tasks/page.tsx:123` | not applicable |
| Nothing is blocking approval. The exporter can approve this version. | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:184` | not applicable |
| Nothing is blocking you from buyer outreach. The items below are recommended improvements, not requirements. | `src/app/app/readiness/tasks/page.tsx:140` | not applicable |
| Readiness blocked | `src/app/app/overview/modules.tsx:417` | not applicable |
| Screening BLOCKED | `src/components/ops/SanctionsSourceHealthPanel.tsx:21` | not applicable |
| Sending freezes this version and creates the exporter's approval task. You cannot approve it yourself. | `src/app/agent/deals/[dealId]/commercial/TermsEditor.tsx:252` | not applicable |
| Serving previous COMPLETE snapshot — the latest refresh failed at the | `src/components/ops/SanctionsSourceHealthPanel.tsx:76` | not applicable |
| Shown once. Store or send this link now — it cannot be recovered. Anyone who opens it can claim it, so share it only with the intended person. If it is lost or sent to the wrong person, revoke it and generate a new one. | `src/components/ops/GenerateInvitationLinkForm.tsx:73` | not applicable |
| sign-in is unavailable in this environment. | `src/app/(auth)/login/SocialSignInButtons.tsx:44` | not applicable |
| Something went wrong | `src/app/error.tsx:46` | not applicable |
| Sources: overdue/escalated or blocked tasks, open disputes, shipments on watch or blocked, and sanctions cases needing review. Disputes not attached to a deal are not listed — they carry no tenant of their own. | `src/app/agent/escalations/page.tsx:144` | not applicable |
| Superseded and expired decisions stay listed. Each shows what the model said at that moment, which the current assessment can no longer tell you. | `src/components/agent/BuyerDiscoveryControl.tsx:369` | not applicable |
| The configured renderer cannot produce this document. Set | `src/app/agent/deals/[dealId]/documents/GenerateDocumentPanel.tsx:68` | not applicable |
| The PDF font cannot represent every character in this document, so a PDF rendering would substitute them. Use the DOCX output, which represents them correctly, or transliterate the values in the canonical record. | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:132` | not applicable |
| This account cannot be converted | `src/app/(auth)/accept-staff-invitation/page.tsx:157` | not applicable |
| This account cannot become an Agent | `src/app/(auth)/accept-staff-invitation/page.tsx:129` | not applicable |
| This deal is blocked | `src/app/app/deals/[dealId]/layout.tsx:92` | not applicable |
| This invitation has expired | `src/app/(auth)/accept-staff-invitation/page.tsx:76` | not applicable |
| This invitation is not valid | `src/app/(auth)/accept-staff-invitation/page.tsx:66` | not applicable |
| This is a historical version and cannot be approved (EXP-13-AC01). Open the current version to act on it. | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx:206` | not applicable |
| This PDF cannot be approved | `src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx:130` | not applicable |
| unavailable | `src/components/ops/SanctionsSourceHealthPanel.tsx:24` | not applicable |
| unavailable | `src/components/ops/SanctionsSourceHealthPanel.tsx:90` | not applicable |
| Unavailable: | `src/components/agent/DemandDiscoveryControl.tsx:98` | not applicable |
| Upload failed. | `src/components/documents/UploadReplacement.tsx:28` | not applicable |
| Upload failed. | `src/components/enablement/EvidenceUploadForm.tsx:40` | not applicable |
| Upload failed. | `src/components/payment/PaymentEvidenceUpload.tsx:24` | not applicable |
| Upload failed. | `src/components/shipment/MilestoneEvidenceUpload.tsx:24` | not applicable |
| Watch — worth flagging, not yet blocking | `src/components/shipment/RaiseIssueButton.tsx:66` | not applicable |
| What looks wrong with this payout? | `src/components/agent/RaisePayoutQueryButton.tsx:47` | not applicable |
| Your review says this version is fit to put in front of the exporter. Approval is the exporter's decision — agents cannot approve on their behalf. | `src/app/agent/deals/[dealId]/documents/[documentId]/ReviewPanel.tsx:68` | not applicable |


### Section 4 supplement — exported component signatures and JSX use counts

This supplement captures inline and destructured props that do not have a named `*Props` declaration. The signature is copied from the source AST. JSX-use counts count `<ComponentName` occurrences in page modules and therefore include use through barrel imports.

| Component file | Exported function/variable signatures | Page/module JSX locations and counts |
|---|---|---|
| `src/components/access-denied.tsx` | AccessDenied({ message }: { message: string }) | `src/app/agent/layout.tsx` ×1<br>`src/app/app/layout.tsx` ×1<br>`src/app/ops/agents/[agentId]/page.tsx` ×1<br>`src/app/ops/agents/page.tsx` ×1<br>`src/app/ops/assignments/page.tsx` ×1<br>`src/app/ops/audit/page.tsx` ×1<br>`src/app/ops/disputes/[disputeId]/page.tsx` ×1<br>`src/app/ops/disputes/page.tsx` ×1<br>`src/app/ops/exceptions/page.tsx` ×1<br>`src/app/ops/execution/page.tsx` ×1<br>`src/app/ops/finance/page.tsx` ×1<br>`src/app/ops/layout.tsx` ×1<br>`src/app/ops/page.tsx` ×1<br>`src/app/ops/sanctions/page.tsx` ×1 |
| `src/components/agent/BuyerDecisionControls.tsx` | BuyerDecisionControls({
  assessmentId,
  buyerName,
}: {
  assessmentId: string;
  buyerName: string;
}) | none |
| `src/components/agent/BuyerDiscoveryControl.tsx` | BuyerDiscoveryControl({
  rows,
  showAll,
  totalCount,
}: {
  rows: BuyerControlRow[];
  showAll: boolean;
  totalCount: number;
}) | `src/app/agent/exporters/[exporterOrgId]/page.tsx` ×1 |
| `src/components/agent/ConvertLeadForm.tsx` | ConvertLeadForm({ buyerLeadId }: { buyerLeadId: string }) | `src/app/agent/leads/[buyerLeadId]/page.tsx` ×1 |
| `src/components/agent/CreateTaskForm.tsx` | CreateTaskForm({ exporterOrgId }: { exporterOrgId: string }) | `src/app/agent/exporters/[exporterOrgId]/page.tsx` ×1 |
| `src/components/agent/DemandDiscoveryControl.tsx` | DemandDiscoveryControl({
  rows,
  showAll,
  runId,
}: {
  rows: MarketControlRow[];
  showAll: boolean;
  runId: string \| null;
}) | `src/app/agent/exporters/[exporterOrgId]/page.tsx` ×1 |
| `src/components/agent/DisqualifyLeadForm.tsx` | DisqualifyLeadForm({ buyerLeadId }: { buyerLeadId: string }) | `src/app/agent/leads/[buyerLeadId]/page.tsx` ×1 |
| `src/components/agent/InternalNoteForm.tsx` | InternalNoteForm({ endpoint }: { endpoint: string }) | `src/app/agent/deals/[dealId]/page.tsx` ×1<br>`src/app/agent/exporters/[exporterOrgId]/page.tsx` ×1<br>`src/app/agent/leads/[buyerLeadId]/page.tsx` ×1 |
| `src/components/agent/LogOutreachForm.tsx` | LogOutreachForm({ buyerLeadId, currentStage }: { buyerLeadId: string; currentStage: string }) | `src/app/agent/leads/[buyerLeadId]/page.tsx` ×1 |
| `src/components/agent/MarketDecisionControls.tsx` | MarketDecisionControls({
  assessmentId,
  countryCode,
}: {
  assessmentId: string;
  countryCode: string;
}) | none |
| `src/components/agent/MessageForm.tsx` | MessageForm({ endpoint }: { endpoint: string }) | `src/app/agent/exporters/[exporterOrgId]/page.tsx` ×1 |
| `src/components/agent/ProductClassificationForm.tsx` | ProductClassificationForm({productId,status,method='agent_supplied'}:{productId:string;status:string\|null;method?:'agent_supplied'\|'exporter_supplied'}) | `src/app/agent/exporters/[exporterOrgId]/page.tsx` ×1<br>`src/app/app/markets/DemandDiscovery.tsx` ×1 |
| `src/components/agent/ProductQuickEditForm.tsx` | ProductQuickEditForm({ productId, initial }: { productId: string; initial: Partial<ProductFields> }) | `src/app/agent/exporters/[exporterOrgId]/page.tsx` ×1 |
| `src/components/agent/RaisePayoutQueryButton.tsx` | RaisePayoutQueryButton({ payoutId }: { payoutId: string }) | `src/app/agent/performance/page.tsx` ×1 |
| `src/components/agent/TaskEscalationActions.tsx` | TaskEscalationActions({
  taskId,
  hasOwner,
  isEscalated,
}: {
  taskId: string;
  hasOwner: boolean;
  isEscalated: boolean;
}) | `src/app/agent/tasks/page.tsx` ×1 |
| `src/components/agent/VerifyContactForm.tsx` | VerifyContactForm({ contactId }: { contactId: string }) | `src/app/agent/leads/[buyerLeadId]/page.tsx` ×1 |
| `src/components/buyer-detail/RelationshipActions.tsx` | RelationshipActions({
  buyerId,
  products,
  isShortlisted,
}: {
  buyerId: string;
  products: { id: string; name: string }[];
  isShortlisted: boolean;
}) | `src/app/app/buyers/[buyerId]/page.tsx` ×1 |
| `src/components/commercial/ProposalDiff.tsx` | ProposalDiff({
  diff,
  currentVersion,
  previousVersion,
}: {
  diff: ProposalFieldDiff[];
  currentVersion: number;
  previousVersion: number \| null;
}) | `src/app/agent/deals/[dealId]/commercial/page.tsx` ×1<br>`src/app/app/deals/[dealId]/commercial/page.tsx` ×1 |
| `src/components/commercial/ProposalHistory.tsx` | ProposalHistory({
  history,
  display = PROPOSAL_STATUS_DISPLAY,
}: {
  history: ProposalView[];
  display?: Record<string, StatusDescriptor>;
}) | `src/app/agent/deals/[dealId]/commercial/page.tsx` ×1<br>`src/app/app/deals/[dealId]/commercial/page.tsx` ×1 |
| `src/components/documents/DocumentApprovalPanel.tsx` | DocumentApprovalPanel({
  dealId,
  documentId,
  version,
  checksum,
}: {
  dealId: string;
  documentId: string;
  version: number;
  checksum: string;
}) | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx` ×1 |
| `src/components/documents/GenerateButton.tsx` | GenerateButton({
  dealId,
  documentId,
  label = 'Generate',
  compact = false,
}: {
  dealId: string;
  documentId: string;
  label?: string;
  compact?: boolean;
}) | `src/app/agent/deals/[dealId]/page.tsx` ×1<br>`src/app/app/deals/[dealId]/documents/[documentId]/page.tsx` ×1<br>`src/app/app/deals/[dealId]/documents/page.tsx` ×1 |
| `src/components/documents/UploadReplacement.tsx` | UploadReplacement({ dealId, documentId }: { dealId: string; documentId: string }) | `src/app/app/deals/[dealId]/documents/[documentId]/page.tsx` ×1 |
| `src/components/enablement/AskAgentButton.tsx` | AskAgentButton({ taskId }: { taskId: string }) | `src/app/app/deals/[dealId]/tasks/page.tsx` ×1<br>`src/app/app/readiness/tasks/page.tsx` ×1 |
| `src/components/enablement/EvidenceUploadForm.tsx` | EvidenceUploadForm({ taskId, latestEvidence }: { taskId: string; latestEvidence: EvidenceDTO \| null }) | `src/app/app/deals/[dealId]/tasks/page.tsx` ×1<br>`src/app/app/readiness/tasks/page.tsx` ×1 |
| `src/components/enablement/SelfCompleteButton.tsx` | SelfCompleteButton({ taskId }: { taskId: string }) | `src/app/app/readiness/tasks/page.tsx` ×1 |
| `src/components/execution/AssignPartnerForm.tsx` | AssignPartnerForm({
  dealId,
  lane,
  partners,
  currentPartnerName,
}: {
  dealId: string;
  lane: 'cha' \| 'freight';
  partners: DirectoryPartner[];
  currentPartnerName: string \| null;
}) | `src/app/agent/deals/[dealId]/page.tsx` ×2<br>`src/app/ops/execution/page.tsx` ×2 |
| `src/components/execution/EscalateBlockerButton.tsx` | EscalateBlockerButton({ dealId, gate, gateLabel }: { dealId: string; gate: string; gateLabel: string }) | `src/app/agent/deals/[dealId]/page.tsx` ×1 |
| `src/components/execution/FileDocumentForm.tsx` | FileDocumentForm({
  dealId,
  documentId,
  filingStatus,
  filingReference,
}: {
  dealId: string;
  documentId: string;
  filingStatus: string;
  filingReference: string \| null;
}) | `src/app/agent/deals/[dealId]/page.tsx` ×1 |
| `src/components/execution/GatedAction.tsx` | GatedAction({
  verdict,
  children,
  label,
}: {
  verdict: { allowed: true } \| { allowed: false; gate: ExecutionGate };
  children: ReactNode;
  /** What the blocked control would have said, so the disabled state still reads sensibly. */
  label: string;
}) | `src/app/agent/deals/[dealId]/page.tsx` ×5 |
| `src/components/execution/HandoffStatusForm.tsx` | HandoffStatusForm({
  dealId,
  handoffId,
  status,
  reference,
}: {
  dealId: string;
  handoffId: string;
  status: string;
  reference: string \| null;
}) | `src/app/agent/deals/[dealId]/page.tsx` ×1 |
| `src/components/execution/InternalNoteForm.tsx` | InternalNoteForm({ dealId }: { dealId: string }) | `src/app/agent/deals/[dealId]/page.tsx` ×1<br>`src/app/agent/exporters/[exporterOrgId]/page.tsx` ×1<br>`src/app/agent/leads/[buyerLeadId]/page.tsx` ×1 |
| `src/components/execution/TaskActions.tsx` | TaskActions({ taskId, state }: { taskId: string; state: string }) | `src/app/agent/deals/[dealId]/page.tsx` ×2<br>`src/app/agent/tasks/page.tsx` ×1<br>`src/app/app/deals/[dealId]/tasks/page.tsx` ×1 |
| `src/components/notifications/NotificationsList.tsx` | NotificationsList() | `src/app/app/notifications/page.tsx` ×1 |
| `src/components/notifications/OrgProfileForm.tsx` | OrgProfileForm({
  canEdit,
  initial,
}: {
  canEdit: boolean;
  initial: { legal_name: string \| null; display_name: string; gstin: string \| null; iec_label: string; state: string \| null; city: string \| null };
}) | `src/app/app/notifications/page.tsx` ×1 |
| `src/components/notifications/PreferencesPanel.tsx` | PreferencesPanel() | `src/app/app/notifications/page.tsx` ×1 |
| `src/components/notifications/TeamPanel.tsx` | TeamPanel({
  isOwner,
  members,
  invitations,
}: {
  isOwner: boolean;
  members: Member[];
  invitations: Invite[];
}) | `src/app/app/notifications/page.tsx` ×1 |
| `src/components/ops-disputes/DisputeActions.tsx` | DisputeActions({
  dealId,
  disputeId,
  status,
  assignableUsers,
}: {
  dealId: string;
  disputeId: string;
  status: string;
  assignableUsers: AssignableUser[];
}) | `src/app/ops/disputes/[disputeId]/page.tsx` ×1 |
| `src/components/ops/AddAgentForm.tsx` | AddAgentForm() | `src/app/ops/agents/page.tsx` ×1 |
| `src/components/ops/AgentActivationControl.tsx` | AgentActivationControl({ agentId, agentName, isActive }: { agentId: string; agentName: string; isActive: boolean }) | `src/app/ops/agents/[agentId]/page.tsx` ×1 |
| `src/components/ops/AssignAgentToExporterForm.tsx` | AssignAgentToExporterForm({
  exporterOrgId,
  exporterName,
  agents,
}: {
  exporterOrgId: string;
  exporterName: string;
  agents: { id: string; name: string; assignedCount: number }[];
}) | `src/app/ops/assignments/page.tsx` ×1 |
| `src/components/ops/AssignExporterForm.tsx` | AssignExporterForm({
  agentUserId,
  exporters,
  unassignAssignmentId,
  exporterName,
}: {
  agentUserId: string;
  exporters?: { id: string; display_name: string }[];
  unassignAssignmentId?: string;
  /** Shown in the unassign confirmation panel, for the org-wide `/ops/assignments` view. */
  exporterName?: string;
}) | `src/app/ops/agents/[agentId]/page.tsx` ×2<br>`src/app/ops/assignments/page.tsx` ×1 |
| `src/components/ops/ConfigVersionForm.tsx` | ConfigVersionForm({ configKey, currentValue }: { configKey: string; currentValue: unknown }) | `src/app/ops/audit/page.tsx` ×1 |
| `src/components/ops/FeePolicyForm.tsx` | FeePolicyForm({ initial }: { initial: FeePolicyFields }) | `src/app/ops/audit/page.tsx` ×1 |
| `src/components/ops/GenerateInvitationLinkForm.tsx` | GenerateInvitationLinkForm() | `src/app/ops/agents/page.tsx` ×1 |
| `src/components/ops/OverrideRequirementForm.tsx` | OverrideRequirementForm({ dealId, documentId }: { dealId: string; documentId: string }) | `src/app/ops/execution/page.tsx` ×1 |
| `src/components/ops/PartnerDirectoryForms.tsx` | CreatePartnerForm()<br>PartnerStatusForm({ partnerId, currentStatus }: { partnerId: string; currentStatus: string }) | `src/app/ops/audit/page.tsx` ×2 |
| `src/components/ops/PayoutActions.tsx` | PayoutActions({ payoutId, state }: { payoutId: string; state: string }) | `src/app/ops/finance/page.tsx` ×1 |
| `src/components/ops/ReassignExporterForm.tsx` | ReassignExporterForm({
  assignmentId,
  exporterName,
  currentAgentName,
  candidates,
}: {
  assignmentId: string;
  exporterName: string;
  currentAgentName: string;
  candidates: { id: string; name: string }[];
}) | `src/app/ops/agents/[agentId]/page.tsx` ×1<br>`src/app/ops/assignments/page.tsx` ×1 |
| `src/components/ops/RecordFilingForm.tsx` | RecordFilingForm({ dealId, documentId, allowedTargets }: { dealId: string; documentId: string; allowedTargets: string[] }) | `src/app/ops/execution/page.tsx` ×2 |
| `src/components/ops/RevokeGrantButton.tsx` | RevokeGrantButton({ grantId, email, grantedBy }: { grantId: string; email: string; grantedBy: string }) | `src/app/ops/agents/page.tsx` ×1 |
| `src/components/ops/RevokeInvitationButton.tsx` | RevokeInvitationButton({
  invitationId, createdBy, createdAt, expiresAt,
}: {
  invitationId: string; createdBy: string; createdAt: string; expiresAt: string;
}) | `src/app/ops/agents/page.tsx` ×1 |
| `src/components/ops/SanctionsSourceHealthPanel.tsx` | SanctionsSourceHealthPanel({health}:{health:SanctionsSourceHealth}) | `src/app/ops/sanctions/page.tsx` ×1 |
| `src/components/payment/BrcStatusControl.tsx` | BrcStatusControl({ dealId, paymentId, brcStatus }: { dealId: string; paymentId: string; brcStatus: BrcStatus }) | `src/app/app/deals/[dealId]/payment/page.tsx` ×1 |
| `src/components/payment/InsuranceQuoteButton.tsx` | InsuranceQuoteButton({ dealId }: { dealId: string }) | `src/app/app/deals/[dealId]/payment/page.tsx` ×1 |
| `src/components/payment/OpenDisputeButton.tsx` | OpenDisputeButton({ dealId, paymentId }: { dealId: string; paymentId: string }) | `src/app/app/deals/[dealId]/payment/page.tsx` ×1 |
| `src/components/payment/PaymentEvidenceUpload.tsx` | PaymentEvidenceUpload({ dealId, paymentId }: { dealId: string; paymentId: string }) | `src/app/app/deals/[dealId]/payment/page.tsx` ×1 |
| `src/components/payment/PaymentStatusForm.tsx` | PaymentStatusForm({ dealId, paymentId }: { dealId: string; paymentId: string }) | `src/app/app/deals/[dealId]/payment/page.tsx` ×1 |
| `src/components/shell/AppShell.tsx` | AppShell({
  children,
  portal,
  userName,
  tier,
  role,
}: {
  children: ReactNode;
  portal: Portal;
  userName: string \| null;
  tier: Tier;
  role: UserRole;
}) | `src/app/agent/layout.tsx` ×1<br>`src/app/app/layout.tsx` ×1<br>`src/app/ops/layout.tsx` ×1 |
| `src/components/shipment/ConfirmPickupForm.tsx` | ConfirmPickupForm({ dealId }: { dealId: string }) | `src/app/app/deals/[dealId]/shipment/page.tsx` ×1 |
| `src/components/shipment/MilestoneEvidenceUpload.tsx` | MilestoneEvidenceUpload({ dealId, milestoneId }: { dealId: string; milestoneId: string }) | `src/app/app/deals/[dealId]/shipment/page.tsx` ×1 |
| `src/components/shipment/RaiseIssueButton.tsx` | RaiseIssueButton({ dealId }: { dealId: string }) | `src/app/app/deals/[dealId]/shipment/page.tsx` ×1 |
| `src/components/support/AcceptResolutionButton.tsx` | AcceptResolutionButton({ dealId, disputeId }: { dealId: string; disputeId: string }) | `src/app/app/deals/[dealId]/support/page.tsx` ×1 |
| `src/components/support/CreateCaseForm.tsx` | CreateCaseForm({
  dealId,
  shipmentId,
  payments,
}: {
  dealId: string;
  shipmentId: string \| null;
  payments: { id: string; label: string }[];
}) | `src/app/app/deals/[dealId]/support/page.tsx` ×1 |
| `src/components/support/SendMessageForm.tsx` | SendMessageForm({ dealId }: { dealId: string }) | `src/app/app/deals/[dealId]/support/page.tsx` ×1 |
| `src/components/ui/Button.tsx` | Button({ className = '', variant = 'primary', type = 'button', ...props }: ButtonProps) | `src/app/(auth)/accept-staff-invitation/ConvertToAgentPanel.tsx` ×2<br>`src/app/(auth)/accept-staff-invitation/SignOutAndReturn.tsx` ×1<br>`src/app/(auth)/login/LoginForm.tsx` ×1<br>`src/app/(auth)/login/SocialSignInButtons.tsx` ×1<br>`src/app/(auth)/register/RegisterForm.tsx` ×1<br>`src/app/agent/deals/[dealId]/commercial/LockPanel.tsx` ×1<br>`src/app/agent/deals/[dealId]/commercial/TermsEditor.tsx` ×2<br>`src/app/agent/deals/[dealId]/document-data/FixCanonicalDataPanel.tsx` ×3<br>`src/app/agent/deals/[dealId]/documents/GenerateDocumentPanel.tsx` ×1<br>`src/app/agent/deals/[dealId]/documents/[documentId]/ReviewPanel.tsx` ×3<br>`src/app/app/billing/CommitmentFeeCard.tsx` ×1<br>`src/app/app/deals/[dealId]/commercial/ApprovalPanel.tsx` ×4<br>`src/app/app/markets/DemandDiscovery.tsx` ×2<br>`src/app/app/markets/MarketEstimate.tsx` ×1<br>`src/app/app/markets/[marketAssessmentId]/MarketDetail.tsx` ×2<br>`src/app/app/readiness/ReadinessForm.tsx` ×4<br>`src/app/error.tsx` ×2 |
| `src/components/ui/DataTable.tsx` | DataTable({
  columns,
  rows,
  rowKey,
  loading = false,
  page,
  onPageChange,
  sort,
  onSortChange,
  hasActiveFilters = false,
  emptyState,
  filteredEmptyState = DEFAULT_FILTERED_EMPTY,
  onRowClick,
  rowActions,
  className,
}: DataTableProps<T>) | none |
| `src/components/ui/Input.tsx` | Input({ className = '', error, id, label, ...props }: InputProps) | `src/app/(auth)/login/LoginForm.tsx` ×2<br>`src/app/(auth)/register/RegisterForm.tsx` ×4<br>`src/app/agent/deals/[dealId]/document-data/FixCanonicalDataPanel.tsx` ×4<br>`src/app/app/markets/DemandDiscovery.tsx` ×2<br>`src/app/app/markets/MarketEstimate.tsx` ×4<br>`src/app/app/readiness/ReadinessForm.tsx` ×16 |
| `src/components/ui/JourneyProgress.tsx` | JourneyProgress({ currentStage, getHref, className }: JourneyProgressProps) | `src/app/app/deals/[dealId]/layout.tsx` ×1<br>`src/app/app/overview/modules.tsx` ×1 |
| `src/components/ui/MetricCard.tsx` | MetricCard({
  label,
  value,
  secondaryText,
  comparison,
  loading = false,
  className,
}: MetricCardProps) | `src/app/agent/exporters/[exporterOrgId]/page.tsx` ×3<br>`src/app/agent/page.tsx` ×4<br>`src/app/agent/performance/page.tsx` ×4<br>`src/app/app/deals/DealsList.tsx` ×3<br>`src/app/app/markets/[marketAssessmentId]/MarketDetail.tsx` ×5<br>`src/app/app/overview/modules.tsx` ×4<br>`src/app/ops/page.tsx` ×1 |
| `src/components/ui/NextActionCard.tsx` | NextActionCard({
  title,
  owner,
  dueAt,
  urgency,
  blocker,
  href,
  ctaLabel = 'View',
  loading = false,
  className,
}: NextActionCardProps) | `src/app/app/overview/modules.tsx` ×1 |
| `src/components/ui/NotBuiltYet.tsx` | NotBuiltYet({ tabLabel, backHref }: { tabLabel: string; backHref: string }) | none |
| `src/components/ui/Skeleton.tsx` | Skeleton({ variant = 'text', width, height, lines = 1, className }: SkeletonProps) | `src/app/app/markets/DemandDiscovery.tsx` ×1<br>`src/app/app/overview/page.tsx` ×1 |
| `src/components/ui/StatusChip.tsx` | StatusChip({ label, tone, icon, detail, size = 'md', className }: StatusChipProps) | `src/app/agent/deals/[dealId]/commercial/LockPanel.tsx` ×1<br>`src/app/agent/deals/[dealId]/commercial/TermsEditor.tsx` ×1<br>`src/app/agent/deals/[dealId]/commercial/page.tsx` ×4<br>`src/app/agent/deals/[dealId]/document-data/page.tsx` ×1<br>`src/app/agent/deals/[dealId]/documents/[documentId]/page.tsx` ×4<br>`src/app/agent/deals/[dealId]/documents/page.tsx` ×5<br>`src/app/agent/deals/[dealId]/page.tsx` ×14<br>`src/app/agent/deals/page.tsx` ×1<br>`src/app/agent/escalations/page.tsx` ×1<br>`src/app/agent/exporters/[exporterOrgId]/page.tsx` ×6<br>`src/app/agent/exporters/page.tsx` ×1<br>`src/app/agent/leads/[buyerLeadId]/page.tsx` ×7<br>`src/app/agent/outreach/OutreachPipeline.tsx` ×5<br>`src/app/agent/page.tsx` ×3<br>`src/app/agent/performance/page.tsx` ×2<br>`src/app/agent/tasks/page.tsx` ×2<br>`src/app/app/billing/CommitmentFeeCard.tsx` ×2<br>`src/app/app/buyers/BuyersExplorer.tsx` ×6<br>`src/app/app/buyers/[buyerId]/page.tsx` ×4<br>`src/app/app/deals/DealsList.tsx` ×2<br>`src/app/app/deals/[dealId]/activity/page.tsx` ×1<br>`src/app/app/deals/[dealId]/commercial/ApprovalPanel.tsx` ×1<br>`src/app/app/deals/[dealId]/commercial/page.tsx` ×1<br>`src/app/app/deals/[dealId]/documents/[documentId]/page.tsx` ×6<br>`src/app/app/deals/[dealId]/documents/page.tsx` ×4<br>`src/app/app/deals/[dealId]/layout.tsx` ×1<br>`src/app/app/deals/[dealId]/page.tsx` ×1<br>`src/app/app/deals/[dealId]/payment/page.tsx` ×5<br>`src/app/app/deals/[dealId]/shipment/page.tsx` ×4<br>`src/app/app/deals/[dealId]/support/page.tsx` ×3<br>`src/app/app/deals/[dealId]/tasks/page.tsx` ×1<br>`src/app/app/markets/DemandDiscovery.tsx` ×6<br>`src/app/app/markets/[marketAssessmentId]/MarketDetail.tsx` ×2<br>`src/app/app/overview/modules.tsx` ×3<br>`src/app/app/readiness/ReadinessForm.tsx` ×1<br>`src/app/app/readiness/tasks/page.tsx` ×1<br>`src/app/app/tasks/TasksList.tsx` ×1<br>`src/app/ops/agents/[agentId]/page.tsx` ×1<br>`src/app/ops/agents/page.tsx` ×3<br>`src/app/ops/assignments/page.tsx` ×1<br>`src/app/ops/audit/page.tsx` ×5<br>`src/app/ops/disputes/[disputeId]/page.tsx` ×2<br>`src/app/ops/disputes/page.tsx` ×2<br>`src/app/ops/exceptions/page.tsx` ×1<br>`src/app/ops/execution/page.tsx` ×6<br>`src/app/ops/finance/page.tsx` ×6<br>`src/app/ops/page.tsx` ×2<br>`src/app/ops/sanctions/page.tsx` ×1 |
| `src/components/ui/UpgradeNotice.tsx` | UpgradeNotice(props: UpgradeNoticeProps) | `src/app/app/buyers/BuyersExplorer.tsx` ×3<br>`src/app/app/buyers/[buyerId]/page.tsx` ×2<br>`src/app/app/deals/[dealId]/layout.tsx` ×1<br>`src/app/app/deals/page.tsx` ×1<br>`src/app/app/markets/DemandDiscovery.tsx` ×2<br>`src/app/app/markets/MarketEstimate.tsx` ×1<br>`src/app/app/markets/[marketAssessmentId]/MarketDetail.tsx` ×1<br>`src/app/app/messages/page.tsx` ×1<br>`src/app/app/more/page.tsx` ×1<br>`src/app/app/notifications/page.tsx` ×1<br>`src/app/app/overview/modules.tsx` ×3<br>`src/app/app/readiness/page.tsx` ×1<br>`src/app/app/readiness/tasks/page.tsx` ×1<br>`src/app/app/tasks/page.tsx` ×1 |
---

## Section 7 — Inconsistency Register

Each entry records parallel implementations of the same UI kind. It states only the observable difference and locations.

| Kind | Version A | Version B |
|---|---|---|
| Card container | `rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card` appears in dashboard and metric/card compositions, including `src/components/ui/MetricCard.tsx`, `src/components/ui/NextActionCard.tsx`, and `src/app/app/overview/modules.tsx`. | Border-only cards without `shadow-card`, commonly `rounded-lg border border-[var(--color-border)] bg-surface p-4` or `p-5`, appear throughout deal, agent, and ops pages, including `src/app/app/deals/[dealId]/page.tsx`, `src/app/agent/page.tsx`, and `src/app/ops/page.tsx`.
| Empty state | Standalone muted paragraph copy appears inside the surrounding section, such as “Nothing outstanding on your side for this deal right now.” in `src/app/app/deals/[dealId]/page.tsx`. | Bordered or tinted empty panels appear in delegated client components such as `src/app/app/buyers/BuyersExplorer.tsx`, `src/app/app/markets/DemandDiscovery.tsx`, and `src/app/agent/outreach/OutreachPipeline.tsx`.
| Page title hierarchy | Portal pages commonly render an eyebrow (`text-xs font-semibold uppercase tracking-wide`) followed by an `h1` using `text-2xl font-semibold`, including `/agent`, `/agent/tasks`, `/ops`, and `/ops/assignments`. | Exporter deal-tab pages commonly begin with an `h2` or section content because the `h1` is supplied by `src/app/app/deals/[dealId]/layout.tsx`; auth pages use brand text plus an `h1`, and delegated discovery pages supply their own heading.
| Button implementation | Shared `Button` renders its size and variant matrix from `src/components/ui/Button.tsx`. | Native `<button>` elements with local padding/color class strings occur in client forms and filters, including `src/app/app/buyers/BuyersExplorer.tsx`, `src/app/app/markets/DemandDiscovery.tsx`, `src/app/agent/outreach/OutreachPipeline.tsx`, and multiple files under `src/components/agent/` and `src/components/ops/`.
| Semantic error background | `color-mix()` arbitrary values using `--color-critical`, for example `bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)]`, appear in overview, buyer, outreach, and auth error panels. | `bg-red-50` appears in `src/app/(auth)/login/LoginForm.tsx`, `src/app/(auth)/register/RegisterForm.tsx`, `src/components/agent/BuyerDecisionControls.tsx`, and `src/components/agent/MarketDecisionControls.tsx`.
| Semantic danger variable | Defined critical tokens are used as `--color-critical` and `--color-critical-text`. | `var(--color-danger)` is referenced five times in source although `--color-danger` is not declared in `src/app/globals.css`.
| Status presentation | `StatusChip` supplies icon, label, tone, border, and tint in `src/components/ui/StatusChip.tsx`. | Plain text status labels and locally styled status banners also appear, including commercial approval prose, task owner/waiting lines, invitation validity panels, and payment/shipment issue panels.
| Table construction | `DataTable` supplies a shared `<table>/<thead>/<tbody>` structure in `src/components/ui/DataTable.tsx`. | Page-local `<table>` markup is used by agent and ops queues, including `src/app/agent/deals/page.tsx`, `src/app/agent/tasks/page.tsx`, `src/app/ops/assignments/page.tsx`, `src/app/ops/exceptions/page.tsx`, `src/app/ops/execution/page.tsx`, and `src/app/ops/finance/page.tsx`.
| Table cell density | Shared `DataTable` cells use the padding and type declared in `src/components/ui/DataTable.tsx`. | Page-local tables use combinations of `px-3 py-2`, `px-3 py-3`, `px-4 py-3`, `text-xs`, and `text-sm` in agent and ops route files.
| Section spacing | Many pages use a parent `space-y-4`. | Other pages use explicit sibling margins such as `mt-3`, `mt-4`, `mt-6`, or grid gaps without a parent `space-y-*`; the raw distribution is listed in Section 2.
| Radius notation | `rounded` resolves to the configured default `--radius-md`; `rounded-md`, `rounded-lg`, and `rounded-xl` resolve through named radius entries. | `rounded-full` and arbitrary/range-specific radius utilities appear for pills and circular controls; the complete counts are in Section 2.
| Color reference form | Named Tailwind mappings such as `text-primary`, `bg-surface`, `border-critical`, and `text-info` are used throughout source. | Arbitrary CSS-variable utilities such as `text-[var(--color-text-secondary)]`, `border-[var(--color-border)]`, and `bg-[color-mix(...)]` are used alongside the named mappings.
| Header context | Agent and Ops pages render portal eyebrows (“Agent workspace”, “Operations”/“Ops”) in individual pages. | Exporter routes rely on `AppShell`, deal layout context, or page-specific headings; `/app/overview` renders “Overview” without a portal eyebrow.
| Loading state | `/app/overview` uses `Skeleton` through Suspense fallbacks for independently loaded modules. | Most server-rendered route pages contain no route-local loading UI and either render synchronously after data access or delegate pending feedback to a client component.
| Filtered-empty copy | `/agent/tasks` uses the single message “Nothing in this view right now.” for each selected view. | `/agent/deals`, `/ops/exceptions`, and client discovery/pipeline components use filter-specific or query-specific no-result wording.

---

### Section 1 source verification — verbatim current files

The following blocks preserve comments and whitespace from the current worktree and are the authoritative full-file copies for Section 1.

#### `src/app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --font-inter: 'Inter', system-ui, sans-serif;

  --color-primary: #0B1739;
  --color-action: #14B8A6;
  --color-info: #27C2E8;
  --color-warning: #F59E0B;
  --color-critical: #EF4444;
  --color-accent: #7C3AED;
  --color-surface-raised: #132654;
  --color-surface-muted: #F4F7FB;
  --color-surface: #FFFFFF;

  --color-border: rgba(11, 23, 57, 0.12);
  --color-border-strong: rgba(11, 23, 57, 0.24);
  --color-text-primary: #0B1739;
  --color-text-secondary: rgba(11, 23, 57, 0.7);
  /* 0.64, not 0.48. At 0.48 this composites to rgb(138,144,160) on white = 3.19:1,
     which fails WCAG AA (4.5:1). It was assumed safe as "de-emphasized metadata only",
     but a sweep found it carrying journey-rail stage labels, MetricCard explanations
     and the Ops KPI drill-down link — all essential text. 0.64 gives 5.35:1 on white
     and 5.20:1 on --color-surface-muted, while staying a visible step lighter than
     --color-text-secondary (0.70). */
  --color-text-muted: rgba(11, 23, 57, 0.64);
  --color-text-inverse: #FFFFFF;

  /* Semantic hues as TEXT on a light surface.
     The docs/00 §2 palette values are tuned as fills and accents, not as small text:
     measured on white they are teal 2.49:1, cyan 2.42:1, amber 2.15:1, red 3.76:1 —
     all below AA's 4.5:1. Blending 55% hue into navy keeps each colour identifiable
     while clearing AA on both --color-surface (>=5.18:1) and --color-surface-muted
     (>=4.82:1). Use these anywhere a semantic colour carries words; keep the raw
     tokens for fills, borders and icons. */
  --color-action-text: color-mix(in srgb, var(--color-action) 55%, var(--color-primary));
  --color-info-text: color-mix(in srgb, var(--color-info) 55%, var(--color-primary));
  --color-warning-text: color-mix(in srgb, var(--color-warning) 55%, var(--color-primary));
  --color-critical-text: color-mix(in srgb, var(--color-critical) 55%, var(--color-primary));

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 10px;
  --radius-full: 9999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --text-4xl: 2.25rem;

  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;

  --shadow-card: 0 1px 3px rgba(11, 23, 57, 0.08), 0 1px 2px rgba(11, 23, 57, 0.06);
  --shadow-raised: 0 4px 12px rgba(11, 23, 57, 0.12), 0 2px 4px rgba(11, 23, 57, 0.08);

  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;

  --topbar-height: 56px;
  --leftnav-width: 256px;
  --leftnav-width-collapsed: 72px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: #0B1739;
    --color-surface-raised: #0F1F44;
    --color-surface-muted: #0D1B3A;
    --color-surface: #132654;
    --color-border: rgba(255, 255, 255, 0.12);
    --color-border-strong: rgba(255, 255, 255, 0.24);
    --color-text-primary: #F4F7FB;
    --color-text-secondary: rgba(244, 247, 251, 0.7);
    /* Mirrors the light-mode fix above; same reasoning, inverted ramp. */
    --color-text-muted: rgba(244, 247, 251, 0.64);
    --color-text-inverse: #0B1739;
    --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
    --shadow-raised: 0 4px 12px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.2);
  }
}

* {
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

html,
body {
  max-width: 100vw;
  overflow-x: hidden;
  font-family: var(--font-inter);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--color-text-primary);
  background-color: var(--color-surface-muted);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  font-family: inherit;
}

input,
textarea,
select {
  font-family: inherit;
  font-size: inherit;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.focus-visible-ring:focus-visible {
  outline: none;
  ring: 2px;
  ring-color: var(--color-action);
  ring-offset: 2px;
  ring-offset-color: var(--color-surface);
}

@layer utilities {
  .text-balance {
    text-wrap: balance;
  }
}```

#### `tailwind.config.ts`

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        action: 'var(--color-action)',
        // `info`/`critical` map to their AA-safe `-text` blends, not the raw brand hue.
        // `text-info`/`text-critical`/`border-critical` are used ~11 places across the
        // app (form errors, blocker reasons, job-status text) as a BARE class — no
        // `[var(--color-x-text)]` arbitrary value in sight — so whatever this token
        // resolves to is exactly what ships as body text. The raw hues fail WCAG AA at
        // small sizes on a light background (`--color-critical` #EF4444 measured at
        // 3.54:1 against a 5%-tint card, needs 4.5:1) — the same "class name looks
        // right but silently fails" shape as the `bg-x/N` opacity bug elsewhere in this
        // file's history, just on the text-color axis instead of alpha. `warning` stays
        // on its raw hue: nothing in the app uses a bare `text-warning`/`border-warning`
        // today, so there is no live bug to fix, and changing it preemptively would be
        // guessing at a future default rather than fixing a measured failure.
        info: 'var(--color-info-text)',
        warning: 'var(--color-warning)',
        critical: 'var(--color-critical-text)',
        accent: 'var(--color-accent)',
        'surface-raised': 'var(--color-surface-raised)',
        'surface-muted': 'var(--color-surface-muted)',
        surface: 'var(--color-surface)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      spacing: {
        '1': 'var(--space-1)',
        '2': 'var(--space-2)',
        '3': 'var(--space-3)',
        '4': 'var(--space-4)',
        '5': 'var(--space-5)',
        '6': 'var(--space-6)',
        '8': 'var(--space-8)',
        '10': 'var(--space-10)',
        '12': 'var(--space-12)',
        '16': 'var(--space-16)',
        '20': 'var(--space-20)',
        '24': 'var(--space-24)',
      },
      fontSize: {
        xs: ['var(--text-xs)', { lineHeight: 'var(--leading-tight)' }],
        sm: ['var(--text-sm)', { lineHeight: 'var(--leading-normal)' }],
        base: ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        lg: ['var(--text-lg)', { lineHeight: 'var(--leading-normal)' }],
        xl: ['var(--text-xl)', { lineHeight: 'var(--leading-snug)' }],
        '2xl': ['var(--text-2xl)', { lineHeight: 'var(--leading-snug)' }],
        '3xl': ['var(--text-3xl)', { lineHeight: 'var(--leading-tight)' }],
        '4xl': ['var(--text-4xl)', { lineHeight: 'var(--leading-tight)' }],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
      },
    },
  },
  plugins: [],
};

export default config;```

### Section 4 supplement — component-rendered visible strings

These are static JSX text nodes and user-facing aria-label, placeholder, and title attributes rendered by each shared component. Dynamic values are represented by surrounding static fragments in the markup trees and signatures above.

- `src/components/access-denied.tsx`: “Access denied”.
- `src/components/agent/BuyerDecisionControls.tsx`: “Canonical disqualification reason”; “*”; “Stored on the lead itself, separately from your written explanation below.”; “Reason”; “(required)”; “Why this decision? Recorded permanently against your name.”; “Operational priority (optional)”; “Your ordering for workflow. Blank keeps the AI position. The BuyerFit score is never changed.”; “Cancel”.
- `src/components/agent/BuyerDiscoveryControl.tsx`: “Excluded”; “from”; “Selection:”; “Pipeline:”; “No lead yet”; “Disqualified:”; “Outreach:”; “attempt”; “Not applicable — no lead”; “No agent decision”; “AI recommendation”; “What the model concluded. Read-only.”; “Component”; “Score”; “Not computed”; “Supporting evidence”; “Facts about the buyer. These are inputs and context — not the model&rsquo;s components above.”; “Sanctions:”; “Not screened”; “No decisions recorded yet.”; “priority”; “AI at decision time: score”; “· confidence”; “Frozen components:”; “No BuyerFit assessments for this exporter yet. Buyers appear here once buyer intelligence has run.”; “of”; “buyer”; “Buyer”; “AI score”; “Confidence”; “AI position”; “Operational order”; “Canonical state”; “Agent decision”; “Actions”; “Evidence, provenance and decision history”; “· AI score”; “Decision history”; “Superseded and expired decisions stay listed. Each shows what the model said at that moment, which the current assessment can no longer tell you.”.
- `src/components/agent/ConvertLeadForm.tsx`: “Deal created —”; “open the deal workspace”; “Quantity”; “Unit”; “Unit price”; “Currency”; “Incoterm”; “e.g. FOB”.
- `src/components/agent/CreateTaskForm.tsx`: “Create task”; “Title”; “Owner”; “Agent”; “Exporter”; “Ops”; “Visibility”; “Internal only”; “Exporter-visible”; “Cancel”.
- `src/components/agent/DemandDiscoveryControl.tsx`: “Excluded”; “from”; “No agent decision”; “Component”; “Score”; “Base weight”; “Effective weight”; “Unavailable:”; “No decisions recorded yet.”; “priority”; “AI at decision time: score”; “· rank”; “No Demand Discovery run yet for this exporter. Scores appear here once a run completes.”; “The latest run produced no market assessments.”; “market”; “from the latest run”; “Market”; “AI rank”; “AI score”; “Confidence”; “Operational order”; “Agent decision”; “Actions”; “Component scores, weights and provenance”; “· AI rank”; “Decision history”.
- `src/components/agent/DisqualifyLeadForm.tsx`: “Disqualify”; “Reason”; “Additional detail (optional)”; “Cancel”.
- `src/components/agent/InternalNoteForm.tsx`: “Internal note — never shown to the exporter”; “Visible to agents and Ops only”.
- `src/components/agent/LogOutreachForm.tsx`: “Log outreach / reply”; “Type”; “Call”; “Email”; “Message”; “Meeting”; “Note”; “Visible to”; “Internal only”; “Exporter-visible”; “What happened?”; “Move stage to (optional)”; “No stage change”; “Next action”; “Next action date”.
- `src/components/agent/MarketDecisionControls.tsx`: “Reason”; “*”; “(required)”; “Why this decision? Recorded permanently against your name.”; “Operational priority (optional)”; “Your ordering for workflow. Leave blank to keep the AI rank as the operational order. The AI rank and score are never changed.”; “Cancel”.
- `src/components/agent/MessageForm.tsx`: “Message to exporter — the exporter will see this”; “Exporter-visible”.
- `src/components/agent/ProductClassificationForm.tsx`: “Tariff classification ·”; “Enter an exact HS6 or eight-digit ITC-HS candidate. Confirmation is a human legal-classification decision.”; “HS or ITC-HS candidate”; “6-digit HS or 8-digit ITC-HS”; “Classification confidence”; “Confidence 0–1”; “Classification evidence”; “Evidence and distinguishing rationale”; “Save candidate”; “Confirm reviewed code”.
- `src/components/agent/ProductQuickEditForm.tsx`: “Quick-edit”; “Capacity”; “Value”; “Unit (e.g. MT/month)”; “MOQ”; “Unit”; “Target price”; “Amount”; “Currency (e.g. USD)”; “Per unit (e.g. kg)”; “Incoterm (e.g. CIF)”; “Lead time (days)”; “End-to-end delivery commitment (days)”; “Desired order size”; “Currency”; “Customization capability”; “Packaging capability”; “Packaging”; “Cancel”.
- `src/components/agent/RaisePayoutQueryButton.tsx`: “Raise a query”; “What looks wrong with this payout?”; “This opens a finance case. It does not change the calculation.”; “Cancel”.
- `src/components/agent/TaskEscalationActions.tsx`: “Cancel”; “Claim”; “Escalate”; “Reassign request”.
- `src/components/agent/VerifyContactForm.tsx`: “Verify contact”; “Verification status”; “Verified”; “Partially verified”; “Unverified”; “What evidence supports this? (e.g. call confirmed, email replied from domain)”; “Cancel”.
- `src/components/buyer-detail/RelationshipActions.tsx`: “Add a product to your profile to shortlist or create a lead.”; “Product”.
- `src/components/commercial/ProposalDiff.tsx`: “Term”; “Previous (v”; “Current (v”; “Not set”.
- `src/components/commercial/ProposalHistory.tsx`: “No commercial proposals have been prepared for this deal yet.”; “Version”; “Accepted by”; “Changes requested by”.
- `src/components/documents/DocumentApprovalPanel.tsx`: “Your decision”; “Approving is recorded against this exact version and checksum.”; “Reload”; “Request changes”; “What needs to change?”; “Cancel”.
- `src/components/documents/GenerateButton.tsx`: “Fix this”.
- `src/components/documents/UploadReplacement.tsx`: “Upload a replacement”; “Uploading always creates a new version — this one stays exactly as it is.”; “Uploading…”.
- `src/components/enablement/AskAgentButton.tsx`: “Ask agent”; “Sent — check Messages for a reply.”; “What do you need help with?”; “Cancel”.
- `src/components/enablement/EvidenceUploadForm.tsx`: “Your evidence is waiting on review — you&apos;ll see the outcome here.”; “Upload a corrected file above to re-submit.”; “Uploading…”.
- `src/components/enablement/SelfCompleteButton.tsx`: no static visible string; content is prop/data-driven or the module renders no JSX.
- `src/components/execution/AssignPartnerForm.tsx`: “No active”; “partner is in the approved directory. Ops must onboard one before this can be assigned.”; “Handoff note (optional)”; “What you sent them”.
- `src/components/execution/EscalateBlockerButton.tsx`: “Escalate to Ops”; “Open case”; “Why does Ops need to step in on “”; “”?”; “Cancel”.
- `src/components/execution/FileDocumentForm.tsx`: “Filing complete.”; “Authority reference”; “Filing reference”.
- `src/components/execution/GatedAction.tsx`: “Blocked by “”; “””; “Go there”.
- `src/components/execution/HandoffStatusForm.tsx`: “Partner reference”; “Job / booking number they quoted”.
- `src/components/execution/InternalNoteForm.tsx`: “Add an internal note”; “Not visible to the exporter”.
- `src/components/execution/TaskActions.tsx`: “Cancel”.
- `src/components/notifications/NotificationsList.tsx`: “Notifications”; “Unread only”; “Mark all read”; “Loading…”; “Previous”; “Page”; “of”; “Next”.
- `src/components/notifications/OrgProfileForm.tsx`: “Organization profile”; “GSTIN”; “IEC status”; “GSTIN and IEC are managed through your readiness assessment, not this form.”; “Only the account owner can edit these details.”; “Saved.”.
- `src/components/notifications/PreferencesPanel.tsx`: “Preferences”; “Choose which categories reach you by email and in-app.”; “Loading…”; “Always on”.
- `src/components/notifications/TeamPanel.tsx`: “Team”; “Members of your organization.”; “Pending invitations”; “Expires”; “Resend”; “Revoke”; “Invite a team member”; “name@company.com”; “Member”; “Owner”; “Only the account owner can invite or remove team members.”.
- `src/components/ops-disputes/DisputeActions.tsx`: “Assign owner”; “Waiting on external party”; “Propose resolution”; “Close (authority basis)”; “Reopen”; “Owner”; “Cancel”; “Waiting on”; “e.g. buyer's bank”; “Follow-up date”; “Proposed resolution”; “Authority basis”; “e.g. inspection report, arbitration outcome”; “Closure summary”; “Why reopen this case?”.
- `src/components/ops/AddAgentForm.tsx`: “Add another”; “is already an Agent.”; “already has a ClearTrade account, currently”; “Convert existing account to Agent? Their password and any linked sign-in providers are preserved.”; “Cancel”; “already has a pending pre-authorization awaiting their sign-in.”; “Back”; “No ClearTrade account exists yet for”; “Pre-authorize this email as Agent? No password is created and no email is sent — the moment this exact, verified email signs in, ClearTrade recognizes the grant and provisions the account as Agent instead of an ordinary exporter.”; “person@example.com”.
- `src/components/ops/AgentActivationControl.tsx`: “Deactivate agent”; “Deactivate”; “? They immediately lose portal access. Their history (decisions, assignments, audit trail) is preserved and stays attributed to them. Any active assignments must be reassigned or unassigned first.”; “Reason (optional)”; “Cancel”.
- `src/components/ops/AssignAgentToExporterForm.tsx`: “Assign”; “Exporter:”; “Assign to agent”; “Select an agent…”; “exporter”; “Reason (optional)”; “Cancel”.
- `src/components/ops/AssignExporterForm.tsx`: “Unassign”; “? The agent immediately loses access to their data. This does not delete assignment history.”; “Reason (required)”; “Cancel”; “Exporter”; “Select an exporter…”.
- `src/components/ops/ConfigVersionForm.tsx`: “New version”; “High-risk: this creates a new active version immediately.”; “Cancel”.
- `src/components/ops/FeePolicyForm.tsx`: “New version”; “High-risk: this becomes the active fee policy for every deal locked from now on.”; “Cancel”.
- `src/components/ops/GenerateInvitationLinkForm.tsx`: “Invitation created”; “Shown once. Store or send this link now — it cannot be recovered. Anyone who opens it can claim it, so share it only with the intended person. If it is lost or sent to the wrong person, revoke it and generate a new one.”; “Generate another”.
- `src/components/ops/OverrideRequirementForm.tsx`: “Override requirement”; “High-risk: waives this document&apos;s filing requirement.”; “Why does this requirement not apply? (minimum 10 characters)”; “I understand this bypasses the normal filing check.”; “Cancel”.
- `src/components/ops/PartnerDirectoryForms.tsx`: “Onboard partner”; “Type”; “CHA”; “Freight”; “Insurance”; “Inspection”; “Bank”; “Country”; “Legal name”; “Display name”; “Cancel”; “Change status”; “New status”; “Active”; “Suspended”; “Offboarded”; “Reason”.
- `src/components/ops/PayoutActions.tsx`: “Transfer reference”; “Cancel”; “High-risk: this appends an adjustment record. The original quote is never rewritten.”; “Amount (negative to claw back)”; “Reason”; “I confirm this adjustment.”; “Approve”; “Mark paid”; “Adjust”.
- `src/components/ops/ReassignExporterForm.tsx`: “Reassign”; “Move”; “from”; “to:”; “Select an agent…”; “Reason (required)”; “Cancel”.
- `src/components/ops/RecordFilingForm.tsx`: “Record filing”; “Outcome”; “Authority reference”; “Rejection reason”; “Cancel”.
- `src/components/ops/RevokeGrantButton.tsx`: no static visible string; content is prop/data-driven or the module renders no JSX.
- `src/components/ops/RevokeInvitationButton.tsx`: no static visible string; content is prop/data-driven or the module renders no JSX.
- `src/components/ops/SanctionsSourceHealthPanel.tsx`: “Sanctions source health”; “· contract”; “· required dataset”; “Serving previous COMPLETE snapshot — the latest refresh failed at the”; “stage”; “. Screening continues on the last good data; it was not silently reset.”; “Most recent attempt failed at the”; “(threshold”; “d)”; “retained ·”; “· verification”; “anomaly finding”; “· [”; “]”; “Required-dataset set:”; “Policy”; “. The”; “-day freshness threshold is an engineering default and is”; “— it has not been ratified as the tolerated staleness for screening.”.
- `src/components/payment/BrcStatusControl.tsx`: no static visible string; content is prop/data-driven or the module renders no JSX.
- `src/components/payment/InsuranceQuoteButton.tsx`: no static visible string; content is prop/data-driven or the module renders no JSX.
- `src/components/payment/OpenDisputeButton.tsx`: “Open payment dispute”; “What is being disputed?”; “Cancel”.
- `src/components/payment/PaymentEvidenceUpload.tsx`: “Uploading…”.
- `src/components/payment/PaymentStatusForm.tsx`: “Record payment update”; “New status”; “Source (provenance)”; “Amount received”; “What is being disputed?”; “Note (optional)”; “Cancel”.
- `src/components/shell/AppShell.tsx`: “ClearTrade AI”; “Browsing as guest”; “Create free account”; “Exporter mobile navigation”.
- `src/components/shipment/ConfirmPickupForm.tsx`: “Confirm pickup”; “Pickup window start”; “Pickup window end”; “Contact name”; “Contact phone”; “Pickup address”; “Cancel”.
- `src/components/shipment/MilestoneEvidenceUpload.tsx`: “Uploading…”.
- `src/components/shipment/RaiseIssueButton.tsx`: “Raise issue”; “Severity”; “Watch — worth flagging, not yet blocking”; “Blocked — this is halting the shipment”; “What is the issue?”; “Cancel”.
- `src/components/support/AcceptResolutionButton.tsx`: “Accept resolution”; “Accepting closes this case. This cannot be undone.”; “Cancel”.
- `src/components/support/CreateCaseForm.tsx`: “Open a case”; “Type”; “Severity”; “Low”; “Medium”; “High”; “Critical”; “Relates to”; “This deal generally”; “The shipment”; “What is the issue?”; “Cancel”.
- `src/components/support/SendMessageForm.tsx`: “Message”; “Message your agent or ClearTrade support”.
- `src/components/ui/Button.tsx`: no static visible string; content is prop/data-driven or the module renders no JSX.
- `src/components/ui/DataTable.tsx`: “Actions”; “Page”; “of”.
- `src/components/ui/Input.tsx`: no static visible string; content is prop/data-driven or the module renders no JSX.
- `src/components/ui/JourneyProgress.tsx`: “Export journey progress”.
- `src/components/ui/MetricCard.tsx`: no static visible string; content is prop/data-driven or the module renders no JSX.
- `src/components/ui/NextActionCard.tsx`: “Owner:”; “Unassigned”; “Resolve this first”.
- `src/components/ui/NotBuiltYet.tsx`: “isn&apos;t built yet.”; “This tab has a real route so a deep link never 404s, but there is no”; “content behind it yet.”; “Back to Overview”.
- `src/components/ui/Skeleton.tsx`: no static visible string; content is prop/data-driven or the module renders no JSX.
- `src/components/ui/StatusChip.tsx`: no static visible string; content is prop/data-driven or the module renders no JSX.
- `src/components/ui/UpgradeNotice.tsx`: no static visible string; content is prop/data-driven or the module renders no JSX.
