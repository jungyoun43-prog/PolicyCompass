# Design

PolicyCompass 제품·UI·데이터 경계의 단일 설계 기준입니다.

## 0. Canonical Two-App Product Architecture

This section is normative. When a later patient or clinical detail conflicts with it, this two-app boundary wins.

### Product hierarchy and personas

- **Clinical app — primary product:** `/emr` is the physician-centered system of work. Physicians and authorized clinical staff select a patient, document the Encounter, review chart facts, use the selected patient's PolicyCompass projection, run pre-claim checks, and explicitly export a patient-safe transfer file. Clinical facts remain owned by the EMR record.
- **Patient app — personal companion:** `/patient` plus `/map`, `/connections`, `/insights`, and `/journey` are one personal PolicyCompass app for a patient or caregiver. It manages only that person's health map, relationship context, visit brief, and local Journey. It must not expose EMR queues, SOAP, clinicians, claims, audit history, or institutional controls.
- **Gateway — neutral and stateless:** `/` only asks which app to open. It has no data-entry controls, scripts, storage access, PHI, role detection, or background routing. The physician action is visually primary and links to `/emr`; the personal action links to `/patient`.
- The two apps are separate products with a narrow file handoff, not two tabs over one shared browser record. They must not read each other's `localStorage` or `sessionStorage`, pass health data in URLs, use `BroadcastChannel` for chart exchange, or silently synchronize through a server.

### Route ownership

| Route | Owner | Purpose | Data boundary |
|---|---|---|---|
| `/` | Gateway | Explicit role choice | Stateless; no PHI or storage |
| `/emr` | Clinical app | Primary physician EMR workspace | Full local clinical sandbox record |
| `/emr?demo=1` | Clinical app | Labelled synthetic evaluation record | Demo only; never real patient data on a public preview |
| `/patient` | Patient app | Personal PolicyCompass landing and start | Personal app state only |
| `/map` | Patient app | Personal record input and health map | Personal app state and explicit file import |
| `/connections` | Patient app | Condition relationship explorer | Patient-safe condition context only |
| `/insights` | Patient app | Visit brief and questions | Personal app state only |
| `/journey` | Patient app | Explicit local snapshots | Personal Journey storage only |

`.html` aliases are compatibility routes, not separate products. Brand links may return to `/` for role switching, but role switching never transfers data.

### Explicit patient-file handoff

The only sanctioned bridge is a manually downloaded and manually selected JSON file with `schema: "policycompass-patient-transfer"` and `version: 1`. Export always scopes to the clinician's currently selected patient. Import never inspects EMR storage.

The v1 object is an exact allowlist:

```text
{
  schema: "policycompass-patient-transfer",
  version: 1,
  exportedAt: <canonical ISO-8601 instant>,
  transferCode: <128-bit random Crockford Base32 code>,
  scope: "patient-policy-compass",
  trust: "unsigned-local-export",
  healthMap: {
    conditions: [{ id, label, recordedOn, basis: "confirmed-condition" }],
    measurements: [{ key, code, label, value, unit, observedOn, basis: "final-observation" }]
  },
  summary: { includedConditions, includedMeasurements }
}
```

- `conditions` contains only supported, confirmed KCD condition codes that the patient app can represent. The KCD system and structured code are authoritative; a free-text label cannot override them. `measurements` contains only final LOINC observations with an allowed code, canonical unit, bounded value, and observation date. Split systolic/diastolic events are never combined by date.
- `transferCode` is freshly generated for every export from at least 128 bits of Web Crypto randomness. The clinician sees patient name plus code before download and gives the code to the patient through a different channel. The patient must confirm the same code before any map/session mutation. This mitigates accidental file handoff only; it does not authenticate a patient or institution, sign the file, prevent replay, or bind multiple exports to one Journey profile.
- The file excludes all identifiers and demographics, including name, chart number/MRN, FHIR Patient identity, birth date, age, sex, phone, address, insurance, emergency contact, and blood type.
- It also excludes internal patient/Encounter/event/resource IDs, chief concern, SOAP, free text, clinician/department/room/signature, medications, allergies, procedures, orders, claims, reimbursement rules/results, audit events, AI output, revisions, and actor metadata.
- The source allowlist is positive: `encounter` facts require a non-empty Encounter ID that resolves to the same patient's finished Encounter with a current local `signed` signature, non-empty signer, and signing instant. Legacy-migrated completion markers are not signatures and never qualify. Only `manual` facts may stand alone, after explicit clinician “검토·확정”. Draft, provisional, differential, refuted, cancelled, entered-in-error, orphaned, unsupported, demo, imported, copilot-generated, and external-unverified facts are omitted. Raw imported FHIR facts remain ineligible for patient transfer.
- Unknown keys, an unsupported schema/version/scope/trust value, invalid transfer code/counts, malformed or future dates, invalid systems/codes/units/ranges, unsupported condition or measurement IDs, and an oversized file fail closed. A valid import replaces only the current unsaved map after complete validation and recipient-code confirmation; existing Journey history changes only through a separate explicit save action.
- The personal app accepts only this transfer schema. Generic patient-side FHIR fallback is intentionally absent so multi-patient Bundles cannot silently merge. Clinical FHIR import/export remains owned by `/emr`.
- The file still contains sensitive personal health information. It is plain, unencrypted, and unsigned JSON. `trust: "unsigned-local-export"` means the patient app cannot verify origin, authorship, or valid-value tampering without institution-managed cryptographic keys.

