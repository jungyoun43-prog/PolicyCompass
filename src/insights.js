import { createVisitBrief, createVisitStory } from "/insight-model.js";
import { normalizeJourney } from "/journey-model.js";

const sessionKey = "vitagraph-scene";
const journeyKey = "vitagraph-journey";

function readSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? "{}");
    return {
      visibleIds: Array.isArray(stored?.visibleIds) ? stored.visibleIds : [],
      measurements: Array.isArray(stored?.measurements) ? stored.measurements : [],
      observedAt: typeof stored?.observedAt === "string" ? stored.observedAt : "",
      source: typeof stored?.source === "string" ? stored.source : "현재 건강 지도",
      isDemo: stored?.isDemo === true,
    };
  } catch {
    return { visibleIds: [], measurements: [], observedAt: "", source: "현재 건강 지도", isDemo: false };
  }
}

function readJourney() {
  try {
    return normalizeJourney(JSON.parse(localStorage.getItem(journeyKey) ?? "[]"));
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

const storyNumberFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });

function storyMeasurementText(measurement) {
  const before = storyNumberFormatter.format(measurement.before);
  const after = storyNumberFormatter.format(measurement.after);
  const unit = measurement.unit ? ` ${measurement.unit}` : "";
  return `${before}${unit} → ${after}${unit}`;
}

function renderStoryItems(target, items, emptyText) {
  if (items.length === 0) {
    target.replaceChildren(createTextElement("p", "story-empty", emptyText));
    return;
  }

  target.replaceChildren(...items.map((item) => {
    const entry = document.createElement("article");
    entry.className = "story-item";
    entry.dataset.kind = item.kind ?? "review";
    entry.append(
      createTextElement("strong", "", item.title),
      createTextElement("p", "", item.detail),
    );
    if (item.measurement) {
      entry.append(createTextElement("span", "story-item__value", storyMeasurementText(item.measurement)));
    }
    return entry;
  }));
}

function renderStoryContexts(contexts) {
  const target = document.querySelector("#insightContexts");
  if (contexts.length === 0) {
    target.replaceChildren(createTextElement(
      "p",
      "story-empty",
      "현재 입력 신호만으로 근거를 연결할 수 있는 일반 맥락이 없습니다.",
    ));
    return;
  }

  target.replaceChildren(...contexts.map((context) => {
    const entry = document.createElement("article");
    entry.className = "story-context";
    const meta = document.createElement("div");
    meta.append(
      createTextElement("span", "story-context__tag", context.category),
      createTextElement("span", "story-context__tag story-context__tag--caution", "가능성 · 인과 아님"),
    );
    const source = createTextElement("a", "story-context__source", `${context.sourceTitle} ↗`);
    source.href = context.sourceUrl;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.setAttribute("aria-label", `${context.title} 일반 참고 근거: ${context.sourceTitle}, 새 창`);
    entry.append(
      meta,
      createTextElement("strong", "", `${context.title} · ${context.label}`),
      createTextElement("p", "", context.rationale),
      createTextElement("small", "story-context__guardrail", context.guardrail),
      source,
    );
    return entry;
  }));
}

const session = readSession();
const brief = createVisitBrief(session.visibleIds);
const journey = readJourney();
const story = createVisitStory({
  ids: session.visibleIds,
  measurements: session.measurements,
  observedAt: session.observedAt,
  source: session.source,
  isDemo: session.isDemo,
  previousSnapshot: journey.at(-1) ?? null,
});
const hasQuestions = brief.questions.length > 0;

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

renderQuestions(brief.questions);
renderSignals(brief.signals);
renderStoryItems(
  document.querySelector("#insightChanges"),
  story.observations,
  "현재 지도에 비교할 입력 신호가 없습니다. 기록을 연결하면 관찰된 차이만 여기에 표시합니다.",
);
renderStoryContexts(story.contexts);
renderStoryItems(
  document.querySelector("#insightNextReviews"),
  story.nextReviews,
  "현재 입력에서 만들 수 있는 확인 항목이 없습니다. 기록을 연결하면 다음 진료 질문을 제안합니다.",
);
document.querySelector("#insightComparison").textContent = story.comparisonSummary;
document.querySelector(".visit-story").dataset.state = story.state;
if (!story.hasCurrentData) {
  document.querySelector(".visit-story").before(document.querySelector(".brief-layout"));
}

const printButton = document.querySelector("#printBrief");
printButton.disabled = !hasQuestions;
printButton.addEventListener("click", () => window.print());
