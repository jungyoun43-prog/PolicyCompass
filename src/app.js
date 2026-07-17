import { CONDITIONS, inferConditionIds } from "/data.js";
import { parseFhirBundle } from "/fhir-import.js";
import { createJourneySnapshot, normalizeJourney } from "/journey-model.js";
import {
  createBodyModel,
  createDetailModel,
  normalizeActiveId,
  selectBodyArea,
} from "/view-model.js";

const toneClasses = ["tone-coral", "tone-cyan", "tone-lime", "tone-violet", "tone-amber"];
const sessionKey = "vitagraph-scene";
const journeyKey = "vitagraph-journey";

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
  graphPreviewCount: document.querySelector("#graphPreviewCount"),
  connectionsLinks: [...document.querySelectorAll("[data-connections-link]")],
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
  fhirFile: document.querySelector("#fhirFile"),
  fhirResult: document.querySelector("#fhirResult"),
  saveJourney: document.querySelector("#saveJourney"),
};

const state = {
  declaredIds: [],
  visibleIds: [],
  activeId: "",
  measurements: [],
  observedAt: "",
  source: "직접 입력",
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
  elements.graphPreviewCount.textContent = conditions.length + "개";
  elements.saveJourney.disabled = conditions.length === 0 && state.measurements.length === 0;
}

function measurementNote(measurements) {
  return measurements.map(({ label, value, unit }) => `${label} ${value}${unit ? ` ${unit}` : ""}`).join(", ");
}

function importFhirFile(file) {
  if (file.size > 2 * 1024 * 1024) throw new RangeError("2MB 이하의 FHIR JSON 파일만 가져올 수 있습니다.");
  return file.text().then((text) => parseFhirBundle(JSON.parse(text)));
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
  try {
    sessionStorage.setItem(sessionKey, JSON.stringify({
      visibleIds: state.visibleIds,
      activeId: state.activeId,
    }));
  } catch {
    // The map remains usable when session storage is unavailable.
  }
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

for (const link of elements.connectionsLinks) {
  link.addEventListener("click", () => {
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify({
        visibleIds: state.visibleIds,
        activeId: state.activeId,
      }));
    } catch {
      // Navigation still works if session storage is unavailable.
    }
  });
}

elements.resetButton.addEventListener("click", () => {
  elements.note.value = "";
  state.declaredIds = [];
  state.visibleIds = [];
  state.activeId = "";
  state.measurements = [];
  state.observedAt = "";
  state.source = "직접 입력";
  elements.fhirFile.value = "";
  elements.fhirResult.hidden = true;
  for (const chip of elements.chips) chip.setAttribute("aria-pressed", "false");
  elements.formError.hidden = true;
  renderAll();
});

elements.fhirFile.addEventListener("change", async () => {
  const [file] = elements.fhirFile.files;
  if (!file) return;
  elements.fhirResult.hidden = false;
  elements.fhirResult.className = "import-result is-loading";
  elements.fhirResult.textContent = "기록 구조를 확인하는 중…";
  try {
    const imported = await importFhirFile(file);
    state.declaredIds = imported.conditionIds;
    state.measurements = imported.measurements;
    state.observedAt = imported.observedAt;
    state.source = imported.provenance.format;
    for (const chip of elements.chips) chip.setAttribute("aria-pressed", String(state.declaredIds.includes(chip.dataset.condition)));
    const note = measurementNote(imported.measurements);
    if (note) elements.note.value = note;
    analyze();
    elements.fhirResult.className = "import-result is-success";
    elements.fhirResult.textContent = `${imported.provenance.supported}개 항목 연결 · ${imported.provenance.unsupported}개는 지원 범위 밖`;
  } catch (error) {
    elements.fhirResult.className = "import-result is-error";
    elements.fhirResult.textContent = error instanceof SyntaxError ? "JSON 형식을 읽을 수 없습니다." : error.message;
  }
});

elements.saveJourney.addEventListener("click", () => {
  const snapshot = createJourneySnapshot({
    observedAt: state.observedAt || new Date().toISOString(), conditionIds: state.visibleIds,
    measurements: state.measurements, source: state.source,
  });
  try {
    const existing = normalizeJourney(JSON.parse(localStorage.getItem(journeyKey) ?? "[]"));
    localStorage.setItem(journeyKey, JSON.stringify([...existing, snapshot]));
    elements.saveJourney.classList.add("is-saved");
    elements.saveJourney.querySelector("span").textContent = `${snapshot.date} 기록 저장됨`;
    window.setTimeout(() => { elements.saveJourney.classList.remove("is-saved"); elements.saveJourney.querySelector("span").textContent = "현재 지도를 Journey에 저장"; }, 1800);
  } catch {
    elements.formError.hidden = false;
    elements.formError.textContent = "이 브라우저에서 로컬 저장소를 사용할 수 없습니다.";
  }
});

elements.sourceToggle.addEventListener("click", () => elements.sourceDialog.showModal());
elements.sourceClose.addEventListener("click", () => elements.sourceDialog.close());

analyze();
