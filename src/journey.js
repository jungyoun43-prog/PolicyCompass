import { CONDITIONS } from "/data.js";
import {
  compareSnapshots,
  createJourneyBackup,
  createJourneyNarrative,
  normalizeJourney,
  parseJourneyBackup,
} from "/journey-model.js";

const storageKey = "vitagraph-journey";
const elements = {
  timeline: document.querySelector("#journeyTimeline"), empty: document.querySelector("#journeyEmpty"),
  title: document.querySelector("#comparisonTitle"), copy: document.querySelector("#comparisonCopy"),
  added: document.querySelector("#addedSignals"), steady: document.querySelector("#steadySignals"), removed: document.querySelector("#removedSignals"),
  measurementChanges: document.querySelector("#measurementChanges"),
  comparison: document.querySelector("#journeyComparison"),
  comparisonDetail: document.querySelector("#journeyComparisonDetail"),
  storyChanges: document.querySelector("#journeyChanges"), contexts: document.querySelector("#journeyContexts"),
  nextReviews: document.querySelector("#journeyNextReviews"), priorComparison: document.querySelector("#journeyPriorComparison"),
  clear: document.querySelector("#clearJourney"), export: document.querySelector("#exportJourney"),
  importTrigger: document.querySelector("#importJourneyTrigger"), importInput: document.querySelector("#journeyImport"),
  transferStatus: document.querySelector("#journeyTransferStatus"),
  reviewAction: document.querySelector("#journeyReviewAction"),
  reviewChanges: document.querySelector("#reviewJourneyChanges"),
};

function readJourney() {
  try { return normalizeJourney(JSON.parse(localStorage.getItem(storageKey) ?? "[]")); } catch { return []; }
}
let journey = readJourney();

function persistJourney() {
  if (journey.length === 0) localStorage.removeItem(storageKey);
  else localStorage.setItem(storageKey, JSON.stringify(journey));
}

function setTransferStatus(message, state = "") {
  elements.transferStatus.textContent = message;
  elements.transferStatus.className = `journey-transfer-status${state ? ` is-${state}` : ""}`;
}

function conditionPills(target, ids, emptyText) {
  target.replaceChildren();
  if (ids.length === 0) { const span = document.createElement("span"); span.className = "change-empty"; span.textContent = emptyText; target.append(span); return; }
  for (const id of ids) { const span = document.createElement("span"); span.className = `journey-pill tone-${CONDITIONS[id].tone}`; span.textContent = CONDITIONS[id].label; target.append(span); }
}

const numberFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });

function measurementText(value, unit) {
  return `${numberFormatter.format(value)}${unit ? ` ${unit}` : ""}`;
}

function textElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function renderStoryItems(target, items, emptyText) {
  if (items.length === 0) {
    target.replaceChildren(textElement("p", "journey-story-empty", emptyText));
    return;
  }

  target.replaceChildren(...items.map((item) => {
    const entry = document.createElement("article");
    entry.className = "journey-story-item";
    entry.dataset.kind = item.kind ?? "review";
    entry.append(
      textElement("strong", "", item.title),
      textElement("p", "", item.detail),
    );
    if (item.measurement) {
      entry.append(textElement(
        "span",
        "journey-story-value",
        `${measurementText(item.measurement.before, item.measurement.unit)} → ${measurementText(item.measurement.after, item.measurement.unit)}`,
      ));
    }
    return entry;
  }));
}

