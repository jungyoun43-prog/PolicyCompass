import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  callFrontierModel,
  frontierApiStyle,
  frontierBaseUrl,
} from "../scripts/patient-question-assistant.mjs";
import { findMedicationInCatalog } from "../src/medication-catalog.js";
import { buildMedicationClaimComparison } from "../src/medication-claim-review.js";
import { createDemoEmrState } from "../src/emr-model.js";
import { runMedicationClaimReview } from "../scripts/graphs/medication-claim-review-graph.mjs";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

function recorder(payload) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return { ok: true, json: async () => payload };
  };
  return { calls, fetchImpl };
}

test("기본 게이트웨이는 OpenAI Responses API를 그대로 사용한다", async () => {
  // Given
  const { calls, fetchImpl } = recorder({ model: "gpt-5.6-sol", output_text: '{"answer":"ok"}' });

  // When
  const result = await callFrontierModel({
    apiKey: "test-key",
    model: "gpt-5.6-sol",
    instructions: "지시문",
    input: "입력",
    schemaName: "demo",
    schema: SCHEMA,
    fetchImpl,
    environment: {},
  });

  // Then
  assert.equal(frontierBaseUrl({}), "https://api.openai.com/v1");
  assert.equal(frontierApiStyle({}), "responses");
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].body.instructions, "지시문");
  assert.equal(calls[0].body.text.format.type, "json_schema");
  assert.equal(calls[0].headers.authorization, "Bearer test-key");
  assert.equal(result.text, '{"answer":"ok"}');
});

test("OpenRouter 설정은 chat completions 형식으로 보낸다", async () => {
  // Given
  const environment = {
    POLICYCOMPASS_FRONTIER_BASE_URL: "https://openrouter.ai/api/v1",
    POLICYCOMPASS_FRONTIER_API: "chat",
    POLICYCOMPASS_FRONTIER_SITE_URL: "https://example.test",
    POLICYCOMPASS_FRONTIER_APP_NAME: "PolicyCompass",
  };
  const { calls, fetchImpl } = recorder({
    model: "openai/gpt-4.1-mini",
    choices: [{ message: { content: '{"answer":"ok"}' } }],
  });

  // When
  const result = await callFrontierModel({
    apiKey: "or-key",
    model: "openai/gpt-4.1-mini",
    instructions: "지시문",
    input: "입력",
    schemaName: "demo",
    schema: SCHEMA,
    fetchImpl,
    environment,
  });

  // Then
  assert.equal(frontierApiStyle(environment), "chat");
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.deepEqual(calls[0].body.messages, [
    { role: "system", content: "지시문" },
    { role: "user", content: "입력" },
  ]);
  assert.deepEqual(calls[0].body.response_format, {
    type: "json_schema",
    json_schema: { name: "demo", strict: true, schema: SCHEMA },
  });
  assert.equal(calls[0].headers["http-referer"], "https://example.test");
  assert.equal(calls[0].headers["x-title"], "PolicyCompass");
  assert.equal(result.text, '{"answer":"ok"}');
  assert.equal(result.model, "openai/gpt-4.1-mini");
});

test("게이트웨이 주소는 https만 허용하고 후행 슬래시를 정리한다", () => {
  // Given / When / Then
  assert.equal(frontierBaseUrl({ POLICYCOMPASS_FRONTIER_BASE_URL: "https://openrouter.ai/api/v1/" }), "https://openrouter.ai/api/v1");
  assert.throws(() => frontierBaseUrl({ POLICYCOMPASS_FRONTIER_BASE_URL: "http://openrouter.ai/api/v1" }), /https만 허용/);
  assert.throws(() => frontierBaseUrl({ POLICYCOMPASS_FRONTIER_BASE_URL: "openrouter" }), /올바른 URL이 아닙니다/);
});

