/**
 * The same request contract the node server enforced: JSON errors with codes,
 * a same-origin gate for patient-derived payloads, a body-size ceiling, and a
 * per-address window for frontier calls.
 */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
  });
}

export function assertSameOrigin(request) {
  const fetchSite = request.headers.get("sec-fetch-site") ?? "";
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "같은 PolicyCompass 출처의 요청만 허용합니다.");
  }
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    if (new URL(origin).host !== request.headers.get("host")) throw new Error("host mismatch");
  } catch {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "같은 PolicyCompass 출처의 요청만 허용합니다.");
  }
}

const MAX_JSON_BYTES = 256 * 1024;

export async function readJson(request) {
  if (!String(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "JSON_REQUIRED", "application/json 요청만 허용합니다.");
  }
  const raw = await request.text();
  if (raw.length > MAX_JSON_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "요청은 256KB 이하여야 합니다.");
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON 요청 형식이 올바르지 않습니다.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(400, "INVALID_PAYLOAD", "요청 데이터가 필요합니다.");
  }
  return payload;
}

const frontierWindows = new Map();
const FRONTIER_WINDOW_MS = 60_000;
const FRONTIER_REQUEST_LIMIT = 12;

export function assertFrontierRequestAllowed(request) {
  const forwarded = String(request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const key = forwarded || "unknown";
  const now = Date.now();
  const current = frontierWindows.get(key);
  const next = !current || now - current.startedAt >= FRONTIER_WINDOW_MS
    ? { startedAt: now, count: 1 }
    : { ...current, count: current.count + 1 };
  frontierWindows.set(key, next);
  if (frontierWindows.size > 2_000) {
    for (const [candidate, window] of frontierWindows) {
      if (now - window.startedAt >= FRONTIER_WINDOW_MS) frontierWindows.delete(candidate);
    }
  }
  if (next.count > FRONTIER_REQUEST_LIMIT) {
    throw new ApiError(429, "FRONTIER_RATE_LIMITED", "프론티어 요청이 너무 많습니다. 잠시 후 다시 시도하세요.");
  }
}

export function withApiErrors(handler) {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) return jsonResponse(error.status, { code: error.code, message: error.message });
      return jsonResponse(500, { code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다." });
    }
  };
}
