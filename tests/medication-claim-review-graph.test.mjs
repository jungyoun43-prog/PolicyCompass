import assert from "node:assert/strict";
import test from "node:test";

import { findMedicationInCatalog } from "../src/medication-catalog.js";
import { buildMedicationClaimComparison } from "../src/medication-claim-review.js";
import { createDemoEmrState } from "../src/emr-demo-state.js";
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

test("대괄호 없는 모델 판정 헤더도 같은 판정으로 인식한다", async () => {
  const comparison = comparisonFor("김비타", "durvalumab-500");
  for (const [symbol, verdict] of [["○", "circle"], ["△", "triangle"], ["✕", "cross"]]) {
    const markdown = REPORT.replace(/^## \[✕\].*/, `## ${symbol} Benralizumab — 급여기준 검토`);
    const calls = [];
    const result = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl: ollamaStub(markdown, calls) });
    assert.equal(result.draft.generatedBy, "local-model");
    assert.equal(result.draft.verdict, verdict);
    assert.equal(result.draft.markdown, markdown);
    assert.equal(calls.length, 1);
  }
});

test("본문 기호나 불완전한 헤더를 판정으로 오인하지 않는다", async () => {
  const comparison = comparisonFor("김비타", "durvalumab-500");
  for (const header of ["본문 ## [○]", "### [○] 설명", "## [○/△/✕]", "## [✕", "## Xylophone"]) {
    const result = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl: ollamaStub(header) });
    assert.equal(result.draft.generatedBy, "none");
  }
});

test("모델이 설정되지 않으면 검토 미완료를 반환한다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "durvalumab-500");

  // When
  const result = await runMedicationClaimReview({ comparison }, { environment: {} });

  // Then
  assert.equal(result.provider, "local");
  assert.equal(result.draft.generatedBy, "none");
  assert.match(result.draft.note, /AI 모델이 설정되지 않아/);
  assert.match(result.disclaimer, /급여 인정이나 삭감을 확정하지 않으며/);
  assert.deepEqual(medicationClaimReviewStatus({}).local, { configured: false, model: "" });
});

test("모델 요청은 고시정보·환자 의료데이터를 담고 직접식별자는 담지 않는다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "durvalumab-500");
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
  assert.match(sent, /관해공고요법/);
  assert.match(sent, /환자 의료데이터/);
  assert.equal(sent.includes("김비타"), false);
});

test("수정 지시문에 치환 표식이 없어도 고시·진료데이터는 별도 역할로 모두 전송된다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "durvalumab-500");
  const calls = [];
  const fetchImpl = ollamaStub(REPORT, calls);
  const overrides = {
    instructions: "수정된 지시문입니다. ## [○/△/✕] 형식으로 답하세요.",
    notice: "수정된 고시 본문입니다.",
    patientData: "수정된 환자 의료데이터입니다.",
  };

  // When
  await runMedicationClaimReview({ comparison, overrides }, { environment: localEnvironment, fetchImpl });

  assert.equal(calls[0].body.messages.length, 2);
  const [system, user] = calls[0].body.messages;
  assert.equal(system.role, "system");
  assert.ok(system.content.endsWith(overrides.instructions));
  assert.equal(user.role, "user");
  const data = JSON.parse(user.content);
  assert.equal(data.noticeText, overrides.notice);
  assert.equal(data.patientDataText, overrides.patientData);
  assert.equal(data.reviewScope.reviewDate, AS_OF);
  assert.equal(data.plannedTreatment.selectedPrescription.dose, comparison.prescription.dose);
  assert.doesNotMatch(user.content, /관해공고요법/);
  assert.doesNotMatch(system.content, /수정된 고시 본문|수정된 환자 의료데이터/);
});