test("모델 거부와 실패 응답은 그대로 오류로 올라온다", async () => {
  // Given
  const chat = { POLICYCOMPASS_FRONTIER_BASE_URL: "https://openrouter.ai/api/v1", POLICYCOMPASS_FRONTIER_API: "chat" };
  const refusal = async () => ({ ok: true, json: async () => ({ choices: [{ message: { refusal: "거부" } }] }) });
  const failure = async () => ({ ok: false, status: 402, json: async () => ({ error: { message: "크레딧 부족" } }) });

  // When / Then
  await assert.rejects(() => callFrontierModel({
    apiKey: "k", model: "m", instructions: "i", input: "x", schemaName: "d", schema: SCHEMA, fetchImpl: refusal, environment: chat,
  }), /응답을 거부했습니다/);
  await assert.rejects(() => callFrontierModel({
    apiKey: "k", model: "m", instructions: "i", input: "x", schemaName: "d", schema: SCHEMA, fetchImpl: failure, environment: chat,
  }), /요청 실패 \(402\): 크레딧 부족/);
});

test("약제 삭감 검토도 OpenRouter 설정을 그대로 따른다", async () => {
  // Given
  const demo = createDemoEmrState("2026-07-20");
  const medication = findMedicationInCatalog("amoxicillin-clavulanate-625");
  const comparison = buildMedicationClaimComparison({
    patient: demo.patients.find(({ name }) => name === "김비타"),
    medication,
    prescription: medication.dosing,
    asOf: "2026-07-20",
  });
  const environment = {
    OPENAI_API_KEY: "or-key",
    POLICYCOMPASS_FRONTIER_ENABLED: "true",
    POLICYCOMPASS_FRONTIER_MODEL: "anthropic/claude-sonnet-4.5",
    POLICYCOMPASS_FRONTIER_BASE_URL: "https://openrouter.ai/api/v1",
    POLICYCOMPASS_FRONTIER_API: "chat",
  };
  const { calls, fetchImpl } = recorder({
    model: "anthropic/claude-sonnet-4.5",
    choices: [{ message: { content: JSON.stringify({
      verdict: "cross",
      summary: "등록된 알레르기 성분과 이번 처방 성분명이 일치합니다.",
      rationale: ["알레르기 기록과 성분명이 일치합니다."],
      citedCheckIds: ["allergy"],
    }) } }],
  });

  // When
  const result = await runMedicationClaimReview({ comparison, provider: "frontier" }, { environment, fetchImpl });

  // Then
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(result.draft.generatedBy, "frontier-model");
  assert.equal(result.draft.model, "anthropic/claude-sonnet-4.5");
  assert.equal(result.draft.verdict, "cross");
  assert.equal(JSON.stringify(calls[0].body).includes("김비타"), false);
});

test("OPENROUTER_API_KEY 하나로 게이트웨이·형식·활성화가 함께 정해진다", async () => {
  // Given
  const { frontierCredentials } = await import("../scripts/patient-question-assistant.mjs");
  const { medicationClaimReviewStatus } = await import("../scripts/graphs/medication-claim-review-graph.mjs");
  const minimal = { OPENROUTER_API_KEY: "sk-or-1", POLICYCOMPASS_FRONTIER_MODEL: "openai/gpt-4o" };

  // When
  const credentials = frontierCredentials(minimal);
  const status = medicationClaimReviewStatus(minimal).frontier;

  // Then
  assert.equal(credentials.viaOpenRouter, true);
  assert.equal(status.configured, true);
  assert.equal(status.model, "openai/gpt-4o");
  assert.equal(frontierApiStyle(minimal), "chat");
  assert.equal(frontierBaseUrl(minimal), "https://openrouter.ai/api/v1");
});

