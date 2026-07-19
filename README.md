# VitaGraph

VitaGraph는 개인 건강 지도와 로컬 임상 워크스페이스를 함께 제공하는 정적 웹앱입니다.

- 개인용 화면: 건강 지도, 질환 연결, 진료 질문 브리프, Journey
- 임상용 화면: 환자 차트, VitaGraph 임상 관계도, 진료 준비 초안, 급여 적합성 칸반, 감사 이력
- 저장 방식: 서버 DB 없이 현재 브라우저의 `localStorage`

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

- 개인용 VitaGraph: http://127.0.0.1:4173/
- 임상 EMR: http://127.0.0.1:4173/emr
- 저장되지 않는 가상 환자 데모: http://127.0.0.1:4173/emr?demo=1

환자 등록 → 차트 이벤트 입력 → VitaGraph → 급여 보드 → Journey 순서로 바로 사용할 수 있습니다. JSON 백업 내보내기와 복원도 지원합니다.

## 로컬 AI 코파일럿

AI를 설정하지 않아도 근거가 연결된 규칙 기반 브리프가 작동합니다. 로컬 Ollama 모델을 사용할 때만 모델 이름을 지정합니다.

```bash
VITAGRAPH_OLLAMA_MODEL=your-local-model npm run dev
```

Ollama 주소를 바꾸려면 `VITAGRAPH_OLLAMA_URL`을 사용합니다. 보안을 위해 `localhost`, `127.0.0.1`, `::1`의 HTTP 주소만 허용하고 HTTP 리다이렉트는 따르지 않습니다. 모델 요청은 이벤트 ID를 요청별 별칭으로 바꾸고 환자 이름·등록번호·전화·자유메모를 제외합니다. 반박된 진단이나 주문 의도가 아닌 약물처럼 lifecycle이 모순된 이벤트는 모델 요청에도 포함하지 않습니다. 모델 결과는 항상 “의료진 검토 전 초안”입니다.

## FHIR와 급여 규칙

EMR 가져오기는 정확히 한 명의 Patient가 들어 있고 각 임상 리소스가 그 Patient를 명시적으로 참조하는 FHIR R4 Bundle을 최대 1,000개 항목까지 읽습니다. 절대·URN 참조는 Patient `fullUrl`과 정확히 같아야 하고, 상대 `Patient/{id}` 참조는 해당 임상 entry의 `fullUrl`이 가리키는 FHIR 서버 기준으로만 해석합니다. Condition·AllergyIntolerance는 활성·확정 상태, MedicationRequest는 활성 주문 계열 intent이며 `doNotPerform`이 아닌 경우만 현재 차트 사실로 가져옵니다. 해석하지 못하는 `modifierExtension`·`implicitRules`, 비활성·사망·대체 연결 Patient, 형식이 잘못된 modifier 필드는 fail-closed 처리합니다. 제외 항목과 사유는 가져오기 보고서에 남습니다.

- Patient
- Condition
- Observation
- MedicationRequest
- AllergyIntolerance
- Procedure
- Encounter

급여 보드는 시행일, 종료일, 기준기간, 최대 횟수, 적용 진단, 필수 근거의 이벤트 유형·코드 시스템·최근성을 결정론적으로 평가합니다. 기관 규칙은 서비스·적용 조건·근거의 코드 시스템을 함께 요구해 다른 코드체계의 같은 문자열을 섞지 않으며, 같은 규칙군의 시행기간이 겹치는 버전과 lifecycle이 모순된 차트 이벤트는 저장·복원 모두 거부합니다. 기본 내장 규칙은 UI 검증용 샘플이며 실제 심평원 기준이 아닙니다. 실제 사용 전 기관 담당자가 공식 고시·심사기준을 검증하고 출처와 시행일을 포함해 등록해야 합니다.

FHIR는 임상 데이터 교환 형식입니다. 삭감 여부를 결정하는 급여 기준 자체가 아닙니다. 이 보드는 사전 확인을 돕지만 급여 인정이나 삭감 방지를 보장하지 않습니다.

VitaGraph의 노드는 원 차트 출처를 표시합니다. 코드·표시명으로 묶은 관계는 점선과 `추론` 라벨로만 보여 주며 확정 차트 관계나 인과관계로 취급하지 않습니다.

## 검증

```bash
npm test
npm run smoke:emr
```

- `npm test`: 빌드, 모델, FHIR, 급여 규칙, 백업, 라우트, 보안 헤더 검증
- `npm run smoke:emr`: 실행 중인 로컬 서버와 Chrome을 사용해 데모, 그래프, 칸반, 환자·차트 저장을 실제 브라우저에서 검증

Chrome 경로가 다르면 `CHROME_BIN`을 지정할 수 있습니다. 스모크 테스트 기본 URL은 `http://127.0.0.1:4173`이며 `EMR_URL`로 바꿀 수 있습니다.

## 중요한 제한

이 결과물은 로컬 현장 검증용 샌드박스입니다. 인증된 EMR, 의료기기, 청구 심사 프로그램이 아닙니다.

- 로그인, 권한 분리, 서버 감사로그, 암호화 DB, 동기화 없음
- 브라우저 저장소를 지우면 기록 삭제
- JSON 백업 파일 자체는 암호화되지 않음
- 다중 사용자·동시 편집·PACS·OCS·전자서명·심평원 송신 없음
- 진단, 처방, 응급 판단, 급여 확정 자동화 없음

실제 환자정보를 넣기 전 별도 보안·개인정보·의료법 검토와 운영 인프라 구축이 필요합니다. 현재 단계에서는 가상 또는 비식별 데이터로 평가하세요.
