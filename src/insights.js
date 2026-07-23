import { createVisitBrief } from "/insight-model.js";

const sessionKey = "vitagraph-scene";
const selectedQuestionKey = "vitagraph-selected-visit-question";

function sceneFingerprint(session) {
  const ids = [...new Set(session.visibleIds)].sort();
  return `${session.isDemo ? "demo" : "record"}:${ids.join("|")}`;
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
    // The selection remains visible for this render if storage is unavailable.
  }
}

function readSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? "{}");
    return {
      visibleIds: Array.isArray(stored?.visibleIds) ? stored.visibleIds : [],
      isDemo: stored?.isDemo === true,
    };
  } catch {
    return { visibleIds: [], isDemo: false };
  }
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function renderQuestions(questions, initialSelectionId, fingerprint) {
  const list = document.querySelector("#questions");
  const status = document.querySelector("#questionSelectionStatus");
  let selectedId = questions.some(({ id }) => id === initialSelectionId) ? initialSelectionId : "";
  status.hidden = questions.length === 0;

  function updateSelection(nextId) {
    selectedId = nextId;
    for (const entry of list.querySelectorAll("[data-question-id]")) {
      const isSelected = entry.dataset.questionId === selectedId;
      entry.classList.toggle("is-selected", isSelected);
      const radio = entry.querySelector(".question-select__input");
      const label = entry.querySelector(".question-select__label");
      radio.checked = isSelected;
      label.textContent = isSelected ? "준비 질문으로 선택됨" : "이 질문 준비하기";
    }
    const selectedQuestion = questions.find(({ id }) => id === selectedId);
    status.textContent = selectedQuestion
      ? `준비 질문으로 선택됨: ${selectedQuestion.question}`
      : "진료에서 먼저 확인할 질문을 하나 선택하세요.";
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

  list.replaceChildren(...items);
  updateSelection(selectedId);
}

function renderSignals(signals) {
  const list = document.querySelector("#signals");
  if (signals.length === 0) {
    list.replaceChildren(
      createTextElement("p", "signal-empty", "건강 지도에 연결된 입력 신호가 없습니다."),
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
      createTextElement("strong", "", `${signal.label} 관련 신호`),
      createTextElement("p", "", signal.basis),
    );
    item.append(dot, copy);
    return item;
  });

  list.replaceChildren(...items);
}

const session = readSession();
const brief = createVisitBrief(session.visibleIds);
const hasQuestions = brief.questions.length > 0;
const fingerprint = sceneFingerprint(session);

const demoMode = document.querySelector("#personalDemoMode");
if (demoMode) demoMode.hidden = !session.isDemo;

document.querySelector("#coverage").textContent = brief.coverage;
document.querySelector("#questionCount").textContent = brief.countLabel;
document.querySelector("#disclaimer").textContent = brief.disclaimer;
document.querySelector("#briefEmpty").hidden = hasQuestions;
document.querySelector("#questions").hidden = !hasQuestions;
document.querySelector("#printDate").textContent = `준비일 ${new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
}).format(new Date())}`;

renderQuestions(brief.questions, readSelectedQuestionId(fingerprint), fingerprint);
renderSignals(brief.signals);

const printButton = document.querySelector("#printBrief");
printButton.disabled = !hasQuestions;
printButton.addEventListener("click", () => window.print());
