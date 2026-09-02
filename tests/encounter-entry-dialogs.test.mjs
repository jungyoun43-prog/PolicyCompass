import assert from "node:assert/strict";
import test from "node:test";

import { componentMarkup } from "./helpers/markup.mjs";
import { renderComponent } from "./helpers/render.mjs";
import { declarationsFor, hasRule, stylesheet } from "./helpers/css.mjs";
import { AMOXICLAV, METFORMIN } from "./helpers/medication-fixtures.mjs";

import {
  findOrderInCatalog,
  ORDER_CATALOG,
  ORDER_CATALOG_BOUNDARY,
  ORDER_KINDS,
  orderKindLabel,
  searchOrderCatalog,
} from "../src/order-catalog.js";
import { DIAGNOSIS_CATALOG_BOUNDARY } from "../src/diagnosis-catalog.js";
import { findMedicationInCatalog, MEDICATION_CATALOG } from "../src/medication-catalog.js";
import { buildMedicationClaimComparison } from "../src/medication-claim-review.js";
import {
  medicationReviewInstructions,
  medicationReviewNotice,
  medicationReviewPatientDataText,
  medicationReviewPrompt,
} from "../src/medication-review-prompt.js";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { runMedicationClaimReview } from "../scripts/graphs/medication-claim-review-graph.mjs";
import * as entryDialogs from "../components/emr/entry-dialogs.jsx";
import { PrescriptionDialog } from "../components/emr/prescription-dialog.jsx";
import { HoverPopover } from "../components/emr/dialog-kit.jsx";
import { renderEncounterTab } from "./helpers/emr-fixtures.mjs";

const AS_OF = "2026-07-20";
const demo = createDemoEmrState(AS_OF);

/**
 * The entry dialogs open through Radix `Dialog.Portal` (nothing on the server)
 * and their launcher buttons portal into a slot the parent hands over after
 * mount, so renderToStaticMarkup cannot reach the popup bodies. The tab around
 * them renders and shows what the clinician sees before any popup opens.
 */
async function dialogSources() {
  return [
    await componentMarkup("components/emr/entry-dialogs.jsx"),
    await componentMarkup("components/emr/prescription-dialog.jsx"),
  ].join("\n");
}

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

test("진단·처방·오더는 모두 팝업에서 입력한다", async () => {
  // Given
  const tab = renderEncounterTab();
  const dialogs = await dialogSources();

  // When / Then
  // 측정(활력징후) 입력은 간호 워크플로로 의료진 화면에서 제외됐다(531f035).
  assert.doesNotMatch(tab, /vitalForm|entryLauncher-measurements|활력징후 추가/);
  assert.doesNotMatch(dialogs, /VitalDialog|id="vitalForm"/);
  // 세 입력 단계는 각자 런처 슬롯만 화면에 내놓고, 폼은 팝업이 열릴 때까지 렌더되지 않는다.
  const slotOrder = ["diagnoses", "prescriptions", "orders"].map((step) => tab.indexOf(`id="entryLauncher-${step}"`));
  assert.ok(slotOrder.every((index) => index > -1), "진단·처방·오더 런처 슬롯이 모두 있다");
  assert.deepEqual([...slotOrder].sort((a, b) => a - b), slotOrder, "런처 슬롯은 진단 → 처방 → 오더 순서다");
  assert.doesNotMatch(tab, /id="(?:diagnosisForm|prescriptionForm|orderForm)"/, "팝업 폼은 닫힌 상태에서 화면에 없다");
  // 팝업 모듈은 진단·오더 카탈로그의 경계 문구를 그대로 넘긴다 — 같은 목록을 쓴다는 뜻이다.
  assert.equal(entryDialogs.ORDER_CATALOG_BOUNDARY, ORDER_CATALOG_BOUNDARY);
  assert.equal(entryDialogs.DIAGNOSIS_CATALOG_BOUNDARY, DIAGNOSIS_CATALOG_BOUNDARY);
  assert.equal(typeof entryDialogs.DiagnosisDialog, "function");
  assert.equal(typeof entryDialogs.OrderDialog, "function");
  assert.equal(typeof PrescriptionDialog, "function");
  // source-check: 팝업 본문은 Radix Dialog.Portal 안에 있고 런처는 마운트 뒤 슬롯으로 portal되어 서버 렌더에 나오지 않는다.
  for (const [step, launcher, dialog, form] of [
    ["diagnoses", "openDiagnosisDialog", "diagnosisDialog", "diagnosisForm"],
    ["prescriptions", "openPrescriptionDialog", "prescriptionDialog", "prescriptionForm"],
    ["orders", "openOrderDialog", "orderDialog", "orderForm"],
  ]) {
    assert.match(dialogs, new RegExp(`<Button[^>]*id="${launcher}"`), step);
    assert.match(dialogs, new RegExp(`id="${dialog}"`), step);
    assert.ok(dialogs.includes(`id="${form}"`), `${step} 입력 폼은 팝업 안에 있다`);
    assert.ok(dialogs.indexOf(`id="${launcher}"`) < dialogs.indexOf(`id="${dialog}"`), step);
  }
});

