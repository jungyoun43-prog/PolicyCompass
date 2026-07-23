import assert from "node:assert/strict";
import test from "node:test";

import {
  addClaimRule,
  addPatient,
  appendPatientEvent,
  clinicalContextFingerprint,
  confirmPatientEvent,
  createClinicalGraph,
  createCopilotRequest,
  createDemoEmrState,
  createEmptyEmrState,
  createLocalCopilotBrief,
  createPatient,
  EMR_STORAGE_KEY,
  exportEmrBackup,
  localCalendarDate,
  loadEmrState,
  normalizeEmrState,
  parseEmrBackup,
  recoverEmrState,
  removePatientEvent,
  retireClaimRule,
  saveEmrState,
  updatePatient,
} from "../src/emr-model.js";

function memoryStorage() {
  const memory = new Map();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  };
}

function memoryLockManager() {
  let tail = Promise.resolve();
  return {
    request(_name, _options, callback) {
      const result = tail.then(callback);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

test("EMR은 샘플을 자동 저장하지 않는 빈 로컬 상태로 시작한다", async () => {
  const state = createEmptyEmrState("2026-07-19T10:00:00.000Z");
  let raw = "";
  const storage = {
    getItem: () => raw,
    setItem: (_key, value) => { raw = value; },
  };
  await saveEmrState(state, storage);
  const reloaded = loadEmrState(storage);

  assert.equal(state.schema, "vitagraph-emr");
  assert.equal(state.version, 2);
  assert.deepEqual(state.patients, []);
  assert.equal(state.demo, false);
  assert.equal(reloaded.storageError, "");
  assert.equal(reloaded.rules.length, 3);
  assert.ok(reloaded.rules.every((rule) => rule.serviceSystem));
});

test("환자와 임상 이벤트를 정규화해 감사 이력과 함께 추가한다", () => {
  const initial = createEmptyEmrState("2026-07-19T10:00:00.000Z");
  const patient = createPatient({
    id: "patient-1",
    mrn: "VG-1001",
    name: "김비타",
    birthDate: "1974-04-12",
    sex: "female",
  }, "2026-07-19T10:01:00.000Z");
  const withPatient = addPatient(initial, patient, "2026-07-19T10:01:00.000Z");
  const next = appendPatientEvent(withPatient, patient.id, {
    id: "event-1",
    type: "observation",
    code: "85354-9",
    label: "혈압",
    value: "148/94",
    unit: "mmHg",
    date: "2026-07-19",
    source: { kind: "manual", label: "직접 입력" },
  }, "2026-07-19T10:02:00.000Z");

  assert.equal(next.patients[0].events[0].label, "혈압");
  assert.equal(next.selectedPatientId, "patient-1");
  assert.equal(next.audit.at(-1).action, "patient.event.added");
  assert.deepEqual(initial.patients, []);
  assert.throws(() => appendPatientEvent(withPatient, patient.id, {
    id: "refuted-event",
    type: "condition",
    label: "반박 진단",
    date: "2026-07-19",
    status: "active",
    verificationStatus: "refuted",
  }), /상태·검증·의도/);

  assert.throws(() => removePatientEvent(next, patient.id, "event-1", ""), /취소 사유/);
  const voided = removePatientEvent(next, patient.id, "event-1", "잘못 입력한 측정값", "2026-07-19T10:03:00.000Z");
  assert.equal(voided.patients[0].events[0].recordStatus, "entered-in-error");
  assert.match(voided.patients[0].events[0].note, /기록 취소: 잘못 입력한 측정값/);
  assert.equal(voided.audit.at(-1).action, "patient.event.voided");
  assert.equal(voided.audit.at(-1).entityId, "event-1");
  assert.equal(next.patients[0].events[0].recordStatus, "draft");
  assert.throws(() => removePatientEvent(voided, patient.id, "event-1", "재취소"), /이미 취소/);
});

test("직접 입력 과거자료는 의료진 검토 후에만 확정 차트 사실이 된다", () => {
  let state = addPatient(createEmptyEmrState("2026-07-19T10:00:00.000Z"), {
    id: "patient-confirm",
    mrn: "CONFIRM-1",
    name: "확정 환자",
  }, "2026-07-19T10:00:00.000Z");
  assert.throws(() => appendPatientEvent(state, "patient-confirm", {
    id: "invalid-manual-blood-pressure",
    type: "observation",
    system: "http://loinc.org",
    code: "85354-9",
    label: "혈압",
    value: "not-a-blood-pressure",
    unit: "evil",
    date: "2026-07-19",
    source: { kind: "manual", label: "직접 입력 · 검토 대기" },
  }), /표준 측정값·단위/);
  state = appendPatientEvent(state, "patient-confirm", {
    id: "manual-hba1c",
    type: "observation",
    system: "http://loinc.org",
    code: "4548-4",
    label: "당화혈색소",
    value: 7.1,
    unit: "%",
    date: "2026-07-19",
    source: { kind: "manual", label: "직접 입력 · 검토 대기" },
  }, "2026-07-19T10:01:00.000Z");
  assert.equal(state.patients[0].events[0].recordStatus, "draft");

  const confirmed = confirmPatientEvent(state, "patient-confirm", "manual-hba1c", "2026-07-19T10:02:00.000Z");
  assert.equal(confirmed.patients[0].events[0].recordStatus, "final");
  assert.equal(confirmed.patients[0].events[0].source.label, "직접 입력 · 의료진 검토 확정");
  assert.equal(confirmed.audit.at(-1).action, "patient.event.confirmed");
  assert.throws(() => confirmPatientEvent(confirmed, "patient-confirm", "manual-hba1c"), /검토 대기/);

  const futureDraft = appendPatientEvent(confirmed, "patient-confirm", {
    id: "future-observation",
    type: "observation",
    system: "http://loinc.org",
    code: "2089-1",
    label: "미래 LDL",
    value: 120,
    unit: "mg/dL",
    date: "2026-07-21",
    source: { kind: "manual", label: "직접 입력" },
  }, "2026-07-19T10:03:00.000Z");
  assert.throws(
    () => confirmPatientEvent(futureDraft, "patient-confirm", "future-observation", "2026-07-19T10:04:00.000Z"),
    /미래 날짜/,
  );
});

test("진료가 선택된 상태에서도 새 환자를 등록하고 저장할 수 있다", async () => {
  const current = createDemoEmrState("2026-07-19T10:00:00.000Z");
  assert.ok(current.selectedEncounterId);

  const next = addPatient(current, {
    id: "new-patient-after-encounter",
    mrn: "VG-NEW-1001",
    name: "신규 환자",
    ageYears: 47,
    sex: "male",
  }, "2026-07-19T10:01:00.000Z");

  assert.equal(next.selectedPatientId, "new-patient-after-encounter");
  assert.equal(next.selectedEncounterId, "");
  await assert.doesNotReject(() => saveEmrState(next, memoryStorage()));
});

test("손상되거나 중복된 EMR 입력은 안전하게 정규화한다", () => {
  const normalized = normalizeEmrState({
    schema: "vitagraph-emr",
    version: 1,
    patients: [
      { id: "p1", mrn: "A", name: "첫 환자", events: [{ id: "e1", type: "note", label: "메모", date: "2026-07-01" }] },
      { id: "p1", mrn: "B", name: "중복 환자", events: [] },
      { name: "식별자 없음" },
    ],
    rules: [{ id: "r1", title: "규칙", serviceCode: "DEMO", effectiveFrom: "2026-01-01" }],
    audit: [{ id: "a1", at: "2026-07-01T00:00:00.000Z", action: "import" }],
  });

  assert.equal(normalized.patients.length, 1);
  assert.equal(normalized.patients[0].name, "첫 환자");
  assert.equal(normalized.patients[0].events.length, 1);
  assert.equal(normalized.rules.length, 1);
});

test("샘플 EMR은 임상기록·VitaGraph·급여 보드를 확인할 충분한 자료를 제공한다", () => {
  const demo = createDemoEmrState("2026-07-19T10:00:00.000Z");

  assert.equal(demo.demo, true);
  assert.ok(demo.patients.length >= 2);
  assert.ok(demo.patients[0].events.some(({ type }) => type === "condition"));
  assert.ok(demo.patients[0].events.some(({ type }) => type === "medication"));
  assert.ok(demo.patients[0].events.some(({ type }) => type === "procedure"));
  assert.ok(demo.rules.length >= 2);
});

test("로컬 코파일럿은 근거가 연결된 확정 전 초안만 만든다", () => {
  const patient = createDemoEmrState("2026-07-19T10:00:00.000Z").patients[0];
  const brief = createLocalCopilotBrief(patient, [{
    id: "case-1",
    status: "missing-evidence",
    title: "추적검사",
    missingEvidence: ["최근 검사 결과"],
    evidenceEventIds: [patient.events[0].id],
  }], "2026-07-19");

  assert.equal(brief.kind, "rule-based");
  assert.equal(brief.confirmed, false);
  assert.match(brief.disclaimer, /확정 기록이 아닙니다/);
  assert.ok(brief.summary.length > 0);
  assert.ok(brief.provenance.every(({ eventId }) => patient.events.some(({ id }) => id === eventId)));
});

test("로컬 코파일럿은 반박 진단과 제안 약물을 현재 사실로 요약하지 않는다", () => {
  const brief = createLocalCopilotBrief({
    id: "contradictory",
    name: "환자",
    events: [
      { id: "refuted", type: "condition", code: "I10", label: "반박된 고혈압", date: "2026-07-01", status: "active", verificationStatus: "refuted" },
      { id: "proposal", type: "medication", code: "MED", label: "제안 약물", date: "2026-07-02", status: "active", intent: "proposal" },
    ],
  }, [], "2026-07-19");

  assert.doesNotMatch(JSON.stringify(brief.summary), /반박된 고혈압|제안 약물/);
  assert.deepEqual(brief.provenance, []);
});

test("EMR 백업은 스키마·버전을 검증하며 왕복한다", () => {
  const state = createDemoEmrState("2026-07-19T10:00:00.000Z");
  const backup = exportEmrBackup(state, "2026-07-19T11:00:00.000Z");
  const restored = parseEmrBackup(JSON.parse(JSON.stringify(backup)));

  assert.equal(backup.schema, "vitagraph-emr-backup");
  assert.equal(restored.patients.length, state.patients.length);
  assert.equal(restored.demo, false);
  assert.throws(() => parseEmrBackup({ ...backup, version: 99 }), /지원하지 않는/);
  assert.throws(() => parseEmrBackup({
    ...backup,
    data: { ...backup.data, patients: [{ id: "broken", events: [{ bad: true }] }] },
  }), /손상|유효하지|이름/);
});

test("근거가 없는 임상 이벤트에 질환 연결을 지어내지 않는다", () => {
  const patient = createPatient({
    id: "p",
    name: "환자",
    events: [
      { id: "dx", type: "condition", code: "I10", label: "고혈압", date: "2026-01-01" },
      { id: "allergy", type: "allergy", code: "PEN", label: "페니실린 알레르기", date: "2026-01-02" },
      { id: "knee", type: "symptom", code: "KNEE", label: "무릎 통증", date: "2026-01-03" },
    ],
  });
  const graph = createClinicalGraph(patient);

  assert.equal(graph.edges.length, 0);
});

test("키워드로 만든 그래프 연결은 차트 사실이 아닌 추론과 근거로 표시한다", () => {
  const patient = createPatient({
    id: "p",
    name: "환자",
    events: [
      { id: "dx", type: "condition", code: "I10", label: "고혈압", date: "2026-01-01" },
      { id: "med", type: "medication", code: "UNKNOWN", label: "고혈압 관련 여부 미상 약물", date: "2026-01-02" },
    ],
  });
  const graph = createClinicalGraph(patient);

  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].kind, "inferred");
  assert.match(graph.edges[0].basis, /키워드 기반/);
});

test("24건을 넘는 임상 그래프는 중심 문제를 보존하고 전체·표시·생략 범위를 공개한다", () => {
  const patient = createPatient({
    id: "graph-limit",
    name: "그래프 제한 환자",
    events: [
      ...Array.from({ length: 28 }, (_, index) => ({
        id: `symptom-${index + 1}`,
        type: "symptom",
        code: `SYM-${index + 1}`,
        label: `비연결 증상 ${index + 1}`,
        date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      })),
      { id: "old-condition", type: "condition", code: "Z99", label: "오래된 중심 문제", date: "2020-01-02" },
    ],
  });

  assert.ok(patient.events.findIndex(({ id }) => id === "old-condition") >= 24);
  const graph = createClinicalGraph(patient);

  assert.equal(graph.nodes.length, 24);
  assert.ok(graph.nodes.some(({ id }) => id === "old-condition"));
  assert.equal(graph.edges.length, 0);
  assert.deepEqual(graph.projection, {
    limit: 24,
    totalRecords: 29,
    visibleRecords: 24,
    omittedRecords: 5,
    totalConditions: 1,
    visibleConditions: 1,
    omittedConditions: 0,
    dateRange: { from: "2020-01-02", to: "2026-07-28" },
    visibleDateRange: { from: "2020-01-02", to: "2026-07-28" },
  });

  const conditionOverflow = createClinicalGraph(createPatient({
    id: "condition-overflow",
    name: "중심 문제 제한 환자",
    events: Array.from({ length: 26 }, (_, index) => ({
      id: `condition-${index + 1}`,
      type: "condition",
      code: `Z${String(index + 1).padStart(2, "0")}`,
      label: `중심 문제 ${index + 1}`,
      date: `2025-01-${String(index + 1).padStart(2, "0")}`,
    })),
  }));
  assert.equal(conditionOverflow.projection.totalConditions, 26);
  assert.equal(conditionOverflow.projection.visibleConditions, 24);
  assert.equal(conditionOverflow.projection.omittedConditions, 2);
  assert.equal(conditionOverflow.projection.omittedRecords, 2);
});

test("저장소의 demo 플래그는 실제 로컬 기록을 비영속 데모로 바꾸지 않는다", async () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  };
  const demo = createDemoEmrState("2026-07-19T10:00:00.000Z");
  await saveEmrState(demo, storage);
  const loaded = loadEmrState(storage);

  assert.equal(loaded.demo, false);
});

