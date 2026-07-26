import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createCareBridgePatientBriefInput,
  createModelPatientBrief,
  createPatientClinicalSnapshotExport,
  createPatientFallbackBrief,
  createPatientQuestionContext,
  createPatientQuestionHandoff,
  createPatientQuestionRequest,
  patientClinicalSnapshotFilename,
  sanitizePatientSelfReport,
} from "../src/patient-question-assistant.js";

const signedSnapshot = {
  schema: "vitagraph-clinical-snapshot",
  version: 1,
  preparedAt: "2026-07-20T11:30:00.000Z",
  source: "finalized-clinical-record",
  healthMap: {
    conditions: [{
      id: "hypertension",
      label: "고혈압",
      recordedOn: "2026-07-18",
      basis: "confirmed-condition",
    }],
    measurements: [{
      key: "blood-pressure",
      code: "85354-9",
      label: "혈압",
      value: "138/86",
      unit: "mmHg",
      observedOn: "2026-07-20",
      basis: "final-observation",
    }],
  },
  medications: [{
    system: "urn:kr:local-medication",
    code: "ACE-001",
    label: "ACE 억제제",
    prescribedOn: "2026-07-10",
    dose: 1,
    doseUnit: "정",
    route: "경구",
    frequency: "1일 1회",
    durationDays: 30,
    quantity: 30,
    basis: "signed-prescription",
  }],
  summary: {
    includedConditions: 1,
    includedMeasurements: 1,
    includedMedications: 1,
  },
};

const scene = {
  name: "홍길동",
  mrn: "VG-SECRET-42",
  phone: "010-9999-8888",
  note: "홍길동의 원문 자유메모는 모델로 보내면 안 됩니다.",
  visibleIds: ["hypertension", "unknown", "reflux", "hypertension"],
  measurements: [{
    key: "unsupported-measurement",
    label: "임의 검사",
    value: "secret",
    unit: "x",
    observedAt: "2026-07-20",
  }],
  clinicalSnapshot: signedSnapshot,
};

test("환자 질문 컨텍스트는 자동 연결 스냅샷의 허용 항목만 별칭으로 남긴다", () => {
  const context = createPatientQuestionContext(
    scene,
    "2주 전부터 밤에 기침이 잦음. 연락처 010-1234-5678, test@example.com",
  );

  assert.deepEqual(context.conditionIds, ["hypertension", "reflux"]);
  assert.deepEqual(context.measurements, [{
    id: "measurement:blood-pressure",
    key: "blood-pressure",
    label: "혈압",
    value: "138/86",
    unit: "mmHg",
    observedOn: "2026-07-20",
  }]);
  assert.equal(context.medications[0].id, "medication:1");
  assert.equal(context.medications[0].code, "ACE-001");
  assert.match(context.selfReportSummary, /\[개인정보 제거\]/);
  assert.deepEqual(context.evidence.map(({ id }) => id), [
    "condition:hypertension",
    "condition:reflux",
    "measurement:blood-pressure",
    "medication:1",
    "self-report:1",
  ]);
  assert.doesNotMatch(JSON.stringify(context), /홍길동|VG-SECRET-42|010-1234-5678|test@example\.com|원문 자유메모|unsupported-measurement/);
});

test("API 요청은 서버 계약에 맞춘 정제 스냅샷만 보내고 외부 모델은 매 실행 동의를 요구한다", () => {
  const local = createPatientQuestionRequest(scene, "밤에 기침", { asOf: "2026-07-26" });

  assert.equal(local.provider, "local");
  assert.equal(local.consent, false);
  assert.equal(local.clinicalSnapshot.healthMap.conditions.length, 1);
  assert.equal(local.clinicalSnapshot.medications.length, 1);
  assert.deepEqual(local.selfReport, { summary: "밤에 기침" });
  assert.doesNotMatch(JSON.stringify(local), /홍길동|VG-SECRET-42|원문 자유메모/);
  assert.throws(
    () => createPatientQuestionRequest(scene, "밤에 기침", { provider: "frontier" }),
    /외부 모델 전송 범위/,
  );
  const frontier = createPatientQuestionRequest(scene, "밤에 기침", {
    provider: "frontier",
    frontierConsent: true,
  });
  assert.equal(frontier.consent, true);
});

test("결정론적 폴백은 자기보고·측정·서명 처방·질환 질문을 근거와 함께 제한한다", () => {
  const brief = createPatientFallbackBrief(scene, "2주 전부터 밤에 기침이 잦음");
  const questionText = brief.questions.map(({ question }) => question).join(" ");

  assert.equal(brief.kind, "rule-based");
  assert.ok(brief.questions.length > 0 && brief.questions.length <= 5);
  assert.equal(brief.questions[0].evidenceIds[0], "self-report:1");
  assert.ok(brief.questions.some(({ evidenceIds }) => evidenceIds.includes("measurement:blood-pressure")));
  assert.ok(brief.questions.some(({ evidenceIds }) => evidenceIds.includes("medication:1")));
  assert.ok(brief.questions.every(({ origin, question }) => origin === "rule" && question.endsWith("?")));
  assert.match(questionText, /측정이나 검사 전에는 무엇을 준비해야 할까요/);
  assert.match(questionText, /하루 중 언제 먹고, 불편한 증상이 생기면/);
  assert.doesNotMatch(questionText, /추세|전해질|심혈관 위험|촉발 요인|추적 시점|인과관계/);
  assert.match(brief.disclaimer, /진단·처방·응급 판단을 제공하지 않습니다/);
});

