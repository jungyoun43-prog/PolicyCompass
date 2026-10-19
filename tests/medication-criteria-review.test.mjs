import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { medicationCriteriaProfile, aggregateCriteriaLogic, MEDICATION_CRITERIA_SCHEMA } from "../src/medication-policy-criteria.js";
import { assertCriteriaSource, structuredMedicationRequest, validateMedicationCriteria, medicationEvidenceSources } from "../scripts/medication-criteria-review.mjs";
import { medicationReviewRequest, medicationReviewNotice } from "../src/medication-review-prompt.js";
import { runMedicationClaimReview } from "../scripts/graphs/medication-claim-review-graph.mjs";
import { buildMedicationClaimComparison } from "../src/medication-claim-review.js";
import { findMedicationInCatalog } from "../src/medication-catalog.js";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { applyCoveragePolicyReview } from "../src/medication-coverage-review.js";

const AS_OF = "2026-10-16";
const aetnaSource = JSON.parse(readFileSync(new URL("./helpers/aetna-0917-source-20261016.json", import.meta.url), "utf8"));
const environment = { POLICYCOMPASS_OLLAMA_MODEL: "test-model", POLICYCOMPASS_OLLAMA_URL: "http://127.0.0.1:11434" };
function comparisonFor(medicationId) {
  const medication = findMedicationInCatalog(medicationId);
  return buildMedicationClaimComparison({ patient: createDemoEmrState(AS_OF).patients[0], medication, prescription: medication.dosing, asOf: AS_OF });
}
function setup(medicationId = "durvalumab-500", phase = "initial", lines = []) {
  const comparison = comparisonFor(medicationId);
  comparison.patient.ageYears = 71;
  const policyId = medicationId === "durvalumab-500" ? "us-aetna" : "kr-registered";
  const profile = medicationCriteriaProfile(medicationId, policyId, phase);
  const notice = policyId === "us-aetna" ? aetnaSource.text : medicationReviewNotice(medicationId);
  const notes = [...lines, ...(medicationId === "benralizumab-30" && phase === "initial" ? ["2026-10-16 | 첫 생물학적 제제 투여 계획."] : []), "2026-10-16 | 필요한 진단·치료 계획과 제외 조건을 확인했다."];
  const overrides = { patientData: JSON.stringify({ notes }), notice, policyId, treatmentPhase: phase,
    policyContext: { countryCode: policyId === "us-aetna" ? "US" : "KR", payer: policyId === "us-aetna" ? "Aetna" : "건강보험" } };
  const request = structuredMedicationRequest(medicationReviewRequest(comparison, overrides), comparison, overrides, profile);
  const evidence = [{ sourceId: `E${notes.length}`, quote: notes.at(-1), date: AS_OF }];
  const body = { schema: MEDICATION_CRITERIA_SCHEMA, version: 1, profileId: profile.id,
    criteria: profile.criteria.map(c => ({ id: c.id, status: "met", evidence, facts: {}, reason: "기록 근거 확인" })) };
  const course = body.criteria.find(c => c.id === "biologic_course");
  if (course) Object.assign(course, { facts: {course:"first-biologic"}, evidence:[{sourceId:`E${notes.length-1}`,quote:notes.at(-2),date:AS_OF}] });
  return { comparison, overrides, profile, request, body, notes, set(id, update) { Object.assign(body.criteria.find(row => row.id === id), update); },
    proof(index) { return [{ sourceId: `E${index+1}`, quote: notes[index], date: notes[index].slice(0, 10) }]; },
    result() { return validateMedicationCriteria(JSON.stringify(body), profile, request, comparison); } };
}
function aetna(mono = true) {
  const s = setup("durvalumab-500", "initial", [
    "2026-10-16 | durvalumab 단독 공고요법 계획.", "2026-10-16 | 체중 70kg, 총 투여계획 12개월.",
  ]);
  s.set("single_agent", { facts: { regimen: "single-agent" }, evidence: s.proof(0) });
  s.set("dosing", { facts: { weightKg: 70, totalMonths: 12 }, evidence: s.proof(1) });
  s.set("insufficient_tissue", { status: "missing", evidence: [], reason: "예외 경로 미사용" });
  if (!mono) s.set("single_agent", { status: "missing", evidence: [], facts: {}, reason: "단독/병용 계획 정보 없음" });
  return s;
}
function benra(eos = 350, count = 3, chronic = false) {
  const s = setup("benralizumab-30", "initial", [
    `2026-10-01 | Eosinophil ${eos} cells/uL`,
    `2026-10-16 | 최근 12개월 전신 스테로이드가 필요한 천식 급성악화 ${count}회.`,
    "2026-04-16–2026-10-16 | 경구 prednisolone 5mg/day 지속 투여.",
    "2026-10-16 | 지속 경구 스테로이드는 사용하지 않는다.",
  ]);
  s.set("eosinophils", { evidence: s.proof(0), facts: { measurements: [{ date: "2026-10-01", value: eos, unit: "cells/uL", evidence: s.proof(0) }] } });
  s.set("exacerbations", { evidence: s.proof(1), facts: { count, windowMonths: 12 } });
  s.set("oral_steroids", chronic ? { evidence: [{...s.proof(2)[0], date: "2026-04-16"}], facts: { startDate: "2026-04-16", endDate: AS_OF, prednisoloneEquivalentMgPerDay: 5, continuous: true } }
    : { status: "not_met", evidence: s.proof(3), facts: {} });
  return s;
}

