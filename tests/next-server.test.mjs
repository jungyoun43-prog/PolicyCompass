import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";

import { freePort, startNextServer, stopNextServer } from "./helpers/next-app.mjs";

function post(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers, body });
}

test("Next 서버는 보안 헤더와 출처·JSON·크기·오류 상태 계약을 지킨다", async () => {
  const { baseUrl, child } = await startNextServer();
  try {
    for (const route of ["/emr", "/insights", "/map"]) {
      const response = await fetch(`${baseUrl}${route}`);
      const csp = response.headers.get("content-security-policy") ?? "";
      assert.match(csp, /connect-src 'self'/, route);
      assert.match(csp, /default-src 'self'/, route);
      assert.doesNotMatch(csp, /https?:\/\//, route);
      assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains", route);
      assert.equal(response.headers.get("x-frame-options"), "DENY", route);
    }
    const wasmRoutes = { "/emr": true, "/map": true, "/insights": false, "/patient": false };
    for (const [route, expected] of Object.entries(wasmRoutes)) {
      const csp = (await fetch(`${baseUrl}${route}`)).headers.get("content-security-policy") ?? "";
      assert.equal(csp.includes("'wasm-unsafe-eval'"), expected, route);
    }

    const gateway = await fetch(`${baseUrl}/`);
    assert.equal(gateway.status, 200);
    const gatewayHtml = await gateway.text();
    assert.match(gatewayHtml, /사용할 공간을 선택하세요/);
    assert.match((await fetch(`${baseUrl}/patient`).then((r) => r.text())), /PolicyCompass Personal/);
    assert.equal((await fetch(`${baseUrl}/missing`)).status, 404);

    const patientStatus = await fetch(`${baseUrl}/api/patient-question-assistant/status`);
    assert.equal(patientStatus.status, 200);
    const patientStatusBody = await patientStatus.json();
    assert.deepEqual(patientStatusBody.local, { configured: false, model: "" });
    assert.equal(patientStatusBody.frontier.configured, false);
    assert.equal(patientStatusBody.frontier.model, "gpt-5.6-sol");
    assert.equal(patientStatusBody.frontier.reason, "API 키가 설정되지 않았습니다.");
    assert.equal(patientStatusBody.frontier.detected.OPENROUTER_API_KEY, false);
    assert.equal(Object.values(patientStatusBody.frontier.detected).every((value) => typeof value === "boolean"), true);

    const copilot = "/api/clinical-copilot";
    const jsonHeaders = { "content-type": "application/json", origin: baseUrl };

    const forbidden = await post(baseUrl, copilot, "{}", { "content-type": "application/json", origin: "https://evil.example" });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).code, "ORIGIN_NOT_ALLOWED");

    const wrongType = await post(baseUrl, copilot, "{}", { "content-type": "text/plain", origin: baseUrl });
    assert.equal(wrongType.status, 415);

    const unconfigured = await post(baseUrl, copilot, JSON.stringify({ patient: { events: [] } }), jsonHeaders);
    assert.equal(unconfigured.status, 503);
    assert.equal((await unconfigured.json()).code, "AI_NOT_CONFIGURED");

    const consentMissing = await post(baseUrl, "/api/patient-question-assistant", JSON.stringify({ provider: "frontier", consent: false }), jsonHeaders);
    assert.equal(consentMissing.status, 400);
    assert.equal((await consentMissing.json()).code, "FRONTIER_CONSENT_REQUIRED");

    const frontierUnconfigured = await post(baseUrl, "/api/patient-question-assistant", JSON.stringify({ provider: "frontier", consent: true }), jsonHeaders);
    assert.equal(frontierUnconfigured.status, 503);
    assert.equal((await frontierUnconfigured.json()).code, "FRONTIER_NOT_CONFIGURED");

    const snapshotPayload = {
      clinicalSnapshot: {
        schema: "policycompass-clinical-snapshot",
        version: 1,
        healthMap: {
          conditions: [{ id: "hypertension", label: "고혈압", recordedOn: "2026-07-01" }],
          measurements: [],
        },
        medications: [{
          code: "ACE-001",
          label: "ACE 억제제",
          prescribedOn: "2026-07-10",
          dose: 1,
          doseUnit: "정",
          route: "경구",
          frequency: "1일 1회",
          durationDays: 30,
        }],
      },
      selfReport: { summary: "야간 기침이 있습니다." },
    };
    const insightsResponse = await post(baseUrl, "/api/connection-insights", JSON.stringify(snapshotPayload), jsonHeaders);
    assert.equal(insightsResponse.status, 200);
    const insightsBody = await insightsResponse.json();
    assert.equal(insightsBody.mode, "rule-based");
    assert.ok(insightsBody.insights.length >= 1);

    const reviewStart = await post(baseUrl, "/api/claim-review/start", JSON.stringify({
      evaluation: {
        id: "claim-1",
        title: "고혈압 추적검사",
        status: "missing-evidence",
        explanation: "최근 검사 기록이 없습니다.",
        missingEvidence: ["최근 혈액검사"],
        evidenceEventIds: ["e1"],
      },
      events: [{ id: "e1", label: "고혈압", date: "2026-01-01" }],
    }), jsonHeaders);
    assert.equal(reviewStart.status, 200);
    const startedReview = await reviewStart.json();
    assert.equal(startedReview.status, "awaiting-review");
    assert.ok(startedReview.threadId);

    const reviewResume = await post(baseUrl, "/api/claim-review/resume", JSON.stringify({
      threadId: startedReview.threadId,
      action: "approve",
      note: "확인",
    }), jsonHeaders);
    assert.equal(reviewResume.status, 200);
    const completedReview = await reviewResume.json();
    assert.equal(completedReview.status, "completed");
    assert.equal(completedReview.result.status, "clinician-confirmed");

    const refineUnconfigured = await post(baseUrl, "/api/patient-question-assistant/refine", JSON.stringify({ ...snapshotPayload, instruction: "더 짧게 바꿔줘" }), jsonHeaders);
    assert.equal(refineUnconfigured.status, 503);
    assert.equal((await refineUnconfigured.json()).code, "LOCAL_AI_NOT_CONFIGURED");
  } finally {
    await stopNextServer(child);
  }
});