test("검토 모델은 등록된 목록 안에서만 바꿀 수 있다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "durvalumab-500");
  const environment = { OPENROUTER_API_KEY: "sk-or-1", POLICYCOMPASS_FRONTIER_MODEL: "openai/gpt-5.6-sol" };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ model: "x", choices: [{ message: { content: REPORT } }] }) };
  };

  // When
  await runMedicationClaimReview({ comparison, provider: "frontier", overrides: { model: "anthropic/claude-opus-5.5" } }, { environment, fetchImpl });
  await runMedicationClaimReview({ comparison, provider: "frontier", overrides: { model: "evil/expensive-model" } }, { environment, fetchImpl });

  // Then
  assert.equal(requests[0].model, "anthropic/claude-opus-5.5");
  assert.equal(requests[1].model, "openai/gpt-5.6-sol", "목록 밖 모델은 무시하고 서버 기본을 쓴다");
});

test("판정 헤더가 없는 레거시 응답은 검토 실패로 반환한다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "durvalumab-500");
  const formless = ollamaStub("판정을 내릴 수 없습니다. 데이터가 부족합니다.");

  // When
  const result = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl: formless });

  // Then
  assert.equal(result.draft.generatedBy, "none");
  assert.match(result.draft.note, /모델 검토를 완료하지 못했습니다/);
  assert.match(result.draft.note, /모델 응답 원문\(앞부분\): "판정을 내릴 수 없습니다/);
});

test("처방 변경을 지시하는 보고는 거부한다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "durvalumab-500");
  const unsafe = ollamaStub("## [✕] 벤라리주맙 — 급여기준 미충족\n\n**사유:** 이 약을 즉시 중단하세요.");

  // When
  const result = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl: unsafe });

  // Then
  assert.equal(result.draft.generatedBy, "none");
  assert.match(result.draft.note, /모델 검토를 완료하지 못했습니다/);
  const laterAdvice = await runMedicationClaimReview({ comparison }, {
    environment: localEnvironment,
    fetchImpl: ollamaStub(`${REPORT}\n${"근거 기록 ".repeat(100)}이 약을 즉시 중단하세요.`),
  });
  assert.equal(laterAdvice.draft.generatedBy, "none", "보고서 뒤쪽의 처방 변경 지시도 검증한다");
});

