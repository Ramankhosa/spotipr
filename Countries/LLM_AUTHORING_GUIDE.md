# LLM Authoring Guide — country_profile.json

How to have an LLM (Claude Opus, etc.) generate a complete, importable country
profile for a new jurisdiction. The output is pasted into
**Super Admin → Jurisdictions → Countries → Import Country** (file upload or
Paste JSON), previewed, and imported.

---

## How the import works (so you know what the JSON must achieve)

A country profile provisions four things in one import:

1. **Sections** the jurisdiction's specification uses (`structure`)
2. **Mapping** of each section onto one of the app's superset sections (`canonicalKeys`)
3. **Sequence** of those sections (`order` — becomes the drafting/display order)
4. **Top-up prompts** — jurisdiction-specific drafting instructions applied
   ON TOP of the superset base prompt for each section (`prompts.sections`)

Plus styling: export layout, headings, diagram rules, validation limits.

The importer is forgiving about *shape* (missing optional fields are
auto-repaired with defaults) but strict about *mapping*: any section whose
`canonicalKeys` cannot be resolved to a superset section **blocks the import**
until an admin aliases it, creates a superset section for it, or explicitly
skips it. Nothing is ever dropped silently.

---

## The closed vocabulary — the 17 superset section keys

`canonicalKeys` must use these **exact** keys. The jurisdiction's own name for
the section goes in `label` (and `export.sectionHeadings`), never in
`canonicalKeys`.

| sectionKey | What it is | Jurisdictions commonly call it |
|---|---|---|
| `title` | Title of the invention | Title of Invention |
| `preamble` | Introductory statement | Preamble |
| `crossReference` | Priority / related applications | Cross-Reference to Related Applications, Priority Claim |
| `fieldOfInvention` | Technical field | Technical Field, Field of the Disclosure |
| `background` | Prior art discussion | Background Art, State of the Art, Related Art |
| `objectsOfInvention` | Objects/aims of the invention | Objects of the Invention, Objectives |
| `summary` | Summary / disclosure of invention | Summary of Invention, Disclosure of Invention |
| `technicalProblem` | Problem addressed | Technical Problem, Problem to be Solved |
| `technicalSolution` | Means of solving it | Solution to Problem, Means for Solving the Problem |
| `advantageousEffects` | Effects/advantages | Advantageous Effects, Effects of Invention |
| `briefDescriptionOfDrawings` | Figure list | Brief Description of Drawings |
| `detailedDescription` | Main body | Detailed Description, Description of Embodiments, Mode(s) for Carrying Out the Invention |
| `bestMode` | Best mode disclosure | Best Mode, Best Method of Performing the Invention |
| `industrialApplicability` | Industrial applicability statement | Industrial Applicability, Utility |
| `claims` | Claims | Claims, What Is Claimed |
| `abstract` | Abstract | Abstract, Abstract of the Disclosure |
| `listOfNumerals` | Reference numeral list | Reference Signs List, List of Reference Numerals |

Rules:

- **One superset key per section, one section per superset key.** If two
  jurisdiction sections would map to the same key, merge them into one section
  and cover the nuance in its top-up prompt.
