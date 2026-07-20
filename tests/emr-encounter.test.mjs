import assert from "node:assert/strict";
import test from "node:test";

import { evaluateClaimRule } from "../src/claim-rules.js";
import {
  addEncounterDiagnosis,
  addEncounterOrder,
  addEncounterPrescription,
  cancelEncounter,
  checkInPatient,
  completeEncounter,
  getEncounter,
  getEncounterRecords,
  reopenEncounter,
  removeEncounterItem,
  saveEncounterDraft,
  selectTodayQueue,
  signEncounter,
  startEncounter,
  updateEncounterItem,
  validateEncounterForCompletion,
} from "../src/emr-encounter.js";
import {
  addPatient,
  appendPatientEvent,
  createEmptyEmrState,
  exportEmrBackup,
  loadEmrState,
  parseEmrBackup,
  removePatientEvent,
  saveEmrState,
  selectEncounter,
  selectFinalPatientEvents,
} from "../src/emr-model.js";

const PATIENT_ID = "patient-kim";
const ENCOUNTER_ID = "encounter-20260719-kim";
const VISIT_DATE = "2026-07-19";
const KCD_SYSTEM = "urn:kcd:official";

const TIMES = {
  registered: "2026-07-19T08:50:00.000Z",
  arrived: "2026-07-19T09:00:00.000Z",
  started: "2026-07-19T09:05:00.000Z",
  soapSaved: "2026-07-19T09:12:00.000Z",
  diagnosisAdded: "2026-07-19T09:14:00.000Z",
  prescriptionAdded: "2026-07-19T09:16:00.000Z",
  orderAdded: "2026-07-19T09:18:00.000Z",
  completed: "2026-07-19T09:25:00.000Z",
  signed: "2026-07-19T09:27:00.000Z",
};

const SOAP = {
  subjective: "3일 전부터 두통이 있으며 복약은 규칙적으로 했다고 말함.",
  objective: "혈압 148/94 mmHg, 의식 명료.",
  assessment: "본태성 고혈압 추적 평가.",
  plan: "복약 유지, 혈액검사 후 외래 추적.",
};

const CLAIM_RULE = {
  id: "kcd-i10-follow-up",
  ruleSetId: "kcd-i10-follow-up",
  version: "1",
  title: "고혈압 추적 처치",
  serviceCode: "FOLLOW-UP",
  serviceSystem: "urn:institution:service",
  serviceEventType: "procedure",
  windowDays: 90,
  maxCount: 1,
  dueSoonDays: 14,
  applicabilityCodes: ["I10"],
  applicabilitySystem: KCD_SYSTEM,
  requiredEvidence: [],
  effectiveFrom: "2026-01-01",
  sourceLabel: "기관 검증 기준",
};

function createRegisteredState() {
  return addPatient(createEmptyEmrState(TIMES.registered), {
    id: PATIENT_ID,
    mrn: "VG-260719-001",
    name: "김환자",
    birthDate: "1984-03-12",
    sex: "female",
    phone: "010-1234-5678",
    address: "서울특별시 중구",
    bloodType: "A+",
    insuranceType: "national-health",
    emergencyContact: {
      name: "김보호",
      relation: "배우자",
      phone: "010-9876-5432",
    },
    memo: "고혈압 추적 환자",
  }, TIMES.registered);
}

function checkInAndStart() {
  let state = createRegisteredState();
  state = checkInPatient(state, PATIENT_ID, {
    id: ENCOUNTER_ID,
    date: VISIT_DATE,
    department: "가정의학과",
    clinician: "이선우",
    room: "3진료실",
    chiefComplaint: "두통과 혈압 추적",
  }, TIMES.arrived);
  return startEncounter(state, PATIENT_ID, ENCOUNTER_ID, TIMES.started);
}