async function stubbedCriteriaReview(s, provider, body = s.body) {
  let calls = 0;
  const result = await runMedicationClaimReview({ comparison: s.comparison, overrides: s.overrides, provider }, {
    environment: provider === "local" ? environment : { OPENROUTER_API_KEY: "test-key", POLICYCOMPASS_FRONTIER_MODEL: "qwen/qwen3-8b" },
    fetchImpl: async () => {
      calls += 1;
      const content = JSON.stringify(body);
      return { ok: true, json: async () => provider === "local"
        ? { message: { content } }
        : { choices: [{ message: { content }, finish_reason: "stop" }] } };
    },
  });
  return { ...result, calls };
}

for (const [provider, label] of [["local", "Ollama"], ["frontier", "Qwen3 8B"]]) {
  test(label + ": 모델 추가 value가 미검증 수치 행의 상태·판정을 바꾸지 않는다", async () => {
    for (const id of ["eosinophils", "exacerbations"]) {
      for (const status of ["missing", "ambiguous", "not_met"]) {
        const s = id === "eosinophils" ? benra(600, 3) : benra(350, 4);
        const row = s.body.criteria.find(c => c.id === id);
        s.set(id, { status, evidence: status === "missing" ? [] : row.evidence, facts: {} });
        const before = await stubbedCriteriaReview(s, provider);
        assert.equal(before.draft.verdict, status === "ambiguous" ? "triangle" : "cross");
        const altered = structuredClone(s.body);
        altered.criteria.find(c => c.id === id).value = id === "eosinophils" ? 600 : 4;
        const after = await stubbedCriteriaReview(s, provider, altered);
        assert.deepEqual(after.draft, before.draft, id + " / " + status);
        assert.equal(after.calls, 1);
      }
    }
  });

  test(label + ": 모델 추가 course가 누락·불명확·검증 실패한 교체 경로를 충족시키지 않는다", async () => {
    for (const status of ["missing", "ambiguous", "not_met", "met"]) {
      const s = benra(600, 3);
      const row = s.body.criteria.find(c => c.id === "biologic_course");
      s.set("biologic_course", {
        status, evidence: status === "missing" ? [] : row.evidence,
        facts: status === "met" ? { course: "unknown" } : {},
      });
      const before = await stubbedCriteriaReview(s, provider);
      assert.equal(before.draft.verdict, status === "ambiguous" ? "triangle" : "cross");
      const altered = structuredClone(s.body);
      altered.criteria.find(c => c.id === "biologic_course").course = "first-biologic";
      const after = await stubbedCriteriaReview(s, provider, altered);
      assert.deepEqual(after.draft, before.draft, status);
      assert.equal(after.calls, 1);
    }
  });

  test(label + ": 모델 추가 파생 필드와 무관하게 검증한 사실·원문·정상 결과를 유지한다", async () => {
    for (const [s, verdict] of [[benra(600, 3), "circle"], [benra(350, 3), "cross"], [aetna(), "circle"]]) {
      const before = await stubbedCriteriaReview(s, provider);
      assert.equal(before.status, "completed");
      assert.equal(before.draft.verdict, verdict);
      const altered = structuredClone(s.body);
      for (const row of altered.criteria) Object.assign(row, {
        value: 9999, course: "other-switch", patientInfo: "모델이 덧붙인 환자 정보",
        measurements: [{ value: 9999 }], label: "모델 항목", sourceQuote: "모델 고시", statusLabel: "모델 상태",
      });
      const after = await stubbedCriteriaReview(s, provider, altered);
      assert.deepEqual(after.draft, before.draft);
      assert.equal(after.calls, 1);
    }
  });

  test(label + ": 모델 추가 파생 필드가 있어도 범위 밖 경로·잘못된 근거는 미완료로 남는다", async () => {
    for (const scenario of ["other-switch", "unknown-evidence", "unrecorded-measurement"]) {
      const s = benra(600, 3);
      if (scenario === "other-switch") s.set("biologic_course", { facts: { course: "other-switch" } });
      else {
        const row = s.body.criteria.find(c => c.id === "eosinophils");
        if (scenario === "unknown-evidence") row.facts.measurements[0].evidence = ["E99999"];
        else row.facts.measurements[0].value = 9999;
      }
      for (const row of s.body.criteria) Object.assign(row, { value: 600, course: "first-biologic" });
      const result = await stubbedCriteriaReview(s, provider);
      assert.equal(result.status, scenario === "other-switch" ? "incomplete" : "failed", scenario);
      assert.equal(result.draft.verdict, null, scenario);
      assert.equal(result.draft.generatedBy, "none", scenario);
      assert.equal(result.calls, scenario === "other-switch" ? 1 : 2, scenario);
    }
  });
}

