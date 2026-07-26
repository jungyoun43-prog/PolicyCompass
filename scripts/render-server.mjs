import http from "node:http";

import worker from "../dist/server/index.js";
import {
  patientQuestionAssistantStatus,
  runPatientQuestionAssistant,
} from "./patient-question-assistant.mjs";

const port = Number.parseInt(process.env.PORT ?? "10000", 10);
const frontierWindows = new Map();
const FRONTIER_WINDOW_MS = 60_000;
const FRONTIER_REQUEST_LIMIT = 12;

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
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function assertSameOrigin(request) {
  const fetchSite = String(request.headers["sec-fetch-site"] ?? "");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "같은 VitaGraph 출처의 요청만 허용합니다.");
  }
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== request.headers.host) throw new Error("host mismatch");
  } catch {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "같은 VitaGraph 출처의 요청만 허용합니다.");
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
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "정제 질문 요청은 256KB 이하여야 합니다.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON 요청 형식이 올바르지 않습니다.");
  }
}

function runtimeHeaders(pathname, headers) {
  if (!["/insights", "/insights.html"].includes(pathname)) return headers;
  const next = { ...headers };
  if (typeof next["content-security-policy"] === "string") {
    next["content-security-policy"] = next["content-security-policy"].replace("connect-src 'none'", "connect-src 'self'");
  }
  return next;
}

const server = http.createServer((request, response) => {
  void (async () => {
    const host = request.headers.host ?? `127.0.0.1:${port}`;
    const url = new URL(request.url ?? "/", `http://${host}`);
    const isPatientApi = url.pathname.startsWith("/api/patient-question-assistant");
    if (isPatientApi) {
      assertSameOrigin(request);
      if (url.pathname === "/api/patient-question-assistant/status" && request.method === "GET") {
        sendJson(response, 200, patientQuestionAssistantStatus());
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
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port ${port}`);
});
