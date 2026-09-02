export const CONDITIONS = {
  hypertension: {
    id: "hypertension",
    label: "고혈압",
    system: "심혈관",
    departments: ["cardio", "renal"],
    tone: "coral",
    summary: "입력된 혈압 신호를 심장과 혈관 관리 관점에서 묶어 봅니다.",
    relation: "혈당과 지질 상태는 같은 심혈관 위험 평가에서 함께 확인하는 경우가 많습니다.",
    checks: ["가정 혈압 기록", "신장 기능과 전해질", "전체 심혈관 위험"],
    nutrition: ["나트륨 섭취 점검", "채소·통곡·콩류 중심 식사", "신장 질환이 있다면 칼륨 식품 상담"],
    care: ["올바른 반복 측정법 확인", "처방약 복용 계획 검토", "운동 강도를 의료진과 조정"],
  },
  diabetes: {
    id: "diabetes",
    label: "당뇨병",
    system: "대사",
    departments: ["endocrine", "renal", "sensory"],
    tone: "amber",
    summary: "공복혈당이나 당뇨 키워드를 췌장과 대사 관리 신호로 표시합니다.",
    relation: "혈압과 지질 이상이 함께 있으면 심혈관 위험 평가가 더 중요해질 수 있습니다.",
    checks: ["공복혈당 재검", "당화혈색소", "신장·눈·발 정기 확인"],
    nutrition: ["규칙적인 탄수화물 배분", "수용성 식이섬유", "가당 음료 줄이기"],
    care: ["검사실 수치로 진단 확인", "개인별 약물 계획 상담", "저혈당 대처법 확인"],
  },
  dyslipidemia: {
    id: "dyslipidemia",
    label: "이상지질혈증",
    system: "심혈관",
    departments: ["cardio", "endocrine"],
    tone: "cyan",
    summary: "LDL과 콜레스테롤 신호를 혈관 건강과 연결해 보여 줍니다.",
    relation: "혈압과 혈당 상태를 함께 보면 심혈관 위험을 더 입체적으로 평가할 수 있습니다.",
    checks: ["공복 지질 검사", "가족력과 흡연 여부", "전체 심혈관 위험"],
    nutrition: ["포화지방 대체하기", "귀리·콩류의 수용성 섬유", "생선과 견과류 식품"],
    care: ["검사실 기준 범위 확인", "약물 필요성 위험도 평가", "추적 검사 시점 상담"],
  },
  migraine: {
    id: "migraine",
    label: "편두통",
    system: "신경",
    departments: ["neuro"],
    tone: "violet",
    summary: "두통 신호를 수면, 스트레스, 촉발 요인과 함께 살펴봅니다.",
    relation: "불안과 수면 문제는 편두통의 빈도와 체감 부담에 함께 영향을 줄 수 있습니다.",
    checks: ["두통 일지", "신경학적 경고 증상", "복용 중인 진통제 빈도"],
    nutrition: ["규칙적인 수분과 식사", "개인 촉발 음식 기록", "카페인 패턴 점검"],
    care: ["급성·예방 치료 상담", "일정한 수면 리듬", "갑작스러운 최악의 두통은 즉시 진료"],
  },
  reflux: {
    id: "reflux",
    label: "위식도역류",
    system: "소화기",
    departments: ["digestive"],
    tone: "coral",
    summary: "속쓰림과 역류 신호를 위와 식도 부위에 표시합니다.",
    relation: "야간 역류와 기침이 함께 있으면 호흡기 증상과 구분해 확인할 필요가 있습니다.",
    checks: ["증상 시간과 식사 기록", "삼킴 곤란·출혈 여부", "체중과 복용 약물"],
    nutrition: ["개인 촉발 음식 기록", "취침 3시간 전 식사 마치기", "과식과 잦은 야식 줄이기"],
    care: ["생활 조정 반응 확인", "지속 증상은 진료 상담", "경고 증상은 소화기 평가"],
  },
  asthma: {
    id: "asthma",
    label: "천식",
    system: "호흡기",
    departments: ["respiratory", "dermatology"],
    tone: "cyan",
    summary: "쌕쌕거림과 호흡 곤란 신호를 폐와 기도 관리에 연결합니다.",
    relation: "역류나 알레르기 증상이 기침을 악화시키는지 함께 살펴볼 수 있습니다.",
    checks: ["증상 빈도", "폐기능 또는 최대호기유량", "야간 증상과 촉발 요인"],
    nutrition: ["균형 잡힌 일반 식사", "확인되지 않은 보충제 피하기", "개인 알레르기 식품 확인"],
    care: ["흡입기 사용법 점검", "서면 천식 행동 계획", "악화 시 응급 기준 확인"],
  },
  copd: {
    id: "copd",
    label: "만성폐쇄성폐질환(COPD)",
    system: "호흡기",
    departments: ["respiratory"],
    tone: "cyan",
    summary: "의료진이 최종 확정한 COPD 기록을 폐와 호흡 관리 항목에 연결해 보여 줍니다.",
    relation: "숨참·기침·가래 변화와 흡입기 사용은 다음 진료에서 함께 확인할 수 있습니다.",
    checks: ["평소와 다른 숨참·기침·가래", "흡입기 사용법과 사용 횟수", "악화 때 연락·응급 기준"],
    nutrition: ["한 번에 무리되지 않는 식사량 상담", "균형 잡힌 식사와 수분 섭취 확인", "체중 변화가 있으면 의료진과 상의"],
    care: ["내 상태에 맞는 활동량 상담", "흡입기 사용법을 직접 확인", "심한 호흡 곤란은 즉시 도움 요청"],
  },
  pneumonia: {
    id: "pneumonia",
    label: "폐렴",
    system: "호흡기",
    departments: ["respiratory"],
    tone: "amber",
    summary: "의료진이 확인한 폐렴 기록을 호흡기 증상·영상·치료 경과와 함께 보여 줍니다.",
    relation: "발열·기침·가래·숨참의 변화와 입원 치료 뒤 회복 상태를 다음 진료에서 함께 확인할 수 있습니다.",
    checks: ["발열·기침·가래와 숨참 변화", "흉부 영상과 배양검사 결과", "항생제 복용·투여와 회복 경과"],
    nutrition: ["수분과 식사 가능 여부 확인", "무리 없는 소량 식사 상담", "회복 중 체중·식욕 변화 기록"],
    care: ["회복 단계에 맞는 활동 재개 상담", "처방된 항생제 사용법 확인", "호흡곤란·청색증·의식 변화는 즉시 도움 요청"],
  },
  mood: {
    id: "mood",
    label: "우울·불안",
    system: "정신건강",
    departments: ["mental"],
    tone: "violet",
    summary: "기분과 불안 신호를 수면, 통증, 일상 기능과 연결해 봅니다.",
    relation: "만성 통증과 편두통은 기분 증상과 서로 부담을 키울 수 있습니다.",
    checks: ["증상 지속 기간", "수면과 일상 기능", "자해·자살 생각 여부"],
    nutrition: ["규칙적인 식사 리듬", "과도한 음주 피하기", "결핍 검사는 의료진과 상의"],
    care: ["선별검사와 전문 상담", "심리치료·약물 선택 논의", "위기 생각이 들면 즉시 119 또는 응급실"],
  },
  arthritis: {
    id: "arthritis",
    label: "관절염",
    system: "근골격",
    departments: ["musculoskeletal", "rheumatology"],
    tone: "lime",
    summary: "무릎과 관절 통증 신호를 움직임과 기능 관리에 연결합니다.",
    relation: "통증으로 활동량이 줄면 대사와 기분 건강에도 영향을 줄 수 있습니다.",
    checks: ["통증 부위와 붓기", "아침 뻣뻣함 시간", "보행과 일상 기능"],
    nutrition: ["충분한 단백질 식품", "칼슘·비타민 D 상태 상담", "체중 관리에 맞춘 식사"],
    care: ["저충격 유산소 운동", "근력과 관절 가동성 운동", "통증 조절법 진료 상담"],
  },
};

