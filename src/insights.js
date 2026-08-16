import { retireLegacyCareBridge } from "/care-bridge.js";
import { CONDITIONS } from "/data.js";
import { parsePatientTransferPackage } from "/patient-transfer.js";
import { preserveSampleNavigation } from "/sample-navigation.js";
import {
  createModelPatientBrief,
  createPatientFallbackBrief,
  createPatientQuestionContext,
  createPatientQuestionRequest,
  patientQuestionContextFingerprint,
} from "/patient-question-assistant.js";

const sessionKey = "vitagraph-scene";
const selectedQuestionKey = "vitagraph-selected-visit-question";
const forcedSampleMode = new URLSearchParams(window.location.search).get("sample") === "1";
preserveSampleNavigation(forcedSampleMode);
const demoNote = "혈압 148/94, 공복혈당 132, LDL 156, 속쓰림, 편두통";
const demoConditionIds = ["hypertension", "diabetes", "dyslipidemia", "reflux", "migraine"];
const restoredTransferCode = "VG-00000-00000-00000-00000-000000";
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const localAssistantAvailable = loopbackHosts.has(window.location.hostname);

const refs = {
  coverage: document.querySelector("#coverage"),
  questionCount: document.querySelector("#questionCount"),
  disclaimer: document.querySelector("#disclaimer"),
  briefEmpty: document.querySelector("#briefEmpty"),
  questions: document.querySelector("#questions"),
  questionSelectionStatus: document.querySelector("#questionSelectionStatus"),
  signals: document.querySelector("#signals"),
  printDate: document.querySelector("#printDate"),
  printBrief: document.querySelector("#printBrief"),
  demoMode: document.querySelector("#personalDemoMode"),
  selfReport: document.querySelector("#patientSelfReport"),
  providerMode: document.querySelector("#questionProviderMode"),
  providerInputs: [...document.querySelectorAll('input[name="question-provider"]')],
  frontierConsentPanel: document.querySelector("#frontierConsentPanel"),
  frontierConsent: document.querySelector("#frontierConsent"),
  runAssistant: document.querySelector("#runPatientAssistant"),
  useRules: document.querySelector("#useRuleQuestions"),
  shareBrief: document.querySelector("#sharePatientBrief"),
  assistantStatus: document.querySelector("#patientAssistantStatus"),
  snapshotStatus: document.querySelector("#clinicalSnapshotStatus"),
  snapshotCounts: document.querySelector("#clinicalSnapshotCounts"),
  connectionBadge: document.querySelector("#clinicalConnectionBadge"),
  refreshButtons: [
    document.querySelector("#refreshClinicalSnapshot"),
    document.querySelector("#refreshClinicalSnapshotEmpty"),
  ].filter(Boolean),
};

let session = readSession();
let brief = createPatientFallbackBrief(currentScene(), "");
let selectedQuestionId = "";
let assistantBusy = false;
let assistantRequestController = null;

function clinicalFactCount(snapshot) {
  return (snapshot?.healthMap?.conditions?.length ?? 0)
    + (snapshot?.healthMap?.measurements?.length ?? 0);
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

function restoredImportedTransfer(stored) {
  const transfer = stored?.transfer;
  const ids = Array.isArray(stored?.clinicalConditionIds) ? stored.clinicalConditionIds : null;
  const conditions = Array.isArray(stored?.clinicalConditions) ? stored.clinicalConditions : null;
  const measurements = Array.isArray(stored?.clinicalMeasurements) ? stored.clinicalMeasurements : null;
  if (!hasExactKeys(transfer, ["schema", "version", "exportedAt", "trust"])
    || transfer.schema !== "vitagraph-patient-transfer"
    || transfer.version !== 1
    || transfer.trust !== "unsigned-local-export"
    || !ids
    || !conditions
    || !measurements
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
      scope: "patient-vita-graph",
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
      transfer: {
        schema: "vitagraph-patient-transfer",
        version: 1,
        exportedAt: imported.provenance.exportedAt,
        trust: "unsigned-local-export",
      },
      clinicalConditionIds: [...imported.conditionIds],
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
    };
  } catch {
    return null;
  }
}

