import { createHash } from "node:crypto";
import { MEDICATION_CRITERIA_SCHEMA, CRITERIA_STATUS_LABELS, aggregateCriteriaLogic } from "../src/medication-policy-criteria.js";
import { medicationCriteriaResponseSchema } from "./medication-criteria-schema.mjs";

const normalize = text => String(text).replace(/\s+/g, " ").trim();
const hash = text => createHash("sha256").update(normalize(text)).digest("hex");
const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const stateFor = met => met ? "met" : "not_met";

export function assertCriteriaSource(profile, notice) {
  if (hash(notice) !== profile.sourceHash) throw new TypeError("입력 고시가 검증된 조건표의 원문 버전과 다릅니다. 원문을 복원하거나 조건표를 갱신한 뒤 다시 검토해 주세요.");
  for (const c of profile.criteria) {
    if (!normalize(notice).includes(normalize(c.sourceQuote))) throw new TypeError(`조건표의 원문 위치를 확인할 수 없습니다: ${c.id}`);
  }
}

// Stable evidence IDs reference the actual operator-supplied data, including
// decoded JSON strings. Official policy/context can never serve as patient proof.
export function medicationEvidenceSources(patientDataText, patientFacts, prescription) {
  const sources = [];
  const add = (path, text) => {
    let date = validDate(text.slice(0,10)) ? text.slice(0,10) : "";
    try { const record=JSON.parse(text); if (validDate(record?.date)) date=record.date; } catch { /* Plain chart text. */ }
    sources.push({ id:`E${sources.length+1}`, path, kind:"patient-data", text, date });
  };
  const visit = (value, path) => {
    if (Array.isArray(value)) value.forEach((item, index) => {
      if (item && typeof item === "object" && !Array.isArray(item)) add(`${path}/${index}`,JSON.stringify(item));
      else visit(item, `${path}/${index}`);
    });
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => visit(item, `${path}/${key}`));
    else if (value !== null && value !== undefined) add(path,String(value));
  };
  try { visit(JSON.parse(patientDataText), "patient"); }
  catch { patientDataText.split(/\r?\n\s*\r?\n/).forEach((block,index)=>{ if(block.trim()) add(`patient/block/${index+1}`,block); }); }
  sources.push({ id: "patientFacts", kind:"metadata", text: JSON.stringify(patientFacts) });
  sources.push({ id: "plannedPrescription", kind:"metadata", text: JSON.stringify(prescription) });
  return sources;
}

