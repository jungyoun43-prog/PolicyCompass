"use client";

import {
  evaluateDiseaseAssessment,
  getDiseaseAssessmentOptions,
  getPreferredDiseaseAssessmentId,
} from "../../../src/disease-assessment.js";
import { GOLD_COPD_2026_RULESET, HIRA_COPD_2026_RULESET } from "../../../src/copd-assessment.js";
import { HIRA_PNEUMONIA_2026_RULESET, KDCA_PNEUMONIA_2026_GUIDELINE } from "../../../src/pneumonia-assessment.js";
import { QUALITY_METRIC_STATUS, safeExternalUrl } from "../../../lib/emr/claims.js";
import { displayTimestamp } from "../../../lib/emr/format.js";

function qualityObservedLabel(metric) {
  if (typeof metric.displayValue === "string" && metric.displayValue.trim()) return metric.displayValue;
  if (typeof metric.observedLabel === "string" && metric.observedLabel.trim()) return metric.observedLabel;
  if (!Number.isFinite(Number(metric.observed))) return "자료 확인";
  if (metric.id === "continuing-visits") return `${metric.observed}회`;
  return `${metric.observed}건`;
}

function metricReferenceLabel(metric, diseaseId) {
  const parts = [];
  if (Number.isFinite(metric.weight)) {
    parts.push(diseaseId === "copd" ? `지표 가중치 ${metric.weight}%` : `공식 상대가중치 ${metric.weight}`);
  }
  if (Number.isFinite(metric.minimum)) parts.push(`기준 ${metric.minimum}회 이상`);
  if (metric.denominatorIncluded === false) parts.push("이번 사례는 지표 분모 제외");
  return parts.join(" · ") || "공식 기준과 연결 자료 대조";
}

function qualityTargetHeadline(quality) {
  const includedCount = quality.metrics.filter(({ status }) => status === "included").length;
  const applicableCount = quality.metrics.filter(({ status }) => status !== "not-applicable").length;
  const excludedCount = quality.metrics.length - applicableCount;
  const countLabel = excludedCount
    ? `평가 분모 ${applicableCount}개 중 ${includedCount}개 충족 예상 · ${excludedCount}개 분모 제외`
    : `${quality.metrics.length}개 지표 중 ${includedCount}개 충족 예상`;
  if (quality.target.status === "eligible") return `평가대상 예상 · ${countLabel}`;
  if (quality.target.status === "insufficient") return "평가대상 여부를 판단할 자료가 부족합니다.";
  return "현재 연결 자료에서는 평가대상으로 예상되지 않습니다.";
}

function qualityTargetDetail(quality, diseaseId) {
  const target = quality.target;
  const labels = [
    `평가기간 ${quality.period.start}~${quality.period.end}`,
    `만 ${target.ageYears ?? "?"}세`,
    `상병 ${target.diagnosisCode || "확인 안 됨"}`,
  ];
  if (diseaseId === "pneumonia") {
    labels.push(`정맥 항생제 ${target.ivAntibioticDays ?? "?"}일`, `기관 ${target.institutionType || "확인 안 됨"}`);
  }
  return labels.join(" · ");
}

function SourceLink({ rule }) {
  const href = safeExternalUrl(rule?.sourceUrl);
  if (!href) return null;
  return <a className="quality-source-link" href={href} target="_blank" rel="noreferrer">{rule.sourceLabel} ↗</a>;
}

function DiagnosticAxis({ label, status, value }) {
  return (
    <div className="quality-diagnostic-axis" data-axis-status={status}>
      <small>{label}</small><strong>{value}</strong>
    </div>
  );
}

function copdDiagnosticHeadline(diagnostic) {
  if (diagnostic.status === "matched-repeat-confirmed") return "별도 시점 검사에서도 폐활량측정 기준이 반복 확인됐습니다.";
  if (diagnostic.status === "matched-repeat-pending") return "이번 검사에서 기준 일치 · 별도 시점 반복확인이 필요합니다.";
  if (diagnostic.status === "clinician-review") return "별도 시점 검사 결과가 달라 의료진 검토가 필요합니다.";
  if (diagnostic.status === "not-matched-repeat-pending") return "이번 값은 기준에 일치하지 않지만 반복확인 범위에 있습니다.";
  if (diagnostic.status === "criterion-not-demonstrated") return "현재 검증 자료에서는 폐활량측정 기준이 확인되지 않았습니다.";
  if (diagnostic.status === "matched") return "이번 검사에서 폐활량측정 기준에 일치합니다.";
  return "진단 근거 정합성을 판단할 자료가 부족합니다.";
}

