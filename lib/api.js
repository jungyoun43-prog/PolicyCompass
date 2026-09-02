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
const FRONTIER_REQUEST_LIMIT = 5;

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

const FRONTIER_DAILY_LIMIT_DEFAULT = 300;
const DAILY_KEY_TTL_SECONDS = 172_800;
const dailyFallback = { date: "", count: 0 };

function kstDateKey(now = Date.now()) {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}

function frontierDailyLimit(environment = process.env) {
  const parsed = Number.parseInt(environment.FRONTIER_DAILY_LIMIT ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : FRONTIER_DAILY_LIMIT_DEFAULT;
}

function dailyCounterStore(environment = process.env) {
  const url = environment.KV_REST_API_URL || environment.UPSTASH_REDIS_REST_URL || "";
  const token = environment.KV_REST_API_TOKEN || environment.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;
  try {
    if (new URL(url).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ""), token };
}

async function incrementDailyCounter(key, environment) {
  const store = dailyCounterStore(environment);
  if (store) {
    try {
      const headers = { authorization: `Bearer ${store.token}` };
      const response = await fetch(`${store.url}/incr/${key}`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(1_500),
      });
      const body = await response.json();
      if (response.ok && typeof body?.result === "number") {
        if (body.result === 1) {
          await fetch(`${store.url}/expire/${key}/${DAILY_KEY_TTL_SECONDS}`, {
            method: "POST",
            headers,
            signal: AbortSignal.timeout(1_500),
          }).catch(() => {});
        }
        return body.result;
      }
    } catch {
      // 카운터 장애가 서비스 장애가 되지 않도록 인메모리 근사치로 폴백한다.
    }
  }
  if (dailyFallback.date !== key) {
    dailyFallback.date = key;
    dailyFallback.count = 0;
  }
  dailyFallback.count += 1;
  return dailyFallback.count;
}

/**
 * A shared daily ceiling across every frontier route. The Upstash REST counter
 * makes the cap global across serverless instances; without it (local dev, or
 * a Redis outage) the per-instance tally still provides a rough brake while
 * the per-address window and the gateway-side credit limit keep holding.
 */
export async function assertFrontierDailyBudget(environment = process.env) {
  const used = await incrementDailyCounter(`frontier:${kstDateKey()}`, environment);
  if (used > frontierDailyLimit(environment)) {
    throw new ApiError(429, "FRONTIER_DAILY_LIMITED", "오늘 AI 검토 한도에 도달했습니다. 내일 다시 이용할 수 있습니다.");
  }
}

/**
 * Resolves which provider a payload asks for and stops before any model work
 * when that provider is unusable: frontier calls need explicit consent where
 * the route demands it, and either provider has to be configured server-side.
 */
export function resolveConfiguredProvider(payload, status, { requireConsent = false, unavailableMessage }) {
  const provider = payload.provider === "frontier" ? "frontier" : "local";
  if (requireConsent && provider === "frontier" && payload.consent !== true) {
    throw new ApiError(400, "FRONTIER_CONSENT_REQUIRED", "프론티어 모델 전송 동의가 필요합니다.");
  }
  if (!status()[provider].configured) {
    throw new ApiError(503, provider === "frontier" ? "FRONTIER_NOT_CONFIGURED" : "LOCAL_AI_NOT_CONFIGURED", unavailableMessage);
  }
  return provider;
}

/**
 * Runs one model task under the shared failure contract: a TypeError is the
 * caller's mistake (400 with its message), anything else is the model failing
 * (502 with the route's own wording).
 */
export async function modelResponse(task, { invalidCode, failureCode, failureMessage }) {
  try {
    return jsonResponse(200, await task());
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError(400, invalidCode, error.message);
    throw new ApiError(502, failureCode, failureMessage);
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
