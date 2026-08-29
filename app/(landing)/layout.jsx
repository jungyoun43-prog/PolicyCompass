import "../../src/foundation.css";
import "../../src/brand-signals.css";
import "../../src/patient-presentation.css";
import "../../src/landing.css";
import "../../src/controls.css";
import "../../src/shell.css";

import { RootShell } from "../../components/root-shell.jsx";

export const metadata = {
  title: 'PolicyCompass Personal | 내 건강 기록을 내가 이어 보는 공간',
  description: '의료진에게 받은 환자용 기록을 파일과 확인 코드로 직접 가져오고, 건강 지도와 규칙 기반 진료 질문으로 정리하는 PolicyCompass Personal',
  robots: { index: false, follow: false },
};

export const viewport = { themeColor: '#e8f5e9' };

export default function Layout({ children }) {
  return <RootShell bodyClassName='landing-page'>{children}</RootShell>;
}
