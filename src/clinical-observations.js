export const LOINC_SYSTEM = "http://loinc.org";

export const CLINICAL_OBSERVATION_SPECS = Object.freeze([
  Object.freeze({ key: "blood-pressure", patientTransferKey: "blood-pressure", code: "85354-9", label: "혈압", unit: "mmHg", ucumCode: "mm[Hg]", acceptedUnits: ["mmHg", "mm[Hg]"], placeholder: "예: 120/80", kind: "blood-pressure" }),
  Object.freeze({ key: "heart-rate", code: "8867-4", label: "맥박", unit: "{beats}/min", ucumCode: "{beats}/min", placeholder: "예: 72", minimum: 1, maximum: 300 }),
  Object.freeze({ key: "body-temperature", code: "8310-5", label: "체온", unit: "Cel", ucumCode: "Cel", placeholder: "예: 36.7", minimum: 20, maximum: 50 }),
  Object.freeze({ key: "respiratory-rate", code: "9279-1", label: "호흡수", unit: "{breaths}/min", ucumCode: "{breaths}/min", placeholder: "예: 18", minimum: 1, maximum: 100 }),
  Object.freeze({ key: "oxygen-saturation", code: "59408-5", label: "산소포화도", unit: "%", ucumCode: "%", placeholder: "예: 98", minimum: 1, maximum: 100 }),
  Object.freeze({ key: "body-height", code: "8302-2", label: "키", unit: "cm", ucumCode: "cm", placeholder: "예: 168.5", minimum: 20, maximum: 300 }),
  Object.freeze({ key: "body-weight", code: "29463-7", label: "체중", unit: "kg", ucumCode: "kg", placeholder: "예: 65.2", minimum: 0.2, maximum: 700 }),
  Object.freeze({ key: "body-mass-index", code: "39156-5", label: "BMI", unit: "kg/m2", ucumCode: "kg/m2", placeholder: "예: 23.1", minimum: 1, maximum: 150 }),
  Object.freeze({ key: "fasting-glucose", patientTransferKey: "glucose", code: "1558-6", label: "공복 혈당", unit: "mg/dL", ucumCode: "mg/dL", placeholder: "예: 108", minimum: 1, maximum: 2_000 }),
  Object.freeze({ key: "hba1c", patientTransferKey: "hba1c", code: "4548-4", label: "당화혈색소", unit: "%", ucumCode: "%", placeholder: "예: 6.5", minimum: 1, maximum: 30 }),
  Object.freeze({ key: "ldl", patientTransferKey: "ldl", code: "2089-1", label: "LDL 콜레스테롤", unit: "mg/dL", ucumCode: "mg/dL", placeholder: "예: 120", minimum: 0, maximum: 1_000 }),
]);

const SPEC_BY_CODE = new Map(CLINICAL_OBSERVATION_SPECS.map((spec) => [spec.code, spec]));

export function clinicalObservationSpec(code) {
  return SPEC_BY_CODE.get(typeof code === "string" ? code.trim() : "") ?? null;
}

export function normalizeClinicalObservationValue(value, specOrCode) {
  const spec = typeof specOrCode === "string" ? clinicalObservationSpec(specOrCode) : specOrCode;
  if (!spec) throw new TypeError("지원되는 진료 측정 항목을 선택하세요.");
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === undefined || raw === null || raw === "") throw new TypeError(`${spec.label} 값을 입력하세요.`);
  if (spec.kind === "blood-pressure") {
    const match = typeof raw === "string" ? raw.match(/^(\d{2,3})\s*[\/／]\s*(\d{2,3})$/) : null;
    if (!match) throw new TypeError("혈압은 수축기/이완기 형식으로 입력하세요. 예: 120/80");
    const systolic = Number(match[1]);
    const diastolic = Number(match[2]);
    if (systolic < 40 || systolic > 300 || diastolic < 20 || diastolic > 200 || systolic <= diastolic) {
      throw new TypeError("혈압 값의 범위와 수축기·이완기 순서를 확인하세요.");
    }
    return `${systolic}/${diastolic}`;
  }
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < spec.minimum || parsed > spec.maximum) {
    throw new TypeError(`${spec.label} 값은 ${spec.minimum}~${spec.maximum} ${spec.unit} 범위의 숫자여야 합니다.`);
  }
  return parsed;
}

export function isCanonicalClinicalObservation(event) {
  const spec = event?.system === LOINC_SYSTEM ? clinicalObservationSpec(event?.code) : null;
  if (!spec) return false;
  const acceptedUnits = spec.acceptedUnits ?? [spec.unit];
  if (!acceptedUnits.includes(event.unit)) return false;
  try {
    normalizeClinicalObservationValue(event.value, spec);
    return true;
  } catch {
    return false;
  }
}

export function bloodPressureComponents(value) {
  try {
    const normalized = normalizeClinicalObservationValue(value, "85354-9");
    const [systolic, diastolic] = normalized.split("/").map(Number);
    return { systolic, diastolic };
  } catch {
    return null;
  }
}
