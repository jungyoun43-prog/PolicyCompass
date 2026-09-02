import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parseEmrFhirBundle } from "../src/emr-fhir.js";
import { createClinicalBodyAtlas, createDemoEmrState } from "../src/emr-model.js";
import { startManagedAppServer } from "./browser-smoke-harness.mjs";

/**
 * End-to-end EMR smoke against the React workspace: demo chart, body map,
 * claims board, FHIR import, demographics, the encounter lifecycle through the
 * entry dialogs and sign-off review, chart entries, hostile text, storage
 * failure, backup export/restore guards, corrupt-storage recovery and the
 * full wipe across tabs. Runs `next start` itself unless EMR_URL/APP_URL points
 * at a server that is already up.
 */
const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const debugPort = Number.parseInt(process.env.CHROME_DEBUG_PORT ?? "9224", 10);
const [viewportWidth, viewportHeight] = (process.env.CHROME_WINDOW_SIZE ?? "1440,1100")
  .split(",")
  .map((value) => Number.parseInt(value, 10));
const koreaToday = new Date(Date.now() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
const reportPath = process.env.EMR_SMOKE_REPORT ?? join("artifacts", "smoke", "emr-smoke-report.json");
const STORAGE_KEY = "policycompass-emr-v2";

const app = await startManagedAppServer({
  appUrl: process.env.EMR_URL?.trim() || process.env.APP_URL?.trim() || "",
  healthPath: "/emr",
});
const appUrl = app.appUrl;
const profile = await mkdtemp(join(tmpdir(), "policycompass-emr-smoke-"));
const browser = spawn(chrome, [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-background-networking",
  `--window-size=${viewportWidth},${viewportHeight}`,
  "--remote-debugging-port=" + debugPort,
  "--user-data-dir=" + profile,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * React owns every form control, so values go in through the native setter
 * plus input/change events, tabs through the pointer events Radix listens to,
 * and files through a bubbling change event.
 */
const HELPERS = `(() => {
  if (window.__smoke) return;
  const setNative = (element, value) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  window.__smoke = {
    set(id, value) {
      const element = document.getElementById(id);
      if (!element) throw new Error('missing #' + id);
      setNative(element, value);
    },
    tab(key) {
      const trigger = document.getElementById('tab-' + key);
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      trigger.click();
    },
    file(id, name, text, type) {
      const input = document.getElementById(id);
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], name, { type }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    patient(name) {
      return [...document.querySelectorAll('[data-patient-id]')].find((button) => button.textContent.includes(name)) ?? null;
    },
    pick(listId, label) {
      const item = [...document.querySelectorAll('#' + listId + ' li')].find((li) => li.textContent.includes(label));
      if (!item) throw new Error('no search result for ' + label);
      item.querySelector('button').click();
    },
    text(id) {
      return document.getElementById(id)?.textContent ?? '';
    },
    state() {
      return JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}));
    },
    captureDownloads() {
      const OriginalBlob = window.Blob;
      const originalClick = HTMLAnchorElement.prototype.click;
      const parts = [];
      window.Blob = class extends OriginalBlob {
        constructor(blobParts, options) {
          super(blobParts, options);
          parts.push(blobParts.map(String).join(''));
        }
      };
      HTMLAnchorElement.prototype.click = function () {};
      return () => {
        window.Blob = OriginalBlob;
        HTMLAnchorElement.prototype.click = originalClick;
        return parts;
      };
    },
  };
})();`;

async function waitForEndpoint() {
  const endpoint = "http://127.0.0.1:" + debugPort + "/json/version";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error("Chrome DevTools endpoint did not start.");
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }

  async call(method, params = {}) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

/** Expectations come from the same fixture and classifier the app renders. */
const demoState = createDemoEmrState();
const demoPatient = demoState.patients.find(({ mrn }) => mrn === "PC-1001");
const demoAtlas = createClinicalBodyAtlas(demoPatient);
const areaIds = (predicate) => demoAtlas.areas.filter(predicate).map(({ id }) => id).sort();
const expectedBodyMap = {
  careAreaIds: areaIds((area) => area.careActive),
  candidateAreaIds: areaIds((area) => area.candidateActive),
  candidateOnlyAreaIds: areaIds((area) => area.candidateOnly),
  signalAreaIds: areaIds((area) => area.signalActive),
  signalOnlyAreaIds: areaIds((area) => area.signalOnly),
  careCount: `${demoAtlas.totals.careAreas}개`,
  signalCount: `${demoAtlas.totals.signalAreas}개`,
  visitCount: `${demoAtlas.totals.visits}건`,
  medicationCount: `${demoAtlas.totals.medications}건`,
  unassignedCount: `${demoAtlas.totals.unassignedMedications}건`,
};
const careArea = demoAtlas.areas.find((area) => area.careActive && area.visits.length);
assert(careArea, "Demo fixture no longer has a department-confirmed visit to drive the body map with.");
const otherArea = demoAtlas.areas.find((area) => area.id !== careArea.id);

let client;
const extraClients = [];
let demoClaimCards = 0;
let aiMode = "rule-based";
try {
  await waitForEndpoint();
  const targetResponse = await fetch(
    "http://127.0.0.1:" + debugPort + "/json/new?" + encodeURIComponent(appUrl + "/emr?demo=1"),
    { method: "PUT" },
  );
  const target = await targetResponse.json();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });

  async function evaluate(expression, targetClient = client) {
    const response = await targetClient.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description
        ?? response.exceptionDetails.text
        ?? "Browser evaluation failed.");
    }
    return response.result.value;
  }

  async function waitFor(expression, message, targetClient = client) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        if (await evaluate(expression, targetClient)) return;
      } catch {
        // Navigation may replace the execution context between polls.
      }
      await delay(100);
    }
    const diagnostic = await evaluate(`JSON.stringify({
      workspace: document.getElementById('workspaceStatus')?.textContent || '',
      encounter: document.getElementById('encounterFormMessage')?.textContent || '',
      patient: document.getElementById('patientFormMessage')?.textContent || '',
      event: document.getElementById('eventFormMessage')?.textContent || ''
    })`, targetClient).catch(() => "");
    throw new Error(`${message}${diagnostic ? ` ${diagnostic}` : ""}`);
  }

  async function openPage(url) {
    const response = await fetch(
      "http://127.0.0.1:" + debugPort + "/json/new?" + encodeURIComponent(url),
      { method: "PUT" },
    );
    const page = await response.json();
    const pageClient = new CdpClient(page.webSocketDebuggerUrl);
    extraClients.push(pageClient);
    await pageClient.call("Page.enable");
    await pageClient.call("Runtime.enable");
    await pageClient.call("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
    await waitFor(
      "document.readyState === 'complete' && Boolean(document.getElementById('workspaceStatus'))",
      "Additional EMR tab did not become ready.",
      pageClient,
    );
    await evaluate(HELPERS, pageClient);
    return pageClient;
  }

  const setViewport = (width, height) => client.call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 620,
  });
  const settleFrame = () => evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const fileImport = (inputId, name, payload, type = "application/fhir+json") => evaluate(
    `__smoke.file(${JSON.stringify(inputId)}, ${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(payload))}, ${JSON.stringify(type)})`,
  );
  const openEntryDialog = async (name) => {
    await evaluate(`document.getElementById('open${name}Dialog').click()`);
    await waitFor(`Boolean(document.getElementById('${name.toLowerCase()}Dialog'))`, `${name} dialog did not open.`);
  };
  const closeEntryDialog = async (name) => {
    await evaluate("document.querySelector('.rx-dialog__close').click()");
    await waitFor(`!document.getElementById('${name.toLowerCase()}Dialog')`, `${name} dialog did not close.`);
  };

  // --- Demo workspace -------------------------------------------------------
  await waitFor("document.getElementById('selectedPatientName')?.textContent === '김비타'", "Demo patient did not render.");
  await evaluate(HELPERS);
  assert(await evaluate("document.getElementById('workspaceContent') !== null && document.getElementById('patientListEmpty').hidden === true"), "Selected patient workspace stayed hidden.");
  assert(await evaluate("document.getElementById('exitDemo').hidden === false && document.getElementById('lastSavedAt') === null"), "Demo controls did not reflect demo state.");
  if (process.env.EMR_SCREENSHOT) {
    await setViewport(viewportWidth, viewportHeight);
    await settleFrame();
    const screenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(process.env.EMR_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }

  await waitFor("!document.getElementById('aiStatusDetail')?.textContent.includes('확인 중')", "AI capability check did not finish.");
  await evaluate("__smoke.tab('overview')");
  await evaluate([
    "window.__clinicalPosts = []",
    "window.__originalFetch = window.fetch.bind(window)",
    "window.fetch = (input, init = {}) => { if ((init.method || 'GET').toUpperCase() === 'POST' && String(input).includes('/api/clinical-copilot')) window.__clinicalPosts.push(init.body || ''); return window.__originalFetch(input, init); }",
    "document.getElementById('runCopilot').click()",
  ].join(";"));
  const aiConnected = await evaluate("document.querySelector('.header-ai-status')?.dataset.aiMode === 'local'");
  await waitFor(aiConnected
    ? "document.getElementById('runCopilot').disabled === false && document.getElementById('copilotMode').textContent === '로컬 AI' && window.__clinicalPosts.length === 1"
    : "document.getElementById('runCopilot').disabled === false && document.getElementById('workspaceStatus').textContent.includes('전송하지 않았습니다')",
  "Initial copilot run did not settle.");
  const clinicalPosts = await evaluate("window.__clinicalPosts");
  if (aiConnected) {
    aiMode = "local-model";
    assert(clinicalPosts.length === 1, "Configured local AI did not receive exactly one request.");
    assert(!/김비타|PC-1001/.test(clinicalPosts[0]), "AI request exposed direct identifiers.");
    assert(/event-1/.test(clinicalPosts[0]), "AI request did not pseudonymize event identifiers.");

    await evaluate([
      "window.__raceFetch = window.fetch",
      "window.__releaseCopilot = null",
      "window.fetch = (input, init = {}) => {",
      "  const pending = window.__raceFetch(input, init)",
      "  if ((init.method || 'GET').toUpperCase() !== 'POST' || !String(input).includes('/api/clinical-copilot')) return pending",
      "  return new Promise((resolve, reject) => pending.then((response) => { window.__releaseCopilot = () => resolve(response); }, reject))",
      "}",
      "document.getElementById('runCopilot').click()",
    ].join(";"));
    await waitFor("typeof window.__releaseCopilot === 'function'", "Delayed local AI response did not arrive.");
    await evaluate([
      "__smoke.tab('chart')",
      "window.confirm = () => true",
      "window.prompt = () => '스모크 차트 정정'",
      "document.querySelector('#eventTimeline .event-remove').click()",
    ].join(";"));
    await waitFor("document.getElementById('workspaceStatus').textContent.includes('예시 환자 변경은 저장되지 않습니다')", "Chart mutation during the local AI request did not apply.");
    await evaluate("window.__releaseCopilot(); window.fetch = window.__raceFetch");
    await waitFor("document.getElementById('workspaceStatus').textContent.includes('오래된 로컬 AI 초안을 폐기')", "Stale local AI response was not discarded after a chart mutation.");
    assert(await evaluate("document.getElementById('copilotMode').textContent === '규칙 기반'"), "Stale local AI response replaced the current rule-based brief.");
    await evaluate("__smoke.tab('overview')");
  } else {
    assert(clinicalPosts.length === 0, "Rule-based mode sent a clinical POST.");
  }

  // Arrow keys move focus and selection together (automatic activation);
  // Radix only selects on a real key event, so it goes through CDP.
  await waitFor("(() => { const tab = document.getElementById('tab-overview'); tab.focus(); return document.activeElement === tab; })()", "Overview tab did not take focus.");
  for (const type of ["keyDown", "keyUp"]) {
    await client.call("Input.dispatchKeyEvent", { type, key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  }
  await waitFor("document.activeElement === document.getElementById('tab-chart') && document.getElementById('tab-chart').getAttribute('aria-selected') === 'true'", "Arrow-key tab navigation did not move focus and selection to the next tab.");

  // --- Clinical body map ----------------------------------------------------
  await evaluate("__smoke.tab('graph')");
  await waitFor(
    "document.getElementById('panel-graph').hidden === false && document.querySelectorAll('.body-hotspot[data-body-area]').length === 12 && document.querySelectorAll('.body-caption[data-body-area]').length === 12",
    "Clinical body map did not render its twelve departments.",
  );
  const bodyMap = await evaluate(`(() => {
    const ids = (selector) => [...new Set([...document.querySelectorAll(selector)].map(({ dataset }) => dataset.bodyArea))].sort();
    const hotspots = [...document.querySelectorAll('.body-hotspot[data-body-area]')];
    const captions = [...document.querySelectorAll('.body-caption[data-body-area]')];
    return {
      tabLabel: document.getElementById('tab-graph').textContent.trim(),
      hotspotIds: hotspots.map(({ dataset }) => dataset.bodyArea),
      captionIds: captions.map(({ dataset }) => dataset.bodyArea),
      careAreaIds: ids('[data-body-area].is-care-record'),
      candidateAreaIds: ids('[data-body-area].is-classification-candidate'),
      candidateOnlyAreaIds: ids('[data-body-area].is-candidate-only'),
      signalAreaIds: ids('[data-body-area].is-condition-signal'),
      signalOnlyAreaIds: ids('[data-body-area].is-signal-only'),
      careCount: __smoke.text('bodyAreaCount').trim(),
      signalCount: __smoke.text('bodySignalAreaCount').trim(),
      visitCount: __smoke.text('bodyVisitCount').trim(),
      medicationCount: __smoke.text('bodyMedicationCount').trim(),
      unassignedCount: __smoke.text('bodyUnassignedMedicationCount').trim(),
      legend: document.querySelector('.clinical-body-key').textContent.replace(/\\s+/g, ' ').trim(),
    };
  })()`);
  assert(bodyMap.tabLabel === "신체 지도", `Clinical body-map tab label drifted: ${JSON.stringify(bodyMap)}`);
  assert(new Set(bodyMap.hotspotIds).size === 12
    && JSON.stringify(bodyMap.hotspotIds) === JSON.stringify(bodyMap.captionIds),
  `Body hotspot and caption department identities diverged: ${JSON.stringify(bodyMap)}`);
  for (const key of Object.keys(expectedBodyMap)) {
    assert(JSON.stringify(bodyMap[key]) === JSON.stringify(expectedBodyMap[key]),
      `Body map ${key} drifted from the demo fixture classification: rendered ${JSON.stringify(bodyMap[key])}, expected ${JSON.stringify(expectedBodyMap[key])}`);
  }
  assert(/진료 기록 연결/.test(bodyMap.legend)
    && /진료명 기반 분류 후보/.test(bodyMap.legend)
    && /질환 기반 탐색 영역 · 진료 이력 아님/.test(bodyMap.legend),
  `Body-map legend did not distinguish care, label candidates, and condition-derived signals: ${bodyMap.legend}`);

  await evaluate(`document.querySelector('.body-hotspot[data-body-area="${careArea.id}"]').click()`);
  await waitFor(`document.getElementById('bodyDetailTitle').textContent.trim() === ${JSON.stringify(careArea.title)}`, "Care-area selection did not update the detail heading.");
  const areaDetail = await evaluate(`(() => ({
    department: __smoke.text('bodyDetailDepartment').trim(),
    count: __smoke.text('bodyDetailCount').trim(),
    visitRecords: document.querySelectorAll('#bodyVisitList .clinical-body-record').length,
    visitGroupLabels: [...document.querySelectorAll('#bodyVisitList .clinical-body-list-group-label')].map((node) => node.textContent.replace(/\\s+/g, ' ').trim()),
    visitStatuses: [...document.querySelectorAll('#bodyVisitList .clinical-body-record__status')].map((node) => node.textContent.trim()),
    medicationRecords: document.querySelectorAll('#bodyMedicationList .clinical-body-record').length,
    conditionRecords: document.querySelectorAll('#bodyConditionList .clinical-body-record').length,
    boundary: __smoke.text('bodyDetailBoundary').replace(/\\s+/g, ' ').trim(),
    projection: __smoke.text('bodyProjectionNotice').replace(/\\s+/g, ' ').trim(),
    selectedAreas: [...document.querySelectorAll('[data-body-area][aria-pressed="true"]')].map(({ dataset }) => dataset.bodyArea),
  }))()`);
  const expectedGroupLabels = [
    careArea.visits.some(({ association }) => association.kind === "declared") ? "진료과 필드로 확인" : "",
    careArea.visits.some(({ association }) => association.kind === "classified") ? "진료명 기반 분류 후보 · 진료과 이력 확정 아님" : "",
  ].filter(Boolean);
  assert(areaDetail.department === careArea.department
    && areaDetail.count === `${careArea.visits.length + careArea.medications.length + careArea.conditions.length}건`
    && areaDetail.visitRecords === careArea.visits.length
    && JSON.stringify(areaDetail.visitGroupLabels) === JSON.stringify(expectedGroupLabels)
    && JSON.stringify(areaDetail.visitStatuses) === JSON.stringify(careArea.visits.map(({ lifecycleLabel }) => lifecycleLabel))
    && areaDetail.medicationRecords === careArea.medications.length
    && areaDetail.conditionRecords === careArea.conditions.length,
  `Selected department detail did not mirror the fixture atlas for ${careArea.id}: ${JSON.stringify(areaDetail)}`);
  assert(/약물은 같은 진료 ID가 있을 때만/.test(areaDetail.boundary)
    && (demoAtlas.totals.unassignedMedications === 0 || new RegExp(`진료과 연결 정보가 없는 약물 ${demoAtlas.totals.unassignedMedications}건`).test(areaDetail.boundary))
    && new RegExp(`진료과 필드로 확인된 진료 ${demoAtlas.totals.declaredVisits}건을 ${demoAtlas.totals.careAreas}개 영역`).test(areaDetail.projection)
    && new RegExp(`질환 기반 탐색 영역 ${demoAtlas.totals.signalAreas}개는 진료 이력과 분리`).test(areaDetail.projection),
  `Care, candidate, signal, or unassigned-medication boundaries were not disclosed: ${JSON.stringify(areaDetail)}`);
  assert(areaDetail.selectedAreas.length === 2 && areaDetail.selectedAreas.every((areaId) => areaId === careArea.id),
    `Hotspot and caption selection state diverged: ${JSON.stringify(areaDetail.selectedAreas)}`);

  await setViewport(390, 844);
  await settleFrame();
  await evaluate(`document.querySelector('.body-caption[data-body-area="${otherArea.id}"]').click(); document.querySelector('.body-caption[data-body-area="${careArea.id}"]').click()`);
  const narrowBodyMap = await evaluate(`(() => {
    const workspace = document.querySelector('.clinical-body-workspace').getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      workspaceLeft: workspace.left,
      workspaceRight: workspace.right,
      selectedAreas: [...document.querySelectorAll('[data-body-area][aria-pressed="true"]')].map(({ dataset }) => dataset.bodyArea),
      detailTitle: __smoke.text('bodyDetailTitle').trim(),
    };
  })()`);
  assert(narrowBodyMap.documentWidth <= narrowBodyMap.viewportWidth
    && narrowBodyMap.workspaceLeft >= -1
    && narrowBodyMap.workspaceRight <= narrowBodyMap.viewportWidth + 1,
  `Narrow clinical body map overflowed its viewport: ${JSON.stringify(narrowBodyMap)}`);
  assert(narrowBodyMap.detailTitle === careArea.title
    && narrowBodyMap.selectedAreas.length === 2
    && narrowBodyMap.selectedAreas.every((areaId) => areaId === careArea.id),
  `Narrow clinical body-map selection did not remain synchronized: ${JSON.stringify(narrowBodyMap)}`);
  await setViewport(viewportWidth, viewportHeight);
  await settleFrame();

  const sourceVisit = careArea.visits[0];
  await evaluate("document.querySelector('#bodyVisitList .clinical-body-record__action').click()");
  await waitFor(
    `document.getElementById('tab-chart').getAttribute('aria-selected') === 'true' && document.activeElement === document.querySelector('[data-event-id=${JSON.stringify(sourceVisit.id)}]')`,
    "Body-map source record did not open its chart row with focus.",
  );

  await evaluate("__smoke.tab('claims')");
  await waitFor("document.querySelectorAll('#claimBoard [data-claim-review-lane]').length === 4 && document.querySelectorAll('#claimResultSummary .claim-result-chip').length === 6", "Claim review lanes or immutable calculated-result summary did not render.");
  demoClaimCards = await evaluate("document.querySelectorAll('#claimBoard .claim-card').length");
  assert(demoClaimCards >= 3, "Claim evaluations did not render.");

  // --- Empty local record and FHIR import ------------------------------------
  // A first visit lands on the sample chart; 내 로컬 기록으로 opens the (empty) real one.
  await client.call("Page.navigate", { url: appUrl + "/emr" });
  await waitFor("location.pathname === '/emr' && location.search === '' && document.getElementById('selectedPatientName')?.textContent === '김비타'", "EMR did not become ready after navigation.");
  await evaluate("document.getElementById('exitDemo').click()");
  await waitFor("document.getElementById('patientListEmpty').hidden === false && document.getElementById('selectedPatientName') === null && Boolean(document.getElementById('patientBirthDate')?.max)", "Empty local record did not open after leaving the demo.");

  const fhirBundle = {
    resourceType: "Bundle",
    type: "collection",
    timestamp: "2026-07-19T09:00:00Z",
    entry: [
      {
        fullUrl: "Patient/smoke-fhir",
        resource: {
          resourceType: "Patient",
          id: "smoke-fhir",
          identifier: [{ value: "FHIR-SMOKE-001" }],
          name: [{ text: "FHIR 스모크 환자" }],
          birthDate: "1980-02-03",
          gender: "female",
        },
      },
      {
        fullUrl: "Observation/smoke-observation",
        resource: {
          resourceType: "Observation",
          id: "smoke-observation",
          subject: { reference: "Patient/smoke-fhir" },
          status: "final",
          code: { coding: [{ system: "http://loinc.org", code: "85354-9", display: "혈압" }] },
          component: [
            {
              code: { coding: [{ system: "http://loinc.org", code: "8480-6", display: "수축기 혈압" }] },
              valueQuantity: { value: 118, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
            },
            {
              code: { coding: [{ system: "http://loinc.org", code: "8462-4", display: "이완기 혈압" }] },
              valueQuantity: { value: 76, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
            },
          ],
          effectiveDateTime: "2026-07-19",
        },
      },
      {
        fullUrl: "Encounter/smoke-external-encounter",
        resource: {
          resourceType: "Encounter",
          id: "smoke-external-encounter",
          subject: { reference: "Patient/smoke-fhir" },
          status: "finished",
          class: { code: "AMB", display: "외래" },
          period: { start: `${koreaToday}T09:00:00+09:00`, end: `${koreaToday}T09:20:00+09:00` },
        },
      },
    ],
  };
  const fhirProvenance = parseEmrFhirBundle(fhirBundle).provenance;
  await fileImport("fhirImport", "smoke-fhir.json", fhirBundle);
  await waitFor("document.getElementById('selectedPatientName')?.textContent === 'FHIR 스모크 환자'", "FHIR patient did not import through the UI.");
  assert(await evaluate(`document.getElementById('fhirImportReportSummary').textContent.includes('지원 ${fhirProvenance.supported}건 · 제외 ${fhirProvenance.unsupported}건')`), "FHIR import report did not show the parser's supported/unsupported counts.");
  assert(await evaluate("__smoke.patient('FHIR 스모크 환자')?.textContent.includes('외부 완료·미검증')"), "External FHIR encounter was mislabeled as locally signed in the patient queue.");
  await fileImport("fhirImport", "smoke-fhir.json", fhirBundle);
  await waitFor("document.getElementById('workspaceStatus')?.textContent.includes('이미 있습니다')", "Duplicate FHIR identity was not rejected.");
  assert(await evaluate("__smoke.state().patients.length === 1"), "Duplicate FHIR import added another patient.");

  // --- Demographics ---------------------------------------------------------
  await evaluate([
    "__smoke.set('patientMrn', 'SMOKE-001')",
    "__smoke.set('patientName', '브라우저 테스트 환자')",
    "__smoke.set('patientBirthDate', '1990-01-02')",
    "__smoke.set('patientSex', 'female')",
    "__smoke.set('patientPhone', '010-1234-5678')",
    "__smoke.set('patientAddress', '서울특별시 테스트구')",
    "__smoke.set('patientBloodType', 'A+')",
    "__smoke.set('patientInsuranceType', 'national-health')",
    "__smoke.set('patientEmergencyName', '보호자 테스트')",
    "__smoke.set('patientEmergencyRelation', '배우자')",
    "__smoke.set('patientEmergencyPhone', '010-9999-0000')",
    "__smoke.set('patientMemo', '통화 후 방문')",
    "document.getElementById('patientForm').requestSubmit()",
  ].join(";"));
  await waitFor("document.getElementById('selectedPatientName')?.textContent === '브라우저 테스트 환자'", "New patient did not become active.");
  assert(await evaluate(`(() => {
    const patient = __smoke.state().patients.find(({ mrn }) => mrn === 'SMOKE-001');
    return patient.birthDate === '1990-01-02'
      && patient.sex === 'female'
      && patient.phone === '010-1234-5678'
      && patient.address === '서울특별시 테스트구'
      && patient.bloodType === 'A+'
      && patient.insuranceType === 'national-health'
      && patient.emergencyContact.name === '보호자 테스트'
      && patient.emergencyContact.relation === '배우자'
      && patient.emergencyContact.phone === '010-9999-0000'
      && patient.memo === '통화 후 방문';
  })()`), "Patient demographics did not persist completely.");
  await evaluate("document.getElementById('editPatient').click()");
  await waitFor("document.getElementById('patientComposer').open === true && document.getElementById('patientMrn').value === 'SMOKE-001' && document.getElementById('cancelPatientEdit').hidden === false", "Edit request did not load the selected patient into the composer.");
  await evaluate("document.getElementById('cancelPatientEdit').click()");
  await waitFor("document.getElementById('patientMrn').value === '' && document.getElementById('cancelPatientEdit').hidden === true", "Cancelling the edit did not reset the composer.");

  // --- Encounter lifecycle --------------------------------------------------
  await evaluate("__smoke.tab('encounter'); document.getElementById('checkInPatient').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '대기'", "Patient check-in did not create a waiting encounter.");
  await evaluate("document.getElementById('startEncounter').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '진료 중'", "Encounter did not start.");
  await waitFor("document.activeElement === document.getElementById('soapSubjective')", "Encounter start did not focus the SOAP note.");
  assert(await evaluate("document.querySelector('[data-workflow-disclosure=\"visit-context\"]')?.open === false"), "Visit context did not stay collapsed by default.");
  await evaluate([
    "__smoke.set('encounterDepartment', '내과')",
    "__smoke.set('encounterClinician', '스모크 의사')",
    "__smoke.set('encounterRoom', '1진료실')",
    "__smoke.set('chiefComplaint', '두통과 혈압 상승')",
    "__smoke.set('soapSubjective', '3일 전부터 간헐적 두통을 호소함')",
    "__smoke.set('soapAssessment', '본태성 고혈압 의심')",
    "__smoke.set('soapPlan', '약물치료와 혈액검사 후 30일 뒤 추적')",
  ].join(";"));
  const dirtyExitGuard = await evaluate("window.dispatchEvent(new Event('beforeunload', { cancelable: true }))");
  assert(dirtyExitGuard === false, "Dirty SOAP did not activate the page-exit confirmation boundary.");
  const supplementalFhirBundle = {
    resourceType: "Bundle",
    type: "collection",
    entry: [{
      fullUrl: "Patient/smoke-fhir-supplemental",
      resource: { resourceType: "Patient", id: "smoke-fhir-supplemental", name: [{ text: "FHIR 추가 환자" }] },
    }],
  };
  await fileImport("fhirImport", "smoke-fhir-supplemental.json", supplementalFhirBundle);
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('입력을 지운 뒤')", "FHIR import over an unsaved SOAP draft was not refused.");
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자' && document.getElementById('soapPlan').value.includes('30일 뒤 추적') && __smoke.state().patients.length === 2"), "Refused FHIR import discarded the SOAP draft or imported anyway.");
  await evaluate("document.getElementById('encounterForm').requestSubmit()");
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('초안을 저장')", "SOAP draft did not save.");
  const cleanExitGuard = await evaluate("window.dispatchEvent(new Event('beforeunload', { cancelable: true }))");
  assert(cleanExitGuard === true, "Saved SOAP still activated the page-exit confirmation boundary.");
  await fileImport("fhirImport", "smoke-fhir-supplemental.json", supplementalFhirBundle);
  await waitFor("document.getElementById('selectedPatientName')?.textContent === 'FHIR 추가 환자'", "FHIR import did not finish once the SOAP draft was saved.");
  await evaluate("__smoke.patient('브라우저 테스트 환자').click()");
  await waitFor("document.getElementById('selectedPatientName')?.textContent === '브라우저 테스트 환자' && document.getElementById('soapPlan').value.includes('30일 뒤 추적') && document.getElementById('encounterStatusText').textContent === '진료 중'", "Saved SOAP draft did not restore after returning from the FHIR patient.");

  // Pending dialog input blocks patient switches, cancellation, and completion.
  await openEntryDialog("Diagnosis");
  await evaluate("__smoke.set('diagnosisLabel', '환자 전환 전 미추가 진단')");
  await closeEntryDialog("Diagnosis");
  await evaluate("__smoke.patient('FHIR 추가 환자').click()");
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('현재 진료에 추가')", "Patient switching did not block a pending clinical item.");
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'"), "Patient switching ignored the pending clinical item.");
  await evaluate([
    "window.__smokeOriginalPrompt = window.prompt",
    "window.__cancelPromptCalls = 0",
    "window.prompt = () => { window.__cancelPromptCalls += 1; return '취소되면 안 됨'; }",
    "document.getElementById('cancelEncounter').click()",
  ].join(";"));
  await delay(200);
  assert(await evaluate("window.__cancelPromptCalls === 0 && document.getElementById('encounterStatusText').textContent === '진료 중'"), "Encounter cancellation discarded pending clinical composer input.");
  await evaluate("window.prompt = window.__smokeOriginalPrompt; delete window.__smokeOriginalPrompt");
  await openEntryDialog("Diagnosis");
  assert(await evaluate("document.getElementById('diagnosisLabel').value === '환자 전환 전 미추가 진단'"), "Reopening the dialog lost the pending composer input.");
  await evaluate("__smoke.set('diagnosisLabel', '')");
  await closeEntryDialog("Diagnosis");
  await evaluate("__smoke.tab('chart'); __smoke.set('eventLabel', '환자 전환 전 미추가 과거기록'); __smoke.patient('FHIR 추가 환자').click()");
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('과거 기록')", "Patient switching did not block a pending historical-event form.");
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자' && document.getElementById('eventLabel').value.includes('미추가 과거기록')"), "Patient switching ignored the pending historical-event form.");
  await evaluate("__smoke.set('eventLabel', ''); __smoke.patient('FHIR 추가 환자').click()");
  await waitFor("document.getElementById('selectedPatientName').textContent === 'FHIR 추가 환자'", "Patient switching stayed blocked after the pending input was cleared.");
  await evaluate("__smoke.patient('브라우저 테스트 환자').click()");
  await waitFor("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'", "Could not return after the clinical composer attribution test.");

  // Diagnosis, prescription and order come from their catalogue dialogs.
  await evaluate("__smoke.tab('encounter')");
  await openEntryDialog("Diagnosis");
  await evaluate("__smoke.set('diagnosisSearchInput', '고혈압')");
  await waitFor("[...document.querySelectorAll('#diagnosisResultList li')].some((li) => li.textContent.includes('본태성 고혈압'))", "Diagnosis search did not list 본태성 고혈압.");
  await evaluate("__smoke.pick('diagnosisResultList', '본태성 고혈압')");
  await waitFor("document.getElementById('diagnosisCode').value === 'I10' && document.getElementById('diagnosisSystem').value === 'urn:kr:kcd'", "Picking the diagnosis did not fix its KCD code.");
  await evaluate("document.getElementById('diagnosisForm').requestSubmit()");
  await waitFor("document.getElementById('diagnosisList').textContent.includes('고혈압') && document.getElementById('diagnosisList').textContent.includes('I10')", "Encounter diagnosis did not render.");
  assert(await evaluate("!document.getElementById('diagnosisDialog') && document.getElementById('encounterMobileClaimSummary').textContent.includes('예비판정')"), "Diagnosis dialog stayed open or the claim preflight did not reflect the draft.");

  await openEntryDialog("Prescription");
  await evaluate("__smoke.set('medicationSearchInput', '벤라')");
  await waitFor("[...document.querySelectorAll('#medicationResultList li')].some((li) => li.textContent.includes('벤라리주맙'))", "Medication search did not list 벤라리주맙.");
  await evaluate("__smoke.pick('medicationResultList', '벤라리주맙')");
  await waitFor("document.getElementById('medicationName').value.includes('벤라리주맙') && document.getElementById('medicationDose').value !== ''", "Picking the medication did not fill its default dosing.");
  await evaluate("document.getElementById('prescriptionForm').requestSubmit()");
  await waitFor("document.getElementById('prescriptionList').textContent.includes('벤라리주맙')", "Encounter prescription did not render.");

  await openEntryDialog("Order");
  await evaluate("__smoke.set('orderSearchInput', 'CBC')");
  await waitFor("[...document.querySelectorAll('#orderResultList li')].some((li) => li.textContent.includes('CBC'))", "Order search did not list the CBC panel.");
  await evaluate("__smoke.pick('orderResultList', 'CBC')");
  await waitFor("document.getElementById('orderLabel').value.includes('CBC')", "Picking the order did not fill the form.");
  await evaluate("document.getElementById('orderForm').requestSubmit()");
  await waitFor("document.getElementById('orderList').textContent.includes('CBC')", "Encounter order did not render.");

  // Sign-off review: missing Objective blocks, correction reopens, ack gates.
  await evaluate("document.getElementById('completeEncounter').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '서명 대기'", "Encounter did not complete.");
  assert(await evaluate(`document.getElementById('signEncounter').disabled
    && document.getElementById('encounterSignReviewAcknowledged').disabled
    && document.getElementById('encounterSignReviewContent').textContent.includes('SOAP Objective가 비어 있습니다.')
    && document.getElementById('encounterSignReviewContent').textContent.includes('브라우저 테스트 환자')
    && document.getElementById('encounterSignReviewContent').textContent.includes('SMOKE-001')`), "Incomplete pre-sign review did not block acknowledgement and signature with the current patient context.");
  await evaluate("document.querySelector('.sign-review__finding button').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '진료 중'", "Pre-sign correction did not reopen the Encounter.");
  await waitFor("document.activeElement === document.getElementById('soapObjective')", "Pre-sign correction did not focus the missing SOAP field.");
  await evaluate("__smoke.set('soapObjective', '혈압 150/95 mmHg'); document.getElementById('completeEncounter').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '서명 대기'", "Corrected Encounter did not return to pre-sign review.");
  assert(await evaluate(`!document.getElementById('encounterSignReviewAcknowledged').disabled
    && !document.getElementById('encounterSignReviewAcknowledged').checked
    && document.getElementById('signEncounter').disabled
    && document.getElementById('encounterSignReviewContent').textContent.includes('혈압 150/95 mmHg')`), "Signature became available before explicit review acknowledgement.");
  await evaluate("document.getElementById('encounterSignReviewAcknowledged').click()");
  await waitFor("document.getElementById('signEncounter').disabled === false", "Explicit review acknowledgement did not enable signature.");
  // Confirming a new allergy from the chart changes the reviewed content.
  await evaluate("__smoke.tab('chart'); __smoke.set('eventType', 'allergy'); __smoke.set('eventLabel', '라텍스'); document.getElementById('eventForm').requestSubmit()");
  await waitFor("[...document.querySelectorAll('#eventTimeline .event-row')].some((row) => row.textContent.includes('라텍스'))", "Chart allergy draft did not render.");
  await evaluate("window.confirm = () => true; [...document.querySelectorAll('#eventTimeline .event-row')].find((row) => row.textContent.includes('라텍스')).querySelector('.event-confirm').click()");
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('검토 완료 기록으로 확정')", "Chart allergy was not confirmed.");
  await evaluate("__smoke.tab('encounter')");
  await waitFor(`!document.getElementById('encounterSignReviewAcknowledged').checked
    && document.getElementById('signEncounter').disabled
    && document.getElementById('encounterSignReviewContent').textContent.includes('라텍스')`, "Changed review content did not invalidate the explicit acknowledgement.");
  await evaluate("document.getElementById('encounterSignReviewAcknowledged').click()");
  await waitFor("document.getElementById('signEncounter').disabled === false", "Re-reviewing changed content did not re-enable signature.");
  await evaluate("window.confirm = () => true; document.getElementById('signEncounter').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '완료·서명'", "Encounter did not sign.");
  assert(await evaluate(`(() => {
    const patient = __smoke.state().patients.find(({ mrn }) => mrn === 'SMOKE-001');
    const encounter = patient.events.find(({ type }) => type === 'encounter');
    const children = patient.events.filter(({ encounterId }) => encounterId === encounter.id);
    return encounter.recordStatus === 'final'
      && encounter.signature.status === 'signed'
      && children.length === 3
      && children.every(({ recordStatus }) => recordStatus === 'final')
      && document.getElementById('checkInPatient').hidden === false
      && document.getElementById('checkInPatient').textContent.includes('새 로컬 진료 접수');
  })()`), "Signed encounter or its diagnosis/prescription/order children were not finalized atomically.");

  // --- Chart entry and audit ------------------------------------------------
  await evaluate([
    "__smoke.tab('chart')",
    "__smoke.set('eventType', 'observation')",
    "__smoke.set('eventDate', '2026-07-19')",
    "__smoke.set('eventCode', 'SMOKE-BP')",
    "__smoke.set('eventLabel', '스모크 혈압')",
    "__smoke.set('eventValue', '120/80')",
    "__smoke.set('eventUnit', 'mmHg')",
    "document.getElementById('eventForm').requestSubmit()",
  ].join(";"));
  await waitFor("document.getElementById('eventTimeline').textContent.includes('스모크 혈압')", "Chart event did not render.");
  assert(await evaluate(`(() => {
    const actions = __smoke.state().audit.map(({ action }) => action);
    return ['fhir.imported', 'patient.created', 'encounter.checked-in', 'encounter.started', 'encounter.draft.saved', 'diagnosis.added', 'prescription.added', 'order.added', 'encounter.completed', 'encounter.reopened', 'patient.event.confirmed', 'encounter.signed', 'patient.event.added']
      .every((action) => actions.includes(action));
  })()`), "Audit trail missed a required patient, encounter, FHIR, or chart action.");

  // --- Hostile text and pending-input attribution ---------------------------
  await evaluate([
    "window.__xssExecuted = 0",
    "__smoke.set('patientMrn', '../SMOKE-XSS')",
    "__smoke.set('patientName', '<img src=x onerror=__xssExecuted=1>')",
    "__smoke.set('patientAgeYears', '47')",
    "__smoke.set('patientSex', 'male')",
    "__smoke.set('eventLabel', '새 환자 생성 전 미추가 과거기록')",
    "document.getElementById('patientForm').requestSubmit()",
  ].join(";"));
  await waitFor("document.getElementById('patientFormMessage').textContent.includes('미등록 임상 입력')", "New-patient creation did not refuse a pending historical-event form.");
  assert(await evaluate("!__smoke.state().patients.some(({ mrn }) => mrn === '../SMOKE-XSS') && document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자' && document.getElementById('eventLabel').value.includes('미추가 과거기록')"), "New-patient creation discarded or reattributed a pending historical-event form.");
  await evaluate("__smoke.set('eventLabel', ''); document.getElementById('patientForm').requestSubmit()");
  await waitFor("document.getElementById('selectedPatientName').textContent.includes('<img')", "Hostile-text patient creation stayed blocked after pending input was cleared.");
  assert(await evaluate("window.__xssExecuted === 0 && document.getElementById('selectedPatientName').querySelector('img') === null"), "Hostile patient text executed as markup.");
  assert(await evaluate("__smoke.state().patients.some(({ mrn, birthDate, ageYears, sex }) => mrn === '../SMOKE-XSS' && !birthDate && ageYears === 47 && sex === 'male')"), "Direct age or sex did not persist when birth date was unknown.");
  await evaluate("__smoke.patient('브라우저 테스트 환자').click()");
  await waitFor("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'", "Could not return to the smoke patient after hostile input test.");
  assert(await evaluate("__smoke.state().audit.filter(({ action }) => action === 'patient.created').length >= 2"), "Hostile-text patient creation was not audited.");

  // --- Storage failure stays atomic ----------------------------------------
  const stateBeforeFailure = await evaluate(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`);
  const recoveryBackup = JSON.stringify({
    schema: "policycompass-emr-backup",
    version: 2,
    exportedAt: "2026-07-19T10:00:00.000Z",
    data: JSON.parse(stateBeforeFailure),
  });
  await evaluate([
    "window.__storageSetItem = Storage.prototype.setItem",
    "Storage.prototype.setItem = () => { throw new DOMException('quota smoke', 'QuotaExceededError'); }",
    "__smoke.set('patientMrn', 'SMOKE-FAIL')",
    "__smoke.set('patientName', '저장 실패 환자')",
    "document.getElementById('patientForm').requestSubmit()",
  ].join(";"));
  await waitFor("document.getElementById('patientFormMessage').textContent.includes('quota smoke')", "Storage failure was not shown to the user.");
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'"), "Failed storage mutation changed visible patient state.");
  assert(await evaluate(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`) === stateBeforeFailure, "Failed storage mutation changed persisted state.");
  await evaluate("Storage.prototype.setItem = window.__storageSetItem; __smoke.set('patientMrn', ''); __smoke.set('patientName', '')");

  // --- Backup export/restore guards ----------------------------------------
  const lowRevisionBackup = JSON.parse(recoveryBackup);
  lowRevisionBackup.data.revision = 0;
  /** Clicks an export and reports the downloads it produced once the status settles. */
  const exportAttempt = async (buttonId, statusPattern, targetClient = client) => {
    await evaluate(`window.__finishExport = __smoke.captureDownloads(); document.getElementById(${JSON.stringify(buttonId)}).click()`, targetClient);
    await waitFor(`${JSON.stringify(statusPattern)}.split('|').some((part) => __smoke.text('workspaceStatus').includes(part))`, `Export ${buttonId} did not settle on a status matching ${statusPattern}.`, targetClient);
    return evaluate("(() => { const downloads = window.__finishExport(); delete window.__finishExport; return { downloads, status: __smoke.text('workspaceStatus') }; })()", targetClient);
  };

  await evaluate("__smoke.set('eventLabel', '내보내기 전 미추가 과거기록')");
  const blockedBackupExport = await exportAttempt("exportEmr", "미저장");
  assert(blockedBackupExport.downloads.length === 0, `Backup export ignored a pending chart entry: ${JSON.stringify(blockedBackupExport)}`);
  const revisionBeforeBlockedRestore = await evaluate("__smoke.state().revision");
  await evaluate("window.confirm = () => true");
  await fileImport("importEmr", "blocked-low-revision-backup.json", lowRevisionBackup, "application/json");
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('백업을 복원하세요')", "Backup restore did not refuse a pending chart entry.");
  assert(await evaluate(`document.getElementById('eventLabel').value === '내보내기 전 미추가 과거기록' && __smoke.state().revision === ${revisionBeforeBlockedRestore}`), "Backup restore discarded a pending clinical item or changed persisted state.");
  await evaluate("__smoke.set('eventLabel', '')");
  await fileImport("importEmr", "low-revision-backup.json", lowRevisionBackup, "application/json");
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('출처 미검증 상태로 복원')", "Normal backup restore did not finish.");
  assert(await evaluate(`__smoke.state().revision === ${JSON.parse(stateBeforeFailure).revision + 1}`), "Backup restore reused its historical revision and left an ABA window.");
  assert(await evaluate(`(() => {
    const restored = __smoke.state();
    const restoredRecords = restored.patients.flatMap(({ events }) => events);
    return restored.audit.length === 1
      && restored.audit[0].action === 'backup.restored'
      && restoredRecords.length > 0
      && restoredRecords.every(({ source }) => source.kind === 'import')
      && restoredRecords.filter(({ type, recordStatus }) => type === 'encounter' && recordStatus === 'final').every(({ signature }) => signature.status === 'external')
      && document.querySelectorAll('#eventTimeline .event-remove, #eventTimeline .event-confirm').length === 0
      && document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자';
  })()`), "Unsigned backup restored forged signatures, provenance, or audit history as trusted state.");

  // Another tab moving the revision forward blocks a stale export.
  await evaluate(`(() => {
    const persisted = __smoke.state();
    persisted.revision += 1;
    localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(persisted));
  })()`);
  const staleBackupExport = await exportAttempt("exportEmr", "다른 탭의 최신 변경");
  assert(staleBackupExport.downloads.length === 0, `Backup export emitted a stale cross-tab revision: ${JSON.stringify(staleBackupExport)}`);

  // --- Corrupt storage recovery --------------------------------------------
  const corruptRaw = "{corrupt-smoke";
  await evaluate(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(corruptRaw)})`);
  await client.call("Page.navigate", { url: appUrl + "/emr" });
  await waitFor("document.getElementById('workspaceStatus')?.textContent.includes('로컬 저장을 읽지 못했습니다')", "Corrupt storage recovery state did not render.");
  assert(await evaluate("document.getElementById('workspaceEmpty') !== null && document.getElementById('selectedPatientName') === null"), "Corrupt storage rendered a patient workspace.");
  await evaluate("window.confirm = () => true");
  await fileImport("importEmr", "recovery-backup.json", JSON.parse(recoveryBackup), "application/json");
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('출처 미검증 상태로 복원')", "Backup could not replace the corrupt storage source.");
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'"), "Recovered backup did not restore the selected patient.");
  assert(await evaluate("__smoke.state().revision > 1000000000000000"), "Corrupt-storage restore did not rotate the revision away from stale tabs.");

  // --- Full wipe across tabs -----------------------------------------------
  await evaluate("document.getElementById('checkInPatient').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '대기'", "Second visit did not check in before the wipe.");
  await evaluate("document.getElementById('startEncounter').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '진료 중'", "Second visit did not start before the wipe.");
  await evaluate("__smoke.set('soapSubjective', 'CROSS-TAB-DIRTY-SOAP-S'); __smoke.set('soapPlan', 'CROSS-TAB-DIRTY-SOAP-P')");

  const demoClient = await openPage(appUrl + "/emr?demo=1");
  await waitFor("document.getElementById('selectedPatientName')?.textContent === '김비타'", "Demo tab did not load before the wipe.", demoClient);

  const wipeClient = await openPage(appUrl + "/emr");
  await waitFor("document.getElementById('selectedPatientName')?.textContent === '브라우저 테스트 환자'", "Wipe tab did not load the selected patient.", wipeClient);
  await evaluate([
    "__smoke.tab('data')",
    "window.confirm = () => true",
    "document.getElementById('wipeEmr').click()",
  ].join(";"), wipeClient);
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('기록을 모두 삭제')", "Wipe tab did not finish the full deletion.", wipeClient);
  assert(await evaluate(`(() => {
    const text = ['patientList', 'workspaceStatus'].map((id) => __smoke.text(id)).join(' ');
    return document.getElementById('selectedPatientName') === null
      && document.getElementById('workspaceContent') === null
      && document.getElementById('patientListEmpty').hidden === false
      && !/브라우저 테스트 환자|SMOKE-001|본태성 고혈압|벤라리주맙/.test(text);
  })()`, wipeClient), "Full wipe left patient, diagnosis, or prescription PHI in the executing tab DOM.");
  assert(await evaluate(`(() => {
    const tombstone = __smoke.state();
    return tombstone.patients.length === 0
      && tombstone.audit.length === 0
      && tombstone.rules.every(({ sample }) => sample === true)
      && tombstone.revision > 1000000000000000
      && localStorage.getItem('policycompass-emr-v1') === null;
  })()`, wipeClient), "Full wipe retained clinical data or failed to preserve its anti-resurrection tombstone.");

  const wipedTabBackup = await exportAttempt("exportEmr", "JSON으로 내보냈습니다", wipeClient);
  const wipedTabFhir = await exportAttempt("exportFhir", "환자를 먼저 선택", wipeClient);
  assert(wipedTabBackup.downloads.length === 1 && wipedTabFhir.downloads.length === 0, `The cleared tab exported a patient FHIR bundle or refused the tombstone backup: ${JSON.stringify({ wipedTabBackup, wipedTabFhir })}`);
  const tombstoneBackup = JSON.parse(wipedTabBackup.downloads[0]);
  assert(!/브라우저 테스트 환자|SMOKE-001|CROSS-TAB-DIRTY-SOAP|김비타|PC-1001/.test(wipedTabBackup.downloads[0])
    && tombstoneBackup.data.patients.length === 0
    && tombstoneBackup.data.audit.length === 0
    && tombstoneBackup.data.rules.every(({ sample }) => sample === true),
  "The cleared tab's JSON backup was not the PHI-free tombstone.");

  // Tabs that still hold the pre-wipe chart in memory must not export it: the
  // dirty-form guard answers first, the tombstone guard once the form is clean.
  assert(await evaluate("document.getElementById('soapPlan').value === 'CROSS-TAB-DIRTY-SOAP-P'"), "The dirty SOAP draft was lost while the wipe happened elsewhere.");
  const dirtyTabExport = await exportAttempt("exportEmr", "미저장");
  assert(dirtyTabExport.downloads.length === 0, `The dirty SOAP tab exported over unsaved input: ${JSON.stringify(dirtyTabExport)}`);
  await evaluate("__smoke.set('soapSubjective', ''); __smoke.set('soapPlan', '')");
  for (const [label, staleClient] of [["primary", client], ["demo", demoClient]]) {
    const staleExport = await exportAttempt("exportEmr", "다른 탭에서 전체 삭제|미저장|백업했습니다|내보냈습니다", staleClient);
    assert(staleExport.downloads.length === 0 && staleExport.status.includes("다른 탭에서 전체 삭제"), `The ${label} tab exported stale patient data after the cross-tab wipe: ${JSON.stringify(staleExport)}`);
  }
  await evaluate("document.getElementById('exitDemo').click()", demoClient);
  await waitFor("document.getElementById('exitDemo').hidden === true", "Demo tab did not leave demo mode.", demoClient);
  await evaluate("document.getElementById('loadDemo').click()", demoClient);
  await waitFor("document.getElementById('selectedPatientName')?.textContent === '김비타'", "Demo tab did not reload the sample chart.", demoClient);
  const demoReloadExport = await exportAttempt("exportEmr", "다른 탭에서 전체 삭제|미저장|백업했습니다", demoClient);
  assert(demoReloadExport.downloads.length === 0 && demoReloadExport.status.includes("다른 탭에서 전체 삭제"), `Demo mode exported the pre-wipe savedState after a cross-tab wipe: ${JSON.stringify(demoReloadExport)}`);

  const result = {
    demoPatient: "김비타",
    bodyAreas: demoAtlas.totals.areas,
    bodyCareAreas: demoAtlas.totals.careAreas,
    bodyCandidateAreas: demoAtlas.totals.candidateAreas,
    bodySignalAreas: demoAtlas.totals.signalAreas,
    bodyVisits: careArea.visits.length,
    bodyMedications: careArea.medications.length,
    unassignedBodyMedications: demoAtlas.totals.unassignedMedications,
    claimLanes: 4,
    claimCards: demoClaimCards,
    persistedPatient: "SMOKE-001",
    persistedEvent: "SMOKE-BP",
    signedEncounter: true,
    entryDialogsUsed: ["diagnosis", "prescription", "order"],
    clinicalComposerAttributionGuard: true,
    fhirImported: "FHIR-SMOKE-001",
    aiMode,
    clinicalPosts: clinicalPosts.length,
    storageFailureAtomic: true,
    staleRevisionExportBlocked: true,
    corruptStorageBackupRestored: true,
    crossTabWipeBlockedStaleExports: true,
    hostileTextEscaped: true,
  };
  const temporaryReportPath = `${reportPath}.${process.pid}.tmp`;
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(temporaryReportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await rename(temporaryReportPath, reportPath);
  console.log(JSON.stringify(result));
} finally {
  client?.close();
  for (const extraClient of extraClients) extraClient.close();
  browser.kill("SIGTERM");
  if (browser.exitCode === null) {
    await Promise.race([once(browser, "exit"), delay(2_000)]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await app.stop();
}