const FACT_INSTRUCTIONS = `facts는 각 조건 행 안의 객체입니다. 아래 kind 이름으로 다시 감싸지 마세요. 예: {"id":"eosinophils","facts":{"measurements":[...]}}. 임상 상태만으로 설명하는 행과 missing/not_met/ambiguous 행에 수치가 없으면 facts:{}로 반환합니다.
facts 내부 규격 (해당 kind에서만 사용):
eosinophils: {measurements:[{date:"YYYY-MM-DD",value:숫자,unit:"cells/uL",evidence:[근거]}]}. 백혈구와 분율로 계산할 때 value 대신 wbcValue, wbcUnit("10^3/uL" 또는 "cells/uL"), eosPercent를 주고 같은 날짜의 두 검사 근거를 함께 넣는다. 모든 해당 검사 후보를 반환한다.
exacerbations: 개별 사건 없이 명시된 연간 횟수만 있으면 {count:숫자,windowMonths:12}. 이 요약을 episodes 안에 넣지 않는다. 근거에 천식 악화·전신 스테로이드·12개월·횟수가 명시되어야 한다. 개별 사건의 식별자·시작일·종료일이 원문에 있을 때만 {episodes:[{startDate:"YYYY-MM-DD",endDate:"YYYY-MM-DD",episodeId:"기록에 명시된 사건/입원 식별자",evidence:[근거]}]}를 사용한다. 같은 입원·악화 기간의 경과 기록은 한 사건으로 묶는다. 날짜별 진단·진료기록을 새로운 악화로 세지 않는다. 별도 악화인지 확인 불가능하면 status:ambiguous이다. 반드시 천식 악화이며 전신 스테로이드가 요구된 사건만 포함한다. CAP/패혈증의 스테로이드 투여는 제외한다.
oral_steroids: {startDate:"YYYY-MM-DD",endDate:"YYYY-MM-DD",prednisoloneEquivalentMgPerDay:숫자,continuous:true}. 경구 투여와 prednisolone 또는 명시된 동등 용량의 근거가 필요하다. 다른 스테로이드의 동등용량을 외부 지식으로 계산하지 않는다.
single_agent: {regimen:"single-agent" 또는 "combination"}. 환자 진료기록에서 이번 전체 요법이 단독이라는 명시적 근거가 필요하다. 고시의 적응증이나 선택한 약 하나로 추정하지 않는다.
durvalumab_dosing: {weightKg:숫자 또는 null,totalMonths:숫자}. 체중·계획한 총 기간의 진료기록 근거를 붙인다. prescription.durationDays는 이번 처방 기간이며 총 공고요법 기간이 아니다. 용량과 간격은 plannedTreatment.selectedPrescription에서 서버가 계산한다.
reduction: {baseline:숫자,current:숫자,comparable:true}. 동등한 비교기간·단위의 값만 사용한다. ocs_reduction은 천식 조절의 개선/유지가 문서화된 경우만 comparable:true이다.
duration: {startDate:"YYYY-MM-DD",endDate:"YYYY-MM-DD"}. 계획 종료일까지의 총 투여기간이며 근거에 두 날짜가 필요하다.
biologic_course: {course:"first-biologic"|"from-omalizumab"|"other-switch"|"unknown"}. 첫 생물학적 제제임이나 교체 전 약제를 명시한 환자 기록이 필요하다. 기존 약력의 단순 누락은 first-biologic으로 추정하지 않는다.
omalizumab_trial: {startDate:"YYYY-MM-DD",endDate:"YYYY-MM-DD"}. Omalizumab 사용 시작·종료 날짜의 근거가 필요하다.
clinical/adult: facts:{}.
투여 경로는 reviewScope.treatmentPhase를 따른다. 교체 예외의 사용기간·효과 불충분·부작용·복약순응도·소견서는 각각 별도 ID로 반환한다. 첫 생물학적 제제면 사용하지 않는 교체 예외 항목은 missing으로 반환해도 된다.
annual_assessment는 평가 시점과 소견서 제출을 확인한다. 최초 투여 후 1년 이내라 정기평가 전이면 최초 평가 및 다음 평가 계획의 근거를 확인한다.
EGFR 음성 경로와 조직 부족 예외는 별도 행으로 반환한다. 음성 근거가 있으면 예외 행은 missing이어도 된다. 이 경로에 다른 나라의 PD-L1 조건을 추가하지 않는다.`;

