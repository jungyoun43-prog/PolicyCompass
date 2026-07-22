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
  const patientAction = html.indexOf("개인 VitaGraph 열기");

  assert.ok(clinicalAction >= 0 && patientAction > clinicalAction);
  assert.match(html, /로컬 평가용 샌드박스 · 인증된 운영 EMR 아님/);
  assert.match(html, /개인 기록 도구 · 진단이나 치료를 대신하지 않음/);
  assert.doesNotMatch(html, /patient-presentation__panel[^>]*role-card--clinical/);
});

test("개인 홈은 로컬 데이터 안내 뒤에 가져오기와 예시 행동을 순서대로 둔다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const hero = html.match(/<section class="landing-hero[\s\S]*?<\/section>/)?.[0] ?? "";
  const identity = hero.indexOf("VITAGRAPH PERSONAL · 내 기록 공간");
  const localCopy = hero.indexOf("이 기기에서 처리");
  const importAction = hero.indexOf("기록 파일 가져오기");
  const sampleAction = hero.indexOf("예시 기록으로 먼저 보기");

  assert.ok(identity >= 0);
  assert.ok(localCopy > identity);
  assert.ok(importAction > localCopy);
  assert.ok(sampleAction > importAction);
  assert.match(hero, /원문 서버 전송 없음 · 진단·처방 아님/);
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
