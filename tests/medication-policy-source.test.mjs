import assert from "node:assert/strict";
import test from "node:test";
import { extractPolicyHtml, extractPolicyPdf, loadMedicationPolicySource } from "../scripts/medication-policy-source.mjs";
import { GET } from "../app/api/medication-claim-review/policy-source/route.js";

// Synthetic publisher-shaped fixtures; these strings are not medical guidance.
function aetnaFixture(asthma = false) {
  const target = asthma ? "<h4>Asthma</h4>" : "Non-small cell lung cancer (NSCLC)";
  return `<div class="body">
    <h2>Brand Selection for Test Plans</h2><p>Commercial sentinel <a href="/preferred">Preferred source</a></p><hr>
    <h2>Policy</h2><h3>Scope of Policy</h3><p>Scope sentinel</p><p>Precertification sentinel</p>
    <ol><li><h3>Exclusions</h3><p>Exclusion sentinel</p></li>
    <li><h3>Prescribing Specialties</h3><p>Specialty intro</p><ol><li>Asthma: specialty sentinel</li><li>Other specialty must not leak</li></ol></li>
    <li><h3>Criteria for Initial Approval</h3><p>Initial intro</p><ol><li>${target}<ol><li>Initial sentinel 150; and<ol><li>Nested branch alpha; or</li><li>Nested branch beta</li></ol></li><li>Alternative sentinel</li></ol></li><li><h4>Other disease</h4>Wrong disease initial</li></ol><p>Global initial condition</p></li>
    <li><h3>Continuation of Therapy</h3><p>Continuation intro</p><ol><li>${asthma ? target : "NSCLC"}<ol><li>Continuation sentinel 12 months</li></ol></li><li>Wrong disease continuation</li></ol></li>
    <li><h3>Other</h3><p>General combination sentinel</p></li></ol>
    <h2>Dosage and Administration</h2><p>Dose context sentinel</p>
    <h3>${asthma ? "Asthma" : "Unresectable Stage III test"}</h3><p>30 kg sentinel</p><ul><li>10 mg/kg dose sentinel</li></ul>
    <h3>Other dosing</h3><p>Wrong disease dosing</p>
    <h2 id="appendix">Appendix</h2><table><tr><td>High dose sentinel</td><td>400 mg</td></tr></table><h2>References</h2><p>Background not criteria</p>
  </div>`;
}

test("durvalumab source retains shared policy, all NSCLC alternatives, continuation and dosing", () => {
  const result = extractPolicyHtml(aetnaFixture(), "aetna-durvalumab");
  const text = result.sections.map(section => section.text).join("\n\n");
  for (const sentinel of ["Commercial sentinel", "Scope sentinel", "Precertification sentinel", "Exclusion sentinel", "Initial sentinel 150", "Nested branch alpha; or", "Nested branch beta", "Alternative sentinel", "Global initial condition", "Continuation sentinel 12 months", "Dose context sentinel", "30 kg sentinel", "10 mg/kg dose sentinel"]) assert.ok(text.includes(sentinel), sentinel);
  assert.ok(!text.includes("Wrong disease"));
  assert.ok(!text.includes("한국어 요약"));
  assert.match(text, /\n {2}1\. Nested branch alpha/);
  assert.equal(result.references[0].href, "/preferred");
  assert.throws(() => extractPolicyHtml(aetnaFixture().replace("Continuation of Therapy", "Changed heading"), "aetna-durvalumab"), /필수 구간/);
});

test("benralizumab source includes asthma specialties, common restrictions and the full dose appendix", () => {
  const result = extractPolicyHtml(aetnaFixture(true), "aetna-benralizumab");
  const text = result.sections.map(section => section.text).join("\n");
  for (const sentinel of ["specialty sentinel", "General combination sentinel", "High dose sentinel", "400 mg", "Continuation sentinel"]) assert.ok(text.includes(sentinel));
  assert.ok(!text.includes("Other specialty must not leak"));
  assert.ok(!text.includes("Wrong disease"));
});

test("NICE and Oklahoma sources retain publisher blocks rather than generated summaries", () => {
  const nice = extractPolicyHtml('<div class="chapter"><h2>1 Recommendations</h2><article><h3>1.1</h3><p>Criterion sentinel</p></article><article><h3>1.4</h3><p>Continuation sentinel</p></article></div><nav>Navigation sentinel</nav>', "nice");
  assert.ok(nice.sections[0].text.includes("1.4"));
  assert.ok(!nice.sections[0].text.includes("Navigation sentinel"));
  const ok = extractPolicyHtml('<div class="cmp-accordion__item"><h3>Fasenra</h3><div class="cmp-text"><p>Other diagnosis</p><ul><li>Wrong disease</li></ul><p>Phenotype Asthma</p><ul><li>Criterion sentinel<ul><li>Nested quantity sentinel</li></ul></li><li>Continuation sentinel</li></ul><p><a href="/form.pdf">PA source</a></p></div></div>', "oklahoma-benralizumab");
  const text = ok.sections[0].text;
  assert.ok(text.includes("Nested quantity sentinel") && text.includes("Continuation sentinel"));
  assert.ok(!text.includes("Wrong disease"));
});

