import { CONDITIONS, inferConditionIds } from "/data.js";
import {
  createBodyModel,
  createDetailModel,
  createGraphModel,
  normalizeActiveId,
  selectBodyArea,
  selectGraphNode,
} from "/view-model.js";

const toneClasses = ["tone-coral", "tone-cyan", "tone-lime", "tone-violet", "tone-amber"];
const svgNamespace = "http://www.w3.org/2000/svg";

const elements = {
  form: document.querySelector("#healthForm"),
  note: document.querySelector("#healthNote"),
  chips: [...document.querySelectorAll(".signal-chip")],
  analyzeButton: document.querySelector("#analyzeButton"),
  resetButton: document.querySelector("#resetButton"),
  formError: document.querySelector("#formError"),
  count: document.querySelector("#conditionCount"),
  miniList: document.querySelector("#miniConditionList"),
  mapStatus: document.querySelector("#mapStatus"),
  bodyKey: document.querySelector("#bodyKey"),
  hotspots: [...document.querySelectorAll(".body-hotspot")],
  graphEdges: document.querySelector("#graphEdges"),
  graphNodes: document.querySelector("#graphNodes"),
  graphEmpty: document.querySelector("#graphEmpty"),
  detailTone: document.querySelector("#detailTone"),
  detailSystem: document.querySelector("#detailSystem"),
  detailTitle: document.querySelector("#detailTitle"),
  detailSummary: document.querySelector("#detailSummary"),
  detailRelation: document.querySelector("#detailRelation"),
  detailChecks: document.querySelector("#detailChecks"),
  detailCare: document.querySelector("#detailCare"),
  sourceToggle: document.querySelector("#sourceToggle"),
  sourceDialog: document.querySelector("#sourceDialog"),
  sourceClose: document.querySelector("#sourceClose"),
};

const state = {
  declaredIds: [],
  visibleIds: [],
  activeId: "",
};

function renderList(target, items) {
  target.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("li");
      row.textContent = item;
      return row;
    }),
  );
}

function renderSummary() {
  const conditions = state.visibleIds.map((id) => CONDITIONS[id]);
  elements.count.textContent = `${conditions.length}개 신호`;
  elements.miniList.replaceChildren(
    ...conditions.map((condition) => {
      const badge = document.createElement("span");
      badge.textContent = condition.label;
      return badge;
    }),
  );
}

function renderBody() {
  const model = createBodyModel(state.visibleIds, state.activeId);
  for (const hotspot of elements.hotspots) {
    hotspot.classList.remove("is-active", ...toneClasses);
    const areaIds = model.areas[hotspot.dataset.area] ?? [];
    if (areaIds.length === 0) {
      hotspot.removeAttribute("title");
      continue;
    }
    const first = CONDITIONS[areaIds[0]];
    hotspot.classList.add("is-active", `tone-${first.tone}`);
    hotspot.title = areaIds.map((id) => CONDITIONS[id].label).join(", ");
  }

  elements.mapStatus.textContent = model.statusText;
  elements.mapStatus.classList.toggle("is-ready", model.ready);
  const swatch = document.createElement("span");
  swatch.className = model.keyTone ? `key-swatch tone-${model.keyTone}` : "key-swatch";
  elements.bodyKey.replaceChildren(swatch, document.createTextNode(model.keyText));
}

function addLine(start, end, className) {
  const line = document.createElementNS(svgNamespace, "line");
  line.setAttribute("x1", String(start[0]));
  line.setAttribute("y1", String(start[1]));
  line.setAttribute("x2", String(end[0]));
  line.setAttribute("y2", String(end[1]));
  line.setAttribute("class", className);
  elements.graphEdges.append(line);
}

function graphButton(node) {
  const { condition, position, selected } = node;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `graph-node tone-${condition.tone}`;
  button.classList.toggle("is-selected", selected);
  button.style.left = `${(position[0] / 820) * 100}%`;
  button.style.top = `${(position[1] / 430) * 100}%`;
  button.setAttribute("aria-pressed", String(selected));

  const label = document.createElement("strong");
  label.textContent = condition.label;
  const system = document.createElement("small");
  system.textContent = condition.system;
  button.append(label, system);
  button.addEventListener("click", () => {
    state.activeId = selectGraphNode(state.visibleIds, condition.id);
    renderAll();
  });
  return button;
}

