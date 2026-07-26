import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assert,
  runBrowserSmoke,
  startManagedAppServer,
  writeSmokeReport,
} from "./browser-smoke-harness.mjs";
import {
  MATRIX_CELL_LIMIT_MS,
  MATRIX_PRODUCT_BEHAVIORS,
} from "./responsive-matrix-contract.mjs";

export const RESPONSIVE_VIEWPORTS = Object.freeze([
  Object.freeze({ name: "390x844", width: 390, height: 844, mobile: true }),
  Object.freeze({ name: "768x1024", width: 768, height: 1024, mobile: false }),
  Object.freeze({ name: "1280x800", width: 1280, height: 800, mobile: false }),
  Object.freeze({ name: "1600x900", width: 1600, height: 900, mobile: false }),
]);

export const CANONICAL_STEPS = Object.freeze([
  Object.freeze({
    id: "role-gateway",
    route: "/",
    selectors: [".gateway-intro", ".role-card--clinical", ".role-card--patient", ".handoff-panel", ".gateway-boundary"],
  }),
  Object.freeze({
    id: "patient-home",
    route: "/patient",
    selectors: [".landing-hero", ".fact-strip", ".outcome", ".workflow", ".closing"],
  }),
  Object.freeze({
    id: "patient-map",
    route: "/map",
    selectors: [".map-hero", ".input-panel", ".body-panel", ".detail-panel", ".connection-portal", ".safety-banner"],
  }),
  Object.freeze({
    id: "patient-connections",
    route: "/connections",
    selectors: [".explorer-intro", ".scene-shell", ".explorer-detail"],
  }),
  Object.freeze({
    id: "patient-insights",
    route: "/insights",
    selectors: [".insight-hero", ".insight-status", ".question-panel", ".brief-rail"],
  }),
  Object.freeze({
    id: "patient-journey",
    route: "/journey",
    selectors: [".journey-intro", ".journey-workspace", ".journey-comparison"],
  }),
  Object.freeze({
    id: "clinician-emr",
    route: "/emr",
    selectors: [".clinical-command", ".trust-strip", ".patient-rail", ".patient-workspace"],
  }),
]);

const routeExpectation = new Map(CANONICAL_STEPS.map((step) => [step.route, step]));
const patientStateRoutes = new Set(["/map", "/connections", "/insights", "/journey"]);

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function cellDirectory(route, viewport) {
  const routeName = route === "/" ? "gateway" : route.slice(1).replaceAll("/", "-");
  return `${routeName}@${viewport.name}`;
}

export async function initializeBrowserProfile(api, profileId) {
  await api.navigate("/", "Boolean(document.querySelector('.gateway-intro'))");
  await api.evaluate(`(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("vitagraph-release-profile", ${JSON.stringify(profileId)});
    return localStorage.getItem("vitagraph-release-profile");
  })()`);
}

async function prepareRoute(api, route) {
  if (route === "/") {
    await api.navigate("/", "Boolean(document.querySelector('.gateway-intro'))");
    return;
  }
  if (route === "/patient") {
    await api.navigate("/patient", "Boolean(document.querySelector('[data-first-use=\"patient\"]'))");
    return;
  }
  if (route === "/emr") {
    await api.navigate("/emr", "Boolean(document.getElementById('eventDate')?.value)");
    await api.evaluate("document.getElementById('loadDemo').click()");
    await api.waitFor(
      "document.getElementById('selectedPatientName')?.textContent === '김비타'",
      "The clinician sample workspace did not open.",
    );
    return;
  }
  if (patientStateRoutes.has(route)) {
    await api.navigate(
      "/map?sample=1",
      "document.getElementById('conditionCount')?.textContent !== '0개'",
    );
    await api.waitFor(
      "Boolean(sessionStorage.getItem('vitagraph-scene'))",
      "The patient sample scene was not initialized.",
    );
    if (route !== "/map") {
      const ready = route === "/connections"
        ? "Boolean(document.querySelector('[data-graph-discovery=\"connections\"]'))"
        : route === "/insights"
          ? "document.querySelectorAll('#questions [data-question-id]').length > 0"
          : "Boolean(document.querySelector('[data-story-section=\"changed\"]'))";
      await api.navigate(route, ready);
    }
  }
}

