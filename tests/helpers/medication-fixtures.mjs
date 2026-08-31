/**
 * Rule-engine branch fixtures mirroring retired demo-catalogue entries. The
 * live catalogue only lists benralizumab·durvalumab, but the check logic
 * (indication, evidence, allergy, duplicate, duration, age) keeps its coverage
 * through these.
 */
const FIXTURE_SOURCE = Object.freeze({ label: "내부 검토용 예시 기준", documentNumber: "TEST-RX-1", version: "1", effectiveFrom: "2026-01-01", url: "" });

export function fixtureMedication(entry) {
  return {
    ...entry,
    system: "urn:kr:edi",
    coverage: {
      indications: (entry.coverage.indications ?? []).map((item) => ({ system: "urn:kr:kcd", ...item })),
      requiredEvidence: entry.coverage.requiredEvidence ?? [],
      contraindications: (entry.coverage.contraindications ?? []).map((item) => ({ system: "urn:kr:kcd", ...item })),
      allergyIngredients: entry.coverage.allergyIngredients ?? [],
      duplicateClass: entry.coverage.duplicateClass ?? "",
      duplicateClassLabel: entry.coverage.duplicateClassLabel ?? "",
      maxDurationDays: entry.coverage.maxDurationDays ?? 0,
      ageMinimum: entry.coverage.ageMinimum ?? 0,
      ageMaximum: entry.coverage.ageMaximum ?? 0,
      source: FIXTURE_SOURCE,
    },
  };
}

export const AMLODIPINE = fixtureMedication({
  id: "amlodipine-5", code: "TEST-RX-AMLO5", label: "암로디핀정 5mg", ingredient: "Amlodipine besylate", classLabel: "Calcium channel blocker (CCB)",
  dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 28, quantity: 28, instructions: "" },
  coverage: {
    indications: [{ code: "I10", label: "본태성 고혈압" }, { code: "I11", label: "고혈압성 심장질환" }],
    requiredEvidence: [{ code: "85354-9", system: "http://loinc.org", label: "최근 180일 이내 혈압 측정 기록", eventTypes: ["observation"], lookbackDays: 180, severity: "required" }],
    duplicateClass: "CCB", duplicateClassLabel: "Calcium channel blocker (CCB)", maxDurationDays: 90, ageMinimum: 18,
  },
});

export const AMOXICLAV = fixtureMedication({
  id: "amoxicillin-clavulanate-625", code: "TEST-RX-AMOCLA625", label: "아목시실린·클라불란산정 625mg", ingredient: "Amoxicillin hydrate · Clavulanate potassium", classLabel: "Penicillin-class antibiotic",
  dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 3회", durationDays: 7, quantity: 21, instructions: "" },
  coverage: {
    indications: [{ code: "J18", label: "상세불명 병원체의 폐렴" }, { code: "J20", label: "급성 기관지염" }],
    allergyIngredients: ["페니실린", "아목시실린", "클라불란산", "penicillin", "amoxicillin"],
    duplicateClass: "PENICILLIN", duplicateClassLabel: "Penicillin-class antibiotic", maxDurationDays: 14,
  },
});

export const TIOTROPIUM = fixtureMedication({
  id: "tiotropium-inhaler", code: "TEST-RX-TIO18", label: "티오트로피움브롬화물 흡입제 18mcg", ingredient: "Tiotropium bromide", classLabel: "Long-acting muscarinic antagonist (LAMA)",
  dosing: { dose: "1", doseUnit: "캡슐", route: "흡입", frequency: "1일 1회", durationDays: 30, quantity: 30, instructions: "" },
  coverage: {
    indications: [{ code: "J44", label: "기타 만성 폐쇄성 폐질환" }, { code: "J43", label: "폐기종" }],
    requiredEvidence: [{ code: "F6002", system: "urn:hira:fee-code", label: "기관지확장제 전후 폐활량검사(PFT) 시행 기록", eventTypes: ["procedure"], lookbackDays: 365, severity: "required" }],
    duplicateClass: "LAMA", duplicateClassLabel: "Long-acting muscarinic antagonist (LAMA)", maxDurationDays: 90, ageMinimum: 18,
  },
});

export const PANTOPRAZOLE = fixtureMedication({
  id: "pantoprazole-40", code: "TEST-RX-PANTO40", label: "판토프라졸나트륨정 40mg", ingredient: "Pantoprazole sodium sesquihydrate", classLabel: "Proton pump inhibitor (PPI)",
  dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 28, quantity: 28, instructions: "" },
  coverage: {
    indications: [{ code: "K21", label: "위식도역류병" }, { code: "K25", label: "위궤양" }],
    duplicateClass: "PPI", duplicateClassLabel: "Proton pump inhibitor (PPI)", maxDurationDays: 56, ageMinimum: 18,
  },
});

export const METFORMIN = fixtureMedication({
  id: "metformin-500", code: "TEST-RX-METF500", label: "메트포르민염산염서방정 500mg", ingredient: "Metformin hydrochloride", classLabel: "Biguanide",
  dosing: { dose: "1", doseUnit: "정", route: "경구", frequency: "1일 2회", durationDays: 28, quantity: 56, instructions: "식사 직후 복용" },
  coverage: {
    indications: [{ code: "E11", label: "제2형 당뇨병" }],
    requiredEvidence: [{ code: "4548-4", system: "http://loinc.org", label: "최근 180일 이내 당화혈색소 기록", eventTypes: ["observation"], lookbackDays: 180, severity: "required" }],
    contraindications: [{ code: "N18", label: "만성 콩팥병" }],
    duplicateClass: "BIGUANIDE", duplicateClassLabel: "Biguanide", maxDurationDays: 90, ageMinimum: 18,
  },
});

export function markdownReviewReport() {
  return [
    "## [✕] 벤라리주맙 프리필드시린지 30mg — 급여기준 미충족",
    "",
    "**사유:** 중증 호산구성 천식 진단과 치료 시작 전 12개월 이내 혈중 호산구 수치 기록이 없습니다.",
    "",
    "| 급여기준 | 판정 | 근거 |",
    "| ---- | :---: | ---- |",
    "| 성인 중증 호산구성 천식 | ✕ | 정보 없음 |",
    "",
    "**최종 판단:** 투여대상 조건을 확인할 수 없어 급여기준 미충족입니다.",
  ].join("\n");
}
