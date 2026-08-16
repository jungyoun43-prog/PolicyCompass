import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  SmokeTimeoutError,
  runBrowserSmoke,
  startManagedAppServer,
  terminateActiveBrowsers,
  withTimeout,
  writeSmokeReport,
} from "./browser-smoke-harness.mjs";
import {
  MATRIX_CELL_LIMIT_MS,
  MATRIX_LAYOUT_ASSERTIONS,
  MATRIX_PRODUCT_BEHAVIORS,
  MATRIX_REPETITIONS,
  MATRIX_ROUTES,
  MATRIX_VIEWPORTS,
  aggregateMatrixCoverage,
  canonicalMatrixCell,
  createMatrixAttemptNormalizer,
} from "./responsive-matrix-contract.mjs";
import {
  RESPONSIVE_VIEWPORTS,
  initializeBrowserProfile,
  observeResponsiveRoute,
  runResponsiveSequence,
} from "./responsive-sequence-smoke.mjs";

const viewportByName = new Map(RESPONSIVE_VIEWPORTS.map((viewport) => [viewport.name, viewport]));
const attemptsPerProfileType = MATRIX_ROUTES.length * MATRIX_VIEWPORTS.length * MATRIX_REPETITIONS.length;

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function quantile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index];
}

export function calculateReleaseSchedule({
  p95CellMs,
  p95StartupArtifactMs,
  shardCount,
  configuredCellLimitMs = MATRIX_CELL_LIMIT_MS,
  configuredStepTimeoutMs = 8_000,
}) {
  const adjustedCellCapMs = Math.min(
    configuredCellLimitMs,
    Math.max(10_000, Math.ceil((p95CellMs * 3) / 1_000) * 1_000),
  );
  const stepTimeoutMs = Math.min(configuredStepTimeoutMs, adjustedCellCapMs);
  const hardKillMs = Math.ceil((
    (attemptsPerProfileType + Math.ceil(attemptsPerProfileType / shardCount)) * adjustedCellCapMs
    + p95StartupArtifactMs
  ) * 1.2);
  return Object.freeze({
    shardCount,
    configuredCellLimitMs,
    adjustedCellCapMs,
    stepTimeoutMs,
    hardKillMs,
    hardKillFormula: "ceil(((84 + ceil(84 / S)) * adjustedCellCapMs + p95StartupArtifactMs) * 1.2)",
    p95StartupArtifactMs,
  });
}

function routeSlug(route) {
  return route === "/" ? "gateway" : route.slice(1).replaceAll("/", "-");
}

function attemptRunId(releaseRunId, profileType, repetition, route, viewport) {
  return [
    releaseRunId,
    profileType,
    repetition,
    routeSlug(route),
    viewport.replace("x", "by"),
  ].join("-");
}

function allLayoutAssertions(value) {
  return Object.fromEntries(MATRIX_LAYOUT_ASSERTIONS.map((key) => [key, value]));
}

function failedAssertionIdentities(record) {
  const failures = record.productAssertions
    .filter(({ passed }) => !passed)
    .map(({ stepOrder, behavior }) => ({ stepOrder, assertion: behavior }));
  for (const key of MATRIX_LAYOUT_ASSERTIONS) {
    if (!record.layoutAssertions[key]) {
      failures.push({ stepOrder: record.steps.at(-1).order, assertion: `layout:${key}` });
    }
  }
  if (failures.length === 0) {
    failures.push({ stepOrder: record.steps.at(-1).order, assertion: "step-execution" });
  }
  return failures;
}

async function fallbackDiagnostics(root, metadata, error) {
  await mkdir(root, { recursive: true });
  const paths = {
    log: join(root, "failure.log.json"),
    dom: join(root, "failure.dom.html"),
    screenshot: join(root, "failure.png"),
  };
  await Promise.all([
    writeFile(paths.log, `${JSON.stringify({
      ...metadata,
      error: { name: error.name, message: error.message, stack: error.stack },
    }, null, 2)}\n`, "utf8"),
    writeFile(paths.dom, `<!-- Browser diagnostics unavailable: ${error.message} -->`, "utf8"),
    writeFile(paths.screenshot, Buffer.alloc(0)),
  ]);
  return {
    paths,
    artifacts: [
      { type: "log", path: paths.log, metadata },
      { type: "dom", path: paths.dom, metadata },
      { type: "screenshot", path: paths.screenshot, metadata },
    ],
  };
}

