import assert from "node:assert/strict";
import test from "node:test";

import { parseEmrFhirBundle } from "../src/emr-fhir.js";
import { exportPatientFhirBundle } from "../src/emr-fhir-export.js";
import { addPatient, createEmptyEmrState, selectFinalPatientEvents } from "../src/emr-model.js";
import { evaluateClaimRule } from "../src/claim-rules.js";

const coding = (code, display) => ({ coding: [{ system: "http://example.test", code, display }], text: display });

function roundTripPatient() {
  return {
    id: "round-trip-patient",
    mrn: "VG-ROUND-1",
    name: "왕복 환자",
    ageYears: 52,
    sex: "female",
    phone: "010-1234-5678",
    address: "서울특별시 중구",
    bloodType: "A+",
    insuranceType: "national-health",
    emergencyContact: { name: "보호자", relation: "배우자", phone: "010-0000-0000" },
    events: [
      {
        id: "encounter-round-trip",
        type: "encounter",
        recordStatus: "final",
        status: "finished",
        label: "정기 외래",
        date: "2026-07-19",
        arrivedAt: "2026-07-19T09:00:00Z",
        startedAt: "2026-07-19T09:05:00Z",
        finishedAt: "2026-07-19T09:25:00Z",
        department: "가정의학과",
        clinician: "홍길동 의사",
        room: "3진료실",
        chiefComplaint: "혈압 추적",
        soap: {
          subjective: "두통 없음 <script>alert('x')</script>",
          objective: "혈압 128/78 mmHg",
          assessment: "혈압 안정",
          plan: "현 처방 유지 & 4주 뒤 재진",
        },
        signature: { status: "signed", signer: "홍길동 의사", signedAt: "2026-07-19T09:26:00Z" },
      },
      {
        id: "diagnosis-round-trip",
        type: "condition",
        encounterId: "encounter-round-trip",
        recordStatus: "final",
        status: "active",
        verificationStatus: "confirmed",
        certainty: "confirmed",
        diagnosisRole: "primary",
        system: "http://hl7.org/fhir/sid/icd-10",
        code: "I10",
        label: "본태성 고혈압",
        date: "2026-07-19",
        onsetDate: "2024-01-02",
      },
      {
        id: "medication-round-trip",
        type: "medication",
        encounterId: "encounter-round-trip",
        recordStatus: "final",
        status: "active",
        intent: "original-order",
        system: "https://example.test/medication",
        code: "MED-001",
        label: "예시 혈압약",
        date: "2026-07-19",
        prescription: {
          dose: 1,
          doseUnit: "정",
          route: "경구",
          frequency: "하루 1회",
          durationDays: 28,
          quantity: 28,
          instructions: "아침 식후 복용",
        },
      },
      {
        id: "order-round-trip",
        type: "service-request",
        encounterId: "encounter-round-trip",
        recordStatus: "final",
        status: "active",
        intent: "reflex-order",
        system: "http://loinc.org",
        code: "4548-4",
        label: "당화혈색소",
        date: "2026-07-19",
        order: { kind: "laboratory", priority: "urgent", instructions: "공복 불필요" },
      },
      {
        id: "observation-round-trip",
        type: "observation",
        encounterId: "encounter-round-trip",
        recordStatus: "final",
        status: "final",
        system: "http://loinc.org",
        code: "8480-6",
        label: "수축기 혈압",
        date: "2026-07-19",
        value: 128,
        unit: "mmHg",
      },
      {
        id: "procedure-round-trip",
        type: "procedure",
        encounterId: "encounter-round-trip",
        recordStatus: "final",
        status: "completed",
        code: "EDU-1",
        label: "복약 교육",
        date: "2026-07-19",
      },
    ],
  };
}