function renderStoryContexts(contexts) {
  if (contexts.length === 0) {
    elements.contexts.replaceChildren(textElement(
      "p",
      "journey-story-empty",
      "현재 신호 조합에서 연결할 수 있는 일반 참고 근거가 없습니다.",
    ));
    return;
  }

  elements.contexts.replaceChildren(...contexts.map((context) => {
    const entry = document.createElement("article");
    entry.className = "journey-context-item";
    const meta = document.createElement("div");
    meta.append(
      textElement("span", "journey-context-tag", context.category),
      textElement("span", "journey-context-tag journey-context-tag--caution", "가능성 · 인과 아님"),
    );
    const source = textElement("a", "journey-context-source", `${context.sourceTitle} ↗`);
    source.href = context.sourceUrl;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.setAttribute("aria-label", `${context.title} 일반 참고 근거: ${context.sourceTitle}, 새 창`);
    entry.append(
      meta,
      textElement("strong", "", `${context.title} · ${context.label}`),
      textElement("p", "", context.rationale),
      textElement("small", "journey-context-guardrail", context.guardrail),
      source,
    );
    return entry;
  }));
}

function renderNarrative(before, after) {
  const narrative = createJourneyNarrative(before, after);
  elements.comparison.dataset.storyState = narrative.state;
  renderStoryItems(
    elements.storyChanges,
    narrative.observations,
    "아직 비교할 기록이 없습니다. 첫 기록을 저장하면 기준점으로 표시합니다.",
  );
  renderStoryContexts(narrative.contexts);
  renderStoryItems(
    elements.nextReviews,
    narrative.nextReviews,
    "기준점이 생기면 같은 항목을 다시 확인할 순서를 제안합니다.",
  );
  elements.priorComparison.textContent = narrative.comparisonSummary;
}

function renderMeasurementChanges(changes) {
  elements.measurementChanges.replaceChildren();
  if (changes.length === 0) {
    const empty = document.createElement("span");
    empty.className = "measurement-change-empty";
    empty.textContent = "비교 가능한 숫자 변화 없음";
    elements.measurementChanges.append(empty);
    return;
  }

  for (const change of changes) {
    const item = document.createElement("article");
    item.className = "measurement-change";
    const label = document.createElement("b");
    label.textContent = change.label;
    const values = document.createElement("span");
    values.textContent = `${measurementText(change.before, change.unit)} → ${measurementText(change.after, change.unit)}`;
    const delta = document.createElement("strong");
    delta.dataset.direction = change.delta > 0 ? "up" : "down";
    delta.textContent = `${change.delta > 0 ? "+" : ""}${measurementText(change.delta, change.unit)}`;
    item.append(label, values, delta);
    elements.measurementChanges.append(item);
  }
}

function renderComparison() {
  const after = journey.at(-1) ?? null;
  const before = journey.length > 1 ? journey.at(-2) : null;
  elements.comparison.dataset.state = journey.length > 1 ? "ready" : "waiting";
  elements.comparisonDetail.hidden = journey.length < 2;
  renderNarrative(before, after);

  if (journey.length < 2) {
    elements.title.textContent = journey.length === 1 ? "첫 기준점이 저장됐어요" : "비교할 기록이 아직 없어요";
    elements.copy.textContent = journey.length === 1 ? "다음 기록을 저장하면 무엇이 달라졌는지 비교합니다." : "기록이 두 개 이상이면 최근 변화가 자동으로 표시됩니다.";
    conditionPills(elements.added, [], "비교 대기"); conditionPills(elements.steady, [], "비교 대기"); conditionPills(elements.removed, [], "비교 대기");
    renderMeasurementChanges([]); return;
  }
  const changes = compareSnapshots(before, after);
  const displayDate = (value) => value.replaceAll("-", "\u2011");
  elements.title.textContent = `${displayDate(before.date)} → ${displayDate(after.date)}`;
  elements.copy.textContent = "최근 두 기록에 포함된 신호의 차이입니다. 임상적 변화로 해석하지 않습니다.";
  conditionPills(elements.added, changes.added, "새 신호 없음"); conditionPills(elements.steady, changes.unchanged, "유지 신호 없음"); conditionPills(elements.removed, changes.removed, "빠진 신호 없음");
  renderMeasurementChanges(changes.measurementChanges);
}

