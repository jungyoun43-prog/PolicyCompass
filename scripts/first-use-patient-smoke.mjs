import { join } from "node:path";
import { assert, runBrowserSmoke, writeSmokeReport } from "./browser-smoke-harness.mjs";

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.PATIENT_CHROME_DEBUG_PORT ?? "9231", 10);
const reportPath = process.env.PATIENT_FIRST_USE_REPORT
  ?? join("artifacts", "smoke", "first-use-patient-report.json");
const viewports = [
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: false },
  { width: 1280, height: 800, mobile: false },
  { width: 1600, height: 900, mobile: false },
];

const viewportResults = [];
const routeResults = [];
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
      const imported = firstUse?.querySelector('a[href="/map#import-record"]');
      const rect = firstUse?.getBoundingClientRect();
      const sampleRect = sample?.getBoundingClientRect();
      return {
        steps: firstUse?.querySelectorAll('[data-first-use-step]').length ?? 0,
        localText: localContext?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
        sampleVisible: Boolean(sampleRect && sampleRect.width > 0 && sampleRect.height > 0),
        importPresent: Boolean(imported),
        firstUseWidth: rect?.width ?? 0,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        emrLinks: [...document.querySelectorAll('a[href]')].filter((link) => new URL(link.href).pathname === '/emr').length,
      };
    })()`);
    assert(result.steps === 4, `${viewport.width}x${viewport.height}: first-use path does not have four steps`);
    assert(/이 기기|브라우저/.test(result.localText) && /서버 전송 없음/.test(result.localText), `${viewport.width}x${viewport.height}: local-only context is unclear`);
    assert(result.sampleVisible && result.importPresent, `${viewport.width}x${viewport.height}: safe sample/import entry is missing`);
    assert(result.firstUseWidth > 0 && result.documentWidth <= result.viewportWidth, `${viewport.width}x${viewport.height}: first-use layout overflows`);
    assert(result.emrLinks === 0, `${viewport.width}x${viewport.height}: patient start exposes /emr`);
    viewportResults.push({ viewport: `${viewport.width}x${viewport.height}`, ...result });
  }

  await setViewport(viewports[2]);
  await navigate("/patient", "Boolean(document.querySelector('[data-first-use=" + JSON.stringify("patient") + "]'))");
  assert(await tabTo('.patient-start-path a[href="/map?sample=1"]'), "Sample first-use action is not keyboard reachable.");
  const sampleFocus = await evaluate(`(() => {
    const style = getComputedStyle(document.activeElement);
    return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 3;
  })()`);
  assert(sampleFocus, "Sample first-use action has no visible keyboard focus.");

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

  await writeSmokeReport(reportPath, {
    suite: "first-use-patient",
    generatedAt: new Date().toISOString(),
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
