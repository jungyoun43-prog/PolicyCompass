import assert from "node:assert/strict";
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
import { CLAIM_LANE_LABELS, CLAIM_LANE_ORDER, evaluateClaimRule } from "../src/claim-rules.js";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { getCombinedDiseaseClaimProfile, getDiseaseAssessmentProfiles } from "../src/disease-assessment.js";
import {
  buildClaimSearchIndex,
  claimAttentionEntries,
  claimReviewEvaluationsForPatients,
  CLAIM_REVIEW_STAGE_LABELS,
  CLAIM_REVIEW_STAGE_ORDER,
  profileEvidenceSnapshots,
} from "../lib/emr/claims.js";
import { ClaimWorkbench } from "../components/emr/claims/workbench.jsx";
import { RuleManager } from "../components/emr/claims/rule-manager.jsx";
import { ClaimsTab } from "../components/emr/tabs/claims-tab.jsx";

import { declarationsFor, hasRule, selectorsMatching, stylesheet } from "./helpers/css.mjs";
import { componentMarkup } from "./helpers/markup.mjs";
import { renderComponent } from "./helpers/render.mjs";

const sheet = await stylesheet("src/emr.css");
const workbenchSource = await componentMarkup("components/emr/claims/workbench.jsx");
const ruleManagerSource = await componentMarkup("components/emr/claims/rule-manager.jsx");

const demo = createDemoEmrState("2026-09-02T00:00:00.000Z");
const store = { applyMutation: async () => {}, setStatus: () => {} };
const noop = () => {};
const kim = demo.patients.find(({ name }) => name === "김비타");
const kimEvaluations = claimReviewEvaluationsForPatients(demo, [kim]);
const kimProfile = getCombinedDiseaseClaimProfile(kim);
const kimBloodPressure = kimEvaluations.find(({ rule }) => rule?.id === "demo-bp-follow-up");

function renderWorkbench({ state = demo, evaluations = kimEvaluations, activeDetailId = "", boardScope = "patient" } = {}) {
  const calculatedCounts = Object.fromEntries(CLAIM_LANE_ORDER.map((status) => [status, 0]));
  for (const { status } of evaluations) calculatedCounts[status] = (calculatedCounts[status] ?? 0) + 1;
  return renderComponent(ClaimWorkbench, {
    state, store, evaluations, boardScope, setBoardScope: noop, calculatedCounts,
    activeDetailId, setActiveDetailId: noop, requestedStage: "", setRequestedStage: noop,
  });
}

const renderClaimsTab = (state = demo, patient = kim) => renderComponent(ClaimsTab, { state, patient, store });

/** The rendered <article class="claim-card"> carrying this evaluation id. */
function claimCard(html, evaluationId) {
  const at = html.indexOf(`data-claim-evaluation-id="${evaluationId}"`);
  assert.ok(at > -1, `${evaluationId} 카드가 보드에 있다`);
  return html.slice(html.lastIndexOf("<article", at), html.indexOf("</article>", at));
}

/** The review-stage lane the card for this evaluation is rendered in. */
function laneOf(html, evaluationId) {
  const at = html.indexOf(`data-claim-evaluation-id="${evaluationId}"`);
  return [...html.matchAll(/data-claim-review-lane="([a-z]+)"/g)].filter((match) => match.index < at).at(-1)?.[1];
}

/** Titles of the 청구 전 점검 rows, in display order. */
const attentionTitles = (html) => [...html.matchAll(/<li class="claim-attention-item"[^>]*>.*?<strong>([^<]+)<\/strong>/g)].map((match) => match[1]);

test("급여 칸반은 자동 판정과 담당자 검토 단계를 명확히 분리한다", () => {
  const html = renderWorkbench({ activeDetailId: kimBloodPressure.id });
  const computedStatus = `<span class="claim-computed-status" data-status="${kimBloodPressure.status}">자동 판정 · ${CLAIM_LANE_LABELS[kimBloodPressure.status]}</span>`;

  assert.match(html, /id="claimResultSummary" aria-label="변경되지 않는 자동 규칙 판정 요약" role="list"/);
  assert.match(html, /규칙 판정 뒤 담당자를 배정하고, 해야 할 작업부터 확인합니다/);
  assert.deepEqual(CLAIM_REVIEW_STAGE_ORDER, ["new", "evidence", "reviewing", "reviewed"]);
  assert.equal(CLAIM_REVIEW_STAGE_LABELS.new, "검토 대기");
  assert.equal(CLAIM_REVIEW_STAGE_LABELS.evidence, "자료 확인");
  assert.equal(CLAIM_REVIEW_STAGE_LABELS.reviewed, "최종 판정");
  assert.deepEqual([...html.matchAll(/data-claim-review-lane="([a-z]+)"/g)].map((match) => match[1]), CLAIM_REVIEW_STAGE_ORDER);
  for (const stage of CLAIM_REVIEW_STAGE_ORDER) {
    assert.match(html, new RegExp(`<h4 id="claim-review-lane-${stage}">${CLAIM_REVIEW_STAGE_LABELS[stage]}</h4>`), stage);
  }
  // 카드와 근거 패널 모두 규칙 판정을 담당자 단계와 별도의 상태로 보여 준다.
  assert.ok(claimCard(html, kimBloodPressure.id).includes(computedStatus));
  assert.ok(html.slice(html.indexOf('id="claimReviewDetailHost"')).includes(computedStatus));
  // source-check: 단계 저장 감사 문구(규칙 판정 유지)는 저장 버튼 클릭 뒤 applyMutation 안에서 만들어져 서버 렌더로는 볼 수 없다.
  assert.match(workbenchSource, /규칙 판정 \$\{computedLabel\} 유지/);
});