test("키만 있고 모델이 없으면 켜지 않고 이유를 알려 준다", async () => {
  // Given
  const { frontierCredentials } = await import("../scripts/patient-question-assistant.mjs");
  const { medicationClaimReviewStatus } = await import("../scripts/graphs/medication-claim-review-graph.mjs");

  // When
  const noModel = frontierCredentials({ OPENROUTER_API_KEY: "sk-or-1" });
  const noKey = frontierCredentials({});
  const notEnabled = frontierCredentials({ OPENAI_API_KEY: "sk-1" });

  // Then
  assert.equal(noModel.configured, false);
  assert.match(noModel.reason, /POLICYCOMPASS_FRONTIER_MODEL/);
  assert.match(noKey.reason, /API 키가 설정되지 않았습니다/);
  assert.match(notEnabled.reason, /POLICYCOMPASS_FRONTIER_ENABLED=true/);
  assert.match(medicationClaimReviewStatus({ OPENROUTER_API_KEY: "sk-or-1" }).frontier.reason, /모델 ID/);
});

test("기존 OpenAI 설정과 명시적 덮어쓰기는 그대로 동작한다", async () => {
  // Given
  const { frontierCredentials } = await import("../scripts/patient-question-assistant.mjs");
  const openAi = { OPENAI_API_KEY: "sk-1", POLICYCOMPASS_FRONTIER_ENABLED: "true" };
  const overridden = {
    OPENROUTER_API_KEY: "sk-or-1",
    POLICYCOMPASS_FRONTIER_MODEL: "x/y",
    POLICYCOMPASS_FRONTIER_BASE_URL: "https://api.groq.com/openai/v1",
    POLICYCOMPASS_FRONTIER_API: "responses",
  };

  // When / Then
  assert.equal(frontierCredentials(openAi).configured, true);
  assert.equal(frontierCredentials(openAi).model, "gpt-5.6-sol");
  assert.equal(frontierApiStyle(openAi), "responses");
  assert.equal(frontierBaseUrl(overridden), "https://api.groq.com/openai/v1");
  assert.equal(frontierApiStyle(overridden), "responses");
  assert.equal(frontierCredentials({ OPENROUTER_API_KEY: "k", POLICYCOMPASS_FRONTIER_MODEL: "x/y", POLICYCOMPASS_FRONTIER_ENABLED: "false" }).configured, false);
});

test("설정 상태는 어떤 환경변수가 서버에 도달했는지 이름만 알려 준다", async () => {
  // Given
  const { frontierVariablesPresent } = await import("../scripts/patient-question-assistant.mjs");
  const { medicationClaimReviewStatus } = await import("../scripts/graphs/medication-claim-review-graph.mjs");
  const environment = { OPENROUTER_API_KEY: "sk-or-1" };

  // When
  const detected = frontierVariablesPresent(environment);
  const status = medicationClaimReviewStatus(environment).frontier;
  const configured = medicationClaimReviewStatus({ ...environment, POLICYCOMPASS_FRONTIER_MODEL: "openai/gpt-4o" }).frontier;

  // Then
  assert.equal(detected.OPENROUTER_API_KEY, true);
  assert.equal(detected.POLICYCOMPASS_FRONTIER_MODEL, false);
  assert.equal(status.detected.OPENROUTER_API_KEY, true);
  assert.equal(JSON.stringify(status).includes("sk-or-1"), false, "값은 절대 노출하지 않는다");
  assert.equal(Object.hasOwn(configured, "detected"), false, "설정이 끝나면 진단 정보를 붙이지 않는다");
});

test("모델이 설정되지 않으면 화면이 규칙 기반임을 밝히고 전송하지 않는다", async () => {
  // Given
  const [js, html] = await Promise.all([
    readFile("src/emr.js", "utf8"),
    readFile("src/emr.html", "utf8"),
  ]);

  // When / Then
  assert.match(js, /"규칙 기반 · 모델 미설정"/);
  assert.match(js, /환자 자료를 전송하지 않고 규칙 판정만 표시합니다/);
  assert.doesNotMatch(js, /medicationFrontierConsent/, "합성 환자 데모에서는 전송 동의 항목을 두지 않는다");
  assert.doesNotMatch(html, /rxConsentField/);
});