test("환자용 질환 질문은 식사와 횟수·시간이 있는 운동을 쉬운 말로 묻는다", () => {
  const brief = createPatientFallbackBrief({
    visibleIds: ["diabetes", "arthritis"],
  });
  const questionText = brief.questions.map(({ question }) => question).join(" ");

  assert.match(questionText, /무엇을 먹어도 되고/);
  assert.match(questionText, /일주일에 몇 번·(?:한 번에 )?몇 분/);
  assert.doesNotMatch(questionText, /추세|전해질|심혈관 위험|촉발 요인|추적 시점|인과관계/);
  assert.ok(brief.questions.every(({ question }) => question.endsWith("?")));
});

test("정제 기록이 많아도 식사·운동 생활 질문을 최소 두 자리 우선 보장한다", () => {
  const richSnapshot = structuredClone(signedSnapshot);
  richSnapshot.healthMap.measurements.push({
    key: "hba1c",
    code: "4548-4",
    label: "당화혈색소",
    value: 6.8,
    unit: "%",
    observedOn: "2026-07-18",
    basis: "final-observation",
  });
  richSnapshot.medications.push({
    system: "urn:kr:local-medication",
    code: "STATIN-001",
    label: "예시 지질약",
    prescribedOn: "2026-07-12",
    dose: 1,
    doseUnit: "정",
    route: "경구",
    frequency: "1일 1회",
    durationDays: 30,
    quantity: 30,
    basis: "signed-prescription",
  });
  const brief = createPatientFallbackBrief({
    ...scene,
    visibleIds: ["hypertension"],
    clinicalSnapshot: richSnapshot,
  }, "최근 어지러움이 있었습니다.");
  const conditionQuestions = brief.questions.filter(({ evidenceIds }) => evidenceIds.includes("condition:hypertension"));
  const questionText = conditionQuestions.map(({ question }) => question).join(" ");

  assert.equal(brief.questions.length, 5);
  assert.equal(brief.questions[0].evidenceIds[0], "self-report:1");
  assert.equal(conditionQuestions.length, 2);
  assert.match(questionText, /어떤 음식을 덜 먹고/);
  assert.match(questionText, /일주일에 몇 번·몇 분/);
  assert.ok(brief.questions.some(({ evidenceIds }) => evidenceIds.some((id) => id.startsWith("measurement:"))));
  assert.ok(brief.questions.some(({ evidenceIds }) => evidenceIds.some((id) => id.startsWith("medication:"))));
});

test("모델 질문과 AI 공유 요약은 정제 근거만 허용하고 진단·처방 문장을 거부한다", () => {
  const response = {
    provider: "local",
    model: "local-test",
    generatedAt: "2026-07-26T10:00:00Z",
    summary: "약 먹는 시간과 밤 기침을 진료에서 물어볼 준비가 됐습니다.",
    questions: [{
      question: "이 약은 하루 중 언제 먹고, 기침이 계속되면 어떻게 문의하면 될까요?",
      reason: "약 먹는 시간과 불편한 증상을 함께 물어보기 위해서입니다.",
      evidenceIds: ["medication:1", "self-report:1"],
    }],
    sharedSignals: [{
      text: "지난 2주 동안 야간 기침이 심했습니다.",
      evidenceIds: ["self-report:1"],
    }],
  };
  const brief = createModelPatientBrief(response, scene, "2주 전부터 밤에 기침이 잦음", "local");

  assert.equal(brief.questions[0].origin, "model");
  assert.deepEqual(brief.questions[0].evidenceIds, ["medication:1", "self-report:1"]);
  assert.equal(brief.sharedSignals.length, 1);

  assert.throws(
    () => createModelPatientBrief({
      ...response,
      questions: [{ ...response.questions[0], evidenceIds: ["emr-secret-event"] }],
    }, scene, "밤에 기침", "local"),
    /근거가 정제 입력과 연결되지 않았습니다/,
  );
  assert.throws(
    () => createModelPatientBrief({
      ...response,
      summary: "고혈압으로 확진되었습니다.",
    }, scene, "밤에 기침", "local"),
    /진단 또는 처방 표현/,
  );
});

