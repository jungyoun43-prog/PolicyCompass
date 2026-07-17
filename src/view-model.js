import { CONDITIONS } from "./data.js";

function conditionFor(id) {
  return CONDITIONS[id];
}

export function normalizeActiveId(visibleIds, activeId) {
  return visibleIds.includes(activeId) ? activeId : (visibleIds[0] ?? "");
}

export function selectBodyArea(visibleIds, area) {
  return visibleIds.find((id) => conditionFor(id)?.area === area) ?? "";
}

export function createBodyModel(visibleIds, activeId) {
  const areas = {};
  for (const id of visibleIds) {
    const area = conditionFor(id)?.area;
    if (!area) continue;
    areas[area] = [...(areas[area] ?? []), id];
  }

  const active = conditionFor(activeId);
  const activeAreaCount = Object.keys(areas).length;
  return {
    areas,
    statusText: visibleIds.length === 0 ? "분석 대기" : `${activeAreaCount}개 영역 · ${visibleIds.length}개 신호`,
    ready: visibleIds.length > 0,
    keyTone: active?.tone ?? "",
    keyText: active
      ? `선택 중: ${active.system} · ${active.label}`
      : "입력된 기록에서 연결된 영역이 색 있는 표식으로 표시됩니다.",
  };
}

export function createDetailModel(activeId) {
  const active = conditionFor(activeId);
  if (!active) {
    return {
      tone: "",
      system: "연결 지도",
      title: "질환 노드를 선택하세요",
      summary: "입력한 신호에서 질환 노드를 선택하면 다음 진료에서 확인할 항목을 보여 줍니다.",
      relation: "그래프의 질환 노드를 누르면 관계 설명이 표시됩니다.",
      checks: ["증상 발생 시점", "검사실 결과", "복용 중인 약"],
      nutrition: ["개인 식사 패턴 기록", "의료진과 영양 목표 상의", "검증되지 않은 보충제 피하기"],
      care: ["의료진과 우선순위 정하기", "생활 변화의 안전성 확인", "추적 시점 기록하기"],
    };
  }

  return {
    tone: active.tone,
    system: active.system,
    title: active.label,
    summary: active.summary,
    relation: active.relation,
    checks: active.checks,
    nutrition: active.nutrition,
    care: active.care,
  };
}
