import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { componentMarkup, emrMarkup, pageMarkup } from "./helpers/markup.mjs";

const routes = ["/", "/patient", "/map", "/connections", "/insights", "/journey"];
const layouts = {
  "/": "app/(gateway)/layout.jsx",
  "/patient": "app/(landing)/layout.jsx",
  "/map": "app/(map)/layout.jsx",
  "/connections": "app/(connections)/layout.jsx",
  "/insights": "app/(insights)/layout.jsx",
  "/journey": "app/(journey)/layout.jsx",
  "/emr": "app/(emr)/layout.jsx",
};

test("all product routes share the connected-life-signals identity", async () => {
  const icon = await readFile("app/icon.svg", "utf8");
  assert.match(icon, /M12 40 31 19 52 37/, "the shared connected-node favicon");
  assert.match(icon, /#e8f5e9[\s\S]*#1b5e20[\s\S]*#66bb6a[\s\S]*#a5d6a7/, "favicon must use the brand palette");
  assert.doesNotMatch(icon, /#fbfaf7|#0b6663/, "must not retain the retired favicon colors");

  for (const route of routes) {
    const html = await pageMarkup(route);
    assert.match(html, /import "[^"]*brand-signals\.css"/, `${route} must load the shared motif`);
    assert.match(html, /class="app-brand__mark"|SignalKicker|signal-kicker/, `${route} must expose the shared product mark`);
    assert.match(html, /signal-kicker|SignalKicker/, `${route} must use the motif in a meaningful heading`);
  }

  const emr = await emrMarkup();
  const chrome = await componentMarkup("components/emr/chrome.jsx");
  assert.match(emr, /class="app-brand__mark"/, "emr must expose the shared product mark");
  assert.match(chrome, /signal-kicker|SignalKicker/, "emr must use the motif in a meaningful heading");

  for (const [route, layout] of Object.entries(layouts)) {
    const source = await readFile(layout, "utf8");
    assert.match(source, /themeColor: ["']#e8f5e9["']/, `${route} must expose the green browser theme`);
    assert.match(source, /brand-signals\.css/, `${route} must load the shared motif stylesheet`);
  }
});

test("brand motif encodes recorded and inferred relationships without color alone", async () => {
  const css = await readFile(new URL("../src/brand-signals.css", import.meta.url), "utf8");
  const design = await readFile(new URL("../DESIGN.md", import.meta.url), "utf8");

  assert.match(css, /signal-thread__line--inferred[\s\S]*stroke-dasharray/);
  assert.match(css, /signal-thread__node--recorded[\s\S]*fill:\s*currentColor/);
  assert.match(css, /signal-thread__node--inferred[\s\S]*stroke-dasharray/);
  assert.match(design, /solid path and filled node mean a fact/);
  assert.match(design, /dashed cyan path and outlined node mean a relationship inferred/);
});
