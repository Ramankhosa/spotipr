# Verification-First Generation of First Examination Report Responses: An LLM Architecture for Indian Patent Prosecution

**Authors:** *[Author 1], [Author 2], [Author 3]*
**Affiliation:** *[Department, Institution, City, Country]*
**Corresponding author:** *[email]*

> *Manuscript prepared in IEEE conference format. Section numbering, citation style and structure follow the IEEE Conference Proceedings template; the source may be transferred directly into `IEEEtran` two-column layout. All architectural details, thresholds and constants reported below are taken from the deployed implementation rather than from an idealised design.*

---

## Abstract

Every patent application in India receives a First Examination Report (FER), a statutory letter in which the Controller raises objections on novelty, inventive step, patentable subject matter, sufficiency, clarity and procedural compliance. The applicant must answer every objection within six months, and a single unanswered objection can cost the application. Drafting that reply is slow, repetitive and highly consequential, which makes it an attractive target for large language models (LLMs). It is also a setting in which the standard failure mode of LLMs — fluent, confident, unsupported assertion — is not a nuisance but a professional misrepresentation to a public authority. We present a deployed system that generates filing-ready FER replies while structurally preventing that failure. Its central principle is that **a prompt instruction is a request, whereas a post-hoc check in code is a guarantee**, and that only the second may be trusted. The system runs a seven-stage pipeline in which every generative stage is immediately followed by a deterministic verifier: examiner quotations must substring-match the report; claim-chart passages must substring-match the cited document; every word inserted by an amendment must be traceable to the specification as filed; case law is restricted to a per-objection whitelist; and formal objections never reach a model at all. Jurisdiction-specific law is held entirely in a validated JSON profile, so no source file branches on a country code. A retrieve-per-need context strategy reads the full specification exactly once, which reduces the estimated per-case input budget by roughly an order of magnitude relative to a naive prompt-stuffing design. Nothing is filed automatically: a blocking compliance lint of twenty deterministic checks stands between the draft and the exported document. We describe the architecture, the verification layer in detail, the cost model, and the regression suite that protects the invariants, and we discuss what such a system can and cannot responsibly claim.

**Index Terms** — patent prosecution, office action response, large language models, retrieval-augmented generation, hallucination mitigation, evidence grounding, legal informatics, intellectual property law, human-in-the-loop systems, Indian Patents Act.

---

## I. Introduction

### A. The First Examination Report

Indian patent prosecution is organised around a single document. After a request for examination, the Controller issues a **First Examination Report** under Section 12 and Section 13 of the Patents Act, 1970 [1]. The FER is a structured letter. Part I records administrative findings; Part II carries the detailed substantive observations — objections on novelty (Section 2(1)(j)), inventive step (Section 2(1)(ja)), non-patentable subject matter (Section 3, most often 3(d) and 3(k)), sufficiency and clarity (Section 10), and unity (Section 10(5)); Part III lists formal requirements such as an updated Form 3 statement under Section 8, biological-source declarations, and National Biodiversity Authority approvals.

The reply is governed by a hard clock. Under Rule 24B(5) of the Patents Rules, 2003, the application must be put in order for grant within **six months of the FER date**, extendable by three months on a Form 4 request that, following the Patents (Amendment) Rules, 2024, may be filed at any time within nine months of that date [2]. Failure is not recoverable in the ordinary course: the application is deemed abandoned under Section 21(1), and no statutory revival exists.

Two properties of this task make it unusually demanding. First, **completeness is mandatory**. The reply must answer every objection under the Controller's own numbering; an objection that is silently dropped is the single worst defect a reply can carry. Second, **amendments are tightly constrained**. Section 59(1) permits amendment only by way of disclaimer, correction or explanation, forbids new matter, and requires that amended claims fall wholly within the scope of the claims before amendment. In practice the Controller expects each amendment to be supported by an identified location in the specification as filed. The functional equivalent in Europe is Article 123(2) EPC [15], and the same logic drives the United States prohibition on new matter under 35 U.S.C. §132(a) [18].

### B. Why LLMs, and why not LLMs alone

An FER reply is largely a document-grounded writing task: read the objection, read the cited prior art, compare it with the claims, decide whether to argue or amend, and write formal correspondence in a fixed house style. LLMs are genuinely good at each of those sub-tasks in isolation, and the volume of routine prosecution work in India — where a large share of filings are handled by small firms under fee pressure — makes automation economically attractive.

The difficulty is that the same properties that make an LLM useful here make it dangerous here. Three failure modes are decisive:

1. **Fabricated evidence.** A model asked to quote the examiner, or to quote a cited patent, will often produce a plausible sentence that appears nowhere in either document. Legal hallucination is not a marginal phenomenon; controlled studies of general-purpose models on legal queries report hallucination rates between 58% and 88% depending on task and jurisdiction [3], and even purpose-built commercial legal research tools have been shown to produce unsupported outputs at material rates [4].
2. **Unsupported amendment basis.** A model can assert that an inserted limitation is supported at paragraph [0038] with complete confidence and no relationship to the actual text. Under Section 59 this is not a stylistic defect; it is an added-matter objection waiting to happen, and in the worst case a ground of revocation under Section 64(1)(o).
3. **Asserted compliance.** A model answering a Section 8 objection will readily write "the updated Form 3 has been filed herewith." If it has not been filed, the attorney has just made a false statement to the Controller under their own signature.

