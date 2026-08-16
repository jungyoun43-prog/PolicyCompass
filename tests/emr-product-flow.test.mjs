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
    "/care-bridge.js",
    "/clinical-question-assistant.js",
    "/claim-rules.js",
    "/claim-search.js",
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
  assert.match(html, /id="syncPersonalRecord"/);
  assert.match(html, /id="personalSyncStatus"/);
  assert.match(html, /환자 전달 파일 내보내기/);
  assert.match(html, /선택 환자의 이름과 일회성 확인 코드를 대조/);
  assert.match(html, /코드는 파일과 다른 경로로 환자에게 전달/);
  assert.match(html, /현재 기록만 교체되고 기존 Journey는 바뀌지 않습니다/);
  assert.doesNotMatch(html, /자동 연결|서명 처방.*Personal/);
  assert.match(html, /id="exportEmr"/);
  assert.match(html, /id="wipeEmr"/);
  assert.match(html, /의료진 검토 전 확정 기록 아님/);
  assert.match(html, /삭감 방지 보장/);

  const script = await (await worker.fetch(new Request("https://example.com/emr.js"))).text();
  assert.match(script, /2 \* 1024 \* 1024/);
  assert.match(script, /오래된 로컬 AI 초안을 폐기/);
  assert.match(script, /copilotRequestFingerprint\(currentRequest\)/);
  assert.match(script, /createPatientTransferPackage/);
  assert.match(script, /patientTransferFilename/);
  assert.match(script, /function exportPatientTransfer\(\)/);
  assert.match(script, /currentExportBlocker/);
  assert.match(script, /patient\.transfer\.exported/);
  assert.match(script, /refs\.syncPersonalRecord\?\.addEventListener\("click", exportPatientTransfer\)/);
  assert.match(script, /state\.demo/);
  assert.doesNotMatch(script, /publishClinicalSnapshot|syncSelectedClinicalSnapshot|syncPatientBriefFromCareBridge|publishPatientBrief/);
  assert.doesNotMatch(script, /readCareBridge|subscribeCareBridge|BroadcastChannel/);
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

test("EMR은 환자·SOAP·임상 입력이 남은 새로고침과 페이지 이탈을 명시적으로 막는다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const script = await (await worker.fetch(new Request("https://example.com/emr.js"))).text();

  assert.match(
    script,
    /function blockUnsafePageExit\(event\) \{\s*if \(!patientFormHasPendingInput\(\) && !patientContextHasUnsavedInput\(\)\) return;\s*event\.preventDefault\(\);\s*event\.returnValue = "";\s*\}/,
  );
  assert.match(script, /window\.addEventListener\("beforeunload", blockUnsafePageExit\)/);
});

test("서명 전 검토는 명시적 확인과 내용 fingerprint를 요구하고 완료 뒤 검토 제목으로 이동한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const [html, script] = await Promise.all([
    worker.fetch(new Request("https://example.com/emr")).then((response) => response.text()),
    worker.fetch(new Request("https://example.com/emr.js")).then((response) => response.text()),
  ]);

  assert.match(html, /id="encounterSignReviewTitle" tabindex="-1"/);
  assert.match(html, /id="encounterSignReviewAcknowledged" type="checkbox"/);
  assert.match(script, /reviewedEncounterSignFingerprint/);
  assert.match(script, /assertEncounterSignReviewFingerprint/);
  assert.match(script, /encounterSignReviewTitle\.focus\(\)/);
  assert.match(script, /signEncounter\.disabled = blockers\.length > 0 \|\| !acknowledged/);
});

test("백업 복원은 전용 미검증 복원 경계로 저장하고 일반 save 우회를 사용하지 않는다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const script = await (await worker.fetch(new Request("https://example.com/emr.js"))).text();

  assert.match(script, /restoreEmrBackupState\(parsed, persistedState, undefined, restoredAt\)/);
  assert.doesNotMatch(script, /allowSignedRecordReplacement/);
});

test("공개 Worker는 EMR 데이터를 받지 않고 로컬 개발 서버만 코파일럿 프록시를 소유한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const statusResponse = await worker.fetch(new Request("https://example.com/api/clinical-copilot/status"));
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), { configured: false, mode: "rule-based", model: "" });

  const response = await worker.fetch(new Request("https://example.com/api/clinical-copilot", {
    method: "POST",
    body: "{}",
  }));

  assert.equal(response.status, 405);
});

test("공개 빌드는 AI와 3D 모델에 필요한 같은 출처 연결만 허용한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const emr = await worker.fetch(new Request("https://example.com/emr"));
  const emrPolicy = emr.headers.get("content-security-policy") ?? "";
  const map = await worker.fetch(new Request("https://example.com/map"));
  const mapPolicy = map.headers.get("content-security-policy") ?? "";

  assert.match(emrPolicy, /connect-src 'self'/);
  assert.doesNotMatch(emrPolicy, /https?:\/\//);
  assert.match(mapPolicy, /connect-src 'self'/);
  assert.doesNotMatch(mapPolicy, /https?:\/\//);
});

test("개발 명령은 새 체크아웃에서도 빌드 산출물을 먼저 만든다", async () => {
  const packageJson = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.dev, /npm run build.*scripts\/dev\.mjs/);
});
