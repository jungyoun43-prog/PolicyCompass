// Internal, versioned representations of the supplied notices. They supplement
// the full source text; neither labels nor this tree are official policy prose.
export const MEDICATION_CRITERIA_SCHEMA = "policycompass-medication-criteria";
const all = (...children) => ({ all: children });
const any = (...children) => ({ any: children });
const criterion = (id, label, sourceQuote, kind = "clinical") => ({ id, label, sourceQuote, kind });

const BENRA_HASH = "a3742bb626be570fa6e824d25fd2a0d7275e54ea351c81dd9239b65aa0f8addf";
const AETNA_HASH = "d98c65f1118a719d573fe78f8fc3deb16cf72f331df45dac0021f2184980f654";
const benraBase = [
  criterion("adult", "성인", "성인 중증 호산구성 천식", "adult"),
  criterion("severe_asthma", "중증 호산구성 천식", "성인 중증 호산구성 천식 환자"),
  criterion("inhaler_failure", "고용량 ICS-LABA와 LAMA에도 조절 불충분", "고용량의 흡입용 코르티코스테로이드-장기지속형 흡입용 베타2 작용제 (ICS-LABA)와 장기지속형 무스카린 길항제(LAMA)의 투여에도 불구하고 적절하게 조절이 되지 않는 경우"),
  criterion("eosinophils", "시작 전 12개월 혈중 호산구", "치료 시작 전 12개월 이내에 혈중 호산구 수치", "eosinophils"),
  criterion("exacerbations", "시작 전 12개월 전신 스테로이드가 필요한 천식 악화", "전신 코르티코스테로이드가 요구되는 천식 급성악화", "exacerbations"),
  criterion("oral_steroids", "시작 전 6개월 지속 경구 스테로이드 ≥5mg/day", "치료 시작 6개월 전부터 prednisolone 5mg/day 와 동등한 수준 이상의 경구용 코르티코스테로이드를 지속적으로 투여한 경우", "oral_steroids"),
  criterion("no_biologic_combination", "천식 생물학적 제제 병용 제외", "생물학적 제제(omalizumab, mepolizumab, benralizumab, reslizumab, dupilumab)간 병용투여는 급여 인정하지 아니함."),
  criterion("biologic_course", "첫 생물학적 제제 또는 교체 원약제", "교체투여", "biologic_course"),
  criterion("omalizumab_trial", "Omalizumab 3–6개월 이상 사용", "omalizumab 주사제를 3-6개월 이상 사용하였음에도", "omalizumab_trial"),
  criterion("omalizumab_insufficient", "Omalizumab 효과 불충분", "효과가 불충분하거나"),
  criterion("omalizumab_intolerance", "부작용으로 Omalizumab 지속 불가능", "부작용으로 투약을 지속할 수 없는 경우"),
  criterion("adherence_improvement", "복약순응도 개선 필요", "복약순응도 개선의 필요성이 있는 경우"),
  criterion("switch_letter", "교체 투여 소견서 첨부", "투여소견서 첨부 시 사례별로 급여 인정함."),
];
const benraInitial = all("adult", "severe_asthma", "inhaler_failure", "no_biologic_combination",
  any("no_switch", all("from_omalizumab", "switch_letter", "omalizumab_trial", any("omalizumab_insufficient", "omalizumab_intolerance", "adherence_improvement"))),
  any(all("eos_300", any("exacerbations_4", "oral_steroids")), all("eos_400", "exacerbations_3")));

const aetnaBase = [
  criterion("nsclc_stage", "절제 불가능 II·III기 NSCLC", "The member has unresectable stage II or III NSCLC"),
  criterion("no_ici_progression", "PD-1/PD-L1 치료 중 진행 제외", "Aetna considers members not eligible for Imfinzi when they have experienced disease progression while on PD-1 or PD-L1 inhibitor therapy."),
  criterion("precertification", "해당 계획의 사전승인", "Precertification of durvalumab (Imfinzi) is required of all Aetna participating providers and members in applicable plan designs."),
  criterion("site_of_care", "투여장소 요건 확인", "Site of Care Utilization Management Policy applies."),
];
const aetnaInitial = [
  ...aetnaBase,
  criterion("ccrt_no_progression", "백금 기반 동시 CCRT 후 진행 없음", "has not progressed following concurrent platinum-based chemotherapy and radiation therapy"),
  criterion("egfr_negative", "EGFR exon 19 결손·exon 21 L858R 음성", "The tumor is negative for EGFR exon 19 deletion and exon 21 L858R mutations"),
  criterion("insufficient_tissue", "조직 부족으로 검사 불가능한 예외", "unless testing is not feasible due to insufficient tissue"),
  criterion("single_agent", "Durvalumab 단독 투여 계획", "The requested medication will be used as a single agent", "single_agent"),
  criterion("dosing", "선택 경로의 용량·간격·총 투여기간", "Imfinzi 10 mg/kg every 2 weeks", "durvalumab_dosing"),
];

