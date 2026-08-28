import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CANONICAL_STEPS,
  RESPONSIVE_VIEWPORTS,
} from "../scripts/responsive-sequence-smoke.mjs";
import {
  MATRIX_PRODUCT_BEHAVIORS,
  MATRIX_ROUTES,
} from "../scripts/responsive-matrix-contract.mjs";

const sequence = await readFile(
  new URL("../scripts/responsive-sequence-smoke.mjs", import.meta.url),
  "utf8",
);
const harness = await readFile(
  new URL("../scripts/browser-smoke-harness.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("canonical sequence fixes all seven routes and four viewports", () => {
  assert.deepEqual(CANONICAL_STEPS.map(({ route }) => route), MATRIX_ROUTES);
  assert.deepEqual(
    RESPONSIVE_VIEWPORTS.map(({ name }) => name),
    ["390x844", "768x1024", "1280x800", "1600x900"],
  );
  assert.equal(CANONICAL_STEPS.length * RESPONSIVE_VIEWPORTS.length, 28);
  assert.equal(
    packageJson.scripts["smoke:responsive-sequence"],
    "npm run build && node scripts/responsive-sequence-smoke.mjs",
  );
});

test("one sequential browser profile observes real product and layout behavior", () => {
  assert.match(sequence, /const profileType = "shared-sequential"/);
  assert.match(sequence, /localStorage\.setItem\("policycompass-release-profile"/);
  assert.match(sequence, /for \(const viewport of RESPONSIVE_VIEWPORTS\)/);
  assert.match(sequence, /for \(const expectation of CANONICAL_STEPS\)/);
  assert.match(sequence, /observeResponsiveRoute\(api/);
  assert.match(sequence, /compareDocumentPosition/);
  assert.match(sequence, /DOCUMENT_POSITION_FOLLOWING/);
  assert.match(sequence, /noHorizontalOverflow/);
  assert.match(sequence, /clippedControls\.length === 0/);
  for (const route of MATRIX_ROUTES) {
    for (const behavior of MATRIX_PRODUCT_BEHAVIORS[route]) {
      assert.match(sequence, new RegExp(behavior));
    }
  }
});

test("canonical steps are bounded and failures use shared browser diagnostics", () => {
  assert.match(sequence, /timeoutMs: Math\.min\(cellLimitMs, stepTimeoutMs\)/);
  assert.match(sequence, /attemptTimeoutMs: sessionTimeoutMs/);
  assert.match(sequence, /api\.captureDiagnostics/);
  assert.match(sequence, /failureArtifacts = bundle\.artifacts/);
  assert.match(sequence, /writeSmokeReport\(join\(runRoot, "manifest\.json"\), manifest\)/);
  assert.match(harness, /Runtime\.consoleAPICalled/);
  assert.match(harness, /Network\.loadingFailed/);
  assert.match(harness, /Page\.captureScreenshot/);
  assert.match(harness, /document\.documentElement\?\.outerHTML/);
});
