import { CONDITIONS, inferConditionIds } from "/data.js";
import { createJourneySnapshot, normalizeJourney } from "/journey-model.js";
import { parsePatientTransferPackage } from "/patient-transfer.js";
import {
  createBodyModel,
  createDetailModel,
  normalizeActiveId,
  selectBodyArea,
} from "/view-model.js";

const toneClasses = ["tone-coral", "tone-cyan", "tone-lime", "tone-violet", "tone-amber"];
const sessionKey = "vitagraph-scene";
const journeyKey = "vitagraph-journey";
const demoNote = "혈압 148/94, 공복혈당 132, LDL 156, 속쓰림, 편두통";

const elements = {
  form: document.querySelector("#healthForm"),
  note: document.querySelector("#healthNote"),
  loadDemo: document.querySelector("#loadDemo"),
  demoMode: document.querySelector("#demoMode"),
  chips: [...document.querySelectorAll(".signal-chip")],
  analyzeButton: document.querySelector("#analyzeButton"),
  resetButton: document.querySelector("#resetButton"),
  formError: document.querySelector("#formError"),
  count: document.querySelector("#conditionCount"),
  miniList: document.querySelector("#miniConditionList"),
  mapStatus: document.querySelector("#mapStatus"),
  bodyCaptions: [...document.querySelectorAll(".body-caption")],
  bodyKeySwatch: document.querySelector("#bodyKeySwatch"),
  bodyKeyText: document.querySelector("#bodyKeyText"),
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
  isDemo: false,
};

function readScene() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
    const visibleIds = Array.isArray(stored.visibleIds) ? [...new Set(stored.visibleIds)].filter((id) => CONDITIONS[id]) : [];
    const declaredIds = Array.isArray(stored.declaredIds)
      ? [...new Set(stored.declaredIds)].filter((id) => CONDITIONS[id])
      : visibleIds;
    const activeId = visibleIds.includes(stored.activeId) ? stored.activeId : (visibleIds[0] ?? "");
    const measurements = Array.isArray(stored.measurements)
      ? stored.measurements.filter((item) => item && typeof item === "object" && typeof item.key === "string").slice(0, 1_000)
      : [];
    return {
      declaredIds,
      visibleIds,
      activeId,
      measurements,
      observedAt: typeof stored.observedAt === "string" ? stored.observedAt : "",
      source: typeof stored.source === "string" && stored.source ? stored.source.slice(0, 240) : "직접 입력",
      isDemo: stored.isDemo === true,
      note: typeof stored.note === "string" ? stored.note.slice(0, 4_000) : "",
    };
  } catch {
    return null;
  }
}

const restoredScene = readScene();
if (restoredScene) {
  Object.assign(state, restoredScene);
  elements.note.value = restoredScene.note || measurementNote(restoredScene.measurements);
  elements.demoMode.hidden = !state.isDemo;
  for (const chip of elements.chips) chip.setAttribute("aria-pressed", String(state.declaredIds.includes(chip.dataset.condition)));
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

function renderSummary() {
  const conditions = state.visibleIds.map((id) => CONDITIONS[id]);
  elements.count.textContent = `${conditions.length}개`;
  elements.miniList.replaceChildren(
    ...conditions.map((condition) => {
      const badge = document.createElement("span");
      badge.textContent = condition.label;
      return badge;
    }),
  );
  elements.graphPreviewCount.textContent = conditions.length + "개";
  const hasJourneyData = conditions.length > 0 || state.measurements.length > 0;
  elements.saveJourney.disabled = state.isDemo || !hasJourneyData;
  const saveLabel = elements.saveJourney.querySelector("span");
  const saveNote = elements.saveJourney.querySelector("small");
  if (state.isDemo) {
    saveLabel.textContent = "예시 데이터는 Journey에 저장되지 않아요";
    saveNote.textContent = "데모 모드";
  } else if (!elements.saveJourney.classList.contains("is-saved")) {
    saveLabel.textContent = "현재 지도를 Journey에 저장";
    saveNote.textContent = "브라우저 로컬 기록";
  }
}

function persistScene() {
  try {
    sessionStorage.setItem(sessionKey, JSON.stringify({
      declaredIds: state.declaredIds,
      visibleIds: state.visibleIds,
      activeId: state.activeId,
      measurements: state.measurements,
      observedAt: state.observedAt,
      source: state.source,
      isDemo: state.isDemo,
      note: elements.note.value,
    }));
  } catch {
    // The map remains usable when session storage is unavailable.
  }
}

function leaveDemoMode({ clearResults = false } = {}) {
  if (!state.isDemo) return;
  state.isDemo = false;
  elements.demoMode.hidden = true;
  state.source = "직접 입력";
  if (clearResults) {
    state.visibleIds = [];
    state.activeId = "";
    state.measurements = [];
    state.observedAt = "";
  }
  renderAll();
  persistScene();
}

function measurementNote(measurements) {
  return measurements.map(({ label, value, unit }) => `${label} ${value}${unit ? ` ${unit}` : ""}`).join(", ");
}

function displayText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  return value.label ?? value.name ?? value.display ?? value.organizationName ?? "";
}

