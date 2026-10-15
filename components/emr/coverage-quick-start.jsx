"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { createDemoEmrState } from "../../src/emr-demo-state.js";
import { findMedicationInCatalog } from "../../src/medication-catalog.js";
import { currentEncounterFor } from "../../lib/emr/selectors.js";
import { openCoverageWindow } from "./coverage-window.js";

const SEEN_KEY = "policycompass-coverage-guide-seen";

export function CoverageQuickStart() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try { setOpen(localStorage.getItem(SEEN_KEY) !== "1"); }
      catch { setOpen(true); }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const launchSample = () => {
    const demo = createDemoEmrState();
    const patient = demo.patients.find(({ name }) => name === "김비타");
    const medication = findMedicationInCatalog("benralizumab-30");
    const opened = openCoverageWindow({ patient, encounter: currentEncounterFor(patient), medicationId: medication.id, prescription: medication.dosing });
    setError(opened ? "" : "검토 창이 차단됐습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.");
  };

  return (
    <details className="coverage-quick-start" id="coverageQuickStart" open={open} onToggle={(event) => {
      const expanded = event.currentTarget.open;
      setOpen(expanded);
      if (!expanded) { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* The guide still closes when storage is unavailable. */ } }
    }}>
      <summary><h2>처음이라면, 예시로 급여 확인해 보세요</h2><span>{open ? "안내 접기" : "안내 펼치기"}</span></summary>
      <div className="coverage-quick-start__body">
        <div>
          <p>예시 환자 김비타와 벤라리주맙으로 실제 검토 화면을 열어 봅니다. 저장된 환자 기록은 바뀌지 않습니다.</p>
          <ol>
            <li>예시 검토를 열면 등록된 급여기준과 진료 기록을 대조합니다.</li>
            <li>기준별 판정과 부족한 근거를 확인합니다.</li>
            <li>다른 모델을 비교하려면 <b>검토 설정</b>에서 선택하고 다시 검토합니다.</li>
          </ol>
          <p className="coverage-quick-start__own">직접 확인: 환자 선택 → 오늘 진료의 <b>약 처방</b> → 약품 검색 → <b>급여인정확인</b></p>
        </div>
        <div className="coverage-quick-start__action">
          <Button variant="primary" id="startCoverageSample" onClick={launchSample} aria-haspopup="dialog">예시 급여 검토 열기</Button>
          <small>예시 자료에 대한 참고용 검토입니다.</small>
        </div>
      </div>
      {error ? <p className="coverage-quick-start__error" role="alert">{error}</p> : null}
    </details>
  );
}
