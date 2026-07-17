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
  assert.equal(settled.nodes.length, 8);
  assert.equal(settled.nodes.every(({ type }) => type === "condition"), true);
  for (let index = 0; index < settled.nodes.length; index += 1) {
    for (let comparison = index + 1; comparison < settled.nodes.length; comparison += 1) {
      const first = settled.nodes[index];
      const second = settled.nodes[comparison];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      assert.ok(distance >= first.collisionRadius + second.collisionRadius - 0.5);
    }
  }
});

test("그래프에는 질환과 질환 관계만 남긴다", () => {
  // Given
  const scene = createExplorerScene(["hypertension", "diabetes"], "hypertension");

  // When
  const branchNodes = scene.nodes.filter(({ type }) => type === "branch");
  const branchEdges = scene.edges.filter(({ type }) => type === "branch");

  // Then
  assert.equal(scene.nodes.every(({ type }) => type === "condition"), true);
  assert.equal(scene.edges.every(({ type }) => type === "relation"), true);
  assert.deepEqual(branchNodes, []);
  assert.deepEqual(branchEdges, []);
});

test("노드의 관계 밀도와 라벨 충돌 범위를 장면 모델에 담는다", () => {
  // Given
  const scene = createExplorerScene(["hypertension", "diabetes", "dyslipidemia", "migraine"], "hypertension");
  const hypertension = scene.nodes.find(({ id }) => id === "hypertension");
  const migraine = scene.nodes.find(({ id }) => id === "migraine");

  // Then
  assert.equal(hypertension.relationCount, 2);
  assert.equal(migraine.relationCount, 0);
  assert.ok(hypertension.radius > migraine.radius);
  assert.ok(hypertension.collisionRadius > hypertension.radius);
  assert.ok(hypertension.labelWidth >= 132);
});

test("같은 데이터는 같은 초기 장면을 만든다", () => {
  assert.deepEqual(
    createExplorerScene(visible, "migraine"),
    createExplorerScene(visible, "migraine"),
  );
});
