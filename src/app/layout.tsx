import type { Metadata, Viewport } from 'next';
import { fontVariables } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ClearTrade AI',
    template: '%s · ClearTrade',
  },
  description: 'Structured exports. Zero chaos.',
  icons: {
    icon: [{ url: '/brand/mark.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/brand/mark-app.svg', type: 'image/svg+xml' }],
  },
};

export const viewport: Viewport = {
  // The chrome is ink, not the old navy — the browser UI on Android matched a colour the
  // product no longer uses anywhere.
  themeColor: '#15171B',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-screen bg-paper text-ink-900 antialiased">{children}</body>
    </html>
  );
}
