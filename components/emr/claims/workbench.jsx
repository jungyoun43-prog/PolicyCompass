"use client";

import { useState } from "react";

import { CLAIM_LANE_LABELS, CLAIM_LANE_ORDER } from "../../../src/claim-rules.js";
import { resolveClaimReview, setClaimReviewStage } from "../../../src/emr-model.js";
import {
  claimRequiredActions,
  claimRuleDisplayReference,
  CLAIM_REVIEW_STAGE_LABELS,
  CLAIM_REVIEW_STAGE_ORDER,
  CLAIM_WORKFLOW_LABELS,
  profileClaimUnitLabel,
  safeExternalUrl,
} from "../../../lib/emr/claims.js";
import { displayTimestamp, EVENT_LABELS } from "../../../lib/emr/format.js";

const OUTCOME_LABELS = { approved: "승인", hold: "보류", exception: "예외 인정" };

function ReviewDetail({ state, evaluation, review, stage, requestedStage, store, onClose, onMoved }) {
  const { applyMutation, setStatus } = store;
  const [form, setForm] = useState({
    stage: requestedStage || stage,
    assignee: review.assignee || "",
    reviewer: typeof review.reviewer === "string" ? review.reviewer : review.reviewer?.display || "",
    reason: review.transitionReason || "",
    opinion: review.opinion || "",
    outcome: review.outcome || "",
  });
  const [message, setMessage] = useState("");

  const evidenceEvents = evaluation.evidenceEventIds
    .map((id) => state.patients.find((item) => item.id === evaluation.patientId)?.events.find((event) => event.id === id))
    .filter(Boolean);
  const profileEvidenceRecords = evaluation.sourceKind === "profile" ? evaluation.claimContext?.evidenceRecords ?? [] : [];
  const requiredActions = claimRequiredActions(evaluation);
  const isExampleRule = evaluation.rule.sample === true;
  const sourceUrl = safeExternalUrl(evaluation.rule.sourceUrl);
  const unresolvedProfileEvidence = evaluation.sourceKind === "profile"
    ? Math.max(0, (evaluation.claimContext?.evidenceCount ?? 0) - Math.min(5, profileEvidenceRecords.length))
    : 0;

  const calculationFacts = evaluation.sourceKind === "profile"
    ? [
      ["진료일", evaluation.claimContext?.serviceDate || "미연결"],
      ["명세서 상태", CLAIM_WORKFLOW_LABELS[evaluation.claimContext?.workflowStatus] || "상태 미연결"],
      ["청구 단위", profileClaimUnitLabel(evaluation.claimContext?.claimUnit)],
      ["연결 자료", evaluation.claimContext?.evidenceCount ? `${evaluation.claimContext.evidenceCount}건` : "자료 미연결"],
    ]
    : evaluation.calculationAvailable
      ? [
        ["집계 구간", `${evaluation.windowStart} ~ ${evaluation.windowEnd}`],
        ["시행 횟수", `${evaluation.usedCount}/${evaluation.rule.maxCount}회`],
        ["최근 차트 시행", evaluation.lastServiceDate
          ? `${evaluation.lastServiceDate} · ${evaluation.daysSinceLastService}일 전 · ${evaluation.usedCount > 0 ? "집계 구간 내" : "집계 구간 밖"}`
          : "확정 기록 없음"],
        ["다음 기준", evaluation.nextEligibleDate || `남은 기준 ${evaluation.remainingCount}회`],
      ]
      : [
        ["자동 계산", "기간·횟수 미집계"],
        ["제외 상태", CLAIM_LANE_LABELS[evaluation.status] ?? "판정 제외"],
      ];

  const apply = async () => {
    setMessage("");
    const nextStage = form.stage;
    const assignee = form.assignee.trim();
    const reviewer = form.reviewer.trim();
    const reason = form.reason.trim();
    const outcome = form.outcome.trim();
    try {
      if (nextStage !== "new" && !assignee) throw new Error("담당자를 배정해 주세요.");
      if (!reviewer) throw new Error("기록자 이름을 입력해 주세요.");
      if (stage !== nextStage && !reason) throw new Error("단계를 이동한 이유를 입력해 주세요.");
      if (nextStage === "reviewed" && !["approved", "hold", "exception"].includes(outcome)) {
        throw new Error("최종 판정에서 승인·보류·예외 인정 중 하나를 선택해 주세요.");
      }
      const currentLabel = CLAIM_REVIEW_STAGE_LABELS[stage];
      const nextLabel = CLAIM_REVIEW_STAGE_LABELS[nextStage];
      const computedLabel = CLAIM_LANE_LABELS[evaluation.status] ?? CLAIM_LANE_LABELS.unknown;
      const detail = `${currentLabel} → ${nextLabel} · ${reason || "담당자 의견 갱신"} · 규칙 판정 ${computedLabel} 유지`;
      await applyMutation(
        (current) => setClaimReviewStage(
          current,
          evaluation,
          nextStage,
          detail,
          new Date().toISOString(),
          { assignee, reviewer, reason, opinion: form.opinion.trim(), outcome: nextStage === "reviewed" ? outcome : "", inputMethod: "패널 입력" },
        ),
        `${evaluation.title}의 담당자 검토 단계를 '${nextLabel}' 단계로 옮겼습니다. 규칙 판정 '${computedLabel}'은 유지됩니다.`,
      );
      onMoved?.();
    } catch (error) {
      const text = error instanceof Error ? error.message : "담당자 검토 단계를 옮기지 못했습니다.";
      setMessage(text);
      setStatus(text, "error");
    }
  };

  return (
    <dialog className="claim-card__details" open role="dialog" aria-modal="false" aria-labelledby="claimDetailTitle">
      <header className="claim-card__details-header">
        <div>
          <span className="claim-card__details-eyebrow">CLAIM EVIDENCE</span>
          <h5 id="claimDetailTitle">{evaluation.title}</h5>
          <span className="claim-computed-status" data-status={evaluation.status}>자동 판정 · {CLAIM_LANE_LABELS[evaluation.status]}</span>
        </div>
        <button className="clinical-button claim-card__details-close" type="button" aria-label={`${evaluation.title} 근거·세부정보 닫기`} onClick={onClose}>닫기</button>
      </header>
      <div className="claim-card__details-content">
        <section className="claim-xai-section claim-xai-section--judgment" data-claim-detail-section="judgment">
          <span className="claim-xai-section__step">01</span>
          <h6>판정 요약</h6>
          <strong className="claim-auto-calculation__result">{CLAIM_LANE_LABELS[evaluation.status]}</strong>
          <p>{evaluation.explanation}</p>
          <small className="claim-xai-boundary">자동 규칙 판정은 담당자 검토를 돕는 사전점검이며 보험자 심사결과가 아닙니다.</small>
        </section>

        <section className="claim-xai-section claim-xai-section--rule" data-claim-detail-section="rule">
          <span className="claim-xai-section__step">02</span>
          <h6>적용 규칙</h6>
          <strong>{evaluation.rule.title}</strong>
          <p className="claim-rule-version">{claimRuleDisplayReference(evaluation.rule)} · 적용 {evaluation.rule.effectiveFrom}–{evaluation.rule.effectiveTo || "현재"}</p>
          {evaluation.rule.sourceDocumentNumber ? <p className="claim-rule-document">고시·문서번호 · {evaluation.rule.sourceDocumentNumber}</p> : null}
          {sourceUrl
            ? <a className="claim-source" href={sourceUrl} target="_blank" rel="noreferrer" draggable={false}>{evaluation.rule.sourceLabel} ↗</a>
            : <span className="claim-source">{evaluation.rule.sourceLabel}</span>}
        </section>

        <section className="claim-xai-section claim-xai-section--evidence claim-evidence" data-claim-detail-section="evidence">
          <span className="claim-xai-section__step">03</span>
          <h6>EMR에서 확인한 사실</h6>
          {profileEvidenceRecords.length ? profileEvidenceRecords.slice(0, 5).map((record, index) => (
            <span key={index}>{[record.label, record.date, record.sourceLabel, record.sourceId].filter(Boolean).join(" · ")}</span>
          )) : evidenceEvents.length ? evidenceEvents.slice(0, 5).map((event) => (
            <span key={event.id}>{[event.label, event.date, isExampleRule ? "" : [event.system, event.code].filter(Boolean).join(" | "), event.source?.label, event.source?.resourceId].filter(Boolean).join(" · ")}</span>
          )) : (
            <span className="claim-evidence__empty">{evaluation.sourceKind === "profile"
              ? `청구 line 연결 자료 · 진료일 ${evaluation.claimContext?.serviceDate || "미연결"} · ${evaluation.claimContext?.provenanceLabel || "출처 확인 필요"}`
              : "직접 연결된 확정 차트 근거가 없습니다."}</span>
          )}
          {unresolvedProfileEvidence ? <span className="claim-evidence__excluded">상세 연결을 확인할 프로필 근거 · {unresolvedProfileEvidence}건</span> : null}
          {evaluation.missingEvidence.length ? <span className="claim-evidence__excluded">확인되지 않은 후보 · {evaluation.missingEvidence.join(", ")}</span> : null}
        </section>

        <section className="claim-xai-section claim-xai-section--timeline claim-auto-calculation" data-claim-detail-section="timeline">
          <span className="claim-xai-section__step">04</span>
          <h6>시간·횟수 계산</h6>
          <div className="claim-auto-calculation__metrics">
            {calculationFacts.map(([label, value]) => (
              <span className="claim-auto-calculation__metric" key={label}><small>{label}</small><strong>{value}</strong></span>
            ))}
          </div>
          <p>{evaluation.sourceKind === "profile"
            ? "질환별 연결 프로필의 청구 line 사실만 표시합니다. 기간·횟수 급여기준은 별도 규칙이 연결된 경우에만 계산합니다."
            : evaluation.calculationAvailable
              ? `서명·확정된 EMR의 ${EVENT_LABELS[evaluation.rule.serviceEventType] ?? evaluation.rule.serviceEventType} 기록 중 코드·상태·집계일이 규칙과 일치하는 항목만 자동 계산했습니다.`
              : "규칙 적용 조건이 충족된 경우에만 기간과 횟수를 계산합니다."}</p>
          {evaluation.missingEvidence.length ? <p className="claim-auto-calculation__missing">보완 확인 · {evaluation.missingEvidence.join(", ")}</p> : null}
        </section>

        <section className="claim-xai-section claim-xai-section--actions" data-claim-detail-section="actions">
          <span className="claim-xai-section__step">05</span>
          <h6>해야 할 작업·완료 조건</h6>
          <p>카드를 다음 단계로 옮기기 전에 확인할 작업입니다. 자동 판정과 별도로 담당자가 완료 여부를 판단합니다.</p>
          <ol className="claim-required-actions">
            {requiredActions.map((action) => (
              <li key={action.id}>
                <span className="claim-required-actions__check">□</span>
                <b>{action.label}</b>
                <small>완료 조건 · {action.completionCriterion}</small>
              </li>
            ))}
          </ol>
        </section>

        <section className="claim-xai-section claim-xai-section--review" data-claim-detail-section="review">
          <span className="claim-xai-section__step">06</span>
          <h6>담당자 의견·결론</h6>
          <p>자동 판정의 근거를 확인한 뒤 내부 업무 단계와 의견을 기록합니다. 이 결론은 보험자 심사결과를 바꾸지 않습니다.</p>
          {message ? <p className="claim-review-message" role="alert" aria-live="assertive">{message}</p> : null}
          <div className="claim-review-form">
            <label className="claim-review-control">
              <span>담당자 검토 단계</span>
              <select aria-label={`${evaluation.title} 담당자 검토 단계 이동`} value={form.stage} onChange={(event) => setForm((current) => ({ ...current, stage: event.target.value }))}>
                {CLAIM_REVIEW_STAGE_ORDER.map((optionStage) => <option value={optionStage} key={optionStage}>{CLAIM_REVIEW_STAGE_LABELS[optionStage]}</option>)}
              </select>
            </label>
            <label className="claim-review-control">
              <span>담당</span>
              <input type="text" maxLength={120} required={form.stage !== "new"} placeholder="예: 김심사 · 보험심사팀" value={form.assignee} onChange={(event) => setForm((current) => ({ ...current, assignee: event.target.value }))} />
            </label>
            <label className="claim-review-control">
              <span>기록자</span>
              <input type="text" maxLength={120} required placeholder="이름 또는 담당 역할" value={form.reviewer} onChange={(event) => setForm((current) => ({ ...current, reviewer: event.target.value }))} />
            </label>
            <label className="claim-review-control claim-review-control--wide">
              <span>이동·판정 사유</span>
              <textarea maxLength={800} rows={2} placeholder="예: 외부 검사 결과 확인 필요" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
            </label>
            <label className="claim-review-control claim-review-control--wide">
              <span>담당자 의견</span>
              <textarea maxLength={2000} rows={3} placeholder="확인한 근거와 후속 조치를 기록하세요." value={form.opinion} onChange={(event) => setForm((current) => ({ ...current, opinion: event.target.value }))} />
            </label>
            <label className="claim-review-control">
              <span>내부 최종 의견</span>
              <select disabled={form.stage !== "reviewed"} value={form.outcome} onChange={(event) => setForm((current) => ({ ...current, outcome: event.target.value }))}>
                {[["", "최종 판정에서 선택"], ["approved", "승인"], ["hold", "보류"], ["exception", "예외 인정"]].map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <button className="clinical-button clinical-button--primary claim-review-apply" type="button" onClick={apply}>검토 기록 저장</button>
          </div>
        </section>

        <section className="claim-xai-section claim-xai-section--history" data-claim-detail-section="history">
          <span className="claim-xai-section__step">07</span>
          <h6>검토 이력</h6>
          <ol className="claim-review-history">
            {(review.history?.length ? [...review.history].reverse().slice(0, 10) : []).map((item, index) => (
              <li key={index}>
                <time>{displayTimestamp(item.at)}</time>
                <b>{CLAIM_REVIEW_STAGE_LABELS[item.from] || item.from || "기록"} → {CLAIM_REVIEW_STAGE_LABELS[item.to] || item.to || stage}</b>
                <span>{[item.assignee ? `담당 ${item.assignee}` : "", item.reviewer ? `기록 ${item.reviewer}` : "", item.reason, OUTCOME_LABELS[item.outcome]].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
            {!review.history?.length ? <li className="claim-review-history__empty">아직 담당자 이동 이력이 없습니다.</li> : null}
          </ol>
        </section>

        <p className="claim-detail-boundary">자동 규칙 판정 → 사람 검토 → 내부 최종 의견의 순서로 기록합니다. 실제 인정·조정·삭감은 보험자 또는 심사기관 결과 영역에서만 표시합니다.</p>
      </div>
    </dialog>
  );
}

export function ClaimWorkbench({ state, store, evaluations, boardScope, setBoardScope, calculatedCounts, activeDetailId, setActiveDetailId, requestedStage, setRequestedStage }) {
  const [dragging, setDragging] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const reviewById = new Map(evaluations.map((evaluation) => [evaluation.id, resolveClaimReview(state, evaluation)]));
  const lanes = Object.fromEntries(CLAIM_REVIEW_STAGE_ORDER.map((stage) => [stage, []]));
  for (const evaluation of evaluations) lanes[reviewById.get(evaluation.id).stage].push(evaluation);
  const activeEvaluation = evaluations.find(({ id }) => id === activeDetailId) ?? null;
  const activeReview = activeEvaluation ? reviewById.get(activeEvaluation.id) : null;
  const activeStage = activeEvaluation ? activeReview.stage : "";

  const openDetail = (evaluationId, stage = "") => {
    setRequestedStage(stage);
    setActiveDetailId(evaluationId);
  };

  return (
    <details className="claim-workflow-disclosure" id="claimWorkflowDisclosure">
      <summary className="clinical-card">
        <span><span className="rail-eyebrow">MANUAL REVIEW WORKFLOW</span><b id="claimWorkflowTitle">담당자 검토 보드 열기</b><small>자동 판정 이후의 수동 검토 단계</small></span>
        <span className="source-badge">고급 업무</span>
      </summary>
      <div className="claim-workflow-disclosure__body">
        <section className="clinical-card claim-review-section" aria-labelledby="claimWorkflowTitle">
          <div className="card-heading">
            <div><p className="rail-eyebrow">MANUAL REVIEW WORKFLOW</p><h3>자동 판정 뒤 담당자 검토</h3></div>
            <div className="scope-switch" role="group" aria-label="급여 보드 범위">
              <button type="button" aria-pressed={boardScope === "patient"} data-board-scope="patient" onClick={() => setBoardScope("patient")}>이 환자</button>
              <button type="button" aria-pressed={boardScope === "all"} data-board-scope="all" onClick={() => setBoardScope("all")}>전체 환자</button>
            </div>
          </div>
          <div className="claim-review-guide" id="claimBoardInstructions">
            <span className="claim-review-guide__mark" aria-hidden="true">↔</span>
            <div>
              <b>규칙 판정 뒤 담당자를 배정하고, 해야 할 작업부터 확인합니다.</b>
              <p>카드를 선택하면 오른쪽 근거 패널에서 적용 규칙·EMR 기록·시간 흐름과 완료 조건을 함께 볼 수 있습니다. 담당자·이동 사유·의견·최종 판정을 남긴 뒤 수동 검토 단계를 적용하며, 모든 변경은 검토 이력에 남습니다.</p>
            </div>
          </div>
          <div className="claim-result-summary" id="claimResultSummary" aria-label="변경되지 않는 자동 규칙 판정 요약" role="list">
            {CLAIM_LANE_ORDER.map((status) => (
              <span className="claim-result-chip" data-status={status} role="listitem" key={status}>
                <span>{CLAIM_LANE_LABELS[status]}</span><b>{calculatedCounts[status] ?? 0}</b>
              </span>
            ))}
          </div>
        </section>

        <div className="claim-review-workbench">
          <div className="claim-review-master">
            <div className="claim-board" id="claimBoard" aria-label="담당자 검토 단계별 급여 칸반" aria-describedby="claimBoardInstructions">
              {CLAIM_REVIEW_STAGE_ORDER.map((stage) => (
                <section className="claim-lane" data-claim-review-lane={stage} aria-labelledby={`claim-review-lane-${stage}`} key={stage}>
                  <header>
                    <div className="claim-lane__heading">
                      <h4 id={`claim-review-lane-${stage}`}>{CLAIM_REVIEW_STAGE_LABELS[stage]}</h4>
                      <p>{stage === "new" ? "자동 판정 완료 · 담당 배정" : stage === "evidence" ? "검사·처방·외부 자료 확인" : stage === "reviewing" ? "담당자가 현재 확인 중" : "내부 의견 기록 · 보험자 확정 아님"}</p>
                    </div>
                    <span>{lanes[stage].length}</span>
                  </header>
                  <div className="claim-lane__cards" data-claim-review-dropzone={stage}
                    onDragOver={(event) => { if (dragging) event.preventDefault(); }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const evaluationId = event.dataTransfer.getData("text/plain") || dragging;
                      if (!evaluationId) return;
                      setDragging("");
                      openDetail(evaluationId, stage);
                      setLiveMessage(`카드를 '${CLAIM_REVIEW_STAGE_LABELS[stage]}' 단계로 끌어왔습니다. 근거 패널에서 담당자·사유를 기록한 뒤 저장하세요.`);
                    }}>
                    {lanes[stage].length === 0 ? <p className="claim-empty">카드를 여기에 놓을 수 있습니다.</p> : lanes[stage].map((evaluation) => {
                      const review = reviewById.get(evaluation.id);
                      const requiredActions = claimRequiredActions(evaluation);
                      const isExampleRule = evaluation.rule.sample === true;
                      const connectedEvidenceCount = evaluation.sourceKind === "profile"
                        ? evaluation.claimContext?.evidenceCount ?? 0
                        : evaluation.evidenceEventIds?.length ?? 0;
                      return (
                        <article className="claim-card" data-status={evaluation.status} data-claim-evaluation-id={evaluation.id}
                          data-claim-review-stale={String(review.stale)} data-claim-detail-open={String(evaluation.id === activeDetailId)}
                          aria-current={evaluation.id === activeDetailId || undefined}
                          draggable key={evaluation.id}
                          onDragStart={(event) => { setDragging(evaluation.id); event.dataTransfer.setData("text/plain", evaluation.id); }}
                          onDragEnd={() => setDragging("")}>
                          <button className="claim-card__summary" type="button" aria-expanded={evaluation.id === activeDetailId} aria-haspopup="dialog"
                            aria-describedby="claimBoardInstructions"
                            aria-label={`${evaluation.title} · 자동 규칙 판정 ${CLAIM_LANE_LABELS[evaluation.status]} · 담당자 검토 ${CLAIM_REVIEW_STAGE_LABELS[stage]}${review.stale ? " · 이전 검토 무효화, 재검토 필요" : ""} · 근거·세부정보 보기`}
                            onClick={() => {
                              if (evaluation.id === activeDetailId) {
                                setActiveDetailId("");
                                setLiveMessage(`${evaluation.title}의 연결 차트 근거와 규칙 세부정보를 닫았습니다.`);
                              } else {
                                openDetail(evaluation.id);
                                setLiveMessage(`${evaluation.title}의 연결 차트 근거와 규칙 세부정보를 열었습니다.`);
                              }
                            }}>
                            <span className="claim-card__top">
                              <b>{evaluation.title}</b>
                              <code title={isExampleRule ? "내부 검토용 기관 규칙" : [evaluation.rule.serviceSystem, evaluation.serviceCode].filter(Boolean).join(" | ")}>{isExampleRule ? "기관 규칙" : evaluation.serviceCode}</code>
                              <span className="claim-drag-handle" aria-hidden="true">⠿</span>
                            </span>
                            <span className="claim-computed-status" data-status={evaluation.status}>자동 판정 · {CLAIM_LANE_LABELS[evaluation.status]}</span>
                            {review.stale ? (
                              <span className="claim-review-stale"><b>재검토 필요 · </b>자동 판정·근거·규칙 또는 판정일이 달라져 이전 &apos;{CLAIM_REVIEW_STAGE_LABELS[review.invalidatedFrom] ?? "검토"}&apos; 단계는 무효화되고 &apos;검토 대기&apos;로 돌아왔습니다.</span>
                            ) : null}
                            {boardScope === "all" ? <span className="claim-patient">{evaluation.patientName} · {evaluation.patientMrn || "등록번호 없음"}</span> : null}
                            <span className="claim-card__owner" data-assigned={String(Boolean(review.assignee))}>담당 · {review.assignee || "미배정"}</span>
                            <span className="claim-card__quick-facts">
                              {[
                                ["환자", evaluation.patientName],
                                [evaluation.sourceKind === "profile" ? "진료일" : "판정 기준일", evaluation.asOf || "미연결"],
                                ["자료", `${connectedEvidenceCount ? `${connectedEvidenceCount}건 연결` : "자료 미연결"}${evaluation.missingEvidence?.length ? ` · ${evaluation.missingEvidence.length}건 보완` : ""}`],
                                [evaluation.sourceKind === "profile" ? "청구 단위" : "예상 영향", evaluation.sourceKind === "profile" ? profileClaimUnitLabel(evaluation.claimContext?.claimUnit) : "기관 단가 미연결"],
                              ].map(([label, value]) => (
                                <span className="claim-card__quick-fact" key={label}><small>{label}</small><b>{value}</b></span>
                              ))}
                            </span>
                            <span className="claim-card__next-action">
                              <small>해야 할 작업</small>
                              <b>{requiredActions[0]?.label || "담당자 확인"}</b>
                              {requiredActions.length > 1 ? <em>외 {requiredActions.length - 1}개</em> : null}
                            </span>
                            <span className="claim-card__disclosure">{evaluation.id === activeDetailId ? "근거·세부정보 닫기" : "근거·세부정보 보기"}</span>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            <p className="visually-hidden" id="claimBoardLive" role="status" aria-live="polite" aria-atomic="true">{liveMessage}</p>
          </div>
          <aside className="claim-review-detail-host" id="claimReviewDetailHost" aria-label="선택한 청구 항목의 근거와 담당자 조치" tabIndex={-1} data-active={String(Boolean(activeEvaluation))}>
            {!activeEvaluation ? (
              <div className="claim-review-detail-empty" id="claimReviewDetailEmpty">
                <p className="rail-eyebrow">REVIEW DETAIL</p>
                <h4>검토할 항목을 선택하세요.</h4>
                <p>왼쪽 카드에서 담당 업무를 선택하면 적용 규칙, EMR 근거, 해야 할 작업과 최종 판정 입력란이 여기에 열립니다.</p>
              </div>
            ) : (
              <ReviewDetail
                key={`${activeEvaluation.id}:${requestedStage}:${activeStage}`}
                state={state}
                evaluation={activeEvaluation}
                review={activeReview}
                stage={activeStage}
                requestedStage={requestedStage}
                store={store}
                onClose={() => setActiveDetailId("")}
                onMoved={() => setRequestedStage("")}
              />
            )}
          </aside>
        </div>
      </div>
    </details>
  );
}
