import assert from "node:assert/strict";
import test from "node:test";

import { buildPatientQuestionContext } from "../scripts/patient-question-assistant.mjs";
import {
  buildConnectionCandidates,
  runConnectionInsights,
} from "../scripts/graphs/connection-insights-graph.mjs";

const payload = {
  clinicalSnapshot: {
    schema: "vitagraph-clinical-snapshot",
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

test("후보 관계는 시간 간격이 가까운 순서로 근거 ID 쌍을 만든다", () => {
  const context = buildPatientQuestionContext(payload);
  const candidates = buildConnectionCandidates(context);
  assert.ok(candidates.length >= 3);
  const medCondition = candidates.find(({ kind }) => kind === "medication-condition");
  assert.deepEqual(
    [medCondition.aEvidenceId, medCondition.bEvidenceId],
    ["medication:1", "condition:hypertension"],
  );
  assert.equal(medCondition.gapDays, 9);
  const gaps = candidates.map(({ gapDays }) => gapDays ?? Number.MAX_SAFE_INTEGER);
  assert.deepEqual(gaps, [...gaps].sort((a, b) => a - b));
});

test("모델이 없으면 외부 호출 없이 규칙 기반 관계 설명을 만든다", async () => {
  let fetchCalls = 0;
  const result = await runConnectionInsights(payload, {
    environment: {},
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("호출되면 안 됩니다");
    },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(result.mode, "rule-based");
  assert.ok(result.insights.length >= 3);
  for (const insight of result.insights) {
    assert.equal(insight.verifiedBy, "rule");
    assert.equal(insight.evidenceIds.length, 2);
    assert.match(insight.checkQuestion, /[?？]$/);
  }
  assert.doesNotMatch(JSON.stringify(result), /진단입니다|중단하세요/);
});

test("모델이 있으면 후보마다 병렬 검증하고 관련 없음은 지도에서 제외한다", async () => {
  const asked = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.messages[1].content);
    asked.push(input);
    const related = input.b.label !== "직접 적은 최근 변화";
    return new Response(JSON.stringify({
      model: "patient-local",
      message: {
        content: JSON.stringify({
          related,
          explanation: `${input.a.label} 기록과 ${input.b.label} 기록이 가까운 시기에 함께 있습니다.`,
          checkQuestion: `${input.a.label} 기록과 ${input.b.label} 기록을 함께 봐야 할까요?`,
        }),
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await runConnectionInsights(payload, {
    environment: { VITAGRAPH_PATIENT_OLLAMA_MODEL: "patient-local" },
    fetchImpl,
  });
  assert.equal(result.mode, "local-model");
  assert.ok(asked.length >= 3);
  assert.ok(result.insights.length >= 1);
  assert.ok(result.insights.every(({ verifiedBy }) => verifiedBy === "local-model"));
  assert.ok(result.insights.every(({ kind }) => !kind.endsWith("self-report")));
});

test("한 후보의 모델 검증이 계속 실패하면 그 후보만 규칙 설명으로 폴백한다", async () => {
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.messages[1].content);
    const broken = input.a.label === "혈압" && input.b.label === "고혈압";
    return new Response(JSON.stringify({
      model: "patient-local",
      message: {
        content: broken ? "JSON 아님" : JSON.stringify({
          related: true,
          explanation: `${input.a.label} 기록과 ${input.b.label} 기록이 함께 있습니다.`,
          checkQuestion: "두 기록을 함께 봐야 할까요?",
        }),
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await runConnectionInsights(payload, {
    environment: { VITAGRAPH_PATIENT_OLLAMA_MODEL: "patient-local" },
    fetchImpl,
  });
  const fallback = result.insights.find(({ verifiedBy }) => verifiedBy === "rule");
  assert.ok(fallback);
  assert.match(fallback.note, /모델 검증 실패/);
  assert.ok(result.insights.some(({ verifiedBy }) => verifiedBy === "local-model"));
  assert.ok(calls > result.insights.length);
});

test("정제 기록이 없으면 TypeError로 거부한다", async () => {
  await assert.rejects(() => runConnectionInsights({}, { environment: {} }), TypeError);
});