test("약품·오더 코드는 선택으로 채워지고 직접 입력란으로 노출하지 않는다", async () => {
  // Given
  const dialogs = await dialogSources();

  // When / Then — 코드는 카탈로그 선택으로 폼 상태에만 담기고 입력란이 없다.
  // 카탈로그 항목이 코드와 코드 시스템을 함께 들고 있어 선택만으로 채울 수 있다.
  for (const entry of [...ORDER_CATALOG, ...MEDICATION_CATALOG]) {
    assert.ok(entry.code && entry.system, `${entry.id} 코드·시스템`);
  }
  // source-check: 처방·오더 폼은 Radix Dialog.Portal 안에서만 렌더되어 서버 렌더로 닿을 수 없다.
  assert.doesNotMatch(dialogs, /<label>약품 코드</);
  assert.doesNotMatch(dialogs, /<label>오더 코드</);
  assert.doesNotMatch(dialogs, /<input[^>]*id="(?:medicationCode|medicationSystem|orderCode|orderSystem)"/);
});

test("AI 검토는 전송 단계와 전송 내역을 화면에 남기고 판정 배지는 검토한 약에만 붙는다", async () => {
  // Given
  const rx = await componentMarkup("components/emr/prescription-dialog.jsx");
  const kit = await componentMarkup("components/emr/dialog-kit.jsx");
  const popover = renderComponent(HoverPopover, {
    hostClassName: "rx-process",
    trigger: "검토 과정 확인하기",
    triggerClassName: "rx-process__summary",
    triggerId: "medicationReviewProcessSummary",
    panelId: "medicationReviewPipeline",
    panelClassName: "rx-process__body",
    panel: "전송 단계",
  });

  // When / Then — 검토 과정 팝오버는 버튼이 패널을 제어하고, 패널은 열기 전까지 숨겨져 있다.
  assert.match(popover, /<button class="rx-process__summary" type="button" id="medicationReviewProcessSummary" aria-expanded="false" aria-controls="medicationReviewPipeline">검토 과정 확인하기<\/button>/);
  assert.match(popover, /<span class="rx-process__body" id="medicationReviewPipeline" hidden="">전송 단계<\/span>/);
  // source-check: 검토 결과 헤더는 Radix Dialog.Portal 안에서만 렌더되어 서버 렌더로 닿을 수 없다.
  assert.match(rx, /trigger="검토 과정 확인하기" triggerClassName="rx-process__summary" triggerId="medicationReviewProcessSummary"/);
  assert.match(rx, /panelId="medicationReviewPipeline"/);
  assert.ok(rx.indexOf('id="medicationReviewProcessSummary"') < rx.indexOf("리뷰 판정") || rx.indexOf("medicationReviewProcessSummary") < rx.indexOf("rx-verdict"), "검토 과정은 판정보다 위에 있다");
  // source-check: hover로 살짝 보이는 동작은 마우스 이벤트라 DOM 없이 관찰할 수 없다.
  assert.match(kit, /onMouseEnter/);
  assert.match(kit, /onMouseLeave/);
  // source-check: 전송 내역·강조 표시 함수는 모듈 내부에 있고 팝업 안에서만 렌더된다.
  assert.match(rx, /function medicationReviewTransmission\(review\)/);
  // 전송 내역은 실제로 보낸 것을 말한다: 원본 데이터셋이 있으면 그 원문, 없으면 구조화 추출.
  assert.match(rx, /\["대조 자료", review\.dataset[\s\S]*원본 익명화 데이터셋 원문[\s\S]*구조화 기록 \$\{\(review\.records \?\? \[\]\)\.length\}건/);
  assert.match(rx, /\["전송하지 않음", review\.dataset[\s\S]*"환자 이름·등록번호·연락처·주소·자유 메모"\]/);
  assert.match(rx, /function HighlightedText\(/);
  assert.match(rx, /function buildHighlightPairs\(check, counter\)/);
  assert.match(rx, /data-source-origin/);
});

test("AI 검토 전송 전에 진료데이터·고시정보·프롬프트를 미리보기 팝업으로 확인한다", async () => {
  // Given
  const rx = await componentMarkup("components/emr/prescription-dialog.jsx");
  const medication = findMedicationInCatalog("benralizumab-30");
  const base = buildMedicationClaimComparison({
    patient: demo.patients.find(({ name }) => name === "김비타"),
    medication,
    prescription: medication.dosing,
    asOf: AS_OF,
  });
  const overrides = {
    patientData: "수정된 환자 의료데이터입니다.",
    notice: "수정된 고시 본문입니다.",
    instructions: "수정된 템플릿입니다.\n고시: {NOTICE}\n데이터: {PATIENT_DATA}",
  };

  // When — 미리보기 세 섹션의 원본과, 수정본을 오버라이드로 치환한 최종 프롬프트.
  const dataText = medicationReviewPatientDataText(base);
  const noticeText = medicationReviewNotice(medication.id);
  const promptText = medicationReviewInstructions();
  const sent = [];
  await runMedicationClaimReview({ comparison: base, overrides }, {
    environment: { POLICYCOMPASS_OLLAMA_MODEL: "demo-local", POLICYCOMPASS_OLLAMA_URL: "http://127.0.0.1:11434" },
    fetchImpl: async (url, options) => {
      sent.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ model: "demo-local", message: { content: "## [✕] 벤라리주맙 — 급여기준 미충족" } }) };
    },
  });

  // Then — 세 섹션은 각자 채워져 있고 직접식별자를 담지 않는다.
  assert.ok(dataText.trim().length > 0, "진료데이터");
  assert.equal(dataText.includes("김비타"), false);
  assert.match(noticeText, /고시 제2026-92호/);
  assert.match(promptText, /\{NOTICE\}[\s\S]*\{PATIENT_DATA\}/);
  assert.equal(medicationReviewPrompt(base), promptText.replace("{NOTICE}", noticeText).replace("{PATIENT_DATA}", dataText));
  // 수정본은 오버라이드로 그대로 치환되고, 서버 그래프가 모델에 보내는 메시지도 같은 치환 함수의 결과다.
  assert.equal(
    medicationReviewPrompt(base, overrides),
    "수정된 템플릿입니다.\n고시: 수정된 고시 본문입니다.\n데이터: 수정된 환자 의료데이터입니다.",
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].messages[0].content, medicationReviewPrompt(base, overrides));
  // source-check: 미리보기 팝업은 Radix Dialog.Portal 안의 클라이언트 상태라 서버 렌더로 닿을 수 없다.
  // 모델 없는 규칙 기반 경로는 전송이 없으므로 팝업 없이 그대로 진행한다.
  assert.match(rx, /setReviewPreview\(\{\s*medicationId,\s*name: medication\.label,\s*base,/);
  assert.match(rx, /dataText: medicationReviewPatientDataText\(base\)/);
  assert.match(rx, /noticeText: medicationReviewNotice\(medicationId\)/);
  assert.match(rx, /promptText: medicationReviewInstructions\(\)/);
  assert.match(rx, /id="reviewPreviewDialog"/);
  assert.match(rx, /진료데이터/);
  assert.match(rx, /고시정보/);
  assert.match(rx, /프롬프트/);
  // 세 섹션은 미리 채워진 편집 가능한 입력이고 수정본이 오버라이드로 전송된다.
  assert.match(rx, /id="reviewPreviewData"[^>]*value=\{reviewPreview\.dataText\}/);
  assert.match(rx, /id="reviewPreviewNoticeText"[^>]*value=\{reviewPreview\.noticeText\}/);
  assert.match(rx, /id="reviewPreviewPrompt"[^>]*value=\{reviewPreview\.promptText\}/);
  assert.match(rx, /overrides = \{ patientData: dataText, notice: noticeText, instructions: promptText \}/);
  assert.match(rx, /comparison: base, provider, overrides/);
  assert.match(rx, /id="reviewPreviewSend"[^>]*onClick=\{sendReview\}/);
  // 고시 기반 모델 보고가 있으면 예시 규칙 대조표 대신 보고만 보인다.
  assert.match(rx, /\{review\.markdown \? <MarkdownReport markdown=\{review\.markdown\} \/> : \(/);
  assert.match(rx, /\{review\.markdown \? null : <span>\{review\.summary\}<\/span>\}/);
});

test("같은 사실을 가리키는 기준 문구와 차트 값은 한 쌍으로 묶인다", async () => {
  // Given
  const rx = await componentMarkup("components/emr/prescription-dialog.jsx");
  const css = await stylesheet("src/emr.css");
  const builder = rx.match(/function buildHighlightPairs\(check, counter\)[\s\S]*?\n}/)?.[0] ?? "";

  // When
  const usesEnginePairs = builder.includes("check.source.pairs");
  const pairTokens = [0, 1, 2, 3, 4].map((index) => declarationsFor(css, `.rx-source__mark-text[data-pair="${index}"]`)["--rx-pair"]);

  // Then
  // source-check: buildHighlightPairs는 모듈 내부 함수이고 결과 <mark>는 Radix 팝업 안에서만 렌더된다.
  assert.equal(usesEnginePairs, true, "짝은 문자열 겹침이 아니라 규칙 엔진이 알려 준다");
  assert.match(builder, /phrasesOverlap\(chart, candidate\)/, "차트가 다른 표기로 저장한 값에도 같은 색이 따라간다");
  assert.match(builder, /counter\.next \+= 1;/, "색 번호는 검토 전체에서 이어진다");
  for (const index of [0, 1, 2, 3, 4]) {
    assert.ok(hasRule(css, `.rx-source__mark-text[data-pair="${index}"]`), `pair ${index} 색`);
  }
  const allowedTokens = ["var(--data-cyan)", "var(--data-violet)", "var(--data-amber)", "var(--urgent)", "var(--data-lime)"];
  for (const token of pairTokens) assert.ok(allowedTokens.includes(token), `쌍 색은 데이터 팔레트 토큰이다: ${token}`);
  assert.equal(new Set(pairTokens).size, 5, "쌍마다 서로 다른 색");
  assert.match(declarationsFor(css, ".rx-source__pane").border, /^1px dashed /, "원문 패널은 하위 계층으로 읽힌다");
  assert.match(declarationsFor(css, ".rx-source__excerpt").color, /^color-mix\(in srgb, var\(--muted\)/);
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
  assert.deepEqual(byId.age, [{ rule: "만 18세 이상", chart: "만 71세" }]);
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
