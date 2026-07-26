import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("개인 앱 진입 화면은 자동 정제 연결과 AI 전송 경계 뒤에 연결 기록·예시 행동을 제공한다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const entry = html.match(/<section class="landing-hero[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.match(entry, /data-entry-experience="patient"/);
  assert.match(entry, /의료진이 서명한 기록은 환자에게 필요한 항목만 정제되어 자동으로 이어집니다/);
  assert.match(entry, /개인용 앱 · EMR 업무 공간과 분리/);
  assert.match(entry, /식별정보·원문 메모 제외/);
  assert.match(entry, /임상 기록을 직접 바꾸지 않음/);
  assert.match(entry, /로컬 AI가 기본입니다/);
  assert.match(entry, /프론티어 AI는 전송 범위를 확인하고 이번 실행에 동의한 경우에만/);
  assert.match(entry, /Journey는 선택한 기록만 이 브라우저에 저장합니다/);
  assert.equal((entry.match(/data-primary-action/g) ?? []).length, 1);
  assert.match(entry, /href="\/map#connected-record" data-primary-action>연결 기록으로 시작<\/a>/);
  assert.match(entry, /landing-button--secondary" href="\/map\?sample=1">예시로 보기<\/a>/);
  assert.doesNotMatch(entry, /JSON[^<]*(?:업로드|가져오기)|href="\/map#import-record"/);
});

test("개인 첫 사용 화면은 자동 연결부터 명시적 질문 공유까지 네 단계로 설명한다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const firstUse = html.match(/<section class="patient-start-path"[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.match(firstUse, /data-first-use="patient"/);
  assert.equal((firstUse.match(/data-first-use-step=/g) ?? []).length, 4);
  for (const label of ["정제 기록 확인", "신호 확인", "연결 살펴보기", "질문 확인·공유"]) {
    assert.match(firstUse, new RegExp(label));
  }
  assert.match(firstUse, /EMR 서명·확정 후 자동 연결된 환자용 항목/);
  assert.match(firstUse, /AI 초안을 직접 고른 뒤 필요한 질문만 의료진에게 공유/);
  assert.match(firstUse, /href="\/map\?sample=1"/);
  assert.match(firstUse, /href="\/map#connected-record"/);
  assert.match(firstUse, /예시는 내 기록이나 의료진 브리프와 섞이지 않습니다/);
  assert.doesNotMatch(firstUse, /JSON[^<]*(?:업로드|가져오기)|href="\/map#import-record"/);
  assert.doesNotMatch(html, /href="\/emr(?:[?#"])/);
});

test("개인 첫 사용 경로는 연결 신호 모티프와 좁은 화면 단일 열을 제공한다", async () => {
  const css = await readFile("src/landing.css", "utf8");

  assert.match(css, /\.patient-start-path li:not\(:last-child\)::after/);
  assert.match(css, /\.patient-start-path__signal/);
  assert.match(css, /\.patient-start-path__actions\s*\{[\s\S]*?border-top:\s*1px solid var\(--line\)/);
  assert.match(css, /\.patient-start-path__actions \.landing-button\s*\{[\s\S]*?min-height:\s*52px/);
  assert.match(css, /\.text-action\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?\.patient-start-path\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});