These are not problems that better prompting solves. They are problems of **verification**, and verification of a generated assertion against a source document is a task that ordinary deterministic code performs far more reliably than any model.

### C. Contributions

This paper describes an **Office Action Studio** module deployed inside a commercial patent-workflow platform, focusing on its Indian FER configuration. Our contributions are:

1. **A verification-first pipeline architecture** (Section VI) in which each of seven processing stages is a pair — one generative call followed by one deterministic guard — and in which no generated assertion reaches the filed document without an anchor that code has checked.
2. **A grounding primitive** (`verifyQuote`) tuned for real PDF-extracted text: strict exact matching for short spans, and consecutive word-bigram coverage above a 0.85 threshold for long ones, which absorbs optical-character-recognition noise while still rejecting invented sentences.
3. **A Section 59 added-matter guard implemented as a database query filter rather than a prompt instruction**, so that post-filing material is structurally incapable of becoming amendment basis, combined with a word-coverage test on every inserted span.
4. **Two complementary consistency checks** — a full-document absence scan that corrects claim-chart verdicts formed on truncated evidence, and a contradiction lint that catches drafted prose asserting the opposite of its own chart.
5. **A jurisdiction-as-data design** in which all local law lives in a schema-validated JSON profile, so that supporting a new patent office is an authoring task rather than an engineering task.
6. **A retrieve-per-need context strategy** that reads the full specification exactly once and thereafter serves stages from a cached digest plus top-*K* vector retrieval, giving an estimated order-of-magnitude reduction in per-case input tokens.
7. **A blocking compliance gate** of twenty deterministic checks that a draft must pass before any document can be exported.

---

## II. Related Work

**Patent-domain natural language processing.** Automated patent analysis has a long history, surveyed comprehensively by Krestel *et al.* [5]. Generative work has concentrated on drafting rather than prosecution: Lee and Hsiang demonstrated claim generation by fine-tuning a general language model [6], and Casola and Lavelli examined summarisation and simplification of patent text [7]. Prior-art retrieval has attracted the most sustained attention, including open efforts such as PQAI that frame novelty search as semantic retrieval. Office-action response generation is comparatively unexplored in the literature, and the Indian FER — with its distinctive Section 3 subject-matter grounds and its Section 59 amendment discipline — has received almost no published treatment.

**Retrieval-augmented generation.** Grounding generation in retrieved documents is the standard mitigation for hallucination [8], and retrieval has been shown to reduce unsupported assertions substantially in dialogue settings [9]. Our design uses retrieval but does not rely on it as the safety mechanism. In conventional RAG, retrieved text is *context* and the model is trusted to use it faithfully. Here, retrieved text is the *only admissible substrate*, and — more importantly — the model's use of it is re-checked afterwards by code that does not consult the model. This distinction matters: RAG reduces the probability of fabrication, whereas a post-hoc substring check reduces the probability that a fabrication survives to the filed document.

**Hallucination in legal applications.** Dahl *et al.* profile legal hallucination systematically and observe that models are most confident precisely where they are least reliable, particularly on lower-court and jurisdiction-specific material [3]. Magesh *et al.* extend this to retrieval-augmented commercial legal tools and find that grounding alone does not eliminate the problem [4]. Both results argue directly for our position: the mitigation must be an artifact-level check, not an author-level instruction [10].

**Verification of generated output.** Our guards belong to the same family as self-consistency and post-hoc verification techniques, but differ in a way we consider essential. Verification here is performed by string algorithms and database predicates rather than by a second model call. A verifier that is itself a language model shares the failure distribution of the generator; a substring test does not.

---

## III. Design Principles

Three principles govern the module. They are stated here because every subsequent design decision follows from them.

### A. Jurisdiction logic is data, never code

No file in the module may branch on a country code. All local law — the instruments an office issues, its deadline rules, its objection vocabulary and statutory bases, its doctrinal reasoning steps, its amendment scope rule, its permitted authorities and its reply layout — lives in an `officeActionProfile` block inside a per-country JSON file, validated by a schema. Adding a jurisdiction is therefore an authoring exercise: write the profile, pass structural and semantic validation, pass a readiness check, synchronise it to the database, and activate it. This keeps the engine small and auditable, and it prevents the slow accretion of jurisdiction-specific conditionals that typically makes legal software unmaintainable.

### B. Every assertion is anchored, and the anchor is checked in code

The module states this as a rule about trust: *a prompt instruction is a request; a post-hoc string check is a guarantee.* Both are used, but only the second is relied upon. Consequently, prompts do carry anti-fabrication instructions — copy verbatim, mark a feature as `NOT_DISCLOSED` rather than inventing disclosure, cite specification basis or state plainly that none exists, never claim a form has been filed — and those instructions are treated as belt rather than braces. The guards described in Section VI are what actually holds.

### C. Read the invention once

The full specification is sent to a model exactly once per case, during a digest pass. Every subsequent stage operates on that cached digest plus a small set of vector-retrieved paragraphs. This is presented in Section VII as a cost measure, but it is equally a quality measure: a stage that receives four thousand tokens of targeted context reasons better than one that receives fifty thousand tokens of everything.

---

## IV. System Architecture

### A. Layered structure

The module is organised into five layers.

