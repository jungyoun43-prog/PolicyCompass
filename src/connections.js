import { CONDITIONS, relationsFor } from "/data.js";
import { createExplorerScene, settleExplorerScene } from "/explorer-model.js";
import { createDetailModel } from "/view-model.js";

const svgNamespace = "http://www.w3.org/2000/svg";
const sessionKey = "vitagraph-scene";
const sceneSize = { width: 1180, height: 720 };

const elements = {
  scene: document.querySelector("#networkScene"),
  viewport: document.querySelector("#sceneViewport"),
  edges: document.querySelector("#sceneEdges"),
  nodes: document.querySelector("#sceneNodes"),
  count: document.querySelector("#sceneNodeCount"),
  focus: document.querySelector("#sceneFocus"),
  zoomIn: document.querySelector("#zoomIn"),
  zoomOut: document.querySelector("#zoomOut"),
  reset: document.querySelector("#resetScene"),
  detailTone: document.querySelector("#explorerDetailTone"),
  detailSystem: document.querySelector("#explorerDetailSystem"),
  detailTitle: document.querySelector("#explorerDetailTitle"),
  detailSummary: document.querySelector("#explorerDetailSummary"),
  detailRelation: document.querySelector("#explorerDetailRelation"),
  detailChecks: document.querySelector("#explorerDetailChecks"),
  detailCare: document.querySelector("#explorerDetailCare"),
  evidenceList: document.querySelector("#explorerEvidenceList"),
  empty: document.querySelector("#sceneEmpty"),
};

function readSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
    const visibleIds = Array.isArray(stored?.visibleIds)
      ? stored.visibleIds.filter((id) => CONDITIONS[id])
      : [];
    return {
      visibleIds,
      activeId: visibleIds.includes(stored?.activeId) ? stored.activeId : (visibleIds[0] ?? ""),
    };
  } catch {
    return { visibleIds: [], activeId: "" };
  }
}

const state = {
  ...readSession(),
  selectedNodeId: "",
  scene: null,
  zoom: 1,
  drag: null,
};

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function renderList(target, items) {
  target.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("li");
      row.textContent = item;
      return row;
    }),
  );
}

function renderConditionDetail(id) {
  if (!id || !CONDITIONS[id]) return;
  const detail = createDetailModel(id);
  elements.detailTone.className = `detail-tone tone-${detail.tone}`;
  elements.detailSystem.textContent = detail.system;
  elements.detailTitle.textContent = detail.title;
  elements.detailSummary.textContent = detail.summary;
  elements.detailRelation.textContent = detail.relation;
  renderList(elements.detailChecks, detail.checks);
  renderList(elements.detailCare, detail.care);
  const evidence = relationsFor(id, state.visibleIds);
  elements.evidenceList.replaceChildren(...evidence.map((relation) => {
    const card = document.createElement("article"); card.className = "evidence-card";
    const neighborId = relation.a === id ? relation.b : relation.a;
    const heading = document.createElement("strong"); heading.textContent = `${CONDITIONS[neighborId].label} · ${relation.category}`;
    const rationale = document.createElement("p"); rationale.textContent = relation.rationale;
    const source = document.createElement("a"); source.href = relation.sourceUrl; source.target = "_blank"; source.rel = "noreferrer"; source.textContent = `${relation.sourceTitle} ↗`;
    card.append(heading, rationale, source); return card;
  }));
  if (evidence.length === 0) { const empty = document.createElement("p"); empty.className = "evidence-empty"; empty.textContent = "현재 지도 안에서 직접 연결된 근거가 없습니다."; elements.evidenceList.replaceChildren(empty); }
}

function renderBranchDetail(node) {
  const condition = CONDITIONS[state.activeId];
  elements.detailTone.className = "detail-tone tone-lime";
  elements.detailSystem.textContent = `${condition.label} · 관리 가지`;
  elements.detailTitle.textContent = node.label;
  elements.detailSummary.textContent = node.subtitle;
  elements.detailRelation.textContent = `${condition.label} 노드에서 펼친 ${node.label} 항목입니다.`;
  renderList(elements.detailChecks, node.detail.split(" · "));
  renderList(elements.detailCare, ["개인 상태와 복용 약에 따라 적용 방법을 의료진과 확인하세요."]);
}

function saveSession() {
  try {
    sessionStorage.setItem(sessionKey, JSON.stringify({
      visibleIds: state.visibleIds,
      activeId: state.activeId,
    }));
  } catch {
    // The explorer remains usable when session storage is unavailable.
  }
}

function relationLine(edge, positions) {
  const source = positions.get(edge.source);
  const target = positions.get(edge.target);
  const line = svgElement("line", {
    x1: source.x,
    y1: source.y,
    x2: target.x,
    y2: target.y,
    class: edge.type === "branch" ? "scene-edge branch-edge" : "scene-edge",
  });
  const label = svgElement("text", {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2 - 8,
    class: "edge-caption",
    "text-anchor": "middle",
  });
  label.textContent = edge.label;
  return [line, label];
}