export function medicationCriteriaProfile(medicationId, policyId = "kr-registered", phase = "initial") {
  if (!["initial", "continuation"].includes(phase)) throw new TypeError("초기 또는 지속 투여 경로를 선택해 주세요.");
  if (medicationId === "benralizumab-30" && policyId === "kr-registered") {
    const continuation = phase === "continuation";
    return {
      id: `kr-benralizumab-2026-92-${phase}-v1`, medicationId, policyId, phase,
      sourceVersion: "고시 제2026-92호 (2026-05-01) · 프로젝트 등록 원문",
      sourceHash: BENRA_HASH,
      scope: continuation ? "중증 호산구성 천식 · 지속 투여 평가" : "중증 호산구성 천식 · 초기 투여 (교체 제한 포함)",
      logicSummary: continuation ? "공통 요건과 함께, 악화 빈도 50% 이상 감소 또는 지속 경구 스테로이드 대상자의 천식 조절 유지·개선 및 용량 50% 이상 감소를 확인합니다."
        : "공통 요건과 함께, [호산구 ≥300 AND (악화 ≥4회 OR 6개월 지속 경구 스테로이드)] 또는 [호산구 ≥400 AND 악화 ≥3회] 중 한 경로가 충족되어야 합니다.",
      criteria: continuation ? [
        criterion("initial_eligibility", "최초 투여 당시 투여대상 충족", "동 약제 투여 전과 투여 후 매 1년마다 평가"),
        criterion("annual_assessment", "투여 전·매년 평가", "동 약제 투여 전과 투여 후 매 1년마다 평가"),
        criterion("continuation_letter", "지속 투여 소견서 제출", "투여 소견서 제출 시 지속 투여를 인정함."),
        criterion("asthma_control", "전반적인 천식조절 확인", "전반적인 천식조절을 확인한 환자"),
        criterion("exacerbation_reduction", "천식 악화 빈도 ≥50% 감소", "천식 급성악화의 빈도가 치료 시작 전 대비 50% 이상 감소", "reduction"),
        criterion("chronic_ocs_population", "지속 경구 스테로이드 치료가 필요한 환자", "지속적인 경구용 코르티코스테로이드 치료가 필요한 환자의 경우"),
        criterion("ocs_reduction", "천식 조절 유지·개선하며 경구 스테로이드 ≥50% 감량", "천식증상 조절을 개선하거나 유지하면서 경구용 코르티코스테로이드 용량을 치료 시작 전 대비 50% 이상 감소", "reduction"),
        benraBase.find(c => c.id === "no_biologic_combination"),
      ] : benraBase,
      logic: continuation
        ? all("initial_eligibility", "annual_assessment", "continuation_letter", "asthma_control", "no_biologic_combination", any("exacerbation_reduction", all("chronic_ocs_population", "ocs_reduction")))
        : benraInitial,
    };
  }
  if (medicationId === "durvalumab-500" && policyId === "us-aetna") {
    const continuation = phase === "continuation";
    return {
      id: `us-aetna-0917-consolidation-${phase}-20261016-v1`, medicationId, policyId, phase,
      sourceVersion: "Aetna CPB 0917 · 2026-10-16 확인 원문", sourceHash: AETNA_HASH,
      sourceUrl: "https://www.aetna.com/cpb/medical/data/900_999/0917.html",
      scope: `절제 불가능 II·III기 NSCLC · ${continuation ? "공고요법 재승인" : "동시 CCRT 후 단독 공고요법 초기 승인"}`,
      limitations: "보험 가입·계약별 우선약제 및 연결 문서의 세부요건 전체를 확정하는 검토는 아닙니다.",
      criteria: continuation ? [
        ...aetnaBase,
        criterion("no_toxicity_progression", "현재 요법에서 허용 불가 독성·진행 없음", "there is no evidence of unacceptable toxicity or disease progression while on the current regimen"),
        criterion("total_duration", "총 투여기간 12개월 이내", "up to 12 months total", "duration"),
      ] : aetnaInitial,
      logic: continuation
        ? all(...aetnaBase.map(c => c.id), "no_toxicity_progression", "total_duration")
        : all(...aetnaBase.map(c => c.id), "ccrt_no_progression", "no_known_egfr_positive", any("egfr_negative", "insufficient_tissue"), "single_agent", "dosing"),
    };
  }
  return null;
}

// Unknown information in an unused OR branch cannot override a satisfied branch.
export function aggregateCriteriaLogic(expression, statuses) {
  if (typeof expression === "string") return statuses[expression] ?? "missing";
  const states = (expression.all ?? expression.any).map(child => aggregateCriteriaLogic(child, statuses));
  if (expression.all) {
    if (states.includes("not_met")) return "not_met";
    if (states.includes("missing")) return "missing";
    if (states.includes("ambiguous")) return "ambiguous";
    return "met";
  }
  if (states.includes("met")) return "met";
  if (states.includes("ambiguous")) return "ambiguous";
  if (states.includes("missing")) return "missing";
  return "not_met";
}

export const CRITERIA_STATUS_LABELS = Object.freeze({ met: "충족", not_met: "미충족", missing: "정보 없음", ambiguous: "해석 불명확" });
