import { CONDITIONS, extractInputSignals } from "./data.js";
import { createJourneySnapshot, normalizeJourney } from "./journey-model.js";
import {
  parsePatientTransferPackage,
  PatientTransferCodeError,
  verifyPatientTransferCode,
} from "./patient-transfer.js";
import {
  retireLegacyCareBridge,
} from "./care-bridge.js";
import {
  createBodyModel,
  createDetailModel,
  normalizeActiveId,
  selectBodyArea,
} from "./view-model.js";

const toneClasses = ["tone-coral", "tone-cyan", "tone-lime", "tone-violet", "tone-amber"];
const sessionKey = "policycompass-scene";
const journeyKey = "policycompass-journey";
const demoNote = "혈압 148/94, 공복혈당 132, LDL 156, 속쓰림, 편두통";
const demoConditionIds = ["hypertension", "diabetes", "dyslipidemia", "reflux", "migraine"];
const forcedSampleMode = new URLSearchParams(window.location.search).get("sample") === "1";
const transferCodePattern = /^VG-[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}-[0-9A-HJKMNP-TV-Z]{6}$/;
const restoredTransferCode = "VG-00000-00000-00000-00000-000000";

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
  importBox: document.querySelector("#import-record"),
  fhirFile: document.querySelector("#fhirFile"),
  transferCode: document.querySelector("#transferCode"),
  selectRecordFile: document.querySelector("#selectRecordFile"),
  importRecordButton: document.querySelector("#importRecordButton"),
  recordFileStatus: document.querySelector("#recordFileStatus"),
  fhirResult: document.querySelector("#fhirResult"),
  saveJourney: document.querySelector("#saveJourney"),
};

function revealImportFromHash() {
  if (window.location.hash === "#import-record" && elements.importBox) {
    elements.importBox.open = true;
  }
}

revealImportFromHash();
window.addEventListener("hashchange", revealImportFromHash);
for (const link of document.querySelectorAll('a[href$="#import-record"]')) {
  link.addEventListener("click", () => {
    if (elements.importBox) elements.importBox.open = true;
  });
}

const state = {
  declaredIds: [],
  patientVisibleIds: [],
  clinicalConditionIds: [],
  clinicalConditions: [],
  signals: [],
  visibleIds: [],
  activeId: "",
  measurements: [],
  clinicalMeasurements: [],
  transfer: null,
  observedAt: "",
  source: "직접 입력",
  isDemo: false,
};
let pendingTransferFile = null;
let importInProgress = false;
const sampleAwareLinks = [...document.querySelectorAll('a[href^="/map"], a[href^="/connections"], a[href^="/insights"]')];
const journeyLinks = [...document.querySelectorAll('a[href^="/journey"]')];
for (const link of [...sampleAwareLinks, ...journeyLinks]) link.dataset.personalBaseHref = link.getAttribute("href") ?? "";

function syncDemoNavigation() {
  const demo = state.isDemo || forcedSampleMode;
  for (const link of sampleAwareLinks) {
    const base = link.dataset.personalBaseHref;
    if (!base) continue;
    const url = new URL(base, window.location.origin);
    if (demo) url.searchParams.set("sample", "1");
    else url.searchParams.delete("sample");
    link.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
  }
  for (const link of journeyLinks) {
    link.setAttribute("aria-disabled", String(demo));
    link.classList.toggle("is-disabled", demo);
  }
}

for (const link of journeyLinks) {
  link.addEventListener("click", (event) => {
    if (!state.isDemo && !forcedSampleMode) return;
    event.preventDefault();
    showFormError("예시 데이터는 Journey를 열거나 저장하지 않습니다. 개인 기록을 보려면 예시 모드를 종료하세요.");
  });
}

function conditionIds(value) {
  return Array.isArray(value)
    ? [...new Set(value)].filter((id) => CONDITIONS[id])
    : [];
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  const allowed = new Set(keys);
  return actual.length === allowed.size && actual.every((key) => allowed.has(key));
}