test("자체 FHIR 내보내기 결과를 진료·SOAP·처방·오더 연결까지 다시 가져온다", () => {
  const bundle = exportPatientFhirBundle(roundTripPatient(), "2026-07-19T10:00:00Z");
  const result = parseEmrFhirBundle(bundle);
  const encounter = result.patient.events.find(({ type }) => type === "encounter");
  const condition = result.patient.events.find(({ type }) => type === "condition");
  const medication = result.patient.events.find(({ type }) => type === "medication");
  const service = result.patient.events.find(({ type }) => type === "service-request");

  assert.equal(result.provenance.supported, bundle.entry.length);
  assert.equal(result.provenance.unsupported, 0);
  assert.equal(result.patient.ageYears, 52);
  assert.equal(result.patient.address, "서울특별시 중구");
  assert.equal(result.patient.bloodType, "A+");
  assert.equal(result.patient.insuranceType, "national-health");
  assert.deepEqual(result.patient.emergencyContact, { name: "보호자", relation: "배우자", phone: "010-0000-0000" });
  assert.deepEqual(encounter.soap, {
    subjective: "두통 없음 <script>alert('x')</script>",
    objective: "혈압 128/78 mmHg",
    assessment: "혈압 안정",
    plan: "현 처방 유지 & 4주 뒤 재진",
  });
  assert.equal(encounter.recordStatus, "final");
  assert.equal(encounter.signature.status, "external");
  assert.equal(encounter.signature.signer, "");
  assert.equal(encounter.department, "가정의학과");
  assert.equal(encounter.room, "3진료실");
  assert.equal(encounter.chiefComplaint, "혈압 추적");
  assert.equal(condition.encounterId, encounter.id);
  assert.equal(condition.diagnosisRole, "primary");
  assert.equal(condition.onsetDate, "2024-01-02");
  assert.equal(medication.encounterId, encounter.id);
  assert.deepEqual(medication.prescription, {
    dose: 1,
    doseUnit: "정",
    route: "경구",
    frequency: "하루 1회",
    durationDays: 28,
    quantity: 28,
    instructions: "아침 식후 복용",
  });
  assert.equal(service.encounterId, encounter.id);
  assert.deepEqual(service.order, { kind: "laboratory", priority: "urgent", instructions: "공복 불필요" });
  assert.ok(result.patient.events.filter(({ type }) => ["observation", "procedure"].includes(type)).every(({ encounterId }) => encounterId === encounter.id));
});

test("한국 자정 직후 진료일은 FHIR UTC 직렬화 뒤에도 하루 전으로 바뀌지 않는다", () => {
  const patient = roundTripPatient();
  const encounter = patient.events.find(({ type }) => type === "encounter");
  encounter.date = "2026-07-19";
  encounter.arrivedAt = "2026-07-19T00:05:00+09:00";
  encounter.startedAt = "2026-07-19T00:10:00+09:00";
  encounter.finishedAt = "2026-07-19T00:25:00+09:00";
  encounter.signature.signedAt = "2026-07-19T00:26:00+09:00";

  const result = parseEmrFhirBundle(exportPatientFhirBundle(patient, "2026-07-19T10:00:00Z"));
  assert.equal(result.patient.events.find(({ type }) => type === "encounter").date, "2026-07-19");
});

test("의증 진단은 완료 Encounter와 함께 왕복 보존하되 확정 사실 투영에서는 제외한다", () => {
  const patient = roundTripPatient();
  const condition = patient.events.find(({ type }) => type === "condition");
  condition.verificationStatus = "provisional";
  condition.certainty = "provisional";
  const result = parseEmrFhirBundle(exportPatientFhirBundle(patient, "2026-07-19T10:00:00Z"));
  const restored = result.patient.events.find(({ type }) => type === "condition");

  assert.equal(restored.verificationStatus, "provisional");
  assert.equal(restored.certainty, "provisional");
  assert.equal(restored.encounterId, result.patient.events.find(({ type }) => type === "encounter").id);
  assert.equal(selectFinalPatientEvents(result.patient).some(({ id }) => id === restored.id), false);
  assert.equal(result.provenance.unsupported, 0);
  assert.doesNotThrow(() => addPatient(createEmptyEmrState(), result.patient));
});