function evidenceForRecord(record, bundle) {
  return failedAssertionIdentities(record).flatMap(({ stepOrder, assertion }) => (
    bundle.artifacts.map(({ type, path }) => ({
      type,
      path,
      metadata: {
        runId: record.runId,
        cell: record.cell,
        profileType: record.profileType,
        repetition: record.repetition,
        stepOrder,
        assertion,
      },
    }))
  ));
}

async function executeAttempt(api, {
  releaseRunId,
  artifactRoot,
  profileType,
  profileId,
  repetition,
  route,
  viewport,
  cellLimitMs,
  stepTimeoutMs,
  ownership = "matrix",
}) {
  const runId = attemptRunId(releaseRunId, profileType, repetition, route, viewport);
  const cell = canonicalMatrixCell(route, viewport);
  const attemptRoot = join(
    artifactRoot,
    releaseRunId,
    ownership === "matrix" ? "matrix" : "pilot",
    profileType,
    String(repetition),
    `${routeSlug(route)}@${viewport}`,
  );
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let observed;
  let executionError;
  try {
    observed = await api.step(
      `observe:${cell}`,
      () => observeResponsiveRoute(api, {
        route,
        viewport: viewportByName.get(viewport),
        profileId,
      }),
      { timeoutMs: Math.min(stepTimeoutMs, cellLimitMs) },
    );
  } catch (error) {
    executionError = error;
  }
  const finishedAt = new Date().toISOString();
  const durationMs = Math.min(
    Math.round(performance.now() - started),
    cellLimitMs,
  );
  const browserStep = api.stepRecords.at(-1) ?? {
    order: 1,
    name: `observe:${cell}`,
    startedAt,
    finishedAt,
    elapsedMs: durationMs,
    timeoutMs: Math.min(stepTimeoutMs, cellLimitMs),
    outcome: executionError ? "failed" : "passed",
  };
  const productAssertions = observed
    ? observed.productAssertions.map((assertion) => ({ ...assertion, stepOrder: 1 }))
    : MATRIX_PRODUCT_BEHAVIORS[route].map((behavior) => ({
      stepOrder: 1,
      behavior,
      passed: false,
    }));
  const layoutAssertions = observed?.layoutAssertions ?? allLayoutAssertions(false);
  const allPassed = !executionError
    && productAssertions.every(({ passed }) => passed)
    && Object.values(layoutAssertions).every(Boolean);
  const outcome = allPassed ? "passed" : "failed";
  const record = {
    ownership: "matrix",
    runId,
    profileType,
    profileId,
    repetition,
    route,
    viewport,
    cell,
    browserObserved: true,
    startedAt,
    finishedAt,
    durationMs,
    cellLimitMs,
    steps: [{
      order: 1,
      name: browserStep.name,
      startedAt: browserStep.startedAt,
      finishedAt: browserStep.finishedAt,
      elapsedMs: Math.min(browserStep.elapsedMs, cellLimitMs),
      timeoutMs: Math.min(browserStep.timeoutMs, cellLimitMs),
      outcome: allPassed ? "passed" : "failed",
      ...(executionError ? { error: executionError.message } : {}),
    }],
    productAssertions,
    layoutAssertions,
    outcome,
    ...(executionError ? { failureKind: executionError.name } : {}),
  };

  let evidence = [];
  let artifactElapsedMs = 0;
  if (outcome === "failed") {
    const diagnosticStarted = performance.now();
    const metadata = {
      runId,
      cell,
      profileType,
      profileId,
      repetition,
      route,
      viewport,
      step: record.steps[0],
    };
    const reason = executionError ?? new Error(
      `Browser assertions failed: ${failedAssertionIdentities(record)
        .map(({ assertion }) => assertion)
        .join(", ")}`,
    );
    let bundle;
    try {
      bundle = await api.captureDiagnostics(attemptRoot, metadata, reason);
    } catch {
      bundle = await fallbackDiagnostics(attemptRoot, metadata, reason);
    }
    artifactElapsedMs = Math.round(performance.now() - diagnosticStarted);
    record.diagnostics = {
      log: bundle.paths.log,
      dom: bundle.paths.dom,
      screenshot: bundle.paths.screenshot,
    };
    evidence = evidenceForRecord(record, bundle);
  }
  await writeSmokeReport(join(attemptRoot, "attempt.json"), record);
  return { record, evidence, artifactElapsedMs };
}

