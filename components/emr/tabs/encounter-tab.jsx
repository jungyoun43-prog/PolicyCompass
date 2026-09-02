"use client";

import { Button } from "@/components/ui/button";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  cancelEncounter,
  checkInPatient,
  completeEncounter,
  getEncounterRecords,
  reopenEncounter,
  removeEncounterItem,
  saveEncounterDraft,
  signEncounter,
  startEncounter,
} from "../../../src/emr-encounter.js";
import {
  assertEncounterSignReviewContext,
  assertEncounterSignReviewFingerprint,
  assertEncounterSignReviewReady,
  buildEncounterSignReview,
  encounterSignReviewFingerprint,
  encounterSignReviewIdentity,
} from "../../../src/emr-sign-review.js";
import { CLAIM_LANE_LABELS, CLAIM_LANE_ORDER } from "../../../src/claim-rules.js";
import { displayCoding, displayDate, displayTimestamp, prescriptionSummary, QUEUE_LABELS, today } from "../../../lib/emr/format.js";
import { encounterQueueStatus, finalizedPatient } from "../../../lib/emr/selectors.js";
import { labPanel, labPresentation } from "../../../lib/emr/lab-reference.js";
import { DiagnosisDialog, OrderDialog } from "../entry-dialogs.jsx";
import { PrescriptionDialog } from "../prescription-dialog.jsx";

const EMPTY_FORM = {
  date: "", department: "", clinician: "", room: "", chiefComplaint: "",
  subjective: "", objective: "", assessment: "", plan: "",
};

function formFromEncounter(encounter) {
  return {
    date: encounter?.date || today(),
    department: encounter?.department || "",
    clinician: encounter?.clinician || "",
    room: encounter?.room || "",
    chiefComplaint: encounter?.chiefComplaint || "",
    subjective: encounter?.soap?.subjective || "",
    objective: encounter?.soap?.objective || "",
    assessment: encounter?.soap?.assessment || "",
    plan: encounter?.soap?.plan || "",
  };
}

function draftFromForm(form) {
  return {
    date: form.date,
    department: form.department,
    clinician: form.clinician,
    room: form.room,
    chiefComplaint: form.chiefComplaint,
    soap: { subjective: form.subjective, objective: form.objective, assessment: form.assessment, plan: form.plan },
  };
}

function draftDiffers(form, encounter) {
  if (!encounter || encounter.recordStatus !== "draft" || encounter.status !== "in-progress") return false;
  const clean = (value) => String(value ?? "").trim();
  return clean(form.date) !== clean(encounter.date)
    || clean(form.department) !== clean(encounter.department)
    || clean(form.clinician) !== clean(encounter.clinician)
    || clean(form.room) !== clean(encounter.room)
    || clean(form.chiefComplaint) !== clean(encounter.chiefComplaint)
    || clean(form.subjective) !== clean(encounter.soap?.subjective)
    || clean(form.objective) !== clean(encounter.soap?.objective)
    || clean(form.assessment) !== clean(encounter.soap?.assessment)
    || clean(form.plan) !== clean(encounter.soap?.plan);
}