| Layer | Responsibility |
|---|---|
| **Interface** | Case list and a workspace comprising a deadline strip, an objection rail, a four-tab workbench (Objection / Evidence / Strategy / Draft), and a docked source viewer |
| **HTTP** | Nine endpoints covering case creation, document ingestion, citation management, objection triage, run control, draft editing and export |
| **Orchestration** | Intake orchestration, the reply-preparation pipeline, and a database-lease job worker |
| **Stages** | Eight stage modules, each structured as *generative call → deterministic guard → typed result* |
| **Output** | Deterministic reply assembly, a blocking compliance lint, a filing-grade DOCX renderer, an HTML preview sharing the same block model, and outcome notification |

Supporting infrastructure includes a single LLM entry point, a context-budget and retrieval service, a pure document-normalisation library, a calendar engine, a doctrine renderer and the profile schema.

### B. The jurisdiction profile

The profile is the module's configuration surface and its legal specification. Its principal keys are:

- **`instruments[]`** — the document types the office issues, each with detection hints that drive *deterministic* instrument recognition, and the metadata fields the parser should extract. The Indian profile declares three: FER, Subsequent Examination Report, and Hearing Notice.
- **`timeline.deadlines[]`** — rules of the form `{trigger, period, extension, consequence}` expressed in ISO-8601 durations. The Indian profile encodes the Rule 24B(5) six-month reply period with its Form 4 extension and nine-month request window, the three-month updated Form 3 obligation under Rule 12(3) as amended in 2024, and the fifteen-day post-hearing written-submissions window under Rule 28(7).
- **`objections[]`** — a mapping from a canonical code to the local statute, detection hints, response type, sub-types, doctrine key, action checklist, standard reply sentence, and a **case-law whitelist**. The Indian profile declares eight objection families and expands eligibility into seven Section 3 sub-clauses (3(k), 3(d), 3(e), 3(c), 3(f), 3(i), 3(m)).
- **`doctrines{}`** — ordered reasoning steps a drafter must follow, with leading authorities [12], [13], [14].
- **`amendments`** — the scope rule quoted verbatim from Section 59(1), the basis requirement, and the marked/clean copy convention.
- **`response.skeleton[]`** — the ordered section identifiers, which are literally the switch in the assembly function. The Indian skeleton runs: address block, subject line, preliminary submissions, objection-wise reply, marked amended claims, clean amended claims, conclusion and prayer, signature block.
- **`prompts{}`** — per-stage overlay text merged over the global stage instruction.

The engine's internal vocabulary is a fixed set of canonical objection codes — `NOVELTY`, `INVENTIVE_STEP`, `ELIGIBILITY`, `CLARITY`, `SUFFICIENCY`, `UNITY`, `ADDED_MATTER`, `DOUBLE_PATENTING`, `PROCEDURAL_DISCLOSURE`, `FORMALITIES`, `OTHER` — into which each jurisdiction's local grounds are mapped. This is what allows a single pipeline to serve offices whose statutory schemes differ.

Two validators protect the profile. A structural and semantic validator checks the schema, confirms that deadline rules reference declared instruments, that doctrine keys resolve, and that identifiers are unique. A separate **readiness check** is deliberately pipeline-shaped: each failure it reports corresponds to a stage that would otherwise throw or produce unusable output. No detectable instrument means intake cannot classify; a missing classification or drafting prompt overlay means the two model-critical stages have no jurisdiction guidance; fewer than three skeleton sections means there is nothing to assemble.

### C. Data model

The persistent model is small and deliberately shaped around auditability. A case owns office-action documents, which own objection cards and citation records; a case also owns versioned response drafts and the invention documents, which own embedded text chunks. A separate job table carries the queue.

Several fields carry meaning beyond their names. `quoteVerified` on an objection is the result of the deterministic substring check, not a model claim. `officeNumber` preserves the Controller's own numbering so the reply can answer under it. `newMatterSafe` is `true` only for the as-filed specification and claims, and is the Section 59 guard expressed as a column. The `resolvedVia` field records which retrieval tier produced a citation's full text and is stored only on the column, never inside the JSON payload that reaches the client, because the attorney should see a patent document rather than a fetch log.

---

## V. The Processing Pipeline

### A. Intake

Ingestion is triggered by a PDF, DOCX or text upload and proceeds as follows.

Raw bytes are format-detected by magic bytes and converted to text; a scanned PDF with no extractable text layer is rejected with a clear error rather than silently producing an empty document. The extracted text then passes through a **furniture cleaner**. This step is not cosmetic. PDF-to-text conversion injects repeated running headers, page-number footers, and — at every page break — a duplicate of the final line before the break repeated after it. Those artifacts sever sentences, and a severed sentence defeats exact quote matching downstream. Cleaning reconnects the prose so that the model's verbatim quotes can actually be found in it. The cleaned text is what is stored and what all later verification matches against.

**Instrument detection is deterministic**: profile detection hints are matched as substrings, the instrument with the most hits wins, and confidence is reported as the hit ratio. No model is involved in deciding what kind of document arrived.

A parsing call then extracts dates, parties, cited documents and objections, copied verbatim. The parsing prompt carries one office-specific negative instruction worth noting: it explicitly forbids inferring objections from the Indian FER's Part I summary grid, because the polarity of that grid's yes/no answers differs from row to row and is unreliable. Objections must come from the Part II detailed observations and the Part III formal requirements. This is knowledge about *reading the document*, not about the law, which is why it lives in the prompt rather than the profile.

