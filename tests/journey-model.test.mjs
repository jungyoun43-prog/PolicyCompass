import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSnapshots,
  createJourneyBackup,
  createJourneySnapshot,
  JOURNEY_BACKUP_SCHEMA,
  JOURNEY_BACKUP_VERSION,
  JOURNEY_TIME_ZONE,
  normalizeJourney,
  parseJourneyBackup,
} from "../src/journey-model.js";

test("현재 건강 지도를 날짜가 있는 Journey 스냅샷으로 만든다", () => {
  const snapshot = createJourneySnapshot({
    id: "snap-1",
    observedAt: "2026-07-12T09:30:00+09:00",
    conditionIds: ["hypertension", "diabetes", "unknown"],
    measurements: [{ key: "ldl", label: "LDL", value: 156, unit: "mg/dL" }],
    source: "FHIR R4",
    createdAt: "2026-07-12T01:00:00.000Z",
  });

  assert.equal(snapshot.date, "2026-07-12");
  assert.deepEqual(snapshot.conditionIds, ["hypertension", "diabetes"]);
  assert.ok(snapshot.conditionEntries.every(({ provenanceKind }) => provenanceKind === "unverified"));
  assert.equal(snapshot.source, "기존 기록 · 항목별 출처 미확인");
  assert.equal(snapshot.measurements[0].display, "156 mg/dL");
});

test("두 스냅샷 사이에 추가되고 사라진 질환 항목을 비교한다", () => {
  const before = createJourneySnapshot({ id: "a", observedAt: "2026-06-01", conditionIds: ["hypertension", "reflux"] });
  const after = createJourneySnapshot({ id: "b", observedAt: "2026-07-01", conditionIds: ["hypertension", "diabetes"] });

  assert.deepEqual(compareSnapshots(before, after), {
    added: ["diabetes"],
    removed: ["reflux"],
    unchanged: ["hypertension"],
    addedSignals: [],
    removedSignals: [],
    unchangedSignals: [],
    measurementChanges: [],
  });
});

test("입력 패턴 신호의 추가·삭제를 질환 항목과 별도로 비교한다", () => {
  const baseSignal = {
    id: "input-symptom-heartburn-0",
    kind: "symptom-input",
    key: "heartburn",
    label: "속쓰림·신물 증상 입력",
    value: "속쓰림",
    unit: "",
    evidenceText: "속쓰림",
    provenanceKind: "input-pattern",
  };
  const nextSignal = {
    id: "input-measurement-ldl-0",
    kind: "measurement-input",
    key: "ldl",
    label: "LDL 콜레스테롤 측정 입력",
    value: "130",
    unit: "mg/dL",
    evidenceText: "LDL 130",
    provenanceKind: "input-pattern",
  };
  const before = createJourneySnapshot({ id: "signal-before", observedAt: "2026-06-01", signals: [baseSignal] });
  const after = createJourneySnapshot({ id: "signal-after", observedAt: "2026-07-01", signals: [nextSignal] });
  const changes = compareSnapshots(before, after);
  assert.deepEqual(changes.addedSignals, [nextSignal]);
  assert.deepEqual(changes.removedSignals, [baseSignal]);
  assert.deepEqual(changes.unchangedSignals, []);
});

test("같은 key와 단위의 숫자 측정값만 최근 두 시점의 차이를 계산한다", () => {
  const before = createJourneySnapshot({
    id: "a",
    observedAt: "2026-06-01",
    measurements: [
      { key: "ldl", label: "LDL", value: "156", unit: "mg/dL" },
      { key: "unsupported-weight", label: "체중", value: 70, unit: "kg" },
    ],
  });
  const after = createJourneySnapshot({
    id: "b",
    observedAt: "2026-07-01",
    measurements: [
      { key: "ldl", label: "LDL", value: 140, unit: "mg/dL" },
      { key: "unsupported-weight", label: "체중", value: 154, unit: "lb" },
    ],
  });

  assert.deepEqual(compareSnapshots(before, after).measurementChanges, [
    { key: "ldl", label: "LDL 콜레스테롤", before: 156, after: 140, delta: -16, unit: "mg/dL" },
  ]);
});

test("Journey 기록은 날짜순으로 정렬하고 손상된 항목을 제외한다", () => {
  const result = normalizeJourney([
    { id: "late", date: "2026-07-01", conditionIds: [] },
    null,
    { id: "invalid-date", date: "2026-99-99", conditionIds: [] },
    { id: "early", date: "2026-06-01", conditionIds: ["hypertension"], measurements: [] },
  ]);

  assert.deepEqual(result.map(({ id }) => id), ["early", "late"]);
});

