# Office Action Studio — Product Plan
### A jurisdiction-profile-driven FER / Office Action response engine

**Status:** Proposal (research-backed) · **Date:** 17 July 2026 · **Target repo:** spotipr
**Working name:** *Office Action Studio* (module family: Prior-Art Studio, Diagram Studio). India-facing label: **FER Response Studio**.

---

## 1. Executive summary

Every patent application that survives filing hits the same wall: the examiner's objection letter — **FER** in India, **Office Action** in the US, **Communication under Art. 94(3)** at the EPO. Responding is the highest-volume, most deadline-critical, most formulaic-yet-judgment-heavy task in patent prosecution. India crossed **92k filings in FY2023-24** while examinations collapsed to 18.4k (examiner strength fell 593 → 219; 407 new examiners inducted Jan 2025) — a backlog that guarantees a multi-year **FER wave**. And in the largest published study of Indian outcomes, roughly two-thirds of applications that failed died by withdrawal or *deemed abandonment*, not refusal — a missed deadline, not a lost argument.

We will build a response engine where **everything jurisdiction-specific lives in an uploadable JSON profile** — objection taxonomy mapped to local statute, deadline arithmetic, amendment-format rules, doctrine frameworks (problem–solution for EP, Graham/KSR for US, technical-advance for India), response-document skeleton, and per-stage prompt overlays. The pipeline (parse → classify objections → resolve citations → analyze → strategize → draft → comply → export) is jurisdiction-agnostic; adding a country = authoring + validating + activating a profile in the existing super-admin jurisdictions hub — **exactly how patent-drafting jurisdictions work in spotipr today**.

Market research confirms the gap: Solve Intelligence, DeepIP, Patlytics, PowerPatent, XLSCOUT and &AI all sell OA-response drafting, but all are US-first with EP secondary, none are declaratively profile-driven, and **no one covers India's FER + hearing practice properly**. India is our beachhead; the profile architecture is the moat.

---

## 2. What the research says (the problem)

### 2.1 India — the beachhead market

| Pain point | Evidence / detail |
|---|---|
| **Deadline brutality** | FER reply due **6 months** from FER *issuance* date, extendable **+3 months** via Form 4 (Rule 24B(5)–(6)); post-2024 Rules the Form 4 request is filable **any time within 9 months of the FER date**. Miss it → **deemed abandoned u/s 21(1)**, no statutory revival (writ only). Separate sub-deadline: updated **Form 3 (s.8) within 3 months of FER issuance** (2024 Rules). Rule 138 general condonation (up to 6 months, ₹10k–50k/month) exists but its interplay with 24B is contested — treat 9 months as the hard outer limit. |
| **Boilerplate objections** | Examiner disposal targets produce templated, copy-paste FERs — objections cite D1–D6 with thin reasoning. Delhi HC has rebuked the IPO for "cut-paste" refusal orders (BlackBerry) and called non-speaking orders an "endemic problem"; Bombay HC (2026) again ordered reasoned refusals. Replies must reverse-engineer what the examiner actually means. |
| **Boilerplate replies → hearings** | Superficial agent-drafted replies trigger subsequent exam reports and s.14 hearings. Hearing notices can arrive with as little as **10 days'** notice (Rule 129; FICPI protested the 2022 cut); adjournments: max **2**, each ≤30 days, requested ≥3 days prior (Rule 28(6)); written submissions due **15 days** after hearing (Rule 28(7)) and **cannot introduce new arguments** (DHC). The reply's quality determines whether prosecution ends in one round or three. |
| **3(k)/3(d) unpredictability** | Software (s.3(k), CRI Guidelines — 2025 draft published Mar 2025) and pharma (s.3(d), Novartis efficacy standard) objections are the least consistent, most argument-sensitive category. |
| **s.8 / Form 3 trap** | Foreign-filing disclosure objections are among the *most common* formal objections; 2024 Rules relaxed the regime (once at RQ + updates on Controller direction) but legacy objections persist. |
| **Cost pressure** | ₹30k–80k per FER response at firms. Startups/SMEs — the segment Indian patent policy is trying to grow — feel it most. |
| **2024 Rules compression** | RQ deadline cut to 31 months → examination arrives earlier in a startup's life, with less budget and less prior-art awareness. |