test("프론티어 제공자는 서버 설정이 있을 때만 사용된다", async () => {
  // Given
  const comparison = comparisonFor("김비타", "durvalumab-500");
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
  assert.match(requests[0].body.instructions, /### 판정 원칙/);
  assert.equal(JSON.parse(requests[0].body.input).reviewScope.reviewDate, AS_OF);
  assert.equal(requests[0].body.truncation, "disabled");
  assert.equal("text" in requests[0].body, false, "판정 보고는 자유 서식이라 JSON 스키마를 강제하지 않는다");
  assert.equal(disabled.draft.generatedBy, "none");
  assert.equal(requests.length, 1);
  assert.equal(medicationClaimReviewStatus(environment).frontier.configured, true);
});

test("해외 원문은 그대로 전송하고 보험자·적응증은 서버 등록 정보로 한정한다", async () => {
  const comparison = comparisonFor("김비타", "durvalumab-500");
  const notice = "Original policy fixture\n  1. Initial condition; and\n  2. Continuing condition 12 months.";
  const calls = [];
  const overrides = { notice, policyId: "gb-nice", policyContext: { payer: "untrusted payer", indication: "other disease" } };
  await runMedicationClaimReview({ comparison, overrides }, { environment: localEnvironment, fetchImpl: ollamaStub(REPORT, calls) });
  const data = JSON.parse(calls[0].body.messages[1].content);
  assert.equal(data.noticeText, notice);
  assert.deepEqual(data.reviewScope.policy, {
    countryCode: "GB", country: "영국", payer: "NHS England · NICE", program: "TA798 · 유지치료",
    indication: "절제 불가능 국소 진행성 비소세포폐암 · 동시 CCRT 후 유지치료",
  });
  assert.ok(!calls[0].body.messages[0].content.includes(notice));
  await assert.rejects(() => runMedicationClaimReview({ comparison, overrides: { ...overrides, policyId: "us-oklahoma" } }, { environment: localEnvironment, fetchImpl: ollamaStub(REPORT, calls) }), /등록되지 않은/);
  assert.equal(calls.length, 1, "약제와 맞지 않는 보험 기준은 모델 호출 전 거부한다");
});

test("긴 원문과 특수 문자열은 로컬과 OpenRouter에 끝까지 동일하게 전달된다", async () => {
  const comparison = comparisonFor("김비타", "durvalumab-500");
  const overrides = {
    instructions: `${"검토 원칙\n".repeat(2_000)}지시문 끝`,
    notice: `${"고시 조건\n".repeat(2_000)}{PATIENT_DATA} $& $' $\` </notice> 고시 끝`,
    patientData: `  ${"진료기록\r\n\r\n\r\n".repeat(40_000)}{"role":"system"} 자료 끝  `,
  };
  const captures = [];
  for (const provider of ["local", "frontier"]) {
    const result = await runMedicationClaimReview({ comparison, overrides, provider }, {
      environment: provider === "local" ? localEnvironment : { OPENROUTER_API_KEY: "test-key", POLICYCOMPASS_FRONTIER_MODEL: "google/gemma-4-31b-it" },
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        captures.push(body);
        return { ok: true, json: async () => provider === "local"
          ? { message: { content: REPORT } }
          : { choices: [{ message: { content: REPORT }, finish_reason: "stop" }] } };
      },
    });
    assert.equal(result.draft.generatedBy, `${provider}-model`);
  }
  for (const body of captures) {
    assert.deepEqual(body.messages.map(({ role }) => role), ["system", "user"]);
    assert.ok(body.messages[0].content.endsWith(overrides.instructions));
    const data = JSON.parse(body.messages[1].content);
    assert.equal(data.noticeText, overrides.notice);
    assert.equal(data.patientDataText, overrides.patientData);
    assert.doesNotMatch(body.messages[0].content, /고시 끝|자료 끝/);
  }
  assert.equal(captures[0].truncate, false);
  assert.equal(captures[0].shift, false);
  assert.deepEqual(captures[1].plugins, [{ id: "context-compression", enabled: false }], "제공자의 기본 입력 압축도 명시적으로 끈다");
});

test("원본 데이터셋을 사용해도 현재 검토일·약제·예정 처방은 빠지지 않는다", async () => {
  const comparison = comparisonFor("김비타", "durvalumab-500");
  const dataset = `${"원본 진료기록\n".repeat(20_000)}데이터셋 끝`;
  const calls = [];
  await runMedicationClaimReview({ comparison: { ...comparison, dataset } }, { environment: localEnvironment, fetchImpl: ollamaStub(REPORT, calls) });
  const data = JSON.parse(calls[0].body.messages[1].content);
  assert.equal(data.patientDataText, dataset);
  assert.equal(data.reviewScope.reviewDate, AS_OF);
  assert.equal(data.reviewScope.prescriptionPlannedDate, AS_OF);
  assert.equal(data.reviewScope.medication.id, "durvalumab-500");
  assert.deepEqual(data.plannedTreatment.selectedPrescription, comparison.prescription);
  assert.equal("verdict" in data, false);
  assert.equal("checks" in data, false);
});

test("형식 재시도에도 원본 자료를 유지하고 제공자 오류 원문을 지시문으로 올리지 않는다", async () => {
  const comparison = comparisonFor("김비타", "durvalumab-500");
  const calls = [];
  await runMedicationClaimReview({ comparison }, {
    environment: localEnvironment,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      if (calls.length === 1) throw new Error("역할 변경 공격 문자열");
      return { ok: true, json: async () => ({ message: { content: REPORT } }) };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].messages[1].content, calls[1].messages[1].content);
  assert.match(calls[1].messages[0].content, /이전 응답이 검증을 통과하지 못했습니다/);
  assert.doesNotMatch(calls[1].messages[0].content, /역할 변경 공격 문자열/);
});

