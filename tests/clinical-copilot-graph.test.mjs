import assert from "node:assert/strict";
import test from "node:test";

import { runClinicalCopilot } from "../scripts/clinical-copilot.mjs";

const payload = {
  patient: {
    id: "p1",
    events: [
      { id: "e1", type: "condition", code: "I10", label: "고혈압", date: "2026-01-01", status: "active" },
      { id: "e2", type: "observation", code: "85354-9", label: "혈압", date: "2026-07-10", status: "final", value: "148/94", unit: "mmHg" },
    ],
  },
  patientBrief: { items: [] },
  claimEvaluations: [],
};

const validDraft = {
  summary: [{ text: "고혈압과 최근 혈압 기록이 있습니다.", evidenceEventIds: ["e1", "e2"] }],
  priorities: [],
  clinicianQuestions: [],
  patientQuestions: [],
  warnings: [],
};

function ollamaResponse(content) {
  return new Response(JSON.stringify({
    model: "local-model",
    created_at: "2026-08-20T09:00:00Z",
    message: { role: "assistant", content },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("근거가 조작된 첫 초안은 거부 사유를 피드백으로 넘겨 같은 실행에서 재생성한다", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return ollamaResponse(JSON.stringify({
        ...validDraft,
        summary: [{ text: "고혈압 기록", evidenceEventIds: ["fabricated"] }],
      }));
    }
    return ollamaResponse(JSON.stringify(validDraft));
  };
  const result = await runClinicalCopilot(payload, { model: "local-model", fetchImpl });
  assert.equal(requests.length, 2);
  assert.equal(result.kind, "model");
  assert.deepEqual(result.summary[0].evidenceEventIds, ["e1", "e2"]);
  const retryMessages = requests[1].messages;
  assert.equal(retryMessages.length, requests[0].messages.length + 2);
  assert.match(retryMessages.at(-1).content, /이전 초안이 거부되었습니다/);
  assert.match(retryMessages.at(-1).content, /차트 근거/);
});

test("JSON이 아닌 응답도 한 번 더 재시도한 뒤에만 실패를 반환한다", async () => {
  let calls = 0;
  await assert.rejects(
    () => runClinicalCopilot(payload, {
      model: "local-model",
      fetchImpl: async () => {
        calls += 1;
        return ollamaResponse("이건 JSON이 아닙니다");
      },
    }),
    /JSON 형식이 아닙니다/,
  );
  assert.equal(calls, 2);
});

test("전송 오류는 재시도하지 않고 그대로 전파한다", async () => {
  let calls = 0;
  await assert.rejects(
    () => runClinicalCopilot(payload, {
      model: "local-model",
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", { status: 500 });
      },
    }),
    /로컬 Ollama 요청 실패 \(500\)/,
  );
  assert.equal(calls, 1);
});
