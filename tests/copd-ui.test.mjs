import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { emrMarkup } from "./helpers/markup.mjs";

const html = await emrMarkup();
const css = await readFile(new URL("../src/emr.css", import.meta.url), "utf8");
const js = [
  html,
  await readFile(new URL("../src/disease-assessment.js", import.meta.url), "utf8"),
  await readFile(new URL("../src/copd-assessment.js", import.meta.url), "utf8"),
  await readFile(new URL("../src/pneumonia-assessment.js", import.meta.url), "utf8"),
  await readFile(new URL("../lib/emr/claims.js", import.meta.url), "utf8"),
  await readFile(new URL("../lib/emr/selectors.js", import.meta.url), "utf8"),
  await readFile(new URL("../lib/emr/format.js", import.meta.url), "utf8"),
].join("\n");

test("급여 주의와 질환별 적정성·진단 근거는 독립된 summary-first 패널이다", () => {
  for (const id of [
    "claimBoardKpis",
    "claimRuleTrust",
    "claimAttentionSummary",
    "claimAttentionList",
    "claimAttentionAllDisclosure",
    "claimAttentionAllList",
    "claimAdjudicationSummary",
    "claimAdjudicationList",
    "diseaseAssessmentTabs",
    "diseaseAssessmentPanel",
    "diseaseQualitySummary",
    "diseaseQualityMetrics",
    "diseaseQualityDetails",
    "diseaseAssessmentMeta",
    "diseaseAssessmentSources",
    "claimWorkflowDisclosure",
  ]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, id);
  }
  // 진단 정합성 요약·상세는 질환 변형(코드상 2곳)마다 한 번씩 정의되고, 런타임에는 하나만 렌더된다.
  for (const id of ["diseaseDiagnosticSummary", "diseaseDiagnosticDetails"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 2, id);
  }
  assert.match(html, /질환을 선택해 평가대상 여부와 지표별 충족 예상만 먼저 보고/);
  assert.match(html, /기관 질 지표 예상/);
  assert.match(html, /개별 청구 조정과 별개의 기관 평가입니다/);
  assert.match(html, /공식 기관 점수·등급이나 가산금액을 계산하지 않으며/);
  assert.match(html, /<details class="claim-overview-disclosure/);
  assert.match(html, /id="diseaseQualityDisclosure"[\s\S]*?id="diseaseQualityMetrics"/);
  assert.match(html, /<details class="quality-diagnostic-panel" id="diseaseDiagnosticDisclosure"/);
  assert.match(html, /<details class="claim-workflow-disclosure" id="claimWorkflowDisclosure"/);
  assert.doesNotMatch(html, /id="copd(?:Quality|Diagnostic|Assessment)/);
});

test("질환 선택은 환자별 관련 프로그램만 렌더하고 전환해도 전체 청구 요약을 유지한다", () => {
  assert.match(js, /getDiseaseAssessmentOptions/);
  assert.match(js, /getPreferredDiseaseAssessmentId/);
  assert.match(js, /evaluateDiseaseAssessment/);
  assert.match(js, /getCombinedDiseaseClaimProfile/);
  assert.match(js, /selectedDiseaseByPatientId/);
  assert.match(js, /data-disease-assessment-id/);
  assert.match(js, /TabsPrimitive\.(Root|List|Trigger)/);
  assert.match(js, /왼쪽 급여 주의사항은 전체 질환 기준으로 유지됩니다/);
  assert.match(css, /\.disease-assessment-tab\s*\{[\s\S]*?min-height:\s*48px/);
});

test("선택 환자 헤더는 확정 활성 질환을 별도 목록으로 렌더한다", () => {
  assert.match(html, /id="selectedPatientConditions"[\s\S]{0,40}?role="list"/);
  assert.match(js, /function confirmedActiveConditions\(patient\)/);
  assert.match(js, /event\.recordStatus === "final"/);
  assert.match(js, /event\.status === "active"/);
  assert.match(js, /event\.certainty === "confirmed"/);
  assert.match(js, /confirmedActiveConditions\(patient\)/);
  assert.match(js, /startsWith\("DEMO-"\)/);
  assert.match(js, /includes\("policycompass:demo"\)/);
});

test("공개 EMR UI는 공모전·DEMO 배지를 노출하지 않는다", () => {
  assert.doesNotMatch(html, /<b>예시<\/b>/);
  assert.doesNotMatch(html, />\s*DEMO\s*</i);
  assert.doesNotMatch(html, /\bcontest\b|공모전/i);
  assert.doesNotMatch(js, /claim-synthetic-badge/);
  assert.doesNotMatch(js, /합성 공모전 데모|합성 데모/);
});

test("COPD와 폐렴은 평가 지표와 임상 정합성을 서로 섞지 않는다", () => {
  assert.match(js, /HIRA_COPD_2026_RULESET/);
  assert.match(js, /HIRA_PNEUMONIA_2026_RULESET/);
  assert.match(js, /post-BD 기준/);
  assert.match(js, /정확히 0\.70/);
  assert.match(js, /흉부 영상/);
  assert.match(js, /CURB-65·PSI는 중증도를 확인하는 도구/);
  assert.match(js, /혈액배양을 시행하지 않은 사례/);
  assert.match(js, /개별 진료비 삭감 확정과 같지 않습니다/);
  assert.match(js, /자동 입력·삭제하지 않으며/);
  assert.match(js, /SourceLink/);
});

test("청구 색상은 내부 규칙 상태와 지급·심사 경계를 텍스트로 함께 표시한다", () => {
  assert.match(html, /빨강 · 내부 규칙상 근거 누락/);
  assert.match(html, /주황 · 등록 규칙 확인 필요/);
  assert.match(html, /초록 · 등록 규칙 조건 일치/);
  assert.match(html, /보라 · 자료 부족/);
  assert.match(html, /지급·급여·심사 결과 보장 아님/);
  assert.match(html, /ADJUDICATION RESULT[\s\S]*?>심사 결과</);
  assert.doesNotMatch(html, /[0-9]\. 청구 전 점검|[0-9]\. 심사 결과|[0-9]\. 적정성 평가/);
  assert.match(js, /resolveClaimPreflightPresentation/);
  assert.match(js, /resolveClaimAdjudicationPresentation/);
  assert.match(js, /latestFinalAdjudication/);
  assert.match(js, /paymentBoundary/);
  assert.match(js, /priorityClaimAttentionEntries/);
  assert.match(js, /evaluation\.status === "not-applicable"/);
  assert.match(js, /판정 자료를 보완할 항목/);
  assert.match(css, /data-claim-state="high-risk"/);
  assert.match(css, /data-claim-state="needs-review"/);
  assert.match(css, /data-adjudication-state="recognized"/);
  assert.match(css, /data-claim-state="verified"/);
});

test("반응형 평가 패널은 좁은 화면에서 1열이며 새 모듈을 모두 배포한다", async () => {
  assert.match(css, /\.claim-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.22fr\) minmax\(360px, 0\.78fr\)/);
  assert.match(css, /\.quality-program-metrics\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?\.claim-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.quality-program-metrics/);
  assert.match(css, /#panel-claims details:not\(\[open\]\) > :not\(summary\)\s*\{[\s\S]*?display:\s*none/);
  assert.doesNotMatch(css.match(/\.claim-overview-grid\s*\{[^}]+\}/)?.[0] ?? "", /overflow-x:\s*auto/);
  const diseaseModule = await readFile(new URL("../src/disease-assessment.js", import.meta.url), "utf8");
  for (const file of ["copd-demo-data.js", "copd-assessment.js", "pneumonia-demo-data.js", "pneumonia-assessment.js"]) {
    assert.match(diseaseModule, new RegExp(file.replace(".", "\\.")));
  }
  for (const file of ["claim-presentation.js", "claim-search.js", "disease-assessment.js"]) {
    assert.match(js, new RegExp(file.replace(".", "\\.")));
  }
});

test("급여·적정성의 핵심 판정은 근거 문구보다 큰 위계로 읽힌다", () => {
  const claimsWorkbenchCss = css.slice(css.indexOf("/* Claims workbench:"));
  assert.match(css, /EMR review hierarchy/);
  assert.match(css, /\.claim-attention-summary__content > strong\s*\{[\s\S]*?font-size:\s*1\.05rem/);
  assert.match(css, /\.quality-program-score b\s*\{[\s\S]*?font-size:\s*1\.35rem/);
  assert.match(css, /\.claim-intro \.card-heading h3\s*\{[\s\S]*?font-size:\s*clamp\(1\.15rem/);
  assert.match(css, /\.claim-board-kpi > strong\s*\{[\s\S]*?font-size:\s*clamp\(1\.45rem/);
  assert.match(css, /\.claim-card__details-header h5\s*\{[\s\S]*?font-size:\s*clamp\(1\.45rem/);
  assert.match(html, /진료일·청구 항목별로 조치가 필요한 조건만 먼저 보여 줍니다/);
  assert.doesNotMatch(js, /claim-attention-item__reason/);
  assert.doesNotMatch(claimsWorkbenchCss, /border-left:\s*3px|box-shadow:\s*inset 3px/);
  assert.match(claimsWorkbenchCss, /\.claim-attention-list > li,[\s\S]*?background:\s*linear-gradient/);
  assert.match(claimsWorkbenchCss, /button\.claim-attention-item__summary:hover\s*\{[\s\S]*?background:\s*linear-gradient/);
  assert.match(claimsWorkbenchCss, /\.quality-program-metric__detail\s*\{[\s\S]*?background:\s*linear-gradient/);
});
