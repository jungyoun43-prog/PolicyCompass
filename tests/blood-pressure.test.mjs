import assert from "node:assert/strict";
import test from "node:test";

import { extractInputSignals, inferConditionIds } from "../src/data.js";

test("단일 수축기 혈압은 고혈압 질환 ID로 승격하지 않는다", () => {
  assert.deepEqual(inferConditionIds("혈압 148/80", []), []);
  assert.deepEqual(extractInputSignals("혈압 148/80").map(({ kind, key, value, provenanceKind }) => ({ kind, key, value, provenanceKind })), [
    { kind: "measurement-input", key: "blood-pressure", value: "148/80", provenanceKind: "input-pattern" },
  ]);
});

test("단일 이완기 혈압도 측정 패턴 신호로만 보존한다", () => {
  assert.deepEqual(inferConditionIds("혈압 128/96", []), []);
  assert.equal(extractInputSignals("혈압 128/96")[0].label, "혈압 측정 입력");
});

test("콜론으로 구분한 혈압도 진단이 아닌 측정 신호로 인식한다", () => {
  assert.deepEqual(inferConditionIds("혈압: 148/94", []), []);
  assert.equal(extractInputSignals("혈압: 148/94")[0].evidenceText, "혈압: 148/94");
});

test("경계값 및 이하 측정값 모두 질환 진단으로 변환하지 않는다", () => {
  for (const note of ["혈압 140/90", "혈압 139/89", "공복혈당 126", "LDL 130"]) {
    assert.deepEqual(inferConditionIds(note, []), []);
    assert.ok(extractInputSignals(note).length > 0);
  }
});
