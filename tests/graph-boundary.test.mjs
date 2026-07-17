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

test("Connections는 관리 메모를 그래프 밖 상세 패널에 둔다", async () => {
  const html = await readFile("src/connections.html", "utf8");

  assert.match(html, /id="explorerDetailChecks"/);
  assert.match(html, /id="explorerDetailNutrition"/);
  assert.match(html, /id="explorerDetailCare"/);
  assert.doesNotMatch(html, /관리 가지/);
});

test("Health Map은 활성·비활성 신체 부위를 텍스트로 구분한다", async () => {
  const html = await readFile("src/index.html", "utf8");

  assert.match(html, /class="human-figure__image"/);
  assert.match(html, /src="\/assets\/body-atlas-v4\.webp"/);
  assert.doesNotMatch(html, /class="human-figure__svg"/);
  assert.equal((html.match(/<button class="body-hotspot /g) ?? []).length, 5);
  assert.match(html, /기록과 연결됨/);
  assert.match(html, /현재 기록에 없음/);
});
