import assert from "node:assert/strict";
import test from "node:test";

import { createExplorerScene, settleExplorerScene } from "../src/explorer-model.js";

const visible = [
  "hypertension",
  "diabetes",
  "dyslipidemia",
  "migraine",
  "reflux",
  "asthma",
  "mood",
  "arthritis",
];

test("전체 질환을 불규칙하지만 겹치지 않는 장면으로 배치한다", () => {
  // Given
  const scene = createExplorerScene(visible, "diabetes");

  // When
  const settled = settleExplorerScene(scene, 1180, 720);

  // Then
  assert.equal(settled.nodes.length, 11);
  for (let index = 0; index < settled.nodes.length; index += 1) {
    for (let comparison = index + 1; comparison < settled.nodes.length; comparison += 1) {
      const first = settled.nodes[index];
      const second = settled.nodes[comparison];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      assert.ok(distance >= first.collisionRadius + second.collisionRadius - 0.5);
    }
  }
});

test("선택한 질환에만 식사·확인·관리 가지를 연결한다", () => {
  // Given
  const scene = createExplorerScene(["hypertension", "diabetes"], "hypertension");

  // When
  const branches = scene.nodes.filter(({ type }) => type === "branch");
  const branchEdges = scene.edges.filter(({ type }) => type === "branch");

  // Then
  assert.deepEqual(branches.map(({ label }) => label), ["식사", "확인", "관리"]);
  assert.equal(branchEdges.every(({ source }) => source === "hypertension"), true);
});

test("같은 데이터는 같은 초기 장면을 만든다", () => {
  assert.deepEqual(
    createExplorerScene(visible, "migraine"),
    createExplorerScene(visible, "migraine"),
  );
});