export function structuredMedicationRequest(request, comparison, overrides, profile) {
  const input = JSON.parse(request.input);
  const sources = medicationEvidenceSources(input.patientDataText, comparison.patient, comparison.prescription);
  const kinds=new Set(profile.criteria.map(c=>c.kind));
  const factsInstructions=FACT_INSTRUCTIONS.split("\n").filter((line,index)=>{
    const kind=line.match(/^([a-z_]+)(?:\/adult)?:/)?.[1];
    if(kind)return kinds.has(kind);
    if(index<=1)return true;
    if(line.startsWith("투여 경로"))return profile.medicationId==="benralizumab-30" && profile.phase==="initial";
    if(line.startsWith("annual_assessment"))return profile.medicationId==="benralizumab-30" && profile.phase==="continuation";
    if(line.startsWith("EGFR"))return profile.policyId==="us-aetna" && profile.phase==="initial";
    return false;
  }).join("\n");
  const reviewScope = {
    mode: overrides.policyContext?.countryCode === "US" ? "international-comparison" : "registered-policy-review",
    reviewDate: comparison.asOf, treatmentPhase: profile.phase,
    policy: overrides.policyContext ?? { countryCode: "KR", payer: "건강보험" },
    indication: profile.scope, criteriaProfileId: profile.id, sourceVersion: profile.sourceVersion,
    limitations: profile.limitations ?? "프로젝트에 등록한 원문 범위의 참고 검토입니다.",
  };
  return {
    instructions: `${request.instructions}\n\n### 조건별 근거 반환 계약\n최종 종합 판정과 Markdown 보고서는 서버가 만듭니다. 위 지시문의 출력 예시보다 아래 JSON 반환 규격을 우선합니다.\n보험 기준·검토 적응증은 환자 사실이 아닙니다. 국제 비교에서는 실제 보험 가입 여부를 이 가상 비교의 임상 탈락 근거로 쓰지 마세요.\ncriteriaProfile.criteria에 나열된 ID만 정확히 한 번씩 반환하세요. logic의 파생 ID는 서버가 계산하므로 반환하지 마세요. 최종 verdict는 작성하지 마세요.\n각 행의 status는 met(충족), not_met(명시적 미충족), missing(필수 정보 없음), ambiguous(실제 관련 근거는 있으나 해석 불명확) 중 하나입니다. missing은 evidence:[]로 반환합니다. 나머지는 patientEvidenceSources에 제시된 E번호를 선택해 evidence:["E1"] 형식으로 반환합니다. 근거 문구(quote)와 날짜(date)는 서버가 원문에서 연결하므로 다시 베껴 쓰지 마세요. 정책 문구·환자 기본정보·선택한 처방만으로 임상 근거를 대신하지 마세요. 임의의 E번호·날짜·사실을 만들지 마세요. reason은 해당 조건의 설명 한 문장으로 쓰고 근거 원문을 반복하지 마세요.\n${factsInstructions}\nJSON 객체 하나만 반환합니다. 코드펜스와 부연설명은 쓰지 마세요.\n{"schema":"${MEDICATION_CRITERIA_SCHEMA}","version":1,"profileId":"${profile.id}","criteria":[{"id":"조건 ID","status":"missing","evidence":[],"facts":{},"reason":"정보 없음"}]}${overrides.retryFeedback ? "\n이전 응답이 검증을 통과하지 못했습니다. 조건 ID, 근거 E번호, 수치·단위를 확인하여 JSON 전체를 다시 반환하세요." : ""}`,
    input: JSON.stringify({ reviewScope, patientFacts: comparison.patient,
      plannedTreatment: { selectedPrescription: comparison.prescription, wholeRegimen: "unknown-unless-documented-in-patient-data" },
      noticeText: input.noticeText, patientDataText: input.patientDataText,
      criteriaProfile: { id: profile.id, criteria: profile.criteria, logic: profile.logic }, patientEvidenceSources: sources.filter(source=>source.kind==="patient-data") }),
    sources, reviewScope, schema: medicationCriteriaResponseSchema(profile),
  };
}

function evidenceList(raw, sources) {
  if (!Array.isArray(raw)) throw new Error("조건별 evidence 배열이 필요합니다.");
  return raw.map(item => {
    const id=typeof item==="string" ? item : item?.sourceId;
    const source = sources.find(s => s.id === id);
    if (!source) throw new Error(`실제 진료기록에서 조건별 근거를 찾지 못했습니다: ${id ?? "ID 없음"}`);
    // Only the source ID is model-authored. Text/date always come from the
    // supplied record, even if the model sends unsolicited quote/date fields.
    return { sourceId: source.id, sourcePath:source.path, sourceKind:source.kind, quote: source.text, date: source.date || "" };
  });
}

