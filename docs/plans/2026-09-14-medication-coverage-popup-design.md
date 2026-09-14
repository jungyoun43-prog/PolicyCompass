# Medication coverage popup

Confirmed flow: compact search rows with a single prescription action; context menu on each medication; coverage confirmation opens an in-app dialog. Other screenshot menu entries are disabled placeholders. Remove the AI review introduction from prescription search. Keep editable patient data, notice, prompt and model selection before any review request.

Use the existing Radix dialog and context menu primitives rather than a separate browser window (which complicates focus and patient state). Keep current prescribing behavior: selecting a drug fills the editable prescription form, then the clinician adds the draft.

The coverage dialog contains manufacturer product photography and a source link, registered criteria, patient review results, summary and copy action. Before execution it must show an unreviewed state. Keep fixture provenance visible and distinguish a rules fallback from an AI result. Preserve original evidence and model output rather than inventing clinical findings.

Implementation: add a small product presentation catalog and dialog summary component, move existing review UI to its own dialog, use Radix context menu for keyboard/touch support, and scope compact/popup styles. Verify both drugs, menu dismissal, explicit-send boundary, failed requests, and prescription selection with browser checks; run lint and build.

Sources checked 2026-09-14:
- https://astrazeneca.co.kr/product/?board_pid=49&mode=view
- https://astrazeneca.co.kr/product/?vid=36

The optional writing-plans skill is not installed in the available local skill roots; the implementation sequence is recorded here instead.
