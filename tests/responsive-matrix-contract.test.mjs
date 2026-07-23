import assert from "node:assert/strict";
import test from "node:test";

import {
  MATRIX_LAYOUT_ASSERTIONS,
  MATRIX_PRODUCT_BEHAVIORS,
  MATRIX_REPETITIONS,
  MATRIX_ROUTES,
  MATRIX_VIEWPORTS,
  aggregateMatrixCoverage,
  canonicalMatrixCell,
  createMatrixAttemptNormalizer,
  validateFailureEvidence,
} from "../scripts/responsive-matrix-contract.mjs";

const startedAt = "2026-07-22T03:00:00.000Z";
const finishedAt = "2026-07-22T03:00:00.025Z";

function layouts(value = true) {
  return Object.fromEntries(MATRIX_LAYOUT_ASSERTIONS.map((key) => [key, value]));
}

function assertions(route, value = true) {
  return MATRIX_PRODUCT_BEHAVIORS[route].map((behavior) => ({
    stepOrder: 1,
    behavior,
    passed: value,
  }));
}

function attempt(overrides = {}) {
  const route = overrides.route ?? "/map";
  const viewport = overrides.viewport ?? "390x844";
  const outcome = overrides.outcome ?? "passed";
  return {
    ownership: "matrix",
    runId: "matrix-run-001",
    profileType: "shared",
    profileId: "shared-profile-1",
    repetition: 1,
    route,
    viewport,
    cell: canonicalMatrixCell(route, viewport),
    browserObserved: true,
    startedAt,
    finishedAt,
    durationMs: 25,
    cellLimitMs: 30_000,
    steps: [{
      order: 1,
      name: `observe:${route}@${viewport}`,
      startedAt,
      finishedAt,
      elapsedMs: 25,
      timeoutMs: 8_000,
      outcome,
    }],
    productAssertions: assertions(route),
    layoutAssertions: layouts(),
    outcome,
    ...overrides,
  };
}

test("normalizes one browser-observed, timed, assertion-bearing attempt", () => {
  const normalized = createMatrixAttemptNormalizer()(attempt());

  assert.equal(normalized.cell, "/map@390x844");
  assert.equal(normalized.profileId, "shared-profile-1");
  assert.equal(normalized.repetition, 1);
  assert.equal(normalized.durationMs, 25);
  assert.equal(normalized.steps[0].timeoutMs, 8_000);
  assert(Object.isFrozen(normalized));
  assert(Object.isFrozen(normalized.steps));
  assert(Object.isFrozen(normalized.layoutAssertions));
});

test("rejects fabricated dimensions, repetitions, observations, and timing", () => {
  const invalidCases = [
    { ownership: "PR" },
    { profileType: "shared-sequential" },
    { profileId: "" },
    { repetition: 4 },
    { route: "/admin" },
    { viewport: "1440x900" },
    { browserObserved: false },
    { durationMs: 30_001 },
    { finishedAt: "not-a-date" },
    { steps: [] },
    {
      steps: [{
        order: 2,
        name: "wrong",
        startedAt,
        finishedAt,
        elapsedMs: 1,
        timeoutMs: 1,
        outcome: "passed",
      }],
    },
  ];
  for (const overrides of invalidCases) {
    assert.throws(
      () => createMatrixAttemptNormalizer()(attempt(overrides)),
      /Invalid matrix attempt/,
    );
  }
});

test("requires exact product and layout assertions with consistent outcomes", () => {
  assert.throws(
    () => createMatrixAttemptNormalizer()(attempt({
      productAssertions: assertions("/map").slice(1),
    })),
    /must attest configured behaviors/,
  );
  assert.throws(
    () => createMatrixAttemptNormalizer()(attempt({
      layoutAssertions: { ...layouts(), invented: true },
    })),
    /must contain exactly/,
  );
  assert.throws(
    () => createMatrixAttemptNormalizer()(attempt({
      productAssertions: assertions("/map", false),
    })),
    /passed outcome requires every/,
  );
  assert.throws(
    () => createMatrixAttemptNormalizer()(attempt({
      outcome: "failed",
      steps: [{
        order: 1,
        name: "observe",
        startedAt,
        finishedAt,
        elapsedMs: 25,
        timeoutMs: 8_000,
        outcome: "passed",
      }],
      diagnostics: {
        log: "failure.log.json",
        dom: "failure.dom.html",
        screenshot: "failure.png",
      },
    })),
    /failed outcome must identify/,
  );
});

