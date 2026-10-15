import { medicationReviewNotice } from "./medication-review-prompt.js";

// Curated comparisons for the indications used by this demo, not a worldwide
// formulary. Keep payer, indication, and source version attached to each text.
const CHECKED_ON = "2026-10-16";
export const REGISTERED_COVERAGE_POLICY = "kr-registered";
export const COVERAGE_COUNTRIES = [
  { code: "KR", label: "한국" }, { code: "US", label: "미국" },
  { code: "GB", label: "영국" }, { code: "AU", label: "호주" },
];

const POLICIES = {
  "benralizumab-30": [
    {
      id: "us-aetna", countryCode: "US", payer: "Aetna", program: "상업보험 · CPB 0925",
      indication: "중증 호산구성 천식 · 추가 유지치료",
      sources: [{ title: "Aetna CPB 0925", url: "https://www.aetna.com/cpb/medical/data/900_999/0925.html" }],
    },
    {
      id: "us-oklahoma", countryCode: "US", payer: "Oklahoma SoonerCare", program: "주 Medicaid · 사전승인",
      indication: "중증 호산구성 천식 · 추가 유지치료",
      sources: [{ title: "SoonerCare 2026 Respiratory PA", url: "https://aem-prod.oklahoma.gov/ohca/providers/types/pharmacy/prior-authorization/2026/respiratory.html" }],
    },
    {
      id: "gb-nice", countryCode: "GB", payer: "NHS England · NICE", program: "TA565 · 성인 천식",
      indication: "중증 호산구성 천식 · 추가 유지치료", version: "2019-09-03 개정",
      sources: [
        { title: "NICE TA565 Recommendations", url: "https://www.nice.org.uk/guidance/ta565/chapter/1-Recommendations" },
        { title: "NICE TA565 Medicine information", url: "https://www.nice.org.uk/guidance/ta565/chapter/2-Information-about-benralizumab" },
      ],
    },
    {
      id: "au-pbs", countryCode: "AU", payer: "PBS · Services Australia", program: "PB075 / PB076 · 12세 이상", version: "2026-09 신청서",
      indication: "조절되지 않는 중증 천식 · 신규/재개 및 지속치료",
      sources: [
        { title: "PB075 초기·재개 신청서", url: "https://www.servicesaustralia.gov.au/sites/default/files/2026-08/pb075-2609en-f.pdf" },
        { title: "PB076 지속 신청서", url: "https://www.servicesaustralia.gov.au/sites/default/files/2026-08/pb076-2609en-f.pdf" },
      ],
    },
  ],
  "durvalumab-500": [
    {
      id: "us-aetna", countryCode: "US", payer: "Aetna", program: "상업보험 · CPB 0917",
      indication: "절제 불가능 II·III기 비소세포폐암 · 동시 CCRT 후 단독 공고요법",
      sources: [{ title: "Aetna CPB 0917 · NSCLC consolidation", url: "https://www.aetna.com/cpb/medical/data/900_999/0917.html" }],
    },
    {
      id: "gb-nice", countryCode: "GB", payer: "NHS England · NICE", program: "TA798 · 유지치료", version: "2022-06-22 발행",
      indication: "절제 불가능 국소 진행성 비소세포폐암 · 동시 CCRT 후 유지치료",
      sources: [
        { title: "NICE TA798 Recommendations", url: "https://www.nice.org.uk/guidance/ta798/chapter/1-Recommendations" },
        { title: "NICE TA798 Medicine information", url: "https://www.nice.org.uk/guidance/ta798/chapter/2-Information-about-durvalumab" },
      ],
    },
    {
      id: "au-pbs", countryCode: "AU", payer: "PBS · EFC", program: "C15500 / C12271 · 초기·지속치료", version: "2026-08-01 편찬본",
      indication: "절제 불가능 III기 비소세포폐암 · 초기·지속치료",
      sources: [{ title: "PBS EFC · Schedule 3 C15500 / C12271", url: "https://www.legislation.gov.au/F2024L00405/2026-08-01/2026-08-01/text/original/epub/OEBPS/document_1/document_1.html" }],
    },
  ],
};

export function medicationCoveragePolicies(medicationId) {
  if (!POLICIES[medicationId]) return [];
  return [
    { id: REGISTERED_COVERAGE_POLICY, countryCode: "KR", country: "한국", payer: "건강보험", program: "프로젝트 등록 기준", indication: medicationId === "benralizumab-30" ? "중증 호산구성 천식" : "비소세포폐암 · CCRT 후 공고요법", sources: [], criteria: [] },
    ...POLICIES[medicationId].map((policy) => ({ ...policy, checkedOn: CHECKED_ON, country: COVERAGE_COUNTRIES.find(({ code }) => code === policy.countryCode).label })),
  ];
}

export function medicationCoveragePolicy(medicationId, policyId = REGISTERED_COVERAGE_POLICY) {
  return medicationCoveragePolicies(medicationId).find(({ id }) => id === policyId) ?? null;
}

export function medicationCoveragePolicyNotice(medicationId, policyId = REGISTERED_COVERAGE_POLICY) {
  const policy = medicationCoveragePolicy(medicationId, policyId);
  if (!policy) throw new Error("이 약제에 등록되지 않은 보험 기준입니다.");
  if (policy.countryCode === "KR") return medicationReviewNotice(medicationId);
  // Foreign criteria come from the official-source endpoint. An empty loading
  // state is never substituted with a generated summary or interpretation.
  return "";
}

export function switchMedicationCoveragePolicy(preview, policyId) {
  if (!preview || preview.policyId === policyId) return preview;
  const defaultNotice = medicationCoveragePolicyNotice(preview.medicationId, policyId);
  const previousId = preview.policyId || REGISTERED_COVERAGE_POLICY;
  const noticeDrafts = { ...preview.noticeDrafts };
  // An untouched loading placeholder is not an operator draft. Preserve real
  // edits, including an intentional empty value after a failed source load.
  if (previousId === REGISTERED_COVERAGE_POLICY || preview.noticeSource || preview.noticeText.trim() || preview.noticeTouched?.[previousId]) {
    noticeDrafts[previousId] = preview.noticeText;
  }
  return { ...preview, policyId, noticeDrafts, noticeSource: preview.sourceDocuments?.[policyId] ?? null,
    noticeText: noticeDrafts[policyId] ?? preview.sourceDocuments?.[policyId]?.text ?? defaultNotice };
}

export function isForeignCoveragePolicy(preview) {
  const policy = medicationCoveragePolicy(preview?.medicationId, preview?.policyId);
  return Boolean(policy && policy.countryCode !== "KR");
}

export function applyMedicationPolicySource(preview, document) {
  if (!preview || document.medicationId !== preview.medicationId || document.policyId !== preview.policyId
    || typeof document.text !== "string" || !document.text.trim()) throw new Error("선택한 약제·보험 기준과 원문이 일치하지 않습니다.");
  return { ...preview, noticeSource: document,
    sourceDocuments: { ...preview.sourceDocuments, [preview.policyId]: document },
    noticeText: preview.noticeTouched?.[preview.policyId] || preview.noticeDrafts?.[preview.policyId] !== undefined || preview.noticeText.trim()
      ? preview.noticeText : document.text };
}
