import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoutes = [
  ["/", "src/gateway.html"],
  ["/patient", "src/landing.html"],
];

test("환자 진입 화면은 공유 지원형 프레젠테이션 모듈을 사용한다", async () => {
  for (const [route, file] of sourceRoutes) {
    const html = await readFile(file, "utf8");

    assert.match(html, /href="\/patient-presentation\.css"/, route);
    assert.match(html, /class="[^"]*patient-presentation(?:\s|\")/, route);
    assert.match(html, /patient-presentation__identity/, route);
    assert.match(html, /patient-presentation__assurance/, route);
  }
});

test("역할 선택은 의료진 우선 순서와 두 공간의 안전 경계를 유지한다", async () => {
  const html = await readFile("src/gateway.html", "utf8");
  const clinicalAction = html.indexOf("의료진 EMR 열기");
  const patientAction = html.indexOf("개인 PolicyCompass 열기");

  assert.ok(clinicalAction >= 0 && patientAction > clinicalAction);
  assert.match(html, /로컬 평가용 샌드박스 · 인증된 운영 EMR 아님/);
  assert.match(html, /개인 기록 도구 · 진단이나 치료를 대신하지 않음/);
  assert.doesNotMatch(html, /patient-presentation__panel[^>]*role-card--clinical/);
});

test("개인 홈은 역할·데이터 경계 안내 뒤에 직접 가져오기와 예시 시작 행동을 둔다", async () => {
  const html = await readFile("src/landing.html", "utf8");
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
  for (const file of ["src/landing.html", "src/index.html", "src/connections.html", "src/insights.html", "src/journey.html"]) {
    const html = await readFile(file, "utf8");
    assert.doesNotMatch(html, /로컬 AI|프론티어 AI|양방향 AI/, file);
  }
});

test("지원형 모듈은 작은 화면의 줄바꿈과 공유 토큰만으로 표현된다", async () => {
  const css = await readFile("src/patient-presentation.css", "utf8");

  assert.match(css, /min-width:\s*0/);
  assert.match(css, /max-width:\s*100%/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /(?:^|[;:{\s])(?:margin|padding|gap|font-size):\s*\d+px/m);
});
