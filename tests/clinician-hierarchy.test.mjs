import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { declarationsFor, hasRule, selectorsMatching, stylesheet } from "./helpers/css.mjs";
import { renderPage } from "./helpers/render.mjs";

const layouts = {
  "/": "app/(gateway)/layout.jsx",
  "/patient": "app/(landing)/layout.jsx",
  "/map": "app/(map)/layout.jsx",
  "/connections": "app/(connections)/layout.jsx",
  "/insights": "app/(insights)/layout.jsx",
  "/journey": "app/(journey)/layout.jsx",
  "/emr": "app/(emr)/layout.jsx",
};

/** The HTML the server sends for a route's page (effects do not run). */
// source-check: layouts render through RootShell, which awaits next/headers and
// cannot be imported outside a Next request, so their stylesheet imports and
// bodyClassName are read from source.
const layoutSource = (route) => readFile(layouts[route], "utf8");

/** Every declaration in the sheet as { prop, value } pairs (keyframes included). */
function allDeclarations(sheet) {
  const found = [];
  sheet.walkDecls((decl) => found.push({ prop: decl.prop, value: decl.value }));
  return found;
}

const composedRoutes = ["/map", "/connections", "/insights", "/journey"];

test("등록된 정보 중심 화면은 공유 밀도 계층 모듈을 조합한다", async () => {
  for (const route of composedRoutes) {
    const layout = await layoutSource(route);
    assert.match(layout, /import "[^"]*clinician-hierarchy\.css"/, route);
    assert.match(layout, /bodyClassName=.[^'"]*\bclinician-hierarchy\b/, route);

    const html = await renderPage(route);
    const main = html.match(/<main class="([^"]*)" id="mainContent"[^>]*>([\s\S]*?)<\/main>/);
    assert.ok(main, `${route}: <main id="mainContent">가 렌더링되어야 한다`);
    assert.ok(main[1].split(" ").includes("clinician-hierarchy__workspace"), route);

    const summary = main[2].search(/<section class="[^"]*\bclinician-hierarchy__summary\b[^"]*"/);
    const groups = main[2].search(/<(?:div|section) class="[^"]*\bclinician-hierarchy__groups\b[^"]*"/);
    assert.ok(summary >= 0, `${route}: 요약 영역이 workspace 안에 있어야 한다`);
    assert.ok(groups > summary, `${route}: 그룹 영역이 요약 뒤에 이어져야 한다`);
  }
});

test("계층 모듈은 기존 토큰만 소비하고 컨트롤 계약을 만들지 않는다", async () => {
  const sheet = await stylesheet("src/clinician-hierarchy.css");
  const declarations = allDeclarations(sheet);

  assert.equal(selectorsMatching(sheet, /:root/).length, 0);
  assert.deepEqual(declarations.filter(({ prop }) => prop.startsWith("--")), []);
  assert.deepEqual(declarations.filter(({ value }) => /#[\da-f]{3,8}\b/i.test(value)), []);
  assert.deepEqual(selectorsMatching(sheet, /\b(button|input|textarea|select)\b/), []);

  const values = declarations.map(({ value }) => value).join("\n");
  for (const token of ["border-subtle", "space-3", "space-4", "space-5", "space-6", "muted", "font-mono"]) {
    assert.ok(values.includes(`var(--${token})`), token);
  }
});

test("좁은 화면 계층은 콘텐츠 폭과 긴 문자열을 안전하게 제한한다", async () => {
  const sheet = await stylesheet("src/clinician-hierarchy.css");
  const narrow = { container: "@media (max-width: 620px)" };

  assert.ok(hasRule(sheet, ".clinician-hierarchy__summary", narrow));
  for (const selector of [".clinician-hierarchy__groups", ".clinician-hierarchy__groups > *"]) {
    const rules = declarationsFor(sheet, selector, narrow);
    assert.equal(rules["max-width"], "100%", selector);
    assert.equal(rules["overflow-wrap"], "anywhere", selector);
  }
  assert.equal(declarationsFor(sheet, ".clinician-hierarchy__workspace")["min-width"], "0");
  assert.equal(declarationsFor(sheet, ".clinician-hierarchy__groups > *")["min-width"], "0");
});

test("게이트웨이와 앱 홈 및 EMR 경계에는 밀도 모듈을 주입하지 않는다", async () => {
  for (const route of ["/", "/patient", "/emr"]) {
    assert.doesNotMatch(await renderPage(route), /clinician-hierarchy/, route);
    assert.doesNotMatch(await layoutSource(route), /clinician-hierarchy/, layouts[route]);
  }
});