test("브라우저 현지 날짜는 UTC 날짜 경계에서도 사용자 달력을 따른다", () => {
  const instant = new Date("2026-07-18T16:00:00.000Z");
  assert.equal(localCalendarDate(instant, -540), "2026-07-19");
});

test("환자 등록번호 중복은 UI 밖의 모델 경계에서도 거부한다", () => {
  const initial = addPatient(createEmptyEmrState(), { id: "p1", mrn: "SAME", name: "첫 환자" });
  assert.throws(() => addPatient(initial, { id: "p2", mrn: "SAME", name: "둘째 환자" }), /같은 등록번호/);
});

test("환자 생년월일·직접 나이는 추가·수정·저장·백업 모든 경계에서 검증한다", async () => {
  const base = createEmptyEmrState("2026-07-19T10:00:00.000Z");
  assert.throws(() => addPatient(base, { id: "future", mrn: "FUTURE", name: "미래", birthDate: "2099-01-01" }, "2026-07-19T10:00:00.000Z"), /미래/);
  assert.throws(() => addPatient(base, { id: "age", mrn: "AGE", name: "나이", ageYears: 131 }, "2026-07-19T10:00:00.000Z"), /130세/);
  assert.throws(() => addPatient(base, { id: "conflict", mrn: "CONFLICT", name: "충돌", birthDate: "2000-01-01", ageYears: 99 }, "2026-07-19T10:00:00.000Z"), /동시에 저장/);

  const valid = addPatient(base, { id: "p", mrn: "VALID", name: "환자", ageYears: 52 }, "2026-07-19T10:00:00.000Z");
  assert.throws(() => updatePatient(valid, "p", { ageYears: "52.5" }, "2026-07-19T10:01:00.000Z"), /정수/);

  const forged = structuredClone(valid);
  forged.patients[0].birthDate = "2099-01-01";
  await assert.rejects(() => saveEmrState(forged, memoryStorage()), /미래/);
  assert.throws(() => exportEmrBackup(forged), /미래/);
  const backup = exportEmrBackup(valid, "2026-07-19T10:02:00.000Z");
  backup.data.patients[0].birthDate = "2099-01-01";
  assert.throws(() => parseEmrBackup(backup), /미래/);
  const conflictingBackup = exportEmrBackup(valid, "2026-07-19T10:02:00.000Z");
  conflictingBackup.data.patients[0].birthDate = "2000-01-01";
  assert.throws(() => parseEmrBackup(conflictingBackup), /동시에 저장/);
});