test("requires linked diagnostics only for failed attempts", () => {
  assert.throws(
    () => createMatrixAttemptNormalizer()(attempt({
      diagnostics: {
        log: "failure.log.json",
        dom: "failure.dom.html",
        screenshot: "failure.png",
      },
    })),
    /passed attempts must not claim/,
  );
  assert.throws(
    () => createMatrixAttemptNormalizer()(attempt({
      outcome: "failed",
      steps: [{
        order: 1,
        name: "observe",
        startedAt,
        finishedAt,
        elapsedMs: 25,
        timeoutMs: 8_000,
        outcome: "failed",
      }],
    })),
    /failed attempts must link diagnostics/,
  );
});

function completeMatrix() {
  const records = [];
  let serial = 0;
  for (const route of MATRIX_ROUTES) {
    for (const viewport of MATRIX_VIEWPORTS) {
      for (const profileType of ["shared", "fresh"]) {
        for (const repetition of MATRIX_REPETITIONS) {
          serial += 1;
          records.push(attempt({
            runId: `coverage-${serial}`,
            route,
            viewport,
            cell: canonicalMatrixCell(route, viewport),
            profileType,
            profileId: profileType === "shared"
              ? `shared-profile-${repetition}`
              : `fresh-profile-${serial}`,
            repetition,
            productAssertions: assertions(route),
          }));
        }
      }
    }
  }
  return records;
}

test("aggregates exactly 168 attempts with shared reuse and fresh isolation", () => {
  const coverage = aggregateMatrixCoverage(completeMatrix());

  assert.deepEqual(coverage, {
    records: 168,
    cells: 28,
    attemptsPerCell: 6,
    profilesPerCell: { shared: 3, fresh: 3 },
    sharedProfiles: 3,
    freshProfiles: 84,
    passed: 168,
    failed: 0,
    maxDurationMs: 25,
  });
  assert(Object.isFrozen(coverage));
});

test("rejects incomplete, duplicate, and incorrectly scoped profiles", () => {
  const incomplete = completeMatrix();
  incomplete.pop();
  assert.throws(() => aggregateMatrixCoverage(incomplete), /exactly 168 records/);

  const duplicateTuple = completeMatrix();
  duplicateTuple[1] = {
    ...duplicateTuple[0],
    runId: "duplicate-tuple-but-unique-run",
  };
  assert.throws(() => aggregateMatrixCoverage(duplicateTuple), /duplicate route\/viewport/);

  const splitSharedProfile = completeMatrix();
  splitSharedProfile[0] = {
    ...splitSharedProfile[0],
    profileId: "wrong-shared-profile",
  };
  assert.throws(() => aggregateMatrixCoverage(splitSharedProfile), /reuse exactly one profile/);

  const reusedFreshProfile = completeMatrix();
  const freshIndexes = reusedFreshProfile
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.profileType === "fresh");
  reusedFreshProfile[freshIndexes[1].index] = {
    ...reusedFreshProfile[freshIndexes[1].index],
    profileId: freshIndexes[0].record.profileId,
  };
  assert.throws(() => aggregateMatrixCoverage(reusedFreshProfile), /fresh profileId must be unique/);
});

function failedAttempt() {
  const productAssertions = assertions("/map");
  productAssertions[0] = { ...productAssertions[0], passed: false };
  return createMatrixAttemptNormalizer()(attempt({
    runId: "failed-run-001",
    profileType: "fresh",
    profileId: "failed-profile",
    repetition: 2,
    outcome: "failed",
    steps: [{
      order: 1,
      name: "observe",
      startedAt,
      finishedAt,
      elapsedMs: 25,
      timeoutMs: 8_000,
      outcome: "failed",
    }],
    productAssertions,
    diagnostics: {
      log: "failure.log.json",
      dom: "failure.dom.html",
      screenshot: "failure.png",
    },
  }));
}

function evidence(metadataOverrides = {}) {
  const metadata = {
    runId: "failed-run-001",
    cell: "/map@390x844",
    profileType: "fresh",
    repetition: 2,
    stepOrder: 1,
    assertion: "recorded-fact-connection-distinguished",
    ...metadataOverrides,
  };
  return ["log", "dom", "screenshot"].map((type) => ({
    type,
    path: `artifacts/failed-run-001/${type}`,
    metadata,
  }));
}

test("links log, DOM, and screenshot to every failed assertion identity", () => {
  assert.deepEqual(validateFailureEvidence([failedAttempt()], evidence()), {
    failedAssertions: 1,
    artifacts: 3,
    requiredTypes: ["log", "dom", "screenshot"],
  });
  assert.throws(
    () => validateFailureEvidence([failedAttempt()], evidence().slice(0, 2)),
    /missing: screenshot/,
  );
  for (const mismatch of [
    { runId: "another-run" },
    { profileType: "shared" },
    { repetition: 1 },
    { stepOrder: 2 },
    { assertion: "patient-context-preserved" },
  ]) {
    assert.throws(
      () => validateFailureEvidence([failedAttempt()], evidence(mismatch)),
      /orphaned or mismatched/,
    );
  }
});
