import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // SECURITY: Do not ignore TypeScript errors — type safety is critical for auth/tenant isolation
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  // Keep native-optional packages external so Turbopack doesn't try to bundle
  // their platform-specific .node bindings at build time.
  serverExternalPackages: [
    'unpdf',
    'mammoth',
    'heic-decode',
    'sharp',
    '@aws-sdk/client-s3',
  ],
  // SECURITY: Add standard security headers + Content-Security-Policy
  async headers() {
    const csp = [
      "default-src 'self'",
      process.env.NODE_ENV === 'production' ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https:",
      "media-src 'self' data: blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          ...(process.env.NODE_ENV === 'production' ? [
            { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          ] : []),
        ],
      },
    ]
  },
};

export default nextConfig;
