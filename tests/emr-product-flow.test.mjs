import assert from "node:assert/strict";
import test from "node:test";

test("배포 Worker가 로컬 EMR 화면과 모듈을 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const routes = [
    "/emr",
    "/emr.css",
    "/emr.js",
    "/emr-model.js",
    "/emr-encounter.js",
    "/emr-fhir.js",
    "/emr-fhir-export.js",
    "/patient-transfer.js",
    "/claim-rules.js",
  ];

  for (const route of routes) {
    const response = await worker.fetch(new Request(`https://example.com${route}`));
    assert.equal(response.status, 200, route);
  }
});

test("EMR은 환자·차트·신체 지도·코파일럿·급여 칸반·로컬 데이터 제어를 한 흐름에 둔다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const response = await worker.fetch(new Request("https://example.com/emr"));
  const html = await response.text();

  assert.match(html, /id="patientList"/);
  assert.match(html, /id="encounterForm"/);
  assert.match(html, /id="soapSubjective"/);
  assert.match(html, /id="diagnosisForm"/);
  assert.match(html, /id="prescriptionForm"/);
  assert.match(html, /id="orderForm"/);
  assert.match(html, /id="encounterClaimSummary"/);
  assert.match(html, /id="eventForm"/);
  assert.match(html, /id="eventSystem"/);
  assert.match(html, /id="clinicalBodyTitle"/);
  assert.match(html, /id="bodyVisitList"/);
  assert.match(html, /id="bodyMedicationList"/);
  assert.match(html, /id="copilotPanel"/);
  assert.match(html, /id="claimBoard"/);
  assert.match(html, /id="ruleServiceSystem"/);
  assert.match(html, /id="ruleApplicabilitySystem"/);
  assert.match(html, /id="fhirImport"/);
  assert.match(html, /id="exportPatientTransfer"/);
  assert.match(html, /id="patientTransferStatus"/);
  assert.match(html, /id="exportEmr"/);
  assert.match(html, /id="wipeEmr"/);
  assert.match(html, /의료진 검토 전 확정 기록 아님/);
  assert.match(html, /삭감 방지 보장/);

  const script = await (await worker.fetch(new Request("https://example.com/emr.js"))).text();
  assert.match(script, /2 \* 1024 \* 1024/);
  assert.match(script, /오래된 로컬 AI 초안을 폐기/);
  assert.match(script, /copilotRequestFingerprint\(currentRequest\)/);
  assert.match(script, /createPatientTransferPackage\(patient, exportedAt\)/);
  assert.match(script, /patientTransferFilename\(exportedAt\)/);
  assert.match(script, /state\.demo/);
  assert.match(script, /patient\.transfer\.exported/);
  assert.match(script, /data-confirm-event/);
  assert.match(script, /confirmPatientEvent/);
});

test("EMR은 개인 앱 화면으로 직접 이동하는 링크를 노출하지 않는다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const html = await (await worker.fetch(new Request("https://example.com/emr"))).text();
  const hrefs = [...html.matchAll(/\bhref="([^"]+)"/g)].map(([, href]) => href);

  for (const route of ["/patient", "/map", "/connections", "/insights", "/journey"]) {
    assert.equal(hrefs.includes(route), false, route);
  }
});

test("공개 Worker는 EMR 데이터를 받지 않고 로컬 개발 서버만 코파일럿 프록시를 소유한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const response = await worker.fetch(new Request("https://example.com/api/clinical-copilot", {
    method: "POST",
    body: "{}",
  }));

  assert.equal(response.status, 405);
});

test("공개 빌드는 네트워크 연결을 차단한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const response = await worker.fetch(new Request("https://example.com/emr"));
  const policy = response.headers.get("content-security-policy") ?? "";

  assert.match(policy, /connect-src 'none'/);
  assert.doesNotMatch(policy, /https?:\/\//);
});

test("개발 명령은 새 체크아웃에서도 빌드 산출물을 먼저 만든다", async () => {
  const packageJson = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.dev, /npm run build.*scripts\/dev\.mjs/);
});
