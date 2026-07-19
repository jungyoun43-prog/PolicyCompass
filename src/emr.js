import {
  addClaimRule,
  addPatient,
  appendStateAudit,
  appendPatientEvent,
  clinicalContextFingerprint,
  clearEmrState,
  createClinicalGraph,
  createCopilotRequest,
  createDemoEmrState,
  createEmptyEmrState,
  createLocalCopilotBrief,
  EMR_STORAGE_KEY,
  exportEmrBackup,
  loadEmrState,
  localCalendarDate,
  parseEmrBackup,
  removePatientEvent,
  saveEmrState,
  selectPatient,
  updatePatient,
} from "./emr-model.js";
import { parseEmrFhirBundle } from "./emr-fhir.js";
import {
  buildClaimBoard,
  CLAIM_LANE_LABELS,
  CLAIM_LANE_ORDER,
} from "./claim-rules.js";

const EVENT_LABELS = {
  encounter: "내원",
  condition: "진단·문제",
  observation: "검사·측정",
  medication: "약물",
  allergy: "알레르기",
  procedure: "수술·처치",
  symptom: "증상",
  note: "진료 메모",
};

const SEX_LABELS = {
  female: "여성",
  male: "남성",
  other: "기타",
  unknown: "미상",
};

const AUDIT_LABELS = {
  "patient.created": "환자 등록",
  "patient.updated": "환자 정보 변경",
  "patient.event.added": "임상 이벤트 추가",
  "patient.event.removed": "임상 이벤트 삭제",
  "claim-rule.saved": "급여 규칙 저장",
  "fhir.imported": "FHIR 가져오기",
  "backup.restored": "백업 복원",
  "demo.loaded": "샘플 워크스페이스 열기",
};

const GRAPH_COLORS = {
  condition: "var(--accent)",
  observation: "var(--data-cyan)",
  medication: "var(--data-violet)",
  allergy: "var(--data-amber)",
  procedure: "var(--data-lime)",
  symptom: "var(--surface)",
};

const SVG_NS = "http://www.w3.org/2000/svg";
const today = () => localCalendarDate();
const byId = (id) => document.getElementById(id);
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const timestampFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const refs = {
  patientList: byId("patientList"),
  patientListEmpty: byId("patientListEmpty"),
  patientCount: byId("patientCount"),
  patientSearch: byId("patientSearch"),
  patientComposer: byId("patientComposer"),
  patientForm: byId("patientForm"),
  patientFormMode: byId("patientFormMode"),
  patientMrn: byId("patientMrn"),
  patientName: byId("patientName"),
  patientBirthDate: byId("patientBirthDate"),
  patientSex: byId("patientSex"),
  patientPhone: byId("patientPhone"),
  patientFormMessage: byId("patientFormMessage"),
  cancelPatientEdit: byId("cancelPatientEdit"),
  workspaceEmpty: byId("workspaceEmpty"),
  workspaceContent: byId("workspaceContent"),
  selectedPatientName: byId("selectedPatientName"),
  selectedPatientMeta: byId("selectedPatientMeta"),
  safetyAlerts: byId("safetyAlerts"),
  lastSavedAt: byId("lastSavedAt"),
  patientMetrics: byId("patientMetrics"),
  clinicalSummary: byId("clinicalSummary"),
  copilotMode: byId("copilotMode"),
  copilotContent: byId("copilotContent"),
  runCopilot: byId("runCopilot"),
  nextWorkList: byId("nextWorkList"),
  eventForm: byId("eventForm"),
  eventType: byId("eventType"),
  eventDate: byId("eventDate"),
  eventCode: byId("eventCode"),
  eventSystem: byId("eventSystem"),
  eventLabel: byId("eventLabel"),
  eventValue: byId("eventValue"),
  eventUnit: byId("eventUnit"),
  eventNote: byId("eventNote"),
  eventFormMessage: byId("eventFormMessage"),
  eventFilters: byId("eventFilters"),
  eventTimeline: byId("eventTimeline"),
  eventCount: byId("eventCount"),
  clinicalGraph: byId("clinicalGraph"),
  graphEvidenceList: byId("graphEvidenceList"),
  graphLegend: document.querySelector(".graph-legend"),
  claimBoard: byId("claimBoard"),
  ruleForm: byId("ruleForm"),
  ruleSetId: byId("ruleSetId"),
  ruleVersion: byId("ruleVersion"),
  ruleTitle: byId("ruleTitle"),
  ruleServiceCode: byId("ruleServiceCode"),
  ruleServiceSystem: byId("ruleServiceSystem"),
  ruleServiceEventType: byId("ruleServiceEventType"),
  ruleWindowDays: byId("ruleWindowDays"),
  ruleMaxCount: byId("ruleMaxCount"),
  ruleApplicabilityCodes: byId("ruleApplicabilityCodes"),
  ruleApplicabilitySystem: byId("ruleApplicabilitySystem"),
  ruleEvidenceCodes: byId("ruleEvidenceCodes"),
  ruleEvidenceEventType: byId("ruleEvidenceEventType"),
  ruleEvidenceSystem: byId("ruleEvidenceSystem"),
  ruleEvidenceLookbackDays: byId("ruleEvidenceLookbackDays"),
  ruleEffectiveFrom: byId("ruleEffectiveFrom"),
  ruleEffectiveTo: byId("ruleEffectiveTo"),
  ruleSourceLabel: byId("ruleSourceLabel"),
  ruleSourceUrl: byId("ruleSourceUrl"),
  ruleFormMessage: byId("ruleFormMessage"),
  clinicalJourney: byId("clinicalJourney"),
  visitQuestions: byId("visitQuestions"),
  auditList: byId("auditList"),
  auditCount: byId("auditCount"),
  dataFacts: byId("dataFacts"),
  workspaceStatus: byId("workspaceStatus"),
  demoBanner: byId("demoBanner"),
  loadDemo: byId("loadDemo"),
  exitDemo: byId("exitDemo"),
  fhirImport: byId("fhirImport"),
  importEmr: byId("importEmr"),
  exportEmr: byId("exportEmr"),
  exportEmrSecondary: byId("exportEmrSecondary"),
  wipeEmr: byId("wipeEmr"),
  exportRecoveryRaw: byId("exportRecoveryRaw"),
  fhirImportReport: byId("fhirImportReport"),
  fhirImportReportSummary: byId("fhirImportReportSummary"),
  fhirImportIssues: byId("fhirImportIssues"),
  editPatient: byId("editPatient"),
  aiStatusDot: byId("aiStatusDot"),
  aiStatusLabel: byId("aiStatusLabel"),
  aiStatusDetail: byId("aiStatusDetail"),
};

