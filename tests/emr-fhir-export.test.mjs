import assert from "node:assert/strict";
import test from "node:test";

import { exportPatientFhirBundle } from "../src/emr-fhir-export.js";
import { parseEmrFhirBundle } from "../src/emr-fhir.js";

function fullPatient() {
  return {
    id: "patient-local-1",
    mrn: "VG-2026-1001",
    name: "김비타",
    birthDate: "1974-04-12",
    sex: "female",
    phone: "010-1234-5678",
    address: "서울특별시 중구",
    bloodType: "A+",
    insuranceType: "national-health",
    emergencyContact: { name: "김보호", relation: "배우자", phone: "010-0000-0000" },
    events: [
      {
        id: "encounter-1",
        type: "encounter",
        label: "정기 외래",
        date: "2026-07-19",
        status: "finished",
        recordStatus: "final",
        arrivedAt: "2026-07-19T09:00:00+09:00",
        startedAt: "2026-07-19T09:05:00+09:00",
        finishedAt: "2026-07-19T09:25:00+09:00",
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
        signature: { status: "signed", signer: "홍길동 의사", signedAt: "2026-07-19T09:26:00+09:00" },
      },
      {
        id: "diagnosis-1",
        type: "condition",
        encounterId: "encounter-1",
        recordStatus: "final",
        status: "active",
        certainty: "confirmed",
        diagnosisRole: "primary",
        system: "http://hl7.org/fhir/sid/icd-10",
        code: "I10",
        label: "본태성 고혈압",
        date: "2026-07-19",
        onsetDate: "2024-01-02",
      },
      {
        id: "medication-1",
        type: "medication",
        encounterId: "encounter-1",
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
        id: "order-1",
        type: "service-request",
        encounterId: "encounter-1",
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
        id: "observation-1",
        type: "observation",
        encounterId: "encounter-1",
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
        id: "procedure-1",
        type: "procedure",
        encounterId: "encounter-1",
        recordStatus: "final",
        status: "completed",
        system: "https://example.test/procedure",
        code: "EDU-1",
        label: "복약 교육",
        date: "2026-07-19",
        note: "복약 순응도 교육 완료",
      },
    ],
  };
}

function resources(bundle, type) {
  return bundle.entry.filter(({ resource }) => resource.resourceType === type).map(({ resource }) => resource);
}

function references(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) references(item, found);
    return found;
  }
  if (typeof value.reference === "string") found.push(value.reference);
  for (const item of Object.values(value)) references(item, found);
  return found;
}

test("확정·완료·서명된 진료를 참조가 모두 해소되는 FHIR R4 collection Bundle로 내보낸다", () => {
  const patient = fullPatient();
  const original = structuredClone(patient);
  const bundle = exportPatientFhirBundle(patient, "2026-07-19T01:00:00Z");

  assert.equal(bundle.resourceType, "Bundle");
  assert.equal(bundle.type, "collection");
  assert.equal(bundle.timestamp, "2026-07-19T01:00:00.000Z");
  assert.equal(bundle.entry.length, 8);
  assert.deepEqual(
    bundle.entry.map(({ resource }) => resource.resourceType).sort(),
    ["Patient", "Encounter", "Composition", "Condition", "MedicationRequest", "ServiceRequest", "Observation", "Procedure"].sort(),
  );
  assert.ok(bundle.entry.every((entry) => entry.fullUrl.startsWith("https://policycompass.local/fhir/")));
  assert.ok(bundle.entry.every((entry) => !Object.hasOwn(entry, "request")));

  const fullUrls = new Set(bundle.entry.map(({ fullUrl }) => fullUrl));
  assert.deepEqual([...new Set(references(bundle))].filter((reference) => !fullUrls.has(reference)), []);
  assert.deepEqual(patient, original, "내보내기는 원본 환자 데이터를 변경하지 않는다");
});

test("출처 미검증 백업 기록은 환자 식별정보 외 임상 FHIR 리소스로 재수출하지 않는다", () => {
  const patient = fullPatient();
  patient.events = patient.events.map((event) => ({
    ...event,
    source: { kind: "import", label: "백업 복원 · 출처 미검증", resourceId: "" },
    ...(event.type === "encounter" ? { signature: { status: "external", signer: "", signedAt: "" } } : {}),
  }));
  const bundle = exportPatientFhirBundle(patient, "2026-07-19T01:00:00Z");

  assert.deepEqual(bundle.entry.map(({ resource }) => resource.resourceType), ["Patient"]);
});

