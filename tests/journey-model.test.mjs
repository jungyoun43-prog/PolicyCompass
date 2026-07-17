import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSnapshots,
  createJourneyBackup,
  createJourneySnapshot,
  JOURNEY_BACKUP_SCHEMA,
  JOURNEY_BACKUP_VERSION,
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
  });

  assert.equal(snapshot.date, "2026-07-12");
  assert.deepEqual(snapshot.conditionIds, ["hypertension", "diabetes"]);
  assert.equal(snapshot.measurements[0].display, "156 mg/dL");
});

test("두 스냅샷 사이에 추가되고 사라진 신호를 비교한다", () => {
  const before = createJourneySnapshot({ id: "a", observedAt: "2026-06-01", conditionIds: ["hypertension", "reflux"] });
  const after = createJourneySnapshot({ id: "b", observedAt: "2026-07-01", conditionIds: ["hypertension", "diabetes"] });

  assert.deepEqual(compareSnapshots(before, after), {
    added: ["diabetes"],
    removed: ["reflux"],
    unchanged: ["hypertension"],
    measurementChanges: [],
  });
});

test("같은 key와 단위의 숫자 측정값만 최근 두 시점의 차이를 계산한다", () => {
  const before = createJourneySnapshot({
    id: "a",
    observedAt: "2026-06-01",
    measurements: [
      { key: "ldl", label: "LDL", value: "156", unit: "mg/dL" },
      { key: "weight", label: "체중", value: 70, unit: "kg" },
      { key: "note", label: "메모", value: "공복", unit: "" },
    ],
  });
  const after = createJourneySnapshot({
    id: "b",
    observedAt: "2026-07-01",
    measurements: [
      { key: "ldl", label: "LDL", value: 140, unit: "mg/dL" },
      { key: "weight", label: "체중", value: 154, unit: "lb" },
      { key: "note", label: "메모", value: "식후", unit: "" },
    ],
  });

  assert.deepEqual(compareSnapshots(before, after).measurementChanges, [
    { key: "ldl", label: "LDL", before: 156, after: 140, delta: -16, unit: "mg/dL" },
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
  const backup = createJourneyBackup([
    {
      id: "snap-1",
      date: "2026-07-01",
      conditionIds: ["hypertension", "unknown"],
      measurements: [{ key: "ldl", label: "LDL", value: " 156 ", unit: " mg/dL " }],
    },
  ], "2026-07-17T00:00:00.000Z");

  assert.equal(backup.schema, JOURNEY_BACKUP_SCHEMA);
  assert.equal(backup.version, JOURNEY_BACKUP_VERSION);
  assert.equal(backup.exportedAt, "2026-07-17T00:00:00.000Z");
  assert.deepEqual(backup.snapshots[0].conditionIds, ["hypertension"]);
  assert.equal(backup.snapshots[0].measurements[0].display, "156 mg/dL");
  assert.deepEqual(parseJourneyBackup(backup), backup.snapshots);
});

test("지원하지 않는 버전이나 손상된 기록이 있는 Journey 백업은 거부한다", () => {
  assert.throws(
    () => parseJourneyBackup({ schema: JOURNEY_BACKUP_SCHEMA, version: 2, snapshots: [] }),
    /지원하지 않는 Journey 백업 버전/,
  );
  assert.throws(
    () => parseJourneyBackup({ schema: JOURNEY_BACKUP_SCHEMA, version: 1, snapshots: [{ id: "bad", date: "not-a-date" }] }),
    /읽을 수 없는 기록/,
  );
});
