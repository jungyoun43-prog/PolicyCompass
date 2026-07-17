import { CONDITIONS } from "/data.js";
import { compareSnapshots, normalizeJourney } from "/journey-model.js";

const storageKey = "vitagraph-journey";
const elements = {
  timeline: document.querySelector("#journeyTimeline"), empty: document.querySelector("#journeyEmpty"),
  comparison: document.querySelector("#journeyComparison"), title: document.querySelector("#comparisonTitle"), copy: document.querySelector("#comparisonCopy"),
  added: document.querySelector("#addedSignals"), steady: document.querySelector("#steadySignals"), removed: document.querySelector("#removedSignals"), clear: document.querySelector("#clearJourney"),
};

function readJourney() {
  try { return normalizeJourney(JSON.parse(localStorage.getItem(storageKey) ?? "[]")); } catch { return []; }
}
let journey = readJourney();

function conditionPills(target, ids, emptyText) {
  target.replaceChildren();
  if (ids.length === 0) { const span = document.createElement("span"); span.className = "change-empty"; span.textContent = emptyText; target.append(span); return; }
  for (const id of ids) { const span = document.createElement("span"); span.className = `journey-pill tone-${CONDITIONS[id].tone}`; span.textContent = CONDITIONS[id].label; target.append(span); }
}

function renderComparison() {
  if (journey.length < 2) {
    elements.title.textContent = journey.length === 1 ? "첫 기준점이 저장됐어요" : "두 시점을 선택하세요";
    elements.copy.textContent = journey.length === 1 ? "다음 기록을 저장하면 무엇이 달라졌는지 비교합니다." : "기록이 두 개 이상이면 최근 변화가 자동으로 표시됩니다.";
    conditionPills(elements.added, [], "비교 대기"); conditionPills(elements.steady, [], "비교 대기"); conditionPills(elements.removed, [], "비교 대기"); return;
  }
  const before = journey.at(-2); const after = journey.at(-1); const changes = compareSnapshots(before, after);
  elements.title.textContent = `${before.date} → ${after.date}`;
  elements.copy.textContent = "최근 두 기록에 포함된 신호의 차이입니다. 임상적 변화로 해석하지 않습니다.";
  conditionPills(elements.added, changes.added, "새 신호 없음"); conditionPills(elements.steady, changes.unchanged, "유지 신호 없음"); conditionPills(elements.removed, changes.removed, "빠진 신호 없음");
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
  remove.addEventListener("click", () => { journey = journey.filter(({ id }) => id !== snapshot.id); localStorage.setItem(storageKey, JSON.stringify(journey)); render(); });
  content.append(meta, signals, measures, remove); article.append(marker, content); return article;
}

function render() {
  elements.empty.hidden = journey.length > 0; elements.timeline.hidden = journey.length === 0; elements.clear.hidden = journey.length === 0;
  elements.timeline.replaceChildren(...journey.map(snapshotCard)); renderComparison();
}
elements.clear.addEventListener("click", () => { if (!window.confirm("이 브라우저에 저장된 Journey 기록을 모두 지울까요?")) return; journey = []; localStorage.removeItem(storageKey); render(); });
render();
