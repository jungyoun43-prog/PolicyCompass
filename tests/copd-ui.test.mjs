import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, js, build] = await Promise.all([
  readFile(new URL("../src/emr.html", import.meta.url), "utf8"),
  readFile(new URL("../src/emr.css", import.meta.url), "utf8"),
  readFile(new URL("../src/emr.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
]);

test("급여 주의와 질환별 적정성·진단 근거는 독립된 summary-first 패널이다", () => {
  for (const id of [
    "claimAttentionSummary",
    "claimAttentionList",
    "claimAttentionAllDisclosure",
    "claimAttentionAllList",
    "diseaseAssessmentTabs",
    "diseaseAssessmentPanel",
    "diseaseQualitySummary",
    "diseaseQualityMetrics",
    "diseaseQualityDetails",
    "diseaseDiagnosticSummary",
    "diseaseDiagnosticDetails",
    "diseaseAssessmentMeta",
    "diseaseAssessmentSources",
    "claimWorkflowDisclosure",
  ]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, id);
  }
  assert.match(html, /확정 질환을 선택하면 핵심 상태만 먼저 보여 줍니다/);
  assert.match(html, /공식 점수 아님/);
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
  assert.match(js, /ArrowLeft/);
  assert.match(js, /ArrowRight/);
  assert.match(js, /왼쪽 급여 주의사항은 전체 질환 기준으로 유지됩니다/);
  assert.match(css, /\.disease-assessment-tab\s*\{[\s\S]*?min-height:\s*48px/);
});

test("선택 환자 헤더는 확정 활성 질환을 별도 목록으로 렌더한다", () => {
  assert.match(html, /id="selectedPatientConditions"[^>]*role="list"/);
  assert.match(js, /function confirmedActiveConditions\(patient\)/);
  assert.match(js, /event\.recordStatus === "final"/);
  assert.match(js, /event\.status === "active"/);
  assert.match(js, /event\.certainty === "confirmed"/);
  assert.match(js, /function renderPatientConditions\(patient\)/);
  assert.match(js, /clear\(refs\.selectedPatientConditions\)/);
  assert.match(js, /renderPatientConditions\(patient\)/);
  assert.match(js, /startsWith\("DEMO-"\)/);
  assert.match(js, /includes\("vitagraph:demo"\)/);
});

test("공개 EMR UI는 공모전·DEMO 배지 대신 예시 환자 경계를 한 번 명시한다", () => {
  assert.match(html, /<b>예시 환자<\/b>/);
  assert.match(html, /실제 환자 아님 · 저장되지 않음/);
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
  assert.match(js, /appendSourceLink/);
});

test("청구 색상은 텍스트 상태와 함께 표시하고 빨강은 최종 심사결과에서만 온다", () => {
  assert.match(html, /빨강 · 삭감 확정/);
  assert.match(html, /노랑 · 사전 위험 확인/);
  assert.match(html, /초록 · 사전점검 통과/);
  assert.match(html, /회색 · 확인 불충분/);
  assert.match(js, /resolveClaimPresentation/);
  assert.match(js, /adjudications/);
  assert.match(js, /paymentBoundary/);
  assert.match(js, /priorityClaimAttentionEntries/);
  assert.match(js, /evaluation\.status === "not-applicable"/);
  assert.match(js, /즉시 위험은 없지만 확인 대기/);
  assert.match(css, /data-claim-state="reduced"/);
  assert.match(css, /data-claim-state="risk"/);
  assert.match(css, /data-claim-state="verified"/);
});

test("반응형 평가 패널은 좁은 화면에서 1열이며 새 모듈을 모두 배포한다", () => {
  assert.match(css, /\.claim-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.22fr\) minmax\(360px, 0\.78fr\)/);
  assert.match(css, /\.quality-program-metrics\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?\.claim-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.quality-program-metrics/);
  assert.match(css, /#panel-claims details:not\(\[open\]\) > :not\(summary\)\s*\{[\s\S]*?display:\s*none/);
  assert.doesNotMatch(css.match(/\.claim-overview-grid\s*\{[^}]+\}/)?.[0] ?? "", /overflow-x:\s*auto/);
  for (const file of [
    "claim-presentation.js",
    "copd-demo-data.js",
    "copd-assessment.js",
    "pneumonia-demo-data.js",
    "pneumonia-assessment.js",
    "disease-assessment.js",
  ]) assert.match(build, new RegExp(file.replace(".", "\\.")));
});

test("급여·적정성의 핵심 판정은 근거 문구보다 큰 위계로 읽힌다", () => {
  const claimsWorkbenchCss = css.slice(css.indexOf("/* Claims workbench:"));
  assert.match(css, /EMR review hierarchy/);
  assert.match(css, /\.claim-attention-summary__content > strong\s*\{[\s\S]*?font-size:\s*1\.05rem/);
  assert.match(css, /\.quality-program-score b\s*\{[\s\S]*?font-size:\s*1\.35rem/);
  assert.match(css, /\.quality-diagnostic-panel__label b\s*\{[\s\S]*?font-size:\s*0\.9rem/);
  assert.match(css, /\.claim-workflow-disclosure > summary b\s*\{[\s\S]*?font-size:\s*0\.95rem/);
  assert.match(html, /항목과 현재 판정만 먼저 보고/);
  assert.doesNotMatch(js, /claim-attention-item__reason/);
  assert.doesNotMatch(claimsWorkbenchCss, /border-left:\s*3px|box-shadow:\s*inset 3px/);
  assert.match(claimsWorkbenchCss, /\.claim-attention-list > li,[\s\S]*?background:\s*linear-gradient/);
  assert.match(claimsWorkbenchCss, /\.claim-attention-item__content\s*\{[\s\S]*?background:\s*linear-gradient/);
  assert.match(claimsWorkbenchCss, /\.quality-program-metric__detail\s*\{[\s\S]*?background:\s*linear-gradient/);
});
