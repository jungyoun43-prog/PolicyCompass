import assert from "node:assert/strict";
import test from "node:test";

import {
  resumeClaimReview,
  startClaimReview,
} from "../scripts/graphs/claim-review-graph.mjs";

const payload = {
  evaluation: {
    id: "claim-1",
    title: "고혈압 추적검사",
    status: "missing-evidence",
    explanation: "최근 6개월 내 추적 검사가 기록되지 않았습니다.",
    missingEvidence: ["최근 혈액검사"],
    nextEligibleDate: "2026-09-01",
    evidenceEventIds: ["e1"],
  },
  events: [{ id: "e1", label: "고혈압", date: "2026-01-01" }],
};

test("검토 시작은 초안을 만들고 의료진 확인 단계에서 일시정지한다", async () => {
  const started = await startClaimReview(payload, { environment: {} });
  assert.equal(started.status, "awaiting-review");
  assert.ok(started.threadId);
  assert.equal(started.review.evaluationId, "claim-1");
  assert.equal(started.review.draft.draftedBy, "rule");
  assert.match(started.review.draft.explanation, /missing-evidence/);
  assert.ok(started.review.draft.nextSteps.some((step) => step.includes("최근 혈액검사")));
  assert.ok(started.review.draft.nextSteps.some((step) => step.includes("2026-09-01")));

  const completed = await resumeClaimReview(started.threadId, { action: "approve", note: "확인함" });
  assert.equal(completed.status, "completed");
  assert.equal(completed.result.status, "clinician-confirmed");
  assert.equal(completed.result.confirmed, true);
  assert.equal(completed.result.note, "확인함");

  await assert.rejects(
    () => resumeClaimReview(started.threadId, { action: "approve" }),
    /알 수 없거나 만료된 검토 스레드/,
  );
});

test("revise 결정은 의견을 반영한 새 초안으로 같은 스레드에서 다시 일시정지한다", async () => {
  const started = await startClaimReview(payload, { environment: {} });
  const revised = await resumeClaimReview(started.threadId, {
    action: "revise",
    note: "다음 가능일 안내를 먼저 적어 주세요",
  });
  assert.equal(revised.status, "awaiting-review");
  assert.equal(revised.threadId, started.threadId);
  assert.match(revised.review.draft.explanation, /검토 의견 반영: 다음 가능일 안내를 먼저 적어 주세요/);

  const discarded = await resumeClaimReview(started.threadId, { action: "discard" });
  assert.equal(discarded.status, "completed");
  assert.equal(discarded.result.status, "discarded");
  assert.equal(discarded.result.confirmed, false);
  assert.equal(discarded.result.revisions.length, 1);
});

test("revise에는 의견이 필요하고 결정 값은 화이트리스트만 허용한다", async () => {
  const started = await startClaimReview(payload, { environment: {} });
  await assert.rejects(() => resumeClaimReview(started.threadId, { action: "revise" }), /수정 의견/);
  await assert.rejects(() => resumeClaimReview(started.threadId, { action: "delete-all" }), /approve, revise, discard/);
  const done = await resumeClaimReview(started.threadId, { action: "discard" });
  assert.equal(done.status, "completed");
});

test("모델이 설정되면 초안을 모델이 쓰고 근거 ID는 입력으로 제한한다", async () => {
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.model, "clinic-local");
    return new Response(JSON.stringify({
      model: "clinic-local",
      message: {
        content: JSON.stringify({
          explanation: "추적 검사가 없어 근거 보완이 필요한 상태입니다.",
          nextSteps: ["최근 혈액검사 결과를 확인해 첨부하세요."],
          evidenceEventIds: calls === 1 ? ["fabricated"] : ["e1"],
        }),
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const started = await startClaimReview(payload, {
    environment: { POLICYCOMPASS_OLLAMA_MODEL: "clinic-local" },
    fetchImpl,
  });
  assert.equal(calls, 2);
  assert.equal(started.review.draft.draftedBy, "local-model");
  assert.deepEqual(started.review.draft.evidenceEventIds, ["e1"]);
  const done = await resumeClaimReview(started.threadId, { action: "approve" });
  assert.equal(done.status, "completed");
});

test("평가 정보가 없거나 불완전하면 TypeError로 거부한다", async () => {
  await assert.rejects(() => startClaimReview({}, { environment: {} }), TypeError);
  await assert.rejects(
    () => startClaimReview({ evaluation: { id: "x" } }, { environment: {} }),
    /id, title, status/,
  );
});
