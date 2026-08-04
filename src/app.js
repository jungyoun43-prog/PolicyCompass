import { CONDITIONS, inferConditionIds } from "/data.js";
import { createJourneySnapshot, normalizeJourney } from "/journey-model.js";
import {
  createPatientOwnedJson,
  patientOwnedJsonFilename,
  readCareBridge,
  subscribeCareBridge,
} from "/care-bridge.js";
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
  careLinkStatus: document.querySelector("#careLinkStatus"),
  careLinkSummary: document.querySelector("#careLinkSummary"),
  careLinkDetails: document.querySelector("#careLinkDetails"),
  careConditionList: document.querySelector("#careConditionList"),
  careMeasurementList: document.querySelector("#careMeasurementList"),
  careMedicationList: document.querySelector("#careMedicationList"),
  refreshCareLink: document.querySelector("#refreshCareLink"),
  downloadClinicalJson: document.querySelector("#downloadClinicalJson"),
  saveJourney: document.querySelector("#saveJourney"),
};

const state = {
  declaredIds: [],
  patientVisibleIds: [],
  clinicalConditionIds: [],
  visibleIds: [],
  activeId: "",
  measurements: [],
  clinicalMeasurements: [],
  clinicalMedications: [],
  clinicalSnapshot: null,
  bridgeChannelId: "",
  observedAt: "",
  source: "직접 입력",
  isDemo: false,
};

function readScene() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
    const storedVisibleIds = Array.isArray(stored.visibleIds)
      ? [...new Set(stored.visibleIds)].filter((id) => CONDITIONS[id])
      : [];
    const declaredIds = Array.isArray(stored.declaredIds)
      ? [...new Set(stored.declaredIds)].filter((id) => CONDITIONS[id])
      : storedVisibleIds;
    const clinicalConditionIds = Array.isArray(stored.clinicalConditionIds)
      ? [...new Set(stored.clinicalConditionIds)].filter((id) => CONDITIONS[id])
      : [];
    const note = typeof stored.note === "string" ? stored.note.slice(0, 4_000) : "";
    const patientVisibleIds = Array.isArray(stored.patientVisibleIds)
      ? [...new Set(stored.patientVisibleIds)].filter((id) => CONDITIONS[id])
      : inferConditionIds(note, declaredIds);
    const visibleIds = [...new Set([...patientVisibleIds, ...clinicalConditionIds])];
    const activeId = visibleIds.includes(stored.activeId) ? stored.activeId : (visibleIds[0] ?? "");
    const measurements = Array.isArray(stored.measurements)
      ? stored.measurements.filter((item) => item && typeof item === "object" && typeof item.key === "string").slice(0, 1_000)
      : [];
    return {
      declaredIds,
      patientVisibleIds,
      clinicalConditionIds,
      visibleIds,
      activeId,
      measurements,
      observedAt: typeof stored.observedAt === "string" ? stored.observedAt : "",
      source: typeof stored.source === "string" && stored.source ? stored.source.slice(0, 240) : "직접 입력",
      isDemo: stored.isDemo === true,
      note,
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
    saveNote.textContent = "현재 탭에서만 유지";
  } else if (!elements.saveJourney.classList.contains("is-saved")) {
    saveLabel.textContent = "현재 지도를 Journey에 저장";
    saveNote.textContent = "브라우저 로컬 기록";
  }
}

