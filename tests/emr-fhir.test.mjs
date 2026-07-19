import assert from "node:assert/strict";
import test from "node:test";

import { parseEmrFhirBundle } from "../src/emr-fhir.js";
import { addPatient, createEmptyEmrState } from "../src/emr-model.js";
import { evaluateClaimRule } from "../src/claim-rules.js";

const coding = (code, display) => ({ coding: [{ system: "http://example.test", code, display }], text: display });

test("FHIR Bundle을 환자와 임상 이벤트로 변환하고 출처를 보존한다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    timestamp: "2026-07-19T09:00:00Z",
    entry: [
      { fullUrl: "Patient/p1", resource: { resourceType: "Patient", id: "p1", identifier: [{ value: "VG-1001" }], name: [{ text: "김비타" }], birthDate: "1974-04-12", gender: "female" } },
      { fullUrl: "Condition/c1", resource: { resourceType: "Condition", id: "c1", subject: { reference: "Patient/p1" }, clinicalStatus: coding("active", "Active"), verificationStatus: coding("confirmed", "Confirmed"), code: coding("I10", "고혈압"), recordedDate: "2026-01-01" } },
      { fullUrl: "Observation/o1", resource: { resourceType: "Observation", id: "o1", subject: { reference: "Patient/p1" }, status: "final", code: coding("4548-4", "당화혈색소"), valueQuantity: { value: 6.8, unit: "%" }, effectiveDateTime: "2026-07-10" } },
      { fullUrl: "MedicationRequest/m1", resource: { resourceType: "MedicationRequest", id: "m1", subject: { reference: "Patient/p1" }, status: "active", intent: "order", medicationCodeableConcept: coding("MED-1", "예시 혈압약"), authoredOn: "2026-07-01" } },
      { fullUrl: "AllergyIntolerance/a1", resource: { resourceType: "AllergyIntolerance", id: "a1", patient: { reference: "Patient/p1" }, clinicalStatus: coding("active", "Active"), verificationStatus: coding("confirmed", "Confirmed"), code: coding("ALG-1", "페니실린"), recordedDate: "2025-01-01" } },
      { fullUrl: "Procedure/pr1", resource: { resourceType: "Procedure", id: "pr1", subject: { reference: "Patient/p1" }, status: "completed", code: coding("DEMO-PROC", "예시 추적검사"), performedDateTime: "2026-06-20" } },
      { fullUrl: "Encounter/e1", resource: { resourceType: "Encounter", id: "e1", subject: { reference: "Patient/p1" }, status: "finished", class: { code: "AMB", display: "외래" }, period: { start: "2026-07-19T09:00:00Z", end: "2026-07-19T09:20:00Z" } } },
    ],
  });

  assert.equal(result.patient.name, "김비타");
  assert.equal(result.patient.mrn, "VG-1001");
  assert.deepEqual(
    result.patient.events.map(({ type }) => type).sort(),
    ["condition", "observation", "medication", "allergy", "procedure", "encounter"].sort(),
  );
  assert.deepEqual(
    result.patient.events.map(({ date }) => date),
    [...result.patient.events.map(({ date }) => date)].sort((a, b) => b.localeCompare(a)),
  );
  assert.ok(result.patient.events.every(({ source }) => source.kind === "fhir"));
  assert.equal(result.patient.events.find(({ type }) => type === "condition").verificationStatus, "confirmed");
  assert.equal(result.patient.events.find(({ type }) => type === "medication").intent, "order");
  assert.equal(result.provenance.format, "FHIR R4");
  assert.equal(result.provenance.unsupported, 0);
});

test("취소·오류·비활성 리소스는 확정 이벤트로 만들지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { resource: { resourceType: "Patient", id: "p1", name: [{ text: "테스트" }] } },
      { resource: { resourceType: "Condition", id: "c1", subject: { reference: "Patient/p1" }, clinicalStatus: coding("resolved", "Resolved"), code: coding("I10", "고혈압") } },
      { resource: { resourceType: "Observation", id: "o1", subject: { reference: "Patient/p1" }, status: "entered-in-error", code: coding("x", "오류"), valueString: "오류" } },
      { resource: { resourceType: "Procedure", id: "p1", subject: { reference: "Patient/p1" }, status: "not-done", code: coding("x", "미시행") } },
      { resource: { resourceType: "DocumentReference", id: "d1" } },
    ],
  });

  assert.equal(result.patient.events.length, 0);
  assert.equal(result.provenance.unsupported, 4);
});

