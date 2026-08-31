import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { componentMarkup } from "./helpers/markup.mjs";
import { AMOXICLAV, METFORMIN } from "./helpers/medication-fixtures.mjs";

import {
  findOrderInCatalog,
  ORDER_CATALOG,
  ORDER_CATALOG_BOUNDARY,
  ORDER_KINDS,
  orderKindLabel,
  searchOrderCatalog,
} from "../src/order-catalog.js";
import { findMedicationInCatalog, MEDICATION_CATALOG } from "../src/medication-catalog.js";
import { buildMedicationClaimComparison } from "../src/medication-claim-review.js";
import { createDemoEmrState } from "../src/emr-model.js";

const AS_OF = "2026-07-20";
const demo = createDemoEmrState(AS_OF);

test("예시 오더 목록은 오더명·유형·코드로 검색된다", () => {
  // Given / When
  const byName = searchOrderCatalog("폐활량");
  const byKind = searchOrderCatalog("의뢰");

  // Then
  assert.ok(ORDER_CATALOG.length >= 12);
  assert.deepEqual(byName.map(({ id }) => id), ["pulmonary-function-test"]);
  assert.ok(byKind.length >= 3);
  assert.deepEqual(searchOrderCatalog(""), []);
  assert.equal(findOrderInCatalog("없는-오더"), null);
  assert.equal(orderKindLabel("referral"), "의뢰");
  assert.match(ORDER_CATALOG_BOUNDARY, /기관 수가 마스터가 아니며/);
  const kinds = new Set(ORDER_KINDS.map(({ value }) => value));
  for (const entry of ORDER_CATALOG) {
    assert.ok(kinds.has(entry.kind), entry.id);
    assert.ok(entry.code && entry.system && entry.label, entry.id);
  }
});

test("오더 목록은 청구 규칙과 약제 선행 근거가 요구하는 코드를 담는다", () => {
  // Given / When
  const codes = new Set(ORDER_CATALOG.map(({ code }) => code));

  // Then
  for (const required of ["F6002", "DEMO-BMD", "DEMO-BP-FOLLOWUP", "DEMO-A1C-FOLLOWUP"]) {
    assert.ok(codes.has(required), required);
  }
  assert.equal(findOrderInCatalog("pulmonary-function-test").system, "urn:hira:fee-code");
});

test("성분명과 계열은 영문으로, 제품명은 한글로 표기한다", () => {
  // Given / When / Then
  for (const medication of MEDICATION_CATALOG) {
    assert.doesNotMatch(medication.ingredient, /[가-힣]/, `${medication.id} 성분명`);
    assert.doesNotMatch(medication.classLabel, /[가-힣]/, `${medication.id} 계열`);
    assert.doesNotMatch(medication.coverage.duplicateClassLabel, /[가-힣]/, `${medication.id} 효능군`);
    assert.match(medication.label, /[가-힣]/, `${medication.id} 제품명`);
  }
  assert.equal(findMedicationInCatalog("benralizumab-30").ingredient, "Benralizumab");
  assert.equal(findMedicationInCatalog("durvalumab-500").ingredient, "Durvalumab");
});

test("모든 대조 항목은 확인할 수 있는 기준 원문과 강조 구절을 함께 낸다", () => {
  // Given
  const medication = AMOXICLAV;

  // When
  const review = buildMedicationClaimComparison({
    patient: demo.patients.find(({ name }) => name === "김비타"),
    medication,
    prescription: medication.dosing,
    asOf: AS_OF,
  });

  // Then
  for (const check of review.checks) {
    assert.ok(check.source.article, `${check.id} 조문 위치`);
    assert.ok(check.source.excerpt.length > 20, `${check.id} 원문`);
    assert.ok(check.source.highlights.length > 0, `${check.id} 강조 구절`);
    for (const phrase of check.source.highlights) {
      assert.ok(check.source.excerpt.includes(phrase), `${check.id} 강조 구절은 원문 안에 있다: ${phrase}`);
    }
  }
  const allergy = review.checks.find(({ id }) => id === "allergy");
  assert.match(allergy.source.excerpt, /투여 전 환자의 약물 알레르기 기록을 확인한다/);
  assert.ok(allergy.source.highlights.includes("페니실린"));
});

