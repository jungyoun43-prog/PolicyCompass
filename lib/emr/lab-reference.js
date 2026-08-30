/**
 * Display-only reference ranges for the lab viewer. Synthetic values for the
 * demo catalog — real deployments must load institutional reference ranges.
 * Not used for any judgement; only H/L flags and the 참고치 column.
 */
const LAB_REFERENCES = new Map([
  ["4548-4", { label: "당화혈색소", low: 4.0, high: 5.6, unit: "%", panel: "당대사" }],
  ["2089-1", { label: "LDL 콜레스테롤", high: 129.9, unit: "mg/dL", panel: "지질" }],
  ["6690-2", { label: "백혈구", low: 4.0, high: 10.0, unit: "10³/µL", panel: "CBC" }],
  ["718-7", { label: "혈색소", low: 12.0, high: 16.0, unit: "g/dL", panel: "CBC" }],
  ["4544-3", { label: "적혈구용적률", low: 36, high: 48, unit: "%", panel: "CBC" }],
  ["777-3", { label: "혈소판", low: 150, high: 400, unit: "10³/µL", panel: "CBC" }],
  ["39156-5", { label: "체질량지수", low: 18.5, high: 24.9, unit: "kg/m²", panel: "신체계측" }],
]);

const BP_CODE = "85354-9";

function numeric(value) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Classifies one observation for the viewer: reference text and an H/L flag.
 * Unknown codes return no reference and no flag.
 */
export function labPresentation(event) {
  const code = String(event.code ?? "");
  if (code === BP_CODE) {
    const match = String(event.value ?? "").match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return { reference: "〈 120/80", flag: "" };
    const [systolic, diastolic] = [Number(match[1]), Number(match[2])];
    return {
      reference: "〈 120/80",
      flag: systolic >= 130 || diastolic >= 85 ? "H" : "",
      panel: "활력징후",
    };
  }
  const reference = LAB_REFERENCES.get(code);
  if (!reference) return { reference: "", flag: "", panel: "" };
  const value = numeric(event.value);
  const flag = value === null ? ""
    : reference.low !== undefined && value < reference.low ? "L"
      : reference.high !== undefined && value > reference.high ? "H" : "";
  const bounds = reference.low !== undefined && reference.high !== undefined
    ? `${reference.low}–${reference.high}`
    : reference.high !== undefined ? `〈 ${Math.round(reference.high + 0.1)}` : `〉 ${reference.low}`;
  return { reference: `${bounds} ${reference.unit ?? ""}`.trim(), flag, panel: reference.panel ?? "" };
}

export function labPanel(event) {
  return labPresentation(event).panel || "기타 검사";
}
