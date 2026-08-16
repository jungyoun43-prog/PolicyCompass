import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calculateReleaseSchedule } from "../scripts/release-gate.mjs";
import {
  MATRIX_PROFILE_TYPES,
  MATRIX_REPETITIONS,
  MATRIX_ROUTES,
  MATRIX_VIEWPORTS,
} from "../scripts/responsive-matrix-contract.mjs";

const release = await readFile(
  new URL("../scripts/release-gate.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("release topology owns exactly 168 browser-observed matrix attempts", () => {
  assert.equal(
    MATRIX_ROUTES.length
      * MATRIX_VIEWPORTS.length
      * MATRIX_PROFILE_TYPES.length
      * MATRIX_REPETITIONS.length,
    168,
  );
  assert.match(release, /runSharedRepetition/);
  assert.match(release, /runFreshAttempt/);
  assert.match(release, /for \(const repetition of MATRIX_REPETITIONS\)/);
  assert.match(release, /for \(const route of MATRIX_ROUTES\)/);
  assert.match(release, /for \(const viewport of MATRIX_VIEWPORTS\)/);
  assert.match(release, /browserObserved: true/);
  assert.equal(
    packageJson.scripts["gate:release"],
    "npm run build && node scripts/release-gate.mjs",
  );
});

test("pilot p95 produces a bounded per-cell cap and calculated hard kill", () => {
  assert.deepEqual(calculateReleaseSchedule({
    p95CellMs: 1_700,
    p95StartupArtifactMs: 2_500,
    shardCount: 6,
    configuredCellLimitMs: 30_000,
    configuredStepTimeoutMs: 8_000,
  }), {
    shardCount: 6,
    configuredCellLimitMs: 30_000,
    adjustedCellCapMs: 10_000,
    stepTimeoutMs: 8_000,
    hardKillMs: 1_179_000,
    hardKillFormula: "ceil(((84 + ceil(84 / S)) * adjustedCellCapMs + p95StartupArtifactMs) * 1.2)",
    p95StartupArtifactMs: 2_500,
  });
  assert.match(release, /p50CellMs/);
  assert.match(release, /p95CellMs/);
  assert.match(release, /p50StartupArtifactMs/);
  assert.match(release, /p95StartupArtifactMs/);
  assert.match(release, /runTaskPool\(sharedTasks, 1/);
  assert.match(release, /runTaskPool\(freshTasks, shardCount/);
  assert.match(release, /terminateActiveBrowsers\("SIGKILL"\)/);
});

test("release manifest keeps matrix, canonical, failure evidence, and human gate separate", () => {
  assert.match(release, /aggregateMatrixCoverage\(attempts, evidence\)/);
  assert.match(release, /runResponsiveSequence\(/);
  assert.match(release, /failureEvidence: evidence/);
  assert.match(release, /humanGate: \{[\s\S]*?status: "unperformed"/);
  assert.match(release, /releaseBlocking: true/);
  assert.match(release, /personalUsersRequired: 3/);
  assert.match(release, /clinicalOrHealthInformationUsersRequired: 3/);
  assert.match(release, /await writeSmokeReport\(manifestPath, manifest\)/);
});
