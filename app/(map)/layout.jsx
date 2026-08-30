import "../../src/foundation.css";
import "../../src/brand-signals.css";
import "../../src/controls.css";
import "../../src/body-map.css";
import "../../src/body-index.css";
import "../../src/portal.css";
import "../../src/detail.css";
import "../../src/responsive.css";
import "../../src/clinician-hierarchy.css";
import "../../src/shell.css";

import { RootShell } from "../../components/root-shell.jsx";

export const metadata = {
  title: '건강 지도 | PolicyCompass Personal',
  description: '의료진에게 받은 환자용 파일과 확인 코드를 직접 가져와 몸·질환·관리 항목으로 탐색하는 개인 건강 관계 지도',
  robots: { index: false, follow: false },
};

export const viewport = { themeColor: "#fafbfa" };

export default function Layout({ children }) {
  return <RootShell bodyClassName='map-page clinician-hierarchy'>{children}</RootShell>;
}
