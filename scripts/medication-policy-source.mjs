import { createHash } from "node:crypto";
import { load } from "cheerio";
import { medicationCoveragePolicy } from "../src/medication-coverage-policies.js";

const cache = new Map();
const pending = new Map();
const CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

// Render publisher text and list structure, without generated clinical prose.
export function policyNodeText(node, depth = 0) {
  if (!node) return "";
  if (node.type === "text") return node.data.replace(/[\t\r\n ]+/g, " ");
  const tag = node.tagName;
  if (["script", "style", "nav", "noscript", "button", "input", "svg"].includes(tag)) return "";
  if (tag === "br") return "\n";
  if (tag === "ol" || tag === "ul") return "\n" + (node.children ?? []).filter(child => child.tagName === "li").map((li, index) => {
    const content = (li.children ?? []).map(child => policyNodeText(child, depth + 1)).join("").trim();
    return `${"  ".repeat(depth)}${tag === "ol" ? `${Number(node.attribs?.start || 1) + index}.` : "•"} ${content}`;
  }).join("\n") + "\n";
  const text = (node.children ?? []).map(child => policyNodeText(child, depth)).join("");
  return /^(?:p|div|section|article|h[1-6]|table|tr)$/.test(tag || "") ? `\n${text.trim()}\n` : tag === "td" || tag === "th" ? `${text.trim()}\n` : text;
}

function cleanBlock(text) { return text.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
function block($, nodes) { return cleanBlock(nodes.toArray().map(node => policyNodeText(node)).join("\n")); }
function requireNode(nodes) { if (!nodes.length) throw new Error("공식 문서의 필수 구간을 찾지 못했습니다. 원문 구조가 변경됐을 수 있습니다."); return nodes; }
function heading($, root, text) { return requireNode(root.find("h2,h3,h4").filter((_, node) => $(node).text().trim().toLowerCase() === text.toLowerCase()).first()); }
function section($, title, nodes) {
  const text = block($, requireNode(nodes));
  if (!text) throw new Error("공식 문서 구간이 비어 있습니다.");
  const references = nodes.find("a[href]").add(nodes.filter("a[href]")).toArray().map(anchor => ({ title: $(anchor).text().trim(), href: $(anchor).attr("href") }))
    .filter(reference => reference.href && !reference.href.startsWith("#") && !reference.href.startsWith("javascript:"));
  return { title, text, references };
}

export function extractPolicyHtml(html, kind) {
  const $ = load(html);
  const sections = [];
  let selected;
  if (kind.startsWith("aetna-")) {
    const root = requireNode($(".body").first());
    const brand = root.children("h2").filter((_, node) => $(node).text().startsWith("Brand Selection")).first();
    const scope = heading($, root, "Scope of Policy");
    sections.push(section($, "Commercial policy", requireNode(brand).add(brand.nextUntil("h2,hr"))));
    sections.push(section($, scope.text(), scope.add(scope.nextUntil("ol,h2"))));
    const exclusions = heading($, root, "Exclusions").parent("li");
    sections.push(section($, "Exclusions", exclusions));
    if (kind === "aetna-benralizumab") {
      const specialties = heading($, root, "Prescribing Specialties").parent("li");
      const asthmaSpecialty = specialties.children("ol").children("li").filter((_, node) => $(node).text().trim().startsWith("Asthma:"));
      sections.push(section($, "Prescribing Specialties", specialties.children("h3,p").add(requireNode(asthmaSpecialty))));
    }
    for (const title of ["Criteria for Initial Approval", "Continuation of Therapy"]) {
      const parent = heading($, root, title).parent("li");
      const leaves = parent.children("ol").children("li");
      selected = kind === "aetna-durvalumab" ? leaves.filter((_, node) => /^(?:Non-small cell lung cancer|NSCLC)\b/i.test($(node).clone().children("ol,ul").remove().end().text().trim()))
        : leaves.filter((_, node) => $(node).children("h4").text().trim() === "Asthma");
      // Include the full NSCLC alternative group, so its original AND/OR
      // relationship remains intact rather than leaving a dangling "or".
      sections.push(section($, title, parent.children("h3,p").add(requireNode(selected))));
    }
    if (kind === "aetna-benralizumab") {
      const other = heading($, root, "Other").parent("li");
      sections.push(section($, "Other", other));
    }
    const dosage = heading($, root, "Dosage and Administration");
    sections.push(section($, dosage.text(), dosage.add(dosage.nextUntil("h2,h3"))));
    const doseHeading = kind === "aetna-durvalumab"
      ? requireNode(root.children("h3").filter((_, node) => /Unresectable Stage III/.test($(node).text())).first())
      : requireNode(root.children("h3").filter((_, node) => $(node).text().trim() === "Asthma").first());
    sections.push(section($, doseHeading.text(), doseHeading.add(doseHeading.nextUntil("h2,h3"))));
    if (kind === "aetna-benralizumab") {
      const appendix = requireNode(root.find("#appendix"));
      sections.push(section($, appendix.text(), appendix.add(appendix.nextUntil("h2"))));
    }
    selected = root;
  } else if (kind === "oklahoma-benralizumab") {
    const accordion = requireNode($(".cmp-accordion__item").filter((_, node) => $(node).children("h3").text().trim() === "Fasenra").first());
    const title = requireNode(accordion.find(".cmp-text > p").filter((_, node) => /Phenotype Asthma/.test($(node).text())).first());
    selected = title.add(requireNode(title.next("ul"))).add(title.nextAll("p").first());
    sections.push(section($, "Asthma", selected));
  } else if (kind === "nice") {
    selected = requireNode($(".chapter").first());
    sections.push(section($, selected.find("h2").first().text(), selected));
  } else if (kind === "pbs-durvalumab") {
    const rows = $("tr").filter((_, node) => ["C15500", "C12271"].includes($(node).children("td").first().text().trim()));
    if (rows.length !== 2) throw new Error("PBS 초기·지속치료 구간을 모두 찾지 못했습니다.");
    selected = rows;
    for (const row of rows.toArray()) sections.push(section($, $(row).children("td").first().text().trim(), $(row)));
  } else throw new Error("지원하지 않는 원문 형식입니다.");
  const references = sections.flatMap(section => section.references);
  return { sections, references };
}

export async function extractPolicyPdf(bytes) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false });
  try {
    const document = await task.promise;
    const sections = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const content = await (await document.getPage(number)).getTextContent();
      let text = "", previous;
      for (const item of content.items) {
        if (typeof item.str !== "string" || !item.str.trim()) continue;
        const newLine = previous && (previous.hasEOL || Math.abs(item.transform[5] - previous.transform[5]) > 2 || item.transform[4] < previous.transform[4]);
        text += `${text ? newLine ? "\n" : " " : ""}${item.str}`;
        previous = item;
      }
      if (!text.trim()) throw new Error("PDF 페이지에서 원문을 읽지 못했습니다.");
      sections.push({ title: String(number), text: cleanBlock(text) });
    }
    return { sections, references: [] };
  } finally { await task.destroy(); }
}

