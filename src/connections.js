import { CONDITIONS, relationsFor } from "/data.js";
import { createExplorerScene, selectExplorerNode, settleExplorerScene } from "/explorer-model.js";
import { createDetailModel } from "/view-model.js";

const svgNamespace = "http://www.w3.org/2000/svg";
const sessionKey = "vitagraph-scene";
const desktopSceneSize = { width: 1180, height: 720 };
const compactSceneSize = { width: 680, height: 720 };
let sceneSize = { ...desktopSceneSize };

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
  detailNutrition: document.querySelector("#explorerDetailNutrition"),
  detailCare: document.querySelector("#explorerDetailCare"),
  evidenceList: document.querySelector("#explorerEvidenceList"),
  empty: document.querySelector("#sceneEmpty"),
  demoMode: document.querySelector("#personalDemoMode"),
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
      isDemo: stored?.isDemo === true,
    };
  } catch {
    return { visibleIds: [], activeId: "", isDemo: false };
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
  renderList(elements.detailNutrition, detail.nutrition);
  renderList(elements.detailCare, detail.care);

  const evidence = relationsFor(id, state.visibleIds);
  elements.evidenceList.replaceChildren(...evidence.map((relation) => {
    const card = document.createElement("article");
    card.className = "evidence-card";
    const neighborId = relation.a === id ? relation.b : relation.a;
    const heading = document.createElement("strong");
    heading.textContent = `${CONDITIONS[neighborId].label} · ${relation.category}`;
    const rationale = document.createElement("p");
    rationale.textContent = relation.rationale;
    const source = document.createElement("a");
    source.href = relation.sourceUrl;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = `${relation.sourceTitle} ↗`;
    card.append(heading, rationale, source);
    return card;
  }));
  if (evidence.length === 0) {
    const empty = document.createElement("p");
    empty.className = "evidence-empty";
    empty.textContent = "현재 지도 안에서 직접 연결된 근거가 없습니다.";
    elements.evidenceList.replaceChildren(empty);
  }
}

function renderEmptyDetail() {
  elements.detailTone.className = "detail-tone";
  elements.detailSystem.textContent = "연결 지도";
  elements.detailTitle.textContent = "질환 노드를 선택하세요";
  elements.detailSummary.textContent = "질환 관계는 그래프에서, 검사·식사·관리 메모는 이 패널에서 분리해 읽습니다.";
  elements.detailRelation.textContent = "Health Map에서 연결한 질환이 이 장면에 표시됩니다.";
  renderList(elements.detailChecks, ["증상 발생 시점", "검사실 결과", "복용 중인 약"]);
  renderList(elements.detailNutrition, ["개인 식사 패턴 기록", "의료진과 영양 목표 상의"]);
  renderList(elements.detailCare, ["의료진과 우선순위 정하기", "추적 시점 기록하기"]);
  const empty = document.createElement("p");
  empty.className = "evidence-empty";
  empty.textContent = "질환 노드를 선택하면 관계 근거가 표시됩니다.";
  elements.evidenceList.replaceChildren(empty);
}

function saveSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? "{}");
    const preserved = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    sessionStorage.setItem(sessionKey, JSON.stringify({
      ...preserved,
      visibleIds: state.visibleIds,
      activeId: state.activeId,
    }));
  } catch {
    // The explorer remains usable when session storage is unavailable.
  }
}

function curveDirection(id) {
  const value = [...id].reduce((total, character) => total + character.codePointAt(0), 0);
  return value % 2 === 0 ? 1 : -1;
}