test("결과 값이 없는 확정 Observation은 급여 근거가 되지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { fullUrl: "Patient/p1", resource: { resourceType: "Patient", id: "p1", name: [{ text: "테스트" }] } },
      {
        fullUrl: "Observation/no-value",
        resource: {
          resourceType: "Observation",
          id: "no-value",
          subject: { reference: "Patient/p1" },
          status: "final",
          code: coding("85354-9", "혈압"),
          dataAbsentReason: coding("unknown", "Unknown"),
          effectiveDateTime: "2026-07-10",
        },
      },
    ],
  });
  const evaluation = evaluateClaimRule(result.patient, {
    id: "bp-rule",
    title: "혈압 추적",
    serviceCode: "SERVICE",
    requiredEvidence: [{ code: "85354-9", label: "혈압 결과", eventTypes: ["observation"], lookbackDays: 90 }],
    effectiveFrom: "2026-01-01",
  }, "2026-07-19");

  assert.equal(result.patient.events.length, 0);
  assert.equal(result.provenance.unsupported, 1);
  assert.equal(evaluation.status, "missing-evidence");
});

test("FHIR Bundle 형식과 최대 항목 수를 검증한다", () => {
  assert.throws(() => parseEmrFhirBundle({ resourceType: "Patient" }), /FHIR Bundle/);
  assert.throws(() => parseEmrFhirBundle({ resourceType: "Bundle", entry: Array.from({ length: 1001 }, () => ({})) }), /1,000개/);
  assert.throws(() => parseEmrFhirBundle({ resourceType: "Bundle", entry: [] }), /정확히 한 명/);
  assert.throws(() => parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [{ resource: { resourceType: "Patient", name: [{ text: "식별자 없음" }] } }],
  }), /id 또는 fullUrl/);
});

test("resource.id 없는 URN Patient도 반복 가져오기에서 같은 환자로 식별한다", () => {
  const bundle = {
    resourceType: "Bundle",
    entry: [
      { fullUrl: "urn:uuid:8f4a1a2a-1111-4444-8888-123456789abc", resource: { resourceType: "Patient", name: [{ text: "URN 환자" }] } },
      { resource: { resourceType: "Observation", id: "o1", subject: { reference: "urn:uuid:8f4a1a2a-1111-4444-8888-123456789abc" }, status: "final", code: coding("A", "기록"), effectiveDateTime: "2026-07-01" } },
    ],
  };
  const first = parseEmrFhirBundle(bundle).patient;
  const second = parseEmrFhirBundle(bundle).patient;
  const state = addPatient(createEmptyEmrState(), first);

  assert.equal(first.id, second.id);
  assert.equal(first.fhirIdentity, bundle.entry[0].fullUrl);
  assert.throws(() => addPatient(state, second), /이미|같은 FHIR 환자/);
});

test("여러 환자 Bundle은 임의 환자 선택 없이 거부한다", () => {
  assert.throws(() => parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { fullUrl: "Patient/p1", resource: { resourceType: "Patient", id: "p1", name: [{ text: "첫 환자" }] } },
      { fullUrl: "Patient/p2", resource: { resourceType: "Patient", id: "p2", name: [{ text: "둘째 환자" }] } },
      { resource: { resourceType: "Observation", id: "own", subject: { reference: "Patient/p1" }, status: "final", code: coding("A", "첫 기록"), effectiveDateTime: "2026-07-01" } },
    ],
  }), /정확히 한 명/);
});

