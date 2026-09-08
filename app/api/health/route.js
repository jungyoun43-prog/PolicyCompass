export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", revision: process.env.APP_REVISION ?? "unknown" }, { headers: { "cache-control": "no-store" } });
}
