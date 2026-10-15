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
      criteria: [
        "알레르기·면역 또는 호흡기 전문의 처방/협진, 만 6세 이상. 최근 12개월 내 천식 생물학적 제제 사용 환자는 ICS와 추가 조절제 유지 경로를 별도로 확인한다.",
        "일반 신규 경로: 기저 호산구 ≥150 cells/μL 또는 경구 스테로이드 의존성, 그리고 최근 12개월 내 스테로이드 필요 악화 ≥2회, 입원/응급실 악화 ≥1회, 증상 조절 불량 중 하나 이상.",
        "최적화된 고용량 ICS와 추가 조절제에 순응했어도 조절 불충분해야 하며, 해당 유지치료를 계속한다.",
        "지속: 증상/악화 개선 또는 유지 경구 스테로이드 감량·중단과 ICS/조절제 유지. 같은 적응증의 다른 생물학적 제제/표적 합성약과 병용하지 않는다. 사전승인 및 투여장소 조건을 확인한다.",
      ],
    },
    {
      id: "us-oklahoma", countryCode: "US", payer: "Oklahoma SoonerCare", program: "주 Medicaid · 사전승인",
      indication: "중증 호산구성 천식 · 추가 유지치료",
      sources: [{ title: "SoonerCare 2026 Respiratory PA", url: "https://aem-prod.oklahoma.gov/ohca/providers/types/pharmacy/prior-authorization/2026/respiratory.html" }],
      criteria: [
        "만 6세 이상, 중증 호산구성 천식. 기저 호산구 ≥150 cells/μL 필수이며, 경구 스테로이드 전 과거 검사값도 인정한다.",
        "고용량 ICS와 추가 조절제에 순응했어도 최근 12개월 내 전신 스테로이드 필요 악화 ≥2회 또는 매일 전신 스테로이드가 필요해야 한다.",
        "충분한 중·고용량 ICS 치료 실패, 그리고 고용량 ICS에 추가한 다른 조절제 최소 3개월 치료 실패를 확인한다. 전문의 처방/최근 12개월 내 평가, 아나필락시스 대응 및 자가주사 교육 요건도 확인한다.",
        "초기 승인 6개월, 반응과 치료 순응도 확인 후 지속 승인 1년. 체중 기반 용량이면 최근 3주 이내 체중, 수량 제한 등 원문의 세부 신청 요건을 확인한다.",
      ],
    },
    {
      id: "gb-nice", countryCode: "GB", payer: "NHS England · NICE", program: "TA565 · 성인 천식",
      indication: "중증 호산구성 천식 · 추가 유지치료", version: "2019-09-03 개정",
      sources: [{ title: "NICE TA565 Recommendations", url: "https://www.nice.org.uk/guidance/ta565/chapter/1-Recommendations" }],
      criteria: [
        "성인으로, 최적화된 표준 치료에 동의하고 순응했으며 고용량 ICS와 LABA 유지치료에도 조절되지 않는 중증 호산구성 천식.",
        "(호산구 ≥300 cells/μL 그리고 [최근 12개월 전신 스테로이드 필요 악화 ≥4회 또는 최근 6개월 prednisolone 환산 ≥5 mg/일 지속 경구 투여]) 또는 (호산구 ≥400 cells/μL 그리고 최근 12개월 악화 ≥3회).",
        "상업적 공급 약정 적용. benralizumab·mepolizumab·reslizumab이 동일하게 적합하면 약제와 투여 비용을 고려해 가장 저렴한 치료를 선택한다.",
        "12개월에 반응 평가 후 매년 재평가. 전신 스테로이드 필요 중증 악화의 임상적으로 의미 있는 감소 또는 천식 조절을 유지/개선하면서 경구 스테로이드 사용의 임상적으로 의미 있는 감소가 있어야 지속한다.",
      ],
    },
    {
      id: "au-pbs", countryCode: "AU", payer: "PBS · Services Australia", program: "PB075 / PB076 · 12세 이상", version: "2026-09 신청서",
      indication: "조절되지 않는 중증 천식 · 신규/재개 및 지속치료",
      sources: [
        { title: "PB075 초기·재개 신청서", url: "https://www.servicesaustralia.gov.au/sites/default/files/2026-08/pb075-2609en-f.pdf" },
        { title: "PB076 지속 신청서", url: "https://www.servicesaustralia.gov.au/sites/default/files/2026-08/pb076-2609en-f.pdf" },
      ],
      criteria: [
        "만 12세 이상, 천식 ≥1년. 지정 전문의 진료와 동일 의사 ≥6개월 관리 또는 다학제 중증 천식팀 진단. 신규 또는 마지막 PBS 천식 생물학적 치료 후 ≥12개월 중단 경로이며, 다른 생물학적 제제와의 병용·4주 간격 제한을 확인한다.",
        "고용량 ICS와 LABA ≥12개월 최적화/순응 치료에도 최근 12개월 입원 악화 ≥1회 또는 전신 스테로이드 필요 악화 ≥1회. 금기·불내성 경로는 별도 문서화한다. 진단 확인 검사 및 흡입기 사용법 평가도 필요하다.",
        "1개월 이내 기저 ACQ-5 ≥2.0. 최근 12개월 호산구 ≥300 cells/μL 또는 경구 스테로이드 치료 중 ≥150 cells/μL.",
        "지속: 마지막 투여 후 4주 이내 평가에서 ACQ-5 ≥0.5 감소 또는 유지 경구 스테로이드 ≥25% 감량과 ACQ-5 악화 ≤0.5. 같은 약의 최근 PBS 치료 및 반응 유지 필요. 초기 최대 32주, 지속 신청당 최대 24주; 병원·첨부서류 요건은 신청서 확인.",
      ],
    },
  ],
  "durvalumab-500": [
    {
      id: "us-aetna", countryCode: "US", payer: "Aetna", program: "상업보험 · CPB 0917",
      indication: "절제 불가능 II·III기 비소세포폐암 · 동시 CCRT 후 단독 공고요법",
      sources: [{ title: "Aetna CPB 0917 · NSCLC consolidation", url: "https://www.aetna.com/cpb/medical/data/900_999/0917.html" }],
      criteria: [
        "절제 불가능 II기 또는 III기 비소세포폐암에서 백금 기반 동시 항암화학방사선요법 후 진행이 없고 durvalumab을 단독 공고요법으로 사용한다.",
        "EGFR exon 19 결손 및 exon 21 L858R 변이가 없어야 한다. 단, 조직 부족으로 검사가 불가능한 경우는 예외 경로를 확인한다.",
        "PD-1/PD-L1 억제제 치료 중 질병이 진행한 경우는 제외한다. 이 공고요법 경로에는 PD-L1 ≥1% 조건이 열거되어 있지 않다.",
        "사전승인 및 투여장소 조건을 확인한다. 전이성·수술 전후 병용요법 등 다른 적응증의 승인 조건을 이 경로와 섞지 않는다.",
      ],
    },
    {
      id: "gb-nice", countryCode: "GB", payer: "NHS England · NICE", program: "TA798 · 유지치료", version: "2022-06-22 발행",
      indication: "절제 불가능 국소 진행성 비소세포폐암 · 동시 CCRT 후 유지치료",
      sources: [{ title: "NICE TA798 Recommendations", url: "https://www.nice.org.uk/guidance/ta798/chapter/1-Recommendations" }],
      criteria: [
        "성인, 절제 불가능 국소 진행성 비소세포폐암이며 종양세포의 PD-L1 발현율 ≥1%.",
        "백금 기반 동시 항암화학방사선요법을 받았고, 치료 후 질병 진행이 없어야 한다. 순차적 항암·방사선 치료는 이 권고 대상과 구분한다.",
        "제약사의 상업적 공급 약정에 따라 제공하는 경우에 권고한다. 이 요약은 TA798 권고 1.1의 해당 적응증 범위이다.",
      ],
    },
    {
      id: "au-pbs", countryCode: "AU", payer: "PBS · EFC", program: "C15500 · 초기치료", version: "2026-08-01 편찬본",
      indication: "절제 불가능 III기 비소세포폐암 · 초기치료",
      sources: [{ title: "PBS EFC · Schedule 3 C15500", url: "https://www.legislation.gov.au/F2024L00405/2026-08-01/2026-08-01/text/original/pdf" }],
      criteria: [
        "절제 불가능 III기 비소세포폐암으로 백금 기반 항암화학방사선요법을 받았고, 이후 질병 진행이 없어야 한다.",
        "WHO 수행상태 0 또는 1, durvalumab 시작 시 면역치료를 받은 적이 없어야 한다.",
        "이 질환에서 유일한 PBS 지원 전신 항암치료로 사용한다. Authority Required (STREAMLINED), 코드 15500.",
        "이 사례는 C15500 초기치료 제한의 요약이다. 지속치료·용량·전체 기간은 별도 PBS 제한을 확인해야 하며, 이 항목에 PD-L1 수치 조건은 열거되어 있지 않다.",
      ],
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
  return [
    `${policy.country} / ${policy.payer} / ${policy.program}`,
    `약제: ${medicationId} · 적응증: ${policy.indication}`,
    `자료 확인일: ${policy.checkedOn}${policy.version ? ` · 문서: ${policy.version}` : ""}`,
    "공식 자료의 한국어 요약이며 전체 보험약관이 아닙니다. 이 보험자·제도·적응증 범위의 비교용 기준입니다. 다른 나라나 보험자의 조건을 추가하지 않습니다. 생략된 세부요건은 원문 확인이 필요합니다.",
    ...policy.criteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    "출처:", ...policy.sources.map(({ title, url }) => `${title}: ${url}`),
  ].join("\n\n");
}

export function switchMedicationCoveragePolicy(preview, policyId) {
  if (!preview || preview.policyId === policyId) return preview;
  const defaultNotice = medicationCoveragePolicyNotice(preview.medicationId, policyId);
  const noticeDrafts = { ...preview.noticeDrafts, [preview.policyId || REGISTERED_COVERAGE_POLICY]: preview.noticeText };
  return { ...preview, policyId, noticeDrafts, noticeText: noticeDrafts[policyId] ?? defaultNotice };
}

export function isForeignCoveragePolicy(preview) {
  const policy = medicationCoveragePolicy(preview?.medicationId, preview?.policyId);
  return Boolean(policy && policy.countryCode !== "KR");
}