let savedState = loadEmrState();
let state = new URL(window.location.href).searchParams.get("demo") === "1"
  ? createDemoEmrState()
  : savedState;
let activeTab = "overview";
let eventFilter = "all";
let boardScope = "patient";
let copilotBusy = false;
let aiCapability = { checked: false, configured: false, model: "" };
let lastFhirReport = null;
const briefCache = new Map();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function displayDate(value) {
  if (!value) return "날짜 미상";
  const parsed = new Date(value.length === 10 ? value + "T00:00:00.000Z" : value);
  return Number.isNaN(parsed.valueOf()) ? value : dateFormatter.format(parsed);
}

function displayTimestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "기록 없음" : timestampFormatter.format(parsed);
}

function ageFromBirthDate(value) {
  if (!value) return "";
  const [birthYear, birthMonth, birthDay] = value.split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = today().split("-").map(Number);
  let age = currentYear - birthYear;
  const beforeBirthday = currentMonth < birthMonth
    || (currentMonth === birthMonth && currentDay < birthDay);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? "만 " + age + "세" : "";
}

function selectedPatient() {
  return state.patients.find((patient) => patient.id === state.selectedPatientId) ?? null;
}

function claimEvaluations(patient) {
  if (!patient) return [];
  const board = buildClaimBoard([patient], state.rules, today());
  return CLAIM_LANE_ORDER.flatMap((status) => board.lanes[status]);
}

function restoreCopilotEvidenceIds(brief, aliasToEventId) {
  const restore = (items) => (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    evidenceEventIds: (Array.isArray(item.evidenceEventIds) ? item.evidenceEventIds : [])
      .map((id) => aliasToEventId.get(id))
      .filter(Boolean),
  }));
  return {
    ...brief,
    summary: restore(brief.summary),
    priorities: restore(brief.priorities),
    questions: restore(brief.questions),
    warnings: restore(brief.warnings),
    provenance: (Array.isArray(brief.provenance) ? brief.provenance : []).map((item) => ({
      ...item,
      eventId: aliasToEventId.get(item.eventId) ?? "",
    })).filter(({ eventId }) => eventId),
  };
}

function copilotRequestFingerprint(request) {
  return clinicalContextFingerprint({
    payload: request.payload,
    eventIdentities: [...request.aliasToEventId.entries()],
  });
}

function setStatus(message, tone = "") {
  refs.workspaceStatus.textContent = message;
  refs.workspaceStatus.className = "workspace-status" + (tone ? " is-" + tone : "");
}

function applyMutation(mutator, message) {
  const wasDemo = state.demo;
  if (!wasDemo && state.storageError) {
    throw new Error("손상된 로컬 저장을 먼저 원본으로 내보낸 뒤 백업 복원 또는 전체 삭제로 정리하세요.");
  }
  const candidate = mutator(state);
  if (wasDemo) {
    state = { ...candidate, demo: true };
  } else {
    const saved = saveEmrState(candidate);
    state = saved;
    savedState = saved;
  }
  briefCache.clear();
  render();
  setStatus(message + (wasDemo ? " · 데모 변경은 저장되지 않습니다." : ""), "success");
}

function createEmptyMessage(text, className = "summary-empty") {
  return element("p", className, text);
}

function renderPatients() {
  const query = refs.patientSearch.value.trim().toLocaleLowerCase("ko");
  const patients = state.patients.filter((patient) => {
    const haystack = (patient.name + " " + patient.mrn).toLocaleLowerCase("ko");
    return !query || haystack.includes(query);
  });
  clear(refs.patientList);
  for (const patient of patients) {
    const item = element("li");
    const button = element("button");
    button.type = "button";
    button.dataset.patientId = patient.id;
    button.setAttribute("aria-current", String(patient.id === state.selectedPatientId));
    button.append(
      element("strong", "", patient.name),
      element("small", "", patient.mrn || "등록번호 없음"),
      element("em", "", patient.events.length + "건"),
    );
    item.append(button);
    refs.patientList.append(item);
  }
  refs.patientCount.textContent = state.patients.length + "명";
  refs.patientListEmpty.hidden = state.patients.length > 0;
  if (state.patients.length > 0 && patients.length === 0) {
    refs.patientList.append(element("li", "rail-empty", "검색 결과가 없습니다."));
  }
}

function renderSafety(patient) {
  clear(refs.safetyAlerts);
  const allergies = patient.events.filter((event) => event.type === "allergy");
  if (allergies.length) {
    for (const allergy of allergies.slice(0, 3)) {
      refs.safetyAlerts.append(element("span", "safety-chip safety-chip--allergy", "알레르기 · " + allergy.label));
    }
  } else {
    refs.safetyAlerts.append(element("span", "safety-chip", "알레르기 확인 필요"));
  }
  const activeMedications = patient.events.filter((event) => event.type === "medication" && !["stopped", "cancelled"].includes(event.status));
  refs.safetyAlerts.append(element("span", "safety-chip", "활성 약물 " + activeMedications.length + "건"));
}

function addMetric(label, value, detail, warning = false) {
  const card = element("article", "metric-card" + (warning ? " metric-card--warning" : ""));
  card.append(element("span", "", label), element("strong", "", value), element("small", "", detail));
  refs.patientMetrics.append(card);
}

function renderMetrics(patient, evaluations) {
  clear(refs.patientMetrics);
  const conditions = patient.events.filter((event) => event.type === "condition" && !["inactive", "resolved", "remission"].includes(event.status));
  const medications = patient.events.filter((event) => event.type === "medication" && !["stopped", "cancelled"].includes(event.status));
  const latestObservation = patient.events.find((event) => event.type === "observation");
  const attention = evaluations.filter((item) => ["missing-evidence", "due-soon", "unknown"].includes(item.status));
  addMetric("ACTIVE PROBLEMS", conditions.length + "개", conditions[0]?.label ?? "구조화 문제 없음");
  addMetric("ACTIVE MEDICATIONS", medications.length + "개", medications[0]?.label ?? "활성 약물 없음");
  addMetric("LATEST MEASURE", latestObservation ? displayDate(latestObservation.date) : "없음", latestObservation?.label ?? "측정 기록 없음");
  addMetric("CLAIM ATTENTION", attention.length + "건", "결정 아님 · 담당자 확인", attention.length > 0);
}