function branchNode(branch) {
  addLine(branch.origin, branch.position, "branch-line");
  const node = document.createElement("div");
  node.className = "graph-node branch-node";
  node.style.left = `${(branch.position[0] / 820) * 100}%`;
  node.style.top = `${(branch.position[1] / 430) * 100}%`;
  const title = document.createElement("strong");
  title.textContent = branch.title;
  const value = document.createElement("small");
  value.textContent = branch.value;
  node.append(title, value);
  return node;
}

function renderGraph() {
  const model = createGraphModel(state.visibleIds, state.activeId);
  elements.graphEdges.replaceChildren();
  elements.graphNodes.replaceChildren();
  elements.graphEmpty.hidden = model.nodes.length > 0;
  if (model.nodes.length === 0) return;

  for (const edge of model.edges) {
    addLine(
      edge.start,
      edge.end,
      edge.selected ? "relation-line is-selected" : "relation-line",
    );
  }
  elements.graphNodes.append(
    ...model.nodes.map(graphButton),
    ...model.branches.map(branchNode),
  );
}

function renderDetail() {
  const detail = createDetailModel(state.activeId);
  elements.detailTone.className = detail.tone
    ? `detail-tone tone-${detail.tone}`
    : "detail-tone";
  elements.detailSystem.textContent = detail.system;
  elements.detailTitle.textContent = detail.title;
  elements.detailSummary.textContent = detail.summary;
  elements.detailRelation.textContent = detail.relation;
  renderList(elements.detailChecks, detail.checks);
  renderList(elements.detailCare, detail.care);
}

function renderAll() {
  renderSummary();
  renderBody();
  renderGraph();
  renderDetail();
}

function analyze() {
  const note = elements.note.value.trim();
  state.visibleIds = inferConditionIds(note, state.declaredIds);
  state.activeId = normalizeActiveId(state.visibleIds, state.activeId);
  elements.formError.hidden = state.visibleIds.length > 0;
  if (state.visibleIds.length === 0) {
    elements.formError.textContent =
      "자동으로 연결할 신호를 찾지 못했습니다. 질환을 선택하거나 검사명을 더 구체적으로 적어 주세요.";
  }
  renderAll();
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const hasInput = elements.note.value.trim().length > 0 || state.declaredIds.length > 0;
  if (!hasInput) {
    elements.formError.textContent = "증상이나 수치를 입력하거나 질환을 하나 이상 선택해 주세요.";
    elements.formError.hidden = false;
    return;
  }

  elements.analyzeButton.classList.add("is-loading");
  elements.analyzeButton.textContent = "연결을 찾는 중";
  window.setTimeout(() => {
    analyze();
    elements.analyzeButton.classList.remove("is-loading");
    elements.analyzeButton.textContent = "건강 지도 업데이트";
  }, 420);
});

for (const chip of elements.chips) {
  chip.addEventListener("click", () => {
    const id = chip.dataset.condition;
    const selected = chip.getAttribute("aria-pressed") === "true";
    chip.setAttribute("aria-pressed", String(!selected));
    state.declaredIds = selected
      ? state.declaredIds.filter((item) => item !== id)
      : [...state.declaredIds, id];
  });
}

for (const hotspot of elements.hotspots) {
  hotspot.addEventListener("click", () => {
    const match = selectBodyArea(state.visibleIds, hotspot.dataset.area);
    if (!match) return;
    state.activeId = match;
    renderAll();
  });
}

elements.resetButton.addEventListener("click", () => {
  elements.note.value = "";
  state.declaredIds = [];
  state.visibleIds = [];
  state.activeId = "";
  for (const chip of elements.chips) chip.setAttribute("aria-pressed", "false");
  elements.formError.hidden = true;
  renderAll();
});

elements.sourceToggle.addEventListener("click", () => elements.sourceDialog.showModal());
elements.sourceClose.addEventListener("click", () => elements.sourceDialog.close());

analyze();
