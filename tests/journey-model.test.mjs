import assert from "node:assert/strict";
import test from "node:test";

import { createJourneySnapshot, compareSnapshots, normalizeJourney } from "../src/journey-model.js";

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
  });
});

test("Journey 기록은 날짜순으로 정렬하고 손상된 항목을 제외한다", () => {
  const result = normalizeJourney([
    { id: "late", date: "2026-07-01", conditionIds: [] },
    null,
    { id: "early", date: "2026-06-01", conditionIds: ["hypertension"], measurements: [] },
  ]);

  assert.deepEqual(result.map(({ id }) => id), ["early", "late"]);
});
