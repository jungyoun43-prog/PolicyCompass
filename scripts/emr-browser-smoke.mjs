import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const appUrl = process.env.EMR_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.CHROME_DEBUG_PORT ?? "9224", 10);
const profile = await mkdtemp(join(tmpdir(), "vitagraph-emr-smoke-"));
const browser = spawn(chrome, [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-background-networking",
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
let demoGraphNodes = 0;
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

  async function evaluate(expression) {
    const response = await client.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Browser evaluation failed.");
    return response.result.value;
  }

  async function waitFor(expression, message) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        if (await evaluate(expression)) return;
      } catch {
        // Navigation may replace the execution context between polls.
      }
      await delay(100);
    }
    throw new Error(message);
  }

  await waitFor("document.getElementById('selectedPatientName')?.textContent === '김비타'", "Demo patient did not render.");
  assert(await evaluate("document.getElementById('workspaceContent').hidden === false"), "Selected patient workspace stayed hidden.");
  assert(await evaluate("document.getElementById('loadDemo').hidden === true"), "Demo controls did not reflect demo state.");

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
    assert(!/김비타|VG-1001|혈압과 당화혈색소 추적/.test(clinicalPosts[0]), "AI request exposed direct identifiers or a free note.");
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

  await evaluate(`(() => {
    for (let index = 0; index < 17; index += 1) {
      document.getElementById('eventType').value = 'condition';
      document.getElementById('eventDate').value = '2026-07-19';
      document.getElementById('eventSystem').value = 'urn:vitagraph:smoke:condition';
      document.getElementById('eventCode').value = 'SMOKE-COND-' + index;
      document.getElementById('eventLabel').value = '그래프 부하 진단 ' + index;
      document.getElementById('eventForm').requestSubmit();
    }
  })()`);
  await evaluate("document.querySelector('[data-tab=\"graph\"]').click()");
  await waitFor("document.querySelectorAll('#clinicalGraph .clinical-node').length >= 20", "Large clinical graph did not render.");
  demoGraphNodes = await evaluate("document.querySelectorAll('#clinicalGraph .clinical-node').length");
  assert(demoGraphNodes === 24, "Clinical graph did not render its bounded 24-node capacity.");
  assert(await evaluate(`(() => {
    const svg = document.getElementById('clinicalGraph');
    const bounds = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('.clinical-node')].every((node) => {
      const box = node.getBoundingClientRect();
      return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
        && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
    });
  })()`), "Large clinical graph clipped nodes outside the SVG viewport.");
  await evaluate("document.querySelector('[data-tab=\"claims\"]').click()");
  assert(await evaluate("document.querySelectorAll('#claimBoard .claim-lane').length === 6"), "Claim board lanes did not render.");
  demoClaimCards = await evaluate("document.querySelectorAll('#claimBoard .claim-card').length");
  assert(demoClaimCards >= 3, "Claim evaluations did not render.");

  await client.call("Page.navigate", { url: appUrl + "/emr" });
  await waitFor("location.pathname === '/emr' && location.search === '' && document.readyState === 'complete' && Boolean(document.getElementById('fhirImport'))", "EMR did not become ready after navigation.");
  const fhirBundle = {
    resourceType: "Bundle",
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
          valueString: "118/76",
          effectiveDateTime: "2026-07-19",
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
  assert(await evaluate("document.getElementById('fhirImportReportSummary').textContent.includes('지원 2건')"), "FHIR import report did not show supported resources.");
  await evaluate(importFhir);
  await waitFor("document.getElementById('workspaceStatus')?.textContent.includes('이미 있습니다')", "Duplicate FHIR identity was not rejected.");
  assert(await evaluate("document.getElementById('workspaceStatus').textContent.includes('이미 있습니다')"), "Duplicate FHIR identity was not rejected.");
  assert(await evaluate("JSON.parse(localStorage.getItem('vitagraph-emr-v1')).patients.length === 1"), "Duplicate FHIR import added another patient.");

  await evaluate([
    "document.getElementById('patientMrn').value = 'SMOKE-001'",
    "document.getElementById('patientName').value = '브라우저 테스트 환자'",
    "document.getElementById('patientBirthDate').value = '1990-01-02'",
    "document.getElementById('patientForm').requestSubmit()",
  ].join(";"));
  await delay(250);
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'"), "New patient did not become active.");
  assert(await evaluate("localStorage.getItem('vitagraph-emr-v1').includes('SMOKE-001')"), "Patient did not persist to localStorage.");

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
  assert(await evaluate("JSON.parse(localStorage.getItem('vitagraph-emr-v1')).audit.length === 4"), "Audit trail did not record FHIR import, patient, and chart changes.");

  await evaluate([
    "window.__xssExecuted = 0",
    "document.getElementById('patientMrn').value = '../SMOKE-XSS'",
    "document.getElementById('patientName').value = '../🚑<img src=x onerror=window.__xssExecuted=1>'",
    "document.getElementById('patientForm').requestSubmit()",
  ].join(";"));
  await delay(100);
  assert(await evaluate("window.__xssExecuted === 0 && document.getElementById('selectedPatientName').querySelector('img') === null"), "Hostile patient text executed as markup.");
  assert(await evaluate("document.getElementById('selectedPatientName').textContent.includes('<img')"), "Hostile patient text was not preserved as inert text.");
  await evaluate("[...document.querySelectorAll('[data-patient-id]')].find((button) => button.textContent.includes('브라우저 테스트 환자')).click()");
  await delay(100);
  assert(await evaluate("document.getElementById('selectedPatientName').textContent === '브라우저 테스트 환자'"), "Could not return to the smoke patient after hostile input test.");
  assert(await evaluate("JSON.parse(localStorage.getItem('vitagraph-emr-v1')).audit.length === 5"), "Hostile-text patient creation was not audited.");

  const stateBeforeFailure = await evaluate("localStorage.getItem('vitagraph-emr-v1')");
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
  assert(await evaluate("localStorage.getItem('vitagraph-emr-v1')") === stateBeforeFailure, "Failed storage mutation changed persisted state.");
  await evaluate("Storage.prototype.setItem = window.__storageSetItem");

  const corruptRaw = "{corrupt-smoke";
  await evaluate(`localStorage.setItem('vitagraph-emr-v1', ${JSON.stringify(corruptRaw)})`);
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
  assert(/^vitagraph-emr-recovery-raw-/.test(recovered.name), "Recovery export filename was not explicit.");

  await evaluate("window.confirm = () => true; document.getElementById('wipeEmr').click()");
  await waitFor("document.getElementById('fhirImportReport').hidden && document.getElementById('fhirImportReportSummary').textContent === ''", "Full wipe retained FHIR import metadata.");
  assert(await evaluate("document.getElementById('fhirImportIssues').textContent === ''"), "Full wipe retained FHIR resource identifiers in the DOM.");
  assert(await evaluate("localStorage.getItem('vitagraph-emr-v1') === null"), "Full wipe retained persisted EMR data.");

  console.log(JSON.stringify({
    demoPatient: "김비타",
    graphNodes: demoGraphNodes,
    claimLanes: 6,
    claimCards: demoClaimCards,
    persistedPatient: "SMOKE-001",
    persistedEvent: "SMOKE-BP",
    auditEvents: 5,
    fhirImported: "FHIR-SMOKE-001",
    aiMode,
    clinicalPosts: clinicalPosts.length,
    storageFailureAtomic: true,
    corruptStorageRecovered: true,
    fullWipeClearedMetadata: true,
    hostileTextEscaped: true,
  }));
} finally {
  client?.close();
  browser.kill("SIGTERM");
  if (browser.exitCode === null) {
    await Promise.race([once(browser, "exit"), delay(2_000)]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
