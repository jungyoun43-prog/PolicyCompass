import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.HANDOFF_CHROME_DEBUG_PORT ?? "9226", 10);
const profile = await mkdtemp(join(tmpdir(), "vitagraph-handoff-smoke-"));
const reportPath = process.env.HANDOFF_SMOKE_REPORT ?? join("artifacts", "smoke", "handoff-smoke-report.json");
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
  await evaluate(`
    document.getElementById("medicationCode").value = "C09AA02";
    document.getElementById("medicationSystem").value = "http://www.whocc.no/atc";
    document.getElementById("medicationName").value = "에날라프릴";
    document.getElementById("medicationDose").value = "5";
    document.getElementById("medicationDoseUnit").value = "mg";
    document.getElementById("medicationRoute").value = "경구";
    document.getElementById("medicationFrequency").value = "1일 1회";
    document.getElementById("medicationDurationDays").value = "30";
    document.getElementById("medicationQuantity").value = "30";
    document.getElementById("prescriptionForm").requestSubmit();
  `);
  await waitFor("document.getElementById('prescriptionList').textContent.includes('에날라프릴')", "Encounter prescription did not render.");
  await evaluate("document.getElementById('completeEncounter').click();");
  await waitFor("document.getElementById('encounterStatusText').textContent === '서명 대기'", "Encounter did not complete.");
  await waitFor("document.getElementById('encounterSignReviewAcknowledged').disabled === false", "Pre-sign review did not become available.");
  await evaluate(`
    document.getElementById("encounterSignReviewAcknowledged").checked = true;
    document.getElementById("encounterSignReviewAcknowledged").dispatchEvent(new Event("change", { bubbles: true }));
  `);
  await waitFor("document.getElementById('signEncounter').disabled === false", "Explicit pre-sign acknowledgement did not enable signing.");
  await evaluate("window.confirm = () => true; document.getElementById('signEncounter').click();");
  await waitFor("document.getElementById('encounterStatusText').textContent === '완료·서명'", "Encounter did not sign.");

  await waitFor("Boolean(JSON.parse(localStorage.getItem('vitagraph-care-bridge-v1') || 'null')?.clinical?.snapshot)", "Signed encounter did not publish an automatic Personal snapshot.");
  const bridgeText = await evaluate("localStorage.getItem('vitagraph-care-bridge-v1')");
  const bridge = JSON.parse(bridgeText);
  const clinical = bridge.clinical.snapshot;
  assert(bridge.schema === "vitagraph-care-bridge" && bridge.version === 1, "Care bridge schema/version mismatch.");
  assert(clinical.schema === "vitagraph-clinical-snapshot", "Clinical snapshot schema mismatch.");
  assert(clinical.healthMap.conditions.some(({ id }) => id === "hypertension"), "Confirmed condition was not refined into the bridge.");
  assert(clinical.healthMap.measurements.some(({ key, value }) => key === "hba1c" && value === 7.1), "Final observation was not refined into the bridge.");
  assert(clinical.medications.some(({ code, label }) => code === "C09AA02" && label === "에날라프릴"), "Signed prescription was not refined into the bridge.");
  assert(!/전달검증환자|HANDOFF-001|1980-02-03|특이 증상 없음|복약 유지/.test(bridgeText), "Care bridge exposed an identifier or raw clinical note.");
  assert(await evaluate("document.getElementById('personalSyncStatus').textContent.includes('Personal 자동 연결')"), "EMR did not announce the automatic Personal connection.");

  await navigate("/emr?demo=1", "document.getElementById('selectedPatientName')?.textContent === '김비타'");
  await evaluate("document.getElementById('syncPersonalRecord').click()");
  await waitFor("document.getElementById('personalSyncStatus').textContent.includes('예시 환자')", "Example patient Personal sync was not rejected.");
  assert(await evaluate(`localStorage.getItem('vitagraph-care-bridge-v1') === ${JSON.stringify(bridgeText)}`), "Demo workspace replaced the real patient's connected snapshot.");

  await navigate("/map", "Boolean(document.getElementById('healthForm'))");
  await evaluate(`
    sessionStorage.setItem("vitagraph-scene", JSON.stringify({
      declaredIds: ["migraine"], visibleIds: ["migraine"], activeId: "migraine",
      measurements: [], observedAt: "2026-07-19", source: "직접 입력", isDemo: false, note: "편두통"
    }));
    location.reload();
  `);
  await waitFor("document.getElementById('conditionCount')?.textContent === '2개'", "Map did not merge the existing scene with the connected clinical record.");
  assert(await evaluate(`(() => {
    const scene = JSON.parse(sessionStorage.getItem("vitagraph-scene"));
    return scene.patientVisibleIds.includes("migraine")
      && scene.clinicalConditionIds.includes("hypertension")
      && scene.visibleIds.includes("migraine")
      && scene.visibleIds.includes("hypertension");
  })()`), "Map did not persist patient and clinical condition provenance separately.");
  assert(await evaluate("document.getElementById('careLinkStatus').dataset.state === 'connected'"), "Map did not expose the connected signed-record state.");
  assert(await evaluate("document.getElementById('careLinkSummary').textContent.includes('확정 질환 1개') && document.getElementById('careLinkSummary').textContent.includes('최종 측정 1개') && document.getElementById('careLinkSummary').textContent.includes('서명 처방 1개')"), "Map did not summarize the refined clinical scope.");
  assert(await evaluate("document.getElementById('careConditionList').textContent.includes('고혈압') && document.getElementById('careConditionList').textContent.includes('의료진 확정')"), "Map did not show the refined condition details.");
  assert(await evaluate("document.getElementById('careMeasurementList').textContent.includes('당화혈색소 7.1 %') && document.getElementById('careMeasurementList').textContent.includes('최종 측정')"), "Map did not show the refined measurement details.");
  assert(await evaluate("document.getElementById('careMedicationList').textContent.includes('에날라프릴') && document.getElementById('careMedicationList').textContent.includes('5mg') && document.getElementById('careMedicationList').textContent.includes('1일 1회')"), "Map did not show the signed prescription details.");
  assert(await evaluate("!document.getElementById('transferCode') && !document.getElementById('fhirFile') && !document.getElementById('importRecordButton')"), "Map still exposes the retired patient JSON upload flow.");

  await evaluate(`
    window.__ownedJsonText = "";
    window.__nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.text().then((text) => { window.__ownedJsonText = text; });
      return window.__nativeCreateObjectURL(blob);
    };
    document.getElementById("downloadClinicalJson").click();
  `);
  await waitFor("window.__ownedJsonText.length > 0", "Patient-owned refined JSON download was not produced.");
  const ownedJsonText = await evaluate("window.__ownedJsonText");
  const owned = JSON.parse(ownedJsonText);
  assert(owned.schema === "vitagraph-patient-owned-record" && owned.scope === "patient-controlled-copy", "Patient-owned JSON scope/schema mismatch.");
  assert(owned.clinical.healthMap.conditions.some(({ id }) => id === "hypertension"), "Patient-owned JSON omitted the refined condition.");
  assert(owned.clinical.medications.some(({ label }) => label === "에날라프릴"), "Patient-owned JSON omitted the signed prescription.");
  assert(!/전달검증환자|HANDOFF-001|1980-02-03|특이 증상 없음|복약 유지/.test(ownedJsonText), "Patient-owned JSON exposed an identifier or raw clinical note.");
  await evaluate("document.getElementById('resetButton').click()");
  await waitFor("document.getElementById('conditionCount')?.textContent === '1개'", "Clearing patient input also removed the connected clinical condition.");
  assert(await evaluate("document.getElementById('miniConditionList').textContent.includes('고혈압') && !document.getElementById('miniConditionList').textContent.includes('편두통')"), "Map did not preserve only the connected record after clearing patient input.");

  await navigate("/connections", "Boolean(document.getElementById('networkScene'))");
  await waitFor("document.getElementById('sceneNodeCount')?.textContent.includes('1개')", "Connections did not receive the connected patient state.");
  assert(await evaluate(`(() => {
    const node = document.querySelector('[data-node-id="hypertension"]');
    const detail = document.getElementById("explorerEvidenceKind");
    return node?.dataset.evidenceKind === "recorded"
      && node?.dataset.evidenceSource === "clinical"
      && /서명·확정/.test(node.getAttribute("aria-label") || "")
      && !/진단 사실 아님/.test(node.getAttribute("aria-label") || "")
      && detail?.dataset.provenance === "clinical"
      && /EMR 확정 기록/.test(detail.textContent)
      && !/진단(?:으로 기록된 사실이| 사실) 아님/.test(detail.textContent);
  })()`), "Connections mislabeled the EMR-confirmed condition as inferred or unverified.");
  await navigate("/insights", "Boolean(document.getElementById('questionCount'))");
  await waitFor("document.getElementById('questionCount')?.textContent !== '0개 질문'", "Visit brief did not receive the connected patient state.");
  assert(await evaluate("document.getElementById('clinicalSnapshotStatus').textContent.includes('자동 연결')"), "Visit brief did not identify the signed snapshot.");
  await evaluate(`
    document.getElementById("patientSelfReport").value = "지난 2주 동안 야간 기침이 심했습니다.";
    document.getElementById("patientSelfReport").dispatchEvent(new Event("input", { bubbles: true }));
  `);
  await waitFor("document.getElementById('questions').textContent.includes('이 불편함이 계속되거나 심해지면')", "Patient self-report did not create a grounded rule question.");
  await evaluate("document.querySelector('.question-select__input').click()");
  await waitFor("document.querySelector('.question-select__input').checked && !document.getElementById('sharePatientBrief').disabled", "Patient did not explicitly select a question for sharing.");
  await evaluate("document.getElementById('sharePatientBrief').click()");
  await waitFor("document.getElementById('patientAssistantStatus').textContent.includes('의료진 EMR에 공유')", "Patient brief share did not finish.");
  const sharedBridgeText = await evaluate("localStorage.getItem('vitagraph-care-bridge-v1')");
  const sharedBridge = JSON.parse(sharedBridgeText);
  assert(sharedBridge.patient?.brief?.summary.includes("지난 2주 동안 야간 기침이 심했습니다"), "Shared brief omitted the patient-authored nocturnal cough summary.");
  assert(sharedBridge.patient.brief.questions.length > 0, "Shared brief omitted the explicitly selected question.");

  await navigate("/emr", "document.getElementById('selectedPatientName')?.textContent === '전달검증환자'");
  await waitFor("Boolean(document.querySelector('.copilot-bridge-status'))", "EMR did not receive the explicitly shared patient brief.");
  assert(await evaluate("document.querySelector('.copilot-bridge-status').textContent.includes('환자가 공유한 내용') && document.querySelector('.copilot-bridge-status').textContent.includes('미검증')"), "EMR did not label the patient brief as shared and unverified.");
  assert(await evaluate("document.getElementById('copilotContent').textContent.includes('기침이 시작된 시점') && document.getElementById('copilotContent').textContent.includes('에날라프릴') && document.getElementById('copilotContent').textContent.includes('원인이라고 단정하지 않습니다')"), "Clinician assistant did not turn the cough/ACE timing signal into a non-causal confirmation question.");

  await navigate("/map", "Boolean(document.getElementById('healthForm'))");
  await evaluate(`
    document.getElementById("healthNote").value = "속쓰림";
    document.getElementById("healthNote").dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('[data-condition="migraine"]').click();
    document.getElementById("healthForm").requestSubmit();
  `);
  await waitFor("document.getElementById('conditionCount')?.textContent === '3개'", "Map did not combine clinical, patient-declared, and input-inferred conditions before disconnect.");
  const staleClinicalScene = await evaluate("sessionStorage.getItem('vitagraph-scene')");
  const staleClinicalSceneValue = JSON.parse(staleClinicalScene);
  assert(staleClinicalSceneValue.clinicalConditionIds.includes("hypertension"), "Clinical condition provenance was not persisted before disconnect.");
  assert(staleClinicalSceneValue.patientVisibleIds.includes("migraine") && staleClinicalSceneValue.patientVisibleIds.includes("reflux"), "Patient-declared or input-inferred conditions were not preserved separately before disconnect.");
  await evaluate("localStorage.removeItem('vitagraph-care-bridge-v1')");

  await evaluate(`sessionStorage.setItem("vitagraph-scene", ${JSON.stringify(staleClinicalScene)})`);
  await navigate("/connections", "Boolean(document.getElementById('networkScene'))");
  await waitFor("document.getElementById('sceneNodeCount')?.textContent.includes('2개')", "Connections retained a stale clinical-only condition after disconnect.");
  assert(await evaluate(`(() => {
    const ids = [...document.querySelectorAll("[data-node-id]")].map(({ dataset }) => dataset.nodeId);
    const migraine = document.querySelector('[data-node-id="migraine"]');
    const reflux = document.querySelector('[data-node-id="reflux"]');
    return !ids.includes("hypertension")
      && ids.includes("migraine")
      && ids.includes("reflux")
      && migraine?.dataset.evidenceSource === "patient"
      && migraine?.dataset.evidenceKind === "recorded"
      && reflux?.dataset.evidenceSource === "inferred"
      && reflux?.dataset.evidenceKind === "inferred";
  })()`), "Connections did not preserve patient provenance while removing the disconnected clinical condition.");

  await evaluate(`sessionStorage.setItem("vitagraph-scene", ${JSON.stringify(staleClinicalScene)})`);
  await navigate("/insights", "Boolean(document.getElementById('questionCount'))");
  await waitFor("document.getElementById('questionCount')?.textContent !== '0개 질문'", "Insights did not preserve patient questions after clinical disconnect.");
  assert(await evaluate(`(() => {
    const signals = document.getElementById("signals").textContent;
    return signals.includes("편두통")
      && signals.includes("위식도역류")
      && !signals.includes("고혈압")
      && document.getElementById("clinicalSnapshotStatus").textContent.includes("연결되지 않았")
      && document.getElementById("exportClinicalSnapshot").disabled
      && document.getElementById("sharePatientBrief").disabled;
  })()`), "Insights retained stale clinical evidence or discarded patient-declared/inferred evidence after disconnect.");

  await evaluate(`sessionStorage.setItem("vitagraph-scene", ${JSON.stringify(staleClinicalScene)})`);
  await navigate("/map", "Boolean(document.getElementById('healthForm'))");
  await waitFor("document.getElementById('conditionCount')?.textContent === '2개'", "Map retained a stale clinical-only condition after disconnect.");
  assert(await evaluate(`(() => {
    const labels = document.getElementById("miniConditionList").textContent;
    const scene = JSON.parse(sessionStorage.getItem("vitagraph-scene"));
    return labels.includes("편두통")
      && labels.includes("위식도역류")
      && !labels.includes("고혈압")
      && scene.clinicalConditionIds.length === 0
      && scene.patientVisibleIds.includes("migraine")
      && scene.patientVisibleIds.includes("reflux")
      && !scene.visibleIds.includes("hypertension")
      && document.getElementById("careLinkStatus").dataset.state === "empty"
      && document.getElementById("careLinkDetails").hidden;
  })()`), "Map did not clear stale clinical details while preserving patient-declared and inferred conditions.");

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

  const result = {
    channelId: sharedBridge.channelId,
    conditions: clinical.healthMap.conditions.length,
    measurements: clinical.healthMap.measurements.length,
    medications: clinical.medications.length,
    signedEncounterAutoConnected: true,
    demoSyncBlocked: true,
    patientOwnedJsonExported: true,
    mapHydrated: true,
    connectionsLinked: true,
    clinicalProvenanceVisible: true,
    visitBriefLinked: true,
    patientBriefExplicitlyShared: true,
    clinicianCoughAceQuestionGrounded: true,
    staleClinicalClearedEverywhere: true,
    patientSignalsPreservedAfterDisconnect: true,
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
}
