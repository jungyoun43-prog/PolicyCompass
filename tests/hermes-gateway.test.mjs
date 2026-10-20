import test from 'node:test';
import assert from 'node:assert/strict';
import { hermesSettings, configuredLocalChat } from '../scripts/hermes-gateway.mjs';
import { callFrontierModel, frontierStatus, runPatientQuestionAssistant } from '../scripts/patient-question-assistant.mjs';
import { runClinicalCopilot } from '../scripts/clinical-copilot.mjs';
import { runMedicationClaimReview } from '../scripts/graphs/medication-claim-review-graph.mjs';
import { medicationCoverageTranslationStatus, translateMedicationCoverage } from '../scripts/medication-coverage-translation.mjs';
import { findMedicationInCatalog } from '../src/medication-catalog.js';
import { buildMedicationClaimComparison } from '../src/medication-claim-review.js';
import { createDemoEmrState } from '../src/emr-demo-state.js';
import { resolveConfiguredProvider } from '../lib/api.js';
import { POST as clinicalCopilotPost } from '../app/api/clinical-copilot/route.js';

const key = 'synthetic-hermes-server-key-1234567890';
const environment = { POLICYCOMPASS_HERMES_BASE_URL:'https://hermes.example/api/apps/hermes', POLICYCOMPASS_HERMES_API_KEY:key };
const schema = {type:'object',properties:{answer:{type:'string'}},required:['answer']};
function recorder(output, finish='stop') {
  const calls=[];
  return { calls, fetchImpl: async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,options,body});
    const value=typeof output==='function'?output(body):output;
    return new Response(JSON.stringify({model:'hermes-agent',choices:[{message:{content:JSON.stringify(value)},finish_reason:finish}]}),{headers:{'content-type':'application/json'}});
  }};
}

test('Hermes uses only its own HTTPS server credential and exposes no credential through status',()=>{
  assert.equal(hermesSettings(environment).configured,true);
  const status=frontierStatus({...environment,OPENAI_API_KEY:'unused-openai-key',OPENROUTER_API_KEY:'unused-openrouter-key'});
  assert.equal(status.provider,'hermes');assert.equal(status.model,'hermes-agent');assert.equal(status.api,'chat');
  assert.equal(status.endpoint,environment.POLICYCOMPASS_HERMES_BASE_URL+'/chat/completions');
  assert.ok(!JSON.stringify(status).includes(key));
  for(const config of [{POLICYCOMPASS_HERMES_BASE_URL:'http://127.0.0.1'}, {POLICYCOMPASS_HERMES_API_KEY:key}, {...environment,POLICYCOMPASS_HERMES_API_KEY:''}, {...environment,POLICYCOMPASS_HERMES_BASE_URL:'https://user:password@hermes.example'}]) {
    assert.equal(hermesSettings(config).enabled,true);assert.equal(hermesSettings(config).configured,false);
  }
});

test('frontier calls pin Hermes and preserve the full Unicode input and schema without forwarding provider keys',async()=>{
  const mock=recorder({answer:'ok'});const input='가😀\n"'.repeat(20000);
  const result=await callFrontierModel({apiKey:'old-provider-key',model:'typesafe/jev-1.13',instructions:'합성 지시',input,schemaName:'test',schema,environment,fetchImpl:mock.fetchImpl});
  assert.equal(mock.calls.length,1);const call=mock.calls[0];
  assert.equal(call.url,environment.POLICYCOMPASS_HERMES_BASE_URL+'/chat/completions');assert.equal(call.options.headers.authorization,`Bearer ${key}`);
  assert.equal(call.body.model,'hermes-agent');assert.equal(call.body.messages[1].content,input);assert.deepEqual(call.body.response_format.json_schema.schema,schema);
  assert.ok(!JSON.stringify(call).includes('old-provider-key'));assert.deepEqual(JSON.parse(result.text),{answer:'ok'});assert.equal(result.model,'hermes-agent');
});

test('legacy graph transport uses Hermes with the same JSON schema and rejects partial replies',async()=>{
  const mock=recorder({answer:'ok'});
  const result=await configuredLocalChat({environment,endpoint:'http://127.0.0.1:11434',fetchImpl:mock.fetchImpl},{model:'old-local',messages:[{role:'user',content:'synthetic'}],format:schema});
  assert.equal((await result.json()).message.content,'{"answer":"ok"}');assert.equal(mock.calls[0].body.model,'hermes-agent');assert.deepEqual(mock.calls[0].body.response_format.json_schema.schema,schema);
  const partial=recorder({answer:'partial'},'length');
  await assert.rejects(configuredLocalChat({environment,fetchImpl:partial.fetchImpl},{messages:[{role:'user',content:'synthetic'}]}),/정상 완료/);
  await assert.rejects(callFrontierModel({environment,fetchImpl:partial.fetchImpl,input:'synthetic'}),/정상 완료/);
});

