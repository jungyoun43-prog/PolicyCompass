import { join } from "node:path";
import { assert, runBrowserSmoke, writeSmokeReport } from "./browser-smoke-harness.mjs";

const appUrl = process.env.EMR_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.CLINICIAN_CHROME_DEBUG_PORT ?? "9232", 10);
const reportPath = process.env.CLINICIAN_FIRST_USE_REPORT
  ?? join("artifacts", "smoke", "first-use-clinician-report.json");
const viewports = [
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: false },
  { width: 1280, height: 800, mobile: false },
  { width: 1600, height: 900, mobile: false },
];
const expectedLabels = ["오늘 진료", "환자 요약", "과거 기록", "VitaGraph", "급여 보드", "Journey", "감사·데이터"];

const viewportResults = [];
await runBrowserSmoke({
  appUrl,
  debugPort,
  profilePrefix: "vitagraph-first-use-clinician-",
  initialViewport: viewports[0],
}, async ({ evaluate, navigate, press, setViewport, waitFor }) => {
  for (const viewport of viewports) {
    await setViewport(viewport);
    await navigate("/emr?demo=1", "document.getElementById('selectedPatientName')?.textContent === '김비타'");
    const geometry = await evaluate(`(() => {
      const header = document.querySelector('.clinical-header');
      const action = document.querySelector('.clinical-header .app-header__action');
      const tablists = [...document.querySelectorAll('.workspace-tabs[role="tablist"]')];
      const tabs = tablists[0] ? [...tablists[0].querySelectorAll('[role="tab"]')] : [];
      const headerRect = header?.getBoundingClientRect();
      const actionRect = action?.getBoundingClientRect();
      const persistent = document.querySelector('[data-safety-persistent], .patient-workspace-navigation');
      const persistentRect = persistent?.getBoundingClientRect();
      return {
        headerHeight: headerRect?.height ?? 0,
        actionWidth: actionRect?.width ?? 0,
        actionHeight: actionRect?.height ?? 0,
        tablistCount: tablists.length,
        tabLabels: tabs.map((tab) => tab.textContent.replace(/\\s+/g, ' ').trim()),
        duplicateNavCount: document.querySelectorAll('nav.clinical-nav, [data-tab-target]').length,
        patientName: document.getElementById('selectedPatientName')?.textContent.trim(),
        persistentVisible: Boolean(persistentRect && persistentRect.width > 0 && persistentRect.height > 0),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      };
    })()`);
    assert(geometry.headerHeight <= 60, `${viewport.width}x${viewport.height}: clinical header is ${geometry.headerHeight}px`);
    assert(geometry.actionWidth >= 44 && geometry.actionHeight >= 44, `${viewport.width}x${viewport.height}: patient-add target is ${geometry.actionWidth}x${geometry.actionHeight}`);
    assert(geometry.tablistCount === 1, `${viewport.width}x${viewport.height}: expected one patient tablist`);
    assert(JSON.stringify(geometry.tabLabels) === JSON.stringify(expectedLabels), `${viewport.width}x${viewport.height}: patient tab labels drifted`);
    assert(geometry.duplicateNavCount === 0, `${viewport.width}x${viewport.height}: duplicate clinical navigation remains`);
    assert(geometry.patientName === "김비타" && geometry.persistentVisible, `${viewport.width}x${viewport.height}: patient safety context is not visible`);
    assert(geometry.documentWidth <= geometry.viewportWidth, `${viewport.width}x${viewport.height}: horizontal overflow ${geometry.documentWidth}/${geometry.viewportWidth}`);
    viewportResults.push({ viewport: `${viewport.width}x${viewport.height}`, ...geometry });
  }

  await setViewport(viewports[2]);
  await navigate("/emr?demo=1", "document.getElementById('selectedPatientName')?.textContent === '김비타'");
  await evaluate("document.getElementById('tab-encounter').focus()");
  await press("ArrowRight", "ArrowRight");
  await press("ArrowRight", "ArrowRight");
  await press("ArrowRight", "ArrowRight");
  await waitFor("document.getElementById('tab-graph').getAttribute('aria-selected') === 'true'", "Arrow-key navigation did not reach VitaGraph.");
  const keyboardState = await evaluate(`(() => {
    const active = document.activeElement;
    const style = getComputedStyle(active);
    return {
      activeId: active?.id,
      graphVisible: document.getElementById('panel-graph').hidden === false,
      patientName: document.getElementById('selectedPatientName').textContent.trim(),
      focusVisible: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 3,
      personalRouteLinks: [...document.querySelectorAll('a[href]')].filter((link) => ['/patient', '/map', '/connections', '/insights', '/journey'].includes(new URL(link.href).pathname)).length,
      progressiveDisclosureCount: document.querySelectorAll('[data-workflow-disclosure], details.encounter-workflow-disclosure').length,
      finalReviewPresent: Boolean(document.getElementById('encounterSignoffSummary')),
    };
  })()`);
  assert(keyboardState.activeId === "tab-graph" && keyboardState.graphVisible, "VitaGraph tab did not retain keyboard focus and panel state.");
  assert(keyboardState.patientName === "김비타", "Patient identity changed during tab navigation.");
  assert(keyboardState.focusVisible, "Keyboard tab has no visible focus indicator.");
  assert(keyboardState.personalRouteLinks === 0, "Clinician workspace exposes personal-app routes.");
  assert(keyboardState.progressiveDisclosureCount >= 1, "Workflow-aware progressive disclosure is missing.");
  assert(keyboardState.finalReviewPresent, "Final sign-off review is not discoverable.");

  await writeSmokeReport(reportPath, {
    suite: "first-use-clinician",
    generatedAt: new Date().toISOString(),
    viewports: viewportResults,
    singlePatientTablist: true,
    arrowKeyNavigation: true,
    persistentSafetyContext: true,
    progressiveDisclosure: keyboardState.progressiveDisclosureCount,
    clinicianPatientBoundary: true,
    encounterLifecycleRegressionSuite: "npm run smoke:emr",
  });
});

console.log(`clinician first-use smoke passed: ${viewports.length} viewports; report ${reportPath}`);
