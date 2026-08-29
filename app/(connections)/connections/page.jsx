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
                <a href="/connections" aria-current="page">연결 보기</a>
                <a href="/insights">진료 준비</a>
                <a href="/journey">기록</a>
              </nav>
              <a className="app-header__action" href="/map#import-record">환자용 기록 가져오기</a>
            </div>
          </header>

          <main className="page-shell explorer-shell clinician-hierarchy__workspace" id="mainContent" data-graph-discovery="connections">
            <section className="page-hero explorer-intro clinician-hierarchy__summary" aria-labelledby="explorerTitle">
              <div>
                <div className="signal-kicker">
                  <span className="signal-thread" aria-hidden="true">
                    <svg viewBox="0 0 76 22">
                      <path className="signal-thread__line" d="M4 14 C17 14 20 6 33 6" />
                      <path className="signal-thread__line signal-thread__line--inferred" d="M33 6 C47 6 50 16 72 12" />
                      <circle className="signal-thread__node signal-thread__node--recorded" cx="4" cy="14" r="3" />
                      <circle className="signal-thread__node" cx="33" cy="6" r="3" />
                      <circle className="signal-thread__node signal-thread__node--inferred" cx="72" cy="12" r="3" />
                    </svg>
                  </span>
                  <span className="page-hero__eyebrow signal-kicker__label">CONNECTION EXPLORER</span>
                </div>
                <h1 id="explorerTitle">기록과 추론을 나눠 보기</h1>
                <p className="page-hero__lead">
                  노드를 선택하면 기록 근거와 문헌 관계를 따로 볼 수 있습니다.
                </p>
              </div>
              <div className="page-hero__aside">
                <p className="explorer-data-boundary">예시와 실제 기록은 섞이지 않습니다.</p>
                <a className="primary-button connections-primary-entry" id="connectionsPrimaryEntry" href="#networkScene">
                  관계 지도 바로 보기
                </a>
                <div className="scene-status" data-route-context data-selection-state aria-live="polite">
                  <span id="sceneNodeCount">0개 질환</span>
                  <strong id="sceneFocus">선택 대기</strong>
                </div>
              </div>
            </section>

            <p className="demo-mode" id="personalDemoMode" role="status" hidden>
              예시 데이터만 보는 중 · 가져온 실제 기록과 분리 · 현재 탭에서만 유지 · Journey 미저장
            </p>

            <details className="explorer-first-use context-disclosure" aria-labelledby="explorerGuideTitle" data-graph-instructions>
              <summary id="explorerGuideTitle">관계 지도 사용법 <small>선택 → 연결 → 근거</small></summary>
              <div className="context-disclosure__body">
                <ol>
                  <li><b>1</b><span><strong>노드 선택</strong>클릭하거나 Tab과 Enter를 사용합니다.</span></li>
                  <li><b>2</b><span><strong>연결 확인</strong>선명해진 점선과 관계 이름을 봅니다.</span></li>
                  <li><b>3</b><span><strong>근거 읽기</strong>상세 패널에서 설명과 출처를 확인합니다.</span></li>
                </ol>
              </div>
            </details>

            <section className="explorer-workspace clinician-hierarchy__groups" aria-label="건강 관계 탐색 장면">
              <div className="scene-shell">
                <div className="scene-legend" aria-labelledby="sceneLegendTitle" data-graph-legend>
                  <strong className="scene-legend__title" id="sceneLegendTitle">지도 표기</strong>
                  <span><i className="legend-dot condition-dot" aria-hidden="true"></i>파일 표시 · 발행기관·변조 미검증</span>
                  <span><i className="legend-dot declared-dot" aria-hidden="true"></i>본인 선택 · 의료진 미확인</span>
                  <span><i className="legend-dot focus-dot" aria-hidden="true">✓</i>현재 선택 · 이중 링</span>
                  <span id="relationshipMeaning" data-relationship-meaning><i className="legend-line legend-line--inferred" aria-hidden="true"></i>점선 · 문헌 추론, 기록 아님</span>
                </div>
                <p className="visually-hidden" id="sceneInteractionHelp">클릭 또는 Enter로 선택합니다. 노드를 드래그해 위치를 조정하고, 빈 공간 드래그 또는 방향키로 화면을 이동합니다. 휠이나 빼기·더하기 버튼으로 확대·축소하고, 숫자 0으로 초기 화면으로 돌아갑니다.</p>
                <div className="scene-controls" aria-label="지도 확대, 축소 및 초기화" aria-describedby="sceneInteractionHelp">
                  <button id="zoomOut" type="button" aria-label="지도 축소" aria-controls="networkScene">−</button>
                  <output id="zoomLevel" aria-label="현재 확대 비율">100%</output>
                  <button id="zoomIn" type="button" aria-label="지도 확대" aria-controls="networkScene">+</button>
                  <button className="reset-scene" id="resetScene" type="button" aria-controls="networkScene">초기 화면</button>
                </div>
                <svg
                  className="network-scene"
                  id="networkScene"
                  viewBox="0 0 1180 720"
                  role="group"
                  tabIndex="0"
                  aria-label="질환 관계 노드 연결 지도"
                  aria-describedby="sceneInteractionHelp relationshipMeaning"
                >
                  <g id="sceneViewport">
                    <g id="sceneEdges" aria-hidden="true"></g>
                    <g id="sceneNodes"></g>
                  </g>
                </svg>
                <div className="scene-empty" id="sceneEmpty" hidden>
                  <p className="panel-index">NO HEALTH MAP YET</p>
                  <h2>먼저 환자용 기록을 가져오세요.</h2>
                  <p>의료진에게 받은 환자용 파일과 별도 확인 코드를 건강 지도에서 대조해 가져오거나, 내 신호를 직접 더하세요.</p>
                  <a className="primary-button" href="/map#import-record">건강 지도에서 기록 가져오기</a>
                </div>
                <details className="scene-hint context-disclosure">
                  <summary>지도 조작법 보기</summary>
                  <p className="context-disclosure__body">클릭·Enter: 선택 · 노드 드래그: 위치 조정 · 빈 공간 드래그·방향키: 화면 이동 · 휠·−/+: 확대·축소 · 0: 초기 화면</p>
                </details>
              </div>

              <aside className="explorer-detail" aria-live="polite" aria-labelledby="explorerDetailTitle">
                <div className="explorer-detail__identity">
                  <p className="detail-system" id="explorerDetailSystem">연결 지도</p>
                  <div className="explorer-detail-title">
                    <span className="detail-tone" id="explorerDetailTone"></span>
                    <h2 id="explorerDetailTitle">질환 노드를 선택하세요</h2>
                  </div>
                  <p className="evidence-kind" id="explorerEvidenceKind">선택한 노드의 기록 근거 유형이 여기에 표시됩니다.</p>
                  <p className="explorer-detail-summary" id="explorerDetailSummary">
                    선택한 질환의 검사·식사·관리 메모를 이 패널에서 확인할 수 있습니다.
                  </p>
                </div>

                <div className="explorer-detail__guidance">
                  <section>
                    <h3>왜 연결되나요</h3>
                    <p id="explorerDetailRelation">선을 따라가며 가까운 질환을 선택해 보세요.</p>
                  </section>
                  <details className="context-disclosure">
                    <summary>검사·식사·관리 항목 보기</summary>
                    <div className="context-disclosure__body">
                      <section>
                        <h3>다음에 확인할 것</h3>
                        <ul id="explorerDetailChecks"></ul>
                      </section>
                      <section>
                        <h3>식사·영양 대화</h3>
                        <ul id="explorerDetailNutrition"></ul>
                      </section>
                      <section>
                        <h3>관리 대화</h3>
                        <ul id="explorerDetailCare"></ul>
                      </section>
                    </div>
                  </details>
                </div>

                <div className="explorer-detail__evidence">
                  <details className="context-disclosure">
                    <summary>문헌 근거 보기</summary>
                    <div className="context-disclosure__body">
                      <section>
                        <h3>관련 관계의 문헌 근거</h3>
                        <div className="evidence-list" id="explorerEvidenceList"></div>
                      </section>
                    </div>
                  </details>
                  <div className="explorer-next-step">
                    <p className="panel-index">NEXT · VISIT PREP</p>
                    <h3>선택한 내용을 진료 질문으로 이어 보세요.</h3>
                    <p>현재 지도와 확인 항목을 규칙 기반 질문 초안으로 정리합니다. 외부 모델은 전송 범위를 확인하고 해당 실행에 동의한 경우에만 선택합니다.</p>
                    <a className="primary-button" href="/insights" data-next-action>다음: 진료 준비 질문 만들기</a>
                  </div>
                </div>
              </aside>
            </section>
          </main>

          <footer className="app-footer">
            <span>진단 결과가 아닌 대화 준비용 지도입니다.</span>
            <span>응급 증상은 119 또는 응급실에 문의하세요.</span>
          </footer>
      <LegacyScript page='connections' />
    </>
  );
}
