import { CONDITIONS, RELATIONS } from "./data.js";

const baseWidth = 1180;
const baseHeight = 720;
const branchSpecs = [
  { key: "nutrition", label: "식사" },
  { key: "checks", label: "확인" },
  { key: "care", label: "관리" },
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hash(text) {
  let value = 2166136261;
  for (const character of text) {
    value ^= character.codePointAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function seededUnit(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function initialConditionNode(id, index) {
  const condition = CONDITIONS[id];
  const seed = hash(id);
  const angle = seededUnit(seed) * Math.PI * 2 + index * 0.47;
  const radiusX = 250 + seededUnit(seed + 11) * 250;
  const radiusY = 145 + seededUnit(seed + 29) * 130;
  return {
    id,
    type: "condition",
    label: condition.label,
    subtitle: condition.system,
    detail: condition.summary,
    tone: condition.tone,
    radius: 35,
    collisionRadius: 90,
    x: baseWidth / 2 + Math.cos(angle) * radiusX,
    y: baseHeight / 2 + Math.sin(angle) * radiusY,
  };
}

function initialBranchNode(active, spec, index) {
  const seed = hash(`${active.id}:${spec.key}`);
  const angle = (-Math.PI / 2) + index * (Math.PI * 2 / 3) + seededUnit(seed) * 0.35;
  return {
    id: `${active.id}:${spec.key}`,
    type: "branch",
    label: spec.label,
    subtitle: active[spec.key][0],
    detail: active[spec.key].join(" · "),
    tone: "lime",
    radius: 27,
    collisionRadius: 82,
    x: baseWidth / 2 + Math.cos(angle) * 190,
    y: baseHeight / 2 + Math.sin(angle) * 160,
  };
}

export function createExplorerScene(visibleIds, activeId) {
  const visible = new Set(visibleIds);
  const conditions = visibleIds
    .filter((id) => CONDITIONS[id])
    .map(initialConditionNode);
  const relationEdges = RELATIONS.filter(
    ({ a, b }) => visible.has(a) && visible.has(b),
  ).map(({ a, b, label }) => ({
    id: `${a}:${b}`,
    type: "relation",
    source: a,
    target: b,
    label,
  }));
  const active = CONDITIONS[activeId];
  const branches = active && visible.has(activeId)
    ? branchSpecs.map((spec, index) => initialBranchNode(active, spec, index))
    : [];
  const branchEdges = branches.map((node) => ({
    id: `${activeId}:${node.id}`,
    type: "branch",
    source: activeId,
    target: node.id,
    label: node.label,
  }));

  return {
    activeId: active && visible.has(activeId) ? activeId : (visibleIds[0] ?? ""),
    nodes: [...conditions, ...branches],
    edges: [...relationEdges, ...branchEdges],
  };
}

function applyPairForces(nodes, forces) {
  for (let index = 0; index < nodes.length; index += 1) {
    for (let comparison = index + 1; comparison < nodes.length; comparison += 1) {
      const first = nodes[index];
      const second = nodes[comparison];
      let dx = second.x - first.x;
      let dy = second.y - first.y;
      if (dx === 0 && dy === 0) dx = 0.01;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const minimum = first.collisionRadius + second.collisionRadius;
      const overlapForce = distance < minimum ? (minimum - distance) * 0.09 : 0;
      const repelForce = Math.min(2.2, 1800 / (distance * distance));
      const force = overlapForce + repelForce;
      const unitX = dx / distance;
      const unitY = dy / distance;
      forces[index].x -= unitX * force;
      forces[index].y -= unitY * force;
      forces[comparison].x += unitX * force;
      forces[comparison].y += unitY * force;
    }
  }
}

function applyEdgeForces(nodes, edges, forces) {
  const indexes = new Map(nodes.map(({ id }, index) => [id, index]));
  for (const edge of edges) {
    const sourceIndex = indexes.get(edge.source);
    const targetIndex = indexes.get(edge.target);
    if (sourceIndex === undefined || targetIndex === undefined) continue;
    const source = nodes[sourceIndex];
    const target = nodes[targetIndex];
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const preferred = edge.type === "branch" ? 155 : 245;
    const force = (distance - preferred) * 0.009;
    const forceX = (dx / distance) * force;
    const forceY = (dy / distance) * force;
    forces[sourceIndex].x += forceX;
    forces[sourceIndex].y += forceY;
    forces[targetIndex].x -= forceX;
    forces[targetIndex].y -= forceY;
  }
}

function separateOverlaps(nodes, width, height) {
  for (let pass = 0; pass < 120; pass += 1) {
    let changed = false;
    for (let index = 0; index < nodes.length; index += 1) {
      for (let comparison = index + 1; comparison < nodes.length; comparison += 1) {
        const first = nodes[index];
        const second = nodes[comparison];
        let dx = second.x - first.x;
        let dy = second.y - first.y;
        if (dx === 0 && dy === 0) dx = 0.01;
        const distance = Math.max(0.01, Math.hypot(dx, dy));
        const minimum = first.collisionRadius + second.collisionRadius;
        if (distance >= minimum) continue;
        const shift = (minimum - distance) / 2 + 0.1;
        const unitX = dx / distance;
        const unitY = dy / distance;
        first.x -= unitX * shift;
        first.y -= unitY * shift;
        second.x += unitX * shift;
        second.y += unitY * shift;
        changed = true;
      }
    }
    for (const node of nodes) {
      const margin = node.collisionRadius + 18;
      node.x = clamp(node.x, margin, width - margin);
      node.y = clamp(node.y, margin, height - margin);
    }
    if (!changed) break;
  }
}

export function settleExplorerScene(scene, width = baseWidth, height = baseHeight) {
  const nodes = scene.nodes.map((node) => ({
    ...node,
    x: node.x * width / baseWidth,
    y: node.y * height / baseHeight,
    vx: 0,
    vy: 0,
  }));
  for (let iteration = 0; iteration < 220; iteration += 1) {
    const forces = nodes.map((node) => ({
      x: (width / 2 - node.x) * 0.0014,
      y: (height / 2 - node.y) * 0.0014,
    }));
    applyPairForces(nodes, forces);
    applyEdgeForces(nodes, scene.edges, forces);
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      node.vx = (node.vx + forces[index].x) * 0.8;
      node.vy = (node.vy + forces[index].y) * 0.8;
      node.x += node.vx;
      node.y += node.vy;
    }
  }
  separateOverlaps(nodes, width, height);
  return {
    ...scene,
    nodes: nodes.map(({ vx, vy, ...node }) => node),
  };
}
