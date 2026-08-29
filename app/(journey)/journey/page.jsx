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
                <a href="/insights">진료 준비</a>
                <a href="/journey" aria-current="page">기록</a>
              </nav>
              <a className="app-header__action" href="/map#import-record">환자용 기록 가져오기</a>
            </div>
          </header>

          <main className="page-shell journey-shell clinician-hierarchy__workspace" id="mainContent">
            <section className="page-hero journey-intro clinician-hierarchy__summary" aria-labelledby="journeyPageTitle">
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
                  <span className="page-hero__eyebrow signal-kicker__label">PATIENT JOURNEY</span>
                </div>
                <h1 id="journeyPageTitle">한 장면이 아니라 변화를 봅니다.</h1>
                <p className="page-hero__lead" data-route-context>
                  저장한 건강 지도의 최근 변화를 비교합니다. 기록은 현재 브라우저의 이 기기에만 저장됩니다.
                </p>
              </div>
            </section>

            <section className="journey-workspace clinician-hierarchy__groups" aria-labelledby="journeyTitle">
              <div className="journey-heading">
                <div>
                  <p className="panel-index">LOCAL SNAPSHOTS</p>
                  <h2 id="journeyTitle">나의 건강 지도 기록</h2>
                </div>
              </div>
              <div className="journey-review-action" id="journeyReviewAction" hidden>
                <button
                  className="primary-button"
                  id="reviewJourneyChanges"
                  type="button"
                  aria-controls="journeyComparison"
                >
                  최근 변화 살펴보기
                </button>
                <span>최근 두 기록을 비교하며 저장된 Journey 기록은 바꾸지 않습니다.</span>
              </div>
              <div className="journey-empty" id="journeyEmpty" data-first-use hidden>
                <p className="panel-index">FIRST SNAPSHOT · 01</p>
                <h3>첫 기록을 남기면 다음 시점부터 변화가 이어집니다.</h3>
                <div className="journey-first-actions">
                  <a className="journey-first-action journey-first-action--primary primary-button" href="/map#import-record">
                    <span>첫 지도 만들기</span><small>환자용 기록 가져오기 · 내 신호 직접 추가</small>
                  </a>
                  <a className="journey-first-action secondary-button" href="/map?sample=1">
                    <span>예시로 흐름 보기</span><small>가져온 기록과 분리 · 현재 탭에서만 유지</small>
                  </a>
                </div>
                <p className="journey-first-safety">질환 항목·입력 확인 신호·측정값만 저장합니다. 차이는 원인·호전·악화를 뜻하지 않으며, 예시는 Journey에 저장되지 않습니다.</p>
                <details className="journey-first-guide context-disclosure context-disclosure--compact">
                  <summary>첫 Journey 기록 만드는 법</summary>
                  <div className="context-disclosure__body">
                    <ol className="journey-first-steps" aria-label="첫 Journey 기록 만들기">
                      <li><span>1</span><div><b>정제 기록 가져오기</b><small>환자용 파일과 확인 코드 대조</small></div></li>
                      <li><span>2</span><div><b>시점 확인</b><small>내 입력과 기록 날짜 대조</small></div></li>
                      <li><span>3</span><div><b>Journey에 저장</b><small>다음 기록부터 차이 비교</small></div></li>
                    </ol>
                  </div>
                </details>
              </div>
              <div className="timeline" id="journeyTimeline" aria-label="건강 지도 시간선"></div>
              <details className="journey-data-tools context-disclosure" aria-labelledby="journeyDataToolsTitle">
                <summary id="journeyDataToolsTitle">백업 및 기록 관리</summary>
                <div className="context-disclosure__body">
                  <p className="journey-storage-note" id="journeyStorageNote">
                    다른 기기와 자동 동기화되지 않습니다. 복원하면 현재 Journey 전체를 교체하고, 전체 삭제는 되돌릴 수 없습니다.
                  </p>
                  <div className="journey-data-actions" aria-label="Journey 데이터 관리">
                    <button className="secondary-button" id="exportJourney" type="button" disabled>백업 내보내기</button>
                    <button className="secondary-button" id="importJourneyTrigger" type="button" aria-controls="journeyImport">백업 복원</button>
                    <input className="journey-file-input" id="journeyImport" type="file" accept="application/json,.json" tabIndex="-1" aria-label="Journey JSON 백업 파일 선택" />
                    <button className="secondary-button danger-button journey-clear" id="clearJourney" type="button">전체 기록 지우기</button>
                  </div>
                  <p className="journey-transfer-status" id="journeyTransferStatus" role="status" aria-live="polite"></p>
                </div>
              </details>
            </section>

            <section className="journey-comparison" id="journeyComparison" aria-live="polite">
              <div className="journey-comparison__header">
                <p className="panel-index">CHANGE SUMMARY</p>
                <h2 id="comparisonTitle" tabIndex="-1">최근 두 시점 비교</h2>
                <p id="comparisonCopy">기록이 두 개 이상이면 최근 변화가 자동으로 표시됩니다.</p>
              </div>
              <div className="comparison-detail" id="journeyComparisonDetail" hidden>
                <div className="journey-story-grid" aria-label="최근 기록 변화 이야기">
                  <article className="journey-story-card journey-story-card--changed" data-story-section="changed">
                    <span className="journey-story-card__step" aria-hidden="true">01</span>
                    <p className="panel-index">WHAT CHANGED</p>
                    <h3>기록에서 관찰된 변화</h3>
                    <div className="journey-story-list" id="journeyChanges">
                      <p className="journey-story-empty">기록이 두 개 이상이면 관찰된 차이를 여기에 정리합니다.</p>
                    </div>
                  </article>

                  <article className="journey-story-card journey-story-card--context" data-story-section="context">
                    <span className="journey-story-card__step" aria-hidden="true">02</span>
                    <p className="panel-index">POSSIBLE CONTEXT</p>
                    <h3>함께 살펴볼 수 있는 맥락</h3>
                    <p className="journey-story-guardrail">가능한 추론 맥락 · 인과관계나 이번 변화의 원인 아님</p>
                    <div className="journey-context-list" id="journeyContexts">
                      <p className="journey-story-empty">현재 기록의 질환 항목 조합에 연결되는 일반 근거만 표시합니다.</p>
                    </div>
                  </article>

                  <article className="journey-story-card journey-story-card--next" data-story-section="next">
                    <span className="journey-story-card__step" aria-hidden="true">03</span>
                    <p className="panel-index">REVIEW NEXT</p>
                    <h3>다음 기록에서 확인할 것</h3>
                    <div className="journey-story-list" id="journeyNextReviews">
                      <p className="journey-story-empty">기준점이 생기면 다음에 대조할 항목을 정리합니다.</p>
                    </div>
                  </article>

                  <article className="journey-story-card journey-story-card--prior" data-story-section="comparison">
                    <span className="journey-story-card__step" aria-hidden="true">04</span>
                    <p className="panel-index">PRIOR SNAPSHOT</p>
                    <h3>이전 시점과 비교 범위</h3>
                    <p id="journeyPriorComparison">아직 이전 시점이 없습니다.</p>
                  </article>
                </div>

                <div className="change-columns">
                  <article><span className="change-mark added">+</span><h3>새로 표시</h3><div id="addedSignals"></div></article>
                  <article><span className="change-mark steady">=</span><h3>계속 표시</h3><div id="steadySignals"></div></article>
                  <article><span className="change-mark removed">−</span><h3>이번엔 없음</h3><div id="removedSignals"></div></article>
                </div>
                <section className="measurement-comparison" aria-labelledby="measurementComparisonTitle">
                  <div>
                    <p className="panel-index">MEASUREMENT DELTA</p>
                    <h3 id="measurementComparisonTitle">같은 단위 측정값 변화</h3>
                  </div>
                  <p>최근 두 기록에서 이름과 단위가 같은 숫자만 계산합니다. 차이의 원인이나 호전·악화를 판단하지 않습니다.</p>
                  <div className="measurement-change-list" id="measurementChanges"></div>
                </section>
              </div>
            </section>
            <p className="journey-disclaimer">표시·수치 변화는 질환의 발생·원인·호전·완치를 뜻하지 않습니다. EMR에서 정제된 기록과 직접 입력한 상태 사이의 표시 차이입니다.</p>
          </main>

          <footer className="app-footer">
            <span>PolicyCompass Personal</span>
            <span>의학적 진단이나 처방을 제공하지 않습니다.</span>
          </footer>
      <LegacyScript page='journey' />
    </>
  );
}
