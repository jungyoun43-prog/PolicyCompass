import assert from "node:assert/strict";
import test from "node:test";

import { findMedicationInCatalog } from "../src/medication-catalog.js";
import { buildMedicationClaimComparison } from "../src/medication-claim-review.js";
import { createDemoEmrState } from "../src/emr-model.js";
import {
  medicationClaimReviewStatus,
  runMedicationClaimReview,
} from "../scripts/graphs/medication-claim-review-graph.mjs";

const AS_OF = "2026-07-20";
const demo = createDemoEmrState(AS_OF);

function comparisonFor(patientName, medicationId) {
  const medication = findMedicationInCatalog(medicationId);
  return buildMedicationClaimComparison({
    patient: demo.patients.find((patient) => patient.name === patientName),
    medication,
    prescription: medication.dosing,
    asOf: AS_OF,
  });
}

function ollamaStub(content, calls = []) {
  return async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({ model: "demo-local", message: { content: JSON.stringify(content) } }),
    };
  };
}

const localEnvironment = { POLICYCOMPASS_OLLAMA_MODEL: "demo-local", POLICYCOMPASS_OLLAMA_URL: "http://127.0.0.1:11434" };

test("모델이 설정되지 않으면 규칙 판정을 그대로 사용한다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "amlodipine-5");

  // When
  const result = await runMedicationClaimReview({ comparison }, { environment: {} });

  // Then
  assert.equal(result.provider, "local");
  assert.equal(result.draft.generatedBy, "rule");
  assert.match(result.draft.note, /AI 모델이 설정되지 않아/);
  assert.match(result.disclaimer, /급여 인정이나 삭감을 확정하지 않으며/);
  assert.deepEqual(medicationClaimReviewStatus({}).local, { configured: false, model: "" });
});

test("로컬 모델 초안은 규칙 판정과 근거 항목 안에서만 받아들여진다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "amoxicillin-clavulanate-625");
  const calls = [];
  const fetchImpl = ollamaStub({
    verdict: "cross",
    summary: "등록된 알레르기 성분과 이번 처방 성분명이 일치해 근거 확인이 필요합니다.",
    rationale: ["알레르기 기록 '페니실린 알레르기'와 이번 처방 성분명이 일치합니다."],
    citedCheckIds: ["allergy"],
  }, calls);

  // When
  const result = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl });

  // Then
  assert.equal(result.draft.generatedBy, "local-model");
  assert.equal(result.draft.verdict, "cross");
  assert.deepEqual(result.draft.citedCheckIds, ["allergy"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:11434/api/chat");
  assert.equal(JSON.stringify(calls[0].body).includes("김비타"), false);
});

test("규칙 판정보다 관대하거나 없는 항목을 인용한 초안은 규칙 판정으로 되돌린다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "amoxicillin-clavulanate-625");
  const lenient = ollamaStub({ verdict: "circle", summary: "괜찮습니다.", rationale: ["문제 없습니다."], citedCheckIds: [] });
  const invented = ollamaStub({
    verdict: "cross",
    summary: "확인이 필요합니다.",
    rationale: ["확인이 필요합니다."],
    citedCheckIds: ["made-up"],
  });

  // When
  const softened = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl: lenient });
  const fabricated = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl: invented });

  // Then
  assert.equal(softened.draft.generatedBy, "rule");
  assert.match(softened.draft.note, /관대한 판정/);
  assert.equal(fabricated.draft.generatedBy, "rule");
  assert.match(fabricated.draft.note, /입력에 없는 기준 항목/);
});

test("처방 변경을 지시하거나 급여를 확정하는 초안은 거부한다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "amoxicillin-clavulanate-625");
  const unsafe = ollamaStub({
    verdict: "cross",
    summary: "이 약을 즉시 중단하세요.",
    rationale: ["즉시 중단하세요."],
    citedCheckIds: ["allergy"],
  });

  // When
  const result = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl: unsafe });

  // Then
  assert.equal(result.draft.generatedBy, "rule");
  assert.match(result.draft.note, /모델 검토 실패/);
});

test("프론티어 제공자는 서버 설정이 있을 때만 사용된다", async () => {
  // Given
  const comparison = comparisonFor("이준호", "tiotropium-inhaler");
  const environment = {
    OPENAI_API_KEY: "test-key",
    POLICYCOMPASS_FRONTIER_ENABLED: "true",
    POLICYCOMPASS_FRONTIER_MODEL: "demo-frontier",
  };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, authorization: options.headers.authorization });
    return {
      ok: true,
      json: async () => ({
        model: "demo-frontier",
        output_text: JSON.stringify({
          verdict: "cross",
          summary: "이미 같은 효능군 처방이 있어 중복 근거를 확인해야 합니다.",
          rationale: ["활성 LAMA 처방과 이번 처방이 같은 효능군입니다."],
          citedCheckIds: ["duplicate"],
        }),
      }),
    };
  };

  // When
  const enabled = await runMedicationClaimReview({ comparison, provider: "frontier" }, { environment, fetchImpl });
  const disabled = await runMedicationClaimReview({ comparison, provider: "frontier" }, { environment: {}, fetchImpl });

  // Then
  assert.equal(enabled.draft.generatedBy, "frontier-model");
  assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
  assert.equal(requests[0].authorization, "Bearer test-key");
  assert.equal(disabled.draft.generatedBy, "rule");
  assert.equal(requests.length, 1);
  assert.equal(medicationClaimReviewStatus(environment).frontier.configured, true);
});