test("Journey JSON 백업은 스키마와 버전을 포함하고 정규화된 기록으로 왕복한다", () => {
  const snapshot = createJourneySnapshot({
    id: "snap-1",
    observedAt: "2026-07-01T09:00:00+09:00",
    createdAt: "2026-07-01T01:00:00.000Z",
    conditionEntries: [{ id: "hypertension", provenanceKind: "clinician-confirmed-unsigned-import" }],
    signals: [{
      id: "input-measurement-ldl-1",
      kind: "measurement-input",
      key: "ldl",
      label: "LDL 측정 입력",
      value: "156",
      unit: "mg/dL",
      evidenceText: "LDL 156",
      provenanceKind: "input-pattern",
    }],
    measurements: [{
      key: "ldl",
      value: "156",
      unit: "mg/dL",
      provenanceKind: "clinician-final-unsigned-import",
    }],
  });
  const backup = createJourneyBackup([snapshot], "2026-07-17T00:00:00.000Z");

  assert.equal(backup.schema, JOURNEY_BACKUP_SCHEMA);
  assert.equal(backup.version, JOURNEY_BACKUP_VERSION);
  assert.equal(backup.exportedAt, "2026-07-17T00:00:00.000Z");
  assert.equal(backup.timeZone, JOURNEY_TIME_ZONE);
  assert.deepEqual(backup.snapshots[0].conditionEntries, [{
    id: "hypertension",
    provenanceKind: "clinician-confirmed-unsigned-import",
  }]);
  assert.equal(backup.snapshots[0].measurements[0].provenanceKind, "clinician-final-unsigned-import");
  assert.equal(Object.hasOwn(backup.snapshots[0], "source"), false);
  const restored = parseJourneyBackup(backup);
  assert.deepEqual(restored[0].conditionIds, ["hypertension"]);
  assert.deepEqual(restored[0].conditionEntries, [{ id: "hypertension", provenanceKind: "unverified-import" }]);
  assert.equal(restored[0].measurements[0].provenanceKind, "unverified-import");
  assert.equal(restored[0].source, "백업 복원 · 원본 출처 미검증");
  assert.equal(restored[0].signals[0].provenanceKind, "input-pattern");
});

test("지원하지 않는 버전·조작 출처·손상 날짜·중복 ID를 fail-closed한다", () => {
  const valid = createJourneyBackup([
    createJourneySnapshot({ id: "safe", observedAt: "2026-07-01T00:30:00+09:00", createdAt: "2026-06-30T16:00:00.000Z" }),
  ], "2026-07-02T00:00:00.000Z");
  assert.throws(
    () => parseJourneyBackup({ ...valid, version: 999 }),
    /지원하지 않는 Journey 백업 버전/,
  );
  const spoofed = structuredClone(valid);
  spoofed.snapshots[0].source = "EMR 서명 확정";
  assert.throws(() => parseJourneyBackup(spoofed), /허용되지 않은 필드/);
  const duplicated = structuredClone(valid);
  duplicated.snapshots.push(structuredClone(duplicated.snapshots[0]));
  assert.throws(() => parseJourneyBackup(duplicated), /중복된 기록 ID/);
  const wrongDate = structuredClone(valid);
  wrongDate.snapshots[0].date = "2026-06-30";
  assert.throws(() => parseJourneyBackup(wrongDate), /날짜·시각/);
  const futureDateOnly = structuredClone(valid);
  futureDateOnly.snapshots[0].date = "2026-07-03";
  futureDateOnly.snapshots[0].observedAt = "";
  assert.throws(() => parseJourneyBackup(futureDateOnly), /날짜·시각/);
  const futureBackup = structuredClone(valid);
  futureBackup.exportedAt = "2099-01-02T00:00:00.000Z";
  futureBackup.snapshots[0].date = "2099-01-01";
  futureBackup.snapshots[0].observedAt = "2099-01-01T00:00:00.000Z";
  futureBackup.snapshots[0].createdAt = "2099-01-01T00:01:00.000Z";
  assert.throws(() => parseJourneyBackup(futureBackup), /내보내기 시각이 미래/);
  assert.throws(
    () => parseJourneyBackup({ ...valid, unexpected: true }),
    /허용되지 않은 필드/,
  );
});

test("Asia/Seoul 자정 직후 관찰일을 UTC 전날로 잘못 저장하지 않는다", () => {
  const snapshot = createJourneySnapshot({
    id: "kst-midnight",
    observedAt: "2026-08-16T00:30:00+09:00",
    createdAt: "2026-08-15T15:31:00.000Z",
  });
  assert.equal(snapshot.date, "2026-08-16");
  assert.equal(snapshot.observedAt, "2026-08-15T15:30:00.000Z");
  assert.equal(snapshot.timeZone, JOURNEY_TIME_ZONE);
});
