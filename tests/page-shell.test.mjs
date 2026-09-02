import assert from "node:assert/strict";
import test from "node:test";

import { createDemoEmrState } from "../src/emr-demo-state.js";
import { declarationsFor, hasRule, stylesheet } from "./helpers/css.mjs";
import { renderComponent, renderPage } from "./helpers/render.mjs";

/** The HTML the server sends for a route's page (effects do not run). */
test("역할 게이트웨이는 두 앱의 명시적 진입점을 제공한다", async () => {
  const html = await renderPage("/");

  assert.match(html, /<a [^>]*href="\/emr"[^>]*data-main-link/);
  assert.match(html, /<a [^>]*href="\/patient"/);
});

test("개인 앱의 모든 주요 화면은 /patient 홈 링크를 제공한다", async () => {
  for (const route of ["/patient", "/map", "/connections", "/insights", "/journey"]) {
    const html = await renderPage(route);
    assert.match(html, /<a class="app-brand" href="\/patient"/, route);
  }
});

test("임상 앱은 /emr을 독립 워크스페이스 홈으로 제공한다", async () => {
  // The EMR shell renders its header before the store is ready; the body atlas
  // lives in the 신체 tab, rendered here with a synthetic patient.
  const shell = await renderPage("/emr");
  const { BodyTab } = await import("../components/emr/tabs/body-tab.jsx");
  const state = createDemoEmrState("2026-09-02T00:00:00.000Z");
  const patient = state.patients.find(({ id }) => id === state.selectedPatientId) ?? state.patients[0];
  const bodyTab = renderComponent(BodyTab, { patient, selectTab() {}, active: false });

  assert.match(shell, /<a class="app-brand" href="\/emr"/);
  assert.match(bodyTab, /<h3 id="clinicalBodyTitle">[^<]+<\/h3>/);
  assert.match(bodyTab, /<img [^>]*src="\/assets\/body-atlas-v5\.webp"/);
});

test("Health Map은 빈 세 번째 컬럼 없이 두 영역을 균형 있게 배치한다", async () => {
  const controls = await stylesheet("src/controls.css");
  assert.equal(
    declarationsFor(controls, ".map-page .dashboard")["grid-template-columns"],
    "minmax(320px, 0.78fr) minmax(520px, 1.22fr)",
  );
});

test("공통 앱 셸은 모든 페이지 배경과 헤더 폭을 공유한다", async () => {
  const foundation = await stylesheet("src/foundation.css");
  assert.equal(declarationsFor(foundation, ":root")["--page-width"], "1480px");
  assert.ok(hasRule(foundation, "body.map-page"), "the map page background is set by the shared foundation");
  assert.ok(hasRule(foundation, ".site-header"), "the site header is styled by the shared foundation");
  assert.match(declarationsFor(foundation, ".site-header").width, /var\(--page-width\)/, "the header shares the page width token");
});