### 2.2 US

- Non-final → final → **RCE treadmill**; AFCP 2.0 **terminated Dec 14, 2024**, narrowing after-final options to 37 CFR 1.116 amendments, interviews, RCE, appeal.
- 3-month shortened statutory period, extendable to 6 with escalating fees (37 CFR 1.136(a)) — deadline arithmetic is fee arithmetic.
- §101 eligibility remains the top unpredictability complaint (July 2024 USPTO eligibility + AI guidance); hindsight §103 combinations a close second; examiner variance is so notorious that analytics products (Juristat, PatentBots) exist just to price it. An issued US patent averages ~4.2 office actions.
- $1.5k–5k typical attorney cost per response; amendment formatting is rigid (37 CFR 1.121 status identifiers + underline/strikethrough — get it wrong and you draw a Notice of Non-Compliant Amendment), which is why "shell automation" (ClaimMaster, Rowan, Juristat OAR) is an entire product category.
- Interviews move outcomes (~10-point allowance lift per Juristat; ~95% post-interview win rate under the FY26 examiner appraisal plan) — responses should always carry an interview recommendation.
- **Bootstrap asset:** USPTO Office Action Research Dataset (bulk, 2008–2017, per-OA rejection labels incl. Alice flags) + the new Open Data Portal **Patent File Wrapper API** for current documents (the legacy ODP rejection-label APIs were decommissioned Jan 2026, so recent labels are self-derived from raw OA text — exactly what our classifier does anyway). USPTO's April 2024 AI-practice guidance makes *verifying* AI-drafted content a professional duty (37 CFR 11.18(b)) — our anchor-everything guardrails are the compliance story, not just a quality feature.

### 2.3 EPO

- Art. 94(3) communications; ~4-month response, extendable to 6 (Rule 132); further processing (Art. 121) as paid safety net.
- **Problem–solution approach is mandatory doctrine** — a reply that doesn't argue closest-prior-art → objective technical problem → could/would is malformed. This is a *generatable structure*.
- **Art. 123(2) added matter** ("directly and unambiguously derivable", the G 2/10 gold standard) is the #1 trap for foreign-drafted applications — intermediate generalization kills amendments, and 123(2)/123(3) form an "inescapable trap" post-grant. Rule 137(4): every amendment must indicate its basis in the application as filed; Rule 137(3): later amendment rounds need Examining Division consent.
- Description-conformity amendments are before the Enlarged Board right now (G 1/25 pending as of July 2026; G 1/24, June 2025, already made the description central to claim interpretation) — the rules will shift, which is precisely why profiles are versioned data.
- Deadline-engine detail: the 10-day notification rule was abolished Nov 2023 — EPO periods now run from the document date.

### 2.4 Other offices (encode later, trivially, via profiles)

| Office | First response period | Quirk |
|---|---|---|
| CNIPA (CN) | 4 months (subsequent: 2) | +2-month extension; 15-day mailing buffer abolished for e-filings (2024) |
| JPO (JP) | 60 days domestic / 3 months overseas | Extendable (+3 months for foreign applicants) |
| KIPO / MOIP (KR) | 4 months (raised from 2, July 2025) | Extendable to 8 in 1-month steps; office renamed MOIP |
| UKIPO (GB) | ~4 months | Hard s.20 compliance deadline: 4.5 yrs from priority or 12 mo from first report |
| CIPO (CA) | 4 months (extendable to 6) | Examination stops after 3 OAs — RCE + fee to continue (2022 rules) |

### 2.5 Market gap

