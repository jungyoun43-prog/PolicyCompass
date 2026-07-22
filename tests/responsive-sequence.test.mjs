import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../scripts/responsive-sequence-smoke.mjs", import.meta.url), "utf8");

test("larger viewport preserves every route's 390px semantic content sequence", () => {
  for (const route of ["/", "/patient", "/map", "/connections", "/insights", "/journey", "/emr"]) {
    assert.match(script, new RegExp(`route: ${JSON.stringify(route).replaceAll("/", "\\/")}`));
  }
  assert.match(script, /width: 390, height: 844/);
  assert.match(script, /width: 768, height: 1024/);
  assert.match(script, /width: 1280, height: 800/);
  assert.match(script, /width: 1600, height: 900/);
  assert.match(script, /compareDocumentPosition/);
  assert.match(script, /DOCUMENT_POSITION_FOLLOWING/);
  assert.match(script, /neutralCssOrder/);
  assert.match(script, /documentWidth <= viewport\.width/);
  assert.match(script, /invalidBounds\.length === 0/);
  assert.match(script, /clippedControls\.length === 0/);
  assert.match(script, /overlaps\.length === 0/);
});
