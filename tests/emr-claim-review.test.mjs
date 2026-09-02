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
} from "../src/emr-model.js";
import { sha256Hex } from "../src/sha256.js";
import { evaluateClaimRule } from "../src/claim-rules.js";

import { componentMarkup } from "./helpers/markup.mjs";

const css = await readFile(new URL("../src/emr.css", import.meta.url), "utf8");
const workbench = await componentMarkup("components/emr/claims/workbench.jsx");
const claimsTab = await componentMarkup("components/emr/tabs/claims-tab.jsx");
const claimsLib = await readFile(new URL("../lib/emr/claims.js", import.meta.url), "utf8");
const ruleManager = await componentMarkup("components/emr/claims/rule-manager.jsx");
const board = [workbench, claimsTab, claimsLib, ruleManager].join("\n");

test("급여 칸반은 자동 판정과 담당자 검토 단계를 명확히 분리한다", () => {
  assert.match(workbench, /자동 규칙 판정 요약/);
  assert.match(board, /규칙 판정 뒤 담당자를 배정하고, 해야 할 작업부터 확인합니다|담당자를 배정하고/);
  assert.match(claimsLib, /CLAIM_REVIEW_STAGE_ORDER = (?:Object\.freeze\()?\["new", "evidence", "reviewing", "reviewed"\]/);
  assert.match(claimsLib, /new: "검토 대기"/);
  assert.match(claimsLib, /evidence: "자료 확인"/);
  assert.match(claimsLib, /reviewed: "최종 판정"/);
  assert.match(workbench, /자동 판정 · \{CLAIM_LANE_LABELS\[evaluation\.status\]\}/);
  assert.match(workbench, /규칙 판정 \$\{computedLabel\} 유지/);
});

test("급여 칸반은 드래그·키보드 대체·라이브 안내·감사 이력을 제공한다", () => {
  assert.match(workbench, /id="claimBoardLive" role="status" aria-live="polite"/);
  assert.match(workbench, /draggable/);
  assert.match(workbench, /onDragStart/);
  assert.match(workbench, /onDragOver/);
  assert.match(workbench, /onDrop/);
  assert.match(workbench, /setClaimReviewStage\(/);
  assert.match(workbench, /검토 이력/);
  assert.match(workbench, /보험자 심사결과는 변경되지 않았습니다/);
});

test("급여 카드는 판단 요약을 먼저 보이고 선택하면 근거와 규칙 세부정보를 접근 가능하게 펼친다", () => {
  assert.match(claimsTab, /카드를 선택하면 오른쪽 근거 패널에서 적용 규칙·EMR 기록·시간 흐름과 완료 조건을 함께 볼 수 있습니다|근거 패널/);
  assert.match(workbench, /aria-expanded/);
  assert.match(workbench, /aria-haspopup="dialog"/);
  assert.match(workbench, /DialogPrimitive\.Root open modal=\{false\}/);
  assert.match(workbench, /class="claim-card__details" data-claim-detail-open aria-labelledby="claimDetailTitle"/);
  assert.match(workbench, /기간·횟수 미집계/);
  assert.match(workbench, /집계 구간 내" : "집계 구간 밖/);
  assert.match(workbench, /시간·횟수 계산/);
  assert.match(workbench, /evaluation\.windowStart/);
  assert.match(workbench, /evaluation\.windowEnd/);
  assert.match(workbench, /직접 연결된 확정 차트 근거가 없습니다/);
  for (const section of ["판정 요약", "적용 규칙", "EMR에서 확인한 사실", "해야 할 작업", "담당자 의견·결론", "검토 이력"]) {
    assert.match(workbench, new RegExp(section), section);
  }
  assert.match(css, /\.claim-card__details::backdrop\s*\{/);
  assert.match(css, /\.claim-card__details-content\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.claim-auto-calculation__metrics\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /\.claim-facts\s*\{/);
  assert.match(css, /\.claim-card__summary:focus-visible\s*\{/);
  assert.match(css, /\.claim-review-workbench\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.claim-review-detail-host\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /top:\s*calc\(var\(--header-height\) \+ var\(--space-3\)\)/);
});

test("재계산으로 오래된 담당자 검토가 되면 미분류로 안전하게 보이고 재검토를 안내한다", () => {
  assert.match(workbench, /resolveClaimReview\(/);
  assert.match(workbench, /이전 검토 무효화, 재검토 필요/);
  assert.match(workbench, /자동 판정·근거·규칙 또는 판정일이 달라져/);
  assert.match(css, /\.claim-review-stale\s*\{/);
});

test("급여 칸반은 데스크톱 Master–Detail과 모바일 전체화면 상세로 재배치한다", () => {
  assert.match(css, /#claimBoard\.claim-board\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /@media \(max-width: 1180px\) and \(min-width: 901px\)[\s\S]*?#claimBoard\.claim-board\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.claim-review-detail-host \.claim-card__details\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.claim-review-detail-host\s*\{[^}]*min-height:\s*min\(620px,\s*calc\(100dvh - var\(--header-height\)/s);
  assert.match(css, /\.claim-review-control select\s*\{[^}]*min-height:\s*44px/s);
});

test("대시보드·검색·Workflow는 동일한 고유 업무 ID로 연결되고 규칙 문서번호를 노출한다", () => {
  assert.match(claimsTab, /id="claimSearch"/);
  assert.match(claimsTab, /id="claimSearchResults"/);
  assert.match(ruleManager, /id="ruleSourceDocumentNumber"|sourceDocumentNumber/);
  assert.match(claimsLib, /\$\{patient\.id\}:profile:\$\{sourceId\}|profile:/);
  assert.match(claimsLib, /workItemId/);
  assert.match(board, /createClaimSearchEntry|buildClaimSearchIndex/);
  assert.match(board, /sourceDocumentNumber/);
  assert.match(claimsLib, /calculationAvailable: status !== "GRAY"/);
  assert.match(ruleManager, /reportValidity/);
  assert.match(css, /\.claim-review-control input/);
  assert.match(css, /\.claim-review-message\s*\{/);
  assert.match(claimsTab, /state\.demo \? getCombinedDiseaseClaimProfile\(patient\) : null/);
  assert.match(claimsLib, /profileEvidenceSnapshots|evidenceRecords/);
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
    system: "urn:policycompass:demo:service",
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
  assert.match(reconciled.audit.at(-1).detail, /최종 판정 → 검토 대기/);
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
