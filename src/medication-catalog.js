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
    documentNumber: "PolicyCompass 예시 기준 PC-RX-2026-01",
    version: "2026.1",
    effectiveFrom: "2026-01-01",
    url: "",
  }),
  duplicate: Object.freeze({
    label: "내부 검토용 예시 동일성분·동일효능군 중복 기준 · 실제 고시 아님",
    documentNumber: "PolicyCompass 예시 기준 PC-RX-2026-02",
    version: "2026.1",
    effectiveFrom: "2026-01-01",
    url: "",
  }),
  safety: Object.freeze({
    label: "내부 검토용 예시 금기·알레르기 확인 기준 · 실제 고시 아님",
    documentNumber: "PolicyCompass 예시 기준 PC-RX-2026-03",
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

export const MEDICATION_CATALOG = Object.freeze([
  medication({
    id: "amlodipine-5",
    code: "PC-RX-AMLO5",
    label: "암로디핀정 5mg",
    ingredient: "Amlodipine besylate",
    classLabel: "Calcium channel blocker (CCB)",
    keywords: "amlodipine 노바스크 혈압약 고혈압 CCB 칼슘차단제",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 28, quantity: 28, instructions: "아침 식후 복용" },
    coverage: {
      indications: [{ code: "I10", label: "본태성 고혈압" }, { code: "I11", label: "고혈압성 심장질환" }],
      requiredEvidence: [{ code: "85354-9", system: LOINC_SYSTEM, label: "최근 180일 이내 혈압 측정 기록", eventTypes: ["observation"], lookbackDays: 180, severity: "required" }],
      duplicateClass: "CCB",
      duplicateClassLabel: "Calcium channel blocker (CCB)",
      maxDurationDays: 90,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "losartan-50",
    code: "PC-RX-LOSA50",
    label: "로사르탄칼륨정 50mg",
    ingredient: "Losartan potassium",
    classLabel: "Angiotensin II receptor blocker (ARB)",
    keywords: "losartan 코자 혈압약 고혈압 ARB 안지오텐신",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 28, quantity: 28, instructions: "" },
    coverage: {
      indications: [{ code: "I10", label: "본태성 고혈압" }, { code: "I11", label: "고혈압성 심장질환" }],
      requiredEvidence: [{ code: "85354-9", system: LOINC_SYSTEM, label: "최근 180일 이내 혈압 측정 기록", eventTypes: ["observation"], lookbackDays: 180, severity: "required" }],
      duplicateClass: "RAS",
      duplicateClassLabel: "Renin-angiotensin system inhibitor (ACEI·ARB)",
      maxDurationDays: 90,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "lisinopril-10",
    code: "PC-RX-LISI10",
    label: "리시노프릴정 10mg",
    ingredient: "Lisinopril",
    classLabel: "ACE inhibitor (ACEI)",
    keywords: "lisinopril 혈압약 고혈압 ACEI 안지오텐신전환효소",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 28, quantity: 28, instructions: "" },
    coverage: {
      indications: [{ code: "I10", label: "본태성 고혈압" }, { code: "I11", label: "고혈압성 심장질환" }],
      requiredEvidence: [{ code: "85354-9", system: LOINC_SYSTEM, label: "최근 180일 이내 혈압 측정 기록", eventTypes: ["observation"], lookbackDays: 180, severity: "required" }],
      duplicateClass: "RAS",
      duplicateClassLabel: "Renin-angiotensin system inhibitor (ACEI·ARB)",
      maxDurationDays: 90,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "hydrochlorothiazide-12-5",
    code: "PC-RX-HCTZ125",
    label: "하이드로클로로티아지드정 12.5mg",
    ingredient: "Hydrochlorothiazide",
    classLabel: "Thiazide diuretic",
    keywords: "hydrochlorothiazide HCTZ 이뇨제 혈압약 고혈압",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 28, quantity: 28, instructions: "오전 복용" },
    coverage: {
      indications: [{ code: "I10", label: "본태성 고혈압" }],
      requiredEvidence: [{ code: "85354-9", system: LOINC_SYSTEM, label: "최근 180일 이내 혈압 측정 기록", eventTypes: ["observation"], lookbackDays: 180, severity: "required" }],
      duplicateClass: "THIAZIDE",
      duplicateClassLabel: "Thiazide diuretic",
      maxDurationDays: 90,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "metformin-500",
    code: "PC-RX-METF500",
    label: "메트포르민염산염서방정 500mg",
    ingredient: "Metformin hydrochloride",
    classLabel: "Biguanide",
    keywords: "metformin 메트포민 당뇨약 당뇨 비구아나이드",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 2회", durationDays: 28, quantity: 56, instructions: "식사 직후 복용" },
    coverage: {
      indications: [{ code: "E11", label: "제2형 당뇨병" }],
      requiredEvidence: [{ code: "4548-4", system: LOINC_SYSTEM, label: "최근 180일 이내 당화혈색소 기록", eventTypes: ["observation"], lookbackDays: 180, severity: "required" }],
      contraindications: [{ code: "N18", label: "만성 콩팥병" }],
      duplicateClass: "BIGUANIDE",
      duplicateClassLabel: "Biguanide",
      maxDurationDays: 90,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "glimepiride-2",
    code: "PC-RX-GLIM2",
    label: "글리메피리드정 2mg",
    ingredient: "Glimepiride",
    classLabel: "Sulfonylurea (SU)",
    keywords: "glimepiride 아마릴 당뇨약 당뇨 설포닐우레아",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 28, quantity: 28, instructions: "아침 식전 복용" },
    coverage: {
      indications: [{ code: "E11", label: "제2형 당뇨병" }],
      requiredEvidence: [{ code: "4548-4", system: LOINC_SYSTEM, label: "최근 180일 이내 당화혈색소 기록", eventTypes: ["observation"], lookbackDays: 180, severity: "required" }],
      duplicateClass: "SU",
      duplicateClassLabel: "Sulfonylurea (SU)",
      maxDurationDays: 90,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "empagliflozin-10",
    code: "PC-RX-EMPA10",
    label: "엠파글리플로진정 10mg",
    ingredient: "Empagliflozin",
    classLabel: "SGLT-2 inhibitor",
    keywords: "empagliflozin 자디앙 당뇨약 당뇨 SGLT2",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 28, quantity: 28, instructions: "" },
    coverage: {
      indications: [{ code: "E11", label: "제2형 당뇨병" }],
      requiredEvidence: [
        { code: "4548-4", system: LOINC_SYSTEM, label: "최근 180일 이내 당화혈색소 기록", eventTypes: ["observation"], lookbackDays: 180, severity: "required" },
      ],
      contraindications: [{ code: "N18", label: "만성 콩팥병" }],
      duplicateClass: "SGLT2",
      duplicateClassLabel: "SGLT-2 inhibitor",
      maxDurationDays: 90,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "atorvastatin-20",
    code: "PC-RX-ATOR20",
    label: "아토르바스타틴칼슘정 20mg",
    ingredient: "Atorvastatin calcium",
    classLabel: "HMG-CoA reductase inhibitor (statin)",
    keywords: "atorvastatin 리피토 고지혈증 이상지질혈증 콜레스테롤 스타틴",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 28, quantity: 28, instructions: "저녁 복용" },
    coverage: {
      indications: [{ code: "E78", label: "지질단백질대사장애·이상지질혈증" }],
      requiredEvidence: [{ code: "2089-1", system: LOINC_SYSTEM, label: "최근 365일 이내 LDL 콜레스테롤 기록", eventTypes: ["observation"], lookbackDays: 365, severity: "required" }],
      duplicateClass: "STATIN",
      duplicateClassLabel: "HMG-CoA reductase inhibitor (statin)",
      maxDurationDays: 90,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "tiotropium-inhaler",
    code: "PC-RX-TIO18",
    label: "티오트로피움브롬화물 흡입제 18mcg",
    ingredient: "Tiotropium bromide",
    classLabel: "Long-acting muscarinic antagonist (LAMA)",
    keywords: "tiotropium 스피리바 흡입제 COPD 만성폐쇄성폐질환 LAMA 기관지확장제",
    dosing: { dose: "1", doseUnit: "캡슐", route: "흡입", frequency: "1일 1회", durationDays: 30, quantity: 30, instructions: "흡입기 사용법 교육 후 사용" },
    coverage: {
      indications: [{ code: "J44", label: "기타 만성 폐쇄성 폐질환" }, { code: "J43", label: "폐기종" }],
      requiredEvidence: [{ code: "F6002", system: HIRA_FEE_SYSTEM, label: "기관지확장제 전후 폐활량검사(PFT) 시행 기록", eventTypes: ["procedure"], lookbackDays: 365, severity: "required" }],
      duplicateClass: "LAMA",
      duplicateClassLabel: "Long-acting muscarinic antagonist (LAMA)",
      maxDurationDays: 90,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "salmeterol-fluticasone-inhaler",
    code: "PC-RX-SALFLU",
    label: "살메테롤/플루티카손 흡입제 50/250mcg",
    ingredient: "Salmeterol xinafoate · Fluticasone propionate",
    classLabel: "LABA/ICS combination inhaler",
    keywords: "salmeterol fluticasone 세레타이드 흡입제 COPD 천식 LABA ICS",
    dosing: { dose: "1", doseUnit: "흡입", route: "흡입", frequency: "1일 2회", durationDays: 30, quantity: 1, instructions: "사용 후 입안 헹굼" },
    coverage: {
      indications: [{ code: "J44", label: "기타 만성 폐쇄성 폐질환" }, { code: "J45", label: "천식" }],
      requiredEvidence: [{ code: "F6002", system: HIRA_FEE_SYSTEM, label: "기관지확장제 전후 폐활량검사(PFT) 시행 기록", eventTypes: ["procedure"], lookbackDays: 365, severity: "required" }],
      duplicateClass: "LABA/ICS",
      duplicateClassLabel: "LABA/ICS combination inhaler",
      maxDurationDays: 90,
      ageMinimum: 12,
    },
  }),
  medication({
    id: "amoxicillin-clavulanate-625",
    code: "PC-RX-AMOCLA625",
    label: "아목시실린·클라불란산정 625mg",
    ingredient: "Amoxicillin hydrate · Clavulanate potassium",
    classLabel: "Penicillin-class antibiotic",
    keywords: "amoxicillin clavulanate 오구멘틴 항생제 폐렴 기관지염 페니실린",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 3회", durationDays: 7, quantity: 21, instructions: "식후 복용, 임의 중단 없이 지시된 기간 유지" },
    coverage: {
      indications: [{ code: "J18", label: "상세불명 병원체의 폐렴" }, { code: "J20", label: "급성 기관지염" }, { code: "J01", label: "급성 부비동염" }],
      requiredEvidence: [],
      allergyIngredients: ["페니실린", "아목시실린", "클라불란산", "penicillin", "amoxicillin"],
      duplicateClass: "PENICILLIN",
      duplicateClassLabel: "Penicillin-class antibiotic",
      maxDurationDays: 14,
      ageMinimum: 0,
    },
  }),
  medication({
    id: "levofloxacin-500",
    code: "PC-RX-LEVO500",
    label: "레보플록사신정 500mg",
    ingredient: "Levofloxacin hydrate",
    classLabel: "Fluoroquinolone antibiotic",
    keywords: "levofloxacin 크라비트 항생제 폐렴 퀴놀론",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 7, quantity: 7, instructions: "충분한 물과 함께 복용" },
    coverage: {
      indications: [{ code: "J18", label: "상세불명 병원체의 폐렴" }, { code: "J15", label: "달리 분류되지 않은 세균성 폐렴" }],
      requiredEvidence: [],
      allergyIngredients: ["퀴놀론", "레보플록사신", "levofloxacin", "quinolone"],
      duplicateClass: "QUINOLONE",
      duplicateClassLabel: "Fluoroquinolone antibiotic",
      maxDurationDays: 14,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "pantoprazole-40",
    code: "PC-RX-PANTO40",
    label: "판토프라졸나트륨정 40mg",
    ingredient: "Pantoprazole sodium sesquihydrate",
    classLabel: "Proton pump inhibitor (PPI)",
    keywords: "pantoprazole 판토록 위산 역류 위식도역류 PPI 위산억제제",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 28, quantity: 28, instructions: "아침 식전 복용" },
    coverage: {
      indications: [{ code: "K21", label: "위식도역류병" }, { code: "K25", label: "위궤양" }, { code: "K27", label: "상세불명 부위의 소화성궤양" }],
      requiredEvidence: [],
      duplicateClass: "PPI",
      duplicateClassLabel: "Proton pump inhibitor (PPI)",
      maxDurationDays: 56,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "alendronate-70",
    code: "PC-RX-ALEN70",
    label: "알렌드론산정 70mg",
    ingredient: "Alendronate sodium hydrate",
    classLabel: "Bisphosphonate",
    keywords: "alendronate 포사맥스 골다공증 골밀도 비스포스포네이트",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "주 1회", durationDays: 84, quantity: 12, instructions: "기상 직후 충분한 물과 복용 후 30분간 눕지 않기" },
    coverage: {
      indications: [{ code: "M81", label: "병적 골절이 없는 골다공증" }, { code: "M80", label: "병적 골절을 동반한 골다공증" }],
      requiredEvidence: [{ code: "DEMO-BMD", system: "urn:policycompass:demo:service", label: "최근 365일 이내 골밀도검사 시행 기록", eventTypes: ["procedure"], lookbackDays: 365, severity: "required" }],
      duplicateClass: "BISPHOSPHONATE",
      duplicateClassLabel: "Bisphosphonate",
      maxDurationDays: 168,
      ageMinimum: 18,
    },
  }),
  medication({
    id: "acetaminophen-650",
    code: "PC-RX-ACET650",
    label: "아세트아미노펜서방정 650mg",
    ingredient: "Acetaminophen (paracetamol)",
    classLabel: "Analgesic · antipyretic",
    keywords: "acetaminophen 타이레놀 진통제 해열제 두통 통증",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 3회", durationDays: 5, quantity: 15, instructions: "통증 시 복용" },
    coverage: {
      indications: [{ code: "M17", label: "무릎 관절증" }, { code: "G43", label: "편두통" }, { code: "R52", label: "통증" }],
      requiredEvidence: [],
      allergyIngredients: ["아세트아미노펜", "acetaminophen"],
      duplicateClass: "ANALGESIC",
      duplicateClassLabel: "Analgesic · antipyretic",
      maxDurationDays: 30,
      ageMinimum: 12,
    },
  }),
  medication({
    id: "ibuprofen-400",
    code: "PC-RX-IBU400",
    label: "이부프로펜정 400mg",
    ingredient: "Ibuprofen",
    classLabel: "NSAID",
    keywords: "ibuprofen 부루펜 소염진통제 NSAID 관절염 통증",
    dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 3회", durationDays: 7, quantity: 21, instructions: "식후 복용" },
    coverage: {
      indications: [{ code: "M17", label: "무릎 관절증" }, { code: "M15", label: "다발관절증" }, { code: "M54", label: "등통증" }],
      requiredEvidence: [],
      contraindications: [{ code: "K25", label: "위궤양" }, { code: "K27", label: "상세불명 부위의 소화성궤양" }, { code: "N18", label: "만성 콩팥병" }],
      allergyIngredients: ["이부프로펜", "NSAID", "ibuprofen", "아스피린"],
      duplicateClass: "NSAID",
      duplicateClassLabel: "NSAID",
      maxDurationDays: 30,
      ageMinimum: 12,
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