function buildSignedEncounter() {
  let state = checkInAndStart();
  state = saveEncounterDraft(state, PATIENT_ID, ENCOUNTER_ID, { soap: SOAP }, TIMES.soapSaved);
  state = addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "diagnosis-i10",
    system: KCD_SYSTEM,
    code: "I10",
    label: "본태성 고혈압",
    diagnosisRole: "primary",
    certainty: "confirmed",
  }, TIMES.diagnosisAdded);
  state = addEncounterPrescription(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "prescription-amlodipine",
    system: "urn:institution:drug",
    code: "AML-5",
    label: "암로디핀 5mg",
    dose: 1,
    doseUnit: "정",
    route: "경구",
    frequency: "1일 1회",
    durationDays: 14,
    quantity: 14,
    instructions: "아침 식후 복용",
  }, TIMES.prescriptionAdded);
  state = addEncounterOrder(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "order-cbc",
    system: "http://loinc.org",
    code: "57021-8",
    label: "전혈구검사",
    kind: "laboratory",
    priority: "routine",
    instructions: "금식 불필요",
  }, TIMES.orderAdded);
  state = completeEncounter(state, PATIENT_ID, ENCOUNTER_ID, {}, TIMES.completed);
  return signEncounter(state, PATIENT_ID, ENCOUNTER_ID, "이선우", TIMES.signed);
}

