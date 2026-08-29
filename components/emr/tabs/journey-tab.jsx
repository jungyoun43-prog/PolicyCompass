"use client";

import { createLocalCopilotBrief } from "../../../src/emr-model.js";
import { displayDate, EVENT_LABELS, today } from "../../../lib/emr/format.js";
import { finalizedPatient } from "../../../lib/emr/selectors.js";

function normalizedQuestion(item) {
  if (typeof item === "string") {
    return { question: item, reason: "", evidenceEventIds: [] };
  }
  return {
    question: item?.question || item?.title || "확인 질문",
    reason: item?.reason || item?.basis || "",
    evidenceEventIds: Array.isArray(item?.evidenceEventIds) ? item.evidenceEventIds : [],
  };
}

export function JourneyTab({ patient, evaluations }) {
  const chart = finalizedPatient(patient);
  const brief = createLocalCopilotBrief(patient, evaluations, today());
  const grouped = new Map();
  for (const event of chart.events) {
    if (!grouped.has(event.date)) grouped.set(event.date, []);
    grouped.get(event.date).push(event);
  }
  const eventById = new Map(chart.events.map((event) => [event.id, event]));
  const questions = (brief.questions ?? [])
    .map(normalizedQuestion)
    .map((question) => ({ ...question, sources: question.evidenceEventIds.map((id) => eventById.get(id)).filter(Boolean) }))
    .filter(({ sources }) => sources.length);

  return (
    <div className="journey-layout">
      <section className="clinical-card" aria-labelledby="clinicalJourneyTitle">
        <div className="card-heading">
          <div><p className="rail-eyebrow">CLINICAL JOURNEY</p><h3 id="clinicalJourneyTitle">환자 변화 타임라인</h3></div>
        </div>
        <ol className="clinical-journey" id="clinicalJourney">
          {grouped.size === 0 ? <p className="summary-empty">Journey로 묶을 임상기록이 없습니다.</p> : [...grouped].map(([date, events]) => (
            <li className="journey-day" key={date}>
              <time>{displayDate(date)}</time>
              <ul>
                {events.map((event) => {
                  const value = event.value === "" ? "" : " · " + String(event.value) + (event.unit ? " " + event.unit : "");
                  return <li key={event.id}>{(EVENT_LABELS[event.type] ?? event.type) + " · " + event.label + value}</li>;
                })}
              </ul>
            </li>
          ))}
        </ol>
      </section>
      <section className="clinical-card" aria-labelledby="visitBriefTitle">
        <div className="card-heading">
          <div><p className="rail-eyebrow">VISIT BRIEF</p><h3 id="visitBriefTitle">이번 진료 질문</h3></div>
          <span className="source-badge source-badge--draft">DRAFT</span>
        </div>
        <ol className="visit-question-list" id="visitQuestions">
          {questions.length === 0 ? <p className="summary-empty">질문을 만들 구조화 문제가 없습니다.</p> : questions.map((question, index) => (
            <li key={index}>
              <b>{question.question}</b>
              <span>{question.reason}</span>
              <span className="question-citations">근거 · {question.sources.map((event) => [event.label, event.date, event.source?.label, event.source?.resourceId].filter(Boolean).join(" · ")).join(", ")}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
