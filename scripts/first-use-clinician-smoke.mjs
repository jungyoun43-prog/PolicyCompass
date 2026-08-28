import { join } from "node:path";
import { assert, runBrowserSmoke, writeSmokeReport } from "./browser-smoke-harness.mjs";

const appUrl = process.env.EMR_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.CLINICIAN_CHROME_DEBUG_PORT ?? "9232", 10);
const reportPath = process.env.CLINICIAN_FIRST_USE_REPORT
  ?? join("artifacts", "smoke", "first-use-clinician-report.json");
const runId = process.env.PR_GATE_RUN_ID ?? `local-${process.pid}`;
const cell = process.env.PR_GATE_CELL_ID ?? "clinician-fresh";
const profileType = process.env.PR_GATE_PROFILE_TYPE ?? "fresh";
const viewports = [
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: false },
  { width: 1280, height: 800, mobile: false },
  { width: 1600, height: 900, mobile: false },
];
const expectedLabels = ["오늘 진료", "환자 요약", "과거 기록", "신체 지도", "급여 보드", "Journey", "감사·데이터"];

const viewportResults = [];
await runBrowserSmoke({
  appUrl,
  debugPort,
  profilePrefix: "policycompass-first-use-clinician-",
  initialViewport: viewports[0],
}, async ({ evaluate, navigate, press, setViewport, waitFor }) => {
  for (const viewport of viewports) {
    await setViewport(viewport);
    await navigate("/emr", "Boolean(document.getElementById('eventDate')?.value)");
    await evaluate("document.getElementById('loadDemo').click()");
    await waitFor("document.getElementById('selectedPatientName')?.textContent === '김비타'", `${viewport.width}x${viewport.height}: sample workspace did not open`);
    const geometry = await evaluate(`(() => {
      const header = document.querySelector('.clinical-header');
      const brand = document.querySelector('.clinical-header .app-brand');
      const shell = document.querySelector('.emr-shell');
      const tablists = [...document.querySelectorAll('.workspace-tabs[role="tablist"]')];
      const tabs = tablists[0] ? [...tablists[0].querySelectorAll('[role="tab"]')] : [];
      const headerRect = header?.getBoundingClientRect();
      const brandRect = brand?.getBoundingClientRect();
      const shellRect = shell?.getBoundingClientRect();
      const persistent = document.querySelector('[data-safety-persistent], .patient-workspace-navigation');
      const persistentRect = persistent?.getBoundingClientRect();
      return {
        headerHeight: headerRect?.height ?? 0,
        brandLeft: brandRect?.left ?? -1,
        shellLeft: shellRect?.left ?? -1,
        globalActionCount: document.querySelectorAll('.clinical-header .app-header__action').length,
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
    assert(geometry.globalActionCount === 0, `${viewport.width}x${viewport.height}: removed patient-add header action remains`);
    assert(Math.abs(geometry.brandLeft - geometry.shellLeft) <= 1, `${viewport.width}x${viewport.height}: brand/shell alignment drifted ${geometry.brandLeft}/${geometry.shellLeft}`);
    assert(geometry.tablistCount === 1, `${viewport.width}x${viewport.height}: expected one patient tablist`);
    assert(JSON.stringify(geometry.tabLabels) === JSON.stringify(expectedLabels), `${viewport.width}x${viewport.height}: patient tab labels drifted`);
    assert(geometry.duplicateNavCount === 0, `${viewport.width}x${viewport.height}: duplicate clinical navigation remains`);
    assert(geometry.patientName === "김비타" && geometry.persistentVisible, `${viewport.width}x${viewport.height}: patient safety context is not visible`);
    assert(geometry.documentWidth <= geometry.viewportWidth, `${viewport.width}x${viewport.height}: horizontal overflow ${geometry.documentWidth}/${geometry.viewportWidth}`);
    viewportResults.push({ viewport: `${viewport.width}x${viewport.height}`, ...geometry });
  }

  await setViewport(viewports[2]);
  await navigate("/emr", "Boolean(document.getElementById('eventDate')?.value)");
  await evaluate("document.getElementById('loadDemo').click()");
  await waitFor("document.getElementById('selectedPatientName')?.textContent === '김비타'", "Sample workspace did not open for keyboard validation.");
  await evaluate("document.getElementById('tab-encounter').focus()");
  await press("ArrowRight", "ArrowRight");
  await press("ArrowRight", "ArrowRight");
  await press("ArrowRight", "ArrowRight");
  await waitFor("document.getElementById('tab-graph').getAttribute('aria-selected') === 'true'", "Arrow-key navigation did not reach the body map.");
  const keyboardState = await evaluate(`(() => {
    const active = document.activeElement;
    const style = getComputedStyle(active);
    return {
      activeId: active?.id,
      bodyMapVisible: document.getElementById('panel-graph').hidden === false,
      bodyHotspots: document.querySelectorAll('.body-hotspot[data-body-area]').length,
      bodyCaptions: document.querySelectorAll('.body-caption[data-body-area]').length,
      patientName: document.getElementById('selectedPatientName').textContent.trim(),
      focusVisible: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 3,
      personalRouteLinks: [...document.querySelectorAll('a[href]')].filter((link) => ['/patient', '/map', '/connections', '/insights', '/journey'].includes(new URL(link.href).pathname)).length,
      progressiveDisclosureCount: document.querySelectorAll('[data-workflow-disclosure], details.encounter-workflow-disclosure').length,
      finalReviewPresent: Boolean(
        document.getElementById('encounterSignReview')
        && document.getElementById('encounterSignReviewAcknowledged')
        && document.getElementById('encounterSignReviewTitle')?.tabIndex === -1
      ),
    };
  })()`);
  assert(keyboardState.activeId === "tab-graph" && keyboardState.bodyMapVisible, "Body-map tab did not retain keyboard focus and panel state.");
  assert(keyboardState.bodyHotspots === 12 && keyboardState.bodyCaptions === 12, "Body map did not expose twelve hotspots and twelve department captions.");
  assert(keyboardState.patientName === "김비타", "Patient identity changed during tab navigation.");
  assert(keyboardState.focusVisible, "Keyboard tab has no visible focus indicator.");
  assert(keyboardState.personalRouteLinks === 0, "Clinician workspace exposes personal-app routes.");
  assert(keyboardState.progressiveDisclosureCount >= 1, "Workflow-aware progressive disclosure is missing.");
  assert(keyboardState.finalReviewPresent, "Final sign-off review is not discoverable.");

  await writeSmokeReport(reportPath, {
    suite: "first-use-clinician",
    runId,
    cell,
    profileType,
    generatedAt: new Date().toISOString(),
    steps: ["responsive-context", "keyboard-workspace-navigation"],
    productAssertions: {
      correctPatientContext: true,
      persistentSafetyContext: true,
      clinicianPatientBoundary: true,
      keyboardWorkspaceNavigation: true,
    },
    viewports: viewportResults,
    singlePatientTablist: true,
    arrowKeyNavigation: true,
    bodyMapAreas: keyboardState.bodyHotspots,
    persistentSafetyContext: true,
    progressiveDisclosure: keyboardState.progressiveDisclosureCount,
    clinicianPatientBoundary: true,
    encounterLifecycleRegressionSuite: "npm run smoke:emr",
  });
});

console.log(`clinician first-use smoke passed: ${viewports.length} viewports; report ${reportPath}`);
