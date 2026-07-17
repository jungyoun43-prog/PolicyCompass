import assert from "node:assert/strict";
import test from "node:test";

import {
  createExplorerScene,
  selectExplorerNode,
  settleExplorerScene,
} from "../src/explorer-model.js";

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
  const xs = settled.nodes.map(({ x }) => x);
  const ys = settled.nodes.map(({ y }) => y);
  assert.ok(Math.max(...xs) - Math.min(...xs) >= 560);
  assert.ok(Math.max(...ys) - Math.min(...ys) >= 400);
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

test("모든 질환 노드는 같은 작은 원을 쓰고 라벨 충돌 범위를 따로 둔다", () => {
  // Given
  const scene = createExplorerScene(["hypertension", "diabetes", "dyslipidemia", "migraine"], "hypertension");
  const hypertension = scene.nodes.find(({ id }) => id === "hypertension");
  const migraine = scene.nodes.find(({ id }) => id === "migraine");

  // Then
  assert.equal(hypertension.relationCount, 2);
  assert.equal(migraine.relationCount, 0);
  assert.equal(hypertension.radius, migraine.radius);
  assert.ok(hypertension.radius <= 24);
  assert.ok(hypertension.collisionRadius > hypertension.radius);
  assert.ok(hypertension.labelWidth >= 116);
});

test("같은 데이터는 같은 초기 장면을 만든다", () => {
  assert.deepEqual(
    createExplorerScene(visible, "migraine"),
    createExplorerScene(visible, "migraine"),
  );
});

test("선택 질환이 달라도 장면 좌표는 바뀌지 않는다", () => {
  const first = settleExplorerScene(createExplorerScene(visible, "hypertension"), 1180, 720);
  const second = settleExplorerScene(createExplorerScene(visible, "migraine"), 1180, 720);

  assert.deepEqual(
    first.nodes.map(({ id, x, y }) => ({ id, x, y })),
    second.nodes.map(({ id, x, y }) => ({ id, x, y })),
  );
});

test("노드 선택은 기존 장면 좌표를 그대로 유지한다", () => {
  const scene = settleExplorerScene(createExplorerScene(visible, "hypertension"), 1180, 720);
  const before = scene.nodes.map(({ id, x, y }) => ({ id, x, y }));

  const selected = selectExplorerNode(scene, "migraine");

  assert.equal(selected.activeId, "migraine");
  assert.deepEqual(selected.nodes.map(({ id, x, y }) => ({ id, x, y })), before);
});