test("급여 칸반은 드래그·키보드 대체·라이브 안내·감사 이력을 제공한다", () => {
  const html = renderWorkbench({ activeDetailId: kimBloodPressure.id });

  assert.match(html, /<p class="visually-hidden" id="claimBoardLive" role="status" aria-live="polite" aria-atomic="true">/);
  assert.match(claimCard(html, kimBloodPressure.id), /^<article class="claim-card"[^>]* draggable="true"/);
  assert.deepEqual([...html.matchAll(/data-claim-review-dropzone="([a-z]+)"/g)].map((match) => match[1]), CLAIM_REVIEW_STAGE_ORDER, "모든 단계가 놓기 대상이다");
  // 드래그 없이도 근거 패널의 단계 선택으로 모든 단계에 갈 수 있다.
  assert.match(html, new RegExp(`<select aria-label="${kimBloodPressure.title} 담당자 검토 단계 이동">`));
  for (const stage of CLAIM_REVIEW_STAGE_ORDER) {
    assert.match(html, new RegExp(`<option value="${stage}"[^>]*>${CLAIM_REVIEW_STAGE_LABELS[stage]}</option>`), stage);
  }
  assert.match(html, /<h6>검토 이력<\/h6>/);
  assert.match(html, /아직 담당자 이동 이력이 없습니다/);
  // source-check: 드래그 핸들러, 단계 저장(setClaimReviewStage), 저장 뒤 라이브 안내 문구는 브라우저 이벤트에서만 실행된다.
  assert.match(workbenchSource, /onDragStart/);
  assert.match(workbenchSource, /onDragOver/);
  assert.match(workbenchSource, /onDrop/);
  assert.match(workbenchSource, /setClaimReviewStage\(/);
  assert.match(workbenchSource, /보험자 심사결과는 변경되지 않았습니다/);
});

test("급여 카드는 판단 요약을 먼저 보이고 선택하면 근거와 규칙 세부정보를 접근 가능하게 펼친다", () => {
  const tab = renderClaimsTab();
  const opened = renderWorkbench({ activeDetailId: kimBloodPressure.id });
  const closed = renderWorkbench();
  const variant = (changes) => renderWorkbench({ evaluations: [{ ...kimBloodPressure, ...changes }], activeDetailId: kimBloodPressure.id });

  assert.match(tab, /카드를 선택하면 오른쪽 근거 패널에서 적용 규칙·EMR 기록·시간 흐름과 완료 조건을 함께 볼 수 있습니다/);
  assert.match(claimCard(closed, kimBloodPressure.id), /<button class="claim-card__summary" type="button" aria-expanded="false" aria-haspopup="dialog"/);
  assert.match(closed, /id="claimReviewDetailEmpty"/);
  assert.doesNotMatch(closed, /id="claimDetailTitle"/);
  assert.match(claimCard(opened, kimBloodPressure.id), /<button class="claim-card__summary" type="button" aria-expanded="true" aria-haspopup="dialog"/);
  // 근거 패널은 보드를 계속 조작할 수 있는 비모달 dialog다.
  assert.match(opened, /<section class="claim-card__details" data-claim-detail-open="true" aria-labelledby="claimDetailTitle" role="dialog"/);
  // source-check: Radix Dialog는 modal 여부를 서버 마크업에 드러내지 않아(aria-modal 미출력, modal true/false 모두 동일 HTML) 비모달 계약은 원문으로만 확인한다.
  assert.match(workbenchSource, /DialogPrimitive\.Root open modal=\{false\}/);
  assert.match(opened, new RegExp(`<h5 id="claimDetailTitle">${kimBloodPressure.title}</h5>`));
  assert.deepEqual(
    [...opened.matchAll(/<h6>([^<]+)<\/h6>/g)].map((match) => match[1]),
    ["판정 요약", "적용 규칙", "EMR에서 확인한 사실", "시간·횟수 계산", "해야 할 작업·완료 조건", "담당자 의견·결론", "검토 이력"],
  );
  assert.match(opened, new RegExp(`<small>집계 구간</small><strong>${kimBloodPressure.windowStart} ~ ${kimBloodPressure.windowEnd}</strong>`));
  assert.match(opened, /집계 구간 내/);
  assert.match(variant({ usedCount: 0 }), /집계 구간 밖/);
  assert.match(variant({ calculationAvailable: false }), /<small>자동 계산<\/small><strong>기간·횟수 미집계<\/strong>/);
  assert.match(variant({ evidenceEventIds: [] }), /직접 연결된 확정 차트 근거가 없습니다/);

  assert.ok(hasRule(sheet, ".claim-card__details::backdrop"));
  assert.ok(declarationsFor(sheet, ".claim-card__details-content")["grid-template-columns"]);
  assert.equal(declarationsFor(sheet, ".claim-auto-calculation__metrics")["grid-template-columns"], "repeat(4, minmax(0, 1fr))");
  assert.deepEqual(selectorsMatching(sheet, /\.claim-facts$/), []);
  assert.ok(hasRule(sheet, ".claim-card__summary:focus-visible"));
  assert.ok(declarationsFor(sheet, ".claim-review-workbench")["grid-template-columns"]);
  const detailHost = declarationsFor(sheet, ".claim-review-detail-host");
  assert.equal(detailHost.position, "sticky");
  assert.equal(detailHost.top, "calc(var(--header-height) + var(--space-3))");
});

test("재계산으로 오래된 담당자 검토가 되면 미분류로 안전하게 보이고 재검토를 안내한다", () => {
  const fixture = claimReviewFixture();
  const reviewed = setClaimReviewStage(fixture.state, fixture.evaluation, "reviewed", "미분류 → 확인 완료", "2026-07-22T00:01:00.000Z");
  const fresh = renderWorkbench({ state: reviewed, evaluations: [fixture.evaluation] });
  assert.equal(laneOf(fresh, fixture.evaluation.id), "reviewed");
  assert.match(claimCard(fresh, fixture.evaluation.id), /data-claim-review-stale="false"/);
  assert.doesNotMatch(fresh, /재검토 필요/);

  let changed = appendPatientEvent(reviewed, "claim-review-patient", {
    id: "claim-review-service", type: "procedure", system: "urn:policycompass:demo:service", code: "DEMO-BP-FOLLOWUP",
    label: "고혈압 추적검사", date: "2026-07-20", status: "completed", source: { kind: "manual", label: "직접 입력 · 검토 대기" },
  }, "2026-07-22T00:02:00.000Z");
  changed = confirmPatientEvent(changed, "claim-review-patient", "claim-review-service", "2026-07-22T00:03:00.000Z");
  const changedEvaluation = evaluateClaimRule(changed.patients[0], fixture.rule, "2026-07-22");
  const stale = renderWorkbench({ state: changed, evaluations: [changedEvaluation] });
  const card = claimCard(stale, changedEvaluation.id);

  assert.equal(laneOf(stale, changedEvaluation.id), "new", "무효화된 검토는 검토 대기 열로 돌아온다");
  assert.match(card, /data-claim-review-stale="true"/);
  assert.match(card, /aria-label="[^"]*이전 검토 무효화, 재검토 필요[^"]*"/);
  assert.match(card, /<span class="claim-review-stale"><b>재검토 필요 · <\/b>자동 판정·근거·규칙 또는 판정일이 달라져 이전 &#x27;최종 판정&#x27; 단계는 무효화되고 &#x27;검토 대기&#x27;로 돌아왔습니다\./);
  assert.ok(hasRule(sheet, ".claim-review-stale"));
});

test("급여 칸반은 데스크톱 Master–Detail과 모바일 전체화면 상세로 재배치한다", () => {
  const tablet = { container: "@media (max-width: 1180px) and (min-width: 901px)" };
  const mobile = { container: "@media (max-width: 900px)" };

  assert.equal(declarationsFor(sheet, "#claimBoard.claim-board")["grid-template-columns"], "repeat(2, minmax(0, 1fr))");
  assert.equal(declarationsFor(sheet, "#claimBoard.claim-board", tablet)["grid-template-columns"], "minmax(0, 1fr)");
  assert.equal(declarationsFor(sheet, ".claim-review-detail-host .claim-card__details", mobile).position, "fixed");
  assert.match(declarationsFor(sheet, ".claim-review-detail-host")["min-height"], /^min\(620px, calc\(100dvh - var\(--header-height\)/);
  assert.ok(Number.parseInt(declarationsFor(sheet, ".claim-review-control select")["min-height"], 10) >= 44, "데스크톱 터치 목표 44px 이상");
  assert.equal(declarationsFor(sheet, ".claim-review-control select", mobile)["min-height"], "44px");
});

test("대시보드·검색·Workflow는 동일한 고유 업무 ID로 연결되고 규칙 문서번호를 노출한다", () => {
  const tab = renderClaimsTab();
  const plainTab = renderClaimsTab({ ...demo, demo: false });
  const ruleManager = renderComponent(RuleManager, { state: demo, store });
  const detail = renderWorkbench({ activeDetailId: kimBloodPressure.id });
  const attention = claimAttentionEntries(kim, kimEvaluations, kimProfile);
  const index = buildClaimSearchIndex(demo, kim, kimEvaluations, kimProfile);
  const boardIds = [...tab.matchAll(/data-claim-evaluation-id="([^"]+)"/g)].map((match) => match[1]).sort();
  const profileEvaluations = kimEvaluations.filter(({ sourceKind }) => sourceKind === "profile");
  const park = demo.patients.find(({ name }) => name === "박여정");

  assert.match(tab, /<input id="claimSearch" type="search"/);
  assert.match(tab, /<ol class="claim-search__results" id="claimSearchResults"/);
  assert.match(ruleManager, /<input id="ruleSourceDocumentNumber"/);
  // 프로필 항목은 환자 ID와 출처 ID로 고유 업무 ID를 만들고, 대시보드 행·칸반 카드·검색 결과가 같은 ID를 가리킨다.
  assert.ok(profileEvaluations.length > 0);
  for (const evaluation of profileEvaluations) assert.equal(evaluation.id, `${kim.id}:profile:${evaluation.sourceId}`);
  assert.deepEqual(attention.map(({ workItemId }) => workItemId).sort(), boardIds);
  assert.deepEqual(index.filter(({ kind }) => kind === "workflow").map(({ target }) => target.evaluationId).sort(), boardIds);
  // 규칙 문서번호는 규칙 관리·근거 패널·검색 결과에 노출된다.
  for (const rule of demo.rules) {
    assert.ok(rule.sourceDocumentNumber, `${rule.id} 문서번호`);
    assert.ok(ruleManager.includes(rule.sourceDocumentNumber), `${rule.id} 규칙 관리 노출`);
    assert.ok(index.some(({ kind, subtitle }) => kind === "rule" && subtitle.includes(rule.sourceDocumentNumber)), `${rule.id} 검색 노출`);
  }
  assert.match(detail, new RegExp(`고시·문서번호 · ${kimBloodPressure.rule.sourceDocumentNumber}`));
  // 프로필 사전점검이 GRAY면 기간·횟수를 계산하지 않는다.
  for (const evaluation of profileEvaluations) assert.equal(evaluation.calculationAvailable, evaluation.claimContext.preflightStatus !== "GRAY");
  assert.ok(profileEvaluations.some(({ calculationAvailable }) => !calculationAvailable));
  assert.ok(profileEvaluations.some(({ calculationAvailable }) => calculationAvailable));
  // source-check: reportValidity는 규칙 폼 제출 이벤트에서만 호출되므로 DOM 없이 관찰할 수 없다.
  assert.match(ruleManagerSource, /reportValidity/);
  assert.ok(hasRule(sheet, ".claim-review-control input"));
  assert.ok(hasRule(sheet, ".claim-review-message"));
  // 질환 프로필은 데모 상태에서만 붙는다: 프로필 항목과 심사 결과는 데모가 아니면 사라진다.
  for (const { title } of profileEvaluations) {
    assert.ok(attentionTitles(tab).includes(title), `${title} 데모 노출`);
    assert.ok(!attentionTitles(plainTab).includes(title), `${title} 비데모 미노출`);
  }
  assert.match(renderClaimsTab(demo, park), /data-claim-adjudication-id="copd:park-synthetic-final-partial-reduction"/);
  assert.doesNotMatch(renderClaimsTab({ ...demo, demo: false }, park), /data-claim-adjudication-id=/);
  // 질환별 프로필의 근거 스냅샷이 평가의 evidenceRecords로 실린다.
  const diseaseProfiles = new Map(getDiseaseAssessmentProfiles(kim).map((profile) => [profile.assessmentId, profile]));
  for (const evaluation of profileEvaluations) {
    const diseaseProfile = diseaseProfiles.get(evaluation.claimContext.assessmentId);
    const item = diseaseProfile.claimItems.find(({ id }) => id === evaluation.claimContext.claimItemId);
    assert.deepEqual(evaluation.claimContext.evidenceRecords, profileEvidenceSnapshots(diseaseProfile, item));
  }
  assert.ok(profileEvaluations.some(({ claimContext }) => claimContext.evidenceRecords.length > 0));
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
