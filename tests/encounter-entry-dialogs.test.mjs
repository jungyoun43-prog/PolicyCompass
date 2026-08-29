import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.equal(findMedicationInCatalog("tiotropium-inhaler").ingredient, "Tiotropium bromide");
});

test("모든 대조 항목은 확인할 수 있는 기준 원문과 강조 구절을 함께 낸다", () => {
  // Given
  const medication = findMedicationInCatalog("amoxicillin-clavulanate-625");

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
  const html = await readFile("src/emr.html", "utf8");
  const build = await readFile("scripts/build.mjs", "utf8");

  // When / Then
  for (const [step, launcher, dialog, form] of [
    ["measurements", "openVitalDialog", "vitalDialog", "vitalForm"],
    ["diagnoses", "openDiagnosisDialog", "diagnosisDialog", "diagnosisForm"],
    ["prescriptions", "openPrescriptionDialog", "prescriptionDialog", "prescriptionForm"],
    ["orders", "openOrderDialog", "orderDialog", "orderForm"],
  ]) {
    const disclosure = html.match(new RegExp(`data-workflow-disclosure="${step}"[\\s\\S]*?</details>`))?.[0] ?? "";
    assert.match(disclosure, new RegExp(`<button[^>]*id="${launcher}"`), step);
    assert.match(disclosure, new RegExp(`<dialog[^>]*id="${dialog}"`), step);
    assert.ok(disclosure.includes(`id="${form}"`), `${step} 입력 폼은 팝업 안에 있다`);
    assert.ok(disclosure.indexOf(`id="${launcher}"`) < disclosure.indexOf(`id="${dialog}"`), step);
  }
  assert.match(build, /"\/order-catalog\.js"/);
});

test("약품·오더 코드는 선택으로 채워지고 직접 입력란으로 노출하지 않는다", async () => {
  // Given
  const html = await readFile("src/emr.html", "utf8");

  // When / Then
  for (const id of ["medicationCode", "medicationSystem", "orderCode", "orderSystem"]) {
    assert.match(html, new RegExp(`<input type="hidden" id="${id}"`), id);
  }
  assert.doesNotMatch(html, /<label>약품 코드</);
  assert.doesNotMatch(html, /<label>오더 코드</);
});

test("AI 검토는 전송 단계와 전송 내역을 화면에 남기고 판정 배지는 검토한 약에만 붙는다", async () => {
  // Given
  const [html, js] = await Promise.all([
    readFile("src/emr.html", "utf8"),
    readFile("src/emr.js", "utf8"),
  ]);

  // When / Then
  assert.match(html, /<h5 class="rx-review__heading">AI 검토 과정<\/h5>/);
  assert.match(html, /id="medicationReviewPipeline"/);
  assert.match(js, /function renderMedicationReviewPipeline\(review\)/);
  assert.match(js, /function medicationReviewTransmission\(review\)/);
  assert.match(js, /\["전송하지 않음", "환자 이름·등록번호·연락처·주소·자유 메모"\]/);
  assert.match(js, /const review = medication\.id === activeMedicationReviewId \? medicationReviewById\.get\(medication\.id\) : null;/);
  assert.match(js, /medicationReviewById\.clear\(\);\n\s*expandedSourceIds\.clear\(\);/);
  assert.match(js, /function appendHighlightedText\(node, text, highlights = \[\]\)/);
  assert.match(js, /data-source-origin/);
});
