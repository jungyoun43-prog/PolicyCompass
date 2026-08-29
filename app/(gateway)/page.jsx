import { SignalKicker } from "../../components/signal-kicker.jsx";

export default function GatewayPage() {
  return (
    <>
      <a className="skip-link" href="#mainContent">역할 선택으로 건너뛰기</a>

      <header className="gateway-header">
        <div className="gateway-header__inner">
          <a className="app-brand" href="/" aria-current="page">
            <span className="app-brand__mark" aria-hidden="true"></span>
            <span>PolicyCompass</span>
          </a>
          <p className="gateway-header__status" data-route-context>데이터 입력 없음</p>
        </div>
      </header>

      <main className="gateway-shell" id="mainContent">
        <section className="gateway-intro patient-presentation" aria-labelledby="gatewayTitle">
          <div>
            <SignalKicker className="gateway-eyebrow patient-presentation__identity" label="POLICYCOMPASS · 역할 선택" />
            <h1 id="gatewayTitle">사용할 공간을 선택하세요.</h1>
            <p className="gateway-intro__lead">의료진용 진료 공간과 개인용 기록 공간 중 하나를 선택하세요.</p>
          </div>
        </section>

        <section className="role-grid" aria-label="PolicyCompass 역할 선택">
          <article className="role-card role-card--clinical">
            <div className="role-card__topline">
              <span className="role-card__icon" aria-hidden="true">EMR</span>
              <span className="role-card__badge">PRIMARY · 의료진</span>
            </div>
            <div>
              <p className="role-card__kicker">진료의 기준 공간</p>
              <h2>의료진 EMR</h2>
              <p className="role-card__summary">환자 선택부터 진료 기록, 서명, 급여 점검까지 이어갑니다.</p>
            </div>
            <a className="role-action role-action--primary" href="/emr" data-main-link>
              의료진 EMR 열기
              <span aria-hidden="true">→</span>
            </a>
            <p className="role-card__caution">로컬 평가용 샌드박스 · 인증된 운영 EMR 아님</p>
            <details className="role-card__details context-disclosure">
              <summary>주요 기능 보기</summary>
              <div className="context-disclosure__body">
                <ul className="role-card__features" aria-label="의료진 EMR 주요 기능">
                  <li>선택 환자의 임상 기록과 신체·진료과 지도</li>
                  <li>진료 완료·로컬 서명·근거 추적</li>
                  <li>환자용 정제 기록 내보내기</li>
                </ul>
              </div>
            </details>
          </article>

          <article className="role-card role-card--patient patient-presentation__panel">
            <div className="role-card__topline">
              <span className="role-card__icon" aria-hidden="true">PC</span>
              <span className="role-card__badge">PERSONAL · 개인</span>
            </div>
            <div>
              <p className="role-card__kicker">내 건강정보를 보는 공간</p>
              <h2>개인 PolicyCompass</h2>
              <p className="role-card__summary">내 건강 지도와 연결 근거를 보고 다음 진료 질문을 준비합니다.</p>
            </div>
            <a className="role-action role-action--secondary" href="/patient">
              개인 PolicyCompass 열기
              <span aria-hidden="true">→</span>
            </a>
            <p className="role-card__caution patient-presentation__assurance">개인 기록 도구 · 진단이나 치료를 대신하지 않음</p>
            <details className="role-card__details context-disclosure">
              <summary>주요 기능 보기</summary>
              <div className="context-disclosure__body">
                <ul className="role-card__features" aria-label="개인 PolicyCompass 주요 기능">
                  <li>개인 건강 지도와 질환 연결 보기</li>
                  <li>규칙 기반 진료 질문 정리</li>
                  <li>선택한 시점만 로컬 Journey에 저장</li>
                </ul>
              </div>
            </details>
          </article>
        </section>

        <section className="handoff-panel" aria-labelledby="handoffTitle">
          <details className="context-disclosure">
            <summary id="handoffTitle">의료진과 개인 사이의 기록 전달 방식</summary>
            <div className="context-disclosure__body">
              <p>의료진이 환자용 파일과 일회성 코드를 따로 전달하면, 개인이 직접 대조해 가져옵니다.</p>
              <ol className="handoff-steps" aria-label="진료 전 준비 순서">
                <li><span>1</span><strong>EMR 서명·정제</strong><small>식별정보·원문 메모 제외</small></li>
                <li><span>2</span><strong>환자 확인·가져오기</strong><small>파일과 별도 확인 코드 대조</small></li>
                <li><span>3</span><strong>진료에서 확인</strong><small>선택한 질문을 직접 전달</small></li>
              </ol>
            </div>
          </details>
        </section>

        <aside className="gateway-boundary" aria-label="데이터 경계 안내">
          <strong>이 선택 화면은 무상태입니다.</strong>
          <span>건강정보 입력란, 브라우저 저장, 서버 전송, 자동 역할 감지가 없습니다.</span>
        </aside>
      </main>

      <footer className="gateway-footer">
        <span>PolicyCompass local evaluation</span>
        <span>실제 환자정보 입력 전 기관 보안·개인정보 검토 필요</span>
      </footer>
    </>
  );
}