function snapshotCard(snapshot, index) {
  const article = document.createElement("article"); article.className = "snapshot-card";
  const marker = document.createElement("div"); marker.className = "timeline-marker"; marker.textContent = String(index + 1).padStart(2, "0");
  const content = document.createElement("div"); content.className = "snapshot-content";
  const meta = document.createElement("div"); meta.className = "snapshot-meta";
  const date = document.createElement("time"); date.dateTime = snapshot.date; date.textContent = snapshot.date;
  const source = document.createElement("span"); source.textContent = snapshot.source; meta.append(date, source);
  const signals = document.createElement("div"); signals.className = "snapshot-signals";
  conditionPills(signals, snapshot.conditionIds, "표시된 질환 신호 없음");
  const measures = document.createElement("div"); measures.className = "snapshot-measures";
  for (const item of snapshot.measurements) {
    const row = document.createElement("span");
    const label = document.createElement("b");
    label.textContent = item.label;
    row.append(label, document.createTextNode(` ${item.display}`));
    measures.append(row);
  }
  const remove = document.createElement("button"); remove.type = "button"; remove.className = "snapshot-remove"; remove.textContent = "삭제";
  remove.setAttribute("aria-label", `${snapshot.date} 기록 삭제`);
  remove.addEventListener("click", () => {
    if (!window.confirm(`${snapshot.date} Journey 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    journey = journey.filter(({ id }) => id !== snapshot.id);
    persistJourney();
    render();
    setTransferStatus(`${snapshot.date} Journey 기록을 삭제했습니다.`, "success");
  });
  content.append(meta, signals, measures, remove); article.append(marker, content); return article;
}

function render() {
  elements.empty.hidden = journey.length > 0; elements.timeline.hidden = journey.length === 0; elements.clear.hidden = journey.length === 0;
  elements.reviewAction.hidden = journey.length < 2;
  elements.export.disabled = journey.length === 0;
  elements.timeline.replaceChildren(...journey.map(snapshotCard)); renderComparison();
}

elements.reviewChanges.addEventListener("click", () => {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  elements.comparison.scrollIntoView({ behavior, block: "start" });
  elements.title.focus({ preventScroll: true });
});

elements.export.addEventListener("click", () => {
  const backup = createJourneyBackup(journey);
  const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vitagraph-journey-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  setTransferStatus(`Journey 기록 ${journey.length}개를 개인 백업 JSON으로 내보냈습니다. EMR 연결 기록에는 영향을 주지 않습니다.`, "success");
});

elements.importTrigger.addEventListener("click", () => elements.importInput.click());
elements.importInput.addEventListener("change", async () => {
  const [file] = elements.importInput.files;
  if (!file) return;
  setTransferStatus("백업 파일을 확인하고 있습니다.");

  try {
    if (file.size > 5 * 1024 * 1024) throw new TypeError("5MB 이하의 Journey 백업 파일을 선택하세요.");
    const imported = parseJourneyBackup(JSON.parse(await file.text()));
    if (journey.length > 0 && !window.confirm(`현재 Journey ${journey.length}개를 백업의 Journey ${imported.length}개로 교체할까요?`)) {
      setTransferStatus("Journey 백업 복원을 취소했습니다.");
      return;
    }
    journey = imported;
    persistJourney();
    render();
    setTransferStatus(`Journey 백업에서 기록 ${journey.length}개를 복원해 현재 Journey를 교체했습니다.`, "success");
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "Journey 백업 JSON을 읽을 수 없습니다."
      : error instanceof Error ? error.message : "Journey 백업을 복원하지 못했습니다.";
    setTransferStatus(message, "error");
  } finally {
    elements.importInput.value = "";
  }
});

elements.clear.addEventListener("click", () => { if (!window.confirm("이 브라우저에 저장된 Journey 기록을 모두 지울까요? 내보내지 않은 기록은 복구할 수 없습니다.")) return; journey = []; persistJourney(); render(); setTransferStatus("이 브라우저의 Journey 기록을 모두 지웠습니다.", "success"); });
render();