### Security limitations and production decisions

Current separation is a product and code boundary, not a security boundary. All routes share one origin, and browser storage is plaintext to code running on that origin. The local sandbox has no authentication, RBAC, encrypted clinical database, tamper-resistant audit service, institutional backup, account recovery, or server-side retention enforcement.

The transfer file creates additional risks: it can be copied, opened, altered, delivered to the wrong person, or imported into the wrong personal record. Removing identity fields follows minimum-necessary disclosure, but it also removes an automated recipient-match check. The one-time code and selected-patient confirmation reduce accidental mismatch only. A receiver must compare the code and source out of band. Existing Journey entries trigger a separate same-person warning because one-time codes cannot identify a stable patient profile.

Production cannot proceed until owners answer and test these questions:

- Should clinical and personal apps use separate origins/subdomains to create a real browser security boundary?
- Which identity provider, clinician roles, break-glass rules, session controls, and authorization audit apply?
- Who may export, how is patient consent recorded, and what retention/deletion policy covers transfer files?
- Will transfers be encrypted for the intended recipient and cryptographically signed so origin and tampering can be verified?
- How are wrong-patient delivery and import prevented without embedding identifiers in the minimum dataset?
- What clinician attestation workflow promotes imported or manually entered drafts into confirmed/final chart facts?
- Which accessibility fallback is required when file download/upload or browser persistence is unavailable?
- Which privacy, medical-law, security, clinical-safety, and regulatory reviews approve real-patient deployment?

### Two-app acceptance criteria

- `GET /` and `HEAD /` return the role gateway. It contains explicit links to `/emr` and `/patient`, presents EMR as primary, and contains no `script`, form/input control, storage call, PHI field, or automatic redirect.
- `GET /patient` returns the personal landing. `/map`, `/connections`, `/insights`, and `/journey` remain working patient routes; their navigation contains no EMR workflow controls.
- `GET /emr` remains the physician workspace. Its PolicyCompass and patient export use only the currently selected EMR patient and never read patient-app storage.
- Clinical-to-personal exchange works only through an explicit `policycompass-patient-transfer` v1 download and explicit import. There is no direct storage sharing, background sync, URL payload, or implicit role coupling.
- Export uses the exact allowlist above and excludes every prohibited field. Only confirmed conditions and final observations from a locally signed Encounter or explicit manual clinician confirmation qualify; raw FHIR, generic import, copilot, demo, draft, provisional, refuted, cancelled, or external-unverified facts do not.
- Import validates the complete object before mutation, rejects unknown or malformed content, communicates unsigned/unencrypted risk, and stores accepted data only inside the personal app boundary.
- Demo records cannot be exported. Patient transfer and institutional FHIR exports reject stale cross-tab revisions and unsaved form state; successful real-patient exports append a local audit event before download.
- Desktop and 390px layouts identify both roles without horizontal overflow; both actions are keyboard reachable, at least 44px high, and have visible focus.
- Build, route, model, transfer-boundary, keyboard/content, and security-header tests pass before release.

## 1. Atmosphere & Identity

PolicyCompass feels like a bright clinical atlas rather than a hospital portal. The signature is a white full-body field threaded into a vivid health graph, so body regions and related conditions feel like one explorable system. The product communicates possibility and clarity while avoiding diagnostic certainty.

### Connected life signals

The recurring PolicyCompass signature is a small thread of connected nodes. A solid path and filled node mean a fact present in the person's record; a dashed cyan path and outlined node mean a relationship inferred from labelled literature or keyword context. This motif appears in brand kickers, graph legends, and first-use paths so the identity also teaches the product's evidence model.

- Use the shared `.signal-kicker` and `.signal-thread` contract instead of inventing page-specific medical icons.
- Always pair record/inference color with line style, fill, text, and accessible naming. Color alone never communicates evidence status.
- Keep the motif restrained: one signature moment per hero or major graph surface. It must not resemble an ECG trace, DNA helix, medical cross, or AI sparkle, because those shapes imply capabilities PolicyCompass does not claim.

## 2. Color

### Palette

