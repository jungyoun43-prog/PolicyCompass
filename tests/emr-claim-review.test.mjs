import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addPatient,
  appendPatientEvent,
  appendStateAudit,
  claimEvaluationFingerprint,
  confirmPatientEvent,
  createEmptyEmrState,
  exportEmrBackup,
  normalizeEmrState,
  parseEmrBackup,
  prepareUnverifiedBackupRestore,
  reconcileClaimReviews,
  resolveClaimReview,
  setClaimReviewStage,
  sha256Hex,
} from "../src/emr-model.js";
import { evaluateClaimRule } from "../src/claim-rules.js";

const [html, css, js] = await Promise.all([
  readFile(new URL("../src/emr.html", import.meta.url), "utf8"),
  readFile(new URL("../src/emr.css", import.meta.url), "utf8"),
  readFile(new URL("../src/emr.js", import.meta.url), "utf8"),
]);

test("급여 칸반은 자동 판정과 담당자 검토 단계를 명확히 분리한다", () => {
  assert.match(html, /id="claimResultSummary"[^>]+자동 규칙 판정 요약/);
  assert.match(html, /규칙 판정과 담당자 검토 단계를 분리합니다/);
  assert.match(html, /수동 검토 단계만 이동합니다/);
  assert.match(js, /CLAIM_REVIEW_STAGE_ORDER = \["new", "evidence", "reviewing", "reviewed"\]/);
  assert.match(js, /`자동 판정 · \$\{CLAIM_LANE_LABELS\[evaluation\.status\]\}`/);
  assert.match(js, /규칙 판정 \$\{computedLabel\} 유지/);
});

