import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("랜딩 미리보기는 질환 노드만 관계선으로 보여 준다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const preview = html.match(/<article class="preview-network"[\s\S]*?<\/article>/)?.[0] ?? "";

  assert.match(preview, /고혈압/);
  assert.match(preview, /당뇨병/);
  assert.match(preview, /이상지질/);
  assert.doesNotMatch(preview, /다음 확인/);
  assert.doesNotMatch(preview, /preview-orb/);
});

test("메인 히어로는 같은 크기의 작은 노드와 외부 라벨을 사용한다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const orbit = html.match(/<figure class="hero-orbit"[\s\S]*?<\/figure>/)?.[0] ?? "";

  assert.equal((orbit.match(/<circle class="orbit-node__dot"[^>]*r="22"/g) ?? []).length, 5);
  assert.equal((orbit.match(/class="orbit-node__caption"/g) ?? []).length, 5);
  assert.doesNotMatch(orbit, /orbit-label--main/);
  assert.doesNotMatch(orbit, /r="54"/);
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
