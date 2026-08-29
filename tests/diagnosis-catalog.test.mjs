import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DIAGNOSIS_CATALOG,
  DIAGNOSIS_CATALOG_BOUNDARY,
  DIAGNOSIS_CERTAINTIES,
  DIAGNOSIS_CODE_SYSTEMS,
  DIAGNOSIS_ROLES,
  findDiagnosisInCatalog,
  KCD_SYSTEM,
  preferredDiagnosisCode,
  searchDiagnosisCatalog,
} from "../src/diagnosis-catalog.js";

test("예시 상병 목록은 진단명·코드·증상으로 검색된다", () => {
  // Given / When
  const byName = searchDiagnosisCatalog("고혈압");
  const byCode = searchDiagnosisCatalog("J44");
  const byEnglish = searchDiagnosisCatalog("COPD");

  // Then
  assert.ok(DIAGNOSIS_CATALOG.length >= 20);
  assert.ok(byName.some(({ id }) => id === "essential-hypertension"));
  assert.deepEqual(byCode.map(({ id }) => id), ["copd"]);
  assert.deepEqual(byEnglish.map(({ id }) => id), ["copd"]);
  assert.deepEqual(searchDiagnosisCatalog(""), []);
  assert.deepEqual(searchDiagnosisCatalog("고혈압", 0), []);
});

test("각 상병은 하나 이상의 코드 후보와 기본 코드를 가진다", () => {
  // Given / When / Then
  for (const entry of DIAGNOSIS_CATALOG) {
    assert.ok(entry.codes.length >= 1, entry.id);
    assert.ok(entry.label && entry.category, entry.id);
    const preferred = preferredDiagnosisCode(entry);
    assert.ok(preferred?.code && preferred.label, entry.id);
    assert.equal(entry.codes.filter(({ preferred: flag }) => flag).length <= 1, true, entry.id);
    for (const candidate of entry.codes) {
      assert.match(candidate.code, /^[A-Z]\d{2}(\.\d+)?$/, `${entry.id} ${candidate.code}`);
    }
  }
  assert.equal(preferredDiagnosisCode(findDiagnosisInCatalog("copd")).code, "J44.9");
  assert.equal(findDiagnosisInCatalog("없는-상병"), null);
  assert.equal(preferredDiagnosisCode(null), null);
});

test("코드 시스템과 주·부상병 구분은 선택지로 제공된다", () => {
  // Given / When / Then
  assert.equal(DIAGNOSIS_CODE_SYSTEMS[0].system, KCD_SYSTEM);
  assert.equal(DIAGNOSIS_CODE_SYSTEMS[0].preferred, true);
  assert.ok(DIAGNOSIS_CODE_SYSTEMS.length >= 2);
  assert.deepEqual(DIAGNOSIS_ROLES.map(({ value, label }) => [value, label]), [["primary", "주상병"], ["secondary", "부상병"]]);
  assert.deepEqual(DIAGNOSIS_CERTAINTIES.map(({ value }) => value), ["confirmed", "provisional"]);
  assert.match(DIAGNOSIS_CATALOG_BOUNDARY, /공식 KCD 마스터 파일이 아니며/);
});

test("진단 입력은 팝업에서 검색·코드 선택·주상병 구분을 거친다", async () => {
  // Given
  const [html, js, build] = await Promise.all([
    readFile("src/emr.html", "utf8"),
    readFile("src/emr.js", "utf8"),
    readFile("scripts/build.mjs", "utf8"),
  ]);
  const disclosure = html.match(/data-workflow-disclosure="diagnoses"[\s\S]*?<\/details>/)?.[0] ?? "";

  // When
  const launcherFirst = disclosure.indexOf('id="openDiagnosisDialog"') < disclosure.indexOf('id="diagnosisDialog"');
  const searchBeforeCodes = disclosure.indexOf('id="diagnosisSearchInput"') < disclosure.indexOf('id="diagnosisCodeOptions"');

  // Then
  assert.match(disclosure, /<button[^>]*id="openDiagnosisDialog"[^>]*>진단 추가<\/button>/);
  assert.match(disclosure, /<dialog[^>]*id="diagnosisDialog"/);
  assert.ok(disclosure.includes('id="diagnosisForm"'), "진단 입력 폼은 팝업 안에 있다");
  assert.equal(launcherFirst, true);
  assert.equal(searchBeforeCodes, true);
  assert.match(disclosure, /<select id="diagnosisRole"[\s\S]*?주상병[\s\S]*?부상병[\s\S]*?<\/select>/);
  assert.match(disclosure, /<select id="diagnosisSystem"[\s\S]*?urn:kr:kcd[\s\S]*?<\/select>/);
  assert.match(js, /data-pick-diagnosis/);
  assert.match(js, /data-diagnosis-code-choice/);
  assert.match(build, /"\/diagnosis-catalog\.js"/);
});

test("약품 검색 결과는 상품명과 성분명만 보여 주고 상세는 접어 둔다", async () => {
  // Given
  const js = await readFile("src/emr.js", "utf8");
  const renderer = js.match(/function renderMedicationResults\(\)[\s\S]*?\n}/)?.[0] ?? "";

  // When
  const showsIngredient = renderer.includes('element("span", "rx-result__ingredient", medication.ingredient)');

  // Then
  assert.equal(showsIngredient, true);
  assert.doesNotMatch(renderer, /rx-result__meta/, "결과 행에 코드·용법 줄을 다시 넣지 않는다");
  assert.match(renderer, /element\("summary", "rx-result__details-summary", "자세히 보기"\)/);
  assert.match(js, /function medicationDetailRows\(medication\)/);
  assert.match(js, /expandedMedicationIds/);
});
