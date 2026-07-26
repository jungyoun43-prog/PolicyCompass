import { join } from "node:path";
import { assert, runBrowserSmoke, writeSmokeReport } from "./browser-smoke-harness.mjs";

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.PATIENT_CHROME_DEBUG_PORT ?? "9231", 10);
const reportPath = process.env.PATIENT_FIRST_USE_REPORT
  ?? join("artifacts", "smoke", "first-use-patient-report.json");
const runId = process.env.PR_GATE_RUN_ID ?? `local-${process.pid}`;
const cell = process.env.PR_GATE_CELL_ID ?? "patient-fresh";
const profileType = process.env.PR_GATE_PROFILE_TYPE ?? "fresh";
const viewports = [
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: false },
  { width: 1280, height: 800, mobile: false },
  { width: 1600, height: 900, mobile: false },
];

const viewportResults = [];
const routeResults = [];
let keyboardPrimaryActionVerified = false;
let journeyDataPersistenceVerified = false;
await runBrowserSmoke({
  appUrl,
  debugPort,
  profilePrefix: "vitagraph-first-use-patient-",
  initialViewport: viewports[0],
}, async ({ evaluate, navigate, setViewport, tabTo, waitFor }) => {
  for (const viewport of viewports) {
    await setViewport(viewport);
    await navigate("/patient", "Boolean(document.querySelector('[data-first-use=" + JSON.stringify("patient") + "]'))");
    const result = await evaluate(`(() => {
      const firstUse = document.querySelector('[data-first-use="patient"]');
      const localContext = document.querySelector('[data-route-context]');
      const sample = firstUse?.querySelector('a[href="/map?sample=1"]');
      const connected = firstUse?.querySelector('a[href="/map#connected-record"]');
      const heroPrimary = document.querySelector('[data-primary-action]');
      const heroSample = document.querySelector('.landing-actions a[href="/map?sample=1"]');
      const rect = firstUse?.getBoundingClientRect();
      const sampleRect = sample?.getBoundingClientRect();
      const actionBounds = [heroPrimary, heroSample].map((element) => {
        const bounds = element?.getBoundingClientRect();
        return bounds ? {
          text: element.textContent.trim(),
          path: new URL(element.href).pathname + new URL(element.href).hash + new URL(element.href).search,
          top: bounds.top,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        } : null;
      });
      return {
        steps: firstUse?.querySelectorAll('[data-first-use-step]').length ?? 0,
        localText: localContext?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
        sampleVisible: Boolean(sampleRect && sampleRect.width > 0 && sampleRect.height > 0),
        connectedPresent: Boolean(connected),
        firstUseWidth: rect?.width ?? 0,
        actionBounds,
        viewportHeight: innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        emrLinks: [...document.querySelectorAll('a[href]')].filter((link) => new URL(link.href).pathname === '/emr').length,
      };
    })()`);
    assert(result.steps === 4, `${viewport.width}x${viewport.height}: first-use path does not have four steps`);
    assert(/개인용 앱/.test(result.localText) && /식별정보·원문 메모 제외/.test(result.localText) && /진단·처방 아님/.test(result.localText), `${viewport.width}x${viewport.height}: patient data boundary is unclear`);
    assert(result.sampleVisible && result.connectedPresent, `${viewport.width}x${viewport.height}: safe sample/connected-record entry is missing`);
    assert(result.firstUseWidth > 0 && result.documentWidth <= result.viewportWidth, `${viewport.width}x${viewport.height}: first-use layout overflows`);
    assert(
      result.actionBounds.every((action) => action
        && action.height >= 44
        && action.width >= 44
        && action.top >= 0
        && action.bottom <= result.viewportHeight),
      `${viewport.width}x${viewport.height}: hero start actions are not both reachable in the first viewport (${JSON.stringify(result.actionBounds)})`,
    );
    assert(result.actionBounds[0].text === "연결 기록으로 시작" && result.actionBounds[0].path === "/map#connected-record",
      `${viewport.width}x${viewport.height}: connected-record action is incorrect`);
    assert(result.actionBounds[1].text === "예시로 보기" && result.actionBounds[1].path === "/map?sample=1",
      `${viewport.width}x${viewport.height}: sample action is incorrect`);
    assert(result.emrLinks === 0, `${viewport.width}x${viewport.height}: patient start exposes /emr`);
    viewportResults.push({ viewport: `${viewport.width}x${viewport.height}`, ...result });
  }

  await setViewport(viewports[0]);
  await navigate("/patient", "Boolean(document.querySelector('[data-first-use=" + JSON.stringify("patient") + "]'))");
  for (const selector of ['[data-primary-action]', '.landing-actions a[href="/map?sample=1"]']) {
    assert(await tabTo(selector), `${selector}: hero action is not keyboard reachable.`);
    const focusVisible = await evaluate(`(() => {
      const style = getComputedStyle(document.activeElement);
      return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 3;
    })()`);
    assert(focusVisible, `${selector}: hero action has no visible keyboard focus.`);
  }
  keyboardPrimaryActionVerified = true;

  await setViewport(viewports[2]);
  await navigate("/map?sample=1", "document.getElementById('conditionCount')?.textContent !== '0개'");
  await waitFor("Boolean(sessionStorage.getItem('vitagraph-scene'))", "Sample map did not persist in the patient session.");
  const initialScene = await evaluate("JSON.parse(sessionStorage.getItem('vitagraph-scene'))");
  assert(initialScene.isDemo === true && initialScene.visibleIds.length > 0, "Safe sample state is not marked as demo.");

  const routeExpectations = [
    ["/map", "[data-graph-discovery=\"map\"]", "map"],
    ["/connections", "[data-graph-discovery=\"connections\"]", "connections"],
    ["/insights", "#questionCount", "insights"],
    ["/journey", "[data-story-section=\"changed\"]", "journey"],
  ];
  for (const [route, readySelector, name] of routeExpectations) {
    await navigate(route, `Boolean(document.querySelector(${JSON.stringify(readySelector)}))`);
    const result = await evaluate(`(() => {
      const visible = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      return {
        emrLinks: [...document.querySelectorAll('a[href]')].filter((link) => new URL(link.href).pathname === '/emr').length,
        sessionConditions: JSON.parse(sessionStorage.getItem('vitagraph-scene') || '{}').visibleIds?.length ?? 0,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        legend: visible('[data-graph-legend]'),
        instructions: visible('[data-graph-instructions]'),
        relationshipMeaning: visible('[data-relationship-meaning]'),
        selectionState: visible('[data-selection-state]'),
        nextAction: visible('[data-next-action]'),
        changed: visible('[data-story-section="changed"]'),
        context: visible('[data-story-section="context"]'),
        next: visible('[data-story-section="next"]'),
        questions: visible('#questions'),
        signals: visible('#signals'),
        visitStoryPresent: Boolean(document.querySelector('.visit-story')),
        firstUse: visible('[data-first-use]'),
      };
    })()`);
    assert(result.emrLinks === 0, `${route}: patient route exposes /emr`);
    assert(result.sessionConditions === initialScene.visibleIds.length, `${route}: patient scene did not persist`);
    assert(result.documentWidth <= result.viewportWidth, `${route}: horizontal overflow`);
    if (name === "map" || name === "connections") {
      assert(result.legend && result.instructions && result.relationshipMeaning && result.selectionState && result.nextAction, `${route}: graph discovery affordances are incomplete`);
    } else if (name === "insights") {
      assert(result.questions && result.signals && !result.visitStoryPresent, `${route}: focused question brief is incomplete`);
    } else {
      assert(result.changed && result.context && result.next, `${route}: change story is incomplete`);
    }
    routeResults.push({ route, ...result });
  }

  await navigate("/map", "Boolean(document.getElementById('healthNote'))");
  await evaluate(`(() => {
    const note = document.getElementById('healthNote');
    note.value = '혈압 148/94';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('analyzeButton').click();
  })()`);
  await waitFor("document.getElementById('miniConditionList').children.length > 0", "Real patient map did not update before Journey save.");
  await waitFor("!document.getElementById('saveJourney').disabled", "Journey save did not become available.");
  await evaluate("document.getElementById('saveJourney').click()");
  await waitFor("JSON.parse(localStorage.getItem('vitagraph-journey') || '[]').length === 1", "Journey save did not persist one record.");
  await navigate("/journey", "document.querySelectorAll('.snapshot-card').length === 1");
  assert(await evaluate("JSON.parse(localStorage.getItem('vitagraph-journey') || '[]').length === 1"),
    "Journey record did not persist across patient route navigation.");
  journeyDataPersistenceVerified = true;

  const localStorageExplanationVerified = viewportResults.every(({ localText }) => (
    /이 기기|브라우저/.test(localText) && /서버 전송 없음/.test(localText)
  ));
  const patientClinicianBoundaryVerified = [...viewportResults, ...routeResults]
    .every(({ emrLinks }) => emrLinks === 0);

  await writeSmokeReport(reportPath, {
    suite: "first-use-patient",
    runId,
    cell,
    profileType,
    generatedAt: new Date().toISOString(),
    steps: ["responsive-first-use", "keyboard-primary-action", "patient-golden-route-sequence"],
    productAssertions: {
      localStorageExplanation: localStorageExplanationVerified,
      patientClinicianBoundary: patientClinicianBoundaryVerified,
      keyboardPrimaryAction: keyboardPrimaryActionVerified,
      journeyDataPersistence: journeyDataPersistenceVerified,
    },
    viewports: viewportResults,
    routeFlow: routeResults,
    routeSequence: ["/patient", "/map", "/connections", "/insights", "/journey"],
    sampleIsIsolated: true,
    sessionPersistence: true,
    patientClinicianBoundary: true,
    humanValidationProtocol: "USABILITY.md",
  });
});

console.log(`patient first-use smoke passed: ${viewports.length} viewports and ${routeResults.length} route states; report ${reportPath}`);
