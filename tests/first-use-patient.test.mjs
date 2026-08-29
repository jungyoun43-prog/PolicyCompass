import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { pageMarkup } from "./helpers/markup.mjs";

test("개인 앱 진입 화면은 직접 가져오기와 선택적 외부 모델 경계 뒤에 기록·예시 행동을 제공한다", async () => {
  const html = await pageMarkup("/patient");
  const entry = html.match(/<section class="landing-hero[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.match(entry, /data-entry-experience="patient"/);
  assert.match(entry, /환자용 기록을 직접 가져와 건강 지도와 다음 진료 질문으로 정리합니다/);
  assert.match(entry, /개인용 · 이 브라우저에 저장 · 서버 자동 전송 없음 · 진단이나 처방 아님/);
  assert.match(html, /식별정보와 원문 메모를 제외/);
  assert.match(html, /외부 모델은 전송 범위를 확인하고 해당 실행에 동의한 경우에만/);
  assert.match(html, /Journey는 선택한 기록만 현재 브라우저에 저장/);
  assert.equal((entry.match(/data-primary-action/g) ?? []).length, 1);
  assert.match(entry, /href="\/map#import-record" data-primary-action>환자용 기록 가져오기<\/a>/);
  assert.match(entry, /landing-button--secondary" href="\/map\?sample=1">예시로 보기<\/a>/);
  assert.doesNotMatch(entry, /로컬 AI|프론티어 AI|자동으로 이어집니다/);
});

test("개인 첫 사용 화면은 가져오기부터 진료 질문까지 세 단계로 요약한다", async () => {
  const html = await pageMarkup("/patient");
  const firstUse = html.match(/<section class="patient-start-path"[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.match(firstUse, /data-first-use="patient"/);
  assert.equal((firstUse.match(/data-first-use-step=/g) ?? []).length, 3);
  for (const label of ["기록 가져오기", "지도·연결 확인", "질문 준비"]) {
    assert.match(firstUse, new RegExp(label));
  }
  assert.match(firstUse, /환자용 파일과 별도 확인 코드를 대조하거나 예시를 엽니다/);
  assert.match(firstUse, /필요한 질문만 골라 진료에 가져갑니다/);
  assert.match(firstUse, /href="\/map\?sample=1"/);
  assert.match(firstUse, /href="\/map#import-record"/);
  assert.match(html, /가져온 기록과 예시는 섞이지 않으며/);
  assert.doesNotMatch(firstUse, /자동 연결|AI 초안/);
  assert.doesNotMatch(html, /href="\/emr(?:[?#"])/);
});

test("Connections와 fresh Journey는 핵심 진입을 보조 안내·백업보다 먼저 둔다", async () => {
  const [connections, journey] = await Promise.all([
    pageMarkup("/connections"),
    pageMarkup("/journey"),
  ]);

  assert.ok(connections.indexOf('id="connectionsPrimaryEntry"') < connections.indexOf('class="explorer-first-use '));
  assert.ok(journey.indexOf('journey-first-action--primary') < journey.indexOf('class="journey-data-tools '));
  assert.match(connections, /예시와 실제 기록은 섞이지 않습니다/);
  assert.match(journey, /예시는 Journey에 저장되지 않습니다/);
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
