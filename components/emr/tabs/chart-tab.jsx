"use client";

import { Button } from "@/components/ui/button";

import { useEffect, useState } from "react";

import {
  appendPatientEvent,
  confirmPatientEvent,
  removePatientEvent,
} from "../../../src/emr-model.js";
import { displayCoding, displayDate, EVENT_LABELS, today } from "../../../lib/emr/format.js";

const EMPTY_EVENT = { type: "condition", date: "", code: "", label: "", system: "urn:kr:kcd", value: "", unit: "", note: "" };

export function ChartTab({ state, patient, store, dirtyGuardsRef }) {
  const { applyMutation, setStatus } = store;
  const [eventFilter, setEventFilter] = useState("all");
  const [form, setForm] = useState(() => ({ ...EMPTY_EVENT, date: today() }));
  const [message, setMessage] = useState("");

  useEffect(() => { setEventFilter("all"); }, [patient.id]);
  useEffect(() => {
    dirtyGuardsRef.current.manualEvent = () => (
      form.type !== "condition"
      || form.date !== today()
      || form.system !== "urn:kr:kcd"
      || [form.code, form.label, form.value, form.unit, form.note].some((value) => String(value ?? "").trim())
    );
  }, [dirtyGuardsRef, form]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    if (!form.date || !form.label.trim()) {
      setMessage("기록일과 이름을 입력하세요.");
      return;
    }
    try {
      await applyMutation((current) => appendPatientEvent(current, patient.id, {
        ...form,
        source: state.demo ? { kind: "demo", label: "예시 입력" } : { kind: "manual", label: "직접 입력 · 검토 대기" },
      }), state.demo ? "예시 차트에 기록을 추가했습니다." : "검토 대기 기록을 추가했습니다. 확정 진료 사실·AI·급여 근거에는 포함되지 않습니다.");
      setForm({ ...EMPTY_EVENT, date: today() });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기록 추가에 실패했습니다.");
    }
  };

  const onConfirm = async (record) => {
    if (!window.confirm(`‘${record?.label ?? "이 기록"}’의 코드·값·날짜·출처를 대조했고 확정 차트 사실로 전환할까요? 이 확인은 법적 전자서명이 아닙니다.`)) return;
    try {
      await applyMutation((current) => confirmPatientEvent(current, patient.id, record.id), "과거자료를 의료진 검토 완료 기록으로 확정했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "과거자료를 확정하지 못했습니다.", "error");
    }
  };

  const onRemove = async (record) => {
    const reason = window.prompt("‘" + (record?.label ?? "이 기록") + "’을 취소할 사유를 입력하세요. 원문과 사유는 감사 이력에 남습니다.");
    if (reason === null) return;
    try {
      await applyMutation((current) => removePatientEvent(current, patient.id, record.id, reason), "임상 이벤트를 취소했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "임상 이벤트를 취소하지 못했습니다.", "error");
    }
  };

  const types = ["all", ...new Set(patient.events.map((event) => event.type))];
  const events = patient.events.filter((event) => eventFilter === "all" || event.type === eventFilter);

  return (
    <div className="chart-layout">
      <details className="clinical-card event-composer workflow-disclosure" aria-labelledby="eventFormTitle" data-workflow-disclosure="historical-entry">
        <summary className="workflow-disclosure__summary">
          <span className="workflow-disclosure__heading"><span className="rail-eyebrow">HISTORICAL ENTRY</span><span className="workflow-disclosure__title" id="eventFormTitle" role="heading" aria-level={3}>과거자료 입력·검토</span></span>
          <span className="workflow-disclosure__signals"><span className="source-badge source-badge--draft">DRAFT</span><span className="workflow-disclosure__meta">필요할 때 열기</span></span>
        </summary>
        <div className="workflow-disclosure__body">
          <form id="eventForm" noValidate autoComplete="off" spellCheck="false" onSubmit={submit}>
            <div className="form-pair">
              <label>기록 유형<select id="eventType" required value={form.type} onChange={set("type")}><option value="condition">진단·문제</option><option value="observation">검사·측정</option><option value="medication">약물</option><option value="allergy">알레르기</option><option value="procedure">수술·처치</option><option value="symptom">증상</option><option value="note">진료 메모</option></select></label>
              <label>기록일<input id="eventDate" type="date" required value={form.date} onChange={set("date")} /></label>
            </div>
            <div className="form-pair">
              <label>코드<input id="eventCode" maxLength={80} placeholder="KCD·LOINC·EDI 또는 내부코드" value={form.code} onChange={set("code")} /></label>
              <label>이름<input id="eventLabel" required maxLength={100} placeholder="예: 혈압" value={form.label} onChange={set("label")} /></label>
            </div>
            <label>코드 시스템<input id="eventSystem" maxLength={300} placeholder="예: urn:kr:kcd · http://loinc.org" value={form.system} onChange={set("system")} /></label>
            <div className="form-pair form-pair--value">
              <label>값<input id="eventValue" maxLength={80} placeholder="예: 148/94" value={form.value} onChange={set("value")} /></label>
              <label>단위<input id="eventUnit" maxLength={40} placeholder="예: mmHg" value={form.unit} onChange={set("unit")} /></label>
            </div>
            <label>기록 메모<textarea id="eventNote" rows={3} maxLength={2000} placeholder="의료진이 확인한 맥락과 근거" value={form.note} onChange={set("note")} /></label>
            <p className="entry-boundary">먼저 검토 대기로 저장됩니다. 타임라인의 “검토·확정”에서 코드·값·날짜·출처를 다시 대조해야 확정 차트와 환자용 정제 기록에 반영됩니다.</p>
            <p className="form-message" id="eventFormMessage" role="alert">{message}</p>
            <Button variant="primary" type="submit">검토 대기 기록 추가</Button>
          </form>
        </div>
      </details>

      <section className="clinical-card event-timeline-card" aria-labelledby="eventTimelineTitle">
        <div className="card-heading">
          <div><p className="rail-eyebrow">PATIENT TIMELINE</p><h3 id="eventTimelineTitle">전체 임상기록</h3></div>
          <span className="rail-count" id="eventCount">{events.length}건</span>
        </div>
        <div className="event-filters" role="group" aria-label="기록 유형 필터" id="eventFilters">
          {types.map((type) => (
            <button key={type} type="button" data-event-filter={type} aria-pressed={eventFilter === type} onClick={() => setEventFilter(type)}>
              {type === "all" ? "전체" : EVENT_LABELS[type] ?? type}
            </button>
          ))}
        </div>
        <ol className="event-timeline" id="eventTimeline">
          {events.length === 0 ? <p className="summary-empty">선택한 유형의 기록이 없습니다.</p> : events.map((event) => {
            const value = event.value === "" ? "" : String(event.value) + (event.unit ? " " + event.unit : "");
            const detail = [value, displayCoding(event), event.note].filter(Boolean).join(" · ");
            const isLockedEncounterRecord = Boolean(event.encounterId) || event.type === "encounter";
            const actionable = !isLockedEncounterRecord && event.source?.kind !== "import" && event.recordStatus !== "entered-in-error";
            return (
              <li className="event-row" data-event-id={event.id} tabIndex={-1} key={event.id}>
                <time>{displayDate(event.date)}</time>
                <div className="event-row__body">
                  <header>
                    <span className="event-type-badge">{EVENT_LABELS[event.type] ?? event.type}</span>
                    <span className={`event-type-badge event-type-badge--${event.recordStatus}`}>{event.recordStatus === "draft" ? "초안" : event.recordStatus === "entered-in-error" ? "취소" : "확정"}</span>
                    <b>{event.label}</b>
                  </header>
                  {detail ? <p>{detail}</p> : null}
                  <span className="event-source">{(event.source?.label || "출처 없음") + (event.source?.resourceId ? " · " + event.source.resourceId : "")}</span>
                </div>
                {actionable ? (
                  <div className="event-actions">
                    {event.recordStatus === "draft" && event.source?.kind === "manual" ? (
                      <button className="event-confirm" type="button" aria-label={event.label + " 기록 검토 후 확정"} onClick={() => onConfirm(event)}>검토·확정</button>
                    ) : null}
                    <button className="event-remove" type="button" aria-label={event.label + " 기록 취소"} onClick={() => onRemove(event)}>{event.recordStatus === "draft" ? "폐기" : "취소"}</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
