# Patent Whitespace Intelligence — Product, Design & Architecture Plan

**Product:** PatentNest.ai (spotipr)
**Module:** Whitespace Studio
**Date:** July 2026
**Status:** Proposal for build approval

---

## How to read this document

Sections 1–5 are product strategy. Sections 6–8 are design. Sections 9–11 are engineering. Sections 12–14 are the worked artefacts — wireframes, a full example run, and a deliberately hostile review of our own proposal.

Two conventions run throughout:

- **Every capability is scored against the data we actually have.** This plan was written against the real spotipr schema and services, not an idealised patent database. Where our data cannot support a feature honestly, the feature is deferred and the reason is stated. Claims about existing code carry file paths.
- **VERIFIED vs ASSUMED.** In Section 2 (market research), each claim about a competitor is labelled and carries a source URL. Elsewhere, statements about our own codebase are verified against the repository; forward-looking estimates are labelled as estimates.

---

# Section 1 — Executive concept

## 1.1 The product in one paragraph

Whitespace Studio turns a technology field into a small number of defensible invention opportunities. The user describes a field in plain language; the system maps what has already been patented, clusters the field into named technology areas, measures which areas are crowded and which are moving, pulls actual claim language for the areas worth a closer look, and then proposes specific, structured invention hypotheses. Crucially, it then attacks its own hypotheses — running disproof searches, checking whether the gap is real or an artefact of vocabulary, missing data, broad claims held by someone else, or a technology the field already tried and abandoned. What survives is presented as a scored hypothesis with its supporting *and* contradicting evidence attached, and can be pushed straight into PatentNest's existing novelty search and patent drafting pipelines. The output is not a chart deck. It is a short list of things worth inventing, each with the reasoning shown.

## 1.2 Name options

| Name | Rationale | Verdict |
|---|---|---|
| **Whitespace Studio** | Matches the existing product suite (Prior-Art Studio, Office Action Studio, Diagram Studio). Instantly legible to IP professionals, who already use "white space" as a term of art. | **Recommended** |
| Opportunity Lab | Emphasises the hypothesis-and-test character. Warmer for R&D and startup users, less precise for attorneys. | Strong second; recommended as the name of the *second mode* (see 1.6) |
| Innovation Observatory | Evokes patient, instrumented observation. Good for the landscape half, wrong for the inventive half — observatories watch, they don't build. | Use as the name of the *first mode* |
| Frontier | Short, memorable, ownable. But vague, and oversells certainty about what lies beyond the edge. | Reject |
| Terra / Terra Incognita | Beautiful metaphor for unmapped space. Too cute for a document that attorneys will attach to a client file. | Reject |

**Recommendation: "Whitespace Studio",** with "Observatory" and "Lab" as the names of its two internal modes. This gets suite consistency in the product nav and a genuinely useful conceptual split in the UI, without inventing a brand the market has to learn.

## 1.3 One-line value proposition

> **From patent landscape to defensible invention opportunity — with the evidence, and the counter-evidence, attached.**

Alternates for different audiences:

- *For R&D leaders:* "Find out what's left to invent in your field, and why nobody has."
- *For attorneys:* "Whitespace analysis that shows its work — and tells you when the whitespace isn't real."
- *For startups and TTOs:* "Turn a research area into a patentable position in a week, not a quarter."

## 1.4 Target users

Primary (the segment we build for first):

1. **Corporate R&D and innovation teams** at mid-size technology companies — the people asked "where should we file next year?" who currently answer it with a consultant's PowerPoint or an internal guess.
2. **Patent attorneys and agents in firms with an advisory practice** — who are asked by clients for portfolio-direction advice and currently do it with search tools plus experience.

Secondary (served by the same core, different emphasis):

3. **University technology transfer offices** — sitting on research output, needing to know which parts are patentable and commercially distinct.
4. **Startup founders and CTOs** — needing a defensible position fast, usually without in-house IP expertise.
5. **Individual inventors** — needing to know whether their idea is already crowded, and what adjacent direction is open.
6. **IP strategists and innovation consultants** — who would use this as the analysis engine behind their own client deliverables.
7. **Investors and due-diligence analysts** — assessing whether a target's claimed IP position is real and whether the surrounding space is defensible.

Section 3.3 sets out the personas and Section 3.4 which capabilities change by role.

## 1.5 Core differentiator

The market is well served for *search* and adequately served for *visualisation*. It is not served at all for *judgment*. Every major platform can show you that a region of a technology map is sparse. None of them will tell you whether that sparseness is an opportunity or a graveyard.

Our differentiator is a single discipline, applied consistently:

> **We treat "this area is empty" as a question, not an answer — and we spend real compute answering it.**

Concretely, four things follow from that, and together they constitute the moat:

1. **A whitespace type system.** Ten distinct reasons an area can look empty (Section 10.2). A data gap, a terminology gap, a claim gap, a feasibility gap and a genuine opportunity are indistinguishable on a density map and lead to opposite decisions. We classify rather than colour.
2. **Adversarial validation as a first-class pipeline stage.** The system runs structured disproof attempts against its own findings before showing them, and shows you what it tried. Survival is the signal.
3. **Evidence-first presentation.** Every number drills to passages, queries, retrieval scores, and an explicit statement of what our data does not cover. Contradicting evidence is displayed next to supporting evidence, never suppressed.
4. **It ends in a patent.** The module terminates in PatentNest's existing novelty search and drafting workflows. A standalone analytics vendor structurally cannot close this loop; we already own both ends of it.

## 1.6 The experience model: Observatory and Lab

The brief asked whether the module should be an "Innovation Observatory" or an "Opportunity Lab". The right answer is both, as two explicit modes, because they correspond to two genuinely different cognitive tasks that current tools blur together.

**Observatory (understand).** Read-only, exploratory, cheap. What exists, who owns it, what's growing, what's consolidating, what the field calls things. Nothing here is a recommendation. This is the mode where a user builds a mental model, and it must be fast and free-feeling — no consumption anxiety, no modal dialogs, no "you have 3 credits remaining".

**Lab (test).** Active, expensive, deliberate. Form a hypothesis, attack it, score it, develop it. Every action here consumes metered budget and produces an auditable artefact.

The mode switch is the primary navigational gesture in the module. It also solves a real product problem: it lets us be generous with the cheap SQL-and-vector analytics that builds trust, while metering the expensive LLM work that creates value. Users understand "looking is free, testing costs" intuitively.

## 1.7 Primary user outcome

A user finishes a Whitespace Studio session with:

- A named, structured map of their field they did not have before, and could not have assembled manually in under a week;
- Between one and five **surviving** invention hypotheses, each with a technical direction, the claim elements that would differentiate it, and a candid list of what could kill it;
- An explicit list of *rejected* opportunities with reasons — which is often the more valuable half, because it stops wasted R&D spend;
- A one-click path into a novelty search and then a patent draft.

The success metric we should hold ourselves to is not sessions or charts viewed. It is: **what fraction of surviving hypotheses proceed to a novelty search, and what fraction of those proceed to a filing.** Section 11.5 sets targets.

---

# Section 2 — Market research

## 2.1 Method and confidence

Research conducted July 2026 across vendor product pages, documentation and help centres, dated press releases, review platforms, and the peer-reviewed methodology literature. Claims are marked **[V]** where verified against a named source and **[I]** where they are our inference from evidence. Sources are linked inline.

Three honest caveats about the research itself. G2, Capterra, Gartner and several vendor support pages block automated retrieval, so candid practitioner evidence is thinner than we would like and some review-derived weaknesses are inferences rather than verified quotes. The "best AI patent tool of 2026" listicle genre is largely vendor-authored SEO content and was used only for leads, never as sole support. And almost no vendor publishes pricing — circulating third-party figures vary by an order of magnitude for the same product and should not be relied on.

## 2.2 The headline finding

> **Of the six major incumbent platforms, not one sells a dedicated whitespace product. Whitespace is universally a by-product of a clustering map or a custom classifier — marketed heavily in blog content, shipped thinly in the product.**

The most striking single data point: Minesoft's own 68-page *PatBase Analytics V3 Guide* contains the phrase "white space" **zero times**, while the company's marketing site runs a blog post defining whitespace analysis and pointing readers at four general products **[V]**. Among AI-native tools the pattern repeats — IPRally's Intelligence page poses the whitespace question as a headline, but its three named Intelligence features sit under a "what's coming" heading in preview as of July 2026 **[V]**.

This matters strategically. The category has *demand* for whitespace analysis — every vendor markets it — and almost no *supply*. What is being sold is a visualisation from which the user is expected to infer the gap themselves.

## 2.3 Incumbent platforms

| | Patsnap | Clarivate Derwent | Questel Orbit | LexisNexis PatentSight+/Cipher | LexisNexis IPlytics | Minesoft PatBase |
|---|---|---|---|---|---|---|
| Primary buyer | R&D + IP, broad | Corporate IP, firms, patent offices | IP professionals | Executive / strategy | SEP licensing | Professional searchers |
| Published pricing | **Yes** — Eureka free / $200 mo / custom | No | No | No | No | No |
| Semantic search | Yes, 78% top-100 claimed | AI Search (Dec 2024) | QaECTER (Apr 2026) | **Weak — analytics, not retrieval** | Corpus-specific | Yes + AI Explain |
| Landscape map | 3D Landscape (since 2015) | ThemeScape — *de-emphasised on 2026 product page* | Documented landscape map | **None** — taxonomy instead | None | 2D/3D, 10k-family cap |
| Whitespace claim | Yes, product page | Yes, AI Classifier | Yes, help docs | Yes, via Classification | **No** | **Marketing only** |
| Whitespace artefact | Map + NL exploration | **Taxonomy matrix** | Map + inter-cluster reading | Matrix + ~70 reports | — | Chart only |
| Claim-level | **Best** (limitation→3GPP charts) | Not verified | Claim Graph, Rewrite, AI compare | Not verified | Claim→standard score | Weakest |
| Scientific literature | 192M+ articles | **Web of Science, 73M+** | 150M NPL + clinical trials | **None** | None | 12 NPL sources |
| Market/commercial data | **Best** (M&A, funding, news) | Own-BI ingest only | Orbit Insight, 500+ sources | Litigation + SEP only | Standards/pools | **None** |
| Explainability | Search-strategy appendices; editable concepts | **Weakest** — provenance, not rationale | Documentation + caveats | **Best** — shows full queries | Score without visible evidence | **Best at result level** — span highlighting |

