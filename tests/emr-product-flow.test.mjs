import assert from "node:assert/strict";
import test from "node:test";

import { componentMarkup, emrMarkup } from "./helpers/markup.mjs";

const html = await emrMarkup();
const dataUtilities = await componentMarkup("components/emr/data-utilities.jsx");
const overview = await componentMarkup("components/emr/tabs/overview-tab.jsx");
const encounter = await componentMarkup("components/emr/tabs/encounter-tab.jsx");
const app = await componentMarkup("components/emr/emr-app.jsx");
const chart = await componentMarkup("components/emr/tabs/chart-tab.jsx");
const script = [dataUtilities, overview, encounter, app, chart].join("\n");

test("EMR은 환자·차트·신체 지도·코파일럿·급여 칸반·로컬 데이터 제어를 한 흐름에 둔다", () => {
  for (const id of [
    "patientList", "encounterForm", "soapSubjective", "diagnosisForm", "prescriptionForm", "orderForm",
    "encounterClaimSummary", "eventForm", "eventSystem", "clinicalBodyTitle", "bodyVisitList",
    "bodyMedicationList", "copilotPanel", "claimBoard", "ruleServiceSystem", "ruleApplicabilitySystem",
    "fhirImport", "syncPersonalRecord", "personalSyncStatus", "exportEmr", "wipeEmr",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /환자 전달 파일 내보내기/);
  assert.match(html, /선택 환자의 이름과 일회성 확인 코드를 대조/);
  assert.match(html, /코드는 파일과 다른 경로로 환자에게 전달/);
  assert.match(html, /현재 기록만 교체되고 기존 Journey는 바뀌지 않습니다/);
  assert.doesNotMatch(html, /자동 연결|서명 처방.*Personal/);
  assert.match(html, /의료진 검토 전 확정 기록 아님/);
  assert.match(html, /삭감 방지 보장/);

  assert.match(script, /2 \* 1024 \* 1024/);
  assert.match(script, /오래된 로컬 AI 초안을 폐기/);
  assert.match(script, /copilotRequestFingerprint\(/);
  assert.match(script, /createPatientTransferPackage/);
  assert.match(script, /patientTransferFilename/);
  assert.match(script, /currentExportBlocker/);
  assert.match(script, /patient\.transfer\.exported/);
  assert.match(script, /state\.demo/);
  assert.doesNotMatch(script, /publishClinicalSnapshot|syncSelectedClinicalSnapshot|syncPatientBriefFromCareBridge|publishPatientBrief/);
  assert.doesNotMatch(script, /readCareBridge|subscribeCareBridge|BroadcastChannel/);
  assert.match(script, /confirmPatientEvent/);
});

test("EMR은 개인 앱 화면으로 직접 이동하는 링크를 노출하지 않는다", () => {
  const hrefs = [...html.matchAll(/\bhref="([^"]+)"/g)].map(([, href]) => href);
  for (const route of ["/patient", "/map", "/connections", "/insights", "/journey"]) {
    assert.equal(hrefs.includes(route), false, route);
  }
});

test("EMR은 환자·SOAP·임상 입력이 남은 새로고침과 페이지 이탈을 명시적으로 막는다", () => {
  assert.match(app, /beforeunload/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /event\.returnValue = ""/);
});

test("서명 전 검토는 명시적 확인과 내용 fingerprint를 요구하고 완료 뒤 검토 제목으로 이동한다", () => {
  assert.match(encounter, /id="encounterSignReviewTitle" tabindex=\{?["']?-1/);
  assert.match(encounter, /id="encounterSignReviewAcknowledged"/);
  assert.match(encounter, /assertEncounterSignReviewFingerprint/);
  assert.match(encounter, /getElementById\("encounterSignReviewTitle"\)/);
  assert.match(encounter, /disabled=\{blockers\.length > 0 \|\| !acknowledged\}/);
});

test("백업 복원은 전용 미검증 복원 경계로 저장하고 일반 save 우회를 사용하지 않는다", () => {
  assert.match(dataUtilities, /restoreEmrBackupState\(/);
  assert.doesNotMatch(script, /allowSignedRecordReplacement/);
});