function provenanceLabel(provenance) {
  const source = [
    provenance?.sourceLabel,
    provenance?.organization,
    provenance?.source,
    provenance?.author,
    provenance?.format,
  ].map(displayText).find(Boolean);
  return `${source || "VitaGraph 환자 전달 파일"} · 서명되지 않은 사본`;
}

function formatObservedAt(value) {
  if (!value) return "기준 시점 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat("ko-KR", isDateOnly
    ? { dateStyle: "medium", timeZone: "UTC" }
    : { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function importedConditionLabels(imported) {
  const labels = (imported.conditions ?? []).map((condition) => {
    if (typeof condition === "string") return condition;
    const label = condition?.sourceLabel ?? condition?.label ?? condition?.display ?? CONDITIONS[condition?.id]?.label ?? "";
    return condition?.recordedAt ? `${label} · ${String(condition.recordedAt).slice(0, 10)}` : label;
  }).filter(Boolean);
  if (labels.length > 0) return labels;
  return (imported.conditionIds ?? []).map((id) => CONDITIONS[id]?.label ?? id).filter(Boolean);
}

function previewRow(label, value) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  row.append(term, description);
  return row;
}

function renderImportPreview({ file, imported }) {
  const conditionLabels = importedConditionLabels(imported);
  const measurementLabels = (imported.measurements ?? []).map(({ label, value, unit, observedAt }) => {
    const date = observedAt ? ` · ${String(observedAt).slice(0, 10)}` : "";
    return `${label} ${value}${unit ? ` ${unit}` : ""}${date}`;
  });
  const linkedCount = state.declaredIds.length + state.measurements.length;
  const heading = document.createElement("strong");
  heading.className = "import-result__title";
  heading.textContent = `${linkedCount}개 건강 항목을 연결했습니다.`;
  const details = document.createElement("dl");
  details.className = "import-preview";
  details.append(
    previewRow("파일", file.name),
    previewRow("형식", "VitaGraph 환자 전달 JSON v1"),
    previewRow("출처", provenanceLabel(imported.provenance)),
    previewRow("전달 확인 코드", imported.provenance.transferCode),
    ...(imported.provenance?.exportedAt
      ? [previewRow("내보낸 시각", formatObservedAt(imported.provenance.exportedAt))]
      : []),
    previewRow("기준 시점", formatObservedAt(imported.observedAt)),
    previewRow("질환·신호", conditionLabels.join(" · ") || "연결된 항목 없음"),
    previewRow("측정값", measurementLabels.join(" · ") || "포함된 측정값 없음"),
  );
  if (Number.isFinite(imported.provenance?.supported) || Number.isFinite(imported.provenance?.unsupported)) {
    details.append(previewRow(
      "처리 범위",
      `${imported.provenance?.supported ?? 0}개 지원 · ${imported.provenance?.unsupported ?? 0}개 지원 범위 밖`,
    ));
  }
  const note = document.createElement("p");
  note.className = "import-result__note";
  note.textContent = "환자용으로 전달된 사본이며 원본 의료기록을 변경하지 않습니다. 확인 코드는 오전달 사고만 줄이며 환자 인증이나 전자서명이 아닙니다. 파일에는 전자서명이 없어 발행기관·값 변조를 검증하지 못합니다.";
  elements.fhirResult.className = "import-result is-success";
  elements.fhirResult.replaceChildren(heading, details, note);
}

async function importHealthRecord(file) {
  if (file.size > 2 * 1024 * 1024) throw new RangeError("2MB 이하의 JSON 기록 파일만 가져올 수 있습니다.");
  const payload = JSON.parse(await file.text());
  if (payload?.schema !== "vitagraph-patient-transfer") {
    throw new TypeError("VitaGraph 환자 전달 JSON v1 파일만 가져올 수 있습니다.");
  }
  return parsePatientTransferPackage(payload);
}

function renderBody() {
  const model = createBodyModel(state.visibleIds, state.activeId);
  const captionsByArea = new Map(elements.bodyCaptions.map((caption) => [caption.dataset.area, caption]));
  for (const hotspot of elements.hotspots) {
    hotspot.classList.remove("is-active", "is-current", ...toneClasses);
    const areaIds = model.areas[hotspot.dataset.area] ?? [];
    const caption = captionsByArea.get(hotspot.dataset.area);
    const captionStatus = caption?.querySelector(".body-caption__status");
    const captionTitle = caption?.querySelector(".body-caption__title")?.textContent ?? "이 신체 부위";
    caption?.classList.remove("is-active", "is-current", ...toneClasses);
    if (areaIds.length === 0) {
      hotspot.disabled = true;
      hotspot.setAttribute("aria-pressed", "false");
      hotspot.setAttribute("aria-label", `${captionTitle}: 현재 기록에 연결된 신호 없음`);
      hotspot.removeAttribute("title");
      if (captionStatus) captionStatus.textContent = "현재 기록에 없음";
      continue;
    }
    const first = CONDITIONS[areaIds[0]];
    const labels = areaIds.map((id) => CONDITIONS[id].label);
    const isCurrent = areaIds.includes(state.activeId);
    hotspot.disabled = false;
    hotspot.classList.add("is-active", `tone-${first.tone}`);
    if (isCurrent) hotspot.classList.add("is-current");
    hotspot.setAttribute("aria-pressed", String(isCurrent));
    hotspot.setAttribute(
      "aria-label",
      `${captionTitle}: ${labels.join(", ")}. ${isCurrent ? "현재 선택됨. " : ""}이 영역의 질환 정보 보기`,
    );
    hotspot.title = labels.join(", ");
    caption?.classList.add("is-active", `tone-${first.tone}`);
    if (isCurrent) caption?.classList.add("is-current");
    if (captionStatus) captionStatus.textContent = `${isCurrent ? "선택됨 · " : ""}${labels.join(" · ")}`;
  }

  elements.mapStatus.textContent = model.statusText;
  elements.mapStatus.classList.toggle("is-ready", model.ready);
  elements.bodyKeySwatch.className = model.keyTone ? `key-swatch tone-${model.keyTone}` : "key-swatch";
  elements.bodyKeyText.textContent = model.keyText;
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
      "자동으로 확인 필요 신호를 찾지 못했습니다. 알고 있는 질환을 선택하거나 검사명을 더 구체적으로 적어 주세요.";
  }
  renderAll();
  persistScene();
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
    leaveDemoMode({ clearResults: true });
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
    persistScene();
  });
}

