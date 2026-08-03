import assert from "node:assert/strict";
import test from "node:test";

import { createVisitBrief } from "../src/insight-model.js";

test("입력 신호를 중복과 알 수 없는 값 없이 정규화한다", () => {
  const brief = createVisitBrief([
    "hypertension",
    "unknown",
    "hypertension",
    "diabetes",
  ]);

  assert.deepEqual(brief.ids, ["hypertension", "diabetes"]);
  assert.deepEqual(brief.signals.map(({ id }) => id), ["hypertension", "diabetes"]);
  assert.equal(brief.coverage, "2개 입력 신호에서 진료 질문을 정리했습니다.");
});

test("여러 입력 신호를 고르게 반영하고 질문은 최대 다섯 개로 제한한다", () => {
  const brief = createVisitBrief([
    "hypertension",
    "diabetes",
    "asthma",
    "copd",
    "migraine",
    "reflux",
    "mood",
    "arthritis",
  ]);

  assert.equal(brief.questions.length, 5);
  assert.deepEqual(
    brief.questions.map(({ sourceId }) => sourceId),
    ["hypertension", "diabetes", "asthma", "copd", "migraine"],
  );
  assert.equal(new Set(brief.questions.map(({ question }) => question)).size, 5);
  assert.equal(brief.countLabel, "5개 질문");
});

test("확정 COPD 신호는 식사·활동·흡입기·진료 시점을 쉬운 질문으로 정리한다", () => {
  const brief = createVisitBrief(["copd"]);
  const questionText = brief.questions.map(({ question }) => question).join(" ");

  assert.equal(brief.questions.length, 4);
  assert.deepEqual(brief.questions.map(({ sourceId }) => sourceId), ["copd", "copd", "copd", "copd"]);
  assert.match(questionText, /무엇을 먹으면 좋고/);
  assert.match(questionText, /일주일에 몇 번·한 번에 몇 분/);
  assert.match(questionText, /흡입기는 언제/);
  assert.match(questionText, /언제 병원에 연락하고/);
  assert.ok(brief.questions.every(({ question, sourceLabel }) => (
    question.endsWith("?") && sourceLabel === "만성폐쇄성폐질환(COPD)"
  )));
  assert.doesNotMatch(questionText, /진단 확정|기관 점수|급여|폐기능 수치/);
});

test("각 질문은 확인 이유와 입력 근거를 함께 제공한다", () => {
  const brief = createVisitBrief(["arthritis"]);

  assert.equal(brief.questions.length, 2);
  for (const question of brief.questions) {
    assert.ok(question.question.endsWith("?"));
    assert.ok(question.reason.length > 0);
    assert.match(question.basis, /건강 지도.*관련 입력 신호/);
    assert.equal(question.sourceLabel, "관절염");
    assert.doesNotMatch(question.question, /진단|확률|예측/);
  }
  assert.match(brief.disclaimer, /진단·처방·응급 판단을 제공하지 않습니다/);
});

test("입력 신호가 없으면 인쇄 가능한 질문 없이 빈 상태를 반환한다", () => {
  const brief = createVisitBrief(null);

  assert.deepEqual(brief.ids, []);
  assert.deepEqual(brief.questions, []);
  assert.deepEqual(brief.signals, []);
  assert.equal(brief.countLabel, "0개 질문");
  assert.equal(brief.coverage, "아직 질문을 만들 입력 신호가 없습니다.");
});