test("저장과 백업은 중복 이벤트와 불가능한 취소 Encounter를 조용히 정규화하지 않는다", async () => {
  let state = addPatient(createEmptyEmrState("2026-07-19T10:00:00.000Z"), { id: "p", mrn: "EVENT-TEST", name: "환자" }, "2026-07-19T10:00:00.000Z");
  state = appendPatientEvent(state, "p", { id: "event", type: "note", label: "기록", date: "2026-07-19" }, "2026-07-19T10:01:00.000Z");
  const duplicate = structuredClone(state);
  duplicate.patients[0].events.push(structuredClone(duplicate.patients[0].events[0]));
  await assert.rejects(() => saveEmrState(duplicate, memoryStorage()), /손상|유실/);
  assert.throws(() => exportEmrBackup(duplicate), /손상|유실/);

  const impossible = structuredClone(state);
  impossible.patients[0].events = [{
    id: "cancelled-draft",
    type: "encounter",
    recordStatus: "draft",
    status: "cancelled",
    label: "숨은 취소 진료",
    date: "2026-07-19",
    signature: { status: "unsigned", signer: "", signedAt: "" },
    source: { kind: "manual", label: "직접 입력", resourceId: "" },
  }];
  await assert.rejects(() => saveEmrState(impossible, memoryStorage()), /취소 Encounter/);
});

