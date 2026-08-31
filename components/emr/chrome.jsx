"use client";

import { Button } from "@/components/ui/button";

/** Static chrome around the workspace: header, command bar, trust strip, footer. */
export function ClinicalHeader({ demo = false, onExitDemo, utilities = null, ai = null }) {
  return (
    <header className="app-header clinical-header">
      <div className="app-header__inner">
        <a className="app-brand" href="/emr" aria-label="PolicyCompass Clinical EMR 홈으로 이동">
          <span className="app-brand__mark" aria-hidden="true"></span>
          <span>PolicyCompass <b>Clinical</b></span>
        </a>
        {ai ? (
          <span className="header-ai-status" data-route-context>
            <span className={`trust-dot${ai.configured ? " is-ready" : ""}`} id="aiStatusDot" aria-hidden="true"></span>
            <b id="aiStatusLabel">{ai.label}</b>
            <span id="aiStatusDetail">{ai.detail}</span>
          </span>
        ) : null}
        {utilities || onExitDemo ? (
          <div className="command-actions" aria-label="로컬 데이터 작업">
            <Button id="exitDemo" hidden={!demo} onClick={onExitDemo}>내 로컬 기록으로</Button>
            {utilities}
          </div>
        ) : null}
      </div>
    </header>
  );
}

