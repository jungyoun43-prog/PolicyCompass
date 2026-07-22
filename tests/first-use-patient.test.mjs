import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

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
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?\.patient-start-path\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});
