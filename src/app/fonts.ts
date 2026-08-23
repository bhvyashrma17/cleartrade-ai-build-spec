/**
 * The three faces.
 *
 * Chosen against `public/brand/logo-full.svg`, not against a description of it:
 *
 *  - **Playfair Display** for the display. The logo's wordmark is a high-contrast Didone
 *    with vertical stress and ball terminals; Playfair is the closest web-licensed match,
 *    so the product's page titles and the logo are one voice rather than two.
 *  - **Space Grotesk** for the interface. The brand's tagline is set in a geometric sans,
 *    and Space Grotesk is the version of that idea that survives 13px in a dense table:
 *    proportional, quirky where it can afford to be, and completely unlike the Inter that
 *    every other product defaults to.
 *  - **JetBrains Mono** for records. Drawn for reading identifiers character by character,
 *    which is exactly what a filing reference read down a phone line is.
 *
 * Loaded through `next/font/google` so the files are self-hosted, hashed by the build and
 * preloaded, rather than fetched from a third party on every cold load.
 */

import { JetBrains_Mono, Playfair_Display, Space_Grotesk } from 'next/font/google';

export const displaySerif = Playfair_Display({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-display',
});

export const interfaceSans = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const recordMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
});

export const fontVariables = `${displaySerif.variable} ${interfaceSans.variable} ${recordMono.variable}`;
