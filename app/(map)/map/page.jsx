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
                <a href="/map" aria-current="page">건강 지도</a>
                <a href="/connections">연결 보기</a>
                <a href="/insights">진료 준비</a>
                <a href="/journey">기록</a>
              </nav>
              <a className="app-header__action" href="/map#import-record">환자용 기록 가져오기</a>
            </div>
          </header>

          <main className="page-shell map-shell clinician-hierarchy__workspace" id="mainContent">
            <section className="page-hero map-hero clinician-hierarchy__summary" aria-labelledby="pageTitle">
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
                  <span className="page-hero__eyebrow signal-kicker__label">PERSONAL HEALTH RELATION MAP</span>
                </div>
                <h1 id="pageTitle">내 몸의 신호를 연결해서 보기</h1>
                <p className="page-hero__lead">
                  가져온 기록과 직접 적은 신호를 몸의 위치와 연결해 봅니다.
                </p>
              </div>
              <div className="page-hero__aside">
                <p className="page-hero__note" data-route-context>
                  진단 결과가 아닌 대화 준비용 지도입니다. 최종 판단은 의료진과 함께하세요.
                </p>
                <div className="page-hero__actions">
                  <button className="secondary-button" id="sourceToggle" type="button">정보 원칙 보기</button>
                </div>
              </div>
            </section>

            <div className="dashboard clinician-hierarchy__groups" data-graph-discovery="map">
              <aside className="panel input-panel" aria-labelledby="inputTitle">
                <div className="panel-heading">
                  <div>
                    <p className="panel-index">MY SIGNALS</p>
                    <h2 id="inputTitle">내 기록 확인·추가</h2>
                  </div>
                  <div className="input-panel__heading-actions">
                    <button className="demo-trigger" id="loadDemo" type="button">
                      예시 기록 불러오기
                    </button>
                    <span className="session-badge">SESSION ONLY</span>
                  </div>
                </div>

                <form id="healthForm" noValidate>
                  <label className="field-label" htmlFor="healthNote">증상과 검사 수치</label>
                  <p className="demo-mode" id="demoMode" role="status" hidden>
                    예시 데이터만 보는 중 · 가져온 실제 기록은 표시·내보내기·Journey 저장 안 됨
                  </p>
                  <textarea
                    id="healthNote"
                    rows="5"
                    spellCheck="false"
                    aria-invalid="false"
                    aria-describedby="inputHint formError"
                    placeholder="증상이나 최근 검사 수치를 직접 입력해 주세요"
                  ></textarea>
                  <p className="field-hint" id="inputHint">
                    예: 혈압 148/94, 공복혈당 132, 속쓰림, 무릎 통증
                  </p>

                  <p className="form-error" id="formError" role="alert" hidden>
                    증상이나 수치를 입력하거나 질환을 하나 이상 선택해 주세요.
                  </p>

                  <fieldset className="signal-fieldset">
                    <legend>이미 알고 있는 질환</legend>
                    <div className="chip-grid" id="conditionChips">
                      <button type="button" className="signal-chip" data-condition="hypertension" aria-pressed="false">고혈압</button>
                      <button type="button" className="signal-chip" data-condition="diabetes" aria-pressed="false">당뇨병</button>
                      <button type="button" className="signal-chip" data-condition="dyslipidemia" aria-pressed="false">이상지질혈증</button>
                      <button type="button" className="signal-chip" data-condition="migraine" aria-pressed="false">편두통</button>
                      <button type="button" className="signal-chip" data-condition="reflux" aria-pressed="false">위식도역류</button>
                      <button type="button" className="signal-chip" data-condition="asthma" aria-pressed="false">천식</button>
                      <button type="button" className="signal-chip" data-condition="mood" aria-pressed="false">우울·불안</button>
                      <button type="button" className="signal-chip" data-condition="arthritis" aria-pressed="false">관절염</button>
                    </div>
                  </fieldset>

                  <div className="form-actions">
                    <button className="primary-button" id="analyzeButton" type="submit">
                      건강 지도 업데이트
                    </button>
                    <button className="secondary-button" id="resetButton" type="button">
                      내 입력 비우기
                    </button>
                  </div>
                </form>

                <section className="safety-banner safety-banner--input" aria-label="응급 상황 안내">
                  <strong>응급 증상은 지도보다 먼저 대응하세요.</strong>
                  <span>가슴 통증, 심한 호흡 곤란, 마비, 의식 변화, 자해·자살 생각이 있으면 119 또는 가까운 응급실로 가세요.</span>
                </section>

                <details className="import-box" id="import-record" aria-labelledby="fhirImportTitle">
                  <summary className="import-heading">
                    <span className="import-heading__title-group">
                      <span className="import-tag">PATIENT TRANSFER · FILE + CODE</span>
                      <span className="import-heading__title" id="fhirImportTitle">환자용 기록 가져오기</span>
                    </span>
                    <span className="import-heading__hint">파일 + 확인 코드</span>
                  </summary>
                  <div className="import-box__body">
                    <label className="transfer-code-field" htmlFor="transferCode">
                      <span>1. 파일과 다른 경로로 받은 확인 코드</span>
                      <input
                        id="transferCode"
                        name="transferCode"
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        autocapitalize="characters"
                        spellCheck="false"
                        maxLength="33"
                        pattern="VG-[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}-[0-9A-HJKMNP-TV-Z]{6}"
                        placeholder="VG-…"
                        aria-invalid="false"
                        aria-errormessage="fhirResult"
                        aria-describedby="recordImportHelp recordFileStatus recordImportWarning"
                      />
                    </label>
                    <p id="recordImportHelp">확인 코드를 입력하고 환자용 파일을 선택하세요.</p>
                    <input
                      id="fhirFile"
                      type="file"
                      accept="application/json,.json"
                      tabIndex="-1"
                      aria-label="PolicyCompass 환자 전달 JSON 파일"
                      aria-describedby="recordImportHelp recordFileStatus recordImportWarning"
                    />
                    <div className="import-file-actions">
                      <button className="import-button" id="selectRecordFile" type="button" aria-controls="fhirFile">
                        2. 기록 파일 선택
                      </button>
                      <button className="primary-button" id="importRecordButton" type="button" disabled>
                        3. 본인 기록 확인 후 교체
                      </button>
                    </div>
                    <p className="record-file-status" id="recordFileStatus" role="status" aria-live="polite">
                      확인 코드를 먼저 입력한 뒤 환자용 기록 파일을 선택하세요.
                    </p>
                    <p className="import-warning" id="recordImportWarning">
                      <strong>현재 지도에서 아직 Journey에 저장하지 않은 기록은 가져온 내용으로 교체됩니다.</strong> 기존 Journey는 바뀌지 않습니다.
                    </p>
                    <details className="context-disclosure context-disclosure--compact">
                      <summary>파일 확인 시 주의사항</summary>
                      <div className="context-disclosure__body">
                        <p>파일에는 이름·등록번호가 없습니다. 내 기록인지와 별도 경로의 코드가 맞는지 직접 확인하세요.</p>
                        <p>평문·미서명 사본이므로 발행기관과 변조 여부는 검증되지 않습니다.</p>
                      </div>
                    </details>
                    <div className="import-result" id="fhirResult" role="status" aria-live="polite" hidden></div>
                  </div>
                </details>

                <div className="detected-summary" aria-live="polite">
                  <span>확인 필요 신호 · 진단 아님</span>
                  <strong id="conditionCount">0개</strong>
                  <div className="mini-condition-list" id="miniConditionList"></div>
                </div>
                <button className="journey-save" id="saveJourney" type="button" disabled>
                  <span>현재 지도를 Journey에 저장</span><small>브라우저 로컬 기록</small>
                </button>
              </aside>

              <section className="panel body-panel" id="health-map" aria-labelledby="bodyTitle" tabIndex="-1">
                <div className="panel-heading">
                  <div>
                    <p className="panel-index">BODY VIEW</p>
                    <h2 id="bodyTitle">몸에서 먼저 보기</h2>
                  </div>
                  <span className="map-status" id="mapStatus">분석 대기</span>
                </div>

                <details className="map-first-use context-disclosure" aria-labelledby="mapInstructionsTitle" data-graph-instructions>
                  <summary id="mapInstructionsTitle">지도 사용법 <small>입력 → 표식 → 관계</small></summary>
                  <div className="context-disclosure__body">
                    <ol id="mapInstructions">
                      <li><b>1</b><span>증상·수치를 입력하거나 환자용 기록을 가져옵니다.</span></li>
                      <li><b>2</b><span>3D 모형을 돌려 보고 색 있는 표식을 선택합니다.</span></li>
                      <li><b>3</b><span>관계 화면에서 출처와 근거를 확인합니다.</span></li>
                    </ol>
                  </div>
                </details>

                <section className="map-legend" aria-labelledby="mapLegendTitle" data-graph-legend>
                  <div className="map-legend__heading">
                    <p className="panel-index">MAP LEGEND</p>
                    <h3 id="mapLegendTitle">지도 표기</h3>
                  </div>
                  <ul className="map-legend__items">
                    <li>
                      <i className="map-legend__symbol map-legend__symbol--recorded" aria-hidden="true"></i>
                      <span><strong>기록 신호</strong><small>직접 입력하거나 확인 후 가져온 정제 건강 항목</small></span>
                    </li>
                    <li id="mapRelationshipMeaning" data-relationship-meaning>
                      <i className="map-legend__symbol map-legend__symbol--inferred" aria-hidden="true"></i>
                      <span><strong>추론 관계</strong><small>기록과 문헌을 바탕으로 지도에서 제안 · 진단 아님</small></span>
                    </li>
                    <li>
                      <i className="map-legend__symbol map-legend__symbol--selected" aria-hidden="true">✓</i>
                      <span><strong>현재 선택</strong><small>이중 테두리와 체크로 함께 표시</small></span>
                    </li>
                  </ul>
                </section>

                <div className="body-stage"
                  aria-describedby="mapInstructions mapRelationshipMeaning bodyKeyText"
                  data-body-3d
                  data-body-model="/assets/body-atlas-3d-v4.glb"
                  data-body-viewer-module="/vendor/model-viewer-4.3.1.min.js"
                  data-body-context="patient"
                  data-body-alt="회색 신체 외피와 내부 장기를 함께 확인하는 회전 가능한 3D 건강 지도"
                >
                  <div className="human-figure" aria-label="신체 부위별 건강 신호">
                    <img
                      className="human-figure__image"
                      src="/assets/body-atlas-v5.webp"
                      width="1024"
                      height="1536"
                      alt=""
                      aria-hidden="true"
                      decoding="async"
                      fetchPriority="high"
                    />

                    <button className="body-hotspot hotspot-neuro" data-area="neuro" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">신경과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                    <button className="body-hotspot hotspot-mental" data-area="mental" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">정신건강의학과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                    <button className="body-hotspot hotspot-sensory" data-area="sensory" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">안과와 이비인후과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                    <button className="body-hotspot hotspot-cardio" data-area="cardio" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">순환기내과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                    <button className="body-hotspot hotspot-respiratory" data-area="respiratory" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">호흡기내과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                    <button className="body-hotspot hotspot-digestive" data-area="digestive" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">소화기내과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                    <button className="body-hotspot hotspot-endocrine" data-area="endocrine" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">내분비내과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                    <button className="body-hotspot hotspot-renal" data-area="renal" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">신장내과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                    <button className="body-hotspot hotspot-pelvic" data-area="pelvic" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">산부인과와 비뇨의학과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                    <button className="body-hotspot hotspot-musculoskeletal" data-area="musculoskeletal" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">정형외과와 재활의학과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                    <button className="body-hotspot hotspot-rheumatology" data-area="rheumatology" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">류마티스내과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                    <button className="body-hotspot hotspot-dermatology" data-area="dermatology" type="button" aria-pressed="false">
                      <span className="body-hotspot__core" aria-hidden="true"></span>
                      <span className="visually-hidden">피부과와 알레르기내과: 현재 기록에 연결된 신호 없음</span>
                    </button>
                  </div>
                </div>

                <section className="panel detail-panel" aria-labelledby="detailTitle">
                  <div className="detail-identity">
                    <p className="panel-index">SELECTED NODE</p>
                    <div className="detail-title-row">
                      <span className="detail-tone" id="detailTone" aria-hidden="true"></span>
                      <div>
                        <span className="detail-system" id="detailSystem">심혈관</span>
                        <h2 id="detailTitle">질환 노드를 선택하세요</h2>
                      </div>
                    </div>
                    <p className="detail-summary" id="detailSummary">
                      선택한 질환이 신체의 어느 부위와 연결되는지, 다음 진료에서 무엇을 확인할지 보여 줍니다.
                    </p>
                  </div>

                  <div className="detail-column">
                    <h3>왜 연결되나요</h3>
                    <p id="detailRelation">그래프의 질환 노드를 누르면 관계 설명이 표시됩니다.</p>
                  </div>
                  <details className="detail-column context-disclosure">
                    <summary>확인할 데이터와 관리 대화</summary>
                    <div className="context-disclosure__body detail-column__expanded">
                      <section>
                        <h3>확인할 데이터</h3>
                        <ul id="detailChecks">
                          <li>증상 발생 시점</li>
                          <li>검사실 결과</li>
                          <li>복용 중인 약</li>
                        </ul>
                      </section>
                      <section>
                        <h3>관리 대화</h3>
                        <ul id="detailCare">
                          <li>의료진과 우선순위 정하기</li>
                          <li>생활 변화의 안전성 확인</li>
                          <li>추적 시점 기록하기</li>
                        </ul>
                      </section>
                    </div>
                  </details>
                </section>

                <details className="department-disclosure context-disclosure context-disclosure--compact">
                  <summary>진료과별 위치 보기 <small>12개 영역</small></summary>
                  <div className="context-disclosure__body">
                    <div className="department-index" aria-label="진료과별 연결 상태">
                      <div className="body-caption" data-area="neuro"><span className="body-caption__title">뇌·신경</span><span className="body-caption__department">신경과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                      <div className="body-caption" data-area="mental"><span className="body-caption__title">마음·수면</span><span className="body-caption__department">정신건강의학과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                      <div className="body-caption" data-area="sensory"><span className="body-caption__title">눈·귀·코</span><span className="body-caption__department">안과·이비인후과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                      <div className="body-caption" data-area="cardio"><span className="body-caption__title">심장·혈관</span><span className="body-caption__department">순환기내과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                      <div className="body-caption" data-area="respiratory"><span className="body-caption__title">폐·호흡</span><span className="body-caption__department">호흡기내과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                      <div className="body-caption" data-area="digestive"><span className="body-caption__title">위·장·간</span><span className="body-caption__department">소화기내과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                      <div className="body-caption" data-area="endocrine"><span className="body-caption__title">대사·호르몬</span><span className="body-caption__department">내분비내과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                      <div className="body-caption" data-area="renal"><span className="body-caption__title">신장·수분</span><span className="body-caption__department">신장내과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                      <div className="body-caption" data-area="pelvic"><span className="body-caption__title">골반·비뇨</span><span className="body-caption__department">산부인과·비뇨의학과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                      <div className="body-caption" data-area="musculoskeletal"><span className="body-caption__title">뼈·관절</span><span className="body-caption__department">정형외과·재활의학과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                      <div className="body-caption" data-area="rheumatology"><span className="body-caption__title">면역·관절</span><span className="body-caption__department">류마티스내과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                      <div className="body-caption" data-area="dermatology"><span className="body-caption__title">피부·알레르기</span><span className="body-caption__department">피부과·알레르기내과</span><span className="body-caption__status">현재 기록에 없음</span></div>
                    </div>
                  </div>
                </details>

                <div className="body-key">
                  <span className="body-key__selection" role="status" aria-live="polite" data-selection-state>
                    <span className="key-swatch" id="bodyKeySwatch" aria-hidden="true"></span>
                    <span id="bodyKeyText">입력 신호를 분석하면 관련 부위가 표시됩니다.</span>
                  </span>
                  <span className="body-key__legend"><i className="body-key__dot body-key__dot--active" aria-hidden="true"></i>기록과 연결됨 · 지도 제안, 진단 아님</span>
                  <span className="body-key__legend"><i className="body-key__dot" aria-hidden="true"></i>현재 기록에 없음</span>
                </div>
              </section>

              <section className="panel connection-portal" aria-labelledby="graphTitle">
                <div className="connection-copy">
                  <p className="panel-index">NEXT · CONNECTION EXPLORER</p>
                  <h2 id="graphTitle">
                    <span>다음은 관계와 근거를</span>
                    <span>확인할 차례입니다.</span>
                  </h2>
                  <div className="connection-support">
                    <p className="connection-description">
                      <span>기록과 문헌 관계를 구분해 보여 줍니다. 노드를 선택해 근거를 확인하세요.</span>
                    </p>
                    <div className="connection-actions">
                      <a className="primary-button" href="/connections" data-connections-link data-next-action>다음: 관계와 근거 확인하기</a>
                      <span className="connection-actions__status" role="status" aria-live="polite">
                        <strong id="graphPreviewCount">0개</strong>
                        <span>질환을 연결할 준비가 됐어요</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="connection-preview">
                  <p className="connection-preview__notice">표기 예시 · 실제 환자 기록 아님</p>
                  <svg viewBox="0 0 520 290" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                    <path className="preview-connection preview-connection--inferred" d="M92 198 C138 123 180 151 227 92 S342 82 417 137" />
                    <path className="preview-connection preview-connection--inferred" d="M227 92 C247 148 286 184 353 218" />
                    <path className="preview-connection preview-connection--inferred" d="M92 198 C177 231 270 232 353 218" />
                    <g className="preview-node preview-node--recorded tone-one">
                      <circle cx="92" cy="198" r="18" />
                      <text className="preview-node__label" x="92" y="232">가져온 항목 A</text>
                      <text className="preview-node__type" x="92" y="251">파일 표시 · 출처 미검증</text>
                    </g>
                    <g className="preview-node preview-node--recorded tone-two">
                      <circle cx="227" cy="92" r="18" />
                      <text className="preview-node__label" x="227" y="126">본인 선택 B</text>
                      <text className="preview-node__type" x="227" y="145">의료진 확인 안 됨</text>
                    </g>
                    <g className="preview-node preview-node--inferred tone-three">
                      <circle cx="353" cy="218" r="18" />
                      <text className="preview-node__label" x="353" y="252">관련 항목 C</text>
                      <text className="preview-node__type" x="353" y="271">문헌 관계 · 기록 아님</text>
                    </g>
                    <g className="preview-node preview-node--inferred tone-four">
                      <circle cx="417" cy="137" r="18" />
                      <text className="preview-node__label" x="417" y="171">관련 항목 D</text>
                      <text className="preview-node__type" x="417" y="190">문헌 관계 · 기록 아님</text>
                    </g>
                  </svg>
                </div>
              </section>

            </div>

          </main>

          <footer className="app-footer">
            <span>PolicyCompass Personal</span>
            <span>의학적 진단이나 처방을 제공하지 않습니다.</span>
          </footer>

          <dialog className="source-dialog" id="sourceDialog" aria-labelledby="sourceTitle">
            <div className="dialog-heading">
              <div>
                <p className="panel-index">INFORMATION PRINCIPLES</p>
                <h2 id="sourceTitle">이 지도가 정보를 다루는 방식</h2>
              </div>
              <button className="dialog-close" id="sourceClose" type="button" aria-label="닫기">닫기</button>
            </div>
            <p>
              입력값만으로 질환을 확정하지 않습니다. 수치가 기준에 닿아도 반복 검사와 의료진 판단이 필요하며,
              영양 정보는 보충제 처방이 아닌 식사 대화의 출발점으로만 제공합니다.
            </p>
            <ul className="source-list">
              <li><a href="https://www.cdc.gov/high-blood-pressure/about/index.html" target="_blank" rel="noreferrer">CDC 고혈압 정보</a></li>
              <li><a href="https://www.niddk.nih.gov/health-information/diabetes/overview/tests-diagnosis" target="_blank" rel="noreferrer">NIDDK 당뇨 검사와 진단</a></li>
              <li><a href="https://www.niddk.nih.gov/health-information/digestive-diseases/acid-reflux-ger-gerd-adults/eating-diet-nutrition" target="_blank" rel="noreferrer">NIDDK 위식도역류 식사 정보</a></li>
              <li><a href="https://www.nhlbi.nih.gov/health/asthma/attacks" target="_blank" rel="noreferrer">NHLBI 천식 행동 계획</a></li>
            </ul>
          </dialog>
      <LegacyScript page='map' />
    </>
  );
}