test("FHIR 환자 인적사항은 MR 식별자와 구조화 이름·주소를 정확히 읽는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    entry: [{
      fullUrl: "Patient/structured",
      resource: {
        resourceType: "Patient",
        id: "structured",
        identifier: [
          { system: "urn:insurance", value: "INS-123" },
          { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, system: "urn:hospital:mrn", value: "MRN-456" },
        ],
        name: [{ use: "official", family: "김", given: ["비타"] }],
        address: [{ line: ["세종대로 1"], city: "서울특별시", district: "중구", postalCode: "04524" }],
        contact: [{ name: { family: "김", given: ["보호"] }, relationship: [{ text: "배우자" }], telecom: [{ system: "phone", value: "010-0000-0000" }] }],
      },
    }],
  });

  assert.equal(result.patient.mrn, "MRN-456");
  assert.equal(result.patient.name, "김 비타");
  assert.equal(result.patient.address, "세종대로 1 서울특별시 중구 04524");
  assert.deepEqual(result.patient.emergencyContact, { name: "김 보호", relation: "배우자", phone: "010-0000-0000" });
});

test("FHIR 핵심 인적사항은 잘못된 날짜·성별·충돌 MR 식별자를 조용히 바꾸지 않는다", () => {
  const patient = { resourceType: "Patient", id: "demographics", name: [{ text: "검증 환자" }] };
  const bundle = (patch) => ({
    resourceType: "Bundle", type: "collection",
    entry: [{ fullUrl: "Patient/demographics", resource: { ...patient, ...patch } }],
  });

  assert.throws(() => parseEmrFhirBundle(bundle({ birthDate: "2026-02-31" })), /birthDate.*유효/);
  assert.throws(() => parseEmrFhirBundle(bundle({ birthDate: "1974-04" })), /완전한 YYYY-MM-DD/);
  assert.throws(() => parseEmrFhirBundle(bundle({ birthDate: "9999-01-01" })), /미래/);
  assert.throws(() => parseEmrFhirBundle(bundle({ gender: "INVALID" })), /gender.*유효/);
  assert.throws(() => parseEmrFhirBundle(bundle({
    identifier: [
      { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, value: "MR-A" },
      { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, value: "MR-B" },
    ],
  })), /서로 다른 MR/);
});

test("진행 중 외부 Encounter와 그 연결 기록은 확정 차트에서 함께 제외한다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    entry: [
      { fullUrl: "Patient/p1", resource: { resourceType: "Patient", id: "p1", name: [{ text: "진행 중 환자" }] } },
      {
        fullUrl: "Encounter/e1",
        resource: {
          resourceType: "Encounter",
          id: "e1",
          subject: { reference: "Patient/p1" },
          status: "in-progress",
          period: { start: "2026-07-19T09:00:00Z" },
        },
      },
      {
        fullUrl: "Condition/c1",
        resource: {
          resourceType: "Condition",
          id: "c1",
          subject: { reference: "Patient/p1" },
          encounter: { reference: "Encounter/e1" },
          clinicalStatus: coding("active", "Active"),
          verificationStatus: coding("confirmed", "Confirmed"),
          code: coding("I10", "고혈압"),
          recordedDate: "2026-07-19",
        },
      },
      {
        fullUrl: "Composition/doc1",
        resource: {
          resourceType: "Composition",
          id: "doc1",
          status: "final",
          subject: { reference: "Patient/p1" },
          encounter: { reference: "Encounter/e1" },
          section: [{ code: coding("61150-9", "Subjective"), text: { status: "generated", div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>증상</p></div>' } }],
        },
      },
    ],
  });

  assert.equal(result.patient.events.length, 0);
  assert.equal(result.provenance.supported, 1);
  assert.equal(result.provenance.unsupported, 3);
  assert.ok(result.provenance.unsupportedItems.some(({ reason }) => /완료되지 않은 Encounter/.test(reason)));
  assert.doesNotThrow(() => addPatient(createEmptyEmrState(), result.patient));
});