| Role | Token | Value | Usage |
|---|---|---|---|
| Surface/primary | `--surface` | `#F8FCF8` | Near-white page background |
| Surface/soft | `--surface-soft` | `#E8F5E9` | Pale green section and graph surfaces |
| Surface/raised | `--surface-raised` | `#FFFFFF` | Main panels |
| Surface/inverse | `--surface-inverse` | `#1B5E20` | Dark green role and trust surfaces |
| Text/on-inverse | `--on-inverse` | `#F8FCF8` | Primary text on inverse surfaces |
| Text/on-inverse-muted | `--on-inverse-muted` | `#CFE9D1` | Supporting text on inverse surfaces |
| Text/primary | `--ink` | `#173B1B` | Headlines, body, and primary actions |
| Text/secondary | `--muted` | `#4F6452` | Guidance and metadata |
| Border/subtle | `--line` | `#A5D6A7` | Decorative dividers and soft boundaries |
| Border/control | `--line-strong` | `#548858` | Input and interactive boundaries |
| Interactive | `--accent` | `#1B5E20` | Focus, selected state, and active emphasis |
| Interactive/mid | `--accent-mid` | `#66BB6A` | Decorative active fills and large marks only |
| Interactive/soft | `--accent-soft` | `#A5D6A7` | Section separation and selected backgrounds |
| Interactive/wash | `--accent-wash` | `#E8F5E9` | Calm hero and supporting surfaces |
| Data/cyan | `--data-cyan` | `#247F87` | Respiratory and monitoring nodes |
| Data/lime | `--data-lime` | `#477A43` | Nutrition and lifestyle evidence marks |
| Data/violet | `--data-violet` | `#71688F` | Neurologic and mental-health nodes |
| Data/amber | `--data-amber` | `#B66B12` | Metabolic caution nodes on light surfaces |
| Status/success-text | `--status-success-text` | `#2F6B34` | Small success text on light surfaces |
| Status/success-on-dark | `--status-success-on-dark` | `#A5D6A7` | Success marks on inverse surfaces |
| Status/demo-on-dark | `--status-demo-on-dark` | `#66BB6A` | Demo marks on inverse surfaces |
| Status/amber-on-dark | `--status-amber-on-dark` | `#F2C66D` | Small caution labels on dark surfaces |
| Status/urgent | `--urgent` | `#B4232D` | Emergency guidance only |

Forest green is the sole interaction accent. The lighter greens are reserved for surfaces, dividers, and decorative active fills because they do not meet text or control contrast on white. Cyan, violet, amber, and red remain semantic evidence/status colors; the lighter amber token exists only to preserve text contrast on dark surfaces. No color may be used to claim a diagnosis.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| Display | `clamp(2.25rem, 4vw, 4.5rem)` | 760 | 1.08 | Product statement |
| H1 | `2rem` | 740 | 1.22 | Panel headline |
| H2 | `1.375rem` | 700 | 1.35 | Section title |
| H3 | `1rem` | 680 | 1.5 | Card title |
| Body/lg | `1.0625rem` | 480 | 1.72 | Introductory copy |
| Body | `0.9375rem` | 450 | 1.68 | Default content |
| Body/sm | `0.8125rem` | 500 | 1.6 | Supporting detail |
| Caption | `0.75rem` | 650 | 1.5 | Labels and metadata |

Primary stack: `Pretendard Variable, Noto Sans KR, ui-sans-serif, system-ui, sans-serif`. Noto Sans KR is loaded with `font-display: swap` so Korean labels remain legible in minimal Linux and cloud environments as well as on local devices.
Mono stack: `ui-monospace, SFMono-Regular, Consolas, monospace`.

## 4. Spacing & Layout

Base unit is 4px. Tokens: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px, `--space-12` 48px.

Desktop uses a 12-column grid within 1480px. The data input takes 3 columns, body map 4 columns, and relationship graph 5 columns. Tablet collapses to 6 columns; mobile stacks all regions in reading order with 16px gutters.

## 5. Components

### Surface panel
- Structure: semantic section with title, optional controls, and content.
- Radius: 18px. Padding: 24px.
- States: default, focus-within, loading, empty, error.
- Accessibility: visible headings, landmark labels, no color-only status.

### Signal chip
- Structure: native button with `aria-pressed`.
- Radius: full pill. Padding: 8px 12px.
- States: default, hover, pressed, focus, disabled.

### Graph node
- Structure: an SVG group with one compact, unlabeled condition dot and a persistent disease title plus system/relationship metadata below. Care guidance never becomes a graph node.
- Hierarchy: all condition dots use the same 44px diameter so density never masquerades as severity. The selected condition uses a halo and solid fill; directly related conditions remain vivid; unrelated or standalone signals are quieter but keep readable external labels.
- Geometry: collision bounds include both the orb and its text footprint. Each edge starts and ends at the orb boundary, curves slightly to avoid a mechanical diagram look, and carries a readable relationship pill separate from node labels.
- Layout: position is computed once from condition-to-condition relationship forces rather than rows, columns, or cards. Selecting a node must never recalculate coordinates; only an explicit reset, breakpoint change, or drag may move nodes.
- States: default, related, selected, standalone, dragged, and keyboard focus.
- Accessibility: each group is keyboard selectable with `aria-pressed`; the current state is described in its accessible name and every selection is mirrored in the detail rail.

### Explorer scene
- Structure: a dedicated full-viewport condition graph with a floating toolbar, semantic SVG scene, and persistent detail rail.
- Layout: deterministic force-directed placement balances center gravity, node repulsion, relationship springs, and collision radii.
- Interaction: select a condition to update the adjacent text-only checks, food, care, and evidence notes; drag to pin a node and reset to recompute the scene.
- Responsive: desktop uses scene plus detail rail; mobile stacks a minimum 560px scene above the detail rail.
- Accessibility: graph groups are keyboard selectable, visible focus is mandatory, and every selection is mirrored in text.

