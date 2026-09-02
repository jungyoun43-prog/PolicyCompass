import "../../src/foundation.css";
import "../../src/brand-signals.css";
import "../../src/detail.css";
import "../../src/explorer.css";
import "../../src/controls.css";
import "../../src/clinician-hierarchy.css";
import "../../src/shell.css";

import { pageMetadata, RootShell } from "../../components/root-shell.jsx";

export const metadata = pageMetadata({
  title: '연결 보기 | PolicyCompass Personal',
  description: '내 건강 신호와 질환, 확인할 관리 항목을 자유롭게 탐색하는 관계 지도',
});

export const viewport = { themeColor: "#fafbfa" };

export default function Layout({ children }) {
  return <RootShell bodyClassName='explorer-page clinician-hierarchy'>{children}</RootShell>;
}