Trigger dates pass a strict ISO guard — permissive date parsing accepts ambiguous formats such as `10/13/2025` and silently produces the wrong deadline — and deadlines are then computed by a **pure calendar function** from the profile rules, with month arithmetic clamped to month ends so that a six-month period from 31 August ends on 28 or 29 February rather than overflowing into March.

Finally, objections are classified into canonical cards, and citations are queued for background resolution.

### B. Citation resolution

Resolving a cited document to full text is a cost-ordered cascade, run as a background job: the local corpus first (free and instant, accepted only if the record holds both claims and description), then an authoritative open patent-data service for European and international numbers, then a public patent page, and only as a last resort a paid retrieval service. Non-patent literature and citations without a document number short-circuit to a manual-upload state.

One implementation detail is load-bearing. Every database write in this cascade is guarded on the row still being in the pending state. Retrieval takes seconds per document, and within that window the attorney may have uploaded their own copy; an unguarded write would stamp a resolved citation back to "manual required."

### C. Reply preparation

The preparation run is the core of the module. Because a real FER requires roughly three model calls per objection and can take from several minutes to an hour, the endpoint never performs the work inside the request. It enqueues a job, returns immediately, and the client polls for status.

The run has four phases:

1. **Invention context, computed once per case.** The specification is normalised — paragraph identifiers, canonical sections, claim elements and overlapping chunks — entirely in pure string code with no model involvement. A cached digest is reused if present; otherwise one digest pass distils the problem, solution, key features, technical advance, efficacy data and independent-claim elements, each carrying a paragraph pointer so the digest remains citable. Only a genuine digest is ever persisted, because writing an empty fallback would defeat the null check that triggers rebuilding.

2. **Draft row opened before any work begins.** If a previous run died mid-way, its row is resumed rather than superseded. Opening a new version would make it the latest draft the workspace renders, blanking sections the attorney could already see, and would re-purchase every model call behind the objections already drafted. Only sections that actually contain text are carried over, so a retry replaces a failure instead of sitting beside it.

3. **Per-objection loop, each iteration isolated and persisted.** For each objection the run checks whether a pause has been requested, routes procedural objections to a non-generative path, builds a claim chart if the objection cites documents whose full text is available, produces strategy options with an amendment-basis check, drafts the reply section, and persists. Each objection is wrapped in its own error boundary: a stage that throws costs *that objection* its section — recorded explicitly so the attorney can see which one needs writing and so a later run retries only that one — and never the remainder of the run.

4. **Named sections.** Preliminary submissions and the conclusion and prayer are drafted last, and the draft is marked complete.

The shape of this loop exists to protect already-purchased model output. The unit of loss is one objection, never one case.

### D. The model runner contract

Every generative call in the module passes through a single function. There is no second path. Prompt assembly is fixed and three-part: a jurisdiction-agnostic global instruction for the stage, then the profile's jurisdiction overlay for that stage, then the input block, then a demand for a single JSON object. Output parsing is tolerant of code fences and surrounding prose.

Two properties of this contract matter more than the rest. First, every call is metered through a central gateway with a task and stage code, so model selection, quota, plan entitlement and usage recording are uniform and the gateway is injectable for testing without a database or API keys. Second — and this is the module's single most important resilience property — **failures are returned as data, not thrown**. Both a gateway exception and a gateway failure response produce a typed failure result, and the caller decides the blast radius. A single throw crossing the per-objection boundary would previously abort an entire run.

---

## VI. The Verification Layer

This section describes the module's principal contribution: the deterministic checks that stand between generated text and a filed document. Each is a pure function or a query predicate. None calls a model.

### A. The grounding primitive

`verifyQuote` answers one question: does this quoted span actually appear in that source document? It is used for examiner quotations, for claim-chart passages and, transitively, in the export gate.

Matching operates on a folded form of both strings: Unicode NFKC normalisation to resolve superscripts and ligatures, unification of dash, quotation-mark and non-breaking-space variants, whitespace collapse, and lower-casing. Words are preserved, so folding absorbs extraction noise without weakening the test.

Verification then proceeds in tiers:

```
exact folded substring?                          → verified
needle shorter than 12 words?                    → NOT verified
consecutive word-bigram coverage ≥ 0.85?         → verified
otherwise                                        → NOT verified
```

The design of the second tier is the interesting part. A verbatim examiner quotation may run to two thousand characters, and a single stray superscript or OCR glitch inside that span would defeat exact matching. Bigram coverage tolerates such damage. It does not tolerate fabrication, because the consecutive word pairs of an invented sentence are simply absent from the source. Short quotations are held to exact matching precisely because bigram coverage becomes unreliable at small lengths.

### B. Objection reconciliation

Classification assigns canonical codes, but the code then enforces an invariant the model cannot be trusted to maintain: **every raw parsed objection produces exactly one card**. An explicit index binds each model output to a raw objection. A repeated index is treated as a duplicate and is not permitted to consume a different raw objection, which would otherwise mark an unrelated objection as answered. Positional fallback applies only when no usable index is supplied. Any raw objection the model dropped is appended as an `OTHER` card carrying a "review and re-categorise" rationale. An unknown code is coerced to `OTHER`. Where the model's copy of the examiner text has drifted but the raw parse verifies, the raw text wins.