test("오래된 탭은 새 리비전을 덮어쓰지 못한다", async () => {
  const storage = memoryStorage();
  const initial = createEmptyEmrState("2026-07-19T10:00:00.000Z");
  await saveEmrState(initial, storage);
  const firstTab = addPatient(initial, { id: "first", mrn: "FIRST", name: "첫 탭" }, "2026-07-19T10:01:00.000Z");
  const staleTab = addPatient(initial, { id: "stale", mrn: "STALE", name: "오래된 탭" }, "2026-07-19T10:02:00.000Z");

  await saveEmrState(firstTab, storage, initial.revision);
  await assert.rejects(() => saveEmrState(staleTab, storage, initial.revision), /다른 탭.*변경/);
  assert.deepEqual(loadEmrState(storage).patients.map(({ id }) => id), ["first"]);
});

test("동시 탭 저장은 브라우저 잠금 안에서 직렬화되어 한쪽을 충돌로 차단한다", async () => {
  const storage = memoryStorage();
  const lockManager = memoryLockManager();
  const initial = createEmptyEmrState("2026-07-19T10:00:00.000Z");
  await saveEmrState(initial, storage);
  const firstTab = addPatient(initial, { id: "first", mrn: "FIRST", name: "첫 탭" }, "2026-07-19T10:01:00.000Z");
  const secondTab = addPatient(initial, { id: "second", mrn: "SECOND", name: "둘째 탭" }, "2026-07-19T10:02:00.000Z");

  const results = await Promise.allSettled([
    saveEmrState(firstTab, storage, initial.revision, { lockManager }),
    saveEmrState(secondTab, storage, initial.revision, { lockManager }),
  ]);

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = results.find(({ status }) => status === "rejected");
  assert.match(rejected.reason.message, /다른 탭.*변경/);
  const patientIds = loadEmrState(storage).patients.map(({ id }) => id);
  assert.equal(patientIds.length, 1);
  assert.ok(["first", "second"].includes(patientIds[0]));
});

