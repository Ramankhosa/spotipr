# FER / Office Action Module — Architecture & Processing Intelligence

### An implementation-level map of `src/lib/office-action/*`, written for an AI agent that has to reason about, extend, or debug this code without reading all 6,000 lines first.

**Companion docs:** `OFFICE_ACTION_STUDIO_PRODUCT_PLAN.md` (why), `OFFICE_ACTION_CONTEXT_AND_COST.md` (cost model), `OFFICE_ACTION_UX_DESIGN.md` (attorney surfaces), `OFFICE_ACTION_WESTERN_JURISDICTIONS.md` (profile research).

---

## 0. One-paragraph summary

The module turns an examiner's objection letter (India: **FER** — First Examination Report; US: Office Action; EPO: Art. 94(3) communication) into a filing-ready reply DOCX. It does this with a **jurisdiction-agnostic engine** driven entirely by a **data profile** (`officeActionProfile` inside `Countries/<CODE>.json`), a **7-stage LLM pipeline** whose every generative output passes through a **deterministic verification guard**, and a **retrieve-per-need context strategy** that reads the full specification exactly once. Nothing files automatically: every section is a draft behind an attorney approval gate, and a blocking compliance lint stands between the draft and the export.

**The three non-negotiable ideas.** If you change code here, these are what you must not break:

1. **Jurisdiction logic is data, never code.** No file in `src/lib/office-action/` may branch on a country code. Adding Brazil = authoring a JSON profile.
2. **Every assertion is anchored, and the anchor is checked in code, not asked for in a prompt.** Examiner quotes must substring-match the report. Claim-chart passages must substring-match the cited document. Amendments must cite as-filed paragraphs that actually contain the inserted words. Case law comes only from a per-objection whitelist. A prompt instruction is a request; a post-hoc string check is a guarantee — the code uses both, and only trusts the second.
3. **Read the invention once.** The full spec goes to a model exactly once (the digest pass). Everything after that runs on the digest plus top-K vector-retrieved paragraphs.

---

## 1. Layer map

```
┌─ UI ──────────────────────────────────────────────────────────────────────┐
│ src/app/office-actions/page.tsx           case list                       │
│ src/app/office-actions/[caseId]/page.tsx  workspace (2450 lines):         │
│   deadline strip · objection rail · workbench (Objection/Evidence/        │
│   Strategy/Draft tabs) · docked source viewer                             │
└───────────────────────────────────────────────────────────────────────────┘
┌─ HTTP ────────────────────────────────────────────────────────────────────┐
│ /api/office-actions                     GET list · POST create case       │
│ /api/office-actions/:id                 GET case view                     │
│ /api/office-actions/:id/documents       POST ingest an office comm.       │
│ /api/office-actions/:id/case-documents  GET/POST/DELETE invention + evid. │
│ /api/office-actions/:id/citations       GET cited docs · POST attach      │
│ /api/office-actions/:id/objections      PATCH confirm/dismiss             │
│ /api/office-actions/:id/prepare         POST run/pause/resume · GET status│
│ /api/office-actions/:id/draft           PATCH edits/approve · POST redraft│
│ /api/office-actions/:id/export          POST lint + DOCX                  │
└───────────────────────────────────────────────────────────────────────────┘
┌─ Orchestration ───────────────────────────────────────────────────────────┐
│ oa-case-service.ts          intake orchestration (createCase, ingestDoc)  │
│ reply-pipeline.ts           the reply run (digest → per-objection → close)│
│ office-action-job-service.ts  DB-lease job worker (queue, heartbeat, retry)│
└───────────────────────────────────────────────────────────────────────────┘
┌─ Stages (each: LLM call + deterministic guard) ───────────────────────────┐
│ oa-parser.ts           detect instrument (no LLM) + extract structure     │
│ objection-classifier.ts  canonical code + quote verification              │
│ citation-resolver.ts   4-tier cascade to full patent text (no LLM)        │
│ invention-digest.ts    one-time compact invention summary                 │
│ claim-chart-service.ts feature × citation grid + passage verification     │
│ strategy-service.ts    argue/amend options + s.59 basis guard             │
│ response-drafter.ts    the reply section text                             │
│ procedural-reply.ts    formal objections — deterministic, no LLM at all   │
└───────────────────────────────────────────────────────────────────────────┘
┌─ Infrastructure ──────────────────────────────────────────────────────────┐
│ oa-llm-service.ts      the ONLY LLM entry point (prompt assembly+metering)│
│ context-budget.ts      pgvector retrieval + token packing + cost estimate │
│ document-intake.ts     paragraph/section/claim/chunk normalization (pure) │
│ case-document-service.ts  store + chunk + embed the invention             │
│ deadline-engine.ts     pure calendar arithmetic from profile rules        │
│ objection-doctrine.ts  render the jurisdiction's law for ONE objection    │
│ oa-profile-schema.ts   zod schema + validation + readiness scoring        │
│ oa-case-service.ts     profile loading (DB → repo fallback)               │
└───────────────────────────────────────────────────────────────────────────┘
┌─ Output ──────────────────────────────────────────────────────────────────┐
│ reply-assembly.ts      deterministic block model in skeleton order        │
│ compliance-lint.ts     blocking gate (7 checks)                           │
│ oa-docx-export.ts      filing-grade DOCX                                  │
│ reply-html-preview.ts  same model, browser preview                        │
│ oa-notifications.ts    outcome email                                      │
└───────────────────────────────────────────────────────────────────────────┘
```

