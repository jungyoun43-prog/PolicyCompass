import {
  evaluateGoldCopdConcordance,
  evaluateHiraCopd2026Contribution,
} from "./copd-assessment.js";
import { getCopdDemoProfile } from "./copd-demo-data.js";
import {
  evaluateHiraPneumonia2026Contribution,
  evaluatePneumoniaConcordance,
} from "./pneumonia-assessment.js";
import { getPneumoniaDemoProfile } from "./pneumonia-demo-data.js";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const COPD_PROGRAM = deepFreeze({
  id: "copd",
  order: 10,
  label: "만성폐쇄성폐질환",
  shortLabel: "COPD",
  eyebrow: "COPD 2026 · REVIEW",
  description: "현재 차트와 별도인 고정 합성 COPD 예시로, 환자별 기여 후보와 진단 근거 정합성 표시 방식을 분리해 확인합니다.",
  quality: {
    eyebrow: "HIRA COPD 2026 · CONTRIBUTION PREVIEW",
    title: "COPD 환자별 기여 예상",
    description: "고정 합성 예시의 폐기능검사·지속방문·흡입기관지확장제 기록 표시를 확인합니다.",
    emptyMessage: "연결된 COPD 적정성 평가 프로필이 없습니다.",
  },
  diagnostic: {
    eyebrow: "GOLD 2026 · CONCORDANCE",
    title: "COPD 진단 근거 정합성",
    description: "임상 맥락과 기관지확장제 투여 후 폐활량측정 근거를 함께 확인합니다.",
    emptyMessage: "연결된 COPD 진단 근거 프로필이 없습니다.",
  },
  boundary: "현재 차트 근거와 연결되지 않은 고정 합성 예시입니다. 공식 평가대상·기관 점수·진단·처방 판정이 아닙니다.",
  emptyMessage: "이 환자에게 연결된 COPD 평가 프로필이 없습니다.",
});

const PNEUMONIA_PROGRAM = deepFreeze({
  id: "pneumonia",
  order: 20,
  label: "폐렴",
  shortLabel: "CAP",
  eyebrow: "PNEUMONIA 2026 · REVIEW",
  description: "현재 차트와 별도인 고정 합성 폐렴 예시로, 환자별 기여 후보와 진단 근거 정합성 표시 방식을 분리해 확인합니다.",
  quality: {
    eyebrow: "HIRA PNEUMONIA 2026 · CONTRIBUTION PREVIEW",
    title: "폐렴 환자별 기여 예상",
    description: "고정 합성 예시의 입원·산소포화도·중증도·배양검사·초기 항생제 기록 표시를 확인합니다.",
    emptyMessage: "연결된 폐렴 적정성 평가 프로필이 없습니다.",
  },
  diagnostic: {
    eyebrow: "PNEUMONIA · CLINICAL CONCORDANCE",
    title: "폐렴 진단 근거 정합성",
    description: "영상 소견·감염 근거·지역사회 발생 맥락과 의료진 진단 기록을 함께 확인합니다.",
    emptyMessage: "연결된 폐렴 진단 근거 프로필이 없습니다.",
  },
  boundary: "현재 차트 근거와 연결되지 않은 고정 합성 예시입니다. 공식 평가대상·기관 점수·진단·항생제 선택 판정이 아닙니다.",
  emptyMessage: "이 환자에게 연결된 폐렴 평가 프로필이 없습니다.",
});

export const DISEASE_ASSESSMENT_PROGRAMS = deepFreeze({
  copd: COPD_PROGRAM,
  pneumonia: PNEUMONIA_PROGRAM,
});

const PROGRAM_IMPLEMENTATIONS = Object.freeze({
  copd: Object.freeze({
    profile: getCopdDemoProfile,
    quality: evaluateHiraCopd2026Contribution,
    diagnostic: evaluateGoldCopdConcordance,
  }),
  pneumonia: Object.freeze({
    profile: getPneumoniaDemoProfile,
    quality: evaluateHiraPneumonia2026Contribution,
    diagnostic: evaluatePneumoniaConcordance,
  }),
});

