"use client";

import { Button } from "@/components/ui/button";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  clinicalContextFingerprint,
  createCopilotRequest,
  createLocalCopilotBrief,
} from "../../../src/emr-model.js";
import { CLAIM_LANE_LABELS } from "../../../src/claim-rules.js";
import { displayCoding, displayDate, EVENT_LABELS, today } from "../../../lib/emr/format.js";
import { confirmedActiveConditions, finalizedPatient } from "../../../lib/emr/selectors.js";

function copilotRequestFingerprint(request) {
  return clinicalContextFingerprint({
    payload: request.payload,
    eventIdentities: [...request.aliasToEventId.entries()],
    patientBriefIdentities: [...(request.aliasToPatientBriefId ?? new Map()).entries()],
  });
}

function restoreCopilotEvidenceIds(brief, aliasToEventId, aliasToPatientBriefId = new Map()) {
  const restore = (items) => (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    evidenceEventIds: (Array.isArray(item.evidenceEventIds) ? item.evidenceEventIds : [])
      .map((id) => aliasToEventId.get(id))
      .filter(Boolean),
    patientBriefIds: (Array.isArray(item.patientBriefIds) ? item.patientBriefIds : [])
      .map((id) => aliasToPatientBriefId.get(id))
      .filter(Boolean),
  }));
  return {
    ...brief,
    summary: restore(brief.summary),
    priorities: restore(brief.priorities),
    clinicianQuestions: restore(brief.clinicianQuestions),
    patientQuestions: restore(brief.patientQuestions),
    questions: restore(brief.patientQuestions ?? brief.questions),
    warnings: restore(brief.warnings),
    provenance: (Array.isArray(brief.provenance) ? brief.provenance : []).map((item) => ({
      ...item,
      eventId: aliasToEventId.get(item.eventId) ?? "",
    })).filter(({ eventId }) => eventId),
    patientBriefProvenance: (Array.isArray(brief.patientBriefProvenance) ? brief.patientBriefProvenance : [])
      .map((item) => ({
        ...item,
        id: aliasToPatientBriefId.get(item.id) ?? "",
      }))
      .filter(({ id }) => id),
  };
}

function normalizedQuestion(item) {
  if (typeof item === "string") {
    return { question: item, reason: "로컬 모델이 만든 의료진 검토용 질문입니다.", evidenceEventIds: [], patientBriefIds: [] };
  }
  return {
    question: item?.question || item?.title || "확인 질문",
    reason: item?.reason || item?.basis || "",
    evidenceEventIds: Array.isArray(item?.evidenceEventIds) ? item.evidenceEventIds : [],
    patientBriefIds: Array.isArray(item?.patientBriefIds) ? item.patientBriefIds : [],
  };
}

function groundedSources(evidenceEventIds, patientBriefIds, patient, patientBriefProvenance) {
  const eventById = new Map(patient.events.map((event) => [event.id, event]));
  const patientBriefById = new Map((Array.isArray(patientBriefProvenance) ? patientBriefProvenance : []).map((item) => [item.id, item]));
  return {
    chart: [...new Set(evidenceEventIds ?? [])].map((id) => eventById.get(id)).filter(Boolean),
    patient: [...new Set(patientBriefIds ?? [])].map((id) => patientBriefById.get(id)).filter(Boolean),
  };
}

function CitationRow({ sources }) {
  return (
    <span className="copilot-citations">
      {sources.chart.slice(0, 4).map((event, index) => (
        <small data-provenance-kind="chart" key={`c${index}`}>확정 차트 · {[event.label, displayDate(event.date), event.source?.label, event.source?.resourceId].filter(Boolean).join(" · ")}</small>
      ))}
      {sources.patient.slice(0, 3).map((source, index) => (
        <small data-provenance-kind="patient" key={`p${index}`}>{[source.label, source.observedOn ? displayDate(source.observedOn) : "", "환자보고 · 미검증"].filter(Boolean).join(" · ")}</small>
      ))}
    </span>
  );
}