test("환자 등록부터 Encounter 서명까지 한 진료 흐름을 구조화 기록하고 감사한다", () => {
  let state = createRegisteredState();
  const registered = state.patients[0];
  assert.deepEqual({
    mrn: registered.mrn,
    name: registered.name,
    birthDate: registered.birthDate,
    ageYears: registered.ageYears,
    sex: registered.sex,
    phone: registered.phone,
    address: registered.address,
    bloodType: registered.bloodType,
    insuranceType: registered.insuranceType,
    emergencyContact: registered.emergencyContact,
  }, {
    mrn: "VG-260719-001",
    name: "김환자",
    birthDate: "1984-03-12",
    ageYears: null,
    sex: "female",
    phone: "010-1234-5678",
    address: "서울특별시 중구",
    bloodType: "A+",
    insuranceType: "national-health",
    emergencyContact: { name: "김보호", relation: "배우자", phone: "010-9876-5432" },
  });

  state = checkInPatient(state, PATIENT_ID, {
    id: ENCOUNTER_ID,
    date: VISIT_DATE,
    department: "가정의학과",
    clinician: "이선우",
    room: "3진료실",
    chiefComplaint: "두통과 혈압 추적",
  }, TIMES.arrived);
  assert.equal(getEncounter(state.patients[0], ENCOUNTER_ID).status, "arrived");
  assert.equal(getEncounter(state.patients[0], ENCOUNTER_ID).recordStatus, "draft");
  assert.equal(state.selectedPatientId, PATIENT_ID);
  assert.equal(state.selectedEncounterId, ENCOUNTER_ID);
  assert.deepEqual(selectTodayQueue(state, VISIT_DATE).map(({ patient, encounter }) => [patient.id, encounter.id]), [[PATIENT_ID, ENCOUNTER_ID]]);

  state = startEncounter(state, PATIENT_ID, ENCOUNTER_ID, TIMES.started);
  state = saveEncounterDraft(state, PATIENT_ID, ENCOUNTER_ID, { soap: SOAP }, TIMES.soapSaved);
  state = addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "diagnosis-i10",
    system: KCD_SYSTEM,
    code: "I10",
    label: "본태성 고혈압",
    diagnosisRole: "primary",
    certainty: "confirmed",
  }, TIMES.diagnosisAdded);
  state = addEncounterPrescription(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "prescription-amlodipine",
    system: "urn:institution:drug",
    code: "AML-5",
    label: "암로디핀 5mg",
    dose: "1",
    doseUnit: "정",
    route: "경구",
    frequency: "1일 1회",
    durationDays: "14",
    quantity: "14",
    instructions: "아침 식후 복용",
  }, TIMES.prescriptionAdded);
  state = addEncounterOrder(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "order-cbc",
    system: "http://loinc.org",
    code: "57021-8",
    label: "전혈구검사",
    kind: "laboratory",
    priority: "routine",
    instructions: "금식 불필요",
  }, TIMES.orderAdded);

  let patient = state.patients[0];
  let encounter = getEncounter(patient, ENCOUNTER_ID);
  const diagnosis = patient.events.find(({ id }) => id === "diagnosis-i10");
  const prescription = patient.events.find(({ id }) => id === "prescription-amlodipine");
  const order = patient.events.find(({ id }) => id === "order-cbc");
  assert.deepEqual(encounter.soap, SOAP);
  assert.deepEqual({ system: diagnosis.system, code: diagnosis.code, role: diagnosis.diagnosisRole }, {
    system: KCD_SYSTEM,
    code: "I10",
    role: "primary",
  });
  assert.deepEqual(prescription.prescription, {
    dose: 1,
    doseUnit: "정",
    route: "경구",
    frequency: "1일 1회",
    durationDays: 14,
    quantity: 14,
    instructions: "아침 식후 복용",
  });
  assert.deepEqual(order.order, { kind: "laboratory", priority: "routine", instructions: "금식 불필요" });
  assert.deepEqual(validateEncounterForCompletion(patient, ENCOUNTER_ID), []);

  assert.deepEqual(selectFinalPatientEvents(patient), []);
  assert.equal(evaluateClaimRule(patient, CLAIM_RULE, VISIT_DATE).status, "not-applicable");

  state = completeEncounter(state, PATIENT_ID, ENCOUNTER_ID, {}, TIMES.completed);
  encounter = getEncounter(state.patients[0], ENCOUNTER_ID);
  assert.equal(encounter.status, "finished");
  assert.equal(encounter.recordStatus, "draft");
  assert.equal(encounter.signature.status, "unsigned");
  assert.deepEqual(selectFinalPatientEvents(state.patients[0]), []);

  state = signEncounter(state, PATIENT_ID, ENCOUNTER_ID, "이선우", TIMES.signed);
  patient = state.patients[0];
  encounter = getEncounter(patient, ENCOUNTER_ID);
  const records = getEncounterRecords(patient, ENCOUNTER_ID);
  assert.equal(encounter.status, "finished");
  assert.equal(encounter.recordStatus, "final");
  assert.deepEqual(encounter.signature, { status: "signed", signer: "이선우", signedAt: TIMES.signed });
  assert.equal(records.length, 4);
  assert.ok(records.every(({ recordStatus }) => recordStatus === "final"));
  assert.ok(records.slice(1).every(({ encounterId, source }) => encounterId === ENCOUNTER_ID
    && source.kind === "encounter"
    && source.resourceId === ENCOUNTER_ID));
  assert.deepEqual(new Set(selectFinalPatientEvents(patient).map(({ id }) => id)), new Set([
    ENCOUNTER_ID,
    "diagnosis-i10",
    "prescription-amlodipine",
    "order-cbc",
  ]));
  assert.equal(evaluateClaimRule(patient, CLAIM_RULE, VISIT_DATE).status, "ready");

  assert.deepEqual(state.audit.map(({ action }) => action), [
    "patient.created",
    "encounter.checked-in",
    "encounter.started",
    "encounter.draft.saved",
    "diagnosis.added",
    "prescription.added",
    "order.added",
    "encounter.draft.saved",
    "encounter.completed",
    "encounter.signed",
  ]);
  assert.ok(state.audit.slice(1).every(({ patientId, encounterId }) => patientId === PATIENT_ID && encounterId === ENCOUNTER_ID));
});

test("Encounter 상태 전이는 순서를 건너뛰거나 반복할 수 없다", () => {
  let arrived = checkInPatient(createRegisteredState(), PATIENT_ID, {
    id: ENCOUNTER_ID,
    date: VISIT_DATE,
    clinician: "이선우",
    chiefComplaint: "두통",
  }, TIMES.arrived);

  assert.throws(() => saveEncounterDraft(arrived, PATIENT_ID, ENCOUNTER_ID, { soap: SOAP }), /진료 중 상태/);
  assert.throws(() => completeEncounter(arrived, PATIENT_ID, ENCOUNTER_ID, { soap: SOAP }), /진료 중 상태/);
  assert.throws(() => signEncounter(arrived, PATIENT_ID, ENCOUNTER_ID, "이선우"), /서명 대기/);
  assert.throws(() => reopenEncounter(arrived, PATIENT_ID, ENCOUNTER_ID), /서명 전 완료/);

  const started = startEncounter(arrived, PATIENT_ID, ENCOUNTER_ID, TIMES.started);
  assert.throws(() => startEncounter(started, PATIENT_ID, ENCOUNTER_ID), /대기 상태/);
  assert.throws(() => signEncounter(started, PATIENT_ID, ENCOUNTER_ID, "이선우"), /서명 대기/);
  assert.equal(getEncounter(arrived.patients[0], ENCOUNTER_ID).status, "arrived");
});

