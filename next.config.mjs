/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "strict-transport-security", value: "max-age=31536000; includeSubDomains" },
  { key: "x-content-type-options", value: "nosniff" },
  { key: "permissions-policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "x-frame-options", value: "DENY" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