function GroundedList({ items, patient, emptyLabel }) {
  const rows = items
    .map((item) => ({ text: item.text, sources: groundedSources(item.evidenceEventIds ?? [], [], patient) }))
    .filter(({ text, sources }) => text && (sources.chart.length || sources.patient.length));
  return (
    <ul>
      {rows.length === 0 ? <li>{emptyLabel}</li> : rows.map((row, index) => (
        <li key={index}>{row.text}<CitationRow sources={row.sources} /></li>
      ))}
    </ul>
  );
}

function QuestionList({ items, patient, provenance, emptyLabel }) {
  const rows = (items ?? [])
    .map(normalizedQuestion)
    .map((question) => ({ ...question, sources: groundedSources(question.evidenceEventIds, question.patientBriefIds, patient, provenance) }))
    .filter(({ sources }) => sources.chart.length || sources.patient.length);
  return (
    <ol>
      {rows.length === 0 ? <li className="copilot-question copilot-question--empty">{emptyLabel}</li> : rows.map((row, index) => (
        <li className="copilot-question" key={index}>
          <b>{row.question}</b>
          <p>{row.reason}</p>
          <CitationRow sources={row.sources} />
        </li>
      ))}
    </ol>
  );
}

export function OverviewTab({ patient, evaluations, ai, store, selectTab }) {
  const { setStatus } = store;
  const [briefByPatient, setBriefByPatient] = useState(() => new Map());
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef(null);

  const chart = useMemo(() => finalizedPatient(patient), [patient]);
  const conditions = useMemo(() => confirmedActiveConditions(patient), [patient]);
  const brief = briefByPatient.get(patient.id) ?? createLocalCopilotBrief(patient, evaluations, today());
  const provenanceRows = Array.isArray(brief.patientBriefProvenance) ? brief.patientBriefProvenance : [];

  useEffect(() => () => controllerRef.current?.abort(), []);

  const runCopilot = async () => {
    if (busy) return;
    const localBrief = createLocalCopilotBrief(patient, evaluations, today());
    setBriefByPatient((current) => new Map(current).set(patient.id, localBrief));
    if (!ai.configured) {
      setStatus("규칙 기반 초안을 만들었습니다. 로컬 AI가 설정되지 않아 환자 데이터를 전송하지 않았습니다.", "success");
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("규칙 기반 초안을 먼저 만들었습니다. 선택 환자의 확정 구조화 차트만 이 기기의 로컬 AI에 전달합니다. 직접식별자·자유메모는 제외하고 외부로 전송하지 않습니다.");
    try {
      const request = createCopilotRequest(patient, evaluations, today(), {});
      const requestFingerprint = copilotRequestFingerprint(request);
      const response = await fetch("/api/clinical-copilot", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(request.payload),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "로컬 AI를 사용할 수 없습니다.");
      if (result.kind !== "model") throw new Error("로컬 모델 초안 형식이 올바르지 않습니다.");
      const currentRequest = createCopilotRequest(patient, evaluations, today(), {});
      if (copilotRequestFingerprint(currentRequest) !== requestFingerprint) {
        throw new Error("차트 또는 급여 기준이 변경되어 오래된 로컬 AI 초안을 폐기했습니다.");
      }
      setBriefByPatient((current) => new Map(current).set(
        patient.id,
        restoreCopilotEvidenceIds(result, request.aliasToEventId, request.aliasToPatientBriefId),
      ));
      setStatus("로컬 AI 초안을 만들었습니다. 의료진 검토 전 확정 기록이 아닙니다.", "success");
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus((error instanceof Error ? error.message : "로컬 AI 연결 실패") + " 규칙 기반 초안을 유지합니다.");
      }
    } finally {
      setBusy(false);
    }
  };

  const medications = chart.events.filter((event) => event.type === "medication" && !["stopped", "cancelled"].includes(event.status));
  const latestObservation = chart.events.find((event) => event.type === "observation");
  const attention = evaluations.filter((item) => ["missing-evidence", "due-soon", "unknown"].includes(item.status));
  const nextWork = evaluations.filter((item) => ["missing-evidence", "due-soon", "unknown", "ready"].includes(item.status)).slice(0, 3);
  const activeConditionIds = new Set(conditions.map(({ id }) => id));
  const summaryGroups = [
    ["활성 문제", ["condition", "symptom"]],
    ["최근 검사·측정", ["observation"]],
    ["약물·알레르기", ["medication", "allergy"]],
    ["내원·처치", ["encounter", "procedure", "note"]],
  ];

  const metrics = [
    ["활성 문제", conditions.length + "개", conditions[0]?.label ?? "구조화 문제 없음", false],
    ["활성 약물", medications.length + "개", medications[0]?.label ?? "활성 약물 없음", false],
    ["최근 측정", latestObservation ? displayDate(latestObservation.date) : "없음", latestObservation?.label ?? "측정 기록 없음", false],
    ["청구 주의", attention.length + "건", "결정 아님 · 담당자 확인", attention.length > 0],
  ];

  return (
    <>
      <div className="metric-grid" id="patientMetrics" aria-label="환자 기록 요약">
        {metrics.map(([label, value, detail, warning]) => (
          <article className={`metric-card${warning ? " metric-card--warning" : ""}`} key={label}>
            <span>{label}</span><strong>{value}</strong><small>{detail}</small>
          </article>
        ))}
      </div>

      <div className="overview-grid">
        <section className="clinical-card clinical-card--summary" aria-labelledby="clinicalSummaryTitle">
          <div className="card-heading">
            <div><p className="rail-eyebrow">CHART SUMMARY</p><h3 id="clinicalSummaryTitle">확정 기록 요약</h3></div>
            <span className="source-badge">확정 차트</span>
          </div>
          <div className="summary-sections" id="clinicalSummary">
            {summaryGroups.map(([title, types]) => {
              const events = chart.events.filter((event) => (
                types.includes(event.type) && (event.type !== "condition" || activeConditionIds.has(event.id))
              )).slice(0, 4);
              return (
                <section className="summary-group" key={title}>
                  <h4>{title}</h4>
                  {events.length === 0 ? <p className="summary-empty">해당 구조화 기록이 없습니다.</p> : (
                    <ul>
                      {events.map((event) => {
                        const value = event.value === "" ? "" : String(event.value) + (event.unit ? " " + event.unit : "");
                        return (
                          <li className="summary-item" key={event.id}>
                            <b>{event.label}</b>
                            <small>{displayDate(event.date)}</small>
                            <span>{[value, displayCoding(event), event.note].filter(Boolean).join(" · ") || EVENT_LABELS[event.type]}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </section>

        <section className="clinical-card copilot-card" id="copilotPanel" aria-labelledby="copilotTitle">
          <div className="card-heading">
            <div><p className="rail-eyebrow">CLINICAL COPILOT</p><h3 id="copilotTitle">진료 준비 초안</h3></div>
            <span className="source-badge source-badge--draft" id="copilotMode">{brief.kind === "model" ? "로컬 AI" : "규칙 기반"}</span>
          </div>
          <p className="draft-warning">의료진 검토 전 확정 기록 아님 · 선택 환자의 확정 구조화 차트만 사용 · 의료진 AI는 로컬 실행 · 진단·처방·인과 판단 아님</p>
          <div id="copilotContent">
            <section className="copilot-section">
              <h4>기록 요약</h4>
              <GroundedList
                items={(brief.summary ?? []).map((item) => (typeof item === "string" ? { text: item } : { text: item?.text, evidenceEventIds: item?.evidenceEventIds }))}
                patient={patient}
                emptyLabel="요약할 기록이 없습니다." />
            </section>
            <section className="copilot-section">
              <h4>확인 우선순위</h4>
              <GroundedList
                items={(brief.priorities ?? brief.tasks ?? []).map((item) => ({
                  text: (item.title ? item.title + " · " : "") + (item.reason ?? item.text ?? ""),
                  evidenceEventIds: item.evidenceEventIds,
                }))}
                patient={patient}
                emptyLabel="자동 표시된 우선 작업이 없습니다." />
            </section>
            <section className="copilot-section copilot-question-section">
              <h4>진료 대화 질문 초안</h4>
              <div className="copilot-question-grid">
                <section className="copilot-question-column copilot-question-column--clinician">
                  <span className="copilot-question-kicker">ASK THE PATIENT</span>
                  <h5>의사가 먼저 물어볼 질문</h5>
                  <QuestionList items={brief.clinicianQuestions} patient={patient} provenance={provenanceRows} emptyLabel="질문을 만들 선택 환자의 확정 구조화 차트 근거가 없습니다." />
                </section>
                <section className="copilot-question-column copilot-question-column--patient">
                  <span className="copilot-question-kicker">ANTICIPATE</span>
                  <h5>환자가 물을 수 있는 질문</h5>
                  <QuestionList items={brief.patientQuestions ?? brief.questions} patient={patient} provenance={provenanceRows} emptyLabel="예상 질문을 만들 선택 환자의 확정 구조화 차트 근거가 없습니다." />
                </section>
              </div>
              <p className="copilot-question-boundary">질문 준비용 초안입니다. 증상과 약물의 시간 관계는 확인 질문으로만 제시하며 진단·처방·인과관계를 뜻하지 않습니다.</p>
            </section>
            {Array.isArray(brief.warnings) && brief.warnings.length ? (
              <section className="copilot-section">
                <h4>확인 필요</h4>
                <GroundedList
                  items={brief.warnings.map((warning) => (typeof warning === "string" ? { text: warning } : { text: warning?.text, evidenceEventIds: warning?.evidenceEventIds }))}
                  patient={patient}
                  emptyLabel="확인 항목 없음" />
              </section>
            ) : null}
            <section className="copilot-section">
              <h4>사용한 근거</h4>
              <div className="copilot-provenance">
                {(() => {
                  const explicitSources = Array.isArray(brief.provenance) ? brief.provenance : [];
                  const referencedIds = new Set((brief.priorities ?? []).flatMap((item) => item.evidenceEventIds ?? []));
                  const sources = explicitSources.length
                    ? explicitSources
                    : patient.events.filter((event) => referencedIds.has(event.id)).map((event) => ({ label: event.label, date: event.date }));
                  return sources.length === 0
                    ? <span>직접 연결된 이벤트 근거 없음</span>
                    : sources.slice(0, 8).map((source, index) => <span key={index}>{source.label} · {displayDate(source.date)}</span>);
                })()}
              </div>
            </section>
          </div>
          <Button variant="primary" id="runCopilot" type="button" disabled={busy} onClick={runCopilot}>
            {busy ? "로컬 초안 생성 중…" : "근거로 초안 다시 만들기"}
          </Button>
        </section>
      </div>

      <section className="clinical-card next-work-card" aria-labelledby="nextWorkTitle">
        <div className="card-heading">
          <div><p className="rail-eyebrow">NEXT WORK</p><h3 id="nextWorkTitle">놓치면 안 되는 다음 작업</h3></div>
          <Button variant="text" type="button" onClick={() => selectTab("claims")}>급여 보드 열기</Button>
        </div>
        <div className="next-work-list" id="nextWorkList">
          {nextWork.length === 0 ? <p className="summary-empty">현재 연결 규칙에서 바로 확인할 작업이 없습니다.</p> : nextWork.map((item) => (
            <article className="next-work-item" key={item.id}>
              <span>{CLAIM_LANE_LABELS[item.status] ?? "확인"}</span>
              <b>{item.title}</b>
              <p>{item.explanation}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
