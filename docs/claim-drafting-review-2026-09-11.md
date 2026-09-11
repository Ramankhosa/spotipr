# Claim generation, checking, and correction review

Reviewed 10–11 September 2026. Scope: the current local working tree, including existing uncommitted changes; generation, office-form normalization, automatic repair, prior-art refinement, challenge refinement, saving and finalization. Application code was not changed. This is an engineering and drafting-policy review, not a determination that any particular claim is patentable or a certification of all fourteen office profiles. Live database prompts, deployed feature settings and real model outputs were not inspected.

**Main recommendation:** make source support and preservation of intended scope the acceptance criteria for every claim revision. At present, the system is considerably better at instructing drafting behavior and detecting surface defects than at enforcing those acceptance criteria. Several corrections can change scope, and a clean or “resolved” report does not establish that the claim is supported or improved.

## What is already valuable

- One resolved jurisdiction profile drives generation instructions, normalization and office-form findings.
- The base drafting policy distinguishes essential features, supported generalizations, fallback limitations, statutory categories and single-actor considerations.
- Source ledgers, inventor terminology, novelty handoffs and version history provide useful foundations.
- The challenger omits the drafter's persona. Its amendment flow includes claim fingerprints and stale-preview protection.
- Generation rejects unreadable or empty model output, and automatic repair is limited to one pass.

Keep these foundations. The improvements below concern their implementation and the legal assumptions behind particular rules.

## Verified findings and recommended fixes

### 1. P1 — Source support is not sufficiently enforced in the active generation path

The generation route parses a support matrix but neither calls `analyzePreliminaryClaimQuality` nor persists its result. A comment says that analysis is derived locally, but a source search found the function used only in tests. The active office-form number check extracts bare numbers and uses substring matching against concatenated source and normalized fields.

**Reproduced:** a claim saying “5 bar” receives no `UNSUPPORTED_NUMBER` finding when the source says only “50 bar.” Separately, the unused support matcher accepts “controller opens a valve” against “controller closes a valve” because enough words overlap. Reconnecting that matcher alone would not solve the problem.

**Fix:** require an internal support record for each substantive limitation: original source location and quotation; entity; relationship or operation; parameter, units and conditions; support status; and combination/embodiment context. Verify the actual combination as well as individual features. Distinguish inventor-confirmed disclosure from generated summaries and external prior art. Use exact numeric parsing with units and parameter association, not string presence. A missing source or unverified inference must produce an explicit unresolved status. Keep these records outside the claims themselves.

Evidence: [generation parsing](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:5677), [number checking](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/office-form-lint.ts:806), [support matching](C:/Users/raman/Documents/spotipr/src/lib/preliminary-claim-generation.ts:690).