elements.note.addEventListener("input", () => leaveDemoMode({ clearResults: true }));

elements.loadDemo.addEventListener("click", () => {
  elements.note.value = demoNote;
  state.declaredIds = [];
  state.visibleIds = [];
  state.activeId = "";
  state.measurements = [];
  state.observedAt = "";
  state.source = "예시 데이터";
  state.isDemo = true;
  elements.demoMode.hidden = false;
  elements.fhirFile.value = "";
  elements.fhirResult.hidden = true;
  for (const chip of elements.chips) chip.setAttribute("aria-pressed", "false");
  elements.formError.hidden = true;
  analyze();
});

elements.resetButton.addEventListener("click", () => {
  elements.note.value = "";
  state.declaredIds = [];
  state.visibleIds = [];
  state.activeId = "";
  state.measurements = [];
  state.observedAt = "";
  state.source = "직접 입력";
  state.isDemo = false;
  elements.demoMode.hidden = true;
  elements.fhirFile.value = "";
  elements.fhirResult.hidden = true;
  for (const chip of elements.chips) chip.setAttribute("aria-pressed", "false");
  elements.formError.hidden = true;
  renderAll();
  try {
    sessionStorage.removeItem(sessionKey);
  } catch {
    // Reset still clears the current view when session storage is unavailable.
  }
});

