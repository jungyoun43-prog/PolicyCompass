import assert from "node:assert/strict";
import test from "node:test";

import {
  EMR_BACKUP_SCHEMA,
  EMR_SCHEMA,
  EMR_STORAGE_KEY,
  EMR_VERSION,
  LEGACY_EMR_STORAGE_KEY,
  clearEmrState,
  createEmptyEmrState,
  initializeEmrState,
  migrateV1ToV2,
  parseEmrBackup,
  saveEmrState,
} from "../src/emr-model.js";

const CREATED_AT = "2026-06-01T00:00:00.000Z";
const UPDATED_AT = "2026-07-18T09:30:00.000Z";

function createLegacyV1State(overrides = {}) {
  return {
    schema: EMR_SCHEMA,
    version: 1,
    demo: false,
    selectedPatientId: "legacy-patient",
    patients: [
      {
        id: "legacy-patient",
        mrn: "V1-1001",
        name: "기존환자",
        birthDate: "1974-04-12",
        sex: "female",
        phone: "010-1111-2222",
        memo: "v1에서 작성한 메모",
        events: [
          {
            id: "legacy-active-encounter",
            type: "encounter",
            system: "",
            code: "AMB",
            label: "진료 중 외래",
            date: "2026-07-18",
            status: "in-progress",
            value: "",
            unit: "",
            note: "진료 중 기록",
            source: { kind: "manual", label: "직접 입력", resourceId: "" },
          },
          {
            id: "legacy-finished-encounter",
            type: "encounter",
            system: "",
            code: "AMB",
            label: "완료 외래",
            date: "2026-07-01",
            status: "finished",
            value: "",
            unit: "",
            note: "이전 진료 기록",
            source: { kind: "manual", label: "직접 입력", resourceId: "" },
          },
          {
            id: "legacy-condition",
            type: "condition",
            system: "http://hl7.org/fhir/sid/icd-10",
            code: "I10",
            label: "고혈압",
            date: "2026-07-01",
            status: "active",
            value: "",
            unit: "",
            note: "",
            source: { kind: "manual", label: "직접 입력", resourceId: "" },
          },
          {
            id: "legacy-observation",
            type: "observation",
            system: "http://loinc.org",
            code: "85354-9",
            label: "혈압",
            date: "2026-07-01",
            status: "final",
            value: "148/94",
            unit: "mmHg",
            note: "",
            source: { kind: "manual", label: "직접 입력", resourceId: "" },
          },
        ],
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ],
    rules: structuredClone(createEmptyEmrState(CREATED_AT).rules),
    audit: [
      {
        id: "legacy-audit",
        at: UPDATED_AT,
        actor: "local-user",
        action: "patient.event.added",
        patientId: "legacy-patient",
        detail: "observation:85354-9",
      },
    ],
    storageError: "",
    recoveryRaw: "",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function createMemoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  const writes = [];
  const removals = [];
  return {
    values,
    writes,
    removals,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push({ key, value });
      values.set(key, value);
    },
    removeItem(key) {
      removals.push(key);
      values.delete(key);
    },
  };
}

test("실제 v1 상태를 v2로 올리며 환자·임상 사실·감사 이력을 보존한다", () => {
  const legacy = createLegacyV1State();
  const migrated = migrateV1ToV2(legacy, "2026-07-19T00:00:00.000Z");
  const patient = migrated.patients[0];
  const activeEncounter = patient.events.find(({ id }) => id === "legacy-active-encounter");
  const finishedEncounter = patient.events.find(({ id }) => id === "legacy-finished-encounter");
  const condition = patient.events.find(({ id }) => id === "legacy-condition");

  assert.equal(migrated.schema, EMR_SCHEMA);
  assert.equal(migrated.version, EMR_VERSION);
  assert.equal(migrated.revision, 0);
  assert.equal(migrated.selectedPatientId, legacy.selectedPatientId);
  assert.equal(migrated.selectedEncounterId, "");
  assert.equal(patient.mrn, "V1-1001");
  assert.equal(patient.name, "기존환자");
  assert.equal(patient.birthDate, "1974-04-12");
  assert.equal(patient.sex, "female");
  assert.equal(patient.phone, "010-1111-2222");
  assert.equal(patient.memo, "v1에서 작성한 메모");
  assert.equal(patient.ageYears, null);
  assert.equal(patient.address, "");
  assert.equal(patient.bloodType, "unknown");
  assert.equal(patient.insuranceType, "unknown");
  assert.deepEqual(patient.emergencyContact, { name: "", relation: "", phone: "" });
  assert.equal(patient.events.length, legacy.patients[0].events.length);
  assert.equal(activeEncounter.recordStatus, "draft");
  assert.deepEqual(activeEncounter.signature, { status: "unsigned", signer: "", signedAt: "" });
  assert.equal(finishedEncounter.recordStatus, "final");
  assert.deepEqual(finishedEncounter.signature, { status: "legacy", signer: "", signedAt: "" });
  assert.equal(condition.recordStatus, "final");
  assert.equal(condition.code, "I10");
  assert.ok(migrated.audit.some(({ id, action }) => id === "legacy-audit" && action === "patient.event.added"));
  assert.ok(migrated.audit.some(({ action, detail }) => action === "schema.migrated" && detail === "v1 → v2"));
});

test("legacy 저장 키만 있으면 v2 키로 승격하되 v1 원본은 보존한다", async () => {
  const legacy = createLegacyV1State();
  const legacyRaw = JSON.stringify(legacy);
  const storage = createMemoryStorage({ [LEGACY_EMR_STORAGE_KEY]: legacyRaw });

  const loaded = await initializeEmrState(storage);
  const promoted = JSON.parse(storage.values.get(EMR_STORAGE_KEY));

  assert.equal(loaded.version, EMR_VERSION);
  assert.equal(loaded.patients[0].name, "기존환자");
  assert.equal(promoted.version, EMR_VERSION);
  assert.equal(promoted.patients[0].events.length, legacy.patients[0].events.length);
  assert.equal(storage.values.get(LEGACY_EMR_STORAGE_KEY), legacyRaw);
  assert.deepEqual(storage.writes.map(({ key }) => key), [EMR_STORAGE_KEY]);
  assert.deepEqual(storage.removals, []);
});

test("현재 키에 남은 v1 payload도 제자리에서 v2로 다시 저장한다", async () => {
  const storage = createMemoryStorage({ [EMR_STORAGE_KEY]: JSON.stringify(createLegacyV1State()) });

  const loaded = await initializeEmrState(storage);
  const persisted = JSON.parse(storage.values.get(EMR_STORAGE_KEY));

  assert.equal(loaded.version, EMR_VERSION);
  assert.equal(persisted.version, EMR_VERSION);
  assert.ok(persisted.audit.some(({ action }) => action === "schema.migrated"));
  assert.deepEqual(storage.writes.map(({ key }) => key), [EMR_STORAGE_KEY]);
});

test("유효한 v2 저장이 있으면 남은 v1보다 우선하며 저장을 다시 쓰지 않는다", async () => {
  const current = migrateV1ToV2(createLegacyV1State(), UPDATED_AT);
  const staleLegacy = createLegacyV1State({
    patients: [{ ...createLegacyV1State().patients[0], name: "오래된환자" }],
  });
  const storage = createMemoryStorage({
    [EMR_STORAGE_KEY]: JSON.stringify(current),
    [LEGACY_EMR_STORAGE_KEY]: JSON.stringify(staleLegacy),
  });

  const loaded = await initializeEmrState(storage);

  assert.equal(loaded.patients[0].name, "기존환자");
  assert.deepEqual(storage.writes, []);
});

test("v1 승격 쓰기가 실패해도 환자 기록과 원문을 복구 대상으로 유지한다", async () => {
  const legacy = createLegacyV1State();
  const legacyRaw = JSON.stringify(legacy);
  const storage = {
    getItem(key) {
      return key === LEGACY_EMR_STORAGE_KEY ? legacyRaw : null;
    },
    setItem() {
      throw new Error("quota exceeded");
    },
  };

  const loaded = await initializeEmrState(storage);

  assert.equal(loaded.patients[0].name, "기존환자");
  assert.equal(loaded.version, EMR_VERSION);
  assert.match(loaded.storageError, /승격하지 못했습니다.*quota exceeded/);
  assert.equal(loaded.recoveryRaw, legacyRaw);
});

test("v1 백업을 복원하고 wrapper/data 버전 불일치·미래 버전·손상 참조를 거부한다", () => {
  const legacy = createLegacyV1State();
  const backup = {
    schema: EMR_BACKUP_SCHEMA,
    version: 1,
    exportedAt: "2026-07-18T10:00:00.000Z",
    data: legacy,
  };

  const restored = parseEmrBackup(structuredClone(backup));
  assert.equal(restored.version, EMR_VERSION);
  assert.equal(restored.patients[0].events.length, legacy.patients[0].events.length);
  assert.ok(restored.audit.some(({ action }) => action === "schema.migrated"));

  assert.throws(
    () => parseEmrBackup({ ...structuredClone(backup), version: EMR_VERSION }),
    /버전 참조가 일치하지/,
  );
  assert.throws(
    () => parseEmrBackup({ ...structuredClone(backup), version: EMR_VERSION + 1 }),
    /지원하지 않는/,
  );
  assert.throws(
    () => parseEmrBackup({
      ...structuredClone(backup),
      data: { ...structuredClone(legacy), selectedPatientId: "missing-patient" },
    }),
    /선택 환자 참조가 유효하지/,
  );
  assert.throws(
    () => parseEmrBackup({
      ...structuredClone(backup),
      data: {
        ...structuredClone(legacy),
        patients: [{ ...structuredClone(legacy.patients[0]), events: [{ bad: true }] }],
      },
    }),
    /임상 이벤트가 손상/,
  );
});

test("손상된 v1 저장은 승격하지 않고 원문을 복구 대상으로 남긴다", async () => {
  const broken = createLegacyV1State({ selectedPatientId: "missing-patient" });
  const raw = JSON.stringify(broken);
  const storage = createMemoryStorage({ [LEGACY_EMR_STORAGE_KEY]: raw });

  const loaded = await initializeEmrState(storage);

  assert.deepEqual(loaded.patients, []);
  assert.equal(loaded.recoveryRaw, raw);
  assert.match(loaded.storageError, /선택 환자 참조|유효하지/);
  assert.equal(storage.values.has(EMR_STORAGE_KEY), false);
  assert.equal(storage.values.get(LEGACY_EMR_STORAGE_KEY), raw);
  assert.deepEqual(storage.writes, []);
});

test("전체 초기화는 v2를 개인정보 없는 tombstone으로 교체하고 보존 중인 v1 키를 제거한다", async () => {
  const current = createEmptyEmrState("2026-07-19T00:00:00.000Z");
  const storage = createMemoryStorage({
    [EMR_STORAGE_KEY]: JSON.stringify(current),
    [LEGACY_EMR_STORAGE_KEY]: "legacy",
  });

  const cleared = await clearEmrState(storage, { now: "2026-07-19T01:00:00.000Z" });
  const persisted = JSON.parse(storage.values.get(EMR_STORAGE_KEY));

  assert.equal(cleared.patients.length, 0);
  assert.equal(cleared.audit.length, 0);
  assert.ok(cleared.revision > current.revision);
  assert.deepEqual(persisted, cleared);
  assert.equal(storage.values.has(LEGACY_EMR_STORAGE_KEY), false);
  assert.deepEqual(storage.removals, [LEGACY_EMR_STORAGE_KEY]);
});

test("전체 삭제 tombstone은 리비전 0인 이전 탭의 환자 부활을 차단한다", async () => {
  const legacyRaw = JSON.stringify(createLegacyV1State());
  const storage = createMemoryStorage({ [LEGACY_EMR_STORAGE_KEY]: legacyRaw });
  const staleTab = await initializeEmrState(storage);
  assert.equal(staleTab.revision, 0);
  assert.equal(staleTab.patients.length, 1);

  const cleared = await clearEmrState(storage, { now: "2026-07-19T01:00:00.000Z" });
  await assert.rejects(
    () => saveEmrState(staleTab, storage, staleTab.revision),
    /다른 탭.*변경/,
  );

  assert.ok(cleared.revision > staleTab.revision);
  assert.equal(JSON.parse(storage.values.get(EMR_STORAGE_KEY)).patients.length, 0);
});
