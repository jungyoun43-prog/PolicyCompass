import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { declarationsFor, hasRule, rulesFor, selectorsMatching, stylesheet } from "./helpers/css.mjs";
import { renderPage } from "./helpers/render.mjs";

/** The HTML the server sends for a route's page (effects do not run). */
/**
 * The single `:is(...)` grouping rule whose selector list names every one of
 * `classes` — the way the action language shares one look across button families.
 */
function sharedGroupRule(sheet, ...classes) {
  const selector = selectorsMatching(sheet, /^:is\(/).find((candidate) => classes.every((cls) => candidate.includes(cls)));
  assert.ok(selector, `a shared :is() rule for ${classes.join(", ")}`);
  return { selector, declarations: declarationsFor(sheet, selector) };
}

/** Where the last rule for `selector` starts in the sheet: later rules win the cascade. */
function ruleOffset(sheet, selector) {
  const rule = rulesFor(sheet, selector).at(-1);
  assert.ok(rule, `a rule for ${selector}`);
  return rule.source.start.offset;
}

/** Every rule (in any container) whose selector matches `pattern`, with its declarations. */
function rulesMatching(sheet, pattern) {
  const found = [];
  sheet.walkRules((rule) => {
    if (!rule.selectors.some((selector) => pattern.test(selector.replace(/\s+/g, " ").trim()))) return;
    const declarations = {};
    rule.walkDecls((decl) => { declarations[decl.prop] = decl.value; });
    found.push({ selector: rule.selector, declarations });
  });
  return found;
}

const [controls, shellCss, gatewayCss, insightsCss, journeyCss, emrCss] = await Promise.all(
  ["src/controls.css", "src/shell.css", "src/gateway.css", "src/insights.css", "src/journey.css", "src/emr.css"].map(stylesheet),
);
const [mapHtml, connections, insights, journey, landing, gateway] = await Promise.all(
  ["/map", "/connections", "/insights", "/journey", "/patient", "/"].map(renderPage),
);
const mapScript = await readFile("src/app.js", "utf8");

test("공통 액션 언어는 주요·보조·텍스트 동작과 상태 표시를 서로 다른 형태로 구분한다", () => {
  // source-check: the action-language section comment documents the design rule in the sheet itself.
  const comments = [];
  controls.walkComments((comment) => comments.push(comment.text));
  assert.ok(comments.some((text) => /Action language/.test(text)));

  const primary = sharedGroupRule(controls, ".primary-button", ".role-action--primary", ".clinical-button--primary");
  assert.equal(primary.declarations.background, "var(--ink)");
  const secondary = sharedGroupRule(controls, ".secondary-button", ".role-action--secondary", ".import-button");
  assert.equal(secondary.declarations.background, "var(--surface-raised)");
  assert.ok(
    secondary.selector.includes(".clinical-button:where(:not(.clinical-button--primary):not(.clinical-button--confirm):not(.clinical-button--danger))"),
    "unmodified clinical buttons take the secondary look",
  );
  assert.equal(declarationsFor(controls, ":is(.text-action, .status-refresh)")["text-decoration"], "underline");
  assert.equal(declarationsFor(controls, ".danger-button").color, "var(--urgent)");
  assert.equal(declarationsFor(controls, ".action-note").color, "var(--muted)");
  const miniCondition = declarationsFor(controls, ".mini-condition-list span");
  assert.equal(miniCondition["border-radius"], "6px");
  assert.equal(miniCondition["pointer-events"], "none");
  assert.match(insights, /<p class="action-note" id="exportClinicalSnapshot">[^<]+<\/p>/);
  assert.doesNotMatch(insights, /<button[^>]*id="exportClinicalSnapshot"/);
  assert.match(journey, /<button class="secondary-button danger-button journey-clear" id="clearJourney" type="button">/);
  // .danger-button is declared after the secondary look so it wins on `secondary-button danger-button`.
  assert.ok(ruleOffset(controls, ".danger-button") > ruleOffset(controls, secondary.selector));
});

test("부가 설명은 네이티브 disclosure로 접고 핵심 안전 경고는 해당 동작 가까이에 남긴다", () => {
  for (const [html, marker] of [
    [landing, /기록이 어떻게 이동하는지 보기/],
    [gateway, /주요 기능 보기/],
    [mapHtml, /파일 확인 시 주의사항/],
    [connections, /문헌 근거 보기/],
    [insights, /최근 변화를 더해 질문 다듬기/],
    [journey, /백업 및 기록 관리/],
  ]) {
    assert.match(html, /<details\b/);
    assert.match(html, new RegExp(`<summary\\b[^>]*>(?:(?!</summary>)[\\s\\S])*?${marker.source}`), `${marker.source} is a disclosure summary`);
    assert.equal((html.match(/<details\b/g) ?? []).length, (html.match(/<summary\b/g) ?? []).length);
  }
  assert.equal(declarationsFor(controls, ".context-disclosure:not([open]) > :not(summary)").display, "none");
  assert.match(mapHtml, /현재 지도에서 아직 Journey에 저장하지 않은 기록은 가져온 내용으로 교체/);
  assert.match(journey, /복원하면 현재 Journey 전체를 교체하고, 전체 삭제는 되돌릴 수 없습니다/);
});

test("환자 기록 가져오기는 기본 화면에서 접히고 직접 진입할 때 자동으로 열린다", () => {
  const importBox = mapHtml.match(/<details class="import-box"[^>]*>/)?.[0] ?? "";
  const importSummary = mapHtml.match(/<summary class="import-heading">[\s\S]*?<\/summary>/)?.[0] ?? "";

  assert.match(importBox, /^<details class="import-box" id="import-record"/);
  assert.match(importSummary, /^<summary class="import-heading"><span class="import-heading__title-group">/);
  assert.doesNotMatch(importSummary, /<(?:div|h[1-6])\b/);
  assert.doesNotMatch(importBox, /\bopen(?:=""|\b)/, "the import box starts collapsed");
  // source-check: revealImportFromHash is a vanilla controller that reads window.location and
  // mutates the <details> element on hashchange, which needs a browser DOM to exercise.
  assert.match(mapScript, /function revealImportFromHash\(\)/);
  assert.match(mapScript, /window\.location\.hash === "#import-record"/);
  assert.match(mapScript, /elements\.importBox\.open = true/);
  assert.match(mapScript, /window\.addEventListener\("hashchange", revealImportFromHash\)/);
  for (const { selector, declarations } of rulesMatching(shellCss, /\.import-box__body > p$/)) {
    assert.notEqual(declarations.display, "none", `${selector} must not hide the import guidance`);
  }
  for (const { selector, declarations } of rulesMatching(gatewayCss, /\.role-card__features$/)) {
    assert.notEqual(declarations.display, "none", `${selector} must not hide the role features`);
  }
  assert.ok(hasRule(gatewayCss, ".role-card__features"), "the role features list is styled, not hidden");
  assert.equal(
    declarationsFor(controls, ".role-card--clinical :is(.role-action, .role-card__details > summary):focus-visible")["outline-color"],
    "var(--on-inverse)",
  );
  assert.equal(declarationsFor(controls, ".role-card--clinical .role-action:focus-visible")["outline-color"], "var(--ink)");
});

test("작은 임상 보조 동작도 최소 44px 목표 크기와 키보드 포커스를 유지한다", () => {
  assert.equal(declarationsFor(emrCss, ".clinical-body-record__action")["min-height"], "44px");
  assert.equal(declarationsFor(emrCss, ".claim-search__field button")["min-height"], "44px");
  assert.equal(declarationsFor(emrCss, ".rule-version-actions input")["min-height"], "44px");
  assert.equal(declarationsFor(emrCss, ".claim-rule-trust__link")["min-height"], "44px");
  assert.equal(declarationsFor(journeyCss, ".journey-first-action").border, "1px solid var(--line-strong)");
  assert.equal(declarationsFor(controls, ".context-disclosure > summary")["min-height"], "44px");
  assert.match(declarationsFor(controls, ".context-disclosure > summary:focus-visible").outline, /^3px solid\b/);
  assert.equal(declarationsFor(insightsCss, ".method-card.context-disclosure > summary").color, "var(--surface)");
  assert.equal(declarationsFor(insightsCss, ".method-card.context-disclosure > summary:focus-visible")["outline-color"], "var(--surface)");
  const importWarning = rulesMatching(shellCss, /\.import-box__body > \.import-warning$/);
  assert.ok(importWarning.some(({ declarations }) => declarations["font-size"] === "0.75rem"), "the import warning keeps its compact size");
});
