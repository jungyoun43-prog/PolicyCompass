import assert from "node:assert/strict";
import test from "node:test";

import {
  CARE_BRIDGE_STORAGE_KEY,
  clinicalSnapshotFingerprint,
  createClinicalSnapshot,
  createPatientBrief,
  createPatientOwnedJson,
  parseCareBridge,
  publishClinicalSnapshot,
  publishPatientBrief,
  readCareBridge,
} from "../src/care-bridge.js";

const PREPARED_AT = "2026-07-26T09:00:00.000Z";

function patientFixture() {
  return {
    id: "patient-private-id",
    name: "홍길동",
    mrn: "VG-SECRET",
    events: [
      {
        id: "encounter-1",
        type: "encounter",
        status: "finished",
        recordStatus: "final",
        source: { kind: "encounter" },
        signature: {
          status: "signed",
          signer: "의사 이름",
          signedAt: "2026-07-25T09:30:00.000Z",
        },
      },
      {
        id: "condition-1",
        type: "condition",
        encounterId: "encounter-1",
        system: "urn:kr:kcd",
        code: "I10",
        label: "원본 진단명",
        date: "2026-07-25",
        status: "active",
        verificationStatus: "confirmed",
        recordStatus: "final",
        source: { kind: "encounter" },
        note: "내부 메모",
      },
      {
        id: "medication-1",
        type: "medication",
        encounterId: "encounter-1",
        system: "urn:kr:local-medication",
        code: "ACE-001",
        label: "에이스억제제",
        date: "2026-07-25",
        status: "active",
        recordStatus: "final",
        source: { kind: "encounter" },
        prescription: {
          dose: 1,
          doseUnit: "정",
          route: "경구",
          frequency: "1일 1회",
          durationDays: 30,
          quantity: 30,
          instructions: "내부 복약 메모",
        },
        note: "노출하면 안 되는 메모",
      },
    ],
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    value: (key) => values.get(key),
  };
}