test("환자별 활성 Encounter는 하나뿐이며 교차 환자 ID 접근을 거부한다", () => {
  let state = createRegisteredState();
  state = addPatient(state, { id: "patient-park", mrn: "VG-260719-002", name: "박환자" }, TIMES.registered);
  state = checkInPatient(state, PATIENT_ID, { id: ENCOUNTER_ID, date: VISIT_DATE }, TIMES.arrived);
  state = selectEncounter(state, PATIENT_ID, ENCOUNTER_ID);

  assert.throws(() => checkInPatient(state, PATIENT_ID, { id: "second-active", date: VISIT_DATE }), /이미 대기 또는 진료 중/);
  assert.throws(() => startEncounter(state, "patient-park", ENCOUNTER_ID), /진료 회차를 찾을 수 없습니다/);
  assert.throws(() => addEncounterDiagnosis(state, "patient-park", ENCOUNTER_ID, {
    label: "교차 환자 입력",
  }), /진료 회차를 찾을 수 없습니다/);

  const rejectedSelection = selectEncounter(state, "patient-park", ENCOUNTER_ID);
  assert.equal(rejectedSelection.selectedPatientId, PATIENT_ID);
  assert.equal(rejectedSelection.selectedEncounterId, ENCOUNTER_ID);
  assert.equal(state.patients.find(({ id }) => id === "patient-park").events.length, 0);
});

test("일반 차트 API로 Encounter 생성·삭제·하위 기록 삭제를 우회할 수 없다", () => {
  let state = checkInAndStart();
  state = addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "diagnosis-protected",
    system: KCD_SYSTEM,
    code: "I10",
    label: "본태성 고혈압",
  }, TIMES.diagnosisAdded);

  assert.throws(() => appendPatientEvent(state, PATIENT_ID, {
    id: "forged-encounter",
    type: "encounter",
    label: "우회 내원",
    date: VISIT_DATE,
  }), /접수·진료 시작 흐름/);
  assert.throws(() => removePatientEvent(state, PATIENT_ID, ENCOUNTER_ID, "우회 삭제"), /진료 회차는 삭제할 수 없습니다/);
  assert.throws(() => removePatientEvent(state, PATIENT_ID, "diagnosis-protected", "우회 삭제"), /해당 진료 화면에서만 관리/);
  assert.equal(getEncounterRecords(state.patients[0], ENCOUNTER_ID).length, 2);
});

test("서명된 Encounter와 그 진료 항목은 직접 수정·삭제·재개·취소할 수 없다", async () => {
  const signed = buildSignedEncounter();

  assert.throws(() => saveEncounterDraft(signed, PATIENT_ID, ENCOUNTER_ID, { soap: { ...SOAP, plan: "변조" } }), /서명된 진료/);
  assert.throws(() => addEncounterDiagnosis(signed, PATIENT_ID, ENCOUNTER_ID, { label: "추가 진단" }), /서명된 진료/);
  assert.throws(() => updateEncounterItem(signed, PATIENT_ID, ENCOUNTER_ID, "diagnosis-i10", { label: "변조 진단" }), /서명된 진료/);
  assert.throws(() => removeEncounterItem(signed, PATIENT_ID, ENCOUNTER_ID, "prescription-amlodipine"), /서명된 진료/);
  assert.throws(() => reopenEncounter(signed, PATIENT_ID, ENCOUNTER_ID), /서명 전 완료/);
  assert.throws(() => cancelEncounter(signed, PATIENT_ID, ENCOUNTER_ID, "잘못된 취소"), /대기 또는 진료 중/);
  const forgedEmptySoap = structuredClone(signed);
  forgedEmptySoap.patients[0].events.find(({ id }) => id === ENCOUNTER_ID).soap.plan = "";
  await assert.rejects(() => saveEmrState(forgedEmptySoap, { setItem() {} }), /로컬 서명 진료.*SOAP/);
  assert.throws(() => signEncounter(signed, PATIENT_ID, ENCOUNTER_ID, "이선우"), /서명 대기/);
  assert.equal(getEncounter(signed.patients[0], ENCOUNTER_ID).soap.plan, SOAP.plan);
});