test("급여 칸반은 드래그·키보드 대체·라이브 안내·감사 이력을 제공한다", () => {
  assert.match(html, /id="claimBoardLive"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(js, /card\.draggable = true/);
  assert.match(js, /addEventListener\("dragstart"/);
  assert.match(js, /addEventListener\("dragover"/);
  assert.match(js, /addEventListener\("drop"/);
  assert.match(js, /data\.claimReviewSelect|dataset\.claimReviewSelect/);
  assert.match(js, /setClaimReviewStage\(/);
  assert.match(js, /reconcileClaimReviews\(/);
  assert.match(js, /"claim-review\.invalidated"/);
  assert.match(js, /자동 규칙 판정 .*변경되지 않았습니다/);
});

test("급여 카드는 판단 요약을 먼저 보이고 선택하면 근거와 규칙 세부정보를 접근 가능하게 펼친다", () => {
  const renderClaimBoardSource = js.slice(
    js.indexOf("function renderClaimBoard(patient)"),
    js.indexOf("function renderJourney(patient, brief)"),
  );
  assert.match(html, /카드에는 자동 판정·보완 항목·기준 사용량만 먼저 표시합니다/);
  assert.match(renderClaimBoardSource, /summary\.dataset\.claimDetailToggle = evaluation\.id/);
  assert.match(renderClaimBoardSource, /summary\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(renderClaimBoardSource, /summary\.setAttribute\("aria-controls", detailsId\)/);
  assert.match(renderClaimBoardSource, /summary\.setAttribute\("aria-haspopup", "dialog"\)/);
  assert.match(renderClaimBoardSource, /document\.createElement\("dialog"\)/);
  assert.match(renderClaimBoardSource, /details\.setAttribute\("role", "dialog"\)/);
  assert.match(renderClaimBoardSource, /details\.setAttribute\("aria-modal", "true"\)/);
  assert.match(renderClaimBoardSource, /details\.setAttribute\("aria-labelledby", detailTitleId\)/);
  assert.match(renderClaimBoardSource, /summary\.append\(computedStatus\)/);
  assert.match(renderClaimBoardSource, /summary\.append\(stale\)/);
  assert.match(renderClaimBoardSource, /summary\.append\(element\("span", "claim-missing"/);
  assert.match(renderClaimBoardSource, /summary\.append\(facts\)/);
  assert.match(renderClaimBoardSource, /detailContent\.append\(evidence, detailAside, detailBoundary\)/);
  assert.match(renderClaimBoardSource, /직접 연결된 확정 차트 근거가 없습니다/);
  assert.match(js, /addEventListener\("click", \(event\) => \{[\s\S]*?data-claim-detail-toggle[\s\S]*?details\.showModal\(\)/);
  assert.match(css, /\.claim-card__details::backdrop\s*\{/);
  assert.match(css, /\.claim-card__details-content\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.claim-card__summary:focus-visible\s*\{/);
});

test("재계산으로 오래된 담당자 검토가 되면 미분류로 안전하게 보이고 재검토를 안내한다", () => {
  assert.match(js, /resolveClaimReview\(state, evaluation\)/);
  assert.match(js, /data\.claimReviewStale|dataset\.claimReviewStale/);
  assert.match(js, /이전 검토 무효화, 재검토 필요/);
  assert.match(js, /자동 판정·근거·규칙 또는 판정일이 달라져/);
  assert.match(css, /\.claim-review-stale\s*\{/);
});

test("급여 칸반은 넓은 화면 4열에서 모바일 1열까지 내부 가로 넘침 없이 재배치한다", () => {
  assert.match(css, /\.claim-board\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?\.claim-board\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.claim-board\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css.match(/\.claim-board\s*\{[^}]*\}/s)?.[0] ?? "", /overflow-x:\s*auto|grid-auto-flow:\s*column/);
  assert.match(css, /\.claim-review-control select\s*\{[^}]*min-height:\s*44px/s);
});

function claimReviewFixture() {
  let state = addPatient(createEmptyEmrState("2026-07-22T00:00:00.000Z"), {
    id: "claim-review-patient",
    mrn: "CLAIM-REVIEW-1",
    name: "급여 검토 환자",
    events: [
      {
        id: "claim-review-condition",
        type: "condition",
        recordStatus: "final",
        system: "urn:kr:kcd",
        code: "I10",
        label: "고혈압",
        date: "2026-07-20",
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        source: { kind: "manual", label: "검토 확정" },
      },
      {
        id: "claim-review-bp",
        type: "observation",
        recordStatus: "final",
        system: "http://loinc.org",
        code: "85354-9",
        label: "혈압",
        date: "2026-07-21",
        status: "final",
        value: "120/80",
        unit: "mmHg",
        source: { kind: "manual", label: "검토 확정" },
      },
    ],
  }, "2026-07-22T00:00:01.000Z");
  const rule = state.rules.find(({ id }) => id === "demo-bp-follow-up");
  const evaluation = evaluateClaimRule(state.patients[0], rule, "2026-07-22");
  return { state, rule, evaluation };
}

test("급여 검토 지문은 동기 SHA-256으로 길이를 고정하고 전체 입력을 반영한다", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  const fixture = claimReviewFixture();
  const oversized = structuredClone(fixture.state);
  const oversizedRule = oversized.rules.find(({ id }) => id === fixture.rule.id);
  oversizedRule.sourceLabel = `${"긴 규칙 근거 ".repeat(2_500)}A`;
  const evaluation = evaluateClaimRule(oversized.patients[0], oversizedRule, "2026-07-22");
  const fingerprint = claimEvaluationFingerprint(evaluation, oversized.patients[0]);
  assert.match(fingerprint, /^sha256:[0-9a-f]{64}$/);

  const reviewed = setClaimReviewStage(
    oversized,
    evaluation,
    "reviewed",
    "대용량 규칙 검토",
    "2026-07-22T00:01:00.000Z",
  );
  const reloaded = normalizeEmrState(structuredClone(reviewed));
  const reloadedRule = reloaded.rules.find(({ id }) => id === fixture.rule.id);
  const reloadedEvaluation = evaluateClaimRule(reloaded.patients[0], reloadedRule, "2026-07-22");
  assert.equal(resolveClaimReview(reloaded, reloadedEvaluation).stage, "reviewed");
  assert.equal(resolveClaimReview(reloaded, reloadedEvaluation).stale, false);

  reloadedRule.sourceLabel = `${"긴 규칙 근거 ".repeat(2_500)}B`;
  const suffixChanged = evaluateClaimRule(reloaded.patients[0], reloadedRule, "2026-07-22");
  assert.notEqual(claimEvaluationFingerprint(suffixChanged, reloaded.patients[0]), fingerprint);
  assert.equal(resolveClaimReview(reloaded, suffixChanged).stage, "new");
  assert.equal(resolveClaimReview(reloaded, suffixChanged).stale, true);
});

test("담당자 검토 단계는 1000건 감사 보존 한도를 넘어도 독립 상태로 유지된다", () => {
  const fixture = claimReviewFixture();
  let state = setClaimReviewStage(
    fixture.state,
    fixture.evaluation,
    "reviewed",
    "미분류 → 확인 완료 · 규칙 판정 시행 준비 유지 · 단계 선택",
    "2026-07-22T00:01:00.000Z",
  );
  assert.equal(state.claimReviews[0].stage, "reviewed");
  assert.equal(state.audit.at(-1).action, "claim-review.stage.reviewed");

  for (let index = 0; index < 1_001; index += 1) {
    state = appendStateAudit(
      state,
      "patient.updated",
      `감사 보존 경계 ${index}`,
      new Date(Date.parse("2026-07-22T01:00:00.000Z") + index).toISOString(),
      "claim-review-patient",
    );
  }

  assert.equal(state.audit.length, 1_000);
  assert.equal(state.audit.some(({ action }) => action === "claim-review.stage.reviewed"), false);
  assert.equal(state.claimReviews[0].stage, "reviewed");
  assert.equal(resolveClaimReview(state, fixture.evaluation).stage, "reviewed");
  assert.equal(resolveClaimReview(state, fixture.evaluation).stale, false);
});

test("자동 판정 근거가 바뀌면 순수 조회에서 이전 검토를 무효화하고 다음 mutation에서 감사한다", () => {
  const fixture = claimReviewFixture();
  const reviewed = setClaimReviewStage(
    fixture.state,
    fixture.evaluation,
    "reviewed",
    "미분류 → 확인 완료",
    "2026-07-22T00:01:00.000Z",
  );
  const originalFingerprint = claimEvaluationFingerprint(fixture.evaluation, reviewed.patients[0]);
  assert.equal(originalFingerprint, claimEvaluationFingerprint(structuredClone(fixture.evaluation), reviewed.patients[0]));

  let changed = appendPatientEvent(reviewed, "claim-review-patient", {
    id: "claim-review-service",
    type: "procedure",
    system: "urn:vitagraph:demo:service",
    code: "DEMO-BP-FOLLOWUP",
    label: "고혈압 추적검사",
    date: "2026-07-20",
    status: "completed",
    source: { kind: "manual", label: "직접 입력 · 검토 대기" },
  }, "2026-07-22T00:02:00.000Z");
  changed = confirmPatientEvent(
    changed,
    "claim-review-patient",
    "claim-review-service",
    "2026-07-22T00:03:00.000Z",
  );
  const changedEvaluation = evaluateClaimRule(changed.patients[0], fixture.rule, "2026-07-22");
  assert.equal(fixture.evaluation.status, "ready");
  assert.equal(changedEvaluation.status, "waiting");
  assert.equal(changedEvaluation.id, fixture.evaluation.id);
  assert.notEqual(claimEvaluationFingerprint(changedEvaluation, changed.patients[0]), originalFingerprint);

  const auditCountBeforeResolve = changed.audit.length;
  const pureView = resolveClaimReview(changed, changedEvaluation);
  assert.equal(pureView.stage, "new");
  assert.equal(pureView.stale, true);
  assert.equal(pureView.invalidatedFrom, "reviewed");
  assert.equal(changed.claimReviews[0].stage, "reviewed");
  assert.equal(changed.audit.length, auditCountBeforeResolve);

  const reconciled = reconcileClaimReviews(changed, [changedEvaluation], "2026-07-22T00:04:00.000Z");
  assert.equal(reconciled.claimReviews[0].stage, "new");
  assert.equal(reconciled.claimReviews[0].invalidatedFrom, "reviewed");
  assert.equal(reconciled.audit.at(-1).action, "claim-review.invalidated");
  assert.match(reconciled.audit.at(-1).detail, /확인 완료 → 미분류/);
  assert.equal(evaluateClaimRule(reconciled.patients[0], fixture.rule, "2026-07-22").status, "waiting");

  const resumed = setClaimReviewStage(
    reconciled,
    changedEvaluation,
    "evidence",
    "미분류 → 근거 대조",
    "2026-07-22T00:05:00.000Z",
  );
  assert.equal(resolveClaimReview(resumed, changedEvaluation).stage, "evidence");
  assert.equal(resolveClaimReview(resumed, changedEvaluation).stale, false);
  assert.deepEqual(
    resumed.audit.slice(-2).map(({ action }) => action),
    ["claim-review.invalidated", "claim-review.stage.evidence"],
  );
});

test("검토 상태 백업은 엄격히 검증하고 미검증 복원에서는 신뢰하지 않는다", () => {
  const fixture = claimReviewFixture();
  const reviewed = setClaimReviewStage(
    fixture.state,
    fixture.evaluation,
    "reviewed",
    "미분류 → 확인 완료",
    "2026-07-22T00:01:00.000Z",
  );
  const backup = exportEmrBackup(reviewed, "2026-07-22T00:02:00.000Z");
  assert.equal(parseEmrBackup(structuredClone(backup)).claimReviews[0].stage, "reviewed");

  const oldV2Backup = structuredClone(backup);
  delete oldV2Backup.data.claimReviews;
  assert.deepEqual(parseEmrBackup(oldV2Backup).claimReviews, []);

  const forged = structuredClone(backup);
  forged.data.claimReviews[0].stage = "approved";
  assert.throws(() => parseEmrBackup(forged), /손상|유실/);

  const restored = prepareUnverifiedBackupRestore(
    parseEmrBackup(structuredClone(backup)),
    reviewed,
    "2026-07-22T00:03:00.000Z",
  );
  assert.deepEqual(restored.claimReviews, []);
});
