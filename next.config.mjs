/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "strict-transport-security", value: "max-age=31536000; includeSubDomains" },
  { key: "x-content-type-options", value: "nosniff" },
  { key: "permissions-policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "x-frame-options", value: "DENY" },
];

const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/medication-claim-review/policy-source": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/@napi-rs/canvas*/**/*",
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