test("Encounter 상대 참조는 참조 리소스의 서버 기준으로 해석하고 다른 서버 진료와 섞지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    entry: [
      { fullUrl: "https://hospital-a.example/fhir/Patient/p1", resource: { resourceType: "Patient", id: "p1", name: [{ text: "참조 환자" }] } },
      {
        fullUrl: "https://hospital-a.example/fhir/Encounter/e1",
        resource: {
          resourceType: "Encounter",
          id: "e1",
          subject: { reference: "https://hospital-a.example/fhir/Patient/p1" },
          status: "finished",
          period: { start: "2026-07-19T09:00:00Z", end: "2026-07-19T09:20:00Z" },
        },
      },
      {
        fullUrl: "https://hospital-b.example/fhir/ServiceRequest/s1",
        resource: {
          resourceType: "ServiceRequest",
          id: "s1",
          subject: { reference: "https://hospital-a.example/fhir/Patient/p1" },
          encounter: { reference: "Encounter/e1" },
          status: "active",
          intent: "order",
          category: [{ coding: [{ system: "https://policycompass.local/fhir/CodeSystem/order-kind", code: "laboratory", display: "Laboratory" }] }],
          priority: "routine",
          code: coding("4548-4", "당화혈색소"),
          authoredOn: "2026-07-19",
        },
      },
    ],
  });

  assert.deepEqual(result.patient.events.map(({ type }) => type), ["encounter"]);
  assert.equal(result.provenance.unsupported, 1);
  assert.match(result.provenance.unsupportedItems[0].reason, /Encounter 참조/);
});

test("실행 가능한 XHTML SOAP는 임의 복구하지 않는다", () => {
  const bundle = exportPatientFhirBundle(roundTripPatient(), "2026-07-19T10:00:00Z");
  const composition = bundle.entry.find(({ resource }) => resource.resourceType === "Composition").resource;
  composition.section[0].text.div = '<div xmlns="http://www.w3.org/1999/xhtml"><p><script>alert(1)</script></p></div>';
  const result = parseEmrFhirBundle(bundle);
  const encounter = result.patient.events.find(({ type }) => type === "encounter");

  assert.deepEqual(encounter.soap, { subjective: "", objective: "", assessment: "", plan: "" });
  assert.equal(result.provenance.unsupported, 1);
  assert.match(result.provenance.unsupportedItems[0].reason, /SOAP/);
});

test("나이 전용 Patient 확장은 엄격한 단위·범위와 단일 출처만 허용한다", () => {
  const extension = { url: "https://policycompass.local/fhir/StructureDefinition/age-at-export", valueAge: { value: 52, unit: "year", system: "http://unitsofmeasure.org", code: "a" } };
  const base = { resourceType: "Bundle", type: "collection", entry: [{ resource: { resourceType: "Patient", id: "p1", extension: [extension] } }] };

  assert.equal(parseEmrFhirBundle(base).patient.ageYears, 52);
  assert.throws(() => parseEmrFhirBundle({
    ...base,
    entry: [{ resource: { ...base.entry[0].resource, birthDate: "1974-04-12" } }],
  }), /생년월일.*나이/);
  assert.throws(() => parseEmrFhirBundle({
    ...base,
    entry: [{ resource: { ...base.entry[0].resource, extension: [extension, structuredClone(extension)] } }],
  }), /확장이 중복/);
  assert.throws(() => parseEmrFhirBundle({
    ...base,
    entry: [{ resource: { ...base.entry[0].resource, extension: [{ ...extension, valueAge: { ...extension.valueAge, value: 131 } }] } }],
  }), /나이 확장 값/);
});