function pneumoniaDiagnosticHeadline(diagnostic) {
  if (diagnostic.status === "supported") return "영상·감염 근거·지역사회 발생 맥락과 의료진 진단이 함께 확인됩니다.";
  if (diagnostic.status === "clinician-review") return "임상 근거는 연결됐지만 의료진의 최종 폐렴 진단 기록을 확인해야 합니다.";
  if (diagnostic.status === "outside-cap-scope") return "지역사회획득 폐렴 범위와 맞지 않아 의료진의 재확인이 필요합니다.";
  return "폐렴 진단 근거 정합성을 확인할 자료가 더 필요합니다.";
}

function axisValue(status, supported, missing, mismatch) {
  if (["documented", "supported", "matched", "confirmed"].includes(status)) return supported;
  if (["not-demonstrated", "outside-scope", "not-matched"].includes(status)) return mismatch;
  return missing;
}

function CopdDiagnostic({ diagnostic, profile }) {
  return (
    <>
      <div className="quality-diagnostic-summary" id="diseaseDiagnosticSummary" aria-live="polite" aria-atomic="true">
        <div className="quality-diagnostic-summary__content" data-status={diagnostic.status}>
          <strong>{copdDiagnosticHeadline(diagnostic)}</strong>
          <div className="quality-diagnostic-axes">
            <DiagnosticAxis label="임상 맥락" status={diagnostic.clinicalContext.status} value={diagnostic.clinicalContext.status === "documented" ? "기록 확인" : "자료 부족"} />
            <DiagnosticAxis label="post-BD 기준" status={diagnostic.criterion.status} value={diagnostic.criterion.status === "matched" ? "< 0.70 일치" : diagnostic.criterion.status === "not-matched" ? "≥ 0.70" : "판정 불가"} />
            <DiagnosticAxis label="반복 확인" status={diagnostic.repeatConfirmation.status} value={diagnostic.repeatConfirmation.status === "confirmed" ? "별도 시점 확인" : diagnostic.repeatConfirmation.status === "pending" ? "대기" : diagnostic.repeatConfirmation.status === "clinician-review" ? "의료진 검토" : "해당 상태 확인"} />
            <DiagnosticAxis label="의료진 진단" status={diagnostic.clinicianDiagnosis.status} value={diagnostic.clinicianDiagnosis.status === "documented" ? "기록 있음" : "기록 없음"} />
          </div>
          <p className="quality-diagnostic-boundary">{diagnostic.disclaimer}</p>
        </div>
      </div>
      <div className="claim-overview-disclosure__body quality-diagnostic-details" id="diseaseDiagnosticDetails">
        <section className="quality-detail-section">
          <h5>post-BD 계산과 엄격한 경계</h5>
          {diagnostic.criterion.latestRatio !== null ? (
            <>
              <p className="quality-highlight-result">FEV₁/FVC {diagnostic.criterion.displayRatio} {diagnostic.criteriaMatch ? "<" : "≥"} 0.70</p>
              <p>검사 {diagnostic.criterion.sessionDate} · 세션 {diagnostic.criterion.sessionId} · {diagnostic.criterion.basis === "reported-ratio" ? "보고 비율" : "같은 세션 FEV₁÷FVC 계산"}</p>
            </>
          ) : <p>{diagnostic.criterion.reason}</p>}
          <p>정확히 0.70은 ‘&lt; 0.70’에 해당하지 않습니다. 화면 반올림값이 아니라 원시 비율로 판정합니다.</p>
        </section>
        <section className="quality-detail-section">
          <h5>별도 시점 반복확인</h5>
          <p>{diagnostic.repeatConfirmation.reason}</p>
          {diagnostic.sessions.length ? (
            <ol className="quality-evidence-list">
              {diagnostic.sessions.map((session, index) => (
                <li key={session.id ?? index}>
                  <b>{index + 1}차 · {session.date || "날짜 없음"} · {session.ratio === null ? "비율 판정 불가" : `post-BD ${session.ratio.toFixed(3)}`}</b>
                  <span>{session.valid ? `${session.id} · 출처·품질 확인` : session.reasons.join(" · ")}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {profile?.scenario?.kind === "NORMAL_STAGED" ? (
            <p className="quality-stage-note">1차 0.640만 있을 때는 ‘기준 일치 + 반복확인 대기’였고, 별도 날짜의 2차 0.650이 연결된 뒤 ‘반복 확인’으로 바뀐 변화 흐름입니다.</p>
          ) : null}
        </section>
        <section className="quality-detail-section">
          <h5>임상 맥락과 최종 판단</h5>
          <p>증상: {diagnostic.clinicalContext.symptoms.length ? diagnostic.clinicalContext.symptoms.join(", ") : "확인 안 됨"}</p>
          <p>{diagnostic.clinicalContext.exposure ? `노출력: ${diagnostic.clinicalContext.exposure.kind === "TOBACCO" ? "흡연" : diagnostic.clinicalContext.exposure.kind}${diagnostic.clinicalContext.exposure.packYears ? ` ${diagnostic.clinicalContext.exposure.packYears}갑년` : ""}` : "노출력: 확인 안 됨"}</p>
          <p>{diagnostic.clinicianDiagnosis.reason}</p>
          <p>수치만으로 진단명을 자동 입력·삭제하지 않으며 천식·기관지확장증 등 다른 원인은 의료진이 함께 판단합니다.</p>
          <SourceLink rule={diagnostic.rule} />
        </section>
      </div>
    </>
  );
}

function PneumoniaDiagnostic({ diagnostic }) {
  return (
    <>
      <div className="quality-diagnostic-summary" id="diseaseDiagnosticSummary" aria-live="polite" aria-atomic="true">
        <div className="quality-diagnostic-summary__content" data-status={diagnostic.status}>
          <strong>{pneumoniaDiagnosticHeadline(diagnostic)}</strong>
          <div className="quality-diagnostic-axes">
            <DiagnosticAxis label="흉부 영상" status={diagnostic.imaging.status} value={axisValue(diagnostic.imaging.status, "새 침윤 확인", "판독 확인 필요", "새 침윤 없음")} />
            <DiagnosticAxis label="감염 근거" status={diagnostic.infectionEvidence.status} value={axisValue(diagnostic.infectionEvidence.status, "기록 확인", "자료 확인 필요", "근거 없음")} />
            <DiagnosticAxis label="발생 맥락" status={diagnostic.communitySetting.status} value={axisValue(diagnostic.communitySetting.status, "지역사회 발생", "시점 확인 필요", "CAP 범위 밖")} />
            <DiagnosticAxis label="의료진 진단" status={diagnostic.clinicianDiagnosis.status} value={diagnostic.clinicianDiagnosis.documented ? "기록 있음" : "기록 없음"} />
          </div>
          <p className="quality-diagnostic-boundary">{diagnostic.disclaimer}</p>
        </div>
      </div>
      <div className="claim-overview-disclosure__body quality-diagnostic-details" id="diseaseDiagnosticDetails">
        <section className="quality-detail-section">
          <h5>진단 정합성 네 축</h5>
          <ul className="quality-detail-list">
            {[["흉부 영상", diagnostic.imaging], ["감염을 시사하는 근거", diagnostic.infectionEvidence], ["지역사회 발생 맥락", diagnostic.communitySetting], ["의료진 최종 진단", diagnostic.clinicianDiagnosis]].map(([label, item]) => (
              <li key={label}><b>{label}</b><span>{item.reason}</span></li>
            ))}
          </ul>
        </section>
        <section className="quality-detail-section quality-detail-section--boundary">
          <h5>임상 판단과 적정성 평가 분리</h5>
          <p>CURB-65·PSI는 중증도를 확인하는 도구이며, 점수만으로 폐렴 진단·입원·항생제를 자동 결정하지 않습니다.</p>
          <p>과정지표의 미포함 예상은 기관 적정성 평가 기여 가능성을 뜻하며 개별 진료비 삭감 확정과 같지 않습니다.</p>
          <SourceLink rule={diagnostic.rule} />
        </section>
      </div>
    </>
  );
}

export function DiseaseAssessmentCard({ state, patient, selectedDiseaseId, onSelectDisease }) {
  const options = state.demo ? getDiseaseAssessmentOptions(patient) : [];
  const requested = selectedDiseaseId || getPreferredDiseaseAssessmentId(patient);
  const activeId = options.some(({ id }) => id === requested) ? requested : options[0]?.id ?? "";
  const result = state.demo && activeId ? evaluateDiseaseAssessment(patient, activeId) : null;

  const emptyMessage = !state.demo
    ? "질환별 적정성 평가는 검증된 기관 데이터 연결 뒤 표시합니다."
    : !options.length
      ? "이 환자에게 연결된 질환별 평가가 없습니다."
      : !result ? "선택한 질환의 평가 자료를 연결하지 못했습니다." : "";

  const quality = result?.quality;
  const includedMetricCount = quality?.metrics.filter(({ status }) => status === "included").length ?? 0;
  const applicableMetricCount = quality?.metrics.filter(({ status }) => status !== "not-applicable").length ?? 0;
  const attentionMetricCount = quality?.metrics.filter(({ status }) => ["not-included", "insufficient"].includes(status)).length ?? 0;
  const exceptions = quality?.metrics.filter(({ status }) => ["not-included", "insufficient"].includes(status)) ?? [];
  const qualityRule = activeId === "copd" ? HIRA_COPD_2026_RULESET : HIRA_PNEUMONIA_2026_RULESET;
  const diagnosticRule = activeId === "copd" ? GOLD_COPD_2026_RULESET : KDCA_PNEUMONIA_2026_GUIDELINE;

  const onTabKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = options.findIndex(({ id }) => id === activeId);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? options.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : options.length - 1)) % options.length;
    const next = options[nextIndex];
    if (next) {
      onSelectDisease(next.id);
      requestAnimationFrame(() => document.querySelector(`[data-disease-assessment-id="${next.id}"]`)?.focus());
    }
  };

  return (
    <section className="clinical-card claim-overview-card disease-assessment-card" aria-labelledby="diseaseAssessmentTitle">
      <div className="card-heading">
        <div><p className="rail-eyebrow">QUALITY ASSESSMENT</p><h3 id="diseaseAssessmentTitle">적정성 평가</h3></div>
        <span className="source-badge source-badge--draft">기관 질 지표 예상</span>
      </div>
      <aside className="quality-claim-boundary" aria-label="청구 심사와 적정성 평가의 차이">
        <b>개별 청구 조정과 별개의 기관 평가입니다.</b>
        <span>지표 미충족 예상이 해당 검사·약제 비용의 삭감을 뜻하지 않습니다.</span>
      </aside>
      <p className="claim-overview-card__intro">질환을 선택해 평가대상 여부와 지표별 충족 예상만 먼저 보고, 산출 기간과 근거는 필요할 때 펼쳐 보세요.</p>

      <div className="disease-assessment-tabs" id="diseaseAssessmentTabs" role="tablist" aria-label="질환 평가 선택" onKeyDown={onTabKeyDown}>
        {options.length === 0 ? <span className="claim-overview-empty">{emptyMessage || "연결된 질환을 확인하는 중입니다."}</span> : options.map((option) => (
          <button className="disease-assessment-tab" type="button" role="tab" key={option.id}
            data-disease-assessment-id={option.id}
            aria-selected={option.id === activeId} aria-controls="diseaseAssessmentPanel" tabIndex={option.id === activeId ? 0 : -1}
            onClick={() => onSelectDisease(option.id)}>
            <b>{option.label}</b><small>{option.shortLabel}</small>
          </button>
        ))}
      </div>

      <div className="disease-assessment-panel" id="diseaseAssessmentPanel" role="tabpanel" aria-labelledby="diseaseAssessmentTitle" tabIndex={0}>
        <div className="disease-program-heading">
          <div>
            <p className="rail-eyebrow" id="diseaseProgramEyebrow">{result ? result.program.eyebrow : "SUPPORTED PROGRAM"}</p>
            <h4 id="diseaseProgramTitle">{result ? result.program.label : emptyMessage ? "연결된 질환 평가 없음" : "질환별 검토 준비 중"}</h4>
          </div>
          <span id="diseaseProgramStatus">{result
            ? result.quality.target.status === "eligible" ? "평가대상 예상" : result.quality.target.status === "insufficient" ? "대상 확인 필요" : "대상 아님 예상"
            : "해당 없음"}</span>
        </div>
        <p className="disease-program-intro" id="diseaseProgramIntro" hidden={!result}>{result?.program.description}</p>

        <div className="quality-program-summary" id="diseaseQualitySummary" aria-live="polite" aria-atomic="true">
          {!result ? <p className="claim-overview-empty">{emptyMessage || "평가대상과 자료 완전성을 확인하는 중입니다."}</p> : (
            <div className="quality-program-summary__content" data-status={quality.target.status}>
              <span className="quality-program-score"><b>{includedMetricCount}/{applicableMetricCount}</b><small>지표 충족 예상</small></span>
              <span className="quality-program-summary__copy">
                <strong>{qualityTargetHeadline(quality)}</strong>
                {exceptions.length ? <p className="quality-program-summary__exceptions">확인할 지표 · {exceptions.map(({ label }) => label).join(" · ")}</p> : null}
              </span>
            </div>
          )}
        </div>

        {result ? (
          <>
            <details className="claim-overview-disclosure" id="diseaseQualityDisclosure">
              <summary><span><b>평가 지표 자세히 보기</b><small id="diseaseQualityDisclosureHint">{quality.metrics.length}개 지표 · 충족 예상 {includedMetricCount} · 확인 {attentionMetricCount}</small></span></summary>
              <div className="claim-overview-disclosure__body quality-program-details">
                <div className="quality-program-metrics" id="diseaseQualityMetrics" aria-label="선택 질환의 환자별 지표 기여 예상">
                  {quality.metrics.map((metric) => {
                    const status = QUALITY_METRIC_STATUS[metric.status] ?? QUALITY_METRIC_STATUS.insufficient;
                    return (
                      <details className="quality-program-metric" data-metric-status={metric.status} data-quality-metric-id={metric.id} key={metric.id}>
                        <summary className="quality-program-metric__summary">
                          <span className="quality-program-metric__mark">{status.icon}</span>
                          <span className="quality-program-metric__label"><b>{metric.label}</b><small className="quality-program-metric__status">{status.label}</small></span>
                          <strong className="quality-program-metric__value">{qualityObservedLabel(metric)}</strong>
                        </summary>
                        <div className="quality-program-metric__detail">
                          <small>{metricReferenceLabel(metric, result.program.id)}</small>
                          <p>{metric.reason}</p>
                        </div>
                      </details>
                    );
                  })}
                </div>
                <div id="diseaseQualityDetails">
                  <section className="quality-detail-section">
                    <h5>평가대상 예상 근거</h5>
                    <p>{quality.target.reason}</p>
                    <p>{qualityTargetDetail(quality, result.program.id)}</p>
                  </section>
                  <section className="quality-detail-section quality-detail-section--boundary">
                    <h5>코드·판정 경계</h5>
                    {result.program.id === "copd" ? (
                      <p>PFT 코드는 {HIRA_COPD_2026_RULESET.pftCodes.join(", ")}를 확인합니다. 타기관 검사는 출처·환자 일치·검토자·검증 시각이 모두 확인된 경우에만 기여 근거로 사용합니다.</p>
                    ) : (
                      <>
                        <p>병원급 이상에서 만 18세 이상 지역사회획득 폐렴 입원, 주상병·제1부상병, 정맥 항생제 3일 이상을 환자 단위로 확인합니다.</p>
                        <p>혈액배양을 시행하지 않은 사례는 이 과정지표의 실패가 아니라 환자 분모 제외로 표시합니다.</p>
                      </>
                    )}
                    <p>{quality.disclaimer}</p>
                    <SourceLink rule={quality.rule} />
                  </section>
                </div>
              </div>
            </details>

            <details className="quality-diagnostic-panel" id="diseaseDiagnosticDisclosure">
              <summary>
                <span className="quality-diagnostic-panel__label">
                  <span className="rail-eyebrow" id="diseaseDiagnosticEyebrow">{result.program.diagnostic.eyebrow}</span>
                  <b id="diseaseDiagnosticTitle">{result.program.diagnostic.title}</b>
                  <small id="diseaseDiagnosticDisclosureHint">{activeId === "copd" ? copdDiagnosticHeadline(result.diagnostic) : pneumoniaDiagnosticHeadline(result.diagnostic)}</small>
                </span>
                <span className="quality-diagnostic-panel__badge">자동 진단 아님</span>
              </summary>
              <div className="quality-diagnostic-panel__body">
                {activeId === "copd"
                  ? <CopdDiagnostic diagnostic={result.diagnostic} profile={result.profile} />
                  : <PneumoniaDiagnostic diagnostic={result.diagnostic} />}
              </div>
            </details>

            <details className="claim-overview-disclosure quality-assessment-sources" id="diseaseAssessmentSources">
              <summary><span><b>기준·출처와 사용 범위</b><small>공식 문서·평가 시점·판정 경계</small></span></summary>
              <div className="claim-overview-disclosure__body">
                <p className="quality-assessment-meta" id="diseaseAssessmentMeta">
                  {qualityRule.version} · {diagnosticRule.version} · 평가 기준 시점 {displayTimestamp(result.evaluatedAt)} · <SourceLink rule={qualityRule} /> · <SourceLink rule={diagnosticRule} />
                </p>
                <p className="quality-assessment-boundary"><b>사용 범위</b> 공식 기관 점수·등급이나 가산금액을 계산하지 않으며, 평가 충족만을 위한 검사·내원·처방 또는 자동 진단을 지시하지 않습니다.</p>
              </div>
            </details>
          </>
        ) : null}
      </div>
    </section>
  );
}
