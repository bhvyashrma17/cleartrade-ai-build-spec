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
        'surface-raised': 'var(--color-surface-raised)',
        'surface-muted': 'var(--color-surface-muted)',
        surface: 'var(--color-surface)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
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
        // docs/27-ui-redesign.md §4.2 scale. `record` is deliberately not here — it
        // needs a font-family switch too, so it ships as the `.record` component
        // class in globals.css instead of a bare text- utility.
        display: ['var(--text-display)', { lineHeight: 'var(--leading-display)', letterSpacing: '-0.02em', fontWeight: '600' }],
        'title-page': ['var(--text-title-page)', { lineHeight: 'var(--leading-title-page)', letterSpacing: '-0.015em', fontWeight: '600' }],
        'title-section': ['var(--text-title-section)', { lineHeight: 'var(--leading-title-section)', fontWeight: '600' }],
        subtitle: ['var(--text-subtitle)', { lineHeight: 'var(--leading-subtitle)', fontWeight: '600' }],
        body: ['var(--text-body)', { lineHeight: 'var(--leading-body)', fontWeight: '400' }],
        'body-sm': ['var(--text-body-sm)', { lineHeight: 'var(--leading-body-sm)', fontWeight: '400' }],
        label: ['var(--text-label)', { lineHeight: 'var(--leading-label)', letterSpacing: '0.06em', fontWeight: '600' }],
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