test("저장된 로컬 서명본은 같은 리비전과 감사 이력을 복제해도 직접 덮어쓸 수 없다", async () => {
  const signed = buildSignedEncounter();
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  };
  await saveEmrState(signed, storage);
  const forged = structuredClone(signed);
  getEncounter(forged.patients[0], ENCOUNTER_ID).soap.plan = "감사 없는 변조 계획";

  await assert.rejects(() => saveEmrState(forged, storage, signed.revision), /서명된 진료기록/);
  assert.equal(getEncounter(loadEmrState(storage).patients[0], ENCOUNTER_ID).soap.plan, SOAP.plan);
});

test("진료 항목 수정은 출처·소유권·lifecycle 보호 필드를 바꿀 수 없다", () => {
  let state = checkInAndStart();
  state = addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "protected-diagnosis",
    system: KCD_SYSTEM,
    code: "I10",
    label: "본태성 고혈압",
    diagnosisRole: "primary",
  }, TIMES.diagnosisAdded);

  for (const patch of [
    { source: { kind: "fhir", resourceId: "Condition/fake" } },
    { encounterId: "other" },
    { recordStatus: "final" },
    { verificationStatus: "refuted" },
    { status: "resolved" },
    { date: "2020-01-01" },
  ]) {
    assert.throws(() => updateEncounterItem(
      state,
      PATIENT_ID,
      ENCOUNTER_ID,
      "protected-diagnosis",
      patch,
      "2026-07-19T09:15:00.000Z",
    ), /보호 필드/);
  }

  const updated = updateEncounterItem(
    state,
    PATIENT_ID,
    ENCOUNTER_ID,
    "protected-diagnosis",
    { label: "고혈압" },
    "2026-07-19T09:15:00.000Z",
  );
  const diagnosis = updated.patients[0].events.find(({ id }) => id === "protected-diagnosis");
  assert.equal(diagnosis.label, "고혈압");
  assert.deepEqual(diagnosis.source, { kind: "encounter", label: "진료 입력", resourceId: ENCOUNTER_ID });
});

test("모든 진료 mutation은 해당 Encounter의 마지막 임상 감사 시각보다 앞설 수 없다", () => {
  let state = checkInAndStart();
  state = saveEncounterDraft(state, PATIENT_ID, ENCOUNTER_ID, { soap: SOAP }, TIMES.soapSaved);
  assert.throws(() => addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "time-reversed-diagnosis",
    system: KCD_SYSTEM,
    code: "I10",
    label: "본태성 고혈압",
    diagnosisRole: "primary",
  }, "2026-07-19T09:11:00.000Z"), /앞선 진료 시각/);

  state = addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "chronological-diagnosis",
    system: KCD_SYSTEM,
    code: "I10",
    label: "본태성 고혈압",
    diagnosisRole: "primary",
  }, TIMES.diagnosisAdded);
  state = completeEncounter(state, PATIENT_ID, ENCOUNTER_ID, {}, TIMES.completed);
  assert.throws(() => reopenEncounter(
    state,
    PATIENT_ID,
    ENCOUNTER_ID,
    "2026-07-19T09:24:00.000Z",
  ), /앞선 진료 시각/);
});

