"use client";

import { Button } from "@/components/ui/button";

import { useState } from "react";

import { addClaimRule, retireClaimRule } from "../../../src/emr-model.js";
import { claimRuleDisplayReference } from "../../../lib/emr/claims.js";
import { today } from "../../../lib/emr/format.js";

const EMPTY_RULE = {
  ruleSetId: "", version: "1", title: "", serviceCode: "", serviceSystem: "", serviceEventType: "procedure",
  windowDays: "365", maxCount: "1", applicabilityCodes: "", applicabilitySystem: "",
  evidenceCodes: "", evidenceEventType: "observation", evidenceSystem: "", evidenceLookbackDays: "",
  effectiveFrom: "", effectiveTo: "", sourceLabel: "", sourceDocumentNumber: "", sourceUrl: "",
};

export function RuleManager({ state, store }) {
  const { applyMutation } = store;
  const [form, setForm] = useState(() => ({ ...EMPTY_RULE, effectiveFrom: today() }));
  const [message, setMessage] = useState("");
  const [endDates, setEndDates] = useState({});

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const rules = [...state.rules].sort((left, right) => left.ruleSetId.localeCompare(right.ruleSetId)
    || right.effectiveFrom.localeCompare(left.effectiveFrom));

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    if (!event.currentTarget.reportValidity()) return;
    const applicabilityCodes = form.applicabilityCodes.split(",").map((value) => value.trim()).filter(Boolean);
    const evidenceCodes = form.evidenceCodes.split(",").map((value) => value.trim()).filter(Boolean);
    const lookbackDays = form.evidenceLookbackDays ? Number.parseInt(form.evidenceLookbackDays, 10) : 0;
    try {
      await applyMutation((current) => addClaimRule(current, {
        ruleSetId: form.ruleSetId,
        version: form.version,
        title: form.title,
        serviceCode: form.serviceCode,
        serviceSystem: form.serviceSystem,
        serviceEventType: form.serviceEventType,
        windowDays: form.windowDays,
        maxCount: form.maxCount,
        applicabilityCodes,
        applicabilitySystem: form.applicabilitySystem,
        requiredEvidence: evidenceCodes.map((code) => ({
          code,
          system: form.evidenceSystem.trim(),
          label: code,
          eventTypes: [form.evidenceEventType],
          lookbackDays,
        })),
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo,
        sourceLabel: form.sourceLabel,
        sourceDocumentNumber: form.sourceDocumentNumber,
        sourceUrl: form.sourceUrl,
        sample: false,
      }), "기관 급여 규칙을 저장했습니다.");
      setForm({ ...EMPTY_RULE, effectiveFrom: today() });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "규칙 저장에 실패했습니다.");
    }
  };

  const retire = async (rule) => {
    const value = endDates[rule.id] ?? rule.effectiveTo ?? today();
    if (!value) return;
    try {
      await applyMutation((current) => retireClaimRule(current, rule.id, value), `급여 규칙 버전 종료일을 ${value}로 저장했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "규칙 종료일을 저장하지 못했습니다.");
    }
  };

  return (
    <details className="clinical-card rule-composer" id="ruleVersionManager">
      <summary><span><b>기관 급여 규칙 버전 관리</b><small>기존 버전을 종료한 뒤 후속 버전을 추가</small></span><span aria-hidden="true">＋</span></summary>
      <div className="rule-version-list" id="ruleVersionList" aria-label="저장된 급여 규칙 버전">
        {rules.length === 0 ? <p className="summary-empty">저장된 급여 규칙이 없습니다.</p> : rules.map((rule) => (
          <article className="rule-version-row" data-rule-version-row={rule.id} key={rule.id}>
            <div className="rule-version-summary">
              <b>{rule.title} · {claimRuleDisplayReference(rule)}</b>
              <span>{(rule.sample
                ? ["기관 내부 규칙", rule.sourceDocumentNumber, `${rule.effectiveFrom} ~ ${rule.effectiveTo || "현재"}`, rule.sourceLabel]
                : [rule.ruleSetId, rule.sourceDocumentNumber, `${rule.effectiveFrom} ~ ${rule.effectiveTo || "현재"}`, rule.sourceLabel]).filter(Boolean).join(" · ")}</span>
            </div>
            <div className="rule-version-actions">
              <label>종료일<input type="date" min={rule.effectiveFrom} value={endDates[rule.id] ?? rule.effectiveTo ?? today()} data-rule-end-date={rule.id}
                onChange={(event) => setEndDates((current) => ({ ...current, [rule.id]: event.target.value }))} /></label>
              <Button type="button" data-retire-rule={rule.id} onClick={() => retire(rule)}>{rule.effectiveTo ? "종료일 수정" : "이 버전 종료"}</Button>
            </div>
          </article>
        ))}
      </div>
      <form id="ruleForm" onSubmit={submit}>
        <div className="rule-form-grid">
          <label>규칙군 ID<input id="ruleSetId" required maxLength={100} pattern="[A-Za-z0-9._-]+" placeholder="예: clinic-bp-followup" value={form.ruleSetId} onChange={set("ruleSetId")} /></label>
          <label>버전<input id="ruleVersion" required maxLength={40} placeholder="예: 2026.1" value={form.version} onChange={set("version")} /></label>
          <label>규칙 이름<input id="ruleTitle" required maxLength={100} placeholder="예: 기관 추적검사 기준" value={form.title} onChange={set("title")} /></label>
          <label>서비스 코드<input id="ruleServiceCode" required maxLength={80} placeholder="EDI 또는 내부코드" value={form.serviceCode} onChange={set("serviceCode")} /></label>
          <label>서비스 코드 시스템<input id="ruleServiceSystem" required maxLength={300} placeholder="EDI URI 또는 urn:기관명:코드체계" value={form.serviceSystem} onChange={set("serviceSystem")} /></label>
          <label>차트 시행 유형<select id="ruleServiceEventType" value={form.serviceEventType} onChange={set("serviceEventType")}><option value="procedure">완료 처치·검사</option><option value="observation">확정 검사결과</option><option value="encounter">종료 내원</option></select></label>
          <label>기준기간(일)<input id="ruleWindowDays" type="number" min={1} max={3650} required value={form.windowDays} onChange={set("windowDays")} /></label>
          <label>최대 횟수<input id="ruleMaxCount" type="number" min={1} max={100} required value={form.maxCount} onChange={set("maxCount")} /></label>
          <label>적용 조건 코드<input id="ruleApplicabilityCodes" maxLength={500} placeholder="쉼표로 구분 · 비우면 전체" value={form.applicabilityCodes} onChange={set("applicabilityCodes")} /></label>
          <label>적용 조건 코드 시스템<input id="ruleApplicabilitySystem" maxLength={300} placeholder="예: KCD URI · 조건 코드가 있으면 필수" value={form.applicabilitySystem} onChange={set("applicabilitySystem")} /></label>
          <label>필수 근거 코드<input id="ruleEvidenceCodes" maxLength={500} placeholder="쉼표로 구분: 85354-9" value={form.evidenceCodes} onChange={set("evidenceCodes")} /></label>
          <label>근거 이벤트 유형<select id="ruleEvidenceEventType" value={form.evidenceEventType} onChange={set("evidenceEventType")}><option value="observation">확정 검사결과</option><option value="condition">활성 진단</option><option value="procedure">완료 처치·검사</option><option value="encounter">종료 내원</option><option value="medication">활성 약물</option><option value="allergy">활성 알레르기</option><option value="symptom">활성 증상</option></select></label>
          <label>근거 코드 시스템<input id="ruleEvidenceSystem" maxLength={300} placeholder="예: http://loinc.org" value={form.evidenceSystem} onChange={set("evidenceSystem")} /></label>
          <label>근거 최근성(일)<input id="ruleEvidenceLookbackDays" type="number" min={1} max={3650} placeholder="비우면 기간 제한 없음" value={form.evidenceLookbackDays} onChange={set("evidenceLookbackDays")} /></label>
          <label>시행일<input id="ruleEffectiveFrom" type="date" required value={form.effectiveFrom} onChange={set("effectiveFrom")} /></label>
          <label>종료일<input id="ruleEffectiveTo" type="date" value={form.effectiveTo} onChange={set("effectiveTo")} /></label>
          <label>공식 출처명<input id="ruleSourceLabel" required maxLength={160} placeholder="고시·기관 검증 문서명" value={form.sourceLabel} onChange={set("sourceLabel")} /></label>
          <label>고시·문서번호<input id="ruleSourceDocumentNumber" maxLength={120} placeholder="예: 고시 제2026-114호" value={form.sourceDocumentNumber} onChange={set("sourceDocumentNumber")} /></label>
          <label className="rule-source-url">공식 출처 URL<input id="ruleSourceUrl" type="url" maxLength={500} placeholder="https://..." value={form.sourceUrl} onChange={set("sourceUrl")} /></label>
        </div>
        <p className="form-message" id="ruleFormMessage" role="alert">{message}</p>
        <Button variant="primary" type="submit">버전형 규칙 저장</Button>
      </form>
    </details>
  );
}
