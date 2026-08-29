import { normalizeClaimSearchText } from "./claim-search.js";

export const KCD_SYSTEM = "urn:kr:kcd";
export const ICD10_SYSTEM = "http://hl7.org/fhir/sid/icd-10";

/**
 * A short reference subset for reviewing the diagnosis entry flow, not the
 * official KCD master file. Institutions load their own licensed code set.
 */
export const DIAGNOSIS_CATALOG_BOUNDARY = "내부 검토용 예시 상병 목록입니다. 공식 KCD 마스터 파일이 아니며 자동 코딩·진단 판단을 대신하지 않습니다. 최종 상병과 코드는 의료진이 확인해 선택하세요.";

export const DIAGNOSIS_CODE_SYSTEMS = Object.freeze([
  Object.freeze({ system: KCD_SYSTEM, label: "KCD-8 · 한국표준질병사인분류", preferred: true }),
  Object.freeze({ system: ICD10_SYSTEM, label: "ICD-10 · WHO 국제질병분류" }),
]);

export const DIAGNOSIS_ROLES = Object.freeze([
  Object.freeze({ value: "primary", label: "주상병", detail: "이번 진료의 주된 진료 사유" }),
  Object.freeze({ value: "secondary", label: "부상병", detail: "함께 관리한 동반 상병" }),
]);

export const DIAGNOSIS_CERTAINTIES = Object.freeze([
  Object.freeze({ value: "confirmed", label: "확정", detail: "근거로 확인된 상병" }),
  Object.freeze({ value: "provisional", label: "의증·잠정", detail: "확인 전 잠정 기록" }),
]);

function diagnosis(entry) {
  return Object.freeze({
    ...entry,
    codes: Object.freeze(entry.codes.map((code) => Object.freeze({ ...code }))),
  });
}