test("확정되지 않았거나 반박된 FHIR 상태를 차트 사실로 가져오지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { resource: { resourceType: "Patient", id: "p1", name: [{ text: "테스트" }] } },
      { resource: { resourceType: "Condition", id: "refuted", subject: { reference: "Patient/p1" }, clinicalStatus: coding("active", "Active"), verificationStatus: coding("refuted", "Refuted"), code: coding("I10", "반박된 진단"), recordedDate: "2026-01-01" } },
      { resource: { resourceType: "MedicationRequest", id: "draft", subject: { reference: "Patient/p1" }, status: "draft", intent: "proposal", medicationCodeableConcept: coding("M", "초안 약물"), authoredOn: "2026-01-02" } },
      { resource: { resourceType: "Procedure", id: "planned", subject: { reference: "Patient/p1" }, status: "preparation", code: coding("P", "예정 처치"), performedDateTime: "2026-01-03" } },
      { resource: { resourceType: "Observation", id: "preliminary", subject: { reference: "Patient/p1" }, status: "preliminary", code: coding("O", "예비 검사"), effectiveDateTime: "2026-01-04" } },
    ],
  });

  assert.equal(result.patient.events.length, 0);
  assert.equal(result.provenance.unsupported, 4);
  assert.equal(result.provenance.unsupportedItems.length, 4);
});

test("잠정 진단·미확인 알레르기·제안 약물은 현재 차트 사실로 가져오지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { resource: { resourceType: "Patient", id: "p1", name: [{ text: "테스트" }] } },
      { resource: { resourceType: "Condition", id: "provisional", subject: { reference: "Patient/p1" }, clinicalStatus: coding("active", "Active"), verificationStatus: coding("provisional", "Provisional"), code: coding("I10", "잠정 고혈압"), recordedDate: "2026-01-01" } },
      { resource: { resourceType: "AllergyIntolerance", id: "unconfirmed", patient: { reference: "Patient/p1" }, clinicalStatus: coding("active", "Active"), verificationStatus: coding("unconfirmed", "Unconfirmed"), code: coding("ALG", "미확인 알레르기"), recordedDate: "2026-01-02" } },
      { resource: { resourceType: "MedicationRequest", id: "proposal", subject: { reference: "Patient/p1" }, status: "active", intent: "proposal", medicationCodeableConcept: coding("MED", "제안 약물"), authoredOn: "2026-01-03" } },
    ],
  });

  assert.equal(result.patient.events.length, 0);
  assert.equal(result.provenance.supported, 1);
  assert.equal(result.provenance.unsupported, 3);
});

test("확정 상태와 주문 의도가 명시된 진단·알레르기·약물만 보존한다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { resource: { resourceType: "Patient", id: "p1", name: [{ text: "테스트" }] } },
      { resource: { resourceType: "Condition", id: "confirmed", subject: { reference: "Patient/p1" }, clinicalStatus: coding("active", "Active"), verificationStatus: coding("confirmed", "Confirmed"), code: coding("I10", "확정 고혈압"), recordedDate: "2026-01-01" } },
      { resource: { resourceType: "AllergyIntolerance", id: "confirmed", patient: { reference: "Patient/p1" }, clinicalStatus: coding("active", "Active"), verificationStatus: coding("confirmed", "Confirmed"), code: coding("ALG", "확정 알레르기"), recordedDate: "2026-01-02" } },
      { resource: { resourceType: "MedicationRequest", id: "order", subject: { reference: "Patient/p1" }, status: "active", intent: "order", medicationCodeableConcept: coding("MED", "주문 약물"), authoredOn: "2026-01-03" } },
    ],
  });

  assert.deepEqual(result.patient.events.map(({ type }) => type).sort(), ["allergy", "condition", "medication"]);
  assert.ok(result.patient.events.every((event) => event.type === "medication" || event.verificationStatus === "confirmed"));
});

test("doNotPerform 약물 요청은 활성 처방 사실로 가져오지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { resource: { resourceType: "Patient", id: "p1", name: [{ text: "테스트" }] } },
      { resource: { resourceType: "MedicationRequest", id: "negated", subject: { reference: "Patient/p1" }, status: "active", intent: "order", doNotPerform: true, medicationCodeableConcept: coding("MED", "투여하지 않을 약물"), authoredOn: "2026-01-03" } },
      { resource: { resourceType: "MedicationRequest", id: "malformed-negation", subject: { reference: "Patient/p1" }, status: "active", intent: "order", doNotPerform: "true", medicationCodeableConcept: coding("MED", "형식 오류 약물"), authoredOn: "2026-01-04" } },
    ],
  });

  assert.equal(result.patient.events.length, 0);
  assert.equal(result.provenance.unsupported, 2);
});