test("FHIR 환자 식별자는 추가·수정·백업 복원 모든 경계에서 유일하다", () => {
  let state = addPatient(createEmptyEmrState(), { id: "p1", name: "첫 환자", fhirIdentity: "urn:uuid:same" });
  state = addPatient(state, { id: "p2", mrn: "FHIR-SECOND", name: "둘째 환자" });
  assert.throws(() => updatePatient(state, "p2", { fhirIdentity: "urn:uuid:same" }), /같은 FHIR 환자/);

  const backup = exportEmrBackup(createDemoEmrState("2026-07-19T10:00:00.000Z"));
  backup.data.patients[0].fhirIdentity = "urn:uuid:same";
  backup.data.patients[1].fhirIdentity = "urn:uuid:same";
  assert.throws(() => parseEmrBackup(backup), /중복 FHIR 환자/);
});

test("코파일럿 요청 지문은 키 순서와 무관하고 차트 변경을 구분한다", () => {
  const original = { asOf: "2026-07-19", patient: { events: [{ id: "e1", status: "active" }] } };
  const reordered = { patient: { events: [{ status: "active", id: "e1" }] }, asOf: "2026-07-19" };
  const changed = { asOf: "2026-07-19", patient: { events: [{ id: "e1", status: "resolved" }] } };

  assert.equal(clinicalContextFingerprint(original), clinicalContextFingerprint(reordered));
  assert.notEqual(clinicalContextFingerprint(original), clinicalContextFingerprint(changed));
});

