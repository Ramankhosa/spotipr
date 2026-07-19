# Office Action Studio — Western Jurisdictions Research Pack
### Profile-grade source material for US · CA · AU · NZ · UK · DE

**Status:** Research complete (web-verified July 2026) · **Companion to:** `OFFICE_ACTION_STUDIO_PRODUCT_PLAN.md`
**Purpose:** every fact an `officeActionProfile` JSON needs per country, with sources and UNCERTAIN flags for build-time verification. EPO is covered in the product plan §2.3 and is not repeated here.

---

## 0. What this research changes about the architecture

Findings that feed straight back into the profile spec — discovered by comparing offices, invisible from any single one:

1. **Three deadline models exist; the deadline engine must support all three.**
   - **Per-report response clock** — India, US, Canada, EPO: each report starts its own response period with extensions.
   - **Acceptance clock** — Australia, New Zealand: a single hard window (12 months from the *first* report) to get the application accepted; no per-report deadlines at all. The engine must show "time remaining to acceptance" and warn that each response round consumes shared budget.
   - **Hybrid compliance period** — UK: per-report periods *inside* an overall compliance ceiling (4.5 years from priority or 12 months from first report, whichever later).
2. **Prosecution state needs counters, not just dates.** Canada gates examination after 3 reports (RCE to continue, 2 more reports per RCE). US tracks non-final → final → after-final entry rights. Profile field: `prosecution.counters`.
3. **US wrinkle — fee-from-date override:** after-final extension fees run from the *advisory action* date, not the reply due date (MPEP 706.07(f)). Profile needs `extension.feeFromDateOverride`.
4. **Objection cards need a rejections-vs-objections track flag** (US: rejections → appeal; objections → petition). Generalizes to "substantive vs formal" routing everywhere.
5. **Doctrine libraries are more encodable than expected.** The US publishes its obviousness rationales as a *named list* (MPEP 2143 A–G) and its rebuttals (MPEP 2145); Canada has the Sanofi 4-step; Australia has the Full-Court Aristocrat two-question test; UK has Pozzoli and Aerotel. These become named strategy targets and argument trees in profiles — not free prose.
6. **Cross-jurisdiction synergy card:** art cited in any co-pending foreign OA (e.g., an Indian FER's D1–D3) triggers a US IDS-recommendation card (37 CFR 1.56/1.97 duty). Our multi-jurisdiction data model makes this a query, not a feature.
7. **Corpus access ranking (best → worst):** AU (AusPat eDossier — full file wrappers, no login/CAPTCHA) ≈ NZ (IPONZ register + real API) > CA (Canadian Patents Database documents tab, no CAPTCHA) > US (ODP File Wrapper API, key required) > UK (Ipsum, per-application) > IN (InPASS, CAPTCHA + scanned images) > DE (Akteneinsicht, limited). AU/NZ/CA are the cheapest eval corpora we have.

---

## 1. United States (USPTO)

### 1.1 Instruments & flow
- Sequence: (optional) **restriction requirement / election of species** → **non-final OA** → reply → **final OA** (typically the 2nd action on the merits, MPEP 706.07(a)) → after-final: 37 CFR 1.116 amendment / **advisory action** / pre-appeal brief review / appeal to PTAB / **RCE** (1.114, reopens prosecution) → notice of allowance (+ possible examiner's amendment). MPEP 700 — https://www.uspto.gov/web/offices/pac/mpep/mpep-0700.html
- **Ex parte Quayle** action: prosecution closed on merits, formal matters only, shortened reply period (MPEP 714.14).
- **Rejections vs objections**: rejections (101/102/103/112/DP) hit claims and go to appeal; objections (spec/drawings/claim form) go to petition (MPEP 706.01). A compliant reply addresses both.
- Restriction: election with or without traverse; non-elected claims withdrawn; rejoinder practice MPEP 821.04.

### 1.2 Timeline
- Statutory cap: **6 months** (35 USC 133). Shortened statutory periods (MPEP 710.02(b)): **3 months** any action on the merits (non-final and final); **2 months** restriction/election-only, Quayle actions, multiplicity-only rejections; statutory floor 30 days. Notice of Allowance: issue fee due in 3 months, **not extendable** (35 USC 151).
- Extensions 37 CFR 1.136(a): up to 5 months automatic with fee, no cause shown, payable retroactively with the reply; never past the 6-month cap.
- Extension fees (37 CFR 1.17(a), effective **Jan 19, 2025**; large/small/micro): 1 mo $235/$94/$47 · 2 mo $690/$276/$138 · 3 mo $1,590/$636/$318 · 4 mo $2,495/$998/$499 · 5 mo $3,395/$1,358/$679. — https://www.uspto.gov/learning-and-resources/fees-and-payment/uspto-fee-schedule
- After final: reply within 2 months → advisory action; extension fees then run from the later of the 3-month date or the **advisory action date**, to the 6-month cap (MPEP 706.07(f)).
- Abandonment (1.135) → revival by petition 37 CFR 1.137, sole standard "unintentional" (PLTIA 2013), fee 1.17(m) $2,260/$904/$452; delays >2 years need extra explanation (85 FR 12222).
- RCE fees (2025 schedule): 1st $1,500/$600/$300; 2nd+ $2,860/$1,144/$572. Notice of appeal $905/$362/$181. The Jan 2025 rule also added IDS size fees and continuing-application surcharges (>6/>9 yrs from priority).

### 1.3 Rejection taxonomy + encodable doctrine
- **§101** — MPEP 2106 flowchart: Step 1 statutory category → Step 2A Prong 1 (does the claim *recite* an abstract idea — groupings: mathematical concepts / methods of organizing human activity / mental processes) → Step 2A Prong 2 (practical application; improvement to computer/other technology, MPEP 2106.04(d)) → Step 2B (inventive concept; Berkheimer evidence for well-understood-routine-conventional). July 2024 AI guidance + Examples 47–49. **2025 developments to encode in the argument tree:** Aug 4, 2025 examiner memo ("recites" vs "involves"; claim as a whole; close calls favor eligibility via practical application) and **Ex parte Desjardins** (Appeals Review Panel, Sept 2025; ML-training claims eligible) + Dec 2025 MPEP 2106.04(d)/2106.05 revisions — examiners must credit specification-supported technical improvements. §101 responses should therefore anchor on spec-cited technical improvements. PERA (S.1546) reintroduced May 2025, **not enacted**. — https://www.uspto.gov/web/offices/pac/mpep/s2106.html ; https://www.uspto.gov/sites/default/files/documents/memo-101-20250804.pdf
- **§102** — AIA first-inventor-to-file (MPEP 2150+): 102(a)(1) public disclosures / 102(a)(2) earlier-filed US patent documents; grace-period exceptions 102(b)(1)-(2); anticipation = single reference, all elements, arranged as claimed (MPEP 2131).
- **§103** — Graham factors + KSR. **MPEP 2143 rationales, encode verbatim as named examiner-rationale targets:** (A) combining known elements per known methods, predictable results; (B) simple substitution; (C) known technique to improve similar device; (D) applying known technique ready for improvement; (E) obvious to try — finite identified predictable solutions; (F) design incentives/market forces prompting variations; (G) TSM. **Rebuttal library (MPEP 2145):** no reasonable expectation of success, teaching away, improper hindsight, non-analogous art, missing element, secondary considerations with nexus. Feb 2024 Updated Obviousness Guidance requires articulated reasoning. — https://www.uspto.gov/web/offices/pac/mpep/s2143.html
- **§112(a)** — written description "possession" (MPEP 2163); enablement Wands factors (MPEP 2164); **Amgen v Sanofi (2023)** full-scope enablement — functional genus claims (antibodies, AI) face heightened scrutiny.
- **§112(b)** — In re Packard "clear" standard in prosecution; common flavors: relative terms, antecedent basis, functional language triggering the §112(f) 3-prong analysis (MPEP 2181).
- **Double patenting** — nonstatutory ODP cured by terminal disclaimer (37 CFR 1.321(c)/(d), common ownership + enforcement-alignment clauses); the May 2024 TD-enforceability NPRM was **withdrawn Dec 2024** — practice unchanged; TD fee raised by the 2025 rule *(UNCERTAIN amount — check fee code 1814)*. — https://www.federalregister.gov/documents/2024/12/04/2024-28263/
- **Restriction/election** is a distinct instrument with its own reply grammar (elect + traverse).

### 1.4 Amendment rules (deterministic formatter spec)
37 CFR 1.121: every claim amendment = complete claim listing, all claims ever presented, ascending order, each with a status identifier from the **closed set** — (Original) (Currently amended) (Canceled) (Withdrawn) (Previously presented) (New) (Not entered). Markings only on currently-amended claims: additions underlined, deletions struck through, `[[x]]` allowed for deletions ≤5 characters. Spec amendments by replacement paragraph or substitute specification (clean + marked, 1.125). Drawings via "Replacement Sheet". Non-compliance → Notice of Non-Compliant Amendment with a short window. After final (1.116): entry not of right. New matter barred by 35 USC 132(a). — https://www.law.cornell.edu/cfr/text/37/1.121

### 1.5 Response conventions (1.111)
Reply must be bona fide and fully responsive: "distinctly and specifically point out the supposed errors" in every ground; request reconsideration; general allegations are non-responsive. Conventional order: Amendments to the Claims → to the Specification → to the Drawings → Remarks (101, 112, 102, 103, DP, then objections), amendment sections on separate sheets (1.121(f)). S-signature by practitioner of record (1.33/1.4); filing = 11.18(b) certifications, which since April 2024 include the AI-verification duty. Filed via Patent Center. **IDS interplay:** duty of candor continues (1.56); timing windows 1.97(b)-(d) (statement and/or fee after the free window; foreign-counterpart citations <3 months old qualify for the 1.97(e) statement); **Jan 2025 IDS size fees** — cumulative cited items >50 = $200, >100 = $500, >200 = $800, with a mandatory statement on form SB/08C. Art cited in any foreign counterpart OA — including an Indian FER — must be IDS'd; our cross-jurisdiction citation card automates exactly this.

### 1.6 Interviews
MPEP 713: effectively as of right before final, discretionary after; video/phone standard; examiner writes an Interview Summary. ~+10pp allowance lift (Juristat); the FY26 examiner appraisal plan raises interview credit — interviews are now strongly incentivized. Response drafts should always carry an interview recommendation.

### 1.7 Volume + cost
~477k serialized UPR filings expected FY2025 (~609k including RCEs); OA volume historically ~460k/yr (Office Action Research Dataset: 4.4M OAs 2008–mid-2017), higher now; actions per disposal ~2.4–2.7; **79% of OAs contain a §103 rejection**; first-action pendency ~26 months FY2025 (backlog >800k). Allowance ~74–77% (vendor analytics, *UNCERTAIN*). AIPLA-benchmark response cost ~$2.5–5k by complexity. — https://www.uspto.gov/dashboard/patents/

### 1.8 Data access (July 2026)
- **Open Data Portal Patent File Wrapper API** — base `api.uspto.gov/api/v1/patent/`: applications/search, /{appNo} metadata, /documents (IFW list + PDF/DOCX download), /transactions, /continuity; free API key via USPTO.gov account (mandatory since June 18, 2026); rate limits ~60 req/min *(UNCERTAIN — verify on the rate-limits page)*. — https://data.uspto.gov/apis/patent-file-wrapper/search
- Legacy Developer Hub retired June 2026; the **OA text / rejection / citation APIs migrated into the ODP** (coverage Oct 2017+, rejection typing incl. Alice flags) — verify current endpoint status at build; worst case, labels are self-derived from raw OA text, which our classifier does anyway.
- **Office Action Research Dataset** (2008–2017, 4.4M OAs, per-OA 101/102/103/112/Alice/DP labels, three CSVs) — the classifier bootstrap; also mirrored in Google Patents Public Datasets on BigQuery *(UNCERTAIN current availability)*. — https://www.uspto.gov/ip-policy/economic-research/research-datasets/office-action-research-dataset-patents
- Bulk: BDSS (bulkdata.uspto.gov) + ODP bulk file-wrapper JSON extracts. Patent Center scraping prohibited — use ODP.
- PatRe benchmark (arXiv 2605.03571) for response-generation eval.

---

## 2. Canada (CIPO)

### 2.1 Instruments & flow
- Examiner's reports ("office actions") → since **Oct 3, 2022**: examination stops after **3 reports**; **RCE** (CAD ~$1,120 / small ~$450) buys 2 more reports, repeatable → **Final Action** at impasse → Patent Appeal Board (PAB) review → Commissioner decision → Federal Court appeal. — MOPOP ch. 8/21, https://www.canada.ca/en/intellectual-property-office/services/patents/manual-patent-office-practice/chapter-8
- **Conditional Notice of Allowance (CNOA)**: allowance conditional on fixing minor defects (2022 innovation).
- Excess claim fees: CAD ~$110 per claim over 20, assessed at exam request and **trued up at allowance** — claim-count strategy matters from day one. *(UNCERTAIN exact current amount.)*

### 2.2 Timeline
- Response: **4 months** from report date; extension to **6 months** on request + CAD $150 before expiry, "reasonable grounds" (Patent Rules 2019, r.3(1)).
- Miss → **abandoned** (Patent Act s.73(1)(a)); reinstatement within **12 months**, fee ~CAD $277. "Due care" applies to some abandonment types (maintenance fees, exam request) but generally **not** to an OA response reinstated in the window. *(UNCERTAIN on the exact due-care boundary — verify MOPOP 27 + Rule 138 at build.)*
- Final Action response: 4 months, extendable similarly.

### 2.3 Objection taxonomy + doctrine
- Novelty s.28.2 (claim-date anticipation, single enabling disclosure).
- Obviousness s.28.3 — **Sanofi 4-step** (2008 SCC 61): POSITA+CGK → inventive concept → differences → obvious? (incl. obvious-to-try in some fields). MOPOP ch.18.
- Subject matter s.2: **Choueifaty** (2020 FC 837) killed problem-solution claim construction → **PN2020-04** "actual invention" + physicality; **Benjamin Moore** (2023 FCA 168) rejected a rigid framework; CIPO continues PN2020-04. *(UNCERTAIN: no 2024–26 revised practice notice found — re-check when authoring.)*
- Utility s.2: AstraZeneca (2017 SCC) abolished the promise doctrine; scintilla + sound prediction (factual basis, sound reasoning, disclosure).
- Sufficiency s.27(3); claim definiteness s.27(4); **new matter s.38.2** ("reasonably to be inferred" from the original spec/drawings).

### 2.4 Amendments & format
Complete replacement claim listing; no statutory marked-copy or basis-statement duty (support addressed in remarks by convention). After Final Action, amendments only as PAB/Commissioner permits. *(UNCERTAIN on marked-copy formality — verify MOPOP ch.19.)*

### 2.5 Hearings
No interviews as of right (informal examiner calls common). Final Action → PAB: written submissions + optional oral hearing → Commissioner decision.

### 2.6 Conventions
Point-by-point response + amendments + remarks via CIPO's MyCIPO portal; **Canadian resident agent (CPATA licensee) required**; English or French.

### 2.7 Volume + data access
~37–38k applications/yr (~88% foreign origin). **Canadian Patents Database** exposes per-application prosecution documents (OAs, responses) as downloadable PDFs, no CAPTCHA; no bulk prosecution-document API (per-application collection feasible). — https://www.ic.gc.ca/opic-cipo/cpd/eng/introduction.html

---

## 3. Australia (IP Australia)

### 3.1 Instruments & flow
- Examination on request → **first examination report starts the acceptance clock** → further adverse reports → hearing before a delegate of the Commissioner at impasse → acceptance → (pre-grant opposition window) → grant. — Patent Manual, https://manuals.ipaustralia.gov.au/patent
- Unique mechanics: **postponement of acceptance** (keep divisional options open), **divisional-before-deadline** as the standard fallback strategy, pre-grant opposition.

### 3.2 Timeline — the acceptance-clock model
- **12 months from the first examination report to have the application ACCEPTED** (Patents Regulations reg 13.4, post-Raising the Bar; was 21 months). Miss → application **lapses** (s.142(2)(e)).
- **No per-report deadlines** — the applicant paces themselves; practice is to respond 2–3 months before expiry to leave room for another report cycle. The UI must show a burn-down, not a due date.
- s.223 extensions: only for error/omission or circumstances beyond control — narrow; treat the 12 months as hard. *(UNCERTAIN current fee ~AUD $100/month.)*

### 3.3 Objection taxonomy + doctrine
- Novelty s.18(1)(b)(i) + s.7(1) (whole-of-contents prior-art base).
- Inventive step s.18(1)(b)(ii) + s.7(2)–(3): POSITA + common general knowledge (post-RTB not geographically limited) + s.7(3) documents; framework: the reformulated **Cripps question** (Wellcome/Alphapharm line).
- **Manner of manufacture** s.18(1)(a): NRDC "artificially created state of affairs of economic significance"; computer-implemented inventions governed by the **Full Federal Court Aristocrat** approach (HCA 2022 split 3:3, so the FCAFC result stands): is it a computer-implemented invention? → is the claimed invention merely the computerisation of an otherwise unpatentable scheme? Examined per Manual 5.6.3. *(Flag: check for 2024–26 sequels at authoring.)*
- Usefulness s.18(1)(c) + s.7A (specific, substantial, credible).
- Clarity/support/sufficiency s.40(2)–(3) post-RTB ("support" replaced "fair basis"; enablement "clear enough and complete enough").
- **Amendments s.102(1)**: not allowable if matter extends beyond the disclosure as filed.

### 3.4–3.6 Amendments, hearings, conventions
Statement of proposed amendments + marked-up and clean copies in practice (no EPO-style mandatory basis statement — *UNCERTAIN formality level*). Hearings before a delegate: written or oral (video standard), fees ~AUD $600–800+; appeal to Federal Court. Responses filed via IP Australia Online Services; overseas applicants need an AU/NZ address for service (trans-Tasman attorney regime shared with NZ).

### 3.7 Volume + data access
~32k standard applications/yr, **~91% foreign origin — the highest foreign share among major offices** (prime outsourced-prosecution territory). **AusPat eDossier exposes the entire file wrapper publicly — exam reports, responses, amendments — no login, no CAPTCHA**: the single cheapest OA corpus among all offices researched. Bulk: IPGOD open datasets (events, not full documents). — https://pericles.ipaustralia.gov.au/ols/auspat/

---

## 4. New Zealand (IPONZ)

- Patents Act 2013: absolute novelty, examined inventive step; exam on request; first report starts a **12-month acceptance window** (Patents Regulations 2014, reg 71); per-report response guidance ~6 months within the overall cap *(UNCERTAIN exact instrument — verify)*; miss → abandoned. Treat like Australia's clock.
- Taxonomy: s.14 patentable invention (manner of manufacture + novel + inventive + useful); **s.11 computer program "as such"** excluded, examined UK-Aerotel-style ("actual contribution"); methods of medical treatment excluded by case law but **Swiss-type claims accepted**; support/sufficiency s.39 (UK/AU-style).
- Hearings before an Assistant Commissioner; appeal to High Court. AU/NZ address for service; trans-Tasman attorneys.
- ~6–7k applications/yr (~90% foreign). **IPONZ register exposes per-case documents publicly and offers a genuine IP Data API** — modern, scrapeless corpus access. — https://www.iponz.govt.nz/support/ip-data/
- Verdict: not worth a standalone rollout phase — **ship as a companion profile to Australia** (same attorney base, same deadline model, shared corpus tooling).

---

## 5. United Kingdom (UKIPO)

### 5.1 Instruments & flow
- Combined search & examination (CS&E) or separate; substantive reports under **s.18(3)** (clean = s.18(4)); subsequent reports; abbreviated reports late in the compliance period. Impasse → **hearing before a Hearing Officer** (offered before any adverse decision — natural justice), decision published (BL O/ number), appeal to the Patents Court. — https://www.gov.uk/guidance/manual-of-patent-practice-mopp/section-18-substantive-examination-and-grant-or-refusal-of-patent
- Failure routes: refusal under s.18; compliance-period failure = "treated as refused" (s.20); reinstatement s.20A within 12 months, "unintentional" standard, Form 14.

### 5.2 Timeline — the hybrid model
- Per-report specified periods: typically **4 months** for the first s.18(3) report, **2 months** for later ones (examiner discretion).
- Extensions r.108(2): **2 months as of right** on written request — and the request may be filed **retrospectively up to 2 months after expiry**; further extensions discretionary under r.108(3) with reasons (Form 52 + fee for compliance-period extensions). *(UNCERTAIN on exact form/fee split per period type — verify Formalities Manual ch.10 at build.)*
- **Compliance period (r.30): 4.5 years from priority/filing OR 12 months from the first s.18(3) report, whichever is later** — the outer ceiling every response strategy must respect; extendable in 2-month steps (first as of right).
- Deadline engine: per-report clocks nested inside the compliance ceiling — both shown simultaneously.

### 5.3 Objection taxonomy + doctrines
- Novelty s.2 (incl. s.2(3) whole-of-contents); inventive step s.3 via the **Pozzoli 4-step** (notional PSA + CGK → inventive concept → differences → obvious without hindsight?).
- **Excluded matter s.1(2)** via the **Aerotel/Macrossan 4-step** (construe → identify actual contribution → solely excluded? → technical?) + the **AT&T/HTC five signposts** for computer programs. AI claims: after **Emotional Perception** ([2024] EWCA Civ 825) ANNs are treated as computer programs and Aerotel applies; UKIPO practice note Nov 2024. *(UNCERTAIN: any UKSC sequel 2025–26 — verify at authoring.)*
- Clarity/support s.14(5); sufficiency s.14(3); **added matter s.76(2)** — strict, EPO-aligned "directly and unambiguously derivable"; industrial application s.4; double patenting s.18(5).
- Reports are numbered-paragraph, objection-wise, citing D1, D2… — parses like an Indian FER.

### 5.4 Amendments & conventions
Fully electronic; amended pages / replacement text; **no mandatory marked-up copy or basis statement** (indicating amendments + basis in the covering letter is convention); voluntary amendment windows r.31; s.76 constrains everything. Response = covering letter answering the report paragraph-by-paragraph + amended pages. Address for service in UK/Gibraltar/Channel Islands required; no attorney monopoly. Acceleration: Green Channel (environmental, free), accelerated exam, PCT(UK) Fast Track, PPH.

### 5.5 Volume + data access
~18–19k applications/yr; response cost signals £800–2,500 *(UNCERTAIN)*. **Ipsum** gives free per-application file inspection — full prosecution PDFs, no login/CAPTCHA; no API. — https://www.ipo.gov.uk/p-ipsum.htm

---

## 6. Germany (DPMA national route) — assessed, deferred

- Flow: exam request (up to 7 years from filing) → Prüfungsbescheide with examiner-set periods (~2–4 months, first extensions granted liberally on request) → Anhörung (examiner hearing, commonly used and effective) → refusal → appeal to the Bundespatentgericht within 1 month. Further processing (§123a) + re-establishment (§123) as safety nets. *(Several details UNCERTAIN — practice-based.)*
- Taxonomy mirrors EPC (§§1–5 PatG) but obviousness follows **BGH case law, not problem–solution** (the "Veranlassung"/prompt test), and software follows the BGH two-step technicity framework (any technical means passes hurdle 1; inventive step assessed only on features solving a technical problem with technical means — functionally COMVIK-like, differently articulated). Added matter strict.
- **Language: German** — parser, prompts, classifier, and drafts would all need a German pipeline. Representation: Inlandsvertreter required for foreigners.
- ~40–58k direct applications/yr *(UNCERTAIN split vs utility models)*, ~70% domestic; international filers overwhelmingly use the EPO route, which we already cover.
- **Verdict: defer.** DPMA is the door to the multilingual layer (same investment later unlocks JP/CN/KR). Not worth blocking English-market rollout.

---

## 7. Cross-cutting: corpus access, volumes, rollout order

### 7.1 Public OA-corpus accessibility (best → worst)
| Rank | Office | Access |
|---|---|---|
| 1 | USPTO | ODP File Wrapper API (full documents, API key) + Office Action Research Dataset 2008–17 (labeled) + bulk |
| 2 | AU | AusPat eDossier — entire file wrappers public, no login/CAPTCHA |
| 3 | NZ | IPONZ public case documents + genuine IP Data API |
| 4 | EPO | Register + OPS API (free-tier quotas) + bulk register data |
| 5 | CA | Canadian Patents Database per-application prosecution PDFs, no CAPTCHA, no API |
| 6 | UK | Ipsum per-application PDFs, no login, no API |
| 7 | IN | InPASS per-application, CAPTCHA, scanned images (beachhead corpus regardless) |
| 8 | DE | DPMAregister file inspection, per-application, German |

### 7.2 Volume + foreign-share signals
US ~653k applications/yr (~500k+ first actions — a multi-billion-dollar response market at $1.5–5k each) · EP ~199k · DE ~40–58k (language-gated) · CA ~38k (~88% foreign) · AU ~32k (**~91% foreign — highest of any major office**) · UK ~19k · NZ ~6–7k (~90% foreign). High foreign share = prosecution is already outsourced = exactly where tooling sells. *(Individual figures UNCERTAIN — mixed sources/years; direction is solid.)*

### 7.3 The India outsourcing angle — the second customer, same buyer
Indian LPOs and IP firms already draft US/EP office action responses at scale for foreign clients — Evalueserve, Clairvolex, Clarivate's India delivery centers, Effectual, TT Consultants, Sagacious IP, IIPRD, Legal Advantage and others all advertise OA-response services; the Indian LPO market is estimated at $1–1.5B+/yr with patents a major slice *(scale figures UNCERTAIN — marketing pages)*. **Implication: the US profile sells to the same India-based buyers as the FER beachhead — no new go-to-market motion.** AU/CA extend the identical pitch (high foreign share, English, open corpora).

### 7.4 Recommended rollout order (post-India)
1. **US** — market size, best data access, same Indian buyers via the LPO angle
2. **EP** — second-largest, most formally encodable doctrine (already researched in the plan)
3. **AU** — open corpus, 91% foreign, and NZ becomes nearly free afterwards
4. **CA** — open corpus, English/French, report-counter quirk exercises the state machine
5. **UK** — small but free corpus; hybrid deadline model exercises the engine
6. **NZ** — companion profile to AU
7. **DE** — deferred until the multilingual layer (which then also unlocks JP/CN/KR)

---

*Method: three parallel web-research passes (US; CA/AU/NZ; UK/DE + cross-cutting), primary sources preferred (MPEP/eCFR/Federal Register, MOPOP/Patent Rules, IP Australia Manual/legislation.gov.au, IPONZ/legislation.govt.nz), firm commentary for practice color. Every UNCERTAIN flag is a build-time verification task, not a blocker.*
