"use client";

import { Button } from "@/components/ui/button";

import { Fragment, useEffect, useMemo, useState } from "react";

import { addEncounterPrescription } from "../../src/emr-encounter.js";
import {
  findMedicationInCatalog,
  searchMedicationCatalog,
} from "../../src/medication-catalog.js";
import {
  applyMedicationReviewDraft,
  buildMedicationClaimComparison,
  MEDICATION_REVIEW_VERDICTS,
} from "../../src/medication-claim-review.js";
import { medicationReviewInstructions, medicationReviewModelPayload } from "../../src/medication-review-prompt.js";
import { displayDate, INSURANCE_LABELS, SEX_LABELS, today } from "../../lib/emr/format.js";
import { encounterDialogContext, HoverPopover, RxDialog, RxSearch } from "./dialog-kit.jsx";

const MEDICATION_REVIEW_ENDPOINT = "/api/medication-claim-review";
const HIGHLIGHT_PAIR_COLORS = 5;

const EMPTY_RX_FORM = {
  code: "", system: "", name: "", dose: "", doseUnit: "정", route: "경구",
  frequency: "1일 1회", durationDays: "", quantity: "", instructions: "",
};

function phrasesOverlap(left, right) {
  return left === right || left.includes(right) || right.includes(left);
}

/** One colour per matched fact, running across the whole review. */
function buildHighlightPairs(check, counter) {
  const chartPhrases = [...new Set((check.chart.findings ?? []).flatMap(({ highlights }) => highlights ?? []).filter(Boolean))];
  const pairs = new Map();
  for (const { rule, chart } of check.source.pairs ?? []) {
    if (pairs.has(rule)) continue;
    const tone = counter.next % HIGHLIGHT_PAIR_COLORS;
    counter.next += 1;
    pairs.set(rule, tone);
    pairs.set(chart, tone);
    for (const candidate of chartPhrases) {
      if (!pairs.has(candidate) && phrasesOverlap(chart, candidate)) pairs.set(candidate, tone);
    }
  }
  return pairs;
}

function HighlightedText({ text, highlights = [], pairs = new Map() }) {
  const phrases = [...new Set(highlights.filter(Boolean))];
  const nodes = [];
  let rest = String(text ?? "");
  let key = 0;
  while (rest) {
    let bestIndex = -1;
    let bestPhrase = "";
    for (const phrase of phrases) {
      const index = rest.indexOf(phrase);
      if (index !== -1 && (bestIndex === -1 || index < bestIndex || (index === bestIndex && phrase.length > bestPhrase.length))) {
        bestIndex = index;
        bestPhrase = phrase;
      }
    }
    if (bestIndex === -1) {
      nodes.push(rest);
      break;
    }
    if (bestIndex > 0) nodes.push(rest.slice(0, bestIndex));
    nodes.push(
      <mark className="rx-source__mark-text" data-pair={pairs.has(bestPhrase) ? String(pairs.get(bestPhrase)) : undefined} key={key++}>{bestPhrase}</mark>,
    );
    rest = rest.slice(bestIndex + bestPhrase.length);
  }
  return <>{nodes}</>;
}

const INTERNAL_RECORD_TERMS = new Set(["코드 시스템", "기록 ID", "연결 진료 ID", "기록 출처"]);

/**
 * Clinician-facing code: keep clinical codes (KCD, LOINC), drop the internal
 * namespace prefix and hide synthetic internal identifiers entirely.
 */
function displayRecordCode(code) {
  const bare = String(code ?? "").split("|").pop().trim();
  if (!bare || /^(PC-|DEMO-)/i.test(bare)) return "";
  return bare;
}

function clinicianRecordRows(rows) {
  return rows.filter(([term, value]) => {
    if (INTERNAL_RECORD_TERMS.has(term)) return false;
    if (term === "코드" && !displayRecordCode(value)) return false;
    return true;
  });
}