Supporting I/O: `file-text-extract.ts` (magic-byte format detection → PDF/DOCX/text), `pdf-extract.ts`, `google-patents-fulltext.ts`, `upload-formats.ts`.

---

## 2. The jurisdiction profile — where all local law lives

`oa-profile-schema.ts` defines a zod schema for a block that sits at `Countries/<CODE>.json → officeActionProfile`, mirrored into `CountryProfile.profileData` by `npm run oa:sync-profile <CODE>`.

| Profile key | What the engine does with it |
|---|---|
| `meta` | office name, `moduleLabel` ("FER Response"), `lawVersion`, `status: draft\|active` |
| `instruments[]` | `detectionHints` drive **deterministic** instrument detection; `extractFields` tell the parser what metadata to pull |
| `timeline.deadlines[]` | rule = `{trigger, period(ISO-8601), extension, consequence}` → fed to the pure deadline engine |
| `prosecution.model` | `PER_REPORT` (IN/US/CA/EP) \| `ACCEPTANCE_CLOCK` (AU/NZ) \| `HYBRID` (UK) |
| `objections[]` | maps a canonical code → local statute, `detectionHints`, `responseType: SUBSTANTIVE\|PROCEDURAL`, `track`, `subTypes[]`, `doctrine` key, `actions[]`, `replySentence`, **`caseLawWhitelist[]`** |
| `doctrines{}` | ordered `steps[]` the drafter must follow (problem–solution, Graham/KSR, technical-advance) + `leadingCases` |
| `amendments` | `scopeRule` verbatim, `basisRequired`, marked/clean format, status identifiers |
| `response.skeleton[]` | ordered section ids → **literally the switch in `assembleReply`** |
| `response.export.formatting` | font, size, line spacing, margins, numbering, salutation, section titles → read by the DOCX renderer |
| `prompts{}` | per-stage overlay text merged over the global stage instruction |

**Canonical objection vocabulary** (`CANONICAL_OBJECTION_CODES`) — the engine's internal language: `NOVELTY, INVENTIVE_STEP, ELIGIBILITY, CLARITY, SUFFICIENCY, UNITY, ADDED_MATTER, DOUBLE_PATENTING, PROCEDURAL_DISCLOSURE, FORMALITIES, OTHER`.