function persistedTransfer(value) {
  if (!hasExactKeys(value, ["schema", "version", "exportedAt", "trust"])
    || value.schema !== "policycompass-patient-transfer"
    || value.version !== 1
    || value.trust !== "unsigned-local-export"
    || typeof value.exportedAt !== "string"
    || Number.isNaN(new Date(value.exportedAt).valueOf())
    || new Date(value.exportedAt).toISOString() !== value.exportedAt
    || new Date(value.exportedAt).valueOf() > Date.now() + 5 * 60 * 1_000) return null;
  return {
    schema: "policycompass-patient-transfer",
    version: 1,
    exportedAt: new Date(value.exportedAt).toISOString(),
    trust: "unsigned-local-export",
  };
}

function restoredImportedTransfer(stored) {
  const transfer = persistedTransfer(stored?.transfer);
  if (!transfer) return null;
  const ids = Array.isArray(stored.clinicalConditionIds) ? stored.clinicalConditionIds : null;
  const conditions = Array.isArray(stored.clinicalConditions) ? stored.clinicalConditions : null;
  const measurements = Array.isArray(stored.clinicalMeasurements) ? stored.clinicalMeasurements : null;
  if (!ids || !conditions || !measurements
    || conditions.length + measurements.length === 0
    || conditions.length + measurements.length > 1_000
    || ids.length !== conditions.length
    || new Set(ids).size !== ids.length
    || conditions.some((item) => !hasExactKeys(item, ["id", "label", "recordedOn", "basis", "provenanceKind"])
      || item.basis !== "confirmed-condition"
      || item.provenanceKind !== "clinician-confirmed-unsigned-import")
    || measurements.some((item) => !hasExactKeys(item, ["key", "code", "label", "value", "unit", "observedAt", "basis", "provenanceKind"])
      || item.basis !== "final-observation"
      || item.provenanceKind !== "clinician-final-unsigned-import")) return null;
  try {
    const imported = parsePatientTransferPackage({
      schema: transfer.schema,
      version: transfer.version,
      exportedAt: transfer.exportedAt,
      transferCode: restoredTransferCode,
      scope: "patient-policy-compass",
      trust: transfer.trust,
      healthMap: {
        conditions: conditions.map(({ id, label, recordedOn, basis }) => ({ id, label, recordedOn, basis })),
        measurements: measurements.map(({ key, code, label, value, unit, observedAt, basis }) => ({
          key,
          code,
          label,
          value,
          unit,
          observedOn: observedAt,
          basis,
        })),
      },
      summary: {
        includedConditions: conditions.length,
        includedMeasurements: measurements.length,
      },
    });
    if (ids.some((id, index) => id !== imported.conditionIds[index])) return null;
    return {
      transfer,
      clinicalConditions: imported.conditions.map(({ id, recordedAt }) => ({
        id,
        label: CONDITIONS[id].label,
        recordedOn: recordedAt,
        basis: "confirmed-condition",
        provenanceKind: "clinician-confirmed-unsigned-import",
      })),
      clinicalMeasurements: imported.measurements.map((item) => ({
        ...item,
        basis: "final-observation",
        provenanceKind: "clinician-final-unsigned-import",
      })),
      observedAt: imported.observedAt,
    };
  } catch {
    return null;
  }
}