function renderSummary(patient) {
  clear(refs.clinicalSummary);
  const groups = [
    ["활성 문제", ["condition", "symptom"]],
    ["최근 검사·측정", ["observation"]],
    ["약물·알레르기", ["medication", "allergy"]],
    ["내원·처치", ["encounter", "procedure", "note"]],
  ];
  for (const [title, types] of groups) {
    const section = element("section", "summary-group");
    section.append(element("h4", "", title));
    const events = patient.events.filter((event) => types.includes(event.type)).slice(0, 4);
    if (!events.length) {
      section.append(createEmptyMessage("해당 구조화 기록이 없습니다."));
    } else {
      const list = element("ul");
      for (const event of events) {
        const item = element("li", "summary-item");
        const value = event.value === "" ? "" : String(event.value) + (event.unit ? " " + event.unit : "");
        item.append(
          element("b", "", event.label),
          element("small", "", displayDate(event.date)),
          element("span", "", [value, event.code, event.note].filter(Boolean).join(" · ") || EVENT_LABELS[event.type]),
        );
        list.append(item);
      }
      section.append(list);
    }
    refs.clinicalSummary.append(section);
  }
}

function normalizedQuestion(item) {
  if (typeof item === "string") return { question: item, reason: "로컬 모델이 만든 의료진 검토용 질문입니다." };
  return {
    question: item?.question || item?.title || "확인 질문",
    reason: item?.reason || item?.basis || "",
    evidenceEventIds: Array.isArray(item?.evidenceEventIds) ? item.evidenceEventIds : [],
  };
}

function appendGroundedItem(list, text, evidenceEventIds, patient) {
  const eventById = new Map(patient.events.map((event) => [event.id, event]));
  const citations = [...new Set(evidenceEventIds ?? [])].map((id) => eventById.get(id)).filter(Boolean);
  if (!citations.length) return false;
  const item = element("li");
  item.append(document.createTextNode(text));
  const citationRow = element("span", "copilot-citations");
  for (const event of citations.slice(0, 4)) {
    citationRow.append(element(
      "small",
      "",
      [event.label, displayDate(event.date), event.source?.label, event.source?.resourceId].filter(Boolean).join(" · "),
    ));
  }
  item.append(citationRow);
  list.append(item);
  return true;
}

function renderCopilot(patient, evaluations) {
  const brief = briefCache.get(patient.id) ?? createLocalCopilotBrief(patient, evaluations, today());
  if (!briefCache.has(patient.id)) briefCache.set(patient.id, brief);
  clear(refs.copilotContent);
  refs.copilotMode.textContent = brief.kind === "model" ? "로컬 AI" : "규칙 기반";

  const summary = element("section", "copilot-section");
  summary.append(element("h4", "", "기록 요약"));
  const summaryList = element("ul");
  for (const item of brief.summary ?? []) {
    const text = typeof item === "string" ? item : item?.text;
    if (text) appendGroundedItem(summaryList, text, item?.evidenceEventIds ?? [], patient);
  }
  if (!summaryList.childElementCount) summaryList.append(element("li", "", "요약할 기록이 없습니다."));
  summary.append(summaryList);
  refs.copilotContent.append(summary);

  const priorities = brief.priorities ?? brief.tasks ?? [];
  const prioritySection = element("section", "copilot-section");
  prioritySection.append(element("h4", "", "확인 우선순위"));
  const priorityList = element("ul");
  for (const item of priorities) {
    appendGroundedItem(
      priorityList,
      (item.title ? item.title + " · " : "") + (item.reason ?? item.text ?? ""),
      item.evidenceEventIds,
      patient,
    );
  }
  if (!priorityList.childElementCount) priorityList.append(element("li", "", "자동 표시된 우선 작업이 없습니다."));
  prioritySection.append(priorityList);
  refs.copilotContent.append(prioritySection);

  if (Array.isArray(brief.warnings) && brief.warnings.length) {
    const warningSection = element("section", "copilot-section");
    warningSection.append(element("h4", "", "확인 필요"));
    const warningList = element("ul");
    for (const warning of brief.warnings) {
      const text = typeof warning === "string" ? warning : warning?.text;
      if (text) appendGroundedItem(warningList, text, warning?.evidenceEventIds ?? [], patient);
    }
    warningSection.append(warningList);
    refs.copilotContent.append(warningSection);
  }

  const provenance = element("section", "copilot-section");
  provenance.append(element("h4", "", "사용한 근거"));
  const chips = element("div", "copilot-provenance");
  const explicitSources = Array.isArray(brief.provenance) ? brief.provenance : [];
  const referencedIds = new Set((brief.priorities ?? []).flatMap((item) => item.evidenceEventIds ?? []));
  const sources = explicitSources.length
    ? explicitSources
    : patient.events.filter((event) => referencedIds.has(event.id)).map((event) => ({ label: event.label, date: event.date }));
  for (const source of sources.slice(0, 8)) chips.append(element("span", "", source.label + " · " + displayDate(source.date)));
  if (!chips.childElementCount) chips.append(element("span", "", "직접 연결된 이벤트 근거 없음"));
  provenance.append(chips);
  refs.copilotContent.append(provenance);

  refs.runCopilot.disabled = copilotBusy;
  refs.runCopilot.textContent = copilotBusy ? "로컬 초안 생성 중…" : "근거로 초안 다시 만들기";
}

function renderNextWork(evaluations) {
  clear(refs.nextWorkList);
  const attention = evaluations
    .filter((item) => ["missing-evidence", "due-soon", "unknown", "ready"].includes(item.status))
    .slice(0, 3);
  for (const item of attention) {
    const card = element("article", "next-work-item");
    card.append(
      element("span", "", CLAIM_LANE_LABELS[item.status] ?? "확인"),
      element("b", "", item.title),
      element("p", "", item.explanation),
    );
    refs.nextWorkList.append(card);
  }
  if (!attention.length) refs.nextWorkList.append(createEmptyMessage("현재 샘플 규칙에서 바로 확인할 작업이 없습니다."));
}

function renderEventFilters(patient) {
  clear(refs.eventFilters);
  const types = ["all", ...new Set(patient.events.map((event) => event.type))];
  for (const type of types) {
    const button = element("button", "", type === "all" ? "전체" : EVENT_LABELS[type] ?? type);
    button.type = "button";
    button.dataset.eventFilter = type;
    button.setAttribute("aria-pressed", String(eventFilter === type));
    refs.eventFilters.append(button);
  }
}