test("미지원 modifierExtension과 환자 상태 modifier는 fail-closed 처리한다", () => {
  const clinicalModifier = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { resource: { resourceType: "Patient", id: "p1", name: [{ text: "테스트" }] } },
      {
        resource: {
          resourceType: "Observation",
          id: "modified",
          subject: { reference: "Patient/p1" },
          status: "final",
          code: coding("85354-9", "혈압"),
          effectiveDateTime: "2026-07-10",
          component: [{ modifierExtension: [{ url: "https://example.test/negates", valueBoolean: true }], valueString: "무효" }],
        },
      },
      { resource: { resourceType: "MedicationRequest", id: "implicit", implicitRules: "https://example.test/rules", subject: { reference: "Patient/p1" }, status: "active", intent: "order", medicationCodeableConcept: coding("MED", "규칙 미해석 약물"), authoredOn: "2026-01-03" } },
    ],
  });
  assert.equal(clinicalModifier.patient.events.length, 0);
  assert.equal(clinicalModifier.provenance.unsupported, 2);
  assert.ok(clinicalModifier.provenance.unsupportedItems.every(({ reason }) => /modifierExtension|implicitRules/.test(reason)));

  assert.throws(() => parseEmrFhirBundle({
    resourceType: "Bundle",
    implicitRules: "https://example.test/bundle-rules",
    entry: [{ resource: { resourceType: "Patient", id: "p1" } }],
  }), /implicitRules/);

  for (const patientPatch of [
    { active: false },
    { active: "false" },
    { deceasedBoolean: true },
    { deceasedBoolean: "true" },
    { deceasedDateTime: "2026-01-01" },
    { link: [{ other: { reference: "Patient/p2" }, type: "replaced-by" }] },
    { link: { other: { reference: "Patient/p2" }, type: "replaced-by" } },
    { modifierExtension: [{ url: "https://example.test/identity-modifier", valueBoolean: true }] },
    { implicitRules: "https://example.test/patient-rules" },
  ]) {
    assert.throws(() => parseEmrFhirBundle({
      resourceType: "Bundle",
      entry: [{ resource: { resourceType: "Patient", id: "p1", name: [{ text: "테스트" }], ...patientPatch } }],
    }), /Patient|환자|modifierExtension|implicitRules|비활성|사망|대체/);
  }
});

test("환자 참조가 없거나 다른 임상 리소스는 가져오지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { fullUrl: "Patient/p1", resource: { resourceType: "Patient", id: "p1", name: [{ text: "첫 환자" }] } },
      { resource: { resourceType: "Observation", id: "missing", status: "final", code: coding("A", "무참조"), effectiveDateTime: "2026-07-01" } },
      { resource: { resourceType: "Observation", id: "other", subject: { reference: "Patient/p2" }, status: "final", code: coding("B", "타인"), effectiveDateTime: "2026-07-02" } },
    ],
  });

  assert.equal(result.patient.events.length, 0);
  assert.equal(result.provenance.unsupported, 2);
  assert.ok(result.provenance.unsupportedItems.some(({ reason }) => /subject/.test(reason)));
  assert.ok(result.provenance.unsupportedItems.some(({ reason }) => /다른 환자/.test(reason)));
});

test("다른 FHIR 서버의 같은 Patient ID를 절대 참조로 섞지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { fullUrl: "https://hospital-a.example/fhir/Patient/123", resource: { resourceType: "Patient", id: "123", name: [{ text: "첫 환자" }] } },
      { resource: { resourceType: "Observation", id: "own", subject: { reference: "https://hospital-a.example/fhir/Patient/123" }, status: "final", code: coding("A", "본인 기록"), valueString: "정상", effectiveDateTime: "2026-07-01" } },
      { resource: { resourceType: "Observation", id: "other-host", subject: { reference: "https://hospital-b.example/fhir/Patient/123" }, status: "final", code: coding("B", "다른 서버 기록"), valueString: "타인", effectiveDateTime: "2026-07-02" } },
      { fullUrl: "https://hospital-a.example/fhir/Observation/relative", resource: { resourceType: "Observation", id: "relative", subject: { reference: "Patient/123" }, status: "final", code: coding("C", "상대 참조 기록"), valueString: "정상", effectiveDateTime: "2026-07-03" } },
      { fullUrl: "https://hospital-b.example/fhir/Observation/foreign-relative", resource: { resourceType: "Observation", id: "foreign-relative", subject: { reference: "Patient/123" }, status: "final", code: coding("D", "다른 서버 상대 참조"), valueString: "타인", effectiveDateTime: "2026-07-04" } },
    ],
  });

  assert.deepEqual(result.patient.events.map(({ code }) => code).sort(), ["A", "C"]);
  assert.equal(result.provenance.unsupported, 2);
  assert.ok(result.provenance.unsupportedItems.every(({ reason }) => /다른 환자/.test(reason)));
});

