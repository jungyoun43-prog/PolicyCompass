import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.CHROME_DEBUG_PORT ?? "9229", 10);
const links = [
  { from: "/", selector: ".role-card--clinical .role-action", path: "/emr", hash: "" },
  { from: "/patient", selector: ".landing-actions .landing-button--primary", path: "/map", hash: "#import-record" },
  { from: "/connections", selector: "#sceneEmpty .primary-button", path: "/map", hash: "#import-record" },
  { from: "/journey", selector: "#journeyEmpty .primary-button", path: "/map", hash: "#import-record" },
];
const profile = await mkdtemp(join(tmpdir(), "policycompass-primary-actions-"));
const importedSessionFixture = {
  declaredIds: [],
  patientVisibleIds: ["diabetes"],
  clinicalConditionIds: ["hypertension"],
  clinicalConditions: [{
    id: "hypertension",
    label: "고혈압",
    recordedOn: "2024-12-31",
    basis: "confirmed-condition",
    provenanceKind: "clinician-confirmed-unsigned-import",
  }],
  clinicalMeasurements: [{
    key: "blood-pressure",
    code: "85354-9",
    label: "혈압",
    value: "138/86",
    unit: "mmHg",
    observedAt: "2024-12-31",
    basis: "final-observation",
    provenanceKind: "clinician-final-unsigned-import",
  }],
  visibleIds: ["diabetes", "hypertension"],
  activeId: "hypertension",
  transfer: {
    schema: "policycompass-patient-transfer",
    version: 1,
    exportedAt: "2024-12-31T12:34:56.000Z",
    trust: "unsigned-local-export",
  },
  note: "",
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = spawn(chrome, [
  "--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking",
  "--disable-component-update", "--lang=ko-KR", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

class CdpClient {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data); const pending = this.pending.get(message.id);
      if (!pending) return; this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  async call(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

function assert(value, message) { if (!value) throw new Error(message); }
async function endpoint() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) return; } catch {}
    await delay(100);
  }
  throw new Error("Chrome DevTools endpoint did not start.");
}

