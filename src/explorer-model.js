import { CONDITIONS, RELATIONS } from "./data.js";

const baseWidth = 1180;
const baseHeight = 720;

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

function labelWidth(label, subtitle) {
  const titleWidth = label.length * 21 + 34;
  const subtitleWidth = subtitle.length * 14 + 54;
  return clamp(Math.max(titleWidth, subtitleWidth), 116, 176);
}

function initialConditionNode(id, index, relationCount) {
  const condition = CONDITIONS[id];
  const seed = hash(id);
  const angle = seededUnit(seed) * Math.PI * 2 + index * 0.47;
  const radiusX = 250 + seededUnit(seed + 11) * 250;
  const radiusY = 145 + seededUnit(seed + 29) * 130;
  const radius = 22;
  const textWidth = labelWidth(condition.label, condition.system);

  return {
    id,
    type: "condition",
    label: condition.label,
    subtitle: condition.system,
    detail: condition.summary,
    tone: condition.tone,
    relationCount,
    radius,
    labelWidth: textWidth,
    labelHeight: 48,
    // The visible dot stays compact; collision bounds reserve room for the
    // persistent title and metadata underneath it.
    collisionRadius: Math.max(82, Math.ceil(textWidth * 0.52)),
    x: baseWidth / 2 + Math.cos(angle) * radiusX,
    y: baseHeight / 2 + Math.sin(angle) * radiusY,
  };
}

export function createExplorerScene(visibleIds, activeId) {
  const visible = new Set(visibleIds);
  const relationEdges = RELATIONS.filter(
    ({ a, b }) => visible.has(a) && visible.has(b),
  ).map(({ a, b, label, category, rationale, sourceTitle, sourceUrl }) => ({
    id: `${a}:${b}`,
    type: "relation",
    source: a,
    target: b,
    label,
    category,
    rationale,
    sourceTitle,
    sourceUrl,
  }));
  const relationCounts = new Map(visibleIds.map((id) => [id, 0]));
  for (const { source, target } of relationEdges) {
    relationCounts.set(source, (relationCounts.get(source) ?? 0) + 1);
    relationCounts.set(target, (relationCounts.get(target) ?? 0) + 1);
  }
  const conditions = visibleIds
    .filter((id) => CONDITIONS[id])
    .map((id, index) => initialConditionNode(
      id,
      index,
      relationCounts.get(id) ?? 0,
    ));
  const active = CONDITIONS[activeId];

  return {
    activeId: active && visible.has(activeId) ? activeId : (visibleIds[0] ?? ""),
    nodes: conditions,
    edges: relationEdges,
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
      const overlapForce = distance < minimum ? (minimum - distance) * 0.12 : 0;
      const repelForce = Math.min(3.4, 4200 / (distance * distance));
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
    const preferredDistance = source.radius + target.radius + 330;
    const force = (distance - preferredDistance) * 0.011;
    const forceX = (dx / distance) * force;
    const forceY = (dy / distance) * force;
    forces[sourceIndex].x += forceX;
    forces[sourceIndex].y += forceY;
    forces[targetIndex].x -= forceX;
    forces[targetIndex].y -= forceY;
  }
}

function applyLayoutAnchors(nodes, forces, width, height) {
  const standalone = nodes.filter((node) => node.relationCount === 0);
  standalone.forEach((node, index) => {
    const nodeIndex = nodes.indexOf(node);
    const progress = standalone.length === 1 ? 0.5 : index / (standalone.length - 1);
    const anchorX = width * 0.8;
    const anchorY = height * (0.28 + progress * 0.46);
    forces[nodeIndex].x += (anchorX - node.x) * 0.0018;
    forces[nodeIndex].y += (anchorY - node.y) * 0.0018;
  });
}

function separateOverlaps(nodes, width, height) {
  for (let pass = 0; pass < 160; pass += 1) {
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
  for (let iteration = 0; iteration < 260; iteration += 1) {
    const forces = nodes.map((node) => ({
      x: (width / 2 - node.x) * 0.0005,
      y: (height / 2 - node.y) * 0.0005,
    }));
    applyPairForces(nodes, forces);
    applyEdgeForces(nodes, scene.edges, forces);
    applyLayoutAnchors(nodes, forces, width, height);
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
    nodes: nodes.map(({ vx: _vx, vy: _vy, ...node }) => node),
  };
}

export function selectExplorerNode(scene, nodeId) {
  if (!scene.nodes.some(({ id }) => id === nodeId)) return scene;
  return { ...scene, activeId: nodeId };
}