**Two validators:**
- `validateOfficeActionProfile()` — structural (zod) + semantic (deadline rules reference declared instruments, doctrine keys resolve, ids unique).
- `computeOaReadiness()` — a **pipeline-shaped** health check: each `fail` corresponds to a stage that would throw or produce garbage (no detectable instrument → intake can't classify; missing `OA_CLASSIFY`/`OA_DRAFT_SECTION` prompts → the two LLM-critical stages have no overlay; `< 3` skeleton sections → nothing to assemble). Warn-level: no doctrines, no case-law whitelist, no citation conventions.

**Profile loading has a fallback ladder** (`loadOfficeActionProfileDetailed`): DB copy → repository `Countries/<CODE>.json` (process-cached) → structured failure with an actionable `reason` string. This exists because the DB copy only arrives via the sync script; a fresh deploy or restored dump would otherwise refuse to open any case.

---

## 3. Data model (Prisma, `schema.prisma:5070+`)

```
OfficeActionCase ─┬─ OfficeActionDocument ─┬─ OaObjection      (one card per objection)
  (the matter)    │   (one office comm.)   └─ OaCitation       (D1…Dn + resolution state)
                  ├─ OaResponseDraft        (versioned; sectionsJson/amendedClaimsJson/complianceJson)
                  └─ OaCaseDocument ── OaDocumentChunk  (embedding bit(512), pgvector)
OfficeActionJob    (queue row: lease, heartbeat, retry, cancelRequested)
```

Fields that carry meaning beyond their name:

- `OfficeActionCase.inventionDigest` — cached digest; `null` triggers a rebuild. **Only a real digest is ever persisted**; the empty fallback is deliberately not written, or the null-check would never rebuild it.
- `OfficeActionCase.specificationText` / `claimsText` — canonical text, kept in sync by `case-document-service`.
- `OaObjection.quoteVerified` — result of the deterministic substring check, not a model claim.
- `OaObjection.analysisJson.officeNumber` — the office's own numbering ("1", "2.a"); the reply letter answers under it.
- `OaCitation.passagesJson.examinerSeed` — the examiner's own pinpoint from the FER's citation table, captured at intake.
- `OaCitation.passagesJson.fullDocument` — resolved full text. `resolvedVia` is stored **only** on the column, never inside `passagesJson`, because `passagesJson` reaches the client.
- `OaCaseDocument.newMatterSafe` — `true` only for as-filed SPECIFICATION/CLAIMS. This is the **s.59 / Art. 123(2) guard implemented as a query filter**.
- `OaDocumentChunk.embedding` — `bit(512)`, Hamming `<~>`, matching `PATENT_CORPUS_EMBEDDING_*` in `patent-corpus-service`.
- `OfficeActionJob.cancelRequested` — the pause flag the pipeline polls between objections.

---

## 4. Pipeline A — Intake (`ingestDocument`)

Triggered by `POST /:caseId/documents` with a PDF/DOCX/text upload. `maxDuration = 300`.

```
raw bytes
  → extractUploadText()           magic-byte format detect; scanned-PDF → 422
  → cleanOfficeActionText()       strip running headers/footers and the
                                  page-boundary duplicated-line artifact
  → detectInstrument()            DETERMINISTIC: profile detectionHints,
                                  most hits wins, confidence = hits/total
  → parseOfficeActionDocument()   LLM  [OA_INTAKE_PARSE]
                                  → dates, parties, citedDocuments[], objections[] verbatim
  → buildTriggerDates()           strict ISO guard (Date.parse alone accepts "10/13/2025")
  → computeDeadlines()            PURE: profile rules + trigger dates + today
  → classifyObjections()          LLM  [OA_OBJECTION_CLASSIFY] + reconciliation guard
  → $transaction: document + objections + citations
  → kickCitationResolution()      enqueue RESOLVE_CITATIONS, kick inline drain
```

### 4.1 Why `cleanOfficeActionText` exists

`pdftotext` injects page furniture — repeated running headers, `Page 2 of 6` footers, and (at every page break) a **duplicate of the last line before the break, repeated after it**. Those artifacts sever sentences, which defeats exact quote matching downstream. Cleaning reconnects the prose so the model's verbatim quotes actually substring-match. Note the ordering consequence: `rawText` stored on the document is the **cleaned** text, and that is what `verifyQuote` matches against.

### 4.2 The parser's negative instruction

The extraction prompt explicitly forbids inferring objections from the Indian FER's PART-I summary Yes/No grid (its Yes/No polarity differs per row and is unreliable) and confines objections to PART-II §B "Detailed observations" and PART-III "Formal requirements". This is the sort of office-specific parsing knowledge that lives in the prompt because it is about *reading the document*, not about the law.

### 4.3 The classifier's reconciliation guarantee — read this before touching `normalizeClassified`

The LLM assigns codes; the code then enforces that **every raw parsed objection produces exactly one card**:

- An explicit `index` binds a model output to that raw objection.
- A **repeat of an already-consumed index is a duplicate** and must not consume a different raw — that would mark an unrelated objection as answered.
- Positional fallback only when no usable index was given.
- Any raw the model dropped is appended as an `OTHER` card with a "review and re-categorize" rationale.
- Unknown `canonicalCode` → coerced to `OTHER`.
- If the model's copy of the examiner text drifted but the raw parse verifies, the **raw text wins**.

Total classification failure is not fatal: `fallbackCards()` builds deterministic `OTHER` cards straight from the parse, and the route returns a `warning` rather than an error. **No objection is ever lost** — an unanswered examiner objection in a filed reply is the module's worst possible defect.

### 4.4 `verifyQuote` — the grounding primitive (used in three places)

```
foldForMatch: NFKC → unify dash/quote/nbsp variants → collapse whitespace → lowercase
  exact folded substring?                     → verified
  needle < 12 words?                          → NOT verified (short quotes must be exact)
  else: consecutive word-BIGRAM coverage ≥ 0.85 → verified
```

The bigram tier tolerates a stray superscript or OCR glitch inside a 2,000-character verbatim span while still rejecting fabricated sentences, whose bigrams are simply absent from the source. Used by: objection classification, claim-chart cell verification, and the compliance lint (transitively, via `quoteVerified`).

### 4.5 Citation resolution — a cost-ordered cascade, run as a background job

`resolveCitation()` walks tiers cheapest-first: **local corpus** (free, instant — accepted only if it holds full claims *and* description) → **EPO OPS** for EP/WO numbers (free, authoritative) → **Google Patents page scrape** (free) → **paid external retrieval (SerpAPI) as last resort**. NPL and number-less citations short-circuit to `MANUAL_REQUIRED` (attorney uploads).

Two details that are load-bearing:

- **Every DB write is guarded on the row still being `PENDING`** (`updateMany` with a status predicate). Retrieval takes seconds per document, and in that window the attorney may have uploaded their own copy — an unguarded write would stamp a resolved citation back to `MANUAL_REQUIRED`.
- **`toAttorneyView()` is the only shape that reaches the UI.** It whitelists patent fields and attaches a *neutral* source label ("Full patent specification" / "Patent record" / "Provided by you"). The retrieval route (`resolvedVia`) is internal diagnostics and never surfaces — the attorney sees a patent document, not a fetch log. It also lets **text on file win over the status flag**, so a document the attorney provided reads as available even if a concurrent pass stamped the row otherwise.

---

## 5. Pipeline B — Reply preparation (`prepareReply`, the core of the module)

Triggered by `POST /:caseId/prepare`, which **never runs the work in the request** — a real FER is ~3 LLM calls per objection, minutes to an hour. The route enqueues an `OfficeActionJob(PREPARE_REPLY)`, kicks the inline drain, returns `202`, and the client polls `GET`.

```
prepareReply(caseId, opts)

 ┌ 1. INVENTION CONTEXT (once per case) ────────────────────────────────────┐
 │ normalizeInvention()  pure: ¶IDs, sections, claim elements, chunks       │
 │ inventionDigest cached? → reuse : buildInventionDigest() [OA_INTAKE_PARSE]│
 │ persist ONLY a real digest                                               │
 └──────────────────────────────────────────────────────────────────────────┘
 ┌ 2. DRAFT ROW CREATED UP FRONT ───────────────────────────────────────────┐
 │ resume the latest draft if {inProgress} or {opts.resume && has gaps}     │
 │ else open version+1;  carry over ONLY sections that have text            │
 └──────────────────────────────────────────────────────────────────────────┘
 ┌ 3. PER OBJECTION (isolated try/catch; persisted after each) ─────────────┐
 │   shouldStop()?  → clean pause at this boundary                          │
 │   procedural?    → buildProceduralReply()  NO LLM, skip chart+strategy   │
 │   claim chart    → [OA_CITATION_ANALYSIS]  only if citations w/ full text│
 │   strategy       → [OA_STRATEGY] + checkAmendmentBasis() s.59 guard      │
 │   draft section  → [OA_DRAFT_SECTION]                                    │
 │   persistPartial(false)                                                  │
 └──────────────────────────────────────────────────────────────────────────┘
 ┌ 4. NAMED SECTIONS (isolated) ────────────────────────────────────────────┐
 │ preliminarySubmissions + conclusionAndPrayer  [OA_DRAFT_SECTION]         │
 │ persistPartial(true) → inProgress:false                                  │
 └──────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Crash/economy semantics — the reason the loop is shaped this way

Every design choice in the loop exists to protect **already-purchased LLM output**:

- The draft row is created **before** any work and updated after **every** objection. A timeout or crash loses at most one objection's work.
- A dead run leaves `sectionsJson.inProgress = true`. The next prepare **resumes that row instead of opening a new version**. Opening a new version would make it the "latest draft" the workspace renders — blanking sections the attorney could already see — and would re-buy every LLM call behind the objections already drafted.
- Resume carries over only sections with text; empty/failed ones are dropped and redrafted, so a retry **replaces** the failure rather than leaving it beside the new section.
- `alreadyDrafted` is keyed on sections that actually contain text, not on presence.
- Per-objection `try/catch`: a chart, strategy, or draft that throws costs **that objection** its section (recorded as a `draftError` section so the attorney sees which one to write, and so a later run retries only that one) — never the rest of the run.
- Failure inside `runOaStage` is returned as **data, not an exception** (see §6), precisely because one throw used to abort the whole run.

### 5.2 Pause / resume — the prior-art workflow

`shouldStop()` is checked **between** objections, never mid-stage, so a stop never lands inside a paid call or leaves a half-written section. The worker implements it by reading `OfficeActionJob.cancelRequested`; the route sets that flag on `action: 'pause'`. A paused run keeps `inProgress: true`, skips the closing sections, returns `{stopped: true, remaining}`, and the job is recorded `CANCELLED` (not `COMPLETED`) with the flag cleared. **This is the mechanism that lets an attorney break off mid-run, upload a cited prior-art document, and continue with that document in play for the objections not yet drafted.** No completion email is sent for a deliberate pause.

### 5.3 Progress narration is a product feature, not logging

`onProgress(step, done, total)` writes `OfficeActionJob.currentStep`, which the workspace polls. The strings are deliberately attorney-facing and describe **real work in progress**:

> *"Objection 3 of 7 · Inventive step — charting the claims against D1, D2"*
> *"… — verifying amendment basis in the specification as filed (2/3 within Section 59)"*
> *"Invention indexed — 84 paragraphs available as amendment basis, 7 objections to answer, 4 cited documents on file"*

Every number in those lines is **read off the case, never estimated** — paragraph counts from the normalizer, citation counts filtered to records that actually carry claims or description. Progress callbacks are wrapped so a failure there can never break the run. (This is consistent with the standing product rule that pipeline internals stay behind an advanced view while *real* progress remains visible.)

### 5.4 Amendment aggregation

Only amendments whose s.59 verdict is `pass` (`usableAmendments`) enter `allAmendments`, and `basisRefs` are attached only when the refs resolved. `dedupeAmendments` keeps the **last** amendment per claim number — later objections may refine the same claim — and sorts by claim number.

---

## 6. The LLM runner contract (`oa-llm-service.ts`)

**Every** LLM call in the module goes through `runOaStage()`. There is no second path.

**Prompt assembly** is fixed and three-part:

```
GLOBAL_STAGE_INSTRUCTION[stageCode]        jurisdiction-agnostic, in this file
+ "Jurisdiction guidance (<office>):"       profile.prompts[STAGE_PROMPT_KEY], flat or sub-keyed
+ "Input:" <stage input block>
+ "Respond with a single valid JSON object and nothing else."
```

**Stage codes → profile prompt keys:**

| `OaStageCode` | overlay key | currently used by |
|---|---|---|
| `OA_INTAKE_PARSE` | `OA_PARSE` | `oa-parser`, `invention-digest` |
| `OA_OBJECTION_CLASSIFY` | `OA_CLASSIFY` | `objection-classifier` |
| `OA_CITATION_ANALYSIS` | `OA_CLAIM_CHART` | `claim-chart-service` |
| `OA_STRATEGY` | `OA_STRATEGY` | `strategy-service` |
| `OA_ARGUMENT` | `OA_ARGUE` | *declared, not currently called* — argument generation is folded into the draft stage |
| `OA_DRAFT_SECTION` | `OA_DRAFT_SECTION` | `response-drafter` (sub-keyed by `objectionWiseReply` / section id) |
| `OA_COMPLIANCE_REVIEW` | `OA_COMPLIANCE_REVIEW` | *declared, not currently called* — compliance is deterministic (`compliance-lint`) |

The global instructions encode the anti-fabrication stance at the model layer (copy verbatim; quotes must be exact substrings; mark `NOT_DISCLOSED` rather than inventing; cite spec basis or say it doesn't exist; never claim a form was filed). **Treat these as belt, not braces** — the deterministic guards in §7 are what actually holds.

**Metering:** every call is `taskCode: 'LLM8_OA_RESPONSE'` + `stageCode`, routed through `llmGateway.executeLLMOperation`, so model resolution, quota, plan entitlement (`OFFICE_ACTION_RESPONSE`) and usage recording come for free. `temperature` defaults to `0.0`. The gateway is **injectable** (`OaGateway` interface) so the whole pipeline is testable without a DB or API keys.

**Output handling:** `extractJson()` is tolerant — strips ``` fences, falls back to the outermost `{…}` span. Failure to parse is `{success: false, error}`, not a throw.

**Errors are data.** Both the gateway throwing and the gateway returning failure produce `{success: false, error}`. Callers decide the blast radius. This is the single most important resilience property in the module.

---

## 7. The deterministic guards — the actual trust layer

| Guard | File | What it does | On violation |
|---|---|---|---|
| **Instrument detection** | `oa-parser` | Substring match on profile `detectionHints`; no LLM | `instrumentId: null`, confidence 0 |
| **Quote verification** | `objection-classifier` | `verifyQuote` (§4.4) against cleaned `rawText` | `quoteVerified: false` → **lint blocks export** |
| **Objection reconciliation** | `objection-classifier` | 1 raw ⟷ 1 card, no duplicate consumption, dropped raws appended | Extra `OTHER` cards, never a lost objection |
| **Passage verification** | `claim-chart-service` | Every `DISCLOSED` cell's passage must `verifyQuote` against that citation's corpus | Verdict **downgraded to `AMBIGUOUS`**, passage discarded |
| **Chartable-citation filter** | `reply-pipeline` | Only citations whose `fullDocument` has claims or description are charted | Skipped — charting a bare title/abstract yields false `NOT_DISCLOSED` distinctions the attorney would rely on |
| **s.59 / added-matter guard** | `strategy-service` | `checkAmendmentBasis`: refs must exist in as-filed ¶s **and** ≥70% of words (len>3) in each `<ins>` must appear in those ¶s | `verdict: 'fail'` → amendment **cannot** enter the reply |
| **New-matter query filter** | `context-budget` | Amendment-basis retrieval runs `AND d."newMatterSafe" = true` | Post-filing evidence is structurally unable to become amendment basis |
| **Case-law whitelist** | `objection-doctrine` | Only the objection's (and doctrine's) whitelisted authorities are sent; sub-clause-tagged entries dropped when the sub-clause is known | Empty list is emitted **explicitly**: *"cite no case law"* — silence would let the model fall back on half-remembered case names |
| **Procedural bypass** | `procedural-reply` | Formal objections never reach an LLM | A fixed profile sentence + a highlighted attorney checklist |
| **Compliance lint** | `compliance-lint` | 7 checks (§9) | Any `fail` → export returns **422**, no DOCX |
| **¶ anchor rendering** | `document-intake` | `formatParagraphRefs`: internal `¶0007` → filed `[0007]` at display/export only | Stored text keeps anchors so basis stays verifiable |