function readScene() {
  if (forcedSampleMode) return null;
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
    const declaredIds = conditionIds(stored.declaredIds);
    const restoredTransfer = restoredImportedTransfer(stored);
    const transfer = restoredTransfer?.transfer ?? null;
    const clinicalConditions = restoredTransfer?.clinicalConditions ?? [];
    const normalizedClinicalIds = clinicalConditions.map(({ id }) => id);
    const note = typeof stored.note === "string" ? stored.note.slice(0, 4_000) : "";
    // Legacy patientVisibleIds/visibleIds included free-text threshold inference.
    // Rebuild non-clinical conditions only from explicit patient selections.
    const patientVisibleIds = [...declaredIds];
    const visibleIds = [...new Set([...patientVisibleIds, ...normalizedClinicalIds])];
    const activeId = visibleIds.includes(stored.activeId) ? stored.activeId : (visibleIds[0] ?? "");
    const clinicalMeasurements = restoredTransfer?.clinicalMeasurements ?? [];
    return {
      declaredIds,
      patientVisibleIds,
      clinicalConditionIds: normalizedClinicalIds,
      clinicalConditions,
      signals: extractInputSignals(note),
      visibleIds,
      activeId,
      measurements: clinicalMeasurements,
      clinicalMeasurements,
      transfer,
      observedAt: restoredTransfer?.observedAt ?? "",
      source: transfer
        ? "환자 전달 파일 · 파일에 의료진 확정으로 표시 · 발행기관·변조 미검증"
        : "직접 입력",
      isDemo: false,
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
  const signalBadges = state.signals.map((signal) => {
    const badge = document.createElement("span");
    badge.textContent = `${signal.label} · 패턴 신호 · 진단 아님`;
    return badge;
  });
  elements.count.textContent = `${conditions.length + state.signals.length}개`;
  elements.count.setAttribute(
    "aria-label",
    `선택·가져오기 질환 항목 ${conditions.length}개 · 입력 확인 신호 ${state.signals.length}개`,
  );
  elements.miniList.replaceChildren(
    ...conditions.map((condition, index) => {
      const badge = document.createElement("span");
      const id = state.visibleIds[index];
      if (state.isDemo || forcedSampleMode) {
        badge.textContent = `${condition.label} · 합성 예시 · 실제 기록 아님`;
      } else if (state.clinicalConditionIds.includes(id)) {
        badge.textContent = `${condition.label} · 파일에 의료진 확정으로 표시 · 발행기관·변조 미검증`;
      } else {
        badge.textContent = `${condition.label} · 본인 선택 · 의료진 확정 진단 아님`;
      }
      return badge;
    }),
    ...signalBadges,
  );
  elements.graphPreviewCount.textContent = conditions.length + "개";
  const hasJourneyData = conditions.length > 0 || state.measurements.length > 0 || state.signals.length > 0;
  elements.saveJourney.disabled = state.isDemo || forcedSampleMode || !hasJourneyData;
  const saveLabel = elements.saveJourney.querySelector("span");
  const saveNote = elements.saveJourney.querySelector("small");
  if (state.isDemo) {
    saveLabel.textContent = "예시 데이터는 Journey에 저장되지 않아요";
    saveNote.textContent = "현재 탭에서만 유지";
  } else if (!elements.saveJourney.classList.contains("is-saved")) {
    saveLabel.textContent = "현재 지도를 Journey에 저장";
    saveNote.textContent = "브라우저 로컬 기록";
  }
  syncDemoNavigation();
}

function persistScene() {
  if (state.isDemo || forcedSampleMode) return;
  try {
    sessionStorage.setItem(sessionKey, JSON.stringify({
      declaredIds: state.declaredIds,
      patientVisibleIds: state.patientVisibleIds,
      clinicalConditionIds: state.clinicalConditionIds,
      clinicalConditions: state.clinicalConditions,
      signals: state.signals,
      visibleIds: state.visibleIds,
      activeId: state.activeId,
      measurements: state.measurements,
      clinicalMeasurements: state.clinicalMeasurements,
      transfer: state.transfer,
      observedAt: state.observedAt,
      source: state.source,
      isDemo: false,
      note: elements.note.value,
    }));
  } catch {
    // The map remains usable when session storage is unavailable.
  }
}

function leaveDemoMode({ clearResults = false } = {}) {
  if (!state.isDemo) return;
  if (forcedSampleMode) return;
  state.isDemo = false;
  elements.demoMode.hidden = true;
  state.source = "직접 입력";
  if (clearResults) {
    state.patientVisibleIds = [...state.declaredIds];
    state.signals = extractInputSignals(elements.note.value.trim());
    state.visibleIds = [...state.patientVisibleIds];
    state.activeId = "";
    state.measurements = [];
    state.observedAt = "";
  }
  setClinicalChipState();
  syncImportControls();
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

function setClinicalChipState() {
  for (const chip of elements.chips) {
    const clinical = state.clinicalConditionIds.includes(chip.dataset.condition);
    const selected = clinical || state.declaredIds.includes(chip.dataset.condition);
    chip.setAttribute("aria-pressed", String(selected));
    chip.classList.toggle("is-clinical", clinical);
    if (clinical) {
      chip.title = "파일에 의료진 확정으로 표시 · 발행기관·변조 미검증";
      chip.setAttribute("aria-label", `${chip.textContent.trim()}, 파일에 의료진 확정으로 표시되었으나 발행기관과 변조는 검증되지 않음`);
    } else {
      chip.removeAttribute("title");
      chip.removeAttribute("aria-label");
    }
  }
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
  return `${source || "PolicyCompass 환자 전달 파일"} · 파일에 의료진 확정으로 표시 · 발행기관·변조 미검증`;
}

function importedConditionLabels(imported) {
  const labels = (imported.conditions ?? []).map((condition) => {
    const label = condition?.sourceLabel ?? CONDITIONS[condition?.id]?.label ?? "";
    return condition?.recordedAt ? `${label} · ${String(condition.recordedAt).slice(0, 10)}` : label;
  }).filter(Boolean);
  return labels.length > 0
    ? labels
    : (imported.conditionIds ?? []).map((id) => CONDITIONS[id]?.label ?? id).filter(Boolean);
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

function normalizedTransferCode() {
  return elements.transferCode?.value.trim().toUpperCase() ?? "";
}

function hasValidTransferCodeShape() {
  return transferCodePattern.test(normalizedTransferCode());
}

function setImportResult(message, resultState = "", role = "status") {
  if (!elements.fhirResult) return;
  elements.fhirResult.hidden = false;
  elements.fhirResult.className = `import-result${resultState ? ` is-${resultState}` : ""}`;
  elements.fhirResult.setAttribute("role", role);
  elements.fhirResult.textContent = message;
}

function syncImportControls() {
  if (!elements.transferCode || !elements.selectRecordFile || !elements.importRecordButton || !elements.recordFileStatus) return;
  const blocked = state.isDemo || forcedSampleMode || importInProgress;
  const codeReady = hasValidTransferCodeShape();
  elements.transferCode.disabled = blocked;
  elements.selectRecordFile.disabled = blocked;
  elements.importRecordButton.disabled = blocked || !codeReady || !pendingTransferFile;
  if (blocked) {
    elements.recordFileStatus.textContent = importInProgress
      ? "기록 구조와 확인 코드를 검사하는 중입니다."
      : "예시 모드에서는 실제 환자 전달 파일을 가져올 수 없습니다. 예시를 종료한 뒤 다시 시도하세요.";
  } else if (pendingTransferFile) {
    elements.recordFileStatus.textContent = `선택한 파일: ${pendingTransferFile.name}. 확인하고 가져오기를 누르기 전에는 지도가 바뀌지 않습니다.`;
  } else if (codeReady) {
    elements.recordFileStatus.textContent = "확인 코드 형식을 확인했습니다. 이제 기록 파일을 선택하세요.";
  } else {
    elements.recordFileStatus.textContent = "파일과 별도 경로로 전달받은 확인 코드를 준비하세요.";
  }
}

function clearTransferCodeError() {
  if (!elements.transferCode || !elements.fhirResult) return;
  elements.transferCode.setAttribute("aria-invalid", "false");
  if (elements.fhirResult.dataset.errorField === "transferCode") {
    elements.fhirResult.hidden = true;
    delete elements.fhirResult.dataset.errorField;
  }
}

function showTransferCodeError(message) {
  if (!elements.transferCode || !elements.fhirResult) return;
  elements.transferCode.setAttribute("aria-invalid", "true");
  elements.fhirResult.dataset.errorField = "transferCode";
  setImportResult(message, "error", "alert");
  elements.transferCode.focus({ preventScroll: true });
}

function resetImportFlow({ clearCode = false, hideResult = true } = {}) {
  pendingTransferFile = null;
  if (elements.fhirFile) elements.fhirFile.value = "";
  if (clearCode && elements.transferCode) elements.transferCode.value = "";
  elements.transferCode?.setAttribute("aria-invalid", "false");
  if (elements.fhirResult) {
    delete elements.fhirResult.dataset.errorField;
    if (hideResult) elements.fhirResult.hidden = true;
  }
  syncImportControls();
}

function renderImportPreview({ file, imported }) {
  if (!elements.fhirResult) return;
  const conditionLabels = importedConditionLabels(imported);
  const measurementLabels = (imported.measurements ?? []).map(({ label, value, unit, observedAt }) => {
    const date = observedAt ? ` · ${String(observedAt).slice(0, 10)}` : "";
    return `${label} ${value}${unit ? ` ${unit}` : ""}${date}`;
  });
  const linkedCount = state.clinicalConditionIds.length + state.clinicalMeasurements.length;
  const heading = document.createElement("strong");
  heading.className = "import-result__title";
  heading.textContent = `${linkedCount}개 건강 항목으로 현재 지도를 교체했습니다.`;
  const details = document.createElement("dl");
  details.className = "import-preview";
  details.append(
    previewRow("파일", file.name),
    previewRow("형식", "PolicyCompass 환자 전달 JSON v1"),
    previewRow("출처", provenanceLabel(imported.provenance)),
    previewRow("내보낸 시각", formatObservedAt(imported.provenance.exportedAt)),
    previewRow("기준 시점", formatObservedAt(imported.observedAt)),
    previewRow("파일에 확정으로 표시된 질환", conditionLabels.join(" · ") || "포함된 항목 없음"),
    previewRow("최종 측정", measurementLabels.join(" · ") || "포함된 측정값 없음"),
  );
  const note = document.createElement("p");
  note.className = "import-result__note";
  note.textContent = "현재 저장 전 지도만 교체했습니다. Journey는 자동 변경되지 않습니다. 이 파일은 암호화·전자서명되지 않아 발행기관과 값 변조를 검증할 수 없습니다.";
  const mapLink = document.createElement("a");
  mapLink.className = "primary-button import-result__action";
  mapLink.href = "#health-map";
  mapLink.textContent = "건강 지도 보기";
  elements.fhirResult.hidden = false;
  elements.fhirResult.className = "import-result is-success";
  elements.fhirResult.setAttribute("role", "status");
  delete elements.fhirResult.dataset.errorField;
  elements.fhirResult.replaceChildren(heading, details, note, mapLink);
}

async function importHealthRecord(file) {
  if (file.size > 2 * 1024 * 1024) throw new RangeError("2MB 이하의 JSON 기록 파일만 가져올 수 있습니다.");
  const payload = JSON.parse(await file.text());
  if (payload?.schema !== "policycompass-patient-transfer") {
    throw new TypeError("PolicyCompass 환자 전달 JSON v1 파일만 가져올 수 있습니다.");
  }
  return parsePatientTransferPackage(payload);
}

function replaceMapWithImportedTransfer(imported) {
  const clinicalConditions = (imported.conditions ?? []).map(({ id, recordedAt }) => ({
    id,
    label: CONDITIONS[id].label,
    recordedOn: recordedAt,
    basis: "confirmed-condition",
    provenanceKind: "clinician-confirmed-unsigned-import",
  }));
  state.declaredIds = [];
  state.patientVisibleIds = [];
  state.clinicalConditionIds = clinicalConditions.map(({ id }) => id);
  state.clinicalConditions = clinicalConditions;
  state.signals = [];
  state.visibleIds = [...state.clinicalConditionIds];
  state.activeId = state.visibleIds[0] ?? "";
  state.clinicalMeasurements = (imported.measurements ?? []).map((measurement) => ({
    ...measurement,
    basis: "final-observation",
    provenanceKind: "clinician-final-unsigned-import",
  }));
  state.measurements = [...state.clinicalMeasurements];
  state.transfer = {
    schema: "policycompass-patient-transfer",
    version: 1,
    exportedAt: imported.provenance.exportedAt,
    trust: "unsigned-local-export",
  };
  state.observedAt = imported.observedAt;
  state.source = "환자 전달 파일 · 파일에 의료진 확정으로 표시 · 발행기관·변조 미검증";
  state.isDemo = false;
  elements.note.value = "";
  elements.demoMode.hidden = true;
  setClinicalChipState();
  clearFormError();
  renderAll();
  persistScene();
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
  state.patientVisibleIds = state.isDemo
    ? [...demoConditionIds]
    : [...state.declaredIds];
  state.signals = state.isDemo ? [] : extractInputSignals(note);
  state.visibleIds = state.isDemo
    ? [...state.patientVisibleIds]
    : [...new Set([...state.patientVisibleIds, ...state.clinicalConditionIds])];
  state.activeId = normalizeActiveId(state.visibleIds, state.activeId);
  const hasDetectedInput = state.visibleIds.length > 0 || state.signals.length > 0;
  if (hasDetectedInput) clearFormError();
  if (!hasDetectedInput) {
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
  state.clinicalConditionIds = [];
  state.clinicalConditions = [];
  state.signals = [];
  state.visibleIds = [];
  state.activeId = "";
  state.measurements = [];
  state.clinicalMeasurements = [];
  state.transfer = null;
  state.observedAt = "";
  state.source = "예시 데이터";
  state.isDemo = true;
  elements.demoMode.hidden = false;
  for (const chip of elements.chips) chip.setAttribute("aria-pressed", "false");
  resetImportFlow({ clearCode: true });
  clearFormError();
  analyze();
});

elements.resetButton.addEventListener("click", () => {
  if (forcedSampleMode) {
    elements.loadDemo.click();
    return;
  }
  elements.note.value = "";
  state.declaredIds = [];
  state.patientVisibleIds = [];
  state.clinicalConditionIds = [];
  state.clinicalConditions = [];
  state.signals = [];
  state.visibleIds = [];
  state.activeId = "";
  state.measurements = [];
  state.clinicalMeasurements = [];
  state.transfer = null;
  state.observedAt = "";
  state.source = "직접 입력";
  state.isDemo = false;
  elements.demoMode.hidden = true;
  resetImportFlow({ clearCode: true });
  setClinicalChipState();
  clearFormError();
  renderAll();
  try {
    sessionStorage.removeItem(sessionKey);
  } catch {
    // Reset still clears the current view when session storage is unavailable.
  }
});

elements.transferCode?.addEventListener("input", () => {
  clearTransferCodeError();
  syncImportControls();
});

elements.transferCode?.addEventListener("blur", () => {
  if (elements.transferCode.value.trim()) {
    elements.transferCode.value = normalizedTransferCode();
    syncImportControls();
  }
});

elements.selectRecordFile?.addEventListener("click", () => {
  if (state.isDemo || forcedSampleMode) {
    setImportResult("예시 모드에서는 실제 환자 전달 파일을 가져올 수 없습니다.", "error", "alert");
    return;
  }
  if (!hasValidTransferCodeShape()) {
    showTransferCodeError(elements.transferCode?.value.trim()
      ? "전달 확인 코드 형식을 확인해 주세요."
      : "파일과 별도 경로로 전달받은 확인 코드를 입력해 주세요.");
    return;
  }
  elements.fhirFile.value = "";
  elements.fhirFile.click();
});

elements.fhirFile?.addEventListener("change", () => {
  const [file] = elements.fhirFile.files;
  if (!file) return;
  pendingTransferFile = file;
  if (elements.fhirResult) elements.fhirResult.hidden = true;
  syncImportControls();
});

elements.importRecordButton?.addEventListener("click", async () => {
  if (state.isDemo || forcedSampleMode) {
    setImportResult("예시 모드에서는 실제 환자 전달 파일을 가져올 수 없습니다.", "error", "alert");
    return;
  }
  if (!elements.transferCode?.value.trim()) {
    showTransferCodeError("파일과 별도 경로로 전달받은 확인 코드를 입력해 주세요.");
    return;
  }
  if (!hasValidTransferCodeShape()) {
    showTransferCodeError("전달 확인 코드 형식을 확인해 주세요.");
    return;
  }
  if (!pendingTransferFile) {
    setImportResult("가져올 PolicyCompass 환자 전달 JSON 파일을 선택해 주세요.", "error", "alert");
    elements.selectRecordFile?.focus({ preventScroll: true });
    return;
  }

  const file = pendingTransferFile;
  importInProgress = true;
  clearTransferCodeError();
  setImportResult("기록 구조와 확인 코드를 검사하는 중…", "loading");
  syncImportControls();
  try {
    const imported = verifyPatientTransferCode(
      await importHealthRecord(file),
      normalizedTransferCode(),
    );
    if (pendingTransferFile !== file) throw new Error("선택한 파일이 바뀌었습니다. 다시 확인해 주세요.");
    if (!window.confirm(
      "파일의 전달 확인 코드가 일치합니다. 의료진에게서 별도 경로로 받은 내 기록이 맞는지 확인했습니까?\n\n파일은 암호화·전자서명되지 않았으며 기존 저장 전 지도와 자동 병합하지 않습니다.",
    )) {
      setImportResult("환자 기록 확인을 취소했습니다. 현재 지도와 Journey는 바뀌지 않았습니다.");
      return;
    }
    let journeyCount = 0;
    try {
      journeyCount = normalizeJourney(JSON.parse(localStorage.getItem(journeyKey) ?? "[]")).length;
    } catch {
      throw new Error("이 기기의 Journey 저장소를 확인할 수 없어 가져오기를 중단했습니다. 저장소 접근을 허용한 뒤 다시 시도해 주세요.");
    }
    if (journeyCount > 0 && !window.confirm(
      `이 기기에 Journey ${journeyCount}건이 있습니다. 지금 파일이 같은 사람의 기록인지 직접 확인했습니까?\n\n다른 사람 기록이면 취소하고 Journey 화면에서 기존 기록을 백업·삭제하세요.`,
    )) {
      setImportResult("기존 Journey와의 대상자 대조를 취소했습니다. 현재 지도와 저장된 기록은 바뀌지 않았습니다.");
      return;
    }
    const hasCurrentMap = state.visibleIds.length > 0
      || state.measurements.length > 0
      || elements.note.value.trim().length > 0;
    if (hasCurrentMap && !window.confirm(
      "이 파일이 내 기록인지 확인했습니까? 현재 저장 전 건강 지도를 파일 내용으로 교체합니다. Journey 기록은 자동 변경되지 않습니다.",
    )) {
      setImportResult("현재 지도 교체를 취소했습니다. 선택한 파일은 다시 확인할 수 있도록 유지됩니다.");
      return;
    }
    replaceMapWithImportedTransfer(imported);
    renderImportPreview({ file, imported });
    resetImportFlow({ clearCode: true, hideResult: false });
  } catch (error) {
    if (error instanceof PatientTransferCodeError) {
      showTransferCodeError(error.message);
      return;
    }
    const message = error instanceof SyntaxError
      ? "JSON 형식을 읽을 수 없습니다. PolicyCompass 환자 전달 JSON v1 파일인지 확인해 주세요."
      : error instanceof Error ? error.message : "기록 파일을 가져오지 못했습니다.";
    setImportResult(message, "error", "alert");
    elements.selectRecordFile?.focus({ preventScroll: true });
  } finally {
    importInProgress = false;
    syncImportControls();
  }
});

elements.saveJourney.addEventListener("click", () => {
  if (state.isDemo || forcedSampleMode) {
    elements.formError.hidden = false;
    elements.formError.textContent = "예시 데이터는 Journey에 저장되지 않습니다.";
    return;
  }
  const snapshot = createJourneySnapshot({
    observedAt: state.observedAt || new Date().toISOString(),
    conditionEntries: [
      ...state.declaredIds.map((id) => ({ id, provenanceKind: "patient-declared" })),
      ...state.clinicalConditionIds.map((id) => ({ id, provenanceKind: "clinician-confirmed-unsigned-import" })),
    ],
    signals: state.signals,
    measurements: state.measurements.map((measurement) => ({
      ...measurement,
      provenanceKind: measurement.provenanceKind === "clinician-final-unsigned-import"
        ? "clinician-final-unsigned-import"
        : "patient-entered",
    })),
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

retireLegacyCareBridge();
syncImportControls();
setClinicalChipState();

if (forcedSampleMode) {
  elements.loadDemo.click();
} else {
  renderAll();
}