test("FHIR Bundle을 환자와 임상 이벤트로 변환하고 출처를 보존한다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    timestamp: "2026-07-19T09:00:00Z",
    entry: [
      { fullUrl: "Patient/p1", resource: { resourceType: "Patient", id: "p1", identifier: [{ type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR", display: "Medical record number" }] }, value: "VG-1001" }], name: [{ text: "김비타" }], birthDate: "1974-04-12", gender: "female" } },
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
  assert.deepEqual(selectFinalPatientEvents(result.patient), []);
});

test("용법 없는 외부 MedicationRequest는 손실 없이 재내보내고 미해결 참조 약물은 거부한다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    type: "collection",
    entry: [
      { fullUrl: "Patient/p1", resource: { resourceType: "Patient", id: "p1", name: [{ text: "외부 환자" }] } },
      { fullUrl: "Encounter/e1", resource: { resourceType: "Encounter", id: "e1", subject: { reference: "Patient/p1" }, status: "finished", class: { code: "AMB" }, period: { start: "2026-07-19T09:00:00Z", end: "2026-07-19T09:10:00Z" } } },
      { fullUrl: "MedicationRequest/m1", resource: { resourceType: "MedicationRequest", id: "m1", subject: { reference: "Patient/p1" }, encounter: { reference: "Encounter/e1" }, status: "active", intent: "order", medicationCodeableConcept: coding("MED-1", "외부 처방약"), authoredOn: "2026-07-19" } },
      { fullUrl: "MedicationRequest/m2", resource: { resourceType: "MedicationRequest", id: "m2", subject: { reference: "Patient/p1" }, encounter: { reference: "Encounter/e1" }, status: "active", intent: "order", medicationReference: { reference: "Medication/med-2" }, authoredOn: "2026-07-19" } },
    ],
  });

  assert.equal(result.patient.events.filter(({ type }) => type === "medication").length, 1);
  assert.equal(result.provenance.unsupported, 1);
  const bundle = exportPatientFhirBundle(result.patient, "2026-07-19T10:00:00Z");
  const medications = bundle.entry.filter(({ resource }) => resource.resourceType === "MedicationRequest");
  assert.equal(medications.length, 1);
  assert.equal(medications[0].resource.dosageInstruction, undefined);
  assert.equal(medications[0].resource.dispenseRequest, undefined);
});

test("취소·오류·비활성 리소스는 확정 이벤트로 만들지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
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
    resourceType: "Bundle", type: "collection",
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

test("단일값·비UCUM 혈압은 환자 전체를 중단하지 않고 미지원 리소스로 격리한다", () => {
  const loinc = (code, display) => ({ coding: [{ system: "http://loinc.org", code, display }], text: display });
  const result = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    entry: [
      { fullUrl: "Patient/p1", resource: { resourceType: "Patient", id: "p1", name: [{ text: "혈압 검사 환자" }] } },
      {
        fullUrl: "Observation/scalar-bp",
        resource: {
          resourceType: "Observation",
          id: "scalar-bp",
          subject: { reference: "Patient/p1" },
          status: "final",
          code: loinc("85354-9", "혈압 패널"),
          valueQuantity: { value: 120, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
          effectiveDateTime: "2026-07-10T09:00:00+09:00",
        },
      },
      {
        fullUrl: "Observation/non-ucum-bp",
        resource: {
          resourceType: "Observation",
          id: "non-ucum-bp",
          subject: { reference: "Patient/p1" },
          status: "final",
          code: loinc("85354-9", "혈압 패널"),
          component: [
            { code: loinc("8480-6", "수축기"), valueQuantity: { value: 128, unit: "mmHg", system: "https://example.test/unit", code: "mmHg" } },
            { code: loinc("8462-4", "이완기"), valueQuantity: { value: 78, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" } },
          ],
          effectiveDateTime: "2026-07-10T09:01:00+09:00",
        },
      },
      {
        fullUrl: "Observation/temperature",
        resource: {
          resourceType: "Observation",
          id: "temperature",
          subject: { reference: "Patient/p1" },
          status: "final",
          code: loinc("8310-5", "체온"),
          valueQuantity: { value: 36.7, unit: "Cel", system: "http://unitsofmeasure.org", code: "Cel" },
          effectiveDateTime: "2026-07-10T09:02:00+09:00",
        },
      },
    ],
  });

  assert.deepEqual(result.patient.events.map(({ code }) => code), ["8310-5"]);
  assert.equal(result.provenance.supported, 2);
  assert.equal(result.provenance.unsupported, 2);
  assert.deepEqual(result.provenance.unsupportedItems.map(({ id }) => id), ["scalar-bp", "non-ucum-bp"]);
});

test("FHIR Bundle 형식과 최대 항목 수를 검증한다", () => {
  assert.throws(() => parseEmrFhirBundle({ resourceType: "Patient" }), /FHIR Bundle/);
  assert.throws(() => parseEmrFhirBundle({ resourceType: "Bundle", entry: [] }), /collection 또는 document/);
  assert.throws(() => parseEmrFhirBundle({ resourceType: "Bundle", type: "transaction", entry: [] }), /collection 또는 document/);
  assert.throws(() => parseEmrFhirBundle({ resourceType: "Bundle", type: "collection", timestamp: "invalid", entry: [] }), /timestamp.*유효/);
  assert.throws(() => parseEmrFhirBundle({ resourceType: "Bundle", type: "collection", entry: Array.from({ length: 1001 }, () => ({})) }), /1,000개/);
  assert.throws(() => parseEmrFhirBundle({ resourceType: "Bundle", type: "collection", entry: [] }), /정확히 한 명/);
  assert.throws(() => parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    entry: [{ resource: { resourceType: "Patient", name: [{ text: "식별자 없음" }] } }],
  }), /id 또는 fullUrl/);
});

test("resource.id 없는 URN Patient도 반복 가져오기에서 같은 환자로 식별한다", () => {
  const bundle = {
    resourceType: "Bundle", type: "collection",
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

test("외부 FHIR 환자는 PolicyCompass 왕복 뒤에도 원본 식별자를 보존해 중복 등록을 막는다", () => {
  const external = {
    resourceType: "Bundle", type: "collection",
    entry: [{
      fullUrl: "https://ehr.example/fhir/Patient/identity-1",
      resource: { resourceType: "Patient", id: "identity-1", name: [{ text: "식별 환자" }] },
    }],
  };
  const first = parseEmrFhirBundle(external).patient;
  const second = parseEmrFhirBundle(exportPatientFhirBundle(first, "2026-07-19T10:00:00Z")).patient;

  assert.equal(second.fhirIdentity, first.fhirIdentity);
  const state = addPatient(createEmptyEmrState(), first);
  assert.throws(() => addPatient(state, second), /이미 존재|같은 FHIR 환자/);
});

test("여러 환자 Bundle은 임의 환자 선택 없이 거부한다", () => {
  assert.throws(() => parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    entry: [
      { fullUrl: "Patient/p1", resource: { resourceType: "Patient", id: "p1", name: [{ text: "첫 환자" }] } },
      { fullUrl: "Patient/p2", resource: { resourceType: "Patient", id: "p2", name: [{ text: "둘째 환자" }] } },
      { resource: { resourceType: "Observation", id: "own", subject: { reference: "Patient/p1" }, status: "final", code: coding("A", "첫 기록"), effectiveDateTime: "2026-07-01" } },
    ],
  }), /정확히 한 명/);
});

test("확정되지 않았거나 반박된 FHIR 상태를 차트 사실로 가져오지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
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
    resourceType: "Bundle", type: "collection",
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
    resourceType: "Bundle", type: "collection",
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
    resourceType: "Bundle", type: "collection",
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
    resourceType: "Bundle", type: "collection",
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
    resourceType: "Bundle", type: "collection",
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
      resourceType: "Bundle", type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "p1", name: [{ text: "테스트" }], ...patientPatch } }],
    }), /Patient|환자|modifierExtension|implicitRules|비활성|사망|대체/);
  }
});