The funded platforms — Solve Intelligence (YC), DeepIP ($40M raised, 400+ firms), Patlytics ($40M, self-described "optimized for U.S." with EP "expanding"), PowerPatent, &AI — plus the US shell-automation heritage (ClaimMaster, Rowan/Clarivate, Juristat OAR, LexisNexis PatentOptimizer) all hard-code US practice, with EPO second at best. None expose a declarative jurisdiction layer, and examiner analytics remain US-only and un-fused from drafting. **No dedicated AI FER-response tool exists for India** — that market is served by human LPO services, and even Dolcera (Hyderabad) ships its IP Author OA module for USPTO/EPO only. Nobody combines jurisdiction-specific argument doctrine (KSR vs problem–solution vs s.2(1)(ja)/s.3) in one drafting engine. **Profile-driven multi-office response drafting is unoccupied territory, and India is its emptiest, largest corner.**

---

## 3. Product principles

1. **Jurisdiction logic is data, not code.** If adding Brazil requires a deploy, we failed. Adding a jurisdiction = upload profile JSON → validation → readiness score → activate (identical lifecycle to drafting profiles today).
2. **Attorney-in-the-loop, never auto-file.** Every pipeline stage produces reviewable artifacts (objection cards, claim charts, strategy choices, draft sections). The attorney approves each gate. We draft; they decide. This is also the UPL / liability posture.
3. **Every assertion is anchored.** Examiner quotes must string-match the parsed OA. Citation passages must string-match the fetched document. Claim amendments must cite paragraph-level spec basis (the Art. 123(2) / s.59 guard). Case law only from the profile's whitelist. No anchor → no sentence.
4. **The deadline is a first-class object.** Due dates, extension options, fees, and consequences are computed from the profile the moment a document is ingested — shown always, everywhere.
5. **One canonical pipeline, many local skins.** Canonical objection codes internally; local statute labels, doctrine frameworks, and document formats at the edges.

---

## 4. The Jurisdiction OA Profile (JSON spec)

A new `officeActionProfile` block inside the per-country profile JSON (`Countries/*.json`, stored in `CountryProfile.profileData`), alongside the drafting blocks (`meta / structure / rules / validation / prompts / export`). Validation extends `country-profile-validation.ts` (zod), import extends `country-import-service.ts` (plan/apply, transactional), readiness extends `country-readiness-service.ts` — so a jurisdiction can be drafting-enabled, OA-enabled, or both, each with its own readiness score.

