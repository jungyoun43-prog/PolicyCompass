import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { declarationsFor, hasRule, stylesheet } from "./helpers/css.mjs";
import { renderPage } from "./helpers/render.mjs";

const layouts = {
  "/": "app/(gateway)/layout.jsx",
  "/patient": "app/(landing)/layout.jsx",
  "/map": "app/(map)/layout.jsx",
  "/connections": "app/(connections)/layout.jsx",
  "/insights": "app/(insights)/layout.jsx",
  "/journey": "app/(journey)/layout.jsx",
};

/** The HTML the server sends for a route's page (effects do not run). */
// source-check: layouts render through RootShell, which awaits next/headers and
// cannot be imported outside a Next request, so their stylesheet imports and
// metadata wording are read from source.
const layoutSource = (route) => readFile(layouts[route], "utf8");

/** The class attribute of the first element of `tag` whose class list contains `className`. */
function classListOf(html, tag, className) {
  const pattern = new RegExp(`<${tag} class="([^"]*)"`, "g");
  for (const [, classes] of html.matchAll(pattern)) {
    const list = classes.split(" ");
    if (list.includes(className)) return list;
  }
  return null;
}

/** Every declaration in the sheet as { prop, value } pairs. */
function allDeclarations(sheet) {
  const found = [];
  sheet.walkDecls((decl) => found.push({ prop: decl.prop, value: decl.value }));
  return found;
}

const sourceRoutes = ["/", "/patient"];

test("환자 진입 화면은 공유 지원형 프레젠테이션 모듈을 사용한다", async () => {
  for (const route of sourceRoutes) {
    assert.match(await layoutSource(route), /import "[^"]*patient-presentation\.css"/, route);

    const html = await renderPage(route);
    assert.ok(classListOf(html, "section", "patient-presentation"), `${route}: 진입 섹션이 모듈 루트를 가진다`);
    assert.ok(classListOf(html, "p", "patient-presentation__identity"), `${route}: 정체성 킥커`);
    assert.ok(classListOf(html, "p", "patient-presentation__assurance"), `${route}: 안심 문구`);
  }
});

test("역할 선택은 의료진 우선 순서와 두 공간의 안전 경계를 유지한다", async () => {
  const html = await renderPage("/");
  const clinicalAction = html.indexOf("의료진 EMR 열기");
  const patientAction = html.indexOf("개인 PolicyCompass 열기");

  assert.ok(clinicalAction >= 0 && patientAction > clinicalAction);
  assert.match(html, /로컬 평가용 샌드박스 · 인증된 운영 EMR 아님/);
  assert.match(html, /개인 기록 도구 · 진단이나 치료를 대신하지 않음/);

  const clinicalCard = classListOf(html, "article", "role-card--clinical");
  const patientCard = classListOf(html, "article", "role-card--patient");
  assert.ok(clinicalCard && !clinicalCard.includes("patient-presentation__panel"), "의료진 카드는 지원형 패널 표현을 쓰지 않는다");
  assert.ok(patientCard?.includes("patient-presentation__panel"), "개인 카드는 지원형 패널 표현을 가진다");
});

test("개인 홈은 역할·데이터 경계 안내 뒤에 직접 가져오기와 예시 시작 행동을 둔다", async () => {
  const html = await renderPage("/patient");
  const hero = html.match(/<section class="landing-hero[\s\S]*?<\/section>/)?.[0] ?? "";
  const identity = hero.indexOf("POLICYCOMPASS PERSONAL · 내 기록 공간");
  const localCopy = hero.indexOf("환자용 기록을 직접 가져와 건강 지도와 다음 진료 질문으로 정리합니다");
  const startAction = hero.indexOf("환자용 기록 가져오기");
  const sampleAction = hero.indexOf("예시로 보기");

  assert.ok(identity >= 0);
  assert.ok(localCopy > identity);
  assert.ok(startAction > localCopy);
  assert.ok(sampleAction > startAction);
  assert.equal((hero.match(/data-primary-action/g) ?? []).length, 1);
  assert.match(hero, /href="\/map#import-record"/);
  assert.match(hero, /href="\/map\?sample=1"/);
  assert.match(html, /식별정보와 원문 메모를 제외/);
  assert.match(html, /외부 모델은 전송 범위를 확인하고 해당 실행에 동의한 경우에만/);
  assert.match(hero, /진단이나 처방 아님/);
  assert.doesNotMatch(hero, /로컬 AI|프론티어 AI|자동으로 이어집니다/);
});

test("환자 공개 화면은 실제 기능 수준을 넘는 AI 마케팅 표현을 노출하지 않는다", async () => {
  for (const route of ["/patient", "/map", "/connections", "/insights", "/journey"]) {
    assert.doesNotMatch(await renderPage(route), /로컬 AI|프론티어 AI|양방향 AI/, route);
    assert.doesNotMatch(await layoutSource(route), /로컬 AI|프론티어 AI|양방향 AI/, `${route} metadata`);
  }
});

test("지원형 모듈은 작은 화면의 줄바꿈과 공유 토큰만으로 표현된다", async () => {
  const sheet = await stylesheet("src/patient-presentation.css");
  const narrow = { container: "@media (max-width: 620px)" };

  assert.equal(declarationsFor(sheet, ".patient-presentation")["min-width"], "0");
  assert.equal(declarationsFor(sheet, ".patient-presentation__identity")["max-width"], "100%");
  for (const selector of [".patient-presentation__identity", ".patient-presentation__assurance"]) {
    assert.equal(declarationsFor(sheet, selector)["overflow-wrap"], "anywhere", selector);
    assert.ok(hasRule(sheet, selector, narrow), `${selector}: 좁은 화면 규칙`);
  }

  const declarations = allDeclarations(sheet);
  assert.deepEqual(declarations.filter(({ value }) => /#[\da-f]{3,8}\b/i.test(value)), []);
  assert.deepEqual(
    declarations.filter(({ prop, value }) => ["margin", "padding", "gap", "font-size"].includes(prop) && /\d+px/.test(value)),
    [],
  );
});