export async function observeResponsiveRoute(api, {
  route,
  viewport,
  profileId,
}) {
  const expectation = routeExpectation.get(route);
  assert(expectation, `No responsive expectation is configured for ${route}.`);
  await api.setViewport(viewport);
  await prepareRoute(api, route);

  const observation = await api.evaluate(`(() => {
    const route = ${JSON.stringify(route)};
    const selectors = ${JSON.stringify(expectation.selectors)};
    const elements = selectors.map((selector) => document.querySelector(selector));
    const visible = (element) => {
      if (!element || element.getClientRects().length === 0 || element.closest('details:not([open])')) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
        && !style.clipPath.includes('inset(50%)');
    };
    const bounds = elements.filter(visible).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.id || String(element.className),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
    const focusables = [...document.querySelectorAll(
      'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
    )]
      .filter(visible)
      .filter((element) => !element.matches(':disabled, [aria-disabled="true"]'));
    const clippedControls = focusables.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      let ancestor = element.parentElement;
      let horizontallyScrollable = false;
      while (ancestor && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        if (ancestor.scrollWidth > ancestor.clientWidth + 1 && ['auto', 'scroll'].includes(style.overflowX)) {
          horizontallyScrollable = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      return !horizontallyScrollable && (rect.left < -1 || rect.right > innerWidth + 1)
        ? [{ label: element.id || element.textContent.trim().slice(0, 40), left: rect.left, right: rect.right }]
        : [];
    });
    const marker = localStorage.getItem('vitagraph-release-profile');
    const routeText = document.querySelector('[data-route-context]')?.textContent ?? '';
    const relationshipText = document.querySelector('[data-relationship-meaning]')?.textContent ?? '';
    const orderedElements = elements.filter(Boolean);
    const product = {};
    if (route === '/') {
      const clinicalAction = document.querySelector('.role-card--clinical a[href="/emr"]');
      const patientAction = document.querySelector('.role-card--patient a[href="/patient"]');
      product['role-boundary-understood'] = /의료진/.test(document.querySelector('.role-card--clinical')?.textContent ?? '')
        && /개인/.test(document.querySelector('.role-card--patient')?.textContent ?? '')
        && /무상태|데이터/.test(document.querySelector('.gateway-boundary')?.textContent ?? '');
      product['primary-role-choice-reachable'] = visible(clinicalAction) && visible(patientAction);
    } else if (route === '/patient') {
      product['local-storage-understood'] = /이 기기|브라우저/.test(routeText)
        && /동의한 경우에만|서버 자동 전송 없음/.test(routeText);
      product['journey-data-preserved'] = marker === ${JSON.stringify(profileId)}
        && Boolean(document.querySelector('a[href="/journey"]'));
    } else if (route === '/map') {
      product['recorded-fact-connection-distinguished'] = /기록|근거/.test(relationshipText)
        && /추론|가능/.test(relationshipText);
      product['patient-context-preserved'] = marker === ${JSON.stringify(profileId)}
        && Boolean(sessionStorage.getItem('vitagraph-scene'));
    } else if (route === '/connections') {
      product['connection-evidence-understood'] = /문헌|근거|기록/.test(relationshipText)
        && /추론|사실 아님/.test(relationshipText);
      product['patient-context-preserved'] = marker === ${JSON.stringify(profileId)}
        && Boolean(sessionStorage.getItem('vitagraph-scene'));
    } else if (route === '/insights') {
      const detailText = [...document.querySelectorAll('.question-detail')].map((item) => item.textContent).join(' ');
      product['insight-source-understood'] = document.querySelectorAll('#questions [data-question-id]').length > 0
        && /근거/.test(detailText);
      product['patient-context-preserved'] = marker === ${JSON.stringify(profileId)}
        && Boolean(sessionStorage.getItem('vitagraph-scene'));
    } else if (route === '/journey') {
      product['journey-change-understood'] = Boolean(document.querySelector('[data-story-section="changed"]'))
        && Boolean(document.querySelector('[data-story-section="context"]'))
        && /추론|인과/.test(document.querySelector('[data-story-section="context"]')?.textContent ?? '');
      product['journey-data-preserved'] = marker === ${JSON.stringify(profileId)}
        && Boolean(document.querySelector('#journeyStorageNote'));
    } else if (route === '/emr') {
      const patientName = document.getElementById('selectedPatientName')?.textContent.trim() ?? '';
      const patientMeta = document.getElementById('selectedPatientMeta')?.textContent ?? '';
      const encounter = document.getElementById('encounterStatusText')?.textContent.trim() ?? '';
      product['patient-encounter-context-preserved'] = patientName === '김비타'
        && /VG-1001/.test(patientMeta) && encounter.length > 0;
      product['sign-review-complete'] = Boolean(document.getElementById('encounterSignoffSummary')?.textContent.trim())
        && Boolean(document.querySelector('.patient-workspace-navigation'));
    }
    return {
      pathname: location.pathname,
      profileMarker: marker,
      missing: selectors.filter((_, index) => !elements[index]),
      sequence: orderedElements.map((element) => (
        element.matches('[aria-labelledby]')
          ? element.getAttribute('aria-labelledby')
          : String(element.className)
      )),
      ordered: orderedElements.every((element, index) => index === 0
        || Boolean(orderedElements[index - 1].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)),
      neutralCssOrder: orderedElements.every((element) => getComputedStyle(element).order === '0'),
      invalidBounds: bounds.filter((rect) => (
        rect.width <= 0 || rect.height <= 0 || rect.left < -1 || rect.right > innerWidth + 1
      )),
      clippedControls,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      product,
    };
  })()`);

  const layoutAssertions = {
    routeLoaded: observation.pathname === route,
    expectedRegionsPresent: observation.missing.length === 0
      && observation.invalidBounds.length === 0,
    semanticOrderPreserved: observation.ordered && observation.neutralCssOrder,
    controlsReachable: observation.clippedControls.length === 0,
    noHorizontalOverflow: observation.documentWidth <= observation.viewportWidth + 1,
  };
  const productAssertions = MATRIX_PRODUCT_BEHAVIORS[route].map((behavior) => ({
    behavior,
    passed: observation.product[behavior] === true,
  }));
  return {
    observation,
    layoutAssertions,
    productAssertions,
  };
}