function connectedClinicalSnapshot() {
  if (session.isDemo) return null;
  const restored = restoredImportedTransfer(session);
  if (!restored) return null;
  const conditions = restored.clinicalConditions.map((item) => ({
      id: item.id,
      label: CONDITIONS[item.id].label,
      recordedOn: item.recordedOn,
      basis: "confirmed-condition",
    }));
  const measurements = restored.clinicalMeasurements.map((item) => ({
      key: item.key,
      code: item.code,
      label: item.label,
      value: item.value,
      unit: item.unit,
      observedOn: item.observedAt,
      basis: "final-observation",
    }));
  const preparedAt = restored.transfer.exportedAt;
  const snapshot = {
    schema: "vitagraph-patient-transfer-import",
    version: 1,
    preparedAt,
    source: "unsigned-local-export",
    healthMap: { conditions, measurements },
    summary: {
      includedConditions: conditions.length,
      includedMeasurements: measurements.length,
    },
  };
  return clinicalFactCount(snapshot) > 0 ? snapshot : null;
}

function sceneFingerprint(session) {
  const context = createPatientQuestionContext(session, refs.selfReport.value);
  return `${session.isDemo ? "demo" : "record"}:${patientQuestionContextFingerprint(context)}`;
}

function readSelectedQuestionId(fingerprint) {
  if (forcedSampleMode) return "";
  try {
    const stored = JSON.parse(sessionStorage.getItem(selectedQuestionKey) ?? "null");
    return stored?.scene === fingerprint && typeof stored?.questionId === "string"
      ? stored.questionId
      : "";
  } catch {
    return "";
  }
}

function saveSelectedQuestionId(fingerprint, id) {
  if (forcedSampleMode) return;
  try {
    sessionStorage.setItem(selectedQuestionKey, JSON.stringify({
      scene: fingerprint,
      questionId: id,
    }));
  } catch {
    // The selected question remains visible even if session storage is unavailable.
  }
}

function readSession() {
  if (forcedSampleMode) {
    const visibleIds = [...demoConditionIds];
    return {
      declaredIds: [],
      patientVisibleIds: visibleIds,
      clinicalConditionIds: [],
      clinicalConditions: [],
      clinicalMeasurements: [],
      visibleIds,
      measurements: [],
      transfer: null,
      isDemo: true,
      note: demoNote,
    };
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? "{}");
    const declaredIds = conditionIds(stored?.declaredIds);
    const note = typeof stored?.note === "string" ? stored.note.slice(0, 4_000) : "";
    // Legacy patientVisibleIds/visibleIds may contain free-text threshold inference.
    const patientVisibleIds = [...declaredIds];
    const restored = restoredImportedTransfer(stored);
    const clinicalConditionIds = restored?.clinicalConditionIds ?? [];
    const visibleIds = [...new Set([...patientVisibleIds, ...clinicalConditionIds])];
    return {
      declaredIds,
      patientVisibleIds,
      clinicalConditionIds,
      clinicalConditions: restored?.clinicalConditions ?? [],
      clinicalMeasurements: restored?.clinicalMeasurements ?? [],
      visibleIds,
      measurements: restored?.clinicalMeasurements ?? [],
      transfer: restored?.transfer ?? null,
      isDemo: false,
      note,
    };
  } catch {
    return {
      declaredIds: [],
      patientVisibleIds: [],
      clinicalConditionIds: [],
      clinicalConditions: [],
      clinicalMeasurements: [],
      visibleIds: [],
      measurements: [],
      transfer: null,
      isDemo: false,
      note: "",
    };
  }
}

