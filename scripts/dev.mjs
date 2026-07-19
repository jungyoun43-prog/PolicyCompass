import http from "node:http";

import worker from "../dist/server/index.js";
import { runClinicalCopilot } from "./clinical-copilot.mjs";

const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const localBaseUrl = `http://127.0.0.1:${port}`;
const allowedHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);
const allowedOrigins = new Set([
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  `http://[::1]:${port}`,
]);

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

function isAllowedHost(host) {
  try {
    const url = new URL(`http://${host}`);
    const portMatches = url.port === String(port) || (!url.port && port === 80);
    return allowedHostnames.has(url.hostname) && portMatches;
  } catch {
    return false;
  }
}

function assertLocalApiRequest(request) {
  if (!isAllowedHost(request.headers.host ?? "")) {
    throw new ApiError(403, "LOCAL_HOST_REQUIRED", "로컬 호스트 요청만 허용합니다.");
  }
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "같은 로컬 출처의 요청만 허용합니다.");
  }
}

async function readJson(request) {
  const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new ApiError(415, "JSON_REQUIRED", "application/json 요청만 허용합니다.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512 * 1024) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "요청은 512KB 이하여야 합니다.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON 요청 형식이 올바르지 않습니다.");
  }
}

function localHeadersFor(pathname, headers) {
  if (!["/emr", "/emr.html"].includes(pathname)) return headers;
  const next = { ...headers };
  const csp = next["content-security-policy"];
  if (typeof csp === "string") next["content-security-policy"] = csp.replace("connect-src 'none'", "connect-src 'self'");
  return next;
}

const server = http.createServer((request, response) => {
  void (async () => {
    const requestTarget = request.url ?? "/";
    if (!requestTarget.startsWith("/")) throw new ApiError(400, "INVALID_TARGET", "요청 경로가 올바르지 않습니다.");
    const url = new URL(requestTarget, localBaseUrl);
    const isApi = url.pathname.startsWith("/api/clinical-copilot");
    if (isApi) assertLocalApiRequest(request);

    if (url.pathname === "/api/clinical-copilot/status" && request.method === "GET") {
      sendJson(response, 200, {
        configured: Boolean(process.env.VITAGRAPH_OLLAMA_MODEL),
        mode: process.env.VITAGRAPH_OLLAMA_MODEL ? "local-model" : "rule-based",
        model: process.env.VITAGRAPH_OLLAMA_MODEL ?? "",
      });
      return;
    }
    if (url.pathname === "/api/clinical-copilot" && request.method === "POST") {
      const payload = await readJson(request);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || !payload.patient || !Array.isArray(payload.patient.events)) {
        throw new ApiError(400, "INVALID_PAYLOAD", "구조화 환자 이벤트가 필요합니다.");
      }
      if (!process.env.VITAGRAPH_OLLAMA_MODEL) {
        sendJson(response, 503, { code: "AI_NOT_CONFIGURED", message: "규칙 기반 요약을 사용합니다." });
        return;
      }
      try {
        const result = await runClinicalCopilot(payload);
        sendJson(response, 200, result);
      } catch {
        throw new ApiError(502, "LOCAL_MODEL_FAILED", "로컬 AI가 유효한 근거 초안을 반환하지 못했습니다.");
      }
      return;
    }
    if (isApi) {
      sendJson(response, 405, { code: "METHOD_NOT_ALLOWED", message: "지원하지 않는 API 요청입니다." });
      return;
    }

    const workerResponse = await worker.fetch(new Request(url, { method: request.method ?? "GET" }));
    const headers = localHeadersFor(url.pathname, Object.fromEntries(workerResponse.headers));
    response.writeHead(workerResponse.status, headers);
    response.end(Buffer.from(await workerResponse.arrayBuffer()));
  })().catch((error) => {
    if (error instanceof ApiError) {
      sendJson(response, error.status, { code: error.code, message: error.message });
      return;
    }
    sendJson(response, 500, { code: "INTERNAL_ERROR", message: "로컬 서버 요청을 처리하지 못했습니다." });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local URL: ${localBaseUrl}`);
});