test("과도하게 깊은 FHIR JSON은 재귀 스택을 소진하지 않고 제한 오류로 거부한다", () => {
  let nested = { valueString: "끝" };
  for (let depth = 0; depth < 200; depth += 1) nested = { nested };
  assert.throws(() => parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    entry: [{ resource: { resourceType: "Patient", id: "p1", name: [{ text: "테스트" }], extension: [nested] } }],
  }), (error) => error instanceof TypeError && !(error instanceof RangeError) && /안전|modifierExtension|implicitRules/.test(error.message));
});

test("환자 참조가 없거나 다른 임상 리소스는 가져오지 않는다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
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
    resourceType: "Bundle", type: "collection",
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
    resourceType: "Bundle", type: "collection",
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
    resourceType: "Bundle", type: "collection",
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

test("같은 FHIR 리소스의 절대 fullUrl·상대 ID 별칭은 한 번만 가져온다", () => {
  const result = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    entry: [
      {
        fullUrl: "https://hospital-a.example/fhir/Patient/p1",
        resource: { resourceType: "Patient", id: "p1", name: [{ text: "별칭 환자" }] },
      },
      {
        fullUrl: "https://hospital-a.example/fhir/Observation/same",
        resource: {
          resourceType: "Observation",
          id: "same",
          subject: { reference: "https://hospital-a.example/fhir/Patient/p1" },
          status: "final",
          code: coding("A", "첫 기록"),
          valueString: "첫 값",
          effectiveDateTime: "2026-07-01",
        },
      },
      {
        resource: {
          resourceType: "Observation",
          id: "same",
          subject: { reference: "Patient/p1" },
          status: "final",
          code: coding("B", "상대 별칭 기록"),
          valueString: "둘째 값",
          effectiveDateTime: "2026-07-02",
        },
      },
    ],
  });

  assert.equal(result.patient.events.length, 1);
  assert.equal(result.provenance.supported, 2);
  assert.equal(result.provenance.unsupported, 1);
  assert.match(result.provenance.unsupportedItems[0].reason, /별칭|중복/);
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
    resourceType: "Bundle", type: "collection",
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
    resourceType: "Bundle", type: "collection",
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

test("독립 FHIR 문제·약물·오더·알레르기·관찰·처치는 원출처와 함께 왕복한다", () => {
  const originBase = "https://origin.example/fhir";
  const initial = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    type: "collection",
    entry: [
      { fullUrl: `${originBase}/Patient/p1`, resource: { resourceType: "Patient", id: "p1", name: [{ text: "독립 기록 환자" }] } },
      { fullUrl: `${originBase}/Condition/c1`, resource: { resourceType: "Condition", id: "c1", subject: { reference: `${originBase}/Patient/p1` }, clinicalStatus: coding("active", "Active"), verificationStatus: coding("confirmed", "Confirmed"), code: coding("DX", "독립 진단"), recordedDate: "2026-07-01" } },
      { fullUrl: `${originBase}/MedicationRequest/m1`, resource: { resourceType: "MedicationRequest", id: "m1", subject: { reference: `${originBase}/Patient/p1` }, status: "active", intent: "order", medicationCodeableConcept: coding("MED", "독립 약물"), authoredOn: "2026-07-02" } },
      { fullUrl: `${originBase}/ServiceRequest/s1`, resource: { resourceType: "ServiceRequest", id: "s1", subject: { reference: `${originBase}/Patient/p1` }, status: "active", intent: "order", category: [{ coding: [{ system: "https://policycompass.local/fhir/CodeSystem/order-kind", code: "laboratory" }] }], priority: "routine", code: coding("LAB", "독립 검사"), authoredOn: "2026-07-03" } },
      { fullUrl: `${originBase}/AllergyIntolerance/a1`, resource: { resourceType: "AllergyIntolerance", id: "a1", patient: { reference: `${originBase}/Patient/p1` }, clinicalStatus: coding("active", "Active"), verificationStatus: coding("confirmed", "Confirmed"), code: coding("ALG", "독립 알레르기"), recordedDate: "2026-07-04" } },
      { fullUrl: `${originBase}/Observation/o1`, resource: { resourceType: "Observation", id: "o1", subject: { reference: `${originBase}/Patient/p1` }, status: "final", code: coding("OBS", "독립 관찰"), valueString: "정상", effectiveDateTime: "2026-07-05" } },
      { fullUrl: `${originBase}/Procedure/p1`, resource: { resourceType: "Procedure", id: "p1", subject: { reference: `${originBase}/Patient/p1` }, status: "completed", code: coding("PROC", "독립 처치"), performedDateTime: "2026-07-06" } },
    ],
  });
  const exported = exportPatientFhirBundle(initial.patient, "2026-07-19T10:00:00Z");
  const clinical = exported.entry.filter(({ resource }) => resource.resourceType !== "Patient");

  assert.deepEqual(
    clinical.map(({ resource }) => resource.resourceType).sort(),
    ["Condition", "MedicationRequest", "ServiceRequest", "AllergyIntolerance", "Observation", "Procedure"].sort(),
  );
  for (const { resource } of clinical) {
    const expected = `${originBase}/${resource.resourceType}/${({
      Condition: "c1",
      MedicationRequest: "m1",
      ServiceRequest: "s1",
      AllergyIntolerance: "a1",
      Observation: "o1",
      Procedure: "p1",
    })[resource.resourceType]}`;
    assert.equal(resource.meta.source, expected);
    assert.equal(resource.identifier.find(({ system }) => system.endsWith("/identifier/source-resource")).value, expected);
    assert.equal(resource.encounter, undefined);
  }

  const reimported = parseEmrFhirBundle(exported);
  assert.deepEqual(
    new Map(reimported.patient.events.map((event) => [event.code, event.source.resourceId])),
    new Map([
      ["DX", `${originBase}/Condition/c1`],
      ["MED", `${originBase}/MedicationRequest/m1`],
      ["LAB", `${originBase}/ServiceRequest/s1`],
      ["ALG", `${originBase}/AllergyIntolerance/a1`],
      ["OBS", `${originBase}/Observation/o1`],
      ["PROC", `${originBase}/Procedure/p1`],
    ]),
  );
});

