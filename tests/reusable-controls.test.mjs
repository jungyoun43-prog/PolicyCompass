import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

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
const pages = [
  "gateway.html",
  "landing.html",
  "index.html",
  "connections.html",
  "insights.html",
  "journey.html",
  "emr.html",
];

test("공통 컨트롤 모듈이 hover, keyboard focus, active, disabled 피드백을 모두 소유한다", async () => {
  const css = await readFile("src/controls.css", "utf8");

  for (const state of ["hover:not(:disabled)", "focus-visible", "active:not(:disabled)", "disabled"]) {
    assert.match(css, new RegExp(`\\)\\:${state.replace(/[()]/g, "\\$&")}`), state);
  }
  assert.match(css, /\[aria-disabled="true"\]/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /outline: 3px solid/);
});
test("모든 화면은 공통 컨트롤 모듈을 소비한다", async () => {
  for (const page of pages) {
    const html = await readFile(`src/${page}`, "utf8");
    assert.match(html, /href="\/controls\.css"/, page);
  }
});

test("화면별 모듈은 공통 컨트롤의 상호작용 상태를 재정의하지 않는다", async () => {
  for (const file of routeStyles) {
    const css = await readFile(`src/${file}`, "utf8");
    for (const className of controlClasses) {
      assert.doesNotMatch(
        css,
        new RegExp(`\\.${className}[^,{]*(?::hover|:focus-visible|:active|:disabled)`),
        `${file}: .${className}`,
      );
    }
  }
});
