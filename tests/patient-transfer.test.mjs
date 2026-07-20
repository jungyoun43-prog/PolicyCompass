import assert from "node:assert/strict";
import test from "node:test";

import {
  addEncounterDiagnosis,
  addEncounterOrder,
  addEncounterPrescription,
  checkInPatient,
  completeEncounter,
  saveEncounterDraft,
  signEncounter,
  startEncounter,
} from "../src/emr-encounter.js";
import {
  addPatient,
  createEmptyEmrState,
  normalizePatientEvent,
} from "../src/emr-model.js";
import {
  createPatientTransferPackage,
  parsePatientTransferPackage,
  patientTransferFilename,
} from "../src/patient-transfer.js";

const EXPORTED_AT = "2026-07-20T12:34:56.000Z";
const TRANSFER_CODE = "VG-01234-56789-ABCDE-FGHJK-MNPQRS";
const PATIENT_ID = "patient-id-must-not-leak";
const ENCOUNTER_ID = "encounter-id-must-not-leak";
const KCD_SYSTEM = "urn:kr:kcd";

const PRIVATE_VALUES = [
  PATIENT_ID,
  ENCOUNTER_ID,
  "MRN-MUST-NOT-LEAK",
  "환자이름-노출금지",
  "1984-03-12",
  "010-1111-2222",
  "주소-노출금지",
  "보험-노출금지",
  "비상연락처-노출금지",
  "환자메모-노출금지",
  "SOAP-S-노출금지",
  "SOAP-O-노출금지",
  "SOAP-A-노출금지",
  "SOAP-P-노출금지",
  "의료진-노출금지",
  "진료실-노출금지",
  "진단자유문구-노출금지",
  "측정자유문구-노출금지",
  "약물-노출금지",
  "오더-노출금지",
  "청구-노출금지",
  "감사-노출금지",
];

function normalizedEvent(input) {
  const event = normalizePatientEvent(input);
  assert.ok(event, `fixture event should normalize: ${input.id}`);
  return event;
}