```jsonc
{
  "officeActionProfile": {
    "profileVersion": "1.0",
    "meta": {
      "code": "IN", "office": "IPO (CGPDTM)",
      "moduleLabel": "FER Response",                    // UI label per jurisdiction
      "languages": ["en"], "lawVersion": "Patents Act 1970 + 2024 Amendment Rules",
      "reviewedOn": "2026-07-17", "status": "draft"     // draft → active, like drafting profiles
    },

    // 1. What the office sends us — detection + metadata extraction per instrument
    "instruments": [
      { "id": "FER", "label": "First Examination Report",
        "detectionHints": ["FIRST EXAMINATION REPORT", "u/s 12 & 13"],
        "extractFields": ["applicationNumber", "dateOfReport", "examinerName", "citedDocuments"] },
      { "id": "SER",           "label": "Subsequent Examination Report" },
      { "id": "HEARING_NOTICE","label": "Hearing Notice u/s 14" }
    ],

    // 2. Deadline arithmetic — computed at ingest, displayed everywhere
    "timeline": {
      "deadlines": [
        { "instrument": "FER", "trigger": "dateOfReport", "period": "P6M",
          "extension": { "period": "P3M", "form": "Form 4", "feePerMonth": {"individual": 1000, "large": 4000},
                         "requestWindow": "P9M" },      // 2024 Rules: Form 4 filable any time within 9 months of FER date
          "consequence": { "type": "DEEMED_ABANDONED", "basis": "Section 21(1)", "revivable": false } },
        { "instrument": "FER", "trigger": "dateOfReport", "period": "P3M",
          "what": "updated Form 3 (s.8 foreign filings)", "basis": "2024 Rules" },
        { "instrument": "HEARING_NOTICE", "trigger": "hearingDate", "period": "P15D",
          "what": "written submissions", "basis": "Rule 28(7)" }
      ]
    },

    // 3. Objection taxonomy — canonical code ↔ local law, with per-type playbooks
    "objections": [
      { "canonical": "NOVELTY", "localLabel": "Lack of novelty",
        "legalBasis": ["s.2(1)(j)", "s.13"], "citationDriven": true,
        "detectionHints": ["not novel", "lacks novelty", "anticipated by"],
        "strategies": ["DISTINGUISH_ART", "AMEND_CLAIMS", "BOTH"],
        "argumentSkeleton": "For each cited document: identify the claim feature absent from it; quote the citation passage the examiner relied on; state the technical difference and its effect.",
        "caseLawWhitelist": [{ "name": "Lallubhai Chakubhai v. Chimanlal", "point": "novelty = single-document whole-disclosure test" }] },
      { "canonical": "INVENTIVE_STEP", "legalBasis": ["s.2(1)(ja)"],
        "doctrine": "TECHNICAL_ADVANCE_IN",             // → doctrines block below
        "caseLawWhitelist": [{ "name": "F. Hoffmann-La Roche v. Cipla" }, { "name": "Avery Dennison v. Controller" }] },
      { "canonical": "ELIGIBILITY", "localLabel": "Non-patentable subject matter",
        "legalBasis": ["s.3"], 
        "subTypes": [
          { "id": "3k", "basis": "s.3(k)", "guidance": "CRI Guidelines: argue technical effect/contribution; hardware interplay; avoid 'per se'." },
          { "id": "3d", "basis": "s.3(d)", "guidance": "Enhanced-efficacy data per Novartis; therapeutic efficacy for pharma." } ] },
      { "canonical": "SUFFICIENCY",  "legalBasis": ["s.10(4)"] },
      { "canonical": "CLARITY",      "legalBasis": ["s.10(4)(c)", "s.10(5)"] },
      { "canonical": "UNITY",        "legalBasis": ["s.10(5)"] },
      { "canonical": "PROCEDURAL_DISCLOSURE", "localLabel": "Details of corresponding foreign applications",
        "legalBasis": ["s.8", "Rule 12"], "responseType": "PROCEDURAL",
        "actions": ["File updated Form 3", "Note 2024 Rules: once at RQ + on direction"] },
      { "canonical": "FORMALITIES", "legalBasis": ["various"], "responseType": "PROCEDURAL" }
    ],

    // 4. Doctrine frameworks — named argumentation structures the drafter must follow
    "doctrines": {
      "TECHNICAL_ADVANCE_IN": {
        "steps": ["identify feature over closest art", "technical advance or economic significance", "not obvious to PSITA"],
        "styleNotes": "Track s.2(1)(ja) wording explicitly." },
      "PROBLEM_SOLUTION_EP": { "steps": ["closest prior art", "distinguishing features + technical effect", "objective technical problem", "could-would analysis"] },
      "GRAHAM_KSR_US": { "steps": ["scope/content of art", "differences", "level of skill", "secondary considerations", "motivation-to-combine rebuttal"] }
    },

    // 5. Amendment rules — the added-matter guard, per jurisdiction
    "amendments": {
      "legalBasis": ["s.57", "s.59"],
      "scopeRule": "Only disclaimer, correction or explanation; must fall within scope of original claims/spec.",
      "basisRequired": true,                            // every amendment must cite spec paragraph support
      "voluntaryForm": { "form": "Form 13", "requiredForFerReply": false },
      "format": { "markedCopy": true, "cleanCopy": true, "markStyle": "underline-strikethrough" }
    },

    // 6. Citation conventions — how the office writes references
    "citations": { "labels": "D1, D2, …", "patentNumberFormats": ["US\\d+", "EP\\d+", "WO\\d{4}/\\d+", "IN\\d+"], "nplAllowed": true },

    // 7. Response document — skeleton the generator must fill, in order
    "response": {
      "skeleton": ["addressBlock", "subjectLine", "preliminarySubmissions", "objectionWiseReply",
                   "amendedClaimsMarked", "amendedClaimsClean", "conclusionAndPrayer", "signatureBlock"],
      "tone": "formal-respectful",
      "phrases": { "opening": "With reference to the First Examination Report dated {date}…",
                   "prayer": "…the Applicant respectfully requests that the application be found in order for grant. Should any objection remain outstanding, an opportunity of being heard u/s 14 is respectfully requested." },
      "export": { "formats": ["docx", "pdf"], "headingStyle": "…" }
    },

    // 8. Hearing / oral stage (IN: s.14 hearing; EP: oral proceedings; US: examiner interview)
    "hearing": { "available": true, "trigger": "objections outstanding after reply",
                 "writtenSubmissionsAfter": "P15D",     // Rule 28(7); DHC: no new arguments in written submissions
                 "adjournment": { "requestBefore": "P3D", "max": 2, "eachUpTo": "P30D", "basis": "Rule 28(6)" },
                 "guidance": "Address only objections maintained in the hearing notice; annex proposed amendments." },

    // 9. Per-pipeline-stage LLM prompt overlays (merged by prompt-merger like drafting stages)
    "prompts": {
      "OA_PARSE": "…", "OA_CLASSIFY": "…", "OA_CLAIM_CHART": "…",
      "OA_ARGUE": { "NOVELTY": "…", "INVENTIVE_STEP": "…", "ELIGIBILITY.3k": "…" },
      "OA_DRAFT_SECTION": { "preliminarySubmissions": "…", "objectionWiseReply": "…" }
    },

    // 10. Activation gates — mirrors drafting-profile readiness
    "readiness": {
      "required": ["instruments", "timeline.deadlines", "objections[NOVELTY,INVENTIVE_STEP]",
                   "amendments", "response.skeleton", "prompts.OA_CLASSIFY", "prompts.OA_DRAFT_SECTION"],
      "recommended": ["doctrines", "caseLawWhitelist", "hearing"]
    }
  }
}
```