function persistScene() {
  try {
    sessionStorage.setItem(sessionKey, JSON.stringify({
      declaredIds: state.declaredIds,
      patientVisibleIds: state.patientVisibleIds,
      clinicalConditionIds: state.clinicalConditionIds,
      visibleIds: state.visibleIds,
      activeId: state.activeId,
      measurements: state.isDemo ? state.measurements : [],
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
  state.source = state.clinicalSnapshot ? "EMR 서명·확정 후 정제된 환자용 사본" : "직접 입력";
  if (clearResults) {
    state.patientVisibleIds = inferConditionIds(elements.note.value.trim(), state.declaredIds);
    state.visibleIds = [...new Set([...state.patientVisibleIds, ...state.clinicalConditionIds])];
    state.activeId = "";
    state.measurements = state.clinicalMeasurements;
    state.observedAt = state.clinicalSnapshot?.preparedAt ?? "";
  }
  setClinicalChipState();
  renderAll();
  persistScene();
}

function measurementNote(measurements) {
  return measurements.map(({ label, value, unit }) => `${label} ${value}${unit ? ` ${unit}` : ""}`).join(", ");
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

function linkedItemCount(snapshot) {
  return (snapshot?.healthMap?.conditions?.length ?? 0)
    + (snapshot?.healthMap?.measurements?.length ?? 0)
    + (snapshot?.medications?.length ?? 0);
}

function connectedClinicalSnapshot(snapshot) {
  return linkedItemCount(snapshot) > 0 ? snapshot : null;
}

function setClinicalChipState() {
  for (const chip of elements.chips) {
    const clinical = state.clinicalConditionIds.includes(chip.dataset.condition);
    const selected = clinical || state.declaredIds.includes(chip.dataset.condition);
    chip.setAttribute("aria-pressed", String(selected));
    chip.classList.toggle("is-clinical", clinical);
    if (clinical) {
      chip.title = "EMR에서 연결된 서명·확정 기록";
      chip.setAttribute("aria-label", `${chip.textContent.trim()}, EMR 서명·확정 기록에서 연결됨`);
    } else {
      chip.removeAttribute("title");
      chip.removeAttribute("aria-label");
    }
  }
}

function renderCareLink() {
  const snapshot = state.clinicalSnapshot;
  const count = linkedItemCount(snapshot);
  elements.downloadClinicalJson.disabled = !snapshot;
  elements.careLinkStatus.dataset.state = snapshot ? "connected" : "empty";
  elements.careLinkStatus.textContent = snapshot
    ? `EMR에서 ${count}개 정제 항목을 연결했습니다. 마지막 연결 ${formatObservedAt(snapshot.preparedAt)}`
    : "아직 연결된 서명·확정 기록이 없습니다. 의료진이 진료를 서명하거나 과거 기록을 확인한 뒤 다시 확인하세요.";
  if (!snapshot) {
    elements.careLinkSummary.replaceChildren();
    elements.careLinkSummary.hidden = true;
    elements.careLinkDetails.hidden = true;
    elements.careConditionList.replaceChildren();
    elements.careMeasurementList.replaceChildren();
    elements.careMedicationList.replaceChildren();
    return;
  }
  const values = [
    ["확정 질환", snapshot.healthMap.conditions.length],
    ["최종 측정", snapshot.healthMap.measurements.length],
    ["서명 처방", snapshot.medications.length],
  ];
  elements.careLinkSummary.hidden = false;
  elements.careLinkSummary.replaceChildren(...values.map(([label, value]) => {
    const item = document.createElement("span");
    item.textContent = `${label} ${value}개`;
    return item;
  }));
  elements.careLinkDetails.hidden = false;
  const replaceLinkedItems = (target, items, format) => {
    target.replaceChildren(...(items.length ? items : [null]).map((item) => {
      const row = document.createElement("li");
      if (!item) {
        row.className = "is-empty";
        row.textContent = "연결된 항목 없음";
        return row;
      }
      const primary = document.createElement("strong");
      const secondary = document.createElement("span");
      const value = format(item);
      primary.textContent = value.primary;
      secondary.textContent = value.secondary;
      row.append(primary, secondary);
      return row;
    }));
  };
  replaceLinkedItems(
    elements.careConditionList,
    snapshot.healthMap.conditions,
    ({ label, recordedOn }) => ({
      primary: label,
      secondary: `의료진 확정 · ${recordedOn}`,
    }),
  );
  replaceLinkedItems(
    elements.careMeasurementList,
    snapshot.healthMap.measurements,
    ({ label, value, unit, observedOn }) => ({
      primary: `${label} ${value}${unit ? ` ${unit}` : ""}`,
      secondary: `최종 측정 · ${observedOn}`,
    }),
  );
  replaceLinkedItems(
    elements.careMedicationList,
    snapshot.medications,
    ({ label, dose, doseUnit, frequency, prescribedOn }) => ({
      primary: label,
      secondary: `${dose}${doseUnit} · ${frequency} · ${prescribedOn}`,
    }),
  );
}

function applyCareBridge(bridge = readCareBridge()) {
  const snapshot = connectedClinicalSnapshot(bridge?.clinical?.snapshot);
  state.bridgeChannelId = bridge?.channelId ?? "";
  state.clinicalSnapshot = snapshot;
  state.clinicalConditionIds = (snapshot?.healthMap?.conditions ?? [])
    .map(({ id }) => id)
    .filter((id) => CONDITIONS[id]);
  state.clinicalMeasurements = snapshot?.healthMap?.measurements ?? [];
  state.clinicalMedications = snapshot?.medications ?? [];
  if (!state.isDemo) {
    state.measurements = state.clinicalMeasurements;
    state.observedAt = snapshot?.preparedAt ?? "";
    state.source = snapshot ? "EMR 서명·확정 후 정제된 환자용 사본" : "직접 입력";
    state.patientVisibleIds = inferConditionIds(elements.note.value.trim(), state.declaredIds);
    state.visibleIds = [...new Set([...state.patientVisibleIds, ...state.clinicalConditionIds])];
    state.activeId = normalizeActiveId(state.visibleIds, state.activeId);
  }
  setClinicalChipState();
  renderCareLink();
  renderAll();
  persistScene();
}

function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob(
    [`${JSON.stringify(value, null, 2)}\n`],
    { type: "application/json;charset=utf-8" },
  ));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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

function clearFormError() {
  elements.note.setAttribute("aria-invalid", "false");
  elements.formError.hidden = true;
}

function showFormError(message, { focusNote = false } = {}) {
  elements.note.setAttribute("aria-invalid", "true");
  elements.formError.textContent = message;
  elements.formError.hidden = false;
  if (focusNote) elements.note.focus({ preventScroll: true });
}

function analyze() {
  const note = elements.note.value.trim();
  state.patientVisibleIds = inferConditionIds(note, state.declaredIds);
  state.visibleIds = state.isDemo
    ? [...state.patientVisibleIds]
    : [...new Set([...state.patientVisibleIds, ...state.clinicalConditionIds])];
  state.activeId = normalizeActiveId(state.visibleIds, state.activeId);
  if (state.visibleIds.length > 0) clearFormError();
  if (state.visibleIds.length === 0) {
    showFormError(
      "자동으로 확인 필요 신호를 찾지 못했습니다. 알고 있는 질환을 선택하거나 검사명을 더 구체적으로 적어 주세요.",
      { focusNote: true },
    );
  }
  renderAll();
  persistScene();
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const hasInput = elements.note.value.trim().length > 0
    || state.declaredIds.length > 0
    || state.clinicalConditionIds.length > 0
    || state.clinicalMeasurements.length > 0;
  if (!hasInput) {
    showFormError("증상이나 수치를 입력하거나 질환을 하나 이상 선택해 주세요.", { focusNote: true });
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
    const selected = state.declaredIds.includes(id);
    state.declaredIds = selected
      ? state.declaredIds.filter((item) => item !== id)
      : [...state.declaredIds, id];
    setClinicalChipState();
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

elements.note.addEventListener("input", () => {
  clearFormError();
  leaveDemoMode({ clearResults: true });
});

elements.loadDemo.addEventListener("click", () => {
  elements.note.value = demoNote;
  state.declaredIds = [];
  state.patientVisibleIds = [];
  state.visibleIds = [];
  state.activeId = "";
  state.measurements = [];
  state.observedAt = "";
  state.source = "예시 데이터";
  state.isDemo = true;
  elements.demoMode.hidden = false;
  for (const chip of elements.chips) chip.setAttribute("aria-pressed", "false");
  clearFormError();
  analyze();
});

elements.resetButton.addEventListener("click", () => {
  elements.note.value = "";
  state.declaredIds = [];
  state.patientVisibleIds = [];
  state.visibleIds = [...state.clinicalConditionIds];
  state.activeId = "";
  state.measurements = state.clinicalMeasurements;
  state.observedAt = state.clinicalSnapshot?.preparedAt ?? "";
  state.source = state.clinicalSnapshot ? "EMR 서명·확정 후 정제된 환자용 사본" : "직접 입력";
  state.isDemo = false;
  elements.demoMode.hidden = true;
  setClinicalChipState();
  clearFormError();
  renderAll();
  try {
    persistScene();
  } catch {
    // Reset still clears the current view when session storage is unavailable.
  }
});

elements.refreshCareLink.addEventListener("click", () => {
  applyCareBridge();
  elements.refreshCareLink.textContent = "최신 연결 확인됨";
  window.setTimeout(() => {
    elements.refreshCareLink.textContent = "연결 기록 다시 확인";
  }, 1_500);
});

elements.downloadClinicalJson.addEventListener("click", () => {
  if (!state.clinicalSnapshot) return;
  const exportedAt = new Date();
  downloadJson(
    createPatientOwnedJson(state.clinicalSnapshot, exportedAt),
    patientOwnedJsonFilename(exportedAt),
  );
  elements.careLinkStatus.textContent = "정제 기록 JSON을 내보냈습니다. 이 파일은 환자 본인이 선택해 보관하는 사본입니다.";
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

applyCareBridge();
subscribeCareBridge((bridge) => applyCareBridge(bridge));