test("두 조건표의 모든 원문 앵커와 버전이 등록 원문에 연결된다", () => {
  for (const phase of ["initial", "continuation"]) {
    assert.doesNotThrow(() => assertCriteriaSource(medicationCriteriaProfile("benralizumab-30", "kr-registered", phase), medicationReviewNotice("benralizumab-30")));
    assert.doesNotThrow(() => assertCriteriaSource(medicationCriteriaProfile("durvalumab-500", "us-aetna", phase), aetnaSource.text));
  }
  assert.throws(() => assertCriteriaSource(aetna().profile, aetnaSource.text.replace("single agent", "combination")), /원문 버전/);
});
test("환자·처방·보험 비교 범위를 분리하고 원문을 모두 전달한다", () => {
  const s = aetna(), input = JSON.parse(s.request.input);
  assert.equal(input.reviewScope.mode, "international-comparison");
  assert.equal(input.patientFacts.insuranceType, s.comparison.patient.insuranceType);
  assert.equal(input.reviewScope.policy.payer, "Aetna");
  assert.equal(input.reviewContext, undefined);
  assert.equal(input.noticeText, aetnaSource.text);
  assert.equal(input.patientDataText, s.overrides.patientData);
  assert.equal(input.plannedTreatment.wholeRegimen, "unknown-unless-documented-in-patient-data");
  assert.ok(input.patientEvidenceSources.every(source => !source.id.startsWith("policy")));
});
test("없는 단독요법 정보는 모델의 최종 ○ 주장과 무관하게 ✕로 집계한다", () => {
  const s = aetna(false); s.body.verdict = "circle";
  assert.equal(s.result().verdict, "cross");
  assert.equal(s.result().criteria.find(c => c.id === "single_agent").status, "missing");
  assert.equal(s.result().assessmentMethod, "server-criteria-aggregation");
});
test("선택한 처방 하나를 단독요법 증거로 쓴 met도 missing으로 교정한다", () => {
  const s = aetna(); s.set("single_agent", { evidence: [{ sourceId: "plannedPrescription", quote: JSON.stringify(s.comparison.prescription) }] });
  assert.equal(s.result().verdict, "cross");
});
test("완전한 단독요법 양성 대조군은 사용하지 않는 EGFR 예외가 missing이어도 ○", () => {
  assert.equal(aetna().result().verdict, "circle");
});
test("PD-1/PD-L1 진행 제외 조건은 다른 충족 조건보다 우선한다", () => {
  const s = aetna(); s.set("no_ici_progression", { status: "not_met" });
  assert.equal(s.result().verdict, "cross");
});
test("알려진 EGFR 양성은 조직 부족 예외로 충족 처리하지 않는다", () => {
  const s=aetna();s.set("egfr_negative",{status:"not_met"});s.set("insufficient_tissue",{status:"met",evidence:s.proof(1)});
  assert.equal(s.result().verdict,"cross");
});
test("required missing과 실제 근거의 ambiguous를 구분한다", () => {
  const s = aetna(); s.set("single_agent", { status: "ambiguous", reason: "단독 계획의 적용 시점이 불명확" });
  assert.equal(s.result().verdict, "triangle");
  s.set("precertification", { status: "missing", evidence: [] });
  assert.equal(s.result().verdict, "cross");
});
test("호산구와 악화 횟수의 AND/OR: 350+3회는 ✕, 400+3회 및 350+4회는 ○", () => {
  assert.equal(benra(350, 3).result().verdict, "cross");
  assert.equal(benra(400, 3).result().verdict, "circle");
  assert.equal(benra(350, 4).result().verdict, "circle");
});
test("350+6개월 5mg/day 지속 경구 스테로이드 경로는 악화 횟수 미달이어도 ○", () => {
  assert.equal(benra(350, 0, true).result().verdict, "circle");
  const s = benra(350, 0, true); s.body.criteria.find(c => c.id === "oral_steroids").facts.startDate = "2026-04-17";
  assert.equal(s.result().verdict, "cross");
});
test("WBC 10.1×10³/uL × 호산구 6%는 서버에서 606 cells/uL로 계산", () => {
  const s = setup("benralizumab-30", "initial", ["2026-06-18 | WBC 10.1 ×10³/㎕", "2026-06-18 | Eosinophil 6 %"]);
  const evidence = [...s.proof(0), ...s.proof(1)];
  s.set("eosinophils", { evidence, facts: { measurements: [{ date: "2026-06-18", wbcValue: 10.1, wbcUnit: "10^3/uL", eosPercent: 6, evidence }] } });
  assert.equal(s.result().criteria.find(c => c.id === "eosinophils").value, 606);
});
test("12개월을 벗어난 검사와 중복 악화 기록을 충족 횟수에 더하지 않는다", () => {
  const s = benra(600, 4);
  s.set("eosinophils", { status: "missing", evidence: [], facts: {} });
  assert.equal(s.result().verdict, "cross");
  const t = setup("benralizumab-30", "initial", ["2026-10-01 | 사건 asthma-1: 전신 스테로이드가 필요한 천식 악화."]);
  t.set("exacerbations", { evidence: t.proof(0), facts: { episodes: Array.from({ length: 4 }, () => ({ startDate: "2026-10-01",endDate:"2026-10-01",episodeId:"asthma-1", evidence: t.proof(0) })) } });
  assert.equal(t.result().criteria.find(c => c.id === "exacerbations").value, 1);
});
test("허위 근거 ID·조건 누락·중복은 완료된 판정으로 통과하지 않는다", () => {
  for (const mutation of [s => {s.body.criteria.pop();}, s => {s.body.criteria[0] = s.body.criteria[1];},
    s => {s.body.criteria[0].evidence = [{sourceId:"policy",quote:"single agent"}];}]) {
    const s = aetna(); mutation(s); assert.throws(() => s.result());
  }
});
test("수치가 근거에 없거나 용량 간격이 12주인 처방은 ○로 집계하지 않는다", () => {
  const s = aetna(); s.comparison.prescription.frequency = "12주 1회";
  assert.equal(s.result().verdict, "cross");
  const t = benra(); t.body.criteria.find(c => c.id === "eosinophils").facts.measurements[0].value = 900;
  assert.throws(() => t.result(), /값·단위·근거/);
});
test("지속 투여의 50% 변화 및 Aetna 12개월 기간을 서버가 계산한다", () => {
  const s = setup("benralizumab-30", "continuation", ["2026-10-16 | 악화 4회에서 2회로 감소."]);
  s.set("exacerbation_reduction", { evidence: s.proof(0), facts: { baseline: 4, current: 2, comparable: true } });
  s.set("ocs_reduction", { status: "missing", evidence: [] });
  assert.equal(s.result().verdict, "circle");
  const t = setup("durvalumab-500", "continuation", ["2025-10-16–2026-10-16 | 계획 투여기간."]);
  t.set("total_duration", { evidence: [{...t.proof(0)[0],date:"2025-10-16"}], facts: { startDate:"2025-10-16",endDate:AS_OF } });
  assert.equal(t.result().verdict, "circle");
});
test("실패·미완료·규칙 대체 응답은 한국 기준에서도 종합 ○를 만들지 않는다", () => {
  const comparison = comparisonFor("benralizumab-30");
  const input = { medicationId:"benralizumab-30",policyId:"kr-registered",noticeText:medicationReviewNotice("benralizumab-30"),base:comparison };
  for (const draft of [{status:"failed",verdict:null,generatedBy:"none"},{status:"incomplete",verdict:"circle"},{generatedBy:"rule",verdict:"circle"},{}]) {
    assert.throws(() => applyCoveragePolicyReview(input,draft), /검토/);
  }
});
test("실제 graph의 한 번 요청은 조건 JSON을 받아 서버 판정과 실행 상태를 반환한다", async () => {
  const s = aetna(false), calls = [];
  const result = await runMedicationClaimReview({comparison:s.comparison,overrides:s.overrides}, {environment,fetchImpl:async (url,options) => {
    calls.push(JSON.parse(options.body)); return {ok:true,json:async()=>({message:{content:JSON.stringify(s.body)}})};
  }});
  assert.equal(result.status,"completed"); assert.equal(result.draft.verdict,"cross"); assert.equal(calls.length,1);
  assert.equal(JSON.parse(calls[0].messages[1].content).reviewScope.mode,"international-comparison");
  assert.deepEqual(calls[0].format.properties.profileId.enum,[s.profile.id]);
});
test("프론티어 검토는 응답 JSON 스키마와 이를 지원하는 경로를 요청한다", async () => {
  const s=aetna();const calls=[];
  for(const row of s.body.criteria)row.evidence=row.evidence.map(e=>e.sourceId);
  const result=await runMedicationClaimReview({comparison:s.comparison,overrides:s.overrides,provider:"frontier"},{
    environment:{OPENROUTER_API_KEY:"test-key",POLICYCOMPASS_FRONTIER_MODEL:"google/gemma-4-31b-it"},
    fetchImpl:async(_url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(s.body)},finish_reason:"stop"}]})};},
  });
  assert.equal(result.status,"completed");assert.equal(calls.length,1);
  assert.equal(calls[0].provider.require_parameters,true);
  assert.equal(calls[0].response_format.type,"json_schema");
  assert.equal(calls[0].response_format.json_schema.strict,true);
  assert.equal(calls[0].temperature,0);
  assert.deepEqual(calls[0].response_format.json_schema.schema.properties.profileId.enum,[s.profile.id]);
});
test("OpenAI·Claude 추론 모델은 미지원 temperature 없이 구조화 출력 경로를 요청한다", async () => {
  const s=aetna();
  for(const model of ["openai/gpt-6.1-sol","anthropic/claude-haiku-5.5"]){
    const calls=[];
    const result=await runMedicationClaimReview({comparison:s.comparison,overrides:s.overrides,provider:"frontier"},{
      environment:{OPENROUTER_API_KEY:"test-key",POLICYCOMPASS_FRONTIER_MODEL:model},
      fetchImpl:async(_url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(s.body)},finish_reason:"stop"}]})};},
    });
    assert.equal(result.status,"completed");assert.equal(calls.length,1);
    assert.equal(Object.hasOwn(calls[0],"temperature"),false);
    assert.equal(calls[0].reasoning.effort,"low");assert.equal(calls[0].provider.require_parameters,true);
    assert.equal(calls[0].response_format.type,"json_schema");
  }
});
test("비추론 소형 모델의 native schema 요청에는 reasoning 옵션을 보내지 않는다", async () => {
  const s=aetna();
  for(const model of ["meta-llama/llama-3.1-8b-instruct","google/gemma-3-4b-it"]){
    const calls=[];
    const result=await runMedicationClaimReview({comparison:s.comparison,overrides:s.overrides,provider:"frontier"},{
      environment:{OPENROUTER_API_KEY:"test-key",POLICYCOMPASS_FRONTIER_MODEL:model},
      fetchImpl:async(_url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(s.body)},finish_reason:"stop"}]})};},
    });
    assert.equal(result.status,"completed");assert.equal(Object.hasOwn(calls[0],"reasoning"),false);
    assert.equal(calls[0].temperature,0);assert.equal(calls[0].response_format.type,"json_schema");
  }
});
test("native schema가 없는 Qwen3 8B도 동일한 JSON 계약과 서버 집계를 사용한다", async () => {
  const s=aetna(false);const calls=[];
  const result=await runMedicationClaimReview({comparison:s.comparison,overrides:s.overrides,provider:"frontier"},{
    environment:{OPENROUTER_API_KEY:"test-key",POLICYCOMPASS_FRONTIER_MODEL:"qwen/qwen3-8b"},
    fetchImpl:async(_url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(s.body)},finish_reason:"stop"}]})};},
  });
  assert.equal(result.status,"completed");assert.equal(result.draft.verdict,"cross");
  assert.equal(Object.hasOwn(calls[0],"response_format"),false);assert.equal(Object.hasOwn(calls[0],"provider"),false);
  assert.match(calls[0].messages[0].content,/조건별 근거 반환 계약/);
});
test("잘린 응답·타임아웃·출력 미완료는 실패 상태와 null 판정", async () => {
  const s = aetna();
  for (const fetchImpl of [async()=>{throw new Error("timeout");},async()=>({ok:true,json:async()=>({message:{content:"{unfinished"}})}),
    async()=>({ok:true,json:async()=>({done_reason:"length",message:{content:JSON.stringify(s.body)}})})]) {
    const result = await runMedicationClaimReview({comparison:s.comparison,overrides:s.overrides},{environment,fetchImpl});
    assert.equal(result.status,"failed"); assert.equal(result.draft.verdict,null); assert.equal(result.draft.generatedBy,"none");
  }
});
test("기록된 진단 요약을 새 진단 지시로 막지 않으며 근거 없는 단독요법은 교정한다", async () => {
  const s=aetna(false);let calls=0;
  s.body.criteria.find(c=>c.id==="nsclc_stage").reason="절제 불가능한 III기 비소세포폐암으로 진단되었습니다.";
  s.set("single_agent",{status:"met",evidence:s.proof(1),facts:{regimen:"single-agent"},reason:"Durvalumab 단독 공고요법 예정입니다."});
  const result=await runMedicationClaimReview({comparison:s.comparison,overrides:s.overrides},{environment,fetchImpl:async()=>{
    calls++;return {ok:true,json:async()=>({message:{content:JSON.stringify(s.body)}})};
  }});
  assert.equal(calls,1);assert.equal(result.status,"completed");assert.equal(result.draft.verdict,"cross");
  assert.equal(result.draft.criteria.find(c=>c.id==="single_agent").status,"missing");
});
test("급여 검토에서도 직접적인 약 중단 지시는 완료된 결과가 될 수 없다", async () => {
  const s=aetna();s.body.criteria[0].reason="처방을 중단하세요.";
  const result=await runMedicationClaimReview({comparison:s.comparison,overrides:s.overrides},{environment,fetchImpl:async()=>({ok:true,json:async()=>({message:{content:JSON.stringify(s.body)}})})});
  assert.equal(result.status,"failed");assert.equal(result.draft.verdict,null);assert.match(result.draft.note,/복약 변경/);
});
test("고시 버전 변경 시 모델 호출 전에 미완료로 중단하며 번역본의 숫자 대조는 하지 않는다", async () => {
  const s = aetna(); let calls = 0;
  const result = await runMedicationClaimReview({comparison:s.comparison,overrides:{...s.overrides,notice:"편집된 고시"}},{environment,fetchImpl:async()=>{calls++;}});
  assert.equal(result.status,"incomplete"); assert.equal(result.draft.verdict,null); assert.equal(calls,0);
  assert.doesNotThrow(()=>assertCriteriaSource(s.profile,aetnaSource.text));
});
test("명시된 OR 경로의 충족과 AND 제외 조건 집계", () => {
  const rule={all:["mandatory",{any:["a","b"]}]};
  assert.equal(aggregateCriteriaLogic(rule,{mandatory:"met",a:"missing",b:"met"}),"met");
  assert.equal(aggregateCriteriaLogic(rule,{mandatory:"not_met",a:"met",b:"missing"}),"not_met");
});
test("긴 JSON 진료기록과 개행 문자열을 자르지 않고 근거 원문으로 보존한다", () => {
  const text="긴 임상 기록 ".repeat(6000)+"\n최종 근거";
  const sources=medicationEvidenceSources(JSON.stringify({notes:[text]}),{},{});
  assert.equal(sources[0].text,text);
});
test("인용된 WBC 단위를 모델이 1000배로 재지정할 수 없다", () => {
  const s=setup("benralizumab-30","initial",["2026-06-18 | WBC 10.1 cells/uL","2026-06-18 | Eosinophil 6 %"]);
  const evidence=[...s.proof(0),...s.proof(1)];
  s.set("eosinophils",{evidence,facts:{measurements:[{date:"2026-06-18",wbcValue:10.1,wbcUnit:"10^3/uL",eosPercent:6,evidence}]}});
  assert.throws(()=>s.result(),/값·단위·근거/);
});
test("같은 인용문의 혈소판 수치를 호산구 수치로 사용할 수 없다", () => {
  const s=setup("benralizumab-30","initial",["2026-10-01 | WBC 5 ×10³/uL | Eosinophil 1 % | Platelet 600 cells/uL"]);
  s.set("eosinophils",{evidence:s.proof(0),facts:{measurements:[{date:"2026-10-01",value:600,unit:"cells/uL",evidence:s.proof(0)}]}});
  assert.throws(()=>s.result(),/값·단위·근거/);
  s.set("eosinophils",{evidence:s.proof(0),facts:{measurements:[{date:"2026-10-01",wbcValue:5,wbcUnit:"10^3/uL",eosPercent:1,evidence:s.proof(0)}]}});
  assert.equal(s.result().criteria.find(c=>c.id==="eosinophils").value,50);
});
test("구조화된 검사 객체의 label·value·unit을 같은 기록에서 확인한다", () => {
  const record={date:"2026-10-01",label:"Eosinophil",value:600,unit:"cells/uL"};
  const s=setup("benralizumab-30","initial",[JSON.stringify(record)]);
  s.set("eosinophils",{evidence:s.proof(0).map(e=>({...e,date:"2026-10-01"})),facts:{measurements:[{date:"2026-10-01",value:600,unit:"cells/uL",evidence:s.proof(0).map(e=>({...e,date:"2026-10-01"}))}]}});
  assert.equal(s.result().criteria.find(c=>c.id==="eosinophils").value,600);
});
test("복합 q4w→q8w 일정은 durvalumab의 단순 q4w 용법으로 통과하지 않는다", () => {
  const s=aetna(); s.comparison.prescription.dose="1500";s.comparison.prescription.doseUnit="mg";
  s.comparison.prescription.frequency="4주 1회(첫 3회) 후 8주 1회";
  assert.equal(s.result().verdict,"cross");
});
test("같은 입원의 여러 날짜 기록은 한 사건이며 보고 근거도 실제 사건 인용이다", () => {
  const s=setup("benralizumab-30","initial",["2026-10-01–2026-10-03 | 입원 A-001 천식 악화, 전신 스테로이드.","2026-10-02–2026-10-04 | 입원 A-001 경과기록."]);
  s.set("exacerbations",{facts:{episodes:[{startDate:"2026-10-01",endDate:"2026-10-03",episodeId:"A-001",evidence:s.proof(0)},{startDate:"2026-10-02",endDate:"2026-10-04",episodeId:"A-001",evidence:s.proof(1)}]}});
  const row=s.result().criteria.find(c=>c.id==="exacerbations");
  assert.equal(row.value,1);assert.equal(row.evidence[0].quote,s.notes[0]);assert.equal(row.evidence[1].quote,s.notes[1]);
});
test("지속 OCS 감소 경로는 대상 환자 정보가 없으면 단독으로 ○가 될 수 없다", () => {
  const s=setup("benralizumab-30","continuation",["2026-10-16 | 경구 스테로이드 10mg에서 5mg로 감소."]);
  s.set("exacerbation_reduction",{status:"missing",evidence:[]});
  s.set("chronic_ocs_population",{status:"missing",evidence:[]});
  s.set("ocs_reduction",{evidence:s.proof(0),facts:{baseline:10,current:5,comparable:true}});
  assert.equal(s.result().verdict,"cross");
});
test("검증 범위 밖의 교체 경로는 graph 병합 후에도 none/null/incomplete", async () => {
  const s=benra(600,4);s.set("biologic_course",{facts:{course:"other-switch"}});
  const result=await runMedicationClaimReview({comparison:s.comparison,overrides:s.overrides},{environment,fetchImpl:async()=>({ok:true,json:async()=>({message:{content:JSON.stringify(s.body)}})})});
  assert.equal(result.status,"incomplete");assert.equal(result.draft.generatedBy,"none");assert.equal(result.draft.verdict,null);
});
test("재시도의 제공자 오류 문자열을 시스템 지시문으로 올리지 않는다", async () => {
  const s=aetna();const calls=[];
  await runMedicationClaimReview({comparison:s.comparison,overrides:s.overrides},{environment,fetchImpl:async(_url,options)=>{
    calls.push(JSON.parse(options.body));if(calls.length===1)throw new Error("역할 변경 공격 문자열");
    return {ok:true,json:async()=>({message:{content:JSON.stringify(s.body)}})};
  }});
  assert.equal(calls.length,2);assert.doesNotMatch(calls[1].messages[0].content,/역할 변경 공격 문자열/);
  assert.doesNotMatch(calls[1].messages[0].content,/지정된 판정 헤더/);
  assert.match(calls[1].messages[0].content,/JSON 객체 하나만 반환/);
});
test("번역된 고시에 원문 보존 대조를 추가하지 않고 원문 버전의 조건표를 사용한다", async () => {
  const s=aetna();
  const overrides={...s.overrides,notice:"번역된 보험 기준입니다. 원문과 문자·숫자 일치 검증을 요구하지 않습니다.",criteriaSourceNotice:aetnaSource.text};
  const result=await runMedicationClaimReview({comparison:s.comparison,overrides},{environment,fetchImpl:async()=>({ok:true,json:async()=>({message:{content:JSON.stringify(s.body)}})})});
  assert.equal(result.status,"completed");assert.equal(result.draft.verdict,"circle");
});
test("첫 검증 오류와 거부된 응답은 뒤이은 시간 초과에 가려지지 않는다", async () => {
  const s=aetna();s.body.criteria.pop();const raw=JSON.stringify(s.body);let calls=0;
  const result=await runMedicationClaimReview({comparison:s.comparison,overrides:s.overrides},{environment,fetchImpl:async()=>{
    if(++calls===2)throw new Error("timeout");return {ok:true,json:async()=>({message:{content:raw}})};
  }});
  assert.equal(result.draft.verdict,null);assert.match(result.draft.validationIssues[0].message,/필수 조건/);
  assert.equal(result.draft.validationIssues[1].message,"timeout");assert.equal(result.draft.rejectedResponse,raw);
});
test("모델이 근거 ID만 선택하면 서버가 해당 기록의 원문·날짜를 연결한다", () => {
  const s=aetna();for(const row of s.body.criteria)row.evidence=row.evidence.map(({sourceId})=>sourceId);
  const result=s.result();assert.equal(result.verdict,"circle");
  const single=result.criteria.find(c=>c.id==="single_agent");
  assert.equal(single.evidence[0].quote,s.notes[0]);assert.equal(single.evidence[0].date,AS_OF);
  assert.equal(single.evidence[0].sourcePath,"patient/notes/0");
});
test("모델이 임의의 인용·날짜를 덧붙여도 서버 원문을 바꾸지 못한다", () => {
  const s=aetna();s.body.criteria.find(c=>c.id==="single_agent").evidence=[{sourceId:"E1",quote:"만들어낸 인용",date:"2000-01-01"}];
  const row=s.result().criteria.find(c=>c.id==="single_agent");
  assert.equal(row.evidence[0].quote,s.notes[0]);assert.equal(row.evidence[0].date,AS_OF);
});
test("일반 진료 텍스트는 날짜와 검사값을 문단으로 유지하면서 E번호로 참조한다", () => {
  const text="2026-10-01\nWBC 10.1 ×10³/uL\nEosinophil 6 %\n\n투여 계획 정보 없음";
  const sources=medicationEvidenceSources(text,{},{});
  assert.deepEqual(sources.filter(s=>s.kind==="patient-data").map(s=>[s.id,s.text,s.date]),[["E1","2026-10-01\nWBC 10.1 ×10³/uL\nEosinophil 6 %","2026-10-01"],["E2","투여 계획 정보 없음",""]]);
  assert.equal(sources[0].path,"patient/block/1");
});
test("여러 줄에 적힌 날짜·백혈구·호산구는 같은 근거에서 606 cells/uL로 계산한다", () => {
  const s=setup("benralizumab-30","initial",[]);
  s.overrides.patientData="2026-10-01\nWBC 10.1 ×10³/uL\nEosinophil 6 %";
  for(const row of s.body.criteria)Object.assign(row,{status:"missing",evidence:[],facts:{}});
  s.set("eosinophils",{evidence:["E1"],facts:{measurements:[{date:"2026-10-01",wbcValue:10.1,wbcUnit:"10^3/uL",eosPercent:6,evidence:["E1"]}]}});
  s.set("eosinophils",{status:"met"});
  const request=structuredMedicationRequest(medicationReviewRequest(s.comparison,s.overrides),s.comparison,s.overrides,s.profile);
  const row=validateMedicationCriteria(JSON.stringify(s.body),s.profile,request,s.comparison).criteria.find(c=>c.id==="eosinophils");
  assert.equal(row.value,606);assert.equal(row.evidence[0].date,"2026-10-01");
});
test("수치가 필요 없는 임상 행의 빈 facts 생략은 허용하되 수치 행은 계약을 유지한다", () => {
  const s=aetna();delete s.body.criteria.find(c=>c.id==="nsclc_stage").facts;
  assert.equal(s.result().verdict,"circle");
  delete s.body.criteria.find(c=>c.id==="dosing").facts;
  assert.throws(()=>s.result(),/facts/);
});
test("Gemma의 한 겹 감싼 facts와 미사용 빈 facts 생략은 값·근거 검증 후 집계한다", () => {
  const s=benra(600,3);
  for(const id of ["omalizumab_trial","omalizumab_insufficient","omalizumab_intolerance","adherence_improvement","switch_letter"])s.set(id,{status:"missing",evidence:[]});
  for(const row of s.body.criteria){
    const kind=s.profile.criteria.find(c=>c.id===row.id).kind;
    if(kind==="biologic_course")row.facts={biologic_course:row.facts.course};
    else if(Object.keys(row.facts).length)row.facts={[kind]:row.facts};
    else delete row.facts;
  }
  const result=s.result();assert.equal(result.verdict,"circle");
  assert.equal(result.criteria.find(c=>c.id==="eosinophils").value,600);
  assert.equal(result.criteria.find(c=>c.id==="exacerbations").value,3);
  s.body.criteria.find(c=>c.id==="eosinophils").facts.eosinophils.measurements[0].value=500;
  assert.throws(()=>s.result(),/값·단위·근거/);
});
test("처음 생물학적 제제라는 명시적 기록도 첫 투여 경로의 근거로 연결한다", () => {
  const s=setup("benralizumab-30","initial",["2026-10-16 | 처음 생물학적 제제로 benralizumab 투여 예정."]);
  s.set("biologic_course",{facts:{course:"first-biologic"},evidence:s.proof(0)});
  const row=s.result().criteria.find(c=>c.id==="biologic_course");
  assert.equal(row.status,"met");assert.equal(row.course,"first-biologic");
});
test("연간 횟수 요약 한 건은 개별 악화 사건으로 세지 않고 원문 횟수로 검증한다", () => {
  const s=benra(600,3);
  s.set("exacerbations",{facts:{episodes:[{count:3,windowMonths:12}]}});
  assert.equal(s.result().verdict,"circle");
  assert.equal(s.result().criteria.find(c=>c.id==="exacerbations").value,3);
  s.set("exacerbations",{facts:{episodes:[{count:4,windowMonths:12}]}});
  assert.equal(s.result().verdict,"cross");
  s.set("exacerbations",{facts:{episodes:[{count:3,windowMonths:12},{episodeId:"A-1"}]}});
  assert.throws(()=>s.result(),/근거|evidence/);
});
