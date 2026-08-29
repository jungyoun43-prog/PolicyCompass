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
                <a href="/patient" data-main-link>시작</a>
                <a href="/map">건강 지도</a>
                <a href="/connections">연결 보기</a>
                <a href="/insights" aria-current="page">진료 준비</a>
                <a href="/journey">기록</a>
              </nav>
              <a className="app-header__action" href="/map#import-record">환자용 기록 가져오기</a>
            </div>
          </header>

          <main className="page-shell insight-shell clinician-hierarchy__workspace" id="mainContent">
            <section className="page-hero insight-hero clinician-hierarchy__summary" aria-labelledby="insightTitle">
              <div>
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
                  <span className="page-hero__eyebrow signal-kicker__label">VISIT PREP · REFINED RECORD</span>
                </div>
                <h1 id="insightTitle">진료실에서 바로 꺼내 보는 질문 브리프</h1>
                <p className="page-hero__lead">
                  가져온 정제 기록을 진료 질문 다섯 개 이내로 정리합니다.
                </p>
              </div>
              <div className="page-hero__aside">
                <div className="page-hero__actions">
                  <button className="brief-action brief-action--primary" id="printBrief" type="button" disabled>
                    브리프 인쇄
                  </button>
                  <a className="brief-action brief-action--secondary" href="/map">건강 지도 편집</a>
                </div>
                <p className="action-note" id="exportClinicalSnapshot">별도 JSON은 만들지 않습니다</p>
              </div>
            </section>

            <p className="demo-mode" id="personalDemoMode" role="status" hidden>
              예시 데이터로 만든 질문 · 가져온 실제 기록과 분리 · 복사·모델 요청·Journey 저장 안 됨
            </p>

            <section className="insight-status" data-route-context aria-label="현재 브리프 범위">
              <div>
                <b>현재 브리프</b>
                <span id="questionCount">0개 질문</span>
                <span className="connection-badge" id="clinicalConnectionBadge">기록 확인 중</span>
              </div>
              <p id="coverage" role="status" aria-live="polite"></p>
              <button className="status-refresh" id="refreshClinicalSnapshot" type="button">가져온 기록 다시 확인</button>
            </section>

            <div className="brief-layout clinician-hierarchy__groups">
              <section className="question-panel" aria-labelledby="questionTitle">
                <header className="brief-section-heading">
                  <div>
                    <p className="eyebrow">QUESTIONS TO TAKE</p>
                    <h2 id="questionTitle">의료진에게 확인할 질문</h2>
                    <details className="question-examples context-disclosure context-disclosure--compact">
                      <summary>질문 예시 보기</summary>
                      <p className="context-disclosure__body">식사, 운동 횟수·시간, 약 복용 시점, 검사 준비를 물어볼 수 있습니다.</p>
                    </details>
                  </div>
                  <p id="printDate" className="print-date"></p>
                </header>

                <p className="question-safety-boundary">진료 준비용 질문 · 진단·처방·응급 판단 아님</p>

                <p className="question-selection-status" id="questionSelectionStatus" role="status" aria-live="polite" hidden>
                  진료에서 먼저 확인할 질문을 하나 선택하세요.
                </p>

                <div className="brief-empty" id="briefEmpty" data-first-use hidden>
                  <span className="brief-empty__index" aria-hidden="true">00</span>
                  <div>
                    <p className="eyebrow">WAITING FOR PATIENT TRANSFER</p>
                    <h3>환자용 기록을 직접 가져오면 질문 브리프가 시작됩니다.</h3>
                    <p>의료진에게 받은 파일과 별도 확인 코드를 대조해 가져오세요.</p>
                    <div className="first-use-actions">
                      <a className="first-use-action first-use-action--primary brief-action brief-action--primary" id="refreshClinicalSnapshotEmpty" href="/map#import-record">
                        <span>환자용 기록 가져오기</span><small>파일과 별도 확인 코드를 직접 대조</small>
                      </a>
                      <a className="first-use-action brief-action brief-action--secondary" href="/map?sample=1">
                        <span>예시로 먼저 보기</span><small>현재 탭에서만 유지 · Journey 저장 안 됨</small>
                      </a>
                    </div>
                    <p className="first-use-safety">가져온 기록은 환자용 정제 사본입니다. 예시 모드에서는 실제 기록을 표시하거나 질문을 복사·모델 요청하지 않습니다.</p>
                    <details className="context-disclosure context-disclosure--compact">
                      <summary>가져오기 과정과 데이터 안내</summary>
                      <div className="context-disclosure__body">
                        <ol className="first-use-steps" aria-label="첫 질문 브리프 만들기">
                          <li><span>1</span><div><b>의료진 내보내기</b><small>선택 환자의 정제 파일과 코드를 전달</small></div></li>
                          <li><span>2</span><div><b>환자 확인</b><small>파일과 별도 확인 코드를 직접 대조</small></div></li>
                          <li><span>3</span><div><b>질문 선택</b><small>근거를 보고 선택한 질문만 직접 전달</small></div></li>
                        </ol>
                        <p className="legacy-record-path">원본 전달 파일이 개인 보관 사본입니다. Personal은 별도의 정제 JSON을 만들지 않습니다.</p>
                      </div>
                    </details>
                  </div>
                </div>

                <ol
                  className="question-list"
                  id="questions"
                  role="radiogroup"
                  aria-labelledby="questionTitle"
                  aria-describedby="questionSelectionStatus"
                ></ol>

                <details className="question-assistant context-disclosure" id="questionAssistant">
                  <summary>
                    <span id="assistantTitle">최근 변화를 더해 질문 다듬기</span>
                    <span className="assistant-mode" id="questionProviderMode">규칙 기반 안전망</span>
                  </summary>
                  <div className="context-disclosure__body question-assistant__body">
                    <label className="assistant-report" htmlFor="patientSelfReport">
                      <span>이번 진료에서 전할 최근 변화 <small>선택 · 1,000자 이내</small></span>
                      <textarea
                        id="patientSelfReport"
                        maxLength="1000"
                        rows="3"
                        placeholder="예: 2주 전부터 밤에 기침이 잦아졌어요."
                        aria-describedby="selfReportPrivacy"
                      ></textarea>
                    </label>
                    <p className="assistant-privacy" id="selfReportPrivacy">
                      이름·연락처·주소는 적지 마세요. 자동 탐지는 완전하지 않습니다.
                    </p>

                    <fieldset className="assistant-provider">
                      <legend>선택적 모델 사용</legend>
                      <label>
                        <input type="radio" name="question-provider" value="local" defaultChecked />
                        <span><b>이 기기 모델</b><small>localhost의 Ollama · 사용할 수 없으면 규칙 기반 유지</small></span>
                      </label>
                      <label>
                        <input type="radio" name="question-provider" value="frontier" />
                        <span><b>외부 모델</b><small>선택 실행 · 전송 범위 확인과 동의 필요</small></span>
                      </label>
                    </fieldset>

                    <div className="frontier-consent" id="frontierConsentPanel" hidden>
                      <p>
                        외부 모델에는 파일에 확정으로 표시된 질환·최종 측정값과 직접 적은 최근 변화가 전송됩니다. 파일 발행기관·변조 여부는 검증되지 않으며, 최근 변화에 적은 개인정보 탐지도 완전하지 않습니다.
                      </p>
                      <label>
                        <input id="frontierConsent" type="checkbox" />
                        <span>전송 범위를 확인했고 이번 질문 생성에 동의합니다.</span>
                      </label>
                    </div>

                    <div className="question-assistant__actions">
                      <button className="brief-action brief-action--primary" id="runPatientAssistant" type="button">
                        질문 다시 제안
                      </button>
                      <button className="brief-action brief-action--secondary" id="useRuleQuestions" type="button">
                        규칙 기반으로 되돌리기
                      </button>
                      <button className="brief-action brief-action--secondary" id="sharePatientBrief" type="button" disabled>
                        선택 질문 복사
                      </button>
                    </div>
                    <p className="assistant-status" id="patientAssistantStatus" role="status" aria-live="polite">
                      모델 제안도 복사하기 전에 직접 선택하고 확인하세요.
                    </p>
                  </div>
                </details>
              </section>

              <aside className="brief-rail" aria-label="브리프 보조 정보">
                <section className="snapshot-card" aria-labelledby="snapshotTitle">
                  <p className="eyebrow">IMPORTED UNSIGNED SNAPSHOT</p>
                  <h2 id="snapshotTitle">가져온 정제 기록</h2>
                  <p className="snapshot-card__status" id="clinicalSnapshotStatus">직접 가져온 환자용 기록을 확인하는 중입니다.</p>
                  <dl className="snapshot-counts" id="clinicalSnapshotCounts"></dl>
                  <p className="snapshot-card__note">이름·등록번호·연락처·EMR 원문은 모델 입력에서 제외합니다.</p>
                </section>

                <details className="signal-card context-disclosure" aria-labelledby="signalTitle">
                  <summary id="signalTitle">
                    <span className="eyebrow">INPUT BASIS</span>
                    <strong>브리프가 참고한 신호 보기</strong>
                  </summary>
                  <div className="context-disclosure__body">
                    <div className="signal-list" id="signals"></div>
                  </div>
                </details>

                <details className="method-card context-disclosure" aria-labelledby="methodTitle">
                  <summary id="methodTitle">브리프 작성 방식과 한계</summary>
                  <div className="context-disclosure__body">
                    <ol aria-label="브리프 정리 과정">
                      <li><span>1</span>정제 기록·최근 변화 확인</li>
                      <li><span>2</span>규칙 또는 동의한 모델로 질문 제안</li>
                      <li><span>3</span>근거 대조 후 최대 다섯 개 직접 전달</li>
                    </ol>
                    <p id="disclaimer"></p>
                  </div>
                </details>
              </aside>
            </div>
          </main>

          <footer className="app-footer">
            <span>PolicyCompass Personal</span>
            <span>의학적 진단이나 처방을 제공하지 않습니다.</span>
          </footer>
      <LegacyScript page='insights' />
    </>
  );
}
