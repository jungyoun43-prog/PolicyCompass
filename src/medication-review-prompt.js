import { findMedicationInCatalog } from "./medication-catalog.js";

/**
 * The exact prompt the medication claim review sends to a model, shared so the
 * server graph and the pre-send preview dialog can never drift apart. The
 * system prompt below is the operator-approved 급여기준 검토 지시문; the user
 * message carries the 고시정보(NOTICE) and 환자 의료데이터(PATIENT_DATA).
 */
export function medicationReviewInstructions() {
  return `당신은 건강보험 약제 급여기준 검토를 지원하는 시스템입니다.

입력된 **급여 고시정보**와 **환자 의료데이터**만을 이용하여 해당 약제의 급여기준 충족 여부를 판정하십시오.

### 판정 원칙

* 고시의 AND/OR 조건, 기간, 횟수, 용량 및 검사 기준을 그대로 적용합니다.
* 환자 의료데이터는 급여 판정에 관련된 자료가 모두 조회된 것으로 간주합니다.
* 데이터에 없는 사실은 추정하지 않고 **"정보 없음"**으로 표시합니다.
* 특정 질환이나 치료 목적이 명확하지 않은 기록을 임의로 해당 급여조건의 근거로 사용하지 않습니다.
* 직접 제공되지 않았더라도 주어진 검사값만으로 명확하게 계산 가능한 값은 계산할 수 있습니다.
* 조건을 충족하는 근거가 있으면 날짜와 핵심 원문을 제시합니다.
* 판정에 직접 관계없는 정보는 출력하지 않습니다.

### 판정

* ○ 충족
* △ 판정 제한: 관련 정보는 있으나 내용이 모호하여 충족 여부를 판단할 수 없음
* ✕ 미충족: 기준에 미달하거나 필요한 정보가 없음

### 출력 형식

## [○/△/✕] {약제명} — 급여기준 {충족/판정 제한/미충족}

**사유:** {최종 판정의 핵심 이유를 1~2문장으로 작성}

| 급여기준 |   판정  | 근거                 |
| ---- | :---: | ------------------ |
| {기준} | ○/△/✕ | {날짜, 값 또는 핵심 내용}   |
| {기준} | ○/△/✕ | {근거 원문 또는 "정보 없음"} |

**최종 판단:** {의료진이 바로 확인할 수 있도록 핵심 충족/미충족 사유를 간결하게 작성}`;
}

export function medicationReviewNotice(medicationId) {
  const entry = findMedicationInCatalog(medicationId);
  return entry?.notice || "등록된 급여 고시정보가 없습니다.";
}

export function medicationReviewModelPayload(comparison) {
  return {
    medication: comparison.medication,
    prescription: comparison.prescription,
    patient: comparison.patient,
    records: comparison.records ?? [],
    ruleFindings: comparison.checks.map(({ id, title, chart }) => ({ id, title, chart })),
  };
}

export function medicationReviewPatientDataText(comparison) {
  return JSON.stringify(medicationReviewModelPayload(comparison), null, 1);
}

export function medicationReviewUserMessage({ notice, patientData }) {
  return ["### 급여 고시정보", "", notice, "", "### 환자 의료데이터", "", patientData].join("\n");
}

/**
 * `overrides` carries operator-edited 고시정보/환자 의료데이터 from the pre-send
 * preview; absent fields fall back to the canonical catalogue/extract values.
 */
export function medicationReviewModelInput(comparison, overrides = {}) {
  return medicationReviewUserMessage({
    notice: overrides.notice || medicationReviewNotice(comparison.medication?.id),
    patientData: overrides.patientData || medicationReviewPatientDataText(comparison),
  });
}
