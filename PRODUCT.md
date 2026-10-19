# PolicyCompass

<!-- impeccable:product-schema 1 -->

## Platform

web. React/Next.js application with distinct physician and personal app routes.

## Users

The primary clinical app serves physicians and authorized clinical staff working with a selected patient and Encounter. The personal companion serves a patient or caregiver preparing their health map and questions for a visit. These roles are established in DESIGN.md and README.md.

## Product Purpose

The clinical app connects the patient queue, Encounter documentation, diagnoses, prescriptions, orders, chart review and evidence-bound pre-claim checks. The personal app supports an individual health map, relationship context, visit questions and explicit local Journey snapshots.

## Operating Context

The gateway / is a neutral, stateless role choice. /emr is the clinical workspace; /emr?demo=1 is a labelled synthetic evaluation route. /patient, /map, /connections, /insights and /journey belong to the personal companion. The current redesign starts with the physician's today-visit workspace and prescription composer.

## Capabilities and Constraints

- EMR and Personal never automatically read or synchronize each other's browser records. The sanctioned bridge is an explicit downloaded/selected allowlisted patient transfer file and recipient code.
- Clinical edits remain owned by the selected patient and Encounter. Preserve pending-input guards, saves, signing, audit and conflict behavior.
- Medication evidence binding, typed validation and verdict aggregation remain server-authoritative. Incomplete or failed review must remain incomplete.
- External model transmission retains explicit scope and consent. No model or real patient data is needed for synthetic UI evaluation.
- Current models, catalogues and record types determine the UI content. Generated proposal ages, dates, counts or extra wording are not new product requirements.
- A source-to-build identity claim requires evidence; the initial screenshots came from an existing build with only targeted draft-guard identity verified.

## Brand Commitments

Keep the PolicyCompass name and recognizable product mark. On 2026-10-19 the user selected the physician-specific “진료 흐름 · 기록과 다음 조작에 집중” proposal after viewing separate designs. This allows a new physician visual style and layout. The personal companion retains its separate role and design context; unrelated project designs are not a shared system.

## Evidence on Hand

README.md and DESIGN.md define the implemented product and two-app boundary. Synthetic EMR and prescription captures plus measured geometry are in the 2026-10-19 policy UI artifact folder. No real-patient, model-quality, usability-effectiveness or clinical-outcome claim follows from these captures.

## Product Principles

1. Keep selected-patient identity and allergy context clear while editing.
2. Put today's documentation and next actions ahead of optional onboarding.
3. Preserve unsaved clinical input and make failure states explicit.
4. Distinguish source evidence, model assistance and validated decisions.
5. Use responsive, keyboard-accessible semantic controls with readable Korean labels.

## Open Decisions

Deployment, institutional workflow commitments and any expansion beyond the existing feature set are outside this UI change. No new product capability or automatic cross-app data exchange is approved.
