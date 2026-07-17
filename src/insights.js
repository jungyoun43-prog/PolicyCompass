import { createVisitBrief } from "/insight-model.js";

const sessionKey = "vitagraph-scene";

function readVisibleIds() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? "{}");
    return Array.isArray(stored?.visibleIds) ? stored.visibleIds : [];
  } catch {
    return [];
  }
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function renderQuestions(questions) {
  const list = document.querySelector("#questions");
  const items = questions.map((item, index) => {
    const entry = document.createElement("li");
    const number = createTextElement(
      "span",
      "question-index",
      String(index + 1).padStart(2, "0"),
    );
    number.setAttribute("aria-hidden", "true");

    const copy = document.createElement("div");
    copy.append(createTextElement("strong", "question-prompt", item.question));

    const details = document.createElement("dl");
    details.className = "question-detail";
    details.append(
      createTextElement("dt", "", "왜 확인하나요"),
      createTextElement("dd", "", item.reason),
      createTextElement("dt", "", "브리프 근거"),
      createTextElement("dd", "", item.basis),
    );
    copy.append(details);
    entry.append(number, copy);
    return entry;
  });

  list.replaceChildren(...items);
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

const brief = createVisitBrief(readVisibleIds());
const hasQuestions = brief.questions.length > 0;

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

renderQuestions(brief.questions);
renderSignals(brief.signals);

const printButton = document.querySelector("#printBrief");
printButton.disabled = !hasQuestions;
printButton.addEventListener("click", () => window.print());