test("Next 서버는 유효한 Ollama 초안만 전달하고 실패를 502로 격리한다", async () => {
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
  const { baseUrl, child } = await startNextServer({
    POLICYCOMPASS_OLLAMA_MODEL: "test-local-model",
    POLICYCOMPASS_OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
  });
  const payload = JSON.stringify({
    asOf: "2026-07-19",
    patient: { events: [{ id: "event-1", type: "observation", code: "85354-9", label: "혈압", date: "2026-07-19", value: "130/80", unit: "mmHg" }] },
    claimEvaluations: [],
  });
  const jsonHeaders = { "content-type": "application/json", origin: baseUrl };
  try {
    const success = await post(baseUrl, "/api/clinical-copilot", payload, jsonHeaders);
    assert.equal(success.status, 200);
    assert.equal((await success.json()).kind, "model");

    invalidModelResponse = true;
    const failed = await post(baseUrl, "/api/clinical-copilot", payload, jsonHeaders);
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).code, "LOCAL_MODEL_FAILED");
  } finally {
    await stopNextServer(child);
    await new Promise((resolve) => ollama.close(resolve));
  }
});

test("배포 구성은 Next 기본 감지에 맡기고 이전 커스텀 서버를 남기지 않는다", async () => {
  const packageConfig = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageConfig.scripts.build, "next build");
  assert.equal(packageConfig.scripts.start, "next start");
  assert.equal(packageConfig.scripts.dev, "next dev");

  const vercelConfig = JSON.parse(await readFile("vercel.json", "utf8"));
  assert.equal(vercelConfig.framework, "nextjs");
  assert.equal(vercelConfig.buildCommand, null);
  assert.equal(vercelConfig.outputDirectory, null);

  for (const stale of ["render.yaml", "api/index.js", "scripts/server.mjs", "scripts/app-server.mjs", "scripts/build.mjs", "scripts/dev.mjs"]) {
    const missing = await readFile(stale, "utf8").then(() => false, () => true);
    assert.equal(missing, true, `${stale}은 제거되어야 합니다`);
  }

  const middleware = await readFile("middleware.js", "utf8");
  assert.match(middleware, /content-security-policy/);
  assert.match(middleware, /strict-dynamic/);

  for (const route of [
    "app/api/connection-insights/route.js",
    "app/api/patient-question-assistant/route.js",
    "app/api/patient-question-assistant/refine/route.js",
    "app/api/medication-claim-review/route.js",
    "app/api/clinical-copilot/route.js",
  ]) {
    assert.match(await readFile(route, "utf8"), /export const maxDuration = 60/, route);
  }
});
