import type { Metadata, Viewport } from 'next';
import { fontVariables } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ClearTrade',
    template: '%s · ClearTrade',
  },
  description: 'Structured exports. Zero chaos.',
  // The real brand files, straight from the logo package — not a redrawn approximation.
  icons: {
    icon: [
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/brand/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  // The product is dark now; this is the ground, so the browser chrome on Android and the
  // overscroll gutter on iOS match the page instead of flashing white against it.
  themeColor: '#0C0E11',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-screen bg-ground text-bone antialiased">{children}</body>
    </html>
  );
}