function buildTransferPatient() {
  let state = addPatient(createEmptyEmrState("2026-07-20T08:00:00.000Z"), {
    id: PATIENT_ID,
    mrn: "MRN-MUST-NOT-LEAK",
    name: "환자이름-노출금지",
    birthDate: "1984-03-12",
    sex: "female",
    phone: "010-1111-2222",
    address: "주소-노출금지",
    insuranceType: "other",
    emergencyContact: {
      name: "비상연락처-노출금지",
      relation: "가족",
      phone: "010-9999-8888",
    },
    memo: "환자메모-노출금지 · 보험-노출금지",
  }, "2026-07-20T08:00:00.000Z");

  state = checkInPatient(state, PATIENT_ID, {
    id: ENCOUNTER_ID,
    date: "2026-07-20",
    department: "가정의학과",
    clinician: "의료진-노출금지",
    room: "진료실-노출금지",
    chiefComplaint: "주호소-노출금지",
  }, "2026-07-20T08:10:00.000Z");
  state = startEncounter(state, PATIENT_ID, ENCOUNTER_ID, "2026-07-20T08:15:00.000Z");
  state = saveEncounterDraft(state, PATIENT_ID, ENCOUNTER_ID, {
    soap: {
      subjective: "SOAP-S-노출금지",
      objective: "SOAP-O-노출금지",
      assessment: "SOAP-A-노출금지",
      plan: "SOAP-P-노출금지",
    },
  }, "2026-07-20T08:20:00.000Z");
  state = addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "diagnosis-id-must-not-leak",
    system: KCD_SYSTEM,
    code: "I10",
    label: "진단자유문구-노출금지",
    diagnosisRole: "primary",
    certainty: "confirmed",
  }, "2026-07-20T08:21:00.000Z");
  state = addEncounterDiagnosis(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "provisional-id-must-not-leak",
    system: KCD_SYSTEM,
    code: "E11",
    label: "의증 당뇨병",
    diagnosisRole: "secondary",
    certainty: "provisional",
  }, "2026-07-20T08:22:00.000Z");
  state = addEncounterPrescription(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "medication-id-must-not-leak",
    system: "urn:test:medication",
    code: "MED-PRIVATE",
    label: "약물-노출금지",
    dose: 1,
    doseUnit: "정",
    route: "경구",
    frequency: "1일 1회",
    durationDays: 30,
    quantity: 30,
    instructions: "복약메모-노출금지",
  }, "2026-07-20T08:23:00.000Z");
  state = addEncounterOrder(state, PATIENT_ID, ENCOUNTER_ID, {
    id: "order-id-must-not-leak",
    system: "urn:test:order",
    code: "ORDER-PRIVATE",
    label: "오더-노출금지",
    kind: "laboratory",
    priority: "routine",
    instructions: "오더메모-노출금지",
  }, "2026-07-20T08:24:00.000Z");
  state = completeEncounter(state, PATIENT_ID, ENCOUNTER_ID, {}, "2026-07-20T08:30:00.000Z");
  state = signEncounter(state, PATIENT_ID, ENCOUNTER_ID, "의료진-노출금지", "2026-07-20T08:31:00.000Z");

  const patient = state.patients[0];
  const extraEvents = [
    normalizedEvent({
      id: "signed-observation-id-must-not-leak",
      type: "observation",
      recordStatus: "final",
      encounterId: ENCOUNTER_ID,
      system: "http://loinc.org",
      code: "4548-4",
      label: "측정자유문구-노출금지",
      date: "2026-07-20",
      status: "final",
      value: 7.1,
      unit: "%",
      source: { kind: "encounter", label: "진료 입력", resourceId: ENCOUNTER_ID },
    }),
    normalizedEvent({
      id: "standalone-confirmed-condition",
      type: "condition",
      recordStatus: "final",
      system: KCD_SYSTEM,
      code: "E11",
      label: "당뇨병 원문",
      date: "2026-07-18",
      status: "active",
      clinicalStatus: "active",
      verificationStatus: "confirmed",
      certainty: "confirmed",
      source: { kind: "manual", label: "확정 과거자료" },
    }),
    normalizedEvent({
      id: "standalone-final-observation",
      type: "observation",
      recordStatus: "final",
      system: "http://loinc.org",
      code: "2089-1",
      label: "LDL 원문",
      date: "2026-07-19",
      status: "corrected",
      value: 156,
      unit: "mg/dL",
      source: { kind: "manual", label: "확정 과거자료" },
    }),
    normalizedEvent({
      id: "draft-observation",
      type: "observation",
      recordStatus: "draft",
      system: "http://loinc.org",
      code: "1558-6",
      label: "공복 혈당 초안",
      date: "2026-07-19",
      status: "final",
      value: 132,
      unit: "mg/dL",
    }),
    normalizedEvent({
      id: "unsupported-observation",
      type: "observation",
      recordStatus: "final",
      system: "http://loinc.org",
      code: "9999-9",
      label: "미지원 검사",
      date: "2026-07-19",
      status: "final",
      value: 1,
      unit: "unknown",
    }),
    normalizedEvent({
      id: "external-observation",
      type: "observation",
      recordStatus: "final",
      system: "http://loinc.org",
      code: "1558-6",
      label: "외부 미검증 검사",
      date: "2026-07-19",
      status: "final",
      value: 140,
      unit: "mg/dL",
      source: { kind: "fhir", label: "외부 FHIR", resourceId: "fhir-id-must-not-leak" },
    }),
  ];

  return {
    ...patient,
    events: [...patient.events, ...extraEvents],
    claimRules: [{ title: "청구-노출금지" }],
    audit: [{ detail: "감사-노출금지" }],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertRejected(payload) {
  assert.throws(
    () => parsePatientTransferPackage(payload),
    (error) => error instanceof TypeError || error instanceof RangeError,
  );
}

test("환자 안전 전송 파일은 확정 VitaGraph 정보만 내보내고 앱 입력으로 왕복한다", () => {
  const transfer = createPatientTransferPackage(buildTransferPatient(), EXPORTED_AT, TRANSFER_CODE);
  const parsed = parsePatientTransferPackage(clone(transfer));

  assert.equal(transfer.schema, "vitagraph-patient-transfer");
  assert.equal(transfer.version, 1);
  assert.equal(transfer.exportedAt, EXPORTED_AT);
  assert.equal(transfer.transferCode, TRANSFER_CODE);
  assert.equal(transfer.scope, "patient-vita-graph");
  assert.equal(transfer.trust, "unsigned-local-export");
  assert.deepEqual(transfer.healthMap.conditions.map(({ id }) => id).sort(), ["diabetes", "hypertension"]);
  assert.deepEqual(
    transfer.healthMap.measurements.map(({ key, code }) => [key, code]).sort(),
    [["hba1c", "4548-4"], ["ldl", "2089-1"]],
  );
  assert.equal(transfer.summary.includedConditions, 2);
  assert.equal(transfer.summary.includedMeasurements, 2);

  assert.deepEqual([...parsed.conditionIds].sort(), ["diabetes", "hypertension"]);
  assert.deepEqual(
    parsed.measurements.map(({ key, code, value, unit }) => [key, code, value, unit]).sort(),
    [["hba1c", "4548-4", 7.1, "%"], ["ldl", "2089-1", 156, "mg/dL"]],
  );
  assert.equal(parsed.observedAt, "2026-07-20");
  assert.equal(typeof parsed.provenance, "object");
  assert.equal(parsed.provenance.transferCode, TRANSFER_CODE);
});

test("전송 파일은 정확한 allowlist shape만 가지며 식별자와 임상 내부정보를 누출하지 않는다", () => {
  const transfer = createPatientTransferPackage(buildTransferPatient(), EXPORTED_AT, TRANSFER_CODE);

  assert.deepEqual(Object.keys(transfer).sort(), ["exportedAt", "healthMap", "schema", "scope", "summary", "transferCode", "trust", "version"]);
  assert.deepEqual(Object.keys(transfer.healthMap).sort(), ["conditions", "measurements"]);
  assert.deepEqual(Object.keys(transfer.summary).sort(), ["includedConditions", "includedMeasurements"]);
  for (const condition of transfer.healthMap.conditions) {
    assert.deepEqual(Object.keys(condition).sort(), ["basis", "id", "label", "recordedOn"]);
    assert.equal(condition.basis, "confirmed-condition");
  }
  for (const measurement of transfer.healthMap.measurements) {
    assert.deepEqual(Object.keys(measurement).sort(), ["basis", "code", "key", "label", "observedOn", "unit", "value"]);
    assert.equal(measurement.basis, "final-observation");
  }

  const serialized = JSON.stringify(transfer);
  for (const value of PRIVATE_VALUES) {
    assert.equal(serialized.includes(value), false, `patient transfer leaked: ${value}`);
  }
  for (const forbiddenKey of [
    "patientId", "encounterId", "eventId", "mrn", "birthDate", "sex", "phone", "address",
    "insuranceType", "emergencyContact", "memo", "soap", "clinician", "room", "signature",
    "medication", "prescription", "order", "allergy", "claim", "rule", "audit", "copilot", "resourceId",
  ]) {
    assert.equal(new RegExp(`"${forbiddenKey}"`, "i").test(serialized), false, `forbidden key leaked: ${forbiddenKey}`);
  }
});

test("서명되지 않았거나 의증·초안·외부 미검증인 기록은 전송 사실이 되지 않는다", () => {
  const transfer = createPatientTransferPackage(buildTransferPatient(), EXPORTED_AT, TRANSFER_CODE);
  const serialized = JSON.stringify(transfer);

  assert.doesNotMatch(serialized, /provisional|의증|draft-observation|외부 미검증|9999-9|140/);
  assert.match(serialized, /hypertension|diabetes|4548-4|2089-1/);
});

test("코드 시스템과 구조화 코드가 표시명보다 우선하며 임의 시스템·분리 혈압·데모·생성·고아 진료 기록을 제외한다", () => {
  const diabetesWithMisleadingLabel = normalizedEvent({
    id: "coded-diabetes",
    type: "condition",
    recordStatus: "final",
    system: KCD_SYSTEM,
    code: "E11",
    label: "hypertension",
    date: "2026-07-19",
    status: "active",
    verificationStatus: "confirmed",
    certainty: "confirmed",
    source: { kind: "manual", label: "의료진 확정" },
  });
  const validCondition = normalizedEvent({
    ...diabetesWithMisleadingLabel,
    id: "coded-hypertension",
    code: "I10",
    label: "고혈압",
  });
  const wrongSystemMeasurement = normalizedEvent({
    id: "wrong-system-ldl",
    type: "observation",
    recordStatus: "final",
    system: "urn:not-loinc",
    code: "2089-1",
    label: "LDL",
    date: "2026-07-19",
    status: "final",
    value: 155,
    unit: "mg/dL",
    source: { kind: "manual", label: "의료진 확정" },
  });
  const splitPressure = ["8480-6", "8462-4"].map((code, index) => normalizedEvent({
    id: `split-pressure-${index}`,
    type: "observation",
    recordStatus: "final",
    system: "http://loinc.org",
    code,
    label: code,
    date: "2026-07-19",
    status: "final",
    value: index === 0 ? 120 : 80,
    unit: "mmHg",
    source: { kind: "manual", label: "서로 다른 패널" },
  }));

  const transfer = createPatientTransferPackage({
    events: [diabetesWithMisleadingLabel, validCondition, wrongSystemMeasurement, ...splitPressure],
  }, EXPORTED_AT, TRANSFER_CODE);
  assert.deepEqual(transfer.healthMap.conditions.map(({ id }) => id).sort(), ["diabetes", "hypertension"]);
  assert.deepEqual(transfer.healthMap.measurements, []);

  const wrongConditionSystem = normalizedEvent({ ...validCondition, id: "wrong-kcd", system: "urn:not-kcd" });
  assert.throws(
    () => createPatientTransferPackage({ events: [wrongConditionSystem] }, EXPORTED_AT, TRANSFER_CODE),
    /내보낼 최종·확정 지원 기록/,
  );
  const demoCondition = normalizedEvent({ ...validCondition, id: "demo-condition", source: { kind: "demo", label: "예시" } });
  assert.throws(
    () => createPatientTransferPackage({ events: [demoCondition] }, EXPORTED_AT, TRANSFER_CODE),
    /내보낼 최종·확정 지원 기록/,
  );

  const generatedObservations = ["copilot", "import"].map((kind) => normalizedEvent({
    id: `${kind}-generated-observation`,
    type: "observation",
    recordStatus: "final",
    system: "http://loinc.org",
    code: "4548-4",
    label: "당화혈색소",
    date: "2026-07-19",
    status: "final",
    value: 7.1,
    unit: "%",
    source: { kind, label: `${kind} 생성값` },
  }));
  const orphanEncounterObservations = ["", "missing-encounter"].map((encounterId, index) => normalizedEvent({
    id: `orphan-encounter-observation-${index}`,
    type: "observation",
    recordStatus: "final",
    encounterId,
    system: "http://loinc.org",
    code: "4548-4",
    label: "당화혈색소",
    date: "2026-07-19",
    status: "final",
    value: 7.1,
    unit: "%",
    source: { kind: "encounter", label: "연결되지 않은 진료 입력" },
  }));
  const generatedTransfer = createPatientTransferPackage(
    { events: [validCondition, ...generatedObservations, ...orphanEncounterObservations] },
    EXPORTED_AT,
    TRANSFER_CODE,
  );
  assert.deepEqual(generatedTransfer.healthMap.measurements, []);
});

test("같은 날짜 측정은 corrected가 우선하고 단위·범위·미래 날짜를 fail-closed 처리한다", () => {
  const condition = normalizedEvent({
    id: "condition",
    type: "condition",
    recordStatus: "final",
    system: KCD_SYSTEM,
    code: "I10",
    label: "고혈압",
    date: "2026-07-18",
    status: "active",
    verificationStatus: "confirmed",
    certainty: "confirmed",
    source: { kind: "manual", label: "의료진 확정" },
  });
  const observation = (id, status, value, unit = "%", date = "2026-07-19") => normalizedEvent({
    id,
    type: "observation",
    recordStatus: "final",
    system: "http://loinc.org",
    code: "4548-4",
    label: "당화혈색소",
    date,
    status,
    value,
    unit,
    source: { kind: "manual", label: "의료진 확정" },
  });
  const transfer = createPatientTransferPackage({
    events: [observation("final", "final", 6.9), observation("corrected", "corrected", 7.2), condition],
  }, EXPORTED_AT, TRANSFER_CODE);
  assert.equal(transfer.healthMap.measurements[0].value, 7.2);

  const invalidUnit = createPatientTransferPackage({ events: [condition, observation("unit", "final", 7.1, "환자 메모")] }, EXPORTED_AT, TRANSFER_CODE);
  assert.deepEqual(invalidUnit.healthMap.measurements, []);
  const invalidRange = createPatientTransferPackage({ events: [condition, observation("range", "final", 99)] }, EXPORTED_AT, TRANSFER_CODE);
  assert.deepEqual(invalidRange.healthMap.measurements, []);
  assert.throws(
    () => createPatientTransferPackage({ events: [condition, observation("future", "final", 7.1, "%", "2026-07-21")] }, EXPORTED_AT, TRANSFER_CODE),
    /미래인 최종 측정/,
  );
  assert.throws(
    () => createPatientTransferPackage({ events: [{ ...condition, id: "future-condition", date: "2026-07-21" }] }, EXPORTED_AT, TRANSFER_CODE),
    /미래인 확정 진단/,
  );
});

test("전달 확인 코드는 환자 식별자에서 파생하지 않고 매 내보내기마다 Web Crypto로 새로 만든다", () => {
  const first = createPatientTransferPackage(buildTransferPatient(), EXPORTED_AT).transferCode;
  const second = createPatientTransferPackage(buildTransferPatient(), EXPORTED_AT).transferCode;
  assert.match(first, /^VG-[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}-[0-9A-HJKMNP-TV-Z]{6}$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(PATIENT_ID), false);
});

test("파일명은 환자 전달물임과 내보내기 날짜를 고정한다", () => {
  assert.equal(patientTransferFilename(EXPORTED_AT), "vitagraph-patient-transfer-2026-07-20.json");
  assert.equal(patientTransferFilename("2026-07-19T16:05:00.000Z"), "vitagraph-patient-transfer-2026-07-20.json");
});

test("한국 자정 직후 전달은 현지 진료일을 미래 기록으로 오인하지 않는다", () => {
  const localToday = normalizedEvent({
    id: "korea-midnight-condition",
    type: "condition",
    recordStatus: "final",
    system: KCD_SYSTEM,
    code: "I10",
    label: "고혈압",
    date: "2026-07-20",
    status: "active",
    verificationStatus: "confirmed",
    certainty: "confirmed",
    source: { kind: "manual", label: "의료진 확정" },
  });
  const transfer = createPatientTransferPackage(
    { events: [localToday] },
    "2026-07-19T16:05:00.000Z",
    TRANSFER_CODE,
  );

  assert.equal(transfer.healthMap.conditions[0].recordedOn, "2026-07-20");
  assert.deepEqual(parsePatientTransferPackage(clone(transfer)).conditionIds, ["hypertension"]);
});

test("파서는 schema·version·scope·trust와 모든 중첩 키를 exact-key로 검증한다", () => {
  const base = createPatientTransferPackage(buildTransferPatient(), EXPORTED_AT, TRANSFER_CODE);
  const variants = [
    { ...clone(base), unknown: true },
    { ...clone(base), schema: "vitagraph-emr-backup" },
    { ...clone(base), version: 2 },
    { ...clone(base), scope: "full-emr" },
    { ...clone(base), trust: "cryptographically-signed" },
    { ...clone(base), transferCode: "VG-PATIENT-ID" },
    { ...clone(base), healthMap: { ...clone(base.healthMap), patientName: "노출" } },
    { ...clone(base), healthMap: { ...clone(base.healthMap), conditions: [{ ...clone(base.healthMap.conditions[0]), extra: true }] } },
    { ...clone(base), healthMap: { ...clone(base.healthMap), measurements: [{ ...clone(base.healthMap.measurements[0]), extra: true }] } },
    { ...clone(base), summary: { ...clone(base.summary), extra: true } },
  ];

  for (const payload of variants) assertRejected(payload);
});

test("파서는 미지원 code/key, 잘못된 basis·날짜·값을 fail-closed 처리한다", () => {
  const base = createPatientTransferPackage(buildTransferPatient(), EXPORTED_AT, TRANSFER_CODE);
  const condition = clone(base.healthMap.conditions[0]);
  const measurement = clone(base.healthMap.measurements[0]);
  const withConditions = (conditions) => ({ ...clone(base), healthMap: { ...clone(base.healthMap), conditions } });
  const withMeasurements = (measurements) => ({ ...clone(base), healthMap: { ...clone(base.healthMap), measurements } });

  for (const payload of [
    withConditions([{ ...condition, id: "unknown-condition" }]),
    withConditions([{ ...condition, basis: "provisional-condition" }]),
    withConditions([{ ...condition, recordedOn: "2026-99-99" }]),
    withConditions([{ ...condition, recordedOn: "2026-07-21" }]),
    withMeasurements([{ ...measurement, code: "9999-9" }]),
    withMeasurements([{ ...measurement, key: measurement.key === "hba1c" ? "ldl" : "hba1c" }]),
    withMeasurements([{ ...measurement, basis: "draft-observation" }]),
    withMeasurements([{ ...measurement, observedOn: "not-a-date" }]),
    withMeasurements([{ ...measurement, observedOn: "2026-07-21" }]),
    withMeasurements([{ ...measurement, unit: "환자 자유문구" }]),
    withMeasurements([{ ...measurement, value: { nested: true } }]),
  ]) assertRejected(payload);
});

test("파서는 중복·과다 항목과 과대 payload를 원자적으로 거부한다", () => {
  const base = createPatientTransferPackage(buildTransferPatient(), EXPORTED_AT, TRANSFER_CODE);
  const condition = clone(base.healthMap.conditions[0]);
  const measurement = clone(base.healthMap.measurements[0]);

  assertRejected({
    ...clone(base),
    healthMap: { ...clone(base.healthMap), conditions: [condition, clone(condition)] },
  });
  assertRejected({
    ...clone(base),
    healthMap: { ...clone(base.healthMap), measurements: [measurement, clone(measurement)] },
  });
  assertRejected({
    ...clone(base),
    healthMap: { ...clone(base.healthMap), measurements: Array.from({ length: 1001 }, () => clone(measurement)) },
  });
  assertRejected({
    ...clone(base),
    healthMap: {
      ...clone(base.healthMap),
      measurements: [{ ...measurement, label: "x".repeat(2 * 1024 * 1024 + 1) }],
    },
  });
});