test("측정·진단·처방·오더는 모두 팝업에서 입력한다", async () => {
  // Given
  const dialogs = [
    await componentMarkup("components/emr/entry-dialogs.jsx"),
    await componentMarkup("components/emr/prescription-dialog.jsx"),
  ].join("\n");

  // When / Then
  for (const [step, launcher, dialog, form] of [
    ["measurements", "openVitalDialog", "vitalDialog", "vitalForm"],
    ["diagnoses", "openDiagnosisDialog", "diagnosisDialog", "diagnosisForm"],
    ["prescriptions", "openPrescriptionDialog", "prescriptionDialog", "prescriptionForm"],
    ["orders", "openOrderDialog", "orderDialog", "orderForm"],
  ]) {
    assert.match(dialogs, new RegExp(`<Button[^>]*id="${launcher}"`), step);
    assert.match(dialogs, new RegExp(`id="${dialog}"`), step);
    assert.ok(dialogs.includes(`id="${form}"`), `${step} 입력 폼은 팝업 안에 있다`);
    assert.ok(dialogs.indexOf(`id="${launcher}"`) < dialogs.indexOf(`id="${dialog}"`), step);
  }
  assert.match(dialogs, /from "\.\.\/\.\.\/src\/order-catalog\.js"/);
});

test("약품·오더 코드는 선택으로 채워지고 직접 입력란으로 노출하지 않는다", async () => {
  // Given
  const dialogs = [
    await componentMarkup("components/emr/entry-dialogs.jsx"),
    await componentMarkup("components/emr/prescription-dialog.jsx"),
  ].join("\n");

  // When / Then — 코드는 카탈로그 선택으로 폼 상태에만 담기고 입력란이 없다.
  assert.doesNotMatch(dialogs, /<label>약품 코드</);
  assert.doesNotMatch(dialogs, /<label>오더 코드</);
  assert.doesNotMatch(dialogs, /<input[^>]*id="(?:medicationCode|medicationSystem|orderCode|orderSystem)"/);
});