### Body atlas
- Structure: a self-hosted GLB clinical mannequin with twelve native-button specialty markers and a readable department index. A generated transparent WebP is retained only as the safe fallback when WebGL or the model cannot load; every patient-specific state remains a semantic HTML/CSS overlay.
- Coverage: neurology, psychiatry, ophthalmology/ENT, cardiology, pulmonology, gastroenterology, endocrinology, nephrology, gynecology/urology, orthopedics/rehabilitation, rheumatology, and dermatology/allergy are always visible even when no current record maps to them.
- Presentation: automatically show one large, centered, rotatable 3D androgynous adult with a matte translucent shell and muted internal organs. Every organ mesh stays inside the closed body shell, every marker anchor and normal comes from the body surface, and no labels or diagnosis-like marks are baked into the asset.
- Interaction: drag the body to inspect it. There are no 2D/3D, organ visibility, or front-view controls; organs remain naturally visible and 2D appears only as a load/error fallback.
- States: an active marker is solid and paired with a named condition caption; an inactive marker remains hollow and explicitly says that the current record has no connection there.
- Accessibility: inactive regions are disabled, active regions have descriptive labels, and the selected area is reflected with `aria-pressed` and in the detail panel.

### FHIR import box
- Structure: compact local-file picker above manual entry, with format tag, privacy promise, and parse result.
- Scope: one-patient FHIR R4 Bundle subset for Condition, Observation, MedicationRequest, AllergyIntolerance, Procedure, and Encounter. Every clinical resource requires an exact matching subject; absolute/URN references match the Patient fullUrl exactly, while relative Patient references resolve only from the referencing entry fullUrl base. Current condition/allergy facts require active + confirmed lifecycle, and medications require active order-family intent with doNotPerform=false. Unknown modifierExtension/implicitRules, unsupported Patient active/deceased/link semantics, and malformed modifier primitives fail closed. Unsupported records retain a visible reason and never become inferred diagnoses.
- States: idle, parsing, success, error. File size is capped at 2 MB.

### Evidence card
- Structure: connected condition, relationship category, plain-language rationale, and an external authoritative source.
- Language: describes why two topics are viewed together, never causality or a personalized medical conclusion.

### Journey timeline
- Structure: local snapshots on a vertical rail, followed by added/steady/removed comparison columns.
- Persistence: only explicit saves use browser local storage; each record can be removed and the entire history can be cleared.


### Application shell
- All surfaces use the same pale-green clinical foundation with forest-green interaction, restrained semantic data color, and low elevation. The gateway, patient app, and clinical app may tune density and hierarchy within those shared tokens.
- Gateway shell: one quiet brand rail and two explicit role actions. It has no application navigation because no data-bearing app is active yet.
- Patient shell: `/patient`, `/map`, `/connections`, `/insights`, and `/journey` use the same 1480px rail and explicit 시작, 건강 지도, 연결 보기, 진료 준비, 기록 navigation. The patient landing's active route is `/patient`; no EMR control appears in this navigation.
- Clinical shell: `/emr` uses its physician-centered queue, Encounter, and module navigation. It reuses brand/tokens but must not imitate the patient shell or depend on patient-app state.
- Page hero: each route begins on the same 1480px rail with a pale-green wash panel and 32px outer rhythm. A mono eyebrow, display heading no larger than 4.5rem, and its bounded supporting copy stay in one reading flow; secondary actions occupy the adjacent column without floating copy away from its heading.
- Primary workspace: Health Map has a balanced two-column input/body row. Full-width relationship and detail surfaces follow below; no empty third column is permitted.
- Landing density: the product landing pairs its statement with a live-looking graph vignette, a four-part capability rail, and a concrete workflow preview before supporting detail.
- Landing graph vignette: all conceptual nodes use the same 44px dot and place one persistent label below the circle. The central record node is distinguished by the interaction accent, not by a larger size or text inside the circle; edges stop at each dot boundary.

## 6. Motion & Interaction

Micro feedback uses 140ms ease-out. Panel transitions use 260ms ease-in-out. Emphasis entry uses 480ms cubic-bezier(0.16, 1, 0.3, 1). Only transform, opacity, and filter animate. Reduced-motion mode removes nonessential entry and floating effects. Analysis loading uses opacity only.

## 7. Depth & Surface

Strategy: shadows. Raised panels use a cool tinted shadow and white surface. Inner grouping relies on spacing and subtle tonal shifts. Borders are limited to interactive controls and data lines, not used as the primary panel-depth mechanism.

## 8. Personal Companion Product Contract

Within the patient app, PolicyCompass is a visit-preparation companion, not a diagnostic graph demo. Its consumer audience is a Korean-speaking adult who manages multiple chronic health topics for themselves or a parent. Their job is: “turn scattered measurements, symptoms, and known conditions into one page I can use at the next appointment.” This companion contract does not override `/emr` as the primary product and clinical source of truth.

The activation path is one outcome-first sequence:

1. Start with a clearly labeled sample or an empty private record.
2. Confirm which items came from the note and which conditions the user already knows.
3. Review the body and relationship views as supporting context.
4. Open a printable Visit Brief with no more than five questions and a reason for each.
5. Save a dated snapshot only through an explicit action.

The paid-value hypothesis is a single plan around KRW 6,900 per month, aligned with comparable personal-health software at USD 6–9 per month. The current local beta must not claim that checkout, cloud sync, account recovery, or encrypted backup exists. Until those capabilities and policies are real, pricing is presented as a validation target and all product CTAs lead to the working sample or private local workflow.

## 9. Clinical Honesty Rules