test("코파일럿 직렬화는 코드 시스템·상태 안의 직접식별자도 제거하고 내부 ID는 별도 보존한다", () => {
  const patient = createPatient({
    id: "patient-secret",
    name: "김비타",
    mrn: "SECRET-MRN",
    phone: "010-1234-5678",
    events: [
      {
        id: "internal-event-id",
        type: "condition",
        system: "urn:김비타:SECRET-MRN:010-1234-5678",
        code: "I10",
        label: "고혈압",
        date: "2026-07-19",
        status: "active",
      },
      {
        id: "refuted-event-id",
        type: "condition",
        system: "urn:kcd:official",
        code: "E11",
        label: "반박된 당뇨",
        date: "2026-07-18",
        status: "active",
        verificationStatus: "refuted",
      },
      {
        id: "proposal-event-id",
        type: "medication",
        system: "urn:edi:official",
        code: "MED-1",
        label: "제안 약물",
        date: "2026-07-17",
        status: "active",
        intent: "proposal",
      },
    ],
  });
  const request = createCopilotRequest(patient, [], "2026-07-19");
  const serialized = JSON.stringify(request.payload);

  assert.doesNotMatch(serialized, /김비타|SECRET-MRN|010-1234-5678|internal-event-id|refuted-event-id|proposal-event-id/);
  assert.match(serialized, /\[식별정보 제거\]/);
  assert.equal(request.payload.patient.events.length, 1);
  assert.equal(request.payload.patient.events[0].id, "event-1");
  assert.equal(request.aliasToEventId.get("event-1"), "internal-event-id");
});

