import { join } from "node:path";
import { assert, runBrowserSmoke, writeSmokeReport } from "./browser-smoke-harness.mjs";

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.GRAPH_CHROME_DEBUG_PORT ?? "9233", 10);
const reportPath = process.env.GRAPH_DISCOVERY_REPORT
  ?? join("artifacts", "smoke", "graph-discovery-report.json");
const viewports = [
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: false },
  { width: 1280, height: 800, mobile: false },
  { width: 1600, height: 900, mobile: false },
];

const results = [];
await runBrowserSmoke({
  appUrl,
  debugPort,
  profilePrefix: "policycompass-graph-discovery-",
  initialViewport: viewports[0],
}, async ({ evaluate, navigate, setViewport, waitFor }) => {
  await navigate("/map?sample=1", "document.getElementById('conditionCount')?.textContent !== '0개'");
  assert(await evaluate("sessionStorage.getItem('policycompass-scene') === null"), "Sample map persisted a real Personal scene.");

  for (const viewport of viewports) {
    for (const [route, kind] of [["/map", "map"], ["/connections", "connections"]]) {
      await setViewport(viewport);
      await navigate(`${route}?sample=1`, `Boolean(document.querySelector('[data-graph-discovery="${kind}"]'))`);
      const state = await evaluate(`(() => {
        const visible = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return { visible: false, text: '' };
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
            text: element.textContent.replace(/\\s+/g, ' ').trim(),
          };
        };
        const wrapper = document.querySelector('[data-graph-discovery="${kind}"]');
        return {
          wrapper: visible('[data-graph-discovery="${kind}"]'),
          legend: visible('[data-graph-legend]'),
          instructions: visible('[data-graph-instructions]'),
          relationship: visible('[data-relationship-meaning]'),
          selection: visible('[data-selection-state]'),
          nextAction: visible('[data-next-action]'),
          selectionSemantic: document.querySelector('[data-selection-state]')?.getAttribute('role')
            || document.querySelector('[data-selection-state]')?.getAttribute('aria-live')
            || '',
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
          wrapperRight: wrapper?.getBoundingClientRect().right ?? 0,
        };
      })()`);
      for (const [name, item] of Object.entries({
        wrapper: state.wrapper,
        legend: state.legend,
        instructions: state.instructions,
        relationship: state.relationship,
        selection: state.selection,
        nextAction: state.nextAction,
      })) {
        assert(item.visible && item.text.length > 0, `${route} ${viewport.width}x${viewport.height}: ${name} is not visible and named`);
      }
      assert(/기록|근거/.test(state.relationship.text) && /추론|가능/.test(state.relationship.text), `${route}: relationship meaning does not distinguish evidence from inference`);
      assert(/선택|보고|현재/.test(state.selection.text), `${route}: selected state has no non-color text`);
      assert(state.selectionSemantic.length > 0, `${route}: selected state has no status semantics`);
      assert(state.documentWidth <= state.viewportWidth && state.wrapperRight <= state.viewportWidth + 1, `${route} ${viewport.width}x${viewport.height}: discovery UI clips horizontally`);
      assert(await evaluate("new URLSearchParams(location.search).get('sample') === '1' && sessionStorage.getItem('policycompass-scene') === null"), `${route}: sample boundary was dropped or persisted a real scene`);
      results.push({ route, viewport: `${viewport.width}x${viewport.height}`, ...state });
    }
  }

  await writeSmokeReport(reportPath, {
    suite: "graph-discovery",
    generatedAt: new Date().toISOString(),
    states: results,
    routes: ["/map", "/connections"],
    evidenceInferenceBoundary: true,
    nonColorSelectionState: true,
    responsiveViewports: viewports.map(({ width, height }) => `${width}x${height}`),
  });
});

console.log(`graph discovery smoke passed: ${results.length} route/viewport states; report ${reportPath}`);
