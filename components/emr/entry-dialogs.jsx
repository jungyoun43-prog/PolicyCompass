"use client";

import { Button } from "@/components/ui/button";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { addEncounterDiagnosis, addEncounterOrder } from "../../src/emr-encounter.js";
import {
  DIAGNOSIS_CATALOG_BOUNDARY,
  findDiagnosisInCatalog,
  KCD_SYSTEM,
  preferredDiagnosisCode,
  searchDiagnosisCatalog,
} from "../../src/diagnosis-catalog.js";
import {
  ORDER_CATALOG_BOUNDARY,
  orderKindLabel,
  searchOrderCatalog,
} from "../../src/order-catalog.js";
import { displayCoding } from "../../lib/emr/format.js";
import { encounterDialogContext, RxDialog, RxSearch } from "./dialog-kit.jsx";


function useLauncherSlot(id) {
  const [slot, setSlot] = useState(null);
  useEffect(() => { setSlot(document.getElementById(id)); }, [id]);
  return slot;
}

function useOpenGuard({ patient, encounter, editable, setStatus, activeDialog, setActiveDialog, name, blockedMessage }) {
  const open = activeDialog === name;
  const requestOpen = () => {
    if (!editable) {
      setStatus(blockedMessage, "error");
      return;
    }
    setActiveDialog(name);
  };
  const close = () => setActiveDialog((current) => (current === name ? "" : current));
  const context = patient && encounter ? encounterDialogContext(patient, encounter) : "환자를 먼저 선택하세요.";
  return { open, requestOpen, close, context };
}

function ResultItem({ heading, category, sub, selected, action, onPick, extra }) {
  return (
    <li className={`rx-result${selected ? " is-selected" : ""}`}>
      <div className="rx-result__heading">
        <b className="rx-result__label">{heading}</b>
        {category ? <span className="dx-result__category">{category}</span> : null}
      </div>
      <span className="rx-result__ingredient">{sub}</span>
      <div className="rx-result__actions">
        <Button variant="primary" type="button" onClick={onPick}>{action}</Button>
      </div>
      {extra}
    </li>
  );
}