test("FHIR meta.source와 원본 리소스 식별자가 달라도 각각 보존해 왕복한다", () => {
  const metaSource = "https://provenance.example/source/A";
  const sourceIdentity = "https://origin.example/fhir/Observation/B";
  const imported = parseEmrFhirBundle({
    resourceType: "Bundle", type: "collection",
    type: "collection",
    entry: [
      {
        fullUrl: "https://origin.example/fhir/Patient/p1",
        resource: { resourceType: "Patient", id: "p1", name: [{ text: "출처 보존 환자" }] },
      },
      {
        fullUrl: "https://exchange.example/fhir/Observation/exchanged",
        resource: {
          resourceType: "Observation",
          id: "exchanged",
          meta: { source: metaSource },
          identifier: [{
            system: "https://policycompass.local/fhir/identifier/source-resource",
            value: sourceIdentity,
          }],
          subject: { reference: "https://origin.example/fhir/Patient/p1" },
          status: "final",
          code: coding("OBS", "출처 분리 관찰"),
          valueString: "정상",
          effectiveDateTime: "2026-07-20",
        },
      },
    ],
  });
  const [event] = imported.patient.events;

  assert.equal(event.source.resourceId, sourceIdentity);
  assert.equal(event.source.metaSource, metaSource);

  const exported = exportPatientFhirBundle(imported.patient, "2026-07-20T12:00:00Z");
  const observation = exported.entry.find(({ resource }) => resource.resourceType === "Observation").resource;
  assert.equal(observation.meta.source, metaSource);
  assert.equal(
    observation.identifier.find(({ system }) => system.endsWith("/identifier/source-resource")).value,
    sourceIdentity,
  );

  const reimported = parseEmrFhirBundle(exported);
  assert.equal(reimported.patient.events[0].source.resourceId, sourceIdentity);
  assert.equal(reimported.patient.events[0].source.metaSource, metaSource);
});