### 7.1 Why procedural objections bypass the model entirely

A Form 3 (s.8 foreign filings), an annexure, a declaration, an NBA approval — these are **not argued, they are done**. A model can only *assert* that the act happened, and an asserted compliance that never took place is a misrepresentation to the Controller over the attorney's signature. So `isProceduralObjection()` (driven by `responseType: 'PROCEDURAL'` or `track: 'FORMAL'` in the profile) routes to `buildProceduralReply()`, which emits:

- a **fixed filed sentence** — sub-clause `replySentence` → objection `replySentence` → `response.phrases.proceduralCompliance` → hardcoded default;
- an **`actionItems[]` checklist** from the profile's `actions[]`, shown to the attorney and **never filed as prose** (the profile's actions are full of conditionals and practice notes: a reply reciting *"Note: post-2024 Rules, Form 3 is due once at RQ…"* is a leaked worksheet, not a submission);
- `attorneyAction: true`, which the DOCX renderer honours by **highlighting the paragraph yellow** and appending *"ATTORNEY ACTION — remove before filing"*.

This also saves two paid calls per formal objection (no chart, no strategy).

---

## 8. Cost architecture — "index once, retrieve per need"

The naïve design (full 50k-token spec → every objection × every stage) costs ~900k input tokens per case before citations. Three levers cut that:

