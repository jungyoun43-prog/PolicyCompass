import assert from "node:assert/strict";
import test from "node:test";

import {
  createClinicalQuestionSuggestions,
  normalizeClinicalPatientBrief,
} from "../src/clinical-question-assistant.js";
import {
  createCopilotRequest,
  createLocalCopilotBrief,
} from "../src/emr-model.js";

const patient = {
  id: "patient-internal",
  name: "김비밀",
  mrn: "SECRET-MRN",
  phone: "010-9999-8888",
  birthDate: "1970-01-02",
  events: [
    {
      id: "med-ace",
      type: "medication",
      recordStatus: "final",
      system: "http://www.whocc.no/atc",
      code: "C09AA02",
      label: "에날라프릴",
      date: "2026-07-01",
      status: "active",
      source: { kind: "manual", label: "확정 처방" },
    },
    {
      id: "condition-htn",
      type: "condition",
      recordStatus: "final",
      system: "urn:kr:kcd",
      code: "I10",
      label: "고혈압",
      date: "2026-06-01",
      status: "active",
      verificationStatus: "confirmed",
      source: { kind: "manual", label: "확정 차트" },
    },
    {
      id: "draft-observation",
      type: "observation",
      recordStatus: "draft",
      system: "http://loinc.org",
      code: "85354-9",
      label: "초안 혈압",
      date: "2026-07-20",
      status: "final",
      value: "160/100",
      unit: "mmHg",
      source: { kind: "encounter", label: "진료 초안" },
    },
  ],
};

const bridgeBrief = {
  schema: "vitagraph-patient-brief",
  version: 1,
  preparedAt: "2026-07-26T08:00:00.000Z",
  source: "local-model",
  summary: "김비밀 환자는 지난 2주 동안 야간 기침이 심했습니다. SECRET-MRN",
  signals: ["밤에 누우면 기침", "010-9999-8888"],
  questions: [{
    question: "이 기침과 약을 같이 확인해야 하나요?",
    basis: "환자가 선택한 질문",
  }],
};

test("환자 브리프는 실제 care bridge 형태를 제한된 로컬 별칭으로 정규화하고 직접식별자를 제거한다", () => {
  const normalized = normalizeClinicalPatientBrief(bridgeBrief, patient);
  const serialized = JSON.stringify(normalized);

  assert.equal(normalized.items[0].id, "patient-brief-1");
  assert.ok(normalized.items.some(({ kind }) => kind === "summary"));
  assert.ok(normalized.items.some(({ kind }) => kind === "concern"));
  assert.ok(normalized.items.some(({ kind }) => kind === "question"));
  assert.doesNotMatch(serialized, /김비밀|SECRET-MRN|010-9999-8888/);
  assert.match(serialized, /\[식별정보 제거\]/);
});

test("규칙 기반 폴백은 야간 기침과 ACE 억제제 기록의 시간 관계를 진단이 아닌 교차근거 질문으로 만든다", () => {
  const draft = createClinicalQuestionSuggestions(patient, bridgeBrief);
  const temporal = draft.clinicianQuestions.find(({ question }) => /복용 시작|용량 변경/.test(question));

  assert.ok(temporal);
  assert.deepEqual(temporal.evidenceEventIds, ["med-ace"]);
  assert.deepEqual(temporal.patientBriefIds, ["patient-brief-1"]);
  assert.match(temporal.reason, /원인이라고 단정하지 않습니다/);
  assert.ok(draft.patientQuestions.some(({ question }) => /기침과 약/.test(question)));
  assert.ok(draft.patientBriefProvenance.every(({ sourceLabel }) => /로컬 AI 브리프/.test(sourceLabel)));
  assert.doesNotMatch(JSON.stringify(draft), /초안 혈압|draft-observation/);
});

test("EMR 질문 초안은 확정 차트만 사용하고 의사용·환자 예상 질문 및 환자보고 출처를 분리한다", () => {
  const brief = createLocalCopilotBrief(patient, [], "2026-07-26", bridgeBrief);
  const serialized = JSON.stringify(brief);

  assert.equal(brief.confirmed, false);
  assert.ok(brief.clinicianQuestions.length > 0);
  assert.ok(brief.patientQuestions.length > 0);
  assert.deepEqual(brief.questions, brief.patientQuestions);
  assert.ok(brief.patientBriefProvenance.length > 0);
  assert.doesNotMatch(serialized, /초안 혈압|draft-observation/);
  assert.match(brief.disclaimer, /진단·처방·인과관계/);
});

test("Ollama 직렬화는 환자 브리프를 patient-N으로 재별칭하고 차트·환자 근거 매핑을 분리 보존한다", () => {
  const request = createCopilotRequest(patient, [], "2026-07-26", bridgeBrief);
  const serialized = JSON.stringify(request.payload);

  assert.equal(request.payload.patientBrief.items[0].id, "patient-1");
  assert.equal(request.aliasToPatientBriefId.get("patient-1"), "patient-brief-1");
  assert.equal(request.aliasToEventId.get("event-1"), "med-ace");
  assert.doesNotMatch(serialized, /김비밀|SECRET-MRN|010-9999-8888|med-ace|condition-htn/);
  assert.deepEqual(request.payload.patientBrief.safety, {
    patientReported: true,
    verifiedClinicalFact: false,
  });
});
