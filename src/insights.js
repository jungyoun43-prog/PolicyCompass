import {
  createPatientBrief,
  createPatientOwnedJson,
  clinicalSnapshotFingerprint,
  patientOwnedJsonFilename,
  publishPatientBrief,
  readCareBridge,
  subscribeCareBridge,
} from "/care-bridge.js";
import { inferConditionIds } from "/data.js";
import {
  createCareBridgePatientBriefInput,
  createModelPatientBrief,
  createPatientFallbackBrief,
  createPatientQuestionContext,
  createPatientQuestionRequest,
  patientQuestionContextFingerprint,
} from "/patient-question-assistant.js";

const sessionKey = "vitagraph-scene";
const selectedQuestionKey = "vitagraph-selected-visit-question";
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
  exportSnapshot: document.querySelector("#exportClinicalSnapshot"),
  snapshotStatus: document.querySelector("#clinicalSnapshotStatus"),
  snapshotCounts: document.querySelector("#clinicalSnapshotCounts"),
  connectionBadge: document.querySelector("#clinicalConnectionBadge"),
  refreshButtons: [
    document.querySelector("#refreshClinicalSnapshot"),
    document.querySelector("#refreshClinicalSnapshotEmpty"),
  ].filter(Boolean),
};

let bridgeState = readCareBridge();
let bridgeClinicalFingerprint = `${bridgeState?.channelId ?? ""}:${clinicalSnapshotFingerprint(bridgeState?.clinical?.snapshot)}`;
let session = readSession();
let brief = createPatientFallbackBrief(currentScene(), "");
let selectedQuestionId = "";
let assistantBusy = false;
let assistantRequestController = null;

function clinicalFactCount(snapshot) {
  return (snapshot?.healthMap?.conditions?.length ?? 0)
    + (snapshot?.healthMap?.measurements?.length ?? 0)
    + (snapshot?.medications?.length ?? 0);
}

function connectedClinicalSnapshot() {
  if (session.isDemo) return null;
  const snapshot = bridgeState?.clinical?.snapshot ?? null;
  return clinicalFactCount(snapshot) > 0 ? snapshot : null;
}

function sceneFingerprint(session) {
  const context = createPatientQuestionContext(session, refs.selfReport.value);
  return `${session.isDemo ? "demo" : "record"}:${bridgeState?.channelId ?? "no-channel"}:${patientQuestionContextFingerprint(context)}`;
}

function readSelectedQuestionId(fingerprint) {
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
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? "{}");
    const declaredIds = Array.isArray(stored?.declaredIds) ? stored.declaredIds : [];
    const note = typeof stored?.note === "string" ? stored.note.slice(0, 4_000) : "";
    const patientVisibleIds = Array.isArray(stored?.patientVisibleIds)
      ? stored.patientVisibleIds
      : inferConditionIds(note, declaredIds);
    return {
      declaredIds,
      patientVisibleIds,
      clinicalConditionIds: Array.isArray(stored?.clinicalConditionIds) ? stored.clinicalConditionIds : [],
      visibleIds: Array.isArray(stored?.visibleIds) ? stored.visibleIds : [],
      measurements: Array.isArray(stored?.measurements) ? stored.measurements : [],
      isDemo: stored?.isDemo === true,
      note,
    };
  } catch {
    return {
      declaredIds: [],
      patientVisibleIds: [],
      clinicalConditionIds: [],
      visibleIds: [],
      measurements: [],
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
  return provider === "frontier" ? "프론티어 AI" : "로컬 AI";
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
          ? `${brief.provider === "frontier" ? "프론티어 AI" : "로컬 AI"} 제안 · 환자 확인 필요`
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
    copy.append(
      createTextElement("strong", "", signal.label),
      createTextElement("p", "", signal.basis),
    );
    item.append(dot, copy);
    return item;
  });

  refs.signals.replaceChildren(...items);
}

