import { normalizeClaimSearchText } from "./claim-search.js";

export const KCD_SYSTEM = "urn:kr:kcd";
export const EDI_SYSTEM = "urn:kr:edi";
export const LOINC_SYSTEM = "http://loinc.org";
export const HIRA_FEE_SYSTEM = "urn:hira:fee-code";

/**
 * The catalogue below is an internal review fixture, not a licensed formulary and
 * not a reimbursement notice. Every `source` therefore carries an explicit
 * "예시" marker so no screen can present it as an official 고시.
 */
export const MEDICATION_CATALOG_BOUNDARY = "내부 검토용 예시 약품·급여기준 목록입니다. 실제 약제 급여기준 고시나 의약품 데이터베이스가 아니며, 처방 추천·용량 검증·상호작용 판정을 제공하지 않습니다.";

const SOURCE = Object.freeze({
  drug: Object.freeze({
    label: "내부 검토용 예시 약제 급여기준 · 실제 고시 아님",
    documentNumber: "PC-RX-2026-01",
    version: "2026.1",
    effectiveFrom: "2026-01-01",
    url: "",
  }),
  duplicate: Object.freeze({
    label: "내부 검토용 예시 동일성분·동일효능군 중복 기준 · 실제 고시 아님",
    documentNumber: "PC-RX-2026-02",
    version: "2026.1",
    effectiveFrom: "2026-01-01",
    url: "",
  }),
  safety: Object.freeze({
    label: "내부 검토용 예시 금기·알레르기 확인 기준 · 실제 고시 아님",
    documentNumber: "PC-RX-2026-03",
    version: "2026.1",
    effectiveFrom: "2026-01-01",
    url: "",
  }),
});

export const MEDICATION_CLAIM_SOURCES = SOURCE;

function medication(entry) {
  return Object.freeze({
    ...entry,
    system: EDI_SYSTEM,
    dosing: Object.freeze(entry.dosing),
    coverage: Object.freeze({
      indications: Object.freeze((entry.coverage.indications ?? []).map((item) => Object.freeze({ system: KCD_SYSTEM, ...item }))),
      requiredEvidence: Object.freeze((entry.coverage.requiredEvidence ?? []).map((item) => Object.freeze({ ...item }))),
      contraindications: Object.freeze((entry.coverage.contraindications ?? []).map((item) => Object.freeze({ system: KCD_SYSTEM, ...item }))),
      allergyIngredients: Object.freeze(entry.coverage.allergyIngredients ?? []),
      duplicateClass: entry.coverage.duplicateClass ?? "",
      duplicateClassLabel: entry.coverage.duplicateClassLabel ?? "",
      maxDurationDays: entry.coverage.maxDurationDays ?? 0,
      ageMinimum: entry.coverage.ageMinimum ?? 0,
      ageMaximum: entry.coverage.ageMaximum ?? 0,
      source: SOURCE.drug,
    }),
  });
}