function currentScene() {
  const clinicalSnapshot = connectedClinicalSnapshot();
  const clinicalConditionIds = clinicalSnapshot
    ? clinicalSnapshot.healthMap.conditions.map(({ id }) => id)
    : [];
  const visibleIds = session.isDemo
    ? session.visibleIds
    : [...new Set([...session.patientVisibleIds, ...clinicalConditionIds])];
  return {
    ...session,
    visibleIds,
    clinicalConditionIds,
    clinicalSnapshot,
  };
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function createDefinitionRow(label, value) {
  const row = document.createElement("div");
  row.append(
    createTextElement("dt", "", label),
    createTextElement("dd", "", value),
  );
  return row;
}

function selectedProvider() {
  return refs.providerInputs.find(({ checked }) => checked)?.value === "frontier"
    ? "frontier"
    : "local";
}

function providerLabel(provider = selectedProvider()) {
  return provider === "frontier" ? "외부 모델" : "이 기기 모델";
}

function setAssistantStatus(message, state = "") {
  refs.assistantStatus.textContent = message;
  refs.assistantStatus.className = `assistant-status${state ? ` is-${state}` : ""}`;
}

function renderQuestions(questions, initialSelectionId, fingerprint) {
  let selectedId = questions.some(({ id }) => id === initialSelectionId) ? initialSelectionId : "";
  selectedQuestionId = selectedId;
  refs.questionSelectionStatus.hidden = questions.length === 0;

  function updateSelection(nextId) {
    selectedId = nextId;
    selectedQuestionId = nextId;
    for (const entry of refs.questions.querySelectorAll("[data-question-id]")) {
      const isSelected = entry.dataset.questionId === selectedId;
      entry.classList.toggle("is-selected", isSelected);
      const radio = entry.querySelector(".question-select__input");
      const label = entry.querySelector(".question-select__label");
      radio.checked = isSelected;
      label.textContent = isSelected ? "준비 질문으로 선택됨" : "이 질문 준비하기";
    }
    const selectedQuestion = questions.find(({ id }) => id === selectedId);
    refs.questionSelectionStatus.textContent = selectedQuestion
      ? `준비 질문으로 선택됨: ${selectedQuestion.question}`
      : "진료에서 먼저 확인할 질문을 하나 선택하세요.";
    updateActionAvailability();
  }

  const items = questions.map((item, index) => {
    const entry = document.createElement("li");
    entry.dataset.questionId = item.id;
    const number = createTextElement(
      "span",
      "question-index",
      String(index + 1).padStart(2, "0"),
    );
    number.setAttribute("aria-hidden", "true");

    const copy = document.createElement("div");
    const prompt = createTextElement("strong", "question-prompt", item.question);
    prompt.id = `question-prompt-${item.id}`;
    const selectedBadge = createTextElement("span", "question-selected-badge", "우선 질문");
    copy.append(prompt, selectedBadge);

    const details = document.createElement("dl");
    details.className = "question-detail";
    details.append(
      createTextElement("dt", "", "만든 방식"),
      createTextElement(
        "dd",
        "",
        item.origin === "model"
          ? `${providerLabel(brief.provider)} 제안 · 환자 확인 필요`
          : "결정론적 규칙 기반",
      ),
      createTextElement("dt", "", "왜 확인하나요"),
      createTextElement("dd", "", item.reason),
      createTextElement("dt", "", "브리프 근거"),
      createTextElement("dd", "", item.basis),
    );
    const selectControl = document.createElement("label");
    selectControl.className = "question-select";
    const radio = document.createElement("input");
    radio.className = "visually-hidden question-select__input";
    radio.type = "radio";
    radio.name = "visit-question";
    radio.value = item.id;
    const selectLabel = createTextElement("span", "question-select__label", "이 질문 준비하기");
    selectLabel.id = `question-select-label-${item.id}`;
    radio.setAttribute("aria-labelledby", `${prompt.id} ${selectLabel.id}`);
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      saveSelectedQuestionId(fingerprint, item.id);
      updateSelection(item.id);
    });
    selectControl.append(radio, selectLabel);
    copy.append(details, selectControl);
    entry.append(number, copy);
    return entry;
  });

  refs.questions.replaceChildren(...items);
  updateSelection(selectedId);
}

