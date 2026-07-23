export const MATRIX_ROUTES = Object.freeze([
  "/",
  "/patient",
  "/map",
  "/connections",
  "/insights",
  "/journey",
  "/emr",
]);

export const MATRIX_VIEWPORTS = Object.freeze([
  "390x844",
  "768x1024",
  "1280x800",
  "1600x900",
]);

export const MATRIX_PROFILE_TYPES = Object.freeze(["shared", "fresh"]);
export const MATRIX_REPETITIONS = Object.freeze([1, 2, 3]);
export const MATRIX_CELL_LIMIT_MS = 30_000;

export const MATRIX_PRODUCT_BEHAVIORS = Object.freeze({
  "/": Object.freeze(["role-boundary-understood", "primary-role-choice-reachable"]),
  "/patient": Object.freeze(["local-storage-understood", "journey-data-preserved"]),
  "/map": Object.freeze(["recorded-fact-connection-distinguished", "patient-context-preserved"]),
  "/connections": Object.freeze(["connection-evidence-understood", "patient-context-preserved"]),
  "/insights": Object.freeze(["insight-source-understood", "patient-context-preserved"]),
  "/journey": Object.freeze(["journey-change-understood", "journey-data-preserved"]),
  "/emr": Object.freeze(["patient-encounter-context-preserved", "sign-review-complete"]),
});

export const MATRIX_LAYOUT_ASSERTIONS = Object.freeze([
  "routeLoaded",
  "expectedRegionsPresent",
  "semanticOrderPreserved",
  "controlsReachable",
  "noHorizontalOverflow",
]);

const routeSet = new Set(MATRIX_ROUTES);
const viewportSet = new Set(MATRIX_VIEWPORTS);
const profileTypeSet = new Set(MATRIX_PROFILE_TYPES);
const repetitionSet = new Set(MATRIX_REPETITIONS);
const outcomeSet = new Set(["passed", "failed"]);

function fail(message) {
  throw new TypeError(`Invalid matrix attempt: ${message}`);
}

function failCoverage(message) {
  throw new TypeError(`Invalid matrix coverage: ${message}`);
}

function failEvidence(message) {
  throw new TypeError(`Invalid failure evidence: ${message}`);
}

function requireNonemptyString(value, field, failWith = fail) {
  if (typeof value !== "string" || value.trim() === "") {
    failWith(`${field} must be a nonempty string`);
  }
  return value.trim();
}

