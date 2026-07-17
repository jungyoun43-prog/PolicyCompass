import assert from "node:assert/strict";
import test from "node:test";

import { parseFhirBundle } from "../src/fhir-import.js";

const bundle = {
  resourceType: "Bundle",
  type: "collection",
  timestamp: "2026-07-12T09:30:00+09:00",
  entry: [
    {
      resource: {
        resourceType: "Condition",
        id: "condition-1",
        clinicalStatus: { coding: [{ code: "active" }] },
        code: {
          coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "I10", display: "Essential hypertension" }],
          text: "고혈압",
        },
        recordedDate: "2026-06-02",
      },
    },
    {
      resource: {
        resourceType: "Observation",
        id: "bp-1",
        status: "final",
        effectiveDateTime: "2026-07-11T08:15:00+09:00",
        code: { coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure panel" }] },
        component: [
          { code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] }, valueQuantity: { value: 148, unit: "mmHg" } },
          { code: { coding: [{ system: "http://loinc.org", code: "8462-4" }] }, valueQuantity: { value: 94, unit: "mmHg" } },
        ],
      },
    },
    {
      resource: {
        resourceType: "Observation",
        id: "ldl-1",
        status: "final",
        effectiveDateTime: "2026-07-10",
        code: { coding: [{ system: "http://loinc.org", code: "2089-1", display: "LDL cholesterol" }] },
        valueQuantity: { value: 156, unit: "mg/dL" },
      },
    },
  ],
};

test("FHIR Bundle에서 지원하는 질환과 측정값을 로컬 모델로 변환한다", () => {
  const result = parseFhirBundle(bundle);

  assert.deepEqual(result.conditionIds, ["hypertension"]);
  assert.deepEqual(result.measurements.map(({ key, value }) => [key, value]), [
    ["blood-pressure", "148/94"],
    ["ldl", 156],
  ]);
  assert.equal(result.observedAt, "2026-07-12T09:30:00+09:00");
  assert.equal(result.provenance.supported, 3);
  assert.equal(result.provenance.unsupported, 0);
});

test("비활성 질환과 지원하지 않는 리소스는 확정 신호로 만들지 않는다", () => {
  const result = parseFhirBundle({
    resourceType: "Bundle",
    entry: [
      { resource: { resourceType: "Condition", clinicalStatus: { coding: [{ code: "resolved" }] }, code: { text: "당뇨병" } } },
      { resource: { resourceType: "MedicationRequest", status: "active" } },
    ],
  });

  assert.deepEqual(result.conditionIds, []);
  assert.equal(result.provenance.supported, 0);
  assert.equal(result.provenance.unsupported, 2);
});

test("FHIR Bundle이 아니거나 항목이 과도하면 명확하게 거부한다", () => {
  assert.throws(() => parseFhirBundle({ resourceType: "Patient" }), /FHIR Bundle/);
  assert.throws(
    () => parseFhirBundle({ resourceType: "Bundle", entry: Array.from({ length: 1001 }, () => ({})) }),
    /1,000개/,
  );
});
