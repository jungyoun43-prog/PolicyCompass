import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPatientQuestionContext,
  buildRuleBasedPatientQuestions,
  runPatientQuestionAssistant,
} from "../scripts/patient-question-assistant.mjs";

const payload = {
  clinicalSnapshot: {
    schema: "policycompass-clinical-snapshot",
    version: 1,
    healthMap: {
      conditions: [{ id: "hypertension", label: "고혈압", recordedOn: "2026-07-01" }],
      measurements: [{ key: "bp", label: "혈압", value: "148/94", unit: "mmHg", observedOn: "2026-07-10" }],
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
  selfReport: { summary: "지난 2주 동안 야간 기침이 심했습니다." },
};

const validModelOutput = {
  summary: "약 먹는 시간과 밤 기침을 진료에서 물어볼 준비가 됐습니다.",
  questions: [{
    question: "이 약은 하루 중 언제 먹으면 될까요?",
    reason: "약 먹는 시간을 확인하기 위해서입니다.",
    evidenceIds: ["medication:1"],
  }],
  sharedSignals: [{
    text: "지난 2주 동안 야간 기침이 심했습니다.",
    evidenceIds: ["self-report:1"],
  }],
};

function ollamaResponse(content) {
  return new Response(JSON.stringify({
    model: "patient-local",
    message: { content },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("검증 실패 초안은 거부 사유를 피드백으로 넘겨 같은 실행에서 재생성한다", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return ollamaResponse(JSON.stringify({
        ...validModelOutput,
        questions: [{ ...validModelOutput.questions[0], evidenceIds: ["fabricated"] }],
      }));
    }
    return ollamaResponse(JSON.stringify(validModelOutput));
  };
  const result = await runPatientQuestionAssistant({ ...payload, provider: "local" }, {
    environment: { POLICYCOMPASS_PATIENT_OLLAMA_MODEL: "patient-local" },
    fetchImpl,
  });
  assert.equal(requests.length, 2);
  assert.equal(result.provider, "local");
  assert.equal(result.questions[0].evidenceIds[0], "medication:1");
  const retryMessages = requests[1].messages;
  assert.equal(retryMessages.at(-1).role, "user");
  assert.match(retryMessages.at(-1).content, /이전 초안이 거부되었습니다/);
  assert.match(retryMessages.at(-1).content, /유효한 정제 근거/);
  assert.equal(retryMessages.at(-2).role, "assistant");
});

test("JSON이 아닌 모델 응답도 재시도 대상이며 반복 실패 시 규칙 기반으로 폴백한다", async () => {
  let calls = 0;
  const result = await runPatientQuestionAssistant({ ...payload, provider: "local" }, {
    environment: { POLICYCOMPASS_PATIENT_OLLAMA_MODEL: "patient-local" },
    fetchImpl: async () => {
      calls += 1;
      return ollamaResponse("이건 JSON이 아닙니다");
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.provider, "rule-based");
  assert.match(result.fallback.reason, /JSON 형식이 아닙니다/);
  assert.equal(result.fallback.requestedProvider, "local");
  assert.equal(result.fallback.attempts, 2);
});

test("전송 자체가 실패하면 재시도 없이 즉시 규칙 기반으로 폴백한다", async () => {
  let calls = 0;
  const result = await runPatientQuestionAssistant({ ...payload, provider: "local" }, {
    environment: { POLICYCOMPASS_PATIENT_OLLAMA_MODEL: "patient-local" },
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 500 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.provider, "rule-based");
  assert.match(result.fallback.reason, /요청 실패/);
});

test("규칙 기반 질문은 근거 ID가 연결된 안전한 존댓말 질문만 만든다", () => {
  const context = buildPatientQuestionContext(payload);
  const ruleBased = buildRuleBasedPatientQuestions(context);
  assert.ok(ruleBased.questions.length >= 3);
  for (const item of ruleBased.questions) {
    assert.match(item.question, /[?？]$/);
    assert.ok(item.evidenceIds.every((id) => context.evidenceIds.has(id)));
  }
  assert.doesNotMatch(JSON.stringify(ruleBased), /중단|끊|증량|감량|진단/);
  assert.ok(ruleBased.sharedSignals.length >= 1);
});