Complete classification failure is not fatal. Deterministic fallback cards are built straight from the parse, and the route returns a warning rather than an error. **No objection is ever lost**, because an unanswered objection in a filed reply is the module's worst possible defect.

### C. Claim-chart passage verification and the chartable filter

Every chart cell marked as disclosed must carry a passage that verifies against the cited document's stored text. A cell whose passage does not verify is **downgraded to ambiguous** and the passage is discarded — the model's conclusion is not accepted merely because it was stated.

A second filter operates before charting begins: only citations whose resolved text actually contains claims or a description are charted at all. Charting a bare title and abstract produces false "not disclosed" distinctions, and those distinctions are exactly what the attorney would rely on to argue novelty.

### D. Full-document absence verification

This check addresses a failure that grounding alone cannot reach. To keep prompts affordable, the charting stage sees only the first six thousand characters of each cited document, while a patent specification runs from fifty thousand to two hundred thousand. The model therefore returns "not disclosed" for text it was never shown — and that verdict is then filed as a statement of fact to the Controller.

Before any absence verdict is trusted, the **complete stored document** is scanned for the claim feature. No embeddings, no additional model call; the full text is already on file, and only the prompt was truncated.

Two properties make the check usable in practice. It is **deliberately asymmetric**: a hit downgrades the verdict to ambiguous and shows the attorney the passage, whereas a miss upgrades nothing. One passage proves disclosure; no passage proves nothing. And it suppresses **generic field vocabulary**. Without that suppression, a feature such as "a sensor coupled to a processor configured to output a control signal" matched almost any electronics citation on a single common word, overturned genuine absence findings, and thereby emptied the chart's distinction list — costing the reply its novelty argument. The suppression list covers both classical patent boilerplate and the everyday vocabulary of software, electronics and biotechnology.

### E. Post-draft contradiction lint

The absence scan prevents the chart from being wrong; the contradiction lint prevents the prose from contradicting a chart that is right. A drafted section can state that a document "does not disclose the phaseolin promoter" while the chart for that same document records the feature as disclosed. Nothing upstream catches this: the sentence is fluent, names a real document, and quotes nothing that requires verification.

Because mapping a free-text sentence to a claim limitation is easy in some cases and unreliable in others, the lint reports a confidence tier and only a **high-confidence** mapping may block a filing. A sentence that carries several limitations, several document labels or unresolved pronouns, or that argues about the examiner rather than about a document, is surfaced to the attorney rather than treated as an error. An absence asserted against a document that is not completely on file blocks regardless of tier, since that finding does not depend on resolving which limitation the sentence meant.

### F. Evidence checks over the drafted prose

Everything discussed so far verifies *structured* output. The thing actually filed, however, is free prose. Three deterministic checks read the finished text back:

- **Quotations.** Any quoted span of meaningful length attributed to a document on file must verify against that document. A fabricated quotation blocks. An unlocatable quotation with no attribution warns rather than blocks, and quoted *claim terms* are correctly excluded from treatment as quotations of a document.
- **Authorities.** Case names appearing in the prose are checked against the whitelist for that objection and its doctrine. A United States authority in an Indian reply blocks. Short-form citations of a whitelisted case pass. Where a jurisdiction whitelists no authority for an objection, citing any authority blocks.
- **Figures.** Numerical technical effects asserted in the reply must appear in material on the record. Claim numbers and paragraph numbers are explicitly excluded so that ordinary cross-references are not mistaken for experimental data.

All three are calibrated for **precision over recall**, on the stated reasoning that a check which fires on correct replies is switched off within a week and thereafter catches nothing at all. Each also distinguishes "skipped because nothing is on file" from "passed", so an empty record never reads as a clean result.

### G. The Section 59 guard

Amendment basis is protected at two levels.

**Structurally**, the retrieval query that finds candidate basis paragraphs carries the predicate `newMatterSafe = true`, and that flag is set only for the as-filed specification and claims. Post-filing evidence — comparative efficacy data, expert declarations, teaching-away references — is therefore *incapable* of reaching the basis finder. It is not discouraged from doing so; it cannot be retrieved. Supplementary material travels on a separate, explicitly labelled channel usable for argument and evidence only.

**Textually**, each proposed amendment is checked as follows. Cited basis references are resolved against the as-filed paragraphs, tolerating the several formats the drafting stages actually emit — including ranges such as `¶0038-¶0041`, which retrieval itself produces as chunk labels and which a naive lookup rejected, causing valid amendments to be silently dropped. Every inserted span is then tokenised, short tokens are discarded, and at least **70%** of the remaining words must appear in the cited paragraphs. Falling short marks the amendment as failed, and a failed amendment cannot enter the reply.

The guard also encodes a point of law. A **deletion requires no basis**: Section 59 governs what may be added, so cancelling a claim or striking words introduces no new matter. Reporting such an amendment as "without basis" told the attorney that a perfectly valid narrowing amendment was legally defective. Where some references resolve and others do not, the verdict is partial — real textual support, but a combination the attorney must stand behind personally.

### H. Case-law scoping