elements.fhirFile.addEventListener("change", async () => {
  const [file] = elements.fhirFile.files;
  if (!file) return;
  elements.fhirResult.hidden = false;
  elements.fhirResult.className = "import-result is-loading";
  elements.fhirResult.textContent = "기록 구조를 확인하는 중…";
  try {
    const imported = await importHealthRecord(file);
    const transferCode = imported.provenance?.transferCode;
    if (!window.confirm(`전달 확인 코드\n${transferCode}\n\n의료기관에서 파일과 다른 경로로 안내받은 코드와 정확히 같습니까? 다르면 가져오지 마세요.`)) {
      elements.fhirResult.className = "import-result";
      elements.fhirResult.textContent = "전달 확인 코드 대조를 취소했습니다. 현재 지도와 Journey는 바뀌지 않았습니다.";
      return;
    }
    let journeyCount = 0;
    try {
      journeyCount = normalizeJourney(JSON.parse(localStorage.getItem(journeyKey) ?? "[]")).length;
    } catch {
      journeyCount = 0;
    }
    if (journeyCount > 0 && !window.confirm(
      `이 기기에 Journey ${journeyCount}건이 있습니다. 지금 파일이 같은 사람의 기록인지 직접 확인했습니까?\n\n다른 사람 기록이면 취소하고 Journey 화면에서 기존 기록을 백업·삭제하세요.`,
    )) {
      elements.fhirResult.className = "import-result";
      elements.fhirResult.textContent = "기존 Journey와의 대상자 대조를 취소했습니다. 저장된 기록은 바뀌지 않았습니다.";
      return;
    }
    const hasCurrentMap = !state.isDemo && (state.visibleIds.length > 0 || state.measurements.length > 0 || elements.note.value.trim());
    if (hasCurrentMap && !window.confirm("현재 저장 전 건강 지도를 이 파일 내용으로 교체할까요? Journey 기록은 자동 변경되지 않습니다.")) {
      elements.fhirResult.className = "import-result";
      elements.fhirResult.textContent = "현재 지도 교체를 취소했습니다.";
      return;
    }
    leaveDemoMode({ clearResults: true });
    state.declaredIds = (imported.conditionIds ?? []).filter((id) => CONDITIONS[id]);
    state.measurements = imported.measurements ?? [];
    state.observedAt = imported.observedAt;
    state.source = provenanceLabel(imported.provenance);
    for (const chip of elements.chips) chip.setAttribute("aria-pressed", String(state.declaredIds.includes(chip.dataset.condition)));
    elements.note.value = measurementNote(state.measurements);
    analyze();
    renderImportPreview({ file, imported });
  } catch (error) {
    elements.fhirResult.className = "import-result is-error";
    elements.fhirResult.textContent = error instanceof SyntaxError
      ? "JSON 형식을 읽을 수 없습니다. VitaGraph 환자 전달 JSON v1 파일인지 확인해 주세요."
      : error instanceof Error ? error.message : "기록 파일을 가져오지 못했습니다.";
  } finally {
    elements.fhirFile.value = "";
  }
});

elements.saveJourney.addEventListener("click", () => {
  if (state.isDemo) {
    elements.formError.hidden = false;
    elements.formError.textContent = "예시 데이터는 Journey에 저장되지 않습니다.";
    return;
  }
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

if (new URLSearchParams(window.location.search).get("sample") === "1") {
  elements.loadDemo.click();
}

renderAll();
