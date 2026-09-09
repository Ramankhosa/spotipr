# Claim-drafting E2E fixtures

Each fixture is a JSON file with the disclosure that goes into Stage 0 and the
office-form expectations the generated claim set must meet per jurisdiction.
They are run by `scripts/e2e-claims-fixtures.ts` against a running dev server
(real LLM calls; gated by `E2E_LLM=1`).

```json
{
  "id": "software-scheduler",
  "title": "…",
  "rawIdea": "… the inventor's disclosure, verbatim …",
  "allowRefine": false,
  "patentTypePrimary": "SYSTEM",
  "jurisdictions": ["IN", "US", "EP"],
  "expect": {
    "IN": { "noCodes": ["USE_CLAIM", "METHOD_OF_TREATMENT"], "maxBlocking": 0, "textMustContain": ["as claimed in claim 1"], "textMustNotContain": ["non-transitory"] },
    "US": { "maxBlocking": 0, "textMustContain": ["non-transitory"], "categories": ["method", "system", "medium"] }
  }
}
```

`expect.<CC>`:

- `maxBlocking` — maximum number of `block` findings left in `claimFormReport.findings`.
- `noCodes` — finding codes that must not appear at any severity.
- `textMustContain` / `textMustNotContain` — substrings checked against the whole claim set (case-insensitive).
- `categories` — claim categories that must each appear at least once.
- `verbatimTerms` — inventor terms that must survive verbatim somewhere in the set (PRESERVE fixtures).

Two fixtures used in earlier PRESERVE testing are **not** in the repository
because their disclosures were pasted in chat rather than committed:

- `solar-dryer` — twin-chamber solar dryer with warm-keeper blocks and a
  humidity-swing flap (mechanical, PRESERVE). Coined terms that must survive:
  warm-keeper block, humidity-swing flap, mesh sled, chimney throat, night lid,
  drip ledge, coir twist-cord. Fallback numbers (8 blocks, 48–52 C paraffin,
  coir cord) belong in dependents only.
- `berberine` — stomach-raft bilayer tablet of berberine with melt-lock granules
  and a gas-nest layer (pharma, PRESERVE, supplementary tables). India must
  produce composition claims only (no method of treatment, no Swiss-type);
  EP must produce an "X for use in the treatment of Y" mirror; US may keep a
  method-of-treatment claim; CN must use Swiss-type form. Claim 1 must not
  carry the declared fallback values (1:1.5, 12 %, 8 %).

Drop their disclosures into `solar-dryer.json` and `berberine.json` following
the shape above to run them.