function renderTimeline(patient) {
  renderEventFilters(patient);
  clear(refs.eventTimeline);
  const events = patient.events.filter((event) => eventFilter === "all" || event.type === eventFilter);
  refs.eventCount.textContent = events.length + "건";
  for (const event of events) {
    const item = element("li", "event-row");
    item.append(element("time", "", displayDate(event.date)));
    const body = element("div", "event-row__body");
    const header = element("header");
    header.append(element("span", "event-type-badge", EVENT_LABELS[event.type] ?? event.type), element("b", "", event.label));
    body.append(header);
    const value = event.value === "" ? "" : String(event.value) + (event.unit ? " " + event.unit : "");
    const codedValue = event.code ? [event.system, event.code].filter(Boolean).join(" | ") : "";
    const detail = [value, codedValue, event.note].filter(Boolean).join(" · ");
    if (detail) body.append(element("p", "", detail));
    body.append(element("span", "event-source", "",));
    body.lastElementChild.textContent = (event.source?.label || "출처 없음") + (event.source?.resourceId ? " · " + event.source.resourceId : "");
    item.append(body);
    const remove = element("button", "event-remove", "삭제");
    remove.type = "button";
    remove.dataset.removeEvent = event.id;
    remove.setAttribute("aria-label", event.label + " 기록 삭제");
    item.append(remove);
    refs.eventTimeline.append(item);
  }
  if (!events.length) refs.eventTimeline.append(createEmptyMessage("선택한 유형의 기록이 없습니다."));
}

function graphPositions(nodes) {
  const positions = new Map();
  if (!nodes.length) return positions;
  const columns = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(nodes.length * (900 / 520)))));
  const rows = Math.ceil(nodes.length / columns);
  const horizontalMargin = 70;
  const verticalMargin = 60;
  const horizontalStep = columns === 1 ? 0 : Math.min(190, (900 - horizontalMargin * 2) / (columns - 1));
  const verticalStep = rows === 1 ? 0 : Math.min(140, (520 - verticalMargin * 2) / (rows - 1));
  const firstRowY = 260 - ((rows - 1) * verticalStep) / 2;
  nodes.forEach((node, index) => {
    const row = Math.floor(index / columns);
    const rowStart = row * columns;
    const rowCount = Math.min(columns, nodes.length - rowStart);
    const rowWidth = (rowCount - 1) * horizontalStep;
    positions.set(node.id, {
      x: 450 - rowWidth / 2 + (index - rowStart) * horizontalStep,
      y: firstRowY + row * verticalStep,
    });
  });
  return positions;
}