**Design notes**
- Canonical codes (`NOVELTY`, `INVENTIVE_STEP`, `ELIGIBILITY`, `CLARITY`, `SUFFICIENCY`, `UNITY`, `ADDED_MATTER`, `DOUBLE_PATENTING`, `PROCEDURAL_DISCLOSURE`, `FORMALITIES`, `OTHER`) keep the pipeline, analytics, and metering jurisdiction-agnostic.
- `detectionHints` seed the classifier; the LLM does the heavy lifting, hints anchor it and let profiles tune recall per office's boilerplate.
- Case-law whitelists are the *only* citations the drafter may make to authority — the anti-hallucination rule is structural, not prompt-hoped.
- Profiles are versioned (`lawVersion`, `reviewedOn`) because practice drifts (AFCP death, 2024 India Rules, EPO description-conformity).

---

## 5. The pipeline (one canonical flow, six stages)

Presented in the workspace as vertical stages, exactly like the drafting workspace.

```
1. INTAKE            Upload FER/OA PDF (+ as-filed spec & claims, or link an existing
                     spotipr draft project). Parse/OCR → instrument detection → metadata
                     extraction → deadline computation (due date, extension options, fees,
                     consequence banner). Job pattern: DB row + polling, like novelty search.

2. OBJECTION MAP     LLM extraction → objection cards: canonical code, local basis,
                     examiner's verbatim text (string-match verified), claims affected,
                     citations referenced. Attorney reviews/edits/merges cards. Nothing
                     proceeds until cards are confirmed.  ← human gate #1

3. CITATION          Resolve D1…Dn: LocalPatent corpus lookup by normalized publication
   WORKBENCH         number, then the existing patent-search provider fan-out (google-
                     patents, EPO OPS, PQAI, indian-corpus) for misses; NPL flagged for
                     manual upload. Pinpoint the
                     passages the examiner relied on (embeddings + LLM, string-anchored).
                     Output: claim charts — claim features × citations, with per-feature
                     disclosed / not-disclosed / ambiguous calls.

4. STRATEGY BOARD    Per objection: assessment of examiner position strength + options
                     (argue / amend / both) with tradeoffs. For amendments: proposed claim
                     language with SPEC-BASIS FINDER — every inserted feature must carry a
                     paragraph citation from the as-filed spec (embeddings search + verify).
                     Added-matter guard runs the profile's scope rule (s.59 / Art.123(2) /
                     112). Attorney selects strategy per objection.  ← human gate #2

5. DRAFT             Generate the response per profile skeleton: preliminary submissions,
                     objection-wise replies (each following the mapped doctrine framework),
                     amended claims in marked + clean copies (format from profile),
                     conclusion/prayer with hearing request per profile phrasing.
                     Section-by-section regeneration + inline editing, like Draft One.

6. COMPLY & EXPORT   Deterministic lint: every objection addressed? every amendment has
                     basis? every quote string-matches source? marked/clean copies
                     consistent? forms & fees checklist (Form 4? updated Form 3? POA?).
                     DOCX/PDF export via existing exporters.  ← human gate #3 (download)
```