function renderSignals(signals) {
  if (signals.length === 0) {
    refs.signals.replaceChildren(
      createTextElement("p", "signal-empty", "연결된 정제 건강 항목이 없습니다."),
    );
    return;
  }

  const items = signals.map((signal) => {
    const item = document.createElement("article");
    item.className = "signal-item";
    const dot = createTextElement("span", "signal-dot", "");
    dot.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    const importedConditionId = typeof signal.id === "string" && signal.id.startsWith("condition:")
      ? signal.id.slice("condition:".length)
      : "";
    const basis = importedConditionId && session.clinicalConditionIds.includes(importedConditionId)
      ? "파일에 의료진 확정으로 표시 · 발행기관·변조 미검증"
      : typeof signal.id === "string" && signal.id.startsWith("measurement:") && session.clinicalMeasurements.length > 0
        ? `${signal.basis} · 환자 전달 파일 · 발행기관·변조 미검증`
        : signal.basis;
    copy.append(
      createTextElement("strong", "", signal.label),
      createTextElement("p", "", basis),
    );
    item.append(dot, copy);
    return item;
  });

  refs.signals.replaceChildren(...items);
}

function renderSnapshot() {
  const snapshot = connectedClinicalSnapshot();
  if (!refs.snapshotStatus || !refs.connectionBadge || !refs.snapshotCounts) return;
  refs.snapshotStatus.classList.toggle("is-connected", Boolean(snapshot));
  if (!snapshot) {
    refs.connectionBadge.textContent = session.isDemo ? "예시 모드" : "파일 가져오기 대기";
    refs.connectionBadge.dataset.state = session.isDemo ? "demo" : "empty";
    refs.snapshotStatus.textContent = session.isDemo
      ? "예시 데이터만 사용 중입니다. 실제 환자 전달 파일·내보내기·AI 전송은 차단됩니다."
      : "건강 지도에서 환자 전달 JSON과 별도 확인 코드를 직접 확인해 가져오세요.";
    refs.snapshotCounts.replaceChildren();
    return;
  }
  refs.connectionBadge.textContent = "환자 전달 파일 가져옴";
  refs.connectionBadge.dataset.state = "connected";
  const preparedAt = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(snapshot.preparedAt));
  refs.snapshotStatus.textContent = `${preparedAt}에 내보낸 환자 전달 파일을 명시적으로 가져왔습니다. 파일에 의료진 확정으로 표시 · 발행기관·변조 미검증.`;
  refs.snapshotCounts.replaceChildren(
    createDefinitionRow("건강 항목", `${snapshot.healthMap.conditions.length}개`),
    createDefinitionRow("최종 측정", `${snapshot.healthMap.measurements.length}개`),
  );
}

function renderBrief(nextBrief, preferredSelectionId = selectedQuestionId) {
  brief = nextBrief;
  const hasQuestions = brief.questions.length > 0;
  const fingerprint = sceneFingerprint(currentScene());
  if (preferredSelectionId && brief.questions.some(({ id }) => id === preferredSelectionId)) {
    saveSelectedQuestionId(fingerprint, preferredSelectionId);
  }

  refs.coverage.textContent = brief.coverage;
  refs.questionCount.textContent = brief.countLabel;
  refs.disclaimer.textContent = brief.disclaimer;
  refs.briefEmpty.hidden = hasQuestions;
  refs.questions.hidden = !hasQuestions;
  refs.providerMode.textContent = brief.kind === "model"
    ? `${providerLabel(brief.provider)} 초안 · 확인 필요`
    : "규칙 기반 안전망";
  refs.useRules.disabled = assistantBusy || brief.kind === "rule-based";

  renderQuestions(brief.questions, readSelectedQuestionId(fingerprint), fingerprint);
  renderSignals(brief.signals);
  updateActionAvailability();
}

function updateActionAvailability() {
  const provider = selectedProvider();
  let hasEvidence = false;
  try {
    createPatientQuestionRequest(currentScene(), refs.selfReport.value, { provider: "local" });
    hasEvidence = true;
  } catch {
    hasEvidence = false;
  }
  const frontierReady = provider !== "frontier" || refs.frontierConsent.checked;
  const providerReady = provider !== "local" || localAssistantAvailable;
  refs.runAssistant.disabled = session.isDemo || assistantBusy || !hasEvidence || !frontierReady || !providerReady;
  refs.runAssistant.textContent = assistantBusy
    ? `${providerLabel(provider)} 질문 생성 중…`
    : `${providerLabel(provider)}로 질문 제안`;
  refs.useRules.disabled = assistantBusy || brief.kind === "rule-based";
  refs.printBrief.disabled = brief.questions.length === 0;
  if (refs.shareBrief) refs.shareBrief.disabled = session.isDemo || assistantBusy || !selectedQuestionId;
  if (refs.exportSnapshot) refs.exportSnapshot.disabled = true;
}

