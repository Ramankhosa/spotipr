# The PatentNest Journal — SEO & content strategy

**Status:** live · **Owner:** growth + editorial · **Last reviewed:** 27 July 2026

This document is the reason the blog is built the way it is. Every rule below is
enforced somewhere in code — mostly in `src/lib/blog/seo-audit.ts`, which the
composer runs live on every keystroke, so an author never has to come back here
to remember the checklist.

---

## 1. Who we are writing for

Three readers, in order of commercial value:

| Reader | What they search | What they need from us |
|---|---|---|
| **Founder / inventor, pre-filing** | "how much does a patent cost", "do I need a patent search", "provisional vs complete" | A number, a timeline, and an honest account of what they can and cannot do themselves |
| **In-house IP / R&D manager** | "PCT national phase deadline", "FTO vs patentability search", "patent quality checklist" | Comparisons, process, defensible decisions they can take to a budget holder |
| **Patent attorney / agent** | "§101 software eligibility 2026", "office action response strategy", "AI patent drafting" | Practice-level depth, jurisdiction precision, and a candid view of where AI helps |

Everything is written so a founder can follow it and an attorney would not wince
at it. Where those pull apart, we keep the attorney's accuracy and add the
founder's context — never the reverse.

---

## 2. What the competition actually does

Fetched and read in July 2026.

