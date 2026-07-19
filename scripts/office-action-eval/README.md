# Office Action Studio — evaluation harness

Real-document eval for the FER/OA pipeline. Keeps the profile honest against
genuine office output rather than synthetic text.

## fixtures/

Text extracted (via `pdftotext -layout`) from real First Examination Reports
downloaded from the Indian Patent Office e-register (public documents). Each is
a current (2026) bilingual IPO FER following the standard four-part template
(Summary / Detailed Technical Report / Formal Requirements / Documents on Record).

- `fer-in-01.txt` — App 202541122810 (IIT Hyderabad); objections: inventive step,
  3(d)+3(e), sufficiency, clarity, definitiveness, Form 3. Cited art: NPL only (D1–D4).
- `fer-in-02.txt` — App 202541118981; inventive step, 3(d), sufficiency, clarity,
  definitiveness. Cited art: NPL (D1–D5).
- `fer-in-03.txt` — App 202531116984; inventive step, sufficiency, clarity,
  definitiveness. Cited art: NPL (D1–D3).

To add more: `pdftotext -layout your-fer.pdf scripts/office-action-eval/fixtures/fer-in-NN.txt`.

## What the eval proves

`npm run oa:eval` (or `tsx scripts/office-action-eval/validate-real-fers.ts`) runs
the DETERMINISTIC pipeline pieces against every fixture:

1. **Instrument detection** from the profile's `detectionHints` — each real FER is
   recognized as an `FER` and not confused with a hearing notice.
2. **Deadline engine** — the reply deadline computed from the "Date of Dispatch"
   is cross-checked against the office's OWN printed "Last date for filing response".
   All three match to the day (dispatch + 6 months, Rule 24B(5)).

The LLM stages (parse / classify) require model API keys and are exercised by
`scripts/test-office-action-pipeline.ts` with a stubbed gateway. Running the LLM
stages against these fixtures with live models is the Phase-1 classification-quality
gate (target ≥90% objection-classification F1).

## Provenance / privacy

These are public FERs from the IPO e-register, used here only as an internal test
corpus. Do not redistribute as a dataset.
