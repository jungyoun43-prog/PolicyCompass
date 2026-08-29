import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CHART_MEDICATION_CLASS_HINTS,
  chartMedicationClass,
  findMedicationInCatalog,
  MEDICATION_CATALOG,
  MEDICATION_CATALOG_BOUNDARY,
  searchMedicationCatalog,
} from "../src/medication-catalog.js";
import {
  applyMedicationReviewDraft,
  buildMedicationClaimComparison,
  isVerdictAtLeastAsCautious,
  MEDICATION_REVIEW_VERDICTS,
  worstVerdict,
} from "../src/medication-claim-review.js";
import { createDemoEmrState } from "../src/emr-model.js";
import { sanitizeMedicationClaimComparison } from "../scripts/graphs/medication-claim-review-graph.mjs";

const AS_OF = "2026-07-20";
const demo = createDemoEmrState(AS_OF);
const patientByName = (name) => demo.patients.find((patient) => patient.name === name);

function review(patientName, medicationId, prescription) {
  const medication = findMedicationInCatalog(medicationId);
  return buildMedicationClaimComparison({
    patient: patientByName(patientName),
    medication,
    prescription: prescription ?? medication.dosing,
    asOf: AS_OF,
  });
}

test("예시 약품 목록은 검색되고 실제 급여기준이 아님을 밝힌다", () => {
  // Given / When
  const byIngredient = searchMedicationCatalog("암로디핀");
  const byClass = searchMedicationCatalog("흡입제");
  const byIndication = searchMedicationCatalog("J44");

  // Then
  assert.ok(MEDICATION_CATALOG.length >= 12);
  assert.deepEqual(byIngredient.map(({ id }) => id), ["amlodipine-5"]);
  assert.ok(byClass.length >= 2);
  assert.ok(byIndication.some(({ id }) => id === "tiotropium-inhaler"));
  assert.deepEqual(searchMedicationCatalog(""), []);
  assert.match(MEDICATION_CATALOG_BOUNDARY, /실제 약제 급여기준 고시나 의약품 데이터베이스가 아니며/);
  for (const medication of MEDICATION_CATALOG) {
    assert.match(medication.coverage.source.label, /예시/, `${medication.id} 출처 표기`);
    assert.equal(medication.coverage.source.url, "", `${medication.id} 은 실제 고시 링크를 만들어내지 않는다`);
  }
});

test("차트에 이미 있는 약은 등록된 효능군으로 해석된다", () => {
  // Given / When / Then
  assert.equal(chartMedicationClass({ code: "DEMO-LAMA", label: "LAMA 흡입제" }).class, "LAMA");
  assert.equal(chartMedicationClass({ code: "MED-PPI", label: "예시 위산 억제제" }).class, "PPI");
  assert.equal(chartMedicationClass({ code: "PC-RX-AMLO5", label: "암로디핀정 5mg" }).class, "CCB");
  assert.equal(chartMedicationClass({ code: "UNKNOWN", label: "알 수 없는 약" }).class, "");
  assert.ok(CHART_MEDICATION_CLASS_HINTS.length >= 5);
});

test("등록 기준과 환자 기록이 모두 맞으면 동그라미로 제시한다", () => {
  // Given / When
  const result = review("김비타", "amlodipine-5");

  // Then
  assert.equal(result.verdict, "circle");
  assert.equal(result.verdictSymbol, "○");
  assert.equal(result.generatedBy, "rule");
  assert.ok(result.checks.every(({ verdict }) => verdict === "circle"));
  assert.match(result.boundary, /급여 인정·삭감을 확정하지 않고/);
});

test("알레르기 성분이 일치하면 엑스로 제시하고 근거를 환자 기록으로 짚는다", () => {
  // Given / When
  const result = review("김비타", "amoxicillin-clavulanate-625");
  const allergy = result.checks.find(({ id }) => id === "allergy");

  // Then
  assert.equal(result.verdict, "cross");
  assert.equal(result.verdictSymbol, "✕");
  assert.equal(allergy.verdict, "cross");
  assert.match(allergy.criterion.requirement, /아목시실린/);
  assert.equal(allergy.chart.findings[0].label, "페니실린 알레르기");
  assert.equal(allergy.chart.findings[0].eventId, "kim-allergy");
});

