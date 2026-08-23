import type { Config } from 'tailwindcss';

/**
 * Token surface for the design system in src/app/globals.css.
 *
 * Two rules this file exists to enforce:
 *
 * 1. **Every colour is a `var()`.** No hex values live here. That is what makes the
 *    density and theme switches in globals.css reach every call site.
 * 2. **Never use a Tailwind alpha modifier on one of these colours** (`bg-seal/10`).
 *    Tailwind cannot re-compose a bare `var()` into `rgb(... / alpha)`, so the modifier
 *    silently yields `transparent` — that is precisely how every StatusChip tint in this
 *    product rendered invisible for months. Use the pre-mixed `*-tint` tokens, or an
 *    explicit `color-mix()` arbitrary value.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // --- Brand ---
        bone: 'var(--bone)',
        slate: 'var(--slate)',
        ink: {
          900: 'var(--ink-900)',
          700: 'var(--ink-700)',
          500: 'var(--ink-500)',
          300: 'var(--ink-300)',
          // Decorative and border only — 3.1:1 on white. Never body text.
          200: 'var(--ink-200)',
          DEFAULT: 'var(--ink-900)',
        },
        paper: {
          DEFAULT: 'var(--paper)',
          sunk: 'var(--paper-sunk)',
        },
        card: 'var(--card)',
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },

        // --- Seal: the one accent. Never a status. ---
        seal: {
          600: 'var(--seal-600)',
          500: 'var(--seal-500)',
          tint: 'var(--seal-tint)',
          DEFAULT: 'var(--seal-600)',
        },

        // --- Status. `fill` for icons/borders, `text` for labels, `tint` for grounds. ---
        ok: { DEFAULT: 'var(--ok-fill)', text: 'var(--ok-text)', tint: 'var(--ok-tint)' },
        caution: { DEFAULT: 'var(--warn-fill)', text: 'var(--warn-text)', tint: 'var(--warn-tint)' },

        // --- Legacy names. Still on ~1,100 call sites; each resolves to its new
        //     equivalent so the retune reaches them without an edit. `info`/`critical`
        //     map to the AA-safe `-text` blend because both are used as BARE text
        //     classes (`text-info`, `text-critical`) where the raw hue fails AA. ---
        primary: 'var(--color-primary)',
        action: 'var(--color-action)',
        info: 'var(--color-info-text)',
        warning: 'var(--color-warning)',
        critical: 'var(--color-critical-text)',
        'surface-raised': 'var(--color-surface-raised)',
        'surface-muted': 'var(--color-surface-muted)',
        surface: 'var(--color-surface)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        serif: ['var(--font-display)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
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
        // Density-aware. `p-inset` / `gap-stack` follow the shell's data-density.
        'inset-sm': 'var(--inset-sm)',
        'inset-md': 'var(--inset-md)',
        'inset-lg': 'var(--inset-lg)',
        'stack-xs': 'var(--stack-xs)',
        'stack-sm': 'var(--stack-sm)',
        'stack-md': 'var(--stack-md)',
        'stack-lg': 'var(--stack-lg)',
        'stack-xl': 'var(--stack-xl)',
        topbar: 'var(--topbar-height)',
        leftnav: 'var(--leftnav-width)',
      },
      fontSize: {
        xs: ['var(--text-xs)', { lineHeight: 'var(--leading-body-sm)' }],
        sm: ['var(--text-sm)', { lineHeight: 'var(--leading-body)' }],
        base: ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        lg: ['var(--text-lg)', { lineHeight: 'var(--leading-subtitle)' }],
        xl: ['var(--text-xl)', { lineHeight: 'var(--leading-title-section)' }],
        '2xl': ['var(--text-2xl)', { lineHeight: 'var(--leading-snug)', letterSpacing: '-0.015em' }],
        '3xl': ['var(--text-3xl)', { lineHeight: 'var(--leading-title-page)', letterSpacing: '-0.02em' }],
        '4xl': ['var(--text-4xl)', { lineHeight: 'var(--leading-tight)', letterSpacing: '-0.02em' }],
        // Named scale. `record` is deliberately absent — it needs a font-family switch
        // too, so it ships as the `.record` component class in globals.css.
        display: ['var(--text-display)', { lineHeight: 'var(--leading-display)', letterSpacing: '-0.025em', fontWeight: '500' }],
        'title-page': ['var(--text-title-page)', { lineHeight: 'var(--leading-title-page)', letterSpacing: '-0.02em', fontWeight: '500' }],
        'title-section': ['var(--text-title-section)', { lineHeight: 'var(--leading-title-section)', letterSpacing: '-0.01em', fontWeight: '600' }],
        subtitle: ['var(--text-subtitle)', { lineHeight: 'var(--leading-subtitle)', fontWeight: '600' }],
        body: ['var(--text-body)', { lineHeight: 'var(--leading-body)', fontWeight: '400' }],
        'body-sm': ['var(--text-body-sm)', { lineHeight: 'var(--leading-body-sm)', fontWeight: '400' }],
        label: ['var(--text-label)', { lineHeight: 'var(--leading-label)', letterSpacing: '0.09em', fontWeight: '600' }],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)',
      },
      height: {
        topbar: 'var(--topbar-height)',
        control: 'var(--control-h)',
        row: 'var(--row-h)',
      },
      minHeight: {
        control: 'var(--control-h)',
      },
      width: {
        leftnav: 'var(--leftnav-width)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
      },
      keyframes: {
        'fade-rise': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'fade-rise': 'fade-rise var(--duration-slow) var(--ease-out) both',
      },
    },
  },
  plugins: [],
};

export default config;
