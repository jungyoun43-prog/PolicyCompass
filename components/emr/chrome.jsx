"use client";

import { Button } from "@/components/ui/button";

/** Static chrome around the workspace: header, command bar, trust strip, footer. */
export function ClinicalHeader({ demo = false, onExitDemo, utilities = null }) {
  return (
    <header className="app-header clinical-header">
      <div className="app-header__inner">
        <a className="app-brand" href="/emr" aria-label="PolicyCompass Clinical EMR 홈으로 이동">
          <span className="app-brand__mark" aria-hidden="true"></span>
          <span>PolicyCompass <b>Clinical</b></span>
        </a>
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

export function TrustStrip({ ai }) {
  return (
    <section className="trust-strip" aria-label="AI 검토 상태">
      <div data-route-context>
        <span className={`trust-dot${ai.configured ? " is-ready" : ""}`} id="aiStatusDot" aria-hidden="true"></span>
        <b id="aiStatusLabel">{ai.label}</b>
        <span id="aiStatusDetail">{ai.detail}</span>
      </div>
    </section>
  );
}

export function ClinicalFooter() {
  return (
    <footer className="app-footer clinical-footer">
      <span>PolicyCompass Clinical</span>
      <span>확정 기록과 보조 초안을 분리합니다.</span>
    </footer>
  );
}

export function SafetyNotes() {
  return (
    <details className="context-disclosure context-disclosure--footer emr-safety-notes">
      <summary>데이터·임상 한계 안내</summary>
      <div className="context-disclosure__body">
        <p>환자 기록은 현재 브라우저에만 저장되며 내보낸 백업 파일은 암호화되지 않습니다. 데이터 작업 전 선택 환자를 다시 확인하세요.</p>
        <p>AI 초안·급여 사전점검·적정성 예상은 진단, 처방, 서명된 임상 판단이나 보험자의 최종 지급 결정을 대신하지 않습니다.</p>
      </div>
    </details>
  );
}
