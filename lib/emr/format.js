/**
 * Presentation vocabulary and formatters shared by the clinical workspace.
 * Ported verbatim from the pre-React controller so wording stays identical.
 */
import { KOREA_TIMEZONE_OFFSET_MINUTES, localCalendarDate } from "../../src/emr-model.js";

export const EVENT_LABELS = {
  encounter: "내원",
  condition: "진단·문제",
  observation: "검사·측정",
  medication: "약물",
  allergy: "알레르기",
  procedure: "수술·처치",
  "service-request": "오더",
  symptom: "증상",
  note: "진료 메모",
};

export const SEX_LABELS = { unknown: "성별 미상", female: "여성", male: "남성", other: "기타" };

export const INSURANCE_LABELS = {
  "national-health": "건강보험",
  "medical-aid": "의료급여",
  industrial: "산재보험",
  auto: "자동차보험",
  "self-pay": "일반·비급여",
  other: "기타",
  unknown: "보험 미상",
};

export const QUEUE_LABELS = {
  none: "미접수",
  waiting: "대기",
  "in-progress": "진료 중",
  completed: "서명 대기",
  signed: "완료·서명",
  legacy: "완료·이관",
  external: "외부 완료·미검증",
};

export const today = () => localCalendarDate(new Date(), KOREA_TIMEZONE_OFFSET_MINUTES);

const dateFormatter = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const timestampFormatter = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function displayDate(value) {
  if (!value) return "날짜 미상";
  const parsed = new Date(value.length === 10 ? value + "T00:00:00.000Z" : value);
  return Number.isNaN(parsed.valueOf()) ? value : dateFormatter.format(parsed);
}

export function displayTimestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "기록 없음" : timestampFormatter.format(parsed);
}

export function ageFromBirthDate(value) {
  if (!value) return "";
  const [birthYear, birthMonth, birthDay] = value.split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = today().split("-").map(Number);
  let age = currentYear - birthYear;
  if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) age -= 1;
  return age >= 0 ? "만 " + age + "세" : "";
}

export function patientAgeLabel(patient) {
  return ageFromBirthDate(patient?.birthDate)
    || (Number.isInteger(patient?.ageYears) ? `만 ${patient.ageYears}세 · 직접 입력` : "나이 미상");
}

export function isInternalExampleCoding(event = {}) {
  return String(event.code ?? "").toUpperCase().startsWith("DEMO-")
    || String(event.system ?? "").toLowerCase().includes("policycompass:demo");
}

export function displayCoding(event = {}) {
  return isInternalExampleCoding(event) ? "" : [event.system, event.code].filter(Boolean).join(" | ");
}

export function prescriptionSummary(prescription = {}) {
  return [
    prescription.dose ? `1회 ${prescription.dose}${prescription.doseUnit || ""}` : "",
    prescription.route,
    prescription.frequency,
    prescription.durationDays ? `${prescription.durationDays}일` : "",
    prescription.quantity ? `총 ${prescription.quantity}` : "",
    prescription.instructions,
  ].filter(Boolean).join(" · ");
}