test("상대 Patient 참조는 참조 리소스 fullUrl의 FHIR 서버 기준으로만 해석한다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { resource: { resourceType: "Patient", id: "123", name: [{ text: "기준 없는 환자" }] } },
      { fullUrl: "https://hospital-b.example/fhir/Observation/foreign", resource: { resourceType: "Observation", id: "foreign", subject: { reference: "Patient/123" }, status: "final", code: coding("A", "귀속 불명"), valueString: "값", effectiveDateTime: "2026-07-01" } },
    ],
  });

  assert.equal(result.patient.events.length, 0);
  assert.equal(result.provenance.unsupported, 1);
  assert.match(result.provenance.unsupportedItems[0].reason, /다른 환자/);
});

test("중복 FHIR 리소스 ID는 근거 개수와 다르게 조용히 유실되지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { fullUrl: "Patient/p1", resource: { resourceType: "Patient", id: "p1", name: [{ text: "첫 환자" }] } },
      { resource: { resourceType: "Observation", id: "same", subject: { reference: "Patient/p1" }, status: "final", code: coding("A", "첫 기록"), valueString: "첫 값", effectiveDateTime: "2026-07-01" } },
      { resource: { resourceType: "Observation", id: "same", subject: { reference: "Patient/p1" }, status: "final", code: coding("B", "중복 기록"), valueString: "둘째 값", effectiveDateTime: "2026-07-02" } },
    ],
  });

  assert.equal(result.patient.events.length, 1);
  assert.equal(result.provenance.supported, 2);
  assert.equal(result.provenance.unsupported, 1);
});

test("resource.id 없는 동일 fullUrl 임상 리소스는 한 번만 가져온다", () => {
  const patientFullUrl = "urn:uuid:patient-1111-4444-8888-123456789abc";
  const repeatedProcedure = {
    fullUrl: "urn:uuid:procedure-1111-4444-8888-123456789abc",
    resource: {
      resourceType: "Procedure",
      subject: { reference: patientFullUrl },
      status: "completed",
      code: coding("SERVICE", "완료 서비스"),
      performedDateTime: "2026-07-01",
    },
  };
  const result = parseEmrFhirBundle({
    resourceType: "Bundle",
    entry: [
      { fullUrl: patientFullUrl, resource: { resourceType: "Patient", id: "p1", name: [{ text: "첫 환자" }] } },
      repeatedProcedure,
      structuredClone(repeatedProcedure),
    ],
  });

  assert.equal(result.patient.events.length, 1);
  assert.equal(result.provenance.supported, 2);
  assert.equal(result.provenance.unsupported, 1);
  assert.match(result.provenance.unsupportedItems[0].reason, /중복/);
});

test("Patient보다 앞선 임상 entry가 Patient fullUrl을 선점하지 못한다", () => {
  const patientFullUrl = "urn:uuid:shared-1111-4444-8888-123456789abc";
  const bundle = {
    resourceType: "Bundle",
    entry: [
      {
        fullUrl: patientFullUrl,
        resource: {
          resourceType: "Observation",
          subject: { reference: patientFullUrl },
          status: "final",
          code: coding("A", "충돌 기록"),
          effectiveDateTime: "2026-07-01",
        },
      },
      { fullUrl: patientFullUrl, resource: { resourceType: "Patient", name: [{ text: "순서 독립 환자" }] } },
    ],
  };
  const first = parseEmrFhirBundle(bundle);
  const second = parseEmrFhirBundle(bundle);
  const state = addPatient(createEmptyEmrState(), first.patient);

  assert.equal(first.patient.name, "순서 독립 환자");
  assert.equal(first.patient.id, second.patient.id);
  assert.equal(first.patient.events.length, 0);
  assert.equal(first.provenance.supported, 1);
  assert.equal(first.provenance.unsupported, 1);
  assert.throws(() => addPatient(state, second.patient), /이미|같은 FHIR 환자/);
});
