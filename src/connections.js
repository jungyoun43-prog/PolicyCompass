import { CONDITIONS, relationsFor } from "/data.js";
import { readCareBridge, subscribeCareBridge } from "/care-bridge.js";
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
  zoomLevel: document.querySelector("#zoomLevel"),
  reset: document.querySelector("#resetScene"),
  detailTone: document.querySelector("#explorerDetailTone"),
  detailSystem: document.querySelector("#explorerDetailSystem"),
  detailTitle: document.querySelector("#explorerDetailTitle"),
  evidenceKind: document.querySelector("#explorerEvidenceKind"),
  detailSummary: document.querySelector("#explorerDetailSummary"),
  detailRelation: document.querySelector("#explorerDetailRelation"),
  detailChecks: document.querySelector("#explorerDetailChecks"),
  detailNutrition: document.querySelector("#explorerDetailNutrition"),
  detailCare: document.querySelector("#explorerDetailCare"),
  evidenceList: document.querySelector("#explorerEvidenceList"),
  empty: document.querySelector("#sceneEmpty"),
  demoMode: document.querySelector("#personalDemoMode"),
};

function conditionIds(value) {
  return Array.isArray(value)
    ? [...new Set(value)].filter((id) => CONDITIONS[id])
    : [];
}

function clinicalIdsFromBridge(bridge) {
  return conditionIds(bridge?.clinical?.snapshot?.healthMap?.conditions?.map(({ id }) => id));
}

function readSession(bridge = readCareBridge()) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
    const storedVisibleIds = conditionIds(stored?.visibleIds);
    const storedClinicalIds = conditionIds(stored?.clinicalConditionIds);
    const declaredIds = conditionIds(stored?.declaredIds);
    const isDemo = stored?.isDemo === true;
    const patientVisibleIds = Array.isArray(stored?.patientVisibleIds)
      ? conditionIds(stored.patientVisibleIds)
      : storedVisibleIds.filter((id) => !storedClinicalIds.includes(id) || declaredIds.includes(id));
    const clinicalConditionIds = isDemo ? [] : clinicalIdsFromBridge(bridge);
    const visibleIds = isDemo
      ? storedVisibleIds
      : [...new Set([...patientVisibleIds, ...clinicalConditionIds])];
    return {
      visibleIds,
      patientVisibleIds,
      clinicalConditionIds,
      declaredIds: declaredIds.filter((id) => visibleIds.includes(id)),
      activeId: visibleIds.includes(stored?.activeId) ? stored.activeId : (visibleIds[0] ?? ""),
      isDemo,
    };
  } catch {
    return {
      visibleIds: [],
      patientVisibleIds: [],
      clinicalConditionIds: [],
      declaredIds: [],
      activeId: "",
      isDemo: false,
    };
  }
}

