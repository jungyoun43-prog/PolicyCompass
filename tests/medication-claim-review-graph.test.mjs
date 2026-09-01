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

const REPORT = [
  "## [✕] 벤라리주맙 프리필드시린지 30mg — 급여기준 미충족",
  "",
  "**사유:** 중증 호산구성 천식 진단과 치료 시작 전 12개월 이내 혈중 호산구 수치 기록이 없습니다.",
  "",
  "| 급여기준 | 판정 | 근거 |",
  "| ---- | :---: | ---- |",
  "| 성인 중증 호산구성 천식 | ✕ | 정보 없음 |",
  "| 혈중 호산구 300 cells/㎕ 이상 | ✕ | 정보 없음 |",
  "",
  "**최종 판단:** 투여대상 조건을 확인할 수 없어 급여기준 미충족입니다.",
].join("\n");

function ollamaStub(content, calls = []) {
  return async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({ model: "demo-local", message: { content } }),
    };
  };
}

const localEnvironment = { POLICYCOMPASS_OLLAMA_MODEL: "demo-local", POLICYCOMPASS_OLLAMA_URL: "http://127.0.0.1:11434" };

test("모델이 설정되지 않으면 규칙 판정을 그대로 사용한다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "benralizumab-30");

  // When
  const result = await runMedicationClaimReview({ comparison }, { environment: {} });

  // Then
  assert.equal(result.provider, "local");
  assert.equal(result.draft.generatedBy, "rule");
  assert.match(result.draft.note, /AI 모델이 설정되지 않아/);
  assert.match(result.disclaimer, /급여 인정이나 삭감을 확정하지 않으며/);
  assert.deepEqual(medicationClaimReviewStatus({}).local, { configured: false, model: "" });
});

test("모델 요청은 고시정보·환자 의료데이터를 담고 직접식별자는 담지 않는다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "benralizumab-30");
  const calls = [];
  const fetchImpl = ollamaStub(REPORT, calls);

  // When
  const result = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl });

  // Then
  assert.equal(result.draft.generatedBy, "local-model");
  assert.equal(result.draft.verdict, "cross");
  assert.match(result.draft.markdown, /급여기준 미충족/);
  assert.equal(calls.length, 1);
  const sent = JSON.stringify(calls[0].body);
  assert.match(sent, /급여 고시정보/);
  assert.match(sent, /고시 제2026-92호/);
  assert.match(sent, /환자 의료데이터/);
  assert.equal(sent.includes("김비타"), false);
});

test("미리보기에서 수정한 프롬프트·고시·진료데이터가 그대로 전송된다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "benralizumab-30");
  const calls = [];
  const fetchImpl = ollamaStub(REPORT, calls);
  const overrides = {
    instructions: "수정된 템플릿입니다. ## [○/△/✕] 형식으로 답하세요.\n고시: {NOTICE}\n데이터: {PATIENT_DATA}",
    notice: "수정된 고시 본문입니다.",
    patientData: "수정된 환자 의료데이터입니다.",
  };

  // When
  await runMedicationClaimReview({ comparison, overrides }, { environment: localEnvironment, fetchImpl });

  // Then — 템플릿의 {NOTICE}/{PATIENT_DATA} 자리에 수정본이 그대로 치환된 단일 메시지.
  assert.equal(calls[0].body.messages.length, 1);
  const [user] = calls[0].body.messages;
  assert.equal(user.role, "user");
  assert.match(user.content, /^수정된 템플릿입니다\./);
  assert.match(user.content, /고시: 수정된 고시 본문입니다\./);
  assert.match(user.content, /데이터: 수정된 환자 의료데이터입니다\./);
  assert.doesNotMatch(user.content, /고시 제2026-92호/);
});

test("검토 모델은 등록된 목록 안에서만 바꿀 수 있다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "benralizumab-30");
  const environment = { OPENROUTER_API_KEY: "sk-or-1", POLICYCOMPASS_FRONTIER_MODEL: "openai/gpt-5.6-sol" };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ model: "x", choices: [{ message: { content: REPORT } }] }) };
  };

  // When
  await runMedicationClaimReview({ comparison, provider: "frontier", overrides: { model: "anthropic/claude-opus-5" } }, { environment, fetchImpl });
  await runMedicationClaimReview({ comparison, provider: "frontier", overrides: { model: "evil/expensive-model" } }, { environment, fetchImpl });

  // Then
  assert.equal(requests[0].model, "anthropic/claude-opus-5");
  assert.equal(requests[1].model, "openai/gpt-5.6-sol", "목록 밖 모델은 무시하고 서버 기본을 쓴다");
});

test("판정 헤더가 없는 응답은 규칙 판정으로 되돌린다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "benralizumab-30");
  const formless = ollamaStub("판정을 내릴 수 없습니다. 데이터가 부족합니다.");

  // When
  const result = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl: formless });

  // Then
  assert.equal(result.draft.generatedBy, "rule");
  assert.match(result.draft.note, /모델 검토 실패/);
});

test("처방 변경을 지시하는 보고는 거부한다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "benralizumab-30");
  const unsafe = ollamaStub("## [✕] 벤라리주맙 — 급여기준 미충족\n\n**사유:** 이 약을 즉시 중단하세요.");

  // When
  const result = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl: unsafe });

  // Then
  assert.equal(result.draft.generatedBy, "rule");
  assert.match(result.draft.note, /모델 검토 실패/);
});

test("프론티어 제공자는 서버 설정이 있을 때만 사용된다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "benralizumab-30");
  const environment = {
    OPENAI_API_KEY: "test-key",
    POLICYCOMPASS_FRONTIER_ENABLED: "true",
    POLICYCOMPASS_FRONTIER_MODEL: "demo-frontier",
  };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, authorization: options.headers.authorization, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({ model: "demo-frontier", output_text: REPORT }),
    };
  };

  // When
  const enabled = await runMedicationClaimReview({ comparison, provider: "frontier" }, { environment, fetchImpl });
  const disabled = await runMedicationClaimReview({ comparison, provider: "frontier" }, { environment: {}, fetchImpl });

  // Then
  assert.equal(enabled.draft.generatedBy, "frontier-model");
  assert.equal(enabled.draft.verdict, "cross");
  assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
  assert.equal(requests[0].authorization, "Bearer test-key");
  assert.equal("text" in requests[0].body, false, "판정 보고는 자유 서식이라 JSON 스키마를 강제하지 않는다");
  assert.equal(disabled.draft.generatedBy, "rule");
  assert.equal(requests.length, 1);
  assert.equal(medicationClaimReviewStatus(environment).frontier.configured, true);
});
