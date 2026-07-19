# Office Action Studio — Attorney Interaction Design
### How the attorney works with partial or full LLM control, per objection

**Status:** Design (approved pending review) · **Date:** 18 July 2026 · **Companion to:** `OFFICE_ACTION_STUDIO_PRODUCT_PLAN.md`
**Mockup:** published artifact "Office Action Studio — Attorney Workspace" (built from the real parsed FER 202541122810).

---

## 1. Design thesis

The attorney's professional duty is to **verify and own** the reply; the system's job is to make verification *fast* and to concentrate the attorney's attention where judgment is genuinely required. Two consequences drive everything below:

1. **Autonomy is per-objection, not per-case.** A Form 3 objection and an inventive-step objection deserve completely different levels of AI control. A global Auto/Manual switch forces the wrong level on half the objections. So every objection card carries its own **autonomy dial** — and the "Auto mode" / "Manual mode" the user asked for become case-level *presets* that set all dials at once.
2. **Trust is shown, not claimed.** Every AI-produced sentence that relies on a fact carries a **provenance chip** — [FER ¶B(1)], [D2 · p.5 ¶3], [Spec ¶0042], [Case: Avery Dennison] — that opens the source at the pinpoint. The attorney never has to wonder "where did this come from?"; they click and see. Unverified evidence blocks approval, structurally.

Weight of real work (from the three real FERs studied): ~70% of attorney thought goes to inventive step + s.3 eligibility; clarity/definitiveness are formulaic; Form 3/formal items are checklist work. The UI matches effort to weight.

---

## 2. The autonomy model

### 2.1 Three dial positions (per objection)

| Dial | Who does what | Attorney's obligation | Default for |
|---|---|---|---|
| **Autopilot** | LLM runs research → analysis → picks the strategy (with stated rationale) → drafts. | Review evidence ledger + draft, approve. One glance for formulaic items. | FORMALITIES, PROCEDURAL_DISCLOSURE, CLARITY (clarity/definitiveness subtypes) |
| **Copilot** (guided) | LLM runs research + presents **2–3 strategy options with tradeoffs** (argue / amend / both; which distinctions to lead; amendment + basis). Attorney chooses/edits strategy → LLM drafts it → attorney reviews. | Choose the strategy; approve the draft. | INVENTIVE_STEP, ELIGIBILITY, SUFFICIENCY, UNITY |
| **Manual** | Attorney writes in the editor. LLM acts only on request via an **assist palette**: insert doctrine skeleton, find spec basis for selection, verify a quote, pull whitelisted case law, check s.59 on an amendment, polish register. | Everything; assists are tools. | Attorney's choice; also the graceful degradation when quota is exhausted |

- Dial defaults come **from the jurisdiction profile** (a `defaultAutonomy` field per canonical objection code) — jurisdiction-agnostic mechanism, jurisdiction-tuned behavior, consistent with the no-`if (country)` rule.
- A **judgment flag** on an objection (see §5) bumps Autopilot → Copilot automatically: the system refuses to auto-decide questions that belong to the attorney.

### 2.2 Case presets (the user's two modes)