test("clinical bridge publishes only signed, sanitized patient facts", () => {
  const snapshot = createClinicalSnapshot(patientFixture(), PREPARED_AT);
  assert.deepEqual(snapshot.summary, {
    includedConditions: 1,
    includedMeasurements: 0,
    includedMedications: 1,
  });
  assert.equal(snapshot.healthMap.conditions[0].id, "hypertension");
  assert.deepEqual(snapshot.medications[0], {
    system: "urn:kr:local-medication",
    code: "ACE-001",
    label: "에이스억제제",
    prescribedOn: "2026-07-25",
    dose: 1,
    doseUnit: "정",
    route: "경구",
    frequency: "1일 1회",
    durationDays: 30,
    quantity: 30,
    basis: "signed-prescription",
  });

  const serialized = JSON.stringify(snapshot);
  for (const privateValue of ["patient-private-id", "홍길동", "VG-SECRET", "의사 이름", "내부 메모", "노출하면 안 되는 메모"]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
});

test("care bridge carries a patient brief back without identifiers", () => {
  const storage = memoryStorage();
  const snapshot = createClinicalSnapshot(patientFixture(), PREPARED_AT);
  const clinical = publishClinicalSnapshot(snapshot, { storage, publishedAt: PREPARED_AT });
  assert.equal(parseCareBridge(JSON.parse(storage.value(CARE_BRIDGE_STORAGE_KEY))).channelId, clinical.channelId);

  const brief = createPatientBrief({
    source: "frontier-model",
    summary: "지난 2주 동안 야간 기침이 심했습니다.",
    signals: ["야간 기침 · 2주"],
    questions: [{
      question: "약을 시작한 뒤 기침이 생겼는지 확인할까요?",
      basis: "최근 처방과 환자 입력 시점 비교",
    }],
  }, "2026-07-26T09:05:00.000Z");
  publishPatientBrief(brief, { storage });

  const linked = readCareBridge(storage);
  assert.equal(linked.patient.brief.source, "frontier-model");
  assert.match(linked.patient.brief.summary, /야간 기침/);
  assert.equal(linked.patient.brief.questions.length, 1);
});

test("patient brief publish fails closed when the active clinical channel changes", () => {
  const storage = memoryStorage();
  const firstSnapshot = createClinicalSnapshot(patientFixture(), PREPARED_AT);
  const firstBridge = publishClinicalSnapshot(firstSnapshot, { storage, publishedAt: PREPARED_AT });
  const expectedFingerprint = clinicalSnapshotFingerprint(firstSnapshot);

  const nextPatient = patientFixture();
  nextPatient.events[1].code = "E11";
  nextPatient.events[1].date = "2026-07-26";
  publishClinicalSnapshot(
    createClinicalSnapshot(nextPatient, "2026-07-27T09:00:00.000Z"),
    { storage, rotateChannel: true, publishedAt: "2026-07-27T09:00:00.000Z" },
  );

  assert.throws(
    () => publishPatientBrief(createPatientBrief({
      summary: "이전 환자가 정리한 내용",
      questions: [{ question: "이전 질문인가요?", basis: "이전 기록" }],
    }), {
      storage,
      expectedChannelId: firstBridge.channelId,
      expectedClinicalFingerprint: expectedFingerprint,
    }),
    /환자 기록이 바뀌었습니다/,
  );
  assert.equal(readCareBridge(storage).patient, null);
});

test("patient-owned JSON contains the sanitized snapshot, not EMR identity", () => {
  const exported = createPatientOwnedJson(
    createClinicalSnapshot(patientFixture(), PREPARED_AT),
    "2026-07-26T10:00:00.000Z",
  );
  assert.equal(exported.schema, "vitagraph-patient-owned-record");
  assert.equal(exported.scope, "patient-controlled-copy");
  const serialized = JSON.stringify(exported);
  assert.equal(serialized.includes("홍길동"), false);
  assert.equal(serialized.includes("VG-SECRET"), false);
  assert.equal(serialized.includes("instructions"), false);
});

test("an empty finalized projection remains publishable so stale Personal facts can be cleared", () => {
  const storage = memoryStorage();
  const empty = createClinicalSnapshot({ events: [] }, PREPARED_AT);
  assert.deepEqual(empty.summary, {
    includedConditions: 0,
    includedMeasurements: 0,
    includedMedications: 0,
  });
  publishClinicalSnapshot(empty, { storage, publishedAt: PREPARED_AT });
  assert.deepEqual(readCareBridge(storage).clinical.snapshot.healthMap, {
    conditions: [],
    measurements: [],
  });
});

test("KST 진료일의 서명 처방은 UTC 날짜 경계 뒤에도 정제 스냅샷에 포함된다", () => {
  const patient = patientFixture();
  patient.events[2].date = "2026-07-27";
  const snapshot = createClinicalSnapshot(patient, "2026-07-26T16:00:00.000Z");
  assert.equal(snapshot.medications.length, 1);
  assert.equal(snapshot.medications[0].prescribedOn, "2026-07-27");
});

test("care bridge rejects malformed dates, null facts, and extra clinical fields", () => {
  const storage = memoryStorage();
  publishClinicalSnapshot(createClinicalSnapshot(patientFixture(), PREPARED_AT), {
    storage,
    publishedAt: PREPARED_AT,
  });
  const valid = JSON.parse(storage.value(CARE_BRIDGE_STORAGE_KEY));

  const withRawNote = structuredClone(valid);
  withRawNote.clinical.snapshot.rawClinicalNote = "환자 이름과 원문";
  assert.throws(() => parseCareBridge(withRawNote), /허용되지 않은 필드/);

  const withNullFact = structuredClone(valid);
  withNullFact.clinical.snapshot.healthMap.conditions = [null];
  withNullFact.clinical.snapshot.summary.includedConditions = 1;
  assert.throws(() => parseCareBridge(withNullFact), /정제 질환 구조/);

  const withBadDate = structuredClone(valid);
  withBadDate.clinical.snapshot.preparedAt = "not-a-date";
  assert.throws(() => parseCareBridge(withBadDate), /시각/);

  assert.throws(
    () => createPatientOwnedJson(withRawNote.clinical.snapshot, PREPARED_AT),
    /허용되지 않은 필드/,
  );
});