export function DiagnosisDialog({ patient, encounter, editable, applyMutation, withDraftPreserved, setStatus, activeDialog, setActiveDialog, registerDirty }) {
  const diagnosisLauncherSlot = useLauncherSlot("entryLauncher-diagnoses");
  const { open, requestOpen, close, context } = useOpenGuard({
    patient, encounter, editable, setStatus, activeDialog, setActiveDialog,
    name: "diagnosis", blockedMessage: "진료를 시작한 뒤 진단을 담을 수 있습니다.",
  });
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState({ role: "primary", code: "", system: KCD_SYSTEM, label: "", certainty: "confirmed" });

  useEffect(() => {
    registerDirty(() => Boolean(form.code.trim() || form.label.trim()));
  }, [registerDirty, form]);

  const results = useMemo(() => searchDiagnosisCatalog(query, 8), [query]);
  const selected = findDiagnosisInCatalog(selectedId);

  const pick = (entry) => {
    setSelectedId(entry.id);
    const preferred = preferredDiagnosisCode(entry);
    setForm((current) => ({ ...current, system: KCD_SYSTEM, code: preferred.code, label: preferred.label }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!patient || !encounter) return;
    if (!form.code.trim() || !form.label.trim()) {
      setStatus("진단 코드와 진단명을 입력하세요.", "error");
      return;
    }
    try {
      await applyMutation(withDraftPreserved((current) => addEncounterDiagnosis(current, patient.id, encounter.id, {
        diagnosisRole: form.role,
        code: form.code,
        system: form.system,
        label: form.label,
        certainty: form.certainty === "confirmed" ? "confirmed" : "provisional",
      })), "진단 초안을 추가했습니다.");
      setForm({ role: "primary", code: "", system: KCD_SYSTEM, label: "", certainty: "confirmed" });
      setSelectedId("");
      close();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "진단을 추가하지 못했습니다.", "error");
    }
  };

  return (
    <>
      {diagnosisLauncherSlot ? createPortal(
        <Button variant="primary" id="openDiagnosisDialog" type="button" aria-haspopup="dialog" onClick={requestOpen}>진단 추가</Button>,
        diagnosisLauncherSlot) : null}
      <RxDialog id="diagnosisDialog" open={open} onClose={close} eyebrow="DIAGNOSIS SEARCH" title="진단 추가" titleId="dxDialogTitle" context={context}
        notice="상병과 코드는 의료진이 선택해 확정합니다. 자동 코딩을 대신하지 않습니다." noticeId="diagnosisNotice">
        <RxSearch id="diagnosisSearchForm" inputId="diagnosisSearchInput" label="진단명 검색" placeholder="진단명·증상·코드 (예: 고혈압, 당뇨, J44)" value={query} onChange={setQuery} />
        <section className="dx-results" aria-labelledby="dxResultsTitle">
          <h4 className="rx-section-title" id="dxResultsTitle">검색 결과 <span className="rx-count" id="diagnosisResultCount">{results.length}건</span></h4>
          <ul className="rx-result-list" id="diagnosisResultList" aria-label="진단명 검색 결과" aria-live="polite">
            {results.length === 0 ? (
              <li className="rx-result-empty">{query.trim() ? "검색어와 맞는 상병이 없습니다. 다른 진단명이나 코드로 다시 검색하세요." : "진단명·증상·코드로 검색하세요."}</li>
            ) : results.map((entry) => (
              <ResultItem key={entry.id} heading={entry.label} category={entry.category}
                sub={`${preferredDiagnosisCode(entry)?.code ?? ""} · 코드 후보 ${entry.codes.length}개`}
                selected={entry.id === selectedId} action="이 상병 선택" onPick={() => pick(entry)} />
            ))}
          </ul>
        </section>
        <form className="inline-clinical-form rx-form" id="diagnosisForm" noValidate autoComplete="off" spellCheck="false" onSubmit={submit}>
          <p className="rx-form__selected" id="diagnosisSelectedSummary">
            {selected ? `${selected.label} · ${form.code} ${form.label}` : "검색 결과에서 진단명을 선택하면 코드 후보가 표시됩니다."}
          </p>
          {selected ? (
            <fieldset className="dx-codes" id="diagnosisCodeChoices">
              <legend className="rx-review__heading">진단 코드 선택</legend>
              <div className="dx-codes__options" id="diagnosisCodeOptions">
                {selected.codes.map((candidate) => (
                  <label className="dx-code-option" key={candidate.code}>
                    <input type="radio" name="diagnosisCodeChoice" value={candidate.code} checked={form.code === candidate.code}
                      onChange={() => setForm((current) => ({ ...current, code: candidate.code, label: candidate.label }))} />
                    <span className="dx-code-option__text"><b>{candidate.code}</b><span>{candidate.label}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="diagnosis-form-grid">
            <label>구분<select id="diagnosisRole" name="role" value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}><option value="primary">주상병</option><option value="secondary">부상병</option></select></label>
            <label>진단 코드<input id="diagnosisCode" name="code" maxLength={80} placeholder="예: I10" required value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} /></label>
            <label className="clinical-system-field">코드 시스템<select id="diagnosisSystem" name="system" value={form.system} onChange={(event) => setForm((current) => ({ ...current, system: event.target.value }))}><option value="urn:kr:kcd">KCD-8 · 한국표준질병사인분류</option><option value="http://hl7.org/fhir/sid/icd-10">ICD-10 · WHO 국제질병분류</option></select></label>
            <label className="clinical-label-field">진단명<input id="diagnosisLabel" name="label" maxLength={160} placeholder="예: 본태성 고혈압" required value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} /></label>
            <label>확실성<select id="diagnosisCertainty" name="certainty" value={form.certainty} onChange={(event) => setForm((current) => ({ ...current, certainty: event.target.value }))}><option value="confirmed">확정</option><option value="provisional">의증·잠정</option></select></label>
            <Button variant="primary" className="rx-form__submit" type="submit">진단 추가</Button>
          </div>
        </form>
      </RxDialog>
    </>
  );
}

export function OrderDialog({ patient, encounter, editable, applyMutation, withDraftPreserved, setStatus, activeDialog, setActiveDialog, registerDirty }) {
  const orderLauncherSlot = useLauncherSlot("entryLauncher-orders");
  const { open, requestOpen, close, context } = useOpenGuard({
    patient, encounter, editable, setStatus, activeDialog, setActiveDialog,
    name: "order", blockedMessage: "진료를 시작한 뒤 오더를 담을 수 있습니다.",
  });
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState({ kind: "laboratory", code: "", system: "", label: "", priority: "routine", instructions: "" });

  useEffect(() => {
    registerDirty(() => Boolean(form.label.trim() || form.instructions.trim()));
  }, [registerDirty, form]);

  const results = useMemo(() => searchOrderCatalog(query, 8), [query]);

  const pick = (entry) => {
    setSelectedId(entry.id);
    setForm({ kind: entry.kind, code: entry.code, system: entry.system, label: entry.label, priority: entry.priority, instructions: entry.instructions });
    requestAnimationFrame(() => document.getElementById("orderPriority")?.focus());
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!patient || !encounter) return;
    if (!form.label.trim()) {
      setStatus("오더명을 입력하세요.", "error");
      return;
    }
    try {
      await applyMutation(withDraftPreserved((current) => addEncounterOrder(current, patient.id, encounter.id, form)), "오더 초안을 추가했습니다.");
      setForm({ kind: "laboratory", code: "", system: "", label: "", priority: "routine", instructions: "" });
      setSelectedId("");
      close();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "오더를 추가하지 못했습니다.", "error");
    }
  };

  return (
    <>
      {orderLauncherSlot ? createPortal(
        <Button variant="primary" id="openOrderDialog" type="button" aria-haspopup="dialog" onClick={requestOpen}>오더 추가</Button>,
        orderLauncherSlot) : null}
      <RxDialog id="orderDialog" open={open} onClose={close} eyebrow="ORDER SEARCH" title="오더 추가" titleId="orderDialogTitle" context={context}
        notice="오더 필요성을 자동으로 판단하지 않습니다. 실제 오더 전송 기능이 아닙니다." noticeId="orderNotice">
        <RxSearch id="orderSearchForm" inputId="orderSearchInput" label="오더 검색" placeholder="오더명·유형·코드 (예: 폐기능, 흉부, 의뢰)" value={query} onChange={setQuery} />
        <section className="dx-results" aria-labelledby="orderResultsTitle">
          <h4 className="rx-section-title" id="orderResultsTitle">검색 결과 <span className="rx-count" id="orderResultCount">{results.length}건</span></h4>
          <ul className="rx-result-list" id="orderResultList" aria-label="오더 검색 결과" aria-live="polite">
            {results.length === 0 ? (
              <li className="rx-result-empty">{query.trim() ? "검색어와 맞는 오더가 없습니다. 오더명이나 유형으로 다시 검색하세요." : "오더명·유형·코드로 검색하세요."}</li>
            ) : results.map((entry) => (
              <ResultItem key={entry.id} heading={entry.label} category={orderKindLabel(entry.kind)}
                sub={displayCoding(entry) || "기관 코드"} selected={entry.id === selectedId} action="이 오더 선택" onPick={() => pick(entry)} />
            ))}
          </ul>
        </section>
        <form className="inline-clinical-form rx-form" id="orderForm" noValidate autoComplete="off" spellCheck="false" onSubmit={submit}>
          <p className="rx-form__selected" id="orderSelectedSummary">
            {selectedId ? `${form.label} · ${orderKindLabel(form.kind)}` : "검색 결과에서 오더를 선택하면 유형과 코드가 채워집니다."}
          </p>
          <div className="order-form-grid">
            <label>오더 유형<select id="orderKind" name="kind" value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}><option value="laboratory">검사</option><option value="imaging">영상</option><option value="procedure">처치</option><option value="referral">의뢰</option></select></label>
            <label className="clinical-label-field">오더명<input id="orderLabel" name="label" maxLength={160} required placeholder="예: 흉부 X-ray" value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} /></label>
            <label>우선순위<select id="orderPriority" name="priority" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}><option value="routine">일반</option><option value="urgent">긴급</option><option value="asap">즉시</option></select></label>
            <label className="clinical-instructions-field">요청사항<input id="orderInstructions" name="instructions" maxLength={500} placeholder="검사 목적·부위·주의사항" value={form.instructions} onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} /></label>
            <Button variant="primary" className="rx-form__submit" type="submit">오더 추가</Button>
          </div>
        </form>
      </RxDialog>
    </>
  );
}

export { DIAGNOSIS_CATALOG_BOUNDARY, ORDER_CATALOG_BOUNDARY };