test("필수 선행 근거가 없거나 같은 효능군이 이미 있으면 엑스로 제시한다", () => {
  // Given / When
  const missingEvidence = review("정수진", "tiotropium-inhaler");
  const duplicate = review("이준호", "tiotropium-inhaler");

  // Then
  assert.equal(missingEvidence.checks.find(({ id }) => id === "evidence-1").verdict, "cross");
  assert.equal(duplicate.checks.find(({ id }) => id === "evidence-1").verdict, "circle");
  assert.equal(duplicate.checks.find(({ id }) => id === "duplicate").verdict, "cross");
  assert.equal(duplicate.checks.find(({ id }) => id === "duplicate").chart.findings[0].eventId, "lee-copd-lama");
});

test("인정 일수를 넘기면 세모로 제시한다", () => {
  // Given
  const medication = findMedicationInCatalog("pantoprazole-40");

  // When
  const result = buildMedicationClaimComparison({
    patient: patientByName("최민아"),
    medication,
    prescription: { ...medication.dosing, durationDays: 90 },
    asOf: AS_OF,
  });
  const duration = result.checks.find(({ id }) => id === "duration");

  // Then
  assert.equal(duration.verdict, "triangle");
  assert.match(duration.chart.detail, /34일 초과/);
});

test("모든 항목은 삭감 근거와 환자 정보와 출처를 함께 제시한다", () => {
  // Given / When
  const result = review("이준호", "tiotropium-inhaler");

  // Then
  assert.ok(result.checks.length >= 4);
  for (const item of result.checks) {
    assert.ok(item.criterion.requirement, `${item.id} 삭감 근거`);
    assert.ok(item.criterion.detail, `${item.id} 기준 설명`);
    assert.ok(item.chart.detail, `${item.id} 환자 정보`);
    assert.ok(Array.isArray(item.chart.findings), `${item.id} 환자 기록 목록`);
    assert.ok(item.source.label && item.source.documentNumber, `${item.id} 출처`);
    assert.ok(Object.hasOwn(MEDICATION_REVIEW_VERDICTS, item.verdict), `${item.id} 판정`);
  }
  assert.equal(result.rationale.length, result.checks.length);
});

test("검토 결과에는 직접식별자가 들어가지 않는다", () => {
  // Given / When
  const serialized = JSON.stringify(review("김비타", "amoxicillin-clavulanate-625"));

  // Then
  assert.doesNotMatch(serialized, /김비타/);
  assert.doesNotMatch(serialized, /PC-1001/);
  assert.equal(Object.hasOwn(JSON.parse(serialized).patient, "name"), false);
});

test("판정 등급은 가장 신중한 항목을 따른다", () => {
  // Given / When / Then
  assert.equal(worstVerdict(["circle", "triangle", "circle"]), "triangle");
  assert.equal(worstVerdict(["circle", "cross", "triangle"]), "cross");
  assert.equal(worstVerdict([]), "circle");
  assert.equal(isVerdictAtLeastAsCautious("cross", "triangle"), true);
  assert.equal(isVerdictAtLeastAsCautious("circle", "triangle"), false);
  assert.equal(isVerdictAtLeastAsCautious("nonsense", "circle"), false);
});