- Public patient-facing routes must not use `AI`, `LLM`, probability, prediction, diagnosis, or personalized-risk language until a real model, traceable evidence layer, external validation, and monitoring exist. The local clinical sandbox may expose a clearly labelled copilot draft only when every statement links back to source chart data; its deterministic fallback must be labelled rule-based and never presented as model output.
- Text matching is described as rule-based organization. An inferred measurement pattern is an “item to confirm,” never a newly diagnosed condition.
- Patient-declared conditions, clinician-confirmed imported conditions, and text-derived measurement or symptom signals are separate typed records. A flat condition ID must never erase that provenance.
- Journey stores the original instant and `Asia/Seoul` clinical calendar date together with typed condition provenance and input signals. Restored backups are always labelled unverified and cannot promote an arbitrary source string to clinician-confirmed provenance.
- Sample data is opt-in, carries a persistent sample label, and is isolated from imported records, Journey, export, and model requests.
- Every generated question states why it appears. Questions are conversation prompts, not treatment advice.
- Values always retain their unit, date when known, and source. Correlation uses “changed together,” never causal wording.
- Trust claims describe only what the code proves: local browser processing, no application server upload, explicit local storage, export/delete controls when available, and the risk of browser-data deletion.
- No fabricated testimonials, clinicians, customer counts, certifications, compliance claims, or support contacts.

## 10. Image and Interface Roles

Generated imagery owns atmosphere, empathy, and the landing focal scene. HTML and SVG own every interactive, measurable, or medical fact.

- Hero: an original editorial image of one person with abstract record layers and PolicyCompass-colored signals. No baked-in text, numbers, organs, diagnosis marks, charts, badges, logos, or imitation product UI.
- Product proof: real HTML-rendered Visit Brief and health-map surfaces, not a generated dashboard screenshot.
- Body atlas: the existing generated mannequin remains a neutral navigation base; all user state is semantic overlay content.
- Controls, forms, pricing, trust statements, charts, focus states, and responsive behavior remain native UI.

Image-first restraint follows Apple’s focal-object and whitespace grammar, PicnicHealth’s human-plus-record orbit, and Parsley Health’s calm clinical editorial tone. PolicyCompass keeps its own forest-green foundation and restrained cyan/lime/violet evidence system and does not copy brand imagery, layouts, or claims.

## 11. Patient Landing Narrative

1. State the appointment problem and the one-page outcome above the fold.
2. Offer two 44px actions: view a labeled sample and start with an empty record.
3. Prove the output with a real Visit Brief preview before feature explanation.
4. Explain the three-step flow: add record, confirm connections, take the brief.
5. Place the local-processing and non-diagnostic trust strip immediately before data-entry CTAs.
6. Present one transparent beta plan, naming what works now and what requires a hosted paid release.
7. Close with the same sample and private-start actions. No dead lead-capture form.

## 12. Reference Research Log

Research date: 2026-07-17.

- Lazyweb queries: `personal health records dashboard onboarding`, `lab results health dashboard insights`, `health tracking timeline medical reports`.
- 24 search results reviewed; five screens inspected closely: PicnicHealth overview, MyQuest laboratory timeline, Parsley Health clinical membership, Gentler activity product, WHOOP advanced labs.
- Market flows reviewed: Function Health, Superpower, InsideTracker, Mito Health, Guava, Heads Up Health, Oura, and Exist.
- Extracted: Function’s benefit-to-process-to-trust sales order; Guava’s records/timeline structure; Oura’s one-question-per-screen hierarchy; Exist’s statistical honesty; Apple’s image-led restraint.
- Rejected: celebrity authority, countdowns, unverified medical detection claims, score proliferation, generated fake product screenshots, and compliance badges the implementation cannot substantiate.

## 13. Patient App Release Acceptance

- At 390px, the first screen identifies the buyer, appointment job, one-page outcome, sample action, and private-start action without horizontal overflow.
- Primary actions are at least 44px high and have visible keyboard focus.
- The map starts empty. Sample content appears only after an explicit action and stays visibly labeled.
- Rule-derived items are framed as confirmation signals. Known conditions remain user-declared or imported.
- Visit Brief prints cleanly, contains at most five questions with reasons, and never mentions AI or LLM.
- The working routes build with the existing zero-dependency stack and preserve GET/HEAD-only, no-network CSP behavior.
- Desktop and mobile screenshots, keyboard traversal, reduced-motion, automated tests, and route/content checks pass before release.

## 14. Local Clinical EMR Extension

### Source of truth

- Status: Active
- Last refreshed: 2026-07-20
- Primary product surface: `/emr`, a physician-centered local outpatient EMR workspace. `/patient` and its feature routes are the separate personal PolicyCompass companion; `/` is the stateless role gateway.
- Evidence reviewed: `README.md`, all existing HTML routes, `src/data.js`, `src/patient-transfer.js`, `src/journey-model.js`, `src/insight-model.js`, shared shell and control styles, tests, and existing desktop/mobile baseline captures under `.omo/artifacts/baseline/`.

### Brand

- Personality: calm clinical command center; precise, humane, low-noise.
- Trust signals: local-only state, explicit source provenance, effective-dated reimbursement rules, draft/confirmed separation, visible audit trail, export and wipe controls.
- Avoid: futuristic AI theatre, opaque scores, revenue-first language in the clinical graph, fake compliance claims, diagnostic certainty, and colors that imply severity without text.

