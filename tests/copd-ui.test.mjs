import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, js, build] = await Promise.all([
  readFile(new URL("../src/emr.html", import.meta.url), "utf8"),
  readFile(new URL("../src/emr.css", import.meta.url), "utf8"),
  readFile(new URL("../src/emr.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
]);

test("claim and COPD domains are separate summary-first panels with drilldown", () => {
  for (const id of [
    "claimAttentionSummary",
    "claimAttentionList",
    "copdQualitySummary",
    "copdQualityMetrics",
    "copdQualityDetails",
    "copdDiagnosticSummary",
    "copdDiagnosticDetails",
    "copdAssessmentMeta",
  ]) {
    assert.equal((html.match(new RegExp(`id=\"${id}\"`, "g")) ?? []).length, 1, id);
  }
  assert.match(html, /환자별 기여 예상/);
  assert.match(html, /공식 점수 아님/);
  assert.match(html, /검사·내원·처방 또는 진단을 자동으로 결정하지 않습니다/);
  assert.match(html, /<details class="claim-overview-disclosure/);
});

test("claim colors have text labels and red comes through final adjudication resolver", () => {
  assert.match(html, /빨강 · 삭감 확정/);
  assert.match(html, /노랑 · 사전 위험 확인/);
  assert.match(html, /초록 · 사전점검 통과/);
  assert.match(html, /회색 · 확인 불충분/);
  assert.match(js, /resolveClaimPresentation/);
  assert.match(js, /adjudications/);
  assert.match(js, /paymentBoundary/);
  assert.match(css, /data-claim-state="reduced"/);
  assert.match(css, /data-claim-state="risk"/);
  assert.match(css, /data-claim-state="verified"/);
});

test("COPD renderer exposes three metrics, four diagnostic axes, source/version and safety boundary", () => {
  assert.match(js, /evaluateHiraCopd2026Contribution/);
  assert.match(js, /evaluateGoldCopdConcordance/);
  assert.match(js, /지표 가중치/);
  assert.match(js, /임상 맥락/);
  assert.match(js, /post-BD 기준/);
  assert.match(js, /반복 확인/);
  assert.match(js, /의료진 진단/);
  assert.match(js, /정확히 0\.70/);
  assert.match(js, /자동 입력·삭제하지 않으며/);
  assert.match(js, /appendSourceLink/);
});

test("responsive panels collapse without horizontal scrolling and new modules are built", () => {
  assert.match(css, /\.claim-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 0\.94fr\) minmax\(0, 1\.06fr\)/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?\.claim-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.copd-diagnostic-axes/);
  assert.doesNotMatch(css.match(/\.claim-overview-grid\s*\{[^}]+\}/)?.[0] ?? "", /overflow-x:\s*auto/);
  for (const file of ["claim-presentation.js", "copd-demo-data.js", "copd-assessment.js"]) assert.match(build, new RegExp(file.replace(".", "\\.")));
});
