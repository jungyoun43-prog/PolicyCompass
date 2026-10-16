# 나라별 약제 보험 기준 비교

급여인정확인 창의 **다른 나라 사례 확인**에서 같은 약의 기준을 불러온다. 국가에 보험 기준이 여러 개 등록되어 있으면 보험자/제도를 한 번 더 선택한다. 현재 범위는 benralizumab의 중증 천식, durvalumab의 절제 불가능 NSCLC 공고/유지치료이다.

## 등록 자료

해외 기준은 공식 HTML/PDF 문서에서 원문을 불러온다. 기준 본문에 앱이 작성한 요약·해석·주의 문장을 추가하지 않는다. 출처, 조회 시각, 선택한 나라·보험자·적응증은 별도 메타정보이다. 한국은 기존 프로젝트 등록 기준을 유지한다.

| 약제 | 나라와 보험자 | 자료 |
| --- | --- | --- |
| Benralizumab | 미국 Aetna 상업보험 | [CPB 0925](https://www.aetna.com/cpb/medical/data/900_999/0925.html) |
| Benralizumab | 미국 Oklahoma SoonerCare Medicaid | [2026 Respiratory PA](https://aem-prod.oklahoma.gov/ohca/providers/types/pharmacy/prior-authorization/2026/respiratory.html) |
| Benralizumab | 영국 NHS England / NICE | [TA565](https://www.nice.org.uk/guidance/ta565/chapter/1-Recommendations), 2019-09-03 개정 |
| Benralizumab | 호주 PBS | [PB075](https://www.servicesaustralia.gov.au/pb075), [PB076](https://www.servicesaustralia.gov.au/pb076), 2026-09 신청서 |
| Durvalumab | 미국 Aetna 상업보험 | [CPB 0917](https://www.aetna.com/cpb/medical/data/900_999/0917.html), NSCLC 공고요법 경로 |
| Durvalumab | 영국 NHS England / NICE | [TA798](https://www.nice.org.uk/guidance/ta798/chapter/1-Recommendations), 2022-06-22 |
| Durvalumab | 호주 PBS EFC | [2026-08-01 편찬본](https://www.legislation.gov.au/F2024L00405/2026-08-01/2026-08-01/text/original/epub/OEBPS/document_1/document_1.html), Schedule 3 C15500 초기 / C12271 지속치료 |

미국 사례를 Original Medicare, Medicare Advantage, 다른 주 Medicaid 또는 다른 상업보험 기준으로 일반화하지 않는다. NICE 사례는 NHS England 범위로 표시한다. 발췌 범위와 연결 문서를 확인해야 하며, 개별 가입 약관과 연계 문서를 모두 포함한다고 주장하지 않는다.

- Aetna: 공통 상업보험·사전승인·투여장소 항목, 제외 조건, 해당 적응증의 초기/지속 승인, 공통 용량 안내와 해당 적응증 용량. benralizumab은 전문의·병용 조건 및 ICS 용량 Appendix도 포함한다. durvalumab은 NSCLC의 OR 관계를 보존하려고 해당 대안 묶음을 그대로 포함한다.
- NICE: 권고 1장과 약제 정보 2장 전체.
- Oklahoma: Fasenra 천식 기준의 전체 목록과 연결된 PA 신청서 링크.
- 호주 benralizumab: PB075 4쪽과 PB076 3쪽의 텍스트 전체. 다른 약의 분기 문항도 문서의 원래 구조를 유지하며 검토 대상 약제에 해당하는 경로를 평가한다.
- 호주 durvalumab: C15500과 C12271의 전체 행.

`GET /api/medication-claim-review/policy-source`는 등록된 약제·보험 기준의 고정된 공식 URL만 가져온다. 성공한 결과를 6시간 캐시하고 조회 시각·본문 SHA-256·문서 구간을 함께 반환한다. 필수 구간이 없거나 요청이 실패하면 오류를 표시하며 작성한 요약문으로 대체하지 않는다. 원문은 저장소에 복제하지 않는다.

PDF는 Node 런타임의 `pdfjs-dist`로 모든 페이지를 읽는다. Next.js standalone 배포에는 동적 PDF worker와 Node canvas 패키지를 명시적으로 포함한다.

## 입력과 판정

- 국가/보험 기준을 바꾸면 `noticeText`가 바뀐다. 진료데이터와 직접 수정한 지시문은 유지하고, 기준별 수정 내용은 창이 열려 있는 동안 복원한다.
- 국가 선택 시 공식 원문 조회 API를 호출한다. AI 검토는 검토 시작을 눌렀을 때만 호출한다. `overrides.notice`에는 편집기에 보이는 본문만 그대로 넣으며 보험자·적응증은 `reviewContext.coveragePolicy`에 별도로 넣는다.
- 기준 변경 시 이전 결과를 지운다. 결과에는 실제 전송한 기준과 수정 여부를 보관한다.
- 국내 규칙 엔진은 해외 기준을 판정하지 않는다. 모델 미설정 시 해외 자동 검토를 막고, API 오류·규칙 대체 응답·고시 기반 보고/확률이 없는 응답은 입력 화면에서 재시도를 안내한다.
- 해외 판정은 국내 처방의 `claimReviewVerdict`로 기록하지 않는다.

출처를 갱신할 때 `src/medication-coverage-policies.js`의 URL/범위와 `scripts/medication-policy-source.mjs`의 문서 구조 선택을 함께 검증한다. AND/OR 경로, 대상 연령, 초기/지속치료와 제도를 구분하고 국내 조건을 다른 나라의 누락 항목에 보충하지 않는다.

## Haiku 번역

해외 국가를 선택하면 해당 언어로 전체 번역하는 버튼을 표시한다. 현재 미국·영국·호주 사례의 대상 언어는 영어이며 국가별 영어 로케일을 전송한다. 버튼을 누를 때만 `/api/medication-claim-review/translate`를 호출하고, 서버는 OpenRouter의 `anthropic/claude-haiku-5.5`를 고정 사용한다. 검토 모델 선택과 번역 모델 선택은 서로 영향을 주지 않는다.

진료데이터, 보험 기준 원문, 검토 지시문, 이미 있는 보고서·요약을 번역한다. 원문은 별도로 유지하며 번역본은 읽기 전용으로 보여준다. 번역본을 보고 검토를 시작하면 번역된 입력을 사용하고 결과에 번역 모델과 언어를 기록한다. 원문 수정 시 번역 캐시를 무효화하고, 국가 변경·닫기·취소 시 진행 중인 번역 결과를 버린다. 화면 조작 버튼과 안내는 한국어를 유지한다.

번역 API는 같은 출처, 기존 요청 빈도·일일 예산 검사를 적용한다. 응답 필드의 문자열 여부, 필수 항목, 보험 기준 목록의 JSON 형식만 확인한다. 원문과 번역문의 수치·단위·코드·문구를 대조하는 보존 검증은 적용하지 않는다. 잘린 응답이나 불완전한 JSON은 오류로 처리하며 입력을 자동으로 잘라 보내지 않는다.

번역을 기다리는 동안 10초마다 JSON 앞의 공백을 전송해 로드밸런서의 유휴 연결 종료를 방지한다. 최종 본문은 기존 JSON 형식이며 화면은 완료될 때까지 기다린다. 사전 입력·설정·예산 오류는 기존 HTTP 상태를 유지한다. 스트림 시작 후 발생한 모델 오류는 HTTP 200 본문의 `code`·`message`로 반환하며 클라이언트가 실패로 처리한다.

번역 요청은 Haiku의 추론을 끄고 OpenRouter에서 처리량이 높은 제공자를 우선한다. 화면이 수정되지 않은 공식 영문 기준임을 표시한 경우 해당 기준을 다시 생성하지 않는다. JSON 진료데이터·기준 목록은 문자열 값만 추출하고 다른 텍스트와 함께 최대 3개 요청으로 균등하게 나누어 병렬 번역한다. 각 기록·문자열은 통째로 전송하며 길이 제한으로 자르지 않는다. 번역을 모두 받은 뒤 JSON의 해당 값에 넣어 반환하고, 항목 ID·문자열·필수 응답 형식만 확인한다. 원문과 번역문의 수치·문구를 대조해 차단하는 검증은 적용하지 않는다.
