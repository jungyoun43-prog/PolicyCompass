import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import test from "node:test";

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startDevServer(environment = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/dev.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`로컬 서버 조기 종료: ${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/clinical-copilot/status`);
      if (response.ok) return { baseUrl, child, port };
    } catch {
      // Startup polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGKILL");
  throw new Error(`로컬 서버 시작 시간 초과: ${output}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 2_000)),
  ]);
}

function post(baseUrl, body, headers = {}) {
  return fetch(`${baseUrl}/api/clinical-copilot`, {
    method: "POST",
    headers,
    body,
  });
}

test("로컬 개발 서버는 출처·JSON·크기·오류 상태 계약을 지킨다", async () => {
  const { baseUrl, child } = await startDevServer();
  try {
    const emr = await fetch(`${baseUrl}/emr`);
    assert.match(emr.headers.get("content-security-policy") ?? "", /connect-src 'self'/);

    const forbidden = await post(baseUrl, "{}", { "content-type": "application/json", origin: "https://evil.example" });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).code, "ORIGIN_NOT_ALLOWED");

    const wrongType = await post(baseUrl, "{}", { "content-type": "text/plain", origin: baseUrl });
    assert.equal(wrongType.status, 415);

    const malformed = await post(baseUrl, "{", { "content-type": "application/json", origin: baseUrl });
    assert.equal(malformed.status, 400);

    const oversized = await post(baseUrl, JSON.stringify({ padding: "x".repeat(513 * 1024) }), { "content-type": "application/json", origin: baseUrl });
    assert.equal(oversized.status, 413);

    const unconfigured = await post(baseUrl, JSON.stringify({ patient: { events: [] } }), { "content-type": "application/json", origin: baseUrl });
    assert.equal(unconfigured.status, 503);
    assert.equal((await unconfigured.json()).code, "AI_NOT_CONFIGURED");
  } finally {
    await stopChild(child);
  }
});

test("로컬 개발 서버는 유효한 Ollama 초안만 전달하고 실패를 502로 격리한다", async () => {
  let invalidModelResponse = false;
  const ollamaPort = await freePort();
  const ollama = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      model: "test-local-model",
      created_at: "2026-07-19T10:00:00Z",
      message: {
        role: "assistant",
        content: invalidModelResponse ? "not-json" : JSON.stringify({
          summary: [{ text: "혈압 기록이 있습니다.", evidenceEventIds: ["event-1"] }],
          priorities: [{ title: "혈압 확인", reason: "최근 측정", evidenceEventIds: ["event-1"] }],
          questions: [{ question: "혈압을 다시 확인할까요?", reason: "최근 측정", evidenceEventIds: ["event-1"] }],
          warnings: [],
        }),
      },
    }));
  });
  await new Promise((resolve, reject) => ollama.listen(ollamaPort, "127.0.0.1", resolve).once("error", reject));
  const { baseUrl, child } = await startDevServer({
    VITAGRAPH_OLLAMA_MODEL: "test-local-model",
    VITAGRAPH_OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
  });
  const payload = JSON.stringify({
    asOf: "2026-07-19",
    patient: { events: [{ id: "event-1", type: "observation", code: "85354-9", label: "혈압", date: "2026-07-19", value: "130/80", unit: "mmHg" }] },
    claimEvaluations: [],
  });
  try {
    const success = await post(baseUrl, payload, { "content-type": "application/json", origin: baseUrl });
    assert.equal(success.status, 200);
    assert.equal((await success.json()).kind, "model");

    invalidModelResponse = true;
    const failed = await post(baseUrl, payload, { "content-type": "application/json", origin: baseUrl });
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).code, "LOCAL_MODEL_FAILED");
  } finally {
    await stopChild(child);
    await new Promise((resolve) => ollama.close(resolve));
  }
});
