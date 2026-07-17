import assert from "node:assert/strict";
import test from "node:test";

import { inferConditionIds } from "../src/data.js";

test("수축기 혈압만 높은 신호도 심혈관 상태에 연결한다", () => {
  assert.deepEqual(inferConditionIds("혈압 148/80", []), ["hypertension"]);
});

test("이완기 혈압만 높은 신호도 심혈관 상태에 연결한다", () => {
  assert.deepEqual(inferConditionIds("혈압 128/96", []), ["hypertension"]);
});

test("콜론으로 구분한 혈압 기록도 인식한다", () => {
  assert.deepEqual(inferConditionIds("혈압: 148/94", []), ["hypertension"]);
});
