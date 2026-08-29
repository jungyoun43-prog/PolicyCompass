import { NextResponse } from "next/server";

/**
 * The static build shipped a strict CSP with script-src 'self'. Next.js needs
 * inline bootstrap scripts, so the equivalent posture here is a per-request
 * nonce with strict-dynamic: only scripts we emitted this response may run.
 * model-viewer's WASM needs wasm-unsafe-eval on the pages that render 3D.
 */
export function middleware(request) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const { pathname } = request.nextUrl;
  const needsWasm = ["/emr", "/map"].some((route) => pathname === route || pathname === `${route}.html`);
  const connectSrc = "'self'";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${needsWasm ? " 'wasm-unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|assets|icon.svg).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};
