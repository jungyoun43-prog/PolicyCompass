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
    throw new Error(message);
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

  await evaluate(`
    document.querySelector('[data-tab-target="chart"]').click();
    document.getElementById("eventType").value = "condition";
    document.getElementById("eventDate").value = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    document.getElementById("eventSystem").value = "urn:kr:kcd";
    document.getElementById("eventCode").value = "I10";
    document.getElementById("eventLabel").value = "본태성 고혈압";
    document.getElementById("eventForm").requestSubmit();
  `);
  await waitFor("document.querySelectorAll('[data-confirm-event]').length === 1", "Condition draft was not created.");
  await evaluate("window.confirm = () => true; document.querySelector('[data-confirm-event]').click();");
  await waitFor("document.querySelectorAll('[data-confirm-event]').length === 0", "Condition draft was not confirmed.");

  await evaluate(`
    document.getElementById("eventType").value = "observation";
    document.getElementById("eventType").dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("eventDate").value = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    document.getElementById("eventCode").value = "4548-4";
    document.getElementById("eventLabel").value = "당화혈색소";
    document.getElementById("eventValue").value = "7.1";
    document.getElementById("eventUnit").value = "%";
    document.getElementById("eventForm").requestSubmit();
  `);
  await waitFor("document.querySelectorAll('[data-confirm-event]').length === 1", "Observation draft was not created.");
  await evaluate("document.querySelector('[data-confirm-event]').click();");
  await waitFor("document.querySelectorAll('[data-confirm-event]').length === 0", "Observation draft was not confirmed.");

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

  process.stdout.write(`${JSON.stringify({
    transferCode: transfer.transferCode,
    conditions: transfer.healthMap.conditions.length,
    measurements: transfer.healthMap.measurements.length,
    demoExportBlocked: true,
    cancelledImportAtomic: true,
    mapHydrated: true,
    connectionsLinked: true,
    visitBriefLinked: true,
  })}\n`);
} finally {
  client?.close();
  browser.kill("SIGTERM");
  if (browser.exitCode === null) {
    await Promise.race([once(browser, "exit"), delay(2_000)]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
