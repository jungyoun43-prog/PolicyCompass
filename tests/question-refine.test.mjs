import assert from "node:assert/strict";
import test from "node:test";

import { runQuestionRefine } from "../scripts/graphs/question-refine-graph.mjs";

const payload = {
  clinicalSnapshot: {
    schema: "vitagraph-clinical-snapshot",
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
  selfReport: { summary: "지난 2주 동안 야간 기침이 심했습니다." },
  questions: [{
    question: "이 약은 언제 먹으면 될까요?",
    reason: "복용 시간을 확인하기 위해서입니다.",
    evidenceIds: ["medication:1"],
  }],
};

function ollamaResponse(questions) {
  return new Response(JSON.stringify({
    model: "patient-local",
    message: { content: JSON.stringify({ questions }) },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

const environment = { VITAGRAPH_PATIENT_OLLAMA_MODEL: "patient-local" };

test("같은 스레드에서 컨텍스트를 다시 보내지 않아도 대화형으로 질문을 다듬는다", async () => {
  const inputs = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    inputs.push(JSON.parse(body.messages[1].content));
    return ollamaResponse([{
      question: `${inputs.length}번째로 다듬은 질문인가요?`,
      reason: "지시를 반영했습니다.",
      evidenceIds: ["medication:1"],
    }]);
  };

  const first = await runQuestionRefine({ ...payload, instruction: "더 짧게 바꿔줘" }, { environment, fetchImpl });
  assert.ok(first.threadId);
  assert.equal(first.turn, 1);
  assert.equal(first.applied, true);
  assert.equal(inputs[0].instruction, "더 짧게 바꿔줘");
  assert.equal(inputs[0].currentQuestions[0].question, "이 약은 언제 먹으면 될까요?");
  assert.ok(inputs[0].context.clinical.conditions.length >= 1);

  const second = await runQuestionRefine({
    threadId: first.threadId,
    instruction: "기침 이야기도 넣어줘",
  }, { environment, fetchImpl });
  assert.equal(second.threadId, first.threadId);
  assert.equal(second.turn, 2);
  assert.deepEqual(inputs[1].previousInstructions, ["더 짧게 바꿔줘"]);
  assert.equal(inputs[1].currentQuestions[0].question, "1번째로 다듬은 질문인가요?");
  assert.ok(inputs[1].context.clinical.conditions.length >= 1);
  assert.equal(second.questions[0].question, "2번째로 다듬은 질문인가요?");
});

test("안전하지 않거나 근거가 조작된 다듬기는 재시도 후 기존 질문을 유지한다", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return ollamaResponse([{
      question: "약을 바로 끊어야 하나요?",
      reason: "위험해 보여서입니다.",
      evidenceIds: ["medication:1"],
    }]);
  };
  const result = await runQuestionRefine({ ...payload, instruction: "약 끊는 질문으로 바꿔줘" }, { environment, fetchImpl });
  assert.equal(calls, 2);
  assert.equal(result.applied, false);
  assert.match(result.error, /진단 또는 복약 변경/);
  assert.equal(result.questions[0].question, "이 약은 언제 먹으면 될까요?");

  const next = await runQuestionRefine({
    threadId: result.threadId,
    instruction: "그냥 더 정중하게 바꿔줘",
  }, {
    environment,
    fetchImpl: async () => ollamaResponse([{
      question: "이 약은 언제 드시는 것이 좋을까요?",
      reason: "복용 시간을 확인하기 위해서입니다.",
      evidenceIds: ["medication:1"],
    }]),
  });
  assert.equal(next.applied, true);
  assert.equal(next.turn, 2);
  assert.equal(next.questions[0].question, "이 약은 언제 드시는 것이 좋을까요?");
});

test("시드 질문이 없으면 규칙 기반 질문으로 시작하고 지시의 개인정보는 제거한다", async () => {
  const inputs = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    inputs.push(JSON.parse(body.messages[1].content));
    return ollamaResponse([{
      question: "무엇을 먹어도 될까요?",
      reason: "식단을 확인하기 위해서입니다.",
      evidenceIds: ["condition:hypertension"],
    }]);
  };
  const { questions: _omit, ...withoutSeed } = payload;
  const result = await runQuestionRefine({
    ...withoutSeed,
    instruction: "저는 김영희입니다. 010-1234-5678로 연락 주세요. 식단 질문으로 바꿔줘",
  }, { environment, fetchImpl });
  assert.equal(result.applied, true);
  assert.ok(inputs[0].currentQuestions.length >= 3);
  assert.doesNotMatch(JSON.stringify(inputs[0]), /김영희|010-1234-5678/);
});

test("지시가 없거나 모르는 스레드면 TypeError, 모델 미설정이면 일반 오류를 던진다", async () => {
  await assert.rejects(() => runQuestionRefine({ ...payload }, { environment }), /지시가 필요/);
  await assert.rejects(
    () => runQuestionRefine({ threadId: "00000000-0000-0000-0000-000000000000", instruction: "바꿔줘" }, { environment }),
    /알 수 없거나 만료된 질문 다듬기 스레드/,
  );
  await assert.rejects(
    () => runQuestionRefine({ ...payload, instruction: "바꿔줘" }, { environment: {} }),
    /로컬 모델이 설정되지 않았습니다/,
  );
  await assert.rejects(
    () => runQuestionRefine({ ...payload, provider: "frontier", instruction: "바꿔줘" }, { environment }),
    TypeError,
  );
});