test("모델 초안은 규칙 판정을 완화하지 못하고 없는 항목을 인용하지 못한다", () => {
  // Given
  const base = review("김비타", "amoxicillin-clavulanate-625");

  // When
  const softened = applyMedicationReviewDraft(base, {
    verdict: "circle",
    summary: "문제 없습니다.",
    rationale: ["괜찮습니다."],
    citedCheckIds: ["allergy", "made-up-check"],
    generatedBy: "local-model",
    model: "demo-model",
  });
  const escalated = applyMedicationReviewDraft(review("김비타", "amlodipine-5"), {
    verdict: "triangle",
    summary: "추가 확인이 필요합니다.",
    rationale: ["혈압 기록의 최신성을 확인하세요."],
    citedCheckIds: ["evidence-1"],
    generatedBy: "local-model",
  });

  // Then
  assert.equal(softened.verdict, "cross");
  assert.equal(softened.ruleVerdict, "cross");
  assert.deepEqual(softened.citedCheckIds, ["allergy"]);
  assert.match(softened.note, /규칙 판정을 우선했습니다/);
  assert.equal(escalated.verdict, "triangle");
  assert.equal(escalated.summary, "추가 확인이 필요합니다.");
});

test("서버는 브라우저가 보낸 비교 결과만 받아들인다", () => {
  // Given
  const comparison = review("이준호", "tiotropium-inhaler");

  // When
  const sanitized = sanitizeMedicationClaimComparison({ comparison });

  // Then
  assert.equal(sanitized.schema, "policycompass-medication-claim-review");
  assert.equal(sanitized.verdict, comparison.verdict);
  assert.equal(sanitized.checks.length, comparison.checks.length);
  assert.throws(() => sanitizeMedicationClaimComparison({}), /비교 결과가 필요합니다/);
  assert.throws(() => sanitizeMedicationClaimComparison({ comparison: { ...comparison, checks: [] } }), /대조된 기준 항목이 없습니다/);
  assert.throws(() => sanitizeMedicationClaimComparison({ comparison: { ...comparison, verdict: "maybe" } }), /규칙 판정이 올바르지 않습니다/);
});

test("EMR 화면은 처방을 팝업에서 검색하고 판정과 근거 대조표를 보여 준다", async () => {
  // Given
  const [html, js, build] = await Promise.all([
    readFile("src/emr.html", "utf8"),
    readFile("src/emr.js", "utf8"),
    readFile("scripts/build.mjs", "utf8"),
  ]);
  const disclosure = html.match(/data-workflow-disclosure="prescriptions"[\s\S]*?<\/details>/)?.[0] ?? "";

  // When
  const launcherFirst = disclosure.indexOf('id="openPrescriptionDialog"') < disclosure.indexOf('id="prescriptionDialog"');
  const verdictBeforeSources = disclosure.indexOf('id="medicationReviewVerdict"') < disclosure.indexOf('id="medicationReviewSources"');

  // Then
  assert.match(disclosure, /<button[^>]*id="openPrescriptionDialog"[^>]*>약 처방하기<\/button>/);
  assert.match(disclosure, /<dialog[^>]*id="prescriptionDialog"/);
  assert.match(disclosure, /id="medicationSearchInput"/);
  assert.ok(disclosure.includes('id="prescriptionForm"'), "처방 입력 폼은 팝업 안에 있다");
  assert.equal(launcherFirst, true);
  assert.equal(verdictBeforeSources, true);
  assert.match(disclosure, /판정 근거 · 삭감 근거와 환자 정보 대조/);
  assert.doesNotMatch(disclosure, /medicationReviewRationale/, "판정 근거 대조표가 있으므로 줄글 근거는 중복이다");
  assert.match(js, /data-review-medication/);
  assert.match(js, /"\/api\/medication-claim-review"/);
  assert.match(build, /"\/medication-catalog\.js"/);
  assert.match(build, /"\/medication-claim-review\.js"/);
});

test("배포 서버는 약제 AI 검토 경로를 같은 출처로만 열어 둔다", async () => {
  // Given
  const [appServer, devServer] = await Promise.all([
    readFile("scripts/app-server.mjs", "utf8"),
    readFile("scripts/dev.mjs", "utf8"),
  ]);

  // When
  const guardsOrigin = appServer.includes('if (url.pathname.startsWith("/api/medication-claim-review")) {\n      assertSameOrigin(request);');

  // Then
  assert.equal(guardsOrigin, true);
  assert.match(appServer, /FRONTIER_CONSENT_REQUIRED/);
  assert.match(devServer, /\/api\/medication-claim-review/);
});