function EncounterEntryList({ id, ariaLabel, entries, emptyLabel, onRemove }) {
  return (
    <ul className="clinical-entry-list" id={id} aria-label={ariaLabel} aria-live="polite">
      {entries.length === 0 ? <li className="encounter-entry-empty">{emptyLabel}</li> : entries.map((entry) => (
        <li className="encounter-entry-row" key={entry.entityId}>
          <div className="encounter-entry-row__body">
            <div className="encounter-entry-row__heading">
              <b>{entry.title}</b>
              {entry.badge ? <span className="event-type-badge">{entry.badge}</span> : null}
              {entry.verdict ? <span className="rx-verdict-chip" data-tone={entry.verdict === "cross" ? "red" : entry.verdict === "triangle" ? "amber" : "green"}>{entry.verdict === "cross" ? "✕ 삭감 위험 높음" : entry.verdict === "triangle" ? "△ 추가 확인" : "○ 위험 낮음"}</span> : null}
            </div>
            <small>{entry.meta}</small>
            {entry.detail ? <p>{entry.detail}</p> : null}
          </div>
          {entry.editable ? (
            <button className="event-remove" type="button" aria-label={`${entry.title} 초안 삭제`} onClick={() => onRemove(entry.entityId)}>삭제</button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function WorkflowDisclosure({ name, title, titleId, summaryText, summaryTone, children }) {
  return (
    <section className="clinical-card clinical-entry-card workflow-disclosure workflow-disclosure--static" aria-labelledby={titleId} data-workflow-disclosure={name}>
      <div className="workflow-disclosure__summary">
        <span className="workflow-disclosure__heading"><span className="workflow-disclosure__title" id={titleId} role="heading" aria-level={3}>{title}</span></span>
        <span className="workflow-disclosure__signals"><span className="entry-launcher-slot" id={`entryLauncher-${name}`}></span><span className="workflow-disclosure__meta" data-disclosure-summary={name} data-tone={summaryTone || undefined}>{summaryText}</span></span>
      </div>
      <div className="workflow-disclosure__body">{children}</div>
    </section>
  );
}

function ClaimMiniSummary({ evaluations, attention }) {
  const counts = Object.fromEntries(CLAIM_LANE_ORDER.map((status) => [status, evaluations.filter((item) => item.status === status).length]));
  return (
    <>
      <p className="claim-preflight-note">예비판정 · 서명 전 초안을 확정 사실과 분리해 가상 반영</p>
      <div className="claim-mini-counts">
        {["missing-evidence", "due-soon", "ready", "waiting", "unknown"].map((status) => (
          <span className={`claim-mini-count claim-mini-count--${status}`} key={status}><b>{counts[status]}</b>{CLAIM_LANE_LABELS[status]}</span>
        ))}
      </div>
      {attention.map((evaluation) => (
        <article className="claim-mini-risk" key={evaluation.id}>
          <b>{evaluation.title}</b>
          <span>{CLAIM_LANE_LABELS[evaluation.status] ?? "확인"}</span>
          <p>{evaluation.explanation}</p>
        </article>
      ))}
      {attention.length === 0 ? <p className="context-ok">현재 규칙에서 즉시 보완할 항목 없음 · 실제 청구 전 담당자 재확인</p> : null}
    </>
  );
}

export function EncounterTab({ state, patient, encounter, preflightEvaluations, store, viewedEncounterId, setViewedEncounterId, selectTab, dirtyGuardsRef, blockClinicalContextChange }) {
  const { applyMutation, setStatus } = store;
  const [form, setForm] = useState(EMPTY_FORM);
  const [formMessage, setFormMessage] = useState("");
  const [signAck, setSignAck] = useState({ identity: null, fingerprint: "", checked: false });
  const [openDisclosures, setOpenDisclosures] = useState(() => new Map());
  const [railTab, setRailTab] = useState("notes");
  const [trendRowId, setTrendRowId] = useState("");
  const [visitSlot, setVisitSlot] = useState(null);
  useEffect(() => { setVisitSlot(document.getElementById("visitContextSlot")); }, []);
  const [activeDialog, setActiveDialog] = useState("");
  // Each entry dialog keeps its own dirty probe; the encounter is dirty when any
  // of them still holds unsubmitted input.
  const dialogProbesRef = useRef(new Map());
  const dialogsDirtyRef = useRef(() => [...dialogProbesRef.current.values()].some((probe) => probe()));
  const registerDirty = useMemo(() => Object.fromEntries(["diagnosis", "prescription", "order"].map((name) => [
    name,
    (probe) => { dialogProbesRef.current.set(name, probe); },
  ])), []);
  const formRef = useRef(form);
  formRef.current = form;

  const status = encounterQueueStatus(encounter);
  const unverifiedBackup = encounter?.source?.kind === "import";
  const editable = status === "in-progress" && encounter?.recordStatus === "draft" && !unverifiedBackup;
  const completed = status === "completed" && !unverifiedBackup;
  const finalized = ["signed", "legacy", "external"].includes(status);
  const records = useMemo(
    () => (encounter ? getEncounterRecords(patient, encounter.id).slice(1) : []),
    [patient, encounter],
  );

  // The workspace re-syncs the draft form from state whenever the chart moves,
  // exactly as the pre-React render() did; dialog mutations preserve unsaved
  // form edits into state first, so nothing typed is lost.
  useEffect(() => { setForm(formFromEncounter(encounter)); }, [encounter]);
  useEffect(() => { setActiveDialog(""); }, [patient?.id, encounter?.id, editable]);

  /** A mutation from a dialog first folds unsaved form edits into the chart. */
  const withDraftPreserved = useCallback((mutator) => (current) => {
    const activePatient = current.patients.find((item) => item.id === current.selectedPatientId);
    const activeEncounter = activePatient?.events.find(({ id }) => id === encounter?.id);
    const base = activeEncounter && draftDiffers(formRef.current, activeEncounter)
      ? saveEncounterDraft(current, activePatient.id, activeEncounter.id, draftFromForm(formRef.current))
      : current;
    return mutator(base);
  }, [encounter]);

  useEffect(() => {
    dirtyGuardsRef.current.composer = () => dialogsDirtyRef.current();
    dirtyGuardsRef.current.encounter = () => dialogsDirtyRef.current() || draftDiffers(formRef.current, encounter);
  }, [dirtyGuardsRef, encounter]);

  const review = useMemo(
    () => (completed ? buildEncounterSignReview(patient, encounter, records) : null),
    [completed, patient, encounter, records],
  );
  const activeIdentity = completed ? encounterSignReviewIdentity(patient, encounter) : null;
  const activeFingerprint = review ? encounterSignReviewFingerprint(review) : "";
  const blockers = review ? [...review.conflicts, ...review.omissions] : [];
  const acknowledged = Boolean(signAck.identity
    && activeIdentity
    && signAck.identity.patientId === activeIdentity.patientId
    && signAck.identity.patientMrn === activeIdentity.patientMrn
    && signAck.identity.encounterId === activeIdentity.encounterId
    && signAck.fingerprint === activeFingerprint
    && signAck.checked);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const guard = (action) => async () => {
    if (!patient || !encounter) return;
    setFormMessage("");
    try {
      await action();
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "작업을 완료하지 못했습니다.");
    }
  };

  const onCheckIn = async () => {
    if (!patient) return;
    setFormMessage("");
    try {
      setViewedEncounterId("");
      await applyMutation((current) => checkInPatient(current, patient.id, {
        date: today(),
        department: formRef.current.department,
        clinician: formRef.current.clinician,
        room: formRef.current.room,
      }), "오늘 진료에 접수했습니다.");
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "접수에 실패했습니다.");
    }
  };

  const onStart = guard(async () => {
    await applyMutation((current) => startEncounter(current, patient.id, encounter.id), "진료를 시작했습니다.");
    requestAnimationFrame(() => document.getElementById("soapSubjective")?.focus());
  });

  const onSaveDraft = guard(async () => {
    await applyMutation((current) => saveEncounterDraft(current, patient.id, encounter.id, draftFromForm(formRef.current)), "SOAP·진료 초안을 저장했습니다.");
  });

  const onComplete = guard(async () => {
    if (blockClinicalContextChange({ composersOnly: true })) return;
    await applyMutation((current) => completeEncounter(current, patient.id, encounter.id, draftFromForm(formRef.current)), "진료를 완료했습니다. 최종 검토 후 서명하세요.");
    queueMicrotask(() => {
      const title = document.getElementById("encounterSignReviewTitle");
      if (!title || title.getClientRects().length === 0) return;
      title.focus();
      title.scrollIntoView({ block: "start" });
    });
  });

  const onSign = async () => {
    if (!patient || !encounter) return;
    try {
      const current = buildEncounterSignReview(patient, encounter, getEncounterRecords(patient, encounter.id).slice(1));
      assertEncounterSignReviewContext(signAck.identity, patient, encounter);
      assertEncounterSignReviewReady(current);
      assertEncounterSignReviewFingerprint(signAck.fingerprint, current);
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "현재 기록을 다시 검토한 뒤 서명하세요.");
      return;
    }
    if (!window.confirm("SOAP·측정·진단·처방·오더를 확정하고 로컬 서명할까요? 서명 후 직접 수정할 수 없습니다.")) return;
    setFormMessage("");
    try {
      await applyMutation((currentState) => {
        const activePatient = currentState.patients.find(({ id }) => id === currentState.selectedPatientId) ?? null;
        const activeEncounter = activePatient?.events.find(({ id }) => id === encounter.id && id === currentState.selectedEncounterId) ?? null;
        assertEncounterSignReviewContext(signAck.identity, activePatient, activeEncounter);
        const latest = buildEncounterSignReview(activePatient, activeEncounter, getEncounterRecords(activePatient, activeEncounter.id).slice(1));
        assertEncounterSignReviewReady(latest);
        assertEncounterSignReviewFingerprint(signAck.fingerprint, latest);
        return signEncounter(currentState, patient.id, encounter.id, encounter.clinician);
      }, "진료를 완료·서명했습니다.");
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "진료 서명에 실패했습니다.");
    }
  };

  const onReopen = guard(async () => {
    await applyMutation((current) => reopenEncounter(current, patient.id, encounter.id), "서명 전 진료를 다시 열었습니다.");
    requestAnimationFrame(() => document.getElementById("soapSubjective")?.focus());
  });

  const onCancel = async () => {
    if (!patient || !encounter) return;
    if (blockClinicalContextChange()) return;
    const reason = window.prompt("진료 취소 사유를 입력하세요. 연결된 초안도 취소됩니다.");
    if (reason === null) return;
    setFormMessage("");
    try {
      await applyMutation((current) => cancelEncounter(current, patient.id, encounter.id, reason), "진료를 취소했습니다.");
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "진료를 취소하지 못했습니다.");
    }
  };

  const onRemoveItem = async (entityId) => {
    try {
      await applyMutation(withDraftPreserved((current) => removeEncounterItem(current, patient.id, encounter.id, entityId)), "진료 초안 항목을 삭제했습니다.");
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "항목을 삭제하지 못했습니다.");
    }
  };

  const contextCount = [form.date, form.department, form.clinician, form.room, form.chiefComplaint]
    .filter((value) => String(value ?? "").trim()).length;
  const soapCount = [form.subjective, form.objective, form.assessment, form.plan]
    .filter((value) => String(value ?? "").trim()).length;
  const entryCounts = {
    measurements: records.filter((event) => event.type === "observation").length,
    diagnoses: records.filter((event) => event.type === "condition").length,
    prescriptions: records.filter((event) => event.type === "medication").length,
    orders: records.filter((event) => event.type === "service-request").length,
  };

  const disclosureKey = (name) => `${patient.id}:${encounter?.id ?? "no-encounter"}:${status}:${name}`;
  // 진료 기본정보는 자동 채움 기본값이라 접힌 한 줄로 시작한다 — 필요할 때만 펼친다.
  const disclosureOpen = (name) => openDisclosures.get(disclosureKey(name)) ?? (name !== "visit-context");
  const onDisclosureToggle = (name, open) => {
    setOpenDisclosures((current) => {
      const next = new Map(current);
      next.set(disclosureKey(name), open);
      return next;
    });
  };

  const attentionStatuses = new Set(["missing-evidence", "due-soon", "unknown"]);
  const attention = preflightEvaluations.filter((item) => attentionStatuses.has(item.status)).slice(0, 3);



  const IMAGING_PATTERN = /X선|엑스레이|CT|MRI|초음파|영상|촬영/i;
  const chartFinal = finalizedPatient(patient);
  const streamEntries = {
    notes: [...chartFinal.events].filter((event) => event.type === "encounter").map((event) => ({
      id: event.id, date: event.date,
      title: [event.department, event.label].filter(Boolean).join(" · ") || "진료",
      clinician: event.clinician,
      chiefComplaint: event.chiefComplaint,
      soap: event.soap,
      note: event.note,
      encounterId: event.id,
    })),
    labs: chartFinal.events.filter((event) => event.type === "observation" || (event.type === "procedure" && !IMAGING_PATTERN.test(event.label ?? ""))).map((event) => ({
      id: event.id, date: event.date, code: event.code,
      title: event.label,
      value: event.type === "procedure" ? "시행" : [event.value, event.unit].filter(Boolean).join(" "),
      ...labPresentation(event),
      panel: event.type === "procedure" ? "시술·검사" : labPanel(event),
    })),
    imaging: chartFinal.events.filter((event) => event.type === "procedure" && IMAGING_PATTERN.test(event.label ?? "")).map((event) => ({
      id: event.id, date: event.date,
      title: event.label,
      detail: event.note || "영상 검사",
    })),
  };
  const labTrend = (code) => streamEntries.labs
    .filter((entry) => entry.code === code)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const streamByDate = (entries) => {
    const groups = new Map();
    for (const entry of [...entries].sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
      const key = entry.date || "날짜 없음";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    return [...groups.entries()];
  };

  const formMessageText = formMessage || (unverifiedBackup
    ? "백업 복원 · 출처 미검증 진료. 진행·수정·완료·서명·취소할 수 없으며 새 로컬 진료로 접수해야 합니다."
    : status === "signed"
      ? `${encounter.signature?.signer || "의료진"} · ${displayTimestamp(encounter.signature?.signedAt)} 로컬 서명 완료. 법적 전자서명 아님.`
      : status === "external"
        ? "외부 완료 기록 · 원본 기관·작성자·전자서명 미검증. 로컬 서명으로 보지 않습니다."
        : status === "legacy"
          ? "이전 버전에서 이관된 완료 기록 · 원본 서명 상태를 별도로 확인하세요."
          : status === "completed"
            ? "진료 완료 · 최종 검토 후 서명하세요. 서명 전에는 다시 열 수 있습니다."
            : status === "waiting"
              ? "접수 완료 · 진료 시작 후 기록할 수 있습니다."
              : status === "none" ? "오늘 접수 후 진료를 시작하세요." : "");

  const dialogShared = {
    patient,
    encounter,
    editable,
    applyMutation,
    withDraftPreserved,
    setStatus,
    activeDialog,
    setActiveDialog,
  };

  return (
    <div className="encounter-layout">
      <div className="encounter-main">

        <form className="encounter-form" id="encounterForm" noValidate autoComplete="off" spellCheck="false" onSubmit={(event) => { event.preventDefault(); onSaveDraft(); }}>

          <section className="clinical-card soap-card workflow-disclosure workflow-disclosure--static" aria-labelledby="soapTitle" data-workflow-disclosure="soap">
            <div className="workflow-disclosure__summary">
              <span className="workflow-disclosure__heading">
                <span className="workflow-disclosure__title" id="soapTitle" role="heading" aria-level={3}>진료 기록</span>
                <span className="workflow-disclosure__meta" data-disclosure-summary="soap" data-tone={status === "completed" && soapCount < 4 ? "attention" : soapCount === 4 ? "ready" : undefined}>{status === "none" || status === "waiting" ? "진료 시작 후 입력" : `${soapCount}/4 작성`}</span>
              </span>
              <span className="workflow-disclosure__signals">
                <div className="encounter-save-actions">
                  <Button variant="danger" id="cancelEncounter" type="button" hidden={unverifiedBackup || !["waiting", "in-progress"].includes(status)} onClick={onCancel}>진료 취소</Button>
                  <Button id="reopenEncounter" type="button" hidden={!completed} onClick={onReopen}>서명 전 재개</Button>
                  <Button id="saveEncounterDraft" type="submit" form="encounterForm" hidden={!editable}>임시 저장</Button>
                  <Button variant="primary" id="completeEncounter" type="button" hidden={!editable} onClick={onComplete}>진료 완료</Button>
                  <Button variant="confirm" id="signEncounter" type="button" hidden={!completed} disabled={blockers.length > 0 || !acknowledged} title={blockers.length ? `서명 전 누락·충돌 ${blockers.length}건을 먼저 수정하세요.` : !acknowledged ? "현재 환자·Encounter와 전체 기록을 확인한 뒤 검토 완료를 선택하세요." : undefined} onClick={onSign}>검토 후 서명</Button>
                </div>
              </span>
            </div>
            <div className="workflow-disclosure__body">
              <div className="soap-grid">
                <label className="soap-field soap-field--full">주호소 · 내원 사유<textarea id="chiefComplaint" name="chiefComplaint" rows={2} maxLength={2000} placeholder="환자의 표현과 증상 시작 시점을 기록하세요." disabled={!editable} value={form.chiefComplaint} onChange={set("chiefComplaint")} /></label>
                <label className="soap-field" data-soap="subjective"><span><b>S</b> Subjective · 주관적 소견</span><textarea id="soapSubjective" name="soapSubjective" rows={4} maxLength={8000} placeholder="환자가 말한 그대로 · 주호소, 증상 발생 시점과 경과, 악화·완화 요인" disabled={!editable} value={form.subjective} onChange={set("subjective")} /></label>
                <label className="soap-field" data-soap="objective"><span><b>O</b> Objective · 객관적 소견</span><textarea id="soapObjective" name="soapObjective" rows={4} maxLength={8000} placeholder="측정한 수치 · 활력징후, 신체검진 소견, 검사·영상 결과값" disabled={!editable} value={form.objective} onChange={set("objective")} /></label>
                <label className="soap-field" data-soap="assessment"><span><b>A</b> Assessment · 평가</span><textarea id="soapAssessment" name="soapAssessment" rows={4} maxLength={8000} placeholder="추정 진단과 상병코드 · 감별진단과 그렇게 본 근거" disabled={!editable} value={form.assessment} onChange={set("assessment")} /></label>
                <label className="soap-field" data-soap="plan"><span><b>P</b> Plan · 계획</span><textarea id="soapPlan" name="soapPlan" rows={4} maxLength={8000} placeholder="치료 계획 · 약물, 추가 검사, 환자 교육, 다음 추적 시점" disabled={!editable} value={form.plan} onChange={set("plan")} /></label>
              </div>
            </div>
          </section>
        </form>

        <div className="entry-grid">

        <WorkflowDisclosure name="diagnoses" title="진단" titleId="diagnosisTitle" badge="KCD · MANUAL" summaryText={`${entryCounts.diagnoses}건`} summaryTone={entryCounts.diagnoses ? "ready" : ""}>
          <DiagnosisDialog {...dialogShared} registerDirty={registerDirty.diagnosis} key={`dx:${patient.id}:${encounter?.id ?? ""}`} />
          <EncounterEntryList id="diagnosisList" ariaLabel="이번 진료 진단 목록" onRemove={onRemoveItem}
            emptyLabel={editable ? "이번 진료 진단을 추가하세요." : "이번 진료 진단 없음"}
            entries={records.filter((event) => event.type === "condition").map((diagnosis) => ({
              entityId: diagnosis.id,
              title: diagnosis.label,
              meta: [diagnosis.diagnosisRole === "primary" ? "주상병" : "부상병", displayCoding(diagnosis)].filter(Boolean).join(" · "),
              detail: diagnosis.note,
              badge: diagnosis.certainty === "provisional" ? "의증" : "확정",
              editable,
            }))} />
        </WorkflowDisclosure>

        <WorkflowDisclosure name="prescriptions" title="처방 기록" titleId="prescriptionTitle" summaryText={`${entryCounts.prescriptions}건`} summaryTone={entryCounts.prescriptions ? "ready" : ""}>
          <PrescriptionDialog {...dialogShared} registerDirty={registerDirty.prescription} key={`rx:${patient.id}:${encounter?.id ?? ""}`} />
          <EncounterEntryList id="prescriptionList" ariaLabel="이번 진료 처방 목록" onRemove={onRemoveItem}
            emptyLabel={editable ? "처방이 필요한 경우 구조화해 추가하세요." : "이번 진료 처방 없음"}
            entries={records.filter((event) => event.type === "medication").map((medication) => {
              const rx = medication.prescription ?? {};
              return {
                entityId: medication.id,
                title: medication.label,
                meta: displayCoding(medication) || "처방 항목",
                detail: [`1회 ${rx.dose ?? "—"}${rx.doseUnit || ""}`, rx.route, rx.frequency, `${rx.durationDays ?? "—"}일`, `총 ${rx.quantity ?? "—"}`, rx.instructions].filter(Boolean).join(" · "),
                badge: medication.recordStatus === "final" ? "확정 처방" : "처방 초안",
                verdict: medication.claimReviewVerdict || "",
                editable,
              };
            })} />
        </WorkflowDisclosure>

        <WorkflowDisclosure name="orders" title="검사·처치·의뢰 오더" titleId="orderTitle" summaryText={`${entryCounts.orders}건`} summaryTone={entryCounts.orders ? "ready" : ""}>
          <OrderDialog {...dialogShared} registerDirty={registerDirty.order} key={`order:${patient.id}:${encounter?.id ?? ""}`} />
          <EncounterEntryList id="orderList" ariaLabel="이번 진료 오더 목록" onRemove={onRemoveItem}
            emptyLabel={editable ? "검사·영상·처치·의뢰 오더를 추가하세요." : "이번 진료 오더 없음"}
            entries={records.filter((event) => event.type === "service-request").map((order) => {
              const evaluation = preflightEvaluations
                .filter((item) => item.rule?.serviceCode === order.code && (!item.rule.serviceSystem || item.rule.serviceSystem === order.system))
                .sort((left, right) => Number(left.status === "not-applicable") - Number(right.status === "not-applicable")
                  || String(right.rule?.effectiveFrom).localeCompare(String(left.rule?.effectiveFrom)))[0] ?? null;
              return {
                entityId: order.id,
                title: order.label,
                meta: [order.order?.kind, displayCoding(order), order.order?.priority].filter(Boolean).join(" · "),
                detail: order.order?.instructions,
                badge: evaluation ? `예비 · ${CLAIM_LANE_LABELS[evaluation.status]}` : "예비 · 기준 확인",
                editable,
              };
            })} />
        </WorkflowDisclosure>
        </div>

        {completed && review ? (
          <section className="clinical-card sign-review" id="encounterSignReview" aria-labelledby="encounterSignReviewTitle">
            <div className="card-heading">
              <div><p className="rail-eyebrow">SIGN-OFF REVIEW</p><h3 id="encounterSignReviewTitle" tabIndex={-1}>서명 전 전체 기록 검토</h3></div>
              <span className="source-badge">서명 차단 조건</span>
            </div>
            <div id="encounterSignReviewContent">
              <div className="sign-review__identity">
                <strong>{review.patient.name}</strong>
                <span>MRN {review.patient.mrn}</span>
                <span>{review.encounter.label} · {review.encounter.date}</span>
                <span>Encounter ID {review.encounter.id}</span>
                <span>{review.encounter.department} · {review.encounter.clinician} · {review.encounter.room}</span>
                <span>주호소 · {review.encounter.chiefComplaint}</span>
              </div>
              <section className="sign-review__alerts" aria-label="서명 전 누락 및 충돌">
                {blockers.length === 0 ? <p className="sign-review__ok">자동 확인에서 누락·이름 일치 충돌을 찾지 못했습니다. 임상적 안전성을 자동 판정한다는 의미는 아닙니다.</p> : null}
                {[...review.conflicts.map((item) => ({ ...item, kind: "충돌" })), ...review.omissions.map((item) => ({ ...item, kind: "누락" }))].map((finding, index) => (
                  <div className="sign-review__finding" key={index}>
                    <p>{finding.kind} · {finding.message}</p>
                    <Button type="button" onClick={async () => {
                      await onReopen();
                      requestAnimationFrame(() => document.getElementById(finding.target)?.focus());
                    }}>{finding.action} — 진료 재개</Button>
                  </div>
                ))}
              </section>
              <div className="sign-review__grid">
                {[
                  ["알레르기", review.allergies.map((item) => item.label), "기록 없음 · 알레르기 상태를 확인하세요."],
                  ["활성 약물", review.activeMedications.map((item) => item.label), "활성 약물 기록 없음"],
                  ["외부·미검증 알레르기", review.unverifiedAllergies.map((item) => `${item.label} · ${item.source?.label || "출처 미검증"}`), "외부·미검증 알레르기 기록 없음"],
                  ["외부·미검증 활성 약물", review.unverifiedActiveMedications.map((item) => `${item.label} · ${item.source?.label || "출처 미검증"}`), "외부·미검증 활성 약물 기록 없음"],
                  ["이번 진료 측정·활력징후", review.measurements.map((item) => `${item.label}: ${item.value ?? "—"} ${item.unit ?? ""}`.trim()), "측정 없음"],
                  ["새 처방", review.prescriptions.map((item) => `${item.label} · ${prescriptionSummary(item.prescription) || "용법 확인 필요"}`), "새 처방 없음"],
                  ["SOAP", [["S", review.soap.subjective], ["O", review.soap.objective], ["A", review.soap.assessment], ["P", review.soap.plan]].map(([part, value]) => `${part} · ${String(value ?? "").trim() || "미입력"}`), "SOAP 없음"],
                  ["KCD 진단", review.diagnoses.map((item) => [item.diagnosisRole === "primary" ? "주" : "부", displayCoding(item), item.label].filter(Boolean).join(" · ")), "진단 없음"],
                  ["오더", review.orders.map((item) => [item.order?.kind || "오더", displayCoding(item), item.label].filter(Boolean).join(" · ")), "오더 없음"],
                ].map(([title, values, emptyLabel]) => (
                  <section className="sign-review__group" key={title}>
                    <h4>{title}</h4>
                    <ul className="sign-review__values">
                      {values.length === 0 ? <li className="sign-review__empty">{emptyLabel}</li> : values.map((value, index) => <li key={index}>{value}</li>)}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
            <label className="sign-review__acknowledge">
              <input type="checkbox" id="encounterSignReviewAcknowledged" disabled={blockers.length > 0} checked={acknowledged} onChange={(event) => {
                setSignAck(event.target.checked
                  ? { identity: activeIdentity, fingerprint: activeFingerprint, checked: true }
                  : { identity: null, fingerprint: "", checked: false });
              }} />
              <span>현재 환자·Encounter의 전체 기록을 확인했으며 서명할 준비가 되었습니다.</span>
            </label>
            <p className="sign-review__status" id="encounterSignReviewAcknowledgementStatus" role="status">
              {blockers.length
                ? `누락 ${review.omissions.length}건·충돌 ${review.conflicts.length}건을 해결해야 검토를 완료할 수 있습니다.`
                : !acknowledged
                  ? "전체 기록을 확인한 뒤 검토 완료를 선택하면 서명할 수 있습니다."
                  : "현재 내용의 검토 완료가 확인됐습니다. 내용이 바뀌면 이 확인은 자동으로 해제됩니다."}
            </p>
          </section>
        ) : null}

        <section className="clinical-card encounter-mobile-claim" aria-labelledby="encounterMobileClaimTitle">
          <div className="card-heading">
            <div><p className="rail-eyebrow">CLAIM READINESS</p><h3 id="encounterMobileClaimTitle">서명 전 급여 점검</h3></div>
            <span className="source-badge">예비 점검</span>
          </div>
          <p className="context-guidance">현재 진료 초안을 가상 반영해 기간·횟수·근거 누락을 먼저 확인합니다.</p>
          <div className="context-summary" id="encounterMobileClaimSummary" aria-live="polite"><ClaimMiniSummary evaluations={preflightEvaluations} attention={attention} /></div>
          <Button className="context-open-button" type="button" onClick={() => selectTab("claims")}>전체 급여 보드 열기</Button>
        </section>

        {/* The actions live in the 진료 기록 card header; this strip only carries the status line. */}
        <section className="encounter-save-bar" aria-labelledby="encounterSignoffTitle">
          <h3 className="visually-hidden" id="encounterSignoffTitle">진료 최종 검토 및 서명</h3>
          <p className="form-message" id="encounterFormMessage" role="status" aria-live="polite">{formMessageText}</p>
        </section>
      </div>

      {visitSlot ? createPortal(<>
        <section className="clinical-card encounter-command-card" aria-label="진료 상태 작업">
          <div className="encounter-quick-actions">
            <Button id="returnCurrentEncounter" type="button" hidden={!viewedEncounterId} onClick={() => {
              if (blockClinicalContextChange()) return;
              setViewedEncounterId("");
            }}>현재 진료로 돌아가기</Button>
            <Button id="checkInPatient" type="button" hidden={!unverifiedBackup && !["none", "signed", "legacy", "external"].includes(status)} onClick={onCheckIn}>
              {finalized || unverifiedBackup ? "새 로컬 진료 접수" : "오늘 접수"}
            </Button>
            <Button variant="primary" id="startEncounter" type="button" hidden={status !== "waiting" || unverifiedBackup} onClick={onStart}>진료 시작</Button>
          </div>
        </section>
          <details className="clinical-card encounter-details workflow-disclosure" aria-labelledby="encounterDetailsTitle" data-workflow-disclosure="visit-context" open={disclosureOpen("visit-context")} onToggle={(event) => onDisclosureToggle("visit-context", event.currentTarget.open)}>
            <summary className="workflow-disclosure__summary">
              <span className="workflow-disclosure__heading"><span className="rail-eyebrow">VISIT CONTEXT</span><span className="workflow-disclosure__title" id="encounterDetailsTitle" role="heading" aria-level={3}>진료 기본정보</span></span>
              <span className="workflow-disclosure__signals"><span className="encounter-state" id="encounterStatus" data-status={status} role="status" aria-label="진료 상태" aria-live="polite" tabIndex={-1}><span className="encounter-state__dot" aria-hidden="true"></span><b id="encounterStatusText">{QUEUE_LABELS[status]}</b></span><span className="workflow-disclosure__meta" data-disclosure-summary="visit-context" data-tone={status === "in-progress" && contextCount < 2 ? "attention" : contextCount > 1 ? "ready" : undefined}>{status === "none" ? "접수 후 입력" : `${contextCount}/5 작성`}</span></span>
            </summary>
            <div className="workflow-disclosure__body">
              <fieldset className="form-fieldset form-fieldset--plain" disabled={!editable}>
                <legend className="visually-hidden">진료 기본정보 입력</legend>
                <div className="encounter-meta-grid">
                  <label>진료일<input id="encounterDate" name="date" type="date" required lang="ko" value={form.date} onChange={set("date")} />{typeof navigator !== "undefined" && !String(navigator.language).toLowerCase().startsWith("ko") && form.date ? <small className="field-echo">{displayDate(form.date)}</small> : null}</label>
                  <label>진료과<input id="encounterDepartment" name="department" maxLength={80} placeholder="예: 내과" value={form.department} onChange={set("department")} /></label>
                  <label>담당 의료진<input id="encounterClinician" name="clinician" maxLength={80} placeholder="예: 김의사" value={form.clinician} onChange={set("clinician")} /></label>
                  <label>진료실<input id="encounterRoom" name="room" maxLength={40} placeholder="예: 1진료실" value={form.room} onChange={set("room")} /></label>
                </div>
              </fieldset>
            </div>
          </details>
      </>, visitSlot) : null}

      <aside className="encounter-context-rail" aria-label="환자 맥락과 진료 안전 정보">
        <section className="clinical-card context-card context-card--stream" aria-labelledby="patientStreamTitle">
          <div className="card-heading">
            <div><p className="rail-eyebrow">PATIENT STREAM</p><h3 id="patientStreamTitle">환자 기록</h3></div>
          </div>
          <div className="stream-tabs" role="group" aria-label="기록 스트림 선택">
            {[["notes", "일지"], ["labs", "검사"], ["imaging", "영상"]].map(([key, label]) => (
              <button key={key} type="button" className="stream-tab" aria-pressed={railTab === key} onClick={() => setRailTab(key)}>
                {label} <small>{streamEntries[key].length}</small>
              </button>
            ))}
          </div>
          <div className="stream-scroll" aria-live="polite">
            {streamByDate(streamEntries[railTab]).length === 0 ? (
              <p className="stream-empty">{railTab === "imaging" ? "확정된 영상 검사가 없습니다." : railTab === "labs" ? "확정된 검사 결과가 없습니다." : "완료된 진료 일지가 없습니다."}</p>
            ) : railTab === "notes" ? (
              streamByDate(streamEntries.notes).map(([date, entries]) => (
                <section className="stream-day" key={date}>
                  <h4 className="stream-day__date">{displayDate(date)}</h4>
                  {entries.map((entry) => (
                    <article className="stream-note" key={entry.id}>
                      <header className="stream-note__head">
                        <b>{entry.title}</b>
                        {entry.clinician ? <span>{entry.clinician}</span> : null}
                        <Button variant="text" type="button" disabled={entry.encounterId === encounter?.id} onClick={() => {
                          if (blockClinicalContextChange()) return;
                          setViewedEncounterId(entry.encounterId);
                        }}>{entry.encounterId === encounter?.id ? "열림" : "열기"}</Button>
                      </header>
                      {entry.chiefComplaint ? <p className="stream-note__cc">주호소 · {entry.chiefComplaint}</p> : null}
                      {[["S", entry.soap?.subjective], ["O", entry.soap?.objective], ["A", entry.soap?.assessment], ["P", entry.soap?.plan]]
                        .filter(([, text]) => text)
                        .map(([letter, text]) => (
                          <p className="stream-note__soap" key={letter}><b>{letter}</b>{text}</p>
                        ))}
                      {!entry.chiefComplaint && !entry.soap?.subjective && !entry.soap?.objective && !entry.soap?.assessment && !entry.soap?.plan && entry.note ? (
                        <p className="stream-note__cc">{entry.note}</p>
                      ) : null}
                    </article>
                  ))}
                </section>
              ))
            ) : railTab === "labs" ? (
              streamByDate(streamEntries.labs).map(([date, entries]) => {
                const panels = new Map();
                for (const entry of entries) {
                  if (!panels.has(entry.panel)) panels.set(entry.panel, []);
                  panels.get(entry.panel).push(entry);
                }
                return (
                  <section className="lab-day" key={date}>
                    <h4 className="lab-day__date">{displayDate(date)}</h4>
                    <div className="lab-day__panels">
                      {[...panels.entries()].map(([panel, rows]) => (
                        <div className="lab-panel" key={panel}>
                          <h5 className="lab-panel__name">{panel}</h5>
                          {rows.map((row) => (
                            <div className="lab-row-wrap" key={row.id}>
                              <div className="lab-row" data-flag={row.flag || undefined}>
                                <span className="lab-row__name">{row.title}</span>
                                <b className="lab-row__value">{row.value}</b>
                                <span className="lab-row__reference">{row.reference}</span>
                                <span className="lab-row__flag">{row.flag}</span>
                                <button className="lab-row__trend" type="button" aria-expanded={trendRowId === row.id}
                                  onClick={() => setTrendRowId((current) => (current === row.id ? "" : row.id))}>추이</button>
                              </div>
                              {trendRowId === row.id ? (
                                <ol className="lab-trend">
                                  {labTrend(row.code).map((point) => (
                                    <li key={point.id} data-flag={point.flag || undefined}>
                                      <span>{displayDate(point.date)}</span>
                                      <b>{point.value}</b>
                                      <em>{point.flag}</em>
                                    </li>
                                  ))}
                                </ol>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })
            ) : (
              streamByDate(streamEntries.imaging).map(([date, entries]) => (
                <section className="stream-day" key={date}>
                  <h4 className="stream-day__date">{displayDate(date)}</h4>
                  <ol className="stream-day__list">
                    {entries.map((entry) => (
                      <li key={entry.id}><b>{entry.title}</b><span>{entry.detail}</span></li>
                    ))}
                  </ol>
                </section>
              ))
            )}
          </div>
          <Button variant="text" type="button" onClick={() => selectTab("chart")}>전체 기록 보기</Button>
        </section>

      </aside>
    </div>
  );
}