function pointFromEvent(event) {
  const point = elements.scene.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(elements.viewport.getScreenCTM().inverse());
}

function moveNode(nodeId, point) {
  const node = state.scene.nodes.find(({ id }) => id === nodeId);
  if (!node) return;
  node.x = Math.max(node.collisionRadius, Math.min(sceneSize.width - node.collisionRadius, point.x));
  node.y = Math.max(node.collisionRadius, Math.min(sceneSize.height - node.collisionRadius, point.y));
  renderSceneElements();
}

function nodeGroup(node) {
  const group = svgElement("g", {
    class: `network-node ${node.type === "branch" ? "branch-node" : "condition-node"}`,
    transform: `translate(${node.x} ${node.y})`,
    tabindex: "0",
    role: "button",
    "data-tone": node.tone,
    "data-node-id": node.id,
    "aria-label": `${node.label}, ${node.subtitle}`,
  });
  if (node.id === state.activeId || node.id === state.selectedNodeId) {
    group.classList.add("is-selected");
  }
  group.append(
    svgElement("circle", { class: "node-halo", r: node.radius + 10 }),
    svgElement("circle", { class: "node-core", r: node.radius }),
  );
  const title = svgElement("text", {
    class: "node-title",
    y: node.type === "branch" ? 4 : node.radius + 24,
    "text-anchor": "middle",
  });
  title.textContent = node.label;
  const subtitle = svgElement("text", {
    class: "node-subtitle",
    y: node.radius + 42,
    "text-anchor": "middle",
  });
  subtitle.textContent = node.subtitle.length > 16 ? `${node.subtitle.slice(0, 16)}…` : node.subtitle;
  group.append(title, subtitle);

  const select = () => {
    if (state.drag?.moved) return;
    state.selectedNodeId = node.id;
    if (node.type === "condition") {
      state.activeId = node.id;
      saveSession();
      renderGraph();
      return;
    }
    renderBranchDetail(node);
    renderSceneElements();
  };
  group.addEventListener("click", select);
  group.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    select();
  });
  group.addEventListener("pointerdown", (event) => {
    state.drag = { nodeId: node.id, moved: false };
    group.setPointerCapture(event.pointerId);
  });
  group.addEventListener("pointermove", (event) => {
    if (state.drag?.nodeId !== node.id) return;
    state.drag.moved = true;
    moveNode(node.id, pointFromEvent(event));
  });
  group.addEventListener("pointerup", () => {
    window.setTimeout(() => { state.drag = null; }, 0);
  });
  return group;
}

function renderSceneElements() {
  const positions = new Map(state.scene.nodes.map((node) => [node.id, node]));
  elements.edges.replaceChildren(
    ...state.scene.edges.flatMap((edge) => relationLine(edge, positions)),
  );
  elements.nodes.replaceChildren(...state.scene.nodes.map(nodeGroup));
  elements.count.textContent = `${state.scene.nodes.length}개 노드 · ${state.scene.edges.length}개 연결`;
  elements.focus.textContent = CONDITIONS[state.activeId]?.label ?? "선택 대기";
}

function renderGraph() {
  const hasData = state.visibleIds.length > 0;
  elements.empty.hidden = hasData;
  elements.scene.classList.toggle("is-empty", !hasData);
  if (!hasData) {
    state.scene = { nodes: [], edges: [] }; elements.edges.replaceChildren(); elements.nodes.replaceChildren();
    elements.count.textContent = "0개 노드 · 입력 대기"; elements.focus.textContent = "선택 대기"; return;
  }
  state.scene = settleExplorerScene(
    createExplorerScene(state.visibleIds, state.activeId),
    sceneSize.width,
    sceneSize.height,
  );
  state.selectedNodeId = state.activeId;
  renderSceneElements();
  renderConditionDetail(state.activeId);
}

function setZoom(nextZoom) {
  state.zoom = Math.max(0.72, Math.min(1.55, nextZoom));
  const offsetX = sceneSize.width * (1 - state.zoom) / 2;
  const offsetY = sceneSize.height * (1 - state.zoom) / 2;
  elements.viewport.setAttribute("transform", `translate(${offsetX} ${offsetY}) scale(${state.zoom})`);
}

function updateSceneFraming() {
  const compact = window.matchMedia("(max-width: 620px)").matches;
  elements.scene.setAttribute("preserveAspectRatio", compact ? "xMidYMid slice" : "xMidYMid meet");
}

elements.zoomIn.addEventListener("click", () => setZoom(state.zoom + 0.12));
elements.zoomOut.addEventListener("click", () => setZoom(state.zoom - 0.12));
elements.reset.addEventListener("click", () => {
  setZoom(1);
  renderGraph();
});
elements.scene.addEventListener("wheel", (event) => {
  event.preventDefault();
  setZoom(state.zoom + (event.deltaY < 0 ? 0.08 : -0.08));
}, { passive: false });

window.addEventListener("resize", updateSceneFraming);
updateSceneFraming();
renderGraph();