function medicationDetailRows(medication) {
  return [
    ["계열", medication.classLabel],
    ["적응증", medication.indication || "등록된 적응증 없음"],
    ["급여 인정 상병", medication.coverage.indications.map(({ code, label }) => `${code} ${label}`).join(", ") || "등록된 인정 상병 없음"],
    ["기본 용법", `1회 ${medication.dosing.dose}${medication.dosing.doseUnit} · ${medication.dosing.route} · ${medication.dosing.frequency} · ${medication.dosing.durationDays}일 · 총 ${medication.dosing.quantity}`],
    ["복약 안내", medication.dosing.instructions || "등록된 복약 안내 없음"],
    ["인정 일수", medication.coverage.maxDurationDays ? `1회 최대 ${medication.coverage.maxDurationDays}일` : "등록된 인정 일수 없음"],
  ];
}

function medicationReviewTransmission(review) {
  const findings = review.checks.reduce((total, item) => total + item.chart.findings.filter(({ eventId }) => eventId).length, 0);
  return [
    ["약품", `${review.medication.label} · ${review.medication.ingredient}`],
    ["이번 처방", [
      review.prescription.dose ? `1회 ${review.prescription.dose}${review.prescription.doseUnit}` : "",
      review.prescription.route,
      review.prescription.frequency,
      review.prescription.durationDays ? `${review.prescription.durationDays}일` : "",
    ].filter(Boolean).join(" · ") || "용법 미입력"],
    ["환자 컨텍스트", [
      Number.isInteger(review.patient.ageYears) ? `만 ${review.patient.ageYears}세` : "나이 미상",
      SEX_LABELS[review.patient.sex] ?? "성별 미상",
      INSURANCE_LABELS[review.patient.insuranceType] ?? INSURANCE_LABELS.unknown,
      `확인 상병 ${review.patient.conditionCount}건`,
    ].join(" · ")],
    ["대조 자료", `등록 기준 ${review.checks.length}개 · 연결된 차트 기록 ${findings}건`],
    ["전송하지 않음", "환자 이름·등록번호·연락처·주소·자유 메모"],
  ];
}