function requireFiniteNumber(value, field, {
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
  failWith = fail,
} = {}) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    failWith(`${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function requireTimestamp(value, field) {
  const timestamp = requireNonemptyString(value, field);
  if (!Number.isFinite(Date.parse(timestamp))) fail(`${field} must be an ISO-compatible timestamp`);
  return timestamp;
}

function normalizeSteps(steps, cellLimitMs) {
  if (!Array.isArray(steps) || steps.length === 0) {
    fail("steps must be a nonempty ordered array");
  }

  return Object.freeze(steps.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      fail(`steps[${index}] must be an object`);
    }
    if (step.order !== index + 1) {
      fail(`steps[${index}].order must be ${index + 1}`);
    }
    const name = requireNonemptyString(step.name, `steps[${index}].name`);
    const startedAt = requireTimestamp(step.startedAt, `steps[${index}].startedAt`);
    const finishedAt = requireTimestamp(step.finishedAt, `steps[${index}].finishedAt`);
    if (Date.parse(finishedAt) < Date.parse(startedAt)) {
      fail(`steps[${index}].finishedAt must not precede startedAt`);
    }
    const elapsedMs = requireFiniteNumber(step.elapsedMs, `steps[${index}].elapsedMs`, {
      maximum: cellLimitMs,
    });
    const timeoutMs = requireFiniteNumber(step.timeoutMs, `steps[${index}].timeoutMs`, {
      minimum: 1,
      maximum: cellLimitMs,
    });
    if (!outcomeSet.has(step.outcome)) {
      fail(`steps[${index}].outcome must be passed or failed`);
    }
    return Object.freeze({
      ...step,
      order: index + 1,
      name,
      startedAt,
      finishedAt,
      elapsedMs,
      timeoutMs,
      outcome: step.outcome,
    });
  }));
}

function normalizeProductAssertions(assertions, route, steps) {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    fail("productAssertions must be a nonempty array");
  }

  const configuredBehaviors = new Set(MATRIX_PRODUCT_BEHAVIORS[route]);
  const assertedBehaviors = new Set();
  const normalized = assertions.map((assertion, index) => {
    if (!assertion || typeof assertion !== "object" || Array.isArray(assertion)) {
      fail(`productAssertions[${index}] must be an object`);
    }
    if (!Number.isInteger(assertion.stepOrder) || !steps[assertion.stepOrder - 1]) {
      fail(`productAssertions[${index}].stepOrder must identify an executed step`);
    }
    const behavior = requireNonemptyString(
      assertion.behavior,
      `productAssertions[${index}].behavior`,
    );
    if (!configuredBehaviors.has(behavior)) {
      fail(`productAssertions[${index}].behavior is not configured for ${route}: ${behavior}`);
    }
    if (assertedBehaviors.has(behavior)) {
      fail(`productAssertions must identify behavior exactly once: ${behavior}`);
    }
    if (typeof assertion.passed !== "boolean") {
      fail(`productAssertions[${index}].passed must be a boolean outcome`);
    }
    assertedBehaviors.add(behavior);
    return Object.freeze({
      stepOrder: assertion.stepOrder,
      behavior,
      passed: assertion.passed,
    });
  });

  const missingBehaviors = [...configuredBehaviors].filter(
    (behavior) => !assertedBehaviors.has(behavior),
  );
  if (missingBehaviors.length > 0) {
    fail(`productAssertions must attest configured behaviors for ${route}: ${missingBehaviors.join(", ")}`);
  }
  return Object.freeze(normalized);
}

function normalizeLayoutAssertions(assertions) {
  if (!assertions || typeof assertions !== "object" || Array.isArray(assertions)) {
    fail("layoutAssertions must be an object");
  }
  const keys = Object.keys(assertions).sort();
  const expected = [...MATRIX_LAYOUT_ASSERTIONS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    fail(`layoutAssertions must contain exactly: ${MATRIX_LAYOUT_ASSERTIONS.join(", ")}`);
  }
  const normalized = {};
  for (const key of MATRIX_LAYOUT_ASSERTIONS) {
    if (typeof assertions[key] !== "boolean") {
      fail(`layoutAssertions.${key} must be a boolean outcome`);
    }
    normalized[key] = assertions[key];
  }
  return Object.freeze(normalized);
}

function normalizeDiagnostics(diagnostics, outcome) {
  if (outcome === "passed") {
    if (diagnostics !== undefined && diagnostics !== null) {
      fail("passed attempts must not claim failure diagnostics");
    }
    return undefined;
  }
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) {
    fail("failed attempts must link diagnostics");
  }
  const normalized = {};
  for (const type of ["log", "dom", "screenshot"]) {
    normalized[type] = requireNonemptyString(diagnostics[type], `diagnostics.${type}`);
  }
  return Object.freeze(normalized);
}

export function canonicalMatrixCell(route, viewport) {
  if (!routeSet.has(route)) fail(`route is not configured: ${String(route)}`);
  if (!viewportSet.has(viewport)) fail(`viewport is not configured: ${String(viewport)}`);
  return `${route}@${viewport}`;
}

export function createMatrixAttemptNormalizer() {
  const runIds = new Set();

  return function normalizeMatrixAttemptRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      fail("record must be an object");
    }
    if (record.ownership !== "matrix") fail('ownership must be "matrix"');

    const runId = requireNonemptyString(record.runId, "runId");
    if (runIds.has(runId)) fail(`runId must be globally unique: ${runId}`);
    if (!profileTypeSet.has(record.profileType)) {
      fail(`profileType must be one of: ${MATRIX_PROFILE_TYPES.join(", ")}`);
    }
    const profileId = requireNonemptyString(record.profileId, "profileId");
    if (!repetitionSet.has(record.repetition)) {
      fail(`repetition must be one of: ${MATRIX_REPETITIONS.join(", ")}`);
    }
    if (!routeSet.has(record.route)) fail(`route is not configured: ${String(record.route)}`);
    if (!viewportSet.has(record.viewport)) {
      fail(`viewport is not configured: ${String(record.viewport)}`);
    }
    if (record.browserObserved !== true) fail("browserObserved must be true");
    if (!outcomeSet.has(record.outcome)) fail("outcome must be passed or failed");

    const cellLimitMs = requireFiniteNumber(record.cellLimitMs, "cellLimitMs", {
      minimum: 1,
      maximum: MATRIX_CELL_LIMIT_MS,
    });
    const startedAt = requireTimestamp(record.startedAt, "startedAt");
    const finishedAt = requireTimestamp(record.finishedAt, "finishedAt");
    if (Date.parse(finishedAt) < Date.parse(startedAt)) {
      fail("finishedAt must not precede startedAt");
    }
    const durationMs = requireFiniteNumber(record.durationMs, "durationMs", {
      maximum: cellLimitMs,
    });
    const steps = normalizeSteps(record.steps, cellLimitMs);
    const productAssertions = normalizeProductAssertions(record.productAssertions, record.route, steps);
    const layoutAssertions = normalizeLayoutAssertions(record.layoutAssertions);
    const diagnostics = normalizeDiagnostics(record.diagnostics, record.outcome);
    const cell = canonicalMatrixCell(record.route, record.viewport);
    if (record.cell !== undefined && record.cell !== cell) fail(`cell must be ${cell}`);

    const allAssertionsPassed = productAssertions.every(({ passed }) => passed)
      && Object.values(layoutAssertions).every(Boolean)
      && steps.every(({ outcome }) => outcome === "passed");
    if (record.outcome === "passed" && !allAssertionsPassed) {
      fail("passed outcome requires every step, product assertion, and layout assertion to pass");
    }
    if (record.outcome === "failed" && allAssertionsPassed) {
      fail("failed outcome must identify a failed step or assertion");
    }
    runIds.add(runId);

    return Object.freeze({
      ...record,
      ownership: "matrix",
      runId,
      profileType: record.profileType,
      profileId,
      repetition: record.repetition,
      route: record.route,
      viewport: record.viewport,
      cell,
      browserObserved: true,
      cellLimitMs,
      startedAt,
      finishedAt,
      durationMs,
      steps,
      productAssertions,
      layoutAssertions,
      outcome: record.outcome,
      ...(diagnostics ? { diagnostics } : {}),
    });
  };
}

export const normalizeMatrixAttemptRecord = createMatrixAttemptNormalizer();

function tupleKey(record) {
  return JSON.stringify([
    record.route,
    record.viewport,
    record.profileType,
    record.repetition,
  ]);
}

function failedAssertionIdentities(record) {
  const identities = record.productAssertions
    .filter(({ passed }) => !passed)
    .map(({ stepOrder, behavior }) => ({ stepOrder, assertion: behavior }));
  const fallbackStep = record.steps.find(({ outcome }) => outcome === "failed")?.order
    ?? record.steps.at(-1).order;
  for (const key of MATRIX_LAYOUT_ASSERTIONS) {
    if (!record.layoutAssertions[key]) {
      identities.push({ stepOrder: fallbackStep, assertion: `layout:${key}` });
    }
  }
  if (identities.length === 0) {
    identities.push({ stepOrder: fallbackStep, assertion: "step-execution" });
  }
  return identities;
}

export function aggregateMatrixCoverage(records, artifacts = []) {
  if (!Array.isArray(records)) failCoverage("records must be an array");
  if (records.length !== 168) {
    failCoverage(`expected exactly 168 records; received ${records.length}`);
  }

  let normalized;
  try {
    const normalize = createMatrixAttemptNormalizer();
    normalized = records.map((record) => normalize(record));
  } catch (error) {
    failCoverage(error.message);
  }

  const tupleKeys = new Set();
  const cells = new Map();
  const sharedProfilesByRepetition = new Map();
  const freshProfileIds = new Set();
  for (const record of normalized) {
    const tuple = tupleKey(record);
    if (tupleKeys.has(tuple)) failCoverage(`duplicate route/viewport/profile/repetition tuple: ${tuple}`);
    tupleKeys.add(tuple);

    const cell = cells.get(record.cell) ?? { shared: [], fresh: [] };
    cell[record.profileType].push(record);
    cells.set(record.cell, cell);
    if (record.profileType === "shared") {
      const profiles = sharedProfilesByRepetition.get(record.repetition) ?? new Set();
      profiles.add(record.profileId);
      sharedProfilesByRepetition.set(record.repetition, profiles);
    } else {
      if (freshProfileIds.has(record.profileId)) {
        failCoverage(`fresh profileId must be unique to one attempt: ${record.profileId}`);
      }
      freshProfileIds.add(record.profileId);
    }
  }

  if (cells.size !== 28) {
    failCoverage(`expected exactly 28 route-viewport cells; received ${cells.size}`);
  }
  for (const route of MATRIX_ROUTES) {
    for (const viewport of MATRIX_VIEWPORTS) {
      const cellKey = canonicalMatrixCell(route, viewport);
      const cell = cells.get(cellKey);
      if (!cell) failCoverage(`missing route-viewport cell: ${cellKey}`);
      if (cell.shared.length !== 3 || cell.fresh.length !== 3) {
        failCoverage(
          `${cellKey} must contain exactly 3 shared and 3 fresh attempts; `
          + `received ${cell.shared.length} shared and ${cell.fresh.length} fresh`,
        );
      }
      for (const profileType of MATRIX_PROFILE_TYPES) {
        const repetitions = cell[profileType].map(({ repetition }) => repetition).sort();
        if (JSON.stringify(repetitions) !== JSON.stringify(MATRIX_REPETITIONS)) {
          failCoverage(`${cellKey}/${profileType} must contain repetitions 1, 2, and 3 exactly once`);
        }
      }
    }
  }
  for (const repetition of MATRIX_REPETITIONS) {
    const profiles = sharedProfilesByRepetition.get(repetition);
    if (!profiles || profiles.size !== 1) {
      failCoverage(`shared repetition ${repetition} must reuse exactly one profile across all 28 cells`);
    }
  }
  if (freshProfileIds.size !== 84) {
    failCoverage(`expected 84 unique fresh profiles; received ${freshProfileIds.size}`);
  }

  const failed = normalized.filter(({ outcome }) => outcome === "failed");
  if (failed.length > 0) validateFailureEvidence(normalized, artifacts);
  else if (artifacts.length > 0) validateFailureEvidence(normalized, artifacts);

  return Object.freeze({
    records: normalized.length,
    cells: cells.size,
    attemptsPerCell: 6,
    profilesPerCell: Object.freeze({ shared: 3, fresh: 3 }),
    sharedProfiles: 3,
    freshProfiles: freshProfileIds.size,
    passed: normalized.length - failed.length,
    failed: failed.length,
    maxDurationMs: Math.max(...normalized.map(({ durationMs }) => durationMs)),
  });
}

const FAILURE_EVIDENCE_TYPES = Object.freeze(["log", "dom", "screenshot"]);

function failureKey({ runId, cell, profileType, repetition, stepOrder, assertion }) {
  return JSON.stringify([runId, cell, profileType, repetition, stepOrder, assertion]);
}

export function validateFailureEvidence(records, artifacts) {
  if (!Array.isArray(records)) failEvidence("records must be an array");
  if (!Array.isArray(artifacts)) failEvidence("artifacts must be an array");

  const failures = new Map();
  for (const [recordIndex, record] of records.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      failEvidence(`records[${recordIndex}] must be a canonical attempt record`);
    }
    const expectedCell = canonicalMatrixCell(record.route, record.viewport);
    if (record.cell !== expectedCell) {
      failEvidence(`records[${recordIndex}].cell must be ${expectedCell}`);
    }
    if (record.outcome !== "failed") continue;
    for (const identityPart of failedAssertionIdentities(record)) {
      const identity = {
        runId: requireNonemptyString(
          record.runId,
          `records[${recordIndex}].runId`,
          failEvidence,
        ),
        cell: expectedCell,
        profileType: record.profileType,
        repetition: record.repetition,
        ...identityPart,
      };
      const key = failureKey(identity);
      if (failures.has(key)) failEvidence(`duplicate failed assertion ${key}`);
      failures.set(key, { ...identity, types: new Set() });
    }
  }

  for (const [artifactIndex, artifact] of artifacts.entries()) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      failEvidence(`artifacts[${artifactIndex}] must be an object`);
    }
    if (!FAILURE_EVIDENCE_TYPES.includes(artifact.type)) {
      failEvidence(`artifacts[${artifactIndex}].type must be log, dom, or screenshot`);
    }
    requireNonemptyString(artifact.path, `artifacts[${artifactIndex}].path`, failEvidence);
    const metadata = artifact.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      failEvidence(`artifacts[${artifactIndex}].metadata must be an object`);
    }
    const identity = {
      runId: requireNonemptyString(metadata.runId, `artifacts[${artifactIndex}].metadata.runId`, failEvidence),
      cell: requireNonemptyString(metadata.cell, `artifacts[${artifactIndex}].metadata.cell`, failEvidence),
      profileType: requireNonemptyString(
        metadata.profileType,
        `artifacts[${artifactIndex}].metadata.profileType`,
        failEvidence,
      ),
      repetition: metadata.repetition,
      stepOrder: metadata.stepOrder,
      assertion: requireNonemptyString(
        metadata.assertion,
        `artifacts[${artifactIndex}].metadata.assertion`,
        failEvidence,
      ),
    };
    if (!repetitionSet.has(identity.repetition)) {
      failEvidence(`artifacts[${artifactIndex}].metadata.repetition must be 1, 2, or 3`);
    }
    if (!Number.isInteger(identity.stepOrder) || identity.stepOrder < 1) {
      failEvidence(`artifacts[${artifactIndex}].metadata.stepOrder must be a positive integer`);
    }
    const key = failureKey(identity);
    const failure = failures.get(key);
    if (!failure) failEvidence(`orphaned or mismatched ${artifact.type} artifact ${artifact.path}`);
    if (failure.types.has(artifact.type)) {
      failEvidence(`duplicate ${artifact.type} artifact for failed assertion ${key}`);
    }
    failure.types.add(artifact.type);
  }

  for (const [key, failure] of failures) {
    const missing = FAILURE_EVIDENCE_TYPES.filter((type) => !failure.types.has(type));
    if (missing.length > 0) {
      failEvidence(`failed assertion ${key} is missing: ${missing.join(", ")}`);
    }
  }
  if (failures.size === 0 && artifacts.length > 0) {
    failEvidence("passing records must not have failure evidence");
  }

  return Object.freeze({
    failedAssertions: failures.size,
    artifacts: artifacts.length,
    requiredTypes: FAILURE_EVIDENCE_TYPES,
  });
}