| Site | What works | What we take | What we deliberately don't |
|---|---|---|---|
| **[GreyB](https://www.greyb.com/blog/)** | Card grid, category filter, sidebar of recommended reading, strong "this startup does X" curiosity headlines | Multiple discovery paths from every article; research-led headlines | Curiosity-gap headlines that don't state the answer; webinar-gated content |
| **[Solve Intelligence](https://www.solveintelligence.com/blog)** | Clean filters (AI for Patents / Case Studies / Legal News), consistent card design, pagination | Topic filters as real, indexable pages | ~70% of posts are product and partnership news — that ranks for nothing |
| **[DeepIP](https://www.deepip.ai/blog)** | Ten well-named topic filters, category chips on every card, month/year stamps | Fine-grained topic hubs; jurisdiction/date honesty | No author on cards — a fatal E-E-A-T omission for legal content |
| **[Henry Patent Law Firm](https://henry.law/blog/)** | Featured hero story, author attribution, year archives, newsletter capture | Featured lead article; named author on every card | Only 3 in 12 headlines are question-shaped — most of their traffic potential is left on the table |
| **[Patsnap](https://www.patsnap.com/resources/blog/)** | Enormous topical footprint, tool/calculator posts that earn links | Tools-as-content on the roadmap (fee and deadline calculators) | Volume without a byline; thin pages that dilute the domain |
| **Indian IP firms** (Intepat, Origiin, LegisMith) | Rank hard on "patent cost in India", "provisional patent India" — exact-fee tables win the snippet | Exact fee tables with entity categories | Fee tables with no review date, which quietly rot |

**The gap we exploit:** the AI-patent-tool companies write product news; the law
firms write legal commentary. Almost nobody writes the plain-English, multi-office,
*decision-shaped* answer — "here is the number, here is the deadline, here is
what changes if you're in India instead of the US" — with a named practitioner
behind it. That is the entire editorial position.

---

## 3. The search reality we are writing into

- AI Overviews cut click-through on top-ranking pages by roughly half for
  informational queries — being ranked is no longer the same as being read.
- But LLM-referred visitors convert far better than classic organic (ChatGPT
  referrals convert around 16% vs ~2% for organic), because the model has
  already qualified them.
- Google's FAQ rich results are gone for most sites, but FAQ **structured data**
  still feeds AI systems. Schema is now a trust and comprehension signal, not a
  display trick.

**Consequence:** we optimise to be *quoted*, not just ranked. If an AI answer
lifts our fee table and cites us, that is a win, and the reader who does click
through is worth ten who bounced off a listicle.

---

## 4. Architecture: four pillars, ten clusters

Hubs are real pages at `/blog/category/<slug>` with their own titles and intros,
not filtered views. Every article links up to its hub and sideways to at least
two siblings.

### Pillar 1 — Patent basics (`patent-basics`)
Top-of-funnel money questions. Highest volume, lowest intent, best for AI citation.

| Article | Focus keyword | Intent |
|---|---|---|
| How much does a patent cost in 2026? | `patent cost` | Informational → commercial |
| How long does it take to get a patent? | `how long does a patent take` | Informational |
| Provisional vs complete specification | `provisional vs complete specification` | Decision |

### Pillar 2 — Prior art & searching (`prior-art-search`)
Directly upstream of the novelty-search product.

| Article | Focus keyword | Intent |
|---|---|---|
| How to do a patent prior art search | `prior art search` | How-to |
| Patentability vs FTO vs invalidity search | `types of patent search` | Comparison |

### Pillar 3 — Drafting & claims (`drafting-and-claims`)
Practitioner depth; proves we understand the craft we automate.

| Article | Focus keyword | Intent |
|---|---|---|
| How to write patent claims | `how to write patent claims` | How-to |
| Are software and AI inventions patentable? | `software patent eligibility` | Informational, high value |
| AI patent drafting: what it does and doesn't do | `ai patent drafting` | Commercial |

### Pillar 4 — Filing & prosecution (`filing-and-prosecution`)
Deadline-driven queries with urgency behind them.

| Article | Focus keyword | Intent |
|---|---|---|
| PCT national phase deadlines | `pct national phase deadline` | Informational, urgent |
| How to respond to an office action | `office action response` | How-to → commercial |

**Roadmap (next ten):** patent quality checklist · design vs utility patents ·
patent maintenance/renewal fee calendars · India FER specifics · EPO
inventive-step (problem–solution) · trade secret vs patent · patent landscape
analysis · claim charts · continuation and divisional strategy · fee calculator
tool page.

---

## 5. The article template

Fixed for every post. It is both a reading experience and an extraction target.

1. **Headline** — the question, as searched. 40–65 characters.
2. **The short answer** — 40–80 words, directly under the H1, in its own field
   (`answerSummary`). This is what gets quoted. It must be true standing alone,
   with no article around it.
3. **Key takeaways** — 4–6 standalone sentences.
4. **Body** — five or more H2 sections, each phrased as a question a person
   would type. At least one table.
5. **FAQ** — 4+ genuine follow-ups (`faqs`), rendered as `<details>` so the text
   is in the DOM even when collapsed, and emitted as FAQPage JSON-LD.
6. **Legal note** — not-legal-advice, verify-with-the-office. Always.
7. **Author + reviewer** — both named, both with profile pages.
8. **One CTA** — matched to the article's subject, never a generic banner.

### Non-negotiables

- **State the jurisdiction.** A patent answer without an office attached is
  wrong somewhere. Every post carries `jurisdictions[]` and says so in the body.
- **Cite the office, not a blog.** USPTO, WIPO, EPO, IPO India — primary sources
  only. The audit counts them.
- **Date the money.** Fees and deadlines get a "checked on" date and a link to
  the live fee schedule, because they change annually.
- **No fabricated precision.** Ranges beat invented averages.
- **No AI-slop tells.** No "in today's fast-paced world", no "delve", no
  three-item lists of empty abstractions.

---

## 6. Answer-engine rules (AEO/GEO)

What we do differently because models, not just crawlers, read the page:

- **Front-load the answer.** Retrieval systems weight the opening; the first 100
  words contain the exact query phrase and the direct answer.
- **Self-contained sentences.** Every takeaway and FAQ answer resolves its own
  pronouns and names its own jurisdiction, because it will be read out of order.
- **Tables for comparables.** Fees, deadlines and options go in tables — the
  structure survives extraction intact where prose does not.
- **Explicit dates and numbers.** "As of July 2026, the USPTO basic filing fee
  is $1,820 (large entity)" is quotable; "filing fees are substantial" is not.
- **Entity clarity.** Organization, Person (author + reviewer), BlogPosting,
  FAQPage and BreadcrumbList JSON-LD on every article, one `@graph` per page.
- **`/llms.txt`** describes the site and lists every article with its one-line
  answer, generated from the database so it cannot drift.
- **AI crawlers are explicitly allowed** in `robots.ts` (GPTBot, OAI-SearchBot,
  ClaudeBot, PerplexityBot, Google-Extended, CCBot). Being quoted is the goal.

---

## 7. What is implemented in the codebase

| Concern | Where |
|---|---|
| Content model incl. answer/takeaways/FAQ fields | `prisma/schema.prisma` → `BlogPost` |
| Live editorial rubric (this document, as code) | `src/lib/blog/seo-audit.ts` |
| Metadata, canonicals, OG/Twitter | `generateMetadata` in `src/app/blog/[slug]/page.tsx` |
| JSON-LD builders | `src/lib/blog/site.ts` |
| Sitemap with real `lastModified` | `src/app/sitemap.ts` |
| robots.txt incl. AI crawler rules | `src/app/robots.ts` |
| RSS 2.0 | `src/app/blog/rss.xml/route.ts` |
| llms.txt | `src/app/llms.txt/route.ts` |
| Author profile pages (E-E-A-T) | `src/app/blog/authors/[slug]/page.tsx` |
| Composer with live audit | `src/app/super-admin/blog/…` |

**Deployment requirement:** set `SITE_URL` in production. Canonicals, sitemap
and JSON-LD all derive from it, and pointing them at localhost makes the blog
invisible.

---

## 8. Internal linking

- Every article: ≥3 internal links (audit-enforced), of which ≥2 to sibling
  articles and ≥1 to a product page.
- Every article links up to its hub via the breadcrumb.
- Hubs link down to every article they own.
- The footer links `/blog` from every marketing page, so the crawl path from the
  homepage to any article is two clicks.
- `relatedSlugs` is hand-curated first, auto-filled from the hub second.

---

## 9. Cadence and maintenance

- **Publish:** 2 articles per month, both against a mapped keyword. Never
  publish to hit a number.
- **Refresh:** every fee/deadline article is re-checked each January, when the
  USPTO and most offices adjust fees. Update `dateModified` only on real
  revisions — a fake freshness stamp is a trust liability.
- **Prune:** anything that has neither ranked nor been cited after 9 months gets
  rewritten or merged into a stronger sibling. Thin pages dilute the domain.

---

## 10. Measurement

| Metric | Target at 6 months | Where from |
|---|---|---|
| Indexed articles | 20 | Search Console |
| Non-brand organic clicks / month | 1,500 | Search Console |
| Top-10 rankings for mapped keywords | 6 of 20 | Rank tracking |
| **Share of model** — % of a fixed 30-prompt patent question set where an AI assistant cites us | 10% | Manual monthly run across ChatGPT, Perplexity, Gemini, AI Overviews |
| Blog → trial signups | 25 / month | `sourcePage` on `AccessRequest` |
| Mean SEO score of published posts | ≥ 85 | Editorial desk |

Share of model is the metric that matters most and the one no off-the-shelf tool
reports properly yet. Run it by hand, monthly, with the same prompts every time.