### Product goals

- Let a clinician complete one outpatient visit in order: find or register the patient, start an Encounter, document SOAP, add KCD diagnoses, record prescriptions and orders, review safety and billing evidence, finish, and locally sign the chart.
- Capture usable patient demographics: chart number, name, date of birth with calculated age, sex, phone, address, insurance details, and emergency contact. Age is derived from date of birth and the relevant reference date (today or the Encounter date) rather than stored as an independent fact.
- Give clinicians and billing coordinators one encounter-linked view of PolicyCompass relationships, longitudinal Journey, source-linked assistance, and pre-claim eligibility/evidence checks.
- Reduce preventable claim adjustments by surfacing interval, count, evidence, and documentation gaps before submission, without promising reimbursement or adjustment prevention.
- Preserve the existing PolicyCompass consumer experience and reuse its relationship, provenance, Journey, and visit-preparation concepts.
- Non-goals: certified production EMR, legal electronic-prescription transmission, live HIRA submission, PACS/OCS integration, qualified electronic signature, medical-device diagnosis, autonomous treatment decisions, guaranteed zero adjustments, cloud accounts, multi-user synchronization, or storing real identifiers without an institution-approved security deployment.
- Success signals: complete a labelled demo visit in under five minutes; demographics and visit records survive local reload; every rule result explains evidence and rule version; all data can be exported and wiped; no AI draft enters signed chart state automatically.

### Personas and jobs

- Primary personas: outpatient clinician, nurse/care coordinator, and claims-review coordinator evaluating the product locally.
- User jobs: manage today's waiting queue, open a patient, confirm identity and safety context, document a complete visit, review clinical relationships, resolve pre-claim documentation gaps, locally sign the encounter, and export a portable backup.
- Key context: desktop-first during chart review; tablet during rounds; compact mobile view for read-only triage and quick tasks.

### Information architecture

- Primary navigation inside `/emr`: 진료, 과거기록, PolicyCompass, 급여 점검, Journey, 데이터.
- The default screen is not an analytics dashboard. It is a work queue and active Encounter workspace.
- Desktop hierarchy:
  1. Left rail: today's waiting/in-progress/completed queue, patient search, and new-patient entry.
  2. Center: active Encounter header, SOAP, diagnoses, prescriptions, orders, draft save, finish, and local sign.
  3. Right rail: demographics summary, allergies/current medications, source-linked assistance, and encounter-specific pre-claim checks.
- Secondary screens retain the selected patient and Encounter context. PolicyCompass, Journey, assistance, and reimbursement tasks never become disconnected copies of clinical facts.
- The institution-wide reimbursement board remains available for billing review, while the active visit always exposes its unresolved risk count and a direct path to the relevant cards.

### Core clinical workflow

1. Select an existing patient from today's queue or create a patient record.
2. Enter or edit chart number, name, date of birth, date-derived age (or a clearly labelled direct age when birth date is unknown), sex, phone, address, insurance type, and emergency contact.
3. Start an Encounter with date/time, department, clinician, and chief concern. Queue state changes from waiting to in progress.
4. Record structured vital signs and common measurements as Encounter-owned LOINC observations. Values remain visible beside SOAP and become final only with the same local signature.
5. Write Subjective, Objective, Assessment, and Plan, then save the Encounter as a draft without requiring completion.
6. Add one or more KCD diagnoses with code, display, primary/secondary role, and clinical status.
7. Add prescriptions with medication/code, dose and unit, route, frequency, duration, quantity, and directions. The record is a local clinical draft, not a transmitted legal prescription.
8. Add laboratory, imaging, procedure, or referral orders with code, priority, status, and instructions.
9. Review allergy/current-medication context, encounter-linked PolicyCompass/AI support, and pre-claim eligibility/evidence warnings.
10. Finish the visit, then locally sign it. A signed Encounter is immutable. Only a completed but unsigned Encounter can be reopened, with the transition captured in the audit trail.

The Encounter is the clinical unit of work. Diagnoses, prescriptions, procedures, observations, Journey entries, PolicyCompass nodes, assistance citations, and reimbursement evidence reference the same Encounter ID. Derived views must not silently fork or overwrite signed source records.

### Design principles

1. Record of truth and assistance are visibly separate. Confirmed chart facts use neutral surfaces; suggestions use tinted, labelled surfaces and require a human action.
2. Clinical graph and reimbursement status are linked but not conflated. Clinical nodes never change severity because of claim risk.
3. Every computed status answers “why, from which record, under which rule version, and what next?”
4. Dense workflow stays scan-friendly through compact typography, consistent lane grammar, and progressive disclosure rather than dashboard ornament.
5. Patient identity, demographics, allergies, and the active Encounter remain visible while a clinician writes. Switching supporting modules must not discard unsaved draft input.
6. The UI records clinician decisions; it does not recommend a diagnosis, dose, duration, or treatment autonomously.
- Tradeoff: local-first simplicity enables immediate evaluation but cannot claim institutional security, concurrency, recovery, or certification.

### Visual language