function renderGraph(patient) {
  const graph = createClinicalGraph(patient);
  const positions = graphPositions(graph.nodes);
  clear(refs.clinicalGraph);
  if (!graph.nodes.length) {
    const text = svgElement("text", { x: 450, y: 260, "text-anchor": "middle", fill: "currentColor" });
    text.textContent = "그래프로 표시할 구조화 임상기록이 없습니다.";
    refs.clinicalGraph.append(text);
  } else {
    const edgeGroup = svgElement("g", { "aria-hidden": "true" });
    for (const edge of graph.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const line = svgElement("line", {
        class: `clinical-edge${edge.kind === "inferred" ? " clinical-edge--inferred" : ""}`,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      });
      const title = svgElement("title");
      title.textContent = `${edge.kind === "inferred" ? "추론 관계" : "명시 관계"} · ${edge.label} · ${edge.basis || "관계 출처 없음"}`;
      line.append(title);
      edgeGroup.append(line);
      if (edge.kind === "inferred") {
        const label = svgElement("text", {
          class: "clinical-edge-label",
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2 - 5,
          "text-anchor": "middle",
        });
        label.textContent = "추론";
        edgeGroup.append(label);
      }
    }
    refs.clinicalGraph.append(edgeGroup);
    for (const node of graph.nodes) {
      const position = positions.get(node.id);
      const group = svgElement("g", {
        class: "clinical-node",
        "data-type": node.type,
        transform: "translate(" + position.x + " " + position.y + ")",
        tabindex: "0",
        role: "group",
        "aria-label": (EVENT_LABELS[node.type] ?? node.type) + " " + node.label + " " + displayDate(node.date),
      });
      const title = svgElement("title");
      title.textContent = node.label + " · " + (node.code || "코드 없음") + " · " + displayDate(node.date);
      const label = svgElement("text", { y: 4 });
      label.textContent = node.label.length > 12 ? node.label.slice(0, 11) + "…" : node.label;
      const meta = svgElement("text", { class: "node-meta", y: 21 });
      meta.textContent = node.code || EVENT_LABELS[node.type] || node.type;
      group.append(title, svgElement("circle", { r: node.type === "condition" ? 45 : 39 }), label, meta);
      refs.clinicalGraph.append(group);
    }
  }

  clear(refs.graphLegend);
  for (const type of ["condition", "observation", "medication", "allergy", "procedure", "symptom"]) {
    const item = element("span");
    const dot = element("i", "legend-dot");
    dot.style.background = GRAPH_COLORS[type];
    item.append(dot, document.createTextNode(EVENT_LABELS[type]));
    refs.graphLegend.append(item);
  }

  clear(refs.graphEvidenceList);
  for (const edge of graph.edges) {
    const from = graph.nodes.find(({ id }) => id === edge.from);
    const to = graph.nodes.find(({ id }) => id === edge.to);
    if (!from || !to) continue;
    const item = element("li", "graph-relation-note");
    item.append(
      element("b", "", `${edge.kind === "inferred" ? "추론 관계" : "명시 관계"} · ${from.label} → ${to.label}`),
      element("span", "", `${edge.label} · ${edge.basis || "관계 출처 없음"}${edge.kind === "inferred" ? " · 차트 사실 아님" : ""}`),
    );
    refs.graphEvidenceList.append(item);
  }
  for (const node of graph.nodes) {
    const item = element("li");
    item.append(
      element("b", "", node.label + (node.code ? " · " + node.code : "")),
      element("span", "", displayDate(node.date) + " · " + (node.source?.label || "출처 없음")),
    );
    refs.graphEvidenceList.append(item);
  }
  if (!graph.nodes.length) refs.graphEvidenceList.append(createEmptyMessage("연결할 차트 근거가 없습니다."));
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function renderClaimBoard(patient) {
  const patients = boardScope === "all" ? state.patients : [patient];
  const board = buildClaimBoard(patients, state.rules, today());
  clear(refs.claimBoard);
  for (const status of CLAIM_LANE_ORDER) {
    const lane = element("section", "claim-lane");
    const header = element("header");
    header.append(element("h4", "", CLAIM_LANE_LABELS[status]), element("span", "", board.lanes[status].length));
    lane.append(header);
    const cards = element("div", "claim-lane__cards");
    for (const evaluation of board.lanes[status]) {
      const card = element("article", "claim-card");
      card.dataset.status = status;
      const top = element("div", "claim-card__top");
      const serviceCode = element("code", "", evaluation.serviceCode);
      serviceCode.title = [evaluation.rule.serviceSystem, evaluation.serviceCode].filter(Boolean).join(" | ");
      top.append(element("b", "", evaluation.title), serviceCode);
      card.append(top);
      if (boardScope === "all") card.append(element("span", "claim-patient", evaluation.patientName + " · " + (evaluation.patientMrn || "등록번호 없음")));
      card.append(element("p", "", evaluation.explanation));
      if (evaluation.missingEvidence.length) {
        card.append(element("p", "claim-missing", "보완 확인 · " + evaluation.missingEvidence.join(", ")));
      }
      const facts = element("div", "claim-facts");
      facts.append(
        element("span", "", "차트 시행 " + evaluation.usedCount + "/" + evaluation.rule.maxCount + "건"),
        element("span", "", evaluation.nextEligibleDate ? "수동 대조 " + evaluation.nextEligibleDate : "기준일 수동 확인"),
      );
      card.append(facts);
      const evidenceEvents = evaluation.evidenceEventIds
        .map((id) => state.patients.find((item) => item.id === evaluation.patientId)?.events.find((event) => event.id === id))
        .filter(Boolean);
      if (evidenceEvents.length) {
        const evidence = element("div", "claim-evidence");
        evidence.append(element("b", "", "연결 차트 근거"));
        for (const event of evidenceEvents.slice(0, 5)) {
          evidence.append(element(
            "span",
            "",
            [event.label, event.date, [event.system, event.code].filter(Boolean).join(" | "), event.source?.label, event.source?.resourceId].filter(Boolean).join(" · "),
          ));
        }
        card.append(evidence);
      }
      card.append(element(
        "span",
        "claim-rule-version",
        "규칙 " + evaluation.rule.ruleSetId + " · v" + evaluation.rule.version + " · " + evaluation.rule.effectiveFrom + " ~ " + (evaluation.rule.effectiveTo || "현재"),
      ));
      card.append(element("span", "claim-manual-note", "Claim/ClaimResponse 미연결 · 청구·심사 이력 수동 대조"));
      const sourceUrl = safeExternalUrl(evaluation.rule.sourceUrl);
      if (sourceUrl) {
        const source = element("a", "claim-source", evaluation.rule.sourceLabel + " ↗");
        source.href = sourceUrl;
        source.target = "_blank";
        source.rel = "noreferrer";
        card.append(source);
      } else {
        card.append(element("span", "claim-source", evaluation.rule.sourceLabel));
      }
      cards.append(card);
    }
    if (!cards.childElementCount) cards.append(createEmptyMessage("해당 상태 없음", "claim-empty"));
    lane.append(cards);
    refs.claimBoard.append(lane);
  }
}

function renderJourney(patient, brief) {
  clear(refs.clinicalJourney);
  const grouped = new Map();
  for (const event of patient.events) {
    if (!grouped.has(event.date)) grouped.set(event.date, []);
    grouped.get(event.date).push(event);
  }
  for (const [date, events] of grouped) {
    const item = element("li", "journey-day");
    item.append(element("time", "", displayDate(date)));
    const list = element("ul");
    for (const event of events) {
      const value = event.value === "" ? "" : " · " + String(event.value) + (event.unit ? " " + event.unit : "");
      list.append(element("li", "", (EVENT_LABELS[event.type] ?? event.type) + " · " + event.label + value));
    }
    item.append(list);
    refs.clinicalJourney.append(item);
  }
  if (!grouped.size) refs.clinicalJourney.append(createEmptyMessage("Journey로 묶을 임상기록이 없습니다."));

  clear(refs.visitQuestions);
  const eventById = new Map(patient.events.map((event) => [event.id, event]));
  for (const item of brief.questions ?? []) {
    const question = normalizedQuestion(item);
    const sources = question.evidenceEventIds.map((id) => eventById.get(id)).filter(Boolean);
    if (!sources.length) continue;
    const li = element("li");
    li.append(element("b", "", question.question), element("span", "", question.reason));
    li.append(element(
      "span",
      "question-citations",
      "근거 · " + sources.map((event) => [event.label, event.date, event.source?.label, event.source?.resourceId].filter(Boolean).join(" · ")).join(", "),
    ));
    refs.visitQuestions.append(li);
  }
  if (!refs.visitQuestions.childElementCount) refs.visitQuestions.append(createEmptyMessage("질문을 만들 구조화 문제가 없습니다."));
}

function renderAudit() {
  clear(refs.auditList);
  const events = [...state.audit].reverse();
  refs.auditCount.textContent = events.length + "건";
  for (const event of events) {
    const item = element("li");
    item.append(element("time", "", displayTimestamp(event.at)));
    const detail = element("div");
    detail.append(
      element("b", "", AUDIT_LABELS[event.action] ?? event.action),
      element("span", "", [event.actor, event.patientId, event.detail].filter(Boolean).join(" · ")),
    );
    item.append(detail);
    refs.auditList.append(item);
  }
  if (!events.length) refs.auditList.append(createEmptyMessage("아직 로컬 변경 이력이 없습니다."));
}

function renderDataFacts() {
  clear(refs.dataFacts);
  const facts = [
    ["저장 위치", state.demo ? "메모리 전용 데모" : "브라우저 localStorage"],
    ["환자 수", state.patients.length + "명"],
    ["임상 이벤트", state.patients.reduce((sum, patient) => sum + patient.events.length, 0) + "건"],
    ["급여 규칙", state.rules.length + "개"],
    ["마지막 변경", displayTimestamp(state.updatedAt)],
    ["저장 상태", state.storageError ? "복구 필요" : "정상"],
    ["백업 암호화", "없음 · 별도 보호 필요"],
  ];
  for (const [term, description] of facts) {
    refs.dataFacts.append(element("dt", "", term), element("dd", "", description));
  }
  refs.exportRecoveryRaw.hidden = !state.recoveryRaw;
}

function renderFhirReport() {
  refs.fhirImportReport.hidden = !lastFhirReport;
  if (!lastFhirReport) {
    refs.fhirImportReportSummary.textContent = "";
    clear(refs.fhirImportIssues);
    return;
  }
  refs.fhirImportReportSummary.textContent = "지원 " + lastFhirReport.supported + "건 · 제외 " + lastFhirReport.unsupported + "건";
  clear(refs.fhirImportIssues);
  for (const item of lastFhirReport.unsupportedItems ?? []) {
    refs.fhirImportIssues.append(element(
      "li",
      "",
      item.resourceType + (item.id ? "/" + item.id : "") + " · " + item.reason,
    ));
  }
  if (lastFhirReport.unsupportedTruncated) {
    refs.fhirImportIssues.append(element("li", "", "추가 제외 항목 " + lastFhirReport.unsupportedTruncated + "건"));
  }
  if (!refs.fhirImportIssues.childElementCount) refs.fhirImportIssues.append(element("li", "", "제외된 리소스가 없습니다."));
}

function renderTabs() {
  for (const tab of document.querySelectorAll("[data-tab]")) {
    const selected = tab.dataset.tab === activeTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== activeTab;
  for (const link of document.querySelectorAll("[data-tab-target]")) {
    if (link.dataset.tabTarget === activeTab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function renderWorkspace() {
  const patient = selectedPatient();
  refs.workspaceEmpty.hidden = Boolean(patient);
  refs.workspaceContent.hidden = !patient;
  if (!patient) return;
  const evaluations = claimEvaluations(patient);
  refs.selectedPatientName.textContent = patient.name;
  refs.selectedPatientMeta.textContent = [
    patient.mrn || "등록번호 없음",
    patient.birthDate ? displayDate(patient.birthDate) : "생년월일 미상",
    ageFromBirthDate(patient.birthDate),
    SEX_LABELS[patient.sex],
  ].filter(Boolean).join(" · ");
  refs.lastSavedAt.textContent = state.demo ? "데모 · 저장 안 됨" : "저장 " + displayTimestamp(state.updatedAt);
  renderSafety(patient);
  renderMetrics(patient, evaluations);
  renderSummary(patient);
  renderCopilot(patient, evaluations);
  renderNextWork(evaluations);
  renderTimeline(patient);
  renderGraph(patient);
  renderClaimBoard(patient);
  renderJourney(patient, briefCache.get(patient.id));
}

function render() {
  refs.demoBanner.hidden = !state.demo;
  refs.exitDemo.hidden = !state.demo;
  refs.loadDemo.hidden = state.demo;
  renderPatients();
  renderTabs();
  renderWorkspace();
  renderAudit();
  renderDataFacts();
  renderFhirReport();
}

function resetPatientForm() {
  refs.patientForm.reset();
  refs.patientFormMode.value = "create";
  refs.patientFormMessage.textContent = "";
  refs.cancelPatientEdit.hidden = true;
  refs.patientComposer.querySelector("summary span").textContent = "새 환자 등록";
}

function beginPatientEdit() {
  const patient = selectedPatient();
  if (!patient) return;
  refs.patientFormMode.value = patient.id;
  refs.patientMrn.value = patient.mrn;
  refs.patientName.value = patient.name;
  refs.patientBirthDate.value = patient.birthDate;
  refs.patientSex.value = patient.sex;
  refs.patientPhone.value = patient.phone;
  refs.patientFormMessage.textContent = "";
  refs.cancelPatientEdit.hidden = false;
  refs.patientComposer.querySelector("summary span").textContent = "환자 정보 편집";
  refs.patientComposer.open = true;
  refs.patientMrn.focus();
}

function switchTab(tab, focus = false) {
  if (!document.querySelector("[data-panel='" + tab + "']")) return;
  activeTab = tab;
  renderTabs();
  if (focus) byId("tab-" + tab)?.focus();
}

function downloadJson(value, filename) {
  downloadText(JSON.stringify(value, null, 2), filename, "application/json;charset=utf-8");
}

function downloadText(value, filename, type = "text/plain;charset=utf-8") {
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function readJsonFile(file, maximumBytes = 5 * 1024 * 1024) {
  if (!file) throw new Error("파일이 선택되지 않았습니다.");
  if (file.size > maximumBytes) throw new RangeError(`가져오기 파일은 ${Math.floor(maximumBytes / 1024 / 1024)}MB 이하여야 합니다.`);
  return JSON.parse(await file.text());
}

async function checkAiStatus() {
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
  try {
    const response = await fetch("/api/clinical-copilot/status", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("status");
    const result = await response.json();
    aiCapability = {
      checked: true,
      configured: loopback && result.configured === true,
      model: typeof result.model === "string" ? result.model : "",
    };
    if (aiCapability.configured) {
      refs.aiStatusDot.classList.add("is-ready");
      refs.aiStatusLabel.textContent = "로컬 AI 연결";
      refs.aiStatusDetail.textContent = aiCapability.model + " · 브리프만 생성";
    } else {
      refs.aiStatusLabel.textContent = "규칙 기반 모드";
      refs.aiStatusDetail.textContent = "Ollama 모델 미설정 · 기능 정상";
    }
  } catch {
    aiCapability = { checked: true, configured: false, model: "" };
    refs.aiStatusLabel.textContent = "규칙 기반 모드";
    refs.aiStatusDetail.textContent = "공개 빌드 · 환자 데이터 전송 안 함";
  }
}

async function runCopilot() {
  const patient = selectedPatient();
  if (!patient || copilotBusy) return;
  const evaluations = claimEvaluations(patient);
  briefCache.set(patient.id, createLocalCopilotBrief(patient, evaluations, today()));
  renderCopilot(patient, evaluations);
  if (!aiCapability.configured) {
    setStatus("규칙 기반 초안을 만들었습니다. 로컬 AI가 설정되지 않아 환자 데이터를 전송하지 않았습니다.", "success");
    renderJourney(patient, briefCache.get(patient.id));
    return;
  }
  copilotBusy = true;
  renderCopilot(patient, evaluations);
  setStatus("규칙 기반 초안을 먼저 만들었습니다. 이름·등록번호·전화·자유메모를 제외한 구조화 차트를 로컬 AI에 보냅니다.");
  try {
    const request = createCopilotRequest(patient, evaluations, today());
    const requestFingerprint = copilotRequestFingerprint(request);
    const response = await fetch("/api/clinical-copilot", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request.payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "로컬 AI를 사용할 수 없습니다.");
    if (result.kind !== "model") throw new Error("로컬 모델 초안 형식이 올바르지 않습니다.");
    const currentPatient = state.patients.find(({ id }) => id === patient.id);
    const currentRequest = currentPatient
      ? createCopilotRequest(currentPatient, claimEvaluations(currentPatient), today())
      : null;
    if (selectedPatient()?.id !== patient.id
      || !currentRequest
      || copilotRequestFingerprint(currentRequest) !== requestFingerprint) {
      throw new Error("차트 또는 급여 기준이 변경되어 오래된 로컬 AI 초안을 폐기했습니다.");
    }
    briefCache.set(patient.id, restoreCopilotEvidenceIds(result, request.aliasToEventId));
    setStatus("로컬 AI 초안을 만들었습니다. 의료진 검토 전 확정 기록이 아닙니다.", "success");
  } catch (error) {
    setStatus((error instanceof Error ? error.message : "로컬 AI 연결 실패") + " 규칙 기반 초안을 유지합니다.");
  } finally {
    copilotBusy = false;
    const current = selectedPatient();
    if (current) {
      const currentEvaluations = claimEvaluations(current);
      renderCopilot(current, currentEvaluations);
      renderJourney(current, briefCache.get(current.id));
    }
  }
}

refs.patientSearch.addEventListener("input", renderPatients);

refs.patientList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-patient-id]");
  if (!button) return;
  try {
    const candidate = selectPatient(state, button.dataset.patientId);
    if (state.demo) {
      state = candidate;
    } else {
      const saved = saveEmrState(candidate);
      state = saved;
      savedState = saved;
    }
    eventFilter = "all";
    activeTab = "overview";
    render();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "환자 선택을 저장하지 못했습니다.", "error");
  }
});

refs.patientForm.addEventListener("submit", (event) => {
  event.preventDefault();
  refs.patientFormMessage.textContent = "";
  const mrn = refs.patientMrn.value.trim();
  const name = refs.patientName.value.trim();
  const mode = refs.patientFormMode.value;
  if (!mrn || !name) {
    refs.patientFormMessage.textContent = "등록번호와 이름을 입력하세요.";
    return;
  }
  const duplicate = state.patients.find((patient) => patient.mrn === mrn && patient.id !== mode);
  if (duplicate) {
    refs.patientFormMessage.textContent = "같은 등록번호가 이미 있습니다.";
    return;
  }
  const payload = {
    mrn,
    name,
    birthDate: refs.patientBirthDate.value,
    sex: refs.patientSex.value,
    phone: refs.patientPhone.value,
  };
  try {
    if (mode === "create") {
      applyMutation((current) => addPatient(current, payload), "환자를 등록했습니다.");
    } else {
      applyMutation((current) => updatePatient(current, mode, payload), "환자 정보를 수정했습니다.");
    }
    resetPatientForm();
    refs.patientComposer.open = false;
  } catch (error) {
    refs.patientFormMessage.textContent = error instanceof Error ? error.message : "환자 저장에 실패했습니다.";
  }
});

refs.cancelPatientEdit.addEventListener("click", resetPatientForm);
refs.editPatient.addEventListener("click", beginPatientEdit);

refs.eventForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const patient = selectedPatient();
  refs.eventFormMessage.textContent = "";
  if (!patient) return;
  if (!refs.eventDate.value || !refs.eventLabel.value.trim()) {
    refs.eventFormMessage.textContent = "기록일과 이름을 입력하세요.";
    return;
  }
  try {
    applyMutation((current) => appendPatientEvent(current, patient.id, {
      type: refs.eventType.value,
      date: refs.eventDate.value,
      system: refs.eventSystem.value,
      code: refs.eventCode.value,
      label: refs.eventLabel.value,
      value: refs.eventValue.value,
      unit: refs.eventUnit.value,
      note: refs.eventNote.value,
      source: { kind: "manual", label: "직접 입력" },
    }), "확정 차트에 기록을 추가했습니다.");
    refs.eventForm.reset();
    refs.eventDate.value = today();
  } catch (error) {
    refs.eventFormMessage.textContent = error instanceof Error ? error.message : "기록 추가에 실패했습니다.";
  }
});

refs.eventFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-event-filter]");
  if (!button) return;
  eventFilter = button.dataset.eventFilter;
  const patient = selectedPatient();
  if (patient) renderTimeline(patient);
});