async function runFreshAttempt(options) {
  const sessionStarted = performance.now();
  let result;
  await runBrowserSmoke({
    appUrl: options.appUrl,
    debugPort: 0,
    profilePrefix: "vitagraph-release-fresh-",
    initialViewport: viewportByName.get(options.viewport),
    cdpTimeoutMs: Math.min(options.stepTimeoutMs, 8_000),
    stepTimeoutMs: options.stepTimeoutMs,
    attemptTimeoutMs: options.cellLimitMs + 12_000,
    diagnosticRoot: join(
      options.artifactRoot,
      options.releaseRunId,
      options.ownership === "matrix" ? "matrix-session-failures" : "pilot-session-failures",
      options.profileId,
    ),
    diagnosticMetadata: {
      releaseRunId: options.releaseRunId,
      profileType: "fresh",
      profileId: options.profileId,
    },
    signal: options.signal,
  }, async (api) => {
    await api.step(
      "initialize-profile",
      () => initializeBrowserProfile(api, options.profileId),
      { timeoutMs: options.stepTimeoutMs },
    );
    result = await executeAttempt(api, options);
  });
  return {
    ...result,
    sessionElapsedMs: Math.round(performance.now() - sessionStarted),
  };
}

async function runSharedRepetition(options) {
  const results = [];
  try {
    await runBrowserSmoke({
      appUrl: options.appUrl,
      debugPort: 0,
      profilePrefix: `vitagraph-release-shared-${options.repetition}-`,
      initialViewport: RESPONSIVE_VIEWPORTS[0],
      cdpTimeoutMs: Math.min(options.stepTimeoutMs, 8_000),
      stepTimeoutMs: options.stepTimeoutMs,
      attemptTimeoutMs: options.cellLimitMs * 28 + 30_000,
      diagnosticRoot: join(
        options.artifactRoot,
        options.releaseRunId,
        "matrix-session-failures",
        options.profileId,
      ),
      diagnosticMetadata: {
        releaseRunId: options.releaseRunId,
        profileType: "shared",
        profileId: options.profileId,
        repetition: options.repetition,
      },
      signal: options.signal,
    }, async (api) => {
      await api.step(
        "initialize-shared-profile",
        () => initializeBrowserProfile(api, options.profileId),
        { timeoutMs: options.stepTimeoutMs },
      );
      for (const route of MATRIX_ROUTES) {
        for (const viewport of MATRIX_VIEWPORTS) {
          results.push(await executeAttempt(api, {
            ...options,
            profileType: "shared",
            route,
            viewport,
            ownership: "matrix",
          }));
        }
      }
    });
  } catch (error) {
    error.partialResults = results;
    throw error;
  }
  return results;
}

async function runTaskPool(tasks, concurrency, signal) {
  const results = new Array(tasks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      if (signal.aborted) return;
      const index = nextIndex;
      nextIndex += 1;
      const task = tasks[index];
      try {
        results[index] = {
          status: "fulfilled",
          id: task.id,
          value: await task.run(),
        };
      } catch (error) {
        results[index] = {
          status: "rejected",
          id: task.id,
          diagnosticRoot: task.diagnosticRoot,
          partialResults: error.partialResults ?? [],
          error: { name: error.name, message: error.message },
        };
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  ));
  return results;
}

async function runPilot({
  appUrl,
  artifactRoot,
  releaseRunId,
  configuredCellLimitMs,
  stepTimeoutMs,
  signal,
}) {
  const configurations = [
    { route: "/", viewport: "390x844" },
    { route: "/map", viewport: "1280x800" },
    { route: "/emr", viewport: "1600x900" },
  ];
  const samples = [];
  for (const [index, configuration] of configurations.entries()) {
    const result = await runFreshAttempt({
      appUrl,
      artifactRoot,
      releaseRunId: `${releaseRunId}-pilot-${index + 1}`,
      profileType: "fresh",
      profileId: `${releaseRunId}-pilot-profile-${index + 1}`,
      repetition: 1,
      cellLimitMs: configuredCellLimitMs,
      stepTimeoutMs,
      ownership: "pilot",
      signal,
      ...configuration,
    });
    if (result.record.outcome !== "passed") {
      throw new Error(`Release pilot failed at ${configuration.route}@${configuration.viewport}.`);
    }
    samples.push({
      route: configuration.route,
      viewport: configuration.viewport,
      cellMs: result.record.durationMs,
      sessionMs: result.sessionElapsedMs,
      startupArtifactMs: Math.max(
        0,
        result.sessionElapsedMs - result.record.durationMs + result.artifactElapsedMs,
      ),
    });
  }
  const cellDurations = samples.map(({ cellMs }) => cellMs);
  const overheadDurations = samples.map(({ startupArtifactMs }) => startupArtifactMs);
  return {
    samples,
    p50CellMs: quantile(cellDurations, 0.5),
    p95CellMs: quantile(cellDurations, 0.95),
    p50StartupArtifactMs: quantile(overheadDurations, 0.5),
    p95StartupArtifactMs: quantile(overheadDurations, 0.95),
  };
}

