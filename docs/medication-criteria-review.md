# Medication criteria review

The structured pilot covers the project's registered Korean benralizumab notice
(2026-92) and Aetna CPB 0917's unresectable stage II/III NSCLC consolidation pathway.
Both expose initial and continuation review paths. Other registered policies retain
their existing model-report/decision handling; failure never becomes a rule verdict.

## Data and execution

`src/medication-policy-criteria.js` contains internal versioned criterion IDs,
source anchors and AND/OR trees. These are application interpretations, not official
policy text or a clinically certified rules catalogue. Source notices remain intact.
Normalized full-text SHA-256 binds each pilot tree to the notice checked on
2026-10-16. An edited or updated notice returns `incomplete`, `verdict: null` until
the tree is reviewed and versioned. Update the source hash, anchors and regressions
together. Aetna's snapshot fixture records the exact official extracted sections
used to check the tree; it does not replace the live official-source endpoint.

`scripts/medication-criteria-review.mjs` separates review scope, patient facts,
the selected prescription, full source documents and patient evidence IDs. A selected
prescription does not establish the entire regimen. International comparison does
not establish actual foreign insurance enrollment. Aetna's contract-specific
preferred-drug and linked-document details remain an explicit scope limitation.

The model returns every requested criterion once, with `met`, `not_met`, `missing`
or `ambiguous`, evidence IDs (`E1`, `E2`, ...), typed numeric facts and a reason.
The server attaches source text and available dates directly, so the model need not
copy clinical prose. JSON records retain their paths; plain text is indexed by
paragraph, keeping date headings and their multiline laboratory values together.
The complete input is still supplied intact. Any unsolicited model-authored quotes
or dates are discarded; unknown IDs cannot become evidence.
The server checks completeness and source references, binds laboratory values to
their recorded units, computes thresholds, dates and reductions, then aggregates
the verified tree. Missing information is distinct from documented nonfulfillment;
both map to cross under the current product definition. Ambiguous relevant evidence
maps to triangle unless another mandatory condition fails. A fulfilled OR branch
does not fail because an unused alternative lacks information.

Benralizumab switching has explicit prior-biologic, omalizumab trial/reason and
submission-letter conditions. A switching route outside the encoded exception
returns incomplete rather than extrapolating a new eligibility rule. Event counts
deduplicate documented episode IDs and overlapping periods. If separate exacerbations
cannot be established from the record, the extraction must return ambiguous.

The existing LangGraph node makes one model request, with at most one validation
retry inside its time budget. No additional model is called to write the report.
Jev's verdict-only API cannot supply this pilot's evidence contract and returns
incomplete if selected for a pilot policy; it remains available for other policies.
All failures have a null verdict. The UI restores editable inputs and displays
`검토 미완료`; basic age/allergy/duplicate checks are not promoted to an overall
coverage verdict. The API uses the existing JSON heartbeat to survive proxy idle
timeouts, and the client handles delayed `code/message` errors after HTTP 200.
Failed responses retain per-attempt validation issues and the rejected model text
for diagnosis in the requesting client's response, never as an accepted report.
This diagnostic text is not written to a database or production log.

Translations continue using Haiku. No original-versus-translation number, unit or
code comparison gate is introduced. A translated review carries its original notice
for selecting the versioned tree; evidence quotes refer to the supplied translated
patient data. Input documents and operator instructions are not truncated.

## Validation and limits

Tests cover missing monotherapy, explicit monotherapy, exclusion precedence,
unused OR alternatives, 350 eosinophils plus three exacerbations, chronic oral
steroid alternatives, 606-cell calculations, unit relabeling, overlapping events,
switching/continuation subconditions, incomplete outputs, timeouts, edited source
versions and full input preservation. Legacy report/Decisions tests use the
non-pilot Korean durvalumab route so their compatibility does not bypass the pilot.

These tests exercise software contracts with controlled model responses. They do
not establish clinical model accuracy. A quote match does not prove that its meaning
supports the criterion, that an exclusion is absent, or that comparison periods are
clinically equivalent. Model extraction and the authored rules still require an
adjudicated evaluation set before clinical use. Gemma remains the configured review
model; this change does not assert that its interpretation now matches stronger models.

Prescription rows share dose, unit, frequency, infusion-slot and action columns.
The optional infusion field reserves its column on desktop; the existing container
breakpoints stack the form on narrower surfaces.