function DetailList({ rows }) {
  return (
    <dl className="rx-detail-list">
      {rows.map(([term, value]) => (
        <Fragment key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function PrescriptionDialog({ patient, encounter, editable, applyMutation, withDraftPreserved, setStatus, activeDialog, setActiveDialog, registerDirty }) {
  const open = activeDialog === "prescription";
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(EMPTY_RX_FORM);
  const [selectedMedicationId, setSelectedMedicationId] = useState("");
  const [review, setReview] = useState(null);
  const [pendingReview, setPendingReview] = useState(null);
  const [reviewBusyId, setReviewBusyId] = useState("");
  const [reviewPreview, setReviewPreview] = useState(null);
  const [capability, setCapability] = useState({ checked: false, local: false, frontier: false, model: "" });
  const [expandedDetails, setExpandedDetails] = useState(() => new Set());
  const [expandedSources, setExpandedSources] = useState(() => new Set());
  const [expandedChecks, setExpandedChecks] = useState(() => new Set());

  useEffect(() => {
    registerDirty(() => Boolean(form.name.trim() || form.dose.trim() || form.instructions.trim()));
  }, [registerDirty, form]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${MEDICATION_REVIEW_ENDPOINT}/status`, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("status");
        const result = await response.json();
        if (cancelled) return;
        setCapability({
          checked: true,
          local: result?.local?.configured === true,
          frontier: result?.frontier?.configured === true,
          model: String(result?.local?.model || result?.frontier?.model || ""),
        });
      } catch {
        if (!cancelled) setCapability({ checked: true, local: false, frontier: false, model: "" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const provider = capability.local ? "local" : capability.frontier ? "frontier" : "";
  const results = useMemo(() => searchMedicationCatalog(query, 8), [query]);
  const context = patient && encounter ? encounterDialogContext(patient, encounter) : "환자를 먼저 선택하세요.";

  const requestOpen = () => {
    if (!editable) {
      setStatus("진료를 시작한 뒤 처방을 담을 수 있습니다.", "error");
      return;
    }
    setReview(null);
    setPendingReview(null);
    setExpandedSources(new Set());
    setExpandedChecks(new Set());
    setActiveDialog("prescription");
  };
  const close = () => setActiveDialog((current) => (current === "prescription" ? "" : current));

  const pickMedication = (medication) => {
    setSelectedMedicationId(medication.id);
    setForm({
      code: medication.code,
      system: medication.system,
      name: medication.label,
      dose: medication.dosing.dose,
      doseUnit: medication.dosing.doseUnit,
      route: medication.dosing.route,
      frequency: medication.dosing.frequency,
      durationDays: String(medication.dosing.durationDays),
      quantity: String(medication.dosing.quantity),
      instructions: medication.dosing.instructions,
    });
    requestAnimationFrame(() => {
      document.getElementById("prescriptionForm")?.scrollIntoView({ block: "end", behavior: "smooth" });
      document.getElementById("medicationDose")?.focus({ preventScroll: true });
    });
  };

  const currentDosing = (medication) => (selectedMedicationId === medication.id
    ? { dose: form.dose, doseUnit: form.doseUnit, route: form.route, frequency: form.frequency, durationDays: form.durationDays, quantity: form.quantity, instructions: form.instructions }
    : medication.dosing);

  const runReview = async (medicationId) => {
    const medication = findMedicationInCatalog(medicationId);
    if (!medication || !patient || reviewBusyId) return;
    let base;
    try {
      base = buildMedicationClaimComparison({
        patient,
        medication,
        prescription: currentDosing(medication),
        encounterId: encounter?.id ?? "",
        asOf: today(),
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "약제 사전점검을 만들지 못했습니다.", "error");
      return;
    }
    setExpandedSources(new Set());
    setExpandedChecks(new Set());
    if (!provider) {
      setReview({ medicationId, ...base });
      setStatus("규칙 기반 사전점검을 완료했습니다.");
      return;
    }
    // 서버로 보내기 전에 전송 항목(진료데이터·고시정보·프롬프트)을 사람이 확인한다.
    setReviewPreview({ medicationId, name: medication.label, base });
  };

  const sendReview = async () => {
    if (!reviewPreview) return;
    const { medicationId, name, base } = reviewPreview;
    setReviewPreview(null);
    // 판정은 모델 검토까지 끝난 뒤에만 보여 준다. 그동안은 진행 상태를 표시한다.
    setReview(null);
    setPendingReview({ medicationId, name });
    setReviewBusyId(medicationId);
    try {
      const response = await fetch(MEDICATION_REVIEW_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ comparison: base, provider }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "AI 검토를 사용할 수 없습니다.");
      const merged = applyMedicationReviewDraft(base, result.draft ?? {});
      setReview({ medicationId, ...merged });
      setStatus("AI 검토를 완료했습니다.", "success");
    } catch (error) {
      setReview({ medicationId, ...base });
      setStatus(`${error instanceof Error ? error.message : "AI 검토 연결 실패"} 규칙 기반 사전점검을 유지합니다.`);
    } finally {
      setPendingReview(null);
      setReviewBusyId("");
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!patient || !encounter) return;
    if (!form.name.trim()) {
      setStatus("약품명을 입력하세요.", "error");
      return;
    }
    try {
      await applyMutation(withDraftPreserved((current) => addEncounterPrescription(current, patient.id, encounter.id, {
        code: form.code,
        system: form.system,
        label: form.name,
        dose: form.dose,
        doseUnit: form.doseUnit,
        route: form.route,
        frequency: form.frequency,
        durationDays: form.durationDays,
        quantity: form.quantity,
        instructions: form.instructions,
        claimReviewVerdict: review && review.medicationId === selectedMedicationId ? review.verdict : undefined,
      })), "처방 초안을 추가했습니다.");
      setForm(EMPTY_RX_FORM);
      setSelectedMedicationId("");
      close();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "처방을 추가하지 못했습니다.", "error");
    }
  };

  const cloudLabel = provider === "frontier"
    ? `클라우드 LLM 규칙 재검토 · ${capability.model || "연결된 모델"}`
    : provider === "local"
      ? "LLM 규칙 재검토 · 이 기기의 로컬 모델"
      : "클라우드 LLM 규칙 재검토 · 모델 미설정";

  const reviewModeLabel = review && review.generatedBy !== "rule"
    ? `AI 검토 · ${review.model || review.generatedBy}`
    : provider
      ? `AI 검토 가능 · ${provider === "local" ? "로컬 모델" : capability.model || "연결된 모델"}`
      : "규칙 기반 · 모델 미설정";

  const pairCounter = { next: 0 };

  return (
    <>
      <div className="prescription-launcher">
        <Button variant="primary" id="openPrescriptionDialog" type="button" aria-haspopup="dialog" onClick={requestOpen}>약 처방하기</Button>
        <p className="prescription-launcher__hint">약을 검색하고 <b>AI 검토</b>로 이 환자 기록과 등록된 급여기준을 대조한 뒤 이번 진료에 담습니다.</p>
      </div>
      <RxDialog id="prescriptionDialog" open={open} onClose={close} eyebrow="PRESCRIPTION SEARCH" title="약 처방하기" titleId="rxDialogTitle" context={context}
        notice="급여 인정이나 삭감을 확정하지 않습니다. 용법·상호작용·금기 판단과 최종 처방 결정은 의료진에게 있습니다." noticeId="prescriptionNotice"
        headerExtra={review ? (
          <HoverPopover hostClassName="rx-process" trigger="검토 과정 확인하기" triggerClassName="rx-process__summary" triggerId="medicationReviewProcessSummary"
            panelId="medicationReviewPipeline" panelClassName="rx-process__body"
            panel={(
              <>
                <ol className="rx-pipeline">
                  {[
                    ["1", "이 브라우저에서 규칙 대조", "선택 환자의 확정 차트와 등록된 급여기준을 항목별로 맞춥니다."],
                    ["2", "대조 결과 전송", `같은 출처 API ${MEDICATION_REVIEW_ENDPOINT}로 아래 내역만 보냅니다.`],
                    ["3", cloudLabel, "기준 문구와 환자 기록을 다시 대조해 판정과 근거 문장을 작성합니다."],
                    ["4", "판정·근거·출처 반환", "규칙 판정보다 관대한 답과 없는 근거 인용은 서버가 되돌립니다."],
                  ].map(([index, title, detail]) => (
                    <li className="rx-pipeline__step" key={index}>
                      <span className="rx-pipeline__index">{index}</span>
                      <span className="rx-pipeline__text"><b>{title}</b><span>{detail}</span></span>
                    </li>
                  ))}
                </ol>
                <details className="rx-pipeline__payload">
                  <summary className="rx-result__details-summary">전송 내역 보기</summary>
                  <DetailList rows={medicationReviewTransmission(review)} />
                </details>
                {!provider ? (
                  <p className="rx-review__boundary">지금은 모델이 설정되지 않아 2~3단계를 실행하지 않았습니다. 환자 자료를 전송하지 않고 규칙 판정만 표시합니다.</p>
                ) : null}
              </>
            )} />
        ) : null}>

        <RxSearch id="medicationSearchForm" inputId="medicationSearchInput" label="약품 검색" placeholder="약품명·성분명·계열·상병코드 (예: 암로디핀, 흡입제, J44)" value={query} onChange={setQuery} />

        <div className="rx-dialog__columns">
          <section className="rx-results" aria-labelledby="rxResultsTitle">
            <h4 className="rx-section-title" id="rxResultsTitle">검색 결과 <span className="rx-count" id="medicationResultCount">{results.length}건</span></h4>
            <ul className="rx-result-list" id="medicationResultList" aria-label="약품 검색 결과" aria-live="polite">
              {results.length === 0 ? (
                <li className="rx-result-empty">{query.trim() ? "검색어와 맞는 약품이 없습니다. 성분명이나 계열로 다시 검색하세요." : "약품명·성분명·계열·상병코드로 검색하세요."}</li>
              ) : results.map((medication) => {
                const rowReview = review?.medicationId === medication.id ? review : null;
                return (
                  <li className={`rx-result${medication.id === selectedMedicationId ? " is-selected" : ""}${reviewBusyId === medication.id ? " is-reviewing" : ""}`} data-review-tone={rowReview?.verdictTone || undefined} key={medication.id}>
                    <div className="rx-result__heading">
                      <b className="rx-result__label">{medication.label}</b>
                    </div>
                    <span className="rx-result__ingredient">{medication.ingredient}</span>
                    <div className="rx-result__actions">
                      <Button variant="primary" type="button" onClick={() => pickMedication(medication)}>처방 담기</Button>
                      <span className="rx-result__actions-divider"></span>
                      <Button className="rx-result__review" type="button" disabled={reviewBusyId === medication.id} onClick={() => runReview(medication.id)}>
                        {reviewBusyId === medication.id ? "검토 중…" : "AI 검토"}
                      </Button>
                    </div>
                    <details className="rx-result__details" open={expandedDetails.has(medication.id)} onToggle={(event) => {
                      const isOpen = event.currentTarget.open;
                      setExpandedDetails((current) => {
                        const next = new Set(current);
                        if (isOpen) next.add(medication.id);
                        else next.delete(medication.id);
                        return next;
                      });
                    }}>
                      <summary className="rx-result__details-summary">
                        자세히 보기
                        {rowReview ? <span className="rx-verdict-chip" data-tone={rowReview.verdictTone} onClick={(event) => event.preventDefault()}>{rowReview.verdictSymbol} {rowReview.verdictLabel}</span> : null}
                      </summary>
                      <DetailList rows={medicationDetailRows(medication)} />
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rx-review" aria-labelledby="rxReviewTitle">
            <h4 className="rx-section-title" id="rxReviewTitle">AI 삭감 사전검토 <span className="rx-count" id="medicationReviewMode">{reviewModeLabel}</span></h4>
            {pendingReview ? (
              <div className="rx-review__progress" id="medicationReviewProgress" role="status" aria-live="polite">
                <span className="rx-review__spinner" aria-hidden="true"></span>
                <div className="rx-review__progress-text">
                  <b>AI 검토 중 · {pendingReview.name}</b>
                  <span>{cloudLabel}이 기준 문구와 환자 기록을 다시 대조하고 있습니다. 검토가 끝나면 판정과 근거를 함께 보여 드립니다.</span>
                  <ol className="rx-pipeline rx-pipeline--progress">
                    {[
                      ["1", "규칙 대조 완료", "done"],
                      ["2", "대조 결과 전송", "done"],
                      ["3", "모델 재검토 중", "active"],
                      ["4", "판정·근거 반환", "waiting"],
                    ].map(([index, title, state]) => (
                      <li className="rx-pipeline__step" data-state={state} key={index}>
                        <span className="rx-pipeline__index">{state === "done" ? "✓" : index}</span>
                        <span className="rx-pipeline__text"><b>{title}</b></span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            ) : !review ? (
              <p className="rx-review__empty" id="medicationReviewEmpty">검색 결과에서 <b>AI 검토</b>를 누르면 이 환자의 기록과 등록된 급여기준을 항목별로 대조해 삭감 위험을 ○·△·✕로 보여 줍니다.</p>
            ) : (
              <div className="rx-review__body" id="medicationReviewBody" aria-live="polite">
                <div className="rx-verdict" id="medicationReviewVerdict" data-tone={review.verdictTone}>
                  <span className="rx-verdict__symbol">{review.verdictSymbol}</span>
                  <span className="rx-verdict__text">
                    <b>{review.verdictLabel}</b>
                    <span>{review.summary}</span>
                    {review.note ? <span className="rx-verdict__note">{review.note}</span> : null}
                  </span>
                </div>
                <section className="rx-review__section">
                  <h5 className="rx-review__heading">판정 근거 · 삭감 근거와 환자 정보 대조</h5>
                  <ul className="rx-source-list" id="medicationReviewSources">
                    {review.checks.map((check) => {
                      const pairs = buildHighlightPairs(check, pairCounter);
                      const chartRecords = check.chart.findings.filter(({ record }) => Array.isArray(record) && record.length);
                      const sourceOpen = expandedSources.has(check.id);
                      const toggleSource = () => setExpandedSources((current) => {
                        const next = new Set(current);
                        if (next.has(check.id)) next.delete(check.id);
                        else next.add(check.id);
                        return next;
                      });
                      const passed = check.verdict === "circle";
                      const bodyOpen = !passed || expandedChecks.has(check.id);
                      const toggleCheck = () => setExpandedChecks((current) => {
                        const next = new Set(current);
                        if (next.has(check.id)) next.delete(check.id);
                        else next.add(check.id);
                        return next;
                      });
                      return (
                        <li className="rx-source" data-verdict={check.verdict} data-collapsed={passed && !bodyOpen ? "" : undefined} key={check.id}>
                          {passed ? (
                            <button className="rx-source__title rx-source__title--toggle" type="button" aria-expanded={bodyOpen} onClick={toggleCheck}>
                              <span className="rx-source__mark">{MEDICATION_REVIEW_VERDICTS[check.verdict].symbol}</span>
                              <b>{check.title}</b>
                              <span className="rx-source__summary-line">{check.chart.detail}</span>
                              <span className="rx-source__caret" aria-hidden="true">{bodyOpen ? "▲" : "▼"}</span>
                            </button>
                          ) : (
                            <div className="rx-source__title">
                              <span className="rx-source__mark">{MEDICATION_REVIEW_VERDICTS[check.verdict].symbol}</span>
                              <b>{check.title}</b>
                            </div>
                          )}
                          {bodyOpen ? (<>
                          <div className="rx-source__grid">
                            <div className="rx-source__cell">
                              <span className="rx-source__cell-label">삭감 근거</span>
                              <b>{check.criterion.requirement}</b>
                              <span className="rx-source__cell-detail">{check.criterion.detail}</span>
                            </div>
                            <div className="rx-source__cell">
                              <span className="rx-source__cell-label">환자 정보</span>
                              <b>{check.chart.detail}</b>
                              <ul className="rx-source__findings">
                                {check.chart.findings.length === 0 ? <li className="rx-source__findings-empty">대조된 환자 기록 없음</li> : check.chart.findings.map((record, index) => (
                                  <li key={index}>
                                    <b>{record.label}</b>
                                    <span>{[displayRecordCode(record.code), record.date ? displayDate(record.date) : "", record.provenance, record.detail].filter(Boolean).join(" · ")}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                          {(check.source.excerpt || chartRecords.length) ? (
                            <>
                              <button className="rx-source__origin-trigger" type="button" data-source-origin={check.id} aria-expanded={sourceOpen} onClick={toggleSource}>원문 확인</button>
                              <div className="rx-source__origins" hidden={!sourceOpen}>
                                {check.source.excerpt ? (
                                  <div className="rx-source__pane">
                                    <h6 className="rx-source__pane-title">기준 원문</h6>
                                    {check.source.article ? <p className="rx-source__article">{check.source.article}</p> : null}
                                    <blockquote className="rx-source__excerpt"><HighlightedText text={check.source.excerpt} highlights={check.source.highlights} pairs={pairs} /></blockquote>
                                  </div>
                                ) : null}
                                {chartRecords.length ? (
                                  <div className="rx-source__pane">
                                    <h6 className="rx-source__pane-title">환자 기록 원문</h6>
                                    {chartRecords.slice(0, 3).map((item, index) => (
                                      <Fragment key={index}>
                                        <p className="rx-source__article">{item.label}{item.provenance ? ` · ${item.provenance}` : ""}</p>
                                        <dl className="rx-detail-list rx-source__record">
                                          {clinicianRecordRows(item.record).map(([term, value]) => (
                                            <Fragment key={term}>
                                              <dt>{term}</dt>
                                              <dd><HighlightedText text={value} highlights={item.highlights} pairs={pairs} /></dd>
                                            </Fragment>
                                          ))}
                                        </dl>
                                      </Fragment>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </>
                          ) : null}
                          {sourceOpen ? (
                            <p className="rx-source__document">{[
                              check.source.documentNumber,
                              check.source.version ? `v${check.source.version}` : "",
                              check.source.effectiveFrom ? `시행 ${check.source.effectiveFrom}` : "",
                            ].filter(Boolean).join(" · ")}</p>
                          ) : null}
                          </>) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </div>
            )}
          </section>
        </div>

        <form className="inline-clinical-form rx-form" id="prescriptionForm" noValidate autoComplete="off" spellCheck="false" onSubmit={submit}>
          <p className="rx-form__selected" id="medicationSelectedSummary">
            {selectedMedicationId
              ? `${form.name} · ${findMedicationInCatalog(selectedMedicationId)?.ingredient ?? ""}`
              : "검색 결과에서 약을 선택하면 기본 용법이 채워집니다. 용법은 의료진이 직접 확인하고 수정하세요."}
          </p>
          <div className="prescription-form-grid">
            <label className="clinical-label-field">약품명<input id="medicationName" name="name" maxLength={160} required placeholder="약품명" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>1회 용량<input id="medicationDose" name="dose" maxLength={40} inputMode="decimal" placeholder="예: 1" value={form.dose} onChange={(event) => setForm((current) => ({ ...current, dose: event.target.value }))} /></label>
            <label>용량 단위<select id="medicationDoseUnit" name="doseUnit" value={form.doseUnit} onChange={(event) => setForm((current) => ({ ...current, doseUnit: event.target.value }))}>{["정", "캡슐", "포", "mg", "g", "mL", "흡입", "앰플", "바이알", "패치", "방울"].map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
            <label>투여 경로<select id="medicationRoute" name="route" value={form.route} onChange={(event) => setForm((current) => ({ ...current, route: event.target.value }))}>{[["경구", "경구 · PO"], ["정맥", "정맥 · IV"], ["근육", "근육 · IM"], ["피하", "피하 · SC"], ["흡입", "흡입 · INH"], ["설하", "설하 · SL"], ["국소", "국소 · TOP"], ["점안", "점안 · OU"], ["직장", "직장 · PR"], ["비강", "비강 · NAS"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>투여 빈도<select id="medicationFrequency" name="frequency" value={form.frequency} onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}>{[["1일 1회", "1일 1회 · QD"], ["1일 2회", "1일 2회 · BID"], ["1일 3회", "1일 3회 · TID"], ["1일 4회", "1일 4회 · QID"], ["격일 1회", "격일 1회 · QOD"], ["주 1회", "주 1회 · QW"], ["취침 전", "취침 전 · HS"], ["필요 시", "필요 시 · PRN"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>처방 일수<input id="medicationDurationDays" name="durationDays" type="number" min={1} max={365} inputMode="numeric" placeholder="일" value={form.durationDays} onChange={(event) => setForm((current) => ({ ...current, durationDays: event.target.value }))} /></label>
            <label>총 수량<input id="medicationQuantity" name="quantity" type="number" min={0.01} step={0.01} inputMode="decimal" placeholder="수량" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></label>
            <label className="clinical-instructions-field">복약 안내<textarea id="medicationInstructions" name="instructions" maxLength={500} rows={3} placeholder="식전·식후, 주의사항 등 의료진 지시" value={form.instructions} onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} /></label>
            <Button variant="primary" className="rx-form__submit" type="submit">처방 추가</Button>
          </div>
        </form>
      </RxDialog>
      {reviewPreview ? (
        <RxDialog id="reviewPreviewDialog" open onClose={() => setReviewPreview(null)} eyebrow="검토 요청 확인"
          title="AI 검토 전송 내용" titleId="reviewPreviewTitle" context={`${reviewPreview.name} · ${cloudLabel}`}
          noticeId="reviewPreviewNotice"
          notice={<p>검토 요청 시 서버로 전송되는 입력을 그대로 보여 줍니다. 이름·등록번호 같은 직접식별자는 포함되지 않습니다.</p>}>
          <div className="review-preview">
            <section className="review-preview__section">
              <h4>진료데이터 <span>환자 구조화 기록에서 추출해 급여기준과 짝지은 대조 항목 — 이 JSON이 모델 입력으로 전송됩니다.</span></h4>
              <pre className="review-preview__code">{JSON.stringify(medicationReviewModelPayload(reviewPreview.base), null, 2)}</pre>
            </section>
            <section className="review-preview__section">
              <h4>고시정보 <span>요양급여 적용기준 고시</span></h4>
              <p className="review-preview__placeholder">고시 원문 연동 예정입니다. 현재는 등록된 예시 급여기준(criterion)이 위 진료데이터의 checks 항목에 포함되어 전송됩니다.</p>
            </section>
            <section className="review-preview__section">
              <h4>프롬프트 <span>모델에 전달되는 시스템 지시 — 위 진료데이터 JSON이 사용자 입력으로 함께 전송됩니다.</span></h4>
              <pre className="review-preview__prose">{medicationReviewInstructions()}</pre>
            </section>
            <div className="review-preview__actions">
              <Button type="button" onClick={() => setReviewPreview(null)}>취소</Button>
              <Button variant="primary" type="button" id="reviewPreviewSend" onClick={sendReview}>이 내용으로 검토 요청</Button>
            </div>
          </div>
        </RxDialog>
      ) : null}
    </>
  );
}
