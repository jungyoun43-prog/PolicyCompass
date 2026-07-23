import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  SmokeTimeoutError,
  startManagedAppServer,
  stopChildProcess,
  withTimeout,
  writeSmokeReport,
} from "./browser-smoke-harness.mjs";

export const PR_GATE_CELLS = Object.freeze([
  Object.freeze({
    id: "clinician-fresh",
    flow: "clinician",
    profileType: "fresh",
    command: "scripts/first-use-clinician-smoke.mjs",
    reportEnv: "CLINICIAN_FIRST_USE_REPORT",
  }),
  Object.freeze({
    id: "patient-fresh",
    flow: "patient",
    profileType: "fresh",
    command: "scripts/first-use-patient-smoke.mjs",
    reportEnv: "PATIENT_FIRST_USE_REPORT",
  }),
  Object.freeze({
    id: "clinician-then-patient-shared",
    flow: "clinician+patient",
    profileType: "shared-sequential",
    command: "scripts/pr-shared-profile-smoke.mjs",
    reportEnv: "PR_SHARED_PROFILE_REPORT",
  }),
]);

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

async function writeIfMissing(path, value, options) {
  try {
    await writeFile(path, value, { ...options, flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

async function ensureFailureBundle(cellRoot, metadata, log) {
  const paths = {
    log: join(cellRoot, "runner.log"),
    dom: join(cellRoot, "failure.dom.html"),
    screenshot: join(cellRoot, "failure.png"),
    failure: join(cellRoot, "failure.json"),
  };
  await Promise.all([
    writeIfMissing(paths.log, log, { encoding: "utf8" }),
    writeIfMissing(
      paths.dom,
      `<!-- Browser DOM was unavailable. ${metadata.message} -->`,
      { encoding: "utf8" },
    ),
    writeIfMissing(paths.screenshot, Buffer.alloc(0)),
    writeSmokeReport(paths.failure, {
      ...metadata,
      artifacts: {
        log: paths.log,
        dom: paths.dom,
        screenshot: paths.screenshot,
      },
    }),
  ]);
  return paths;
}

export async function runPrGoldenFlowGate({
  appUrl = process.env.APP_URL?.trim() || "",
  artifactRoot = process.env.PR_GATE_ARTIFACT_ROOT ?? join("artifacts", "pr-gate"),
  runId = process.env.PR_GATE_RUN_ID
    ?? `pr-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}`,
  cellTimeoutMs = positiveInteger(process.env.PR_GATE_CELL_TIMEOUT_MS, 30_000, 30_000),
} = {}) {
  const runRoot = join(artifactRoot, runId);
  const startedAt = new Date().toISOString();
  await mkdir(runRoot, { recursive: true });
  let server;
  const results = [];

  try {
    server = await startManagedAppServer({ appUrl, healthPath: "/patient" });

    for (const cell of PR_GATE_CELLS) {
      const cellRoot = join(runRoot, cell.id);
      const reportPath = join(cellRoot, "report.json");
      const logPath = join(cellRoot, "runner.log");
      await mkdir(cellRoot, { recursive: true });
      const cellStartedAt = new Date().toISOString();
      const cellStarted = performance.now();
      let log = "";
      let timedOut = false;
      const useProcessGroup = process.platform !== "win32";
      const child = spawn(process.execPath, [cell.command], {
        detached: useProcessGroup,
        env: {
          ...process.env,
          APP_URL: server.appUrl,
          EMR_URL: server.appUrl,
          BROWSER_ATTEMPT_TIMEOUT_MS: String(Math.max(1_000, cellTimeoutMs - 2_000)),
          BROWSER_CDP_TIMEOUT_MS: String(Math.min(6_000, cellTimeoutMs)),
          BROWSER_STEP_TIMEOUT_MS: String(Math.min(8_000, cellTimeoutMs)),
          CLINICIAN_CHROME_DEBUG_PORT: "0",
          PATIENT_CHROME_DEBUG_PORT: "0",
          PR_GATE_CHROME_DEBUG_PORT: "0",
          PR_GATE_RUN_ID: runId,
          PR_GATE_CELL_ID: cell.id,
          PR_GATE_PROFILE_TYPE: cell.profileType,
          PR_GATE_CELL_ROOT: cellRoot,
          [cell.reportEnv]: reportPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => {
        log = `${log}${chunk}`.slice(-64_000);
      });
      child.stderr.on("data", (chunk) => {
        log = `${log}${chunk}`.slice(-64_000);
      });

      let exitCode;
      let processError;
      try {
        exitCode = await withTimeout(
          new Promise((resolveExit, rejectExit) => {
            child.once("error", rejectExit);
            child.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
          }),
          cellTimeoutMs,
          `PR gate cell ${cell.id}`,
          () => {
            timedOut = true;
            void stopChildProcess(child, { processGroup: useProcessGroup });
          },
        );
      } catch (error) {
        processError = error;
        await stopChildProcess(child, { processGroup: useProcessGroup });
        exitCode = 1;
      }
      await writeFile(logPath, log, "utf8");

      let report = null;
      try {
        report = JSON.parse(await readFile(reportPath, "utf8"));
      } catch {
        // A bounded failure may occur before the child can write a success report.
      }
      const productAssertions = report?.productAssertions ?? {};
      const reportIsValid = report
        && report.runId === runId
        && report.cell === cell.id
        && report.profileType === cell.profileType
        && Array.isArray(report.steps)
        && report.steps.length > 0
        && Object.keys(productAssertions).length > 0
        && Object.values(productAssertions).every((assertion) => assertion === true);
      const outcome = exitCode === 0 && reportIsValid ? "passed" : "failed";
      const finishedAt = new Date().toISOString();
      const elapsedMs = Math.round(performance.now() - cellStarted);
      const executionStep = {
        order: 1,
        name: `${cell.flow}-golden-flow`,
        startedAt: cellStartedAt,
        finishedAt,
        elapsedMs: Math.min(elapsedMs, cellTimeoutMs),
        timeoutMs: cellTimeoutMs,
        outcome,
      };
      const failureMessage = processError?.message
        ?? (exitCode === 0
          ? "Flow report did not satisfy the PR evidence contract."
          : `Flow exited with code ${exitCode}.`);
      const diagnostics = {
        log: logPath,
        report: reportPath,
        dom: join(cellRoot, "failure.dom.html"),
        screenshot: join(cellRoot, "failure.png"),
        failure: join(cellRoot, "failure.json"),
      };
      if (outcome === "failed") {
        await ensureFailureBundle(cellRoot, {
          runId,
          cell: cell.id,
          profileType: cell.profileType,
          step: report?.steps?.at(-1) ?? "launch",
          timedOut,
          timeoutMs: cellTimeoutMs,
          message: failureMessage,
        }, log);
      }

      results.push({
        runId,
        cell: cell.id,
        flow: cell.flow,
        profileType: cell.profileType,
        startedAt: cellStartedAt,
        finishedAt,
        durationMs: Math.min(elapsedMs, cellTimeoutMs),
        cellTimeoutMs,
        exitCode: outcome === "passed" ? 0 : (exitCode || 1),
        outcome,
        steps: [executionStep],
        reportedSteps: report?.steps ?? report?.routeSequence ?? [],
        productAssertions,
        diagnostics,
      });
      if (outcome === "failed") break;
    }

    const manifest = {
      suite: "pr-golden-flow-gate",
      ownership: "PR",
      runId,
      appUrl: server.appUrl,
      startedAt,
      finishedAt: new Date().toISOString(),
      cellTimeoutMs,
      expectedCells: PR_GATE_CELLS.map(({ id }) => id),
      cells: results,
      outcome: results.length === PR_GATE_CELLS.length
        && results.every(({ outcome }) => outcome === "passed")
        ? "passed"
        : "failed",
    };
    const manifestPath = join(runRoot, "manifest.json");
    await writeSmokeReport(manifestPath, manifest);
    if (manifest.outcome !== "passed") {
      throw new Error(`PR golden-flow gate failed; diagnostics manifest: ${manifestPath}`);
    }
    return { manifest, manifestPath };
  } catch (error) {
    if (error instanceof SmokeTimeoutError || results.length === 0) {
      await writeSmokeReport(join(runRoot, "manifest.json"), {
        suite: "pr-golden-flow-gate",
        ownership: "PR",
        runId,
        appUrl: server?.appUrl ?? appUrl,
        startedAt,
        finishedAt: new Date().toISOString(),
        cellTimeoutMs,
        expectedCells: PR_GATE_CELLS.map(({ id }) => id),
        cells: results,
        outcome: "failed",
        error: { name: error.name, message: error.message },
      });
    }
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
  const { manifest, manifestPath } = await runPrGoldenFlowGate();
  console.log(`PR golden-flow gate passed (${manifest.runId}): ${manifestPath}`);
}
