# 나라별 약제 보험 기준 비교

급여인정확인 창의 **다른 나라 사례 확인**에서 같은 약의 기준을 불러온다. 국가에 보험 기준이 여러 개 등록되어 있으면 보험자/제도를 한 번 더 선택한다. 현재 범위는 benralizumab의 중증 천식, durvalumab의 절제 불가능 NSCLC 공고/유지치료이다.

## 등록 자료

2026-10-16 확인한 공식 자료의 한국어 요약이다. 자동 갱신되는 보험 데이터베이스가 아니며, 해당 적응증의 비교 사례이다. 한국은 기존 프로젝트 등록 기준을 유지한다.

| 약제 | 나라와 보험자 | 자료 |
| --- | --- | --- |
| Benralizumab | 미국 Aetna 상업보험 | [CPB 0925](https://www.aetna.com/cpb/medical/data/900_999/0925.html) |
| Benralizumab | 미국 Oklahoma SoonerCare Medicaid | [2026 Respiratory PA](https://aem-prod.oklahoma.gov/ohca/providers/types/pharmacy/prior-authorization/2026/respiratory.html) |
| Benralizumab | 영국 NHS England / NICE | [TA565](https://www.nice.org.uk/guidance/ta565/chapter/1-Recommendations), 2019-09-03 개정 |
| Benralizumab | 호주 PBS | [PB075](https://www.servicesaustralia.gov.au/pb075), [PB076](https://www.servicesaustralia.gov.au/pb076), 2026-09 신청서 |
| Durvalumab | 미국 Aetna 상업보험 | [CPB 0917](https://www.aetna.com/cpb/medical/data/900_999/0917.html), NSCLC 공고요법 경로 |
| Durvalumab | 영국 NHS England / NICE | [TA798](https://www.nice.org.uk/guidance/ta798/chapter/1-Recommendations), 2022-06-22 |
| Durvalumab | 호주 PBS EFC | [2026-08-01 편찬본](https://www.legislation.gov.au/F2024L00405/2026-08-01/2026-08-01/text/original/pdf), Schedule 3 C15500 초기치료 |

미국 사례를 Original Medicare, Medicare Advantage, 다른 주 Medicaid 또는 다른 상업보험 기준으로 일반화하지 않는다. NICE 사례는 NHS England 범위로 표시한다. 호주 durvalumab 사례는 초기치료 제한이며, 지속치료 전체 기준으로 사용하지 않는다. 요약에 없는 세부 조건은 연결된 원문에서 확인해야 한다.

## 입력과 판정

- 국가/보험 기준을 바꾸면 `noticeText`가 바뀐다. 진료데이터와 직접 수정한 지시문은 유지하고, 기준별 수정 내용은 창이 열려 있는 동안 복원한다.
- 선택만으로 API 호출은 발생하지 않는다. 검토 시작을 눌렀을 때 기존 API의 `overrides.notice`로 선택한 텍스트 전체와 출처를 전송한다.
- 기준 변경 시 이전 결과를 지운다. 결과에는 실제 전송한 기준과 수정 여부를 보관한다.
- 국내 규칙 엔진은 해외 기준을 판정하지 않는다. 모델 미설정 시 해외 자동 검토를 막고, API 오류·규칙 대체 응답·고시 기반 보고/확률이 없는 응답은 입력 화면에서 재시도를 안내한다.
- 해외 판정은 국내 처방의 `claimReviewVerdict`로 기록하지 않는다.

자료를 갱신할 때 `src/medication-coverage-policies.js`의 조건·출처·확인일을 함께 검증한다. AND/OR 경로, 대상 연령, 초기/지속치료와 제도를 구분하고 국내 조건을 다른 나라의 누락 항목에 보충하지 않는다.

## Haiku 번역

해외 국가를 선택하면 해당 언어로 전체 번역하는 버튼을 표시한다. 현재 미국·영국·호주 사례의 대상 언어는 영어이며 국가별 영어 로케일을 전송한다. 버튼을 누를 때만 `/api/medication-claim-review/translate`를 호출하고, 서버는 OpenRouter의 `anthropic/claude-haiku-5.5`를 고정 사용한다. 검토 모델 선택과 번역 모델 선택은 서로 영향을 주지 않는다.

진료데이터, 보험 기준, 검토 지시문, 기준 요약, 이미 있는 보고서·요약을 번역한다. 원문은 별도로 유지하며 번역본은 읽기 전용으로 보여준다. 번역본을 보고 검토를 시작하면 번역된 입력을 사용하고 결과에 번역 모델과 언어를 기록한다. 원문 수정 시 번역 캐시를 무효화하고, 국가 변경·닫기·취소 시 진행 중인 번역 결과를 버린다. 화면 조작 버튼과 안내는 한국어를 유지한다.

번역 API는 같은 출처, 기존 요청 빈도·일일 예산 검사를 적용한다. JSON 키·배열 길이·비문자열 값과 수치·단위·의료 코드·URL·판정 기호 보존을 검증하며, 잘린 응답·불완전한 JSON·검증 실패 시 부분 적용하지 않는다. 이 검사는 구조와 주요 토큰의 보존 검사이며, 의학적 의미 전체의 정확성을 보증하지 않는다. 입력을 자동으로 잘라 보내지 않는다.