test("기관 급여 규칙은 서비스·적용 조건·근거 코드 시스템을 요구한다", () => {
  const base = createEmptyEmrState();
  const common = {
    id: "institution-rule",
    ruleSetId: "institution-rule",
    title: "기관 기준",
    serviceCode: "SVC-1",
    serviceSystem: "urn:edi:official",
    applicabilityCodes: ["I10"],
    applicabilitySystem: "urn:kcd:official",
    requiredEvidence: [{ code: "85354-9", system: "http://loinc.org", eventTypes: ["observation"] }],
    effectiveFrom: "2026-01-01",
    sourceLabel: "기관 검증 문서",
  };

  assert.doesNotThrow(() => addClaimRule(base, common));
  assert.throws(() => addClaimRule(base, { ...common, serviceSystem: "" }), /서비스 코드 시스템/);
  assert.throws(() => addClaimRule(base, { ...common, applicabilitySystem: "" }), /적용 조건 코드 시스템/);
  assert.throws(() => addClaimRule(base, { ...common, requiredEvidence: [{ code: "85354-9" }] }), /근거 코드 시스템/);
  assert.throws(() => addClaimRule(base, { ...common, effectiveTo: "2026-02-31" }), /종료일.*유효/);

  const withRule = addClaimRule(base, common);
  assert.throws(() => addClaimRule(withRule, common), /같은 급여 규칙 ID/);
  const backup = exportEmrBackup(withRule);
  const missingServiceSystem = structuredClone(backup);
  missingServiceSystem.data.rules.find(({ id }) => id === common.id).serviceSystem = "";
  assert.throws(() => parseEmrBackup(missingServiceSystem), /서비스 코드 시스템/);

  const missingApplicabilitySystem = structuredClone(backup);
  missingApplicabilitySystem.data.rules.find(({ id }) => id === common.id).applicabilitySystem = "";
  assert.throws(() => parseEmrBackup(missingApplicabilitySystem), /적용 조건 코드 시스템/);

  const missingEvidenceSystem = structuredClone(backup);
  missingEvidenceSystem.data.rules.find(({ id }) => id === common.id).requiredEvidence[0].system = "";
  assert.throws(() => parseEmrBackup(missingEvidenceSystem), /근거 코드 시스템/);

  const forgedSample = structuredClone(backup);
  const forgedRule = forgedSample.data.rules.find(({ id }) => id === common.id);
  forgedRule.sample = true;
  forgedRule.serviceSystem = "";
  assert.throws(() => parseEmrBackup(forgedSample), /서비스 코드 시스템/);

  const overlappingVersion = structuredClone(backup);
  overlappingVersion.data.rules.push({
    ...structuredClone(overlappingVersion.data.rules.find(({ id }) => id === common.id)),
    id: "institution-rule-v2",
    version: "2",
    effectiveFrom: "2026-06-01",
  });
  assert.throws(() => parseEmrBackup(overlappingVersion), /시행기간.*겹칩니다/);

  const loaded = loadEmrState({ getItem: () => JSON.stringify(missingServiceSystem.data) });
  assert.match(loaded.storageError, /서비스 코드 시스템/);
});

test("시행 중인 급여 규칙을 종료한 뒤 겹치지 않는 후속 버전을 추가한다", () => {
  const baseRule = {
    id: "versioned-v1",
    ruleSetId: "versioned",
    version: "1",
    title: "기관 기준 v1",
    serviceCode: "SVC",
    serviceSystem: "urn:institution:service",
    serviceEventType: "procedure",
    windowDays: 365,
    maxCount: 1,
    applicabilityCodes: [],
    requiredEvidence: [],
    effectiveFrom: "2026-01-01",
    sourceLabel: "기관 공식 기준",
  };
  const withOpenVersion = addClaimRule(createEmptyEmrState(), baseRule, "2026-01-01T00:00:00Z");
  assert.throws(() => retireClaimRule(withOpenVersion, baseRule.id, "2025-12-31"), /시행일보다 빠를/);

  const retired = retireClaimRule(withOpenVersion, baseRule.id, "2026-06-30", "2026-06-20T00:00:00Z");
  assert.equal(retired.rules.find(({ id }) => id === baseRule.id).effectiveTo, "2026-06-30");
  assert.equal(retired.audit.at(-1).action, "claim-rule.retired");
  assert.equal(retired.audit.at(-1).entityId, baseRule.id);
  assert.throws(() => addClaimRule(retired, {
    ...baseRule,
    id: "versioned-overlap",
    version: "2",
    effectiveFrom: "2026-06-30",
    effectiveTo: "",
  }), /시행기간.*겹칩니다/);
  const successor = addClaimRule(retired, {
    ...baseRule,
    id: "versioned-v2",
    version: "2",
    effectiveFrom: "2026-07-01",
    effectiveTo: "",
  });
  assert.equal(successor.rules.filter(({ ruleSetId }) => ruleSetId === "versioned").length, 2);
});

