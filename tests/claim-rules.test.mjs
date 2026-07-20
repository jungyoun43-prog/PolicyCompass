import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClaimBoard,
  DEFAULT_CLAIM_RULES,
  evaluateClaimRule,
  KCD_SYSTEM,
  normalizeClaimRule,
} from "../src/claim-rules.js";

const patient = {
  id: "p1",
  mrn: "VG-1",
  name: "김비타",
  events: [
    { id: "dx", type: "condition", code: "I10", label: "고혈압", date: "2026-01-01" },
    { id: "bp", type: "observation", code: "85354-9", label: "혈압", value: "138/88", unit: "mmHg", date: "2026-07-10" },
    { id: "proc", type: "procedure", code: "DEMO-PROC", label: "예시 추적검사", date: "2026-06-20", status: "completed" },
  ],
};

test("급여 규칙은 시행일·종료일·횟수·기간·근거를 정규화한다", () => {
  const rule = normalizeClaimRule({
    id: "rule-1",
    title: "예시 추적검사",
    serviceCode: "DEMO-PROC",
    windowDays: "90",
    maxCount: "1",
    requiredEvidenceCodes: ["I10", "85354-9", ""],
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    sourceLabel: "기관 내부 검증용 샘플",
  });

  assert.equal(rule.windowDays, 90);
  assert.equal(rule.maxCount, 1);
  assert.deepEqual(rule.requiredEvidenceCodes, ["I10", "85354-9"]);
});

test("근거 최근성을 비우면 무제한 0일로 명시 저장할 수 있다", () => {
  const rule = normalizeClaimRule({
    id: "no-lookback",
    title: "최근성 제한 없음",
    serviceCode: "SERVICE",
    requiredEvidence: [{ code: "I10", label: "진단", lookbackDays: 0 }],
    effectiveFrom: "2026-01-01",
  });

  assert.equal(rule.requiredEvidence[0].lookbackDays, 0);
});

test("내장 추적 규칙은 같은 코드의 진단을 검사 결과로 오인하지 않는다", () => {
  const bloodPressureRule = DEFAULT_CLAIM_RULES.find(({ id }) => id === "demo-bp-follow-up");
  const result = evaluateClaimRule({
    id: "p",
    name: "환자",
    events: [
      { id: "dx", type: "condition", system: KCD_SYSTEM, code: "I10", label: "고혈압", date: "2026-01-01", status: "active" },
      { id: "wrong-type", type: "condition", system: "http://loinc.org", code: "85354-9", label: "혈압 코드 진단", date: "2026-07-10", status: "active" },
    ],
  }, bloodPressureRule, "2026-07-19");

  assert.equal(result.status, "missing-evidence");
  assert.deepEqual(result.missingEvidence, ["90일 이내 혈압 기록"]);
});