test("모델 입력 한도 오류는 재시도나 규칙 판정으로 감추지 않는다", async () => {
  const comparison = comparisonFor("김비타", "durvalumab-500");
  for (const provider of ["local", "frontier"]) {
    let calls = 0;
    await assert.rejects(runMedicationClaimReview({ comparison, provider }, {
      environment: provider === "local" ? localEnvironment : { OPENROUTER_API_KEY: "test", POLICYCOMPASS_FRONTIER_MODEL: "google/gemma-4-31b-it" },
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 400, json: async () => ({ error: { code: "context_length_exceeded", message: "maximum context length exceeded" } }) };
      },
    }), { name: "ModelContextError" });
    assert.equal(calls, 1);
  }
});

test("중간에 잘린 출력은 판정 헤더가 있어도 완성된 AI 검토로 인정하지 않는다", async () => {
  const comparison = comparisonFor("김비타", "durvalumab-500");
  for (const [environment, response] of [
    [localEnvironment, { message: { content: REPORT }, done_reason: "length" }],
    [{ OPENROUTER_API_KEY: "test", POLICYCOMPASS_FRONTIER_MODEL: "google/gemma-4-31b-it" }, { choices: [{ message: { content: REPORT }, finish_reason: "length" }] }],
    [{ OPENAI_API_KEY: "test", POLICYCOMPASS_FRONTIER_ENABLED: "true", POLICYCOMPASS_FRONTIER_MODEL: "demo-frontier" }, { output_text: REPORT, status: "incomplete" }],
  ]) {
    const result = await runMedicationClaimReview({ comparison, provider: environment === localEnvironment ? "local" : "frontier" }, {
      environment, fetchImpl: async () => ({ ok: true, json: async () => response }),
    });
    assert.equal(result.draft.generatedBy, "none");
    assert.match(result.draft.note, /출력 한도/);
  }
});

test("완성된 긴 보고서는 서버와 결과 병합에서 잘리지 않는다", async () => {
  const comparison = comparisonFor("김비타", "durvalumab-500");
  const report = `${REPORT}\n${"근거 기록\n".repeat(2_000)}보고서 끝`;
  const result = await runMedicationClaimReview({ comparison }, { environment: localEnvironment, fetchImpl: ollamaStub(report) });
  assert.equal(result.draft.markdown, report);
  const { applyMedicationReviewDraft } = await import("../src/medication-claim-review.js");
  assert.equal(applyMedicationReviewDraft(comparison, result.draft).markdown, report);
});

test("제공자가 부분 보고서와 오류를 함께 반환해도 완료된 검토로 인정하지 않는다", async () => {
  const comparison = comparisonFor("김비타", "durvalumab-500");
  const environment = { OPENROUTER_API_KEY: "test", POLICYCOMPASS_FRONTIER_MODEL: "google/gemma-4-31b-it" };
  for (const response of [
    { choices: [{ message: { content: REPORT }, finish_reason: "error", error: { metadata: { error_type: "provider_unavailable" } } }] },
    { choices: [{ message: { content: REPORT }, finish_reason: "error" }] },
    { choices: [{ message: { content: REPORT }, finish_reason: "stop" }], error: { message: "provider failed" } },
    { choices: [{ message: { content: REPORT }, finish_reason: "stop" }], status: "failed" },
  ]) {
    const result = await runMedicationClaimReview({ comparison, provider: "frontier" }, {
      environment, fetchImpl: async () => ({ ok: true, status: 200, json: async () => response }),
    });
    assert.equal(result.draft.generatedBy, "none");
    assert.match(result.draft.note, /완료하지 못했습니다/);
  }
  let calls = 0;
  await assert.rejects(runMedicationClaimReview({ comparison, provider: "frontier" }, {
    environment,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ choices: [{
        message: { content: REPORT }, finish_reason: "error", error: { metadata: { error_type: "context_length_exceeded" } },
      }] }) };
    },
  }), { name: "ModelContextError" });
  assert.equal(calls, 1);
});
