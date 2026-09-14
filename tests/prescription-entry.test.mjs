import test from "node:test";
import assert from "node:assert/strict";
import { usesInfusionRate, prescriptionEntryInstructions } from "../src/prescription-entry.js";

test("주입속도는 정맥주입 경로에서만 전달한다", () => {
  assert.equal(usesInfusionRate("정맥주입"), true);
  for (const route of ["피하주사", "경구", "근육", "흡입", "정맥", ""]) {
    assert.equal(usesInfusionRate(route), false);
    assert.equal(prescriptionEntryInstructions({ route, instructions: "기존 안내", infusionRate: "이전 속도" }), "기존 안내");
  }
  assert.equal(prescriptionEntryInstructions({ route: "정맥주입", instructions: "기존 안내", infusionRate: " 검증용 속도 " }), "기존 안내\n주입속도: 검증용 속도");
  assert.equal(prescriptionEntryInstructions({ route: "정맥주입", instructions: "기존 안내", infusionRate: "" }), "기존 안내");
});