function resetToRules(message = "정제 기록에 연결된 결정론적 규칙 질문을 표시합니다.") {
  assistantRequestController?.abort();
  assistantRequestController = null;
  assistantBusy = false;
  renderBrief(createPatientFallbackBrief(currentScene(), refs.selfReport.value), "");
  setAssistantStatus(message);
}

function syncProviderControls({ announce = false } = {}) {
  const provider = selectedProvider();
  refs.frontierConsentPanel.hidden = provider !== "frontier";
  if (provider !== "frontier") refs.frontierConsent.checked = false;
  if (announce || (provider === "local" && !localAssistantAvailable)) {
    setAssistantStatus(provider === "frontier"
      ? "가져온 확정 표시 질환·최종 측정값과 직접 적은 최근 변화의 외부 전송 범위를 확인하고 동의한 뒤에만 외부 모델 요청을 보냅니다."
      : localAssistantAvailable
        ? "정제 항목은 이 기기에서 실행하는 Ollama에만 전달하며, 실패하면 규칙 질문을 유지합니다."
        : "공개 미리보기에서는 이 기기 모델 요청을 차단합니다. 규칙 기반 질문을 사용하거나, 동의 후 외부 모델을 선택하세요.");
  }
  updateActionAvailability();
}

async function runPatientAssistant() {
  if (assistantBusy) return;
  if (session.isDemo) {
    setAssistantStatus("예시 모드에서는 이 기기 모델·외부 모델로 데이터를 전송하지 않습니다.", "error");
    updateActionAvailability();
    return;
  }
  const provider = selectedProvider();
  if (provider === "local" && !localAssistantAvailable) {
    setAssistantStatus(
      "이 기기 모델은 localhost에서 실행할 때만 사용할 수 있습니다. 정제 기록을 이 서버로 보내지 않았습니다.",
      "error",
    );
    updateActionAvailability();
    return;
  }
  const sceneAtRequest = currentScene();
  let request;
  try {
    request = createPatientQuestionRequest(sceneAtRequest, refs.selfReport.value, {
      provider,
      frontierConsent: refs.frontierConsent.checked,
    });
    if (request.clinicalSnapshot) {
      const { medications: _unsupportedMedications, ...snapshot } = request.clinicalSnapshot;
      request = {
        ...request,
        clinicalSnapshot: {
          ...snapshot,
          source: "unsigned-local-export",
          summary: {
            includedConditions: snapshot.healthMap.conditions.length,
            includedMeasurements: snapshot.healthMap.measurements.length,
          },
        },
      };
    }
  } catch (error) {
    setAssistantStatus(error instanceof Error ? error.message : "질문 생성 조건을 확인해 주세요.", "error");
    updateActionAvailability();
    return;
  }

  const requestContext = createPatientQuestionContext(sceneAtRequest, refs.selfReport.value);
  const requestFingerprint = patientQuestionContextFingerprint(requestContext);
  const fallback = createPatientFallbackBrief(
    sceneAtRequest,
    request.selfReport?.summary ?? "",
  );
  renderBrief(fallback, "");
  assistantBusy = true;
  const controller = new AbortController();
  assistantRequestController?.abort();
  assistantRequestController = controller;
  setAssistantStatus(
    provider === "frontier"
      ? "동의한 정제 항목을 외부 모델에 보내 질문 초안을 만드는 중입니다."
      : "정제 항목을 이 기기에서 실행하는 Ollama로 보내 질문 초안을 만드는 중입니다.",
  );
  updateActionAvailability();

  try {
    const response = await fetch("/api/patient-question-assistant", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = "";
      try {
        message = (await response.json())?.message ?? "";
      } catch {
        message = "";
      }
      throw new Error(message || `${providerLabel(provider)}가 유효한 질문을 반환하지 못했습니다.`);
    }
    const responseBody = await response.json();
    const currentContext = createPatientQuestionContext(currentScene(), refs.selfReport.value);
    if (controller.signal.aborted
      || selectedProvider() !== provider
      || patientQuestionContextFingerprint(currentContext) !== requestFingerprint) {
      return;
    }
    const modelBrief = createModelPatientBrief(
      responseBody,
      sceneAtRequest,
      request.selfReport?.summary ?? "",
      provider,
    );
    renderBrief(modelBrief, "");
    setAssistantStatus(
      `${modelBrief.countLabel}을 ${providerLabel(provider)}가 제안했습니다. 근거를 확인하고 우선 질문을 직접 선택하세요.`,
      "success",
    );
  } catch (error) {
    if (error?.name === "AbortError") return;
    renderBrief(fallback, "");
    setAssistantStatus(
      provider === "frontier"
        ? `${error instanceof Error ? error.message : "외부 모델 요청에 실패했습니다."} 규칙 기반 질문을 유지합니다.`
        : `${error instanceof Error ? error.message : "이 기기 모델을 사용할 수 없습니다."} 외부 전송 없이 규칙 기반 질문을 유지합니다.`,
      "error",
    );
  } finally {
    if (provider === "frontier") refs.frontierConsent.checked = false;
    if (assistantRequestController === controller) assistantRequestController = null;
    assistantBusy = false;
    updateActionAvailability();
  }
}

