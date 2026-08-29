import { LegacyScript } from "../../../components/legacy-script.jsx";

export default function Page() {
  return (
    <>
          <a className="skip-link" href="#mainContent">본문으로 건너뛰기</a>
          <header className="app-header">
            <div className="app-header__inner">
              <a className="app-brand" href="/patient" aria-label="PolicyCompass Personal 시작 화면으로 이동">
                <span className="app-brand__mark" aria-hidden="true"></span>
                <span>PolicyCompass Personal</span>
              </a>
              <nav className="app-nav" aria-label="주요 화면">
                <a href="/patient" aria-current="page" data-main-link>시작</a>
                <a href="/map">건강 지도</a>
                <a href="/connections">연결 보기</a>
                <a href="/insights">진료 준비</a>
                <a href="/journey">기록</a>
              </nav>
              <a className="app-header__action" href="/map#import-record">환자용 기록 가져오기</a>
            </div>
          </header>

          <main className="page-shell landing-shell" id="mainContent">
            <section className="landing-hero patient-presentation" aria-labelledby="landingTitle" data-entry-experience="patient">
              <div className="landing-hero__copy">
                <p className="eyebrow patient-presentation__identity signal-kicker">
                  <span className="signal-thread" aria-hidden="true">
                    <svg viewBox="0 0 76 22" focusable="false">
                      <path className="signal-thread__line" d="M5 15 C18 15 20 6 33 6 S49 16 70 11" />
                      <path className="signal-thread__line signal-thread__line--inferred" d="M33 6 C43 3 54 4 70 11" />
                      <circle className="signal-thread__node signal-thread__node--recorded" cx="5" cy="15" r="3" />
                      <circle className="signal-thread__node signal-thread__node--recorded" cx="33" cy="6" r="3" />
                      <circle className="signal-thread__node signal-thread__node--inferred" cx="70" cy="11" r="3" />
                    </svg>
                  </span>
                  <span className="signal-kicker__label">POLICYCOMPASS PERSONAL · 내 기록 공간</span>
                </p>
                <h1 id="landingTitle">
                  <span>내 건강 기록을</span>
                  <span><em>내가 이어 보는</em> 공간.</span>
                </h1>
                <p className="landing-hero__lead">
                  환자용 기록을 직접 가져와 건강 지도와 다음 진료 질문으로 정리합니다.
                </p>
                <div className="landing-hero__boundary" aria-label="개인 앱의 역할과 저장 방식" data-route-context>
                  <p className="patient-presentation__assurance">개인용 · 이 브라우저에 저장 · 서버 자동 전송 없음 · 진단이나 처방 아님</p>
                </div>
                <div className="landing-actions">
                  <a className="landing-button landing-button--primary" href="/map#import-record" data-primary-action>환자용 기록 가져오기</a>
                  <a className="landing-button landing-button--secondary" href="/map?sample=1">예시로 보기</a>
                </div>
              </div>
              <figure className="landing-hero__visual">
                <img
                  src="/assets/visit-prep-hero.png"
                  width="1586"
                  height="992"
                  fetchPriority="high"
                  alt="집에서 건강 기록을 살피며 다음 진료를 준비하는 보호자"
                />
              </figure>
            </section>

            <section className="patient-start-path" aria-labelledby="patientStartTitle" data-first-use="patient" data-reveal>
              <header>
                <p className="eyebrow">첫 사용 · 3단계</p>
                <h2 id="patientStartTitle">처음이라면 세 단계면 됩니다.</h2>
                <p>파일이 없어도 안전한 예시로 먼저 볼 수 있습니다.</p>
              </header>
              <ol aria-label="PolicyCompass Personal 첫 사용 순서">
                <li data-first-use-step="record">
                  <span className="patient-start-path__signal" aria-hidden="true">01</span>
                  <div><strong>기록 가져오기</strong><p>환자용 파일과 별도 확인 코드를 대조하거나 예시를 엽니다.</p></div>
                </li>
                <li data-first-use-step="map">
                  <span className="patient-start-path__signal" aria-hidden="true">02</span>
                  <div><strong>지도·연결 확인</strong><p>기록 항목과 직접 더한 항목, 문헌 관계를 구분해 봅니다.</p></div>
                </li>
                <li data-first-use-step="prepare">
                  <span className="patient-start-path__signal" aria-hidden="true">03</span>
                  <div><strong>질문 준비</strong><p>근거를 확인하고 필요한 질문만 골라 진료에 가져갑니다.</p></div>
                </li>
              </ol>
              <div className="patient-start-path__actions">
                <a className="landing-button landing-button--primary" href="/map#import-record">환자용 기록 가져오기</a>
                <a className="text-action" href="/map?sample=1">예시로 시작 <span aria-hidden="true">→</span></a>
              </div>
            </section>

            <section className="outcome" aria-labelledby="outcomeTitle" data-reveal>
              <header className="section-intro">
                <p className="eyebrow">VISIT PREP</p>
                <h2 id="outcomeTitle">진료실에서 바로 꺼내 볼 순서로 정리합니다.</h2>
                <p>확인할 내용을 최대 다섯 개 질문으로 모읍니다.</p>
                <a className="text-action" href="/insights">진료 준비 화면 보기 <span aria-hidden="true">↗</span></a>
              </header>

              <article className="brief-preview" aria-label="예시 진료 준비 브리프">
                <header className="brief-preview__header">
                  <div>
                    <p>POLICYCOMPASS · SAMPLE BRIEF</p>
                    <h3>다음 진료에서 확인할 질문</h3>
                  </div>
                  <span>예시 데이터</span>
                </header>
                <div className="brief-preview__signals" aria-label="브리프가 참고한 예시 신호">
                  <span>혈압 기록</span><span>공복혈당</span><span>LDL</span><span>속쓰림</span>
                </div>
                <ol className="brief-preview__questions">
                  <li>
                    <b>01</b>
                    <div><strong>가정 혈압은 어떤 시간대와 방식으로 기록할까요?</strong><p>한 번의 값보다 반복 측정 맥락을 함께 확인하기 위해서입니다.</p></div>
                  </li>
                  <li>
                    <b>02</b>
                    <div><strong>혈당과 지질 수치는 언제 다시 검사하면 좋을까요?</strong><p>현재 값과 다음 추적 시점을 한 자리에서 확인하기 위해서입니다.</p></div>
                  </li>
                  <li>
                    <b>03</b>
                    <div><strong>식사·취침 시간과 속쓰림 기록을 같이 볼까요?</strong><p>증상이 나타나는 맥락을 구체적으로 설명하기 위해서입니다.</p></div>
                  </li>
                </ol>
                <footer>예시 브리프 · 개인별 위험도나 질병 확률을 계산하지 않습니다.</footer>
              </article>
            </section>

            <details className="workflow context-disclosure" data-reveal>
              <summary>기록이 어떻게 이동하는지 보기</summary>
              <div className="context-disclosure__body">
                <ol className="workflow__steps">
                  <li><span>01</span><div><h3>파일 직접 받기</h3><p>의료진에게 환자용 파일과 별도 확인 코드를 받습니다.</p></div></li>
                  <li><span>02</span><div><h3>근거 구분하기</h3><p>파일 표시, 본인 선택, 문헌 기반 추론을 구분합니다.</p></div></li>
                  <li><span>03</span><div><h3>질문 가져가기</h3><p>필요한 질문만 골라 복사하거나 진료에서 보여줍니다.</p></div></li>
                </ol>
              </div>
            </details>

            <section className="closing" aria-labelledby="closingTitle" data-reveal>
              <div>
                <p className="eyebrow">BEFORE YOUR NEXT VISIT</p>
                <h2 id="closingTitle"><span>다음 진료 전에,</span><span>한 번 정리해 보세요.</span></h2>
                <p>가져온 기록과 예시는 섞이지 않으며, 진료에서 보여줄 질문은 내가 직접 선택합니다.</p>
              </div>
              <div className="landing-actions">
                <a className="landing-button landing-button--primary" href="/map#import-record">환자용 기록 가져오기</a>
                <a className="landing-button landing-button--secondary" href="/map?sample=1">예시로 먼저 보기</a>
              </div>
            </section>
          </main>

          <details className="context-disclosure context-disclosure--footer">
            <summary>데이터·안전 안내</summary>
            <div className="context-disclosure__body">
              <p>환자용 파일은 식별정보와 원문 메모를 제외하지만 평문·미서명 사본입니다. 파일과 다른 경로로 받은 확인 코드를 직접 대조하세요.</p>
              <p>기본 질문은 규칙으로 정리합니다. 외부 모델은 전송 범위를 확인하고 해당 실행에 동의한 경우에만 사용하며, Journey는 선택한 기록만 현재 브라우저에 저장합니다.</p>
              <p>PolicyCompass는 진단·처방 또는 응급 판단을 제공하지 않습니다.</p>
            </div>
          </details>

          <footer className="app-footer">
            <span>PolicyCompass Personal</span>
            <span>의학적 진단이나 처방을 제공하지 않습니다.</span>
          </footer>
      <LegacyScript page='landing' />
    </>
  );
}