- **Auto mode** — "Prepare full reply": every dial to Autopilot (judgment-flagged ones bump to Copilot). Runs the whole pipeline as one background job with a progress timeline ("Resolved D1–D4 · Charted 10 claims × 4 refs · Drafted 6 sections · 2 need your judgment"), then presents the **review queue**.
- **Balanced** (default) — profile defaults per objection.
- **Manual mode** — all dials Manual; assists on demand; the system still parses, computes deadlines, resolves citations and builds the claim chart (that's evidence, not drafting).

### 2.3 The review queue (Auto mode's core UX)

After an auto run the attorney doesn't read top-to-bottom; they work a queue ordered by where their judgment matters:

1. **Judgment required** (red) — e.g. 3(d) efficacy-data gap, estoppel-heavy narrowing, examiner error found.
2. **Weak evidence** (amber) — a distinction resting on an AMBIGUOUS claim-chart cell, low parse confidence, an unverified quote.
3. **Strong/formulaic** (green) — verified, boilerplate-pattern responses; one-glance approvals.

Everything still requires explicit approval (professional duty; USPTO Apr-2024-style verification duty is the compliance story) — the queue just orders attention.

---

## 3. Surfaces

### 3.1 Docket (case list, `/office-actions`)
Cases sorted by **days-to-deadline**, not creation date. Each row: application no., applicant, jurisdiction chip, objection count by status, deadline countdown with urgency color, and a **Form 4 quick action** when inside the extension window (shows computed fee from the profile). This page is the attorney's morning triage.

### 3.2 Case workspace (the main surface)

Three-zone layout:

- **Top bar — the deadline strip** (always visible): reply due date + countdown + consequence ("deemed abandoned u/s 21(1)"), secondary deadlines (Form 3), extension option with fee, **case completeness meter** (spec ✓ / claims ✓ / POA ✗), **approval ring** (e.g. 4/6 approved), and the mode preset control.
- **Left rail — objection cards**: one card per objection: canonical badge + statute, claims affected, autonomy dial, status chip (Extracted → Evidence ready → Strategy chosen → Drafted → **Approved**), and risk flags. Clicking a card loads its workbench. FER numbering order, never re-sorted (the reply must mirror the FER).
- **Center — the objection workbench**: four tabs per objection (see §4).
- **Right rail — the source viewer**: tabbed readers for the FER itself, each cited document, and the specification. Any provenance chip clicked anywhere opens the right source scrolled to the pinpoint with the passage highlighted. This is the verification loop: read left, confirm right, approve.

Below the objection flow, two case-level steps:
- **Reply assembly** — the full letter in profile-skeleton order; per-section status; preliminary submissions and prayer auto-drafted (Autopilot-class); inline editing.
- **Compliance & export** — the lint checklist + export actions (§7).

---

## 4. The objection workbench (four tabs)

Illustrated for INVENTIVE_STEP; lighter objections show the same tabs with less content.

### Tab 1 — Objection
- The examiner's **verbatim text**, quote-verified badge, link into the FER source.
- **Structure extraction**: closest prior art named by the examiner, the CGK assertion, the combination logic (D1+D2+D3), and — critically — **the examiner's own concessions** ("However D1 do not discloses the following features: (A)…"). Concessions are pre-highlighted: they are the reply's ammunition and attorneys hunt for them first.
- Claims affected, cited documents, statute, and any **examiner-error flags** (e.g. the "claim 14" copy-paste artifact in a claims 1–10 application) with a suggested polite noting.

### Tab 2 — Evidence
- **Citation cards** D1…Dn: resolution status (corpus → BigQuery claims → SerpApi full text), the examiner's pinpoint (from the PART-II table), our pinpointed passages, full-text reader link.
- **Claim chart**: features × citations grid, each cell DISCLOSED (with exact quote + location) / NOT_DISCLOSED / AMBIGUOUS. NOT_DISCLOSED cells are the distinctions; AMBIGUOUS cells carry an amber "verify" chip.
- **Specification evidence**: auto-extracted technical-advance / efficacy / synergy passages with paragraph cites — the s.2(1)(ja) and s.3(d) raw material.
- **Evidence gaps** (red cards): what the record *doesn't* contain — "No comparative efficacy data vs known Ru complexes in the specification. Options: expert affidavit u/r 137? argue outside 3(d) scope? Attorney decision." The system converts absence-of-evidence into an explicit decision instead of fabricating.
- The **evidence ledger** footer: every anchor used anywhere in this objection with its verify state; bulk-accept for verified items.

### Tab 3 — Strategy
- **Assessment**: examiner-position strength per element (which distinctions are strong, which arguments are weak), in plain language.
- **Options** (Copilot): 2–3 cards with tradeoffs — e.g. *A: Argue only* (keeps full scope; risk: examiner maintains → hearing), *B: Argue + amend claim 1 with the anthracene-naphthimidazole limitation* (strong distinction; cost: narrower scope + prosecution-history note), *C: Amend only* (fastest to grant; gives up most). Each shows the claim diff preview and an estoppel/scope note.
- **Amendment editor**: marked-diff claim editor; every inserted phrase must carry a **basis chip** (Spec ¶ found by the basis finder) and the **s.59 verdict** (within scope / risk / fail) renders live. Un-based additions cannot be saved.
- Choosing an option (re)generates the draft.

### Tab 4 — Draft
- The generated section with **inline provenance chips**; register follows the profile phrases.
- **Edit** directly (rich text) — edits re-run quote verification live.
- **Revise by instruction** — "lead with the D2 teaching-away point, drop the third argument" → regenerates with the instruction; version history v1/v2/v3 with diffs, restore.
- **Approve** button — disabled until: evidence ledger green, no stale flag (§5), no unresolved judgment flag. Approval locks the section into the assembly (editable later, but un-approves).

---

## 5. Cross-cutting mechanisms (the recommendations beyond the ask)

1. **Consistency watchdog / stale invalidation.** Claim text is a shared dependency. Amend claims in one objection → every drafted section quoting the claims is flagged **STALE** (amber) and must be regenerated or re-approved. Same when a strategy changes. Without this, multi-objection replies silently self-contradict — the classic hand-drafting failure the system must not reproduce.
2. **Judgment flags.** A typed list of things the system must never decide silently: missing efficacy/synergy data (3d/3e), estoppel-heavy narrowing, divisional decision (unity), examiner-error handling, abandoning a claim. Each renders as a red card demanding an explicit attorney choice; in Auto mode they are what bumps an objection into the review queue's top tier.
3. **Examiner-concession extraction.** FERs routinely admit what the closest art lacks. Auto-surfaced, quoted, verified — often the whole reply writes itself from the examiner's own words.
4. **Verification record (internal PDF).** On export, optionally generate an audit trail: who approved each section when, every evidence item and its verification state, model/versions used. Not filed — it's the attorney's file note (professional-duty cover) and the LPO reviewer's QC sheet. No competitor offers this.
5. **Client summary generator.** One click: plain-language email to the client — what the examiner said, what we propose, what we need from you (e.g. efficacy data), fee/deadline. Attorneys spend real unbilled time on exactly this.
6. **Deadline-integrated extension action.** The strip's "Request extension" computes the Form 4 fee from the profile and drafts the request; the docket shows who is inside the 9-month window.
7. **Quota/cost visibility.** Each auto run shows metered usage (existing metering); LPO admins see per-case cost.
8. **Firm-style learning (later).** Approved-vs-generated diffs are per-firm style signal — feed the existing PersonaSync infrastructure so drafts converge on each firm's voice. Phase 4.
9. **Hearing continuity.** Strategy notes and evidence persist on the case; when a hearing notice arrives (Phase 1.5), the written-submissions workspace pre-loads only the maintained objections with the prior round's evidence.
10. **Intake completeness gate.** The workbench is only as good as its inputs: intake demands the as-filed spec + claims (upload or import from the spotipr draft), and the completeness meter warns that basis-finding/amendment guard degrade without them.

---

## 6. Manual mode specifics (light-assistance contract)

Manual is not "no AI" — it's "AI never writes unprompted":
- Full parsing, deadlines, citation resolution and claim chart still run (evidence, not drafting).
- The editor offers an **assist palette** (slash-command or toolbar): `/skeleton` insert doctrine steps · `/basis` find spec support for selection · `/verify` quote-check selection · `/caselaw` whitelist lookup · `/s59` amendment scope check · `/polish` register pass on selection.
- Every assist result carries the same provenance chips; the ledger accrues the same way — so a manually drafted reply still exports with a verification record.

---

## 7. Compliance & export

Lint (deterministic, blocking): every objection has an approved section · every quote verified · every amendment has basis + s.59 pass · marked/clean copies consistent · Form 3 status resolved · POA present · signature block set · FER-order preserved.

Exports: **reply letter DOCX** (profile skeleton) · marked + clean claim copies · Form 4 draft (if extension chosen) · client summary email · **verification record PDF** (optional). Nothing is ever filed by the system.

---

## 8. States that must be designed (not afterthoughts)

- **Parse-confidence low / scanned FER** → manual objection-card entry flow (cards typed by the attorney; pipeline continues identically).
- **Citation unresolvable** (NPL, dead number) → "upload the document" card; chart marks the column PENDING; drafting can proceed with the examiner's pinpoint quoted as *examiner's characterization* (labelled as such, never as our verified reading).
- **Quota exhausted mid-run** → completed stages keep their results; remaining objections drop to Manual with a clear banner.
- **Empty case** (no documents yet) → the intake dropzone with the three-step explainer.
- **Everything approved** → the export step lights up; the deadline strip turns from countdown to "ready to file, X days early."

---

## 9. Build order (UI phases)

- **UI-1 (with Phase 1 backend):** docket · workspace shell · deadline strip · objection cards · Objection/Evidence/Draft tabs (Copilot flow only) · provenance chips + source viewer · approve flow · assembly · lint · DOCX.
- **UI-2:** autonomy dials + presets · Auto run + review queue · Strategy tab with options + amendment editor + s.59 live verdict · consistency watchdog · judgment flags.
- **UI-3:** Manual assist palette · revise-by-instruction + versioning · client summary · verification record · Form 4 action · quota display.
- **UI-4:** firm-style learning · hearing continuity workspace.