refs.eventTimeline.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-event]");
  const patient = selectedPatient();
  if (!button || !patient) return;
  const record = patient.events.find((item) => item.id === button.dataset.removeEvent);
  if (!window.confirm("‘" + (record?.label ?? "이 기록") + "’을 삭제할까요? 이 작업은 감사 이력에 남습니다.")) return;
  applyMutation((current) => removePatientEvent(current, patient.id, button.dataset.removeEvent), "임상 이벤트를 삭제했습니다.");
});

refs.ruleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  refs.ruleFormMessage.textContent = "";
  if (!refs.ruleForm.checkValidity()) {
    refs.ruleForm.reportValidity();
    return;
  }
  const applicabilityCodes = refs.ruleApplicabilityCodes.value.split(",").map((value) => value.trim()).filter(Boolean);
  const evidenceCodes = refs.ruleEvidenceCodes.value.split(",").map((value) => value.trim()).filter(Boolean);
  const lookbackDays = refs.ruleEvidenceLookbackDays.value ? Number.parseInt(refs.ruleEvidenceLookbackDays.value, 10) : 0;
  try {
    applyMutation((current) => addClaimRule(current, {
      ruleSetId: refs.ruleSetId.value,
      version: refs.ruleVersion.value,
      title: refs.ruleTitle.value,
      serviceCode: refs.ruleServiceCode.value,
      serviceSystem: refs.ruleServiceSystem.value,
      serviceEventType: refs.ruleServiceEventType.value,
      windowDays: refs.ruleWindowDays.value,
      maxCount: refs.ruleMaxCount.value,
      applicabilityCodes,
      applicabilitySystem: refs.ruleApplicabilitySystem.value,
      requiredEvidence: evidenceCodes.map((code) => ({
        code,
        system: refs.ruleEvidenceSystem.value.trim(),
        label: code,
        eventTypes: [refs.ruleEvidenceEventType.value],
        lookbackDays,
      })),
      effectiveFrom: refs.ruleEffectiveFrom.value,
      effectiveTo: refs.ruleEffectiveTo.value,
      sourceLabel: refs.ruleSourceLabel.value,
      sourceUrl: refs.ruleSourceUrl.value,
      sample: false,
    }), "기관 급여 규칙을 저장했습니다.");
    refs.ruleForm.reset();
    refs.ruleWindowDays.value = "365";
    refs.ruleMaxCount.value = "1";
    refs.ruleVersion.value = "1";
    refs.ruleEffectiveFrom.value = today();
  } catch (error) {
    refs.ruleFormMessage.textContent = error instanceof Error ? error.message : "규칙 저장에 실패했습니다.";
  }
});

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    switchTab(tab.dataset.tab);
    return;
  }
  const headerTab = event.target.closest("[data-tab-target]");
  if (headerTab) {
    event.preventDefault();
    switchTab(headerTab.dataset.tabTarget);
    document.querySelector(".patient-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const openTab = event.target.closest("[data-open-tab]");
  if (openTab) {
    switchTab(openTab.dataset.openTab, true);
    return;
  }
  if (event.target.closest("[data-load-demo]")) loadDemo();
});

