import assert from "node:assert/strict";
import test from "node:test";
import { splitMedicationReportRow, normalizeMedicationReportRow } from "../src/medication-report-table.js";

test("escaped pipes remain in the evidence column", () => {
  assert.deepEqual(splitMedicationReportRow(String.raw`| 호산구 | 3.4% | ✕ | Eosinophil \| WBC \| 6.4 × 10³ |`), ["호산구", "3.4%", "✕", "Eosinophil | WBC | 6.4 × 10³"]);
});
test("legacy extra cells are retained as evidence text", () => {
  assert.deepEqual(normalizeMedicationReportRow(["호산구", "✕", "2026-02-19", "WBC", "217 cells/μL"], 3), ["호산구", "✕", "2026-02-19 | WBC | 217 cells/μL"]);
});
test("short rows retain the header width and line breaks remain plain text", () => {
  assert.deepEqual(normalizeMedicationReportRow(["진단", "정보 없음"], 4), ["진단", "정보 없음", "", ""]);
  assert.deepEqual(splitMedicationReportRow("| 날짜<br />기록 |"), ["날짜\n기록"]);
});