export const RELATIONS = [
  { a: "hypertension", b: "diabetes", label: "대사 위험", category: "함께 확인", rationale: "혈압과 혈당은 대사증후군과 심혈관 위험을 평가할 때 함께 확인하는 지표입니다.", sourceTitle: "NHLBI · Metabolic Syndrome", sourceUrl: "https://www.nhlbi.nih.gov/health/metabolic-syndrome/diagnosis" },
  { a: "hypertension", b: "dyslipidemia", label: "혈관 위험", category: "공통 위험", rationale: "혈압과 콜레스테롤 상태는 심혈관 위험을 구성하는 서로 다른 요소입니다.", sourceTitle: "NHLBI · Metabolic Syndrome", sourceUrl: "https://www.nhlbi.nih.gov/health/metabolic-syndrome" },
  { a: "diabetes", b: "dyslipidemia", label: "대사 연결", category: "공통 위험", rationale: "혈당과 지질 수치는 대사 건강과 심혈관 위험을 함께 이해하는 데 사용됩니다.", sourceTitle: "NHLBI · Metabolic Syndrome", sourceUrl: "https://www.nhlbi.nih.gov/health/metabolic-syndrome/diagnosis" },
  { a: "migraine", b: "mood", label: "수면·스트레스", category: "동반 부담", rationale: "편두통이 있는 사람에게 불안·우울과 수면 문제가 더 흔하게 나타날 수 있습니다.", sourceTitle: "NINDS · Migraine", sourceUrl: "https://www.ninds.nih.gov/health-information/disorders/migraine" },
  { a: "reflux", b: "asthma", label: "기침·야간 증상", category: "증상 구분", rationale: "위식도역류는 만성 기침을 동반할 수 있어 호흡기 증상과 함께 맥락을 확인할 수 있습니다.", sourceTitle: "NIDDK · GERD Symptoms", sourceUrl: "https://www.niddk.nih.gov/health-information/digestive-diseases/acid-reflux-ger-gerd-adults/symptoms-causes" },
  { a: "arthritis", b: "mood", label: "통증 부담", category: "생활 영향", rationale: "지속되는 통증과 활동 제한은 기분과 일상 기능을 함께 살펴볼 이유가 됩니다.", sourceTitle: "CDC · Arthritis and Mental Health", sourceUrl: "https://www.cdc.gov/arthritis/about/about-arthritis-and-mental-health.html" },
  { a: "arthritis", b: "diabetes", label: "활동량", category: "생활 영향", rationale: "관절 통증으로 활동이 줄면 혈당 관리 계획에도 영향을 줄 수 있어 함께 대화할 수 있습니다.", sourceTitle: "CDC · Physical Activity for Arthritis", sourceUrl: "https://www.cdc.gov/arthritis/basics/physical-activity-overview.html" },
];
export function relationsFor(id, visibleIds = Object.keys(CONDITIONS)) {
  const visible = new Set(visibleIds);
  return RELATIONS.filter(({ a, b }) => (a === id || b === id) && visible.has(a) && visible.has(b));
}

