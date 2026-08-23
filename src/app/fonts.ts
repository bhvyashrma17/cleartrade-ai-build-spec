/**
 * The three faces — docs/ui-design.md §2.
 *
 * Loaded through `next/font/google` rather than a `<link>` to fonts.googleapis.com so the
 * files are self-hosted from our own origin, hashed by the build, and preloaded. The old
 * `<link>` cost two DNS handshakes on every cold load and shipped a render-blocking
 * stylesheet from a third party — visible as a flash of Times New Roman on the masthead,
 * which is the single most brand-critical glyph run on the page.
 */

import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from 'next/font/google';

/**
 * Masthead. A newspaper-of-record serif — the brand is an instrument of record, and the
 * mark reads as a customs die. Deliberately NOT Instrument Serif: that face plus warm
 * cream is the current house style of every AI-generated landing page (docs/27 §3.1
 * warns against exactly this), and the product was wearing it.
 */
export const displaySerif = Newsreader({
  subsets: ['latin'],
  // No `weight`: Newsreader ships as a variable font, so the whole 200-800 range arrives
  // in one file and `axes` may only be declared when the weight axis is left variable.
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-display',
  // Newsreader is optical-size variable; pin the display cut so 30-52px titles get the
  // tighter fitting and finer hairlines rather than the text cut scaled up.
  axes: ['opsz'],
});

/** Interface. IBM's institutional grotesque — engineered, not startup-neutral, and it is
 *  the sibling of the mono below, so the UI and the record set share one skeleton. */
export const interfaceSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans',
});

/** Record. Every reference number in the product — docs/ui-design.md §2.3. */
export const recordMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
});

export const fontVariables = `${displaySerif.variable} ${interfaceSans.variable} ${recordMono.variable}`;