**Lever 1 — the invention digest.** `buildInventionDigest()` reads the paragraph-numbered spec **once** and distils `{problem, solution, keyFeatures[], technicalAdvance[], efficacyOrData[], independentClaims[]}`, each item carrying a `¶` basis pointer so the digest stays citable. Cached on `OfficeActionCase.inventionDigest`. `digestFromSpotiprDraft()` builds the same shape for **zero LLM tokens** when the case links an existing spotipr drafting project.

**Lever 2 — retrieval instead of stuffing.** `document-intake.ts` does all structure work in **pure string code** (paragraph IDs, canonical sections, claim elements, ~400-token chunks with 1-paragraph overlap, each labelled with its `¶` range). `case-document-service.embedChunks()` embeds each chunk **once**. Then every stage calls `retrieveContext()`:

- query embedded with `requestSearchQueryEmbedding` — **Voyage embeddings are asymmetric**; embedding a query as a document (the old default) silently degrades retrieval;
- pgvector Hamming search over `oa_document_chunks`, filtered by `kind` and `newMatterSafe`;
- `topK: 8`, packed to `maxContextTokens: 4000`;
- **on any failure returns `[]`** so callers degrade to digest-only context — never to full-spec stuffing.

**Lever 3 — skip work that isn't needed.** No chart when the objection cites nothing (or nothing with full text). No chart and no strategy for procedural objections. `CLAIMS`/`DRAWINGS` documents are marked `NOT_REQUIRED` rather than embedded, because nothing retrieves them (claims reach the charts whole via `OfficeActionCase.claimsText`).

