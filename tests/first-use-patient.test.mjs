import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("개인 앱 진입 화면은 역할과 로컬 저장 경계 뒤에 내 기록과 예시 시작 행동을 제공한다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const entry = html.match(/<section class="landing-hero[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.match(entry, /data-entry-experience="patient"/);
  assert.match(entry, /개인용 앱입니다/);
  assert.match(entry, /의료진의 EMR 업무 공간과 분리/);
  assert.match(entry, /임상 기록을 직접 바꾸지 않음/);
  assert.match(entry, /Journey에서 직접 저장한 기록만 이 브라우저의 로컬 저장소에 남고/);
  assert.match(entry, /브라우저 데이터를 지우면 함께 삭제될 수 있습니다/);
  assert.equal((entry.match(/data-primary-action/g) ?? []).length, 1);
  assert.match(entry, /href="\/map#import-record" data-primary-action>내 기록으로 시작<\/a>/);
  assert.match(entry, /landing-button--secondary" href="\/map\?sample=1">예시로 보기<\/a>/);
});

test("개인 첫 사용 화면은 안전한 예시와 가져오기 경로를 네 단계로 설명한다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const firstUse = html.match(/<section class="patient-start-path"[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.match(firstUse, /data-first-use="patient"/);
  assert.equal((firstUse.match(/data-first-use-step=/g) ?? []).length, 4);
  for (const label of ["기록 선택", "신호 확인", "연결 살펴보기", "다음 진료 준비"]) {
    assert.match(firstUse, new RegExp(label));
  }
  assert.match(firstUse, /href="\/map\?sample=1"/);
  assert.match(firstUse, /href="\/map#import-record"/);
  assert.match(firstUse, /예시는 내 기록과 섞이지 않습니다/);
  assert.doesNotMatch(html, /href="\/emr(?:[?#"])/);
});

test("개인 첫 사용 경로는 연결 신호 모티프와 좁은 화면 단일 열을 제공한다", async () => {
  const css = await readFile("src/landing.css", "utf8");

  assert.match(css, /\.patient-start-path li:not\(:last-child\)::after/);
  assert.match(css, /\.patient-start-path__signal/);
  assert.match(css, /\.text-action\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?\.patient-start-path\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});
