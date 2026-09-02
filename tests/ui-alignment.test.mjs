import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import ConnectionsPage from "../app/(connections)/connections/page.jsx";
import JourneyPage from "../app/(journey)/journey/page.jsx";
import { EncounterTab } from "../components/emr/tabs/encounter-tab.jsx";
import { PatientRail } from "../components/emr/patient-rail.jsx";
import { centerSelectedPatientCard, updateHorizontalScrollPosition } from "../components/emr/use-horizontal-scroll.js";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { claimEvaluationsFor, currentEncounterFor } from "../lib/emr/selectors.js";
import { declarationsFor, hasRule, stylesheet } from "./helpers/css.mjs";
import { componentMarkup } from "./helpers/markup.mjs";
import { openingTag, renderComponent } from "./helpers/render.mjs";

/** The opening tag of the element carrying `id`, or "" when it is not rendered. */
test("공통 헤더와 보조 버튼은 44px 클릭 영역을 로고 주변에만 둔다", async () => {
  const [shell, foundation] = await Promise.all([
    stylesheet("src/shell.css"),
    stylesheet("src/foundation.css"),
  ]);

  const brand = declarationsFor(shell, ".app-brand");
  assert.equal(brand.width, "fit-content");
  assert.equal(brand["min-height"], "44px");
  assert.equal(brand["justify-self"], "start");
  const navLink = declarationsFor(shell, ".app-nav a");
  assert.equal(navLink["min-width"], "44px");
  assert.equal(navLink["min-height"], "44px");
  assert.equal(declarationsFor(shell, ".skip-link")["min-height"], "44px");
  assert.equal(declarationsFor(foundation, ".text-button")["min-height"], "44px");
});

test("연결 탐색은 그래프와 근거를 위아래로 분리하고 근거 링크에 충분한 클릭 영역을 둔다", async () => {
  const html = renderComponent(ConnectionsPage);
  const css = await stylesheet("src/explorer.css");

  // The detail panel renders its three regions, in reading order, inside the workspace.
  const identity = html.indexOf('class="explorer-detail__identity"');
  const guidance = html.indexOf('class="explorer-detail__guidance"');
  const evidence = html.indexOf('class="explorer-detail__evidence"');
  assert.ok(identity > -1 && guidance > identity && evidence > guidance);
  const scene = html.indexOf('class="scene-shell"');
  assert.ok(scene > -1 && scene < identity);
  // One column: the scene above, the detail panel below; the panel itself splits into three.
  assert.equal(declarationsFor(css, ".explorer-workspace")["grid-template-columns"], "minmax(0, 1fr)");
  assert.equal(declarationsFor(css, ".explorer-detail")["grid-template-columns"], "minmax(0, 0.82fr) minmax(0, 1.1fr) minmax(0, 1.08fr)");
  assert.equal(declarationsFor(css, ".evidence-card a")["min-height"], "44px");
});

test("Journey는 비교 전에는 긴 변화 상세를 숨기고 모바일 백업 버튼 폭을 제한한다", async () => {
  const html = renderComponent(JourneyPage);
  const [css, script] = await Promise.all([
    stylesheet("src/journey.css"),
    readFile("src/journey.js", "utf8"),
  ]);

  assert.match(openingTag(html, "journeyComparisonDetail"), /\bhidden=""/);
  // source-check: journey.js is a vanilla controller that toggles the detail on the live document; there is no module API to call without a DOM.
  assert.match(script, /elements\.comparisonDetail\.hidden = journey\.length < 2/);
  assert.equal(declarationsFor(css, ".comparison-detail[hidden]").display, "none");
  const narrowActions = declarationsFor(css, ".journey-data-actions", { container: "@media (max-width: 520px)" });
  assert.equal(narrowActions["grid-template-columns"], "repeat(2, minmax(0, 1fr))");
  assert.equal(declarationsFor(css, ".journey-data-actions .secondary-button", { container: "@media (max-width: 520px)" }).width, "100%");
});