const measurementSignalRules = Object.freeze([
  Object.freeze({
    key: "blood-pressure",
    label: "혈압 측정 입력",
    unit: "mmHg",
    pattern: /혈압\s*:?\s*(\d{2,3})\s*[/／-]\s*(\d{2,3})/i,
    value: (match) => `${match[1]}/${match[2]}`,
  }),
  Object.freeze({
    key: "fasting-glucose",
    label: "공복 혈당 측정 입력",
    unit: "mg/dL",
    pattern: /공복\s*혈당\s*:?\s*(\d{1,4})/i,
    value: (match) => match[1],
  }),
  Object.freeze({
    key: "ldl",
    label: "LDL 콜레스테롤 측정 입력",
    unit: "mg/dL",
    pattern: /\bldl(?:\s*콜레스테롤)?\s*:?\s*(\d{1,4})/i,
    value: (match) => match[1],
  }),
]);

const symptomSignalRules = Object.freeze([
  Object.freeze({ key: "headache", label: "두통 증상 입력", pattern: /반복(?:되는)?\s*두통|두통/i }),
  Object.freeze({ key: "heartburn", label: "속쓰림·신물 증상 입력", pattern: /속쓰림|신물/i }),
  Object.freeze({ key: "wheeze-dyspnea", label: "쌕쌕·호흡곤란 증상 입력", pattern: /쌕쌕|호흡\s*곤란/i }),
  Object.freeze({ key: "mood-symptom", label: "기분·불안 증상 입력", pattern: /우울감|불안감|공황\s*증상/i }),
  Object.freeze({ key: "joint-pain", label: "관절 통증 증상 입력", pattern: /무릎\s*통증|관절\s*통증/i }),
]);

function negatedNear(note, match) {
  const start = Math.max(0, match.index - 12);
  const end = Math.min(note.length, match.index + match[0].length + 14);
  const context = note.slice(start, end);
  return /(?:없(?:음|다|어요|고)?|아님|아니(?:다|에요)?|부인|호소하지\s*않)/i.test(context);
}

function signalId(kind, key, index) {
  return `input-${kind}-${key}-${index}`;
}

/**
 * Free-text values and symptoms remain unverified review signals. This
 * function never creates a Condition or asserts a diagnosis.
 */
export function extractInputSignals(note) {
  const text = typeof note === "string" ? note.slice(0, 4_000) : "";
  const signals = [];

  for (const rule of measurementSignalRules) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    signals.push({
      id: signalId("measurement", rule.key, match.index),
      kind: "measurement-input",
      key: rule.key,
      label: rule.label,
      value: rule.value(match),
      unit: rule.unit,
      evidenceText: match[0],
      provenanceKind: "input-pattern",
    });
  }

  for (const rule of symptomSignalRules) {
    const match = rule.pattern.exec(text);
    if (!match || negatedNear(text, match)) continue;
    signals.push({
      id: signalId("symptom", rule.key, match.index),
      kind: "symptom-input",
      key: rule.key,
      label: rule.label,
      value: match[0],
      unit: "",
      evidenceText: match[0],
      provenanceKind: "input-pattern",
    });
  }

  return signals.sort((left, right) => left.id.localeCompare(right.id));
}

export function inferConditionIds(_note, selectedIds = []) {
  return [...new Set(Array.isArray(selectedIds) ? selectedIds : [])]
    .filter((id) => CONDITIONS[id]);
}