function numberPresent(value, evidence) {
  if (!Number.isFinite(value)) return false;
  return evidence.some(e => (e.quote.replace(/\d{4}-\d{2}-\d{2}/g, "").replace(/(?<=\d),(?=\d{3}\b)/g, "").match(/\d+(?:\.\d+)?/g) ?? [])
    .some(n => Math.abs(Number(n) - value) < 1e-8));
}
function monthsBefore(date, months) {
  const d = new Date(date + "T00:00:00Z"), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - months);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, end));
  return d.toISOString().slice(0, 10);
}
const unitText = value => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\sμµ]/g, m => /[μµ]/.test(m) ? "u" : "");
const directCellUnit = unit => ["cells/ul", "cell/ul", "/ul", "cells/mm3"].includes(unitText(unit));
const thousandCellUnit = unit => /^(?:[×x])?10\^?(?:3\/ul|9\/l)$/.test(unitText(unit));
const textOf = evidence => evidence.map(e => e.quote).join(" ");

function recordedMeasurement(value, unit, evidence, label) {
  const multiplier = directCellUnit(unit) ? 1 : thousandCellUnit(unit) ? 1000 : unit === "%" ? 0 : null;
  if (multiplier === null) return false;
  return evidence.some(e => {
    const factor = u => u === "%" ? 0 : directCellUnit(u) ? 1 : thousandCellUnit(u) ? 1000 : null;
    try {
      const record = JSON.parse(e.quote);
      if (record && typeof record === "object" && !Array.isArray(record) && label.test([record.label, record.code].join(" "))
        && (typeof record.value === "number" || (typeof record.value === "string" && /^\d+(?:\.\d+)?$/.test(record.value)))
        && Math.abs(Number(record.value) - value) < 1e-8 && factor(record.unit) === multiplier) return true;
    } catch { /* The source is an ordinary chart string. */ }
    const text = e.quote.normalize("NFKC").toLowerCase().replace(/[μµ]/g,"u").replace(/(?<=\d),(?=\d{3}\b)/g, "");
    const measurements = text.matchAll(/(\d+(?:\.\d+)?)\s*((?:[×x]\s*)?10\^?(?:3\s*\/\s*ul|9\s*\/\s*l)|cells?\s*\/\s*ul|\/\s*ul|cells?\s*\/\s*mm3|%)/g);
    let precedingEnd = 0;
    for (const match of measurements) {
      const preceding = text.slice(precedingEnd,match.index).split(/[|;,\n]/).filter(part=>part.trim()).at(-1) ?? "";
      precedingEnd = match.index + match[0].length;
      if (label.test(preceding) && Math.abs(Number(match[1]) - value) < 1e-8 && factor(match[2]) === multiplier) return true;
    }
    return false;
  });
}

