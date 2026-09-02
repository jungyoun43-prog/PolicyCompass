import "../../src/foundation.css";
import "../../src/brand-signals.css";
import "../../src/insights.css";
import "../../src/controls.css";
import "../../src/clinician-hierarchy.css";
import "../../src/shell.css";

import { pageMetadata, RootShell } from "../../components/root-shell.jsx";

export const metadata = pageMetadata({
  title: '진료 준비 브리프 | PolicyCompass Personal',
  description: '내가 확인해 가져온 정제 기록과 최근 변화를 규칙 기반 질문으로 정리하고, 필요할 때만 동의한 외부 모델을 선택합니다.',
});

export const viewport = { themeColor: "#fafbfa" };

export default function Layout({ children }) {
  return <RootShell bodyClassName='insights-page clinician-hierarchy'>{children}</RootShell>;
}