test("처방 수치와 필수 용법은 모델 경계에서 검증한다", () => {
  const state = checkInAndStart();
  const valid = {
    label: "암로디핀 5mg",
    dose: 1,
    doseUnit: "정",
    route: "경구",
    frequency: "1일 1회",
    durationDays: 14,
    quantity: 14,
  };
  const invalidCases = [
    [{ dose: 0 }, /1회량.*0보다 큰 숫자/],
    [{ dose: "not-a-number" }, /1회량.*0보다 큰 숫자/],
    [{ dose: Number.POSITIVE_INFINITY }, /1회량.*0보다 큰 숫자/],
    [{ durationDays: 1.5 }, /투여 일수.*정수/],
    [{ durationDays: 0 }, /투여 일수.*1 이상의 정수/],
    [{ quantity: -1 }, /총량.*0보다 큰 숫자/],
    [{ doseUnit: "" }, /단위, 투여 경로, 투여 횟수/],
    [{ route: "" }, /단위, 투여 경로, 투여 횟수/],
    [{ frequency: "" }, /단위, 투여 경로, 투여 횟수/],
    [{ durationDays: 366 }, /투여 일수.*정수/],
  ];

  for (const [patch, expected] of invalidCases) {
    assert.throws(() => addEncounterPrescription(state, PATIENT_ID, ENCOUNTER_ID, { ...valid, ...patch }), expected);
  }
  assert.equal(getEncounterRecords(state.patients[0], ENCOUNTER_ID).length, 1);
});

test("접수 ID·한국 날짜·진료 시각·SOAP 길이를 경계에서 검증한다", async () => {
  let withNote = appendPatientEvent(createRegisteredState(), PATIENT_ID, {
    id: "collision",
    type: "note",
    label: "기존 메모",
    date: VISIT_DATE,
  }, TIMES.arrived);
  assert.throws(() => checkInPatient(withNote, PATIENT_ID, { id: "collision" }, TIMES.started), /이미 존재/);

  let state = checkInPatient(createRegisteredState(), PATIENT_ID, { id: ENCOUNTER_ID }, "2026-07-18T16:00:00.000Z");
  const arrived = getEncounter(state.patients[0], ENCOUNTER_ID);
  assert.equal(arrived.date, "2026-07-19");
  assert.throws(() => startEncounter(state, PATIENT_ID, ENCOUNTER_ID, "2026-07-18T15:59:59.000Z"), /앞선 진료 시각/);

  state = startEncounter(state, PATIENT_ID, ENCOUNTER_ID, "2026-07-18T16:05:00.000Z");
  assert.throws(() => saveEncounterDraft(state, PATIENT_ID, ENCOUNTER_ID, {
    soap: { ...SOAP, subjective: "x".repeat(8_001) },
  }, "2026-07-18T16:06:00.000Z"), /8,000자/);

  state = addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "date-linked-diagnosis",
    system: KCD_SYSTEM,
    code: "I10",
    label: "본태성 고혈압",
    diagnosisRole: "primary",
  }, "2026-07-18T16:07:00.000Z");
  state = saveEncounterDraft(state, PATIENT_ID, ENCOUNTER_ID, { date: "2026-07-20", soap: SOAP }, "2026-07-18T16:08:00.000Z");
  assert.equal(state.patients[0].events.find(({ id }) => id === "date-linked-diagnosis").date, "2026-07-20");

  const reversed = structuredClone(state);
  getEncounter(reversed.patients[0], ENCOUNTER_ID).startedAt = "2026-07-18T15:00:00.000Z";
  await assert.rejects(() => saveEmrState(reversed, {
    getItem: () => null,
    setItem: () => {},
  }), /시각 순서/);
});

test("완료 전 진단 코드와 정확히 한 건의 주상병을 요구한다", () => {
  let state = checkInAndStart();
  assert.throws(() => addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, { label: "코드 없음" }), /진단 코드/);
  state = addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "primary",
    system: KCD_SYSTEM,
    code: "I10",
    label: "본태성 고혈압",
    diagnosisRole: "primary",
  }, TIMES.diagnosisAdded);
  assert.throws(() => addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "second-primary",
    system: KCD_SYSTEM,
    code: "R51",
    label: "두통",
    diagnosisRole: "primary",
  }), /주상병.*한 건/);

  const noPrimaryState = addEncounterDiagnosis(checkInAndStart(), PATIENT_ID, ENCOUNTER_ID, {
    id: "secondary-only",
    system: KCD_SYSTEM,
    code: "R51",
    label: "두통",
    diagnosisRole: "secondary",
  }, TIMES.diagnosisAdded);
  assert.throws(() => completeEncounter(noPrimaryState, PATIENT_ID, ENCOUNTER_ID, { soap: SOAP }, TIMES.completed), /주상병을 정확히 한 건/);
});

