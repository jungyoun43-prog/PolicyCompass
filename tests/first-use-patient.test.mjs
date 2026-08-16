import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("개인 앱 진입 화면은 직접 가져오기와 선택적 외부 모델 경계 뒤에 기록·예시 행동을 제공한다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const entry = html.match(/<section class="landing-hero[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.match(entry, /data-entry-experience="patient"/);
  assert.match(entry, /의료진이 내보낸 환자용 기록은 파일과 별도 확인 코드를 받은 뒤 내가 직접 가져옵니다/);
  assert.match(entry, /개인용 앱 · EMR 업무 공간과 분리/);
  assert.match(entry, /식별정보·원문 메모 제외/);
  assert.match(entry, /임상 기록을 직접 바꾸지 않음/);
  assert.match(entry, /질문은 검증 가능한 규칙으로 먼저 정리합니다/);
  assert.match(entry, /선택적 외부 모델은 전송 범위를 확인하고 해당 실행에 동의한 경우에만/);
  assert.match(entry, /Journey는 선택한 기록만 이 브라우저에 저장합니다/);
  assert.equal((entry.match(/data-primary-action/g) ?? []).length, 1);
  assert.match(entry, /href="\/map#import-record" data-primary-action>환자용 기록 가져오기<\/a>/);
  assert.match(entry, /landing-button--secondary" href="\/map\?sample=1">예시로 보기<\/a>/);
  assert.doesNotMatch(entry, /로컬 AI|프론티어 AI|자동으로 이어집니다/);
});

test("개인 첫 사용 화면은 직접 가져오기부터 질문 복사·직접 전달까지 네 단계로 설명한다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const firstUse = html.match(/<section class="patient-start-path"[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.match(firstUse, /data-first-use="patient"/);
  assert.equal((firstUse.match(/data-first-use-step=/g) ?? []).length, 4);
  for (const label of ["정제 기록 가져오기", "신호 확인", "연결 살펴보기", "질문 확인·직접 전달"]) {
    assert.match(firstUse, new RegExp(label));
  }
  assert.match(firstUse, /환자용 파일과 별도 확인 코드를 직접 대조해 가져오거나/);
  assert.match(firstUse, /규칙 기반 질문 초안을 확인한 뒤 필요한 질문을 복사하거나 진료에서 직접 보여줍니다/);
  assert.match(firstUse, /href="\/map\?sample=1"/);
  assert.match(firstUse, /href="\/map#import-record"/);
  assert.match(firstUse, /예시는 가져온 기록이나 의료진 브리프와 섞이지 않습니다/);
  assert.doesNotMatch(firstUse, /자동 연결|AI 초안/);
  assert.doesNotMatch(html, /href="\/emr(?:[?#"])/);
});

test("Connections와 fresh Journey는 핵심 진입을 보조 안내·백업보다 먼저 둔다", async () => {
  const [connections, journey] = await Promise.all([
    readFile("src/connections.html", "utf8"),
    readFile("src/journey.html", "utf8"),
  ]);

  assert.ok(connections.indexOf('id="connectionsPrimaryEntry"') < connections.indexOf('class="explorer-first-use"'));
  assert.ok(journey.indexOf('journey-first-action--primary') < journey.indexOf('class="journey-data-tools"'));
  assert.match(connections, /가져온 기록과 예시 데이터는 한 지도에 섞이지 않습니다/);
  assert.match(journey, /예시 모드에서는 가져온 실제 기록을 표시하거나 내보내지 않고 Journey에도 저장하지 않습니다/);
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
