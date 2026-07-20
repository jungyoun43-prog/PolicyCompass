import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.HANDOFF_CHROME_DEBUG_PORT ?? "9226", 10);
const profile = await mkdtemp(join(tmpdir(), "vitagraph-handoff-smoke-"));
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

  await waitFor(
    "document.getElementById('selectedPatientName')?.textContent === ''",
    "EMR application did not finish initializing.",
  );
  await evaluate(`
    document.getElementById("patientMrn").value = "HANDOFF-001";
    document.getElementById("patientName").value = "전달검증환자";
    document.getElementById("patientBirthDate").value = "1980-02-03";
    document.getElementById("patientSex").value = "female";
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
    document.getElementById("encounterDepartment").value = "내과";
    document.getElementById("encounterClinician").value = "전달검증의사";
    document.getElementById("chiefComplaint").value = "고혈압과 당화혈색소 추적";
    document.getElementById("soapSubjective").value = "복약 중이며 특이 증상 없음";
    document.getElementById("soapObjective").value = "당화혈색소 결과 확인";
    document.getElementById("soapAssessment").value = "고혈압 추적 평가";
    document.getElementById("soapPlan").value = "복약 유지 및 추적 검사";
    document.getElementById("encounterForm").requestSubmit();
  `);
  await waitFor("document.getElementById('workspaceStatus').textContent.includes('초안을 저장')", "Encounter draft did not save.");
  await evaluate(`
    document.getElementById("vitalPreset").value = "4548-4";
    document.getElementById("vitalPreset").dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("vitalValue").value = "7.1";
    document.getElementById("vitalNote").value = "당일 검사";
    document.getElementById("vitalForm").requestSubmit();
  `);
  await waitFor("document.getElementById('vitalList').textContent.includes('7.1 %')", "Encounter observation did not render.");
  await evaluate(`
    document.getElementById("diagnosisRole").value = "primary";
    document.getElementById("diagnosisSystem").value = "urn:kr:kcd";
    document.getElementById("diagnosisCode").value = "I10";
    document.getElementById("diagnosisLabel").value = "본태성 고혈압";
    document.getElementById("diagnosisForm").requestSubmit();
  `);
  await waitFor("document.getElementById('diagnosisList').textContent.includes('본태성 고혈압')", "Encounter diagnosis did not render.");
  await evaluate("document.getElementById('completeEncounter').click();");
  await waitFor("document.getElementById('encounterStatusText').textContent === '서명 대기'", "Encounter did not complete.");
  await evaluate("window.confirm = () => true; document.getElementById('signEncounter').click();");
  await waitFor("document.getElementById('encounterStatusText').textContent === '완료·서명'", "Encounter did not sign.");

  await evaluate("document.querySelector('#emrUtilities > summary').click()");
  await waitFor("document.getElementById('emrUtilities').open && document.getElementById('exportPatientTransfer').getClientRects().length === 1", "Data utility disclosure did not expose patient transfer through its summary control.");
  await evaluate(`
    window.__transferDownloadText = "";
    window.__nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.text().then((text) => { window.__transferDownloadText = text; });
      return window.__nativeCreateObjectURL(blob);
    };
    document.getElementById("exportPatientTransfer").click();
  `);
  await waitFor("window.__transferDownloadText.length > 0", "Patient transfer download was not produced.");
  const transferText = await evaluate("window.__transferDownloadText");
  const transfer = JSON.parse(transferText);
  assert(transfer.schema === "vitagraph-patient-transfer" && transfer.version === 1, "Transfer schema/version mismatch.");
  assert(/^VG-/.test(transfer.transferCode), "Transfer confirmation code is missing.");
  assert(transfer.healthMap.conditions.some(({ id }) => id === "hypertension"), "Confirmed condition was not exported.");
  assert(transfer.healthMap.measurements.some(({ key, value }) => key === "hba1c" && value === 7.1), "Confirmed observation was not exported.");
  assert(!/전달검증환자|HANDOFF-001|1980-02-03/.test(transferText), "Transfer exposed direct patient identifiers.");
  assert(await evaluate("document.getElementById('patientTransferStatus').textContent.includes('내보냈습니다')"), "Export status did not confirm completion.");

  await navigate("/emr?demo=1", "document.getElementById('selectedPatientName')?.textContent === '김비타'");
  await evaluate(`
    window.__demoDownload = "";
    URL.createObjectURL = (blob) => { blob.text().then((text) => { window.__demoDownload = text; }); return window.__nativeCreateObjectURL(blob); };
    document.getElementById("exportPatientTransfer").click();
  `);
  await waitFor("document.getElementById('patientTransferStatus').textContent.includes('샘플 환자')", "Demo export was not rejected.");
  assert(await evaluate("window.__demoDownload === ''"), "Demo patient produced a transfer download.");

  await navigate("/map", "Boolean(document.getElementById('healthForm'))");
  await evaluate(`
    sessionStorage.setItem("vitagraph-scene", JSON.stringify({
      declaredIds: ["migraine"], visibleIds: ["migraine"], activeId: "migraine",
      measurements: [], observedAt: "2026-07-19", source: "직접 입력", isDemo: false, note: "편두통"
    }));
    location.reload();
  `);
  await waitFor("document.getElementById('conditionCount')?.textContent === '1개'", "Map did not hydrate the existing scene.");
  const beforeCancelledImport = await evaluate("sessionStorage.getItem('vitagraph-scene')");
  await evaluate(`
    (() => {
      window.confirm = () => false;
      const file = new File([${JSON.stringify(transferText)}], "transfer.json", { type: "application/json" });
      const files = new DataTransfer();
      files.items.add(file);
      document.getElementById("fhirFile").files = files.files;
      document.getElementById("fhirFile").dispatchEvent(new Event("change", { bubbles: true }));
    })();
  `);
  await waitFor("document.getElementById('fhirResult').textContent.includes('취소')", "Cancelled code check did not settle.");
  assert(await evaluate("sessionStorage.getItem('vitagraph-scene')") === beforeCancelledImport, "Cancelled import mutated patient session state.");

  await evaluate(`
    (() => {
      window.confirm = () => true;
      const file = new File([${JSON.stringify(transferText)}], "transfer.json", { type: "application/json" });
      const files = new DataTransfer();
      files.items.add(file);
      document.getElementById("fhirFile").files = files.files;
      document.getElementById("fhirFile").dispatchEvent(new Event("change", { bubbles: true }));
    })();
  `);
  await waitFor("document.getElementById('fhirResult').classList.contains('is-success')", "Confirmed patient import did not finish.");
  const patientScene = JSON.parse(await evaluate("sessionStorage.getItem('vitagraph-scene')"));
  assert(patientScene.visibleIds.includes("hypertension"), "Imported map omitted the condition.");
  assert(patientScene.measurements.some(({ key }) => key === "hba1c"), "Imported map omitted the measurement.");
  assert(patientScene.source.includes("서명되지 않은 사본"), "Unsigned trust label was not preserved in patient state.");

  await navigate("/connections", "Boolean(document.getElementById('networkScene'))");
  await waitFor("document.getElementById('sceneNodeCount')?.textContent.includes('1개')", "Connections did not receive imported patient state.");
  await navigate("/insights", "Boolean(document.getElementById('questionCount'))");
  await waitFor("document.getElementById('questionCount')?.textContent !== '0개 질문'", "Visit brief did not receive imported patient state.");

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

  process.stdout.write(`${JSON.stringify({
    transferCode: transfer.transferCode,
    conditions: transfer.healthMap.conditions.length,
    measurements: transfer.healthMap.measurements.length,
    signedEncounterTransfer: true,
    demoExportBlocked: true,
    cancelledImportAtomic: true,
    mapHydrated: true,
    connectionsLinked: true,
    visitBriefLinked: true,
    gatewayMobileReady: true,
  })}\n`);
} finally {
  client?.close();
  browser.kill("SIGTERM");
  if (browser.exitCode === null) {
    await Promise.race([once(browser, "exit"), delay(2_000)]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