const state = {
  ...readSession(readCareBridge()),
  selectedNodeId: "",
  scene: null,
  zoom: 1,
  pan: { x: 0, y: 0 },
  panDrag: null,
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

function conditionProvenance(id) {
  if (state.clinicalConditionIds.includes(id)) {
    return {
      kind: "recorded",
      source: "clinical",
      label: "EMR 확정 기록 · 의료진이 서명·확정한 뒤 환자용으로 정제된 질환 항목",
      aria: "EMR에서 서명·확정 후 정제되어 연결된 질환 기록",
    };
  }
  if (state.declaredIds.includes(id)) {
    return {
      kind: "recorded",
      source: "patient",
      label: "환자 직접 확인 · 건강 지도에서 직접 선택한 항목 · 의료진 확정 진단 아님",
      aria: "건강 지도에서 직접 선택한 환자 확인 항목, 의료진 확정 진단 아님",
    };
  }
  return {
    kind: "inferred",
    source: "inferred",
    label: "입력 신호에서 찾은 확인 후보 · 진단으로 기록된 사실이 아님",
    aria: "입력 신호에서 찾은 확인 후보, 진단 사실 아님",
  };
}

function renderConditionDetail(id) {
  if (!id || !CONDITIONS[id]) return;
  const detail = createDetailModel(id);
  elements.detailTone.className = `detail-tone tone-${detail.tone}`;
  elements.detailSystem.textContent = detail.system;
  elements.detailTitle.textContent = detail.title;
  const provenance = conditionProvenance(id);
  elements.evidenceKind.className = `evidence-kind evidence-kind--${provenance.kind}`;
  elements.evidenceKind.dataset.provenance = provenance.source;
  elements.evidenceKind.textContent = provenance.label;
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
    const kind = document.createElement("span");
    kind.className = "evidence-card__kind";
    kind.textContent = "문헌 기반 추론 관계 · 환자 기록 사실 아님";
    const rationale = document.createElement("p");
    rationale.textContent = relation.rationale;
    const source = document.createElement("a");
    source.href = relation.sourceUrl;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = `${relation.sourceTitle} ↗`;
    card.append(heading, kind, rationale, source);
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
  elements.evidenceKind.className = "evidence-kind";
  delete elements.evidenceKind.dataset.provenance;
  elements.evidenceKind.textContent = "개인 기록 근거와 문헌 기반 추론 관계를 구분해 표시합니다.";
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
      patientVisibleIds: state.patientVisibleIds,
      clinicalConditionIds: state.clinicalConditionIds,
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
    class: `scene-edge is-inferred${isActive ? " is-active" : " is-muted"}`,
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
  const provenance = conditionProvenance(node.id);
  const isRecorded = provenance.kind === "recorded";
  const isRelated = state.scene.edges.some((edge) => (
    (edge.source === state.activeId && edge.target === node.id)
    || (edge.target === state.activeId && edge.source === node.id)
  ));
  const isStandalone = node.relationCount === 0;
  const selectionDescription = isSelected
    ? "현재 선택됨, 중심 질환"
    : isRelated
      ? "선택한 질환과 직접 연결됨"
      : isStandalone
        ? "현재 지도 안에 직접 연결된 질환 없음"
        : "다른 질환과 연결됨";
  const group = svgElement("g", {
    class: `network-node condition-node ${isRecorded ? "is-recorded" : "is-inferred"}`,
    transform: `translate(${node.x} ${node.y})`,
    tabindex: "0",
    role: "button",
    "data-tone": node.tone,
    "data-node-id": node.id,
    "data-relation-count": node.relationCount,
    "data-evidence-kind": provenance.kind,
    "data-evidence-source": provenance.source,
    "aria-label": `${node.label}, ${node.subtitle}. ${provenance.aria}. ${selectionDescription}.`,
    "aria-pressed": String(isSelected),
  });
  if (isSelected) group.classList.add("is-selected");
  if (isRelated) group.classList.add("is-related");
  if (!isSelected && !isRelated) group.classList.add("is-muted");
  if (isStandalone) group.classList.add("is-standalone");

  group.append(
    svgElement("circle", { class: "node-halo", r: node.radius + 16 }),
    svgElement("circle", { class: "node-selection-ring", r: node.radius + 10 }),
    svgElement("circle", { class: "node-core", r: node.radius }),
    svgElement("circle", { class: "node-orbit", r: 5 }),
  );
  const selectionBadge = svgElement("g", { class: "node-selection-badge", "aria-hidden": "true" });
  const selectionText = svgElement("text", {
    x: 0,
    y: -(node.radius + 24),
    "text-anchor": "middle",
    "dominant-baseline": "middle",
  });
  selectionText.textContent = "✓ 선택됨";
  selectionBadge.append(
    svgElement("rect", {
      x: -38,
      y: -(node.radius + 36),
      width: 76,
      height: 24,
      rx: 12,
    }),
    selectionText,
  );
  group.append(selectionBadge);
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
    event.stopPropagation();
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
  group.addEventListener("pointercancel", () => {
    state.drag = null;
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
  elements.focus.textContent = state.activeId ? `${CONDITIONS[state.activeId]?.label} 선택됨 · 중심` : "선택 대기";
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

function refreshFromBridge(bridge = readCareBridge()) {
  const next = readSession(bridge);
  Object.assign(state, next);
  state.selectedNodeId = state.activeId;
  if (elements.demoMode) elements.demoMode.hidden = !state.isDemo;
  saveSession();
  renderGraph();
}

function applyViewportTransform() {
  const offsetX = sceneSize.width * (1 - state.zoom) / 2;
  const offsetY = sceneSize.height * (1 - state.zoom) / 2;
  elements.viewport.setAttribute(
    "transform",
    `translate(${offsetX + state.pan.x} ${offsetY + state.pan.y}) scale(${state.zoom})`,
  );
  elements.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
  elements.zoomOut.disabled = state.zoom <= 0.72;
  elements.zoomIn.disabled = state.zoom >= 1.55;
}

function setZoom(nextZoom) {
  state.zoom = Math.max(0.72, Math.min(1.55, nextZoom));
  applyViewportTransform();
}

function setPan(nextX, nextY) {
  const horizontalLimit = sceneSize.width * 0.38;
  const verticalLimit = sceneSize.height * 0.38;
  state.pan.x = Math.max(-horizontalLimit, Math.min(horizontalLimit, nextX));
  state.pan.y = Math.max(-verticalLimit, Math.min(verticalLimit, nextY));
  applyViewportTransform();
}

function resetCamera() {
  state.zoom = 1;
  state.pan = { x: 0, y: 0 };
  applyViewportTransform();
}

function scenePointFromEvent(event) {
  const point = elements.scene.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(elements.scene.getScreenCTM().inverse());
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
  resetCamera();
  renderGraph();
});
elements.scene.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest?.(".network-node")) return;
  const point = scenePointFromEvent(event);
  state.panDrag = { pointerId: event.pointerId, point, origin: { ...state.pan } };
  elements.scene.setPointerCapture(event.pointerId);
  elements.scene.classList.add("is-panning");
});
elements.scene.addEventListener("pointermove", (event) => {
  if (state.panDrag?.pointerId !== event.pointerId) return;
  const point = scenePointFromEvent(event);
  setPan(
    state.panDrag.origin.x + point.x - state.panDrag.point.x,
    state.panDrag.origin.y + point.y - state.panDrag.point.y,
  );
});
const finishPan = (event) => {
  if (state.panDrag?.pointerId !== event.pointerId) return;
  state.panDrag = null;
  elements.scene.classList.remove("is-panning");
};
elements.scene.addEventListener("pointerup", finishPan);
elements.scene.addEventListener("pointercancel", finishPan);
elements.scene.addEventListener("wheel", (event) => {
  event.preventDefault();
  setZoom(state.zoom + (event.deltaY < 0 ? 0.08 : -0.08));
}, { passive: false });
elements.scene.addEventListener("keydown", (event) => {
  if (event.target !== elements.scene) return;
  const panStep = 36;
  if (event.key === "ArrowLeft") setPan(state.pan.x + panStep, state.pan.y);
  else if (event.key === "ArrowRight") setPan(state.pan.x - panStep, state.pan.y);
  else if (event.key === "ArrowUp") setPan(state.pan.x, state.pan.y + panStep);
  else if (event.key === "ArrowDown") setPan(state.pan.x, state.pan.y - panStep);
  else if (event.key === "+" || event.key === "=") setZoom(state.zoom + 0.12);
  else if (event.key === "-" || event.key === "_") setZoom(state.zoom - 0.12);
  else if (event.key === "0") resetCamera();
  else return;
  event.preventDefault();
});

window.addEventListener("resize", () => {
  if (updateSceneFraming()) {
    resetCamera();
    renderGraph();
  }
});
updateSceneFraming();
applyViewportTransform();
if (elements.demoMode) elements.demoMode.hidden = !state.isDemo;
renderGraph();
const unsubscribeBridge = subscribeCareBridge((bridge) => refreshFromBridge(bridge));
window.addEventListener("pagehide", unsubscribeBridge, { once: true });