**India add-on (Phase 1.5):** Hearing mode — upload hearing notice → diff which objections are maintained → written-submissions draft (15-day Rule 28(7) clock shown) reusing stages 2–6 in "maintained objections only" scope.

---

## 6. Trust & verification guardrails (the actual product)

Research shows the #1 criticism of AI OA tools is confident garbage: invented case law, generic arguments, amendments with no basis. Our guardrails are deterministic code, not prompt instructions:

| Guardrail | Mechanism |
|---|---|
| Quote fidelity | Every examiner/citation quote must exact-substring-match the parsed source; failing quotes render with a red flag and block export. |
| Amendment basis | Claim-diff extractor finds every added token span → each must map to a cited spec paragraph verified by string/semantic match; unverified basis blocks the amendment card. |
| Added matter | Profile scope rule runs as a dedicated LLM+rules check with the diff and cited basis; verdict shown on the card (pass / risk / fail). |
| Coverage | Export lint fails if any confirmed objection card lacks a response section. |
| Authority whitelist | Case law/citations to authority may only come from the profile whitelist; anything else is stripped + flagged. |
| Never auto-file | Product ends at a reviewed DOCX. Filing stays human. |

---

## 7. Architecture & data model (reuse map)

Everything below plugs into infrastructure that already exists in spotipr.

### 7.1 New Prisma models

```prisma
model OfficeActionCase {        // one prosecution matter (per application per jurisdiction)
  id, tenantId, userId, projectId?        // optional link to a spotipr drafting project
  jurisdictionCode, applicationNumber, applicantName, title
  status            // ACTIVE | REPLIED | HEARING | CLOSED
  createdAt, updatedAt
}
model OfficeActionDocument {    // each uploaded office communication
  id, caseId, instrumentType    // FER | SER | HEARING_NOTICE | OA_NONFINAL | OA_FINAL | EP_94_3 | …
  issueDate, dueDate, extendedDueDate, deadlineJson
  fileKey, parseStatus, parsedJson        // job-pattern columns (status + progress), like NoveltySearchJob
}
model OaObjection   { id, documentId, canonicalCode, localBasis, examinerText, claimsAffected,
                      citationLabels, status, analysisJson, strategyJson, sortOrder }
model OaCitation    { id, documentId, label, docNumber, kind,          // PATENT | NPL
                      corpusDocId?, fetchStatus, fullTextKey?, passagesJson }
model OaResponseDraft { id, caseId, documentId, version, sectionsJson,
                        amendedClaimsJson, complianceJson, exportFileKey? }
```
`CountryProfile.profileData` gains the `officeActionProfile` block (zod-validated in `country-profile-validation.ts`); OA readiness computed alongside drafting readiness in `country-readiness-service.ts`. `OfficeActionJob` copies the lease/heartbeat queue fields of `PatentDraftingJob` (`status, currentStep, lockedBy, lockedUntil, heartbeatAt, attemptCount…`) and gets its own worker.

### 7.2 Reused infrastructure

