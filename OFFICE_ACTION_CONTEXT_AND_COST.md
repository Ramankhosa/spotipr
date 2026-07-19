# Office Action Studio — Invention Context & Cost Architecture
### How the attorney provides the invention, adds supplementary evidence, and how we keep LLM cost bounded

**Status:** Design · **Date:** 18 July 2026 · **Companion to:** `OFFICE_ACTION_STUDIO_PRODUCT_PLAN.md`, `OFFICE_ACTION_UX_DESIGN.md`

---

## 1. The problem

To draft a good FER reply the system must *understand the invention* — the full specification and claims, plus any supplementary material the attorney wants used (efficacy data, declarations, extra prior-art distinctions). But a full patent specification is **20,000–80,000 tokens**. The naïve approach — send the whole spec to every objection's every stage — is what makes an office-action tool expensive:

> 6 objections × 3 generative stages × ~50k-token spec ≈ **900k input tokens per case**, before citations or revisions. At reasoning-model rates that is a few dollars *per case* spent re-reading the same document, multiplied by every Auto run and every revision.

The whole design below exists to make the invention context **paid for once and reused**, so per-case generation cost is dominated by output, not by re-reading inputs.

**Guiding principle: index once, retrieve per-need.** Read the full invention exactly once (to index + distill); after that, every stage sees a small, relevant slice — never the whole document again.

---

## 2. How the attorney provides the invention

Three sources, one normalized result. Intake is a required step before drafting (the workbench warns until the invention is provided — the s.59 basis finder and amendment guard cannot work without it).

| Source | Flow | Cost |
|---|---|---|
| **Import from a spotipr draft** | If the case links a `patentId`, pull the already-structured sections (title, field, background, summary, detailed description, claims, abstract) and the existing idea normalization straight from the drafting tables. | **Zero LLM** — sections and paragraph structure already exist. The ideal path. |
| **Upload DOCX / PDF** | DOCX: split by heading styles into canonical sections (deterministic). PDF: `pdftotext` + the same section heuristics used for FERs, plus the furniture cleaner. | Zero LLM for structure; embedding only. |
| **Paste** | Spec + claims pasted into two fields for quick matters. | Zero LLM for structure; embedding only. |