- Color: use the shared forest-green interaction accent and pale-green surface scale with restrained cyan/lime/violet/amber data colors. Reimbursement states add semantic text and icons; red is reserved for hard safety/error states, never routine claim risk.
- Typography: existing Noto/Pretendard stack; compact 12–14px operational metadata and 16–22px patient/work headings.
- Spacing/layout rhythm: existing 4px scale; desktop cockpit uses a 280px patient rail plus fluid workspace; boards scroll horizontally without shrinking cards below 260px.
- Shape/radius/elevation: reuse control and panel radii; reduce shadow depth inside dense clinical workspaces.
- Motion: 140ms feedback only; no animated medical or financial state changes.
- Imagery/iconography: no decorative clinical imagery inside EMR. Use CSS/SVG/data marks with text equivalents.

### Components

- Existing components to reuse: app brand, skip link, buttons, chips, panels, detail lists, graph node semantics, Journey comparison, Visit Brief question cards.
- New components: today's queue, patient demographic editor, patient safety header, Encounter header, four-part SOAP editor, KCD diagnosis list, prescription line editor, order list, draft/final/sign action bar, provenance badge, copilot draft panel, reimbursement summary, reimbursement rule card, Kanban lane, rule explanation drawer, audit event, and local data toolbar.
- Variants and states: waiting/in-progress/completed, draft/finished/signed/reopened, primary/secondary diagnosis, documented/inferred, rule pass/warn/not-ready/unknown, empty/loading/error/saved, demo/private.
- Token ownership: shared visual tokens remain in `foundation.css`; EMR-only composition belongs to `emr.css`; domain state classes must not redefine shared shell primitives.

### Accessibility

- Target: WCAG 2.2 AA behavior for keyboard, labels, landmarks, focus visibility, contrast, status announcements, and minimum 44px primary touch targets.
- Keyboard/focus: tabs use buttons with `aria-selected`; Kanban remains a semantic list with headings; dialogs restore focus; graph selection mirrors into text.
- Contrast/readability: never rely on color; dates, counts, rule state, and missing evidence remain explicit text.
- Screen readers: patient selection, save status, destructive data actions, and copilot provenance use live/status regions conservatively.
- Reduced motion: all nonessential transitions removed under `prefers-reduced-motion`.

### Responsive behavior

- Supported: 390px, 768px, 1280px, and wide desktop.
- Desktop: fixed queue rail, flexible Encounter editor, and compact safety/claim rail; full Kanban uses horizontal scroll.
- Tablet: queue becomes a top worklist strip; the safety/claim rail moves below the Encounter editor.
- Mobile: queue, patient identity, Encounter editor, and safety/claim summary stack in that order; tabs and lanes scroll; editing forms remain full-width; graph becomes text-first when space is constrained.
- Mobile gateway: both role names and both role actions must appear within the first 844px viewport; supporting bullet lists may collapse so one long role card cannot hide the other choice.
- Mobile EMR: patient and Encounter work precede transfer, FHIR, and backup utilities. Secondary data operations live in a labelled disclosure instead of occupying the full first viewport.
- Touch/hover: all critical content available without hover; drag is never required.

### Interaction states

- Loading: local operations use brief inline state, not blocking skeletons.
- Empty: one primary action and a truthful explanation; demo records load only by explicit action.
- Error: preserve user input and show a recovery action.
- Success: announce saved/exported state and retain visible timestamp.
- Disabled: include a reason near the control.
- Offline: full deterministic workflow remains available; configured model assistance may fail closed to the labelled rule-based brief.

### Accessibility and responsive audit evidence (2026-07-23)

- Assumption: native browser confirmation dialogs provide the accessible, keyboard-operable confirmation boundary for destructive local-only actions; no custom dialog semantics are substituted.
- Verified by automation: shared skip links and labelled landmarks, visible keyboard focus, labelled controls, status/alert regions, reduced-motion overrides, horizontal-overflow checks, and reachable primary actions at 390×844. The `/map` empty-submit path marks the health-note control `aria-invalid`, retains the entered value, and returns focus to that control for correction.
- The responsive primary-action gate checks every parent route at 390×844 for visibility within the first viewport, a 44×44px minimum target, keyboard focus and visible focus, unobstructed reachability, and no horizontal clipping. In particular, `/map` checks the visible `건강 지도 업데이트` action.
- Product evidence is the native markup, shared tokens, and error-recovery behavior. Harness evidence is limited to deterministic DOM, accessibility-tree, viewport, and keyboard assertions; it cannot establish clinical comprehension or WCAG certification.
- Unverified and release-blocking external gate: the real sessions defined in `USABILITY.md` (three personal users and three clinical or health-information users) remain unperformed. No automated result is treated as a substitute for those sessions.

### Content voice

- Tone: direct Korean clinical operations language; short labels, complete safety explanations.
- Terminology: “청구 전 적합성”, “조정 위험”, “근거 부족”, and “확인 필요”; never “삭감 방지 보장”.
- AI copy: “코파일럿 초안” only for actual model output; fallback copy says “규칙 기반 요약”. Always display “의료진 검토 전 확정 기록 아님”.

### Implementation constraints