Only the authorities whitelisted for the specific objection, together with its doctrine's leading cases, are supplied to the drafter, and entries tagged to a sub-clause are dropped when the sub-clause is known. When the list is empty, that fact is stated **explicitly** in the prompt — "cite no case law" — because silence would leave the model free to fall back on half-remembered case names. The list that feeds the prompt is the same list that feeds the post-hoc check, which is itself covered by regression tests.

### I. Procedural bypass

Formal objections never reach a model at all. A Form 3 statement under Section 8, an annexure, a declaration of biological source [17], an NBA approval — these are **not argued; they are done**. A model can only *assert* that the act took place, and an asserted compliance that did not occur is a misrepresentation to the Controller over the attorney's signature.

Objections marked procedural in the profile therefore route to a deterministic builder that emits a fixed reply sentence drawn from the profile, plus an action checklist rendered for the attorney and **never filed as prose** — the profile's action entries are full of conditionals and practice notes, and a reply reciting one would be a leaked worksheet rather than a submission. The paragraph is flagged, and the DOCX renderer honours the flag by highlighting it and appending an explicit "remove before filing" marker. As a secondary benefit, this saves two paid calls per formal objection.

### J. The blocking compliance gate

Export is gated. The lint runs twenty distinct checks, of which the following block the export outright: every non-dismissed objection has an approved reply; no approved section is empty; every approved reply rests on a verified examiner quotation; every amended claim cites specification basis; that basis resolves in the as-filed text; the specification designated as-filed actually exists on the case; marked and clean claim copies carry identical claim-number sets; every paragraph reference in the filed text resolves; no internal anchor residue survives into the document; prior-art statements do not contradict the chart at high confidence; quotations, authorities and asserted figures pass the prose checks; and, where the report raises a Section 8 objection, the attorney has *positively confirmed* the Form 3 position — because on a procedural objection, **silence is not compliance**. Warning-level checks cover FER ordering, power of attorney, Form 4, applicant-name and stated-versus-computed deadline agreement.

A failing lint returns an error status and no document is produced. The lint result is persisted either way, so the record shows what was checked and when.

---

## VII. Context and Cost Architecture

### A. The naive baseline

A specification runs from twenty thousand to eighty thousand tokens. Sending it to every stage of every objection — six objections across three generative stages at a fifty-thousand-token specification — costs roughly **900,000 input tokens per case** before citations or revisions are considered. At reasoning-model rates, that is a material sum spent repeatedly re-reading one document, multiplied by every run and every revision.

### B. Three levers

**Lever 1 — the digest.** One pass over the paragraph-numbered specification produces a compact structured summary of one to two thousand tokens, each element carrying a paragraph pointer so it remains citable. It is cached on the case. Where the case is linked to an existing drafting project inside the platform, the same structure is assembled from already-normalised data for **zero model tokens**.

**Lever 2 — retrieval instead of stuffing.** All structural work — paragraph identifiers, canonical sections, claim elements, and roughly four-hundred-token chunks with one-paragraph overlap, each labelled with its paragraph range — is done in pure string code. Each chunk is embedded once at intake. Every subsequent stage that needs specification detail issues a top-*K* approximate nearest-neighbour retrieval [16] with `topK = 8` packed to a four-thousand-token ceiling, filtered by document kind and by the new-matter flag.

Two details in this path repay attention. The query is embedded with a *query-side* embedding request: the embedding model in use is asymmetric, and embedding a query as though it were a document silently degrades retrieval without producing any error. And **any retrieval failure returns an empty result**, so callers degrade to digest-only context — never to full-specification stuffing, which would convert a retrieval outage into a cost incident.

**Lever 3 — skip work that is not needed.** No chart is built when an objection cites nothing, or cites nothing whose full text is available. Procedural objections skip both charting and strategy. Claims and drawings documents are marked as not requiring indexing, because nothing retrieves them; claims reach the charts whole from a dedicated field.

### C. Estimated effect

| Item | Naive | This architecture |
|---|---|---|
| Understanding the invention | 50k × 6 objections × 3 stages ≈ 900k | one digest pass ≈ 55k in / 2k out |
| Per-objection generation | *(included above)* | 6 × (digest 2k + retrieved 3k + objection 1k) ≈ 36k in |
| Citations | full text for every reference | examiner pinpoints; full fetch on demand |
| Embedding | — | whole specification once, a fraction of a cent |
| **Input tokens per case** | **≈ 900k** | **≈ 90–100k**, most of it cacheable prefix |

These figures are **analytical estimates derived from the token model**, not measurements from production traffic; the module also exposes a deliberately conservative pre-flight estimator so an attorney sees a bound before authorising a run. Because the digest and jurisdiction guidance form a stable prompt prefix across a case's objections, provider-side prompt caching discounts the shared portion on every objection after the first.

---

## VIII. Human Oversight and Reliability

### A. Attorney-in-the-loop surfaces

The system files nothing. Every generated section is a draft behind an approval gate, and approval is per section. Four controls define the workflow:

