import assert from "node:assert/strict";
import test from "node:test";

import {
  createBodyModel,
  createDetailModel,
  normalizeActiveId,
  selectBodyArea,
} from "../src/view-model.js";

test("질환 신호를 진료과별 활성 상태로 중복 투영한다", () => {
  const model = createBodyModel(["hypertension", "dyslipidemia"], "dyslipidemia");

  assert.deepEqual(model.areas.cardio, ["hypertension", "dyslipidemia"]);
  assert.deepEqual(model.areas.renal, ["hypertension"]);
  assert.deepEqual(model.areas.endocrine, ["dyslipidemia"]);
  assert.equal(model.statusText, "3개 진료과 · 2개 신호");
  assert.equal(model.keyTone, "cyan");
});

test("진료과 선택은 현재 표시된 질환만 활성화한다", () => {
  const visible = ["migraine", "mood"];

  assert.equal(selectBodyArea(visible, "neuro"), "migraine");
  assert.equal(selectBodyArea(visible, "respiratory"), "");
});

test("재분석과 상세 패널이 같은 활성 질환을 유지한다", () => {
  assert.equal(normalizeActiveId(["hypertension", "diabetes"], "diabetes"), "diabetes");
  assert.equal(normalizeActiveId(["hypertension"], "diabetes"), "hypertension");

  const detail = createDetailModel("diabetes");
  assert.equal(detail.title, "당뇨병");
  assert.equal(detail.checks.length, 3);
  assert.equal(detail.care.length, 3);
});
