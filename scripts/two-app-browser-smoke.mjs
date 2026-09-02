import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { startManagedAppServer } from "./browser-smoke-harness.mjs";

/**
 * EMR → Personal handoff: a signed encounter becomes an explicit transfer
 * file, the Personal pages import it only with the separately delivered
 * code, and the two apps' storage stays isolated. The EMR side drives the
 * React workspace (controlled inputs, catalogue dialogs); the Personal pages
 * are the proven static controllers. Runs `next start` itself unless
 * APP_URL/EMR_URL points at a server that is already up.
 */
const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const app = await startManagedAppServer({
  appUrl: process.env.APP_URL?.trim() || process.env.EMR_URL?.trim() || "",
  healthPath: "/emr",
});
const appUrl = app.appUrl;
const debugPort = Number.parseInt(process.env.HANDOFF_CHROME_DEBUG_PORT ?? "9226", 10);
const profile = await mkdtemp(join(tmpdir(), "policycompass-handoff-smoke-"));
const reportPath = process.env.HANDOFF_SMOKE_REPORT ?? join("artifacts", "smoke", "handoff-smoke-report.json");
const initialPersonalScene = {
  declaredIds: ["migraine"],
  patientVisibleIds: ["migraine", "reflux"],
  clinicalConditionIds: [],
  clinicalConditions: [],
  clinicalMeasurements: [],
  visibleIds: ["migraine", "reflux"],
  activeId: "migraine",
  measurements: [],
  transfer: null,
  observedAt: "",
  source: "직접 입력",
  isDemo: false,
  note: "",
};
const existingJourney = [{
  id: "journey-existing",
  date: "2026-07-01",
  conditionIds: ["migraine"],
  measurements: [],
  source: "직접 입력",
  createdAt: "2026-07-01T00:00:00.000Z",
}];
const browser = spawn(chrome, [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-background-networking",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** React-owned controls take values through the native setter plus events. */
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
    pick(listId, label) {
      const item = [...document.querySelectorAll('#' + listId + ' li')].find((li) => li.textContent.includes(label));
      if (!item) throw new Error('no search result for ' + label);
      item.querySelector('button').click();
    },
  };
})();`;

async function waitForEndpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
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
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
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
try {
  await waitForEndpoint();
  const targetResponse = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`${appUrl}/emr`)}`,
    { method: "PUT" },
  );
  const target = await targetResponse.json();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });

  async function evaluate(expression) {
    const response = await client.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Browser evaluation failed.");
    return response.result.value;
  }

  async function waitFor(expression, message) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        if (await evaluate(expression)) return;
      } catch {
        // Navigation may replace the execution context between polls.
      }
      await delay(100);
    }
    const diagnostic = await evaluate(`JSON.stringify({
      workspace: document.getElementById('workspaceStatus')?.textContent || '',
      encounter: document.getElementById('encounterFormMessage')?.textContent || '',
      patient: document.getElementById('patientFormMessage')?.textContent || ''
    })`).catch(() => "");
    throw new Error(`${message}${diagnostic ? ` ${diagnostic}` : ""}`);
  }

  async function navigate(path, readyExpression) {
    await client.call("Page.navigate", { url: `${appUrl}${path}` });
    await waitFor(`document.readyState === "complete" && (${readyExpression})`, `${path} did not become ready.`);
  }

  // A first visit opens the sample chart; the real (empty) record is one click away.
  await waitFor(
    "document.getElementById('selectedPatientName')?.textContent === '김비타'",
    "EMR application did not finish initializing.",
  );
  await evaluate(HELPERS);
  await evaluate("document.getElementById('exitDemo').click()");
  await waitFor(
    "document.getElementById('selectedPatientName') === null && document.getElementById('patientListEmpty').hidden === false",
    "EMR did not open the empty local record.",
  );
  const initialPersonalSceneText = JSON.stringify(initialPersonalScene);
  const existingJourneyText = JSON.stringify(existingJourney);
  await evaluate(`sessionStorage.setItem("policycompass-scene", ${JSON.stringify(initialPersonalSceneText)});localStorage.setItem("policycompass-journey", ${JSON.stringify(existingJourneyText)})`);
  await evaluate(`
    __smoke.set("patientMrn", "HANDOFF-001");
    __smoke.set("patientName", "전달검증환자");
    __smoke.set("patientBirthDate", "1980-02-03");
    __smoke.set("patientSex", "female");
    document.getElementById("patientForm").requestSubmit();
  `);
  await waitFor(
    "document.getElementById('selectedPatientName')?.textContent === '전달검증환자'",
    `Patient registration did not finish: ${await evaluate("document.getElementById('patientFormMessage')?.textContent || document.getElementById('workspaceStatus')?.textContent || 'no UI error'")}`,
  );

  await evaluate("document.getElementById('checkInPatient').click();");
  await waitFor("document.getElementById('encounterStatusText').textContent === '대기'", "Patient check-in did not finish.");
  await evaluate("document.getElementById('startEncounter').click();");
  await waitFor("document.getElementById('encounterStatusText').textContent === '진료 중'", "Encounter did not start.");
  await evaluate(`
    __smoke.set("encounterDepartment", "내과");
    __smoke.set("encounterClinician", "전달검증의사");
    __smoke.set("chiefComplaint", "고혈압과 당화혈색소 추적");
    __smoke.set("soapSubjective", "복약 중이며 특이 증상 없음");
    __smoke.set("soapObjective", "당화혈색소 결과 확인");
    __smoke.set("soapAssessment", "고혈압 추적 평가");
    __smoke.set("soapPlan", "복약 유지 및 추적 검사");
    document.getElementById("encounterForm").requestSubmit();
  `);
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('초안을 저장')", "Encounter draft did not save.");
  // Measurements are nursing workflow: the clinician chart takes a reviewed
  // historical result, which becomes final once confirmed.
  await evaluate(`
    __smoke.tab("chart");
    __smoke.set("eventType", "observation");
    __smoke.set("eventCode", "4548-4");
    __smoke.set("eventLabel", "당화혈색소");
    __smoke.set("eventSystem", "http://loinc.org");
    __smoke.set("eventValue", "7.1");
    __smoke.set("eventUnit", "%");
    document.getElementById("eventForm").requestSubmit();
  `);
  await waitFor("[...document.querySelectorAll('#eventTimeline .event-row')].some((row) => row.textContent.includes('당화혈색소'))", "Chart observation did not render.");
  await evaluate(`
    window.confirm = () => true;
    [...document.querySelectorAll('#eventTimeline .event-row')].find((row) => row.textContent.includes('당화혈색소')).querySelector('.event-confirm').click();
  `);
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('검토 완료 기록으로 확정')", "Chart observation was not confirmed.");
  await evaluate(`__smoke.tab("encounter"); document.getElementById("openDiagnosisDialog").click()`);
  await waitFor("Boolean(document.getElementById('diagnosisSearchInput'))", "Diagnosis dialog did not open.");
  await evaluate(`__smoke.set("diagnosisSearchInput", "고혈압")`);
  await waitFor("[...document.querySelectorAll('#diagnosisResultList li')].some((li) => li.textContent.includes('본태성 고혈압'))", "Diagnosis search did not list 본태성 고혈압.");
  await evaluate(`__smoke.pick("diagnosisResultList", "본태성 고혈압")`);
  await waitFor("document.getElementById('diagnosisCode').value === 'I10'", "Picking the diagnosis did not fix its KCD code.");
  await evaluate(`document.getElementById("diagnosisForm").requestSubmit()`);
  await waitFor("document.getElementById('diagnosisList').textContent.includes('고혈압')", "Encounter diagnosis did not render.");
  await evaluate(`document.getElementById("openPrescriptionDialog").click()`);
  await waitFor("Boolean(document.getElementById('medicationSearchInput'))", "Prescription dialog did not open.");
  await evaluate(`__smoke.set("medicationSearchInput", "벤라")`);
  await waitFor("[...document.querySelectorAll('#medicationResultList li')].some((li) => li.textContent.includes('벤라리주맙'))", "Medication search did not list 벤라리주맙.");
  await evaluate(`__smoke.pick("medicationResultList", "벤라리주맙")`);
  await waitFor("document.getElementById('medicationName').value.includes('벤라리주맙')", "Picking the medication did not fill the prescription form.");
  await evaluate(`document.getElementById("prescriptionForm").requestSubmit()`);
  await waitFor("document.getElementById('prescriptionList').textContent.includes('벤라리주맙')", "Encounter prescription did not render.");
  await evaluate("document.getElementById('completeEncounter').click();");
  await waitFor("document.getElementById('encounterStatusText').textContent === '서명 대기'", "Encounter did not complete.");
  await waitFor("document.getElementById('encounterSignReviewAcknowledged').disabled === false", "Pre-sign review did not become available.");
  await evaluate(`document.getElementById("encounterSignReviewAcknowledged").click()`);
  await waitFor("document.getElementById('signEncounter').disabled === false", "Explicit pre-sign acknowledgement did not enable signing.");
  await evaluate("window.confirm = () => true; document.getElementById('signEncounter').click();");
  await waitFor("document.getElementById('encounterStatusText').textContent === '완료·서명'", "Encounter did not sign.");

  assert(await evaluate(`sessionStorage.getItem("policycompass-scene") === ${JSON.stringify(initialPersonalSceneText)}`), "Signing an EMR encounter changed the Personal scene without an explicit import.");
  assert(await evaluate("localStorage.getItem('policycompass-care-bridge-v1') === null"), "Signing recreated the retired global care bridge.");

  await evaluate(`
    window.__transferJsonText = "";
    window.__transferConfirmMessage = "";
    window.confirm = (message) => { window.__transferConfirmMessage = String(message); return true; };
    window.__nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.text().then((text) => { window.__transferJsonText = text; });
      return window.__nativeCreateObjectURL(blob);
    };
    document.getElementById("syncPersonalRecord").click();
  `);
  await waitFor("window.__transferJsonText.length > 0", "EMR did not produce an explicit patient transfer file.");
  const transferJsonText = await evaluate("window.__transferJsonText");
  const transferPackage = JSON.parse(transferJsonText);
  assert(transferPackage.schema === "policycompass-patient-transfer" && transferPackage.version === 1, "Patient transfer schema/version mismatch.");
  assert(transferPackage.healthMap.conditions.some(({ id }) => id === "hypertension"), "Explicit transfer omitted the confirmed condition.");
  assert(transferPackage.healthMap.measurements.some(({ key, value }) => key === "hba1c" && value === 7.1), "Explicit transfer omitted the final observation.");
  assert(!("medications" in transferPackage.healthMap) && !("medications" in transferPackage), "Explicit transfer included unsupported medication scope.");
  assert(!/전달검증환자|HANDOFF-001|1980-02-03|벤라리주맙|특이 증상 없음|복약 유지/.test(transferJsonText), "Patient transfer exposed an identifier, medication, or raw clinical note.");
  assert(await evaluate("window.__transferConfirmMessage.includes('전달검증환자') && window.__transferConfirmMessage.includes('전달 확인 코드')"), "EMR did not require local patient/code confirmation before export.");

  await navigate("/emr?demo=1", "document.getElementById('selectedPatientName')?.textContent === '김비타'");
  await evaluate("document.getElementById('syncPersonalRecord').click()");
  await waitFor("document.getElementById('personalSyncStatus').textContent.includes('예시 환자')", "Example patient transfer export was not rejected.");

  await navigate("/map", "Boolean(document.getElementById('healthForm'))");
  await waitFor("document.getElementById('miniConditionList').textContent.includes('편두통')", "Map did not restore the Personal patient's declared condition.");
  assert(await evaluate("!document.getElementById('miniConditionList').textContent.includes('위식도역류')"), "Map revived a legacy inferred patientVisibleIds condition.");
  assert(await evaluate("Boolean(document.getElementById('transferCode') && document.getElementById('fhirFile') && document.getElementById('importRecordButton'))"), "Map did not expose explicit file+code import controls.");
  const wrongTransferCode = `${transferPackage.transferCode.slice(0, -1)}${transferPackage.transferCode.endsWith("0") ? "1" : "0"}`;
  await evaluate(`(() => {
    const input = document.getElementById("transferCode");
    input.value = ${JSON.stringify(wrongTransferCode)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const transferFile = new File([${JSON.stringify(transferJsonText)}], "policycompass-patient-transfer.json", { type: "application/json" });
    const files = new DataTransfer();
    files.items.add(transferFile);
    const picker = document.getElementById("fhirFile");
    picker.files = files.files;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("importRecordButton").click();
  })()`);
  await waitFor("document.getElementById('transferCode').getAttribute('aria-invalid') === 'true'", "A mismatched transfer code did not fail closed.");
  assert(await evaluate(`sessionStorage.getItem("policycompass-scene") === ${JSON.stringify(initialPersonalSceneText)}`), "A failed transfer-code check changed the Personal scene.");
  assert(await evaluate(`localStorage.getItem("policycompass-journey") === ${JSON.stringify(existingJourneyText)}`), "A failed import changed Journey.");

  await evaluate(`
    window.__importConfirmCount = 0;
    window.confirm = () => { window.__importConfirmCount += 1; return true; };
    const input = document.getElementById("transferCode");
    input.value = ${JSON.stringify(transferPackage.transferCode)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("importRecordButton").click();
  `);
  await waitFor("document.getElementById('fhirResult').classList.contains('is-success')", "Correct file+code import did not finish.");
  const validImportedSceneText = await evaluate("sessionStorage.getItem('policycompass-scene')");
  const validImportedScene = JSON.parse(validImportedSceneText);
  assert(await evaluate("window.__importConfirmCount >= 3"), "Import did not require patient, Journey-subject, and replacement confirmations.");
  assert(validImportedScene.declaredIds.length === 0 && validImportedScene.patientVisibleIds.length === 0, "Explicit import merged the previous Personal patient's conditions.");
  assert(validImportedScene.clinicalConditionIds.length === 1 && validImportedScene.clinicalConditionIds[0] === "hypertension", "Explicit import did not replace the map with the transferred condition.");
  assert(validImportedScene.clinicalConditions[0].provenanceKind === "clinician-confirmed-unsigned-import", "Imported condition provenance was overstated.");
  assert(validImportedScene.clinicalMeasurements[0].provenanceKind === "clinician-final-unsigned-import", "Imported measurement provenance was lost.");
  assert(validImportedScene.note === "" && validImportedScene.signals.length === 0, "Explicit import retained the previous patient's unsaved note/signals.");
  assert(!("transferCode" in validImportedScene.transfer), "Personal session persisted the separately delivered transfer code.");
  assert(await evaluate(`localStorage.getItem("policycompass-journey") === ${JSON.stringify(existingJourneyText)}`), "Successful import changed existing Journey records.");
  assert(await evaluate("!document.getElementById('downloadClinicalJson')"), "Personal recreated a second clinical JSON export path.");

  await navigate("/connections", "Boolean(document.getElementById('networkScene'))");
  await waitFor("document.getElementById('sceneNodeCount')?.textContent.includes('1개')", "Connections did not receive the explicit imported state.");
  assert(await evaluate(`(() => {
    const node = document.querySelector('[data-node-id="hypertension"]');
    const detail = document.getElementById("explorerEvidenceKind");
    return node?.dataset.evidenceKind === "recorded"
      && node?.dataset.evidenceSource === "clinical-import"
      && /발행기관과 변조는 검증되지 않은/.test(node.getAttribute("aria-label") || "")
      && detail?.dataset.provenance === "clinical-import"
      && detail.textContent.includes("파일에 의료진 확정으로 표시 · 발행기관·변조 미검증");
  })()`), "Connections overstated or lost unsigned-import provenance.");

  // The brief asks the server whether an external model is configured and
  // disables the option otherwise; this run simulates a deployment that has one.
  await client.call("Page.addScriptToEvaluateOnNewDocument", { source: `
    const smokeNativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => String(input).includes('/api/patient-question-assistant/status')
      ? new Response(JSON.stringify({ local: { configured: false, model: '' }, frontier: { configured: true, model: 'smoke-model', api: 'chat', endpoint: 'smoke' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      : smokeNativeFetch(input, init);` });
  await navigate("/insights", "Boolean(document.getElementById('questionCount'))");
  await waitFor("document.getElementById('questionCount')?.textContent !== '0개 질문'", "Visit brief did not receive the explicit imported state.");
  assert(await evaluate("document.getElementById('clinicalSnapshotStatus').textContent.includes('파일에 의료진 확정으로 표시 · 발행기관·변조 미검증')"), "Visit brief did not identify unsigned-import provenance.");
  assert(await evaluate(`(() => {
    const note = document.getElementById("exportClinicalSnapshot");
    return !document.getElementById("clinicalSnapshotCounts").textContent.includes("처방")
      && note?.tagName === "P"
      && !note.matches("button, a, input, [role='button']");
  })()`), "Visit brief claimed unsupported medication/export scope.");
  await evaluate(`
    document.getElementById("patientSelfReport").value = "이름 홍길동, 010-1234-5678, 지난 2주 동안 야간 기침이 심했습니다.";
    document.getElementById("patientSelfReport").dispatchEvent(new Event("input", { bubbles: true }));
  `);
  await waitFor("document.getElementById('questions').textContent.includes('이 불편함이 계속되거나 심해지면')", "Patient self-report did not create a grounded rule question.");
  await evaluate("document.querySelector('.question-select__input').click();window.__copiedQuestion='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value)=>{window.__copiedQuestion=value}}})");
  await waitFor("!document.getElementById('sharePatientBrief').disabled", "Patient did not explicitly select a question for copying.");
  await evaluate("document.getElementById('sharePatientBrief').click()");
  await waitFor("document.getElementById('patientAssistantStatus').textContent.includes('클립보드에 복사')", "Selected question was not copied locally.");
  assert(await evaluate("Boolean(window.__copiedQuestion) && localStorage.getItem('policycompass-care-bridge-v1') === null"), "Question copy recreated an EMR bridge or copied no question.");

  await evaluate(`
    window.__patientAssistantRequest = null;
    window.fetch = async (_url, options) => {
      window.__patientAssistantRequest = JSON.parse(options.body);
      return new Response(JSON.stringify({
        kind: "model",
        provider: "frontier",
        model: "smoke-model",
        generatedAt: new Date().toISOString(),
        summary: "확인 질문 초안",
        questions: [{ question: "다음 진료에서 혈압 기록을 어떻게 확인하면 좋을까요?", reason: "기록을 의료진과 함께 확인하기 위해서입니다.", evidenceIds: ["condition:hypertension"] }],
        sharedSignals: []
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const frontier = document.querySelector('input[name="question-provider"][value="frontier"]');
    frontier.checked = true;
    frontier.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("frontierConsent").checked = true;
    document.getElementById("frontierConsent").dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("runPatientAssistant").click();
  `);
  await waitFor("Boolean(window.__patientAssistantRequest) && document.getElementById('questionProviderMode').textContent.includes('외부 모델')", "Consented external-model request did not finish.");
  const patientAssistantRequest = await evaluate("window.__patientAssistantRequest");
  const requestText = JSON.stringify(patientAssistantRequest);
  assert(patientAssistantRequest.clinicalSnapshot.source === "unsigned-local-export", "Model payload overstated the imported file's provenance.");
  assert(patientAssistantRequest.clinicalSnapshot.healthMap.conditions.length === 1, "Model payload omitted or expanded imported conditions.");
  assert(patientAssistantRequest.clinicalSnapshot.healthMap.measurements.some(({ key, value }) => key === "hba1c" && value === 7.1), "Model payload omitted the imported final measurement.");
  assert(!("medications" in patientAssistantRequest.clinicalSnapshot), "Personal model payload attempted unsupported medication transmission.");
  assert(!/홍길동|010-1234-5678|전달검증환자|HANDOFF-001|벤라리주맙/.test(requestText), "Personal model payload exposed a direct identifier, EMR identity, or medication.");

  await navigate("/emr", "document.getElementById('selectedPatientName')?.textContent === '전달검증환자'");
  assert(await evaluate("!document.querySelector('.copilot-bridge-status') && !/환자가 공유한|공유 브리프/.test(document.getElementById('copilotContent').textContent)"), "EMR exposed a retired automatic patient-brief path.");

  const tamperedScene = structuredClone(validImportedScene);
  tamperedScene.clinicalMeasurements[0].value = 9_999;
  await evaluate(`sessionStorage.setItem("policycompass-scene", ${JSON.stringify(JSON.stringify(tamperedScene))})`);
  await navigate("/insights", "Boolean(document.getElementById('questionCount'))");
  await waitFor("document.getElementById('clinicalConnectionBadge').textContent.includes('파일 가져오기 대기')", "Tampered imported measurement was not rejected.");
  assert(await evaluate("document.getElementById('questionCount').textContent === '0개 질문' && document.getElementById('runPatientAssistant').disabled"), "Tampered session data reached questions or model controls.");

  await evaluate(`sessionStorage.setItem("policycompass-scene", ${JSON.stringify(validImportedSceneText)});localStorage.setItem("policycompass-care-bridge-v1", "legacy-secret-snapshot")`);
  await navigate("/map?sample=1", "Boolean(document.getElementById('healthForm'))");
  assert(await evaluate(`sessionStorage.getItem("policycompass-scene") === ${JSON.stringify(validImportedSceneText)}`), "Sample map mutated the real imported session.");
  // The Personal controllers boot after hydration, so sample-mode state settles a beat after navigation.
  await waitFor("document.getElementById('transferCode').disabled && document.getElementById('importRecordButton').disabled && document.getElementById('saveJourney').disabled", "Sample map enabled import or Journey actions.");
  assert(await evaluate("!document.body.textContent.includes('7.1') && localStorage.getItem('policycompass-care-bridge-v1') === null"), "Sample map exposed imported/legacy clinical detail.");
  await navigate("/insights?sample=1", "Boolean(document.getElementById('questionCount'))");
  await waitFor(`(() => {
    const note = document.getElementById("exportClinicalSnapshot");
    return document.getElementById("clinicalConnectionBadge").textContent === "예시 모드"
      && document.getElementById("runPatientAssistant").disabled
      && document.getElementById("sharePatientBrief").disabled
      && note?.tagName === "P"
      && !note.matches("button, a, input, [role='button']");
  })()`, "Sample insights enabled real-data actions.");
  assert(await evaluate(`sessionStorage.getItem("policycompass-scene") === ${JSON.stringify(validImportedSceneText)} && !document.body.textContent.includes('7.1')`), "Sample insights exposed or mutated imported detail.");
  await navigate("/connections?sample=1", "Boolean(document.getElementById('networkScene'))");
  await waitFor("!document.getElementById('personalDemoMode').hidden && document.querySelectorAll('[data-node-id]').length === 5", "Sample connections did not stay in the synthetic fixture.");
  assert(await evaluate(`sessionStorage.getItem("policycompass-scene") === ${JSON.stringify(validImportedSceneText)}`), "Sample connections mutated the real imported session.");
  await evaluate(`document.querySelector('.app-nav a[href^="/insights"]').click()`);
  await waitFor("location.pathname === '/insights' && new URLSearchParams(location.search).get('sample') === '1' && document.getElementById('clinicalConnectionBadge')?.textContent === '예시 모드'", "Sample navigation dropped its boundary from Connections to Insights.");
  assert(await evaluate("document.getElementById('clinicalConnectionBadge').textContent === '예시 모드' && !document.body.textContent.includes('7.1')"), "A sample navigation click exposed imported Insights data.");
  await evaluate(`document.querySelector('.app-nav a[href^="/journey"]').click()`);
  await waitFor("location.pathname === '/journey' && new URLSearchParams(location.search).get('sample') === '1' && document.getElementById('journeyTimeline')?.hidden", "Sample navigation dropped its boundary from Insights to Journey.");
  assert(await evaluate(`document.getElementById("journeyTimeline").hidden && localStorage.getItem("policycompass-journey") === ${JSON.stringify(existingJourneyText)}`), "Sample Journey exposed or changed the real timeline after an actual navigation click.");

  await client.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await navigate("/", "document.querySelectorAll('.role-action').length === 2");
  await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const gatewayLayout = await evaluate(`(() => ({
    width: document.documentElement.scrollWidth,
    actions: [...document.querySelectorAll('.role-action')].map((node) => ({
      top: node.getBoundingClientRect().top,
      bottom: node.getBoundingClientRect().bottom,
      display: getComputedStyle(node).display,
    })),
    cautions: [...document.querySelectorAll('.role-card__caution')].map((node) => ({
      top: node.getBoundingClientRect().top,
      bottom: node.getBoundingClientRect().bottom,
      display: getComputedStyle(node).display,
    })),
  }))()`);
  assert(gatewayLayout.width <= 390, `Gateway overflowed the 390px viewport: ${JSON.stringify(gatewayLayout)}`);
  assert(gatewayLayout.actions.length === 2 && gatewayLayout.actions.every(({ top, bottom, display }) => top >= 0 && bottom <= 844 && display !== "none"), `Both role actions were not visible within 390×844: ${JSON.stringify(gatewayLayout)}`);
  assert(gatewayLayout.cautions.length === 2 && gatewayLayout.cautions.every(({ top, bottom, display }) => top >= 0 && bottom <= 844 && display !== "none"), `Both safety cautions were not visible within 390×844: ${JSON.stringify(gatewayLayout)}`);

  await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } });
      Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } });
    `,
  });
  await navigate("/map", "Boolean(document.getElementById('healthForm'))");
  await navigate("/connections", "Boolean(document.getElementById('networkScene'))");
  await navigate("/insights", "Boolean(document.getElementById('questionCount'))");
  assert(await evaluate("document.readyState === 'complete'"), "Personal routes crashed when browser storage getters threw SecurityError.");

  const result = {
    conditions: transferPackage.healthMap.conditions.length,
    measurements: transferPackage.healthMap.measurements.length,
    medications: 0,
    signedEncounterDidNotAutoConnect: true,
    demoExportBlocked: true,
    explicitFileCodeImport: true,
    wrongCodeFailedClosed: true,
    replaceOnlyImport: true,
    journeyPreserved: true,
    unsignedImportProvenanceVisible: true,
    localQuestionCopyOnly: true,
    modelPayloadAllowlisted: true,
    tamperedSessionRejected: true,
    sampleIsolated: true,
    legacyBridgeRetired: true,
    storageSecurityErrorGraceful: true,
    gatewayMobileReady: true,
  };
  const temporaryReportPath = `${reportPath}.${process.pid}.tmp`;
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(temporaryReportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await rename(temporaryReportPath, reportPath);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  client?.close();
  browser.kill("SIGTERM");
  if (browser.exitCode === null) {
    await Promise.race([once(browser, "exit"), delay(2_000)]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await app.stop();
}
