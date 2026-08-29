import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PR_GATE_CELLS } from "../scripts/pr-golden-flow-gate.mjs";

const gate = await readFile(
  new URL("../scripts/pr-golden-flow-gate.mjs", import.meta.url),
  "utf8",
);
const harness = await readFile(
  new URL("../scripts/browser-smoke-harness.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("PR gate owns the two fresh flows and one shared sequential flow", () => {
  assert.deepEqual(
    PR_GATE_CELLS.map(({ id, profileType }) => ({ id, profileType })),
    [
      { id: "clinician-fresh", profileType: "fresh" },
      { id: "patient-fresh", profileType: "fresh" },
      {
        id: "clinician-then-patient-shared",
        profileType: "shared-sequential",
      },
    ],
  );
  assert.equal(
    packageJson.scripts["gate:pr"],
    "npm run build && node scripts/pr-golden-flow-gate.mjs",
  );
});

test("explicit and managed app URLs are both health checked", () => {
  assert.match(gate, /startManagedAppServer\(\{ appUrl, healthPath: "\/patient" \}\)/);
  assert.match(harness, /if \(appUrl\) \{[\s\S]*?await waitForAppHealth\(normalized/);
  assert.match(harness, /const port = await reserveTcpPort\(\)/);
  assert.match(harness, /spawn\("npx", \["next", "start", "-p", String\(port\)\]/);
  assert.match(harness, /server\.stdout\.on\("data"/);
  assert.match(harness, /server\.stderr\.on\("data"/);
  assert.match(gate, /finally \{[\s\S]*?await server\?\.stop\(\)/);
});

test("each PR cell is bounded and receives an isolated Chrome debug port", () => {
  assert.match(gate, /withTimeout\([\s\S]*?cellTimeoutMs/);
  assert.match(gate, /stopChildProcess\(child, \{ processGroup: useProcessGroup \}\)/);
  assert.match(gate, /CLINICIAN_CHROME_DEBUG_PORT: "0"/);
  assert.match(gate, /PATIENT_CHROME_DEBUG_PORT: "0"/);
  assert.match(gate, /PR_GATE_CHROME_DEBUG_PORT: "0"/);
  assert.match(harness, /SmokeTimeoutError/);
  assert.match(harness, /Chrome DevTools command \$\{method\} timed out/);
  assert.match(harness, /Browser step "\$\{name\}"/);
  assert.match(harness, /Browser smoke attempt/);
  assert.match(harness, /signal\("SIGTERM"\)[\s\S]*?signal\("SIGKILL"\)/);
});

test("PR success and failure manifests contain timed evidence-bearing cells", () => {
  for (const field of [
    "runId",
    "cell",
    "profileType",
    "startedAt",
    "finishedAt",
    "durationMs",
    "cellTimeoutMs",
    "steps",
    "productAssertions",
    "outcome",
  ]) {
    assert.match(gate, new RegExp(`\\b${field}\\b`));
  }
  for (const artifact of [
    "runner.log",
    "failure.dom.html",
    "failure.png",
    "failure.json",
    "manifest.json",
  ]) {
    assert.match(gate, new RegExp(artifact.replace(".", "\\.")));
  }
  assert.match(gate, /Object\.values\(productAssertions\)\.every/);
  assert.match(gate, /await writeSmokeReport\(manifestPath, manifest\)/);
  assert.match(gate, /ownership: "PR"/);
});
