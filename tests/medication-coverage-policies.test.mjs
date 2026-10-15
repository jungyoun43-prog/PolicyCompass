import assert from "node:assert/strict";
import test from "node:test";
import { medicationCoveragePolicies, medicationCoveragePolicy, medicationCoveragePolicyNotice, switchMedicationCoveragePolicy, applyMedicationPolicySource } from "../src/medication-coverage-policies.js";
import { applyCoveragePolicyReview } from "../src/medication-coverage-review.js";
import { medicationReviewNotice, medicationReviewRequest } from "../src/medication-review-prompt.js";

const makeInput = (medicationId = "benralizumab-30") => ({
  medicationId, policyId: "kr-registered", noticeDrafts: {},
  dataText: "환자 자료 | 원문\n데이터", promptText: "직접 수정한 지시문 {NOTICE}",
  noticeText: medicationReviewNotice(medicationId),
  base: { medication: { id: medicationId }, asOf: "2026-10-16", patient: { id: "patient-test" },
    prescription: { dose: "30" }, verdict: "cross", summary: "국내 규칙 요약",
    rationale: ["국내 기준"], checks: [{ id: "korean-rule" }] },
});

test("policies are bound to the medication and distinguish country from US payer", () => {
  for (const medicationId of ["benralizumab-30", "durvalumab-500"]) {
    const policies = medicationCoveragePolicies(medicationId);
    assert.deepEqual([...new Set(policies.map(({ countryCode }) => countryCode))], ["KR", "US", "GB", "AU"]);
    assert.equal(new Set(policies.map(({ id }) => id)).size, policies.length);
    assert.equal(medicationCoveragePolicyNotice(medicationId), medicationReviewNotice(medicationId));
    for (const policy of policies.filter(({ countryCode }) => countryCode !== "KR")) {
      assert.equal(medicationCoveragePolicyNotice(medicationId, policy.id), "", "foreign loading state has no generated criteria");
      assert.ok(policy.sources.length && policy.sources.every(({ url }) => url.startsWith("https://")));
      assert.equal(policy.criteria, undefined, "registry contains metadata, not authored clinical summaries");
    }
  }
  assert.equal(medicationCoveragePolicy("durvalumab-500", "us-oklahoma"), null);
  assert.deepEqual(medicationCoveragePolicies("pembrolizumab"), []);
  assert.throws(() => medicationCoveragePolicyNotice("durvalumab-500", "us-oklahoma"));
  assert.equal(medicationCoveragePolicies("benralizumab-30").filter(({ countryCode }) => countryCode === "US").length, 2);
});

test("changing policy preserves clinical data, instructions, and each policy's edits including empty text", () => {
  const original = makeInput();
  original.noticeText += "\n한국 입력 수정";
  let selected = switchMedicationCoveragePolicy(original, "us-aetna");
  assert.equal(selected.dataText, original.dataText);
  assert.equal(selected.promptText, original.promptText);
  assert.equal(selected.base, original.base);
  selected.noticeText += "\n미국 입력 수정";
  const editedUS = selected.noticeText;
  selected = switchMedicationCoveragePolicy(selected, "gb-nice");
  selected.noticeText = "";
  selected.noticeTouched = { "gb-nice": true };
  selected = switchMedicationCoveragePolicy(selected, "kr-registered");
  assert.equal(selected.noticeText, original.noticeText);
  selected = switchMedicationCoveragePolicy(selected, "us-aetna");
  assert.equal(selected.noticeText, editedUS);
  selected = switchMedicationCoveragePolicy(selected, "gb-nice");
  assert.equal(selected.noticeText, "");
  assert.equal(switchMedicationCoveragePolicy(selected, "gb-nice"), selected);
  assert.equal(original.noticeDrafts["us-aetna"], undefined);
});

test("selected foreign text reaches the existing LLM payload without Korean criteria or interpolation", () => {
  for (const medicationId of ["benralizumab-30", "durvalumab-500"]) {
    for (const policy of medicationCoveragePolicies(medicationId).filter(({ countryCode }) => countryCode !== "KR")) {
      let input = switchMedicationCoveragePolicy(makeInput(medicationId), policy.id);
      input = applyMedicationPolicySource(input, { medicationId, policyId: policy.id, original: true, text: "Publisher criterion\n1. Preserve 150 cells/μL and all alternatives." });
      const payload = medicationReviewRequest(input.base, { patientData: input.dataText, notice: input.noticeText, instructions: input.promptText });
      const parsed = JSON.parse(payload.input);
      assert.equal(parsed.noticeText, input.noticeText);
      assert.equal(parsed.patientDataText, input.dataText);
      assert.ok(payload.instructions.includes(input.promptText));
      assert.ok(!parsed.noticeText.includes("프로젝트 등록 기준"));
      assert.ok(!Object.hasOwn(parsed.reviewContext, "checks"));
    }
  }
});