test("브라우저 저장소 접근 자체가 차단돼도 빈 복구 상태로 시작한다", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("storage blocked", "SecurityError");
    },
  });
  try {
    const loaded = loadEmrState();
    assert.deepEqual(loaded.patients, []);
    assert.match(loaded.storageError, /storage blocked/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("손상된 로컬 저장은 빈 상태로 덮지 않고 원문과 오류를 복구 대상으로 보존한다", () => {
  const raw = "{invalid-json";
  const storage = { getItem: () => raw };
  const loaded = loadEmrState(storage);

  assert.match(loaded.storageError, /JSON|Unexpected|position|property/i);
  assert.equal(loaded.recoveryRaw, raw);
  assert.deepEqual(loaded.patients, []);
});

test("손상 저장 복원은 원본 일치 토큰을 확인하고 새 리비전으로 ABA 덮어쓰기를 막는다", async () => {
  const storage = memoryStorage();
  const corruptRaw = "{invalid-json";
  storage.setItem(EMR_STORAGE_KEY, corruptRaw);
  const recoveryState = loadEmrState(storage);
  const replacement = createDemoEmrState("2026-07-19T10:00:00.000Z");

  const recovered = await recoverEmrState(
    replacement,
    recoveryState.recoveryRaw,
    storage,
    "2026-07-19T10:01:00.000Z",
  );
  assert.ok(recovered.revision >= new Date("2026-07-19T10:01:00.000Z").valueOf() * 1_000);
  assert.equal(loadEmrState(storage).patients[0].name, "김비타");

  storage.setItem(EMR_STORAGE_KEY, "{changed-in-another-tab");
  await assert.rejects(() => recoverEmrState(replacement, corruptRaw, storage), /다른 탭에서 변경/);
  assert.equal(storage.getItem(EMR_STORAGE_KEY), "{changed-in-another-tab");
});

test("저장소 쓰기 실패는 호출자에게 전파되고 기존 저장을 바꾸지 않는다", async () => {
  const original = "preserved";
  const storage = {
    getItem: () => original,
    setItem: () => { throw new Error("quota exceeded"); },
  };
  const state = createEmptyEmrState();

  await assert.rejects(() => saveEmrState(state, storage), /quota exceeded/);
  assert.equal(storage.getItem(), original);
});

test("백업 복원은 손실성 필드 변환과 중복 등록번호를 거부한다", () => {
  const backup = exportEmrBackup(createDemoEmrState("2026-07-19T10:00:00.000Z"));
  const invalidBirthDate = structuredClone(backup);
  invalidBirthDate.data.patients[0].birthDate = "2026-02-31";
  assert.throws(() => parseEmrBackup(invalidBirthDate), /생년월일|손상|유실/);

  const invalidSex = structuredClone(backup);
  invalidSex.data.patients[0].sex = "invalid";
  assert.throws(() => parseEmrBackup(invalidSex), /손상|유실|성별/);

  const duplicateMrn = structuredClone(backup);
  duplicateMrn.data.patients[1].mrn = duplicateMrn.data.patients[0].mrn;
  assert.throws(() => parseEmrBackup(duplicateMrn), /중복 등록번호/);

  const unsafeWindow = structuredClone(backup);
  unsafeWindow.data.rules[0].windowDays = 200_000_000;
  assert.throws(() => parseEmrBackup(unsafeWindow), /손상|유실/);

  const refutedCondition = structuredClone(backup);
  refutedCondition.data.patients[0].events.find(({ type }) => type === "condition").verificationStatus = "refuted";
  assert.throws(() => parseEmrBackup(refutedCondition), /상태·검증·의도/);

  const proposalMedication = structuredClone(backup);
  proposalMedication.data.patients[0].events.find(({ type }) => type === "medication").intent = "proposal";
  assert.throws(() => parseEmrBackup(proposalMedication), /상태·검증·의도/);
});