- **Unique `order` values** — two sections may not share an order number.
- If the jurisdiction has a section with **no counterpart in this list**
  (e.g. Japan's Citation List), still include it with a descriptive snake_case
  key, and note it in `_authorNotes`. The import will flag it and the admin
  decides: create a new superset section, alias it, or skip it. Do NOT
  shoehorn it into a wrong key.

The importer also accepts common synonyms and the labels above as
`canonicalKeys` (e.g. `problem_to_be_solved` resolves to `technicalProblem`),
but exact keys are preferred — they make the mapping explicit and reviewable.

---

## Field semantics — what is actually consumed where

- `rules.claims` → injected into the claims drafting prompt (two-part form,
  multiple dependency, connectors, forbidden phrases, claim-count/fee
  thresholds, numerals-in-claims, support requirement).
- `rules.abstract` → abstract prompt: `wordLimit` (hard target),
  `singleParagraph`, `noBenefitsOrAdvantages`, `noClaimLanguage`.
- `rules.description` → detailed-description prompt: `requireBestModeDisclosure`,
  `avoidClaimLanguage`, `allowReferenceNumerals`,
  `requireEmbodimentSupportForAllClaims`.
- `rules.global` → all body sections: `paragraphNumberingRequired` (content is
  written numbering-ready; numbers are added on export), `allowEquations`,
  `allowTables`. `maxPagesRecommended` is stored for reference only.
- `rules.drawings` → diagram generation config (paper size, color, line style,
  minimum text size, margins, numeral requirements).
- `rules.procedural`, `rules.language` → stored; language drives
  translation/figure-language fallbacks.
- `validation.sectionChecks` → hard QA rules (word/char/count limits) enforced
  at review time. **Put every numeric limit here too**, even if it also appears
  in `rules` — this is the enforcement path. Key them by superset key.
- `validation.crossSectionChecks` + `crossChecks` → cross-section consistency
  rules (claims supported by description, abstract consistent, etc.).
- `prompts.baseStyle` → tone/voice/avoid-list for every section.
- `prompts.sections` → the top-ups. Applied ON TOP of the superset base prompt
  with priority: BASE < TOP-UP < user instructions.
- `export.documentTypes` → PDF/DOCX layout. `includesSections` must use the
  **structure section ids defined in this same file** (not superset keys).
- `export.sectionHeadings` → exact printed headings, keyed by structure id or
  superset key. Use the office's official orthography (capitalization included).
- `diagrams` → supported diagram types + per-type generation hints.

### Writing good top-ups

A top-up is a **delta**, not a full prompt. The superset base prompt already
explains how to draft the section generically. The top-up adds only what this
jurisdiction requires differently:

- statutory requirements with their legal basis ("per Section 10(4)(c) of the
  Patents Act, disclose the best method known to the applicant")
- mandated phrasing/format ("begin the abstract with the title", "use the
  two-part form with 'characterized in that'")
- office-specific prohibitions ("no trademarks in claims", "no laudatory
  statements")
- numeric norms (word limits, claim fees thresholds) phrased as instructions

Do not restate generic drafting advice — it duplicates the base prompt.

---

## Tolerances (what you may omit)

The importer auto-repairs: missing `meta.version/status/tags`, missing
timestamps, `officeUrl` without protocol, missing section `label`/`order`/
`group`/`required`, missing `canonicalKeys` (falls back to the section id),
partially-filled `rules` blocks (missing fields get defaults), empty/missing
`export`, `diagrams`, `crossChecks`, missing `validation` sub-objects.
So a lean file imports — but an explicit, complete file is preferred because
defaults are generic, not jurisdiction-accurate.

Unknown top-level keys (e.g. `_authorNotes`) are preserved and ignored.

---

## Generation prompt (copy-paste into the LLM)

> You are preparing a `country_profile.json` for the patent-drafting platform
> PatentNest. Research the patent specification requirements of
> **[COUNTRY / PATENT OFFICE]** using its official sources (patent act,
> implementing rules, office manual of practice, WIPO country guide) and
> produce ONE complete JSON object, no commentary.
>
> Follow these rules exactly:
>
> 1. `meta`: `id` = `code` = the 2–3 letter uppercase code; `name`,
>    `continent`, `office` (official name), `officeUrl`, `applicationTypes`,
>    `languages` (ISO codes, filing languages), `status: "draft"`.
> 2. `structure`: one variant (`id: "standard"`). List the specification
>    sections in the office's mandated order. For each section:
>    - `id`: snake_case identifier
>    - `label`: the office's official heading for the section
>    - `order`: 1, 2, 3, … (unique)
>    - `canonicalKeys`: EXACTLY ONE key from this closed list —
>      `title, preamble, crossReference, fieldOfInvention, background,
>      objectsOfInvention, summary, technicalProblem, technicalSolution,
>      advantageousEffects, briefDescriptionOfDrawings, detailedDescription,
>      bestMode, industrialApplicability, claims, abstract, listOfNumerals`.
>      Never map two sections to the same key. If a mandated section has no
>      counterpart in the list, keep it with a snake_case key of its own and
>      record it in `_authorNotes` as unmapped.
>    - `required`: whether the office mandates it
>    - `group`: `header` | `body` | `claims` | `abstract`
> 3. `rules`: fill `global`, `abstract`, `claims`, `description`, `drawings`,
>    `procedural`, `language` with this office's real norms (word limits,
>    claim fee thresholds, multiple-dependency rules, paper size, margins,
>    grace period, translation requirements). Use official values; if a value
>    is uncertain, choose the conservative option and flag it in
>    `_authorNotes` with the source you used.
> 4. `validation.sectionChecks`: repeat every numeric limit as a check —
>    e.g. abstract word limit as
>    `{"id":"abstract_words","type":"maxWords","limit":N,"severity":"error","message":"..."}`.
>    Key checks by the superset key.
> 5. `prompts.baseStyle` + `prompts.sections`: for each section where this
>    jurisdiction differs from generic practice, write
>    `{"topUp": {"instruction": "...", "constraints": ["..."]}}`.
>    Top-ups are DELTAS on top of an existing generic base prompt: statutory
>    requirements (cite the provision), mandated phrasing, prohibitions,
>    numeric norms. No generic drafting advice.
> 6. `export`: one `documentTypes` entry (`id: "spec_pdf"`) with the office's
>    page size, font, spacing, margins, numbering rules. `includesSections`
>    lists the structure section ids from step 2. `sectionHeadings` maps each
>    structure id to the exact printed heading.
> 7. `diagrams`: the office's drawing rules and 3–8 diagram generation hints.
> 8. `crossChecks`: standard consistency checks (claims supported by
>    description, abstract consistent with description, drawings referenced).
> 9. Add `_authorNotes`: sources consulted, uncertain values, and any
>    unmapped sections.
>
> Output only the JSON.

---

## Minimal worked example

A compact but complete profile (fictional office, for shape reference — a real
one should be richer, especially the top-ups):

```json
{
  "_authorNotes": "Example only. Sources: none. No unmapped sections.",
  "meta": {
    "id": "XX", "code": "XX", "name": "Exampleland", "continent": "Europe",
    "office": "Exampleland Patent Office", "officeUrl": "https://epo.example",
    "applicationTypes": ["ordinary", "PCT national phase"],
    "languages": ["en"], "version": 1, "status": "draft",
    "inheritsFrom": null, "tags": ["example"]
  },
  "structure": {
    "defaultVariant": "standard",
    "variants": [{
      "id": "standard", "label": "Standard", "description": "Standard specification",
      "sections": [
        { "id": "title", "label": "Title of the Invention", "order": 1, "canonicalKeys": ["title"], "required": true, "group": "header" },
        { "id": "technical_field", "label": "Technical Field", "order": 2, "canonicalKeys": ["fieldOfInvention"], "required": true, "group": "body" },
        { "id": "background_art", "label": "Background Art", "order": 3, "canonicalKeys": ["background"], "required": true, "group": "body" },
        { "id": "summary", "label": "Summary of the Invention", "order": 4, "canonicalKeys": ["summary"], "required": true, "group": "body" },
        { "id": "drawings_list", "label": "Brief Description of the Drawings", "order": 5, "canonicalKeys": ["briefDescriptionOfDrawings"], "required": false, "group": "body" },
        { "id": "detailed_description", "label": "Detailed Description of the Invention", "order": 6, "canonicalKeys": ["detailedDescription"], "required": true, "group": "body" },
        { "id": "claims", "label": "Claims", "order": 7, "canonicalKeys": ["claims"], "required": true, "group": "claims" },
        { "id": "abstract", "label": "Abstract", "order": 8, "canonicalKeys": ["abstract"], "required": true, "group": "abstract" }
      ]
    }]
  },
  "rules": {
    "global": { "paragraphNumberingRequired": true, "maxPagesRecommended": 80, "allowEquations": true, "allowTables": true },
    "abstract": { "wordLimit": 150, "noBenefitsOrAdvantages": true, "noClaimLanguage": true, "singleParagraph": true },
    "claims": {
      "twoPartFormPreferred": true, "allowMultipleDependent": true,
      "prohibitMultipleDependentOnMultipleDependent": true,
      "preferredConnectors": ["comprising"], "discouragedConnectors": ["consisting of"],
      "forbiddenPhrases": ["substantially", "about"],
      "maxIndependentClaimsBeforeExtraFee": 3, "maxTotalClaimsRecommended": 15,
      "allowReferenceNumeralsInClaims": true, "requireSupportInDescription": true,
      "unityStandard": "PCT_UNITY_OF_INVENTION"
    },
    "description": { "requireBestModeDisclosure": false, "avoidClaimLanguage": true, "allowReferenceNumerals": true, "requireEmbodimentSupportForAllClaims": true, "industrialApplicabilitySectionRequired": false },
    "drawings": { "requiredWhenApplicable": true, "paperSize": "A4", "colorAllowed": false, "lineStyle": "black_and_white_solid", "referenceNumeralsMandatoryWhenDrawings": true, "minReferenceTextSizePt": 8, "marginTopCm": 2.5, "marginBottomCm": 1.0, "marginLeftCm": 2.5, "marginRightCm": 1.5 },
    "procedural": { "gracePeriodMonths": 12, "foreignFilingLicenseRequired": false, "idsRequired": false, "priorArtDisclosureThreshold": "any_relevant_to_novelty_or_inventive_step", "allowProvisionalPriority": true },
    "language": { "allowedLanguages": ["en"], "requiresOfficialTranslation": false }
  },
  "validation": {
    "sectionChecks": {
      "abstract": [{ "id": "abstract_words", "type": "maxWords", "limit": 150, "severity": "error", "message": "Abstract must not exceed 150 words (Rule 8)." }],
      "title": [{ "id": "title_words", "type": "maxWords", "limit": 15, "severity": "warning", "message": "Keep the title within 15 words." }]
    },
    "crossSectionChecks": [
      { "id": "claims_support", "type": "support", "from": "claims", "mustBeSupportedBy": ["detailed_description"], "severity": "error", "message": "Every claim element must be supported by the description." }
    ]
  },
  "prompts": {
    "baseStyle": { "tone": "formal, technical, precise", "voice": "impersonal_third_person", "avoid": ["marketing language", "unsupported advantages"] },
    "sections": {
      "claims": { "topUp": { "instruction": "Use the two-part form with 'characterized in that' where the invention improves known art (Rule 21(2)). Keep independent claims to 3 or fewer; excess claims incur fees.", "constraints": ["No trademarks in claims", "Reference numerals in parentheses"] } },
      "abstract": { "topUp": { "instruction": "Begin with the title of the invention. State the technical field, the problem, and the gist of the solution in one paragraph of at most 150 words (Rule 8).", "constraints": ["No claim language", "No advantages"] } }
    }
  },
  "export": {
    "documentTypes": [{
      "id": "spec_pdf", "label": "Specification PDF",
      "includesSections": ["title", "technical_field", "background_art", "summary", "drawings_list", "detailed_description", "claims", "abstract"],
      "pageSize": "A4", "lineSpacing": 1.5, "fontFamily": "Times New Roman", "fontSizePt": 12,
      "addPageNumbers": true, "addParagraphNumbers": true,
      "marginTopCm": 2.0, "marginBottomCm": 2.0, "marginLeftCm": 2.5, "marginRightCm": 2.0
    }],
    "sectionHeadings": {
      "title": "TITLE OF THE INVENTION", "technical_field": "TECHNICAL FIELD",
      "background_art": "BACKGROUND ART", "summary": "SUMMARY OF THE INVENTION",
      "drawings_list": "BRIEF DESCRIPTION OF THE DRAWINGS",
      "detailed_description": "DETAILED DESCRIPTION OF THE INVENTION",
      "claims": "CLAIMS", "abstract": "ABSTRACT"
    }
  },
  "diagrams": {
    "requiredWhenApplicable": true,
    "supportedDiagramTypes": ["block", "flowchart", "schematic"],
    "figureLabelFormat": "FIG. {number}",
    "autoGenerateReferenceTable": true,
    "diagramGenerationHints": {
      "block": "Black-and-white line blocks, numbered 100-series, no shading.",
      "flowchart": "Top-to-bottom flow, steps numbered S101, S102, ..."
    }
  },
  "crossChecks": {
    "enableSemanticCrossCheck": true,
    "checkList": [
      { "id": "claim_terms_explained", "description": "Claim terms appear in the description", "from": "claims", "mustBeExplainedIn": ["detailed_description"] }
    ]
  }
}
```

---

## After generation

1. Paste into **Jurisdictions → Countries → Import Country** (Paste JSON tab).
2. Client-side repair + validation runs immediately; fix anything red.
3. **Preview changes** — review the mapping table (every section, its superset
   key, order, required flag), top-ups, and style rows. Blocking issues mean a
   section didn't resolve: add an alias, create a superset section, or skip it.
4. **Import everything** — then the readiness checklist must be all-green
   before activation.
5. Have a patent professional review the top-ups and limits against the
   office's current rules — the importer guarantees structure, not legal
   accuracy.