- Framework: existing zero-dependency ES modules and generated Worker asset bundle.
- Persistence: versioned browser `localStorage` JSON with Web Locks-serialized writes, revision conflict checks, anti-resurrection wipe tombstones, cross-tab in-memory/DOM purge on wipe, strict backup validation, corrupt-source recovery export, import/export, and wipe; no silent sample persistence. An unsigned backup never restores its local signatures, institution rules, or audit trail as trusted state: every restored clinical event, including drafts, becomes immutable external/unverified data. Restored records cannot be confirmed, changed, cancelled, or used for a local signature; restored Encounter drafts also cannot be continued, completed, signed, or reopened, but they do not block a new local Encounter. A clinician must create that new Encounter or manually re-enter and verify a fact. Restored events remain excluded from AI, reimbursement evidence, FHIR clinical export, and patient transfer. It is not an encrypted clinical database.
- Clinical record: patient demographics and Encounter-owned SOAP, diagnoses, prescriptions, and orders are the local source of truth. Signed encounters cannot be reopened or edited; corrections require an explicit void/amendment workflow outside this sandbox.
- FHIR: FHIR R4 is an exchange projection, not the application's reimbursement rule source. Import accepts only Bundles with exactly one Patient and explicit matching subject references; current facts require fail-closed lifecycle certainty, and unsupported resources plus reasons remain visible in the import report. Raw imported FHIR facts remain untrusted for finalized summaries, AI, reimbursement, and patient transfer, while an explicit institutional FHIR export may losslessly re-emit supported facts with their original `meta.source` and source identifier. Re-emission preserves exchange provenance and is not clinician attestation. Exported resources preserve the Encounter link where the supported subset allows it.
- Structured observations: the Encounter vital-sign picker, model validation, claim evidence, FHIR projection, and patient transfer share one bounded local catalogue of active LOINC codes and canonical display units. It validates nonblank values and ranges before creating a draft Observation and records the exact observation timestamp. A blood-pressure panel exports as systolic/diastolic UCUM components, not an invalid scalar string. This catalogue is an input aid, not an institution terminology service or clinical decision rule.
- Clinical graph: node provenance is factual. Keyword relationships are heuristic only and must remain dashed, labelled `추론`, and accompanied by their basis plus “차트 사실 아님”.
- Reimbursement: Korean benefit review is based on HIRA claim statements and effective benefit/review criteria, not on FHIR itself. The product provides deterministic, effective-dated pre-claim eligibility and evidence checks. Institution-authored rules require coding-system namespaces for applicability, evidence, and service matching. Procedure/Observation/Encounter records are chart evidence, not adjudicated claims; Claim/ClaimResponse remain a manual reconciliation boundary. AI cannot set pass/fail or promise reimbursement.
- Security: no analytics, no remote fonts/data beyond existing style contract, no credentials in browser storage, and no production-compliance claim.
- Compatibility: latest Chrome/Edge/Firefox/Safari desktop; graceful fallback when local persistence is unavailable.
- Test expectations: pure model tests, route/build/header tests, persistence serialization tests, keyboard/content assertions, local Chrome screenshots at desktop and mobile widths.

### Open questions

- [ ] Institution-specific HIRA rule catalogue ingestion and update authority / product owner + claims specialist / blocks production claim guidance, not local sample evaluation.
- [ ] Certified identity, access control, encryption-at-rest, backup, and retention profile / security and legal owners / blocks real-patient deployment.
- [ ] Which on-premise model and validation dataset become supported / clinical AI owner / blocks validated generative summaries, not deterministic fallback.
- [ ] Live claim submission adapter and certified claim-software scope / billing integration owner / blocks HIRA submission, not readiness workflow.

### EMR release acceptance

- Existing routes and their regression baseline remain intact.
- `/emr` starts empty, explicitly loads a labelled demo, and supports patient create/select/edit, FHIR import, local backup export/import, and full wipe.
- A patient can store chart number, name, date of birth, derived age, sex, phone, address, insurance information, and emergency contact without losing existing records during schema migration.
- Today's queue supports waiting, in-progress, and completed states and opens the same selected-patient Encounter workspace.
- A clinician can start an Encounter, save all four SOAP sections, add multiple KCD diagnoses, add prescriptions with dose/frequency/duration/directions, and add laboratory/imaging/procedure orders.
- A clinician can add, review, remove, sign, export, and patient-transfer eligible structured vital signs without duplicating them as unlinked manual chart events.
- Unsubmitted measurement, diagnosis, prescription, or order input blocks patient/Encounter switching, completion, import, and export so typed clinical content cannot cross context or disappear silently.
- Browser refresh or page exit requests confirmation whenever patient edits, Encounter/SOAP changes, unsubmitted clinical items, or manual history input remain unsaved.
- An unsigned JSON backup restores every clinical event as external/unverified, blocks promotion or local signing of restored drafts, retains the currently installed institution rules, discards the supplied audit trail, and adds one fresh local restore audit event.
- Finishing and locally signing an Encounter records timestamps and audit actions. Signed content cannot be silently edited.
- Selected patient and Encounter show diagnoses, medications, allergies, observations, procedures, PolicyCompass, Journey, assistance, and source provenance without duplicating the source record.
- Encounter-side checks and the full reimbursement board calculate interval/count/evidence states from effective-dated deterministic rules and expose patient plus institution views.
- Reimbursement wording consistently says pre-claim eligibility/evidence review and never implies FHIR determines coverage or the product guarantees adjustment prevention.
- Copilot output is source-linked, labelled as actual model or deterministic fallback, and cannot mutate confirmed records.
- Desktop and mobile screenshot review, keyboard navigation, reduced motion, build, and all tests pass before handoff.
