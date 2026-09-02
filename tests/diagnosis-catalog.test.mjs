import assert from "node:assert/strict";
import test from "node:test";

import { componentMarkup } from "./helpers/markup.mjs";

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
import * as entryDialogs from "../components/emr/entry-dialogs.jsx";
import { renderEncounterTab } from "./helpers/emr-fixtures.mjs";

/**
 * The entry dialogs open through Radix `Dialog.Portal`, which renders nothing
 * on the server, and their launcher buttons portal into a slot the parent
 * hands over after mount. renderToStaticMarkup therefore cannot reach the
 * dialog body; the tab around it renders fine and shows what the clinician
 * sees before opening a popup.
 */
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
  const tab = renderEncounterTab();
  const dialogs = await componentMarkup("components/emr/entry-dialogs.jsx");

  // When
  const launcherFirst = dialogs.indexOf('id="openDiagnosisDialog"') < dialogs.indexOf('id="diagnosisDialog"');
  const searchBeforeCodes = dialogs.indexOf('id="diagnosisSearchInput"') < dialogs.indexOf('id="diagnosisCodeOptions"');

  // Then — 진단 카드는 런처 슬롯만 내놓고, 검색·코드 선택·폼은 팝업이 열릴 때까지 화면에 없다.
  assert.match(tab, /<span class="entry-launcher-slot" id="entryLauncher-diagnoses">/);
  assert.doesNotMatch(tab, /id="diagnosisForm"|id="diagnosisSearchInput"|id="diagnosisCodeOptions"/);
  // 팝업 모듈은 카탈로그의 경계 문구를 그대로 넘긴다 — 같은 상병 목록을 쓴다는 뜻이다.
  assert.equal(entryDialogs.DIAGNOSIS_CATALOG_BOUNDARY, DIAGNOSIS_CATALOG_BOUNDARY);
  assert.equal(typeof entryDialogs.DiagnosisDialog, "function");
  // source-check: 팝업 본문은 Radix Dialog.Portal 안에 있고 런처는 마운트 뒤 슬롯으로 portal되어 서버 렌더에 나오지 않는다.
  assert.match(dialogs, /<Button[^>]*id="openDiagnosisDialog"[^>]*>진단 추가<\/Button>/);
  assert.match(dialogs, /id="diagnosisDialog"/);
  assert.ok(dialogs.includes('id="diagnosisForm"'), "진단 입력 폼은 팝업 안에 있다");
  assert.equal(launcherFirst, true);
  assert.equal(searchBeforeCodes, true);
  assert.match(dialogs, /id="diagnosisRole"[\s\S]*?주상병[\s\S]*?부상병[\s\S]*?<\/select>/);
  assert.match(dialogs, /id="diagnosisSystem"[\s\S]*?urn:kr:kcd[\s\S]*?<\/select>/);
});

test("약품 검색 결과는 상품명과 성분명만 보여 주고 상세는 접어 둔다", async () => {
  // Given
  const dialog = await componentMarkup("components/emr/prescription-dialog.jsx");

  // When
  const showsIngredient = dialog.includes('class="rx-result__ingredient"');

  // Then
  // source-check: 검색 결과 목록은 Radix Dialog.Portal 안에서만 렌더되어 서버 렌더로 닿을 수 없다.
  assert.equal(showsIngredient, true);
  assert.doesNotMatch(dialog, /rx-result__meta/, "결과 행에 코드·용법 줄을 다시 넣지 않는다");
  assert.match(dialog, /class="rx-result__details-summary">\s*자세히 보기/);
  assert.match(dialog, /<details class="rx-result__details"[\s\S]*?<DetailList rows=/, "상세 행은 접힌 details 안에 있다");
});