`estimateAutoRunTokens()` gives a deliberately conservative pre-flight estimate: `digestPass + n × (digest + retrieval + objectionText)` in, `digest + n × 900` out.

### 8.1 Supplementary material is a separate, firewalled channel

`retrieveSupplementaryContext()` pulls attorney-uploaded evidence (efficacy data, declarations, teaching-away references) whose `targetCodes` include this objection's code (or that declare none). It has a **deterministic fallback** to the document's leading chunks when embeddings aren't ready, so explicitly-provided evidence is never silently dropped. Its prompt block is labelled unambiguously:

> *"use for ARGUMENT/EVIDENCE only — it is post-filing material and MUST NOT be cited as Section 59 amendment basis"*

…and, more importantly, the basis retrieval **cannot see it at all**, because that query filters `newMatterSafe = true`. The attorney's `intentNote` ("Comparative efficacy vs D1–D3 — use for the 3(d) objection") is passed through so the material is used the way they intend.

---

## 9. Output path — assembly, lint, export

**`assembleReply()`** is pure and deterministic. It walks `profile.response.skeleton` and emits typed blocks: `addressBlock` (+ salutation) · `subjectLine` · `namedSection` · `objections` · `amendments` (both claim slots collapse into one block) · `signatureBlock`. Objection replies are sorted by `sortOrder` (extraction order = FER order). Both renderers — DOCX and HTML preview — consume this same model.

