"use client";

import { Button } from "@/components/ui/button";

/** Static chrome around the workspace: header, command bar, trust strip, footer. */
export function ClinicalHeader() {
  return (
    <header className="app-header clinical-header">
      <div className="app-header__inner">
        <a className="app-brand" href="/emr" aria-label="PolicyCompass Clinical EMR 홈으로 이동">
          <span className="app-brand__mark" aria-hidden="true"></span>
          <span>PolicyCompass <b>Clinical</b></span>
        </a>
      </div>
    </header>
  );
}

export function CommandBar({ demo, onExitDemo, utilities }) {
  return (
    <section className="clinical-command" aria-labelledby="emrTitle">
      <div className="command-title">
        <div className="signal-kicker">
          <span className="signal-thread signal-thread--quiet" aria-hidden="true">
            <svg viewBox="0 0 76 22" focusable="false">
              <path className="signal-thread__line" d="M5 15 C18 15 20 6 33 6 S49 16 70 11" />
              <path className="signal-thread__line signal-thread__line--inferred" d="M33 6 C43 3 54 4 70 11" />
              <circle className="signal-thread__node signal-thread__node--recorded" cx="5" cy="15" r="3" />
              <circle className="signal-thread__node signal-thread__node--recorded" cx="33" cy="6" r="3" />
              <circle className="signal-thread__node signal-thread__node--inferred" cx="70" cy="11" r="3" />
            </svg>
          </span>
          <span className="page-hero__eyebrow signal-kicker__label">의료진 워크스페이스</span>
        </div>
        <div className="command-title__row">
          <h1 id="emrTitle">오늘 진료</h1>
          <p className="command-title__path">환자 선택 → 기록 → 서명</p>
        </div>
      </div>
      <div className="command-actions" aria-label="로컬 데이터 작업">
        <Button id="exitDemo" type="button" hidden={!demo} onClick={onExitDemo}>내 로컬 기록으로</Button>
        {utilities}
      </div>
    </section>
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