function renderSnapshot() {
  const snapshot = connectedClinicalSnapshot();
  refs.exportSnapshot.disabled = !snapshot;
  refs.snapshotStatus.classList.toggle("is-connected", Boolean(snapshot));
  if (!snapshot) {
    refs.connectionBadge.textContent = session.isDemo ? "예시 모드" : "연결 대기";
    refs.connectionBadge.dataset.state = session.isDemo ? "demo" : "empty";
    refs.snapshotStatus.textContent = session.isDemo
      ? "예시 데이터 보는 중 · 실제 EMR 연결 기록과 섞지 않습니다."
      : "아직 서명·확정된 EMR 정제 기록이 연결되지 않았습니다.";
    refs.snapshotCounts.replaceChildren();
    return;
  }
  refs.connectionBadge.textContent = "정제 기록 연결됨";
  refs.connectionBadge.dataset.state = "connected";
  const preparedAt = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(snapshot.preparedAt));
  refs.snapshotStatus.textContent = `${preparedAt}에 준비된 서명·확정 기록이 자동 연결되었습니다.`;
  refs.snapshotCounts.replaceChildren(
    createDefinitionRow("건강 항목", `${snapshot.healthMap.conditions.length}개`),
    createDefinitionRow("최종 측정", `${snapshot.healthMap.measurements.length}개`),
    createDefinitionRow("서명 처방", `${snapshot.medications.length}개`),
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
  refs.runAssistant.disabled = assistantBusy || !hasEvidence || !frontierReady || !providerReady;
  refs.runAssistant.textContent = assistantBusy
    ? `${providerLabel(provider)} 질문 생성 중…`
    : `${providerLabel(provider)}로 질문 제안`;
  refs.useRules.disabled = assistantBusy || brief.kind === "rule-based";
  refs.printBrief.disabled = brief.questions.length === 0;
  refs.shareBrief.disabled = assistantBusy
    || session.isDemo
    || !connectedClinicalSnapshot()
    || !selectedQuestionId;
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
      ? "외부 전송 범위를 확인하고 동의한 뒤에만 프론티어 AI 요청을 보냅니다."
      : localAssistantAvailable
        ? "정제 항목은 이 기기의 로컬 Ollama에만 전달하며, 실패하면 규칙 질문을 유지합니다."
        : "공개 미리보기에서는 로컬 AI 전송을 차단합니다. 규칙 기반 질문을 사용하거나, 동의 후 프론티어 AI를 선택하세요.");
  }
  updateActionAvailability();
}

async function runPatientAssistant() {
  if (assistantBusy) return;
  const provider = selectedProvider();
  if (provider === "local" && !localAssistantAvailable) {
    setAssistantStatus(
      "로컬 AI는 localhost에서 실행할 때만 사용할 수 있습니다. 정제 기록을 이 서버로 보내지 않았습니다.",
      "error",
    );
    updateActionAvailability();
    return;
  }
  const sceneAtRequest = currentScene();
  const bridgeChannelAtRequest = bridgeState?.channelId ?? "";
  let request;
  try {
    request = createPatientQuestionRequest(sceneAtRequest, refs.selfReport.value, {
      provider,
      frontierConsent: refs.frontierConsent.checked,
    });
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
      ? "동의한 정제 항목을 프론티어 AI에 보내 질문 초안을 만드는 중입니다."
      : "정제 항목을 이 기기의 로컬 Ollama로 보내 질문 초안을 만드는 중입니다.",
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
      || (bridgeState?.channelId ?? "") !== bridgeChannelAtRequest
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
        : `${error instanceof Error ? error.message : "로컬 AI를 사용할 수 없습니다."} 외부 전송 없이 규칙 기반 질문을 유지합니다.`,
      "error",
    );
  } finally {
    if (provider === "frontier") refs.frontierConsent.checked = false;
    if (assistantRequestController === controller) assistantRequestController = null;
    assistantBusy = false;
    updateActionAvailability();
  }
}