test("명시 공유 payload는 우선 질문을 앞에 두고 모델·환자 요약을 안전 표기한다", () => {
  const modelBrief = createModelPatientBrief({
    provider: "frontier",
    model: "frontier-test",
    generatedAt: "2026-07-26T10:00:00Z",
    summary: "밤 기침과 약 먹는 시간을 진료에서 물어볼 준비가 됐습니다.",
    questions: [{
      question: "이 약은 언제 먹고, 밤 기침이 계속되면 어떻게 문의하면 될까요?",
      reason: "약 먹는 시간과 불편한 증상을 함께 물어보기 위해서입니다.",
      evidenceIds: ["self-report:1", "medication:1"],
    }],
    sharedSignals: [{
      text: "2주 전부터 밤 기침이 잦아졌습니다.",
      evidenceIds: ["self-report:1"],
    }],
  }, scene, "2주 전부터 밤에 기침이 잦음", "frontier");
  const selectedId = modelBrief.questions[0].id;
  const handoff = createPatientQuestionHandoff(scene, modelBrief, selectedId);
  const bridgeInput = createCareBridgePatientBriefInput(scene, modelBrief, selectedId);

  assert.equal(handoff.selectedQuestionId, selectedId);
  assert.equal(handoff.safety.modelGenerated, true);
  assert.equal(bridgeInput.source, "frontier-model");
  assert.match(bridgeInput.summary, /환자 입력.*AI 정리 초안/);
  assert.match(bridgeInput.questions[0].basis, /환자가 우선 질문으로 선택/);
  assert.doesNotMatch(JSON.stringify(bridgeInput), /홍길동|VG-SECRET-42|원문 자유메모|010-9999-8888/);
});

test("정제 스냅샷 내보내기 모델은 원문·식별자 없이 고정 스키마를 사용한다", () => {
  const exported = createPatientClinicalSnapshotExport(scene, "2026-07-26T12:30:00Z");

  assert.equal(exported.schema, "vitagraph-personal-clinical-snapshot");
  assert.equal(exported.safety.directIdentifiersIncluded, false);
  assert.equal(exported.safety.rawClinicalNoteIncluded, false);
  assert.equal(exported.refinedContext.medications.length, 1);
  assert.doesNotMatch(JSON.stringify(exported), /홍길동|VG-SECRET-42|원문 자유메모|010-9999-8888/);
  assert.equal(patientClinicalSnapshotFilename(exported.exportedAt), "vitagraph-personal-snapshot-2026-07-26.json");
});

test("자기보고 정리는 길이와 흔한 직접식별자 마스킹 경계를 지킨다", () => {
  const text = sanitizePatientSelfReport(
    `${"기침 ".repeat(300)}저는 김영희이고 서울시 종로구에 살며 900101-5234567, 010-1111-2222`,
  );
  assert.ok(text.length <= 1_000);
  assert.doesNotMatch(text, /김영희|서울시 종로구|900101-5234567|010-1111-2222/);
});

test("진료 준비 화면은 자동 연결·provider 동의·명시 공유·선택 내보내기 흐름을 노출한다", async () => {
  const [html, client, css] = await Promise.all([
    readFile(new URL("../src/insights.html", import.meta.url), "utf8"),
    readFile(new URL("../src/insights.js", import.meta.url), "utf8"),
    readFile(new URL("../src/insights.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /EMR에서 서명하거나 의료진이 확인·확정한 기록 중 식별정보를 제외/);
  assert.match(html, /id="patientSelfReport"[^>]*maxlength="1000"/);
  assert.match(html, /무엇을 먹어도 될까요/);
  assert.match(html, /운동은 일주일에 몇 번·몇 분 하면 좋을까요/);
  assert.match(html, /약은 언제 먹고, 검사 전에는 무엇을 준비할까요/);
  assert.match(html, /name="question-provider" value="local" checked/);
  assert.match(html, /name="question-provider" value="frontier"/);
  assert.match(html, /id="frontierConsent"/);
  assert.match(html, /외부 모델 서비스로 전송/);
  assert.match(html, /id="sharePatientBrief"[^>]*disabled/);
  assert.match(html, /id="exportClinicalSnapshot"[^>]*disabled/);
  assert.match(html, /내 정제 기록을 보관하려면/);
  assert.match(html, /JSON은 병원과 연결하기 위한 업로드 파일이 아니라 환자가 직접 보관·활용하는 사본/);

  assert.match(client, /fetch\("\/api\/patient-question-assistant"/);
  assert.match(client, /createPatientQuestionRequest/);
  assert.match(client, /publishPatientBrief\(createPatientBrief\(input\), \{/);
  assert.match(client, /expectedChannelId: bridgeState\.channelId/);
  assert.match(client, /expectedClinicalFingerprint: clinicalSnapshotFingerprint\(bridgeState\.clinical\.snapshot\)/);
  assert.match(client, /createPatientOwnedJson\(snapshot, exportedAt\)/);
  assert.match(client, /session\.isDemo[\s\S]*?shareBrief\.disabled/);
  assert.match(css, /\.frontier-consent\[hidden\]/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.assistant-provider/);
});
