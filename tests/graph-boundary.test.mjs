import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("랜딩 미리보기는 실제 진료 준비 결과물을 보여 준다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const preview = html.match(/<article class="brief-preview"[\s\S]*?<\/article>/)?.[0] ?? "";

  assert.match(preview, /예시 데이터/);
  assert.match(preview, /다음 진료에서 확인할 질문/);
  assert.match(preview, /가정 혈압/);
  assert.match(preview, /개인별 위험도나 질병 확률을 계산하지 않습니다/);
  assert.doesNotMatch(preview, /AI|LLM/);
});

test("메인 히어로는 생성 이미지와 의미 있는 대체 텍스트를 사용한다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const hero = html.match(/<figure class="landing-hero__visual"[\s\S]*?<\/figure>/)?.[0] ?? "";

  assert.match(hero, /src="\/assets\/visit-prep-hero\.png"/);
  assert.match(hero, /width="1586"/);
  assert.match(hero, /height="992"/);
  assert.match(hero, /alt="[^"]+"/);
});

test("Connections는 관리 메모를 그래프 밖 상세 패널에 둔다", async () => {
  const html = await readFile("src/connections.html", "utf8");

  assert.match(html, /id="explorerDetailChecks"/);
  assert.match(html, /id="explorerDetailNutrition"/);
  assert.match(html, /id="explorerDetailCare"/);
  assert.doesNotMatch(html, /관리 가지/);
});

test("Health Map은 12개 진료과 영역의 활성·비활성 상태를 구분한다", async () => {
  const html = await readFile("src/index.html", "utf8");

  assert.match(html, /class="human-figure__image"/);
  assert.match(html, /src="\/assets\/body-atlas-v4\.webp"/);
  assert.doesNotMatch(html, /class="human-figure__svg"/);
  assert.equal((html.match(/<button class="body-hotspot /g) ?? []).length, 12);
  assert.match(html, /신경과/);
  assert.match(html, /정신건강의학과/);
  assert.match(html, /순환기내과/);
  assert.match(html, /신장내과/);
  assert.match(html, /류마티스내과/);
  assert.match(html, /기록과 연결됨/);
  assert.match(html, /현재 기록에 없음/);
});
