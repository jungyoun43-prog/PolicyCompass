import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assert, runBrowserSmoke, writeSmokeReport } from "./browser-smoke-harness.mjs";

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const runId = process.env.PR_GATE_RUN_ID ?? `local-${process.pid}`;
const cell = process.env.PR_GATE_CELL_ID ?? "clinician-then-patient-shared";
const profileType = process.env.PR_GATE_PROFILE_TYPE ?? "shared-sequential";
const cellRoot = process.env.PR_GATE_CELL_ROOT ?? join("artifacts", "pr-gate", runId, cell);
const reportPath = process.env.PR_SHARED_PROFILE_REPORT ?? join(cellRoot, "report.json");
const steps = [];
let activeStep = "launch";

await mkdir(cellRoot, { recursive: true });

try {
  await runBrowserSmoke({
    appUrl,
    debugPort: Number.parseInt(process.env.PR_GATE_CHROME_DEBUG_PORT ?? "9244", 10),
    profilePrefix: "policycompass-pr-shared-",
  }, async ({ client, evaluate, navigate, waitFor }) => {
    const step = async (name, action) => {
      activeStep = name;
      await action();
      steps.push(name);
    };

    await step("clinician-context", async () => {
      await navigate("/emr", "Boolean(document.getElementById('eventDate')?.value)");
      await evaluate("document.getElementById('loadDemo').click()");
      await waitFor("document.getElementById('selectedPatientName')?.textContent === '김비타'", "Clinician sample workspace did not open.");
      const context = await evaluate(`({
        patient: document.getElementById('selectedPatientName')?.textContent.trim(),
        mrn: document.getElementById('selectedPatientMeta')?.textContent.trim(),
        encounter: document.getElementById('encounterStatusText')?.textContent.trim(),
        patientRouteLinks: [...document.querySelectorAll('a[href]')]
          .filter((link) => ['/patient','/map','/connections','/insights','/journey'].includes(new URL(link.href).pathname)).length
      })`);
      assert(context.patient === "김비타", "Clinician golden flow lost patient identity.");
      assert(context.mrn.includes("VG-1001"), "Clinician golden flow omitted MRN context.");
      assert(context.patientRouteLinks === 0, "Clinician flow crossed into patient navigation.");
    });

    await step("patient-local-boundary", async () => {
      await navigate("/patient", "Boolean(document.querySelector('[data-first-use=\"patient\"]'))");
      const boundary = await evaluate(`({
        local: document.querySelector('[data-route-context]')?.textContent ?? '',
        clinicianLinks: [...document.querySelectorAll('a[href]')]
          .filter((link) => new URL(link.href).pathname === '/emr').length,
        journeyBefore: localStorage.getItem('policycompass-journey')
      })`);
      assert(
        /이 기기|브라우저/.test(boundary.local)
          && /동의한 경우에만|서버 자동 전송 없음/.test(boundary.local),
        "Patient local-storage boundary is unclear.",
      );
      assert(boundary.clinicianLinks === 0, "Patient flow crossed into clinician navigation.");
    });

    await step("patient-sample-boundary", async () => {
      await navigate("/map?sample=1", "document.getElementById('conditionCount')?.textContent !== '0개'");
      assert(await evaluate("sessionStorage.getItem('policycompass-scene') === null"), "Patient sample wrote a real Personal scene.");
      await navigate("/journey?sample=1", "Boolean(document.querySelector('[data-story-section=\"changed\"]'))");
      assert(await evaluate("new URLSearchParams(location.search).get('sample') === '1' && document.getElementById('journeyTimeline').hidden && sessionStorage.getItem('policycompass-scene') === null"), "Patient sample crossed into real Journey or persisted a scene.");
    });

    await writeSmokeReport(reportPath, {
      suite: "pr-shared-profile",
      runId,
      cell,
      profileType,
      flowOrder: ["clinician", "patient"],
      steps,
      productAssertions: {
        clinicianPatientContext: true,
        roleBoundary: true,
        patientLocalStorageExplanation: true,
        patientSampleIsolation: true,
      },
    });

    void client;
  });
} catch (error) {
  const failure = { runId, cell, profileType, step: activeStep, message: error.message };
  await writeFile(join(cellRoot, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  throw error;
}
