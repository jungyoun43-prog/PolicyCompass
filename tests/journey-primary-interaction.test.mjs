import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { pageMarkup } from "./helpers/markup.mjs";

test("Journey 변화는 저장 데이터를 수정하지 않는 하나의 명시적 기본 동작으로 연다", async () => {
  const [html, client, css] = await Promise.all([
    pageMarkup("/journey"),
    readFile(new URL("../src/journey.js", import.meta.url), "utf8"),
    readFile(new URL("../src/journey.css", import.meta.url), "utf8"),
  ]);

  assert.equal((html.match(/id="reviewJourneyChanges"/g) ?? []).length, 1);
  assert.match(html, /id="reviewJourneyChanges"[\s\S]*?aria-controls="journeyComparison"[\s\S]*?최근 변화 살펴보기/);
  assert.match(html, /id="comparisonTitle" tabindex="-1"/);
  assert.match(client, /elements\.reviewAction\.hidden = journey\.length < 2/);
  assert.match(client, /value\.replaceAll\("-", "\\u2011"\)/);
  assert.match(
    client,
    /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches \? "auto" : "smooth"/,
  );
  assert.match(client, /window\.confirm\(`\$\{snapshot\.date\} Journey 기록을 삭제할까요\?/);

  const reviewHandler = client.match(
    /elements\.reviewChanges\.addEventListener\("click",[\s\S]*?\n\}\);/,
  )?.[0] ?? "";
  assert.doesNotMatch(reviewHandler, /persistJourney|localStorage|journey\s*=/);
  assert.match(css, /\.journey-review-action \.primary-button \{ min-height: 44px; \}/);
  assert.match(css, /#comparisonTitle:focus-visible/);
});
