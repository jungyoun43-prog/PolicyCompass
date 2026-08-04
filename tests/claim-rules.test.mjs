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

test("고시·문서번호는 선택 필드로 보존하고 내장 샘플은 공식 고시를 사칭하지 않는다", () => {
  const withoutDocumentNumber = normalizeClaimRule({
    id: "legacy-rule",
    title: "기존 규칙",
    serviceCode: "LEGACY-SERVICE",
    effectiveFrom: "2026-01-01",
  });
  assert.equal(Object.hasOwn(withoutDocumentNumber, "sourceDocumentNumber"), false);

  const withDocumentNumber = normalizeClaimRule({
    id: "documented-rule",
    title: "문서 연결 규칙",
    serviceCode: "DOCUMENTED-SERVICE",
    effectiveFrom: "2026-01-01",
    sourceDocumentNumber: "보험급여과-1234",
  });
  assert.equal(withDocumentNumber.sourceDocumentNumber, "보험급여과-1234");
  assert.ok(DEFAULT_CLAIM_RULES.every(({ sourceDocumentNumber }) => /^기관 규칙 VG-2026-\d{2}$/.test(sourceDocumentNumber)));
  assert.ok(DEFAULT_CLAIM_RULES.every(({ sourceDocumentNumber }) => !/고시|심평원/.test(sourceDocumentNumber)));
  assert.ok(DEFAULT_CLAIM_RULES.every(({ ruleSetId, version }) => !/demo/i.test(`${ruleSetId} ${version}`)));
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

test("형식·단위가 검증되지 않은 표준 측정은 급여 근거가 되지 않는다", () => {
  const bloodPressureRule = DEFAULT_CLAIM_RULES.find(({ id }) => id === "demo-bp-follow-up");
  const result = evaluateClaimRule({
    id: "p",
    name: "환자",
    events: [
      { id: "dx", type: "condition", recordStatus: "final", system: KCD_SYSTEM, code: "I10", label: "고혈압", date: "2026-01-01", status: "active" },
      { id: "invalid-bp", type: "observation", recordStatus: "final", system: "http://loinc.org", code: "85354-9", label: "혈압", date: "2026-07-10", status: "final", value: "not-a-blood-pressure", unit: "evil", source: { kind: "manual" } },
    ],
  }, bloodPressureRule, "2026-07-19");

  assert.equal(result.status, "missing-evidence");
  assert.deepEqual(result.missingEvidence, ["90일 이내 혈압 기록"]);
});

test("출처 미검증 백업 기록은 코드와 값이 맞아도 급여 근거가 되지 않는다", () => {
  const result = evaluateClaimRule({
    id: "patient-imported",
    name: "백업 환자",
    events: [{
      id: "imported-bp",
      type: "observation",
      recordStatus: "final",
      status: "final",
      system: "http://loinc.org",
      code: "85354-9",
      label: "혈압 패널",
      date: "2026-07-19",
      value: "128/78",
      unit: "mmHg",
      source: { kind: "import", label: "백업 복원 · 출처 미검증", resourceId: "" },
    }],
  }, {
    id: "bp-import-check",
    title: "혈압 확인",
    serviceCode: "BP-CHECK",
    serviceSystem: "urn:institution:service",
    requiredEvidence: [{ system: "http://loinc.org", code: "85354-9", eventTypes: ["observation"], statuses: ["final"] }],
    effectiveFrom: "2026-01-01",
    sourceLabel: "기관 검증 기준",
  }, "2026-07-20");

  assert.equal(result.status, "missing-evidence");
  assert.deepEqual(result.evidenceEventIds, []);
});

test("출처 미검증 백업의 시행 기록은 급여 사용 횟수에도 포함하지 않는다", () => {
  const result = evaluateClaimRule({
    id: "patient-imported-service",
    name: "백업 환자",
    events: [{
      id: "imported-service",
      type: "procedure",
      recordStatus: "final",
      status: "completed",
      system: "urn:institution:service",
      code: "SERVICE-1",
      label: "출처 미검증 시행",
      date: "2026-07-19",
      source: { kind: "import", label: "백업 복원 · 출처 미검증", resourceId: "" },
    }],
  }, {
    id: "imported-service-check",
    title: "시행 횟수 확인",
    serviceCode: "SERVICE-1",
    serviceSystem: "urn:institution:service",
    maxCount: 1,
    effectiveFrom: "2026-01-01",
  }, "2026-07-20");

  assert.equal(result.status, "ready");
  assert.equal(result.usedCount, 0);
  assert.deepEqual(result.evidenceEventIds, []);
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
  assert.equal(result.calculationAvailable, true);
  assert.equal(result.usedCount, 1);
  assert.equal(result.windowStart, "2026-04-21");
  assert.equal(result.windowEnd, "2026-07-19");
  assert.deepEqual(result.serviceEventIds, ["proc"]);
  assert.equal(result.lastServiceDate, "2026-06-20");
  assert.equal(result.daysSinceLastService, 29);
  assert.equal(result.nextEligibleDate, "2026-09-18");
  assert.deepEqual(result.missingEvidence, []);
  assert.match(result.explanation, /EMR 확정 기록.*최근 90일.*1\/1회.*자동 집계/);
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
  assert.deepEqual(result.serviceEventIds, []);
  assert.equal(result.lastServiceDate, "");
  assert.equal(result.daysSinceLastService, null);
  assert.match(result.explanation, /EMR 확정 기록.*자동 집계.*남은 기준 횟수는 1회/);
});

test("집계 구간 밖의 최근 확정 시행은 횟수에서 제외하되 마지막 시행일로 구분한다", () => {
  const result = evaluateClaimRule({
    ...patient,
    events: [
      ...patient.events.filter(({ id }) => id !== "proc"),
      { id: "old-proc", type: "procedure", code: "DEMO-PROC", label: "이전 추적검사", date: "2026-03-01", status: "completed" },
    ],
  }, {
    id: "rule-outside-window",
    title: "예시 추적검사",
    serviceCode: "DEMO-PROC",
    windowDays: 90,
    maxCount: 1,
    requiredEvidenceCodes: ["I10"],
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");

  assert.equal(result.usedCount, 0);
  assert.deepEqual(result.serviceEventIds, []);
  assert.equal(result.lastServiceDate, "2026-03-01");
  assert.equal(result.daysSinceLastService, 140);
  assert.ok(result.evidenceEventIds.includes("old-proc"));
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
  assert.equal(result.calculationAvailable, false);
  assert.equal(result.usedCount, 0);
  assert.equal(result.lastServiceDate, "");
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
    events: [...baseEvents, { id: "bp", type: "observation", system: "http://loinc.org", code: "85354-9", label: "혈압", value: "138/88", unit: "mmHg", date: "2026-07-10", status: "final" }],
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

test("값 없거나 표준 범위를 벗어난 Observation은 필수 근거나 시행 횟수로 계산하지 않는다", () => {
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
  const validService = evaluateClaimRule({
    id: "p4",
    name: "환자",
    events: [{ ...blankObservation, id: "valid", value: "120/80", unit: "mmHg" }],
  }, serviceRule, "2026-07-19");

  assert.equal(evidenceResult.status, "missing-evidence");
  assert.deepEqual(evidenceResult.evidenceEventIds, []);
  assert.equal(blankService.usedCount, 0);
  assert.equal(zeroService.usedCount, 0);
  assert.equal(zeroService.status, "ready");
  assert.equal(validService.usedCount, 1);
  assert.equal(validService.status, "waiting");
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
