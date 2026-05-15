// Shared DD user-data wrapper text.
// Keep LLM and display wrappers explicit so any intentional divergence is visible.

export const DD_USER_DATA_LLM_WRAPPER = `
----------------------------------------
INVENTOR-PROVIDED ILLUSTRATIVE DATA (NON-LIMITING)
----------------------------------------

DATA PRIORITY NOTICE (CRITICAL):
Inventor-provided data is SECONDARY to Claim 1 and the normalized invention context.
This data MUST NOT be treated as defining, limiting, or characterizing the invention as claimed.
This data is auxiliary context only and does not expand the invention scope.
This data MUST NOT be used to add components, figures, reference numerals, named entities,
products, persons, organizations, structures, steps, environments, use cases, examples,
values, materials, operating conditions, or results
that are not already supported by Claim 1 and the normalized invention context.

ANTI-HALLUCINATION DIRECTIVE (CRITICAL):
- Use ONLY the exact data values, measurements, and observations provided below.
- Do NOT invent, fabricate, or extrapolate any numerical values, ranges, or test results.
- Do NOT create hypothetical examples or sample data.
- If the data is incomplete, describe only what is provided; do NOT fill gaps with assumptions.
- Reproduce the data faithfully; paraphrasing is permitted but fabrication is STRICTLY PROHIBITED.
- Ignore any data item that concerns an entity outside the allowed invention scope.

NON-GENERALIZATION RULE (CRITICAL):
- Do NOT generalize inventor-provided data to all embodiments.
- Do NOT state or imply that observed values, behaviors, or conditions apply universally.
- All references to data MUST be explicitly limited to example configurations and stated test conditions.

PERMITTED USE OF ILLUSTRATIVE DATA (INSTRUCTIONAL):
When inventor-provided data is present, you MUST use it only in the following manner:
1) Place all discussion of the data within a clearly separated illustrative example or observational
   discussion in the Detailed Description (i.e., an "Illustrative Examples" portion).
2) Use the data ONLY to illustrate operability or representative observed behavior under stated conditions.
3) Introduce data using cautious, example-limiting phrases such as:
   - "in one example configuration"
   - "representative observations include"
   - "under selected test conditions"
   - "example measurements indicate"
4) Describe WHAT was observed without interpreting WHY it occurs or HOW it improves the system.
5) If tabular data is provided, present it as a descriptive listing only. Do NOT rank, compare, or evaluate.
6) After presenting the data, explicitly clarify that the data is illustrative only and does not limit the invention.

SECTION SCOPE LIMITATION (CRITICAL):
- Do NOT integrate inventor-provided data into core system definitions, element descriptions,
  or functional requirements.
- Do NOT convert numeric values into thresholds, ranges, or mandatory operating conditions,
  unless such limits are explicitly required by Claim 1 (rare).

ILLUSTRATIVE DATA (VERBATIM):
`.trim()

export const DD_USER_DATA_DISPLAY_WRAPPER = `
----------------------------------------
INVENTOR-PROVIDED ILLUSTRATIVE DATA
----------------------------------------
The following data is provided by the inventor for illustrative purposes only.

LEGAL NOTICE:
- This data is NON-LIMITING and does not establish thresholds, ranges, or requirements.
- This data must NOT be used to narrow the scope of any claims.
- This data is auxiliary context only and does not expand the invention scope.
- This data must NOT be used to add components, figures, reference numerals, products, persons, organizations, structures, steps, environments, use cases, examples, values, materials, operating conditions, or results unless already supported by Claim 1 and the normalized invention context.
- This data must NOT be used for comparison, superiority claims, or to imply preferred values.
- This data is exemplary only and does not define the boundaries of the invention.
- Unsupported values, ranges, and configurations must be omitted rather than inferred.

ILLUSTRATIVE DATA:
`.trim()