function sortAttempts(attempts) {
  const routeOrder = new Map(MATRIX_ROUTES.map((route, index) => [route, index]));
  const viewportOrder = new Map(MATRIX_VIEWPORTS.map((viewport, index) => [viewport, index]));
  return attempts.sort((left, right) => (
    routeOrder.get(left.route) - routeOrder.get(right.route)
    || viewportOrder.get(left.viewport) - viewportOrder.get(right.viewport)
    || left.profileType.localeCompare(right.profileType)
    || left.repetition - right.repetition
  ));
}

export async function runReleaseGate({
  appUrl = process.env.APP_URL?.trim() || "",
  artifactRoot = process.env.RELEASE_GATE_ARTIFACT_ROOT
    ?? join(process.cwd(), "artifacts", "release-gate"),
  runId = process.env.RELEASE_GATE_RUN_ID?.trim() || `release-${randomUUID()}`,
  shardCount = positiveInteger(process.env.RELEASE_GATE_SHARDS, 3, 12),
  configuredCellLimitMs = positiveInteger(
    process.env.RELEASE_GATE_CELL_TIMEOUT_MS,
    MATRIX_CELL_LIMIT_MS,
    MATRIX_CELL_LIMIT_MS,
  ),
  configuredStepTimeoutMs = positiveInteger(
    process.env.RELEASE_GATE_STEP_TIMEOUT_MS,
    MATRIX_CELL_LIMIT_MS,
    MATRIX_CELL_LIMIT_MS,
  ),
} = {}) {
  const runRoot = join(artifactRoot, runId);
  const manifestPath = join(runRoot, "manifest.json");
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let server;
  let pilot;
  let scheduler;
  let attempts = [];
  let evidence = [];
  let taskFailures = [];
  let coverage;
  let canonical;
  await mkdir(runRoot, { recursive: true });

  try {
    server = await startManagedAppServer({ appUrl, healthPath: "/" });
    const releaseController = new AbortController();
    pilot = await runPilot({
      appUrl: server.appUrl,
      artifactRoot,
      releaseRunId: runId,
      configuredCellLimitMs,
      stepTimeoutMs: configuredStepTimeoutMs,
      signal: releaseController.signal,
    });
    scheduler = calculateReleaseSchedule({
      p95CellMs: pilot.p95CellMs,
      p95StartupArtifactMs: pilot.p95StartupArtifactMs,
      shardCount,
      configuredCellLimitMs,
      configuredStepTimeoutMs,
    });
    const { adjustedCellCapMs, stepTimeoutMs, hardKillMs } = scheduler;

    const sharedTasks = [];
    const freshTasks = [];
    for (const repetition of MATRIX_REPETITIONS) {
      const profileId = `${runId}-shared-profile-${repetition}`;
      sharedTasks.push({
        id: `shared-repetition-${repetition}`,
        diagnosticRoot: join(runRoot, "matrix-session-failures", profileId),
        run: () => runSharedRepetition({
          appUrl: server.appUrl,
          artifactRoot,
          releaseRunId: runId,
          profileId,
          repetition,
          cellLimitMs: adjustedCellCapMs,
          stepTimeoutMs,
          signal: releaseController.signal,
        }),
      });
    }
    for (const route of MATRIX_ROUTES) {
      for (const viewport of MATRIX_VIEWPORTS) {
        for (const repetition of MATRIX_REPETITIONS) {
          const profileId = attemptRunId(runId, "fresh-profile", repetition, route, viewport);
          freshTasks.push({
            id: `fresh-${repetition}-${routeSlug(route)}-${viewport}`,
            diagnosticRoot: join(runRoot, "matrix-session-failures", profileId),
            run: () => runFreshAttempt({
              appUrl: server.appUrl,
              artifactRoot,
              releaseRunId: runId,
              profileType: "fresh",
              profileId,
              repetition,
              route,
              viewport,
              cellLimitMs: adjustedCellCapMs,
              stepTimeoutMs,
              ownership: "matrix",
              signal: releaseController.signal,
            }),
          });
        }
      }
    }

    const taskResults = await withTimeout(
      (async () => [
        ...await runTaskPool(sharedTasks, 1, releaseController.signal),
        ...await runTaskPool(freshTasks, shardCount, releaseController.signal),
      ])(),
      hardKillMs,
      "Release matrix hard kill",
      (error) => {
        releaseController.abort(error);
        terminateActiveBrowsers("SIGKILL");
      },
    );
    for (const taskResult of taskResults.filter(Boolean)) {
      const entries = taskResult.status === "fulfilled"
        ? (Array.isArray(taskResult.value) ? taskResult.value : [taskResult.value])
        : taskResult.partialResults;
      for (const entry of entries) {
        attempts.push(entry.record);
        evidence.push(...entry.evidence);
      }
      if (taskResult.status === "rejected") {
        taskFailures.push({
          id: taskResult.id,
          error: taskResult.error,
          diagnostics: {
            log: join(taskResult.diagnosticRoot, "failure.log.json"),
            dom: join(taskResult.diagnosticRoot, "failure.dom.html"),
            screenshot: join(taskResult.diagnosticRoot, "failure.png"),
          },
        });
      }
    }
    sortAttempts(attempts);
    if (taskFailures.length > 0) {
      throw new Error(
        `${taskFailures.length} release matrix task(s) failed before complete coverage.`,
      );
    }

    const normalize = createMatrixAttemptNormalizer();
    attempts = attempts.map((attempt) => normalize(attempt));
    for (const artifact of evidence) await access(artifact.path);
    coverage = aggregateMatrixCoverage(attempts, evidence);

    canonical = await runResponsiveSequence({
      appUrl: server.appUrl,
      artifactRoot: join(runRoot, "canonical"),
      runId: `${runId}-canonical`,
      cellLimitMs: adjustedCellCapMs,
      stepTimeoutMs,
      sessionTimeoutMs: Math.min(120_000, adjustedCellCapMs * 28 + 30_000),
    });

    const outcome = coverage.failed === 0 && canonical.outcome === "passed"
      ? "passed"
      : "failed";
    const manifest = {
      suite: "release-gate",
      ownership: "release",
      runId,
      appUrl: server.appUrl,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      pilot,
      scheduler,
      matrix: {
        coverage,
        attempts,
        failureEvidence: evidence,
        taskFailures,
      },
      canonical: {
        runId: canonical.runId,
        outcome: canonical.outcome,
        profileType: canonical.profileType,
        profileId: canonical.profileId,
        steps: canonical.steps.length,
        manifest: join(runRoot, "canonical", canonical.runId, "manifest.json"),
      },
      humanGate: {
        status: "unperformed",
        releaseBlocking: true,
        personalUsersRequired: 3,
        clinicalOrHealthInformationUsersRequired: 3,
        protocol: "USABILITY.md",
      },
      outcome,
    };
    await writeSmokeReport(manifestPath, manifest);
    if (outcome !== "passed") {
      throw new Error(`Release gate completed with failures; manifest: ${manifestPath}`);
    }
    return { manifest, manifestPath };
  } catch (error) {
    if (error instanceof SmokeTimeoutError) terminateActiveBrowsers("SIGKILL");
    await writeSmokeReport(manifestPath, {
      suite: "release-gate",
      ownership: "release",
      runId,
      appUrl: server?.appUrl ?? appUrl,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      pilot,
      scheduler,
      matrix: {
        attempts,
        failureEvidence: evidence,
        taskFailures,
        coverage,
      },
      canonical: canonical && {
        runId: canonical.runId,
        outcome: canonical.outcome,
        profileType: canonical.profileType,
      },
      humanGate: {
        status: "unperformed",
        releaseBlocking: true,
        personalUsersRequired: 3,
        clinicalOrHealthInformationUsersRequired: 3,
        protocol: "USABILITY.md",
      },
      outcome: "failed",
      error: { name: error.name, message: error.message },
    });
    throw error;
  } finally {
    await server?.stop();
  }
}

function isDirectExecution() {
  return Boolean(process.argv[1])
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  const { manifest, manifestPath } = await runReleaseGate();
  console.log(JSON.stringify({
    suite: manifest.suite,
    runId: manifest.runId,
    matrix: manifest.matrix.coverage,
    canonical: manifest.canonical.outcome,
    scheduler: manifest.scheduler,
  }));
  console.log(`release gate passed: ${manifestPath}`);
}