document.querySelector(".workspace-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const focusedTab = event.target.closest("[data-tab]");
  const focusedIndex = tabs.indexOf(focusedTab);
  const current = focusedIndex >= 0 ? focusedIndex : tabs.findIndex((tab) => tab.dataset.tab === activeTab);
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const next = tabs[(current + direction + tabs.length) % tabs.length];
  event.preventDefault();
  switchTab(next.dataset.tab, true);
});

for (const button of document.querySelectorAll("[data-board-scope]")) {
  button.addEventListener("click", () => {
    boardScope = button.dataset.boardScope;
    for (const item of document.querySelectorAll("[data-board-scope]")) item.setAttribute("aria-pressed", String(item === button));
    const patient = selectedPatient();
    if (patient) renderClaimBoard(patient);
  });
}

function loadDemo() {
  state = createDemoEmrState();
  activeTab = "overview";
  eventFilter = "all";
  briefCache.clear();
  render();
  setStatus("가상 환자 2명을 열었습니다. 데모 변경은 저장되지 않습니다.", "success");
}

refs.loadDemo.addEventListener("click", loadDemo);
refs.exitDemo.addEventListener("click", () => {
  savedState = loadEmrState();
  state = savedState;
  briefCache.clear();
  const url = new URL(window.location.href);
  url.searchParams.delete("demo");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  render();
  if (state.storageError) setStatus("로컬 저장을 읽지 못했습니다. 손상 원본을 내보낸 뒤 백업 복원 또는 전체 삭제로 정리하세요.", "error");
  else setStatus("브라우저에 저장된 로컬 기록으로 돌아왔습니다.", "success");
});