test("official source loads verbatim, remains separate from metadata, and restores each policy's edits", () => {
  const original = makeInput();
  let input = switchMedicationCoveragePolicy(original, "us-aetna");
  const document = { medicationId: original.medicationId, policyId: "us-aetna", original: true, text: "Publisher-only text\nOriginal AND/OR relationship", hash: "source-hash" };
  input = applyMedicationPolicySource(input, document);
  assert.equal(input.noticeText, document.text);
  assert.equal(input.noticeSource, document);
  input.noticeText += "\nOperator edit";
  input = switchMedicationCoveragePolicy(input, "gb-nice");
  assert.equal(input.noticeText, "");
  input = switchMedicationCoveragePolicy(input, "us-aetna");
  assert.equal(input.noticeText, document.text + "\nOperator edit");
  assert.equal(input.noticeSource.hash, document.hash);
  assert.throws(() => applyMedicationPolicySource(input, { ...document, policyId: "gb-nice" }));
  assert.throws(() => applyMedicationPolicySource(input, { ...document, text: "" }));
});

test("switching away during loading does not cache a blank draft, but intentional empty edits survive a retry", () => {
  let input = switchMedicationCoveragePolicy(makeInput(), "us-aetna");
  input = switchMedicationCoveragePolicy(input, "gb-nice");
  assert.equal(input.noticeDrafts["us-aetna"], undefined);
  input = switchMedicationCoveragePolicy(input, "us-aetna");
  const document = { medicationId: input.medicationId, policyId: input.policyId, original: true, text: "Publisher source fixture" };
  assert.equal(applyMedicationPolicySource(input, document).noticeText, document.text);
  input.noticeTouched = { "us-aetna": true };
  input = switchMedicationCoveragePolicy(input, "gb-nice");
  input = switchMedicationCoveragePolicy(input, "us-aetna");
  assert.equal(applyMedicationPolicySource(input, document).noticeText, "");
  input.noticeText = "Operator pasted source after failure";
  assert.equal(applyMedicationPolicySource(input, document).noticeText, input.noticeText, "retry cannot overwrite the latest manual edit with an older cached draft");
});

test("foreign results cannot reuse a Korean rule fallback, legacy verdict, or invalid model decision", () => {
  const input = switchMedicationCoveragePolicy(makeInput(), "us-aetna");
  for (const draft of [
    {}, { generatedBy: "rule", verdict: "cross" },
    { generatedBy: "rule", verdict: "circle", markdown: "국내 규칙" },
    { generatedBy: "frontier", verdict: "circle", summary: "레거시" },
    { generatedBy: "frontier", verdict: "invalid", markdown: "보고" },
    { generatedBy: "frontier", verdict: "circle", outputKind: "decision", probabilities: null },
  ]) assert.throws(() => applyCoveragePolicyReview(input, draft), /해외 보험 기준/);
  assert.throws(() => applyCoveragePolicyReview({ ...input, policyId: "missing" }, {}), /등록되지 않은/);
});

test("foreign report uses model verdict independently of Korean rules and snapshots the source", () => {
  const input = switchMedicationCoveragePolicy(makeInput(), "gb-nice");
  input.noticeText += "\n확인한 추가 조건";
  const result = applyCoveragePolicyReview(input, { generatedBy: "frontier", model: "test-model", verdict: "circle", markdown: "## [○] Benralizumab — 급여기준 충족\n**최종 판단:** 선택 기준 충족" });
  assert.equal(result.verdict, "circle");
  assert.equal(result.verdictLabel, "기준 충족");
  assert.equal(result.ruleVerdict, undefined);
  assert.deepEqual(result.checks, []);
  assert.deepEqual(result.rationale, []);
  assert.deepEqual(result.citedCheckIds, []);
  assert.ok(!result.summary.includes("국내 규칙"));
  assert.equal(result.coveragePolicy.id, "gb-nice");
  assert.equal(result.coveragePolicy.noticeText, input.noticeText);
  assert.equal(result.coveragePolicy.edited, true);
  input.noticeText = "나중 수정";
  assert.notEqual(result.coveragePolicy.noticeText, input.noticeText);
});

test("Korean fallback keeps the existing rule result and records its actual input", () => {
  const input = makeInput();
  const result = applyCoveragePolicyReview(input, { generatedBy: "rule", note: "모델 미설정" });
  assert.equal(result.verdict, input.base.verdict);
  assert.equal(result.checks, input.base.checks);
  assert.equal(result.coveragePolicy.id, "kr-registered");
  assert.equal(result.coveragePolicy.edited, false);
});

test("foreign decision probabilities are accepted only as a complete distribution", () => {
  const input = switchMedicationCoveragePolicy(makeInput(), "au-pbs");
  const draft = { generatedBy: "frontier", model: "typesafe/jev-1.13", verdict: "circle", outputKind: "decision",
    probabilities: { circle: 0.85, triangle: 0.1, cross: 0.05 } };
  const result = applyCoveragePolicyReview(input, draft);
  assert.equal(result.outputKind, "decision");
  assert.equal(result.verdict, "circle");
  assert.deepEqual(result.probabilities, draft.probabilities);
  assert.deepEqual(result.checks, []);
  assert.equal(result.coveragePolicy.id, "au-pbs");
  assert.throws(() => applyCoveragePolicyReview(input, { ...draft, probabilities: { circle: 0.85 } }));
});
