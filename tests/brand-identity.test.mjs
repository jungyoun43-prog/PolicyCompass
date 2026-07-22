import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pages = [
  "gateway.html",
  "landing.html",
  "index.html",
  "connections.html",
  "insights.html",
  "journey.html",
  "emr.html",
];

test("all product routes share the connected-life-signals identity", async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../src/${page}`, import.meta.url), "utf8");

    assert.match(html, /href="\/brand-signals\.css"/, `${page} must load the shared motif`);
    assert.match(html, /class="app-brand__mark"/, `${page} must expose the shared product mark`);
    assert.match(html, /class="[^"]*signal-kicker/, `${page} must use the motif in a meaningful heading`);
    assert.match(html, /M12 40 31 19 52 37/, `${page} must use the shared connected-node favicon`);
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
