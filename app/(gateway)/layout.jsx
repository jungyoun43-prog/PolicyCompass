import "../../src/foundation.css";
import "../../src/brand-signals.css";
import "../../src/shell.css";
import "../../src/patient-presentation.css";
import "../../src/gateway.css";
import "../../src/controls.css";

import { pageMetadata, RootShell } from "../../components/root-shell.jsx";

export const metadata = pageMetadata({
  title: "PolicyCompass | 사용할 공간 선택",
  description:
    "서명·확정 기록을 환자용 파일로 내보내고 규칙 기반 진료 질문을 준비하는 의료진 EMR과 개인 PolicyCompass 중 사용할 공간을 선택합니다.",
});

export const viewport = { themeColor: "#fafbfa" };

export default function GatewayLayout({ children }) {
  return <RootShell bodyClassName="gateway-page">{children}</RootShell>;
}