test('clinical copilot uses Hermes while preserving event evidence validation',async()=>{
  const patient={id:'synthetic',name:'합성이름',mrn:'DO-NOT-SEND',events:[{id:'e1',type:'condition',label:'고혈압',date:'2026-01-01',status:'active'}]};
  const output={summary:[{text:'고혈압 기록이 있습니다.',evidenceEventIds:['e1']}],priorities:[],clinicianQuestions:[],patientQuestions:[],warnings:[]};
  const mock=recorder(output);const result=await runClinicalCopilot({patient},{environment,fetchImpl:mock.fetchImpl,maxAttempts:1});
  assert.equal(result.model,'hermes-agent');assert.match(result.label,/Hermes/);assert.equal(mock.calls.length,1);
  assert.ok(!JSON.stringify(mock.calls).includes('DO-NOT-SEND'));
  const fabricated=recorder({...output,summary:[{text:'합성 응답',evidenceEventIds:['invented']}]});
  await assert.rejects(runClinicalCopilot({patient},{environment,fetchImpl:fabricated.fetchImpl,maxAttempts:1}));
});

test('JEV and arbitrary model overrides never escape Hermes or produce invented probabilities',async()=>{
  const medication=findMedicationInCatalog('durvalumab-500');
  const comparison=buildMedicationClaimComparison({patient:createDemoEmrState('2026-07-20').patients[0],medication,prescription:medication.dosing,asOf:'2026-07-20'});
  const mock=recorder({});
  const result=await runMedicationClaimReview({comparison,provider:'local',overrides:{model:'typesafe/jev-1.13'}},{environment,fetchImpl:mock.fetchImpl});
  assert.ok(mock.calls.length>0);assert.ok(mock.calls.every(call=>call.url===environment.POLICYCOMPASS_HERMES_BASE_URL+'/chat/completions'&&call.body.model==='hermes-agent'));
  assert.notEqual(result.draft.status,'ready');assert.ok(!result.draft.probabilities);
});

test('Hermes never bypasses patient per-run consent or the frontier route policy',async()=>{
  let calls=0;
  await assert.rejects(runPatientQuestionAssistant({provider:'local'},{environment,fetchImpl:async()=>{calls++;}}),/동의/);assert.equal(calls,0);
  const status=()=>({local:{configured:false},frontier:{configured:true,provider:'hermes'}});
  assert.throws(()=>resolveConfiguredProvider({provider:'local'},status,{requireConsent:true}),error=>error.code==='FRONTIER_CONSENT_REQUIRED');
  const payload={provider:'local',consent:true};assert.equal(resolveConfiguredProvider(payload,status,{requireConsent:true}),'frontier');assert.equal(payload.provider,'frontier');
});

test('coverage translation uses Hermes and preserves original fields and exact numeric tokens',async()=>{
  assert.equal(medicationCoverageTranslationStatus(environment).model,'hermes-agent');
  const fields={dataText:'{"value":9007199254740993,"label":"합성 항목"}',noticeText:'합성 기준 원문',promptText:'합성 지시문',reportText:'',summaryText:'',criteriaText:'["합성 기준"]'};
  const original=structuredClone(fields);
  const mock=recorder(body=>({translations:JSON.parse(body.messages[1].content).items.map(item=>({id:item.id,text:item.text}))}));
  const result=await translateMedicationCoverage({medicationId:'benralizumab-30',policyId:'gb-nice',fields},{environment,fetchImpl:mock.fetchImpl});
  assert.equal(result.model,'hermes-agent');assert.deepEqual(fields,original);assert.match(result.fields.dataText,/9007199254740993/);assert.ok(mock.calls.length>0);
});

test('Hermes clinical API retains the shared daily and per-address frontier limits',async t=>{
  const variables={...environment,FRONTIER_DAILY_LIMIT:'1',KV_REST_API_URL:undefined,KV_REST_API_TOKEN:undefined,UPSTASH_REDIS_REST_URL:undefined,UPSTASH_REDIS_REST_TOKEN:undefined};
  const previous=Object.fromEntries(Object.keys(variables).map(name=>[name,process.env[name]]));
  for(const [name,value] of Object.entries(variables)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  t.after(()=>{for(const [name,value] of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
  const output={summary:[{text:'고혈압 기록이 있습니다.',evidenceEventIds:['e1']}],priorities:[],clinicianQuestions:[],patientQuestions:[],warnings:[]};
  const mock=recorder(output);t.mock.method(globalThis,'fetch',mock.fetchImpl);
  const payload={patient:{id:'synthetic',events:[{id:'e1',type:'condition',label:'고혈압',date:'2026-01-01',status:'active'}]}};
  const request=(address,body=payload)=>new Request('http://localhost/api/clinical-copilot',{method:'POST',headers:{host:'localhost','content-type':'application/json','x-forwarded-for':address},body:JSON.stringify(body)});
  assert.equal((await clinicalCopilotPost(request('synthetic-daily',{}))).status,400);
  assert.equal((await clinicalCopilotPost(request('synthetic-daily'))).status,200);
  const daily=await clinicalCopilotPost(request('synthetic-daily'));
  assert.equal(daily.status,429);assert.equal((await daily.json()).code,'FRONTIER_DAILY_LIMITED');
  process.env.FRONTIER_DAILY_LIMIT='300';
  for(let i=0;i<5;i++)assert.equal((await clinicalCopilotPost(request('synthetic-minute'))).status,200);
  const minute=await clinicalCopilotPost(request('synthetic-minute'));
  assert.equal(minute.status,429);assert.equal((await minute.json()).code,'FRONTIER_RATE_LIMITED');
  assert.equal(mock.calls.length,6);
});