| Need | Existing asset |
|---|---|
| Jurisdiction upload → validate → readiness → activate | `Countries/*.json` profiles → `country-profile-validation.ts` (zod) → `country-import-service.ts` (preview/apply, single transaction) → `country-readiness-service.ts` → `/super-admin/jurisdictions` hub. Add an "Office Action" tab + a second readiness badge; activation stays readiness-gated like drafting profiles |
| Per-stage prompt assembly | `prompt-merger-service.ts` B+T+U merge (`SupersetSection` base + `CountrySectionPrompt` jurisdiction top-up + `UserSectionInstruction`) — OA response sections join the same system |
| Stage workspace UI | Drafting workspace pattern (`src/components/drafting/*Stage` + `VerticalStageNav`); new OA stage enum + `WorkflowStage` rows seeded in `Seed/seed-llm-models.js` with per-stage `PlanStageModelConfig` |
| Cited-patent full text | `LocalPatent` (unique `publicationNumber`, trigram indexes) + `LocalPatentEmbedding` (pgvector/Voyage) for passage pinpointing & spec-basis finder; `patent-search/orchestrator.ts` provider fan-out (google-patents, **EPO OPS**, PQAI, indian-corpus) + `google-patents-claims-service.ts` for claims by pub number |
| Long-running LLM jobs | DB-backed poll queue with lease/heartbeat (`PatentDraftingJob` pattern) → `OfficeActionJob` + `scripts/office-action-worker.ts` + a progress-polling route |
| Exports | `docx` Packer + pdfkit patterns from the drafting `export_docx`/`export_pdf` action and the novelty attorney report; per-office formatting via `CountryExportConfig`; persisted as `Document` + `DocumentAccessLink` |
| Plan gating | New `FeatureCode OFFICE_ACTION_RESPONSE` (+ `ServiceType`), `Feature`/`PlanFeature` seeds, new `TaskCode` (e.g. `LLM_OA_RESPONSE`) mapped in `metering/gateway.ts getFeatureForTask()`, routes gated by `enforceServiceAccess` |
| Metering | `llmGateway.executeLLMOperation({taskCode, stageCode})` per pipeline stage — quota reservation, fail-closed model resolution (`PlanStageModelConfig`), and usage recording come free |

### 7.3 New services (src/lib/office-action/)

`oa-parser.ts` (PDF/OCR + instrument detection + metadata), `deadline-engine.ts` (profile timeline → dates/fees), `objection-classifier.ts`, `citation-resolver.ts` (corpus → external fallback), `claim-chart-service.ts`, `basis-finder.ts` (spec-support search), `added-matter-check.ts`, `response-drafter.ts` (skeleton-driven), `compliance-lint.ts`, `oa-profile-schema.ts` (zod for the profile spec + readiness calculator).

---

## 8. Jurisdiction lifecycle ("uploaded and enabled like patent drafts")