const NOTICE_BENRALIZUMAB = `허가사항 범위 내에서 아래와 같은 기준으로 투여 시 요양급여를 인정하며, 동 인정기준 이외에는 약값 전액을 환자가 부담토록 함.

- 아 래 -
1. 투여대상
○ 성인 중증 호산구성 천식 환자 중 고용량의 흡입용 코르티코스테로이드-장기지속형 흡입용 베타2 작용제 (ICS-LABA)와 장기지속형 무스카린 길항제(LAMA)의 투여에도 불구하고 적절하게 조절이 되지 않는 경우로서 다음 1), 2) 조건 중 하나에 해당하는 경우
※ ICS-LABA: Inhaled CorticoSteroids-Long Acting Beta-2 Agonist
LAMA: Long Acting Muscarinic Antagonist
- 다 음 -
1) 치료 시작 전 12개월 이내에 혈중 호산구 수치가 300 cells/㎕ 이상이면서
- 치료 시작 전 12개월 이내에 전신 코르티코스테로이드가 요구되는 천식 급성악화가 4번 이상 발생하였거나, 치료 시작 6개월 전부터 prednisolone 5mg/day 와 동등한 수준 이상의 경구용 코르티코스테로이드를 지속적으로 투여한 경우
2) 치료 시작 전 12개월 이내에 혈중 호산구 수치가 400 cells/㎕ 이상이면서
- 치료 시작 전 12개월 이내에 전신 코르티코스테로이드가 요구되는 천식 급성악화가 3번 이상 발생한 경우

2. 평가방법
○ 동 약제 투여 전과 투여 후 매 1년마다 평가하여 다음 중 한 가지 이상을 만족하면서, 전반적인 천식조절을 확인한 환자에 대한 투여 소견서 제출 시 지속 투여를 인정함.
(단, 임상증상 등을 고려하여 효과가 불충분하다고 판단되는 경우에는 1년 이내이더라도 치료효과를 평가할 수 있음.)
- 다 음 -
1) 천식 급성악화의 빈도가 치료 시작 전 대비 50% 이상 감소
2) 지속적인 경구용 코르티코스테로이드 치료가 필요한 환자의 경우 천식증상 조절을 개선하거나 유지하면서 경구용 코르티코스테로이드 용량을 치료 시작 전 대비 50% 이상 감소

3. 중증 천식 환자에 사용하는 생물학적 제제(omalizumab, mepolizumab, benralizumab, reslizumab, dupilumab)간 병용투여는 급여 인정하지 아니함.

4. 교체투여
가. 중증 호산구성 천식 환자에 사용하는 생물학적 제제(mepolizumab, reslizumab, dupilumab)간 교체투여 및 동 약제에서 omalizumab으로의 교체투여는 인정하지 아니함.
나. omalizumab 주사제 투여 후 동 약제로의 교체투여는 다음의 조건을 모두 만족하면서 투여소견서 첨부 시 사례별로 급여 인정함.
- 다 음 -
1) omalizumab 주사제를 3-6개월 이상 사용하였음에도 효과가 불충분하거나 부작용으로 투약을 지속할 수 없는 경우 또는 복약순응도 개선의 필요성이 있는 경우
2) 동 약제의 투여대상 조건을 만족하는 경우

■ 고시번호(시행일자): 고시 제2026-92호(2026.5.1.)
■ 변경 전 고시번호(시행일자): 고시 제2025-224호(2026.1.1.)`;

export const MEDICATION_CATALOG = Object.freeze([
  medication({
    id: "benralizumab-30",
    code: "PC-RX-BENRA30",
    label: "벤라리주맙 프리필드시린지 30mg",
    ingredient: "Benralizumab",
    classLabel: "Anti-IL-5 receptor α monoclonal antibody",
    indication: "성인 중증 호산구성 천식의 추가 유지 치료",
    keywords: "benralizumab 벤라리주맙 파센라 fasenra 천식 호산구 생물학적제제 항체 IL-5 asthma",
    dosing: { dose: "30", doseUnit: "mg", route: "피하주사", frequency: "4주 1회(첫 3회) 후 8주 1회", durationDays: 56, quantity: 1, instructions: "의료기관 내 투여" },
    coverage: {
      indications: [{ code: "J45", label: "천식" }, { code: "J46", label: "천식지속상태" }],
      duplicateClass: "SEVERE-ASTHMA-BIOLOGIC",
      duplicateClassLabel: "Severe asthma biologic (anti-IgE·anti-IL-5·anti-IL-4Rα)",
      ageMinimum: 18,
    },
    notice: NOTICE_BENRALIZUMAB,
  }),
  medication({
    id: "durvalumab-500",
    code: "PC-RX-DURVA500",
    label: "더발루맙주 500mg",
    ingredient: "Durvalumab",
    classLabel: "Anti-PD-L1 monoclonal antibody (immune checkpoint inhibitor)",
    indication: "절제 불가능한 3기 비소세포폐암의 백금 기반 항암화학방사선요법 후 공고요법 등",
    keywords: "durvalumab 더발루맙 임핀지 imfinzi 면역항암제 폐암 비소세포폐암 소세포폐암 PD-L1 면역관문억제제 항암제",
    dosing: { dose: "10", doseUnit: "mg/kg", route: "정맥주입", frequency: "2주 1회", durationDays: 14, quantity: 1, instructions: "의료기관 내 60분 정맥주입" },
    coverage: {
      indications: [{ code: "C34", label: "기관지 및 폐의 악성 신생물" }],
      duplicateClass: "IMMUNE-CHECKPOINT",
      duplicateClassLabel: "Immune checkpoint inhibitor (anti-PD-1·anti-PD-L1)",
      ageMinimum: 18,
    },
  }),
]);

