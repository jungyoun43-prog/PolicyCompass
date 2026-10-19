import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";

import { CoverageQuickStart } from "../components/emr/coverage-quick-start.jsx";
import { EncounterTab } from "../components/emr/tabs/encounter-tab.jsx";
import { currentEncounterFor } from "../lib/emr/selectors.js";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { renderComponent } from "./helpers/render.mjs";
import { declarationsFor, hasRule, stylesheet } from "./helpers/css.mjs";

const state = createDemoEmrState("2026-09-02T00:00:00.000Z");
const patient = state.patients.find(({ id }) => id === state.selectedPatientId);
const encounter = currentEncounterFor(patient, { viewedEncounterId: "", selectedEncounterId: state.selectedEncounterId });
const noop = () => {};
const renderEncounter = () => load(renderComponent(EncounterTab, {
  patient, encounter, preflightEvaluations: [], viewedEncounterId: "",
  store: { applyMutation: async () => {}, setStatus: noop },
  setViewedEncounterId: noop, selectTab: noop, dirtyGuardsRef: { current: {} },
  blockClinicalContextChange: () => false, visitSlot: null,
}));

test("진료 영역 탐색은 잠금·제출 없이 고유한 제목을 가리킨다", () => {
  const $ = renderEncounter();
  const buttons = $('nav[aria-label="현재 진료 영역 이동"] button');
  assert.deepEqual(buttons.toArray().map((button) => $(button).text()), ["기록", "진단", "처방", "검사", "완료"]);
  for (const button of buttons) {
    const control = $(button);
    assert.equal(control.attr("type"), "button", "이동은 저장/제출 동작이 아니다");
    assert.equal(control.attr("disabled"), undefined);
    assert.equal(control.parents("form").length, 0);
    const targetId = control.attr("aria-controls");
    const target = $(`[id="${targetId}"]`);
    assert.equal(target.length, 1, `${targetId}: 중복되거나 누락된 이동 대상`);
    assert.equal(target.attr("tabindex"), "-1", `${targetId}: 프로그램 초점 대상`);
    assert.equal(target.is('h1,h2,h3,h4,h5,h6,[role="heading"]'), true);
    assert.equal(target.parents("details:not([open])").length, 0, "이동 제목은 접힌 영역에 있지 않는다");
  }
  assert.equal(buttons.filter('[aria-current="location"]').length, 1);
});

test("과거 기록은 접혀 시작하는 native disclosure 안에 기존 자료와 열기를 유지한다", () => {
  const $ = renderEncounter();
  const history = $("#patientHistory");
  assert.equal(history.length, 1);
  assert.equal(history.is("details"), true);
  assert.equal(history.attr("open"), undefined);
  assert.match(history.children("summary").text(), /^과거 기록/);
  assert.equal(history.find('.stream-tabs button[aria-pressed="true"]').length, 1);
  assert.equal(history.find(".stream-scroll").length, 1);
  assert.equal(history.find("button").toArray().some((button) => $(button).text() === "전체 기록 보기"), true);
  assert.equal($("#encounterSignoffTitle").parents("details").length, 0);
  assert.equal($("#saveEncounterDraft").attr("form"), "encounterForm");
  assert.equal($("#signEncounter").attr("type"), "button");
});

test("사용 안내는 접혀 시작하며 예시 검토와 원래 안전 문구를 보존한다", () => {
  const $ = load(renderComponent(CoverageQuickStart));
  const help = $("#coverageQuickStart");
  assert.equal(help.is("details"), true);
  assert.equal(help.attr("open"), undefined);
  assert.match(help.children("summary").text(), /사용 안내/);
  assert.equal(help.find("#startCoverageSample").attr("aria-haspopup"), "dialog");
  assert.match(help.text(), /저장된 환자 기록은 바뀌지 않습니다/);
  assert.match(help.text(), /예시 자료에 대한 참고용 검토입니다/);
});

test("처방 composer는 라벨을 표시하고 결과 스크롤과 action 영역을 분리한다", async () => {
  const css = await stylesheet("src/emr-dialog-responsive.css");
  const labels = declarationsFor(css, "#prescriptionDialog .rx-order-field-label");
  assert.equal(labels.position, "static");
  assert.equal(labels["clip-path"], "none");
  assert.equal(labels.overflow, "visible");
  assert.equal(declarationsFor(css, "#prescriptionDialog .rx-result-list").overflow, "auto");
  assert.equal(declarationsFor(css, "#prescriptionDialog .rx-order-line__actions").position, undefined, "actions가 입력 위에 떠 있지 않는다");
  const phone = { container: "@media (max-width: 620px)" };
  assert.equal(declarationsFor(css, "#prescriptionDialog:not([data-embedded])", phone).height, "calc(100dvh - 16px)");
});

test("휴대폰 헤더는 환자 탐색 위에 두 개의 44px 행으로 모든 조작을 배치한다", async () => {
  const css = await stylesheet("src/clinical-ui.css");
  const phone = { container: "@media (max-width: 620px)" };
  assert.equal(declarationsFor(css, ".emr-page .clinical-header .app-header__inner", phone).height, "88px");
  assert.equal(declarationsFor(css, ".emr-page .clinical-header .app-header__inner", phone)["flex-direction"], "column");
  for (const selector of [".emr-page .clinical-header .app-header__identity", ".emr-page .clinical-header .app-header__workspace"]) {
    assert.equal(declarationsFor(css, selector, phone)["min-height"], "44px");
    assert.equal(declarationsFor(css, selector, phone)["flex-direction"], "row");
  }
  assert.equal(declarationsFor(css, ".emr-page .clinical-header .command-actions", phone)["flex-wrap"], "nowrap");
  assert.equal(declarationsFor(css, ".emr-page .clinical-header .command-actions > .clinical-button", phone).width, "auto", "legacy width:100%가 조작 행을 늘리지 않는다");
});

test("처방 행은 내용 높이로 남고 스크롤바 안쪽 폭과 44px action 폭을 지킨다", async () => {
  const css = await stylesheet("src/emr-dialog-responsive.css");
  const result = declarationsFor(css, "#prescriptionDialog .rx-result--compact");
  assert.equal(result.flex, "0 0 auto", "첫 카드의 내용과 action을 수축시키지 않는다");
  assert.equal(result.overflow, "visible", "선택 카드가 입력이나 action을 자르지 않는다");
  assert.equal(result.width, "auto", "행은 목록의 실제 client 폭을 따른다");
  assert.equal(result["max-width"], "100%");
  assert.equal(declarationsFor(css, "#prescriptionDialog .rx-order-line__actions button")["min-width"], "44px");
});

test("약품 선택은 전체 1px 경계와 배경으로 표시하고 이름 위 stripe는 만들지 않는다", async () => {
  const legacy = await stylesheet("src/emr.css");
  const composer = await stylesheet("src/emr-dialog-responsive.css");
  assert.equal(hasRule(legacy, ".rx-result.is-selected::before"), false);
  assert.equal(hasRule(legacy, ".rx-result.is-reviewing::before"), false);
  const selection = declarationsFor(composer, "#prescriptionDialog .rx-result--compact:is(.is-selected, .is-reviewing)");
  assert.equal(selection.background, "var(--accent-wash)");
  assert.equal(selection["box-shadow"], "inset 0 0 0 1px var(--accent)");
});