1. **Author** — start from `oa-profile-template.json` (ship next to `country-profile-template.json`).
2. **Upload** — super-admin jurisdictions hub → Office Action tab → import JSON (zod-validated, errors inline).
3. **Readiness** — computed score against `readiness.required/recommended`; gaps listed exactly like drafting readiness.
4. **Test bench** — run the profile against 3–5 sample OA PDFs stored with the profile; review classification + deadline output before activation (this is the profile author's acceptance test).
5. **Activate** — flips availability; tenant access still governed by plan/feature gating (ATI-bound).
6. **Version** — profiles carry `lawVersion`/`reviewedOn`; re-import bumps version, old cases keep the version they ran under.

---

## 9. Corpus & evaluation strategy

- **India:** entire public file wrappers (FER, replies, hearing notices, written submissions) are viewable per-application on InPASS/e-register — behind a CAPTCHA, many as scanned images. Collect a 100–300 document set semi-manually across tech domains (with an OCR pass) → (a) few-shot exemplars per objection type in the India profile, (b) held-out eval set for classifier precision/recall and draft-quality review.
- **US:** USPTO Office Action Research Dataset (bulk, 2008–2017, rejection-type labels) for classifier bootstrapping + the Open Data Portal Patent File Wrapper API for current OA documents (the legacy rejection-label APIs died Jan 2026). The academic **PatRe** benchmark (office-action + rebuttal generation) is a ready-made external eval.
- **Eval loop per jurisdiction (activation bar):** ≥95% instrument detection, ≥90% objection classification F1 on held-out docs, 100% deadline computation accuracy on synthetic date cases, attorney rubric review of 10 end-to-end drafts.

---

## 10. Rollout

| Phase | Scope | Outcome |
|---|---|---|
| **0 — Foundation** (1–2 wks) | Profile spec + zod + readiness calc + template; Prisma migration; India profile authored; INTAKE + OBJECTION MAP stages; InPASS eval set (~50 FERs) | Parse a real FER → verified objection cards + live deadline banner |
| **1 — India end-to-end** (3–5 wks) | CITATION WORKBENCH (corpus resolver + claim charts), STRATEGY (basis finder + s.59 guard), DRAFT, COMPLY & EXPORT (DOCX); feature gating + metering; workspace UI | Full FER → reviewed reply DOCX. Beachhead live |
| **1.5 — Hearing mode** (1 wk) | Hearing-notice instrument, maintained-objection diff, written-submissions draft | Covers India's full prosecution loop |
| **2 — US + EP profiles** (3–4 wks) | US profile (non-final/final flows, 1.121 amendment formatting, Graham/KSR + Alice modules, OA-dataset-bootstrapped classifier); EP profile (problem–solution generator, Rule 137(4) basis statements, strict 123(2) guard) | Three-office coverage; profile spec proven general |
| **3 — Jurisdiction SDK** (2 wks) | Authoring guide, test bench in hub, profile versioning UX | New jurisdiction without a deploy — the actual product promise |
| **4 — Intelligence layer** (ongoing) | Objection analytics across cases, examiner-pattern stats, docketing/reminder integration, CN/JP/KR with translation layer | Compounding data advantage |

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Unauthorized-practice-of-law / liability optics | Position as attorney drafting assistant; human gates at stages 2/4/6; never auto-file; disclaimer in exports; sell to practitioners and in-house teams, not pro-se filing |
| Hallucinated authority/quotes | Structural guardrails (§6) — whitelists + string-match verification, enforced in code |
| Added matter introduced by AI amendments | Basis-finder requirement + scope-rule check blocking unverified amendments |
| Legal drift (rules change) | Profile versioning + `reviewedOn` staleness badge in hub; profiles are data → same-day updates |
| OCR/parse failures on scanned FERs | Parse-confidence score; low confidence routes to manual objection entry (pipeline still works with hand-entered cards) |
| Client confidentiality | Existing tenant isolation; no training on client data; document keys per-tenant |
| Scope creep (20 jurisdictions, none deep) | Readiness gates + activation eval bar (§9); India → US → EP before anything else |

---

## 12. Success metrics

- Time from FER upload → attorney-approved draft (target: < 1 day vs 1–2 weeks).
- Objection classification F1 on held-out sets (≥0.9 to activate a jurisdiction).
- Attorney edit distance on drafted sections (trending down per profile version).
- % replies that resolve prosecution without a further OA/hearing, vs tenant baseline.
- Deadline misses among active cases: **zero, ever.**
- Jurisdictions active without code deploys (Phase 3+).

---

## 13. Open decisions

1. **Naming:** "Office Action Studio" globally with `moduleLabel` per jurisdiction ("FER Response" in India) — proposed, confirm.
2. **Case ↔ project linkage:** OA cases can stand alone or link to a spotipr drafting project (auto-importing spec/claims). Standalone-first proposed, since most FER work arrives for applications not drafted in spotipr.
3. **External citation fetch fallback** — resolved by codebase reality: the `patent-search` orchestrator already ships google-patents, **EPO OPS**, PQAI, and indian-corpus providers; the citation resolver fans out to them after a `LocalPatent` miss. No new integration needed for Phase 1.
4. **Hearing mode in Phase 1 vs 1.5** — proposed 1.5 to keep the beachhead release tight.

---

*Research inputs: practitioner commentary (SpicyIP, Mondaq/Lexology firm articles, Reddit/LinkedIn practitioner threads), CGPDTM annual report statistics, Patents Act 1970 + Patents Rules incl. 2024 Amendment Rules, MPEP/37 CFR, EPO Guidelines, USPTO datasets/APIs, and a competitive scan of Solve Intelligence, DeepIP, Patlytics, PowerPatent, ClaimMaster, XLSCOUT, &AI, Juristat, PatentBots. Infrastructure reuse mapped against the current spotipr codebase.*
