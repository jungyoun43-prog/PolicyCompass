import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const appUrl = process.env.EMR_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.CHROME_DEBUG_PORT ?? "9224", 10);
const [viewportWidth, viewportHeight] = (process.env.CHROME_WINDOW_SIZE ?? "1440,1100")
  .split(",")
  .map((value) => Number.parseInt(value, 10));
const koreaToday = new Date(Date.now() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
const profile = await mkdtemp(join(tmpdir(), "policycompass-emr-smoke-"));
const reportPath = process.env.EMR_SMOKE_REPORT ?? join("artifacts", "smoke", "emr-smoke-report.json");
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

let client;
const extraClients = [];
let demoBodyAreas = 0;
let demoBodyCareAreas = 0;
let demoBodyCandidateAreas = 0;
let demoBodySignalAreas = 0;
let demoBodyVisits = 0;
let demoBodyMedications = 0;
let demoClaimCards = 0;
let aiMode = "rule-based";
let aiRequestAbortedOnWipe = null;
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

  async function evaluate(expression, targetClient = client) {
    const response = await targetClient.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Browser evaluation failed.");
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
    await waitFor(
      "document.readyState === 'complete' && Boolean(document.getElementById('emrTitle'))",
      "Additional EMR tab did not become ready.",
      pageClient,
    );
    return pageClient;
  }

  await waitFor("document.getElementById('selectedPatientName')?.textContent === '김비타'", "Demo patient did not render.");
  assert(await evaluate("document.getElementById('workspaceContent').hidden === false"), "Selected patient workspace stayed hidden.");
  assert(await evaluate("document.getElementById('loadDemo').hidden === true"), "Demo controls did not reflect demo state.");
  if (process.env.EMR_SCREENSHOT) {
    await client.call("Emulation.setDeviceMetricsOverride", {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: viewportWidth <= 620,
    });
    await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const screenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(process.env.EMR_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }

  await waitFor("!document.getElementById('aiStatusLabel')?.textContent.includes('확인 중')", "AI capability check did not finish.");
  await evaluate([
    "window.__clinicalPosts = []",
    "window.__originalFetch = window.fetch.bind(window)",
    "window.fetch = (input, init = {}) => { if ((init.method || 'GET').toUpperCase() === 'POST' && String(input).includes('/api/clinical-copilot')) window.__clinicalPosts.push(init.body || ''); return window.__originalFetch(input, init); }",
    "document.getElementById('runCopilot').click()",
  ].join(";"));
  const aiConnected = await evaluate("document.getElementById('aiStatusLabel').textContent === '로컬 AI 연결'");
  await waitFor(aiConnected
    ? "document.getElementById('runCopilot').disabled === false && document.getElementById('copilotMode').textContent === '로컬 AI' && window.__clinicalPosts.length === 1"
    : "document.getElementById('runCopilot').disabled === false && document.getElementById('workspaceStatus').textContent.includes('전송하지 않았습니다')",
  "Initial copilot run did not settle.");
  const clinicalPosts = await evaluate("window.__clinicalPosts");
  if (aiConnected) {
    aiMode = "local-model";
    assert(clinicalPosts.length === 1, "Configured local AI did not receive exactly one request.");
    assert(!/김비타|PC-1001|혈압과 당화혈색소 추적/.test(clinicalPosts[0]), "AI request exposed direct identifiers or a free note.");
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
      "document.querySelector('[data-tab=\"chart\"]').click()",
      "window.confirm = () => true",
      "window.prompt = () => '스모크 차트 정정'",
      "document.querySelector('[data-remove-event]').click()",
      "window.__releaseCopilot()",
      "window.fetch = window.__raceFetch",
    ].join(";"));
    await waitFor("document.getElementById('workspaceStatus').textContent.includes('오래된 로컬 AI 초안을 폐기')", "Stale local AI response was not discarded after a chart mutation.");
    assert(await evaluate("document.getElementById('copilotMode').textContent === '규칙 기반'"), "Stale local AI response replaced the current rule-based brief.");
  } else {
    assert(clinicalPosts.length === 0, "Rule-based mode sent a clinical POST.");
    assert(await evaluate("document.getElementById('workspaceStatus').textContent.includes('전송하지 않았습니다')"), "Offline AI status did not explain no-send behavior.");
  }

  await evaluate([
    "const firstTab = document.querySelector('[data-tab=\"overview\"]')",
    "firstTab.focus()",
    "firstTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))",
  ].join(";"));
  assert(await evaluate("document.querySelector('[data-tab=\"chart\"]').getAttribute('aria-selected') === 'true'"), "Arrow-key tab navigation failed.");

  await evaluate("document.querySelector('[data-tab=\"graph\"]').click()");
  await waitFor(
    "document.getElementById('panel-graph').hidden === false && document.querySelectorAll('.body-hotspot[data-body-area]').length === 12 && document.querySelectorAll('.body-caption[data-body-area]').length === 12",
    "Clinical body map did not render its twelve departments.",
  );
  const bodyMap = await evaluate(`(() => {
    const hotspots = [...document.querySelectorAll('.body-hotspot[data-body-area]')];
    const captions = [...document.querySelectorAll('.body-caption[data-body-area]')];
    const careAreaIds = [...new Set(
      [...document.querySelectorAll('[data-body-area].is-care-record')].map(({ dataset }) => dataset.bodyArea),
    )].sort();
    const signalAreaIds = [...new Set(
      [...document.querySelectorAll('[data-body-area].is-condition-signal')].map(({ dataset }) => dataset.bodyArea),
    )].sort();
    const candidateAreaIds = [...new Set(
      [...document.querySelectorAll('[data-body-area].is-classification-candidate')].map(({ dataset }) => dataset.bodyArea),
    )].sort();
    const candidateOnlyAreaIds = [...new Set(
      [...document.querySelectorAll('[data-body-area].is-candidate-only')].map(({ dataset }) => dataset.bodyArea),
    )].sort();
    const signalOnlyAreaIds = [...new Set(
      [...document.querySelectorAll('[data-body-area].is-signal-only')].map(({ dataset }) => dataset.bodyArea),
    )].sort();
    return {
      tabLabel: document.getElementById('tab-graph').textContent.trim(),
      hotspots: hotspots.length,
      captions: captions.length,
      hotspotIds: hotspots.map(({ dataset }) => dataset.bodyArea),
      captionIds: captions.map(({ dataset }) => dataset.bodyArea),
      careAreaIds,
      candidateAreaIds,
      candidateOnlyAreaIds,
      signalAreaIds,
      signalOnlyAreaIds,
      careCount: document.getElementById('bodyAreaCount').textContent.trim(),
      signalCount: document.getElementById('bodySignalAreaCount').textContent.trim(),
      visitCount: document.getElementById('bodyVisitCount').textContent.trim(),
      medicationCount: document.getElementById('bodyMedicationCount').textContent.trim(),
      legend: document.querySelector('.clinical-body-key').textContent.replace(/\\s+/g, ' ').trim(),
    };
  })()`);
  demoBodyAreas = bodyMap.hotspots;
  demoBodyCareAreas = bodyMap.careAreaIds.length;
  demoBodyCandidateAreas = bodyMap.candidateAreaIds.length;
  demoBodySignalAreas = bodyMap.signalAreaIds.length;
  assert(bodyMap.tabLabel === "신체 지도", `Clinical body-map tab label drifted: ${JSON.stringify(bodyMap)}`);
  assert(bodyMap.hotspots === 12 && bodyMap.captions === 12,
    `Clinical body map did not render 12 hotspots and 12 captions: ${JSON.stringify(bodyMap)}`);
  assert(new Set(bodyMap.hotspotIds).size === 12
    && JSON.stringify(bodyMap.hotspotIds) === JSON.stringify(bodyMap.captionIds),
  `Body hotspot and caption department identities diverged: ${JSON.stringify(bodyMap)}`);
  assert(JSON.stringify(bodyMap.careAreaIds) === JSON.stringify(["endocrine", "respiratory"])
    && bodyMap.careCount === "2개"
    && bodyMap.visitCount === "3건"
    && bodyMap.medicationCount === "1건",
  `Demo care records did not preserve the explicitly declared endocrine and respiratory departments: ${JSON.stringify(bodyMap)}`);
  assert(JSON.stringify(bodyMap.candidateAreaIds) === JSON.stringify(["endocrine"])
    && bodyMap.candidateOnlyAreaIds.length === 0,
  `Label-derived department candidates were not visually separated from confirmed care: ${JSON.stringify(bodyMap)}`);
  assert(JSON.stringify(bodyMap.signalAreaIds) === JSON.stringify(["cardio", "endocrine", "renal", "respiratory", "sensory"])
    && JSON.stringify(bodyMap.signalOnlyAreaIds) === JSON.stringify(["cardio", "renal", "sensory"])
    && bodyMap.signalCount === "5개",
  `Condition-derived navigation signals were not separated from care records: ${JSON.stringify(bodyMap)}`);
  assert(/진료 기록 연결/.test(bodyMap.legend)
    && /진료명 기반 분류 후보/.test(bodyMap.legend)
    && /질환 기반 탐색 영역 · 진료 이력 아님/.test(bodyMap.legend),
  `Body-map legend did not distinguish care, label candidates, and condition-derived signals: ${bodyMap.legend}`);

  await evaluate("document.querySelector('.body-hotspot[data-body-area=\"endocrine\"]').click()");
  await waitFor(
    "document.querySelector('#bodyVisitList [data-body-source-event=\"kim-visit-today\"]') && document.querySelector('#bodyVisitList [data-body-source-event=\"kim-encounter\"]') && document.querySelector('#bodyMedicationList [data-body-source-event=\"kim-visit-med\"]')",
    "Endocrine declared visit, label-derived candidate, and encounter-linked prescription did not render.",
  );
  const endocrineDetail = await evaluate(`(() => {
    const visitSources = [...document.querySelectorAll('#bodyVisitList [data-body-source-event]')]
      .map(({ dataset }) => dataset.bodySourceEvent);
    const medicationSources = [...document.querySelectorAll('#bodyMedicationList [data-body-source-event]')]
      .map(({ dataset }) => dataset.bodySourceEvent);
    return {
      title: document.getElementById('bodyDetailTitle').textContent.trim(),
      department: document.getElementById('bodyDetailDepartment').textContent.trim(),
      visitSources,
      medicationSources,
      visitText: document.getElementById('bodyVisitList').textContent.replace(/\\s+/g, ' ').trim(),
      medicationText: document.getElementById('bodyMedicationList').textContent.replace(/\\s+/g, ' ').trim(),
      visitGroupLabels: [...document.querySelectorAll('#bodyVisitList .clinical-body-list-group-label')]
        .map((node) => node.textContent.replace(/\\s+/g, ' ').trim()),
      boundary: document.getElementById('bodyDetailBoundary').textContent.replace(/\\s+/g, ' ').trim(),
      projection: document.getElementById('bodyProjectionNotice').textContent.replace(/\\s+/g, ' ').trim(),
      unassignedSummary: document.getElementById('bodyUnassignedMedicationCount').textContent.trim(),
      unassignedRendered: Boolean(document.querySelector('[data-body-source-event="kim-med"]')),
      selectedAreas: [...document.querySelectorAll('[data-body-area][aria-pressed="true"]')]
        .map(({ dataset }) => dataset.bodyArea),
    };
  })()`);
  demoBodyVisits = endocrineDetail.visitSources.length;
  demoBodyMedications = endocrineDetail.medicationSources.length;
  assert(endocrineDetail.title === "대사·호르몬" && endocrineDetail.department === "내분비내과",
    `Endocrine selection did not update its detail heading: ${JSON.stringify(endocrineDetail)}`);
  assert(JSON.stringify([...endocrineDetail.visitSources].sort()) === JSON.stringify(["kim-encounter", "kim-visit-today"]),
    `Endocrine detail omitted or invented visits: ${JSON.stringify(endocrineDetail.visitSources)}`);
  assert(/진료 중/.test(endocrineDetail.visitText)
    && /진료 완료/.test(endocrineDetail.visitText)
    && JSON.stringify(endocrineDetail.visitGroupLabels) === JSON.stringify([
      "진료과 필드로 확인",
      "진료명 기반 분류 후보 · 진료과 이력 확정 아님",
    ]),
  `Endocrine detail did not distinguish declared care from its label-derived candidate: ${JSON.stringify(endocrineDetail)}`);
  assert(JSON.stringify(endocrineDetail.medicationSources) === JSON.stringify(["kim-visit-med"])
    && /예시 혈압약/.test(endocrineDetail.medicationText)
    && /처방 초안/.test(endocrineDetail.medicationText),
  `Endocrine detail did not show only its encounter-linked prescription: ${JSON.stringify(endocrineDetail)}`);
  assert(endocrineDetail.unassignedSummary === "1건"
    && /진료과 연결 정보가 없는 약물 1건/.test(endocrineDetail.boundary)
    && /임의로 배정하지 않아/.test(endocrineDetail.boundary)
    && /진료과 필드로 확인된 진료 2건을 2개 영역/.test(endocrineDetail.projection)
    && /진료명 기반 분류 후보 1건과 연결 처방 0건/.test(endocrineDetail.projection)
    && /확인된 진료과 이력에서 제외/.test(endocrineDetail.projection)
    && /질환 기반 탐색 영역 5개는 진료 이력과 분리/.test(endocrineDetail.projection)
    && !endocrineDetail.unassignedRendered,
  `Care, candidate, signal, or unassigned-medication boundaries were not disclosed: ${JSON.stringify(endocrineDetail)}`);
  assert(endocrineDetail.selectedAreas.length === 2
    && endocrineDetail.selectedAreas.every((areaId) => areaId === "endocrine"),
  `Hotspot and caption selection state diverged: ${JSON.stringify(endocrineDetail.selectedAreas)}`);

  await client.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await evaluate("document.querySelector('.body-caption[data-body-area=\"renal\"]').click(); document.querySelector('.body-caption[data-body-area=\"endocrine\"]').click()");
  const narrowBodyMap = await evaluate(`(() => {
    const workspace = document.querySelector('.clinical-body-workspace').getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      workspaceLeft: workspace.left,
      workspaceRight: workspace.right,
      selectedAreas: [...document.querySelectorAll('[data-body-area][aria-pressed="true"]')]
        .map(({ dataset }) => dataset.bodyArea),
      detailTitle: document.getElementById('bodyDetailTitle').textContent.trim(),
    };
  })()`);
  assert(narrowBodyMap.documentWidth <= narrowBodyMap.viewportWidth
    && narrowBodyMap.workspaceLeft >= -1
    && narrowBodyMap.workspaceRight <= narrowBodyMap.viewportWidth + 1,
  `Narrow clinical body map overflowed its viewport: ${JSON.stringify(narrowBodyMap)}`);
  assert(narrowBodyMap.detailTitle === "대사·호르몬"
    && narrowBodyMap.selectedAreas.length === 2
    && narrowBodyMap.selectedAreas.every((areaId) => areaId === "endocrine"),
  `Narrow clinical body-map selection did not remain synchronized: ${JSON.stringify(narrowBodyMap)}`);
  await client.call("Emulation.setDeviceMetricsOverride", {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: viewportWidth <= 620,
  });

  await evaluate("document.querySelector('#bodyVisitList [data-body-source-event=\"kim-visit-today\"]').click()");
  await waitFor(
    "document.activeElement === document.querySelector('[data-event-id=\"kim-visit-today\"]')",
    "Exact body-map source record did not receive focus after navigation.",
  );
  const sourceNavigation = await evaluate(`(() => {
    const row = document.querySelector('[data-event-id="kim-visit-today"]');
    return {
      chartSelected: document.querySelector('[data-tab="chart"]').getAttribute('aria-selected'),
      current: row?.getAttribute('aria-current'),
      highlighted: row?.classList.contains('is-source-target'),
      marker: row?.querySelector('.event-source-target-label')?.textContent,
      filterSelected: document.querySelector('[data-event-filter="encounter"]')?.getAttribute('aria-pressed'),
      announcement: document.getElementById('workspaceStatus').textContent,
    };
  })()`);
  assert(sourceNavigation.chartSelected === "true"
    && sourceNavigation.current === "true"
    && sourceNavigation.highlighted
    && sourceNavigation.marker === "신체 지도에서 선택한 기록"
    && sourceNavigation.filterSelected === "true"
    && /차트 기록으로 이동/.test(sourceNavigation.announcement)
    && /출처 식별자를 확인/.test(sourceNavigation.announcement),
  `Exact body-map source navigation lost identity, focus, highlight, filter, or announcement: ${JSON.stringify(sourceNavigation)}`);
  await evaluate("document.querySelector('[data-tab=\"claims\"]').click()");
  assert(await evaluate("document.querySelectorAll('#claimBoard [data-claim-review-lane]').length === 4 && document.querySelectorAll('#claimResultSummary .claim-result-chip').length === 6"), "Claim review lanes or immutable calculated-result summary did not render.");
  demoClaimCards = await evaluate("document.querySelectorAll('#claimBoard .claim-card').length");
  assert(demoClaimCards >= 3, "Claim evaluations did not render.");

  await client.call("Page.navigate", { url: appUrl + "/emr" });
  await waitFor("location.pathname === '/emr' && location.search === '' && document.readyState === 'complete' && Boolean(document.getElementById('fhirImport')) && Boolean(document.getElementById('patientBirthDate')?.max)", "EMR did not become ready after navigation.");
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
  const importFhir = `(async () => {
    const input = document.getElementById('fhirImport');
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(JSON.stringify(fhirBundle))}], 'smoke-fhir.json', { type: 'application/fhir+json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  })()`;
  await evaluate(importFhir);
  await waitFor("document.getElementById('selectedPatientName')?.textContent === 'FHIR 스모크 환자'", "FHIR patient did not import through the UI.");
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === 'FHIR 스모크 환자'"), "FHIR patient did not import through the UI.");
  assert(await evaluate("document.getElementById('fhirImportReportSummary').textContent.includes('지원 3건')"), "FHIR import report did not show supported resources.");
  assert(await evaluate("[...document.querySelectorAll('[data-patient-id]')].find((button) => button.textContent.includes('FHIR 스모크 환자'))?.textContent.includes('외부 완료·미검증')"), "External FHIR encounter was mislabeled as locally signed in the patient queue.");
  await evaluate(importFhir);
  await waitFor("document.getElementById('workspaceStatus')?.textContent.includes('이미 있습니다')", "Duplicate FHIR identity was not rejected.");
  assert(await evaluate("document.getElementById('workspaceStatus').textContent.includes('이미 있습니다')"), "Duplicate FHIR identity was not rejected.");
  assert(await evaluate("JSON.parse(localStorage.getItem('policycompass-emr-v2')).patients.length === 1"), "Duplicate FHIR import added another patient.");

  await evaluate([
    "document.getElementById('patientMrn').value = 'SMOKE-001'",
    "document.getElementById('patientName').value = '브라우저 테스트 환자'",
    "document.getElementById('patientBirthDate').value = '1990-01-02'",
    "document.getElementById('patientSex').value = 'female'",
    "document.getElementById('patientPhone').value = '010-1234-5678'",
    "document.getElementById('patientAddress').value = '서울특별시 테스트구'",
    "document.getElementById('patientBloodType').value = 'A+'",
    "document.getElementById('patientInsuranceType').value = 'national-health'",
    "document.getElementById('patientEmergencyName').value = '보호자 테스트'",
    "document.getElementById('patientEmergencyRelation').value = '배우자'",
    "document.getElementById('patientEmergencyPhone').value = '010-9999-0000'",
    "document.getElementById('patientMemo').value = '통화 후 방문'",
    "document.getElementById('patientForm').requestSubmit()",
  ].join(";"));
  await delay(250);
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'"), "New patient did not become active.");
  assert(await evaluate("localStorage.getItem('policycompass-emr-v2').includes('SMOKE-001')"), "Patient did not persist to localStorage.");
  assert(await evaluate(`(() => {
    const patient = JSON.parse(localStorage.getItem('policycompass-emr-v2')).patients.find(({ mrn }) => mrn === 'SMOKE-001');
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
  await evaluate("document.getElementById('editPatient').click(); [...document.querySelectorAll('[data-patient-id]')].find((button) => button.textContent.includes('FHIR 스모크 환자')).click()");
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자' && document.getElementById('workspaceStatus').textContent.includes('편집을 저장하거나 취소')"), "Patient selection changed behind an active demographics editor.");
  await evaluate("document.getElementById('cancelPatientEdit').click()");

  await evaluate("document.querySelector('[data-tab=\"encounter\"]').click(); document.getElementById('checkInPatient').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '대기'", "Patient check-in did not create a waiting encounter.");
  assert(await evaluate("document.activeElement === document.getElementById('startEncounter')"), "Check-in did not move focus to the next valid clinical action.");
  await evaluate("document.getElementById('startEncounter').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '진료 중'", "Encounter did not start.");
  const encounterStartFocus = await evaluate(`(() => ({
    activeId: document.activeElement?.id ?? '',
    soapOpen: document.querySelector('[data-workflow-disclosure="soap"]')?.open === true,
    visitContextOpen: document.querySelector('[data-workflow-disclosure="visit-context"]')?.open === true,
  }))()`);
  assert(encounterStartFocus.activeId === "soapSubjective"
    && encounterStartFocus.soapOpen
    && !encounterStartFocus.visitContextOpen,
  `Encounter start did not focus the open SOAP disclosure or preserve the concise default state: ${JSON.stringify(encounterStartFocus)}`);
  await evaluate([
    "document.getElementById('encounterDepartment').value = '내과'",
    "document.getElementById('encounterClinician').value = '스모크 의사'",
    "document.getElementById('encounterRoom').value = '1진료실'",
    "document.getElementById('chiefComplaint').value = '두통과 혈압 상승'",
    "document.getElementById('soapSubjective').value = '3일 전부터 간헐적 두통을 호소함'",
    "document.getElementById('soapObjective').value = '혈압 150/95 mmHg'",
    "document.getElementById('soapAssessment').value = '본태성 고혈압 의심'",
    "document.getElementById('soapPlan').value = '약물치료와 혈액검사 후 30일 뒤 추적'",
  ].join(";"));
  const dirtyExitGuard = await evaluate(`(() => {
    const event = new Event('beforeunload', { cancelable: true });
    return { dispatchResult: window.dispatchEvent(event), returnValue: event.returnValue };
  })()`);
  assert(dirtyExitGuard.dispatchResult === false, "Dirty SOAP did not activate the page-exit confirmation boundary.");
  const supplementalFhirBundle = {
    resourceType: "Bundle",
    type: "collection",
    entry: [{
      fullUrl: "Patient/smoke-fhir-supplemental",
      resource: { resourceType: "Patient", id: "smoke-fhir-supplemental", name: [{ text: "FHIR 추가 환자" }] },
    }],
  };
  await evaluate(`(() => {
    const input = document.getElementById('fhirImport');
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(JSON.stringify(supplementalFhirBundle))}], 'smoke-fhir-supplemental.json', { type: 'application/fhir+json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  })()`);
  await waitFor("document.getElementById('selectedPatientName')?.textContent === 'FHIR 추가 환자'", "FHIR import did not finish while a SOAP draft was unsaved.");
  assert(await evaluate(`(() => {
    const state = JSON.parse(localStorage.getItem('policycompass-emr-v2'));
    const patient = state.patients.find(({ mrn }) => mrn === 'SMOKE-001');
    const encounter = patient.events.find(({ type, status }) => type === 'encounter' && status === 'in-progress');
    return encounter?.soap?.plan === '약물치료와 혈액검사 후 30일 뒤 추적';
  })()`), "FHIR import discarded the unsaved SOAP draft instead of preserving it atomically.");
  await evaluate("[...document.querySelectorAll('[data-patient-id]')].find((button) => button.textContent.includes('브라우저 테스트 환자')).click()");
  await waitFor("document.getElementById('selectedPatientName')?.textContent === '브라우저 테스트 환자' && document.getElementById('soapPlan').value.includes('30일 뒤 추적')", "Preserved SOAP draft did not restore after returning from the FHIR patient.");
  await evaluate("document.getElementById('soapPlan').value += ' · 저장 이벤트 직전 수정'; window.dispatchEvent(new StorageEvent('storage', { key: 'policycompass-emr-v2' }))");
  assert(await evaluate("document.getElementById('soapPlan').value.includes('저장 이벤트 직전 수정') && document.getElementById('workspaceStatus').textContent.includes('미저장 입력을 보존')"), "Cross-tab storage event discarded an unsaved encounter draft.");
  await evaluate([
    "document.getElementById('encounterForm').requestSubmit()",
  ].join(";"));
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('초안을 저장')", "SOAP draft did not save.");
  assert(await evaluate("document.activeElement === document.getElementById('saveEncounterDraft')"), "Draft save did not preserve workflow focus.");
  const cleanExitGuard = await evaluate(`(() => {
    const event = new Event('beforeunload', { cancelable: true });
    return { dispatchResult: window.dispatchEvent(event), returnValue: event.returnValue };
  })()`);
  assert(cleanExitGuard.dispatchResult === true, "Saved SOAP still activated the page-exit confirmation boundary.");

  await evaluate([
    "document.getElementById('vitalValue').value = '149/93'",
    "document.getElementById('vitalNote').value = '환자 전환 전 미추가 값'",
    "window.dispatchEvent(new StorageEvent('storage', { key: 'policycompass-emr-v2', newValue: localStorage.getItem('policycompass-emr-v2') }))",
  ].join(";"));
  assert(await evaluate("document.getElementById('vitalValue').value === '149/93' && document.getElementById('workspaceStatus').textContent.includes('미저장 입력을 보존')"), "A storage event discarded the pending clinical-item composer.");
  await evaluate("[...document.querySelectorAll('[data-patient-id]')].find((button) => button.textContent.includes('FHIR 추가 환자')).click()");
  await delay(100);
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자' && document.getElementById('workspaceStatus').textContent.includes('현재 진료에 추가')"), "Patient switching did not block a pending clinical item.");
  await evaluate([
    "document.getElementById('vitalValue').value = ''",
    "document.getElementById('vitalNote').value = ''",
    "document.getElementById('eventLabel').value = '환자 전환 전 미추가 과거기록'",
    "[...document.querySelectorAll('[data-patient-id]')].find((button) => button.textContent.includes('FHIR 추가 환자')).click()",
  ].join(";"));
  await delay(100);
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자' && document.getElementById('eventLabel').value.includes('미추가 과거기록') && document.getElementById('workspaceStatus').textContent.includes('과거 기록')"), "Patient switching did not block a pending historical-event form.");
  await evaluate([
    "document.getElementById('eventLabel').value = ''",
    "[...document.querySelectorAll('[data-patient-id]')].find((button) => button.textContent.includes('FHIR 추가 환자')).click()",
  ].join(";"));
  await waitFor("document.getElementById('selectedPatientName').textContent === 'FHIR 추가 환자'", "Patient switching stayed blocked after the pending clinical item was cleared.");
  assert(await evaluate("document.getElementById('vitalValue').value === ''"), "A pending measurement crossed into another patient context.");
  await evaluate("[...document.querySelectorAll('[data-patient-id]')].find((button) => button.textContent.includes('브라우저 테스트 환자')).click()");
  await waitFor("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'", "Could not return after the clinical composer attribution test.");

  await evaluate([
    "window.__smokeOriginalPrompt = window.prompt",
    "window.__cancelPromptCalls = 0",
    "window.prompt = () => { window.__cancelPromptCalls += 1; return '취소되면 안 됨'; }",
    "document.getElementById('vitalValue').value = '148/92'",
    "document.getElementById('cancelEncounter').click()",
  ].join(";"));
  await delay(100);
  assert(await evaluate(`window.__cancelPromptCalls === 0
    && document.getElementById('encounterStatusText').textContent === '진료 중'
    && document.getElementById('vitalValue').value === '148/92'
    && document.getElementById('workspaceStatus').textContent.includes('현재 진료에 추가')`), "Encounter cancellation discarded pending clinical composer input.");
  await evaluate("document.getElementById('vitalValue').value = ''; window.prompt = window.__smokeOriginalPrompt; delete window.__smokeOriginalPrompt");

  await evaluate([
    "document.getElementById('vitalPreset').value = '85354-9'",
    "document.getElementById('vitalPreset').dispatchEvent(new Event('change', { bubbles: true }))",
    "document.getElementById('vitalValue').value = '150/95'",
    "document.getElementById('vitalNote').value = '좌측 상완'",
    "document.getElementById('vitalForm').requestSubmit()",
  ].join(";"));
  await waitFor("document.getElementById('vitalList').textContent.includes('150/95 mmHg')", "Encounter observation did not render.");
  assert(await evaluate(`(() => {
    const state = JSON.parse(localStorage.getItem('policycompass-emr-v2'));
    const patient = state.patients.find(({ mrn }) => mrn === 'SMOKE-001');
    const observation = patient.events.find(({ type, code }) => type === 'observation' && code === '85354-9');
    return observation?.system === 'http://loinc.org'
      && observation.label === '혈압'
      && observation.value === '150/95'
      && observation.unit === 'mmHg'
      && observation.recordStatus === 'draft';
  })()`), "Encounter observation did not preserve fixed LOINC metadata.");

  await evaluate([
    "document.getElementById('diagnosisRole').value = 'primary'",
    "document.getElementById('diagnosisCode').value = 'I10'",
    "document.getElementById('diagnosisSystem').value = 'urn:kr:kcd'",
    "document.getElementById('diagnosisLabel').value = '본태성 고혈압'",
    "document.getElementById('diagnosisCertainty').value = 'confirmed'",
    "document.getElementById('diagnosisForm').requestSubmit()",
  ].join(";"));
  await waitFor("document.getElementById('diagnosisList').textContent.includes('본태성 고혈압')", "Encounter diagnosis did not render.");
  const claimPreflight = await evaluate("document.getElementById('encounterClaimSummary').textContent");
  assert(claimPreflight.includes("예비판정") && claimPreflight.includes("1시행 준비") && !claimPreflight.includes("필수 근거"), `Draft diagnosis and structured blood pressure did not feed the explicitly provisional claim preflight: ${claimPreflight}`);

  await evaluate([
    "document.getElementById('medicationCode').value = 'SMOKE-MED-001'",
    "document.getElementById('medicationSystem').value = 'urn:policycompass:smoke:medication'",
    "document.getElementById('medicationName').value = '스모크정 5mg'",
    "document.getElementById('medicationDose').value = '1'",
    "document.getElementById('medicationDoseUnit').value = '정'",
    "document.getElementById('medicationRoute').value = '경구'",
    "document.getElementById('medicationFrequency').value = '1일 1회'",
    "document.getElementById('medicationDurationDays').value = '30'",
    "document.getElementById('medicationQuantity').value = '30'",
    "document.getElementById('medicationInstructions').value = '아침 식후 복용'",
    "document.getElementById('prescriptionForm').requestSubmit()",
  ].join(";"));
  await waitFor("document.getElementById('prescriptionList').textContent.includes('스모크정 5mg')", "Encounter prescription did not render.");

  await evaluate([
    "document.getElementById('orderKind').value = 'laboratory'",
    "document.getElementById('orderCode').value = 'SMOKE-LAB-001'",
    "document.getElementById('orderSystem').value = 'urn:policycompass:smoke:order'",
    "document.getElementById('orderLabel').value = '기본 혈액검사'",
    "document.getElementById('orderPriority').value = 'routine'",
    "document.getElementById('orderInstructions').value = '고혈압 초진 평가'",
    "document.getElementById('orderForm').requestSubmit()",
  ].join(";"));
  await waitFor("document.getElementById('orderList').textContent.includes('기본 혈액검사')", "Encounter order did not render.");

  await evaluate("document.getElementById('soapObjective').value = ''; document.getElementById('completeEncounter').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '서명 대기'", "Encounter did not complete.");
  await waitFor("document.activeElement === document.getElementById('encounterSignReviewTitle')", "Completion did not move focus to the pre-sign review title.");
  assert(await evaluate(`document.getElementById('signEncounter').disabled
    && document.getElementById('encounterSignReviewAcknowledged').disabled
    && document.getElementById('encounterSignReviewContent').textContent.includes('SOAP Objective가 비어 있습니다.')
    && document.getElementById('encounterSignReviewContent').textContent.includes('브라우저 테스트 환자')
    && document.getElementById('encounterSignReviewContent').textContent.includes('SMOKE-001')`), "Incomplete pre-sign review did not block acknowledgement and signature with the current patient context.");
  await evaluate("document.querySelector('[data-sign-review-target=\"soapObjective\"]').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '진료 중'", "Pre-sign correction did not reopen the Encounter.");
  assert(await evaluate("document.activeElement === document.getElementById('soapObjective')"), "Pre-sign correction did not focus the missing SOAP field.");
  await evaluate("document.getElementById('soapObjective').value = '혈압 150/95 mmHg'; document.getElementById('completeEncounter').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '서명 대기'", "Corrected Encounter did not return to pre-sign review.");
  await waitFor("document.activeElement === document.getElementById('encounterSignReviewTitle')", "Corrected completion did not return focus to the pre-sign review title.");
  assert(await evaluate(`!document.getElementById('encounterSignReviewAcknowledged').disabled
    && !document.getElementById('encounterSignReviewAcknowledged').checked
    && document.getElementById('signEncounter').disabled`), "Signature became available before explicit review acknowledgement.");
  await evaluate(`(() => {
    const acknowledgement = document.getElementById('encounterSignReviewAcknowledged');
    acknowledgement.checked = true;
    acknowledgement.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.getElementById('signEncounter').disabled === false", "Explicit review acknowledgement did not enable signature.");
  await evaluate(`(async () => {
    const model = await import('/emr-model.js');
    const current = model.loadEmrState();
    const patientId = current.selectedPatientId;
    const addedAt = new Date().toISOString();
    const confirmedAt = new Date(Date.now() + 1).toISOString();
    let changed = model.appendPatientEvent(current, patientId, {
      id: 'review-fingerprint-allergy',
      type: 'allergy',
      label: '라텍스',
      date: ${JSON.stringify(koreaToday)},
      status: 'active',
      clinicalStatus: 'active',
      verificationStatus: 'confirmed',
    }, addedAt);
    changed = model.confirmPatientEvent(changed, patientId, 'review-fingerprint-allergy', confirmedAt);
    await model.saveEmrState(changed, undefined, current.revision);
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'policycompass-emr-v2',
      newValue: localStorage.getItem('policycompass-emr-v2'),
    }));
  })()`);
  await waitFor(`!document.getElementById('encounterSignReviewAcknowledged').checked
    && document.getElementById('signEncounter').disabled
    && document.getElementById('encounterSignReviewContent').textContent.includes('라텍스')`, "Changed review content did not invalidate the explicit acknowledgement.");
  await evaluate(`(() => {
    const acknowledgement = document.getElementById('encounterSignReviewAcknowledged');
    acknowledgement.checked = true;
    acknowledgement.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.getElementById('signEncounter').disabled === false", "Re-reviewing changed content did not re-enable signature.");
  await evaluate("window.confirm = () => true; document.getElementById('signEncounter').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '완료·서명'", "Encounter did not sign.");
  assert(await evaluate("document.activeElement === document.getElementById('encounterStatus')"), "Signature did not restore focus to the updated encounter status.");
  assert(await evaluate(`(() => {
    const state = JSON.parse(localStorage.getItem('policycompass-emr-v2'));
    const patient = state.patients.find(({ mrn }) => mrn === 'SMOKE-001');
    const encounter = patient.events.find(({ type }) => type === 'encounter');
    const children = patient.events.filter(({ encounterId }) => encounterId === encounter.id);
    return encounter.recordStatus === 'final'
      && encounter.signature.status === 'signed'
      && children.length === 4
      && children.every(({ recordStatus }) => recordStatus === 'final');
  })()`), "Signed encounter or its observation/diagnosis/prescription/order children were not finalized atomically.");

  await evaluate("document.querySelector('[data-tab=\"chart\"]').click()");
  await evaluate([
    "document.getElementById('eventType').value = 'observation'",
    "document.getElementById('eventDate').value = '2026-07-19'",
    "document.getElementById('eventCode').value = 'SMOKE-BP'",
    "document.getElementById('eventLabel').value = '스모크 혈압'",
    "document.getElementById('eventValue').value = '120/80'",
    "document.getElementById('eventUnit').value = 'mmHg'",
    "document.getElementById('eventForm').requestSubmit()",
  ].join(";"));
  await delay(250);
  assert(await evaluate("document.getElementById('eventTimeline').textContent.includes('스모크 혈압')"), "Chart event did not render.");
  assert(await evaluate(`(() => {
    const actions = JSON.parse(localStorage.getItem('policycompass-emr-v2')).audit.map(({ action }) => action);
    return ['fhir.imported', 'patient.created', 'encounter.checked-in', 'encounter.started', 'observation.added', 'encounter.signed', 'patient.event.added']
      .every((action) => actions.includes(action));
  })()`), "Audit trail missed a required patient, encounter, FHIR, or chart action.");

  await evaluate([
    "window.__xssExecuted = 0",
    "document.getElementById('patientForm').reset()",
    "document.getElementById('patientFormMode').value = 'create'",
    "document.getElementById('patientAgeYears').disabled = false",
    "document.getElementById('patientMrn').value = '../SMOKE-XSS'",
    "document.getElementById('patientName').value = '<img src=x onerror=__xssExecuted=1>'",
    "document.getElementById('patientAgeYears').value = '47'",
    "document.getElementById('patientSex').value = 'male'",
    "document.getElementById('eventLabel').value = '새 환자 생성 전 미추가 과거기록'",
    "document.getElementById('patientForm').requestSubmit()",
  ].join(";"));
  await delay(100);
  assert(await evaluate(`!JSON.parse(localStorage.getItem('policycompass-emr-v2')).patients.some(({ mrn }) => mrn === '../SMOKE-XSS')
    && document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'
    && document.getElementById('eventLabel').value.includes('미추가 과거기록')
    && document.getElementById('patientFormMessage').textContent.includes('미등록 임상 입력')`), "New-patient creation discarded or reattributed a pending historical-event form.");
  await evaluate("document.getElementById('eventLabel').value = ''; document.getElementById('patientForm').requestSubmit()");
  await waitFor("document.getElementById('selectedPatientName').textContent.includes('<img')", "Hostile-text patient creation stayed blocked after pending input was cleared.");
  const hostilePatientDebug = await evaluate(`JSON.stringify({
    selectedName: document.getElementById('selectedPatientName').textContent,
    formMessage: document.getElementById('patientFormMessage').textContent,
    workspaceStatus: document.getElementById('workspaceStatus').textContent,
    formValid: document.getElementById('patientForm').checkValidity(),
    patients: JSON.parse(localStorage.getItem('policycompass-emr-v2')).patients.map(({ mrn, name }) => ({ mrn, name })),
  })`);
  assert(await evaluate("window.__xssExecuted === 0 && document.getElementById('selectedPatientName').querySelector('img') === null"), "Hostile patient text executed as markup.");
  assert(await evaluate("document.getElementById('selectedPatientName').textContent.includes('<img')"), `Hostile patient text was not preserved as inert text: ${hostilePatientDebug}`);
  assert(await evaluate("JSON.parse(localStorage.getItem('policycompass-emr-v2')).patients.some(({ mrn, birthDate, ageYears, sex }) => mrn === '../SMOKE-XSS' && !birthDate && ageYears === 47 && sex === 'male')"), "Direct age or sex did not persist when birth date was unknown.");
  await evaluate("[...document.querySelectorAll('[data-patient-id]')].find((button) => button.textContent.includes('브라우저 테스트 환자')).click(); window.__patientTransitionWasInert = document.getElementById('mainContent').inert");
  await waitFor("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'", "Could not return to the smoke patient after hostile input test.");
  assert(await evaluate("window.__patientTransitionWasInert === true && document.getElementById('mainContent').inert === false"), "Async patient transition did not lock patient-bound inputs for its full save window.");
  assert(await evaluate("JSON.parse(localStorage.getItem('policycompass-emr-v2')).audit.filter(({ action }) => action === 'patient.created').length >= 2"), "Hostile-text patient creation was not audited.");

  const stateBeforeFailure = await evaluate("localStorage.getItem('policycompass-emr-v2')");
  const recoveryBackup = JSON.stringify({
    schema: "policycompass-emr-backup",
    version: 2,
    exportedAt: "2026-07-19T10:00:00.000Z",
    data: JSON.parse(stateBeforeFailure),
  });
  await evaluate([
    "window.__storageSetItem = Storage.prototype.setItem",
    "Storage.prototype.setItem = () => { throw new DOMException('quota smoke', 'QuotaExceededError'); }",
    "document.getElementById('patientMrn').value = 'SMOKE-FAIL'",
    "document.getElementById('patientName').value = '저장 실패 환자'",
    "document.getElementById('patientForm').requestSubmit()",
  ].join(";"));
  await delay(100);
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'"), "Failed storage mutation changed visible patient state.");
  assert(await evaluate("document.getElementById('patientFormMessage').textContent.includes('quota smoke')"), "Storage failure was not shown to the user.");
  assert(await evaluate("localStorage.getItem('policycompass-emr-v2')") === stateBeforeFailure, "Failed storage mutation changed persisted state.");
  await evaluate("Storage.prototype.setItem = window.__storageSetItem");

  const lowRevisionBackup = JSON.parse(recoveryBackup);
  lowRevisionBackup.data.revision = 0;
  const blockedBackupExport = await evaluate(`(() => {
    const OriginalBlob = window.Blob;
    const originalClick = HTMLAnchorElement.prototype.click;
    window.__pendingBackupParts = [];
    window.Blob = class extends OriginalBlob {
      constructor(parts, options) {
        super(parts, options);
        window.__pendingBackupParts.push(parts.map(String).join(''));
      }
    };
    HTMLAnchorElement.prototype.click = function () {};
    document.getElementById('vitalValue').value = '147/91';
    document.getElementById('exportEmr').click();
    const result = {
      downloads: window.__pendingBackupParts.length,
      status: document.getElementById('workspaceStatus').textContent,
      value: document.getElementById('vitalValue').value,
    };
    window.Blob = OriginalBlob;
    HTMLAnchorElement.prototype.click = originalClick;
    return result;
  })()`);
  assert(blockedBackupExport.downloads === 0 && blockedBackupExport.status.includes("미저장") && blockedBackupExport.value === "147/91", "Backup export discarded or omitted a pending clinical item.");

  const revisionBeforeBlockedRestore = await evaluate("JSON.parse(localStorage.getItem('policycompass-emr-v2')).revision");
  await evaluate(`(() => {
    window.confirm = () => true;
    const input = document.getElementById('importEmr');
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(JSON.stringify(lowRevisionBackup))}], 'blocked-low-revision-backup.json', { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  })()`);
  await delay(100);
  assert(await evaluate(`document.getElementById('workspaceStatus').textContent.includes('미저장')
    && document.getElementById('vitalValue').value === '147/91'
    && JSON.parse(localStorage.getItem('policycompass-emr-v2')).revision === ${revisionBeforeBlockedRestore}`), "Backup restore discarded a pending clinical item or changed persisted state.");
  await evaluate("document.getElementById('vitalValue').value = ''; document.getElementById('cancelPatientEdit').click()");
  await evaluate(`(() => {
    window.confirm = () => true;
    const input = document.getElementById('importEmr');
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(JSON.stringify(lowRevisionBackup))}], 'low-revision-backup.json', { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  })()`);
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('출처 미검증 상태로 복원')", "Normal backup restore did not finish.");
  assert(await evaluate(`JSON.parse(localStorage.getItem('policycompass-emr-v2')).revision === ${JSON.parse(stateBeforeFailure).revision + 1}`), "Backup restore reused its historical revision and left an ABA window.");
  assert(await evaluate(`(() => {
    const restored = JSON.parse(localStorage.getItem('policycompass-emr-v2'));
    const restoredRecords = restored.patients.flatMap(({ events }) => events);
    return restored.audit.length === 1
      && restored.audit[0].action === 'backup.restored'
      && restoredRecords.length > 0
      && restoredRecords.every(({ source }) => source.kind === 'import')
      && restoredRecords.filter(({ type, recordStatus }) => type === 'encounter' && recordStatus === 'final').every(({ signature }) => signature.status === 'external')
      && document.querySelectorAll('[data-remove-event]').length === 0;
  })()`), "Unsigned backup restored forged signatures, provenance, or audit history as trusted state.");

  const staleBackupExport = await evaluate(`(async () => {
    const model = await import('/emr-model.js');
    const persisted = model.loadEmrState();
    const changed = model.addPatient(persisted, { id: 'backup-cas-patient', mrn: 'BACKUP-CAS', name: '백업 CAS 환자' });
    await model.saveEmrState(changed, undefined, persisted.revision);
    const OriginalBlob = window.Blob;
    const originalClick = HTMLAnchorElement.prototype.click;
    window.__staleBackupParts = [];
    window.Blob = class extends OriginalBlob {
      constructor(parts, options) {
        super(parts, options);
        window.__staleBackupParts.push(parts.map(String).join(''));
      }
    };
    HTMLAnchorElement.prototype.click = function () {};
    document.getElementById('exportEmr').click();
    const result = {
      downloads: window.__staleBackupParts.length,
      status: document.getElementById('workspaceStatus').textContent,
    };
    window.Blob = OriginalBlob;
    HTMLAnchorElement.prototype.click = originalClick;
    return result;
  })()`);
  assert(staleBackupExport.downloads === 0 && staleBackupExport.status.includes("다른 탭의 최신 변경"), "Backup export emitted a stale cross-tab revision.");
  await evaluate("window.dispatchEvent(new StorageEvent('storage', { key: 'policycompass-emr-v2', newValue: localStorage.getItem('policycompass-emr-v2') }))");
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('다른 탭의 로컬 기록 변경')", "Primary tab did not adopt the backup-guard CAS change.");

  const corruptRaw = "{corrupt-smoke";
  await evaluate(`localStorage.setItem('policycompass-emr-v2', ${JSON.stringify(corruptRaw)})`);
  await client.call("Page.navigate", { url: appUrl + "/emr" });
  await waitFor("document.getElementById('dataFacts')?.textContent.includes('복구 필요')", "Corrupt storage recovery state did not render.");
  assert(await evaluate("document.getElementById('dataFacts').textContent.includes('복구 필요')"), "Corrupt storage recovery state did not render.");
  assert(await evaluate("document.getElementById('exportRecoveryRaw').hidden === false"), "Recovery raw export stayed hidden.");
  const recovered = await evaluate(`(() => {
    const OriginalBlob = window.Blob;
    window.Blob = class extends OriginalBlob {
      constructor(parts, options) {
        super(parts, options);
        window.__recoveryParts = parts;
      }
    };
    HTMLAnchorElement.prototype.click = function () { window.__recoveryHref = this.href; window.__recoveryName = this.download; };
    document.getElementById('exportRecoveryRaw').click();
    window.Blob = OriginalBlob;
    return { value: window.__recoveryParts.join(''), name: window.__recoveryName };
  })()`);
  assert(recovered.value === corruptRaw, "Recovery export did not preserve the exact corrupt source.");
  assert(/^policycompass-emr-recovery-raw-/.test(recovered.name), "Recovery export filename was not explicit.");

  await evaluate(`(() => {
    window.confirm = () => true;
    const input = document.getElementById('importEmr');
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(recoveryBackup)}], 'recovery-backup.json', { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  })()`);
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('출처 미검증 상태로 복원')", "Backup could not replace the exact corrupt storage source.");
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'"), "Recovered backup did not restore the selected patient.");
  assert(await evaluate("JSON.parse(localStorage.getItem('policycompass-emr-v2')).revision > 1000000000000000"), "Corrupt-storage restore did not rotate the revision away from stale tabs.");

  const concurrentWrite = await evaluate(`(async () => {
    const model = await import('/emr-model.js');
    const current = model.loadEmrState();
    const first = model.addPatient(current, { id: 'cas-first', mrn: 'CAS-FIRST', name: '동시 저장 A' });
    const second = model.addPatient(current, { id: 'cas-second', mrn: 'CAS-SECOND', name: '동시 저장 B' });
    const results = await Promise.allSettled([
      model.saveEmrState(first, undefined, current.revision),
      model.saveEmrState(second, undefined, current.revision),
    ]);
    const persistedIds = model.loadEmrState().patients.map(({ id }) => id);
    return {
      statuses: results.map(({ status }) => status),
      errors: results.map((result) => result.status === 'rejected' ? String(result.reason?.message ?? result.reason) : ''),
      persistedIds,
    };
  })()`);
  assert(concurrentWrite.statuses.filter((status) => status === "fulfilled").length === 1, "Concurrent browser writes did not produce exactly one winner.");
  assert(concurrentWrite.statuses.filter((status) => status === "rejected").length === 1, "Concurrent browser writes did not reject the stale contender.");
  assert(concurrentWrite.errors.some((message) => /다른 탭.*변경/.test(message)), "Concurrent browser write rejection did not explain the revision conflict.");
  assert(concurrentWrite.persistedIds.filter((id) => ["cas-first", "cas-second"].includes(id)).length === 1, "Concurrent browser writes lost both records or accepted both stale candidates.");

  await evaluate("window.dispatchEvent(new StorageEvent('storage', { key: 'policycompass-emr-v2', newValue: localStorage.getItem('policycompass-emr-v2') }))");
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('다른 탭의 로컬 기록 변경')", "Primary tab did not adopt the concurrent-write winner.");
  await evaluate("[...document.querySelectorAll('[data-patient-id]')].find((button) => button.textContent.includes('브라우저 테스트 환자')).click()");
  await waitFor("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'", "Primary tab did not return to the smoke patient before the cross-tab wipe.");
  await evaluate("document.querySelector('[data-tab=\"encounter\"]').click(); document.getElementById('checkInPatient').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '대기'", "Second visit did not check in before the cross-tab wipe.");
  await evaluate("document.getElementById('startEncounter').click()");
  await waitFor("document.getElementById('encounterStatusText').textContent === '진료 중'", "Second visit did not start before the cross-tab wipe.");
  await evaluate([
    "document.getElementById('soapSubjective').value = 'CROSS-TAB-DIRTY-SOAP-S'",
    "document.getElementById('soapPlan').value = 'CROSS-TAB-DIRTY-SOAP-P'",
    "document.getElementById('vitalValue').value = '121/81'",
    "window.__staleEmrBeforeWipe = JSON.parse(localStorage.getItem('policycompass-emr-v2'))",
    "window.__wipeDownloads = []",
    "window.__wipeOriginalBlob = window.Blob",
    "window.Blob = class extends window.__wipeOriginalBlob { constructor(parts, options) { super(parts, options); window.__wipeDownloads.push(parts.map(String).join('')); } }",
    "HTMLAnchorElement.prototype.click = function () {}",
  ].join(";"));
  await evaluate("window.dispatchEvent(new StorageEvent('storage', { key: 'policycompass-emr-v2', newValue: localStorage.getItem('policycompass-emr-v2') }))");
  assert(await evaluate("document.getElementById('soapPlan').value === 'CROSS-TAB-DIRTY-SOAP-P' && document.getElementById('workspaceStatus').textContent.includes('미저장 입력을 보존')"), "The ordinary cross-tab dirty-form guard was not active before the tombstone override test.");
  if (aiConnected) {
    await evaluate([
      "window.__preWipeFetch = window.fetch",
      "window.__wipeAiPending = false",
      "window.__wipeAiAborted = false",
      "window.fetch = (input, init = {}) => {",
      "  if ((init.method || 'GET').toUpperCase() !== 'POST' || !String(input).includes('/api/clinical-copilot')) return window.__preWipeFetch(input, init)",
      "  window.__wipeAiPending = true",
      "  return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { window.__wipeAiAborted = true; reject(new DOMException('wipe', 'AbortError')); }, { once: true }))",
      "}",
      "document.getElementById('runCopilot').click()",
    ].join(";"));
    await waitFor("window.__wipeAiPending === true", "Local AI request did not remain pending for the wipe cancellation test.");
  }

  const demoClient = await openPage(appUrl + "/emr?demo=1");
  await waitFor("document.getElementById('selectedPatientName')?.textContent === '김비타'", "Demo tab did not load before the cross-tab wipe.", demoClient);
  await evaluate([
    "window.__wipeDownloads = []",
    "window.__wipeOriginalBlob = window.Blob",
    "window.Blob = class extends window.__wipeOriginalBlob { constructor(parts, options) { super(parts, options); window.__wipeDownloads.push(parts.map(String).join('')); } }",
    "HTMLAnchorElement.prototype.click = function () {}",
  ].join(";"), demoClient);

  const wipeClient = await openPage(appUrl + "/emr");
  await waitFor("document.getElementById('selectedPatientName')?.textContent === '브라우저 테스트 환자'", "Wipe tab did not load the selected patient.", wipeClient);
  await evaluate([
    "document.getElementById('patientMemo').value = 'WIPE-TAB-PATIENT-DRAFT'",
    "document.getElementById('soapPlan').value = 'WIPE-TAB-SOAP-DRAFT'",
    "document.getElementById('vitalValue').value = '122/82'",
    "document.getElementById('diagnosisLabel').value = 'WIPE-TAB-DIAGNOSIS-DRAFT'",
    "document.getElementById('medicationName').value = 'WIPE-TAB-MEDICATION-DRAFT'",
    "document.getElementById('orderLabel').value = 'WIPE-TAB-ORDER-DRAFT'",
    "document.getElementById('eventNote').value = 'WIPE-TAB-EVENT-DRAFT'",
    "window.confirm = () => true",
    "document.getElementById('wipeEmr').click()",
  ].join(";"), wipeClient);
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('기록을 모두 삭제')", "Wipe tab did not finish the full deletion.", wipeClient);
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('다른 탭에서 전체 삭제')", "Dirty SOAP tab ignored the deletion tombstone.");
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('다른 탭에서 전체 삭제')", "Demo tab ignored the deletion tombstone.", demoClient);
  if (aiConnected) {
    aiRequestAbortedOnWipe = await evaluate("window.__wipeAiAborted === true");
    assert(aiRequestAbortedOnWipe, "Full wipe did not abort the in-flight local AI request.");
    await evaluate("window.fetch = window.__preWipeFetch");
  }

  assert(await evaluate(`(() => {
    const values = ['patientMemo', 'soapPlan', 'vitalValue', 'diagnosisLabel', 'medicationName', 'orderLabel', 'eventNote']
      .map((id) => document.getElementById(id).value);
    const text = ['selectedPatientName', 'selectedPatientMeta', 'vitalList', 'diagnosisList', 'prescriptionList', 'orderList', 'recentEncounterList']
      .map((id) => document.getElementById(id).textContent).join(' ');
    return values.every((value) => value === '')
      && !/브라우저 테스트 환자|본태성 고혈압|스모크정|WIPE-TAB-/.test(text)
      && document.getElementById('workspaceContent').hidden;
  })()`, wipeClient), "Full wipe left patient, SOAP, diagnosis, prescription, or order PHI in the executing tab DOM.");
  assert(await evaluate(`(() => {
    const text = ['patientList', 'selectedPatientName', 'selectedPatientMeta', 'safetyAlerts', 'clinicalSummary', 'copilotContent',
      'vitalList', 'diagnosisList', 'prescriptionList', 'orderList', 'recentEncounterList', 'eventTimeline',
      'bodyVisitList', 'bodyMedicationList', 'bodyConditionList',
      'claimBoard', 'clinicalJourney', 'visitQuestions', 'auditList'].map((id) => document.getElementById(id).textContent).join(' ');
    return document.getElementById('soapSubjective').value === ''
      && document.getElementById('soapPlan').value === ''
      && !/CROSS-TAB-DIRTY-SOAP|브라우저 테스트 환자|SMOKE-001|본태성 고혈압|스모크정/.test(text)
      && document.getElementById('workspaceContent').hidden;
  })()`), "Cross-tab tombstone left dirty SOAP or rendered PHI in memory.");
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '' && document.getElementById('workspaceContent').hidden", demoClient), "Demo tab retained its stale saved-state patient workspace after full deletion.");
  assert(await evaluate("document.getElementById('fhirImportReport').hidden && document.getElementById('fhirImportReportSummary').textContent === ''", wipeClient), "Full wipe retained FHIR import metadata.");
  assert(await evaluate("document.getElementById('fhirImportIssues').textContent === ''", wipeClient), "Full wipe retained FHIR resource identifiers in the DOM.");
  assert(await evaluate(`(() => {
    const tombstone = JSON.parse(localStorage.getItem('policycompass-emr-v2'));
    return tombstone.patients.length === 0
      && tombstone.audit.length === 0
      && tombstone.rules.every(({ sample }) => sample === true)
      && tombstone.revision > 1000000000000000
      && localStorage.getItem('policycompass-emr-v1') === null;
  })()`), "Full wipe retained clinical data or failed to preserve its anti-resurrection tombstone.");

  const primaryExportsAfterWipe = await evaluate(`(() => {
    document.getElementById('exportEmr').click();
    document.getElementById('exportFhir').click();
    const downloads = [...window.__wipeDownloads];
    window.Blob = window.__wipeOriginalBlob;
    return downloads;
  })()`);
  const demoExportsAfterWipe = await evaluate(`(() => {
    document.getElementById('exportEmr').click();
    document.getElementById('exportFhir').click();
    const downloads = [...window.__wipeDownloads];
    window.Blob = window.__wipeOriginalBlob;
    return downloads;
  })()`, demoClient);
  for (const downloads of [primaryExportsAfterWipe, demoExportsAfterWipe]) {
    assert(downloads.length === 1, "A cleared tab exported a stale patient FHIR bundle.");
    assert(!/브라우저 테스트 환자|SMOKE-001|CROSS-TAB-DIRTY-SOAP|김비타|PC-1001/.test(downloads[0]), "A cleared tab exported stale patient data in its JSON backup.");
    const backup = JSON.parse(downloads[0]);
    assert(backup.data.patients.length === 0 && backup.data.audit.length === 0 && backup.data.rules.every(({ sample }) => sample === true), "A cleared tab's JSON backup was not the PHI-free tombstone.");
  }
  assert(await evaluate("document.getElementById('workspaceStatus').textContent.includes('환자를 먼저 선택')"), "The cleared primary tab did not block FHIR export.");
  assert(await evaluate("document.getElementById('workspaceStatus').textContent.includes('환자를 먼저 선택')", demoClient), "The cleared demo tab did not block FHIR export.");

  const demoSavedStateAfterWipe = await evaluate(`(() => {
    document.getElementById('loadDemo').click();
    window.__wipeDownloads = [];
    window.Blob = class extends window.__wipeOriginalBlob { constructor(parts, options) { super(parts, options); window.__wipeDownloads.push(parts.map(String).join('')); } };
    document.getElementById('exportEmr').click();
    const download = window.__wipeDownloads[0];
    window.Blob = window.__wipeOriginalBlob;
    return download;
  })()`, demoClient);
  const demoSavedBackup = JSON.parse(demoSavedStateAfterWipe);
  assert(demoSavedBackup.data.patients.length === 0 && demoSavedBackup.data.audit.length === 0 && demoSavedBackup.data.rules.every(({ sample }) => sample === true), "Demo mode retained the pre-wipe savedState for JSON export.");

  const staleWriteAfterWipe = await evaluate(`(async () => {
    const model = await import('/emr-model.js');
    try {
      await model.saveEmrState(window.__staleEmrBeforeWipe, undefined, window.__staleEmrBeforeWipe.revision);
      return '';
    } catch (error) {
      return String(error?.message ?? error);
    }
  })()`);
  assert(/다른 탭.*변경/.test(staleWriteAfterWipe), "A stale browser tab revived patient data after full wipe.");
  assert(await evaluate("JSON.parse(localStorage.getItem('policycompass-emr-v2')).patients.length === 0"), "Rejected stale write changed the full-wipe tombstone.");

  const result = {
    demoPatient: "김비타",
    bodyAreas: demoBodyAreas,
    bodyCareAreas: demoBodyCareAreas,
    bodyCandidateAreas: demoBodyCandidateAreas,
    bodySignalAreas: demoBodySignalAreas,
    bodyVisits: demoBodyVisits,
    bodyMedications: demoBodyMedications,
    unassignedBodyMedications: 1,
    claimLanes: 4,
    claimCards: demoClaimCards,
    persistedPatient: "SMOKE-001",
    persistedEvent: "SMOKE-BP",
    signedEncounter: true,
    structuredEncounterObservation: true,
    clinicalComposerAttributionGuard: true,
    fhirImported: "FHIR-SMOKE-001",
    aiMode,
    clinicalPosts: clinicalPosts.length,
    storageFailureAtomic: true,
    concurrentWriteRejected: true,
    staleWriteAfterWipeRejected: true,
    crossTabWipeClearedDirtySoap: true,
    clearedTabsBlockedStaleExports: true,
    aiRequestAbortedOnWipe,
    corruptStorageBackupRestored: true,
    fullWipeClearedMetadata: true,
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
}