- **Objection triage.** An objection card may be confirmed or dismissed. Dismissed objections are excluded from the run and from lint coverage, which is how an attorney disposes of an objection they judge inapplicable without leaving a coverage failure.
- **Editing re-opens approval.** Any text edit sets the section back to unapproved. An edited section must be read again before it can be exported.
- **Directed redrafting.** A single section can be redrafted with the attorney's own instruction. The current section text and the remark are supplied together, with the remark positioned last — closest to the task — and framed as binding: follow it exactly, keep what works, stay within the supplied evidence and authorities, and if it cannot be done on this record, say so plainly rather than inventing support. The remark is stored on the section as the record of why the wording changed, and the result always returns unapproved, because it has not been read yet.
- **Pause and resume.** A stop request is honoured **between** objections, never mid-stage, so a pause never lands inside a paid call or leaves a half-written section. This is the mechanism that lets an attorney interrupt a run, upload a cited prior-art document they hold, and continue with that document in play for the objections not yet drafted.

Progress narration is treated as a product surface rather than as logging. Messages describe real work — *"Objection 3 of 7 · Inventive step — charting the claims against D1, D2"*, *"Invention indexed — 84 paragraphs available as amendment basis, 7 objections to answer, 4 cited documents on file"* — and every number in them is read off the case rather than estimated.

### B. Reliability engineering

The job worker uses a database-lease pattern: candidates are selected and then claimed by a guarded conditional update, so exactly one worker wins under concurrency. A heartbeat renews the lease every sixty seconds, and a worker that loses its lease abandons the job rather than competing with its new owner. Two runtimes share one queue — a standalone worker and an in-process drain — which the lease makes safe. Retries follow a one-minute, five-minute, fifteen-minute backoff to a default of three attempts.

One defect fixed here is worth recording because it is characteristic of long-running LLM pipelines. A preparation run spans minutes to an hour of gateway calls, while the default session credential expired after fifteen minutes, causing every stage after that point to fail with an unrelated-looking tenant-resolution error. The run now mints a ninety-minute internal credential and re-mints it every ten minutes, mutating the shared header object in place so that the refresh reaches calls already in flight further down the pipeline.

Completion notification is sent only by the worker that actually recorded the outcome, so a lease handover cannot produce a duplicate, and only on genuine completion or final failure — never on a retry and never on a deliberate pause. The notification carries the soonest live deadline, because the statutory clock runs whether or not the run succeeded.

---

## IX. Implementation Status and Validation

### A. Status

The module comprises roughly 8,300 lines of TypeScript across thirty-one stage and infrastructure files, plus the workspace interface and nine HTTP endpoints. It is deployed within a commercial patent-workflow platform. The **Indian profile is the implemented jurisdiction**, covering the Section 59 basis guard, Rule 24B deadlines, the Section 3(d) and 3(k) sub-clauses, and the Form 3 / Section 8 procedural track. The profile schema already models the deadline shapes required for the United States, European, Australian, New Zealand and United Kingdom offices under three prosecution models — per-report, acceptance-clock, and hybrid — so those jurisdictions are authoring work rather than engineering work.

### B. Regression suite

The verification layer is protected by **48 regression tests across two suites, all passing** at the time of writing. Their organisation is itself informative, because each test encodes a defect that reached a draft:

- paragraph anchors never reach a filing unvetted, and the preview shows the same verdict as the filing;
- the filed document contains only what the attorney approved, and a failed section never produces a heading with no body;
- a font name drawn from a jurisdiction profile cannot close the stylesheet and inject script into the preview;
- claim parsing survives spaced claim markers, numberless back-references and dependencies declared late in a claim;
- chunking is bounded even for text containing no sentence punctuation;
- common engineering vocabulary does not overturn a genuine absence finding, while a genuinely distinctive term does;
- a deletion-only amendment requires no basis, an unsupported insertion is still rejected, and a range basis reference is cited in full rather than truncated to its first number;
- deadlines are computed relative to today rather than to the ingest date, however they were stored;
- malformed model output cannot fail an entire ingest;
- a fabricated quotation blocks while a genuine one passes; a foreign authority blocks while a whitelisted one passes in both full and short form; an invented technical effect blocks while a figure present in the specification passes;
- and each prose check is *skipped* rather than *passed* when nothing is on file.

### C. What we do not claim

We report no accuracy, acceptance-rate or attorney-time figures. Establishing them properly requires a controlled study over a corpus of real FERs with blinded expert assessment of the resulting replies, together with grant-outcome tracking over the prosecution cycle, and that study has not yet been conducted. We think it important to say so plainly: the contribution offered here is an architecture and a verification methodology, evidenced by the implemented guards and the regression suite that protects them, and not an empirical claim about output quality.

---

## X. Discussion and Limitations

### A. What the architecture buys

The design converts a class of unbounded risks into bounded ones. A model that fabricates an examiner quotation produces a card flagged as unverified, which blocks export. A model that invents disclosure in a cited document produces a chart cell downgraded to ambiguous. A model that proposes an amendment without support produces a failed verdict, and the amendment never enters the reply. A model that reaches for a familiar foreign authority produces prose that the whitelist check rejects. In each case the failure surfaces as a visible, named, blocking condition rather than as a confident sentence in a filed document.

Equally important, the design bounds *economic* loss. Work is persisted after every objection; a crash costs one objection, not one case. A dead run resumes rather than reopening, so previously purchased output is not re-purchased. Stage failures are data rather than exceptions, so one bad objection does not abort six good ones.

### B. Limitations

**Precision-recall calibration.** The prose checks are explicitly tuned for precision. This is the right trade-off for a gate that attorneys must be willing to keep switched on, but it means some fabrications will pass. The checks reduce the rate; they do not reduce it to zero.