test("서명된 후에도 같은 날 새 재내원을 별도 Encounter로 접수할 수 있다", () => {
  const signed = buildSignedEncounter();
  const next = checkInPatient(signed, PATIENT_ID, { id: "encounter-second-visit", date: VISIT_DATE }, "2026-07-19T11:00:00.000Z");
  assert.equal(getEncounter(next.patients[0], ENCOUNTER_ID).recordStatus, "final");
  assert.equal(getEncounter(next.patients[0], "encounter-second-visit").status, "arrived");
  assert.equal(next.selectedEncounterId, "encounter-second-visit");
});

test("Encounter 취소는 사유가 필수이고 연결 기록과 대기열을 함께 무효화한다", () => {
  let state = checkInAndStart();
  state = addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "diagnosis-before-cancel",
    system: KCD_SYSTEM,
    code: "I10",
    label: "본태성 고혈압",
  }, TIMES.diagnosisAdded);

  assert.throws(() => cancelEncounter(state, PATIENT_ID, ENCOUNTER_ID, "  "), /취소 사유/);
  assert.equal(getEncounter(state.patients[0], ENCOUNTER_ID).status, "in-progress");

  const cancelled = cancelEncounter(state, PATIENT_ID, ENCOUNTER_ID, "환자 귀가 요청", TIMES.completed);
  const records = getEncounterRecords(cancelled.patients[0], ENCOUNTER_ID);
  assert.equal(records[0].status, "cancelled");
  assert.equal(records[0].note, "환자 귀가 요청");
  assert.ok(records.every(({ recordStatus }) => recordStatus === "entered-in-error"));
  assert.match(records[1].note, /진료 취소: 환자 귀가 요청/);
  assert.deepEqual(selectTodayQueue(cancelled, VISIT_DATE), []);
  assert.deepEqual(selectFinalPatientEvents(cancelled.patients[0]), []);
  assert.deepEqual(cancelled.audit.at(-1), {
    ...cancelled.audit.at(-1),
    action: "encounter.cancelled",
    patientId: PATIENT_ID,
    encounterId: ENCOUNTER_ID,
    entityId: ENCOUNTER_ID,
    detail: "환자 귀가 요청",
  });
  assert.throws(() => cancelEncounter(cancelled, PATIENT_ID, ENCOUNTER_ID, "재취소"), /대기 또는 진료 중/);

  const checkedInAgain = checkInPatient(cancelled, PATIENT_ID, { id: "replacement-encounter", date: VISIT_DATE }, TIMES.signed);
  assert.equal(getEncounter(checkedInAgain.patients[0], "replacement-encounter").status, "arrived");
});

test("서명 기록과 환자 인구정보는 로컬 저장·JSON 백업에서 손실 없이 왕복한다", async () => {
  const signed = buildSignedEncounter();
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  };

  const saved = await saveEmrState(signed, storage);
  const loaded = loadEmrState(storage);
  const backup = exportEmrBackup(loaded, "2026-07-19T10:00:00.000Z");
  const restored = parseEmrBackup(JSON.parse(JSON.stringify(backup)));

  assert.deepEqual(loaded, saved);
  assert.deepEqual(restored, saved);
  assert.deepEqual(restored.patients[0].emergencyContact, {
    name: "김보호",
    relation: "배우자",
    phone: "010-9876-5432",
  });
  assert.equal(restored.patients[0].ageYears, null);
  assert.equal(getEncounter(restored.patients[0], ENCOUNTER_ID).signature.status, "signed");
  assert.equal(restored.audit.at(-1).action, "encounter.signed");
  assert.equal(restored.selectedPatientId, PATIENT_ID);
  assert.equal(restored.selectedEncounterId, ENCOUNTER_ID);
});