function failedMessages({ layoutAssertions, productAssertions }) {
  return [
    ...Object.entries(layoutAssertions)
      .filter(([, passed]) => !passed)
      .map(([name]) => `layout:${name}`),
    ...productAssertions
      .filter(({ passed }) => !passed)
      .map(({ behavior }) => behavior),
  ];
}

export async function runResponsiveSequence({
  appUrl = process.env.APP_URL?.trim() || "",
  artifactRoot = process.env.RESPONSIVE_SEQUENCE_ARTIFACT_ROOT
    ?? join(process.cwd(), "artifacts", "responsive-sequence"),
  runId = process.env.RESPONSIVE_SEQUENCE_RUN_ID?.trim()
    || `responsive-sequence-${randomUUID()}`,
  cellLimitMs = positiveInteger(
    process.env.RESPONSIVE_SEQUENCE_CELL_TIMEOUT_MS,
    MATRIX_CELL_LIMIT_MS,
    MATRIX_CELL_LIMIT_MS,
  ),
  stepTimeoutMs = positiveInteger(
    process.env.RESPONSIVE_SEQUENCE_STEP_TIMEOUT_MS,
    8_000,
    MATRIX_CELL_LIMIT_MS,
  ),
  sessionTimeoutMs = positiveInteger(
    process.env.RESPONSIVE_SEQUENCE_TIMEOUT_MS,
    120_000,
  ),
  signal,
} = {}) {
  const runRoot = join(artifactRoot, runId);
  const profileType = "shared-sequential";
  const profileId = `${runId}-profile`;
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const completedSteps = [];
  let failureArtifacts = [];
  let server;
  await mkdir(runRoot, { recursive: true });

  try {
    server = await startManagedAppServer({ appUrl, healthPath: "/" });
    await runBrowserSmoke({
      appUrl: server.appUrl,
      debugPort: 0,
      profilePrefix: "vitagraph-responsive-sequence-",
      initialViewport: RESPONSIVE_VIEWPORTS[0],
      cdpTimeoutMs: Math.min(stepTimeoutMs, 8_000),
      stepTimeoutMs,
      attemptTimeoutMs: sessionTimeoutMs,
      diagnosticRoot: join(runRoot, "session"),
      diagnosticMetadata: { runId, profileType, profileId, suite: "responsive-sequence" },
      signal,
    }, async (api) => {
      await api.step("initialize-shared-profile", () => initializeBrowserProfile(api, profileId), {
        timeoutMs: stepTimeoutMs,
      });
      let order = 0;
      for (const viewport of RESPONSIVE_VIEWPORTS) {
        for (const expectation of CANONICAL_STEPS) {
          order += 1;
          let result;
          try {
            result = await api.step(
              `${expectation.id}@${viewport.name}`,
              async () => {
                const observed = await observeResponsiveRoute(api, {
                  route: expectation.route,
                  viewport,
                  profileId,
                });
                const failures = failedMessages(observed);
                assert(
                  failures.length === 0,
                  `${expectation.route}@${viewport.name} failed: ${failures.join(", ")}`,
                );
                return observed;
              },
              { timeoutMs: Math.min(cellLimitMs, stepTimeoutMs) },
            );
          } catch (error) {
            const browserStep = api.stepRecords.at(-1);
            const cell = `${expectation.route}@${viewport.name}`;
            const bundle = await api.captureDiagnostics(
              join(runRoot, cellDirectory(expectation.route, viewport), `${String(order).padStart(2, "0")}-${expectation.id}`),
              {
                runId,
                profileType,
                profileId,
                cell,
                step: {
                  order,
                  id: expectation.id,
                  route: expectation.route,
                  viewport: viewport.name,
                  elapsedMs: browserStep?.elapsedMs,
                  timeoutMs: browserStep?.timeoutMs,
                },
              },
              error,
            );
            failureArtifacts = bundle.artifacts;
            error.sequenceFailure = { order, expectation, viewport, bundle };
            throw error;
          }
          const browserStep = api.stepRecords.at(-1);
          completedSteps.push({
            order,
            name: expectation.id,
            route: expectation.route,
            viewport: viewport.name,
            startedAt: browserStep.startedAt,
            finishedAt: browserStep.finishedAt,
            elapsedMs: browserStep.elapsedMs,
            timeoutMs: browserStep.timeoutMs,
            outcome: "passed",
            layoutAssertions: result.layoutAssertions,
            productAssertions: result.productAssertions,
          });
        }
      }
    });

    const manifest = {
      suite: "responsive-sequence",
      ownership: "canonical",
      runId,
      profileType,
      profileId,
      appUrl: server.appUrl,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      cellLimitMs,
      stepTimeoutMs,
      sessionTimeoutMs,
      canonicalOrder: CANONICAL_STEPS.map(({ id }) => id),
      viewports: RESPONSIVE_VIEWPORTS.map(({ name }) => name),
      steps: completedSteps,
      outcome: "passed",
      artifacts: [],
    };
    await writeSmokeReport(join(runRoot, "manifest.json"), manifest);
    return manifest;
  } catch (error) {
    const manifest = {
      suite: "responsive-sequence",
      ownership: "canonical",
      runId,
      profileType,
      profileId,
      appUrl: server?.appUrl ?? appUrl,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      cellLimitMs,
      stepTimeoutMs,
      sessionTimeoutMs,
      canonicalOrder: CANONICAL_STEPS.map(({ id }) => id),
      viewports: RESPONSIVE_VIEWPORTS.map(({ name }) => name),
      steps: completedSteps,
      outcome: "failed",
      error: { name: error.name, message: error.message },
      artifacts: failureArtifacts,
    };
    await writeSmokeReport(join(runRoot, "manifest.json"), manifest);
    throw new Error(
      `${error.message}; responsive-sequence manifest: ${join(runRoot, "manifest.json")}`,
      { cause: error },
    );
  } finally {
    await server?.stop();
  }
}

function isDirectExecution() {
  return Boolean(process.argv[1])
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  const manifest = await runResponsiveSequence();
  console.log(JSON.stringify({
    suite: manifest.suite,
    runId: manifest.runId,
    outcome: manifest.outcome,
    steps: manifest.steps.length,
  }));
  console.log(
    `responsive canonical sequence passed: ${CANONICAL_STEPS.length} routes across `
    + `${RESPONSIVE_VIEWPORTS.length} viewports; ${join(
      process.env.RESPONSIVE_SEQUENCE_ARTIFACT_ROOT
        ?? join(process.cwd(), "artifacts", "responsive-sequence"),
      manifest.runId,
      "manifest.json",
    )}`,
  );
}
