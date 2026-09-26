import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  poweredByHeader: false,
  // Opt-in so the ordinary `npm run build` + `npm start` workflow is unchanged.
  // The container build sets BUILD_STANDALONE=1 to emit a self-contained server.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Only in production: sending HSTS from http://localhost would pin the
          // browser to HTTPS for localhost and break local development.
          ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