test("환자·Encounter·SOAP Composition과 진단 역할을 손실 없이 매핑하고 XHTML을 escape한다", () => {
  const input = fullPatient();
  input.events[0].soap.plan += " 🩺\uD800";
  const bundle = exportPatientFhirBundle(input, "2026-07-19T01:00:00Z");
  const patient = resources(bundle, "Patient")[0];
  const encounter = resources(bundle, "Encounter")[0];
  const composition = resources(bundle, "Composition")[0];
  const condition = resources(bundle, "Condition")[0];

  assert.equal(patient.identifier[0].value, "VG-2026-1001");
  assert.equal(patient.name[0].text, "김비타");
  assert.equal(patient.gender, "female");
  assert.equal(patient.birthDate, "1974-04-12");
  assert.equal(patient.address[0].text, "서울특별시 중구");
  assert.equal(patient.contact[0].name.text, "김보호");
  assert.equal(patient.contact[0].relationship[0].text, "배우자");
  assert.equal(patient.contact[0].telecom[0].value, "010-0000-0000");
  assert.equal(patient.extension.find(({ url }) => url.endsWith("recorded-blood-type")).valueCodeableConcept.text, "A+");
  assert.equal(patient.extension.find(({ url }) => url.endsWith("local-insurance-type")).valueCode, "national-health");

  assert.equal(encounter.status, "finished");
  assert.equal(encounter.class.code, "AMB");
  assert.equal(encounter.period.start, "2026-07-19T00:05:00.000Z");
  assert.equal(encounter.period.end, "2026-07-19T00:25:00.000Z");
  assert.equal(encounter.serviceType.text, "가정의학과");
  assert.equal(encounter.location[0].location.display, "3진료실");
  assert.equal(encounter.reasonCode[0].text, "혈압 추적");
  assert.equal(encounter.diagnosis[0].rank, 1);

  assert.equal(composition.status, "final");
  assert.equal(composition.section.length, 4);
  assert.deepEqual(composition.section.map(({ code }) => code.coding[0].code), ["61150-9", "61149-1", "51848-0", "18776-5"]);
  assert.match(composition.section[0].text.div, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(composition.section[0].text.div, /<script>/);
  assert.match(composition.section[3].text.div, /유지 &amp; 4주/);
  assert.match(composition.section[3].text.div, /🩺�/);
  assert.equal(composition.section[3].text.div.includes("\uD800"), false);
  assert.equal(composition.author[0].display, "홍길동 의사");
  assert.equal(composition.attester, undefined);
  assert.equal(composition.meta.tag[0].code, "local-unverified");

  assert.equal(condition.code.coding[0].code, "I10");
  assert.equal(condition.verificationStatus.coding[0].code, "confirmed");
  assert.equal(condition.category[1].coding[0].code, "primary");
  assert.equal(condition.onsetDateTime, "2024-01-02");
});

test("처방 용법·기간·수량과 검사·처치 오더를 구조화한다", () => {
  const bundle = exportPatientFhirBundle(fullPatient(), "2026-07-19T01:00:00Z");
  const medication = resources(bundle, "MedicationRequest")[0];
  const service = resources(bundle, "ServiceRequest")[0];

  assert.equal(medication.status, "active");
  assert.equal(medication.intent, "original-order");
  assert.equal(medication.medicationCodeableConcept.text, "예시 혈압약");
  assert.equal(medication.dosageInstruction[0].text, "아침 식후 복용");
  assert.equal(medication.dosageInstruction[0].route.text, "경구");
  assert.equal(medication.dosageInstruction[0].timing.code.text, "하루 1회");
  assert.deepEqual(medication.dosageInstruction[0].doseAndRate[0].doseQuantity, { value: 1, unit: "정" });
  assert.equal(medication.dispenseRequest.quantity.value, 28);
  assert.equal(medication.dispenseRequest.expectedSupplyDuration.code, "d");
  assert.equal(medication.dispenseRequest.expectedSupplyDuration.value, 28);

  assert.equal(service.status, "active");
  assert.equal(service.intent, "reflex-order");
  assert.equal(service.priority, "urgent");
  assert.equal(service.category[0].coding[0].code, "laboratory");
  assert.equal(service.code.coding[0].code, "4548-4");
  assert.equal(service.patientInstruction, "공복 불필요");
});

test("혈압 패널은 수축기·이완기 UCUM component와 실제 측정 시각으로 FHIR 왕복한다", () => {
  const input = fullPatient();
  input.events = input.events.filter(({ type }) => type !== "observation");
  input.events.push({
    id: "blood-pressure-panel",
    type: "observation",
    encounterId: "encounter-1",
    recordStatus: "final",
    status: "final",
    system: "http://loinc.org",
    code: "85354-9",
    label: "혈압",
    date: "2026-07-19",
    observedAt: "2026-07-19T00:12:34.000Z",
    value: "128/78",
    unit: "mmHg",
  });

  const bundle = exportPatientFhirBundle(input, "2026-07-19T01:00:00Z");
  const observation = resources(bundle, "Observation")[0];
  assert.equal(observation.code.coding[0].code, "85354-9");
  assert.equal(observation.category[0].coding[0].code, "vital-signs");
  assert.equal(observation.effectiveDateTime, "2026-07-19T00:12:34.000Z");
  assert.equal(observation.valueString, undefined);
  assert.equal(observation.valueQuantity, undefined);
  assert.deepEqual(observation.component.map(({ code, valueQuantity }) => ({
    code: code.coding[0].code,
    value: valueQuantity.value,
    unit: valueQuantity.unit,
    system: valueQuantity.system,
    unitCode: valueQuantity.code,
  })), [
    { code: "8480-6", value: 128, unit: "mmHg", system: "http://unitsofmeasure.org", unitCode: "mm[Hg]" },
    { code: "8462-4", value: 78, unit: "mmHg", system: "http://unitsofmeasure.org", unitCode: "mm[Hg]" },
  ]);

  const roundTrip = parseEmrFhirBundle(bundle).patient.events.find(({ code }) => code === "85354-9");
  assert.equal(roundTrip.value, "128/78");
  assert.equal(roundTrip.unit, "mmHg");
  assert.equal(roundTrip.observedAt, "2026-07-19T00:12:34.000Z");
});

test("변조된 표준 측정은 FHIR 자원으로 내보내지 않고 fail-closed 처리한다", () => {
  const input = fullPatient();
  const observation = input.events.find(({ type }) => type === "observation");
  Object.assign(observation, {
    system: "http://loinc.org",
    code: "85354-9",
    label: "혈압",
    value: "999/999",
    unit: "DROP TABLE",
  });

  assert.throws(() => exportPatientFhirBundle(input, "2026-07-19T01:00:00Z"), /표준 Observation 값·단위/);
});

test("draft·취소·미서명 진료와 그 하위 기록을 내보내지 않는다", () => {
  const baseEncounter = {
    type: "encounter",
    label: "외래",
    date: "2026-07-19",
    status: "finished",
    recordStatus: "final",
    signature: { status: "signed", signer: "의사", signedAt: "2026-07-19T09:00:00Z" },
    soap: {},
  };
  const patient = {
    id: "patient-filter",
    name: "필터 환자",
    events: [
      { ...baseEncounter, id: "eligible", signature: { status: "legacy", signer: "이관 의사" } },
      { ...baseEncounter, id: "unsigned", signature: { status: "unsigned" } },
      { ...baseEncounter, id: "draft", recordStatus: "draft" },
      { ...baseEncounter, id: "cancelled", status: "cancelled" },
      { id: "keep-child", type: "condition", encounterId: "eligible", recordStatus: "final", status: "active", verificationStatus: "confirmed", diagnosisRole: "secondary", label: "유지 진단", date: "2026-07-19" },
      { id: "unsigned-child", type: "condition", encounterId: "unsigned", recordStatus: "final", status: "active", label: "제외 진단", date: "2026-07-19" },
      { id: "draft-child", type: "medication", encounterId: "eligible", recordStatus: "draft", status: "active", label: "초안 약", date: "2026-07-19" },
      { id: "cancelled-child", type: "service-request", encounterId: "eligible", recordStatus: "final", status: "cancelled", label: "취소 오더", date: "2026-07-19" },
    ],
  };

  const bundle = exportPatientFhirBundle(patient, "2026-07-19T10:00:00Z");
  assert.equal(resources(bundle, "Encounter").length, 1);
  assert.equal(resources(bundle, "Composition").length, 1);
  assert.equal(resources(bundle, "Condition").length, 1);
  assert.equal(resources(bundle, "MedicationRequest").length, 0);
  assert.equal(resources(bundle, "ServiceRequest").length, 0);
  assert.equal(resources(bundle, "Composition")[0].attester, undefined);
  assert.equal(resources(bundle, "Composition")[0].meta.tag[0].code, "local-unverified");
  const sections = resources(bundle, "Composition")[0].section;
  assert.ok(sections.filter(({ entry }) => !entry?.length).every(({ emptyReason }) => emptyReason?.coding[0].code === "nilknown"));
  assert.ok(sections.filter(({ entry }) => entry?.length).every(({ emptyReason }) => emptyReason === undefined));
});

test("진료 외 확정 Observation·Procedure는 같은 환자 자원으로 내보내고 고아 encounter 참조는 제외한다", () => {
  const patient = {
    id: "patient-source",
    name: "검사 환자",
    events: [
      { id: "obs", type: "observation", status: "final", label: "체온", date: "2026-07-18", value: 36.7, unit: "Cel" },
      { id: "proc", type: "procedure", recordStatus: "final", status: "completed", label: "상처 소독", date: "2026-07-18" },
      { id: "draft-obs", type: "observation", recordStatus: "draft", status: "final", label: "초안", date: "2026-07-18", value: "임시" },
      { id: "error-obs", type: "observation", recordStatus: "entered-in-error", status: "final", label: "오류", date: "2026-07-18", value: "오류" },
      { id: "orphan", type: "observation", encounterId: "not-exported", status: "final", label: "고아", date: "2026-07-18", value: "값" },
      { id: "empty", type: "observation", status: "final", label: "값 없음", date: "2026-07-18", value: "" },
    ],
  };

  const bundle = exportPatientFhirBundle(patient, "2026-07-19T10:00:00Z");
  assert.equal(resources(bundle, "Encounter").length, 0);
  assert.equal(resources(bundle, "Observation").length, 1);
  assert.equal(resources(bundle, "Procedure").length, 1);
  assert.equal(resources(bundle, "Observation")[0].valueQuantity.value, 36.7);
  assert.equal(resources(bundle, "Procedure")[0].subject.reference, bundle.entry[0].fullUrl);
  assert.equal(resources(bundle, "Procedure")[0].encounter, undefined);
});

test("지원 LOINC 숫자 측정은 표시 단위와 UCUM system·code를 함께 내보낸다", () => {
  const patient = {
    id: "patient-ucum",
    name: "단위 환자",
    events: [{
      id: "hba1c-ucum",
      type: "observation",
      recordStatus: "final",
      source: { kind: "manual", label: "의료진 확정" },
      status: "final",
      system: "http://loinc.org",
      code: "4548-4",
      label: "당화혈색소",
      date: "2026-07-18",
      value: 6.7,
      unit: "%",
    }],
  };

  const observation = resources(exportPatientFhirBundle(patient, "2026-07-19T10:00:00Z"), "Observation")[0];
  assert.deepEqual(observation.valueQuantity, {
    value: 6.7,
    unit: "%",
    system: "http://unitsofmeasure.org",
    code: "%",
  });
});

test("SOAP 텍스트가 없어도 구조화 entry가 있으면 Composition emptyReason을 만들지 않는다", () => {
  const input = fullPatient();
  input.events[0].soap.objective = "";
  const composition = resources(exportPatientFhirBundle(input, "2026-07-19T00:00:00Z"), "Composition")[0];
  const objective = composition.section.find(({ code }) => code.coding[0].code === "61149-1");

  assert.equal(objective.text, undefined);
  assert.equal(objective.emptyReason, undefined);
  assert.equal(objective.entry.length, 1);
});

test("역전된 Encounter 기간과 잘못된 임상 lifecycle은 fail-closed 처리한다", () => {
  const reversed = fullPatient();
  reversed.events[0].startedAt = "2026-07-19T10:00:00Z";
  reversed.events[0].finishedAt = "2026-07-19T09:00:00Z";
  assert.throws(() => exportPatientFhirBundle(reversed, "2026-07-19T00:00:00Z"), /종료 시각/);

  const invalidCondition = fullPatient();
  invalidCondition.events.find(({ type }) => type === "condition").certainty = "unknown-certainty";
  assert.throws(() => exportPatientFhirBundle(invalidCondition, "2026-07-19T00:00:00Z"), /Condition 상태/);

  const invalidMedication = fullPatient();
  invalidMedication.events.find(({ type }) => type === "medication").intent = "proposal";
  assert.throws(() => exportPatientFhirBundle(invalidMedication, "2026-07-19T00:00:00Z"), /MedicationRequest 상태/);

  const invalidPrescription = fullPatient();
  invalidPrescription.events.find(({ type }) => type === "medication").prescription.quantity = 0;
  assert.throws(() => exportPatientFhirBundle(invalidPrescription, "2026-07-19T00:00:00Z"), /처방 상세/);

  const invalidService = fullPatient();
  invalidService.events.find(({ type }) => type === "service-request").order.kind = "unknown-kind";
  assert.throws(() => exportPatientFhirBundle(invalidService, "2026-07-19T00:00:00Z"), /ServiceRequest 상태/);
});

test("entered-in-error Condition은 FHIR con-5에 따라 clinicalStatus를 생략한다", () => {
  const input = fullPatient();
  input.events.find(({ type }) => type === "condition").verificationStatus = "entered-in-error";
  const condition = resources(exportPatientFhirBundle(input, "2026-07-19T00:00:00Z"), "Condition")[0];

  assert.equal(condition.verificationStatus.coding[0].code, "entered-in-error");
  assert.equal(condition.clinicalStatus, undefined);
});

test("같은 로컬 ID는 반복 내보내기에서도 같은 FHIR ID·fullUrl을 만든다", () => {
  const first = exportPatientFhirBundle(fullPatient(), "2026-07-19T01:00:00Z");
  const second = exportPatientFhirBundle(fullPatient(), "2026-08-01T01:00:00Z");

  assert.deepEqual(first.entry.map(({ fullUrl }) => fullUrl), second.entry.map(({ fullUrl }) => fullUrl));
  assert.deepEqual(first.entry.map(({ resource }) => resource.id), second.entry.map(({ resource }) => resource.id));
  assert.notEqual(first.timestamp, second.timestamp);
});

test("환자가 다르면 같은 로컬 이벤트 ID도 다른 FHIR 자원 ID를 사용한다", () => {
  const firstPatient = fullPatient();
  const secondPatient = fullPatient();
  secondPatient.id = "patient-local-2";
  secondPatient.mrn = "VG-2026-1002";

  const first = exportPatientFhirBundle(firstPatient, "2026-07-19T01:00:00Z");
  const second = exportPatientFhirBundle(secondPatient, "2026-07-19T01:00:00Z");
  const firstUrls = new Set(first.entry.map(({ fullUrl }) => fullUrl));
  assert.ok(second.entry.every(({ fullUrl }) => !firstUrls.has(fullUrl)));
  assert.ok(resources(first, "Composition").every((composition) => composition.attester === undefined
    && composition.meta.tag.some(({ code }) => code === "local-unverified")));
});

test("생년월일이 없을 때만 입력 나이를 age-at-export 확장으로 보존한다", () => {
  const withoutBirthDate = exportPatientFhirBundle({ id: "age-only", name: "나이 환자", ageYears: 52, events: [] }, "2026-07-19T00:00:00Z");
  const withBirthDate = exportPatientFhirBundle({ id: "birth-date", name: "생일 환자", birthDate: "1974-04-12", ageYears: 99, events: [] }, "2026-07-19T00:00:00Z");

  assert.deepEqual(resources(withoutBirthDate, "Patient")[0].extension[0].valueAge, {
    value: 52,
    unit: "year",
    system: "http://unitsofmeasure.org",
    code: "a",
  });
  assert.equal(resources(withBirthDate, "Patient")[0].extension, undefined);
  assert.equal(resources(withBirthDate, "Patient")[0].birthDate, "1974-04-12");
});

test("환자·이벤트·내보내기 시각 입력을 엄격히 검증한다", () => {
  assert.throws(() => exportPatientFhirBundle(null, "2026-07-19T00:00:00Z"), /환자 데이터/);
  assert.throws(() => exportPatientFhirBundle({ name: "ID 없음" }, "2026-07-19T00:00:00Z"), /환자 ID/);
  assert.throws(() => exportPatientFhirBundle({ id: "p", events: {} }, "2026-07-19T00:00:00Z"), /이벤트 목록/);
  assert.throws(() => exportPatientFhirBundle({ id: "p", events: [] }, "not-a-date"), /시각/);
  assert.throws(() => exportPatientFhirBundle({ id: "p", events: [{ type: "observation", status: "final", label: "ID 없음", date: "2026-07-19", value: 1 }] }, "2026-07-19T00:00:00Z"), /이벤트 ID/);
  assert.throws(() => exportPatientFhirBundle({
    id: "p",
    events: [
      { id: "duplicate", type: "note" },
      { id: "duplicate", type: "observation" },
    ],
  }, "2026-07-19T00:00:00Z"), /중복된 임상 이벤트 ID/);
});