**[Patsnap](https://www.patsnap.com/)** is the broadest. Its Analytics page does explicitly offer white-space discovery **[V]**, delivered as a 3D landscape plus, since the March 2026 Eureka release, conversational exploration **[V]**. Its genuinely distinctive assets are **Patent DNA** — LLM-extracted technical-problem and technical-benefit fields made *searchable* rather than merely displayed (CN/US/EP, last decade) **[V]** — and an **SEP Claim Chart** that maps claim limitations to 3GPP sections with source text and mapping rationale visible **[V]**. Its agent reports ship reproducibility appendices listing technical elements, synonyms and the search strategy **[V]**. Weaknesses: Capterra shows 4.7/5 from only six reviews, with complaints about learning curve and legal status tracked at family rather than individual level **[V]**.

**[Clarivate Derwent](https://clarivate.com/intellectual-property/derwent/)** (renamed from Derwent Innovation / Innography) leads on curated data: the DWPI layer provides human-authored Novelty, Use and Advantage fields across 70M+ invention families, indexed by 800+ editors **[V]**. Searching an editor-written "Novelty" field is a materially different retrieval primitive from full text, and it is what Patsnap tried to replicate with LLMs. Its **AI Classifier** accepts plain-English class definitions or example patents with no training data, claims 97% accuracy on a third-party gold-standard set, and processes 2,500 patents in under 18 minutes **[V]** — and its page instructs users to spot trends and whitespace with it **[V]**. Two observations: ThemeScape, the category's most famous landscape visualisation, is **not mentioned on the current Derwent Patent Search product page** **[I: a strategic de-emphasis]**; and Clarivate has quietly built the better whitespace primitive (a counted taxonomy matrix) while barely marketing it as such.

**[Questel Orbit](https://intelligence.help.questel.com/en/support/solutions/articles/77000450043-understand-and-use-a-landscape-map)** has the best-documented analytics internals of anyone. Its landscape help article explains the full pipeline — concepts extracted from full text, weighted by the field they appear in and by frequency, then clustered and projected — and names whitespace identification as a use case, framed as examining **intersections between clusters** rather than blank canvas **[V]**. That framing is more disciplined than most. **QaECTER** (April 2026) is its own retrieval model trained with citation-driven supervision and evaluated on an internal Sophia-Bench of 10,000 queries graded against examiner-cited prior art **[V]** — vendor-reported and not independently replicated. Questel also has the market's most responsible AI caveats, explicitly discouraging reliance on AI summaries for FTO **[V]**.

**[LexisNexis PatentSight+ / Cipher](https://www.lexisnexisip.com/solutions/ip-analytics-and-intelligence/)** competes on metrics and taxonomy rather than cartography — there is no ThemeScape equivalent. Its Universal Technology Taxonomy sorts ~45M active patents into 10 super-classes and ~121 sub-classes designed to be comparably populated, and is claimed to be the only such algorithm independently peer-reviewed **[V]**. Whitespace is delivered as an empty cell in a taxonomy-by-competitor matrix, one of ~70 pre-built classifier reports **[V]**. Its **Protégé** assistant is the explainability standout: it displays the full generated queries and contextualises results **[V]**. Structural gap: PatentSight+ has no meaningful semantic prior-art retrieval, no claim tooling, and no scientific literature **[V]**.

**[LexisNexis IPlytics](https://www.lexisnexisip.com/solutions/ip-analytics-and-intelligence/iplytics/)** is standards-specific. Its Semantic Essentiality Score maps patent claims to standard sections and returns a 1–100 likelihood **[V]** — element-level analysis productised as a score. No whitespace claim, correctly, since standards define the space. The instructive contrast with Patsnap: a score is easy to consume and hard to defend; a claim chart is hard to produce and easy to defend. **Neither vendor ships the obvious synthesis — a score that expands into its evidence** **[I]**.

**[Minesoft PatBase](https://minesoft.com/platform/patbase/)** is the professional searcher's tool. **AI Explain** (Sept 2025) is the most concrete per-result explainability feature found anywhere in this audit: it highlights precisely which sections and wording matched the input, with a distinct treatment for partial matches **[V]**. Its **AI Alerts** let users bulk-train a classifier from their own folders and search history **[V]** — harvesting curation users already do, which is the most practical personalisation mechanism in the market. Whitespace, as noted, exists only in its marketing.

## 2.4 AI-native tools

**[IPRally](https://www.iprally.com/)** is the most technically differentiated engine in the market: inventions are decomposed into **graphs of technical features and relationships**, and ranking uses a graph neural network **trained on millions of examiner citations** — supervised on exactly the relevance signal the profession cares about **[V]**. Explainability is the deepest available and, crucially, *actionable*: the graph decomposition is shown to the user and is **editable before the search runs** **[V]**. Its Agent (March 2026) produces feature-level claim charts with reasoning traceable to source documents, and includes a **human verification checkpoint** — extracted features are confirmed with the user before searching **[V]**. Gaps: **no scientific literature at all** **[V]**, whitespace still in preview **[V]**, and a deliberate refusal to generate inventions — its drafting product never auto-generates claims and requires explicit approval of every AI modification **[V]**.

**[Amplified](https://www.amplified.ai/)** uses a patent-specific language model trained on citations, classifications and full text, with two user-selectable ranking modes (Neural for conceptual breadth, Classic for text specificity) **[V]**. Its most copyable idea is a product guarantee: **AI sorts but never excludes results** **[V]** — a trust commitment rather than an explanation, and it costs nothing. Ranking is document-level, with no element mapping **[V]**, and no landscaping.

**[IP.com InnovationQ+ / IQ Ideas+](https://ip.com/iq-ideas/)** has the most complete ideation loop that has actually shipped. CompassAI (June 2024) offers three ideation workflows — solutions drawn from prior art, generative creative solutions, and ideas derived from structured inventive principles (TRIZ-flavoured) — feeding into novelty scoring against a claimed 15M+ exclusive prior-art corpus, and then automated invention-disclosure generation **[V]**. Its architecture separates retrieval from reasoning in a stated "dual engine" design so that grounding is auditable by construction **[V]** — a pattern worth adopting explicitly. **HD-Analyze** provides semantic maps with a credible whitespace story **[V]**. The caveat is significant: InnovationQ+ has zero G2 ratings and we found no independent practitioner review anywhere **[V]** — execution quality is unknown.

**[Solve Intelligence](https://www.solveintelligence.com/)** ($40M Series B, Dec 2025; $55M total) is drafting-first and explicitly **not** a search engine **[V]**. Its Charts product cites file-wrapper documents and case law — a genuinely differentiated evidence source **[V]**. Invention "harvesting" is capture and standardisation of human disclosures, not generation. No landscaping, no whitespace.

**Notable entrants:** **[Patlytics](https://www.patlytics.ai/)** ($40M Series B, April 2026) claims to analyse patent family gaps against competitive landscapes and ranks patentable ideas by strength **[V]**. **XLSCOUT's Ideacue** is the purest ideation product found — problem statement in, AI-generated ideas out, each categorised weak/medium/strong against prior art **[V]**. **Cypris** integrates 180M+ patents with 270M+ scientific papers and names white-space analysis as a workflow, positioning on the observation that research runs ahead of patent activity **[V-medium]**. **&AI** searches the broadest evidence set found — including standards, product documentation, archived web content and video **[V]**.

## 2.5 Free and open sources

**[Google Patents](https://patents.google.com/)** covers 120M+ publications from 100+ offices with full text from 21, and machine-translates and indexes non-English documents **[V]**. Its quiet superpower is that **Google Scholar content has been machine-classified with CPC codes**, making non-patent literature searchable in a patent idiom **[V]**. BigQuery public datasets are CC BY 4.0 at roughly $5/TB scanned after a free first terabyte, and include an open **Automated Patent Landscaping** implementation **[V]** — the reference open method. Note: there is no official Google Patents REST API; programmatic access is BigQuery only **[V]**.

**[The Lens](https://about.lens.org/)** is non-profit, holds 200M+ scholarly records with an open citation graph, and — uniquely — has a dedicated feature page for identifying white space framed as **mining patent claims** **[V]**. That framing is conceptually correct and rarer than it should be; the delivered mechanics appear closer to assignee and CPC trend analysis **[I]**, so the framing likely outruns the tooling. Individual Professional access has been held at $1,000/year since launch **[V]**.

**[Espacenet](https://worldwide.espacenet.com/)** offers free access to 150M+ documents with claims and description fields directly searchable **[V]**. The EPO described a natural-language-query version in development as of November 2024; we could not verify that it shipped by July 2026 **[V by absence]**.

**[PQAI](https://projectpq.ai/)** is the only open-source, self-hostable, transparently priced option ($0 / $20 per month / $700 enterprise API), trained on examination records, and includes DOAJ open-access journals **[V]**.

## 2.6 Adjacent platforms — what patent tools lack

| Platform | The idea worth borrowing |
|---|---|
| [ITONICS](https://www.itonics-innovation.com/) | A **rated, routable object** with an owner and a next action, rendered across radar / kanban / roadmap / list views — not a disposable chart |
| [CB Insights](https://www.cbinsights.com/mosaic-score/) | **Mosaic Score**: a published, decomposed, weighted score (Momentum 50% / Money 40% / Market 5% / Management 5%) with an explicit predictive-validation claim |
| [SciVal](https://www.elsevier.com/products/scival/overview/topics) | **Topic Prominence** shipped *with its disclaimer* — Elsevier states it indicates momentum and visibility, not importance |
| [Web of Science ESI](https://clarivate.com/academia-government/essays/research-fronts/) | **Research Fronts**: bottom-up co-citation clusters with a two-layer "core plus citing front" structure, refreshed annually — no a-priori taxonomy |
| [Connected Papers](https://www.connectedpapers.com/) | **Seed-to-graph in one click** — time-to-first-insight measured in seconds, no search strategy required |
| [Litmaps](https://www.litmaps.com/) | **Meaningful axes** plus saved, monitored, subscribable maps |
| [ResearchRabbit](https://www.researchrabbit.ai/) | **Reversible exploration state** — search history as a branching tree you can hop back into |
| [Elicit](https://elicit.com/) | **User-defined extraction columns** — the analyst defines the schema, the tool fills it across the result set |
| [Wellspring](https://www.wellspring.com/scout) | **Partner-shaped output** — the answer is an organisation you can call, not a document |
| [Dimensions](https://www.dimensions.ai/) | Grants and clinical trials as **first-class linked nodes** alongside publications and patents |

Two of these are directly actionable for us: Elsevier's honesty pattern (ship the indicator *with* what it does not license you to conclude) is exactly our coverage-strip philosophy, and CB Insights' decomposed published score is exactly our score vector — with the addition, which we should copy, of a stated predictive validation.

## 2.7 The methodology literature — the most important research finding

This is where the strongest support for our approach comes from, and it is worth more than any competitor comparison.

**WIPO's *Guidelines for Preparing Patent Landscape Reports* (Trippe, WIPO Publication 946, 2015)** — the standard-setting document for the discipline — **never uses the term "white space"**, and in §8.6.2 explicitly warns that spatial concept maps have no real axes, that distance is relative to the document collection, and that no inference can be drawn about what would occupy an empty region **[V]**. The same author's consultancy has published the same warning about ThemeScape specifically **[V]**.

**The convergence here is remarkable and worth stating plainly to prospects:** the person who wrote WIPO's landscape guidelines has publicly warned that the industry's flagship whitespace visualisation is not interpretable in its empty regions — and the entire category markets whitespace off exactly that visualisation. Section 10.2a treats this as a binding design constraint.

WIPO's prescribed analytical vocabulary also gives us cover for our most novel-looking screen: §6.9 defines **SAO (subject–action–object) analysis** where action plus object is the problem and subject is the solution, and observes that aggregating these yields solutions to a problem even when no single document contains them together **[V]**. That is our problem–solution–constraint matrix, and it is the WIPO-sanctioned technique.

**Silent data exclusions manufacture fake whitespace.** This finding is specific, verified, and damning across three vendors: Questel's landscape omits families considered too far from others to avoid computational problems **[V]**; PatBase excludes families lacking a usable abstract entirely and caps clustering at 10,000 families **[V]**; Patsnap's landscape has document limits **[V]**. **None of these exclusions is surfaced in the visualisation at the moment a user draws a conclusion from it.** Every one of them creates empty regions that are artefacts of the tool. Our answer — annotating every visual with how many documents were rendered and how many excluded, and why — is a direct, cheap response to a documented category-wide failure.

**Other load-bearing findings**, developed further in Sections 10 and 14:

- **[RIPL](https://www.nature.com/articles/nbt.4291)** (Smith et al., *Nature Biotechnology* 36:1043–7, 2018) is a 21-item reporting standard for patent landscapes, created in response to documented quality failures including keyword-only searching and omitted search terms **[V]**. No commercial whitespace product claims conformance. We should.
- **Classification is not a technology taxonomy.** WIPO states plainly that examiners create codes to segment patent-office workload, and alignment with a client's business categories is incidental **[V]**. Automated landscaping research documents bias toward frequent, well-established CPC subclasses with direct consequences for downstream indicators **[V]**.
- **Hierarchy artefacts.** Cheng and Wang's technology/function matrix work establishes that a low-count cell is only interpretable against a *sibling* code; a parent code's low count is a classification artefact **[V]**. Without depth normalisation, the entire upper classification tree reports as opportunity.
- **Science-to-patent lag is large and field-specific** — roughly four years in some biomedical areas, a median near six for biomedical papers generally, over ten years in human–computer interaction **[V]**. Same-year comparison of publication and filing volumes is meaningless.
- **The "R&D Trap" quadrant.** Practitioner guidance distinguishes high-need/low-density (true whitespace) from low-need/low-density, and identifies confusing the two as the most common R&D committee failure **[V]**.
- **Trade secrecy is concentrated where whitespace analysis looks.** Process technology, formulations and manufacturing know-how are systematically kept secret, which means low patent density is weak evidence of an unoccupied area **[V]**. Section 10.7a introduces an appropriability prior in response.
- **The ideation–execution gap.** In a controlled study with 43 expert researchers executing assigned ideas, LLM-generated ideas rated *more novel* than human ones before execution and fell significantly further on every metric after **[V]**. Our confidence scores are pre-execution judgments and must be labelled as such.
- **Vacancy methods are criticised in the literature they spawned.** Work following GTM-based "patent vacuum" mapping notes that defining and interpreting vacancies is intuitive and ambiguous, and that a vacant region may reflect technical barriers or abandoned technology **[V]**. Novelty-outlier and semantic–structural coupling approaches exist as falsifiable alternatives, the latter notably validated retrospectively on a held-out time slice **[V]**.

## 2.8 Best features worth adopting

Ranked by leverage, with the source that does it best:

1. **Show the generated query** (LexisNexis Protégé) — converts an opaque answer into an auditable, editable, re-runnable object. Cheapest high-trust feature in the market.
2. **Span-level match explanation** (Minesoft AI Explain) — highlight exactly which words caused the hit, with distinct treatment for partial matches.
3. **Editable extracted concepts before searching** (Patsnap semantic customise; IPRally's graph and verification checkpoint) — explainability that is also steering. **This validates our scope-review screen (6.3) as the single highest-ROI design decision in our plan.**
4. **Reproducibility appendices in reports** (Patsnap) — technical elements, synonyms, search strategy shipped with every agent report.
5. **LLM-extracted fields as a searchable index, not chat output** (Patsnap Patent DNA) — structural, compounding, hard to copy.
6. **No-training-data custom taxonomy** (Clarivate AI Classifier) — plain-English class definitions producing a counted matrix. The correct whitespace primitive.
7. **User folders as classifier training data** (Minesoft AI Alerts) — near-free personalisation from curation users already perform.
8. **Examiner-citation supervision with a published benchmark** (Questel QaECTER; IPRally's GNN; PQAI) — the emerging consensus training signal. If a ranking model is not supervised on citation or rejection data, it is behind.
9. **Limitation-level claim mapping with visible rationale** (Patsnap SEP Claim Chart).
10. **Show difference, not just similarity** (NLPatent) — the delta is what becomes the distinguishing argument. Almost nobody does this.
11. **Architectural separation of retrieval from reasoning** (IP.com dual engine) — grounding auditable by construction. **This validates our deterministic-measurement / LLM-language split (9.4).**
12. **A product guarantee that AI never silently excludes** (Amplified) — removes the searcher's deepest fear at zero cost.
13. **Explicit data-privacy posture as a sales asset** (Patsnap) — prompts and data excluded from training, stated plainly.

## 2.9 Weaknesses worth avoiding

1. **Whitespace as a blank pixel** — the category's central unearned claim, contradicted by the discipline's own standard-setter.
2. **Silent data exclusions inside visualisations** — documented at three vendors, surfaced by none.
3. **Aspirational capability copy** — IPRally's whitespace framing sits above features still in preview. Buyers who check once will discount everything else a vendor says.
4. **Export as an afterthought** — Orbit reviewers report export formats that are not usage-ready and record caps requiring email delivery **[V]**.
5. **Breaking changes without notice** — Orbit reviewers report data-format changes that broke downstream imports **[V]**.
6. **Learning curves treated as a moat** — five of six incumbents have documented onboarding complaints **[V]**.
7. **Product-surface fragmentation** — a user's real workflow crosses three or four SKUs, and the seams are where the manual work lives.
8. **Documentation lagging the product** — PatBase's analytics manual mentions AI zero times while the product ships three AI features.
9. **Unaudited accuracy claims** — 78%, 97%, 81%, "83× more accurate than ChatGPT". All vendor-reported, none independently replicated. Questel alone built a formal benchmark and promises to publish it.
10. **Confusing invention *harvesting* with invention *generation*** — half the market markets the former as the latter.

## 2.10 Unmet needs and where we fit

The research supports five specific openings, in descending order of defensibility.

**1. A whitespace artefact that is not a picture.** Six incumbents, one genuine whitespace primitive between them (Clarivate's counted taxonomy matrix). Nobody produces a ranked list of candidate gaps with evidence and confidence. This is the largest open capability in the category, and it is precisely what Sections 6.15 and 6.16 specify.

**2. Explaining *why* a gap exists.** **No vendor — incumbent, AI-native or free — distinguishes "nobody thought of it" from "everyone tried and it does not work" from "it is unpatentable" from "the field calls it something else."** This is exactly the judgment users currently pay analysts for, and it is the whole purpose of our ten-type system and gate ladder. It is the single clearest differentiation available.

**3. Nobody closes the loop.** No product identifies a claim-level gap, generates concepts *targeted at that gap*, verifies each against prior art at feature level, and emits draftable claim scaffolding on one evidence trail. XLSCOUT generates from a user's problem statement, not from a structurally-derived gap. IP.com has grounding and disclosure output but weak whitespace linkage. IPRally has the best feature-level machinery and has deliberately declined to generate. The Lens has the right conception — mining claims for whitespace — and no AI to execute it. **We already own both ends of this loop.**

**4. Claim-element analysis outside SEP.** The best claim tooling in the market is standards-specific (Patsnap's 3GPP charts, IPlytics' essentiality scores). General-purpose claim-element analysis remains substantially manual. And we found **no peer-reviewed methodology for claim-element-level whitespace detection at all** — a genuine gap in the literature, and the strongest defensible technical position available to us, because element-level absence is the only kind of absence with legal meaning.

**5. Transparent pricing.** Two vendors out of roughly twenty publish real numbers. The resulting vacuum is filled by aggregator guesses ranging from €3,000 to $72,000 per year for the same product. Publishing ours is a marketing asset, not a concession.

**What we should not attempt.** Corpus breadth (Patsnap and Clarivate are decades ahead), curated data quality (DWPI's 800 editors), legal-status depth, jurisdiction coverage, or standards data. Those races are lost before they start. Our advantage is methodological and architectural, and it is available now.

---

# Section 3 — Product strategy

## 3.1 Jobs to be done

Ordered by how strongly they pull, based on the workflows the module must serve:

**JTBD-1 — "Tell me where to file next year."**
*Corporate R&D / IP manager.* Has budget for N filings, needs a defensible allocation across technology areas. Currently answered by consultant reports (expensive, slow, stale on arrival) or internal intuition. The job is not "show me a landscape" — it is "give me a ranked, defensible set of directions I can take to a review board." **This is the anchor job.**

**JTBD-2 — "Is this idea already taken, and if so what's the adjacent open direction?"**
*Inventor / founder / attorney.* Has a specific idea. Existing novelty search answers the first half. Nothing answers the second half — when the answer is "yes, crowded", the user is left with nothing. Whitespace Studio turns a negative novelty result into a set of adjacent directions. **This is the highest-frequency job and the best entry point from our existing product.**

**JTBD-3 — "Where is our research group's work patentable?"**
*University TTO / research lead.* Has publications, needs to find which parts have patent space around them. Requires the science-vs-patent comparison as a first-class view.

**JTBD-4 — "What is our competitor not covering?"**
*Corporate IP strategist.* Assignee-centric rather than field-centric entry. Wants portfolio gaps, design-around directions, and expiry-driven openings.

**JTBD-5 — "Is this company's IP position real?"**
*Investor / diligence analyst.* Read-only, report-oriented, time-boxed. Needs defensible summary output more than exploration.

**JTBD-6 — "Keep watching this space for me."**
*All segments, post-analysis.* The recurring-revenue job. Once a user has defined a field and a hypothesis, they want to know when the picture changes.

## 3.2 Primary workflows

Three, and the module should make all three feel native rather than privileging the first:

**Workflow A — Field-first (the flagship).** Describe a field → review scope → observe landscape → shortlist areas → generate hypotheses → validate → develop → hand off. Serves JTBD-1 and JTBD-3. This is the full seven-stage pipeline of Section 9.

**Workflow B — Idea-first (the volume driver).** Start from an existing disclosure or a completed novelty search → the system derives the field from the idea → jumps straight to "here is the neighbourhood of your idea, here is what's crowded, here are three adjacent openings". Serves JTBD-2. **This should be reachable in one click from a novelty search result page**, especially a negative one, and it is the single highest-leverage integration in the whole plan.

**Workflow C — Competitor-first.** Start from an assignee → their portfolio becomes the map → gaps are computed relative to their coverage and the field's. Serves JTBD-4 and JTBD-5.

All three converge on the same hypothesis object and the same Evidence Room. Only the entry differs.

## 3.3 Personas

**Priya — Corporate IP Manager, industrial electronics, 400-person R&D org.**
Files ~40 patents a year across five business units. Runs an annual "filing direction" exercise that currently takes six weeks and produces a deck nobody trusts. Reads CPC codes fluently. Sceptical of AI output but pragmatic. *Needs:* defensible ranked directions, exportable evidence, the ability to say "here's why we rejected X". *Fails us if:* the system produces a confident recommendation she can't defend to a review board.

**David — Partner, IP boutique, prosecution plus advisory.**
Bills advisory work at a premium. Uses professional search tools daily; will immediately spot a tool that overstates its coverage. *Needs:* claim-level rigour, explicit non-legal-conclusion framing, exportable work product with methodology stated. *Fails us if:* the tool implies a patentability or freedom-to-operate conclusion — that's a liability, not a feature.

**Dr. Chen — Principal investigator and TTO liaison, university materials group.**
Publishes before she patents (and knows this is a problem). Fluent in literature, illiterate in CPC. *Needs:* science-vs-patent comparison, plain-language scope building, disclosure generation. *Fails us if:* the interface requires classification knowledge to start.

**Marcus — CTO, 18-person hardware startup.**
Needs a defensible IP position for a Series A, has no IP function, three weeks of attention. *Needs:* speed, plain language, direct path to a filing, cost transparency. *Fails us if:* the module is a research tool that doesn't end in a draft.

**Anna — Innovation consultant.**
Resells analysis. *Needs:* white-labelled export, methodology transparency, multi-client project organisation. *Fails us if:* output isn't presentable to her own clients.

## 3.4 What changes by role

Shared by everyone: scope builder, landscape, cluster explorer, hypothesis board, Evidence Room, coverage disclosures. The core analysis must never fork — one methodology, one set of numbers.

What changes is emphasis, defaults and vocabulary:

| Role | Default landing view | Vocabulary | Emphasised capability | De-emphasised |
|---|---|---|---|---|
| Corporate R&D | Field overview + heatmap | Technology areas, filing direction | Ranked opportunities, portfolio overlay, monitoring | Claim-element detail |
| Patent attorney | Claim-element map | Independent claims, elements, prosecution | Claim analysis, design-around, exportable methodology | Market/commercial signals |
| University / TTO | Science-vs-patent view | Publications, research fronts, translation | Research-to-patent ratio, disclosure generation | Competitor portfolios |
| Startup founder | Idea-first entry | Plain language throughout | Speed to draft, cost clarity | CPC exploration, HHI |
| Investor / diligence | Report builder | Position, coverage, risk | Export, competitor comparison | Invention development |
| Consultant | Projects list | Client-neutral | White-label export, multi-project | — |

Implementation: a single `role` preference on the study, set at creation with a sensible default from the tenant's plan and the user's prior behaviour, controlling (a) default landing tab, (b) which of the six insight cards appear first, (c) glossary tone. **Not** controlling which analysis runs. A user must always be able to reach every view — role tailoring is ordering, not gating.

## 3.5 Differentiation strategy

We will not win on corpus size (Clarivate and PatSnap have decades of curated data and full-text coverage we don't), on legal-status depth, or on breadth of jurisdictions. Competing there is a losing race.

We win on three things we can actually hold:

1. **Judgment over display.** The type system and the disproof loop. This is a methodology and product-design advantage, not a data advantage, which means it is available to us now and is genuinely hard to copy — not technically, but organisationally. An incumbent whose product is a visualisation platform cannot easily ship a feature whose main job is to tell users that most of what their map shows is not an opportunity.
2. **The closed loop to drafting.** We own novelty search and drafting. An opportunity becomes a disclosure becomes a draft inside one product with one evidence trail. Standalone analytics vendors would need to build a drafting product; drafting vendors would need to build an analytics platform.
3. **Honest coverage as a feature.** Our data has real limits (2000-present, claims mostly US/EP/IN, no citation graph). Rather than hiding these, we surface them — per-area text coverage, explicit exclusions on every hypothesis, and untestable checks named on the artefact rather than omitted. Sophisticated users trust a tool that tells them where it's blind far more than one that doesn't mention blindness. This converts our biggest weakness into a trust asset. It is also the correct thing to do.

4. **Reproducibility and confidentiality, as architectural consequences.** Because production runs entirely against local data (9.0), a study re-run on the same scope and corpus snapshot returns the same answer — which is what RIPL item 14 and WIPO's reproducibility rule actually require, and which no competitor dependent on external providers can deliver. The same property means invention details never reach a third-party patent service. Both are unusual claims in this market and both are consequences of the architecture rather than features we have to maintain.

## 3.6 Trust and explainability strategy

This module makes claims that could cost a user real money if wrong. The trust strategy is therefore not a UI veneer; it is architectural.

**Principle 1 — Deterministic where possible, LLM where necessary.** Stages 1 and 3 (census and signals) are pure SQL and arithmetic. No language model touches the numbers. This means the landscape is reproducible: same scope, same day, same result. LLMs are used for naming, extraction, synthesis and critique — tasks where they excel — and never for measurement.

**Principle 2 — Every number is a link.** No statistic appears without a path to the underlying families and the query that produced them. The Evidence Room (Section 6.17) is the backbone, not a feature.

**Principle 3 — The system argues against itself, visibly.** Contradicting evidence is rendered with equal weight to supporting evidence. A hypothesis card that has survived attack shows what attacked it. This is the single most trust-building element in the design, and it is why "Red Team" is a screen and not a hidden pipeline step.

**Principle 4 — Confidence is a vector, never a number.** A single "opportunity score" would be the most dangerous thing we could ship. Section 10.4 defines six independent dimensions; the composite exists only to order a list and is always shown decomposed.

**Principle 5 — Analytical indicators are never legal conclusions.** The system says "no independent claim in our retrieved set recites this element combination". It never says "this is patentable" or "you are free to operate". This distinction is enforced in prompt design, in UI copy, and in export templates. Section 14.5 lists the specific phrases that must never appear.

**Principle 6 — Coverage limitations travel with the artefact.** Every hypothesis carries a non-optional `coverageLimitations` field, populated automatically, and it is rendered on screen and in every export. A hypothesis that leaves our system without its caveats is a bug.

## 3.7 Minimum viable product

Scoped in Section 11 in detail. In one sentence: **the MVP is the full seven-stage pipeline over patents plus keyless scientific literature, with the type system and the disproof loop intact, and without citation analysis, legal status, or market data.**

The temptation will be to ship the landscape first and the judgment later, because the landscape is easier. **This would be a strategic error.** A landscape-only release is a worse version of five existing products and teaches users to think of us as a chart tool. The disproof loop is the product; if we can only ship one thing, ship that.

## 3.8 Roadmap

**Phase 1 (MVP, ~4 months).** Workflows A and B. Seven-stage pipeline. Patent corpus plus keyless literature providers. Type system, gate ladder, Evidence Room, scoring vector. Novelty and drafting handoffs. Exports.

**Phase 2 (~3 months after).** Citation enrichment on shortlists and the influence metrics it unlocks. Legal event data. Cross-domain transfer explorer. Product-to-patent mapping. Workflow C (competitor-first). Full-field cluster census.

**Phase 3 (enterprise, ~3 months after).** Monitoring and delta alerts. Multi-user studies with roles and comments. Portfolio overlay. API access. Custom corpus ingestion.

Rationale for the ordering: Phase 1 is everything that is credible on data we already have. Phase 2 is everything gated on ingesting data we don't have. Phase 3 is everything gated on having enough users for collaboration to matter. Each phase is independently sellable.

---

# Section 4 — Information architecture

## 4.1 Placement in the app

Whitespace Studio sits as a top-level module alongside the existing studios, reachable from `MAIN_NAV` in [AppShell.tsx](src/components/AppShell.tsx) and from a dashboard tile in [UserDashboard.tsx](src/components/dashboards/UserDashboard.tsx).

It renders **inside** AppShell (not in `IMMERSIVE_PATTERNS`) for the launcher and report views, and switches to a full-height workspace chrome for the study workspace itself — the same treatment Prior-Art Studio uses, so the sidebar collapses but breadcrumbs persist.

## 4.2 Route tree

```
/whitespace                                  Module landing / studies list
  /new                                       New study setup (3-step wizard)
  /[studyId]                                 Study workspace (shell for all views below)
    ?view=scope                              Scope & query review
    ?view=overview                           Executive opportunity overview  [default after first run]
    ?view=landscape                          State-of-the-art landscape
    ?view=taxonomy                           Technology taxonomy explorer
    ?view=clusters                           Semantic cluster explorer
    ?view=matrix                             Problem–solution–constraint matrix
    ?view=claims                             Claim-element map
    ?view=citations                          Citation & influence network        [Phase 2]
    ?view=science                            Science vs patent activity
    ?view=products                           Product-to-patent comparison        [Phase 2]
    ?view=competitors                        Competitor portfolio comparison
    ?view=opportunities                      Whitespace opportunity list
    /opportunity/[hypothesisId]              Individual opportunity detail
      ?panel=evidence                        Evidence Room (drawer)
      /challenge                             Red-team / hypothesis challenge
    /crossdomain                             Cross-domain opportunity explorer   [Phase 2]
    /concept/[conceptId]                     Invention development workspace
    /report                                  Report builder
    /monitor                                 Monitoring configuration            [Phase 3]
    /collaborate                             Collaboration & expert review       [Phase 3]

/api/whitespace/studies                      GET list, POST create
/api/whitespace/studies/[id]                 GET, PATCH, DELETE
/api/whitespace/studies/[id]/scope/compile   POST — NL brief → structured scope
/api/whitespace/studies/[id]/runs            POST — start a stage run (202)
/api/whitespace/studies/[id]/runs/[runId]    GET — poll run status
/api/whitespace/studies/[id]/clusters        GET tree
/api/whitespace/studies/[id]/clusters/[cid]/subcluster    POST (202)
/api/whitespace/studies/[id]/clusters/[cid]/deep-dive     POST (202)
/api/whitespace/studies/[id]/hypotheses      GET, POST
/api/whitespace/studies/[id]/hypotheses/generate          POST
/api/whitespace/studies/[id]/hypotheses/[hid]/validate    POST (202)
/api/whitespace/studies/[id]/hypotheses/[hid]/challenge   POST — user-directed attack
/api/whitespace/studies/[id]/evidence        GET (filtered by stance, hypothesis)
/api/whitespace/studies/[id]/concepts        GET, POST
/api/whitespace/studies/[id]/concepts/[cid]/handoff/novelty   POST
/api/whitespace/studies/[id]/concepts/[cid]/handoff/drafting  POST
/api/whitespace/studies/[id]/export          GET (xlsx | pdf | docx)
```

## 4.3 Navigation hierarchy inside a study

The workspace uses a **two-level nav**: a mode switch (Observatory / Lab) and, within each, a view rail.

```
┌─ OBSERVATORY ────────────────┐   ┌─ LAB ────────────────────────┐
│  Overview                    │   │  Opportunities               │
│  Landscape                   │   │  Opportunity detail          │
│  Taxonomy                    │   │   └ Evidence Room            │
│  Clusters                    │   │   └ Red Team                 │
│  Claim elements              │   │  Cross-domain      [Phase 2] │
│  Science vs patents          │   │  Invention workspace         │
│  Competitors                 │   │  Report builder              │
│  Citations         [Phase 2] │   └──────────────────────────────┘
│  Products          [Phase 2] │
└──────────────────────────────┘
```

Scope sits above the mode switch — it is the study's premise, editable at any time, and changing it invalidates downstream runs (with an explicit warning and a version bump rather than silent recomputation).

Rationale for this split: it maps to the user's actual mental state. In Observatory they are asking "what is true?"; in Lab they are asking "what should I do?". Mixing recommendation cards into a landscape view — which is what most competitors do — encourages users to read a chart as advice. Separating the modes makes the epistemic status of each screen unambiguous.

## 4.4 Cross-module entry and exit points

**Entry:**
- Sidebar and dashboard tile (cold start → Workflow A)
- **Novelty search result page → "Explore the space around this idea"** (Workflow B) — highest-leverage placement, especially on low-novelty results
- Idea Bank idea → "Find whitespace near this idea"
- Drafting session → "What else is open in this area?"
- AISpotlight suggestion card when a user's recent novelty search returned a crowded result

**Exit:**
- Open edge / matrix cell / cluster → **ideation mind-map** (divergence — see 8.11)
- Hypothesis → novelty search (validation)
- Concept → drafting session (creation)
- Study → monitoring (retention)
- Report → export or share link

The ideation exit is bidirectional and is the one that distinguishes this module: whitespace evidence seeds the mind-map, and the ideas it produces come back as hypotheses for gating.

---

# Section 5 — End-to-end user journey

The journey below is Workflow A in full. Times are estimates for a mid-size field (roughly 5,000–30,000 families).

### Step 1 — Define the field *(2 minutes, user effort)*

The user types a paragraph. No classification knowledge required, no Boolean syntax, no forced field selection. Examples of valid input: a problem statement, an existing disclosure pasted in, a patent number, a paper DOI, a product URL, a competitor name.

The system's job here is to make the *next* screen good, so the input box is deliberately generous — it accepts anything and the scope screen does the disambiguation.

### Step 2 — Review and correct the scope *(3 minutes, user effort — the most important interaction in the product)*

The system returns a structured, editable scope: core concepts, expanded synonyms and functional phrasings, the vocabulary the field actually uses, candidate CPC codes with plain-language glosses, proposed exclusions, date range, jurisdictions — and, critically, **a written list of the assumptions it has made**.

This screen exists because scope errors are the dominant source of wrong answers in patent analytics, and because a user who corrects the scope has invested in the result and will trust it more. We deliberately spend user time here rather than hiding it.

The user can add a synonym the system missed, remove a CPC code that drags in an unrelated field, exclude a sub-area, or widen the date range. Each edit shows an immediate estimated family count so the consequences are visible before committing.

### Step 3 — Observe the landscape *(4 minutes system time, then exploration)*

The field census runs. The user watches a progress experience that shows what is being computed rather than a spinner (Section 6.4).

What comes back: how big the field is, how it has grown, where it is filed, who owns it, how it is classified, and how much of it we can read at claim level. Then the clustering names the field's technology areas — this is the moment where a user typically says "yes, that's my field" or "no, you've dragged in the wrong thing", and the latter sends them back to scope.

### Step 4 — Find the interesting areas *(exploration, 10–20 minutes)*

Signals overlay the map: which areas are crowded, which are accelerating, which are dominated by one player, where the field's vocabulary diverges from ours. The user drills into areas, reads representative patents, and shortlists two to four areas worth deeper analysis.

This is the last free step. Everything after it is metered.

### Step 5 — Deep-dive the shortlist *(8–15 minutes system time per area)*

For shortlisted areas the system pulls real claim text and extracts claim elements, computes which elements travel together and which almost never do, and builds a problem–solution–constraint matrix from the descriptions.

### Step 6 — Generate hypotheses *(2 minutes system time)*

The system proposes structured opportunities. Each arrives untyped and unproven, marked as such, with its supporting evidence already linked. Typically six to ten from three deep-dived areas.

### Step 7 — Stress-test *(4–8 minutes system time per hypothesis)*

The gate ladder and the disproof loop run. Some hypotheses are re-typed (a "gap" turns out to be a terminology artefact). Some are refuted outright. The survivors carry a confidence score and a record of what they survived.

**This is the emotional centre of the product.** The user watches the system kill its own ideas. Done well, this is what converts scepticism into trust — and it is why the validation screen is designed as a visible process rather than a background job with a result.

### Step 8 — Develop the direction *(15–40 minutes, user effort, AI-assisted)*

The user picks a survivor and opens the invention workspace: refine the problem, sketch an architecture, list components, propose alternative embodiments, state the technical effect, position against the closest prior art in a differentiation table. The user's own domain knowledge enters here — the system is explicitly a drafting partner at this stage, not an oracle.

### Step 9 — Validate properly

"Run a novelty search on this" hands the concept to the existing novelty pipeline with features pre-extracted. The user gets the full attorney-grade novelty assessment they would have got had they started there — except the idea itself came from evidence rather than a brainstorm.

### Step 10 — Convert

"Start drafting" seeds a drafting session with the concept, the closest art, and claim guidance. The user is now in the existing product.

### Step 11 — Monitor *(ongoing)*

The study can be kept alive: re-run monthly, alert when a competitor files in a shortlisted area, when a hypothesis's supporting evidence weakens, or when a blocking family lapses.

## 5.1 Where this journey improves on the brief's proposal

The brief proposed a nine-step workflow. Three changes, each with a reason:

1. **Scope review is promoted to a first-class step with explicit user commitment.** The brief treated it as part of definition. In practice it is where analyses go wrong, and making the user an author of the scope is the cheapest trust mechanism available.

2. **Shortlisting is an explicit gate between free and metered work.** The brief moved continuously from "identify underexplored areas" to "generate hypotheses". Inserting a deliberate user decision there both controls cost and improves quality, because the user's domain judgment about which areas are worth money is better than our heuristics.

3. **Stress-testing is a visible step, not a background quality process.** The brief listed it as step 6 of 9 among peers. It should be the step the product is *known* for. Users should be able to describe our product as "the one that tries to prove itself wrong".

One thing the brief got right that we should preserve carefully: the journey ends at a patent project, not a report. Every step should be answerable to the question "does this get the user closer to a filing?"

---

# Section 6 — Screen-by-screen UI specification

## Conventions applying to all screens

Rather than repeat them 24 times, these hold everywhere unless a screen overrides them.

**Layout skeleton.** Header (study title, scope summary chip, mode switch, run status, primary action) → left view rail (collapses to icons at `lg`, drawer below) → main canvas → right context panel (collapsible, 380px) → evidence drawer (bottom or right, 50% max, dismissible). This is the same skeleton as Prior-Art Studio's workspace, so it will feel familiar to existing users.

**Coverage strip.** Every analytical screen carries a persistent, quiet one-line strip: *"2000–present · 12,400 families · claims readable for 62% of this area · no citation data"*. It is small, grey, always present, and clickable to a full coverage panel. This single element does more for trust than any amount of confidence styling.

**Confidence rendering.** Never a single number without decomposition. Six-segment micro-bar with a hover breakdown; low-confidence states desaturate the card rather than hiding it.

**Empty states** state what will appear and offer the action that produces it. Never a shrug.

**Loading states** narrate the specific work in progress with real counts (Section 6.4), never a generic spinner for anything over 2 seconds.

**Error and low-confidence states** are distinct. An error means we failed; a low-confidence state means we succeeded and the answer is weak — which is information, and must never be styled as a failure.

**Mobile.** Analytical canvases (maps, matrices, networks) are *view-only* below `md`, with a "best viewed on desktop" affordance and a scrollable summary-list fallback rendering the same data as ranked rows. Reading screens (opportunity detail, Evidence Room, reports) are fully responsive and genuinely useful on a phone — an attorney reading a hypothesis on the train is a real use case; one exploring a cluster map is not.

---

## 6.1 Module landing page — `/whitespace`

**Purpose.** Get a returning user back into work in one click, and give a first-time user a reason to start.
**Primary question.** *"What was I working on, and what should I start?"*

**Components.** Header with "New study". A studies list (card grid): title, field summary, stage badge, surviving-hypothesis count, last-run date, sparkline of field filing trend. Above it, for returning users, a "Needs attention" band: studies with completed runs unviewed, hypotheses whose evidence changed, monitored fields with new filings. For first-time users the band is replaced by a three-panel explainer of the Observatory→Lab→Draft arc plus two worked example studies (read-only, real, pre-computed) the user can open immediately.

**Hierarchy.** Attention band → studies → templates/examples. Not: marketing copy above the user's own work.

**Actions.** New study; open; duplicate (re-run a scope with a new date range); archive; open example.

**AI assistance.** None here. Deliberately — the landing page should be fast and boring.

**Empty state.** The three-panel explainer plus example studies, plus three seeded field suggestions derived from the tenant's existing patents and drafting sessions ("You have 4 drafts in medical imaging — explore that field?"). This is a strong activation lever and cheap to build.

**Loading.** Skeleton cards.
**Error.** Inline retry per card; a failed card never blocks the list.
**Mobile.** Single-column list; full function.

---

## 6.2 New whitespace study setup — `/whitespace/new`

**Purpose.** Capture intent with the least possible friction and the fewest decisions.
**Primary question.** *"What field do you want to understand?"*

**Components.** A single large text area, generously sized, with a prompt that invites prose: *"Describe the technology area, the problem you're trying to solve, or paste a disclosure, patent number, paper DOI or product page."* Beneath it, a quiet row of alternate starting points (From a patent number · From one of my ideas · From a novelty search · From a competitor). Below the fold, an optional "Advanced" disclosure with date range, jurisdictions and known CPC codes for users who want them — collapsed by default and never required.

**Hierarchy.** One input dominates. Everything else is subordinate and optional. Resist the urge to add fields; every one added measurably reduces completion.

**Actions.** Continue (→ scope compile). Choose a role preset (affects defaults only; explained in a tooltip, not a modal).

**AI assistance.** On paste of a patent number, DOI or URL, an inline resolve-and-preview: *"Looks like US 11,123,456 B2 — 'Photoacoustic sensor for…'. Use this as the seed?"* Fast, cheap, and it makes the input box feel intelligent immediately.

**Empty state.** N/A. **Loading.** Button spinner → scope compile takes 5–15s and transitions to 6.3 with its own progress.
**Error.** If the brief is too vague to compile (under ~10 meaningful words, or no technical content), don't fail — ask one targeted clarifying question inline rather than erroring.
**Mobile.** Fully usable; this is the one creation flow that must work on a phone.

---

## 6.3 Field scope and query review — `?view=scope`

**Purpose.** Make the research premise explicit, correctable and owned by the user.
**Primary question.** *"Is this what I actually meant — and does the system understand my field?"*

**Components.** Four editable panels plus a live estimate.

1. **Concepts.** Core concepts as chips; each expandable to show synonyms, functional phrasings, acronyms and scientific vs industry terminology, individually removable. A concept can be marked *required* or *optional*.
2. **Classification.** Proposed CPC codes, each with a plain-language gloss and an estimated family count. Codes the system is unsure about are visually flagged with a one-line reason ("broad — may pull in unrelated imaging"). Add/remove freely.
3. **Boundaries.** Date range, jurisdictions, exclusions (as chips with reasons), assignee filters.
4. **Assumptions.** A written, plain-English list: *"I assumed 'non-invasive' excludes implantable sensors"*, *"I treated 'wearable' as including patch-form devices"*, *"Corpus covers 2000–present only"*. Each assumption is individually correctable, and correcting one re-runs the compile.

To the right, a persistent **estimate card**: family count, date distribution sparkline, top 5 CPC codes by volume, jurisdiction split — updating live (debounced) as the user edits, so consequences are visible before committing.

**Hierarchy.** Concepts first (most consequential), assumptions last but visually distinct — a bordered, slightly warm panel, because these are the things that most often need fixing and are most often skipped.

**Actions.** Edit any element; "Suggest more synonyms"; "Show me what this excludes" (samples 20 families excluded by current filters — an excellent trust device); Run field map; Save as template.

**AI assistance.** Contextual, attached to objects, never a floating chatbot: *Expand this concept* · *Find the terms this field actually uses* · *Is this CPC code right for my field?* · *What am I missing?*

**Evidence presentation.** Every CPC suggestion links to a sample of 10 families it would bring in. Every synonym shows how many additional families it adds. Scope decisions are made against data, not vibes.

**Filters / drill-down.** Clicking any estimate element drills to a sample list.

**Empty / loading.** Compile shows the four panels filling progressively (concepts → classifications → boundaries → assumptions), which reads as thinking rather than waiting.
**Low-confidence state.** If the compiler is unsure the field is coherent (e.g. the brief spans two unrelated domains), it says so at the top and offers to split the study into two — rather than silently producing a mush cluster later.
**Mobile.** Usable, accordion-collapsed panels; the estimate card moves below.

---

## 6.4 Analysis progress experience

**Purpose.** Convert a 4-minute wait into trust rather than doubt.
**Primary question.** *"Is this working, and what is it actually doing?"*

**Components.** A staged progress rail (reusing the [NoveltyStageNav](src/components/novelty-search/NoveltyStageNav.tsx) idiom) with the seven stages, current stage expanded to show live counts: *"Counting families by classification — 8,200 of ~12,400"*, *"Sampling 50,000 families across 26 years"*, *"Naming 24 technology areas"*. Completed stages collapse to a one-line result the user can already read: *"Field size: 12,400 families · peak filing 2018"*.

**The key design decision:** partial results are readable as they land. The user can start reading the field size and trend while clustering is still running. Nothing is gated behind full completion.

**Actions.** Run in background (returns user to the studies list, notifies on completion); cancel; view partial results.

**AI assistance.** None during progress — resist narrating with an LLM; it adds cost and latency to a stage whose job is to feel fast.

**Error state.** Per-stage. A failed stage shows which one, why, and what is still usable: *"Clustering failed (timeout). Field statistics are complete and usable. Retry clustering?"* Never discard completed work.
**Low-confidence.** If the sample is unrepresentative (e.g. field too small to stratify), say so here rather than later.
**Mobile.** Fully responsive; this is a screen users will check on a phone.

---

## 6.5 Executive opportunity overview — `?view=overview`

**Purpose.** The one screen a busy user reads. Answer the whole study in 30 seconds.
**Primary question.** *"What did we find, and what should I do about it?"*

**Components.** Top: a one-paragraph plain-language field verdict, LLM-written from deterministic inputs, and constrained to state only what the numbers support. Then four to six **insight cards**, ordered by role, each a single claim with a number, a micro-visual and a link: *"Two companies hold 34% of this field"* · *"Filing has declined 18% since 2019 while publications rose 22%"* · *"Your vocabulary misses 31% of the relevant art"*.

Below: the **opportunity funnel** — a horizontal band showing hypotheses generated → survived gate ladder → validated, with counts, styled after [GatesFunnel](src/components/prior-art-studio/GatesFunnel.tsx). Clicking a segment filters the opportunity list. Rejected hypotheses are *visible and clickable here*, not hidden — "we rejected 5 for these reasons" is a headline, not a footnote.

Right rail: study status, what's been run, what's available to run next with its cost.

**Hierarchy.** Verdict → insight cards → funnel → next actions. If a user reads only the first two lines they should still have learned something true.

**Actions.** Jump to any opportunity; run the next stage; export; share.

**AI assistance.** *Explain this verdict* · *What would change your mind?* · *Summarise for a non-technical stakeholder*.

**Evidence presentation.** Every insight card number links to its underlying view.

**Empty state.** Before the first run: the funnel greyed with a clear "Run field map" CTA and an estimate of time and cost.
**Low-confidence state.** If no hypothesis survived, this screen says so prominently and constructively: *"No opportunity in this field survived validation. Here's what blocked each one — and two adjacent fields worth checking."* **A null result must feel like a finding, not a failure.** This is a genuinely important state and a differentiator; most tools cannot produce a defensible negative.
**Mobile.** Full support, single column — this is the most-viewed screen on mobile.

---

## 6.6 State-of-the-art landscape — `?view=landscape`

**Purpose.** The market-parity view. Everything a user expects from a landscape tool, without the chart dump.
**Primary question.** *"What does this field look like?"*

**Components.** Six panels, each answering one named question, arranged in a two-column grid. Every panel has its question as its title — literally, e.g. *"Is this field growing?"* rather than *"Filings over time"*.

1. *Is this field growing?* — filing volume by year, with a publication-count overlay toggle.
2. *Where is it protected?* — jurisdiction distribution, family-level, with a coverage-breadth metric.
3. *Who owns it?* — top assignees, canonicalised, with concentration (HHI) stated in words: *"moderately concentrated — top 3 hold 41%"*.
4. *How is it classified?* — CPC distribution with plain-language glosses and a co-classification pair list.
5. *How mature is it?* — filing-age distribution and grant-kind proxy split, clearly labelled as a proxy.
6. *Can we read it?* — text coverage: what fraction has retrievable claims, by jurisdiction and source. **No competitor shows this. It is unglamorous and it is the most honest panel in the product.**

**Hierarchy.** Growth and ownership first; coverage last but never omitted.

**Actions.** Toggle overlays; change the date window (with a "what changed?" diff mode, Section 8.6); filter to a cluster and see all six panels re-render for that subset; export any panel.

**AI assistance.** Per panel: *Explain this pattern* · *Is this normal for a field this size?* — the second is valuable and rare; benchmark context is what turns a number into a judgment.

**Evidence.** Every bar and point drills to its family list.
**Filters.** Date, jurisdiction, assignee, cluster, legal-status proxy, CPC — applied globally across all six panels and reflected in the coverage strip.
**Empty / loading.** Panels populate independently as facet queries return.
**Low-confidence.** Small fields (<200 families) show a warning that statistics are unstable and suppress percentage-based claims.
**Mobile.** Charts become scrollable cards; each remains readable.

---

## 6.7 Technology taxonomy explorer — `?view=taxonomy`

**Purpose.** Give structure to a field without requiring classification literacy.
**Primary question.** *"How does this field break down, and along what dimensions?"*

**Components.** A zoomable tree (Section 8.1) with the field at the root, decomposed along **domain-adaptive dimensions** — this is important and Section 9.6 specifies the mechanism. A mechanical field decomposes into mechanism / components / materials / manufacturing; a software field into inputs / algorithms / data sources / deployment; a biotech field into target / modality / delivery / indication. The taxonomy template is selected by the LLM from the field's CPC profile and is **visible and switchable by the user** — a dropdown reading "Viewing as: device architecture ▾" with alternates.

Each node shows family count, trend arrow and crowdedness band. Nodes can be pinned to a comparison tray.

**Hierarchy.** Structure over statistics — this screen is about shape, with numbers as annotation.

**Actions.** Expand/collapse; switch decomposition dimension; pin to tray; filter the whole study to a node; "show me patents here"; suggest a missing branch.

**AI assistance.** *Why is this branch empty?* · *Add a dimension I'm missing* · *Re-decompose along [user's own axis]* — the last is powerful: a user with domain expertise can impose their own taxonomy and the system re-buckets the corpus against it.

**Evidence.** Node → representative families with the classification and semantic reasons for membership.
**Empty state.** Before clustering: a CPC-derived skeleton taxonomy is still shown (cheap, deterministic), so this screen is never blank.
**Low-confidence.** Nodes whose membership is semantically diffuse are marked; the tree does not pretend to crispness it lacks.
**Mobile.** Collapsible nested list; no zoom canvas.

---

## 6.8 Semantic cluster explorer — `?view=clusters`

**Purpose.** Let a user navigate the field by meaning rather than by classification. The screen most at risk of becoming a beautiful, useless blob — Section 8.2 addresses this directly.
**Primary question.** *"What are the real technology areas here, and which are worth my attention?"*

**Components.** Split view, not a full-bleed map. **Left (60%):** cluster scatter — each cluster a labelled circle sized by family count, positioned by centroid PCA, coloured by crowdedness, with a diffuseness ring for low-cohesion clusters. **Right (40%):** the selected cluster's dossier — name, plain-language technical summary, representative patents, dominant claim concepts, top assignees, filing trend, jurisdiction spread, cohesion grade, distinction from neighbours, and *confidence in the cluster interpretation*.

The anti-blob rules, enforced in the design:
- Every cluster has a human-readable name and a one-paragraph summary. A cluster we cannot name is a cluster we do not show.
- The map is never the only representation; a ranked **list view** toggle shows the same clusters as rows with sortable metrics. Many users will live in the list, and that is fine.
- Position is explained: hovering the gap between two clusters explains what separates them.
- Low-cohesion clusters are visibly marked "diffuse — drill down for structure" and are excluded from automated hypothesis generation.

**Hierarchy.** Selected cluster's dossier outranks the map. The map is a selector, not the payload.

**Actions.** Select; drill down (recursive sub-clustering, 10–30s); merge two clusters (user override, recorded in the trail); rename; exclude from study; shortlist for deep dive; compare two clusters side by side.

**AI assistance.** *Explain this cluster* · *How is this different from [neighbour]?* · *Why is this area crowded?* · *Why does this look underexplored?* — the last routes into a preliminary gate check rather than a guess.

**Evidence.** Every cluster → its medoid families with distance scores; every metric → its family set.
**Filters.** Date, assignee, jurisdiction, cohesion band, crowdedness band. Filtering re-renders metrics but not cluster membership (membership is fixed at run time; changing it requires a re-run, and the UI says so).
**Drill-down.** Field → cluster → sub-cluster → family → claim element. Breadcrumbed, depth-capped at 3.
**Empty state.** "Clustering hasn't run" with cost and time estimate.
**Loading.** Sub-clustering renders in place with a shimmer on the expanding node.
**Low-confidence.** A field that clusters poorly (all clusters diffuse) triggers an honest message: *"This field doesn't separate cleanly into technology areas — it may be too broad or too narrow. Consider [suggestions]."*
**Mobile.** List view only; map hidden.

---

## 6.9 Problem–solution–constraint matrix — `?view=matrix`

**Purpose.** Reframe the field from "what has been patented" to "what has been solved, and under what constraints" — the reframe that makes gaps meaningful.
**Primary question.** *"Which problems are solved, by what approaches, and which constraints does nobody address?"*

**Components.** An interactive matrix: **rows = technical problems** extracted from the shortlisted areas; **columns = solution approaches**; **cell = evidence density** for that pairing. Each cell carries patent family count, claim-level count, publication count, and a constraint-coverage chip set showing which constraints (cost, power, latency, safety, manufacturability, sustainability…) that pairing addresses — and, rendered differently, which it demonstrably ignores.

The high-value visual is the **constraint gap**: a cell dense with patents where a specific constraint chip is absent across all of them. That is a far better opportunity signal than an empty cell, and it is the matrix's reason to exist.

Constraint toggles (Section 8.8) let the user filter to "show only work that addresses cost AND manufacturability", collapsing the matrix to what survives — often dramatically.

**Hierarchy.** The matrix dominates; a right panel details the selected cell.

**Actions.** Select cell → evidence; toggle constraints; add a problem or constraint row the system missed; mark a cell as mischaracterised (feeds the trail and the re-run); promote a cell to a hypothesis seed.

**AI assistance.** *What constraint is everyone ignoring here?* · *Why do these two approaches never appear together?* · *Is this problem actually important?* (routes to literature and product evidence) · *Generate a hypothesis from this cell*.

**Evidence.** Cell → the families and passages that put them there, with the extraction quote for each problem/solution/constraint assignment. Extraction errors must be visible and correctable.
**Filters.** Constraint toggles, date, cluster, assignee, evidence type.
**Empty state.** Requires a deep dive; shows which areas are eligible and the cost.
**Low-confidence.** Cells built from few documents are visibly lighter and labelled with their support count. Sparse cells are never styled as confident opportunities.
**Mobile.** Not usable as a matrix. Falls back to a ranked list of notable cells ("dense problem, missing constraint") which is arguably the useful 80%.

---

## 6.10 Claim-element map — `?view=claims`

**Purpose.** The screen attorneys will judge us on. Move from documents to the actual building blocks of claims.
**Primary question.** *"What do the claims in this field actually recite, and which combinations are missing?"*

**Components.** A **claim-element constellation** (Section 8.3): elements as nodes sized by frequency across independent claims; edges weighted by co-occurrence lift; layout clusters elements that travel together. Three visual states matter: elements that are near-universal (the field's mandatory architecture), pairs with high lift (conventional combinations), and **pairs with high individual support but near-zero co-occurrence** — rendered as a distinct, deliberately eye-catching "open edge" between two well-established nodes. That open edge is the product's core visual metaphor.

Right panel for a selected element or pair: frequency, the families reciting it, typical claim phrasing (with the actual language), whether it appears in independent or only dependent claims, system/method/apparatus split, and — where the description mentions a concept the claims never recite — a **"described but not claimed"** flag, which is one of the most commercially interesting signals we can compute.

Below: a side-by-side claim comparison tool for any two selected families.

**Hierarchy.** The constellation, then the selected pair's detail, then comparison.

**Actions.** Select element/pair; filter to independent claims only; toggle to a matrix view (many attorneys prefer the grid — provide both, per [ElementGrid](src/components/prior-art-studio/ElementGrid.tsx)); compare claims; promote an open edge to a hypothesis; export a claim chart.

**AI assistance.** *Extract the dominant claim elements* · *What's described but never claimed?* · *Where are the design-around directions?* · *Compare these two claim sets* — each producing analytical statements, never legal conclusions.

**Evidence.** Every element links to verbatim claim excerpts with publication numbers. **Non-negotiable: no claim-element assertion appears without the quoted claim language behind it.**

**Filters.** Independent-only, granted-only (proxy), date, assignee, cluster, element support threshold.
**Empty state.** Requires deep dive. States clearly which areas have claim text available and which do not — coverage honesty is especially important here, since a "missing" element may simply be unreadable data.
**Low-confidence.** If claim coverage for the area is below threshold (default 40%), the whole screen carries a prominent banner: *"Claims retrievable for only 28% of this area — element analysis is indicative only."* And the gate ladder will have typed related hypotheses as DATA_GAP.
**Mobile.** Constellation view-only; element list and claim excerpts fully readable.

---

## 6.11 Citation and influence network — `?view=citations` *(Phase 2)*

**Purpose.** Show intellectual lineage and influence.
**Primary question.** *"Which work in this field is foundational, and where does the citation trail go cold?"*

**Components.** A citation graph over the shortlisted families (not the whole field — see below), with node size by citation count, edges directed, and a time axis option. Panels for most-cited families, citation-desert areas (technically active, rarely cited — often a genuine-novelty signal or an isolation signal), and examiner-citation patterns where available.

**Critical scoping decision.** We do not have corpus-wide citation data, and the local-only constraint (9.0) rules out per-query enrichment. **This screen therefore cannot ship at all until the citation bulk load (9.3a item 2) completes** — there is no thin version worth building. Once loaded, citations are corpus-wide rather than shortlist-scoped, which is strictly better than the API-enrichment design it replaces: complete coverage, no per-query cost, and reproducible.

Until then the screen is an honest stub stating what it will show and what it depends on.

**Empty state (MVP).** The screen exists in MVP as a stub explaining that citation analysis arrives in Phase 2 and what it will add. Better than hiding it — it sets accurate expectations.
**Low-confidence.** Citation counts from a single source are labelled as such; absence of citations is never presented as absence of influence.
**Mobile.** List view of most-cited and least-cited; no graph.

---

## 6.12 Scientific research vs patent activity — `?view=science`

**Purpose.** The most decision-relevant comparison in the module, and the one that distinguishes a dead field from an open one.
**Primary question.** *"Is the science ahead of the patents here, or has everyone given up?"*

**Components.** The centrepiece is a **research–patent quadrant**: publication velocity on one axis, filing velocity on the other, one point per cluster, sized by absolute volume. The four quadrants are labelled in plain language, and the labels are the analysis:

- **High research, low patenting** → *"Translation opportunity"* — the quadrant we exist to find.
- **High both** → *"Active race"* — real but crowded.
- **Low research, high patenting** → *"Patent-led / possibly defensive"* — often portfolio-building, worth understanding.
- **Low both** → *"Dormant or abandoned"* — the trap. Density-only tools call this whitespace; we call it a graveyard until proven otherwise.

Supporting panels: publication-to-filing time lag for the field, leading institutions vs leading companies (side by side — the mismatch is often the story), research trend lines per cluster, and per-cluster **research-to-patent ratio** as a sortable metric.

**Hierarchy.** Quadrant first — it does the interpretive work. Everything else supports it.

**Actions.** Select a cluster point → its literature and patent sets; filter by year; open source papers; promote a translation-quadrant cluster to a hypothesis seed.

**AI assistance.** *Compare scientific and patent activity here* · *Why is nobody patenting this research?* — a genuinely useful and frequently surprising question · *Find the institutions publishing without filing* (a direct lead-generation feature for TTOs and licensing teams).

**Evidence.** Every point links to both its family set and its publication set, with DOIs. Publication metadata only — we do not have full text and the UI says so.

**Filters.** Date, cluster, open-access-only, minimum citation count, provider.
**Empty state.** Literature probe not yet run; one click, low cost (keyless providers).
**Low-confidence.** Fields with poor literature coverage in our providers (some engineering and industrial domains publish little) get an explicit warning against over-reading the quadrant. Provider health is shown — if OpenAlex returned nothing, say so rather than showing a misleading zero.
**Mobile.** Quadrant renders acceptably small; ratio table fully usable.

---

## 6.13 Product-to-patent comparison — `?view=products` *(Phase 2)*

**Purpose.** Connect the patent picture to what actually exists in market.
**Primary question.** *"What's being sold here, and does the patent coverage match it?"*

**Components.** Two-column mapping: products (name, company, category, launch date, core features, claimed benefits, known limitations, target customer, regulatory status where relevant) against related patent families. The two derived views are the payload: **product features with no clear patent coverage** (possible trade-secret protection, or a genuine gap) and **patent concepts absent from any product** (possibly infeasible, uneconomic, or ahead of the market).

**Honesty requirement, stated on-screen.** Public product descriptions do not reveal internal technology. This screen shows *apparent* correspondence, never actual implementation. Section 14 treats over-reading this as a top misleading-conclusion risk, and the UI copy must be defensive.

**Data reality.** We have no product or company corpus (Section 9.3). Phase 2 requires either an ingestion or a manual/assisted entry mode. **Recommendation: ship the assisted-entry version first** — the user (who knows their market far better than any API) adds products, and the system maps them to patents. Lower cost, higher accuracy, and it makes the user a collaborator.

**Empty state (MVP).** Stub with Phase 2 explanation plus the option to add products manually.
**Mobile.** Two-column becomes stacked cards.

---

## 6.14 Competitor portfolio comparison — `?view=competitors`

**Purpose.** Serve Workflow C and JTBD-4/5.
**Primary question.** *"Who is covering what, and what is nobody covering?"*

**Components.** A **coverage grid**: assignees as rows, technology clusters as columns, cells showing family count and recency, with the user's own tenant portfolio pinnable as a row (Phase 3 for automatic detection; manual entry earlier). Derived views: areas where one assignee is uniquely strong; areas contested by many; areas nobody occupies; **assignee-removal mode** (Section 8.9) — hide a dominant player and see what the field looks like without them, which reveals whether an area is genuinely crowded or just one company's programme.

Right panel per assignee: portfolio size, filing trend, jurisdiction strategy, cluster concentration, recent activity, notable families.

**Hierarchy.** Grid first, assignee detail second.

**Actions.** Add/remove assignees; pin own portfolio; toggle assignee-removal; filter to expiring families (Section 8.10); export a competitive summary.

**AI assistance.** *What is [competitor] not covering?* · *What changed in their filing strategy?* · *Where do we overlap?*

**Evidence.** Every cell → family list. Assignee canonicalisation is shown and correctable — the UI must expose that "SAMSUNG ELECTRONICS CO LTD" and "Samsung Electronics" were merged, because a wrong merge distorts everything on this screen.

**Filters.** Date, jurisdiction, cluster, legal-status proxy.
**Empty state.** Suggests the top 10 assignees from the field census as a starting set.
**Low-confidence.** Canonicalisation confidence is surfaced; ambiguous merges are flagged for user confirmation rather than applied silently.
**Mobile.** Grid horizontally scrollable within its container; assignee cards below.

---

## 6.15 Whitespace opportunity list — `?view=opportunities`

**Purpose.** The Lab's home screen. The ranked output of the whole study.
**Primary question.** *"What are my options, and which are real?"*

**Components.** A list of hypothesis cards — deliberately a list, not a grid, because these need reading. Each card: title, one-sentence statement, **type badge** (the ten types, colour-and-label coded), status (draft / validating / validated / refuted / inconclusive), the six-segment score vector as a micro-bar, cluster origin, and a one-line "what would kill this" summary.

Above the list, the **funnel band** (generated → survived → validated) doubling as a filter, and a segmented control: *Surviving · All · Refuted*. **Refuted hypotheses are first-class and browsable**, with their rejection reason prominent. A user who reads the refuted list understands the field better than one who reads only survivors, and this is where "show me why this is NOT whitespace" (Section 8.7) lives natively.

Sort options: whitespace strength (default), confidence, evidence quality, semantic novelty, combination rarity, date.

**Hierarchy.** Type badge and status are the most important glanceable elements — more than the score. A user must never mistake an unvalidated draft for a validated survivor, and the visual weight must make that impossible.

**Actions.** Open; validate (metered, cost shown); challenge; dismiss with reason; promote to concept; compare two hypotheses; bulk-export.

**AI assistance.** *Generate more hypotheses from [cluster]* · *Why did these all fail?* (pattern analysis across refutations — genuinely insightful) · *Which of these is most defensible?*

**Evidence.** Card → detail → Evidence Room.
**Filters.** Type, status, score thresholds, cluster, date.
**Empty state.** Requires deep dive + generation; shows eligible areas and cost.
**Loading.** Cards appear as generated, with a "validating" shimmer during stage 6.
**Low-confidence / null state.** If everything was refuted, the screen leads with that as a finding and offers the constructive next moves (widen scope, adjacent fields, different decomposition). Never an empty list with no explanation.
**Mobile.** Fully supported — reading hypotheses on a phone is a genuine use case.

---

## 6.16 Individual opportunity detail — `/opportunity/[hypothesisId]`

**Purpose.** The complete case for and against a single opportunity.
**Primary question.** *"Is this real, and what would I do with it?"*

**Components.** A long-form document layout — closer to a memo than a dashboard, because that is what it is. Sections, in order:

1. **Header:** title, type badge, status, score vector (expanded, all six dimensions labelled and explained on hover), confidence, primary actions.
2. **The opportunity:** unresolved problem, target user/application, proposed technical direction, the novel combination, expected technical effect.
3. **What exists today:** existing approaches, their limitations, closest prior-art clusters, closest families with similarity scores.
4. **Claim positioning:** elements likely to overlap with existing art, potential differentiating elements, described-but-not-claimed opportunities. Framed analytically throughout.
5. **Evidence for** — patent, scientific, product, with counts and links.
6. **Evidence against** — rendered with *equal visual weight*, in the same component style. Not a footnote, not collapsed by default. This is a deliberate and defensible design choice.
7. **What we tried in order to kill this:** the disproof searches run, each with its query, hit count and outcome. The gate ladder with each gate's verdict.
8. **Why this may have remained unexplored:** the system's candid hypotheses (technically hard, recently enabled by another advance, economically marginal until now, terminology-hidden…), each labelled speculative.
9. **Concerns:** feasibility, regulatory, manufacturing/deployment, with confidence levels.
10. **Coverage limitations:** what our data could not see. Non-optional.
11. **Recommended validation steps:** concrete and ordered — run a novelty search, check pre-2000 art in [specific classification], consult a domain expert on [specific question], prototype test for [specific effect].

**Hierarchy.** Problem and direction first; evidence-against no lower than the fold; coverage limitations always visible before the primary action.

**Actions.** Validate; challenge (→ 6.18); develop into a concept (→ 6.20); run novelty search; dismiss with reason; export as a memo; share.

**AI assistance.** *Generate alternative embodiments* · *What's the strongest argument against this?* · *Identify missing technical constraints* · *Suggest experiments to validate feasibility* · *Convert to an invention disclosure*.

**Evidence.** Everything links. Evidence Room opens as a drawer without losing place.
**Low-confidence state.** A hypothesis with confidence below 0.5 renders with a prominent, non-dismissible banner explaining what is weak and what would strengthen it. It is not hidden — a weak hypothesis with a clear strengthening path is useful.
**Mobile.** Fully responsive; this is a document and should read beautifully on a phone.

---

## 6.17 Evidence Room — `?panel=evidence`

**Purpose.** The trust backbone. Everything the system believes, and why.
**Primary question.** *"Show me exactly what this is based on."*

**Components.** A drawer or full view with four tabs:

1. **Supporting** — patent passages (with publication number, claim or paragraph reference, verbatim quote, retrieval and rerank scores), scientific papers (title, authors, venue, year, DOI, citation count), statistics (with the query that produced them).
2. **Contradicting** — same structure, same visual weight.
3. **Search traces** — every query run, in what lane (lexical/semantic/classification), how many hits, how many were relevant, and what was concluded. This is the audit trail; for a professional user it is the difference between a tool and a toy.
4. **Coverage & limitations** — date range, jurisdiction coverage, text availability for this area, which providers responded and which failed, known blind spots.

Each evidence item is a card that expands in place. Filters: stance, kind, date, source, minimum score.

**Hierarchy.** Contradicting evidence is one click from supporting — same level, adjacent tab. Never buried.

**Actions.** Open source document; mark evidence as misinterpreted (feeds trail, adjusts confidence); add own evidence (user-supplied documents become first-class evidence — important for domain experts); export the evidence set; **challenge from here** (an evidence item can seed a targeted disproof).

**AI assistance.** *Summarise this evidence set* · *What's the weakest link here?* · *Find stronger prior art* · *Search alternative terminology*.

**Empty state.** Cannot occur — a hypothesis without evidence cannot be created by the pipeline. If it somehow renders empty, that is an error state and should say so loudly.
**Low-confidence.** Evidence items below a retrieval-score threshold are shown but visually deprecated with the reason.
**Mobile.** Full support; tabbed, scrollable.

---

## 6.18 Hypothesis challenge / red-team — `/opportunity/[id]/challenge`

**Purpose.** Let the user direct the attack, and make the system's self-criticism visible and steerable.
**Primary question.** *"What's the best argument that this is wrong?"*

**Components.** Split view. **Left:** the hypothesis in summary with its current score and survival record. **Right:** an attack console — a menu of named attacks the user can launch, each with cost and expected duration:

- Find stronger prior art
- Search alternative terminology
- Expand classifications
- Search other jurisdictions *(within the corpus — CN, JP, KR families are present even where claims are not)*
- Search non-patent literature
- Test obvious combinations (obviousness-style: is this just A + B?)
- Find failed or abandoned approaches *(literature trajectory)*
- Free-text attack: *"I think Company X already does this in their Y product"*

Below the runnable attacks, a permanently visible **"Cannot be tested here"** panel naming the checks this system cannot perform — pre-2000 art, commercial and product evidence, legal status — each with a one-line instruction for performing it externally. This panel is not an error state and is never dismissible. It exists because a red-team screen that lists only the attacks it can win is an advertisement, not an audit.

Results stream in below as a **challenge log**: each attack, what it found, and its verdict — *survived*, *weakened* (with the confidence delta), or *refuted* (with the killing evidence quoted). A running confidence meter updates visibly.

**Hierarchy.** The attack menu and the log. The hypothesis is context.

**Actions.** Launch attacks; accept a refutation (sets status REFUTED with reason); dispute a refutation (user override, recorded, with justification — the human is allowed to win, and we record that they did); re-run all attacks after a scope change.

**AI assistance.** *Find the strongest contradiction* — the system picks the attack most likely to succeed rather than running all of them, which is both cheaper and more intellectually honest. *What haven't we tested?*

**Evidence.** Every attack result writes to the Evidence Room as a search trace.
**Empty state.** No attacks run yet; the system pre-selects the three most relevant given the hypothesis type.
**Loading.** Each attack shows live progress; multiple attacks run concurrently.
**Low-confidence.** If an attack returns ambiguous results, it is logged as inconclusive rather than forced into survived/refuted — and inconclusive results lower evidence quality rather than confidence.
**Mobile.** Usable; attack menu as a list, log below.

---

## 6.19 Cross-domain opportunity explorer — `/crossdomain` *(late MVP / Phase 2)*

**Purpose.** Find technology transferable from another industry — historically one of the richest sources of genuine invention.
**Primary question.** *"Who else has solved a problem like mine?"*

**Components.** A **function-first** framing, which is the key design insight: the user's problem is abstracted to a technical function ("dissipate heat from a densely packed cell array without active coolant"), and the system searches for that function's solutions in *distant* CPC sections. Results are presented as transfer cards: source domain, target domain, the shared technical function, the adaptation required, existing cross-domain families (has anyone already bridged these?), the missing combination, likely barriers, and the potential inventive contribution.

A domain-distance control lets the user tune how far afield to look — adjacent industries or genuinely distant ones.

**Implementation note (Section 9.4).** MVP-lite version: semantic nearest-neighbours to the hypothesis embedding, filtered to families whose CPC section differs from the field's dominant sections, then LLM-summarised into transfer cards. This is cheap and surprisingly effective. The full version with function-level abstraction is Phase 2.

**AI assistance.** *Abstract this to a technical function* · *Who else solves this?* · *What would adaptation require?*

**Evidence.** Every transfer card links to the source-domain families.
**Low-confidence.** Cross-domain analogies are the single most hallucination-prone output in the module. Every card is explicitly labelled as an analogy requiring expert judgment, and no card is generated without at least one real source-domain family behind it. Section 14.6 covers the safeguards.
**Mobile.** Card list; fully readable.

---

## 6.20 Invention development workspace — `/concept/[conceptId]`

**Purpose.** Turn a validated hypothesis into a structured invention concept, with the user's expertise in the loop.
**Primary question.** *"What exactly am I inventing, and how is it different?"*

**Components.** A two-column working document. **Left (editable canvas):** problem refinement, proposed architecture, required components, optional components, alternative embodiments, technical effect, design variations, performance targets, failure cases, experimental validation plan, prototype plan, open questions. Every block is individually AI-regenerable and individually editable, with a clear visual distinction between AI-generated and user-authored content — and user edits are never silently overwritten.

**Right (fixed reference):** the source hypothesis, closest prior art, and a live **differentiation table** — the concept's elements against the closest three families, showing for each element whether it is present, partial or absent in each. This table is the concept's spine; it updates as the user edits the concept, and it is directly exportable.

Below: claim-element positioning — which elements are likely to be contested, which are candidates for differentiation. Analytical framing only.

**Hierarchy.** The concept document is primary; the differentiation table is the permanent companion.

**Actions.** Edit any block; regenerate a block; add an embodiment; reject an assumption (with reason — recorded); run novelty search; start drafting; generate figures (routes to the existing diagram pipeline); export as a disclosure.

**AI assistance.** Per-block, contextual: *Generate three alternative embodiments* · *What are the failure modes?* · *Suggest experiments* · *Make this claim element broader/narrower* · *What would an examiner say?*

**Evidence.** The differentiation table cells link to claim excerpts.
**Empty state.** Newly promoted concepts arrive pre-populated from the hypothesis; genuinely empty blocks show a generate button with a preview of what will be produced.
**Low-confidence.** AI-generated blocks that draw on weak evidence are marked and the user is prompted to verify.
**Mobile.** Read and light-edit only; this is desktop work.

---

## 6.21 Novelty-search handoff — modal / route

**Purpose.** Move a concept into the existing novelty pipeline losslessly.
**Primary question.** *"Am I about to search for the right thing?"*

**Components.** A confirmation view showing exactly what will be handed over: the extracted invention features (editable before submission), the search scope, the pre-identified closest art that will seed the search, and the estimated cost and duration against the user's quota. A clear statement of what the novelty search adds beyond what whitespace validation already did — because the user should understand these are different tests: validation asked "is this space open?", novelty asks "is this specific invention new?".

**Actions.** Edit features; adjust scope; confirm and run; cancel.
**AI assistance.** *Refine these features for search* · *Is this feature too broad?*
**Empty state.** N/A.
**Error.** Quota exceeded → clear explanation and upgrade path, never a raw 403.
**Mobile.** Fully supported.

---

## 6.22 Report builder — `/report`

**Purpose.** Produce a defensible document, because in the real world the deliverable is often a document.
**Primary question.** *"How do I present this to someone who wasn't here?"*

**Components.** A section picker (left) with live preview (right). Available sections: executive summary, scope and methodology, field landscape, technology areas, claim-element analysis, science-vs-patent comparison, competitor coverage, surviving opportunities (each at chosen depth), **rejected opportunities with reasons**, evidence appendix, coverage limitations, glossary.

Two things are **mandatory and non-removable** in every export: the methodology statement and the coverage limitations. A user can reorder and deselect almost everything else. This is a deliberate constraint — an export that leaves our system without its caveats becomes someone else's decision document, and we are responsible for what it implies.

Templates: board memo (short, verdict-led), attorney work product (long, evidence-dense, methodology-forward), research brief (science-forward), investor summary.

**Actions.** Select/reorder sections; choose template; set depth; export DOCX / PDF / XLSX; generate share link with expiry.

**AI assistance.** *Write the executive summary* · *Rewrite for a non-technical audience* · *Shorten to two pages*.

**Evidence.** The evidence appendix is generated from the Evidence Room, with full citations.
**Empty state.** Sections unavailable because their analysis hasn't run are shown greyed with what's needed.
**Loading.** Export generation with progress; large PDFs run server-side (pdfkit) with a download notification.
**Mobile.** Preview and download; not authoring.

---

## 6.23 Saved projects and monitoring — `/monitor` *(Phase 3)*

**Purpose.** Turn a one-off study into a standing capability. The retention mechanism.
**Primary question.** *"What changed in my field?"*

**Components.** Per-study monitoring configuration: re-run frequency, what to watch (new filings in shortlisted clusters, new filings by named assignees, publications in translation-quadrant areas, changes to a hypothesis's supporting evidence, families lapsing in blocking positions), and alert routing.

The **change feed** is the payload: a reverse-chronological list of material changes, each with a "what this means for you" line generated against the study's specific hypotheses. Not "12 new patents in your field" — rather *"A new Samsung family in the photoacoustic area recites two of the three elements in your Hypothesis 4. Confidence has dropped from 0.78 to 0.61."* **That sentence is the entire value of Phase 3.**

**Actions.** Configure watches; re-run now; view diff (Section 8.6); re-validate affected hypotheses; snooze.
**AI assistance.** *Does this new filing threaten my hypothesis?* · *Summarise this month's changes*.
**Empty state.** No changes since last run — stated positively with the date checked.
**Mobile.** Full support; this is a notification-driven surface.

---

## 6.24 Collaboration and expert review — `/collaborate` *(Phase 3)*

**Purpose.** Studies are argued over by teams; the argument should live in the artefact.
**Primary question.** *"What does my team think, and who signed off?"*

**Components.** Comment threads anchored to specific objects — a cluster, a matrix cell, a hypothesis, a single piece of evidence. A review workflow: a hypothesis can be assigned to a domain expert with a specific question, and their verdict (endorse / dispute / needs work) attaches to the hypothesis and adjusts a human-review flag that appears everywhere the hypothesis is shown. An activity trail per study (reusing the [TrailPanel](src/components/prior-art-studio/TrailPanel.tsx) pattern) recording every run, edit, override and decision.

**Design principle: expert dissent is recorded, not resolved.** If a domain expert disputes a hypothesis the system rates highly, both views persist and travel with the artefact. The system does not get the last word, and neither does it silently defer.

**Actions.** Comment; assign review; record verdict; @mention; resolve thread; export with or without commentary.
**Permissions.** Built on the existing `ProjectCollaborator` roles (owner/collaborator/viewer) and share-link infrastructure.
**Empty state.** Invite prompt with a suggested reviewer from the tenant.
**Mobile.** Full support — reviewing and commenting on a phone is realistic.

---

# Section 7 — Visual design system

## 7.1 Position: extend, don't invent

PatentNest already has a considered visual language — the "Banker's Green" system defined in [palette.ts](src/lib/patentnest/palette.ts), [tailwind.config.js](tailwind.config.js) and [globals.css](src/app/globals.css). It is warm, paper-based, restrained, and already reads as premium and document-serious. Inventing a separate look for this module would be both wasteful and wrong.

**Whitespace Studio uses the existing system unchanged and adds exactly four things:** a crowding scale, a whitespace-type notation, a confidence notation, and an evidence-stance notation. Nothing else. Every other surface is built from existing tokens and primitives.

The brief warned against "excessive black or dark-mode AI styling", "futuristic gradients and glowing effects". The existing palette makes that easy — it is a light, warm, ink-on-paper system. We lean into that: this should look like a well-made scientific instrument or a good engineering report, not a sci-fi console.

## 7.2 Colour

**Inherited base** (from `palette.ts`, unchanged):

| Token | Hex | Role in this module |
|---|---|---|
| `INK` | `#1e293b` | Primary text, chart line work, node strokes |
| `SOFT` | `#94a3b8` | Captions, axis labels, leader lines, deprecated evidence |
| `LAMP` | `#2e5d47` | Brand green; primary actions; supporting evidence accent |
| `BRASS` | `#8a6a1f` | Document ceremony — section marks, report headers, gates |
| `BLUE` | `#31567e` | Semantic/search lane accents — retrieval, queries, traces |
| `VIOLET` | `#5b4a8a` | Reserved (figures); used here for cross-domain transfer only |
| `WAX` | `#a03b25` | Warm red — contradicting evidence, refutation, errors |
| `PAPER` | `#fdfcfa` | Card and plate fill |
| `DESK` | `#f0eee6` | Page background |

**Addition 1 — the crowding scale.** A single sequential ramp from paper to ink, warm-biased, used for every density/crowdedness encoding in the module (heatmap cells, cluster fills, matrix cells). Five steps, derived from the paper→ink axis rather than a new hue, so density reads as *ink on the page*:

```
crowding-0  #fdfcfa   sparse      (paper)
crowding-1  #e8e4da
crowding-2  #cfc8b8
crowding-3  #a89e88
crowding-4  #6b6555
crowding-5  #2f2b22   saturated   (near-ink)
```

Rationale for a monochrome ramp rather than a red-green one: **a colour that says "good" or "bad" on a density map is precisely the error this product exists to prevent.** Sparse is not good. Dense is not bad. Ink density says "how much has been written here" and nothing more. This is a small decision that carries the whole product thesis.

**Addition 2 — whitespace-type notation.** Ten types is too many for colour alone. The system uses **a three-band colour grouping plus a distinct glyph per type**:

| Band | Colour | Types | Meaning |
|---|---|---|---|
| Artefact | `SOFT` grey | Data gap, Terminology gap | Not a real gap — an artefact of our data or vocabulary |
| Blocked | `WAX` | Claim gap, Feasibility, Regulatory, Commercial | A real gap with a known reason it is closed |
| Open | `LAMP` | Scientific, Market, Cross-domain, **Genuine** | A gap that survives scrutiny |
| Untested | `BRASS` outline | Undetermined | Generated but not yet gated |

Each type additionally carries a small unique glyph (16px, line-art, in the type's band colour) so the ten types remain distinguishable without ten hues, and so colour-blind users are never dependent on hue. **Genuine** is the only type that gets a filled `LAMP` badge; everything else is outlined. Scarcity of the strongest signal is the point.

**Addition 3 — confidence notation.** A six-segment micro-bar, 48×6px, one segment per score dimension, filled in `INK` at opacity proportional to the dimension's value on `DESK`. It reads as a small ledger rule rather than a progress bar — deliberately unexciting, because confidence should not feel like a game score. Hover expands to a labelled breakdown. **A single aggregate number never appears without its decomposition adjacent.**

**Addition 4 — evidence stance.** Indicated by a **3px left border rule only**, never by fill:

- Supporting → `LAMP` rule
- Contradicting → `WAX` rule
- Context → `SOFT` rule

The border-only rule is deliberate: a filled red card would make contradicting evidence feel like an alarm, when epistemically it is the most valuable thing on the screen. Equal weight, different mark.

## 7.3 Typography

Inherited unchanged: **Inter** (`--font-inter`, `font-sans`) for all interface text and data; **Cormorant Garamond** (`--font-cormorant`, `font-serif`) for ceremony — report titles, section marks, the study title in the header, and pull-quotes of claim language.

The one module-specific rule: **verbatim patent and claim text is always set in Cormorant, at 1.05× the surrounding size, on a faintly warm ground.** This gives quoted source material a consistent, unmistakable texture across the whole module — a user should be able to tell at a glance what is the source's words and what is ours. This is a small typographic decision doing real epistemic work.

Numerals: Inter with `font-variant-numeric: tabular-nums` everywhere numbers align in columns or update in place.

Scale (existing): 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36 / 48. Body 14–16. Data labels 12. Never below 12.

## 7.4 Grid and spacing

8px base, inherited. Workspace: 64px collapsed view rail (240px expanded), fluid main canvas with 1440px max content width, 380px context panel, evidence drawer at 50vh (bottom) or 480px (right).

Card padding 16/20/24 by density. Section rhythm 32px. Panel gutters 24px.

Analytical canvases get more air than typical dashboards — the brief asked for "structured whitespace" as a design element, and here it is literal: generous margins around maps and matrices make dense data legible and make the product feel calm rather than crowded. **Resist filling every pixel.** A screen with four things on it that a user understands beats a screen with twelve they skim.

## 7.5 Cards

Three card species, and only three:

1. **Insight card** — `PAPER` fill, 1px `SOFT/30` border, radius from `--radius`, no shadow at rest, 2px shadow on hover. Contains one claim, one number, one micro-visual, one link.
2. **Evidence card** — `PAPER` fill, 3px stance rule on the left, quoted source text in Cormorant, metadata row in 12px `SOFT`, expandable in place.
3. **Hypothesis card** — `PAPER` fill, type badge top-left, status top-right, score micro-bar bottom-left, "what would kill this" line in `SOFT` italic at the bottom. Refuted hypotheses render at 70% opacity with a `WAX` strikethrough on the title — visible, browsable, unmistakably dead.

No other card variants. Consistency here is worth more than expressiveness.

## 7.6 Tables

Dense, quiet, functional. `DESK` header row, 1px `SOFT/20` row rules, no zebra striping (it fights the paper aesthetic), tabular numerals, right-aligned numbers, sortable headers with a subtle `BRASS` active indicator. Row hover raises to `PAPER`. Sticky headers on scroll. Every table has an export affordance in its header.

Row density toggle (comfortable / compact) persisted per user — analysts want compact, executives want comfortable.

## 7.7 Charts

**Decision: hybrid, and the split is principled.**

`recharts@3.2.1` is already a dependency with zero current usage. Use it for **standard statistical charts** — time series, bar distributions, stacked areas, scatter — where it is well-tested, accessible, responsive and would take us days to reimplement. This is the whole of the landscape screen (6.6).

Use **custom SVG**, following the [GatesFunnel](src/components/prior-art-studio/GatesFunnel.tsx) precedent, for the **five signature visuals** where recharts would be a fight and where the visual *is* the differentiation:

1. Cluster map (PCA scatter with labelled, sized, ringed nodes)
2. Claim-element constellation (force-adjacent layout with weighted edges and open-edge emphasis)
3. Problem–solution–constraint matrix (cell grid with constraint chips)
4. Opportunity funnel (segmented band with drill-through)
5. Research–patent quadrant (labelled quadrant scatter)

Rationale: recharts earns its place on the 80% of charts that are conventional; hand-built SVG earns its place on the 20% that carry the product's identity. Building all of it custom wastes weeks; building all of it in recharts produces a product that looks like every other dashboard.

**Chart rules across both:** no chart junk, no 3D, no gradients-for-decoration, no more than five series before switching to small multiples, direct labelling in preference to legends, axes always labelled with units, and — the important one — **every chart has its question as its title.**

## 7.8 Networks and maps

Cluster map: nodes 24–72px by family count; fill from the crowding ramp; 1.5px `SOFT` ring for diffuse clusters; labels always visible (a node we can't label is a node we don't show); `INK` selection ring.

Claim constellation: nodes sized by support, edges by co-occurrence lift, edge opacity by confidence. The **open edge** — high individual support, near-zero co-occurrence — is drawn as a `LAMP` dashed line, the only dashed element in the entire design system, so it reads instantly as "this connection does not yet exist".

Both canvases: pan/zoom with a reset control, keyboard-navigable node focus, and a permanent list-view toggle.

**Where React Flow belongs, and where it does not.** `@xyflow/react` is already in the app, driving the ideation mind-map. Use it for **the taxonomy tree** (6.7) and, in Phase 2, **the citation network** (6.11) — both are genuine node-graphs with interaction needs (expand, collapse, drag, focus) that would be wasteful to hand-roll. Use it for nothing else here, and specifically **not** for the cluster map or the claim-element constellation.

The reason is a design principle rather than a technical one. A mind-map canvas signals *"you arranged this"*. Cluster and constellation positions are **computed**, and dressing computed positions in an authoring interface invites exactly the misreading Section 10.2a exists to prevent — that spatial proximity carries meaning the projection cannot support. Those two stay custom SVG with fixed, explained layouts and no drag affordance. A node the user cannot move is a node whose position they will not over-interpret.

The one place a genuine mind-map belongs is combination exploration, and it already exists — see 8.11.

## 7.9 Evidence and confidence indicators

Consolidated for reference:

| Indicator | Form | Where |
|---|---|---|
| Evidence stance | 3px left border rule (lamp / wax / soft) | Evidence cards |
| Evidence strength | 12px `SOFT` metadata line with retrieval score | Evidence cards |
| Confidence | Six-segment micro-bar + hover breakdown | Hypothesis cards, detail header |
| Whitespace type | Band colour + unique glyph badge | Everywhere a hypothesis appears |
| Coverage | Persistent grey strip, always visible | Every analytical screen |
| Data quality | Hatched overlay on charts where coverage < 50% | Charts, matrices, maps |
| Human review | Small `BRASS` seal glyph | Hypotheses reviewed by an expert |

The hatched overlay deserves note: where a visual is built on data we know to be partial, we draw a fine diagonal hatch across the affected region rather than footnoting it. It is borrowed from engineering drawing convention, it fits the paper aesthetic, and it makes incompleteness impossible to miss without being alarming.

## 7.10 Icons

Line-art, 1.5px stroke, 20px default, matching the existing Lucide-based set. The ten whitespace-type glyphs are custom, drawn as a family, in the same weight — they are the only bespoke iconography in the module.

## 7.11 Motion

Restraint is the rule. Motion is used for exactly four purposes, and never for decoration:

1. **Progressive reveal** — analysis results fade in as they land (150ms, ease-out), which communicates streaming rather than stalling.
2. **Drill-down continuity** — expanding a cluster animates its children out of the parent node (300ms) so the user keeps their place in the hierarchy.
3. **Timeline playback** — the field's evolution over years, animated on demand (Section 8.6). This is the one place where animation is genuinely explanatory: watching clusters appear, grow and consolidate teaches something a static chart cannot.
4. **Confidence change** — when a validation run alters a score, the micro-bar animates to its new value (400ms) so the change is noticed rather than silently swapped.

Everything else is instant or a 150ms opacity transition. No parallax, no scroll-jacking, no entrance animations on page load. `prefers-reduced-motion` disables 2–4 and reduces 1 to instant.

## 7.12 Light and dark mode

**Light is the primary and default mode**, and it should be the mode we design and demo in. The paper aesthetic is the brand, the users are professionals reading dense documents in offices, and the brief explicitly warned against dark-mode AI styling.

Dark mode is supported (the app has the token infrastructure) with three specific adaptations:
- The crowding ramp inverts direction — density becomes *light* on dark, preserving "more ink = more patents" as "more signal = more patents".
- `PAPER`/`DESK` invert to `ai-graphite` steps; `LAMP`, `BRASS`, `WAX` lighten ~15% for contrast on dark grounds.
- The hatched data-quality overlay lightens rather than darkens.

Charts must be verified in both modes; the signature SVG visuals take their colours from CSS custom properties rather than hard-coded hex so this is automatic.

## 7.13 What we deliberately avoid

Restating the brief's warnings as concrete prohibitions, because these are easy to drift into:

- No glowing gradients, no neon, no glassmorphism, no dark "AI" chrome.
- No single-number patentability or novelty score, anywhere, ever.
- No chart that exists because we had the data — every visualisation answers a stated question or it is cut.
- No floating chatbot bubble. AI actions attach to objects (Section 8).
- No decorative semantic map without a list-view equivalent.
- No hidden search logic — every query is inspectable.
- No interface element that requires understanding CPC before starting.
- No static PDF as the primary interaction; the report is an output, not the product.

---

# Section 8 — Distinctive interactions

Fourteen interaction concepts. Each is specified enough to build, and each earns its place by making a specific analytical task easier — none are here for novelty alone.

## 8.1 The re-decomposable technology tree

A zoomable tree of the field, but with a control most tools don't offer: **the decomposition axis is switchable, and the user can impose their own.** "Viewing as: device architecture ▾" offers alternates (by mechanism, by application, by material, by constraint) and a free-text option where a domain expert types their own axis — *"decompose this by power source"* — and the corpus is re-bucketed against it.

*Why it matters:* every field has multiple valid decompositions, and the one that reveals a gap is often not the one CPC imposes. Letting the expert impose theirs is the cheapest way to surface non-obvious structure. *Cost:* one cheap LLM call per re-decomposition plus a re-bucketing pass over cluster members.

## 8.2 The anti-blob cluster map

Not an interaction so much as a set of enforced constraints, but it is the difference between a map that works and the "visually impressive, analytically meaningless blob" the brief warned about. Every cluster is named or hidden. The map is always paired with a sortable list showing identical data. Hovering the space *between* two clusters explains what separates them. Low-cohesion clusters are visibly marked and excluded from automated hypothesis generation.

*Why it matters:* semantic maps are the most over-sold artefact in this market. Ours should be the one users actually navigate by.

## 8.3 Claim-element constellation with open edges

Elements as nodes, co-occurrence as edges — and the signature move: **pairs with high individual support but near-zero co-occurrence are drawn as dashed `LAMP` "open edges"** between two established nodes. The user sees, literally, the connections the field has not made.

Clicking an open edge shows both elements' claim language, the families reciting each, and a "generate hypothesis from this gap" action.

*Why it matters:* this is the single most direct visual expression of the product thesis — a gap you can see and click. It is also grounded in real claim text rather than abstraction. *Cost:* computed from deep-dive extraction; no additional retrieval.

## 8.4 The opportunity funnel with browsable rejects

A segmented band — generated → gated → validated → surviving — where **every segment including the losses is clickable**. Clicking "8 rejected at the terminology gate" lists them with the vocabulary that killed them.

*Why it matters:* most funnels show attrition as loss. Here the attrition *is* the analysis. A user who browses the rejected set learns their field's failure modes, and the visible rigour is the trust mechanism.

## 8.5 The research–patent quadrant

Publication velocity against filing velocity, one point per cluster, with the four quadrants named in plain language ("Translation opportunity", "Active race", "Patent-led", "Dormant or abandoned"). Dragging a selection box promotes the enclosed clusters to a shortlist.

*Why it matters:* it makes the single most important discrimination in the whole product — open field vs graveyard — into one glance. See Section 6.12.

## 8.6 Timeline playback and "what changed?" overlay

A scrubber across the field's years. Playing it animates clusters appearing, growing, merging and going quiet; the user watches their field's history in fifteen seconds. Separately, a diff mode: select two periods and the map renders **change** — new clusters in `LAMP`, growing in ink, shrinking in `SOFT`, gone in outline.

*Why it matters:* trend charts show that a field grew; playback shows *how* it grew and which branches died. The diff mode is also the foundation of Phase 3 monitoring — the same component, with "now vs last month".

## 8.7 "Show me why this is *not* whitespace" mode

A toggle on any apparent gap — a sparse cluster, an empty matrix cell, an open edge. Flipping it makes the system argue the opposite case: it runs the gate ladder in preview, surfaces the best counter-evidence it can find, and presents the case *against* the gap being real.

*Why it matters:* this is the product's thesis as a single control. It inverts the default posture of every competing tool. It is also the demo moment — showing a prospect a tool that argues against its own output is memorable in a market full of confident dashboards.

## 8.8 Constraint toggles

On the problem–solution–constraint matrix, a chip row of constraints (cost, power, latency, safety, manufacturability, regulatory, sustainability). Toggling one filters the matrix to work that demonstrably addresses it. Toggling two or three usually collapses a dense matrix to near-empty — and *that* emptiness is meaningful in a way raw sparseness is not.

*Why it matters:* "lots of solutions, none that are cheap enough" is a far better opportunity statement than "few solutions". This interaction produces that sentence.

## 8.9 Assignee-removal view

A control to hide one or more assignees and re-render every metric. "What does this field look like without Samsung?"

*Why it matters:* it distinguishes a genuinely crowded field from one company's filing programme — a distinction that changes strategy completely and that no density map can express. Cheap to build (a filter on the family set), high analytical value.

## 8.10 Expiring-and-lapsed opportunity layer

An overlay marking families approaching or past their 20-year term, and (Phase 2, with legal events) those lapsed for non-payment. Areas dense with expiring art are highlighted as a distinct opportunity class.

*Why it matters:* expiry-driven opportunity is real, well understood by professionals, and largely invisible in current whitespace tooling. In MVP this is a date proxy and must be labelled as such; it becomes rigorous in Phase 2.

## 8.11 Combination exploration — via the existing ideation mind-map, not a new canvas

The analyst's core mental operation is "what if we combined X and Y?", and it deserves a first-class gesture. **We should not build one.** spotipr already has it.

[`IdeationWorkspace.tsx`](src/components/idea-bank/ideation/IdeationWorkspace.tsx) is a working React Flow canvas with a typed node vocabulary — `SeedNode`, `DimensionNode`, `OperatorNode`, `IdeaNode` — backed by `MindMapNode`/`MindMapEdge`, plus [`CombineTray`](src/components/idea-bank/ideation/CombineTray.tsx), which holds selected components, dimensions and operators against a `recipeIntent` of divergent / convergent / risk-reduction / cost-reduction, and emits scored `IdeaFrame`s. There is even a contradiction-insight panel. Building a second combination canvas inside Whitespace Studio would be a straight re-implementation.

**The design is therefore a handoff, and it is the most valuable connection in this entire plan.** From an open edge on the claim-element map, a cell on the problem–solution–constraint matrix, or a shortlisted cluster, the action is *"Explore combinations"* — which opens an ideation session pre-seeded from whitespace evidence:

| Whitespace artefact | Seeds into ideation as |
|---|---|
| The two elements of an open edge | `SeedNode`s, with their real claim language attached |
| Claim elements from the deep dive | `DimensionNode`s |
| Constraints the PSC matrix found unaddressed | `OperatorNode`s / dimensions |
| Whitespace type + crowdedness | `CombineTray.recipeIntent` — a crowded area seeds *convergent*, an open one seeds *divergent* |
| Closest prior-art families | Context on the canvas, so divergence happens away from known art |

Generated `IdeaFrame`s return as candidate hypotheses and enter the gate ladder like any other — so the human's divergent output is stress-tested by the same machinery that tests the machine's.

*Why this matters more than the feature it replaces.* Section 2.10 identified the largest unoccupied position in the market: **no product generates invention concepts targeted at a structurally-derived claim-level gap.** XLSCOUT's Ideacue generates from a user's problem statement; IP.com's CompassAI generates from prior art and inventive principles; IPRally has the best feature-level machinery and deliberately declines to generate at all.

spotipr already owns both halves and has never connected them. Ideation currently diverges from a seed with no gap-grounding and only a `noveltyScore` to judge by. Whitespace Studio synthesises hypotheses by LLM with no human divergent step. Wiring them together produces the loop the market research found nobody closes — **evidence-derived gap → human-driven divergence → adversarial verification → claim scaffolding, on one evidence trail** — and it costs a handoff library rather than a new module.

Implementation follows the established pure-transform pattern of [`novelty-drafting-handoff.ts`](src/lib/novelty-drafting-handoff.ts) and [`ideation-novelty-handoff.ts`](src/lib/ideation-novelty-handoff.ts): a new `whitespace-ideation-handoff.ts` projecting whitespace artefacts into the mind-map node shapes, with the route owning persistence.

## 8.12 "Find the strongest contradiction"

A single button on any hypothesis that asks the system to identify and run the attack *most likely to succeed*, rather than running everything.

*Why it matters:* it is cheaper than exhaustive validation, more intellectually honest than confirmatory search, and it models good analytical practice. It also reads, to a sceptical professional, as the tool being on their side rather than selling them a result.

## 8.13 "Show me what this excludes"

On the scope screen, a control that samples twenty families *excluded* by the current filters and shows them.

*Why it matters:* scope errors are the dominant failure mode in patent analytics, and they are invisible by construction — you cannot see what you filtered out. This makes the invisible visible at the moment it can still be fixed. Cheap, unglamorous, and probably prevents more wrong answers than any other feature in this list.

## 8.14 Progressive evidence reveal

Evidence cards that expand in place through three depths: claim → passage → full document context, each a single click, without navigation. Combined with a research-notebook layer where users annotate any object and their notes travel into the report.

*Why it matters:* it respects the reading behaviour of professionals, who skim then drill. Forcing a modal or a new page at each depth breaks the analytical thread.

---

# Section 9 — Data and AI architecture

## 9.0 Architectural constraint: local corpus only

**Production runs against locally stored data. The module makes no calls to external patent API services** — not SerpAPI, not BigQuery, not EPO OPS, not PatentsView, not IP Australia. Everything the pipeline reads about patents comes from Postgres: `local_patents`, `local_patent_embeddings`, and the EPO side-tables.

This constraint costs far less than it first appears, and buys more than it costs.

**What it costs, honestly.** Three things, and one of them is serious:

1. **The pre-2000 blind spot loses its mitigation.** The earlier design used date-unrestricted external searches during validation to catch foundational art outside the corpus window. That is no longer available. **This is now an unmitigated limitation** and Section 14 treats it as the single largest analytical risk in the product. It must be disclosed prominently rather than engineered around.
2. **Commercial and product evidence disappears as an automatic source.** The worked example's discontinued-programme evidence came from external search. Gate G4 now rests on scientific literature and on filing/publication trajectory alone, and G5 (commercial) becomes fully user-supplied.
3. **Citations and legal status cannot be obtained by query.** They move from "Phase 2 via API enrichment" to "Phase 2 via bulk ingestion, or not at all" (9.3).

**What it costs far less than expected.** The BigQuery on-demand claims service was in the earlier design to gap-fill US claim text. Checking the corpus loader shows this is largely redundant: [SCHEMA.md](scripts/google-patents-import/SCHEMA.md) column 13 maps `claims_localized` (English) to `claimsText` as the **full claims blob**, not a single claim — the column's `first_claim` name is a legacy misnomer, and note 6 in that file confirms the extraction returns the complete English claims text. So **full US claims are already local**, EP full claims are already local via `epo_ep_fulltext`, and IN claims are already local via the IPIndia pipeline. CN and other jurisdictions have no claims in the public dataset at all, so no API call would have helped. Dropping the on-demand fetch removes a cost centre and a latency source while losing very little coverage.

**What it buys.** Four things, and two of them are strategic:

- **Reproducibility.** With no external dependency, a study re-run on the same scope against the same corpus snapshot returns the same result. External providers change ranking, rate-limit, and go down; each of those silently changes an answer. **RIPL item 14 and WIPO's reproducibility rule both require that a second analyst can reproduce the result** (10.7b) — a local-only pipeline is the only way to actually deliver that, and no competitor can claim it.
- **Confidentiality.** Section 14.4a raises the risk that submitting invention details to third-party services could bear on public disclosure. A local-only patent pipeline removes that concern for everything except the LLM calls themselves, which already run under the gateway's configured providers. For enterprise and attorney customers this is a sales asset, not merely a technical property.
- **Cost and latency.** No SerpAPI credits, no BigQuery scan charges, no 400GB dry-run guard, no 20-second provider timeouts, no rate-limit backoff. Per-study API cost falls to zero (9.8).
- **No silent provider failure.** A provider returning nothing looks identical to a genuine absence of art — precisely the failure mode this product exists to prevent.

**Design rule that follows:** where a capability requires data we do not hold, the answer is **bulk ingestion into local storage**, following the pattern already established by [scripts/google-patents-import/](scripts/google-patents-import/) — never a per-query API call. That is how the corpus itself was built, and it is the only approach consistent with both this constraint and the reproducibility requirement.

## 9.1 What we actually have

This section is deliberately blunt, because the credibility of everything above depends on it. The architecture was designed against the real schema, not an ideal one.

**Available today (verified against the repository):**

| Asset | Location | Reality |
|---|---|---|
| Patent corpus | `local_patents` ([schema.prisma](prisma/schema.prisma):1483–1569) | ~45.4M rows, **2000–2026 only**. Title + English abstract on every row. `classifications[]` = CPC, GIN-indexed. `filingDate`/`publicationDate` indexed. `familyId` = DOCDB string. |
| Claims & descriptions | same table + `epo_ep_fulltext` | **US full claims already local** (`claimsText` holds the complete English claims blob), **EP full** via the EPO side-table, **IN** via IPIndia. Descriptions US-only and truncated to 5,000 chars. Not embedded. |
| Embeddings | `local_patent_embeddings` | pgvector `bit(512)`, Voyage `voyage-3.5-lite` (natively 1024-dim, MRL-truncated to 512, binary-quantised), Hamming ANN via IVFFlat. **Title+abstract only** (title+claim-1 for EP grants). **One vector per DOCDB family** (~29.8M). |
| Hybrid retrieval | [orchestrator.ts](src/lib/patent-search/orchestrator.ts) | pgvector + Postgres FTS + trigram lanes, RRF fusion, Voyage `rerank-2.5-lite`. |
| ~~Claim gap-fill~~ | ~~[google-patents-claims-service.ts](src/lib/google-patents-claims-service.ts)~~ | **Not used.** On-demand BigQuery claims fetch — redundant, since US full claims are already local (9.0). |
| Scientific literature | [literature-search-service.ts](src/lib/literature-search-service.ts) | **Seven providers**: Google Scholar (SerpAPI), Semantic Scholar, Crossref, OpenAlex, PubMed, arXiv, CORE. **Five need no API key.** Metadata only. |
| LLM routing | [gateway.ts](src/lib/metering/gateway.ts) | Per-plan stage→task model resolution, fallback chains, cost logging, reservations, fail-closed stage configs. |
| Feature extraction | [patent-api-analysis.ts](src/lib/patent-api-analysis.ts) | `extractPublicInventionFeatures()`, `mapFeaturesToPublicPatent()` — element-wise present/partial/absent with verbatim quotes. |
| Durable jobs | [office-action-job-service.ts](src/lib/office-action-job-service.ts) | Lease queue: guarded claim, heartbeat, retry backoff, worker or inline drain. |

**Not available, and the design must not pretend otherwise:**

- **No corpus-wide citation data.** Forward, backward and examiner citations exist only in `PriorArtPatentDetail`, a sparse per-search SerpAPI cache with a required foreign key to `PriorArtPatent`.
- **No legal status.** No grant dates, no lapse events, no INPADOC status.
- **No priority dates** on the corpus (only in the sparse prior-art cache).
- **No patent family table** — `familyId` is a bare string.
- **No normalised assignees or inventors** — JSON blobs and string arrays.
- **No product, company, standards or regulatory corpus** of any kind.
- **Nothing before 2000.** Publications without an abstract were dropped at load.
- **No clustering, aggregation or analytics code exists** — all of it is greenfield.
- `PriorArtScholarContent` exists but is **dead**: written only by unreachable code, read by nothing, four of eleven fields ever populated. Not reusable.

Every feature in Sections 6–8 was checked against this list. Where a feature needs data we lack, it is deferred to Phase 2 with the dependency named.

## 9.2 The seven-stage pipeline

Stages 1–4 and 6 run on a durable DB-lease job queue cloned from [office-action-job-service.ts](src/lib/office-action-job-service.ts), where **the job row is the run row**. Stages 0, 5 and 7 are interactive.

### Stage 0 — SCOPE *(interactive, 5–15s, cheap tier)*
Deterministic expansion (extending [query-planner.ts](src/lib/patent-search/query-planner.ts):408) plus one LLM call at stage `WS_SCOPE_COMPILE`. Produces concepts, synonyms, functional phrasings, CPC candidates with glosses, exclusions, assumptions. Persisted to `WhitespaceStudy.scope` as versioned JSON. User edits before commit; each edit re-estimates family count via a cheap `COUNT` query.

### Stage 1 — FIELD_MAP *(background, 2–6 min, SQL + one cheap LLM call)*
Pure SQL over `local_patents`, decomposed into ~8 independent facet queries so no single statement approaches the 30–60s profile of a deep search, with worker heartbeats between facets:

- Family census: `GROUP BY COALESCE("familyId", "publicationNumber")`
- Filing/publication trend series by year
- Jurisdiction distribution (family-level, and family jurisdiction breadth)
- CPC subclass distribution and co-classification pair counts
- Top applicants after on-the-fly canonicalisation
- Legal-status proxy distribution from kind codes
- **Text-coverage census** — what fraction of the field has retrievable claims, by source. This feeds gate G1 and the coverage strip.
- Stratified embedding sample draw: year-bucket × top-CPC-subclass strata, `DISTINCT ON (familyId)` joined to `local_patent_embeddings`, capped at 50,000 families, with per-stratum weights retained for honest extrapolation.

One cheap LLM call narrates the census into the field verdict paragraph.

### Stage 2 — CLUSTER *(background, 2–5 min, free math + batched cheap LLM)*

**Algorithm: binary k-means ("k-majority") in the Node worker.** Vectors arrive as `bit(512)`, packed into `Uint32Array` (16 words each; 50k families ≈ 3.2MB). Assignment is XOR + popcount Hamming; centroid update is per-bit majority vote across members. k-means++ initialisation, 15–25 Lloyd iterations. Cost per iteration at k=24, n=50k is ~19M word operations — milliseconds. A secondary real-valued mean centroid (Float32×512 per cluster) is kept for fine member ranking and inter-centroid geometry.

**k = 24 at the top level** (tunable 8–40), chosen because it is the largest number of areas a user can browse without the map becoming a blob.

**Why not HDBSCAN:** no maintained TypeScript implementation at this scale; density estimation in binary Hamming space is poorly calibrated (integer distances 0–512 with heavy ties); and its "noise" label is a UX liability — telling a user 30% of their field is noise is both true and useless. k-means plus cohesion pruning plus recursion gives the same product value transparently.

**Recursion:** sub-clustering re-runs k-majority (k=6–12) over a cluster's members, depth-capped at 3. Where a cluster's field estimate exceeds its sampled membership, the system first re-samples within the parent's Hamming radius via an ANN query seeded by the binarised parent centroid.

**Naming:** one or two batched calls at stage `WS_CLUSTER_LABEL` — 10–15 medoid titles, two abstract snippets and the top five CPC codes per cluster → `{label, description, keywords[]}`. Medoids are the members minimising summed Hamming distance to co-members.

**Cohesion:** mean intra-cluster Hamming (normalised /512), sampled silhouette over a 2k subsample, and separation as nearest inter-centroid distance → a three-band coherence grade. Diffuse clusters are badged and excluded from automated hypothesis generation.

**Map layout:** PCA to 2D over the ≤40 centroids in TypeScript (trivial at that size) plus a deterministic force spread. No t-SNE or UMAP dependency.

**Field-scale counts** are stratified-weight extrapolations from the sample and are labelled as estimates. An opt-in full-census pass (single SQL argmin over binarised centroids) is available in Phase 2.

### Stage 3 — SIGNALS *(background, 1–3 min, SQL + arithmetic, zero LLM)*
Per cluster and per CPC×concept cell: normalised density, 5-year filing CAGR, assignee HHI, jurisdiction coverage, recency share, crowdedness index. Plus the **terminology-divergence probe** — for each scope concept, run the lexical lanes (FTS + trigram) and the semantic lane separately and compute Jaccard overlap of the top-300 family sets. Low overlap with high semantic-only yield indicates terminology divergence; one cheap LLM call summarises the vocabulary of the semantic-only hits.

**No language model touches any number in this stage.** This is what makes the landscape reproducible.

### Stage 4 — DEEP_DIVE *(user-triggered per cluster, 5–15 min, mid tier, metered)*
Claims assembly for the top 30–60 families, entirely from local storage: `claimsText` (US full claims, and IN via IPIndia) plus `epo_ep_fulltext` (EP full claims). No external fetch. Families with no local claim text are **excluded from element analysis and counted in the coverage record** rather than silently omitted — the count is surfaced on the claim-element screen (6.10) and feeds gate G1.

LLM claim-element extraction adapted from `extractPublicInventionFeatures`, at stage `WS_CLAIM_ELEMENTS`. Then deterministic co-occurrence and residual computation (10.3), and a problem–solution–constraint matrix extracted from abstracts and available descriptions. Records its own text coverage by jurisdiction and source.

### Stage 5 — HYPOTHESIZE *(1–2 min, premium tier)*
A premium model synthesises structured hypotheses from stage 3 and 4 outputs. Three generation strategies run: rare-but-supported element combinations, low-density cells adjacent to high-velocity cells, and semantic voids between cluster centroids. Every hypothesis is created with `type = UNDETERMINED`, auto-populated `coverageLimitations`, and linked evidence rows. **The generator is explicitly prompted that it is proposing candidates for testing, not findings** — and the schema enforces it, since only the gate ladder can set a type.

### Stage 6 — VALIDATE *(background, 3–8 min per hypothesis, mid tier + one premium call)*
The adversarial loop. Detailed in Section 10.5.

### Stage 7 — CONVERT *(instant)*
Promotion to `WhitespaceConcept` in the `inventionFeatures` shape, then pure-transform handoff builders following the [novelty-drafting-handoff.ts](src/lib/novelty-drafting-handoff.ts) pattern.

## 9.3 Closing the data gaps

| Gap | Approach | Effort | Phase |
|---|---|---|---|
| Family consolidation | `GROUP BY COALESCE(familyId, publicationNumber)` throughout; earliest family `filingDate` as priority proxy; family jurisdiction set as coverage breadth. No new table. | Low | MVP |
| Assignee normalisation | On-the-fly TypeScript canonicaliser: extract from `applicants` JSON, uppercase, strip legal suffixes (INC/LLC/CORP/GMBH/LTD/KK/AB/SA/PLC/CO), collapse punctuation, plus a curated ~200-entry alias map for majors. Stored only on study rows, never globally. | Low–med | MVP |
| Citations | **Not obtainable by query.** Per-query API enrichment is ruled out by 9.0. The only route is **bulk ingestion** of the BigQuery citation tables into a local `PatentCitation` table, following the existing corpus-load pattern — a one-time export-and-load, not a runtime dependency. Until that ingestion runs, the module has no citation data and says so. | High (one-time ingestion) | Phase 2, gated on ingestion |
| Legal status | MVP and beyond: kind-code + age heuristic, labelled **"status proxy"** in the UI and never "legal status". Real legal events would likewise require bulk ingestion (EPO INPADOC bulk, or DOCDB legal-event files through the existing `epo-bdds` loader, which already handles bulk archives). **Until then the proxy is permanent, not provisional** — and the UI must not imply otherwise. | Low / High | Proxy indefinitely |
| Pre-2000 blind spot | **Now unmitigated.** The previous mitigation — date-unrestricted external disproof searches — is removed by 9.0. The corpus begins in 2000 and nothing in the pipeline can see behind that boundary. Response is disclosure only: stamped on every density visual, auto-recorded in `coverageLimitations`, and stated in the recommended-validation steps as an explicit human task ("search pre-2000 art in [classification] using an external tool before relying on this"). Closing it properly means **bulk-loading pre-2000 records into `local_patents`**, which is the same import path already built and is the highest-value data investment available to this module. | — (disclosure) / High (ingestion) | Disclosed in MVP; ingestion recommended |
| Terminology whitespace | Lexical-vs-semantic lane disagreement (Stage 3). Entirely local, cheap, reuses existing lanes, genuinely differentiating. **Unaffected by the constraint.** | Med | MVP |
| Scientific literature | Non-patent literature is not a patent API service and remains in scope. Cluster-scale probe via the five keyless providers (Semantic Scholar, Crossref, OpenAlex, PubMed, arXiv) behind a new gateway adding cache, rate limiting, retries and metering. **Every result is persisted locally** in `WhitespaceLiteratureItem` and embedded through the same Voyage path as patents, so a study becomes self-contained and re-runnable after first fetch. If a fully-local posture is wanted here too, OpenAlex publishes a complete bulk snapshot that can be loaded the same way as the patent corpus — see 9.3a. | Med | MVP |
| Products / companies / standards | No corpus, and no API route. **Assisted manual entry only** — the user adds the products they know, the system maps them to families. This was already the recommendation on accuracy grounds; the constraint now makes it the only option. | Med | Phase 2 |

## 9.3a Ingestion roadmap — what to load instead of calling

The local-only constraint converts every "which API do we call?" question into "which dataset do we load?". That is a better question, because a loaded dataset is reproducible, has no per-query cost, and cannot fail at runtime. It is also a question this codebase already knows how to answer — [scripts/google-patents-import/](scripts/google-patents-import/) is a complete, documented, resumable bulk-load pipeline (staging SQL → GCS export → Postgres upsert → embedding batch), and [src/lib/epo-bdds/](src/lib/epo-bdds/) is a second one for EPO bulk archives.

Ranked by value per unit of effort:

| # | Dataset | Unlocks | Effort | Notes |
|---|---|---|---|---|
| 1 | **Pre-2000 patent records** | Closes the single largest analytical blind spot; makes density claims defensible in mature mechanical, materials and chemical fields | Medium — same 14-column pipeline, extended date range; the load scripts already parameterise by year | **Highest-value investment available to this module.** The corpus was capped at 2000 for cost, not capability |
| 2 | **Backward + forward citations** | Influence metrics, citation deserts, examiner-citation signal; enables the whole of screen 6.11 | Medium — BigQuery `patents.publications.citation` is a well-defined bulk export; needs a `PatentCitation` join table | Also unlocks link-prediction as a falsifiable gap signal (2.7) |
| 3 | **Full descriptions (beyond 5,000 chars)** | Better problem–solution extraction; "described but not claimed" detection gets substantially stronger | High — description text is the largest scan cost in the dataset and the biggest storage line | Consider loading only for shortlisted CPC areas rather than corpus-wide |
| 4 | **OpenAlex snapshot** | Makes the science-vs-patent comparison fully local and instantaneous; removes the last external runtime dependency | Medium — published as a complete bulk snapshot with a stable schema | Only worth it if a fully-local posture is required; the keyless APIs work well and cache locally |
| 5 | **Legal-event / INPADOC bulk** | Real legal status, lapse-driven opportunity layer (8.10) | High — schema complexity and update cadence | The `epo-bdds` loader already handles bulk archive ingest, so the plumbing exists |
| 6 | **CN claims** | Would fix the most severe jurisdictional gap (CN is often ~28% of a field with ~12% claim readability) | Very high — not in the public dataset at any price; would need a commercial source | Flagged for completeness; not realistically actionable |

**Recommendation: items 1 and 2, in that order, and treat them as prerequisites for the claims we make rather than as enhancements.** Item 1 in particular changes what the product is allowed to say. Every density statement currently carries "since 2000" as a caveat; loading pre-2000 removes the caveat instead of managing it, and it is the difference between a landscape a patent attorney trusts and one they discount.

## 9.4 Feature → architecture map

| Feature | Data | Retrieval | Analysis | Model tier | Confidence basis | Evidence | Compute |
|---|---|---|---|---|---|---|---|
| Scope compile | — | — | Deterministic expansion + LLM | Cheap | Concept coverage vs corpus | CPC samples | Very low |
| Field census | `local_patents` | SQL | Aggregation | None | Exact counts | Family lists | Low (SQL) |
| Trend / jurisdiction / assignee | `local_patents` | SQL | Aggregation + canonicalisation | None | Exact, with canonicalisation caveat | Family lists | Low |
| Text-coverage census | `local_patents`, `epo_ep_fulltext` | SQL | Aggregation | None | Exact | — | Low |
| Clustering | `local_patent_embeddings` | ANN + stratified sample | Binary k-means | Cheap (naming only) | Cohesion + silhouette | Medoid families | Low (in-worker) |
| Cluster naming | medoid text | — | LLM summarisation | Cheap | Medoid representativeness | Medoid titles | Very low |
| Density / velocity / HHI | `local_patents` | SQL | Arithmetic | None | Exact within coverage | Family lists | Low |
| Terminology divergence | `local_patents` | FTS + trigram + vector | Jaccard overlap | Cheap (summary) | Set overlap | Semantic-only hits | Medium |
| Claim-element extraction | local claims (US/EP/IN) | Local fetch | LLM extraction | Mid | Text coverage + extraction agreement | Verbatim claim quotes | **High** |
| Co-occurrence / lift | extracted elements | — | Arithmetic | None | Support counts | Element→family map | Low |
| Problem–solution–constraint | abstracts + descriptions | — | LLM extraction | Mid | Support counts per cell | Passage quotes | High |
| Science vs patent | literature providers | HTTP fan-out | Arithmetic ratios | None | Provider health + coverage | DOIs | Medium (external) |
| Hypothesis generation | stages 3+4 outputs | — | LLM synthesis | **Premium** | Inherited from inputs | Linked evidence | High |
| Gate ladder | corpus + literature | Multi-lane + rerank | Rules + LLM mapping | Mid | Gate outcomes | Search traces | High |
| Red team | hypothesis + survivors | Multi-lane | LLM adversarial | **Premium** | Attack survival | Attack log | High |
| Semantic novelty | `local_patent_embeddings` | ANN | Distance percentile | None | Self-calibrated per field | Nearest families | Low |
| Cross-domain | `local_patent_embeddings` | ANN + CPC filter | LLM framing | Mid | Source-family existence | Source families | Medium |
| Concept development | concept + prior art | — | LLM generation | Mid–premium | User-verified | Differentiation table | Medium |
| Report | all | — | Deterministic assembly | Cheap (prose) | — | Full appendix | Low |

**Deterministic vs ML vs LLM — the dividing line.** Deterministic: all counts, ratios, densities, velocities, concentrations, lifts, distances, percentiles, gate arithmetic. Machine learning (non-LLM): embedding generation and retrieval, clustering, reranking. LLM: language tasks only — scope expansion, naming, extraction from prose, synthesis, critique, report writing. **No LLM produces a number that appears in the UI as a measurement.** Where an LLM's output is quantified (e.g. element mapping), the quantity is a count of LLM judgments, and it is labelled as such.

## 9.5 Data model

New enum values: `ServiceType.WHITESPACE_ANALYSIS`, `FeatureCode.WHITESPACE_ANALYSIS`, and task codes `WS_SCOPE`, `WS_CLUSTER_LABEL`, `WS_CLAIM_ELEMENTS`, `WS_HYPOTHESIS_GENERATE`, `WS_HYPOTHESIS_VALIDATE`, `WS_REDTEAM`.

```prisma
model WhitespaceStudy {
  id, userId, tenantId?, projectId?, title, status   // ACTIVE | ARCHIVED
  scope         Json      // concepts[], synonyms{}, cpc[], exclusions[], assumptions[], dateRange
  scopeVersion  Int
  seedText      String?
  role          String?   // UI tailoring only — never gates analysis
  @@index([userId, updatedAt]) @@index([tenantId])
}

model WhitespaceRun {          // the run row IS the durable job row
  id, studyId, stage           // FIELD_MAP | CLUSTER | SIGNALS | DEEP_DIVE | VALIDATE
  scopeVersion Int, scopeSnapshot Json, params Json?
  status String                // QUEUED | PROCESSING | COMPLETED | FAILED
  lockedBy String?, lockedUntil DateTime?, heartbeatAt DateTime?
  attemptCount Int, nextAttemptAt DateTime, lastError String?
  results Json?, gateCounts Json?, durationMs Int?
  @@index([studyId]) @@index([status, nextAttemptAt])
}

model WhitespaceCluster {
  id, studyId, runId, parentClusterId String?, depth Int
  label String, description String?, keywords String[]
  centroidBits String           // 512-bit hex
  memberCount Int, fieldEstimate Int
  cohesion Float?, separation Float?, silhouette Float?
  metrics Json?                 // density, velocity, hhi, jurisdictions, topAssignees, cpcMix,
                                // termDivergence, publicationVolume, researchToPatentRatio
  @@index([studyId]) @@index([parentClusterId])
}

model WhitespaceClusterMember {
  id, studyId, clusterId?       // null between sampling and assignment
  familyKey String, publicationNumber String, title String
  bits String?                  // retained so re-clustering needs no refetch
  distance Float?, isMedoid Boolean, year Int?, assigneeCanonical String?
  @@unique([studyId, familyKey]) @@index([clusterId])
}

model WhitespaceAreaAnalysis {
  id, studyId, clusterId, status
  claimElements Json?           // elements[], coOccurrence, lift
  problemSolutionMatrix Json?
  textCoverage Json             // { familiesTotal, withClaims, bySource } — feeds gate G1
  results Json?
}

model WhitespaceHypothesis {
  id, studyId, clusterId?, areaAnalysisId?
  type String                   // the ten types + UNDETERMINED
  statement String, rationale String
  elementCombination Json?
  scores Json                   // always the full vector, never a bare number
  status String                 // DRAFT|VALIDATING|VALIDATED|REFUTED|INCONCLUSIVE
  validation Json?              // attacks run, gate outcomes, red-team notes
  coverageLimitations Json      // NON-OPTIONAL, auto-populated
  humanReview Json?             // expert verdicts (Phase 3)
  createdBy String
}

model WhitespaceEvidence {
  id, studyId, hypothesisId?, clusterId?
  kind String                   // PATENT_PASSAGE | SCHOLAR | SEARCH_TRACE | STATISTIC | USER
  refId String?, passage String? @db.Text
  queryText String?, score Float?
  stance String                 // SUPPORTING | CONTRADICTORY | CONTEXT
  data Json?
  @@index([hypothesisId]) @@index([studyId, stance])
}

model WhitespaceConcept {
  id, studyId, hypothesisId?
  title, summary, features Json  // inventionFeatures shape — handoff-ready
  status String, handoffs Json?  // { noveltySessionId?, draftingSessionId? }
}

model WhitespaceTrailEntry { id, studyId, kind, actor, summary, data Json? }

model WhitespaceLiteratureItem {
  id, studyId, clusterId?, hypothesisId?
  doi String?, title String, authors String[], year Int?, venue String?
  abstract String? @db.Text, citationCount Int?, url String?, isOpenAccess Boolean
  provider String, embedding ... // Voyage bits, so paper/patent scores are comparable
  @@index([studyId, clusterId])
}

model LiteratureQueryCache { cacheKey String @id, provider, resultJson Json, hitCount Int, expiresAt DateTime }

model PatentCitationCache {     // decoupled — NOT PriorArtPatentDetail (required FK)
  publicationNumber String @id
  citationsPatent Json?, citedByPatents Json?, legalEvents Json?
  source String, fetchedAt DateTime
}
```

**Design rule applied throughout:** write-once, read-whole analytics (statistics, matrices, gate funnels) are JSON. Anything filtered, linked, or independently mutated (clusters, members, hypotheses, evidence, concepts) is normalised.

## 9.6 Domain-adaptive decomposition

The brief correctly insists that biotech, electronics, mechanical and software fields should not share a decomposition template. Implementation:

A set of ~8 curated decomposition templates (mechanical/device, electronics/hardware, software/algorithmic, biotech/pharma, materials/chemical, energy/power, medical device, process/manufacturing), each a list of dimension names with prompting guidance. Template selection is **deterministic first** — from the field's CPC section profile (A61 → medical, C07/C12 → biotech, G06 → software, H01/H02 → electronics, and so on) — with an LLM tiebreak only where the profile is genuinely mixed. Selection is shown to the user and overridable, and the free-text re-decomposition of Section 8.1 sits on top.

Deterministic-first matters: it is free, reproducible, and correct in the large majority of cases where a field has a clear classification centre of gravity.

## 9.7 Cost-aware model routing

All calls go through [gateway.ts](src/lib/metering/gateway.ts) with fail-closed stage configs, so a super-admin maps each `WS_*` stage to a model per plan.

| Stage | Tier | Why |
|---|---|---|
| `WS_SCOPE` | Cheap (flash / groq / deepseek class) | Structured expansion, low creativity |
| `WS_CLUSTER_LABEL` | Cheap | Summarising 15 titles into a label |
| Field narration | Cheap | Reading numbers into prose |
| `WS_CLAIM_ELEMENTS` | Mid | High volume, structured extraction, accuracy over flair |
| PSC extraction | Mid | Same |
| Validation mapping | Mid | Same |
| `WS_HYPOTHESIS_GENERATE` | **Premium** | Reasoning quality *is* the product here |
| `WS_REDTEAM` | **Premium** | Adversarial reasoning is the hardest task in the pipeline |

Exactly two stages get premium models. Everything else is cheap or mid. This is what keeps a study near $1–2.50 rather than $20.

## 9.8 Estimated cost per study

For a representative study (one field map, k=24 clustering, three deep dives at 40 families each, eight hypotheses, five validated):

| Stage | Calls | Approx tokens | Tier | Estimated cost |
|---|---|---|---|---|
| Scope compile | 1–2 | 6k | Cheap | <$0.01 |
| Field narration | 1 | 3k | Cheap | <$0.01 |
| Cluster labelling | 1–2 batched | 15k | Cheap | ~$0.01 |
| Claim-element extraction | 3 × 40 families | ~350k | Mid | $0.15–0.40 |
| PSC extraction | 3 | ~90k | Mid | $0.05–0.12 |
| Hypothesis generation | 3 | 3 × (15k in / 3k out) | Premium | $0.30–0.75 |
| Validation mapping | 5 × ~15 candidates | ~250k | Mid | $0.10–0.30 |
| Red-team passes | 5 | 5 × 12k | Premium | $0.25–0.60 |
| Voyage embeddings + rerank | ~30 rerank calls | — | rerank-2.5-lite | $0.10–0.25 |
| Literature (keyless providers) | ~50 queries | — | free | $0.00 |
| ~~Patent API services~~ | — | — | — | **$0.00 — none called (9.0)** |
| **Total AI/API** | | | | **≈ $1.00–2.30** |

Database compute (census SQL, ANN queries, in-worker clustering) is effectively free at the margin, and under the local-only constraint it is the overwhelming majority of the work the module does. There are **no per-query patent-data charges at all** — no SerpAPI credits, no BigQuery scan billing, no dry-run guard to tune.

That has a pricing consequence worth taking seriously: the marginal cost of a study is now almost entirely LLM tokens, which we control by stage routing. **The metering axis remains deep dives and validations per month**, but the underlying economics are far more predictable than a design with external data dependencies, and the Observatory half of the product (stages 0–3) costs essentially nothing to serve. That is what makes the unmetered-Observatory decision in 1.6 financially safe rather than merely generous.

These are estimates and should be instrumented from day one.

---

# Section 10 — Whitespace methodology

## 10.1 The core claim, stated carefully

The methodology below produces **analytical indicators about the distribution of patent and scientific activity in a defined corpus, and structured hypotheses derived from those indicators**. It does not produce patentability opinions, novelty determinations, or freedom-to-operate conclusions, and no output of this system should be represented as any of those. That framing is not legal boilerplate; it constrains what we build and what we say.

## 10.2 The ten whitespace types

The central methodological commitment. An area with low patent density is assigned exactly one type, and the type determines what it means:

| # | Type | Definition | Typical detection | Action implied |
|---|---|---|---|---|
| 1 | **Data whitespace** | Our corpus cannot see the area (pre-2000, no claims text, dropped abstracts, jurisdiction absent) | Text-coverage census below threshold; date distribution truncated | Not an opportunity. Widen data before concluding. |
| 2 | **Terminology whitespace** | The area is patented, under words we didn't search | Lexical/semantic lane disagreement; semantic-only hits are dense | Not an opportunity. Fix vocabulary; often reveals a crowded area. |
| 3 | **Patent whitespace** | Genuinely few families addressing the problem | Low family density after types 1–2 excluded | Candidate. Continue testing. |
| 4 | **Claim whitespace** | Patents exist but their independent claims don't recite this combination | Element mapping returns Partial/Absent across the closest families | Candidate — often the strongest kind, and the most attorney-relevant. |
| 5 | **Scientific whitespace** | Neither patents nor literature address it | Low density on both axes of the research–patent quadrant | Usually a warning. Could be genuinely new, more often uninteresting or infeasible. |
| 6 | **Product/market whitespace** | Patented and/or researched, but nothing is sold | Patent or literature activity with no product evidence | Interesting — may indicate infeasibility, or an unexploited position. |
| 7 | **Technical feasibility whitespace** | Attempted and abandoned | Publications rose then fell; failure language in abstracts; discontinued products | **Not an opportunity** unless an enabling change is identified. The most dangerous false positive. |
| 8 | **Commercial whitespace** | Feasible but uneconomic | Cost/scale constraints unaddressed across the art; no commercial entrants despite maturity | Conditional — worth pursuing only if economics changed. |
| 9 | **Regulatory whitespace** | Blocked or unapproved | Regulatory constraints named in descriptions; no approvals in the space | Conditional; requires domain expertise we don't have. |
| 10 | **Genuine invention opportunity** | Survives all of the above | Passes gates G1–G4 with confidence ≥ 0.75 | Pursue. Validate with novelty search. |

Types 1 and 2 are *artefacts of our method*. Types 5, 7, 8 and 9 are *real gaps with reasons they are closed*. Types 3, 4, 6 and 10 are *candidates*. Only type 10 is a recommendation, and it is deliberately hard to reach.

## 10.2a Methodological grounding — and the authority that matters most

Before the formulas, the finding that most shapes them.

**WIPO's own *Guidelines for Preparing Patent Landscape Reports* (Trippe, WIPO Publication 946, 2015) never uses the term "white space" anywhere in its 130 pages.** What it does contain, in §8.6.2 on spatial concept maps, is a direct warning against the exact inference this entire product category is built on — that because such maps have no real axes and distance is relative to the document collection, *guesses cannot generally be made about what sort of document might occupy an empty space on the map*. It further notes that contour lines encompassing multiple clusters are routinely misread as implying a relationship between them, when they merely reflect the spread of documents.

This is the authoritative statement of the empty-quadrant fallacy, and it comes from the standard-setter for the whole discipline. We treat it as a binding design constraint, and it produces the single most important rule in our methodology:

> **No opportunity claim in this product may originate from emptiness on a dimensionality-reduced map.**

Our cluster map (6.8) is therefore a *selector*, never evidence. Every actual gap claim originates from one of four falsifiable signal types instead:

1. **Semantically-axed absence** — problem × solution, or claim-element × claim-element. Axes that mean something, so an empty cell is interpretable as "no document teaches S for P" rather than "no dot here".
2. **Statistical under-combination** — co-occurrence significantly below chance between two *individually well-established* elements (10.3).
3. **Disagreement between independent views** — lexical retrieval vs semantic retrieval (our terminology probe), or literature activity vs patent activity (the research–patent ratio). Disagreement signals are falsifiable in a way absence signals are not.
4. **Anomaly** — documents that are outliers relative to their own neighbourhood, which points at real readable documents rather than at a hole.

The methodology literature converges on the same conclusion from the other direction: work following Yoon and Park's GTM-based "patent vacuum" maps has been criticised precisely because defining and interpreting vacancies is intuitive and ambiguous, and because a vacant region may be empty due to technical barriers or abandoned technology rather than opportunity — which is the whitespace type system of §10.2 restated in the academic literature. The novelty-outlier line of work (using Local Outlier Factor to score patents against their neighbourhood) exists specifically as a falsifiable alternative to vacancy hunting, and more recent semantic–structural coupling-entropy approaches — which look for mismatch between text-derived functional boundaries and network-derived structural boundaries — are notable for being *retrospectively validated* on a held-out time slice. That validation design is one we should adopt (11.5).

**WIPO's prescribed analytical vocabulary** also maps onto our pipeline more closely than we expected, and where it does we should use their terms:

| WIPO task (Pub. 946) | Our stage |
|---|---|
| §6.1 Data cleanup and grouping | Assignee canonicalisation (9.3) |
| §6.3 Co-occurrence matrices | Claim-element co-occurrence, CPC co-classification (Stage 4) |
| §6.4 Clustering and classification | Stage 2 |
| §6.5 Spatial concept mapping | Cluster map — **demoted to selector per the warning above** |
| §6.8 Network analysis | Citation network (Phase 2) |
| **§6.9 Semantic analysis: SAO triplets** | **Problem–solution–constraint matrix (6.9)** |

The SAO correspondence deserves emphasis. WIPO's Subject–Action–Object decomposition treats **Action + Object as the problem and Subject as the solution**, and observes that aggregating these across a corpus yields a knowledge base able to offer solutions to a problem *even when no single document contains them together*. That is precisely the analytical move our problem–solution–constraint matrix makes, and it is the WIPO-sanctioned technique for doing it. We should implement our extraction as an SAO-style decomposition explicitly, and say so — it converts our most novel-looking screen into an implementation of a documented standard.

**Search quality thresholds.** WIPO holds that statistical findings are safe when recall exceeds 90% and precision exceeds 70%; below 70% precision, manual review is required. Our Stage 1 census should estimate and display both against a sampled ground truth, and the coverage strip should carry them.

## 10.3 Metric definitions

**Density.** For a cell *c* (cluster, or CPC × concept cell):

```
D(c) = log1p(families(c)) / log1p(P95_families)
```
where P95 is the 95th percentile family count across the study's cells. Log-scaled because patent distributions are heavily skewed; percentile-normalised so density is relative to *this field*, not an absolute that means nothing across domains.

**Hierarchy-depth correction (required).** Where a cell is defined by a classification code, raw counts are **not comparable across hierarchy levels**, because examiners push documents down the tree — parent codes are structurally sparse as an artefact of classification practice, not as evidence of an unexplored area. Cheng and Wang's technology/function matrix work makes this concrete: when reading a low-count cell, only a *sibling* code at the same level is interpretable; a parent code's low count is a hierarchy artefact. We therefore:

```
D_adj(c) = D(c) / medianDensityAtDepth(depth(c))
```
and, in the UI, only ever compare cells at equal classification depth. **Without this correction the entire upper classification tree reports as opportunity**, which would be a first-order bug in a whitespace product.

**Velocity.** `V(c)` = compound annual growth rate of family counts over the trailing five years, computed on filing date.

**Publication-lag handling.** Because of the 18-month publication delay, recent filing years are systematically undercounted. WIPO's guidance is explicit and we adopt it in two parts:
- **For display:** do *not* truncate recent years. Show them, and draw a marked boundary at 18 months before the data end with a footnote explaining the dip. Truncating hides the convention from the user; marking it teaches them to read the chart.
- **For computation:** exclude the trailing 18 months from CAGR. Including it makes every field appear to be collapsing, and would systematically mislabel active areas as dormant in the research–patent quadrant.

The wider truncation literature (Hall, Jaffe and Trajtenberg on citation truncation, and subsequent corrections work) suggests that for *citation*-based indicators a three-to-four-year exclusion may be required. That is a Phase 2 concern, since we have no citation data in MVP — but when citation metrics arrive, they must not reuse the 18-month convention.

**Family counting.** All counts are family-level. We use `familyId` (DOCDB) via `GROUP BY COALESCE(familyId, publicationNumber)`. WIPO notes that INPADOC extended families dramatically underrepresent investment — particularly for US and JP portfolios — and recommends One Document Per Invention as a middle ground. Our DOCDB simple-family basis sits closer to ODPI than to extended families, which is the right side of that trade-off, but **the convention must be declared in every export** and held constant within a study.

**Crowdedness.**
```
C(c) = 0.5·D(c) + 0.3·percentile(V(c)) + 0.2·(1 − HHI_assignee(c))
```
Dense, accelerating, and contested by many players. The HHI term inverts because a field dominated by one assignee is *less* crowded in the sense that matters — there is room to work around a single programme, less so against twenty competitors.

**Combination rarity.** For claim elements *a* and *b* from deep-dive extraction, compute the co-occurrence **residual against chance**, not raw lift:

```
E(a,b) = ( support(a) · support(b) ) / N          expected under independence
z(a,b) = ( c(a,b) − E(a,b) ) / sqrt( E(a,b) )     standardised residual
R(a,b) = clamp( −z(a,b) / z_ref , 0, 1 )          rarity, z_ref = 3.0
```

**Valid only when `support(a) ≥ s_min` AND `support(b) ≥ s_min`** (default `s_min` = 20 families, or 5% of the area, whichever is larger).

Two points about this formulation.

**Why the residual rather than lift.** Lift is unstable at low counts and says nothing about whether a deviation is larger than sampling noise. The standardised residual asks the right question — *is this pair combined significantly less often than chance would predict?* — and its magnitude is interpretable. A candidate gap is a cell where **both marginals are large and z is strongly negative**: two things the field actively pursues that it systematically does not put together. This is the same normalisation logic that the bibliometrics literature settled on for co-occurrence data, where association strength (`c_ij / (c_i · c_j)`, a probabilistic measure) is preferred over set-theoretic measures like cosine and Jaccard precisely because the latter do not properly correct for size effects.

**Why the support floor is non-negotiable.** Without it, the rarest combinations are always the most meaningless ones — two obscure elements that co-occur nowhere because neither matters. With it, rarity only counts between elements the field has independently established as useful, which is exactly the condition under which an unexplored combination is interesting. Section 13.6 shows this floor doing real work: the highest apparent rarity signal in the worked example is suppressed because one element falls below support.

**Temporal extension (Phase 2).** Tracking `Δz(a,b)` across rolling windows separates a pair that has *never* been combined from one that has *recently become* combinable — the second is a much stronger opportunity signal, because it suggests an enabling change rather than a standing barrier.

**Semantic novelty.** For hypothesis *h*: embed the statement through the exact path in [patent-corpus-service.ts](src/lib/patent-corpus-service.ts) (Voyage → MRL-512 → binarise — replicating this precisely is required for comparability with stored vectors), ANN-retrieve the top 200 within the field, then
```
N(h) = clamp( (d_min − p05) / (p50 − p05), 0, 1 )
```
where `d_min` is the Hamming distance to the nearest family and `p05`/`p50` are that field's own nearest-neighbour distance percentiles. **Self-calibrating per field**, which matters because absolute Hamming distances are not comparable across technology domains.

**Research-to-patent ratio — with mandatory lag alignment.** This is the metric that drives the quadrant in 6.12, and the naive version of it is wrong.

Science-to-patent lag is large, highly field-dependent, and well documented: roughly four years from publication to first patent citation in some biomedical areas, a median of around six years for biomedical papers generally, and an average exceeding ten years in human-computer interaction, with the median in that field roughly doubling between 1989 and 2014. **Comparing publication volume and filing volume in the same year is therefore meaningless** — it compares a leading indicator against a lagging one and will systematically mislabel healthy translation pipelines as "patent-led" and genuine research fronts as ordinary.

We therefore compute:

```
lag(field)  = argmax_k  corr( pubVolume[t−k] , filingVolume[t] )   for k ∈ [0,12] years
RPR(c)      = pubCAGR(c, window ending now)
              ÷ filingCAGR(c, window ending now, trailing 18 months excluded)
              evaluated with publication series shifted forward by lag(field)
```

The lag is estimated **per field, from the field's own data**, by maximising cross-correlation between the publication and filing series — not assumed. Where the field is too small or the series too short to estimate it reliably, the system says so and presents the quadrant with an explicit "lag not estimable — interpret with caution" state rather than defaulting to zero.

This makes the lag itself a displayed finding, which is useful in its own right: a field with a twelve-year science-to-patent lag behaves very differently from one with a three-year lag, and a user planning a filing programme should know which they are in.

**Evidence quality.**
```
Q(h) = 0.35·textCoverage + 0.25·sourceDiversity + 0.40·disproofCompleteness
```
`disproofCompleteness` is the fraction of planned disproof searches actually executed with adequate recall. It carries the largest weight deliberately: **evidence quality is mostly about how hard we tried to be wrong**, not how much supporting material we found.

**Confidence.**
```
conf(h) = 0.40·validationSurvival + 0.30·Q(h) + 0.20·N(h) + 0.10·R(h)
```
`validationSurvival` starts at 0.5; each clean disproof search adds `+0.5/M` where M is the planned attack count. **Any single hit where element mapping returns Present for the full combination forces `conf → 0` and `status → REFUTED`** — one solid refutation outweighs any amount of supporting evidence, which is the correct epistemics and the opposite of how most tools behave. Confidence is hard-capped at 0.6 until all mandatory gates have passed.

**Whitespace strength** (used only for ranking a list):
```
S(h) = N^0.30 · R^0.25 · (1 − C)^0.20 · Q^0.25
```
Multiplicative, so any collapsed pillar collapses the whole score. A low-density area with no rarity signal and weak evidence scores near zero regardless of how empty it is — **low density alone can never produce a high rank.** That property is the mathematical expression of the entire product thesis, and it should be regression-tested.

## 10.4 The score vector

Six dimensions are always displayed together and never collapsed into a single headline number in the UI:

1. Patent density (how much art exists)
2. Combination rarity (how unusual the proposed combination is)
3. Semantic novelty (how far from the nearest existing family)
4. Evidence quality (how well-evidenced, including how hard we tried to refute)
5. Confidence (how much the system believes it, post-validation)
6. Crowdedness of the surrounding area (competitive context)

Plus, displayed separately and never averaged in: **type** (which of the ten) and **status** (draft/validating/validated/refuted/inconclusive). Type and status are categorical facts, not scores, and mixing them into a number would destroy the information they carry.

**What each score does not prove** — this text ships in the UI, not just this document:
- Density says nothing about whether the missing work is valuable.
- Rarity says nothing about whether the combination is technically sensible.
- Semantic novelty measures distance in an embedding of titles and abstracts — not in claim scope, and not in inventive concept.
- Evidence quality measures our search effort, not the truth of the hypothesis.
- Confidence is confidence *in our own analysis*, not a probability of being granted a patent.

## 10.5 The gate ladder

Every hypothesis passes through gates in strict order. Each gate writes evidence rows and may re-type the hypothesis, which terminates its progress.

**G1 — Data coverage.** Is the area readable? Inputs: text-coverage census for the area, date distribution, jurisdiction spread. Fail condition: claims coverage below 40%, or the area's activity is concentrated at the corpus's 2000 boundary (suggesting truncated history). → `DATA_WHITESPACE`, blocked from ever reaching GENUINE.

**G2 — Terminology.** Does the gap survive vocabulary expansion? Runs the semantic lane with LLM-generated alternative phrasings, plus CPC-neighbour expansion. Fail condition: expanded search returns dense material that the original scope missed. → `TERMINOLOGY_WHITESPACE`, refuted as an opportunity but surfaced as a valuable vocabulary insight (and it should trigger a suggestion to update the study scope).

**G3 — Adjacent claims.** Is it already covered by broader claims elsewhere? Broadens to the CPC superclass, retrieves the closest families by semantic similarity to the hypothesis, and runs element mapping against the hypothesis's element combination. Fail condition: any family returns Present for the full combination. Partial matches lower confidence proportionally rather than refuting. → `CLAIM_WHITESPACE` if partially covered, refuted if fully.

**G4 — Scientific feasibility.** Was this tried and abandoned? Inputs: publication volume trend, publication-to-filing ratio trajectory, failure language in abstracts, and discontinued-product evidence where available. Fail condition: literature rose then declined by more than 40% from peak with no recent recovery, or explicit failure findings dominate. → `TECHNICAL_FEASIBILITY_WHITESPACE`. **This is the gate that catches the most dangerous false positives** and is worth the most engineering care.

**G5 — Commercial** and **G6 — Regulatory.** Advisory only in MVP: an LLM flags likely concerns, explicitly marked as low-evidence and requiring user attestation. We do not have market or regulatory data and must not imply that we do. Evidence-backed in Phase 2.

Order G1→G4 is strict. G5/G6 annotate but do not block. **Only a hypothesis that passes G1–G4 with confidence ≥ 0.75 may be labelled GENUINE.**

## 10.6 The adversarial loop

All four attack strategies run against the local corpus — the loop is unaffected by the local-only constraint (9.0), because every one of them is a retrieval-shape variation rather than a different data source.

```
compile(hypothesis)
  → generate M disproof queries across four strategies:
       1. synonym-shifted lexical      (attacks terminology assumptions)
       2. semantic paraphrase          (attacks phrasing assumptions)
       3. CPC-adjacent broadening      (attacks classification assumptions)
       4. assignee / inventor pivot    (follows the people nearest the idea)
  → shallow orchestrator run per query + Voyage rerank   [local corpus lane only]
  → element-map the top hits against the hypothesis combination
  → record every query, hit count and mapping as a SEARCH_TRACE evidence row
  → literature disproof: has anyone published this combination?   [NPL providers]
  → premium red-team pass: read the survivors, name the strongest remaining attack
  → execute that attack
  → stop on saturation (new-relevant-document rate < ε, following the
    computeSaturation precedent in prior-art-studio/service.ts)
  → update confidence; set status
  → append the un-runnable attacks to coverageLimitations, named explicitly:
       "pre-2000 art not searched — outside corpus"
       "commercial/product evidence not searched — no source"
```

Three design commitments make this honest rather than theatrical:

1. **The attack queries are generated to succeed, not to fail.** The prompt instructs the model to find art that *destroys* the hypothesis, and the red-team pass is explicitly rewarded for refutation. A validation loop prompted neutrally will confirm; one prompted adversarially will occasionally kill good ideas, which is the correct error direction.
2. **Everything is logged and shown.** The user sees each attack and its outcome. A hypothesis that survived four attacks and a hypothesis that survived twelve are visibly different objects.
3. **The attacks we *cannot* run are logged too.** This is new, and it matters more under the local-only constraint than it would have before. `disproofCompleteness` in the evidence-quality formula (10.3) is computed against the attacks that *should* have run, not the ones that could — so a hypothesis in a field whose history predates 2000 scores a lower evidence quality automatically, and the reason is named on the hypothesis card. **Absence of a disproof search is recorded as weakness, never as survival.**

## 10.7 Guarding against the classic errors

| Error | Guard |
|---|---|
| Low density read as opportunity | Multiplicative scoring; type system; gate ladder; monochrome density ramp |
| Rare combination that is rare because pointless | Support floor on both elements before rarity counts |
| Terminology blindness | G2 plus the standing lexical-vs-semantic divergence probe |
| Missing history | Corpus boundary disclosed everywhere; date-unrestricted disproof searches |
| Broad claims hiding coverage | G3 element mapping against superclass-broadened retrieval |
| Trade-secret protection | Cannot detect. **Appropriability prior** applied per area (see below) and disclosed on every hypothesis. |
| Propensity-to-patent bias | Density compared against a non-patent activity signal (publications) before any gap claim; filing decline never read as innovation decline |
| Classification hierarchy artefacts | Depth-normalised density; same-level sibling comparison only |
| Publication-lag distortion | 18-month exclusion in computation, marked boundary in display |
| Science/patent timing mismatch | Per-field lag estimation before any ratio is computed |
| Abandoned technology | G4, plus the research–patent quadrant's "dormant" labelling |
| Classification drift | Semantic lane runs independently of CPC; divergence between the two is itself surfaced |
| Family inflation | All counts family-level, never publication-level |
| Assignee fragmentation | Canonicalisation, with merges shown and correctable |
| Overconfident synthesis | Confidence capped until gates pass; single Present hit forces refutation |
| Hallucinated evidence | No hypothesis can cite a family that was not returned by a real retrieval; passages are quoted verbatim from stored text, never generated |

## 10.7a The appropriability prior — the guard we would otherwise have missed

There is an inversion at the heart of whitespace analysis that deserves its own treatment, because getting it wrong is systematic rather than occasional.

Firms choose between patenting and secrecy, and that choice is **not random across technology types**. Process technology, formulations, manufacturing know-how, and anything difficult to reverse-engineer from a shipped product are exactly the categories where firms rationally prefer trade secrecy. Survey evidence consistently finds trade secrets more important than patents for a large share of firms, and the boundary is endogenous — it shifts with labour mobility and enforcement conditions.

The consequence for us is uncomfortable and important:

> **A low-patent-density area is, other things equal, *more* likely to be commercially occupied than a high-density one — because the areas firms keep secret are precisely the areas that look empty.**

This is the inverse of the naive reading, and no amount of patent data can detect it, because the evidence is deliberately absent by construction.

**Our guard** is an **appropriability prior** attached to each technology area, derived deterministically from its classification profile and its problem–solution character:

| Area character | Prior | Effect on hypotheses |
|---|---|---|
| Process, formulation, manufacturing method, catalyst, coating | **Secrecy-favouring** | Confidence capped lower; explicit warning that absence may indicate secrecy; user prompted for market knowledge |
| Device architecture, mechanism, user-facing system | Patent-favouring | No adjustment |
| Software / algorithmic | Mixed and jurisdiction-dependent | Warning that subject-matter eligibility varies and may suppress filing |

The prior does not change the arithmetic; it changes the interpretation shown to the user and it caps confidence in secrecy-favouring areas. Combined with the requirement that every gap be cross-checked against a non-patent activity signal, it converts an invisible systematic error into a visible caveat.

## 10.7b Reporting standard: RIPL compliance

Our report builder (6.22) should conform to the **Reporting Items for Patent Landscapes (RIPL)** statement (Smith, Arshad, Trippe, Collins and Brindley, *Nature Biotechnology* 36:1043–7, 2018), a 21-item checklist developed in response to documented quality failures in published patent landscapes — including landscapes searching only by keyword, misusing classification, or omitting their search terms entirely.

This is a cheap and unusually strong credibility move: **no commercial whitespace product we found claims conformance to a published reporting standard.** The load-bearing items map directly onto data we already hold:

| RIPL item | Our source |
|---|---|
| 5 — databases, offices, dates, fields, and full search terms | Scope object + search traces (already persisted) |
| 6/7 — selection and relevance-sorting criteria | Scope exclusions + retrieval configuration |
| 8 — every extracted field defined, software named | Element extraction schema |
| **10 — family designation source and definition** | DOCDB simple family, declared |
| 11 — counts assessed, included, excluded with reasons | Gate counts funnel (already computed) |
| 12 — every standardisation step and its assumptions | Assignee canonicalisation log |
| 14 — analysis settings, including map settings and year convention | Run parameters snapshot |
| 15 — list of all publication numbers included | Cluster member export |
| **17 — limitations and how error was reduced** | `coverageLimitations` (already non-optional) |

Nearly all of it is already in the data model. Making the export RIPL-conformant is mostly a matter of rendering what we already store — and it lets us state, truthfully, that our reports meet a peer-reviewed standard that most consultancy landscape reports do not.

The related reproducibility rule from WIPO is also worth adopting: ship post-processed, value-added data rather than raw dumps, such that a different analyst given the same data could reproduce the result.

## 10.8 What we will not claim

Prohibited outputs, enforced in prompts, UI copy and export templates:

- "This is patentable" / "novel" / "non-obvious" — we produce indicators, not determinations.
- "You are free to operate."
- "No prior art exists."
- Any probability of grant.
- Any single-number patentability or novelty score.
- Any statement that a product does or does not infringe.

Permitted formulations: *"No independent claim in our retrieved set recites this element combination"*; *"Family density in this area is in the lowest decile for this field"*; *"Publication activity here has grown 22% annually while filings declined."*

---

# Section 11 — MVP recommendation

## 11.1 Prioritisation

Each candidate feature scored on the brief's six axes. Value and differentiation are the drivers; data availability and trust risk are the constraints.

| Feature | User value | Differentiation | Data avail. | Complexity | Compute | Trust risk | Verdict |
|---|---|---|---|---|---|---|---|
| Scope builder with assumptions | High | Med | Full | Low | Very low | Low | **MVP** |
| Field census + landscape | High | Low (parity) | Full | Low | Low | Low | **MVP** |
| Text-coverage census | Med | **High** | Full | Low | Low | **Negative** (builds trust) | **MVP** |
| Semantic clustering + naming | High | Med | Full | Med | Low | Med | **MVP** |
| Recursive drill-down | Med | Med | Full | Med | Low | Low | **MVP** |
| Density / velocity / HHI signals | High | Low | Full | Low | Low | Med | **MVP** |
| Terminology divergence probe | High | **High** | Full | Med | Med | Low | **MVP** |
| Deep dive + claim elements | **High** | **High** | Partial (US/EP/IN) | High | High | Med | **MVP** |
| Co-occurrence + open edges | High | **High** | Derived | Med | Low | Med | **MVP** |
| Problem–solution–constraint matrix | High | High | Partial | High | High | Med | **MVP** |
| Hypothesis generation + type system | **High** | **Highest** | Derived | Med | High | **High** | **MVP** |
| Gate ladder | High | **Highest** | Full | High | High | **Negative** | **MVP** |
| Adversarial validation + red team | High | **Highest** | Full | High | High | **Negative** | **MVP** |
| Science vs patent quadrant | **High** | High | Full (keyless) | Med | Med | Low | **MVP** |
| Evidence Room | High | High | Derived | Med | Low | **Negative** | **MVP** |
| Score vector | Med | High | Derived | Low | Low | **Negative** | **MVP** |
| Novelty + drafting handoff | **High** | **Highest** | Full | Med | Low | Low | **MVP** |
| Exports (xlsx/pdf/docx) | High | Low | Derived | Med | Low | Low | **MVP** |
| Competitor comparison | Med | Low | Full | Med | Low | Med | **MVP-lite** |
| Cross-domain explorer | High | High | Full | Med | Med | **High** | **Late MVP** (basic) |
| Citation network | Med | Low | **None** | High | High | Med | Phase 2 |
| Legal status | Med | Low | **None** | High | Med | **High** | Phase 2 |
| Product-to-patent | Med | Med | **None** | Med | Med | **High** | Phase 2 |
| Full-field cluster census | Low | Low | Full | Med | High | Low | Phase 2 |
| Pre-2000 backfill | Med | Low | External | High | High | Low | Phase 2 |
| Monitoring + alerts | High | Med | Full | Med | Med | Low | Phase 3 |
| Collaboration | Med | Low | Full | Med | Low | Low | Phase 3 |
| Portfolio overlay | Med | Med | Full | Med | Low | Low | Phase 3 |
| API access | Med | Low | Full | Med | Low | Med | Phase 3 |

## 11.2 MVP scope

Everything marked MVP above. In narrative form: **the complete seven-stage pipeline over patents plus keyless scientific literature, with the whitespace type system, the gate ladder and the adversarial loop fully intact, terminating in handoffs to novelty search and drafting.**

Screens in MVP: 6.1–6.10, 6.12, 6.14 (lite), 6.15–6.18, 6.20–6.22. Stubs with honest Phase 2 messaging: 6.11 (citations), 6.13 (products). Deferred: 6.19 (cross-domain, unless the basic semantic version lands late), 6.23 (monitoring), 6.24 (collaboration).

**Explicitly excluded from MVP, with reasons:**
- **Citation analysis** — no citation data locally, and the local-only constraint (9.0) rules out API enrichment. Requires bulk ingestion (9.3a item 2) before it can ship at all.
- **Legal status** — kind codes and dates support a labelled *proxy* and nothing more, and with no API route the proxy is **permanent until a bulk legal-event load runs**. Presenting a proxy as status is the kind of error that loses a professional user permanently.
- **Product/market evidence** — no corpus and no API route; assisted manual entry is the only path.
- **Pre-2000** — outside the corpus, and **now without the external-search mitigation**. Disclosed everywhere, named as an untestable attack on every hypothesis, and folded into evidence quality so affected hypotheses score lower automatically.

**One scoping change the constraint forces.** The plan previously treated the pre-2000 gap as manageable through validation-time external search. It is not manageable that way any more. Two options, and I recommend the second:

1. Ship MVP with the gap disclosed and let users perform that check externally. Workable, honest, and it makes every hypothesis in a mature field carry a visible asterisk.
2. **Add the pre-2000 corpus load to the MVP data work** (9.3a item 1). It uses the import pipeline that already exists, it is bounded work, and it converts the product's largest caveat into a non-issue. For mechanical, materials and chemical fields it is close to the difference between a tool an attorney trusts and one they discount.

The second is the better investment. It is data-engineering effort rather than product effort, so it can run in parallel with Milestones 1–4 without consuming feature capacity.

## 11.3 The one thing that must not be cut

If the schedule compresses, the temptation will be to ship the Observatory (landscape, clusters, signals) and defer the Lab (hypotheses, gates, validation). **This must be resisted.** An Observatory-only release is a weaker version of five products that already exist, it teaches the market to categorise us as a chart tool, and it puts nothing in front of users that they would pay a premium for.

If something must go, cut breadth instead: fewer landscape panels, one decomposition template instead of eight, list views instead of the cluster map, no cross-domain. Keep the pipeline end-to-end. **A narrow product that forms and kills hypotheses is a business; a broad product that draws charts is a feature.**

## 11.4 Build sequence

**Milestone 1 — Skeleton and census (3 weeks).** Prisma models, enums, feature gating, plan quotas. Module scaffolding following the Prior-Art Studio four-tree pattern. Scope compile. Field map SQL facets. Studies list and study workspace shell. *Exit: a user can define a field and see a real census.*

**Milestone 2 — Structure (3 weeks).** Stratified sampling, binary k-means worker, cluster naming, cohesion metrics, recursion. Cluster explorer with map and list. Signals including the terminology probe. Landscape screen. *Exit: a user can navigate their field by named technology area.*

**Milestone 3 — Depth (3 weeks).** Deep-dive claims assembly from the three local sources (US `claimsText`, `epo_ep_fulltext`, IPIndia). Claim-element extraction, co-occurrence, residual rarity, open edges. Claim-element map. PSC matrix. **Extraction-agreement evaluation harness** (14.1). *Exit: a user can see what claims in an area actually recite, and we know how reproducible that extraction is.*

**Parallel data-engineering track (not on the feature critical path).** Pre-2000 corpus load via the existing import pipeline (9.3a item 1). Runs alongside Milestones 1–4; if it lands before launch, the product's largest caveat disappears.

**Milestone 4 — Judgment (4 weeks — the differentiating milestone).** Hypothesis generation. The full gate ladder. Adversarial loop and red team. Evidence Room. Score vector. Opportunity list and detail. Challenge screen. *Exit: the product does the thing it exists to do.*

**Milestone 5 — Literature and output (2 weeks).** Literature gateway with cache, rate limiting, retries and metering. Cluster-scale probe. Science-vs-patent quadrant. Concept workspace. Handoffs. Exports. *Exit: shippable.*

**Milestone 6 — Hardening (2 weeks).** Coverage disclosures everywhere. Empty, loading, error and low-confidence states. Mobile fallbacks. Prompt-injection hardening on retrieved text. Cost instrumentation. Regression tests on the scoring properties. Internal dogfooding against three real fields with a patent attorney reviewing the output.

**Total: ~17 weeks.** Milestone 4 is the one to protect.

## 11.5 Success metrics

Vanity metrics to avoid: studies created, charts viewed, time in product.

Metrics that matter:

| Metric | Definition | MVP target |
|---|---|---|
| Hypothesis conversion | Surviving hypotheses → novelty search | > 25% |
| Pipeline completion | Studies reaching validated hypotheses | > 40% |
| Refutation rate | Hypotheses killed by gates | **30–70%** |
| Filing conversion | Concepts → drafting session | > 10% |
| Scope edit rate | Studies where the user edited scope | > 50% |
| Expert agreement | Attorney review agreeing with type assignment | > 80% |

Two of those deserve comment. **Refutation rate is a two-sided target** — below 30% the gates are not working and we are shipping optimism; above 70% either our scope compilation is poor or the generator is producing noise. It is the single best health metric for the methodology.

**Scope edit rate above 50%** would confirm that the scope screen is doing its job. If users never edit, they are not engaging with the premise, and the trust benefit is lost.

## 11.6 Phase 2 and Enterprise

**Phase 2 (~3 months).** Gated on the bulk ingestions in 9.3a rather than on API integrations: citation load → influence metrics, citation deserts, examiner-citation patterns, and link-prediction as a falsifiable gap signal. Legal-event load → real status and the lapse-driven opportunity layer. Cluster-scale literature deepening. Product-to-patent with assisted entry. Full cross-domain explorer with function abstraction. Workflow C (competitor-first entry). Full-field cluster census. `AssigneeAlias` table with LLM-assisted merging. Evidence-backed G5/G6.

Note the sequencing change the local-only constraint imposes: **Phase 2 features are now gated on data-engineering work, not on product work.** That is a scheduling advantage — the ingestions can start now, in parallel, and each one unlocks its features on completion rather than requiring a coordinated release.

**Phase 3, Enterprise (~3 months).** Scheduled re-runs and delta monitoring with hypothesis-aware alerting. Multi-user studies, comment threads, expert review workflow. Portfolio overlay against the tenant's own families. API access. Custom corpus ingestion for clients with internal disclosure databases.

## 11.7 Commercial model

**Packaging recommendation, in priority order:**

1. **Subscription tier with metered depth (primary).** Whitespace Studio included in Pro and Enterprise plans, with monthly allowances of *deep dives* and *validations* — the two units that actually cost money. Observatory analysis (census, clustering, signals) is unmetered, because it is nearly free to serve and it is what builds the habit. This maps cleanly onto the existing plan and quota infrastructure and onto the Observatory/Lab split in the UI.

2. **Standalone whitespace study (land-and-expand).** A one-off, fixed-price study for non-subscribers, delivered as a report plus 30 days of workspace access. The natural entry for consultants and for enterprise procurement that cannot start with a subscription.

3. **Attorney-assisted premium report.** Our analysis plus a qualified attorney's review and sign-off, at a substantial multiple. This is the highest-margin offer and it directly addresses the trust problem — it also gives us a structured channel for expert feedback on output quality.

4. **University/TTO package.** Discounted seats plus the science-vs-patent view emphasised, sold on the translation-opportunity use case. TTOs are underserved, budget-constrained, and generate referenceable case studies.

5. **Enterprise innovation workspace.** Multi-seat, monitoring, portfolio overlay, custom corpus.

6. **API / MCP access.** Extends the existing Patent Public API. Later; a small revenue line but strategically useful for embedding in customers' workflows.

**Most defensible initial segment: mid-size corporate R&D organisations that already have an IP function but no dedicated analytics team** — roughly 200–2,000 employees, filing 20–100 patents a year. They have the budget and the recurring need (annual filing planning), they feel the pain acutely (their current answer is a consultant or a guess), they are too small for a Derwent or PatSnap enterprise contract, and they can decide quickly. Critically, they also have in-house technical experts who can evaluate our hypotheses — which means we get the expert feedback loop that makes the product better.

The second segment, and the cheaper one to reach because they are already in our product, is **existing PatentNest novelty-search users whose search came back crowded.** That is a pre-qualified user with a live need at the exact moment we can help. Workflow B exists for them, and the "explore the space around this idea" button on a negative novelty result is likely the highest-converting surface in the entire plan.

---

# Section 12 — Wireframes

Structured layout descriptions for the highest-value screens. Desktop at 1440px unless noted; the header/rail/canvas/panel/drawer skeleton is constant.

## 12.1 Study workspace shell (constant chrome)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◀ Whitespace   Non-invasive glucose monitoring        [Observatory│Lab]  ⟳ Ready │  56px
│   Scope: 12,400 families · 2000–2026 · 4 CPC groups · edited 2h ago      [Export]│
├────┬─────────────────────────────────────────────────────────────┬───────────────┤
│    │                                                             │               │
│ ▣  │                                                             │  CONTEXT      │
│ Ov │                                                             │  PANEL        │
│    │                    MAIN CANVAS                              │               │
│ ◫  │                                                             │  selection    │
│ La │                                                             │  detail,      │
│    │                                                             │  metrics,     │
│ ⛁  │                                                             │  actions      │
│ Tx │                                                             │               │
│    │                                                             │  380px        │
│ ⬢  │                                                             │  collapsible  │
│ Cl │                                                             │               │
│    │                                                             │               │
│ ▦  ├─────────────────────────────────────────────────────────────┤               │
│ Mx │ 2000–present · claims readable 62% · no citation data    [i] │               │  28px
├────┴─────────────────────────────────────────────────────────────┴───────────────┤
│ ▲ EVIDENCE  supporting 14 · contradicting 3 · traces 22                          │  40px
└──────────────────────────────────────────────────────────────────────────────────┘
 64px                                                                                
```

The coverage strip sits immediately below the canvas — inside the analytical frame, not in a footer, so it reads as part of the data rather than as legal boilerplate. The evidence drawer is a persistent collapsed bar showing counts; clicking expands it to 50vh.

## 12.2 Scope review

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Review your research scope                            [Run field map →]          │
│ Correct anything that looks wrong. This determines everything that follows.      │
├────────────────────────────────────────────────┬─────────────────────────────────┤
│ ① CORE CONCEPTS                            [+] │  ESTIMATE                       │
│ ┌────────────────────────────────────────────┐ │  ┌───────────────────────────┐  │
│ │ non-invasive glucose sensing        ▾  ✕   │ │  │  12,400 families          │  │
│ │   also: analyte concentration determ.,     │ │  │  ▁▂▃▅▇█▇▅▃  2000→2026     │  │
│ │         transdermal measurement,           │ │  │                           │  │
│ │         interstitial fluid sampling   [+]  │ │  │  US 41% · CN 28% · EP 12% │  │
│ └────────────────────────────────────────────┘ │  │                           │  │
│ ┌────────────────────────────────────────────┐ │  │  Top CPC                  │  │
│ │ continuous monitoring               ▾  ✕   │ │  │  A61B5/145   4,200        │  │
│ └────────────────────────────────────────────┘ │  │  A61B5/1455  2,900        │  │
│ ┌────────────────────────────────────────────┐ │  │  G01N21/3577 1,100        │  │
│ │ wearable biosensor                  ▾  ✕   │ │  └───────────────────────────┘  │
│ └────────────────────────────────────────────┘ │                                 │
│                                                │  [Show me what this excludes]   │
│ ② CLASSIFICATION                           [+] │                                 │
│ ▣ A61B5/145  Measuring blood glucose    4,200 │  ← updates live as you edit     │
│ ▣ A61B5/1455 Optical/spectroscopic      2,900 │                                 │
│ ▣ G01N21/3577 IR spectroscopy           1,100 │                                 │
│ ▢ A61B5/1486 Electrochemical      ⚠ broad     │                                 │
│    may pull in implantable sensors             │                                 │
│                                                │                                 │
│ ③ BOUNDARIES                                   │                                 │
│ Dates 2000 ─────────────── 2026                │                                 │
│ Jurisdictions  [all ▾]   Exclude  [implantable ✕] [fingerstick ✕] [+]           │
│                                                │                                 │
│ ┏━ ④ ASSUMPTIONS I MADE ━━━━━━━━━━━━━━━━━━━━━┓ │                                 │
│ ┃ • "non-invasive" excludes implantable    ✎ ┃ │                                 │
│ ┃ • "wearable" includes adhesive patches   ✎ ┃ │                                 │
│ ┃ • corpus covers 2000–present only          ┃ │                                 │
│ ┃ • claims readable mainly for US/EP/IN      ┃ │                                 │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │                                 │
└────────────────────────────────────────────────┴─────────────────────────────────┘
```

The assumptions panel is visually distinct (warm border, `BRASS` rule) because it is the most-skipped and most-consequential element. "Show me what this excludes" sits next to the estimate deliberately — it is the antidote to invisible filtering.

## 12.3 Executive opportunity overview

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ This field is mature and consolidating. Filing peaked in 2018 and has declined   │
│ 18% since, while publication activity rose 22% — a divergence that usually       │
│ signals either a technical barrier or an untranslated research front. Two        │
│ companies hold 34% of families. Three of 24 technology areas show research       │
│ outpacing patenting.                                                             │
├──────────────────┬──────────────────┬──────────────────┬─────────────────────────┤
│ CONCENTRATION    │ DIVERGENCE       │ VOCABULARY       │ READABILITY             │
│ 34%              │ +22% / −18%      │ 31%              │ 62%                     │
│ held by top 2    │ papers vs filings│ art missed by    │ of families have        │
│ ▇▇▇▇�afterwards░░ │ ↗ ↘              │ your terms       │ readable claims         │
│ [see portfolios] │ [see quadrant]   │ [see vocabulary] │ [coverage detail]       │
├──────────────────┴──────────────────┴──────────────────┴─────────────────────────┤
│ OPPORTUNITY FUNNEL                                                               │
│ ┌──────────────┬─────────────┬────────────┬──────────────┐                       │
│ │ generated 9  │ gated 9     │ survived 3 │ validated 2  │  ← every segment      │
│ │ ████████████ │ ██████████  │ ████       │ ███          │     is clickable      │
│ └──────────────┴─────────────┴────────────┴──────────────┘                       │
│ Rejected: 4 feasibility · 1 terminology · 1 claim-covered   [browse rejected →]  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ SURVIVING OPPORTUNITIES                                                          │
│ ◆ GENUINE   Photoacoustic sensing + on-device drift compensation      S 0.68  →  │
│ ◆ GENUINE   RF permittivity sensing with multi-frequency calibration  S 0.54  →  │
│ ◇ CLAIM GAP Sweat-analyte correlation under exercise conditions       S 0.41  →  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Note the funnel shows rejections as a headline, not a footnote, and the rejected browse link is at the same visual level as the survivors.

## 12.4 Cluster explorer

```
┌────────────────────────────────────────────────┬─────────────────────────────────┐
│  [◉ map] [☰ list]     colour: crowdedness ▾    │  Photoacoustic glucose sensing  │
│                                                │  ─────────────────────────────  │
│         ○ sweat                                │  340 families · est. 380        │
│      ◍ ML calib.        ●●● electrochemical    │  cohesion ▮▮▮▯ good             │
│         ⌇                    (crowded)         │                                 │
│                                                │  Measures glucose by detecting  │
│    ◌ RF/dielectric    ● NIR spectroscopy       │  acoustic waves generated when  │
│      (diffuse)                                 │  tissue absorbs pulsed light.   │
│                                                │  Distinct from NIR spectroscopy │
│         ◉ photoacoustic  ← selected            │  (neighbouring) by detection    │
│                                                │  modality, not light source.    │
│    ○ patch mechanics                           │                                 │
│                                                │  Trend  ▁▂▃▄▅▅▆  +11%/yr        │
│  ─────────────────────────────────────────     │  Top    Samsung 41 · Apple 22   │
│  ○ sparse   ◍ moderate   ● crowded   ⌇ diffuse │  CPC    A61B5/1455, G01N21/17   │
│                                                │                                 │
│                                                │  REPRESENTATIVE                 │
│                                                │  US 11,234,567 B2  Photoacoust… │
│                                                │  EP 3,456,789 B1   Method for…  │
│                                                │  US 10,987,654 B2  Wearable…    │
│                                                │                                 │
│                                                │  [Drill down] [Deep dive $0.14] │
├────────────────────────────────────────────────┴─────────────────────────────────┤
│ 2000–present · 12,400 families · claims readable 62% · sample-based estimates [i] │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Map is a selector at 60%; the dossier at 40% is the payload. Diffuse clusters carry the `⌇` mark and are excluded from hypothesis generation.

## 12.5 Claim-element map

```
┌────────────────────────────────────────────────┬─────────────────────────────────┐
│  [◉ constellation] [▦ matrix]   independent ▾  │  OPEN EDGE                      │
│                                                │  ─────────────────────────────  │
│      ● light source (890)                      │  photoacoustic transducer       │
│         ╱  ╲                                   │       ╌╌╌ not claimed together  │
│        ╱    ╲                                  │  personalised drift model       │
│  ● wavelength   ● acoustic transducer (340)    │                                 │
│    selection         ┆                         │  support   340  /  1,900        │
│     (610)            ┆ ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  │  lift      0.08                 │
│        ╲             ┆                    ╲    │  co-occur  2 families           │
│         ╲            ┆                     ╲   │                                 │
│      ● skin coupling ┆              ● personalised│  Both elements are well     │
│         medium       ┆                drift model │  established individually.  │
│                      ┆                  (1,900)   │  Only 2 families recite     │
│      ● temperature ──┘                            │  both, neither in an        │
│        compensation                               │  independent claim.         │
│                                                   │                             │
│  ━━ conventional pairing   ╌╌ open edge           │  CLAIM LANGUAGE             │
│                                                   │  "an acoustic transducer    │
│                                                   │   configured to receive…"   │
│                                                   │   — US 11,234,567 B2 cl.1   │
│                                                   │                             │
│                                                   │  [Generate hypothesis]      │
├────────────────────────────────────────────────┴─────────────────────────────────┤
│ ⚠ Claims retrievable for 71% of this area — element analysis is indicative   [i] │
└──────────────────────────────────────────────────────────────────────────────────┘
```

The dashed open edge is the only dashed element in the design system. Verbatim claim language in Cormorant, always attributed.

## 12.6 Opportunity detail

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◆ GENUINE   VALIDATED           Photoacoustic sensing with on-device            │
│                                 personalised drift compensation                  │
│ density ▮░░░░ rarity ▮▮▮▮▮ novelty ▮▮▮▮░ evidence ▮▮▮▮░ confidence ▮▮▮▮░ 0.78    │
│                                    [Challenge]  [Develop concept]  [Novelty →]   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ THE OPPORTUNITY                                                                  │
│ Calibration drift is the acknowledged failure mode of photoacoustic glucose      │
│ sensing. Descriptions repeatedly identify it; independent claims never address   │
│ it. Personalised on-device compensation models are mature in adjacent sensing    │
│ but have not been claimed in combination with photoacoustic detection.           │
│                                                                                  │
│ WHAT EXISTS TODAY                                    3 closest families →        │
│ CLAIM POSITIONING                                    likely contested: 2 elements│
│                                                                                  │
│ ┌─ EVIDENCE FOR ──────────────────┐ ┌─ EVIDENCE AGAINST ───────────────────────┐│
│ │▌14 patent passages              │ │▌US 11,555,222 claims photoacoustic +     ││
│ │▌ 9 publications, growing 18%/yr │ │▌ "calibration module" (generic) — mapped ││
│ │▌ drift named as open problem in │ │▌ PARTIAL, not Present                    ││
│ │▌ 6 of 9 recent papers           │ │▌2024 paper proposes an optical solution  ││
│ │                                 │ │▌ to drift, which would reduce the need   ││
│ │ [open evidence room]            │ │▌ for a learned model                     ││
│ └─────────────────────────────────┘ └──────────────────────────────────────────┘│
│                                                                                  │
│ WHAT WE TRIED IN ORDER TO KILL THIS                                              │
│ ✓ G1 data coverage      71% claims readable                          passed      │
│ ✓ G2 terminology        +1,240 families found, combination absent    passed      │
│ ✓ G3 adjacent claims    superclass broadened; closest = PARTIAL      passed      │
│ ✓ G4 feasibility        literature growing, drift named as open      passed      │
│ ⚠ G5 commercial         advisory only — no market data               unassessed  │
│ 6 disproof searches run · 0 refuting · 2 weakening        [view attack log]      │
│                                                                                  │
│ COVERAGE LIMITATIONS                                                             │
│ No art before 2000 · claims unreadable for 29% of area · no citation data ·      │
│ trade-secret protection undetectable · no market or regulatory evidence          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Evidence for and against are the same component at the same width. The gate ladder is shown as a checklist — it is the proof of work.

## 12.7 Red team

```
┌────────────────────────────────────┬─────────────────────────────────────────────┐
│ HYPOTHESIS                         │ ATTACK CONSOLE                              │
│ Photoacoustic + drift compensation │ ┌─────────────────────────────────────────┐ │
│ confidence ▮▮▮▮░ 0.78              │ │ Find stronger prior art          $0.04  │ │
│ survived 6 attacks                 │ │ Search alternative terminology   $0.02  │ │
│                                    │ │ Expand classifications           $0.02  │ │
│ [Find the strongest contradiction] │ │ Search other jurisdictions       $0.03  │ │
│  ← let the system pick the attack  │ │ Search literature                free   │ │
│    most likely to succeed          │ │ Test obvious combinations        $0.05  │ │
│                                    │ │ Find abandoned approaches        $0.05  │ │
│                                    │ │ ┌─────────────────────────────────────┐ │ │
│                                    │ │ │ I think Samsung already does this   │ │ │
│                                    │ │ │ in their 2023 watch sensor…         │ │ │
│                                    │ │ └─────────────────────────────────────┘ │ │
│                                    │ ├─ CANNOT BE TESTED HERE ─────────────────┤ │
│                                    │ │ ⃠ Pre-2000 art — outside corpus         │ │
│                                    │ │ ⃠ Product / commercial evidence         │ │
│                                    │ │ ⃠ Legal status — kind-code proxy only   │ │
│                                    │ │   These lower evidence quality and are  │ │
│                                    │ │   named in every export.                │ │
│                                    │ └─────────────────────────────────────────┘ │
├────────────────────────────────────┴─────────────────────────────────────────────┤
│ CHALLENGE LOG                                                                    │
│ ✓ SURVIVED  synonym-shifted lexical   "optoacoustic AND calibration"    41 hits  │
│             → 0 recite the full combination                                      │
│ ⚠ WEAKENED  CPC-adjacent broadening   G01N29/* + A61B5/1455            118 hits  │
│             → US 11,555,222 maps PARTIAL on 2 of 3 elements    conf −0.06        │
│ ✓ SURVIVED  assignee pivot            Samsung + Apple portfolios        87 hits  │
│             → ML calibration present, but bound to electrochemical               │
│ ⋯ RUNNING   pre-2000 external search                                             │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 12.8 Science vs patent quadrant

```
┌──────────────────────────────────────────────────┬───────────────────────────────┐
│  publication                                     │ TRANSLATION OPPORTUNITY       │
│  velocity                                        │ ───────────────────────────── │
│    high │                    │                   │ 3 areas where research is     │
│         │  TRANSLATION       │   ACTIVE RACE     │ outpacing patenting.          │
│         │  OPPORTUNITY       │                   │                               │
│         │        ◉ photoac.  │  ● ML calibration │ Photoacoustic sensing         │
│         │     ◉ sweat        │  ● electrochem.   │   papers +18%/yr              │
│         │  ◉ RF/dielectric   │                   │   filings +11%/yr             │
│         │                    │                   │   ratio 1.64                  │
│    ─────┼────────────────────┼───────────────    │                               │
│         │                    │                   │ Sweat analyte                 │
│         │  DORMANT OR        │   PATENT-LED      │   papers +31%/yr              │
│         │  ABANDONED         │   possibly        │   filings +4%/yr              │
│         │                    │   defensive       │   ratio 7.75  ⚠ verify        │
│         │  ○ Raman/NIR       │  ● patch mechanics│                               │
│     low │  ○ fluorescence    │                   │ [promote to shortlist]        │
│         └────────────────────┴───────────────    │                               │
│           low            filing velocity   high  │                               │
├──────────────────────────────────────────────────┴───────────────────────────────┤
│ Literature: OpenAlex ✓ Crossref ✓ PubMed ✓ Semantic Scholar ✓ arXiv ✓        [i] │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Provider health is shown explicitly — a silent provider failure would make a live area look dormant, which is exactly the error the quadrant exists to prevent.

## 12.9 Mobile — opportunity detail

```
┌─────────────────────────┐
│ ◀  Opportunity 1 of 3   │
├─────────────────────────┤
│ ◆ GENUINE · VALIDATED   │
│ Photoacoustic sensing   │
│ with on-device drift    │
│ compensation            │
│                         │
│ ▮▮▮▮░ confidence 0.78   │
│ [tap for full scores]   │
├─────────────────────────┤
│ THE OPPORTUNITY         │
│ Calibration drift is    │
│ the acknowledged…       │
│                    more │
├─────────────────────────┤
│ ▸ Evidence for      14  │
│ ▸ Evidence against   3  │
│ ▸ What we tried      6  │
│ ▸ Limitations        5  │
├─────────────────────────┤
│ 2000–present · 71% claims│
├─────────────────────────┤
│ [Develop]  [Novelty →]  │
└─────────────────────────┘
```

Reading a hypothesis on a phone is a real use case and is fully supported. Exploring a cluster map is not, and degrades to a ranked list.

---

# Section 13 — Sample use case: non-invasive continuous glucose monitoring

**Why this field.** It is multidisciplinary (optics, acoustics, electrochemistry, materials, machine learning, regulatory), commercially enormous, and — critically — it contains a famous graveyard. Optical non-invasive glucose sensing has consumed decades of investment and produced almost no products. A density-only tool looking at recent filings would confidently recommend the exact areas where the most money has already been lost. **That makes it the ideal test of whether our methodology actually works.**

> **All figures in this section are illustrative placeholders showing the shape and texture of output.** They are not results of an executed run. Real numbers require the module to be built. Company and programme references (GlucoWatch, Verily) are matters of public record and are used here as the kind of evidence the system would surface.

## 13.1 Initial user input

Priya (corporate IP manager) types:

> *"We make wearable health sensors. I want to know where there's room to invent in non-invasive glucose monitoring — the space isn't dominated by Dexcom and Abbott. Interested in anything that avoids skin penetration."*

No CPC codes. No Boolean. No date range.

## 13.2 Generated scope

The system returns, in about eleven seconds:

**Core concepts** — non-invasive glucose sensing · continuous monitoring · wearable biosensor · calibration and drift correction

**Expanded vocabulary** (the system found terms Priya did not use): analyte concentration determination · interstitial fluid sampling · transdermal measurement · tissue optical scattering coefficient · chromophore absorbance · glycaemic state estimation · photoacoustic spectroscopy · dielectric permittivity sensing

**Candidate classifications** — A61B5/145 (measuring blood glucose, 4,200 families) · A61B5/1455 (optical/spectroscopic, 2,900) · G01N21/3577 (IR spectroscopy, 1,100) · A61B5/1486 (electrochemical, flagged: *"broad — will pull in implantable sensors, which your brief appears to exclude"*)

**Proposed exclusions** — implantable sensors · fingerstick/lancet devices · laboratory analysers

**Assumptions stated** — *"I read 'avoids skin penetration' as excluding microneedles as well as implantables. Microneedle arrays are a large and active area; if you want them included, remove this exclusion."* · *"'Wearable' includes adhesive patch form factors."* · *"Corpus covers 2000–present only."* · *"Claim text is readable mainly for US, EP and IN families."*

**Priya's edits:** she re-includes microneedles as a separate concept marked *optional* (she wants to see the boundary), and removes A61B5/1486. Estimate updates from 12,400 to 12,900 families.

**This exchange is the product working.** The system surfaced an ambiguity in her own brief, and she resolved it before any analysis ran.

## 13.3 Field map

| | |
|---|---|
| Families | 12,900 |
| Filing trend | Rose steeply 2010–2018, peaked 2018, **declining ~18% since** |
| Jurisdictions | US 41% · CN 28% · EP 12% · JP 9% · KR 6% |
| Top assignees | Dexcom (612) · Abbott (548) · Medtronic (401) · Samsung (287) · Apple (166) |
| Concentration | Top 2 hold 9% of families but 34% of the last three years' filings |
| Claims readable | 62% overall — 91% of US families, 78% of EP, 12% of CN |
| Status proxy | 44% granted-kind, 51% application-kind, 5% unclear |

The coverage line matters: **CN is 28% of the field and we can read 12% of its claims.** That limitation is stamped on every subsequent screen and auto-recorded on every hypothesis.

## 13.4 Generated taxonomy and clusters

Template auto-selected as **medical device** from the A61B-dominant CPC profile. Decomposition: sensing modality → signal pathway → calibration approach → form factor → target population.

Twenty-four clusters. The eight that matter:

| Cluster | Families | Density | 5-yr velocity | HHI | Cohesion |
|---|---|---|---|---|---|
| Enzymatic electrochemical microneedle arrays | 3,180 | 0.91 | +2% | 0.34 | good |
| NIR / Raman spectroscopic skin measurement | 1,940 | 0.74 | **−12%** | 0.08 | good |
| ML calibration & drift compensation | 1,900 | 0.71 | **+23%** | 0.06 | good |
| Adhesive patch mechanics & adhesion | 1,420 | 0.63 | +5% | 0.11 | moderate |
| Sweat-based analyte sensing | 890 | 0.48 | **+31%** | 0.07 | good |
| RF / dielectric permittivity sensing | 460 | 0.18 | +6% | 0.09 | **diffuse** |
| Photoacoustic glucose sensing | 340 | 0.12 | +11% | 0.13 | good |
| Fluorescence / hydrogel implant-free assays | 210 | 0.09 | −4% | 0.22 | moderate |

**Terminology probe:** lexical-vs-semantic Jaccard overlap of 0.31 across the scope's concepts. The semantic lane found 1,240 families the lexical lane missed, concentrated in optics vocabulary — families that never say "glucose" in the title or abstract but describe tissue absorbance measurement. Priya's original terms would have missed roughly a third of the relevant art. **This is reported before any gap is claimed**, because a gap measured with the wrong vocabulary is meaningless.

## 13.5 Apparent gaps

Four areas look sparse on the density map. A density-only tool would surface all four as opportunities:

1. Photoacoustic glucose sensing (0.12)
2. Fluorescence / hydrogel assays (0.09)
3. RF / dielectric permittivity (0.18)
4. NIR / Raman spectroscopy — declining fast (0.74 density but −12% velocity)

Priya deep-dives photoacoustic, RF/dielectric, and ML calibration (the last as a *dense* comparison area, which is how the interesting combination gets found).

## 13.6 Deep dive and the combination signal

Claim elements extracted from 118 families across the three areas. Selected co-occurrence results:

| Element A | Element B | support(A) | support(B) | co-occur | lift | Reading |
|---|---|---|---|---|---|---|
| acoustic transducer | temperature compensation | 340 | 780 | 190 | 2.41 | Conventional pairing |
| light source | wavelength selection | 890 | 610 | 540 | 3.02 | Near-mandatory architecture |
| photoacoustic sensing | **personalised drift model** | 340 | 1,900 | **2** | **0.08** | **Open edge** |
| RF permittivity | multi-frequency calibration | 460 | 320 | 41 | 0.87 | Sparse but present |
| photoacoustic sensing | hydration compensation | 340 | 95 | 0 | 0.00 | Rare — but support(B) below floor |

The last row is instructive. Zero co-occurrence looks like the strongest signal, but `support(hydration compensation) = 95` is below the support floor for this area (5% of 118 deep-dived families scaled to area size). **The system does not report it as a rarity finding.** Without the floor, this would have been the top-ranked "opportunity" — and it is almost certainly rare because hydration compensation is a niche concern, not because nobody thought of combining them.

Also extracted: in 6 of 9 recent photoacoustic families, **calibration drift is named as a limitation in the description while no independent claim addresses it.** That is a "described but not claimed" signal.

## 13.7 The rejected false whitespace

**Hypothesis H1 (generated, then killed):**

> *"NIR/Raman spectroscopic glucose sensing shows declining filing activity (−12% over five years) with moderate density. The area is being vacated by incumbents, leaving room for a differentiated entrant."*

This is a plausible-sounding, well-formed, completely wrong recommendation. It is exactly what a trend-plus-density tool produces. Here is how it dies:

**G1 — Data coverage: PASSED.** 74% claims readable in this area. The gap is not an artefact of missing data.

**G2 — Terminology: PASSED.** Vocabulary expansion added 380 families; density rose slightly but the declining trend held. The gap is not an artefact of vocabulary.

**G3 — Adjacent claims: PASSED.** No broad claim family covers the area in a way that explains the decline.

**G4 — Scientific feasibility: FAILED.**
- Publication volume rose steadily 2008–2019, then **fell 46% from peak** with no recovery.
- Failure language dominates recent abstracts: signal-to-noise limitations, water absorption interference, poor specificity against confounding analytes, and calibration instability across individuals.
- The research-to-patent ratio is collapsing on **both** axes — this cluster sits squarely in the "dormant or abandoned" quadrant.
- Filing trajectory corroborates: activity peaked with the literature and declined alongside it, which is the signature of abandonment rather than of a field moving to secrecy (where filings fall while publications hold).

**Note on evidence sources under the local-only constraint.** This verdict rests entirely on data we hold: the local corpus's filing trajectory and the scientific-literature providers. The earlier draft of this example also cited discontinued commercial programmes — GlucoWatch's market withdrawal and the halted Verily/Novartis contact-lens effort — which the system could previously surface through external search. **It can no longer retrieve that evidence**, and the hypothesis card says so: *"commercial evidence not searched — no source"* appears in the coverage limitations, and `disproofCompleteness` is reduced accordingly.

The gate still fires correctly, because literature collapse plus filing collapse is sufficient. But this is a real and honest reduction in evidentiary depth, and it is exactly the kind of loss that should be visible on the artefact rather than absorbed silently. A user with domain knowledge who *knows* about GlucoWatch can add it as user-supplied evidence (6.17), which strengthens the refutation and is recorded as human input.

**Verdict:** re-typed `TECHNICAL_FEASIBILITY_WHITESPACE`, status **REFUTED**.

**What the user sees:**

> *"This is not whitespace. Filing activity is declining here because the field tried this and largely stopped. Publications fell 46% from their 2019 peak, recent literature reports unresolved signal-to-noise and specificity limitations, and at least two well-funded commercial programmes were discontinued. The absence of patents reflects abandonment, not opportunity. Pursue only if you have a specific technical development that addresses the water-absorption interference problem — and if you do, that development is the invention, not the application."*

That last sentence is the product being genuinely useful rather than merely cautious: it tells Priya what would *make* this an opportunity.

## 13.8 The surviving hypothesis

**Hypothesis H2:**

> *"Photoacoustic glucose sensing combined with on-device personalised drift compensation — a learned model trained on user-specific pressure, temperature and hydration covariates. Calibration drift is repeatedly identified as the limiting factor in photoacoustic descriptions but is not recited in any independent claim we retrieved, while personalised drift compensation is well established in adjacent sensing modalities."*

**Origin:** open edge, lift 0.08, both elements above support floor.

### Supporting evidence
- 14 patent passages where photoacoustic descriptions name calibration drift as a limitation without claiming a solution
- 340 families establishing photoacoustic detection architecture; 1,900 establishing personalised calibration models
- Photoacoustic publication volume growing ~18% per year; 6 of 9 recent papers name drift as the open problem
- Research-to-patent ratio 1.64 — this cluster sits in the "translation opportunity" quadrant
- Two of the three closest photoacoustic families are from assignees with no ML-calibration filings, suggesting the two competencies sit in different organisations

### Contradicting evidence *(shown with equal weight)*
- **US 11,555,222** (illustrative) claims photoacoustic detection plus a "calibration module" — generic language. Element mapping returns **PARTIAL** on 2 of 3 elements, not Present. This is the most serious threat and it lowered confidence by 0.06.
- Two Samsung families claim personalised ML calibration, but bound to electrochemical sensing. A skilled person might consider the transfer obvious — an obviousness-style concern the system flags but explicitly does not adjudicate.
- A 2024 publication proposes an **optical** solution to photoacoustic drift. If that approach works, the learned-model route may be unnecessary.
- Photoacoustic glucose sensing has no approved commercial product, so the underlying modality's viability is itself unproven.

### Gate ladder
| Gate | Result | Basis |
|---|---|---|
| G1 data coverage | **passed** | 71% claims readable in area |
| G2 terminology | **passed** | +1,240 families from expansion; combination still absent |
| G3 adjacent claims | **passed with weakening** | Superclass broadening: closest maps PARTIAL |
| G4 feasibility | **passed positively** | Literature growing; drift named as open problem, not as a dead end |
| G5 commercial | unassessed | No market data — advisory only |
| G6 regulatory | flagged | Class II/III device pathway; user attestation requested |

### Disproof searches run
Five attacks, all against local data: synonym-shifted lexical ("optoacoustic AND calibration", 41 hits, none reciting the full combination); semantic paraphrase (67 hits, nearest at Hamming 0.31); CPC-adjacent broadening into G01N29/* (118 hits, one PARTIAL); assignee pivot across Samsung and Apple portfolios (87 hits, ML calibration present but bound to electrochemical); literature disproof (no paper reporting the combination).

**Zero refuting, two weakening.**

### Attacks that could not be run
Named on the card and folded into evidence quality: **pre-2000 art** (outside corpus — and for a field with optical-sensing roots in the 1990s this is a material gap), **product and commercial evidence** (no source), **legal status of the two weakening families** (kind-code proxy only). Evidence quality is 0.74 rather than the ~0.85 it would reach with those checks completed, and the recommended-validation list puts the pre-2000 search first as a human task.

### Scores
density 0.12 · rarity 0.92 · semantic novelty 0.71 · evidence quality 0.74 · **confidence 0.78** · crowdedness 0.19 → **strength 0.68**, type **GENUINE**, status **VALIDATED**

### Coverage limitations *(travels with the hypothesis everywhere)*
No art before 2000 · claims unreadable for 29% of this area and 88% of CN families · no citation data · trade-secret protection undetectable · no market or regulatory evidence · semantic analysis based on title and abstract embeddings, not full claim scope

## 13.9 Proposed invention direction

Promoted to a concept, the workspace produces a starting structure that Priya then edits with her own domain knowledge:

**Problem.** Photoacoustic glucose measurement drifts with skin contact pressure, local temperature and tissue hydration, requiring frequent recalibration that defeats the purpose of continuous non-invasive monitoring.

**Direction.** A wearable photoacoustic sensor that co-measures contact pressure, skin temperature and a hydration proxy (e.g. bioimpedance), and applies an on-device personalised model that learns the individual's drift response over an initial calibration period and thereafter corrects the photoacoustic signal without further reference measurements.

**Required elements.** Pulsed light source · acoustic transducer · contact-pressure sensor · temperature sensor · hydration proxy sensor · on-device inference for personalised drift correction · per-user model state persisted across sessions.

**Optional / alternative embodiments.** Federated model initialisation from a population prior; drift-confidence output that requests recalibration only when uncertainty exceeds a threshold; multi-wavelength operation to separate glucose from confounders.

**Technical effect.** Extended interval between reference calibrations at maintained accuracy — the specific, measurable effect a specification would need to support.

**Differentiation table.** Against the three closest families, element by element, showing where each returns Present, Partial or Absent. The pressure/temperature/hydration co-measurement combined with per-user persisted model state is Absent in all three.

**Open questions the system flags for human judgment.** Is the drift response stable enough per individual to be learnable? What calibration period is required? Does the hydration proxy add enough signal to justify the component? Would a skilled person consider the transfer from electrochemical ML calibration obvious?

## 13.10 Next validation step

Recommended and ordered by the system:

1. **Run a novelty search** on the concept's seven features (one click; features pre-extracted; estimated 6 minutes).
2. **Search pre-2000 optical calibration art** in G01N29 and A61B5/1455 **using an external tool** — our corpus begins in 2000, the module cannot perform this check, and this is the most likely place a killing reference hides. The system states this as a task for the user rather than performing it, and marks the hypothesis's evidence quality down until the user records the outcome.
3. **Consult a domain expert** on the specific question of per-individual drift stability. The system states plainly that it cannot assess this.
4. **Check the 2024 optical-drift-correction paper** in full text and determine whether it obviates the learned-model approach.
5. **Bench test** the correlation between the hydration proxy and photoacoustic drift before committing to the component.

Priya runs the novelty search. It returns no anticipating reference and two documents worth reviewing. She opens a drafting session seeded with the concept, the closest art, and the differentiation table.

**Elapsed: about 90 minutes of her attention, four hours of wall-clock, roughly $2 of compute.** The comparable consultant engagement is six weeks and five figures — and would not have produced the rejected-hypothesis list, which is the part that saves R&D money.

---

# Section 14 — Critical review

Written deliberately against the proposal above. Every product document should contain the strongest case against itself, and if the case is weak the document is dishonest.

## 14.1 Where this product could produce misleading conclusions

**1. The clustering is semantic, and semantics is not technology.** Our embeddings encode title and abstract text, not inventive concept. Two patents describing the same mechanism in different registers — an academic-style abstract and a commercial one — may land in different clusters. Every downstream metric inherits this. Cluster boundaries will sometimes be linguistic artefacts presented as technology areas, and a confident cluster name makes the artefact harder to see, not easier. **Mitigation:** cohesion grading, user merge/rename with trail recording, medoids always visible. **Residual risk: real and unavoidable.**

**2. Family-level embedding loses within-family variation.** One vector per DOCDB family, chosen by a representative-selection rule. Where family members differ substantially in claim scope — routine in US continuation practice — we are clustering on one member's language and attributing it to all. **Residual risk: moderate, invisible to the user.**

**3. Claim-element extraction is an LLM reading claims, and LLM extraction is less reproducible than it looks.** Section 9.4 says no LLM produces a number in the UI, and that is true in a narrow sense — but co-occurrence counts are computed over LLM-extracted elements. If extraction normalises two differently-worded elements into one, the residual changes. If it splits one into two, it changes the other way. **The rarity metric, which is central to the whole methodology, sits on a language-model foundation.**

The published evidence on this should worry us. A feasibility study of Elicit for systematic-review data extraction found overall accuracy of about 81% against roughly 87% for human extractors — a gap that was not statistically significant, and which vendors would fairly describe as competitive. But the same study found that **re-running the same extractions from different user accounts reproduced the supporting quotes in only 46% of cases and the reasoning in 30%.** Accuracy and reproducibility are different properties, and it is reproducibility that our metrics depend on.

Mitigation: verbatim quotes shown for every element and substring-verified against stored text; support floors that tolerate some extraction noise; deterministic post-normalisation of element names against a controlled vocabulary built per study. **We must measure extraction agreement across repeated runs before launch and publish the figure internally.** If run-to-run element agreement is below roughly 80%, the rarity metric is not fit to drive a ranked recommendation list and we should degrade it to a qualitative signal. This is the single most important technical risk in the plan and it deserves a dedicated evaluation harness in Milestone 3, not Milestone 6.

**4. Absence of evidence in a 2000-onward corpus — now the single largest analytical risk.** Everything we call sparse is sparse *since 2000*. For mature mechanical, materials and chemical fields the foundational art predates our window entirely.

The earlier version of this plan mitigated this at validation time with date-unrestricted external searches. **The local-only constraint (9.0) removes that mitigation, and nothing replaces it.** What remains is disclosure: the boundary is stamped on every density visual, named as an untestable attack on every hypothesis, and folded into `disproofCompleteness` so affected hypotheses score lower automatically. That is honest, and it is not the same as being right.

The concrete failure mode: a user explores a mature field, sees a genuinely sparse region, watches the system run five disproof searches that all come back clean, and reads a confidence of 0.78 — when the art that kills the idea was filed in 1994. Every element of that chain behaves as designed. **The only real fix is loading pre-2000 records (9.3a item 1), and I would treat it as a prerequisite for selling into mechanical and materials domains** rather than as a roadmap item.

**5. The Chinese-language blind spot.** In the worked example, CN is 28% of families and we can read 12% of its claims. Any claim-element analysis is therefore substantially a US/EP analysis presented as a field analysis. For fields with heavy Chinese filing — batteries, displays, telecoms — this is severe. **The coverage strip states it; users will still under-weight it.**

**6. The research-to-patent ratio can be gamed by provider coverage.** If OpenAlex indexes a field well and PubMed does not, publication volume shifts and the quadrant moves. A field could be mislabelled "dormant" because of provider gaps rather than genuine inactivity. We show provider health, which helps, but the metric is more fragile than its prominence in the UI implies.

**7. Confidence is confidence in our own process.** A hypothesis at 0.78 means our analysis held up against our own attacks using our own data. Users will read it as a probability that the idea is good. **No amount of tooltip text fully prevents this.** The number's precision (two decimals) itself implies a rigour that is not there — we should consider banding it (low/moderate/high) rather than showing 0.78.

**8. Reflexivity.** If this product succeeds, users file in the whitespaces it identifies, and those whitespaces close. Yesterday's analysis becomes wrong precisely because it was acted on. Monitoring partly addresses it; the deeper point is that whitespace is a moving target and any static report has a short half-life. We should date-stamp everything prominently and resist "the definitive map" framing.

**9. The ideation–execution gap — the finding that should most temper our ambitions.** A controlled study of LLM-generated versus expert-generated research ideas had 43 expert researchers each execute a randomly assigned idea, investing over 100 hours apiece, followed by blind expert review. Before execution, the LLM-generated ideas were rated **more novel** than the human ones. After execution, their scores fell significantly more than the human ideas' on every metric measured — novelty, excitement, effectiveness and overall — and human-authored ideas came out ahead on several.

The implication for us is direct and uncomfortable: **AI-generated ideas systematically appear better before anyone tries them.** Our hypotheses are exactly such ideas, and our confidence scores are computed entirely pre-execution. Even a validated hypothesis at 0.78 confidence is a pre-execution judgment, and the evidence says pre-execution judgments of AI-generated ideas are biased upward.

Three responses, all of which we should adopt:
- Frame confidence explicitly as *pre-execution* in the UI, not merely as "confidence".
- Weight the invention-development workspace (6.20) as heavily as generation. The gap closes through human technical engagement, and the workspace is where that happens.
- Track our own version of the gap: what fraction of hypotheses that scored highly at generation survive novelty search, and what fraction of those reach filing. If the drop-off is steep, our scores are miscalibrated and should be presented as bands rather than numbers.

**10. Propensity-to-patent bias means filing counts are not innovation counts.** Patent counts in a field can decline while innovation increases, or rise merely because a few firms are building a defensive war chest. Propensity to patent varies strongly by industry, firm size and invention type; most patents have little economic value while a few have very high value. Our velocity metric measures filing behaviour, and we sometimes describe it in language that implies technological activity. That elision should be corrected in the UI copy: *"filing activity"*, never *"innovation"*.

## 14.2 Where the data is incomplete

Consolidated, and this list belongs in the product's own documentation:

| Gap | Severity | Mitigated? |
|---|---|---|
| Nothing before 2000 | **High** for mature fields | **No — unmitigated** under the local-only constraint. Disclosed, named as an untestable attack, and penalised in evidence quality. Closable only by bulk load (9.3a) |
| Claims unreadable outside US/EP/IN | **High** for CN-heavy fields | Disclosed only; no API route exists either |
| Descriptions truncated at 5,000 chars (US) | Medium | Disclosed only |
| No citation data corpus-wide | Medium | Requires bulk ingestion; no API route |
| No legal status | Medium | Proxy, clearly labelled, **permanent** until bulk load |
| No priority dates | Low–medium | Earliest family filing as proxy |
| Assignee canonicalisation is heuristic | Medium | Shown and correctable |
| No product, standards or regulatory data | **High** for G5/G6 | Advisory only, marked low-evidence |
| Literature is metadata only, no full text | Medium | Disclosed; DOIs provided |
| Publications with no abstract dropped at load | Low–medium | Undisclosed today — **should be added to the coverage panel** |
| Embeddings are title+abstract only | **High** — affects all semantic claims | Disclosed; claim-level analysis on shortlists compensates partly |

## 14.3 Features that look impressive but carry low analytical value

Honest assessment of our own proposal:

- **The cluster map.** Visually the most striking artefact and analytically among the weakest. PCA of binary centroids into 2D discards most of the structure; proximity on screen is suggestive at best. **The list view is more useful and we should be careful not to let the map's beauty imply precision.** Keep it as a selector; never let a conclusion rest on it.
- **Timeline playback.** Genuinely delightful, occasionally illuminating, rarely decision-changing. Worth building for demo value and user engagement, but it should not consume Milestone-4 capacity.
- **The citation network (Phase 2).** Shortlist-scoped citation graphs look authoritative and cover so little of the field that inferences from them are weak. Risk of over-reading is high relative to value delivered.
- **Cross-domain transfer cards.** The highest ratio of impressiveness to reliability in the entire plan. An LLM will always produce a plausible-sounding analogy. Whether it is a real transfer opportunity is a question our data cannot answer. **If we ship this, it must be framed as inspiration, not analysis** — and we should consider whether shipping it at all is worth the credibility risk.
- **The six-dimensional score vector.** Correct in principle, and there is a real chance users ignore five dimensions and read only "confidence". If post-launch telemetry shows that, we should simplify rather than defend the design.
- **Product-to-patent mapping (Phase 2).** Without a real product corpus this is user-entered data with LLM commentary. Useful as a structured workspace; not an analytical capability, and should not be sold as one.

## 14.4 What genuinely requires human patent expertise

The system must be explicit that these are outside its competence:

- **Claim construction.** What a claim term actually covers is a legal question informed by prosecution history, specification and case law. We do string and semantic matching on claim text. These are not the same activity.
- **Obviousness.** Whether combining two known elements is inventive is the central question in patent law and depends on motivation to combine, reasonable expectation of success, and the skilled person's knowledge. **Our combination-rarity metric measures whether it has been *claimed*, not whether it is *inventive*.** Presenting rarity as an inventiveness proxy would be our most dangerous possible error.
- **Enablement and written description.** Whether a direction can be supported by a specification requires domain judgment.
- **Freedom to operate.** Requires claim-by-claim, jurisdiction-by-jurisdiction analysis of in-force rights. We do none of it and must never imply otherwise.
- **Technical feasibility.** G4 detects patterns of abandonment. It cannot tell you whether *your* approach will work.
- **Commercial and regulatory viability.** G5 and G6 are advisory flags. A regulatory strategy for a Class III device is not something we can produce.
- **Whether an opportunity is worth pursuing.** Strategy, portfolio fit, competitive response, budget. The system informs this; it does not decide it.

The AIPLA's published review of AI prosecution tools put the general point sharply: no current AI technology understands an invention. Our design should be read as consistent with that — we organise evidence about inventions; the understanding remains the user's.

## 14.4a Legal and operational risks specific to AI-assisted invention

Four risks that sit outside the analytical questions and need product decisions rather than engineering ones.

**1. Inventorship.** The position has recently moved in our favour. The USPTO issued guidance in February 2024 applying the Pannu joint-inventorship factors to AI-assisted inventions, then **rescinded that guidance in November 2025**, discontinuing the application of Pannu to the AI tool itself on the basis that treating a non-human tool as a putative joint inventor is inappropriate. AI tools are now treated analogously to laboratory equipment, software or research databases. Pannu continues to govern joint inventorship **among humans**, and AI use does not alter that analysis.

What this means for us: the friction we might have anticipated is reduced, but the requirement is unchanged — **a named human must have made a significant contribution to conception.** Our product design already supports this, because the invention-development workspace requires human authorship to produce anything filable. We should nevertheless record, per concept, which blocks were AI-generated and which were human-authored, and surface that record at the drafting handoff. That is good practice regardless of the current guidance, and guidance in this area has now changed twice in two years.

**2. Public-disclosure risk — substantially reduced by the local-only architecture.** Submitting invention details to a third-party service may, depending on terms and jurisdiction, raise questions about public disclosure and consequently about novelty. This is a live concern in practitioner commentary and users will ask about it.

The local-only constraint (9.0) is a strong answer to most of it: **no patent query, no scope text, no hypothesis statement and no claim-element extraction ever leaves our infrastructure for a patent data service, because we call none.** The residual exposure is narrower and more manageable — the LLM calls themselves, and the literature queries (which carry concept-level search terms rather than the invention). Both run under the gateway's configured providers.

What is still needed: a clear, prominently-linked statement of which model providers are configured, under what data-processing terms, with what retention, and whether user content is excluded from training. Enterprise and attorney customers will want contractual commitments. But the architecture now makes that a short, favourable statement rather than a long, defensive one — **this is a genuine sales asset, and it should be said plainly in marketing**, since no competitor with API-dependent enrichment can make the same claim.

**3. Obviousness exposure from predictable generation.** If a direction is one that widely available models would predictably generate from the same inputs, that is at minimum an argument an examiner or opponent could make. We cannot resolve this — it is unsettled — but we should not pretend it does not exist. The practical mitigation is the same as the quality mitigation: the human development stage is where a generated direction becomes a specific invention, and the more the human contributes, the weaker the argument.

**4. AI-generated prior art flooding.** Services exist that mass-generate machine-produced technical disclosures explicitly to block future patenting, and defensive-publication platforms make bulk variation generation easy. Whether unreviewed machine disclosures should qualify as prior art is an open question. The implication for our corpus is that the ratio of signal to defensive noise in some areas may degrade over time, and our density metrics will absorb that noise without noticing. Worth monitoring; nothing to do about it today beyond being aware that "families exist here" will slowly become a weaker signal than it is now.

## 14.5 Claims we must not make in marketing

Prohibited, and this list should be given to whoever writes the website:

- "Find patentable whitespace" — we find candidate gaps; patentability is a legal determination.
- "AI-generated inventions" — we generate hypotheses that require human development. The market has been burned by this claim and buyers will interrogate it.
- "Complete patent landscape" — ours starts in 2000 and reads claims in three jurisdictions.
- "Guaranteed novelty" or any grant-probability figure.
- "Freedom to operate analysis."
- "Replaces your patent search / your attorney / your analyst."
- Any headline percentage of "opportunities found" without the refutation rate alongside it.

Permitted and defensible: *"Evidence-backed invention hypotheses, stress-tested against the art."* · *"Know why an area is empty before you invest in it."* · *"The whitespace tool that tries to prove itself wrong."*

One further caution drawn from the market research: at least one competitor currently displays aspirational whitespace language on pages where the underlying features are still in preview. That is a trap we should avoid deliberately — every capability claim on our marketing surface should map to a shipped, demonstrable feature, because buyers in this category have learned to check.

## 14.6 Preventing hallucinated opportunities

Structural safeguards, in order of importance:

1. **No hypothesis may reference a family that was not returned by a real retrieval call.** Enforced at the data layer: evidence rows carry a `refId` that must resolve to a retrieved record. A hypothesis citing an unretrievable family is rejected before persistence.
2. **All quoted passages come from stored text, never from generation.** Claim excerpts are substring-verified against `claimsText` before being written as evidence. If a model paraphrases, the quote fails verification and the evidence row is dropped.
3. **The type system is set by gates, not by the generator.** The hypothesis generator cannot assign `GENUINE`; only the gate ladder can. The most valuable label is unreachable by the language model.
4. **Confidence is capped until gates pass.** A generated hypothesis cannot present as validated regardless of how confident its prose sounds.
5. **Adversarial prompting.** Validation prompts instruct the model to refute; red-team prompts reward finding the killing reference. Confirmatory framing is the default failure mode of LLM validation and must be designed against explicitly.
6. **Retrieved text is untrusted input.** Patent and paper text passes through the same prompt-injection hardening as any external content. A patent description containing instruction-like text must not influence the pipeline. This needs a dedicated test suite.
7. **Numbers never come from language models.** Every count, ratio and distance is computed in SQL or TypeScript.
8. **Cross-domain cards require a real source family.** No transfer hypothesis without at least one retrieved family from the source domain.

## 14.7 How the product earns trust

In the order the trust is actually built:

1. **Be right about the field's basics.** If the census, top assignees and trends do not match what an expert already knows, nothing else will be believed. The first thirty seconds of the overview screen decide whether the user reads the rest.
2. **Show the limits before being asked.** The coverage strip, the text-coverage panel and the automatic limitations list. Users consistently trust tools that volunteer their weaknesses more than tools that appear flawless.
3. **Kill things visibly.** The refutation rate is a feature. A user who watches the system destroy a plausible hypothesis learns that survivors mean something.
4. **Make everything traceable.** No number without a path to families and queries.
5. **Never cross into legal conclusions.** One "this is patentable" costs every professional user permanently.
6. **Let the human overrule the machine, and record it.** Expert dissent persists alongside the system's view; disputed refutations are honoured.
7. **Publish the methodology.** Section 10 should be a public document. Competitors who cannot explain their whitespace algorithm will be measured against one that can.
8. **Be honest about the null result.** Some fields have no whitespace. A tool that reports this is worth more than one that always finds three opportunities — and the willingness to return nothing is, ultimately, the strongest signal that the rest of the output is real.

---

## Appendix A — Verification note

Every claim in this document about the existing spotipr codebase was checked against the repository in July 2026. Specifically verified: the corpus schema and coverage, the embedding configuration and its title+abstract scope, the seven-provider literature service and its lack of caching/rate-limiting/metering, the retrieval orchestrator and rerank path, the LLM gateway's stage-resolution contract, the durable job-queue pattern, the module and session-cluster conventions, and the design tokens.

Three corrections to earlier internal assumptions are recorded here because they affect implementation:

1. **EP granted specifications are embedded as title + first claim**, not title + abstract (B-documents carry no abstract). Any code replicating the embedding path must handle both cases.
2. **`PriorArtPatentDetail` cannot host citation enrichment** — it carries a required foreign key to `PriorArtPatent`, which would force stub parent rows and couple this module to the prior-art module. A decoupled `PatentCitationCache` is required. `PriorArtScholarContent` is likewise unusable: it is written only by unreachable code and read by nothing.
3. **`voyage-3.5-lite` is natively 1024-dimensional**, MRL-truncated to 512 and then binary-quantised. Hypothesis embedding must replicate that exact path to be comparable with stored vectors.
