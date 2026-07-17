import assert from "node:assert/strict";
import test from "node:test";

import {
  createBodyModel,
  createDetailModel,
  createGraphModel,
  normalizeActiveId,
  selectBodyArea,
  selectGraphNode,
} from "../src/view-model.js";

test("질환 신호를 전신 부위별 활성 상태로 투영한다", () => {
  const model = createBodyModel(["hypertension", "dyslipidemia"], "dyslipidemia");

  assert.deepEqual(model.areas.heart, ["hypertension", "dyslipidemia"]);
  assert.equal(model.statusText, "2개 신호 연결");
  assert.equal(model.keyTone, "cyan");
});

test("선택한 질환의 관계선과 세 가지 관리 가지를 만든다", () => {
  const model = createGraphModel(
    ["hypertension", "diabetes", "dyslipidemia"],
    "diabetes",
  );

  assert.equal(model.edges.length, 3);
  assert.equal(model.edges.filter((edge) => edge.selected).length, 2);
  assert.deepEqual(model.branches.map((branch) => branch.title), ["식사", "확인", "관리"]);
  assert.equal(model.branches.length, 3);
});

test("그래프 노드와 신체 부위 선택은 현재 표시된 질환만 활성화한다", () => {
  const visible = ["migraine", "mood"];

  assert.equal(selectGraphNode(visible, "mood"), "mood");
  assert.equal(selectGraphNode(visible, "asthma"), "");
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
