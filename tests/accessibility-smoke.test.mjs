import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../scripts/accessibility-smoke.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("accessibility smoke covers every route at mobile and desktop viewports", () => {
  for (const route of ["/", "/patient", "/map", "/connections", "/insights", "/journey", "/emr"]) {
    assert.match(script, new RegExp(JSON.stringify(route).replaceAll("/", "\\/")));
  }
  assert.match(script, /width: 390, height: 844/);
  assert.match(script, /width: 1280, height: 800/);
  assert.match(script, /routes\.length \* viewports\.length/);
});

test("accessibility smoke combines the Chrome AX tree with DOM invariants", () => {
  assert.match(script, /Accessibility\.getFullAXTree/);
  assert.match(script, /unnamed visible interactive AX nodes/);
  for (const invariant of [
    "duplicateIds",
    "unlabeledControls",
    "missingAlt",
    "missingHeading",
    "missingLanguage",
    "ariaHiddenFocusables",
    "horizontalOverflow",
  ]) {
    assert.match(script, new RegExp(invariant));
  }
  assert.match(script, /details:not\(\[open\]\)|ancestor\.localName !== 'details'/);
  assert.match(script, /visuallyHidden|isVisuallyHidden/);
});

test("accessibility smoke is deterministic, network-isolated, and cleans its profile", () => {
  assert.match(script, /Fetch\.requestPaused/);
  assert.match(script, /Fetch\.failRequest/);
  assert.match(script, /Emulation\.setLocaleOverride/);
  assert.match(script, /Emulation\.setTimezoneOverride/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /Page\.addScriptToEvaluateOnNewDocument/);
  assert.match(script, /mkdtemp/);
  assert.match(script, /for \(let attempt = 0; attempt < 5/);
  assert.match(script, /rm\(profile, \{ recursive: true, force: true/);
  assert.equal(packageJson.scripts["smoke:a11y"], "node scripts/accessibility-smoke.mjs");
});