**`lintReply()`** is the blocking gate. Seven checks:

1. **Coverage** — every non-dismissed objection has an **approved** reply. *(fail)*
2. **Content** — no approved section is empty; an LLM failure must never export as a finished section under a heading. *(fail)*
3. **Quote fidelity** — every approved reply is built on a verified examiner quote. *(fail)*
4. **Amendment basis** — every amended claim cites spec basis. *(fail)*
5. **Marked/clean consistency** — identical claim number sets in both copies. *(fail)*
6. **FER order preserved.** *(warn)*
7. **Forms checklist** — `form3Filed === false` fails; and when the report actually raises a `PROCEDURAL_DISCLOSURE` objection, **silence is not compliance** — the attorney must positively confirm. POA and Form 4 are warns.

`POST /export` persists the lint result either way, returns `422 + lint` on failure, and only then builds the DOCX. On success it flips the case to `REPLIED` and calls `recordServiceCompletion` keyed on the **case id**, so re-exporting the same reply does not consume a second quota unit. `{preview: true}` runs lint + HTML without generating a file.

**`buildReplyDocx()`** renders a filing-grade document: profile-driven font/size/spacing/margins, hierarchical `1. / 1.1.` numbering, `Re:`/`Subject:` header, salutation, and per objection the systematic pair — *"Examiner's objection: …"* (italic) then *"Applicant's submission:"* — followed by marked claims (`<ins>` → underline, `<del>` → strikethrough), the clean copy, and a s.59 basis sentence. `formatParagraphRefs` converts internal `¶0007` anchors to filed `[0007]` at render time. Optional non-filing verification note appends the lint checks in grey.

---

## 10. Job infrastructure (`office-action-job-service.ts`)

Same DB-lease pattern as the novelty/drafting workers.

- **Claim:** `findMany` candidates → guarded `updateMany` (status + lease predicate); `count === 1` wins. Safe under concurrency.
- **Heartbeat:** every 60s renews `lockedUntil`; a lost lease throws `OaJobLeaseLostError` and the loop `continue`s (another worker took it).
- **Two runtimes, one queue:** the standalone worker (`npm run oa:worker`) and an **inline detached drain** in the Next.js process (`kickOfficeActionJobsInline`). The lease makes them safe side by side. Inline drain is enabled by `NEXT_RUNTIME` (i.e. the web server only) and forced/disabled via `OA_INLINE_JOBS` — standalone scripts and tests must own their queue explicitly, or a detached drain with production deps would race them.
- **Retry:** backoff `[1m, 5m, 15m]`, `maxAttempts` default 3, then `FAILED`.
- **Credential lifetime — a real bug fixed here.** A prepare run is minutes to an hour of gateway calls, and the default 15-minute session JWT expired mid-run, failing every subsequent stage with *"Unable to resolve tenant context"*. `withFreshAuth` now mints a **90-minute** internal JWT and **re-mints every 10 minutes**, mutating the shared `headers` object in place so the refresh reaches calls already in flight down the pipeline.
- **Outcome mail** (`notifyPrepareOutcome`) is sent only by the worker that actually recorded the result (`written.count === 1`), so a lease handover cannot double-notify; only on real completion or final failure (not on a retry, not on a pause). It carries the soonest live deadline, because the clock keeps running whether or not the run succeeded.