function evaluateNumeric(c, row, context) {
  const facts = row.facts, evidence = row.evidence, text = textOf(evidence);
  if (c.kind === "adult") {
    const age = context.comparison.patient.ageYears;
    return Number.isInteger(age) ? { ...row, status: stateFor(age >= 18), patientInfo: `만 ${age}세`, evidence: [{ sourceId: "patientFacts", quote: `ageYears: ${age}`, date: "" }] } : { ...row, status: "missing" };
  }
  if (c.kind === "single_agent") {
    const patientProof = evidence.filter(e => e.sourceKind === "patient-data");
    const quote = textOf(patientProof);
    const explicit = /단독|single[ -]agent|monotherapy/i.test(quote);
    const uncertain = /정보\s*없|기록\s*없|미정|불명|미기재|not\s+(?:documented|specified)|unknown|no\s+(?:documentation|information)/i.test(quote);
    if (!explicit || uncertain) return { ...row, status: "missing", evidence: [], patientInfo: "전체 요법의 단독·병용 계획 정보 없음" };
    if (row.status === "ambiguous") return row;
    return { ...row, status: facts.regimen === "single-agent" ? row.status : "not_met" };
  }
  if (row.status === "missing" || row.status === "ambiguous") return row;
  if (row.status === "not_met" && !Object.keys(facts).length) return row;
  if (c.kind === "eosinophils") {
    const measurements = Array.isArray(facts.measurements) ? facts.measurements : [];
    const values = measurements.map(m => {
      const proof = evidenceList(m.evidence, context.sources);
      if (!validDate(m.date) || !proof.length || proof.some(e => !e.quote.includes(m.date))) throw new Error("검사값과 날짜를 함께 확인할 근거가 필요합니다.");
      let value;
      if (Number.isFinite(m.value) && (directCellUnit(m.unit) || thousandCellUnit(m.unit))
        && recordedMeasurement(m.value, m.unit, proof, /eosinophil|호산구|\bAEC\b|711-2|26449-9/i)) value = m.value * (thousandCellUnit(m.unit) ? 1000 : 1);
      else if (recordedMeasurement(m.wbcValue, m.wbcUnit, proof, /\bWBC\b|white blood|백혈구|6690-2|26464-8/i)
        && recordedMeasurement(m.eosPercent, "%", proof, /eosinophil|호산구|\bEOS\b|713-8/i) && m.eosPercent >= 0 && m.eosPercent <= 100
        && (directCellUnit(m.wbcUnit) || thousandCellUnit(m.wbcUnit))) value = m.wbcValue * (thousandCellUnit(m.wbcUnit) ? 1000 : 1) * m.eosPercent / 100;
      else throw new Error("호산구 계산의 값·단위·근거를 확인할 수 없습니다.");
      if (value < 0) throw new Error("호산구 수치는 음수일 수 없습니다.");
      return { date: m.date, value: Math.round(value * 1e6) / 1e6, evidence: proof };
    }).filter(m => m.date >= monthsBefore(context.date, 12) && m.date <= context.date);
    if (!values.length) return { ...row, status: "missing", patientInfo: "시작 전 12개월 내 확인된 검사 없음" };
    const best = values.reduce((a, b) => a.value >= b.value ? a : b);
    return { ...row, status: stateFor(best.value >= 300), value: best.value, measurements: values,
      patientInfo: `${best.date} · ${best.value} cells/μL · ≥300 ${best.value >= 300 ? "충족" : "미충족"}, ≥400 ${best.value >= 400 ? "충족" : "미충족"}`, evidence: best.evidence };
  }
  if (c.kind === "exacerbations") {
    let count;
    let countedEvidence = evidence;
    if (Array.isArray(facts.episodes)) {
      const episodes = facts.episodes.map(e => {
        const proof = evidenceList(e.evidence, context.sources);
        if (!validDate(e.startDate) || !validDate(e.endDate) || e.endDate < e.startDate || !proof.length
          || !textOf(proof).includes(e.startDate) || !textOf(proof).includes(e.endDate)
          || typeof e.episodeId !== "string" || !e.episodeId.trim() || !textOf(proof).includes(e.episodeId)) throw new Error("악화 사건의 식별자·시작일·종료일과 근거가 필요합니다.");
        return { id: e.episodeId, start: e.startDate, end: e.endDate, evidence: proof };
      }).filter(e => e.start >= monthsBefore(context.date, 12) && e.start <= context.date).sort((a,b)=>a.start.localeCompare(b.start));
      const merged = [];
      for (const episode of episodes) {
        const same = merged.find(e => e.id === episode.id || (e.start <= episode.end && e.end >= episode.start));
        if (same) { same.start = same.start < episode.start ? same.start : episode.start; same.end = same.end > episode.end ? same.end : episode.end; }
        else merged.push({ ...episode });
      }
      count = merged.length;
      countedEvidence = episodes.flatMap(e => e.evidence);
    } else if (Number.isSafeInteger(facts.count) && facts.count >= 0 && facts.windowMonths === 12 && numberPresent(facts.count, evidence)
      && /12\s*(?:개월|months?)|(?:지난|최근|과거)\s*1\s*년|past year|last year/i.test(text)) count = facts.count;
    else return { ...row, status: "missing", patientInfo: "12개월 악화 횟수 정보 없음" };
    return { ...row, value: count, evidence: countedEvidence, status: stateFor(count >= 3), patientInfo: `12개월 내 ${count}회 · ≥3회 ${count >= 3 ? "충족" : "미충족"}, ≥4회 ${count >= 4 ? "충족" : "미충족"} · 동일 사건 중복 제외` };
  }
  if (c.kind === "oral_steroids") {
    if (!validDate(facts.startDate) || !validDate(facts.endDate) || !text.includes(facts.startDate) || !text.includes(facts.endDate)
      || !numberPresent(facts.prednisoloneEquivalentMgPerDay, evidence)) return { ...row, status: "missing" };
    const met = facts.continuous === true && facts.startDate <= monthsBefore(context.date, 6) && facts.endDate >= context.date
      && facts.prednisoloneEquivalentMgPerDay >= 5 && /경구|oral|\bPO\b/i.test(text) && /prednisolone|프레드니솔론|동등|equivalent/i.test(text);
    return { ...row, status: stateFor(met), patientInfo: `${facts.startDate}–${facts.endDate} · ${facts.prednisoloneEquivalentMgPerDay}mg/day` };
  }
  if (c.kind === "durvalumab_dosing") {
    if (!numberPresent(facts.totalMonths, evidence) || facts.totalMonths <= 0) return { ...row, status: "missing", patientInfo: "총 투여기간 정보 없음" };
    const p = context.comparison.prescription, dose = Number(p.dose), unit = unitText(p.doseUnit), frequency = String(p.frequency);
    const q2w = /^(?:2\s*주\s*1\s*회|every\s*2\s*weeks?|q2w)$/i.test(frequency.trim());
    const q4w = /^(?:4\s*주\s*1\s*회|every\s*4\s*weeks?|q4w)$/i.test(frequency.trim());
    const weightKnown = numberPresent(facts.weightKg, evidence);
    if (unit === "mg" && dose === 1500 && q4w && !weightKnown) return { ...row, status: "missing", patientInfo: "체중 정보 없음" };
    const met = facts.totalMonths <= 12 && ((unit === "mg/kg" && dose === 10 && q2w) || (unit === "mg" && dose === 1500 && q4w && weightKnown && facts.weightKg >= 30));
    return { ...row, status: stateFor(met), patientInfo: `${p.dose}${p.doseUnit} · ${frequency} · 총 ${facts.totalMonths}개월` };
  }
  if (c.kind === "reduction") {
    if (!numberPresent(facts.baseline, evidence) || !numberPresent(facts.current, evidence) || facts.baseline <= 0 || facts.current < 0 || facts.comparable !== true) return { ...row, status: "missing" };
    const reduction = (facts.baseline - facts.current) / facts.baseline * 100;
    return { ...row, status: stateFor(reduction >= 50), patientInfo: `${facts.baseline} → ${facts.current} · ${Math.round(reduction * 100) / 100}% 감소 (서버 계산)` };
  }
  if (c.kind === "duration") {
    if (!validDate(facts.startDate) || !validDate(facts.endDate) || !text.includes(facts.startDate) || !text.includes(facts.endDate) || facts.endDate < facts.startDate) return { ...row, status: "missing" };
    return { ...row, status: stateFor(facts.startDate >= monthsBefore(facts.endDate, 12)), patientInfo: `${facts.startDate}–${facts.endDate}` };
  }
  if (c.kind === "omalizumab_trial") {
    if (!validDate(facts.startDate) || !validDate(facts.endDate) || !text.includes(facts.startDate) || !text.includes(facts.endDate) || facts.endDate < facts.startDate || facts.endDate > context.date) return { ...row, status: "missing" };
    return { ...row, status: stateFor(facts.startDate <= monthsBefore(facts.endDate, 3)), patientInfo: `${facts.startDate}–${facts.endDate}` };
  }
  if (c.kind === "biologic_course") {
    const course = facts.course;
    if (!["first-biologic", "from-omalizumab", "other-switch"].includes(course)) return { ...row, status: "missing" };
    if (course === "first-biologic" && !/biologic[ -]naive|first.{0,30}biologic|(?:첫|처음).{0,20}생물학|생물학.{0,20}(처음|첫)|no.{0,20}prior.{0,20}biologic|생물학.{0,20}(투여|사용).{0,10}없/i.test(text)) return { ...row, status: "missing" };
    if (course === "from-omalizumab" && (!/omalizumab|오말리주맙/i.test(text) || !/교체|switch|전환/i.test(text))) return { ...row, status: "missing" };
    return { ...row, course, patientInfo: {"first-biologic":"첫 생물학적 제제", "from-omalizumab":"Omalizumab에서 교체", "other-switch":"검증된 조건표 범위 밖의 교체 경로"}[course] };
  }
  return row;
}