test("PBS includes both the initial and continuing restriction rows and rejects a missing row", () => {
  const row = (code, text) => `<tr><td>${code}</td><td>Durvalumab</td><td>${text}</td></tr>`;
  const source = `<table>${row("C15500", "Initial sentinel")}${row("C12271", "Continuing sentinel 12 months")}${row("Other", "Wrong disease")}</table>`;
  const text = extractPolicyHtml(source, "pbs-durvalumab").sections.map(section => section.text).join("\n");
  assert.ok(text.includes("Initial sentinel") && text.includes("Continuing sentinel 12 months"));
  assert.ok(!text.includes("Wrong disease"));
  assert.throws(() => extractPolicyHtml(`<table>${row("C15500", "Initial sentinel")}</table>`, "pbs-durvalumab"));
});

test("source retrieval is registry-bound and contains no metadata prose in its criterion text", async () => {
  let requested;
  const document = await loadMedicationPolicySource("durvalumab-500", "us-aetna", { cacheEnabled: false, now: Date.parse("2026-10-15T16:00:00Z"), fetchImpl: async url => {
    requested = url;
    return { ok: true, headers: new Headers(), arrayBuffer: async () => Buffer.from(aetnaFixture()) };
  } });
  assert.equal(requested, "https://www.aetna.com/cpb/medical/data/900_999/0917.html");
  assert.equal(document.text, document.documents.flatMap(document => document.sections.map(section => section.text)).join("\n\n"));
  assert.equal(document.checkedOn, "2026-10-16");
  assert.match(document.hash, /^[a-f0-9]{64}$/);
  assert.ok(!document.text.includes(document.fetchedAt));
  assert.ok(!document.text.includes("열거되어 있지"));
  await assert.rejects(() => loadMedicationPolicySource("durvalumab-500", "us-oklahoma"), TypeError);
});

test("concurrent source loads share a request and successful results are cached", async () => {
  let calls = 0;
  const options = { now: Date.parse("2030-01-01T00:00:00Z"), fetchImpl: async () => {
    calls += 1;
    return { ok: true, headers: new Headers(), arrayBuffer: async () => Buffer.from(aetnaFixture()) };
  } };
  const [first, second] = await Promise.all([loadMedicationPolicySource("durvalumab-500", "us-aetna", options), loadMedicationPolicySource("durvalumab-500", "us-aetna", options)]);
  assert.equal(calls, 1);
  assert.equal(first, second);
  await loadMedicationPolicySource("durvalumab-500", "us-aetna", options);
  assert.equal(calls, 1);
});

test("every PDF page is extracted without replacing its text with a summary", async () => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    '<< /Length 53 >>\nstream\nBT /F1 12 Tf 30 700 Td (Initial sentinel 150) Tj ET\nendstream',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    '<< /Length 55 >>\nstream\nBT /F1 12 Tf 30 700 Td (Continuing sentinel 12) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const result = await extractPolicyPdf(Buffer.from(pdf));
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0].text, "Initial sentinel 150");
  assert.equal(result.sections[1].text, "Continuing sentinel 12");
});

test("source API rejects unregistered URLs and cross-origin requests before fetching", async t => {
  const mocked = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  const makeRequest = (query, headers = {}) => new Request(`http://localhost/api/medication-claim-review/policy-source?${query}`, { headers });
  for (const query of ["", "medicationId=durvalumab-500&policyId=us-oklahoma", "medicationId=durvalumab-500&policyId=kr-registered", "medicationId=durvalumab-500&policyId=https://unregistered.example/policy"]) {
    const response = await GET(makeRequest(query));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_POLICY_SOURCE");
  }
  const rejected = await GET(makeRequest("medicationId=durvalumab-500&policyId=us-aetna", { "sec-fetch-site": "cross-site" }));
  assert.equal(rejected.status, 403);
  assert.equal(mocked.mock.callCount(), 0);
});

test("network TypeErrors are source failures rather than invalid policy IDs", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  const response = await GET(new Request("http://localhost/api/medication-claim-review/policy-source?medicationId=benralizumab-30&policyId=gb-nice"));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "POLICY_SOURCE_UNAVAILABLE");
});
