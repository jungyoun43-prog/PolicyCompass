import worker from "../dist/server/index.js";
import { runConnectionInsights } from "./graphs/connection-insights-graph.mjs";
import {
  medicationClaimReviewStatus,
  runMedicationClaimReview,
} from "./graphs/medication-claim-review-graph.mjs";
import { runQuestionRefine } from "./graphs/question-refine-graph.mjs";
import {
  patientQuestionAssistantStatus,
  runPatientQuestionAssistant,
} from "./patient-question-assistant.mjs";

const frontierWindows = new Map();
const FRONTIER_WINDOW_MS = 60_000;
const FRONTIER_REQUEST_LIMIT = 12;
const MAX_JSON_BYTES = 256 * 1024;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function assertSameOrigin(request) {
  const fetchSite = String(request.headers["sec-fetch-site"] ?? "");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "같은 PolicyCompass 출처의 요청만 허용합니다.");
  }
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== request.headers.host) throw new Error("host mismatch");
  } catch {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "같은 PolicyCompass 출처의 요청만 허용합니다.");
  }
}

function assertFrontierRequestAllowed(request) {
  if (!request.headers.origin) {
    throw new ApiError(403, "BROWSER_ORIGIN_REQUIRED", "프론티어 요청에는 같은 출처의 브라우저 확인이 필요합니다.");
  }
  const forwarded = String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const key = forwarded || request.socket.remoteAddress || "unknown";
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
    throw new ApiError(429, "FRONTIER_RATE_LIMITED", "프론티어 질문 요청이 너무 많습니다. 잠시 후 다시 시도하세요.");
  }
}

async function readJson(request) {
  if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "JSON_REQUIRED", "application/json 요청만 허용합니다.");
  }
  // Vercel's Node runtime parses JSON bodies before the handler runs, which drains the stream.
  if (request.body !== undefined && request.body !== null) {
    if (typeof request.body === "string") {
      try {
        return JSON.parse(request.body || "{}");
      } catch {
        throw new ApiError(400, "INVALID_JSON", "JSON 요청 형식이 올바르지 않습니다.");
      }
    }
    if (typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
    if (Buffer.isBuffer(request.body)) {
      if (request.body.length > MAX_JSON_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "정제 질문 요청은 256KB 이하여야 합니다.");
      try {
        return JSON.parse(request.body.toString("utf8") || "{}");
      } catch {
        throw new ApiError(400, "INVALID_JSON", "JSON 요청 형식이 올바르지 않습니다.");
      }
    }
  }
  const chunks = []; 
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "정제 질문 요청은 256KB 이하여야 합니다.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON 요청 형식이 올바르지 않습니다.");
  }
}

/**
 * Vercel rewrites every path to this function. The platform normally forwards the
 * original path, but a bare `/api` or `/api/index` means the rewrite target leaked
 * through, so fall back to the site root instead of a 404.
 */
function requestPath(target) {
  return ["/api", "/api/index", "/api/index.js"].includes(target) ? "/" : target;
}

function runtimeHeaders(pathname, headers) {
  if (!["/emr", "/emr.html", "/insights", "/insights.html"].includes(pathname)) return headers;
  const next = { ...headers };
  if (typeof next["content-security-policy"] === "string") {
    next["content-security-policy"] = next["content-security-policy"].replace("connect-src 'none'", "connect-src 'self'");
  }
  return next;
}

/**
 * Serves the built PolicyCompass worker plus the same-origin AI APIs.
 * The signature is the Node `(request, response)` pair so the same handler backs
 * both `scripts/server.mjs` and the Vercel Serverless Function in `api/index.js`.
 */
