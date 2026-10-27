import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Standalone-Ausgabe für ein schlankes Docker-Image
  output: "standalone",
  // Separates Build-Verzeichnis erlaubt einen parallelen Dev-Server für E2E-Tests
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // Zugriff auf den Dev-Server von anderen Geräten im Netzwerk (z. B. "192.168.1.20,mac-mini.local")
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(",").filter(Boolean),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
