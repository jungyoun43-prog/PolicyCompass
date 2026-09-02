"use client";

import { useMemo, useState } from "react";

import { CLAIM_LANE_ORDER } from "../../../src/claim-rules.js";
import { searchClaimIndex } from "../../../src/claim-search.js";
import {
  evaluateDiseaseAssessment,
  getCombinedDiseaseClaimProfile,
  getDiseaseAssessmentOptions,
} from "../../../src/disease-assessment.js";
import {
  buildClaimSearchIndex,
  claimAdjudicationEntries,
  claimAttentionEntries,
  claimReviewEvaluationsForPatients,
  claimRuleDisplayReference,
  CLAIM_ATTENTION_ICON,
  formatClaimAmount,
  priorityClaimAttentionEntries,
} from "../../../lib/emr/claims.js";
import { displayDate, displayTimestamp, today } from "../../../lib/emr/format.js";
import { DiseaseAssessmentCard } from "../claims/disease-assessment.jsx";
import { ClaimWorkbench } from "../claims/workbench.jsx";
import { RuleManager } from "../claims/rule-manager.jsx";

export function ClaimsTab({ state, patient, store }) {
  const [boardScope, setBoardScope] = useState("patient");
  const [query, setQuery] = useState("");
  const [activeDetailId, setActiveDetailId] = useState("");
  const [requestedStage, setRequestedStage] = useState("");
  // 질환 평가 선택은 이전 컨트롤러처럼 환자별로 세션 메모리에만 유지한다.
  const [selectedDiseaseByPatientId, setSelectedDiseaseByPatientId] = useState(() => new Map());
  const [diseaseLiveMessage, setDiseaseLiveMessage] = useState("");
  const selectedDiseaseId = selectedDiseaseByPatientId.get(patient.id) ?? "";
  const onSelectDisease = (diseaseId) => {
    setSelectedDiseaseByPatientId((current) => new Map(current).set(patient.id, diseaseId));
    const label = getDiseaseAssessmentOptions(patient).find(({ id }) => id === diseaseId)?.label ?? "질환";
    setDiseaseLiveMessage(`${label} 적정성·진단 근거를 표시했습니다. 왼쪽 급여 주의사항은 전체 질환 기준으로 유지됩니다.`);
  };

  const patients = boardScope === "all" ? state.patients : [patient];
  const evaluations = useMemo(() => claimReviewEvaluationsForPatients(state, patients), [state, patients]);
  const selectedEvaluations = evaluations.filter((evaluation) => evaluation.patientId === patient.id);
  const profile = state.demo ? getCombinedDiseaseClaimProfile(patient) : null;
  const attention = useMemo(() => claimAttentionEntries(patient, selectedEvaluations, profile), [patient, selectedEvaluations, profile]);
  const adjudications = useMemo(() => claimAdjudicationEntries(profile), [profile]);
  const searchEntries = useMemo(() => buildClaimSearchIndex(state, patient, evaluations, profile), [state, patient, evaluations, profile]);
  const searchResults = useMemo(() => searchClaimIndex(searchEntries, query, 12), [searchEntries, query]);
  const selectedAssessment = state.demo && selectedDiseaseId ? evaluateDiseaseAssessment(patient, selectedDiseaseId) : null;

  const counts = { "high-risk": 0, "needs-review": 0, insufficient: 0, verified: 0 };
  for (const entry of attention) counts[entry.presentation.state] += 1;
  const priorityEntries = priorityClaimAttentionEntries(attention);
  const priorityIds = new Set(priorityEntries.map(({ id }) => id));
  const otherEntries = attention.filter(({ id }) => !priorityIds.has(id));
  const trustRules = [...new Map(selectedEvaluations.filter(({ sourceKind }) => sourceKind !== "profile").map(({ rule }) => [rule?.id, rule]).filter(([id]) => id)).values()];
  const latestRule = trustRules[0];
  const metrics = Array.isArray(selectedAssessment?.quality?.metrics) ? selectedAssessment.quality.metrics : [];
  const includedCount = metrics.filter(({ status }) => status === "included").length;
  const applicableCount = metrics.filter(({ status }) => status !== "not-applicable").length;
  const calculatedCounts = Object.fromEntries(CLAIM_LANE_ORDER.map((status) => [status, 0]));
  for (const evaluation of evaluations) calculatedCounts[evaluation.status] = (calculatedCounts[evaluation.status] ?? 0) + 1;

  const openWorkItem = (workItemId) => {
    setRequestedStage("");
    setActiveDetailId(workItemId);
    requestAnimationFrame(() => document.querySelector(`[data-claim-evaluation-id="${CSS.escape(workItemId)}"]`)?.scrollIntoView({ block: "center" }));
  };

  const onSearchPick = (entry) => {
    if (!entry) return;
    if (entry.target.targetType === "workflow") openWorkItem(entry.target.evaluationId);
    if (entry.target.targetType === "quality") onSelectDisease(entry.target.diseaseId);
    if (entry.target.targetType === "adjudication") {
      requestAnimationFrame(() => document.querySelector(`[data-claim-adjudication-id="${CSS.escape(entry.target.adjudicationId)}"]`)?.scrollIntoView({ block: "center" }));
    }
    if (entry.target.targetType === "rule") {
      requestAnimationFrame(() => {
        const manager = document.getElementById("ruleVersionManager");
        if (manager) manager.open = true;
        document.querySelector(`[data-rule-version-row="${CSS.escape(entry.target.ruleId)}"]`)?.scrollIntoView({ block: "center" });
      });
    }
  };

  const AttentionRow = ({ entry }) => (
    <li className="claim-attention-item" data-claim-state={entry.presentation.state}>
      <button className="claim-attention-item__summary" type="button" aria-label={`${entry.title} · 보험심사팀 검토와 근거 패널 열기`} onClick={() => openWorkItem(entry.workItemId)}>
        <span className="claim-attention-item__mark" aria-hidden="true">{CLAIM_ATTENTION_ICON[entry.presentation.state]}</span>
        <span className="claim-attention-item__identity">
          <strong>{entry.title}</strong>
          {[entry.displayCode, entry.date ? `${entry.dateLabel} ${entry.date}` : "진료일 미연결"].filter(Boolean).length ? (
            <small>{[entry.displayCode, entry.date ? `${entry.dateLabel} ${entry.date}` : "진료일 미연결"].filter(Boolean).join(" · ")}</small>
          ) : null}
        </span>
        <span className="claim-attention-item__status">{entry.presentation.label}</span>
        <span className="claim-attention-item__open">검토 열기</span>
      </button>
    </li>
  );

  return (
    <>
      <section className="clinical-card claim-intro" aria-labelledby="claimBoardTitle">
        <div className="card-heading">
          <div><p className="rail-eyebrow">REIMBURSEMENT WORKLIST</p><h3 id="claimBoardTitle">급여·심사 지원</h3></div>
        </div>
        <p>청구 전 위험, 실제 심사 결과, 기관 적정성 평가를 서로 다른 기준으로 확인합니다.</p>
      </section>

      <section className="claim-board-kpis" id="claimBoardKpis" aria-label="현재 환자 급여 업무 요약" aria-live="polite" aria-atomic="true">
        {[
          ["high-risk", "청구 고위험", counts["high-risk"], "청구 전 점검"],
          ["needs-review", "확인 필요", counts["needs-review"], "급여조건·기록"],
          ["insufficient", "자료 보완", counts.insufficient, "판정 불가 포함"],
          ["quality", "적정성 지표", applicableCount ? `${includedCount}/${applicableCount}` : "해당 없음", "기관 평가 예상"],
        ].map(([kpi, label, value, description]) => (
          <div className="claim-board-kpi" data-claim-kpi={kpi} key={kpi}>
            <span>{label}</span><strong>{value}</strong><small>{description}</small>
          </div>
        ))}
      </section>

      <section className="claim-rule-trust" id="claimRuleTrust" aria-label="적용 규칙과 판정 책임">
        <div>
          <span className="claim-rule-trust__label">판정 기준</span>
          <strong>{latestRule ? `${latestRule.title} · ${claimRuleDisplayReference(latestRule)}` : "연결된 급여 규칙 확인 필요"}</strong>
          <small>{latestRule
            ? [`적용 ${latestRule.effectiveFrom}–${latestRule.effectiveTo || "현재"}`, `산출 ${displayDate(today())}`, latestRule.sourceDocumentNumber ? `고시·문서번호 ${latestRule.sourceDocumentNumber}` : "고시·문서번호 미연결", `출처 ${latestRule.sourceLabel}`, latestRule.sample ? "기관 내부 규칙" : "공식 출처 연결"].join(" · ")
            : "규칙 버전·적용일·출처를 연결한 뒤 판정할 수 있습니다."}</small>
        </div>
        <p><b>판정 경계 </b>자동 규칙은 검토 대상을 제안합니다. 청구 전 예상, 실제 심사 결과, 기관 적정성 평가는 서로 대체하지 않으며 최종 적용은 담당자가 결정합니다.</p>
        <a className="claim-rule-trust__link" href="#ruleVersionManager">규칙 버전 관리</a>
      </section>

      <section className="claim-search" aria-labelledby="claimSearchTitle">
        <div className="claim-search__heading">
          <label htmlFor="claimSearch">
            <strong id="claimSearchTitle">급여 업무 통합 검색</strong>
            <small>청구 · 심사 결과 · 적정성 평가 · 규칙</small>
          </label>
          <div className="claim-search__field">
            <span aria-hidden="true">⌕</span>
            <input id="claimSearch" type="search" autoComplete="off" spellCheck="false" placeholder="환자, 검사·약제, 서비스 코드, 규칙 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button id="claimSearchClear" type="button" aria-label="급여 업무 검색어 지우기" hidden={!query.trim()} onClick={() => setQuery("")}>지우기</button>
          </div>
        </div>
        <p className="claim-search__summary" id="claimSearchSummary" aria-live="polite">
          {!query.trim()
            ? "환자와 업무 항목을 한 번에 찾을 수 있습니다."
            : searchResults.length
              ? `검색 결과 ${searchResults.length}건 · 업무 항목을 선택하면 같은 카드와 근거 패널로 이동합니다.`
              : "일치하는 급여 업무가 없습니다. 환자명, 코드, 검사·약제명 또는 고시·문서번호를 확인해 주세요."}
        </p>
        <ol className="claim-search__results" id="claimSearchResults" aria-label="급여 업무 통합 검색 결과" hidden={!query.trim()}>
          {searchResults.map((result) => {
            const domainLabel = { claim: "청구·Workflow", workflow: "Workflow", adjudication: "심사 결과", quality: "적정성 평가", rule: "규칙" };
            return (
              <li className="claim-search-result" key={result.id}>
                <button type="button" onClick={() => onSearchPick(result)}>
                  <strong className="claim-search-result__title">{result.title}</strong>
                  <span className="claim-search-result__type">{domainLabel[result.domain] || result.kind}</span>
                  <small className="claim-search-result__meta">{result.subtitle}</small>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="claim-overview-grid" aria-label="환자별 급여와 질환별 근거 요약">
        <section className="clinical-card claim-overview-card claim-attention-card" aria-labelledby="claimAttentionTitle">
          <div className="card-heading">
            <div><p className="rail-eyebrow">PRE-CLAIM CHECK</p><h3 id="claimAttentionTitle">청구 전 점검</h3></div>
            <span className="source-badge">자동 규칙 예상</span>
          </div>
          <p className="claim-overview-card__intro">이번 환자의 진료일·청구 항목별로 조치가 필요한 조건만 먼저 보여 줍니다. 행을 누르면 적용 규칙과 EMR 근거가 열립니다.</p>

          <div className="claim-attention-summary" id="claimAttentionSummary" aria-live="polite" aria-atomic="true">
            <div className="claim-attention-summary__content">
              <strong>{counts["high-risk"]
                ? `내부 규칙상 근거 누락 ${counts["high-risk"]}건을 먼저 확인하세요.`
                : counts["needs-review"]
                  ? `급여기준을 확인할 항목 ${counts["needs-review"]}건이 있습니다.`
                  : counts.insufficient
                    ? `판정 자료를 보완할 항목 ${counts.insufficient}건이 있습니다.`
                    : counts.verified
                      ? "확인된 자료 범위에서 즉시 발견된 위험은 없습니다."
                      : "현재 자료로는 청구 위험을 판정하기 어렵습니다."}</strong>
              <div className="claim-attention-counts" role="list">
                {[["high-risk", "내부 규칙상 근거 누락"], ["needs-review", "확인 필요"], ["insufficient", "자료 부족"], ["verified", "등록 규칙 조건 일치"]].map(([stateName, label]) => (
                  <span className="claim-attention-count" data-claim-state={stateName} role="listitem" key={stateName}>
                    <b>{counts[stateName]}</b><small>{label}</small>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="claim-attention-column-head" aria-hidden="true">
            <span></span><span>진료일 · 청구 항목</span><span>사전점검</span><span></span>
          </div>
          <ol className="claim-attention-list claim-attention-list--priority" id="claimAttentionList" aria-label="우선 확인할 청구 주의사항" hidden={attention.length > 0 && priorityEntries.length === 0}>
            {attention.length === 0 ? <li className="claim-overview-empty">연결된 규칙 또는 심사 자료가 없습니다.</li> : priorityEntries.map((entry) => <AttentionRow entry={entry} key={entry.id} />)}
          </ol>

          {otherEntries.length > 0 ? (
            <details className="claim-status-guide claim-attention-all" id="claimAttentionAllDisclosure">
              <summary><span><b>그 외 항목 보기</b><small id="claimAttentionAllDisclosureHint">{otherEntries.length}건 · 등록 규칙 조건 일치·자료 부족·추가 확인</small></span></summary>
              <ol className="claim-attention-list claim-attention-list--all" id="claimAttentionAllList" aria-label="그 외 청구 사전점검 항목">
                {otherEntries.map((entry) => <AttentionRow entry={entry} key={entry.id} />)}
              </ol>
            </details>
          ) : null}

          <details className="claim-status-guide">
            <summary><span><b>상태 색상과 판정 경계</b><small>사전점검·심사 결과·적정성 평가를 구분</small></span></summary>
            <div className="claim-status-legend" role="list" aria-label="급여와 적정성 평가 상태 기준">
              {[
                ["red", "×", "빨강 · 내부 규칙상 근거 누락", "등록된 사전점검 규칙에서 근거 누락 가능성이 발견됨 · 심사 결과 아님"],
                ["yellow", "!", "주황 · 등록 규칙 확인 필요", "추가 문서나 내부 적용 조건을 담당자가 확인해야 함 · 급여 판단 아님"],
                ["green", "✓", "초록 · 등록 규칙 조건 일치", "연결된 자료 범위에서 내부 조건이 일치함 · 지급·급여·심사 결과 보장 아님"],
                ["gray", "…", "보라 · 자료 부족", "현재 EMR만으로는 판정할 수 없음"],
              ].map(([tone, mark, title, detail]) => (
                <div className="claim-status-legend__item" data-claim-tone={tone} role="listitem" key={tone}>
                  <span className="claim-status-legend__mark" aria-hidden="true">{mark}</span>
                  <span><b>{title}</b><small>{detail}</small></span>
                </div>
              ))}
            </div>
          </details>

          <section className="claim-adjudication" aria-labelledby="claimAdjudicationTitle">
            <div className="claim-adjudication__heading">
              <div><p className="rail-eyebrow">ADJUDICATION RESULT</p><h3 id="claimAdjudicationTitle">심사 결과</h3></div>
              <span className="source-badge claim-adjudication__badge">실제 결과만</span>
            </div>
            <p className="claim-overview-card__intro">심사기관 결과가 연결된 명세서·청구 line만 표시합니다. 사전점검의 예상 판정과 분리됩니다.</p>
            <div className="claim-adjudication-summary" id="claimAdjudicationSummary" aria-live="polite" aria-atomic="true">
              <strong>{adjudications.length
                ? `보험자 최종 결과 ${adjudications.length}건 · 조정 ${adjudications.filter(({ presentation }) => presentation.state === "adjusted").length}건`
                : "연결된 보험자 최종 결과가 없습니다."}</strong>
            </div>
            <ol className="claim-adjudication-list" id="claimAdjudicationList" aria-label="실제 심사 결과">
              {adjudications.length === 0 ? <li className="claim-overview-empty">심사기관 결과가 연결되면 인정·조정·보류를 여기에 표시합니다.</li> : adjudications.map((entry) => (
                <li className="claim-adjudication-item" data-adjudication-state={entry.presentation.state} data-claim-adjudication-id={entry.id} tabIndex={-1} key={entry.id}>
                  <div className="claim-adjudication-item__heading">
                    <span>
                      <strong>{entry.title}</strong>
                      <small>{[entry.code, entry.serviceDate ? `진료일 ${entry.serviceDate}` : "진료일 미연결"].filter(Boolean).join(" · ")}</small>
                    </span>
                    <b className="claim-adjudication-item__status">{entry.presentation.label}</b>
                  </div>
                  <dl className="claim-adjudication-item__amounts">
                    {[["청구", entry.adjudication.claimedAmount ?? entry.adjudication.originalAmount], ["인정", entry.adjudication.allowedAmount], ["조정", entry.adjudication.reductionAmount]].map(([label, value]) => (
                      <div style={{ display: "contents" }} key={label}><dt>{label}</dt><dd>{formatClaimAmount(value, entry.adjudication.currency || "KRW")}</dd></div>
                    ))}
                  </dl>
                  <p>{entry.presentation.reason}</p>
                  <small className="claim-adjudication-item__meta">결정일 {displayTimestamp(entry.adjudication.decidedAt)} · 출처 {entry.adjudication.provenance?.sourceLabel || entry.adjudication.sourceId} · 사유코드 {entry.adjudication.reasonCode}</small>
                  <small className="claim-adjudication-item__boundary">{entry.presentation.paymentBoundary}</small>
                </li>
              ))}
            </ol>
          </section>
        </section>

        <p className="visually-hidden" id="diseaseAssessmentLive" role="status" aria-live="polite">{diseaseLiveMessage}</p>
        <DiseaseAssessmentCard state={state} patient={patient} selectedDiseaseId={selectedDiseaseId} onSelectDisease={onSelectDisease} />
      </div>

      <ClaimWorkbench
        state={state}
        patient={patient}
        store={store}
        evaluations={evaluations}
        boardScope={boardScope}
        setBoardScope={setBoardScope}
        calculatedCounts={calculatedCounts}
        activeDetailId={activeDetailId}
        setActiveDetailId={setActiveDetailId}
        requestedStage={requestedStage}
        setRequestedStage={setRequestedStage}
      />

      <RuleManager state={state} store={store} />
    </>
  );
}
