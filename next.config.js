/** @type {import('next').NextConfig} */

/**
 * Security response headers (Phase 14).
 *
 * HSTS is emitted only in real environments — sending it from a local http:// dev server
 * would pin the browser to https for localhost and break development for anyone who loads
 * the app once.
 */
const isRealEnvironment = ['production', 'staging'].includes(process.env.APP_ENV);

const securityHeaders = [
  // Clickjacking. The app is never intended to be framed.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // No app surface needs camera/mic/geolocation; deny by default rather than by omission.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Documents are served as downloads through an authenticated route; block cross-origin
  // resource loading of anything this app serves.
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  ...(isRealEnvironment
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Never leak the framework version to unauthenticated callers.
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