const PROGRAM_IDS = Object.freeze(Object.values(DISEASE_ASSESSMENT_PROGRAMS)
  .sort((left, right) => left.order - right.order)
  .map(({ id }) => id));

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validInstant(value) {
  const text = cleanText(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

function preference(profile) {
  const selection = profile?.selection && typeof profile.selection === "object" ? profile.selection : {};
  const preferred = profile?.preferred === true
    || profile?.isPreferred === true
    || profile?.preferredAssessment === true
    || selection.preferred === true;
  const isDefault = profile?.default === true
    || profile?.isDefault === true
    || profile?.defaultAssessment === true
    || selection.default === true;
  return { preferred, default: isDefault, rank: preferred ? 0 : isDefault ? 1 : 2 };
}

function profileFor(programId, patient) {
  const implementation = PROGRAM_IMPLEMENTATIONS[programId];
  if (!implementation) return null;
  const profile = implementation.profile(patient);
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  return {
    ...clone(profile),
    assessmentId: programId,
    programId,
  };
}

function orderedProfiles(patient) {
  return PROGRAM_IDS
    .map((programId) => profileFor(programId, patient))
    .filter(Boolean)
    .sort((left, right) => {
      const rankDifference = preference(left).rank - preference(right).rank;
      if (rankDifference) return rankDifference;
      return DISEASE_ASSESSMENT_PROGRAMS[left.assessmentId].order
        - DISEASE_ASSESSMENT_PROGRAMS[right.assessmentId].order;
    });
}

export function getDiseaseAssessmentProfiles(patient) {
  return orderedProfiles(patient).map(clone);
}

export function getDiseaseAssessmentOptions(patient) {
  return orderedProfiles(patient).map((profile) => {
    const program = DISEASE_ASSESSMENT_PROGRAMS[profile.assessmentId];
    const selection = preference(profile);
    return clone({
      id: program.id,
      assessmentId: program.id,
      programId: program.id,
      label: program.label,
      shortLabel: program.shortLabel,
      eyebrow: program.eyebrow,
      description: program.description,
      preferred: selection.preferred,
      default: selection.default,
    });
  });
}

export function getPreferredDiseaseAssessmentId(patient) {
  return orderedProfiles(patient)[0]?.assessmentId ?? "";
}

export function evaluateDiseaseAssessment(patient, diseaseId) {
  const programId = cleanText(diseaseId).toLowerCase();
  const implementation = PROGRAM_IMPLEMENTATIONS[programId];
  if (!implementation) return null;
  const profile = profileFor(programId, patient);
  if (!profile) return null;
  const evaluatedAt = validInstant(profile.evaluatedAt) || new Date().toISOString();
  const quality = implementation.quality(profile, { evaluatedAt });
  const diagnostic = implementation.diagnostic(profile, { evaluatedAt });
  return {
    program: clone(DISEASE_ASSESSMENT_PROGRAMS[programId]),
    profile: clone(profile),
    quality: clone(quality),
    diagnostic: clone(diagnostic),
    evaluatedAt,
  };
}

function dedupeKey(value, kind, index, assessmentId = "") {
  const scope = cleanText(assessmentId) || "unscoped";
  const id = cleanText(value?.id);
  if (id) return `${scope}:id:${id}`;
  if (kind === "claim") {
    const composite = [value?.code, value?.serviceDate, value?.label].map(cleanText).join("|");
    return composite.replaceAll("|", "") ? `${scope}:claim:${composite}` : `${scope}:claim-index:${index}`;
  }
  const composite = [value?.claimItemId, value?.sourceId, value?.decidedAt, value?.reasonCode]
    .map(cleanText)
    .join("|");
  return composite.replaceAll("|", "") ? `${scope}:adjudication:${composite}` : `${scope}:adjudication-index:${index}`;
}

function mergeUnique(profiles, field, kind) {
  const merged = [];
  const seen = new Set();
  let index = 0;
  for (const profile of profiles) {
    const values = Array.isArray(profile[field]) ? profile[field] : [];
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const key = dedupeKey(value, kind, index, profile.assessmentId);
      index += 1;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...clone(value),
        assessmentId: profile.assessmentId,
      });
    }
  }
  return merged;
}

export function getCombinedDiseaseClaimProfile(patient) {
  const profiles = orderedProfiles(patient);
  if (!profiles.length) return null;
  const notices = [...new Set(profiles.map(({ syntheticNotice }) => cleanText(syntheticNotice)).filter(Boolean))];
  return {
    physicianOnly: profiles.every(({ physicianOnly }) => physicianOnly === true),
    synthetic: profiles.every(({ synthetic }) => synthetic === true),
    syntheticNotice: notices.join(" · "),
    assessmentIds: profiles.map(({ assessmentId }) => assessmentId),
    claimItems: mergeUnique(profiles, "claimItems", "claim"),
    adjudications: mergeUnique(profiles, "adjudications", "adjudication"),
  };
}
