"use client";

import { Button } from "@/components/ui/button";

/** Static chrome around the workspace: header, command bar, trust strip, footer. */
export function ClinicalHeader({ demo = false, onExitDemo, utilities = null, ai = null, nav = null }) {
  return (
    <header className="app-header clinical-header">
      {/* Two columns that mirror the workspace grid, so the tab bar starts where the chart column does. */}
      <div className="app-header__inner">
        <div className="app-header__identity">
          <a className="app-brand" href="/emr" aria-label="PolicyCompass Clinical EMR 홈으로 이동">
            <span className="app-brand__mark" aria-hidden="true"></span>
            <span>PolicyCompass</span>
          </a>
          {ai ? (
            <span className="header-ai-status" data-route-context data-ai-mode={ai.mode}>
              <span className={`trust-dot${ai.configured ? " is-ready" : ""}`} aria-hidden="true"></span>
              <b>모델</b>
              <span id="aiStatusDetail">{ai.detail}</span>
            </span>
          ) : null}
        </div>
        <div className="app-header__workspace">
          {nav}
          {utilities || onExitDemo ? (
            <div className="command-actions" aria-label="로컬 데이터 작업">
              <Button id="exitDemo" hidden={!demo} onClick={onExitDemo}>내 로컬 기록으로</Button>
              {utilities}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