This recommendation implements a substantive support standard rather than lexical similarity. See [USPTO written-description guidance](https://www.uspto.gov/web/offices/pac/mpep/s2163.html) and the [EPO amendment standard](https://www.epo.org/en/legal/guidelines-epc/2026/h_iv_2_1.html). For filed applications, the relevant baseline is the application as filed; later inventor input cannot simply be treated as original support.

### 2. P1 — The automatic repair guard does not protect substantive meaning

The guard measures loss of alphabetic tokens of five or more characters, independent-claim count and retention of some component names. It does not check numbers, units, negation, added limitations, whether a changed claim was authorized by a finding, or whether a proposed correction preserves relationships.

**Reproduced:** changing “5 bar” to “50 bar” and removing “not” passes the guard. A change to another claim with no selected finding also passes, as does an unsupported new dependent limitation. Existing claims retain their old `type` during merge, so a change from independent to dependent can pass the count guard; normalization reclassifies it only afterward.

**Fix:** derive the candidate's structure before validation. Restrict edits to affected limitations and necessary dependency consequences. Compare numbers, units, polarity, conjunctions, ranges, claim transitions, relationships, categories and dependency edges. Validate every new limitation against the support record. Require a proposed semantic scope change to be reviewed with a precise before/after explanation. Use token retention only as a supplementary warning.

Evidence: [repair guard and application](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/repair.ts:277), [merge keeps old metadata](C:/Users/raman/Documents/spotipr/src/lib/claim-challenge.ts:675).

### 3. P1 — Some “normalization” operations change protection

Normalization automatically changes multiple dependency from “and” to “or,” closes phrases such as “group consisting essentially of,” inserts “non-transitory,” and substitutes strategy-generated terminology in independent claims. These operations are not equivalent to capitalization or punctuation. Terminology preservation can append a claim saying that the replacement term “is” the inventor label, without proving that this is a meaningful narrowing limitation.

**Reproduced:** “claims 1 and 2” becomes “claims 1 or 2.” This changes cumulative versus alternative dependency. A terminology mapping also adds another claim automatically.

**Fix:** separate mechanical formatting from proposed substantive amendments. Automatically apply only transformations demonstrated to preserve meaning. For cumulative dependencies, identify a valid parent chain that retains the intended combination rather than replacing the conjunction blindly. Verify terminology equivalence against definitions; retaining a label somewhere in the set does not prove preservation of scope. Show transition, category and medium-language changes in the amendment preview.

Evidence: [terminology substitution](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/normalise.ts:55), [dependency rewrite](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/normalise.ts:274), [Markush and medium rewrites](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/normalise.ts:296).

### 4. P1 — Some legal heuristics are too absolute and trigger harmful repair instructions

The modifier detector treats listed words without a number in the same clause as defects, regardless of a definition elsewhere in the disclosure. Its findings become `block` + `llm`. The experimental-parameter detector similarly blocks product/composition measurement language and tells the repair model to remove named measurement tools, timepoints and dose regimens. The recipe can even delete a dependent claim's entire limitation.

**Reproduced:** “substantially planar” remains blocking despite an explicit source definition. A polymer property “as measured by GPC” produces a blocking experimental-parameter finding. These examples demonstrate overbroad classification; they do not establish that either complete example claim is legally sufficient.

**Fix:** classify these as context-dependent issues requiring evidence. Preserve objective measurement definitions where necessary to define a parameter. Distinguish an incidental study detail from a reproducible test condition, an essential property definition, or a permitted medical-use limitation. Never delete a limitation just to clear a warning. Evaluate exceptions before proposing same-category independent-claim conversion or medical-category conversion. Adding hardware words alone must not be presented as resolving software eligibility.

Evidence: [modifier detector](C:/Users/raman/Documents/spotipr/src/lib/claim-challenge-lint.ts:221), [severity mapping](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/office-form-lint.ts:270), [experimental detector](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/office-form-lint.ts:752), [repair recipes](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/repair.ts:137).

The USPTO says relative terminology is not automatically indefinite; its meaning depends on context. [MPEP 2173.05(b)](https://www.uspto.gov/web/offices/pac/mpep/s2173.html). The EPO expressly addresses parameters and circumstances in which their measurement method must be in the claim. [EPO F-IV 4.11](https://www.epo.org/en/legal/guidelines-epc/2026/f_iv_4_11.html). Its one-independent-claim-per-category rule also has substantive exceptions. [EPO F-IV 3.2](https://www.epo.org/en/legal/guidelines-epc/2026/f_iv_3_2.html).

### 5. P1 — “Resolved” is recorded without proving resolution

Automatic repair records selected findings as resolved unless the model puts them in `unresolved`. The route does run the linter again, but does not reconcile that result with the repair record or reject a repair that leaves the targeted defect or introduces a worse one. The UI reports the count from that record as applied corrections.

**Reproduced:** a model response returning identical claim text, with an empty unresolved list, is recorded as a resolved repair although the same blocking modifier remains. The challenge preview also marks all accepted remarks as resolved in advance; application copies that list even when only some claim amendments are selected.

**Fix:** distinguish attempted, changed, independently verified resolved, unresolved and reviewer-dismissed. Resolve each finding only after checking the actual accepted revision and its affected claims. Preserve unresolved and unaccepted remarks. Reject automatic candidates introducing new critical defects or unsupported matter. Assign stable finding identities based on rule, claim identity and affected limitation rather than report-order `F1`, `F2` numbers.

Evidence: [repair result](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/repair.ts:431), [generation recheck](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:5765), [challenge preview resolution](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:7404), [challenge apply resolution](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:7490).

### 6. P1 — Finalization can approve unvalidated or mismatched text

Finalization recomputes a report but does not use its blocking findings to govern approval. The shared preparation helper intentionally catches errors and allows the write with a null report. Separately, consistency between HTML and structured claims is tested using claim-number sets only. Edited wording with unchanged numbering can therefore be paired with old structured text, which downstream drafting prefers.

**Fix:** use one canonical structured revision and render its HTML. At import/editor boundaries parse and compare normalized claim text, not just claim numbers. Bind every report and approval to the exact revision, disclosure version and jurisdiction. Permit saving and continuing research with an incomplete draft, but clearly distinguish this from approval as reviewed claims. Critical verified defects must be cured; disputed legal findings need a recorded reviewer disposition. A failed validator must show “validation unavailable,” not disappear.

Evidence: [error behavior](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:5059), [number-only consistency and finalization](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:6147), [report panel hides stale/missing reports](C:/Users/raman/Documents/spotipr/src/components/drafting/ClaimFormFindingsPanel.tsx:95).

### 7. P1 — Prior-art refinement lacks the challenge path's revision protection

The prior-art preview stores no claim fingerprint. Application finds proposed amendments by claim number and replaces the current text without verifying the preview's original text. The preview and apply handlers also lack the challenge loader's locked-claims guard. Whole-object writes use snapshots read before the model call, creating a risk of replacing newer session data.

**Fix:** bring both refinement workflows through the same revision-aware service. Validate claim revision, source revision, jurisdiction, evidence snapshot and lock state both after model completion and at application. Use an atomic version comparison at write time. Reject stale previews instead of merging by number. Invalidate downstream claim-dependent artifacts when their input revision changes.

Evidence: [prior-art preview persistence](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:6634), [prior-art apply](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:6669), [stronger challenge fingerprint check](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:7446). These are source-inspection findings, not a live concurrent-session reproduction.

### 8. P2 — Prior-art amendments rely on summaries and a weaker drafting contract

Selected references reach the prior-art refinement model as title, threat label and summary/snippet. That handler asks for novelty over every selected patent and says to preserve jurisdictional style “loosely.” It does not include the same resolved office-rule block and strategy digest used by generation and challenge refinement. It also makes user directives mandatory in language that competes with source-support constraints.

**Fix:** share one drafting policy across all mutation paths. Before narrowing, require an objection with a claim-element map, verified passages and relevant dates. Assess anticipation per reference and inventive step/obviousness separately under the relevant office's approach. Use summaries for triage; do not turn incomplete summaries into proof that a feature is absent. Permit “keep unchanged,” “insufficient evidence” and “no supported amendment available.” Rank supported amendments by preservation of commercial scope, not merely by removal of objections. Keep source support above user preference and style.

Evidence: [reference summaries](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:6466), [refinement instructions](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:6548). The separate novelty and obviousness assessments follow the distinction explained in [MPEP 2131](https://www.uspto.gov/web/offices/pac/mpep/s2131.html) and [MPEP 2141](https://www.uspto.gov/web/offices/pac/mpep/s2141.html).

### 9. P2 — A strategy may be missing, stale or planned for another office

Generation waits briefly for an existing plan, otherwise drafts without one and queues it for the next generation. The fingerprint deliberately omits jurisdiction, despite the plan containing office-specific categories, claim form and eligibility doctrine. It hashes the novelty search ID rather than its current findings. Request-level context used to draft claims can also differ from the stored context used to validate the strategy fingerprint.

**Reproduced:** changing the office from US to IN and replacing the novelty digest while retaining its search ID leaves the strategy fingerprint unchanged.

**Fix:** split the reusable technical invention plan from the jurisdiction-specific claim plan. Hash all effective drafting inputs, the actual evidence digest and resolved policy versions. If planning is unavailable, label the output as drafted without completed strategy review. Before reviewed approval, verify the inventive combination, essential-feature coverage, category choices and fallback plan. The first draft should benefit from planning as reliably as later drafts.

Evidence: [strategy selection](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:5528), [fingerprint](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/strategy-state.ts:50), [plan fields](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/strategy.ts:18).

### 10. P2 — Claim-count controls are not enforced after every mutation

The generation cap runs before terminology retention and automatic repair, both of which can add claims. The final report checks fee thresholds, not the user's requested maximum.

**Fix:** make the budget part of the proposed claim architecture, reserve room for necessary fallbacks, and enforce it on the final candidate. If preserving an essential fallback needs another claim, report the tradeoff. Do not silently truncate a dependency chain or remove commercially important protection merely to meet a default fee target.

Evidence: [cap followed by further changes](C:/Users/raman/Documents/spotipr/src/app/api/patents/[patentId]/drafting/route.ts:5713), [retention additions](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/normalise.ts:95), [fee-only count checks](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/office-form-lint.ts:819).

### 11. P2 — Quality review and policy provenance need an explicit status

The current challenge feature is off by default in the local code. This does not turn off office-form lint or generation repair, but means the adversarial review cannot be assumed to have run. The runtime reads merged database prompts; editing the checked-in base prompt alone does not change deployed behavior. Report freshness uses claim signatures without also requiring matching source and resolved-rule hashes.

**Fix:** show separate statuses for form, source support, claim strategy, prior-art assessment and reviewer approval. Record model identity, actual prompt hash, resolved rules hash, source snapshot and evidence snapshot per run. Maintain a rule register with legal authority, jurisdiction, applicability, exceptions, effective date and reviewer. Treat draft guidance separately from operative rules. Audit the database prompt against the checked-in source before deployment; do not assume parity.

Evidence: [challenge flag](C:/Users/raman/Documents/spotipr/src/lib/claim-challenge-flag.ts:1), [prompt deployment mechanism](C:/Users/raman/Documents/spotipr/scripts/sync-claims-base-prompt.js:1), [report matching](C:/Users/raman/Documents/spotipr/src/lib/claim-rules/report.ts:45). For example, IP India's current resources separately list a draft manual and the 2019 manual; that distinction belongs in policy versioning. [IP India manuals](https://ipindia.gov.in/resource/patents-resources-manuals).

## Recommended drafting behavior

1. **Establish the disclosure boundary.** Identify what the inventor actually disclosed, unresolved technical gaps, alternatives, terminology definitions and embodiment combinations. Keep generated suggestions and external art separately labeled.
2. **Plan coverage before prose.** Define the supported inventive combination and distinguish technically essential features from embodiment detail. Map commercial products/actions and plausible disclosed design-arounds to claim coverage. Do not make every feature of the preferred embodiment mandatory.
3. **Draft the broadest supported, defensible combination.** Include its operative relationships. Broaden from a species only when the disclosure supports the generalization. Do not trade away novelty-critical features to meet an arbitrary length target.
4. **Build deliberate fallback branches.** Each dependent claim should further limit its inherited combination, add a coherent protection theme and remain consistent with its parent. Cover meaningful alternatives and the commercial embodiment; avoid padding and arbitrary chains that combine incompatible embodiments.
5. **Add categories where they add protection.** Translate the inventive concept into supported product, system, process or other permitted forms. Check who performs the steps and how infringement might be evidenced. Mirror the concept in category-appropriate limitations rather than copying words mechanically.
6. **Verify before amending.** Separate confirmed mechanical defects from context-dependent legal concerns and strategic preferences. Require a source-grounded reason for every substantive amendment. Preserve supported measurement conditions, exclusions and ranges unless the selected strategy intentionally changes them.
7. **Evaluate the actual final revision.** Recheck support, dependency inheritance, essential features, terminology, numbers, categories, budget and unresolved findings. Confirm the specification supports the breadth and combinations claimed. A clean syntax screen must never stand in for support, enablement, novelty or inventive-step assessment.

For India, clarity, conciseness, support and unity should be explicit review dimensions, consistent with the claim discussion in the [2019 Patent Office Manual](https://www.ipindia.gov.in/frontend/pdf/patents/Manual_for_Patent_Office_Practice_and_Procedure_.pdf). Jurisdiction-specific eligibility decisions still require the relevant facts and current applicable law.

## Implementation order

**First: prevent damaging acceptance.** Fix semantic repair guards and substantive normalization; correct the overbroad measurement/modifier rules; verify actual resolution; enforce canonical revision consistency and stale-preview protection. Introduce explicit validation-unavailable and unresolved states.

**Second: make drafting evidence-driven.** Add limitation-level support and exact parameter checks, share the generation contract with prior-art refinement, and make strategy selection and final claim budgets dependable.

**Third: measure drafting quality.** Build a reviewed evaluation set covering mechanical, software, chemistry, biotechnology and medical-device disclosures, with jurisdiction-specific expected judgments. Measure unsupported-limitations rate, essential-feature omissions, unnecessary narrowing, semantic repair regressions, dependency contradictions, false-positive correction rate and unresolved defects incorrectly marked resolved. Include counterexamples where the right response is to keep the claim unchanged or request missing technical information.

## Verification performed

- **255 existing tests passed across 13 suites.** These covered claim rules, repair, strategy, challenge and its references/lint, preliminary generation, parsing, context, versions, no-freeze behavior, novelty integration and drafting fallbacks. Provider initialization warnings occurred in the test environment; this was not a live provider or end-to-end model validation.
- **12 additional synthetic probes reproduced the behaviors described above.** They call shipped helpers; the one repair-model response is mocked. Their passing assertions document current gaps, not desired acceptance behavior. See [review probes](C:/Users/raman/Documents/spotipr/tmp/claim-drafting-review-2026-09-10/audit.test.ts).
- Route acceptance, stale-preview and HTML/structured-pairing findings were established by source inspection. No real patent documents or production database records were changed.
- No application fixes have been applied. Existing user changes were preserved. The report and synthetic probes are the review artifacts.
