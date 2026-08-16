import { CONDITIONS } from "./data.js";

function conditionFor(id) {
  return CONDITIONS[id];
}

export function normalizeActiveId(visibleIds, activeId) {
  return visibleIds.includes(activeId) ? activeId : (visibleIds[0] ?? "");
}

export function selectBodyArea(visibleIds, area) {
  return visibleIds.find((id) => conditionFor(id)?.departments?.includes(area)) ?? "";
}

export function createBodyModel(visibleIds, activeId) {
  const areas = {};
  for (const id of visibleIds) {
    const departments = conditionFor(id)?.departments ?? [];
    for (const department of departments) {
      areas[department] = [...(areas[department] ?? []), id];
    }
  }

  const active = conditionFor(activeId);
  const activeAreaCount = Object.keys(areas).length;
  return {
    areas,
    statusText: visibleIds.length === 0 ? "항목 선택 대기" : `${activeAreaCount}개 진료과 · ${visibleIds.length}개 선택·가져오기 항목`,
    ready: visibleIds.length > 0,
    keyTone: active?.tone ?? "",
    keyText: active
      ? `선택·가져오기 항목: ${active.system} · ${active.label}`
      : "직접 선택하거나 명시적으로 가져온 항목의 진료과 연결을 표시합니다. 병변 위치나 진단을 뜻하지 않습니다.",
  };
}

export function createDetailModel(activeId) {
  const active = conditionFor(activeId);
  if (!active) {
    return {
      tone: "",
      system: "연결 지도",
      title: "선택·가져오기 항목을 선택하세요",
      summary: "직접 선택하거나 명시적으로 가져온 항목에서 다음 진료에 확인할 내용을 보여 줍니다.",
      relation: "그래프 항목을 누르면 일반적인 관계 설명이 표시됩니다. 개인의 인과관계나 진단은 아닙니다.",
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