async function copySelectedQuestion() {
  if (session.isDemo) {
    setAssistantStatus("예시 질문은 클립보드로 내보내지 않습니다.", "error");
    return;
  }
  const selected = brief.questions.find(({ id }) => id === selectedQuestionId);
  if (!selected) {
    setAssistantStatus("복사할 질문을 먼저 선택해 주세요.", "error");
    return;
  }
  if (typeof navigator.clipboard?.writeText !== "function") {
    setAssistantStatus("이 브라우저에서는 클립보드 복사를 사용할 수 없습니다. 브리프 인쇄를 이용해 주세요.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(selected.question);
    setAssistantStatus("선택한 질문 한 개를 이 기기의 클립보드에 복사했습니다. EMR이나 서버로 자동 공유하지 않았습니다.", "success");
  } catch {
    setAssistantStatus("클립보드 권한이 없어 복사하지 못했습니다. 브리프 인쇄를 이용해 주세요.", "error");
  }
}

function refreshFromSession({ announce = true } = {}) {
  session = readSession();
  renderSnapshot();
  if (announce) {
    refs.frontierConsent.checked = false;
    resetToRules(connectedClinicalSnapshot()
      ? "명시적으로 가져온 환자 전달 기록을 다시 확인해 규칙 질문을 갱신했습니다."
      : "가져온 환자 전달 기록이 없습니다. 건강 지도에서 파일과 별도 확인 코드를 확인하세요.");
  } else {
    updateActionAvailability();
  }
}

refs.printDate.textContent = `준비일 ${new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
}).format(new Date())}`;
refs.demoMode.hidden = !session.isDemo;
refs.printBrief.addEventListener("click", () => window.print());
refs.runAssistant.addEventListener("click", runPatientAssistant);
refs.useRules.addEventListener("click", () => resetToRules());
refs.shareBrief?.addEventListener("click", copySelectedQuestion);
refs.refreshButtons.forEach((button) => button.addEventListener("click", () => refreshFromSession()));
refs.providerInputs.forEach((input) => input.addEventListener("change", () => {
  assistantRequestController?.abort();
  resetToRules();
  syncProviderControls({ announce: true });
}));
refs.frontierConsent.addEventListener("change", updateActionAvailability);
refs.selfReport.addEventListener("input", () => {
  refs.frontierConsent.checked = false;
  resetToRules("최근 변화는 규칙 질문에 반영했습니다. 모델로 다듬으려면 생성 방식을 확인하고 버튼을 누르세요.");
  syncProviderControls();
});

retireLegacyCareBridge();
window.addEventListener("pagehide", () => {
  assistantRequestController?.abort();
}, { once: true });

renderSnapshot();
renderBrief(brief, "");
syncProviderControls();
