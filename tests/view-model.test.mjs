import assert from "node:assert/strict";
import test from "node:test";

import {
  createBodyModel,
  createDetailModel,
  normalizeActiveId,
  selectBodyArea,
} from "../src/view-model.js";

test("질환 신호를 전신 부위별 활성 상태로 투영한다", () => {
  const model = createBodyModel(["hypertension", "dyslipidemia"], "dyslipidemia");

  assert.deepEqual(model.areas.heart, ["hypertension", "dyslipidemia"]);
  assert.equal(model.statusText, "2개 신호 연결");
  assert.equal(model.keyTone, "cyan");
});

test("신체 부위 선택은 현재 표시된 질환만 활성화한다", () => {
  const visible = ["migraine", "mood"];

  assert.equal(selectBodyArea(visible, "head"), "migraine");
  assert.equal(selectBodyArea(visible, "lungs"), "");
});

test("재분석과 상세 패널이 같은 활성 질환을 유지한다", () => {
  assert.equal(normalizeActiveId(["hypertension", "diabetes"], "diabetes"), "diabetes");
  assert.equal(normalizeActiveId(["hypertension"], "diabetes"), "hypertension");

  const detail = createDetailModel("diabetes");
  assert.equal(detail.title, "당뇨병");
  assert.equal(detail.checks.length, 3);
  assert.equal(detail.care.length, 3);
});