---

## 11. Attorney-in-the-loop surfaces

The workspace (`/office-actions/[caseId]`) is three zones: **deadline strip** (always visible) · **objection rail** (left) · **workbench** with four tabs — *Objection / Evidence / Strategy / Draft* — plus a resizable docked **source viewer** for the report and cited documents.

Gates and edits:

- `PATCH /:caseId/objections` — confirm or dismiss an objection card. Dismissed objections are excluded from the run and from lint coverage.
- `PATCH /:caseId/draft` — edit section text, approve/un-approve, edit named sections, tick the forms checklist, set agent name/reg-no, and control amended claims (remove / edit / add). **Any text edit re-opens approval** (`approved = false`) — an edited section must be re-read before export. Approval is mirrored onto `OaObjection.status` (`DRAFTED` / `APPROVED`) to drive the rail's chips.
- `POST /:caseId/draft` — **redraft one section with the attorney's direction**. One LLM call (`maxDuration = 300`). The model is given the *current* section text plus the attorney's remark, positioned last (closest to the task) and framed as binding: *follow it exactly, keep what works, stay within the supplied evidence and authorities, and if it can't be done on this record, say so plainly instead of inventing support*. The remark is stored on the section (`attorneyRemarks`) as the record of why the wording changed. The result always comes back **unapproved** — it has not been read yet. The caller's own `authorization` header is forwarded so the redraft meters against the same tenant.

Every route enforces: authenticate → **case ownership** (`oaCase.userId === auth.user.id`) → `enforceServiceAccess(..., 'OFFICE_ACTION_RESPONSE')` for the paid operations (prepare, redraft, export, citations).

---

## 12. How to extend

**Add a jurisdiction.** Author `officeActionProfile` in `Countries/<CODE>.json` → `validateOfficeActionProfile` must pass → `computeOaReadiness` must have no `fail` → `npm run oa:sync-profile <CODE>` → activate. **Zero code changes.** Minimum viable profile: ≥1 instrument with `detectionHints`, ≥1 deadline rule, `NOVELTY` + `INVENTIVE_STEP` mapped, `amendments.scopeRule`, ≥3 skeleton sections, and `OA_CLASSIFY` + `OA_DRAFT_SECTION` prompt overlays.

**Add a pipeline stage.** Add the code to `OaStageCode` + `GLOBAL_STAGE_INSTRUCTION` + `STAGE_PROMPT_KEY`, seed the `WorkflowStage` row (`Seed/seed-llm-models.js`), write the stage module as `LLM call → deterministic guard → typed result`, and call it from `reply-pipeline` **inside the per-objection try/catch**.

**Add a deterministic check.** Prefer a `compliance-lint` check (blocking, visible, testable) over a prompt instruction.

### Invariants to preserve

1. No country-code branch anywhere in `src/lib/office-action/`.
2. All LLM calls go through `runOaStage`. No direct gateway calls.
3. `runOaStage` failures stay data. Never let a stage failure throw past the per-objection boundary.
4. Persist after every objection; never widen the unit of loss.
5. Never persist an empty digest.
6. Never let `newMatterSafe = false` material reach amendment-basis retrieval.
7. Never surface `resolvedVia` or any retrieval-provider wording to the attorney.
8. Never let a model assert that a form, annexure, or approval was filed.
9. Never render a raw `¶` marker into a filed document.
10. Every guarded write on a status-bearing row keeps its status predicate (`updateMany`, not `update`).

---

## 13. Current state

Working tree (uncommitted at time of writing): `draft/route.ts`, `[caseId]/page.tsx`, `citation-resolver.ts`, `reply-pipeline.ts`, `response-drafter.ts` — the redraft-with-remarks flow and the pause/resume refinements.

Declared-but-unused stages: `OA_ARGUMENT` (folded into `OA_DRAFT_SECTION`) and `OA_COMPLIANCE_REVIEW` (compliance is deterministic). Both remain wired in the runner so a profile can adopt them without engine changes.

Jurisdiction coverage: **IN** is the implemented profile (Section 59 basis guard, Rule 24B deadlines, s.3(d)/3(k) sub-clauses, Form 3/s.8 procedural track). The schema already models the deadline shapes for US/EP/AU/NZ/UK (`PER_REPORT` / `ACCEPTANCE_CLOCK` / `HYBRID`); those profiles are authoring work, not engineering work.
