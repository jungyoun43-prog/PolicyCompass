import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPatientQuestionContext,
  patientQuestionAssistantStatus,
  runPatientQuestionAssistant,
} from "../scripts/patient-question-assistant.mjs";

const snapshot = {
  schema: "policycompass-clinical-snapshot",
  version: 1,
  preparedAt: "2026-07-26T08:00:00.000Z",
  source: "finalized-clinical-record",
  healthMap: {
    conditions: [{ id: "hypertension", label: "고혈압", recordedOn: "2026-07-01", basis: "confirmed-condition" }],
    measurements: [],
  },
  medications: [{
    system: "urn:kr:local-medication",
    code: "ACE-001",
    label: "ACE 억제제",
    prescribedOn: "2026-07-10",
    dose: 1,
    doseUnit: "정",
    route: "경구",
    frequency: "1일 1회",
    durationDays: 30,
    quantity: 30,
    basis: "signed-prescription",
    instructions: "모델에 보내면 안 되는 메모",
  }],
  summary: {
    includedConditions: 1,
    includedMeasurements: 0,
    includedMedications: 1,
  },
};

const modelOutput = {
  summary: "약 먹는 시간과 밤 기침을 진료에서 물어볼 준비가 됐습니다.",
  questions: [{
    question: "이 약은 하루 중 언제 먹고, 기침이 계속되면 어떻게 문의하면 될까요?",
    reason: "약 먹는 시간과 불편한 증상을 함께 물어보기 위해서입니다.",
    evidenceIds: ["medication:1", "self-report:1"],
  }],
  sharedSignals: [{
    text: "지난 2주 동안 야간 기침이 심했습니다.",
    evidenceIds: ["self-report:1"],
  }],
};

const payload = {
  clinicalSnapshot: snapshot,
  selfReport: { summary: "지난 2주 동안 야간 기침이 심했습니다." },
};

test("patient question context keeps only refined clinical fields and aliases evidence", () => {
  const context = buildPatientQuestionContext(payload);
  assert.equal(context.clinical.conditions[0].evidenceId, "condition:hypertension");
  assert.equal(context.clinical.medications[0].evidenceId, "medication:1");
  assert.equal(context.selfReport.evidenceId, "self-report:1");
  assert.doesNotMatch(JSON.stringify(context), /instructions|모델에 보내면 안 되는 메모/);
});

test("server context removes common Korean direct identifiers from patient self-report", () => {
  const context = buildPatientQuestionContext({
    ...payload,
    selfReport: {
      summary: "저는 김영희이고 서울시 종로구에 살며 외국인등록번호 900101-5234567입니다. 야간 기침이 있습니다.",
    },
  });
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /김영희|서울시 종로구|900101-5234567/);
  assert.match(serialized, /개인정보 제거/);
  assert.match(serialized, /야간 기침/);
});

test("local provider uses loopback Ollama and rejects fabricated evidence", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({
      model: "patient-local",
      message: { content: JSON.stringify(modelOutput) },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await runPatientQuestionAssistant({ ...payload, provider: "local" }, {
    environment: {
      POLICYCOMPASS_PATIENT_OLLAMA_MODEL: "patient-local",
      POLICYCOMPASS_PATIENT_OLLAMA_URL: "http://127.0.0.1:11434",
    },
    fetchImpl,
  });
  assert.equal(requests[0].url, "http://127.0.0.1:11434/api/chat");
  assert.equal(result.provider, "local");
  assert.equal(result.questions.length, 1);
  const prompt = JSON.parse(requests[0].options.body).messages[0].content;
  assert.match(prompt, /진료실에서 그대로 읽을 수 있는 짧고 쉬운 존댓말/);
  assert.match(prompt, /무엇을 먹어도 되는지/);
  assert.match(prompt, /일주일에 몇 번·한 번에 몇 분/);
  assert.match(prompt, /약은 언제 먹고 불편하면 어떻게 문의할지/);
  assert.match(prompt, /검사 전 무엇을 준비할지/);

  let fabricatedCalls = 0;
  const fallback = await runPatientQuestionAssistant({ ...payload, provider: "local" }, {
    environment: { POLICYCOMPASS_PATIENT_OLLAMA_MODEL: "patient-local" },
    fetchImpl: async () => {
      fabricatedCalls += 1;
      return new Response(JSON.stringify({
        model: "patient-local",
        message: {
          content: JSON.stringify({
            ...modelOutput,
            questions: [{ ...modelOutput.questions[0], evidenceIds: ["fabricated"] }],
          }),
        },
      }), { status: 200 });
    },
  });
  assert.equal(fabricatedCalls, 2);
  assert.equal(fallback.provider, "rule-based");
  assert.match(fallback.fallback.reason, /유효한 정제 근거/);
  assert.ok(fallback.questions.length >= 1);
  const allowed = new Set(["condition:hypertension", "medication:1", "self-report:1"]);
  assert.ok(fallback.questions.every((item) => item.evidenceIds.every((id) => allowed.has(id))));
});

test("frontier provider requires per-run consent and uses Responses structured output server-side", async () => {
  await assert.rejects(
    () => runPatientQuestionAssistant({ ...payload, provider: "frontier", consent: false }, {
      environment: { OPENAI_API_KEY: "test-key" },
    }),
    /동의/,
  );

  let captured;
  const result = await runPatientQuestionAssistant({
    ...payload,
    provider: "frontier",
    consent: true,
  }, {
    environment: {
      OPENAI_API_KEY: "server-only-test-key",
      POLICYCOMPASS_FRONTIER_ENABLED: "true",
      POLICYCOMPASS_FRONTIER_MODEL: "gpt-5.6-sol",
    },
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        model: "gpt-5.6-sol",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(modelOutput) }],
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.options.headers.authorization, "Bearer server-only-test-key");
  assert.equal(captured.body.model, "gpt-5.6-sol");
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.text.format.type, "json_schema");
  assert.equal(captured.body.text.format.strict, true);
  assert.match(captured.body.instructions, /전문 표현은 피하고 일상말로 풀어 씁니다/);
  assert.equal(result.provider, "frontier");
  assert.equal(result.questions[0].evidenceIds.length, 2);
});

test("provider status reveals configuration state, never the API key", () => {
  const status = patientQuestionAssistantStatus({
    OPENAI_API_KEY: "secret",
    POLICYCOMPASS_FRONTIER_ENABLED: "true",
    POLICYCOMPASS_FRONTIER_MODEL: "gpt-5.6-sol",
  });
  assert.equal(status.frontier.configured, true);
  assert.equal(status.frontier.model, "gpt-5.6-sol");
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("patient model output rejects medication-change instructions even with valid evidence", async () => {
  const result = await runPatientQuestionAssistant({ ...payload, provider: "local" }, {
    environment: { POLICYCOMPASS_PATIENT_OLLAMA_MODEL: "patient-local" },
    fetchImpl: async () => new Response(JSON.stringify({
      model: "patient-local",
      message: {
        content: JSON.stringify({
          ...modelOutput,
          summary: "에날라프릴 중단이 필요합니다.",
          questions: [{
            question: "약을 바로 끊으시겠습니까?",
            reason: "위험하므로 지금 끊으세요.",
            evidenceIds: ["medication:1"],
          }],
        }),
      },
    }), { status: 200 }),
  });
  assert.equal(result.provider, "rule-based");
  assert.match(result.fallback.reason, /진단 또는 복약 변경/);
  assert.doesNotMatch(JSON.stringify(result.questions), /끊으|중단/);
});
