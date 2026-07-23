import { CONDITIONS } from "./data.js";

const QUESTION_RULES = {
  diabetes: [
    {
      question: "최근 혈당과 당화혈색소 추세를 어떻게 확인하면 좋을까요?",
      reason: "한 번의 수치보다 반복 측정과 검사실 기준을 함께 살펴보기 위해서입니다.",
    },
    {
      question: "신장·눈·발 상태 중 지금 점검할 항목이 있나요?",
      reason: "진료 전에 정기 확인 항목과 시기를 빠뜨리지 않기 위해서입니다.",
    },
  ],
  hypertension: [
    {
      question: "가정 혈압 기록을 어떤 방식으로 보여 드리면 도움이 될까요?",
      reason: "측정 시간과 반복값을 함께 보면 진료 대화를 더 구체적으로 시작할 수 있어서입니다.",
    },
    {
      question: "신장 기능·전해질과 전체 심혈관 위험도 함께 확인할까요?",
      reason: "혈압 기록과 함께 검토하는 항목의 범위를 의료진에게 확인하기 위해서입니다.",
    },
  ],
  dyslipidemia: [
    {
      question: "최근 지질 수치의 변화와 다음 검사 시점을 어떻게 봐야 할까요?",
      reason: "현재 값의 의미와 추적 계획을 같은 자리에서 확인하기 위해서입니다.",
    },
    {
      question: "혈압·혈당·가족력까지 포함한 심혈관 위험을 함께 살펴볼까요?",
      reason: "지질 수치 하나만으로 결론 내리지 않고 관련 기록을 함께 검토하기 위해서입니다.",
    },
  ],
  asthma: [
    {
      question: "증상 빈도와 흡입기 사용 기록에서 조정할 부분이 있나요?",
      reason: "증상 패턴과 실제 사용 방법을 함께 확인하기 위해서입니다.",
    },
    {
      question: "야간 증상이나 악화 때 따를 행동 계획을 정리할까요?",
      reason: "증상이 달라졌을 때의 대응 기준을 진료 중 분명히 정하기 위해서입니다.",
    },
  ],
  migraine: [
    {
      question: "두통 일지에서 빈도·지속 시간·촉발 요인을 어떻게 읽어야 할까요?",
      reason: "기억에 의존하지 않고 반복되는 패턴을 의료진과 검토하기 위해서입니다.",
    },
    {
      question: "진통제 사용 빈도와 새롭게 생긴 경고 신호를 확인할까요?",
      reason: "복용 기록과 이전과 다른 증상을 진료 전에 빠뜨리지 않기 위해서입니다.",
    },
  ],
  reflux: [
    {
      question: "식사·취침 시간과 증상 기록에서 확인할 패턴이 있나요?",
      reason: "증상이 나타나는 맥락을 진료 중 구체적으로 설명하기 위해서입니다.",
    },
    {
      question: "삼킴 곤란이나 출혈처럼 바로 알려야 할 변화가 있는지 점검할까요?",
      reason: "일상적인 불편과 신속한 평가가 필요한 변화를 구분해 질문하기 위해서입니다.",
    },
  ],
  mood: [
    {
      question: "수면과 일상 기능의 변화를 어떤 순서로 말씀드리면 좋을까요?",
      reason: "기분뿐 아니라 생활에 미친 영향을 함께 설명하기 위해서입니다.",
    },
    {
      question: "안전과 위기 상황에 대비해 미리 정할 도움 요청 방법이 있나요?",
      reason: "위기 신호가 생겼을 때 사용할 연락과 대응 기준을 의료진과 확인하기 위해서입니다.",
    },
  ],
  arthritis: [
    {
      question: "통증·붓기·아침 뻣뻣함과 기능 변화를 어떻게 기록하면 좋을까요?",
      reason: "통증의 정도뿐 아니라 움직임과 일상 변화도 함께 전달하기 위해서입니다.",
    },
    {
      question: "현재 활동 계획과 통증 조절 방법을 조정할 필요가 있나요?",
      reason: "무리 없이 유지할 수 있는 활동 범위를 진료 중 확인하기 위해서입니다.",
    },
  ],
};

function normalizeIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids)].filter((id) => CONDITIONS[id] && QUESTION_RULES[id]);
}

function buildQuestion(rule, sourceId, index) {
  const source = CONDITIONS[sourceId];
  return {
    id: `${sourceId}-${index + 1}`,
    question: rule.question,
    reason: rule.reason,
    basis: `건강 지도에서 ‘${source.label}’ 관련 입력 신호가 표시됨`,
    sourceId,
    sourceLabel: source.label,
  };
}

function collectQuestions(ids) {
  const questions = [];
  const seen = new Set();
  const rounds = Math.max(0, ...ids.map((id) => QUESTION_RULES[id].length));

  for (let index = 0; index < rounds && questions.length < 5; index += 1) {
    for (const id of ids) {
      const rule = QUESTION_RULES[id][index];
      if (!rule || seen.has(rule.question)) continue;
      seen.add(rule.question);
      questions.push(buildQuestion(rule, id, index));
      if (questions.length === 5) break;
    }
  }

  return questions;
}

export function createVisitBrief(ids = []) {
  const validIds = normalizeIds(ids);
  const questions = collectQuestions(validIds);
  const signals = validIds.map((id) => ({
    id,
    label: CONDITIONS[id].label,
    basis: `건강 지도에서 ‘${CONDITIONS[id].label}’ 관련 입력 신호가 표시됨`,
  }));

  return {
    ids: validIds,
    questions,
    signals,
    coverage: validIds.length
      ? `${validIds.length}개 입력 신호에서 진료 질문을 정리했습니다.`
      : "아직 질문을 만들 입력 신호가 없습니다.",
    countLabel: `${questions.length}개 질문`,
    disclaimer: "이 브리프는 기록 정리용이며 진단·처방·응급 판단을 제공하지 않습니다.",
  };
}