### 2.1 Normalization at intake (all deterministic — no LLM)
1. **Section split** into canonical keys (reusing the superset section vocabulary: `field`, `background`, `summary`, `detailedDescription`, `claims`, `abstract`, …).
2. **Paragraph numbering** with stable IDs `¶0001, ¶0002 …`. This is not cosmetic: Indian FERs demand amendment basis "by page number and line number of the original specification" (see the real FER's PART-II §B(6)/PART-III), and the s.59 guard cites these IDs. The basis chips in the UI *are* these paragraph IDs.
3. **Claim parsing**: independent + dependent claims split, each into **claim elements** (the rows of the claim chart). Done once; every objection's chart reuses them.
4. **Chunking**: paragraphs grouped into ~300–500-token chunks with overlap, each retaining its `sectionRef` (¶ range) so a retrieved chunk always carries a citable location.

### 2.2 Embed once
Every chunk is embedded **once** at intake via the existing `requestCorpusEmbedding()` (Voyage/OpenAI, already wired) and stored in `OaDocumentChunk.embedding` (pgvector). Embedding is 2–3 orders of magnitude cheaper than generation (~$0.02–0.12 per M tokens vs $2.5–15), so indexing a whole spec costs a fraction of a cent and is never repeated.

---

## 3. Supplementary material

The attorney can upload documents they want *used in the reply* — the "here's what I'd argue with" pile:

- comparative efficacy / experimental data (for s.3(d)/(e), sufficiency),
- expert declarations / affidavits (Rule 137),
- additional prior-art distinctions or teaching-away references,
- technical notes, figures, tables.

Each supplementary document carries attorney-supplied metadata:
- **Intent note** — free text: *"Comparative efficacy vs D1–D3 Ru complexes — use for the 3(d)/3(e) objection."* This note is fed to the drafter so the material is used the way the attorney intends.
- **Target objections** — optional: which objection card(s) it applies to (drives retrieval scoping and shows the doc on those cards).

### 3.1 The new-matter guard (legal correctness, not just cost)
Supplementary material is tagged `newMatterSafe = false` by default. Consequences, enforced in code:
- It may be used in **arguments/remarks** and flagged for an **affidavit/declaration** (Rule 137) — *labelled as post-filing evidence*.
- It is **never** offered as **amendment basis**: the s.59 basis finder searches only the **as-filed specification** chunks (`kind = SPECIFICATION`, `newMatterSafe = true`). An amendment can never silently draw support from post-filing data.

This mirrors the plan's structural anti-hallucination stance: the guard is a query filter, not a prompt request.

---

## 4. Cost architecture — seven levers

Ordered by impact. Together they turn the ~900k-token naïve case into a **~40–70k-token** case.

### Lever 1 — The invention digest (pay for "understanding" once)
A single LLM pass over the full spec at intake produces a compact, reusable **invention digest** (~1–2k tokens): problem, solution, key technical features, the technical-advance / efficacy statements with their ¶ locations, and the independent-claim element breakdown. Every objection's strategy/argument/draft stage receives **the digest**, not the spec. The cost of "understanding the invention" is paid **once per case**, not once per objection.
- If imported from a spotipr draft, the digest is largely pre-computed from the existing idea normalization → cheaper still.
- The digest stores *pointers* (¶ IDs), so any claim in it is one click from its source.

### Lever 2 — Retrieval instead of full-text (the big multiplier)
When a stage needs specification detail beyond the digest — the basis finder, the technical-advance evidence for inventive step, the efficacy passages for 3(d) — it runs a **top-K semantic search** over the case chunks (query built from the objection text + affected claim elements + canonical code) and injects only the **6–10 most relevant paragraphs (~2–4k tokens)**. The 50k-token spec is never resent.

### Lever 3 — The examiner already did the pinpointing
The PART-II citation table gives, per cited document, the examiner's own **"Relevant description (page and paragraph)"** and the **claims it's applied against** (we capture these into `OaCitation.examinerSeed`). So the claim chart and citation analysis start from the examiner's pinpoints — we **fetch and read full cited-document text (paid SerpApi) only when the attorney disputes an AMBIGUOUS cell**, not for every reference. Most citations never need a full-text fetch.

### Lever 4 — Model tiering (already wired)
The per-plan stage configs already route cheap models (Gemini flash-lite) to parse/classify/chunk/retrieval-query, and reasoning models (GPT-5.6/Opus-thinking) only to strategy/argument. Reinforced by the architecture: **the expensive model only ever sees the digest + retrieved chunks + the objection** — never a raw document — so even the premium stages have small inputs.

### Lever 5 — Cache everything derivable
Parse, classify, digest, embeddings, and the claim chart are computed once and stored (`parsedJson`, `inventionDigest`, chunks, `claimChartJson`). Re-runs and single-section revisions reuse them; only the regenerated section re-calls the LLM. Additionally, the digest + jurisdiction prompt form a **stable prompt prefix** across a case's objections → provider **prompt caching** (Anthropic/OpenAI) discounts the shared prefix on every subsequent objection.

### Lever 6 — Lazy per-objection (don't pay for what isn't opened)
Only **Auto mode** runs all objections eagerly. In **Balanced/Manual**, per-objection strategy/argument/draft runs **when the attorney opens that objection** — the shared digest + chart are already built, so opening an objection is one small call. Formulaic objections (clarity, Form 3) use the cheapest model and often a template with retrieved basis, not a full reasoning pass.

### Lever 7 — Budget guardrails + visibility
- Hard caps as profile/config constants: `retrieval.topK`, `retrieval.maxContextTokens`, `digest.maxTokens`.
- A per-case **token/cost estimate** shown before an Auto run ("≈ 46k tokens ≈ ₹X") and a running total in the workspace — powered by the existing metering, gated by the existing quota.
- Everything routes through `llmGateway.executeLLMOperation` so per-stage usage is metered and quota-enforced exactly as elsewhere.

### Illustrative budget (one 6-objection case, ~50k-token spec)
| Item | Naïve | This architecture |
|---|---|---|
| Understand invention | 50k × 6 obj × 3 stages = 900k | digest once ≈ 55k in / 2k out |
| Per-objection generation | (included above) | 6 × (digest 2k + retrieved 3k + objection 1k) ≈ 36k in |
| Citations | full text × N always | examiner pinpoints; full fetch on-demand only |
| Embedding | — | whole spec once ≈ <$0.01 |
| **Input tokens/case** | **~900k+** | **~90–100k** *(≈ 90% reduction)*, most cacheable |

---

## 5. Data model (additions)

```prisma
model OaCaseDocument {
  id            String   @id @default(cuid())
  caseId        String
  kind          String   // SPECIFICATION | CLAIMS | DRAWINGS | SUPPLEMENTARY
  source        String   // UPLOAD | SPOTIPR_PROJECT | PASTE
  title         String?
  fileKey       String?
  text          String?  // normalized full text (spec/claims)
  sectionsJson  Json?    // canonical-section → paragraph-id ranges
  intentNote    String?  // attorney's instruction (supplementary)
  targetCodes   Json?    // canonical objection codes this doc serves
  newMatterSafe Boolean  @default(false) // true only for as-filed spec/claims
  indexStatus   String   @default("PENDING") // PENDING | INDEXED | FAILED
  createdAt     DateTime @default(now())
  chunks        OaDocumentChunk[]
}

model OaDocumentChunk {
  id          String  @id @default(cuid())
  caseId      String
  documentId  String
  kind        String  // mirrors the document kind (for retrieval filters)
  sectionRef  String? // e.g. "¶0038–¶0041"
  text        String
  tokenCount  Int
  // pgvector column added by migration (mirrors LocalPatentEmbedding pattern)
  document    OaCaseDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
}
```
`OfficeActionCase` gains `inventionDigest Json?`.

Retrieval filters on `newMatterSafe`/`kind`, so the s.59 basis finder can restrict to as-filed spec chunks in one query.

---

## 6. Services (src/lib/office-action/)

- `document-intake.ts` — deterministic: `splitParagraphs()` (stable ¶ IDs), `splitSections()`, `parseClaimElements()`, `chunkParagraphs()`, `estimateTokens()`. No LLM.
- `invention-digest.ts` — `buildInventionDigest()` via `runOaStage` (one call, cheap-to-mid model), returns the typed digest; cached on the case.
- `context-budget.ts` — `retrieveContext({caseId, query, kind?, topK, maxTokens})` (embeds the query once, pgvector cosine search over chunks, packs to the token cap) + `estimateCaseCost()`.
- Integration points: embeddings via `requestCorpusEmbedding()`; vector search via a raw pgvector query mirroring `patent-corpus-service`.

---

## 7. UI additions (see mockup)

- **Intake step "Provide the invention"** — three source tiles (Import from draft / Upload / Paste), then an extracted-sections summary with paragraph count and an "Indexed ✓" state. Blocks amendment features until present.
- **Case Evidence panel** — drop supplementary files, add an intent note, tag target objections; a visible **"argument/affidavit only — not amendment basis"** marker on `newMatterSafe = false` docs. These surface in the Evidence tab and the ledger.
- **Cost meter** — a compact token/₹ estimate in the deadline strip; the Auto-run confirm shows the pre-flight estimate.

---

## 8. Build order

- **CI-1:** schema + migration · `document-intake` deterministic split/chunk/estimate + self-test · intake UI (paste + upload) · paragraph IDs feeding the s.59 basis chips.
- **CI-2:** embed-once via `requestCorpusEmbedding` + `retrieveContext` pgvector search · `buildInventionDigest` · wire digest+retrieval into strategy/argument/draft stages (replace any full-spec passing).
- **CI-3:** supplementary uploads + intent tags + new-matter guard in the basis finder · import-from-spotipr-draft path · cost meter + pre-flight estimate.