**Truncated charting evidence.** Charting still sees only the first six thousand characters of a cited document. The absence scan corrects false absences afterwards, but a disclosure buried deep in a long specification may simply never be found in the first place, and no downstream check can create evidence that was not sought.

**Single jurisdiction in production.** The claim that the engine is jurisdiction-agnostic is supported by the absence of country-code branching and by a schema that models several prosecution structures, but it has been demonstrated end-to-end only for India. A second profile would test the abstraction properly.

**No outcome evidence.** As stated above, we have no data linking generated replies to prosecution outcomes.

**Dependence on text extraction.** A scanned FER with no text layer is rejected rather than processed. Optical character recognition would extend coverage, but it would also introduce noise into precisely the text that all verification matches against, and the interaction between OCR error rates and the bigram threshold would need to be characterised before that is safe.

### C. Ethical and professional considerations

The system is designed on the assumption that a qualified patent agent or attorney is the author of the filed document and remains professionally responsible for it [11]. Three design choices follow directly. Approval is per section and is revoked by any edit. Procedural compliance is never asserted by a model. And the interface deliberately shows an attorney a patent document rather than the retrieval route that produced it, so that internal machinery does not acquire an unearned appearance of authority. We consider the "assert compliance" failure mode the most serious risk in this application domain, which is why it is addressed structurally — by removing the model from that path entirely — rather than by instruction.

---

## XI. Conclusion

Generating a First Examination Report reply is a task where large language models offer real leverage and where their characteristic failure mode is professionally unacceptable. We have described a deployed system that resolves that tension by refusing to trust generated assertions on their own terms. Every stage that generates is followed by code that checks: examiner quotations against the cleaned report, chart passages against the cited document, absence findings against the complete text rather than the truncated prompt, drafted prose against its own chart, amendments against the specification as filed, authorities against a jurisdiction whitelist, and the entire draft against a blocking compliance gate. Formal objections bypass generation altogether, because compliance is an act and not an argument. All local law lives in a validated profile, so the engine holds no jurisdiction-specific logic, and a retrieve-per-need context strategy keeps the cost of that rigour proportionate.

The general lesson we draw is narrow but, we think, transferable to other regulated drafting domains: **grounding reduces the probability that a model fabricates, but only verification reduces the probability that a fabrication survives.** In a setting where the output is signed and filed with a public authority, it is the second probability that matters.

---

## Acknowledgements

*[To be completed by the authors.]*

---

## References

[1] The Patents Act, 1970 (No. 39 of 1970), Government of India, as amended.

[2] The Patents Rules, 2003, as amended by the Patents (Amendment) Rules, 2024, Government of India.

[3] M. Dahl, V. Magesh, M. Suzgun, and D. E. Ho, "Large legal fictions: Profiling legal hallucinations in large language models," *Journal of Legal Analysis*, vol. 16, no. 1, pp. 64–93, 2024.

[4] V. Magesh, F. Surani, M. Dahl, M. Suzgun, C. D. Manning, and D. E. Ho, "Hallucination-free? Assessing the reliability of leading AI legal research tools," *Journal of Empirical Legal Studies*, 2025.

[5] R. Krestel, R. Chikkamath, C. Hewel, and J. Risch, "A survey on deep learning for patent analysis," *World Patent Information*, vol. 65, 102035, 2021.

[6] J.-S. Lee and J. Hsiang, "Patent claim generation by fine-tuning OpenAI GPT-2," *World Patent Information*, vol. 62, 101983, 2020.

[7] S. Casola and A. Lavelli, "Summarization, simplification, and generation: The case of patents," *Expert Systems with Applications*, vol. 205, 117627, 2022.

[8] P. Lewis *et al.*, "Retrieval-augmented generation for knowledge-intensive NLP tasks," in *Proc. Advances in Neural Information Processing Systems (NeurIPS)*, 2020, pp. 9459–9474.

[9] K. Shuster, S. Poff, M. Chen, D. Kiela, and J. Weston, "Retrieval augmentation reduces hallucination in conversation," in *Findings of EMNLP*, 2021, pp. 3784–3803.

[10] Z. Ji *et al.*, "Survey of hallucination in natural language generation," *ACM Computing Surveys*, vol. 55, no. 12, pp. 1–38, 2023.

[11] Office of the Controller General of Patents, Designs and Trade Marks, *Manual of Patent Office Practice and Procedure*, Government of India.

[12] Office of the Controller General of Patents, Designs and Trade Marks, *Guidelines for Examination of Computer Related Inventions (CRI)*, Government of India, 2017.

[13] *Novartis AG v. Union of India*, (2013) 6 SCC 1 (Supreme Court of India).

[14] *Ferid Allani v. Union of India*, W.P.(C) 7 of 2014, Delhi High Court, 2019.

[15] Convention on the Grant of European Patents (European Patent Convention), Art. 123(2), 16th ed., European Patent Office.

[16] Y. Malkov and D. Yashunin, "Efficient and robust approximate nearest neighbor search using hierarchical navigable small world graphs," *IEEE Transactions on Pattern Analysis and Machine Intelligence*, vol. 42, no. 4, pp. 824–836, 2020.

[17] The Biological Diversity Act, 2002 (No. 18 of 2003), Government of India.

[18] 35 U.S.C. §132(a), United States Code — Notice of rejection; reexamination.