function relationLine(edge, positions) {
  const source = positions.get(edge.source);
  const target = positions.get(edge.target);
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const unitX = dx / distance;
  const unitY = dy / distance;
  const start = {
    x: source.x + unitX * (source.radius + 8),
    y: source.y + unitY * (source.radius + 8),
  };
  const end = {
    x: target.x - unitX * (target.radius + 8),
    y: target.y - unitY * (target.radius + 8),
  };
  const bend = Math.min(42, Math.max(24, distance * 0.12)) * curveDirection(edge.id);
  const control = {
    x: (start.x + end.x) / 2 - unitY * bend,
    y: (start.y + end.y) / 2 + unitX * bend,
  };
  const midpoint = {
    x: (start.x + 2 * control.x + end.x) / 4,
    y: (start.y + 2 * control.y + end.y) / 4,
  };
  const isActive = edge.source === state.activeId || edge.target === state.activeId;
  const path = svgElement("path", {
    d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    class: `scene-edge${isActive ? " is-active" : " is-muted"}`,
    "data-edge-id": edge.id,
  });
  const caption = svgElement("g", {
    class: `edge-caption${isActive ? " is-active" : " is-muted"}`,
    "aria-hidden": "true",
  });
  const captionWidth = Math.max(90, edge.label.length * 17 + 30);
  const captionText = svgElement("text", {
    class: "edge-caption__text",
    x: midpoint.x,
    y: midpoint.y + 2,
    "text-anchor": "middle",
    "dominant-baseline": "middle",
  });
  captionText.textContent = edge.label;
  caption.append(
    svgElement("rect", {
      class: "edge-caption__surface",
      x: midpoint.x - captionWidth / 2,
      y: midpoint.y - 20,
      width: captionWidth,
      height: 34,
      rx: 15,
    }),
    captionText,
  );
  return [path, caption];
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
  const isSelected = node.id === state.activeId || node.id === state.selectedNodeId;
  const isRelated = state.scene.edges.some((edge) => (
    (edge.source === state.activeId && edge.target === node.id)
    || (edge.target === state.activeId && edge.source === node.id)
  ));
  const isStandalone = node.relationCount === 0;
  const selectionDescription = isSelected
    ? "선택한 중심 질환"
    : isRelated
      ? "선택한 질환과 직접 연결됨"
      : isStandalone
        ? "현재 지도 안에 직접 연결된 질환 없음"
        : "다른 질환과 연결됨";
  const group = svgElement("g", {
    class: "network-node condition-node",
    transform: `translate(${node.x} ${node.y})`,
    tabindex: "0",
    role: "button",
    "data-tone": node.tone,
    "data-node-id": node.id,
    "data-relation-count": node.relationCount,
    "aria-label": `${node.label}, ${node.subtitle}. ${selectionDescription}.`,
    "aria-pressed": String(isSelected),
  });
  if (isSelected) group.classList.add("is-selected");
  if (isRelated) group.classList.add("is-related");
  if (!isSelected && !isRelated) group.classList.add("is-muted");
  if (isStandalone) group.classList.add("is-standalone");

  group.append(
    svgElement("circle", { class: "node-halo", r: node.radius + 16 }),
    svgElement("circle", { class: "node-core", r: node.radius }),
    svgElement("circle", { class: "node-orbit", r: 5 }),
  );
  const title = svgElement("text", {
    class: "node-title",
    y: node.radius + 28,
    "text-anchor": "middle",
  });
  title.textContent = node.label;
  const subtitle = svgElement("text", {
    class: "node-subtitle",
    y: node.radius + 50,
    "text-anchor": "middle",
  });
  subtitle.textContent = isStandalone
    ? `${node.subtitle} · 직접 연결 없음`
    : `${node.subtitle} · ${node.relationCount}개 관계`;
  group.append(title, subtitle);

  const select = () => {
    if (state.drag?.moved) return;
    state.selectedNodeId = node.id;
    state.scene = selectExplorerNode(state.scene, node.id);
    state.activeId = state.scene.activeId;
    saveSession();
    renderSceneElements();
    renderConditionDetail(node.id);
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
  elements.count.textContent = `${state.scene.nodes.length}개 질환 · ${state.scene.edges.length}개 관계`;
  elements.focus.textContent = state.activeId ? `${CONDITIONS[state.activeId]?.label} 중심` : "선택 대기";
}

function renderGraph() {
  const hasData = state.visibleIds.length > 0;
  elements.empty.hidden = hasData;
  elements.scene.classList.toggle("is-empty", !hasData);
  if (!hasData) {
    state.scene = { nodes: [], edges: [] };
    elements.edges.replaceChildren();
    elements.nodes.replaceChildren();
    elements.count.textContent = "0개 질환 · 입력 대기";
    elements.focus.textContent = "선택 대기";
    renderEmptyDetail();
    return;
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
  const nextSize = compact ? compactSceneSize : desktopSceneSize;
  const changed = sceneSize.width !== nextSize.width || sceneSize.height !== nextSize.height;
  sceneSize = { ...nextSize };
  elements.scene.setAttribute("viewBox", `0 0 ${sceneSize.width} ${sceneSize.height}`);
  elements.scene.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return changed;
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

window.addEventListener("resize", () => {
  if (updateSceneFraming()) renderGraph();
});
updateSceneFraming();
if (elements.demoMode) elements.demoMode.hidden = !state.isDemo;
renderGraph();
