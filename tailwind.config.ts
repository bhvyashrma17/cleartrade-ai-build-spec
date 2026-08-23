import type { Config } from 'tailwindcss';

/**
 * Token surface for the dark system in src/app/globals.css.
 *
 * Two rules this file exists to hold:
 *
 * 1. **No hex values live here.** Every colour is a `var()`, which is what lets the
 *    density switch and the ground stack reach every call site from one place.
 * 2. **Never put a Tailwind alpha modifier on one of these colours** (`bg-accent/10`).
 *    Tailwind cannot re-compose a bare `var()` into `rgb(… / alpha)`, so the modifier
 *    silently yields transparent — that is exactly how every StatusChip tint in this
 *    product rendered invisible for months. Use a `*-tint` token or `color-mix()`.
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
        // --- Ground stack ---
        ground: 'var(--ground)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        // --- Ink ---
        bone: 'var(--bone)',
        slate: 'var(--slate)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        // --- The one accent. Never a status. ---
        accent: {
          DEFAULT: 'var(--accent)',
          dim: 'var(--accent-dim)',
          tint: 'var(--accent-tint)',
        },
        // --- Status ---
        ok: { DEFAULT: 'var(--ok)', tint: 'var(--ok-tint)' },
        caution: { DEFAULT: 'var(--warn)', tint: 'var(--warn-tint)' },

        // --- Legacy names, still on ~1,100 call sites. Each resolves to its dark
        //     equivalent so the whole product crosses over untouched. ---
        primary: 'var(--color-primary)',
        action: 'var(--color-action)',
        info: 'var(--color-info)',
        warning: 'var(--color-warning)',
        critical: 'var(--color-critical)',
        'surface-raised': 'var(--color-surface-raised)',
        'surface-muted': 'var(--color-surface-muted)',
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
        '1': 'var(--space-1)', '2': 'var(--space-2)', '3': 'var(--space-3)',
        '4': 'var(--space-4)', '5': 'var(--space-5)', '6': 'var(--space-6)',
        '8': 'var(--space-8)', '10': 'var(--space-10)', '12': 'var(--space-12)',
        '16': 'var(--space-16)', '20': 'var(--space-20)', '24': 'var(--space-24)',
        'inset-sm': 'var(--inset-sm)', 'inset-md': 'var(--inset-md)', 'inset-lg': 'var(--inset-lg)',
        'stack-xs': 'var(--stack-xs)', 'stack-sm': 'var(--stack-sm)', 'stack-md': 'var(--stack-md)',
        'stack-lg': 'var(--stack-lg)', 'stack-xl': 'var(--stack-xl)',
        topbar: 'var(--topbar-height)',
      },
      maxWidth: {
        shell: 'var(--shell-max)',
      },
      fontSize: {
        xs: ['var(--text-xs)', { lineHeight: 'var(--leading-body-sm)' }],
        sm: ['var(--text-sm)', { lineHeight: 'var(--leading-body)' }],
        base: ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        lg: ['var(--text-lg)', { lineHeight: 'var(--leading-subtitle)' }],
        xl: ['var(--text-xl)', { lineHeight: 'var(--leading-title-section)', letterSpacing: '-0.01em' }],
        '2xl': ['var(--text-2xl)', { lineHeight: 'var(--leading-snug)', letterSpacing: '-0.02em' }],
        '3xl': ['var(--text-3xl)', { lineHeight: 'var(--leading-title-page)', letterSpacing: '-0.02em' }],
        '4xl': ['var(--text-4xl)', { lineHeight: 'var(--leading-tight)', letterSpacing: '-0.025em' }],
        display: ['var(--text-display)', { lineHeight: 'var(--leading-display)', letterSpacing: '-0.03em', fontWeight: '500' }],
        'title-page': ['var(--text-title-page)', { lineHeight: 'var(--leading-title-page)', letterSpacing: '-0.02em', fontWeight: '500' }],
        'title-section': ['var(--text-title-section)', { lineHeight: 'var(--leading-title-section)', letterSpacing: '-0.01em', fontWeight: '500' }],
        subtitle: ['var(--text-subtitle)', { lineHeight: 'var(--leading-subtitle)', fontWeight: '500' }],
        body: ['var(--text-body)', { lineHeight: 'var(--leading-body)', fontWeight: '400' }],
        'body-sm': ['var(--text-body-sm)', { lineHeight: 'var(--leading-body-sm)', fontWeight: '400' }],
        label: ['var(--text-label)', { lineHeight: 'var(--leading-label)', letterSpacing: '0.14em', fontWeight: '500' }],
        figure: ['var(--text-figure)', { lineHeight: 'var(--leading-figure)', letterSpacing: '-0.03em', fontWeight: '500' }],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)',
        accent: 'var(--glow-accent)',
      },
      height: { topbar: 'var(--topbar-height)', control: 'var(--control-h)', row: 'var(--row-h)' },
      minHeight: { control: 'var(--control-h)' },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: { out: 'var(--ease-out)' },
      keyframes: {
        'fade-rise': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'pop-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        'fade-rise': 'fade-rise var(--duration-slow) var(--ease-out) both',
        'pop-in': 'pop-in var(--duration-normal) var(--ease-out) both',
      },
    },
  },
  plugins: [],
};

export default config;
