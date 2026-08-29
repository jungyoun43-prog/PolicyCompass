import "../../src/foundation.css";
import "../../src/brand-signals.css";
import "../../src/shell.css";
import "../../src/body-map.css";
import "../../src/body-index.css";
import "../../src/emr.css";
import "../../src/controls.css";

import { RootShell } from "../../components/root-shell.jsx";

export const metadata = {
  title: "PolicyCompass Clinical | 임상 기록 워크스페이스",
  description: "서명된 환자용 정제 파일 내보내기와 규칙 기반 질문 준비, 신체 기록 지도와 급여 보드를 결합한 임상 EMR 워크스페이스",
  robots: { index: false, follow: false },
};

export const viewport = { themeColor: "#e8f5e9" };

export default function EmrLayout({ children }) {
  return <RootShell bodyClassName="emr-page">{children}</RootShell>;
}
