import "../../src/foundation.css";
import "../../src/brand-signals.css";
import "../../src/controls.css";
import "../../src/explorer.css";
import "../../src/journey.css";
import "../../src/clinician-hierarchy.css";
import "../../src/shell.css";

import { pageMetadata, RootShell } from "../../components/root-shell.jsx";

export const metadata = pageMetadata({
  title: '건강 기록 | PolicyCompass Personal',
  description: 'EMR 정제 기록과 직접 남긴 신호의 변화를 날짜별로 비교하고 Journey만 별도로 백업하는 PolicyCompass Personal 기록',
});

export const viewport = { themeColor: "#fafbfa" };

export default function Layout({ children }) {
  return <RootShell bodyClassName='journey-page clinician-hierarchy'>{children}</RootShell>;
}