function sharePatientQuestions() {
  if (session.isDemo) {
    setAssistantStatus("예시 질문은 의료진에게 공유되지 않습니다.", "error");
    return;
  }
  if (!connectedClinicalSnapshot()) {
    setAssistantStatus("먼저 EMR에서 서명·확정된 정제 기록을 연결해 주세요.", "error");
    return;
  }
  if (!selectedQuestionId) {
    setAssistantStatus("의료진에게 먼저 보여 줄 질문을 하나 선택해 주세요.", "error");
    return;
  }
  try {
    const input = createCareBridgePatientBriefInput(
      currentScene(),
      brief,
      selectedQuestionId,
    );
    bridgeState = publishPatientBrief(createPatientBrief(input), {
      expectedChannelId: bridgeState.channelId,
      expectedClinicalFingerprint: clinicalSnapshotFingerprint(bridgeState.clinical.snapshot),
    });
    setAssistantStatus(
      "선택한 질문을 맨 앞에 두고 정제 요약과 질문 근거를 의료진 EMR에 공유했습니다. 확정 차트에는 자동 반영되지 않습니다.",
      "success",
    );
    updateActionAvailability();
  } catch (error) {
    setAssistantStatus(
      error instanceof Error ? error.message : "의료진에게 질문을 공유하지 못했습니다.",
      "error",
    );
  }
}

function downloadClinicalSnapshot() {
  const snapshot = connectedClinicalSnapshot();
  if (!snapshot) {
    setAssistantStatus("내보낼 서명 완료 정제 기록이 없습니다.", "error");
    return;
  }
  try {
    const exportedAt = new Date();
    const ownedCopy = createPatientOwnedJson(snapshot, exportedAt);
    const blob = new Blob([JSON.stringify(ownedCopy, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = patientOwnedJsonFilename(exportedAt);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setAssistantStatus("식별정보와 EMR 원문을 제외한 환자 소유 정제 JSON을 내보냈습니다.", "success");
  } catch (error) {
    setAssistantStatus(error instanceof Error ? error.message : "정제 기록을 내보내지 못했습니다.", "error");
  }
}

function refreshFromBridge({ announce = true } = {}) {
  const next = readCareBridge();
  const nextFingerprint = `${next?.channelId ?? ""}:${clinicalSnapshotFingerprint(next?.clinical?.snapshot)}`;
  const clinicalChanged = nextFingerprint !== bridgeClinicalFingerprint;
  bridgeState = next;
  bridgeClinicalFingerprint = nextFingerprint;
  renderSnapshot();
  if (clinicalChanged || announce) {
    if (clinicalChanged) refs.frontierConsent.checked = false;
    resetToRules(clinicalFactCount(next?.clinical?.snapshot) > 0
      ? "서명·확정된 최신 정제 기록을 확인해 규칙 질문을 갱신했습니다."
      : "연결된 서명·확정 기록이 아직 없습니다. 최근 변화를 직접 적어 규칙 질문을 준비할 수 있습니다.");
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
refs.shareBrief.addEventListener("click", sharePatientQuestions);
refs.exportSnapshot.addEventListener("click", downloadClinicalSnapshot);
refs.refreshButtons.forEach((button) => button.addEventListener("click", () => refreshFromBridge()));
refs.providerInputs.forEach((input) => input.addEventListener("change", () => {
  assistantRequestController?.abort();
  resetToRules();
  syncProviderControls({ announce: true });
}));
refs.frontierConsent.addEventListener("change", updateActionAvailability);
refs.selfReport.addEventListener("input", () => {
  refs.frontierConsent.checked = false;
  resetToRules("최근 변화는 규칙 질문에 반영했습니다. AI로 다듬으려면 생성 방식을 확인하고 버튼을 누르세요.");
  syncProviderControls();
});

const unsubscribeBridge = subscribeCareBridge(() => refreshFromBridge({ announce: false }));
window.addEventListener("pagehide", () => {
  assistantRequestController?.abort();
  unsubscribeBridge();
}, { once: true });

renderSnapshot();
renderBrief(brief, "");
syncProviderControls();