/**
 * Maps the codes and labels used by existing chart medications onto the catalogue
 * duplication classes, so an already active prescription can be compared with a new one.
 */
export const CHART_MEDICATION_CLASS_HINTS = Object.freeze([
  Object.freeze({ class: "RAS", classLabel: "Renin-angiotensin system inhibitor (ACEI·ARB)", codes: ["MED-ARB", "C09AA03", "C09CA01"], keywords: ["arb", "acei", "안지오텐신", "리시노프릴", "로사르탄", "혈압약"] }),
  Object.freeze({ class: "LAMA", classLabel: "Long-acting muscarinic antagonist (LAMA)", codes: ["DEMO-LAMA"], keywords: ["lama", "티오트로피움", "흡입제"] }),
  Object.freeze({ class: "PPI", classLabel: "Proton pump inhibitor (PPI)", codes: ["MED-PPI"], keywords: ["ppi", "위산", "판토프라졸", "오메프라졸"] }),
  Object.freeze({ class: "TRIPTAN", classLabel: "Triptan", codes: ["MED-TRIPTAN"], keywords: ["triptan", "트립탄", "편두통"] }),
  Object.freeze({ class: "CCB", classLabel: "Calcium channel blocker (CCB)", codes: [], keywords: ["암로디핀", "amlodipine", "ccb"] }),
  Object.freeze({ class: "STATIN", classLabel: "HMG-CoA reductase inhibitor (statin)", codes: [], keywords: ["스타틴", "statin", "아토르바스타틴"] }),
  Object.freeze({ class: "BIGUANIDE", classLabel: "Biguanide", codes: [], keywords: ["메트포르민", "metformin"] }),
]);

function catalogSearchText(entry) {
  return [
    entry.label,
    entry.ingredient,
    entry.classLabel,
    entry.code,
    entry.keywords,
    entry.coverage.indications.map(({ code, label }) => `${code} ${label}`).join(" "),
  ].join(" ");
}

const searchIndex = MEDICATION_CATALOG.map((entry) => ({
  entry,
  text: normalizeClaimSearchText(catalogSearchText(entry)),
}));

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

/**
 * Substring-and-token search over the demo formulary. Ordering is stable so the
 * same query always lists the same medicines in the same place.
 */
export function searchMedicationCatalog(query, limit = 8) {
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

export function findMedicationInCatalog(id) {
  const key = typeof id === "string" ? id.trim() : "";
  return MEDICATION_CATALOG.find((entry) => entry.id === key || entry.code === key) ?? null;
}

/**
 * Resolves the duplication class of a medication already recorded in the chart.
 * Catalogue codes win over keyword hints so renamed demo labels cannot mislabel a class.
 */
export function chartMedicationClass(event = {}) {
  const code = typeof event.code === "string" ? event.code.trim().toUpperCase() : "";
  const matchedCatalog = MEDICATION_CATALOG.find((entry) => entry.code.toUpperCase() === code);
  if (matchedCatalog) {
    return { class: matchedCatalog.coverage.duplicateClass, classLabel: matchedCatalog.coverage.duplicateClassLabel };
  }
  const haystack = normalizeClaimSearchText([event.code, event.label, event.note].filter(Boolean).join(" "));
  for (const hint of CHART_MEDICATION_CLASS_HINTS) {
    if (hint.codes.some((value) => value.toUpperCase() === code)) return { class: hint.class, classLabel: hint.classLabel };
    if (hint.keywords.some((keyword) => haystack.includes(normalizeClaimSearchText(keyword)))) {
      return { class: hint.class, classLabel: hint.classLabel };
    }
  }
  return { class: "", classLabel: "" };
}