export const DIAGNOSIS_CATALOG = Object.freeze([
  diagnosis({
    id: "essential-hypertension",
    label: "본태성 고혈압",
    category: "순환기",
    keywords: "hypertension HTN 고혈압 본태성 원발성 혈압 I10",
    codes: [
      { code: "I10", label: "본태성(원발성) 고혈압", preferred: true },
    ],
  }),
  diagnosis({
    id: "hypertensive-heart-disease",
    label: "고혈압성 심장병",
    category: "순환기",
    keywords: "hypertensive heart disease 고혈압성 심장병 심부전 I11",
    codes: [
      { code: "I11.9", label: "(울혈성) 심부전이 없는 고혈압성 심장병", preferred: true },
      { code: "I11.0", label: "(울혈성) 심부전을 동반한 고혈압성 심장병" },
    ],
  }),
  diagnosis({
    id: "type-2-diabetes",
    label: "제2형 당뇨병",
    category: "내분비",
    keywords: "diabetes DM 당뇨 당뇨병 제2형 2형 혈당 E11",
    codes: [
      { code: "E11.9", label: "합병증을 동반하지 않은 2형 당뇨병", preferred: true },
      { code: "E11.2", label: "신장 합병증을 동반한 2형 당뇨병" },
      { code: "E11.3", label: "눈 합병증을 동반한 2형 당뇨병" },
      { code: "E11.6", label: "기타 명시된 합병증을 동반한 2형 당뇨병" },
    ],
  }),
  diagnosis({
    id: "dyslipidemia",
    label: "이상지질혈증",
    category: "내분비",
    keywords: "dyslipidemia hyperlipidemia 고지혈증 이상지질혈증 콜레스테롤 중성지방 E78",
    codes: [
      { code: "E78.5", label: "상세불명의 고지질혈증", preferred: true },
      { code: "E78.0", label: "순수 고콜레스테롤혈증" },
      { code: "E78.1", label: "순수 고글리세리드혈증" },
      { code: "E78.2", label: "혼합형 고지질혈증" },
    ],
  }),
  diagnosis({
    id: "hypothyroidism",
    label: "갑상선기능저하증",
    category: "내분비",
    keywords: "hypothyroidism 갑상선 기능저하 갑상샘 E03",
    codes: [
      { code: "E03.9", label: "상세불명의 갑상선기능저하증", preferred: true },
    ],
  }),
  diagnosis({
    id: "copd",
    label: "만성폐쇄성폐질환",
    category: "호흡기",
    keywords: "COPD chronic obstructive pulmonary disease 만성폐쇄성폐질환 만성기관지염 J44",
    codes: [
      { code: "J44.9", label: "상세불명의 만성 폐쇄성 폐질환", preferred: true },
      { code: "J44.0", label: "급성 하기도감염을 동반한 만성 폐쇄성 폐질환" },
      { code: "J44.1", label: "급성 악화를 동반한 만성 폐쇄성 폐질환" },
      { code: "J44.8", label: "기타 명시된 만성 폐쇄성 폐질환" },
    ],
  }),
  diagnosis({
    id: "emphysema",
    label: "폐기종",
    category: "호흡기",
    keywords: "emphysema 폐기종 J43",
    codes: [
      { code: "J43.9", label: "상세불명의 폐기종", preferred: true },
    ],
  }),
  diagnosis({
    id: "pneumonia-unspecified",
    label: "폐렴",
    category: "호흡기",
    keywords: "pneumonia 폐렴 상세불명 병원체 J18",
    codes: [
      { code: "J18.9", label: "상세불명 병원체의 폐렴", preferred: true },
      { code: "J18.0", label: "상세불명의 기관지폐렴" },
      { code: "J18.1", label: "상세불명의 대엽폐렴" },
    ],
  }),
  diagnosis({
    id: "bacterial-pneumonia",
    label: "세균성 폐렴",
    category: "호흡기",
    keywords: "bacterial pneumonia 세균성 폐렴 J15",
    codes: [
      { code: "J15.9", label: "상세불명의 세균성 폐렴", preferred: true },
    ],
  }),
  diagnosis({
    id: "acute-bronchitis",
    label: "급성 기관지염",
    category: "호흡기",
    keywords: "acute bronchitis 급성 기관지염 기침 J20",
    codes: [
      { code: "J20.9", label: "상세불명의 급성 기관지염", preferred: true },
    ],
  }),
  diagnosis({
    id: "acute-sinusitis",
    label: "급성 부비동염",
    category: "호흡기",
    keywords: "acute sinusitis 급성 부비동염 축농증 J01",
    codes: [
      { code: "J01.9", label: "상세불명의 급성 부비동염", preferred: true },
    ],
  }),
  diagnosis({
    id: "asthma",
    label: "천식",
    category: "호흡기",
    keywords: "asthma 천식 알레르기 J45",
    codes: [
      { code: "J45.9", label: "상세불명의 천식", preferred: true },
      { code: "J45.0", label: "주로 알레르기성 천식" },
    ],
  }),
  diagnosis({
    id: "acute-uri",
    label: "급성 상기도감염",
    category: "호흡기",
    keywords: "upper respiratory infection URI 감기 급성 상기도감염 J06",
    codes: [
      { code: "J06.9", label: "상세불명의 급성 상기도감염", preferred: true },
    ],
  }),
  diagnosis({
    id: "gerd",
    label: "위식도역류병",
    category: "소화기",
    keywords: "GERD reflux 위식도역류 역류성 식도염 속쓰림 K21",
    codes: [
      { code: "K21.9", label: "식도염을 동반하지 않은 위-식도역류병", preferred: true },
      { code: "K21.0", label: "식도염을 동반한 위-식도역류병" },
    ],
  }),
  diagnosis({
    id: "gastric-ulcer",
    label: "위궤양",
    category: "소화기",
    keywords: "gastric ulcer 위궤양 K25",
    codes: [
      { code: "K25.9", label: "위궤양, 급성 또는 만성 상세불명, 출혈이나 천공이 없음", preferred: true },
    ],
  }),
  diagnosis({
    id: "peptic-ulcer",
    label: "소화성궤양",
    category: "소화기",
    keywords: "peptic ulcer 소화성궤양 K27",
    codes: [
      { code: "K27.9", label: "상세불명 부위의 소화성궤양, 급성 또는 만성 상세불명, 출혈이나 천공이 없음", preferred: true },
    ],
  }),
  diagnosis({
    id: "knee-osteoarthritis",
    label: "무릎 관절증",
    category: "근골격",
    keywords: "knee osteoarthritis 무릎 관절염 관절증 퇴행성 M17",
    codes: [
      { code: "M17.9", label: "상세불명의 무릎관절증", preferred: true },
      { code: "M17.0", label: "양쪽 원발성 무릎관절증" },
      { code: "M17.1", label: "기타 원발성 무릎관절증" },
    ],
  }),
  diagnosis({
    id: "polyarthrosis",
    label: "다발관절증",
    category: "근골격",
    keywords: "polyarthrosis 다발관절증 관절염 M15",
    codes: [
      { code: "M15.9", label: "상세불명의 다발관절증", preferred: true },
    ],
  }),
  diagnosis({
    id: "back-pain",
    label: "등통증·요통",
    category: "근골격",
    keywords: "back pain 요통 등통증 허리 M54",
    codes: [
      { code: "M54.5", label: "요통", preferred: true },
      { code: "M54.2", label: "경부통" },
    ],
  }),
  diagnosis({
    id: "osteoporosis",
    label: "골다공증",
    category: "근골격",
    keywords: "osteoporosis 골다공증 골밀도 M81",
    codes: [
      { code: "M81.9", label: "상세불명의 골다공증", preferred: true },
    ],
  }),
  diagnosis({
    id: "osteoporosis-fracture",
    label: "병적 골절을 동반한 골다공증",
    category: "근골격",
    keywords: "osteoporosis fracture 골다공증 병적 골절 M80",
    codes: [
      { code: "M80.9", label: "상세불명의 골다공증, 병적 골절 동반", preferred: true },
    ],
  }),
  diagnosis({
    id: "migraine",
    label: "편두통",
    category: "신경",
    keywords: "migraine 편두통 두통 G43",
    codes: [
      { code: "G43.9", label: "상세불명의 편두통", preferred: true },
      { code: "G43.0", label: "조짐이 없는 편두통" },
      { code: "G43.1", label: "조짐이 있는 편두통" },
    ],
  }),
  diagnosis({
    id: "chronic-kidney-disease",
    label: "만성 신장질환",
    category: "신장",
    keywords: "chronic kidney disease CKD 만성 신장질환 콩팥 N18",
    codes: [
      { code: "N18.9", label: "상세불명의 만성 신장질환", preferred: true },
      { code: "N18.3", label: "만성 신장질환, 3기" },
    ],
  }),
  diagnosis({
    id: "urinary-tract-infection",
    label: "요로감염",
    category: "신장",
    keywords: "urinary tract infection UTI 요로감염 방광염 N39",
    codes: [
      { code: "N39.0", label: "부위가 명시되지 않은 요로감염", preferred: true },
    ],
  }),
  diagnosis({
    id: "anxiety-disorder",
    label: "불안장애",
    category: "정신건강",
    keywords: "anxiety 불안 불안장애 F41",
    codes: [
      { code: "F41.9", label: "상세불명의 불안장애", preferred: true },
    ],
  }),
  diagnosis({
    id: "depressive-episode",
    label: "우울에피소드",
    category: "정신건강",
    keywords: "depression 우울 우울증 우울에피소드 F32",
    codes: [
      { code: "F32.9", label: "상세불명의 우울에피소드", preferred: true },
    ],
  }),
  diagnosis({
    id: "unspecified-pain",
    label: "통증",
    category: "증상",
    keywords: "pain 통증 상세불명 R52",
    codes: [
      { code: "R52.9", label: "상세불명의 통증", preferred: true },
    ],
  }),
  diagnosis({
    id: "headache",
    label: "두통",
    category: "증상",
    keywords: "headache 두통 R51",
    codes: [
      { code: "R51", label: "두통", preferred: true },
    ],
  }),
]);

function catalogSearchText(entry) {
  return [
    entry.label,
    entry.category,
    entry.keywords,
    entry.codes.map(({ code, label }) => `${code} ${label}`).join(" "),
  ].join(" ");
}

const searchIndex = DIAGNOSIS_CATALOG.map((entry) => ({
  entry,
  text: normalizeClaimSearchText(catalogSearchText(entry)),
}));

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

/**
 * Substring-and-token search over the reference code subset. Ordering is stable
 * so the same query always lists the same diagnoses in the same place.
 */
export function searchDiagnosisCatalog(query, limit = 8) {
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

export function findDiagnosisInCatalog(id) {
  const key = typeof id === "string" ? id.trim() : "";
  return DIAGNOSIS_CATALOG.find((entry) => entry.id === key) ?? null;
}

export function preferredDiagnosisCode(entry) {
  if (!entry?.codes?.length) return null;
  return entry.codes.find(({ preferred }) => preferred) ?? entry.codes[0];
}
