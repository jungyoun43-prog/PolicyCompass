import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { declarationsFor, rulesFor, selectorsMatching, stylesheet } from "./helpers/css.mjs";

const controlClasses = [
  "landing-button",
  "role-action",
  "brief-action",
  "clinical-button",
  "text-action",
  "primary-button",
  "secondary-button",
  "demo-trigger",
  "import-button",
  "journey-save",
  "signal-chip",
];

const routeStyles = ["landing.css", "gateway.css", "insights.css", "emr.css"];
const layouts = [
  "app/(gateway)/layout.jsx",
  "app/(landing)/layout.jsx",
  "app/(map)/layout.jsx",
  "app/(connections)/layout.jsx",
  "app/(insights)/layout.jsx",
  "app/(journey)/layout.jsx",
  "app/(emr)/layout.jsx",
];

const classesIn = (selector) => (selector.match(/\.[\w-]+/g) ?? []).map((token) => token.slice(1));

/**
 * The one selector in `sheet` that ends with `state` and lists every shared
 * control class; fails naming the missing class when the module drops one.
 */
function sharedStateSelector(sheet, state) {
  const candidates = selectorsMatching(sheet, new RegExp(`${state.replace(/[()[\]"]/g, "\\$&")}$`));
  const shared = candidates.find((selector) => controlClasses.every((name) => classesIn(selector).includes(name)));
  assert.ok(shared, `${state}: ${candidates.join(" | ") || "선택자 없음"}`);
  return shared;
}

test("공통 컨트롤 모듈이 hover, keyboard focus, active, disabled 피드백을 모두 소유한다", async () => {
  const css = await stylesheet("src/controls.css");

  const hover = declarationsFor(css, sharedStateSelector(css, ":hover:not(:disabled)"));
  assert.equal(hover.transform, "translateY(-1px)");
  assert.ok(hover.filter, "hover 밝기 피드백");

  const focus = declarationsFor(css, sharedStateSelector(css, ":focus-visible"));
  assert.equal(focus.outline, "3px solid var(--focus-ring)");
  assert.ok(focus["outline-offset"], "포커스 링 오프셋");

  const active = declarationsFor(css, sharedStateSelector(css, ":active:not(:disabled)"));
  assert.equal(active.transform, "scale(0.98)");

  for (const state of [":disabled", '[aria-disabled="true"]']) {
    const disabled = declarationsFor(css, sharedStateSelector(css, state));
    assert.equal(disabled.cursor, "not-allowed", state);
    assert.equal(disabled["pointer-events"], "none", state);
    assert.ok(disabled.opacity, `${state} 흐림`);
  }

  for (const name of controlClasses) {
    const calm = declarationsFor(css, `.${name}`, { container: "@media (prefers-reduced-motion: reduce)" });
    assert.equal(calm["transition-duration"], "0.01ms", `${name} reduced-motion`);
  }
});

test("모든 화면은 공통 컨트롤 모듈을 소비한다", async () => {
  for (const layout of layouts) {
    // source-check: layouts render through RootShell, which awaits next/headers and
    // cannot run outside a request, and the test hook erases .css imports, so the
    // stylesheet dependency is only visible in the module source.
    const source = await readFile(layout, "utf8");
    assert.match(source, /import "[^"]*\/controls\.css"/, layout);
  }
});

test("화면별 모듈은 공통 컨트롤의 상호작용 상태를 재정의하지 않는다", async () => {
  for (const file of routeStyles) {
    const css = await stylesheet(`src/${file}`);
    for (const className of controlClasses) {
      const overrides = selectorsMatching(
        css,
        new RegExp(`\\.${className}[^,]*(?::hover|:focus-visible|:active|:disabled)`),
      );
      assert.deepEqual(overrides, [], `${file}: .${className}`);
      for (const state of [":hover", ":focus-visible", ":active", ":disabled"]) {
        assert.equal(rulesFor(css, `.${className}${state}`).length, 0, `${file}: .${className}${state}`);
      }
    }
  }
});