function reportText(value) { return String(value ?? "").replace(/[|\r\n]/g, " ").replace(/[<>]/g, ""); }
function criterionFacts(received, criterion) {
  // Known transport variants do not add facts or bypass their source checks.
  let facts=received.facts ?? (["clinical","adult"].includes(criterion.kind) || received.status !== "met" ? {} : undefined);
  if (facts && typeof facts === "object" && !Array.isArray(facts) && Object.keys(facts).length === 1 && Object.hasOwn(facts,criterion.kind)) {
    const nested=facts[criterion.kind];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) facts=nested;
    else if (criterion.kind === "biologic_course" && typeof nested === "string") facts={course:nested};
  }
  // A single annual-count summary is not an individual episode. Preserve that
  // distinction; the same count/window/source checks still run below.
  if (criterion.kind === "exacerbations" && Array.isArray(facts?.episodes) && facts.episodes.length === 1) {
    const summary = facts.episodes[0];
    if (summary && typeof summary === "object" && Object.keys(facts).length === 1
      && Object.keys(summary).length === 2 && Object.hasOwn(summary,"count") && Object.hasOwn(summary,"windowMonths")) facts=summary;
  }
  return facts;
}
export function validateMedicationCriteria(raw, profile, request, comparison) {
  let body;
  try { body = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("조건별 JSON 응답을 읽지 못했습니다."); }
  if (body?.schema !== MEDICATION_CRITERIA_SCHEMA || body.version !== 1 || body.profileId !== profile.id || !Array.isArray(body.criteria)) throw new Error("조건표 ID·버전 또는 조건별 결과가 일치하지 않습니다.");
  if (body.criteria.length !== profile.criteria.length || new Set(body.criteria.map(c => c?.id)).size !== profile.criteria.length
    || body.criteria.some(row => !profile.criteria.some(c => c.id === row?.id))) throw new Error("필수 조건의 결과가 누락되거나 중복되었습니다.");
  if (!validDate(comparison.asOf)) throw new Error("검토 기준일이 올바르지 않습니다.");
  const criteria = profile.criteria.map(c => {
    const received = body.criteria.find(row => row.id === c.id);
    const item = { ...received, facts: criterionFacts(received,c) };
    if (!Object.hasOwn(CRITERIA_STATUS_LABELS, item.status) || typeof item.reason !== "string" || !item.facts || typeof item.facts !== "object" || Array.isArray(item.facts)) throw new Error(`조건별 상태·설명·facts가 올바르지 않습니다: ${c.id}`);
    const evidence = evidenceList(item.evidence, request.sources);
    if (item.status !== "missing" && c.kind !== "adult" && !evidence.length) throw new Error(`충족 여부를 뒷받침할 환자 근거가 없습니다: ${c.id}`);
    if (item.status !== "missing" && !["adult","single_agent"].includes(c.kind) && !evidence.some(e => e.sourceKind === "patient-data")) throw new Error(`환자 기본정보나 처방 한 건으로 임상 조건을 대신할 수 없습니다: ${c.id}`);
    const row = evaluateNumeric(c, { ...item, evidence }, { comparison, sources: request.sources, date: comparison.asOf });
    return { ...row, reason: row.status !== item.status ? `${CRITERIA_STATUS_LABELS[row.status]} · ${row.patientInfo || "조건을 확인할 수치·기간·명시적 근거를 확인해 주세요."}` : row.reason,
      label: c.label, sourceQuote: c.sourceQuote, statusLabel: CRITERIA_STATUS_LABELS[row.status] };
  });
  const statuses = Object.fromEntries(criteria.map(row => [row.id, row.status]));
  if (profile.policyId === "us-aetna" && profile.phase === "initial") statuses.no_known_egfr_positive = statuses.egfr_negative === "not_met" ? "not_met" : "met";
  const course = criteria.find(row => row.id === "biologic_course");
  if (course) {
    statuses.no_switch = course.course ? stateFor(course.course === "first-biologic") : course.status;
    statuses.from_omalizumab = course.course ? stateFor(course.course === "from-omalizumab") : course.status;
    if (course.course === "other-switch") return { status: "incomplete", verdict: null, generatedBy: "none", criteria, note: "이 생물학적 제제 교체 경로는 원문과 조건표의 추가 대조가 필요하여 종합 판정을 완료하지 않았습니다." };
  }
  for (const [id, threshold] of [["eos_300", 300], ["eos_400", 400], ["exacerbations_3", 3], ["exacerbations_4", 4]]) {
    const row = criteria.find(c => c.id === (id.startsWith("eos_") ? "eosinophils" : "exacerbations"));
    if (row) statuses[id] = Number.isFinite(row.value) ? stateFor(row.value >= threshold) : row.status;
  }
  const status = aggregateCriteriaLogic(profile.logic, statuses);
  const verdict = { met: "circle", ambiguous: "triangle", missing: "cross", not_met: "cross" }[status];
  const symbol = { circle: "○", triangle: "△", cross: "✕" }[verdict];
  const label = { circle: "충족", triangle: "판정 제한", cross: "미충족" }[verdict];
  const summary = {met:"선택한 투여 경로의 필수 조건이 충족됩니다.",not_met:"선택한 투여 경로의 필수 조건을 충족하지 못하거나 제외 조건에 해당합니다.",
    missing:"선택한 투여 경로에 필요한 정보가 없어 조건 충족을 확인할 수 없습니다.",ambiguous:"관련 근거는 있으나 해석이 불명확해 조건 충족 여부의 판정이 제한됩니다."}[status];
  const markdown = [`## [${symbol}] ${reportText(comparison.medication.label)} — 급여기준 ${label}`, "", `**사유:** ${summary}`, "",
    ...(profile.logicSummary ? [profile.logicSummary, ""] : []),
    "| 항목 | 환자 정보 | 판단 | 근거 (원문 발췌) |", "| ---- | ---- | :---: | ---- |",
    ...criteria.map(row => `| ${reportText(row.label)} | ${reportText(row.patientInfo || row.reason)} | ${{met:"○",not_met:"✕",missing:"✕",ambiguous:"△"}[row.status]} · ${row.statusLabel} | ${reportText(row.evidence.map(e => [e.date, e.quote].filter(Boolean).join(" · ")).join(" / ") || "정보 없음")} |`),
    "", `**최종 판단:** ${summary}`, ...(profile.limitations ? ["", profile.limitations] : [])].join("\n");
  return { status: "completed", verdict, markdown, summary, outputKind: "criteria", criteria,
    assessmentMethod: "server-criteria-aggregation", criteriaProfile: { id: profile.id, sourceVersion: profile.sourceVersion, sourceHash: profile.sourceHash, scope: profile.scope },
    reviewScope: request.reviewScope };
}