function kindFor(medicationId, policyId) {
  if (policyId === "us-aetna") return medicationId === "durvalumab-500" ? "aetna-durvalumab" : "aetna-benralizumab";
  if (policyId === "us-oklahoma") return "oklahoma-benralizumab";
  if (policyId === "gb-nice") return "nice";
  return "pbs-durvalumab";
}

export async function loadMedicationPolicySource(medicationId, policyId, { fetchImpl = globalThis.fetch, now = Date.now(), cacheEnabled = true } = {}) {
  const policy = medicationCoveragePolicy(medicationId, policyId);
  if (!policy || policy.countryCode === "KR") throw new TypeError("등록된 해외 보험 기준을 선택해 주세요.");
  const key = `${medicationId}/${policyId}`;
  if (cacheEnabled && cache.get(key)?.expires > now) return cache.get(key).value;
  if (cacheEnabled && pending.has(key)) return pending.get(key);
  const work = (async () => {
    const documents = await Promise.all(policy.sources.map(async source => {
      const response = await fetchImpl(source.url, { redirect: "error", signal: AbortSignal.timeout(35_000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; PolicyCompass/1.0)", accept: "text/html,application/pdf" }, cache: "no-store" });
      if (!response.ok) throw new Error("공식 원문 서버가 응답하지 않았습니다.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error("공식 문서가 처리 가능한 파일 크기를 초과했습니다. 내용을 자르지 않았습니다.");
      const pdf = source.url.endsWith(".pdf");
      const extracted = pdf ? await extractPolicyPdf(bytes) : extractPolicyHtml(new TextDecoder().decode(bytes), kindFor(medicationId, policyId));
      const references = extracted.references.map(reference => ({ title: reference.title, url: new URL(reference.href, source.url).href })).filter(reference => /^https?:/.test(reference.url));
      return { title: source.title, url: source.url, sections: extracted.sections, references, lastModified: response.headers?.get("last-modified") || "" };
    }));
    const text = documents.flatMap(document => document.sections.map(section => section.text)).join("\n\n");
    if (!text.trim()) throw new Error("공식 원문이 비어 있습니다.");
    const value = { medicationId, policyId, text, documents, original: true, fetchedAt: new Date(now).toISOString(),
      checkedOn: new Date(now + 9 * 3600_000).toISOString().slice(0, 10), hash: createHash("sha256").update(text).digest("hex") };
    if (cacheEnabled) cache.set(key, { expires: now + CACHE_MS, value });
    return value;
  })();
  if (cacheEnabled) pending.set(key, work);
  try { return await work; } finally { if (cacheEnabled) pending.delete(key); }
}
