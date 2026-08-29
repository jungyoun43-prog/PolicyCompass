import { normalizeClaimSearchText } from "./claim-search.js";

export const LOINC_SYSTEM = "http://loinc.org";
export const HIRA_FEE_SYSTEM = "urn:hira:fee-code";
export const DEMO_SERVICE_SYSTEM = "urn:policycompass:demo:service";

export const ORDER_CATALOG_BOUNDARY = "내부 검토용 예시 오더 목록입니다. 기관 수가 마스터가 아니며 검사·처치 지시를 자동으로 판단하지 않습니다. 오더 내용과 코드는 의료진이 확인해 선택하세요.";

export const ORDER_KINDS = Object.freeze([
  Object.freeze({ value: "laboratory", label: "검사" }),
  Object.freeze({ value: "imaging", label: "영상" }),
  Object.freeze({ value: "procedure", label: "처치" }),
  Object.freeze({ value: "referral", label: "의뢰" }),
]);

export const ORDER_PRIORITIES = Object.freeze([
  Object.freeze({ value: "routine", label: "일반" }),
  Object.freeze({ value: "urgent", label: "긴급" }),
  Object.freeze({ value: "asap", label: "즉시" }),
]);

function order(entry) {
  return Object.freeze({ priority: "routine", instructions: "", ...entry });
}

export const ORDER_CATALOG = Object.freeze([
  order({
    id: "cbc",
    kind: "laboratory",
    code: "58410-2",
    system: LOINC_SYSTEM,
    label: "일반혈액검사(CBC)",
    keywords: "CBC complete blood count 일반혈액검사 혈액 백혈구 빈혈",
  }),
  order({
    id: "fasting-glucose",
    kind: "laboratory",
    code: "1558-6",
    system: LOINC_SYSTEM,
    label: "공복 혈당",
    keywords: "fasting glucose 공복 혈당 당뇨 FBS",
  }),
  order({
    id: "hba1c",
    kind: "laboratory",
    code: "4548-4",
    system: LOINC_SYSTEM,
    label: "당화혈색소(HbA1c)",
    keywords: "hba1c 당화혈색소 당뇨 혈당 추적",
  }),
  order({
    id: "ldl",
    kind: "laboratory",
    code: "2089-1",
    system: LOINC_SYSTEM,
    label: "LDL 콜레스테롤",
    keywords: "LDL cholesterol 콜레스테롤 이상지질혈증 고지혈증",
  }),
  order({
    id: "creatinine",
    kind: "laboratory",
    code: "2160-0",
    system: LOINC_SYSTEM,
    label: "혈청 크레아티닌",
    keywords: "creatinine 크레아티닌 신장 콩팥 신기능",
  }),
  order({
    id: "ast",
    kind: "laboratory",
    code: "1920-8",
    system: LOINC_SYSTEM,
    label: "AST(간기능)",
    keywords: "AST SGOT 간기능 간수치",
  }),
  order({
    id: "alt",
    kind: "laboratory",
    code: "1742-6",
    system: LOINC_SYSTEM,
    label: "ALT(간기능)",
    keywords: "ALT SGPT 간기능 간수치",
  }),
  order({
    id: "ecg",
    kind: "procedure",
    code: "11524-6",
    system: LOINC_SYSTEM,
    label: "심전도(ECG)",
    keywords: "ECG EKG 심전도 부정맥 흉통",
  }),
  order({
    id: "pulmonary-function-test",
    kind: "procedure",
    code: "F6002",
    system: HIRA_FEE_SYSTEM,
    label: "기관지확장제 전후 폐활량검사(PFT)",
    keywords: "PFT spirometry 폐기능검사 폐활량 COPD 천식 기관지확장제",
    instructions: "기관지확장제 투여 전후 측정값을 함께 기록",
  }),
  order({
    id: "bone-mineral-density",
    kind: "procedure",
    code: "DEMO-BMD",
    system: DEMO_SERVICE_SYSTEM,
    label: "골밀도검사",
    keywords: "BMD DXA 골밀도 골다공증",
  }),
  order({
    id: "bp-follow-up",
    kind: "procedure",
    code: "DEMO-BP-FOLLOWUP",
    system: DEMO_SERVICE_SYSTEM,
    label: "고혈압 추적검사",
    keywords: "고혈압 추적 혈압 follow up 재검",
  }),
  order({
    id: "a1c-follow-up",
    kind: "procedure",
    code: "DEMO-A1C-FOLLOWUP",
    system: DEMO_SERVICE_SYSTEM,
    label: "당뇨 추적검사",
    keywords: "당뇨 추적 당화혈색소 follow up 재검",
  }),
  order({
    id: "chest-xray",
    kind: "imaging",
    code: "DEMO-CXR",
    system: DEMO_SERVICE_SYSTEM,
    label: "흉부 X-ray",
    keywords: "chest x-ray CXR 흉부 방사선 폐렴 기침",
  }),
  order({
    id: "chest-ct",
    kind: "imaging",
    code: "DEMO-CHEST-CT",
    system: DEMO_SERVICE_SYSTEM,
    label: "흉부 CT",
    keywords: "chest CT 흉부 컴퓨터단층촬영 폐",
  }),
  order({
    id: "knee-xray",
    kind: "imaging",
    code: "DEMO-KNEE-XR",
    system: DEMO_SERVICE_SYSTEM,
    label: "무릎 X-ray",
    keywords: "knee x-ray 무릎 방사선 관절염 관절증",
  }),
  order({
    id: "referral-pulmonology",
    kind: "referral",
    code: "DEMO-REF-PULM",
    system: DEMO_SERVICE_SYSTEM,
    label: "호흡기내과 의뢰",
    keywords: "호흡기내과 의뢰 전원 COPD 천식 폐",
  }),
  order({
    id: "referral-cardiology",
    kind: "referral",
    code: "DEMO-REF-CARD",
    system: DEMO_SERVICE_SYSTEM,
    label: "순환기내과 의뢰",
    keywords: "순환기내과 심장 의뢰 전원 고혈압 부정맥",
  }),
  order({
    id: "referral-endocrinology",
    kind: "referral",
    code: "DEMO-REF-ENDO",
    system: DEMO_SERVICE_SYSTEM,
    label: "내분비내과 의뢰",
    keywords: "내분비내과 의뢰 전원 당뇨 갑상선",
  }),
]);