export function handleNodeRequest(request, response) {
  void (async () => {
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(requestPath(request.url ?? "/"), `http://${host}`);
    const isPatientApi = url.pathname.startsWith("/api/patient-question-assistant");
    if (isPatientApi) {
      assertSameOrigin(request);
      if (url.pathname === "/api/patient-question-assistant/status" && request.method === "GET") {
        sendJson(response, 200, patientQuestionAssistantStatus());
        return;
      }
      if (url.pathname === "/api/patient-question-assistant/refine" && request.method === "POST") {
        const payload = await readJson(request);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new ApiError(400, "INVALID_PAYLOAD", "질문 다듬기 요청 데이터가 필요합니다.");
        }
        const provider = payload.provider === "frontier" ? "frontier" : "local";
        if (provider === "frontier" && payload.consent !== true) {
          throw new ApiError(400, "FRONTIER_CONSENT_REQUIRED", "프론티어 모델 전송 동의가 필요합니다.");
        }
        const status = patientQuestionAssistantStatus();
        if (!status[provider].configured) {
          sendJson(response, 503, {
            code: provider === "frontier" ? "FRONTIER_NOT_CONFIGURED" : "LOCAL_AI_NOT_CONFIGURED",
            message: "질문 다듬기에는 AI 설정이 필요합니다.",
          });
          return;
        }
        if (provider === "frontier") assertFrontierRequestAllowed(request);
        try {
          sendJson(response, 200, await runQuestionRefine(payload));
        } catch (error) {
          if (error instanceof TypeError) {
            throw new ApiError(400, "INVALID_REFINE_REQUEST", error.message);
          }
          throw new ApiError(502, "REFINE_FAILED", "질문을 다듬지 못했습니다.");
        }
        return;
      }
      if (url.pathname === "/api/patient-question-assistant" && request.method === "POST") {
        const payload = await readJson(request);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new ApiError(400, "INVALID_PAYLOAD", "정제 질문 준비 데이터가 필요합니다.");
        }
        const provider = payload.provider === "frontier" ? "frontier" : "local";
        if (provider === "frontier" && payload.consent !== true) {
          throw new ApiError(400, "FRONTIER_CONSENT_REQUIRED", "프론티어 모델 전송 동의가 필요합니다.");
        }
        const status = patientQuestionAssistantStatus();
        if (!status[provider].configured) {
          sendJson(response, 503, {
            code: provider === "frontier" ? "FRONTIER_NOT_CONFIGURED" : "LOCAL_AI_NOT_CONFIGURED",
            message: "규칙 기반 질문을 사용합니다.",
          });
          return;
        }
        if (provider === "frontier") assertFrontierRequestAllowed(request);
        try {
          sendJson(response, 200, await runPatientQuestionAssistant(payload));
        } catch (error) {
          if (error instanceof TypeError) {
            throw new ApiError(400, "INVALID_PATIENT_CONTEXT", error.message);
          }
          throw new ApiError(502, "PATIENT_MODEL_FAILED", "선택한 AI가 유효한 근거 질문을 반환하지 못했습니다.");
        }
        return;
      }
      sendJson(response, 405, { code: "METHOD_NOT_ALLOWED", message: "지원하지 않는 API 요청입니다." });
      return;
    }
    if (url.pathname.startsWith("/api/medication-claim-review")) {
      assertSameOrigin(request);
      if (url.pathname === "/api/medication-claim-review/status" && request.method === "GET") {
        sendJson(response, 200, medicationClaimReviewStatus());
        return;
      }
      if (url.pathname !== "/api/medication-claim-review" || request.method !== "POST") {
        sendJson(response, 405, { code: "METHOD_NOT_ALLOWED", message: "지원하지 않는 API 요청입니다." });
        return;
      }
      const payload = await readJson(request);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new ApiError(400, "INVALID_PAYLOAD", "약제 급여 사전점검 비교 결과가 필요합니다.");
      }
      const provider = payload.provider === "frontier" ? "frontier" : "local";
      const status = medicationClaimReviewStatus();
      if (!status[provider].configured) {
        sendJson(response, 503, {
          code: provider === "frontier" ? "FRONTIER_NOT_CONFIGURED" : "LOCAL_AI_NOT_CONFIGURED",
          message: "AI 검토가 설정되지 않아 규칙 기반 사전점검을 사용합니다.",
        });
        return;
      }
      if (provider === "frontier") assertFrontierRequestAllowed(request);
      try {
        sendJson(response, 200, await runMedicationClaimReview(payload));
      } catch (error) {
        if (error instanceof TypeError) {
          throw new ApiError(400, "INVALID_MEDICATION_REVIEW", error.message);
        }
        throw new ApiError(502, "MEDICATION_REVIEW_FAILED", "약제 급여 사전점검 초안을 만들지 못했습니다.");
      }
      return;
    }
    if (url.pathname === "/api/connection-insights") {
      assertSameOrigin(request);
      if (request.method !== "POST") {
        sendJson(response, 405, { code: "METHOD_NOT_ALLOWED", message: "지원하지 않는 API 요청입니다." });
        return;
      }
      const payload = await readJson(request);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new ApiError(400, "INVALID_PAYLOAD", "정제 건강 지도 데이터가 필요합니다.");
      }
      try {
        sendJson(response, 200, await runConnectionInsights(payload));
      } catch (error) {
        if (error instanceof TypeError) {
          throw new ApiError(400, "INVALID_PATIENT_CONTEXT", error.message);
        }
        throw new ApiError(502, "CONNECTION_INSIGHTS_FAILED", "관계 근거를 생성하지 못했습니다.");
      }
      return;
    }
    const workerResponse = await worker.fetch(
      new Request(url, { method: request.method ?? "GET" }),
    );
    response.writeHead(
      workerResponse.status,
      runtimeHeaders(url.pathname, Object.fromEntries(workerResponse.headers)),
    );
    response.end(Buffer.from(await workerResponse.arrayBuffer()));
  })().catch((error) => {
    if (error instanceof ApiError) {
      sendJson(response, error.status, { code: error.code, message: error.message });
      return;
    }
    sendJson(response, 500, { code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다." });
  });
}

export default handleNodeRequest;