let client;
try {
  await endpoint();
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about%3Ablank`, { method: "PUT" })).json();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.call("Page.enable"); await client.call("Runtime.enable"); await client.call("Network.enable"); await client.call("DOM.enable");
  await client.call("Network.setBlockedURLs", { urls: ["https://*/*"] });
  await client.call("Emulation.setTimezoneOverride", { timezoneId: "Asia/Seoul" });
  await client.call("Emulation.setLocaleOverride", { locale: "ko-KR" });
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await client.call("Page.addScriptToEvaluateOnNewDocument", { source: "Date.now=()=>1735689600000;Math.random=()=>0.5;" });

  const evaluate = async (expression) => (await client.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const waitFor = async (expression, message) => {
    for (let i = 0; i < 100; i += 1) { if (await evaluate(expression).catch(() => false)) return; await delay(50); }
    throw new Error(message);
  };
  const navigate = async (route) => {
    await client.call("Page.navigate", { url: `${appUrl}${route}` });
    await waitFor("document.readyState === 'complete'", `${route} did not load`);
  };

  for (const contract of links) {
    await navigate(contract.from);
    const selector = JSON.stringify(contract.selector);
    await waitFor(`Boolean(document.querySelector(${selector}))`, `${contract.from} primary action missing`);
    await evaluate(`document.querySelector(${selector}).click()`);
    await waitFor(`location.pathname === ${JSON.stringify(contract.path)} && location.hash === ${JSON.stringify(contract.hash)}`, `${contract.from} primary action reached an invalid destination`);
  }

  await navigate("/map");
  // The map controller boots after hydration: a synthetic submit is only
  // handled (and refused) once its listener is attached.
  await waitFor(`(() => {
    const event = new Event('submit', { cancelable: true });
    document.getElementById('healthForm').dispatchEvent(event);
    return event.defaultPrevented && !document.getElementById('formError').hidden;
  })()`, "/map empty primary action did not expose validation");
  await evaluate(`document.getElementById('healthNote').value='혈압 148/94';document.getElementById('healthNote').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('analyzeButton').click()`);
  await waitFor("document.getElementById('miniConditionList').children.length > 0", "/map valid primary action did not update state");
  assert(await evaluate("document.getElementById('miniConditionList').textContent.includes('패턴 신호 · 진단 아님')"), "/map promoted a text pattern without marking it as a non-diagnostic signal");

  await evaluate(`sessionStorage.setItem('policycompass-scene', ${JSON.stringify(JSON.stringify(importedSessionFixture))});localStorage.setItem('policycompass-care-bridge-v1','legacy-sensitive-snapshot');location.reload()`);
  await waitFor("document.getElementById('miniConditionList').textContent.includes('고혈압')", "/map did not restore the explicitly imported condition");
  assert(await evaluate("!document.getElementById('miniConditionList').textContent.includes('당뇨병')"), "/map trusted a legacy inferred patientVisibleIds entry");
  assert(await evaluate("localStorage.getItem('policycompass-care-bridge-v1') === null"), "/map did not retire legacy global bridge data");

  await navigate("/insights");
  await waitFor("document.getElementById('clinicalSnapshotStatus').textContent.includes('발행기관·변조 미검증')", "/insights did not expose unsigned-import provenance");
  await waitFor("!document.getElementById('printBrief').disabled", "/insights populated primary action was not enabled");
  await waitFor("Boolean(document.querySelector('.question-select__input'))", "/insights visit question selection was unavailable");
  const selectedQuestionId = await evaluate("document.querySelector('[data-question-id]').dataset.questionId");
  await evaluate("document.querySelector('.question-select').click()");
  await waitFor("document.querySelector('.question-select__input').checked", "/insights visit question did not expose its selected state");
  await navigate("/insights");
  await waitFor(`document.querySelector('[data-question-id="${selectedQuestionId}"] .question-select__input').checked`, "/insights visit question selection was not preserved");
  await evaluate("window.__printInvoked=false;window.print=()=>{window.__printInvoked=true};document.getElementById('printBrief').click()");
  await waitFor("window.__printInvoked === true", "/insights populated primary action did not invoke printing");
  await evaluate("window.__copiedQuestion='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value)=>{window.__copiedQuestion=value}}})");
  await evaluate("document.getElementById('sharePatientBrief').click()");
  await waitFor("document.getElementById('patientAssistantStatus').textContent.includes('클립보드에 복사')", "/insights local question copy did not finish");
  assert(await evaluate("Boolean(window.__copiedQuestion)"), "/insights did not copy the selected question");
  assert(await evaluate("localStorage.getItem('policycompass-care-bridge-v1') === null"), "/insights recreated the retired global bridge");

  await evaluate(`localStorage.setItem('policycompass-journey', JSON.stringify([
    {id:'journey-a',date:'2026-06-01',conditionIds:['hypertension'],measurements:[],source:'직접 입력',createdAt:'2026-06-01T00:00:00.000Z'},
    {id:'journey-b',date:'2026-07-01',conditionIds:['hypertension','diabetes'],measurements:[],source:'직접 입력',createdAt:'2026-07-01T00:00:00.000Z'}
  ]))`);
  await navigate("/journey");
  await waitFor("!document.getElementById('journeyReviewAction').hidden", "/journey review action was not available for two records");
  await evaluate(`window.__journeyScrollBehavior='';document.getElementById('journeyComparison').scrollIntoView=({behavior})=>{window.__journeyScrollBehavior=behavior};document.getElementById('reviewJourneyChanges').click()`);
  await waitFor("document.activeElement === document.getElementById('comparisonTitle')", "/journey review action did not move focus to the comparison");
  assert(await evaluate("window.__journeyScrollBehavior === 'auto'"), "/journey review action ignored reduced-motion preference");
  await evaluate("window.confirm=()=>false;document.querySelector('.snapshot-remove').click()");
  assert(await evaluate("document.querySelectorAll('.snapshot-card').length === 2"), "/journey cancelled delete changed saved records");
  await evaluate("window.confirm=()=>true;document.querySelector('.snapshot-remove').click()");
  await waitFor("document.querySelectorAll('.snapshot-card').length === 1", "/journey confirmed delete did not remove one record");

  await navigate("/emr");
  await waitFor("Boolean(document.getElementById('encounterDate').value)", "/emr module did not initialize");
  await evaluate("document.getElementById('loadDemo').click()");
  await waitFor("document.getElementById('patientList').children.length > 0", "/emr primary action did not load demo patients");
  const emr = await evaluate(`({selected:Boolean(document.querySelector('#patientList [aria-current="true"]')),status:document.getElementById('encounterStatus').dataset.status,next:['checkInPatient','startEncounter','saveEncounterDraft','completeEncounter','signEncounter'].filter(id=>{const element=document.getElementById(id);return element&&!element.hidden&&!element.disabled})})`);
  assert(emr.selected, "/emr demo action did not select a patient");
  const validActions = {
    none: ["checkInPatient"], waiting: ["startEncounter"],
    "in-progress": ["saveEncounterDraft", "completeEncounter"], completed: ["signEncounter"],
  }[emr.status] ?? [];
  assert(emr.next.length > 0 && emr.next.every((action) => validActions.includes(action)), `/emr exposed invalid ${emr.status} actions: ${emr.next.join(",")}`);
  const activatedEmrAction = emr.next[0];
  await evaluate(`document.getElementById(${JSON.stringify(activatedEmrAction)}).click()`);
  const expectedStatus = {
    checkInPatient: "waiting",
    startEncounter: "in-progress",
    saveEncounterDraft: "in-progress",
    completeEncounter: "completed",
    signEncounter: "signed",
  }[activatedEmrAction];
  if (activatedEmrAction === "saveEncounterDraft") {
    await waitFor("document.getElementById('workspaceStatus').textContent.includes('저장')", "/emr draft action did not perform its operation");
  } else {
    await waitFor(`document.getElementById('encounterStatus').dataset.status === ${JSON.stringify(expectedStatus)}`, `/emr ${activatedEmrAction} did not produce ${expectedStatus}`);
  }
  console.log(`primary-action behavioral contracts passed: ${links.length + 5} route states; EMR activated ${activatedEmrAction}`);
} finally {
  client?.close(); browser.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2_000)]);
  if (browser.exitCode === null) browser.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
}
