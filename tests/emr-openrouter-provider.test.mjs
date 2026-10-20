import test from 'node:test';
import assert from 'node:assert/strict';
import { hermesSettings, configuredLocalChat } from '../scripts/hermes-gateway.mjs';
import { frontierStatus, frontierCredentials, clinicalLocalModel, patientLocalModel, runPatientQuestionAssistant } from '../scripts/patient-question-assistant.mjs';
import { runClinicalCopilot } from '../scripts/clinical-copilot.mjs';
import { runQuestionRefine } from '../scripts/graphs/question-refine-graph.mjs';
import { medicationClaimReviewStatus } from '../scripts/graphs/medication-claim-review-graph.mjs';
import { medicationCoverageTranslationStatus } from '../scripts/medication-coverage-translation.mjs';
import { resolveConfiguredProvider } from '../lib/api.js';
import { POST } from '../app/api/clinical-copilot/route.js';
import { GET as copilotStatus } from '../app/api/clinical-copilot/status/route.js';

const hermes={POLICYCOMPASS_HERMES_BASE_URL:'https://hermes.example/api/apps/hermes',POLICYCOMPASS_HERMES_API_KEY:'synthetic-hermes-server-key-1234567890'};
const environment={...hermes,POLICYCOMPASS_AI_PROVIDER:'openrouter',OPENROUTER_API_KEY:'sk-or-synthetic-emr-key',POLICYCOMPASS_FRONTIER_MODEL:'google/gemma-4-31b-it',POLICYCOMPASS_FRONTIER_ENABLED:'true'};
const schema={type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false};
const patient={id:'synthetic',name:'가상 환자',mrn:'DO-NOT-SEND',events:[{id:'e1',type:'condition',label:'고혈압',date:'2026-01-01',status:'active'}]};
const output={summary:[{text:'고혈압 기록이 있습니다.',evidenceEventIds:['e1']}],priorities:[],clinicianQuestions:[],patientQuestions:[],warnings:[]};
function recorder(value,finish='stop'){
 const calls=[];
 return {calls,fetchImpl:async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return new Response(JSON.stringify({model:environment.POLICYCOMPASS_FRONTIER_MODEL,choices:[{message:{content:JSON.stringify(value)},finish_reason:finish}]}),{headers:{'content-type':'application/json'}});}};
}
test('the app-specific OpenRouter pin overrides retained Hermes credentials without changing the other configuration',()=>{
 const original=structuredClone(hermes);
 assert.equal(hermesSettings(hermes).configured,true);
 assert.equal(hermesSettings(environment).enabled,false);
 const status=frontierStatus({...environment,POLICYCOMPASS_FRONTIER_BASE_URL:'https://wrong.example',POLICYCOMPASS_FRONTIER_API:'responses'});
 assert.equal(status.provider,'openrouter');assert.equal(status.api,'chat');assert.equal(status.endpoint,'https://openrouter.ai/api/v1/chat/completions');
 assert.equal(status.model,environment.POLICYCOMPASS_FRONTIER_MODEL);assert.equal(status.configured,true);
 assert.ok(!JSON.stringify(status).includes(environment.OPENROUTER_API_KEY));assert.ok(!JSON.stringify(status).includes(hermes.POLICYCOMPASS_HERMES_API_KEY));
 assert.deepEqual(hermes,original);assert.equal(hermesSettings(hermes).configured,true);
});
test('a pinned but missing OpenRouter key fails closed instead of using Hermes or OpenAI',async()=>{
 const missing={...environment,OPENROUTER_API_KEY:'',OPENAI_API_KEY:'unused-openai-key'};let calls=0;
 assert.equal(frontierCredentials(missing).configured,false);assert.equal(frontierCredentials(missing).apiKey,'');
 await assert.rejects(configuredLocalChat({environment:missing,fetchImpl:async()=>{calls++;}},{messages:[]}),/API 키/);assert.equal(calls,0);
});
test('both legacy model descriptors use the pinned OpenRouter model rather than an old loopback model',()=>{
 for(const model of [clinicalLocalModel(environment),patientLocalModel(environment)]){
  assert.equal(model.model,environment.POLICYCOMPASS_FRONTIER_MODEL);assert.equal(model.endpoint,'https://openrouter.ai/api/v1');assert.equal(model.provider,'openrouter');
 }
});
test('legacy graph transport preserves Unicode, retry conversation and JSON schema while sending only the OpenRouter key',async()=>{
 const mock=recorder({answer:'ok'}),messages=[{role:'system',content:'합성 지시'},{role:'user',content:'가😀\n"'.repeat(5000)},{role:'assistant',content:'이전 초안'},{role:'user',content:'근거를 다시 확인'}];
 const original=structuredClone(messages);
 const response=await configuredLocalChat({environment,fetchImpl:mock.fetchImpl},{model:'old-local-model',messages,format:schema,options:{num_predict:1600,temperature:0}});
 const result=await response.json(),call=mock.calls[0];
 assert.equal(call.url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(call.options.headers.authorization,'Bearer '+environment.OPENROUTER_API_KEY);
 assert.equal(call.body.model,environment.POLICYCOMPASS_FRONTIER_MODEL);assert.equal(call.body.max_tokens,1600);assert.deepEqual(call.body.messages,messages);assert.deepEqual(call.body.response_format.json_schema.schema,schema);
 assert.ok(!JSON.stringify(call).includes(hermes.POLICYCOMPASS_HERMES_API_KEY));assert.deepEqual(messages,original);assert.equal(result.done,true);assert.equal(result.message.content,'{"answer":"ok"}');
});
test('incomplete OpenRouter output is rejected before a clinical draft is accepted',async()=>{
 const mock=recorder({answer:'partial'},'length');await assert.rejects(configuredLocalChat({environment,fetchImpl:mock.fetchImpl},{messages:[],format:schema}),/완료/);
});
test('clinical copilot uses OpenRouter while retaining evidence validation and identifier exclusion',async()=>{
 const mock=recorder(output);const result=await runClinicalCopilot({patient},{environment,fetchImpl:mock.fetchImpl,maxAttempts:1});
 assert.equal(result.model,environment.POLICYCOMPASS_FRONTIER_MODEL);assert.match(result.label,/OpenRouter/);assert.equal(result.confirmed,false);
 assert.equal(mock.calls.length,1);assert.ok(!JSON.stringify(mock.calls).includes('DO-NOT-SEND'));
 const fabricated=recorder({...output,summary:[{text:'잘못된 근거',evidenceEventIds:['invented']}]});
 await assert.rejects(runClinicalCopilot({patient},{environment,fetchImpl:fabricated.fetchImpl,maxAttempts:1}));
});
test('medication status and API resolution pin the cloud path while leaving model selection and translation available',()=>{
 const status=medicationClaimReviewStatus(environment);assert.equal(status.local.configured,false);assert.equal(status.frontier.provider,'openrouter');
 const payload={provider:'local'};assert.equal(resolveConfiguredProvider(payload,()=>status,{}),'frontier');assert.equal(payload.provider,'frontier');
 const translation=medicationCoverageTranslationStatus(environment);assert.equal(translation.configured,true);assert.equal(translation.provider,'openrouter');assert.match(translation.model,/haiku/i);
});
test('patient cloud consent cannot be bypassed with an old local-provider payload',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;};
 await assert.rejects(runPatientQuestionAssistant({provider:'local'},{environment,fetchImpl}),/동의/);
 await assert.rejects(runQuestionRefine({provider:'local'},{environment,fetchImpl}),/동의/);
 assert.throws(()=>resolveConfiguredProvider({provider:'local'},()=>medicationClaimReviewStatus(environment),{requireConsent:true}),e=>e.code==='FRONTIER_CONSENT_REQUIRED');assert.equal(calls,0);
});
test('OpenRouter copilot status is truthful and its API keeps the daily frontier limit',async t=>{
 const variables={...environment,FRONTIER_DAILY_LIMIT:'1',KV_REST_API_URL:undefined,KV_REST_API_TOKEN:undefined,UPSTASH_REDIS_REST_URL:undefined,UPSTASH_REDIS_REST_TOKEN:undefined};
 const previous=Object.fromEntries(Object.keys(variables).map(k=>[k,process.env[k]]));
 for(const [k,v]of Object.entries(variables)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 t.after(()=>{for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const status=await(await copilotStatus()).json();assert.equal(status.provider,'openrouter');assert.equal(status.mode,'openrouter');assert.equal(status.configured,true);assert.ok(!JSON.stringify(status).includes(environment.OPENROUTER_API_KEY));
 const mock=recorder(output);t.mock.method(globalThis,'fetch',mock.fetchImpl);
 const request=()=>new Request('http://localhost/api/clinical-copilot',{method:'POST',headers:{host:'localhost','content-type':'application/json','x-forwarded-for':'openrouter-synthetic-daily'},body:JSON.stringify({patient})});
 assert.equal((await POST(request())).status,200);const limited=await POST(request());assert.equal(limited.status,429);assert.equal((await limited.json()).code,'FRONTIER_DAILY_LIMITED');assert.equal(mock.calls.length,1);
});