test("EMR 모바일은 서명 전에 급여 점검을 보여 주고 스크롤 목록 경계를 알린다", async () => {
  const state = createDemoEmrState("2026-09-02T00:00:00.000Z");
  const patient = state.patients.find(({ id }) => id === state.selectedPatientId);
  const encounter = currentEncounterFor(patient, { selectedEncounterId: state.selectedEncounterId });
  const html = renderComponent(EncounterTab, {
    patient,
    encounter,
    preflightEvaluations: claimEvaluationsFor(patient, state.rules, { includeCurrentDraft: true, encounterId: encounter.id }),
    store: { applyMutation: async () => {}, setStatus: () => {} },
    viewedEncounterId: "",
    setViewedEncounterId: () => {},
    selectTab: () => {},
    dirtyGuardsRef: { current: {} },
    blockClinicalContextChange: () => false,
    visitSlot: null,
  });
  const rail = renderComponent(PatientRail, {
    patients: state.patients,
    selectedPatientId: state.selectedPatientId,
    demo: true,
    updatedAt: state.updatedAt,
    onSelectPatient: () => {},
    onLoadDemo: () => {},
    onSavePatient: () => {},
    onEditPatient: () => {},
    editRequest: null,
    visitSlotRef: null,
  });
  const [css, railSource] = await Promise.all([
    stylesheet("src/emr.css"),
    componentMarkup("components/emr/patient-rail.jsx"),
  ]);

  const mobileClaimIndex = html.indexOf('class="clinical-card encounter-mobile-claim"');
  const saveBarIndex = html.indexOf('class="encounter-save-bar"');
  assert.ok(mobileClaimIndex > 0 && mobileClaimIndex < saveBarIndex);
  assert.match(openingTag(html, "completeEncounter"), /class="clinical-button clinical-button--primary"/);
  assert.match(openingTag(html, "signEncounter"), /class="clinical-button clinical-button--primary clinical-button--confirm"/);
  assert.equal(declarationsFor(css, ".text-action")["min-height"], "44px");
  assert.equal(declarationsFor(css, ".patient-list", { container: "@media (max-width: 1080px)" })["scroll-snap-type"], "x proximity");
  assert.ok(hasRule(css, '.workspace-tabs[data-scroll-position="middle"]', { container: "@media (max-width: 620px)" }));

  // The scroll-position advertiser the edge fades key off: none/start/middle/end from the container's geometry.
  const positionFor = (scrollWidth, clientWidth, scrollLeft) => {
    const container = { scrollWidth, clientWidth, scrollLeft, dataset: {} };
    updateHorizontalScrollPosition(container);
    return container.dataset.scrollPosition;
  };
  assert.equal(positionFor(100, 100, 0), "none");
  assert.equal(positionFor(300, 100, 0), "start");
  assert.equal(positionFor(300, 100, 100), "middle");
  assert.equal(positionFor(300, 100, 200), "end");

  // The rail renders the hooks centering relies on: one card per patient, addressed by id, the selected one marked.
  assert.match(openingTag(rail, "patientList"), /class="patient-list"/);
  assert.equal((rail.match(/\bdata-patient-id="/g) ?? []).length, state.patients.length);
  assert.match(rail, new RegExp(`<button type="button" data-patient-id="${state.selectedPatientId}" aria-current="true"`));
  assert.equal((rail.match(/aria-current="true"/g) ?? []).length, 1);
  // Centering scrolls the selected card's <li> to the middle of an overflowing list and leaves a fitting list alone.
  const previousCss = globalThis.CSS;
  globalThis.CSS = { escape: (value) => value };
  try {
    const scrolls = [];
    const item = { offsetLeft: 400, offsetWidth: 100 };
    const list = (scrollWidth) => ({
      scrollWidth, clientWidth: 300,
      querySelector: (selector) => (selector.includes(state.selectedPatientId) ? { closest: () => item } : null),
      scrollTo: (options) => scrolls.push(options),
    });
    centerSelectedPatientCard(list(900), state.selectedPatientId);
    assert.deepEqual(scrolls, [{ left: 300, behavior: "smooth" }]);
    centerSelectedPatientCard(list(300), state.selectedPatientId);
    assert.equal(scrolls.length, 1);
  } finally {
    globalThis.CSS = previousCss;
  }
  // source-check: the rail centers the selected card from an effect keyed on selectedPatientId; effects do not run under SSR.
  assert.match(railSource, /useEffect\(\(\) => \{\s*centerSelectedPatientCard\(patientListRef\.current, selectedPatientId\);\s*\}, \[patientListRef, selectedPatientId\]\)/);
});
