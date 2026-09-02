import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SignalKicker } from "../components/signal-kicker.jsx";
import { declarationsFor, stylesheet } from "./helpers/css.mjs";
import { renderComponent, renderPage } from "./helpers/render.mjs";

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
/** The label text of the first signal-kicker motif in a page, or "" when absent. */
function signalKickerLabel(html) {
  const kicker = html.match(/<(?:p|div) class="[^"]*\bsignal-kicker\b[^"]*"[\s\S]*?<span class="[^"]*\bsignal-kicker__label\b[^"]*">([^<]*)<\/span>/);
  return kicker?.[1].trim() ?? "";
}

test("all product routes share the connected-life-signals identity", async () => {
  // source-check: app/icon.svg is the served favicon itself, so its markup is the output users receive.
  const icon = await readFile("app/icon.svg", "utf8");
  const iconColors = new Set(icon.match(/#[0-9a-f]{6}\b/gi).map((color) => color.toLowerCase()));
  assert.match(icon, /<path[^>]*\bd="M12 40 31 19 52 37"/, "the shared connected-node favicon");
  assert.deepEqual([...iconColors].sort(), ["#1b5e20", "#66bb6a", "#a5d6a7", "#e8f5e9"], "favicon must use the brand palette");
  assert.ok(!iconColors.has("#fbfaf7") && !iconColors.has("#0b6663"), "must not retain the retired favicon colors");

  for (const route of ["/", "/patient", "/map", "/connections", "/insights", "/journey"]) {
    const html = await renderPage(route);
    assert.match(html, /<span class="app-brand__mark" aria-hidden="true">/, `${route} must expose the shared product mark`);
    assert.match(html, /<span class="signal-thread(?: [^"]*)?" aria-hidden="true"><svg\b/, `${route} must render the shared motif`);
    assert.notEqual(signalKickerLabel(html), "", `${route} must use the motif in a meaningful heading`);
  }

  // EMR carries the identity through the branded app header mark; the
  // decorative hero with the thread motif was removed for workspace density.
  const emr = await renderPage("/emr");
  assert.match(emr, /<a class="app-brand" href="\/emr"[^>]*><span class="app-brand__mark" aria-hidden="true">/, "emr must expose the shared product mark");

  for (const [route, layout] of Object.entries(layouts)) {
    // source-check: layouts import next/headers through RootShell, which Node cannot resolve
    // outside a Next build, so the exported viewport and the stylesheet import are read from source.
    const source = await readFile(layout, "utf8");
    assert.match(source, /^export const viewport = \{[^}]*\bthemeColor: ["']#fafbfa["']/m, `${route} must expose the green browser theme`);
    assert.match(source, /^import "[^"]*\/brand-signals\.css";$/m, `${route} must load the shared motif stylesheet`);
  }
});

test("brand motif encodes recorded and inferred relationships without color alone", async () => {
  const css = await stylesheet("src/brand-signals.css");
  // source-check: DESIGN.md is the written design contract itself, not an implementation.
  const design = await readFile(new URL("../DESIGN.md", import.meta.url), "utf8");

  const motif = renderComponent(SignalKicker, { label: "TEST" });
  assert.match(motif, /<path class="signal-thread__line" /, "a recorded path");
  assert.match(motif, /<path class="signal-thread__line signal-thread__line--inferred" /, "an inferred path");
  assert.equal((motif.match(/class="signal-thread__node signal-thread__node--recorded"/g) ?? []).length, 2, "two recorded nodes");
  assert.equal((motif.match(/class="signal-thread__node signal-thread__node--inferred"/g) ?? []).length, 1, "one inferred node");
  assert.match(motif, /<span class="signal-kicker__label">TEST<\/span>/);

  assert.ok(declarationsFor(css, ".signal-thread__line--inferred")["stroke-dasharray"], "inferred paths are dashed");
  assert.equal(declarationsFor(css, ".signal-thread__node--recorded").fill, "currentColor", "recorded nodes are filled");
  assert.ok(declarationsFor(css, ".signal-thread__node--inferred")["stroke-dasharray"], "inferred nodes are dashed outlines");
  assert.match(design, /solid path and filled node mean a fact/);
  assert.match(design, /dashed cyan path and outlined node mean a relationship inferred/);
});