test("AI 검토는 전송 단계와 전송 내역을 화면에 남기고 판정 배지는 검토한 약에만 붙는다", async () => {
  // Given
  const rx = await componentMarkup("components/emr/prescription-dialog.jsx");
  const kit = await componentMarkup("components/emr/dialog-kit.jsx");

  // When / Then
  assert.match(rx, /trigger="검토 과정 확인하기" triggerClassName="rx-process__summary" triggerId="medicationReviewProcessSummary"/);
  assert.match(rx, /panelId="medicationReviewPipeline"/);
  assert.ok(rx.indexOf('id="medicationReviewProcessSummary"') < rx.indexOf("리뷰 판정") || rx.indexOf("medicationReviewProcessSummary") < rx.indexOf("rx-verdict"), "검토 과정은 판정보다 위에 있다");
  assert.match(kit, /onMouseEnter/);
  assert.match(kit, /onMouseLeave/);
  assert.match(rx, /function medicationReviewTransmission\(review\)/);
  assert.match(rx, /\["전송하지 않음", "환자 이름·등록번호·연락처·주소·자유 메모"\]/);
  assert.match(rx, /function HighlightedText\(/);
  assert.match(rx, /function buildHighlightPairs\(check, counter\)/);
  assert.match(rx, /data-source-origin/);
});

test("AI 검토 전송 전에 진료데이터·고시정보·프롬프트를 미리보기 팝업으로 확인한다", async () => {
  // Given
  const rx = await componentMarkup("components/emr/prescription-dialog.jsx");
  const graph = await readFile(new URL("../scripts/graphs/medication-claim-review-graph.mjs", import.meta.url), "utf8");

  // When / Then — 모델 없는 규칙 기반 경로는 전송이 없으므로 팝업 없이 그대로 진행한다.
  assert.match(rx, /setReviewPreview\(\{ medicationId, name: medication\.label, base \}\)/);
  assert.match(rx, /id="reviewPreviewDialog"/);
  assert.match(rx, /진료데이터/);
  assert.match(rx, /고시정보/);
  assert.match(rx, /프롬프트/);
  assert.match(rx, /medicationReviewNotice\(reviewPreview\.medicationId\)/);
  assert.match(rx, /medicationReviewModelPayload\(reviewPreview\.base\)/);
  assert.match(rx, /medicationReviewInstructions\(\)/);
  assert.match(rx, /id="reviewPreviewSend"[^>]*onClick=\{sendReview\}/);
  // 미리보기가 보여 주는 프롬프트와 서버가 실제로 보내는 프롬프트는 같은 모듈에서 나온다.
  assert.match(graph, /from "\.\.\/\.\.\/src\/medication-review-prompt\.js"/);
  assert.match(graph, /const instructions = medicationReviewInstructions;/);
  assert.match(graph, /const modelInput = medicationReviewModelInput;/);
});

test("같은 사실을 가리키는 기준 문구와 차트 값은 한 쌍으로 묶인다", async () => {
  // Given
  const rx = await componentMarkup("components/emr/prescription-dialog.jsx");
  const css = await readFile("src/emr.css", "utf8");
  const builder = rx.match(/function buildHighlightPairs\(check, counter\)[\s\S]*?\n}/)?.[0] ?? "";

  // When
  const usesEnginePairs = builder.includes("check.source.pairs");

  // Then
  assert.equal(usesEnginePairs, true, "짝은 문자열 겹침이 아니라 규칙 엔진이 알려 준다");
  assert.match(builder, /phrasesOverlap\(chart, candidate\)/, "차트가 다른 표기로 저장한 값에도 같은 색이 따라간다");
  assert.match(builder, /counter\.next \+= 1;/, "색 번호는 검토 전체에서 이어진다");
  for (const index of [0, 1, 2, 3, 4]) {
    assert.ok(css.includes(`.rx-source__mark-text[data-pair="${index}"]`), `pair ${index} 색`);
  }
  assert.equal(new Set(["--data-cyan", "--data-violet", "--data-amber", "--urgent", "--data-lime"]
    .filter((token) => css.includes(`data-pair="0"] { --rx-pair: var(${token})`)
      || css.includes(`data-pair="1"] { --rx-pair: var(${token})`)
      || css.includes(`data-pair="2"] { --rx-pair: var(${token})`)
      || css.includes(`data-pair="3"] { --rx-pair: var(${token})`)
      || css.includes(`data-pair="4"] { --rx-pair: var(${token})`))).size, 5, "쌍마다 서로 다른 색");
  assert.match(css, /\.rx-source__pane\s*\{[\s\S]*?border: 1px dashed/, "원문 패널은 하위 계층으로 읽힌다");
  assert.match(css, /\.rx-source__excerpt\s*\{[\s\S]*?color: color-mix\(in srgb, var\(--muted\)/);
});

test("규칙 엔진은 기준 문구와 그것을 충족한 차트 값을 짝으로 알려 준다", () => {
  // Given
  const medication = METFORMIN;

  // When
  const review = buildMedicationClaimComparison({
    patient: demo.patients.find(({ name }) => name === "김비타"),
    medication,
    prescription: medication.dosing,
    asOf: AS_OF,
  });
  const byId = Object.fromEntries(review.checks.map((check) => [check.id, check.source.pairs]));

  // Then
  assert.deepEqual(byId.indication, [{ rule: "E11", chart: "E11" }]);
  assert.deepEqual(byId["evidence-1"], [
    { rule: "최근 180일 이내 당화혈색소 기록", chart: "4548-4" },
    { rule: "최근 180일 이내", chart: "2026-07-08" },
    { rule: "최근 180일 이내 당화혈색소 기록", chart: "4548-4" },
    { rule: "최근 180일 이내", chart: "2026-04-11" },
  ]);
  assert.deepEqual(byId.age, [{ rule: "만 18세 이상", chart: "만 52세" }]);
  assert.deepEqual(byId.duration, [{ rule: "90일분까지 인정", chart: "28일" }]);
  for (const check of review.checks) {
    for (const { rule, chart } of check.source.pairs) {
      assert.ok(check.source.excerpt.includes(rule), `${check.id} 기준 구절은 원문 안에 있다: ${rule}`);
      assert.ok(
        check.chart.findings.some(({ highlights }) => (highlights ?? []).includes(chart)),
        `${check.id} 차트 값은 강조 목록 안에 있다: ${chart}`,
      );
    }
  }
});
