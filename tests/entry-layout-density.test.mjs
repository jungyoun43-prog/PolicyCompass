import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { declarationsFor, hasRule, selectorsMatching, stylesheet } from "./helpers/css.mjs";
import { renderPage } from "./helpers/render.mjs";

/** The HTML the server sends for a route's page (effects do not run). */
const MOBILE = "@media (max-width: 620px)";
const TABLET = "@media (max-width: 800px)";
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";

/** Every value the sheet declares for `prop`, anywhere, so retired values can be ruled out. */
function declaredValues(sheet, prop) {
  const values = [];
  sheet.walkDecls(prop, (decl) => values.push(decl.value));
  return values;
}

/** A stand-in element for the landing reveal controller: class list plus a fixed viewport offset. */
function fakeElement(top = 0) {
  const classes = new Set();
  return {
    classList: { add: (name) => classes.add(name), contains: (name) => classes.has(name) },
    getBoundingClientRect: () => ({ top }),
    has: (name) => classes.has(name),
  };
}

/**
 * Evaluates src/landing.js against a minimal fake document. The controller
 * runs on import, so each scenario imports a fresh module instance (the query
 * string only distinguishes instances). Returns what the controller did.
 */
async function runLandingReveal({ reduceMotion, tops, instance }) {
  const targets = tops.map(fakeElement);
  const documentElement = fakeElement();
  const observer = { callback: null, options: null, observed: [], unobserved: [] };
  const mediaQueries = [];
  const previous = { document: globalThis.document, window: globalThis.window, IntersectionObserver: globalThis.IntersectionObserver };

  globalThis.document = { querySelectorAll: () => targets, documentElement };
  globalThis.window = {
    innerHeight: 1000,
    matchMedia: (query) => { mediaQueries.push(query); return { matches: reduceMotion }; },
  };
  globalThis.IntersectionObserver = class {
    constructor(callback, options) { observer.callback = callback; observer.options = options; }
    observe(target) { observer.observed.push(target); }
    unobserve(target) { observer.unobserved.push(target); }
  };
  try {
    await import(`../src/landing.js?instance=${instance}`);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
  return { targets, documentElement, observer, mediaQueries };
}

test("개인 홈은 핵심 제목을 두 의미 단위로 고정하고 첫 화면 높이를 제한한다", async () => {
  const [html, css] = await Promise.all([renderPage("/patient"), stylesheet("src/landing.css")]);

  const title = html.match(/<h1 id="landingTitle">[\s\S]*?<\/h1>/)?.[0] ?? "";
  assert.equal((title.match(/<span>/g) ?? []).length, 2);
  assert.match(title, /<span>내 건강 기록을<\/span>/);
  assert.match(title, /<span><em>내가 이어 보는<\/em> 공간\.<\/span>/);
  assert.equal(declarationsFor(css, ".landing-hero h1 > span").display, "block");
  assert.equal(declarationsFor(css, ".landing-hero")["min-height"], "clamp(440px, 32vw, 480px)");
  assert.equal(declarationsFor(css, ".landing-page .landing-shell")["padding-top"], "var(--space-6)");
  assert.ok(!declaredValues(css, "min-height").includes("650px"), "예전 650px 첫 화면 높이는 남아 있지 않아야 합니다");
  assert.ok(!declaredValues(css, "padding").includes("112px 0"), "예전 112px 세로 여백은 남아 있지 않아야 합니다");
});

test("첫 사용 안내는 데스크톱에서 압축된 세 열, 모바일에서 한 열로 흐른다", async () => {
  const css = await stylesheet("src/landing.css");

  assert.equal(declarationsFor(css, ".patient-start-path ol")["grid-template-columns"], "repeat(3, minmax(0, 1fr))");
  assert.equal(declarationsFor(css, ".patient-start-path ol", { container: MOBILE })["grid-template-columns"], "1fr");
});

test("개인 홈은 중복 개인 보관 안내 없이 진료 준비 CTA로 바로 이어진다", async () => {
  const [html, css] = await Promise.all([renderPage("/patient"), stylesheet("src/landing.css")]);

  assert.doesNotMatch(html, /<section class="beta/);
  assert.doesNotMatch(html, /class="beta__(?:copy|aside|boundary)"/);
  assert.doesNotMatch(html, /id="data-boundary"/);
  assert.doesNotMatch(html, /href="#data-boundary"/);
  assert.doesNotMatch(html, /MY HEALTH COPY/);
  assert.doesNotMatch(html, /정제 JSON은 환자가 직접 선택해 보관하는 사본입니다/);
  assert.doesNotMatch(html, /<section class="data-boundary/);
  assert.match(html, /<\/details>\s*<section class="closing"/);
  assert.deepEqual(selectorsMatching(css, /\.beta(?:__|(?![\w-]))/), []);
});

test("다음 진료 CTA는 제목과 분리된 균형 잡힌 열에서 반응형으로 흐른다", async () => {
  const css = await stylesheet("src/landing.css");
  const closing = declarationsFor(css, ".closing");
  const actions = declarationsFor(css, ".closing .landing-actions");

  assert.equal(closing["grid-template-columns"], "1fr");
  assert.equal(closing["justify-items"], "center");
  assert.equal(closing.border, "1px solid var(--line)");
  assert.equal(actions["grid-template-columns"], "repeat(2, minmax(0, 1fr))");
  assert.equal(actions["justify-self"], "center");
  assert.equal(declarationsFor(css, ".closing .landing-actions", { container: MOBILE })["grid-template-columns"], "1fr");
  assert.notEqual(declarationsFor(css, ".closing h2")["white-space"], "nowrap");
});

test("개인 홈의 아래 섹션은 동작 줄이기를 존중하는 스크롤 리빌을 사용한다", async () => {
  const [html, css, page, loader] = await Promise.all([
    renderPage("/patient"),
    stylesheet("src/landing.css"),
    // source-check: LegacyScript renders nothing on the server and its loader table is module-private,
    // so which controller the page starts is only visible in source.
    readFile(new URL("../app/(landing)/patient/page.jsx", import.meta.url), "utf8"),
    readFile(new URL("../components/legacy-script.jsx", import.meta.url), "utf8"),
  ]);

  assert.equal((html.match(/\sdata-reveal="true"/g) ?? []).length, 4);
  assert.match(page, /<LegacyScript page=.landing./);
  assert.match(loader, /landing: \(\) => import\("\.\.\/src\/landing\.js"\)/);
  assert.ok(hasRule(css, ".reveal-ready [data-reveal]"));
  const reducedMotion = declarationsFor(css, ".reveal-ready [data-reveal]", { container: REDUCED_MOTION });
  assert.equal(reducedMotion.transition, "none");
  assert.equal(reducedMotion.opacity, "1");

  // The controller reveals what is already on screen, observes the rest once, and stops observing after reveal.
  const animated = await runLandingReveal({ reduceMotion: false, tops: [100, 2000, 3000, 4000], instance: "animated" });
  assert.deepEqual(animated.mediaQueries, ["(prefers-reduced-motion: reduce)"]);
  assert.ok(animated.documentElement.has("reveal-ready"));
  assert.deepEqual(animated.targets.map((target) => target.has("is-revealed")), [true, false, false, false]);
  assert.deepEqual(animated.observer.observed, animated.targets.slice(1));
  animated.observer.callback([
    { isIntersecting: true, target: animated.targets[1] },
    { isIntersecting: false, target: animated.targets[2] },
  ]);
  assert.deepEqual(animated.targets.map((target) => target.has("is-revealed")), [true, true, false, false]);
  assert.deepEqual(animated.observer.unobserved, [animated.targets[1]]);

  // With reduced motion the page never enters the reveal state, so nothing is hidden waiting for an observer.
  const still = await runLandingReveal({ reduceMotion: true, tops: [100, 2000], instance: "still" });
  assert.deepEqual(still.mediaQueries, ["(prefers-reduced-motion: reduce)"]);
  assert.ok(!still.documentElement.has("reveal-ready"));
  assert.equal(still.observer.callback, null);
  assert.deepEqual(still.targets.map((target) => target.has("is-revealed")), [false, false]);
});

test("역할 선택 카드는 데스크톱에서 같은 열 너비와 같은 세로 리듬을 사용한다", async () => {
  const css = await stylesheet("src/gateway.css");
  const grid = declarationsFor(css, ".role-grid");

  assert.equal(grid["grid-template-columns"], "repeat(2, minmax(0, 1fr))");
  assert.equal(grid["align-items"], "stretch");
  assert.equal(declarationsFor(css, ".role-card").gap, "var(--space-5)");
  assert.notEqual(declarationsFor(css, ".role-grid", { container: TABLET })["grid-template-columns"], "1fr");
  assert.equal(declarationsFor(css, ".role-grid", { container: MOBILE })["grid-template-columns"], "1fr");
});

test("Journey 첫 기록 안내는 핵심 행동을 먼저 두고 사용법·데이터 도구를 접어 둔다", async () => {
  const [html, css] = await Promise.all([renderPage("/journey"), stylesheet("src/journey.css")]);
  const empty = declarationsFor(css, ".journey-empty");

  assert.match(html, /class="journey-empty"[\s\S]*?class="journey-first-actions"[\s\S]*?class="journey-first-steps"/);
  assert.match(html, /<details class="journey-first-guide context-disclosure/);
  assert.match(html, /<details class="journey-data-tools context-disclosure"/);
  assert.doesNotMatch(html, /class="journey-empty__visual"/);
  assert.equal(empty.width, "100%");
  assert.equal(empty["max-width"], "72rem");
  assert.equal(empty["grid-template-columns"], "minmax(0, 1fr)");
  assert.equal(declarationsFor(css, ".journey-first-action")["min-height"], "56px");
  assert.equal(declarationsFor(css, ".journey-first-steps li")["min-height"], "84px");
});

test("Journey 변화 비교는 제목을 전체 너비 상단에 두고 세부 내용을 아래에 펼친다", async () => {
  const [html, css] = await Promise.all([renderPage("/journey"), stylesheet("src/journey.css")]);

  assert.match(html, /<section class="journey-comparison"[\s\S]*?<div class="journey-comparison__header">[\s\S]*?<div class="comparison-detail"[^>]*>/);
  assert.equal(declarationsFor(css, ".journey-comparison")["grid-template-columns"], "minmax(0, 1fr)");
  assert.equal(declarationsFor(css, ".journey-comparison__header").width, "100%");
  assert.equal(declarationsFor(css, ".comparison-detail").display, "grid");
});