test("기준기간 내 횟수를 모두 사용하면 다음 인정 가능일을 계산한다", () => {
  const result = evaluateClaimRule(patient, {
    id: "rule-1",
    title: "예시 추적검사",
    serviceCode: "DEMO-PROC",
    windowDays: 90,
    maxCount: 1,
    requiredEvidenceCodes: ["I10"],
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");

  assert.equal(result.status, "waiting");
  assert.equal(result.usedCount, 1);
  assert.equal(result.nextEligibleDate, "2026-09-18");
  assert.deepEqual(result.missingEvidence, []);
});

test("필수 근거가 없으면 횟수 상태보다 근거 부족을 우선한다", () => {
  const result = evaluateClaimRule(patient, {
    id: "rule-2",
    title: "예시 검사",
    serviceCode: "DEMO-OTHER",
    windowDays: 180,
    maxCount: 1,
    requiredEvidenceCodes: ["MISSING-CODE"],
    evidenceLabels: { "MISSING-CODE": "최근 기능검사" },
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");

  assert.equal(result.status, "missing-evidence");
  assert.deepEqual(result.missingEvidence, ["최근 기능검사"]);
});

test("아직 시행되지 않았고 근거가 충족되면 준비 가능 상태다", () => {
  const result = evaluateClaimRule(patient, {
    id: "rule-3",
    title: "예시 신규검사",
    serviceCode: "DEMO-NEW",
    windowDays: 365,
    maxCount: 1,
    requiredEvidenceCodes: ["I10", "85354-9"],
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");

  assert.equal(result.status, "ready");
  assert.equal(result.usedCount, 0);
  assert.equal(result.remainingCount, 1);
});

test("시행 전후가 맞지 않는 규칙은 판정하지 않는다", () => {
  const result = evaluateClaimRule(patient, {
    id: "future-rule",
    title: "미시행 규칙",
    serviceCode: "DEMO",
    windowDays: 30,
    maxCount: 1,
    effectiveFrom: "2026-08-01",
  }, "2026-07-19");

  assert.equal(result.status, "not-applicable");
});

test("전체 환자 급여 보드는 판정 상태별 칸과 환자 근거를 만든다", () => {
  const board = buildClaimBoard([patient], [{
    id: "rule-1",
    title: "예시 추적검사",
    serviceCode: "DEMO-PROC",
    windowDays: 90,
    maxCount: 1,
    requiredEvidenceCodes: ["I10"],
    effectiveFrom: "2026-01-01",
  }], "2026-07-19");

  assert.equal(board.total, 1);
  assert.equal(board.lanes.waiting.length, 1);
  assert.equal(board.lanes.waiting[0].patientName, "김비타");
  assert.ok(board.lanes.waiting[0].evidenceEventIds.includes("proc"));
});

test("적용 조건이 없는 환자는 근거 보완 대상으로 만들지 않는다", () => {
  const result = evaluateClaimRule({
    id: "migraine-patient",
    name: "편두통 환자",
    events: [{ id: "migraine", type: "condition", code: "G43", label: "편두통", date: "2026-01-01", status: "active" }],
  }, {
    id: "bp-rule",
    ruleSetId: "bp",
    version: "1",
    title: "고혈압 추적",
    serviceCode: "DEMO-BP",
    applicabilityCodes: ["I10"],
    requiredEvidence: [{ code: "85354-9", label: "혈압 기록", lookbackDays: 90 }],
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");

  assert.equal(result.status, "not-applicable");
  assert.deepEqual(result.missingEvidence, []);
});

test("완료된 해당 유형의 서비스만 차트 시행 횟수로 계산한다", () => {
  const events = [
    { id: "done", type: "procedure", code: "SERVICE", label: "완료", date: "2026-07-01", status: "completed" },
    { id: "planned", type: "procedure", code: "SERVICE", label: "예정", date: "2026-07-02", status: "preparation" },
    { id: "mention", type: "note", code: "SERVICE", label: "코드 언급", date: "2026-07-03", status: "final" },
  ];
  const result = evaluateClaimRule({ id: "p", name: "환자", events }, {
    id: "rule",
    ruleSetId: "service",
    version: "1",
    title: "서비스",
    serviceCode: "SERVICE",
    serviceEventType: "procedure",
    windowDays: 365,
    maxCount: 2,
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");

  assert.equal(result.usedCount, 1);
  assert.deepEqual(result.evidenceEventIds, ["done"]);
});

test("복수 횟수 규칙의 다음 확인일은 허용량을 비우는 차트 기록 기준으로 계산한다", () => {
  const events = [
    { id: "first", type: "procedure", code: "SERVICE", label: "첫 시행", date: "2026-01-10", status: "completed" },
    { id: "second", type: "procedure", code: "SERVICE", label: "둘째 시행", date: "2026-06-01", status: "completed" },
  ];
  const result = evaluateClaimRule({ id: "p", name: "환자", events }, {
    id: "rule",
    ruleSetId: "service",
    version: "1",
    title: "서비스",
    serviceCode: "SERVICE",
    serviceEventType: "procedure",
    windowDays: 365,
    maxCount: 2,
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");

  assert.equal(result.usedCount, 2);
  assert.equal(result.nextEligibleDate, "2027-01-10");
});

test("근거 최근성은 서비스 기준기간과 분리해 평가한다", () => {
  const result = evaluateClaimRule({
    id: "p",
    name: "환자",
    events: [
      { id: "dx", type: "condition", code: "I10", label: "고혈압", date: "2020-01-01", status: "active" },
      { id: "old-bp", type: "observation", code: "85354-9", label: "혈압", value: "140/90", date: "2026-01-01", status: "final" },
    ],
  }, {
    id: "rule",
    ruleSetId: "bp",
    version: "1",
    title: "고혈압 추적",
    serviceCode: "SERVICE",
    applicabilityCodes: ["I10"],
    requiredEvidence: [{ code: "85354-9", label: "90일 이내 혈압", lookbackDays: 90 }],
    windowDays: 365,
    maxCount: 1,
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");

  assert.equal(result.status, "missing-evidence");
  assert.deepEqual(result.missingEvidence, ["90일 이내 혈압"]);
  assert.ok(result.evidenceEventIds.includes("dx"));
});

test("잘못된 숫자와 역전된 시행기간의 규칙은 거부한다", () => {
  assert.equal(normalizeClaimRule({
    id: "bad-count",
    title: "오류",
    serviceCode: "X",
    windowDays: 0,
    maxCount: 1,
    effectiveFrom: "2026-01-01",
  }), null);
  assert.equal(normalizeClaimRule({
    id: "bad-range",
    title: "오류",
    serviceCode: "X",
    effectiveFrom: "2026-12-31",
    effectiveTo: "2026-01-01",
  }), null);
  assert.equal(normalizeClaimRule({
    id: "unsafe-window",
    title: "오류",
    serviceCode: "X",
    windowDays: 200_000_000,
    effectiveFrom: "2026-01-01",
  }), null);
  assert.equal(normalizeClaimRule({
    id: "unsafe-lookback",
    title: "오류",
    serviceCode: "X",
    requiredEvidence: [{ code: "I10", lookbackDays: 3_651 }],
    effectiveFrom: "2026-01-01",
  }), null);
  assert.equal(normalizeClaimRule({
    id: "partial-number",
    title: "오류",
    serviceCode: "X",
    maxCount: "1회",
    effectiveFrom: "2026-01-01",
  }), null);
});

test("비활성 진단과 메모 코드는 적용 조건·검사 근거로 인정하지 않는다", () => {
  const result = evaluateClaimRule({
    id: "p",
    name: "환자",
    events: [
      { id: "resolved", type: "condition", code: "I10", label: "해결된 고혈압", date: "2026-01-01", status: "resolved" },
      { id: "note", type: "note", code: "85354-9", label: "혈압 코드 메모", date: "2026-07-10", status: "final" },
    ],
  }, {
    id: "rule",
    title: "고혈압 추적",
    serviceCode: "SERVICE",
    applicabilityCodes: ["I10"],
    requiredEvidence: [{ code: "85354-9", label: "혈압", lookbackDays: 90 }],
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");

  assert.equal(result.status, "not-applicable");
  assert.deepEqual(result.evidenceEventIds, []);
});

test("검사 근거는 확정 상태와 코드 시스템을 모두 만족해야 한다", () => {
  const rule = {
    id: "rule",
    title: "고혈압 추적",
    serviceCode: "SERVICE",
    applicabilityCodes: ["I10"],
    requiredEvidence: [{ code: "85354-9", system: "http://loinc.org", label: "혈압", eventTypes: ["observation"], lookbackDays: 90 }],
    effectiveFrom: "2026-01-01",
  };
  const baseEvents = [
    { id: "dx", type: "condition", code: "I10", label: "고혈압", date: "2026-01-01", status: "active" },
  ];
  const preliminary = evaluateClaimRule({
    id: "p1",
    name: "환자",
    events: [...baseEvents, { id: "bp", type: "observation", system: "http://loinc.org", code: "85354-9", label: "혈압", value: "138/88", date: "2026-07-10", status: "preliminary" }],
  }, rule, "2026-07-19");
  const wrongSystem = evaluateClaimRule({
    id: "p2",
    name: "환자",
    events: [...baseEvents, { id: "bp", type: "observation", system: "http://example.test", code: "85354-9", label: "혈압", value: "138/88", date: "2026-07-10", status: "final" }],
  }, rule, "2026-07-19");
  const valid = evaluateClaimRule({
    id: "p3",
    name: "환자",
    events: [...baseEvents, { id: "bp", type: "observation", system: "http://loinc.org", code: "85354-9", label: "혈압", value: "138/88", date: "2026-07-10", status: "final" }],
  }, rule, "2026-07-19");

  assert.equal(preliminary.status, "missing-evidence");
  assert.equal(wrongSystem.status, "missing-evidence");
  assert.equal(valid.status, "ready");
});

test("적용 조건과 시행 서비스는 규칙에 지정된 코드 시스템까지 일치해야 한다", () => {
  const rule = {
    id: "namespaced",
    title: "코드체계 검사",
    serviceCode: "SVC-1",
    serviceSystem: "urn:edi:official",
    applicabilityCodes: ["I10"],
    applicabilitySystem: "urn:kcd:official",
    effectiveFrom: "2026-01-01",
  };
  const wrongCondition = evaluateClaimRule({
    id: "p1",
    name: "환자",
    events: [{ id: "dx", type: "condition", system: "urn:not-kcd", code: "I10", label: "다른 코드체계", date: "2026-01-01", status: "active" }],
  }, rule, "2026-07-19");
  const wrongService = evaluateClaimRule({
    id: "p2",
    name: "환자",
    events: [
      { id: "dx", type: "condition", system: "urn:kcd:official", code: "I10", label: "고혈압", date: "2026-01-01", status: "active" },
      { id: "svc", type: "procedure", system: "urn:not-edi", code: "SVC-1", label: "다른 코드체계 서비스", date: "2026-07-01", status: "completed" },
    ],
  }, rule, "2026-07-19");
  const exact = evaluateClaimRule({
    id: "p3",
    name: "환자",
    events: [
      { id: "dx", type: "condition", system: "urn:kcd:official", code: "I10", label: "고혈압", date: "2026-01-01", status: "active" },
      { id: "svc", type: "procedure", system: "urn:edi:official", code: "SVC-1", label: "서비스", date: "2026-07-01", status: "completed" },
    ],
  }, rule, "2026-07-19");

  assert.equal(wrongCondition.status, "not-applicable");
  assert.equal(wrongService.status, "ready");
  assert.equal(wrongService.usedCount, 0);
  assert.equal(exact.status, "waiting");
  assert.equal(exact.usedCount, 1);
});

test("값 없는 Observation은 필수 근거나 시행 횟수로 계산하지 않는다", () => {
  const blankObservation = {
    id: "blank",
    type: "observation",
    system: "http://loinc.org",
    code: "85354-9",
    label: "결과 없는 혈압",
    value: "",
    date: "2026-07-10",
    status: "final",
  };
  const evidenceResult = evaluateClaimRule({ id: "p1", name: "환자", events: [blankObservation] }, {
    id: "evidence-rule",
    title: "혈압 근거",
    serviceCode: "SERVICE",
    requiredEvidence: [{ code: "85354-9", system: "http://loinc.org", label: "혈압", eventTypes: ["observation"] }],
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");
  const serviceRule = {
    id: "service-rule",
    title: "측정 시행",
    serviceCode: "85354-9",
    serviceSystem: "http://loinc.org",
    serviceEventType: "observation",
    maxCount: 1,
    effectiveFrom: "2026-01-01",
  };
  const blankService = evaluateClaimRule({ id: "p2", name: "환자", events: [blankObservation] }, serviceRule, "2026-07-19");
  const zeroService = evaluateClaimRule({
    id: "p3",
    name: "환자",
    events: [{ ...blankObservation, id: "zero", value: 0 }],
  }, serviceRule, "2026-07-19");

  assert.equal(evidenceResult.status, "missing-evidence");
  assert.deepEqual(evidenceResult.evidenceEventIds, []);
  assert.equal(blankService.usedCount, 0);
  assert.equal(zeroService.usedCount, 1);
  assert.equal(zeroService.status, "waiting");
});

test("반박 진단과 비주문 약물은 active 문자열이어도 급여 근거가 아니다", () => {
  const refuted = evaluateClaimRule({
    id: "p1",
    name: "환자",
    events: [{ id: "dx", type: "condition", code: "I10", label: "반박 진단", date: "2026-01-01", status: "active", verificationStatus: "refuted" }],
  }, {
    id: "condition-rule",
    title: "진단 적용",
    serviceCode: "SERVICE",
    applicabilityCodes: ["I10"],
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");
  const proposal = evaluateClaimRule({
    id: "p2",
    name: "환자",
    events: [{ id: "med", type: "medication", code: "MED", label: "제안 약물", date: "2026-07-01", status: "active", intent: "proposal" }],
  }, {
    id: "medication-rule",
    title: "약물 근거",
    serviceCode: "SERVICE",
    requiredEvidence: [{ code: "MED", label: "활성 주문 약물", eventTypes: ["medication"] }],
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");

  assert.equal(refuted.status, "not-applicable");
  assert.equal(proposal.status, "missing-evidence");
  assert.deepEqual(proposal.evidenceEventIds, []);
});