refs.fhirImport.addEventListener("change", async () => {
  try {
    const bundle = await readJsonFile(refs.fhirImport.files?.[0], 2 * 1024 * 1024);
    const result = parseEmrFhirBundle(bundle);
    lastFhirReport = result.provenance;
    renderFhirReport();
    const base = state.demo ? loadEmrState() : state;
    if (base.storageError) throw new Error("손상된 로컬 저장을 먼저 원본으로 내보낸 뒤 복원 또는 삭제하세요.");
    const patient = result.patient;
    if (base.patients.some((item) => item.id === patient.id || (patient.mrn && item.mrn === patient.mrn))) {
      throw new Error("같은 FHIR 환자 ID 또는 등록번호가 이미 있습니다. 기존 환자 병합은 지원하지 않습니다.");
    }
    let candidate = addPatient(base, patient);
    candidate = appendStateAudit(
      candidate,
      "fhir.imported",
      `FHIR R4 · 지원 ${result.provenance.supported}건 · 제외 ${result.provenance.unsupported}건`,
      new Date().toISOString(),
      patient.id,
    );
    const saved = saveEmrState(candidate);
    state = saved;
    savedState = saved;
    activeTab = "overview";
    briefCache.clear();
    render();
    setStatus("FHIR R4에서 환자 1명과 임상기록 " + patient.events.length + "건을 가져왔습니다. 미지원 " + result.provenance.unsupported + "건.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "FHIR 가져오기에 실패했습니다.", "error");
  } finally {
    refs.fhirImport.value = "";
  }
});

refs.importEmr.addEventListener("change", async () => {
  try {
    const backup = await readJsonFile(refs.importEmr.files?.[0]);
    const parsed = parseEmrBackup(backup);
    if (!window.confirm("현재 브라우저의 환자 기록과 기관 규칙을 이 백업으로 교체할까요? 기존 데이터는 백업 없이는 복구할 수 없습니다.")) {
      setStatus("백업 복원을 취소했습니다.");
      return;
    }
    let candidate = { ...parsed, demo: false };
    candidate = appendStateAudit(candidate, "backup.restored", `환자 ${candidate.patients.length}명`);
    const saved = saveEmrState(candidate);
    state = saved;
    savedState = saved;
    briefCache.clear();
    render();
    setStatus("VitaGraph EMR 백업을 복원했습니다.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "백업 복원에 실패했습니다.", "error");
  } finally {
    refs.importEmr.value = "";
  }
});

function exportBackup() {
  const exportState = state.demo ? savedState : state;
  if (exportState.storageError) {
    setStatus("정상 백업을 만들 수 없습니다. 손상 저장 원본을 먼저 내보내세요.", "error");
    return;
  }
  downloadJson(exportEmrBackup(exportState), "vitagraph-emr-backup-" + today() + ".json");
  setStatus(state.demo ? "데모가 아닌 기존 로컬 기록을 백업했습니다." : "전체 로컬 기록을 JSON으로 내보냈습니다.", "success");
}

refs.exportEmr.addEventListener("click", exportBackup);
refs.exportEmrSecondary.addEventListener("click", exportBackup);
refs.exportRecoveryRaw.addEventListener("click", () => {
  if (!state.recoveryRaw) {
    setStatus("내보낼 손상 저장 원본이 없습니다.");
    return;
  }
  downloadText(state.recoveryRaw, "vitagraph-emr-recovery-raw-" + today() + ".json", "application/json;charset=utf-8");
  setStatus("손상 저장 원본을 변경 없이 내보냈습니다.", "success");
});

refs.wipeEmr.addEventListener("click", () => {
  if (!window.confirm("이 브라우저의 VitaGraph EMR 환자 기록과 기관 규칙을 모두 삭제할까요? 백업 없이는 복구할 수 없습니다.")) return;
  try {
    clearEmrState();
    savedState = createEmptyEmrState();
    state = savedState;
    briefCache.clear();
    lastFhirReport = null;
    refs.fhirImport.value = "";
    refs.importEmr.value = "";
    refs.patientForm.reset();
    refs.eventForm.reset();
    refs.ruleForm.reset();
    refs.eventDate.value = today();
    refs.ruleEffectiveFrom.value = today();
    render();
    setStatus("이 브라우저의 VitaGraph EMR 기록을 모두 삭제했습니다.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "로컬 기록을 삭제하지 못했습니다.", "error");
  }
});

window.addEventListener("storage", (event) => {
  if (event.key !== EMR_STORAGE_KEY || state.demo) return;
  const latest = loadEmrState();
  state = latest;
  savedState = latest;
  briefCache.clear();
  render();
  setStatus(
    latest.storageError ? "다른 탭의 저장 변경을 읽지 못했습니다. 복구가 필요합니다." : "다른 탭의 로컬 기록 변경을 반영했습니다.",
    latest.storageError ? "error" : "success",
  );
});

refs.runCopilot.addEventListener("click", runCopilot);

refs.eventDate.value = today();
refs.ruleEffectiveFrom.value = today();
render();
if (!state.demo && state.storageError) {
  setStatus("로컬 저장을 읽지 못했습니다. 손상 원본을 내보낸 뒤 백업 복원 또는 전체 삭제로 정리하세요.", "error");
}
void checkAiStatus();