const KIND_LABELS = new Map(ORDER_KINDS.map(({ value, label }) => [value, label]));

export function orderKindLabel(kind) {
  return KIND_LABELS.get(kind) ?? "오더";
}

function catalogSearchText(entry) {
  return [entry.label, orderKindLabel(entry.kind), entry.code, entry.keywords].join(" ");
}

const searchIndex = ORDER_CATALOG.map((entry) => ({
  entry,
  text: normalizeClaimSearchText(catalogSearchText(entry)),
}));

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

/**
 * Substring-and-token search over the reference order list. Ordering is stable so
 * the same query always lists the same orders in the same place.
 */
export function searchOrderCatalog(query, limit = 8) {
  const normalized = normalizeClaimSearchText(query).slice(0, 120);
  if (!normalized) return [];
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 0), 30) : 8;
  if (safeLimit <= 0) return [];
  const tokens = normalized.split(" ").filter(Boolean);
  return searchIndex
    .filter(({ text }) => text.includes(normalized) || tokens.every((token) => text.includes(token)))
    .map(({ entry }) => entry)
    .sort((left, right) => collator.compare(left.label, right.label))
    .slice(0, safeLimit);
}

export function findOrderInCatalog(id) {
  const key = typeof id === "string" ? id.trim() : "";
  return ORDER_CATALOG.find((entry) => entry.id === key) ?? null;
}
