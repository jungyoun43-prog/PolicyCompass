"use client";

import { Tabs as TabsPrimitive } from "radix-ui";

import { useHorizontalScrollPosition } from "./use-horizontal-scroll.js";

const TABS = [
  ["encounter", "오늘 진료"],
  ["overview", "환자 요약"],
  ["chart", "과거 기록"],
  ["graph", "신체 지도"],
  ["claims", "급여 보드"],
  ["journey", "Journey"],
  ["data", "감사·데이터"],
];

const ICON_PATHS = {
  encounter: "M8 5H5v15h14V5h-3M9 3h6v4H9zM8 11h8M8 15h5",
  overview: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v3",
  chart: "M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6",
  graph: "M14 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM8 21l1-8-3 4M16 21l-1-8 3 4M9 9h6l2 4M9 9l-2 4M12 13v8",
  claims: "M3 5h18v14H3zM6 15l4-4 4 2 4-5",
  journey: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
  data: "M5 20V10M12 20V4M19 20v-7M3 21h18",
};

/**
 * A clinical rail that becomes a horizontal strip on small screens. The root
 * supplies the matching Radix orientation and Arrow/Home/End handling.
 * Patient identity stays above the current workspace.
 */
export function WorkspaceHeader({ onSelectTab }) {
  const tabListRef = useHorizontalScrollPosition();

  return (
    <div className="patient-workspace-navigation">
      <TabsPrimitive.List className="workspace-tabs" aria-label="선택 환자 화면" ref={tabListRef} loop>
        {TABS.map(([key, label]) => (
          <TabsPrimitive.Trigger key={key} value={key} id={`tab-${key}`} data-tab={key} onClick={() => onSelectTab?.(key)}>
            <svg className="clinical-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={ICON_PATHS[key]} /></svg>
            <span className="clinical-nav-label">{label}</span>
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </div>
  );
}
