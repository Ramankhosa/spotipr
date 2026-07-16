// Feature registry for the /patentnest landing page and its detail pages.
// One entry per capability ("embodiment" in the page's patent-document voice).
// The homepage §04 Detailed Description grid and every
// /patentnest/features/[slug] page are generated from this file, so marketing
// copy, figure specs, and navigation stay in one truthful place.

export type FigSpec =
  | { kind: 'spark' }
  | { kind: 'journey' }
  | { kind: 'noveltyJourney' }
  | { kind: 'pipeline'; stages: string[]; loopback?: { from: number; to: number; label: string } }
  | { kind: 'matrix' }
  | { kind: 'fanout'; branches: string[]; sourceLabel?: string; stacked?: boolean }
  | { kind: 'scan' }
  | { kind: 'style' }
  | { kind: 'refine'; checks: string[] }
  | { kind: 'export'; formats?: string[] }

export interface Feature {
  slug: string
  /** 1-based embodiment number; drives ordering, labels, prev/next nav. */
  embodiment: number
  name: string
  /** Homepage card. */
  card: { tagline: string; size: 'lg' | 'md' }
  fig: FigSpec
  /** Detail page hero. */
  hero: { headline: string; lede: string }
  /** Numbered how-it-works steps (the real flow, from the implementation). */
  how: { title: string; body: string }[]
  /** "Wherein" cards — the distinctive specifics. */
  details: { title: string; body: string }[]
  /** Three proof numbers shown under the hero figure. */
  stats?: { n: string; l: string }[]
  /** One-sentence pull quote — the feature's sharpest claim, set large. */
  pull?: string
  /** Where the CTA sends a signed-in user, and its supporting line. */
  cta?: { href: string; line: string }
}

// Content below is drawn from the actual implementation (ideation-service,
// novelty-search-service, patent-drafting-job-service, ai-review-service,
// jurisdiction-style-service, et al.) — keep it truthful when editing.
export const FEATURES: Feature[] = [
  {
    slug: 'ideation',
    embodiment: 1,
    name: 'Ideation Studio',
    card: {
      tagline:
        'A mind-mapping engine that breaks your assumptions on purpose — and turns a rough seed into mechanism-pure, claimable ideas.',
      size: 'lg',
    },
    fig: { kind: 'journey' },
    hero: {
      headline: 'Invention is a discipline. Practice it.',
      lede: 'The Ideation Studio takes a rough seed idea and works it the way an inventor’s mind should: grounding it, discovering the dimensions that matter, breaking the assumptions holding it in place — and returning structured ideas each built on exactly one causal mechanism.',
    },
    how: [
      {
        title: 'Plant a seed',
        body: 'Describe the idea roughly, with an optional goal and constraints. If the seed is ambiguous, the studio asks a few clarifying questions before spending any effort on it.',
      },
      {
        title: 'Discover the dimensions',
        body: 'The AI grounds and reframes the idea, then discovers four to six dimensions specific to your invention — not from a template — and lays them out as an interactive mind map.',
      },
      {
        title: 'Break assumptions',
        body: 'Expanding any dimension generates assumption-breaking moves — structural changes like remove, invert, decouple, relocate — not decorative feature additions.',
      },
      {
        title: 'Combine and generate',
        body: 'Drag the moves you like into the combine tray (classic TRIZ operators are seeded in), pick an intent, and generate structured ideas — each carrying its core mechanism, its inventive leap, and why it isn’t obvious.',
      },
      {
        title: 'Bank the winners',
        body: 'Every idea gets a first-pass novelty read (AI judgment, before any database search). Shortlist to the Idea Bank, reserve what you’re pursuing, and send it onward to novelty search or drafting.',
      },
    ],
    details: [
      {
        title: 'Mechanism-pure by rule',
        body: 'Ideas that decompose into sequential steps or bolted-together subsystems are rejected by design. One idea, one causal mechanism — the shape a strong claim wants.',
      },
      {
        title: 'A boundary test built in',
        body: 'Each idea records what it deliberately does not solve and where it fails by design — honesty that pays off later, at claim-drafting time.',
      },
      {
        title: 'Reservation, respected',
        body: 'Reserved ideas are redacted for everyone else, server-side. Reservations run 30 days, up to ten at a time per inventor.',
      },
      {
        title: 'A continuous thread',
        body: 'An idea carries its lineage into novelty search and drafting — the session and frame stay linked from first spark to filed application.',
      },
    ],
    stats: [
      { n: '8', l: 'assumption-breaking move types' },
      { n: '1', l: 'mechanism per idea — by rule' },
      { n: '30 days', l: 'reservations, redacted for others' },
    ],
    pull: 'Most tools brainstorm features. This one breaks assumptions — and refuses any idea that isn’t one clean mechanism.',
    cta: { href: '/idea-bank', line: 'Plant a seed · watch the dimensions unfold' },
  },
  {
    slug: 'novelty-assessment',
    embodiment: 2,
    name: 'Novelty Assessment',
    card: {
      tagline:
        'A staged pipeline — plan, retrieve, gate, map, report — that ends in an attorney-style novelty report with evidence you can check.',
      size: 'lg',
    },
    fig: { kind: 'noveltyJourney' },
    hero: {
      headline: 'Novelty is not a feeling. It’s a finding.',
      lede: 'The novelty pipeline turns a disclosure into a precise prior-art search plan you approve before anything runs — then retrieves across patent offices and scholarly indexes, gates candidates by evidence quality, maps every inventive feature against every reference, and hands you an attorney-style report.',
    },
    how: [
      {
        title: 'The plan — approved by you',
        body: 'In about half a minute, the AI converts your disclosure into an editable search plan: extracted inventive features, search language, patent classifications, synonyms. Nothing retrieves until you approve it — those terms control everything downstream.',
      },
      {
        title: 'Two-lane retrieval',
        body: 'Keyword search across a corpus of 30+ million patents from the major offices — USPTO, EPO, WIPO, Japan, China, Korea, India, and more — runs alongside a semantic embedding lane; a neural reranker unifies rankings across corpora. Scholarly literature is searched in parallel.',
      },
      {
        title: 'The relevance gate',
        body: 'Every candidate is classified — accept, component, borderline, reject — with an evidence-quality grade. Only candidates that earn it move on to expensive per-feature analysis.',
      },
      {
        title: 'Feature-by-feature mapping',
        body: 'Each surviving reference is examined against each of your inventive features, with verbatim quotes as evidence. Coverage and novelty metrics are then computed deterministically — not vibes.',
      },
      {
        title: 'The attorney report',
        body: 'A numbered PDF: scope and methodology, key-feature analysis matrix, citation analysis, applicant landscape, claim-positioning observations, risk levels, and limitations. Emailed to you — typically within 15 minutes.',
      },
    ],
    details: [
      {
        title: 'Human-in-the-loop, by design',
        body: 'The search plan is shown, editable, and requires explicit approval — because retrieval terms decide what the pipeline can find.',
      },
      {
        title: 'Budgeted intelligence',
        body: 'The relevance gate spends deep analysis only where evidence quality warrants it — up to 120 candidates gated, the strongest ~60 references mapped in depth.',
      },
      {
        title: 'Combination risk, named',
        body: 'Beyond single-reference anticipation, the report flags distributed-component risk — when your invention is only covered by combining several references.',
      },
      {
        title: 'Durable and honest',
        body: 'Runs as a resumable background job with live progress. If nothing relevant exists, you get a clean no-match report — not padding.',
      },
    ],
  },
  {
    slug: 'feature-mapping',
    embodiment: 3,
    name: 'Feature Mapping',
    card: {
      tagline:
        'Every inventive feature classified against every reference — Present, Partial, Absent, Unknown — with verbatim quotes as evidence.',
      size: 'md',
    },
    fig: { kind: 'matrix' },
    hero: {
      headline: 'Evidence, or it didn’t happen.',
      lede: 'Feature mapping is where the novelty pipeline earns trust: each of your inventive features is classified against each shortlisted reference, and a claim of disclosure must be backed by a verbatim quote copied character-for-character from the reference itself.',
    },
    how: [
      {
        title: 'Features, typed',
        body: 'Inventive features are extracted and typed — core technical, implementation, novelty candidate — while field-common generics (a processor, a sensor) are excluded from standing alone.',
      },
      {
        title: 'One verdict per cell',
        body: 'For every feature × reference pair, exactly one verdict: Present, Partial, Absent, or Unknown. No hedging, no double counting.',
      },
      {
        title: 'Quotes or nothing',
        body: 'Present and Partial require a verbatim quote of at most 18 words from the reference’s title, abstract, or claims, with a confidence score. Thin evidence is forced to Unknown — a missing abstract can’t be spun into fake novelty.',
      },
      {
        title: 'Coverage, computed',
        body: 'Per-reference coverage scores aggregate deterministically into the Key Feature Analysis Matrix, overlap-risk levels, and per-patent attorney remarks in the report.',
      },
    ],
    details: [
      {
        title: 'Same mechanism, or no match',
        body: 'Synonyms and paraphrases count only when they implement the same mechanism — with domain-aware handling for chemical, pharma, and bio inventions.',
      },
      {
        title: 'The honest cell',
        body: 'Unknown is a first-class verdict, mandated when evidence is thin. Most tools quietly guess; this one shows its uncertainty.',
      },
      {
        title: 'Readable by an attorney',
        body: 'Every mapped cell carries a claim-review note and remark written for counsel — the matrix reads as work product, not telemetry.',
      },
      {
        title: 'Feeds your claims',
        body: 'Features that come back clear across the matrix are exactly where your claims should press — the map is a drafting instrument.',
      },
    ],
    stats: [
      { n: '≤18', l: 'words per verbatim quote' },
      { n: '4', l: 'verdicts · present partial absent unknown' },
      { n: '1', l: 'verdict per cell, never hedged' },
    ],
    pull: 'Every “disclosed” must arrive holding its quote — copied character-for-character from the reference itself.',
    cta: { href: '/novelty-search', line: 'See your features mapped against the art' },
  },
  {
    slug: 'prior-art-review',
    embodiment: 4,
    name: 'Prior-Art Review in Drafting',
    card: {
      tagline:
        'Drafting that has already read the prior art — references searched, verdict-gated, and cited before a single section is written.',
      size: 'md',
    },
    fig: { kind: 'pipeline', stages: ['claims', 'search', 'verdict', 'draft'] },
    hero: {
      headline: 'The draft that did its reading.',
      lede: 'Inside the automated drafting pipeline, prior-art review is a first-class stage — not an afterthought. Before any specification section is written, the pipeline searches patent corpora, judges each candidate’s threat to your novelty, and selects the references your draft must be written against.',
    },
    how: [
      {
        title: 'Claims frozen first',
        body: 'Your claim set is generated and frozen before the review — so the review measures references against a fixed target instead of a moving one.',
      },
      {
        title: 'Corpus-first search',
        body: 'The stage searches curated international, European, and Indian patent corpora first, widening to global patent collections when the primaries come up empty.',
      },
      {
        title: 'A verdict for every candidate',
        body: 'Each reference is scored for relevance and given a novelty-threat verdict — anticipates, obvious, adjacent, remote, unknown — along with which parts matter and which of your features it does not disclose.',
      },
      {
        title: 'Selected, excluded, audited',
        body: 'Strong references are auto-selected; remote, unknown, and low-relevance candidates are excluded. The whole pass is recorded as an audit — counts, providers, fallbacks, exclusions.',
      },
      {
        title: 'Drafted against the art',
        body: 'Selected references flow into the drafting configuration, so the background and description are written aware of — and differentiated from — the closest art.',
      },
    ],
    details: [
      {
        title: 'Automatic, not optional',
        body: 'In the automated pipeline the review always runs (unless you supply your own art and say “use only mine”). Prior-art awareness is the default, not an upsell.',
      },
      {
        title: 'Conservative on purpose',
        body: 'Verdicts are made from title and abstract only, and uncertainty forces “unknown” — the pipeline would rather exclude a reference than invent a reading of it.',
      },
      {
        title: 'Manual art respected',
        body: 'References you provide are saved first and merged with the automatic pass — your knowledge of the field is never overwritten.',
      },
      {
        title: 'Shared infrastructure',
        body: 'The same corpus providers and threat vocabulary as the full novelty pipeline — one retrieval stack, one language of risk, end to end.',
      },
    ],
    stats: [
      { n: '5', l: 'threat verdicts per reference' },
      { n: '0.3', l: 'relevance floor — below it, excluded' },
      { n: '100%', l: 'of automated drafts run the review' },
    ],
    pull: 'By the time the first section is written, the draft has already read the art it must be different from.',
    cta: { href: '/patents/draft/new', line: 'Start a draft that does its reading' },
  },
  {
    slug: 'multi-jurisdiction',
    embodiment: 5,
    name: 'Multi-Jurisdiction Drafting',
    card: {
      tagline:
        'One disclosure, drafted for USPTO, EPO, India, PCT and more in a single automated run — each office’s sections, headings, and formatting.',
      size: 'lg',
    },
    fig: { kind: 'fanout', branches: ['USPTO', 'EPO', 'India', 'PCT'], sourceLabel: 'one disclosure' },
    hero: {
      headline: 'Twelve patent offices. One disclosure.',
      lede: 'Select your target offices and the pipeline drafts a separate, office-correct application for each in a single automated run — the right sections in the right order, the right headings, the right formatting, even the right figure language.',
    },
    how: [
      {
        title: 'Pick your offices',
        body: 'US, EP, India, Japan, China, Korea, Germany, Australia, Brazil, UK, Canada, PCT — twelve drafting-ready offices with full section mappings, and a country registry beyond that.',
      },
      {
        title: 'One normalized idea',
        body: 'The invention is normalized once and the claim set frozen once — every jurisdiction drafts from the same source of truth, so the family never drifts apart.',
      },
      {
        title: 'Office-specific sections',
        body: 'Each office enables its own section set and order — a JP/CN draft carries Technical Problem, Technical Solution and Advantageous Effects; a US draft doesn’t. Sections an office doesn’t use are skipped, not padded.',
      },
      {
        title: 'Office-specific form',
        body: 'Export formatting is resolved per office: fonts, line spacing, A4 or Letter, margins, USPTO-style paragraph numbering where required. Figures switch language automatically — Japanese labels for JP, Chinese for CN.',
      },
      {
        title: 'One export each',
        body: 'Every jurisdiction produces its own DOCX and PDF — a filing-ready family from one disclosure.',
      },
    ],
    details: [
      {
        title: 'Database-driven correctness',
        body: 'Section sets, prompts, and formatting live in configuration per office — when an office’s practice changes, the platform updates without a rewrite.',
      },
      {
        title: 'The most restrictive rule wins',
        body: 'Diagram compatibility is computed across all selected offices — if any office demands black-and-white line art, every figure complies.',
      },
      {
        title: 'Reference-numeral discipline',
        body: 'Numbering style adapts to invention type — 100-series buckets for systems, S-labels for process steps, (a)/(b) constituents for compositions — consistently across the whole family.',
      },
      {
        title: 'Scales with batch mode',
        body: 'Across a batch, multiple workers draft different inventions concurrently — a disclosure portfolio becomes a filing-ready portfolio.',
      },
    ],
    stats: [
      { n: '12', l: 'drafting-ready patent offices' },
      { n: '1', l: 'frozen claim set anchoring the family' },
      { n: 'A4 · Letter', l: 'formatting resolved per office' },
    ],
    pull: 'Sections an office doesn’t use are skipped, not padded — a JP draft and a US draft are different documents, on purpose.',
    cta: { href: '/patents/draft/new', line: 'One disclosure · a filing-ready family' },
  },
  {
    slug: 'batch-drafting',
    embodiment: 6,
    name: 'Batch Drafting',
    card: {
      tagline:
        'Upload a spreadsheet of inventions or a folder of disclosure documents — background workers draft them all, into one reviewed ZIP.',
      size: 'md',
    },
    fig: {
      kind: 'fanout',
      branches: ['draft 01', 'draft 02', 'draft 03'],
      sourceLabel: 'one upload',
      stacked: true,
    },
    hero: {
      headline: 'A portfolio, not a patent.',
      lede: 'Batch mode takes an entire pipeline of inventions — a spreadsheet of ideas or a folder of disclosure documents — and drafts them unattended: queued, processed by background workers, tracked live, and delivered as a reviewed, downloadable package.',
    },
    how: [
      {
        title: 'Choose your input',
        body: 'A spreadsheet of ideas (download the template, one invention per row, up to 25 per batch) or documents — one patent per uploaded Word, PDF, or text disclosure, embedded images included.',
      },
      {
        title: 'Set the defaults once',
        body: 'Jurisdictions, filing type, claims handling, prior-art handling — batch-level defaults that every item inherits, with per-row overrides where you need them.',
      },
      {
        title: 'Review, then release',
        body: 'Every row is previewed and editable, with blocking errors flagged before anything runs. One click creates the batch and queues the jobs.',
      },
      {
        title: 'Workers do the drafting',
        body: 'Each item runs the full pipeline — normalize, claims, prior-art review, figures, sections, AI review — with database-locked job claiming, heartbeats, and automatic retries with backoff. Pause, resume, cancel, or retry any time.',
      },
      {
        title: 'One package out',
        body: 'Track attorney-review status per item — needs review, reviewed, accepted, rejected — and download the whole batch as a ZIP: DOCX and PDF per jurisdiction, figures as PNG and SVG.',
      },
    ],
    details: [
      {
        title: 'Genuinely parallel',
        body: 'Multiple workers claim jobs concurrently with row-level locks and leases — a stalled worker’s job is safely reclaimed, not lost.',
      },
      {
        title: 'Fails gracefully',
        body: 'Retries back off (one minute, five, fifteen); batches roll up honestly — completed, completed with errors, or failed. No silent losses.',
      },
      {
        title: 'Documents become drafts',
        body: 'In document mode each file is parsed into a disclosure — title, idea details, embedded figures — and the images flow into the vision pipeline automatically.',
      },
      {
        title: 'Built for review workflows',
        body: 'Attorney-review states on every item make batch output a work queue for counsel, not a pile of files.',
      },
    ],
    stats: [
      { n: '25', l: 'inventions per batch' },
      { n: '2×', l: 'formats per office — DOCX and PDF' },
      { n: '1', l: 'ZIP with the whole portfolio' },
    ],
    pull: 'Workers claim jobs with database locks and heartbeats — a stalled draft is reclaimed, never lost.',
    cta: { href: '/patents/draft/batch', line: 'Upload the spreadsheet · collect the portfolio' },
  },
  {
    slug: 'writing-personas',
    embodiment: 7,
    name: 'Writing Personas',
    card: {
      tagline:
        'Teach the AI your drafting voice from real samples — per section, per jurisdiction — and every draft comes out sounding like your practice.',
      size: 'md',
    },
    fig: { kind: 'style' },
    hero: {
      headline: 'Your voice, at machine speed.',
      lede: 'A writing persona captures how you draft — the vocabulary, sentence structure, and formatting of your practice — from samples you paste in, section by section. Select it when drafting and the AI mimics your style in every generated section, without ever copying your content.',
    },
    how: [
      {
        title: 'Create a persona',
        body: 'Name it — “CSE Patents,” “Pharma Style” — keep it private or share it with your organization as a template.',
      },
      {
        title: 'Feed it real writing',
        body: 'For each section — Field, Background, Summary, Detailed Description, Claims, Abstract — paste a sample from your prior work, with live word-count guidance per section.',
      },
      {
        title: 'Make it jurisdiction-aware',
        body: 'Samples attach per jurisdiction (or universally). At drafting time the lookup prefers jurisdiction-specific samples, then universal, then your personal fallback.',
      },
      {
        title: 'Blend expertise',
        body: 'One primary persona carries structure and tone; up to five secondary personas contribute domain terminology — built for multidisciplinary inventions.',
      },
      {
        title: 'Draft in your voice',
        body: 'Select the persona when drafting. Style few-shots are injected into every section prompt with a hard guard: mimic the style, never the content.',
      },
    ],
    details: [
      {
        title: 'Style, not content',
        body: 'The persona block instructs the model to reproduce vocabulary, cadence, and formatting — reusing the sample’s substance is explicitly forbidden.',
      },
      {
        title: 'Provenance on record',
        body: 'Every generated section records whether persona style was applied and from which samples — coverage gaps surface as warnings, not surprises.',
      },
      {
        title: 'A firm’s house style, shared',
        body: 'Organization personas make a firm’s drafting voice a reusable asset — new associates draft in the house style from day one.',
      },
      {
        title: 'Safe to evolve',
        body: 'Archiving is type-to-confirm and preserves samples for recovery — a persona is practice knowledge, treated that way.',
      },
    ],
    stats: [
      { n: '1 + 5', l: 'primary + secondary personas blended' },
      { n: 'Per office', l: 'jurisdiction-aware samples, with fallback' },
      { n: '0', l: 'sample content ever reused' },
    ],
    pull: 'The model is ordered to mimic your style — and forbidden to touch your substance.',
    cta: { href: '/personas', line: 'Teach it your voice in an afternoon' },
  },
  {
    slug: 'image-intelligence',
    embodiment: 8,
    name: 'Image Reading',
    card: {
      tagline:
        'Upload a sketch or photo — AI vision reads it in context and returns a titled, described, numeral-consistent patent figure.',
      size: 'md',
    },
    fig: { kind: 'scan' },
    hero: {
      headline: 'Your napkin sketch, read like a draftsperson.',
      lede: 'Upload sketches, photos, or diagrams — or let batch mode pull images straight out of disclosure documents. A vision model reads each image in the context of your invention and returns what drafting actually needs: a figure description, a title, and consistency with your reference numerals.',
    },
    how: [
      {
        title: 'Drop in any image',
        body: 'PNG, JPEG, WebP, or SVG — uploaded in the Figure Planner or embedded in batch documents. Each image is queued for analysis the moment it lands.',
      },
      {
        title: 'Preprocessed properly',
        body: 'Images are validated and normalized — downscaled to sane dimensions, SVGs rasterized — before any model sees them.',
      },
      {
        title: 'Read in context',
        body: 'The vision model receives your invention summary, existing diagrams, and declared components — so its description aligns with the reference numerals your draft already uses.',
      },
      {
        title: 'Returned as a figure',
        body: 'A detailed description and a suggested title populate the figure record — feeding the Brief Description of the Drawings and the Detailed Description automatically.',
      },
      {
        title: 'Ready before drafting',
        body: 'In the automated pipeline, image analysis completes before section drafting begins — figure text is never an afterthought.',
      },
    ],
    details: [
      {
        title: 'Context-aware vision',
        body: 'Because the model knows your components and numerals, “the round thing on the left” comes back as “sensor head (12)” — consistent with the rest of the draft.',
      },
      {
        title: 'Sketches and AI figures coexist',
        body: 'Uploaded images and AI-generated diagrams live in one figure sequence, numbered and ordered together.',
      },
      {
        title: 'A real queue behind it',
        body: 'Vision jobs run with heartbeats, retries, and self-healing — a hundred embedded images in a batch won’t fall over.',
      },
      {
        title: 'Transparent provenance',
        body: 'Each analyzed figure records the model used, its status, and any warnings — you can always see how a description came to be.',
      },
    ],
    stats: [
      { n: '4', l: 'formats read · PNG JPEG WebP SVG' },
      { n: '(12)', l: 'descriptions aligned to your numerals' },
      { n: '100%', l: 'analyzed before drafting begins' },
    ],
    pull: '“The round thing on the left” comes back as “sensor head (12)” — because the model read your components first.',
    cta: { href: '/patents/draft/new', line: 'Upload the sketch · get the figure' },
  },
  {
    slug: 'claim-refinement',
    embodiment: 9,
    name: 'Claim Refinement',
    card: {
      tagline:
        'Scope-controlled claim generation, prior-art-driven refinement, antecedent-basis checks — then a freeze that anchors the whole draft.',
      size: 'md',
    },
    fig: { kind: 'refine', checks: ['antecedent basis', 'dependent form', 'claim scope'] },
    hero: {
      headline: 'Claims are the patent. Treat them that way.',
      lede: 'Everything else in an application exists to support the claims. The studio generates them with deliberate scope control, refines them against the actual prior art, validates their structure — and then freezes them, so nothing downstream can quietly drift away from what you claim.',
    },
    how: [
      {
        title: 'Choose your scope',
        body: 'Broad, balanced, or narrow — broad keeps independent claims minimal and pushes embodiments into dependents; narrow pulls concrete differentiators up. Claim style follows your invention type and jurisdiction.',
      },
      {
        title: 'Structural validation',
        body: 'Independent-claim policy enforced, dependent chains checked, and likely antecedent-basis defects flagged — “the sensor array” without a prior “a sensor array” gets caught, not filed.',
      },
      {
        title: 'Refine against the art',
        body: 'After prior-art analysis, an AI comparison reads your claims against the selected references and proposes a refinement preview — edits that tighten and differentiate, grounded in your components and source facts.',
      },
      {
        title: 'You decide, then freeze',
        body: 'Review and edit the suggestions, inject reference numerals into claim text if you want them, and freeze. Frozen claims become read-only.',
      },
      {
        title: 'The anchor holds',
        body: 'From then on, the claims are the fixed point: sections are drafted to support them, and the AI reviewer is forbidden from editing them — it fixes the description to match the claims, never the reverse.',
      },
    ],
    details: [
      {
        title: 'Scope is a dial, not an accident',
        body: 'The broad/balanced/narrow control makes claim strategy an explicit, repeatable choice instead of a prompt-roulette outcome.',
      },
      {
        title: 'Grounded in your facts',
        body: 'Refinements draw on the invention’s source-fact ledger and component map — suggestions cite support, they don’t invent it.',
      },
      {
        title: 'Machine-readable claims',
        body: 'Claims are held as structured data — independent/dependent relationships, numbering, cross-references — which is what makes rigorous validation possible.',
      },
      {
        title: 'One claim set, many offices',
        body: 'In multi-jurisdiction runs the frozen set anchors every office’s draft, keeping the family consistent at its most important point.',
      },
    ],
    stats: [
      { n: '3', l: 'scope styles · broad balanced narrow' },
      { n: '§ 112', l: 'antecedent defects caught before filing' },
      { n: '1', l: 'frozen anchor the whole draft obeys' },
    ],
    pull: 'Once frozen, the claims are read-only — the description bends to them, never the reverse.',
    cta: { href: '/patents/draft/new', line: 'Draft claims with a scope dial, not a dice roll' },
  },
  {
    slug: 'ai-review',
    embodiment: 10,
    name: 'AI Review',
    card: {
      tagline:
        'An examiner-style pass over the whole draft — issues with surgical one-click fixes, and a hard rule: claims and figures are never touched.',
      size: 'md',
    },
    fig: {
      kind: 'pipeline',
      stages: ['draft', 'review', 'fix'],
      loopback: { from: 2, to: 1, label: 're-review' },
    },
    hero: {
      headline: 'Reviewed like an examiner would.',
      lede: 'Before anything ships, an AI review reads the draft the way a senior examiner will: are the claims supported by the description, do the figures match the text, is every component explained, does each section respect its office’s limits? Every issue arrives with a fix you can apply in one click.',
    },
    how: [
      {
        title: 'The full read',
        body: 'Claim-to-description consistency, figure-to-text alignment (numerals in figures must appear in the description), completeness of every declared component, abstract length, numbering-style correctness, jurisdiction section limits, and legal tone.',
      },
      {
        title: 'Issues, graded',
        body: 'Each finding lands as an error, warning, or suggestion, tied to its section, with a self-contained fix instruction — plus an overall score and a recommendation: ready for export, or not yet.',
      },
      {
        title: 'Surgical fixes',
        body: 'Apply a fix and a minimal-edit pass changes only the flagged text — nothing else moves. Ignore or revert any fix; the review re-runs to confirm.',
      },
      {
        title: 'Automated in the pipeline',
        body: 'In batch and automated runs, the review runs per jurisdiction and auto-applies up to eight fixable issues, then re-reviews — drafts arrive pre-polished.',
      },
      {
        title: 'Gatekeeping export',
        body: 'The export quality gate checks that review ran and hard errors are resolved before a filing package is produced.',
      },
    ],
    details: [
      {
        title: 'Claims and figures are sacred',
        body: 'The reviewer is blocked — twice, in the prompt and in code — from modifying claims, diagrams, or figure order. Mismatches are fixed in the editable description, preserving your anchors.',
      },
      {
        title: 'Translation-ready reviews',
        body: 'For the multi-jurisdiction reference draft, the review adds language-neutrality and antecedent-clarity checks — written once, translated safely.',
      },
      {
        title: 'Every issue is actionable',
        body: 'Fix instructions are self-contained — no “consider improving clarity” filler. Apply, ignore, or revert; the trail is kept.',
      },
      {
        title: 'Office-aware limits',
        body: 'Word and character limits per section come from each office’s configuration — the review enforces the rules of the office you’re filing at.',
      },
    ],
    stats: [
      { n: '85–100', l: 'overall score, with recommendation' },
      { n: '8', l: 'fixes auto-applied per office in pipeline' },
      { n: '0', l: 'edits ever made to claims or figures' },
    ],
    pull: 'The reviewer is blocked — in the prompt and again in code — from touching your claims or figures.',
    cta: { href: '/patents/draft/new', line: 'Ship drafts that arrive pre-examined' },
  },
  {
    slug: 'auto-export',
    embodiment: 11,
    name: 'Auto Export',
    card: {
      tagline:
        'Quality-gated DOCX and PDF per jurisdiction — office-correct fonts, margins, paragraph numbering, and embedded figures.',
      size: 'md',
    },
    fig: { kind: 'export', formats: ['docx', 'pdf'] },
    hero: {
      headline: 'The last mile, handled.',
      lede: 'A finished draft becomes a filing package without a formatting weekend: DOCX and PDF per jurisdiction, each following its office’s conventions — sections in the office’s order, figures embedded in sequence, paragraph numbering where required — and a quality gate that refuses to ship an incomplete draft.',
    },
    how: [
      {
        title: 'The quality gate',
        body: 'Before export: required sections present, references valid, validation passing, AI review run. Fail the gate and you get told what’s missing — not a broken file.',
      },
      {
        title: 'Office-correct documents',
        body: 'Fonts, sizes, line spacing, A4 or Letter, margins, page numbers — resolved from each office’s configuration. US exports carry USPTO-style [0001] paragraph numbering; EP exports follow EPO form.',
      },
      {
        title: 'Figures embedded properly',
        body: 'Figures render to PNG for document embedding (SVG alongside), placed in the frozen sequence order, in the correct language variant for each office.',
      },
      {
        title: 'Everything is an artifact',
        body: 'Exports are stored as documents on the record — re-downloadable, versioned by run, never lost in a downloads folder.',
      },
      {
        title: 'Batch ZIPs',
        body: 'Batch runs bundle every item: DOCX and PDF per jurisdiction, figure files grouped and named — one archive for the whole portfolio.',
      },
    ],
    details: [
      {
        title: 'From the same source of truth',
        body: 'Section order and headings come from the same office configuration that drove drafting — the exported document is the draft, not a lossy copy.',
      },
      {
        title: 'Graceful degradation',
        body: 'If PDF rendering is unavailable in a runtime, the DOCX still ships with an explicit warning — the pipeline never silently drops a deliverable.',
      },
      {
        title: 'Names you can file',
        body: 'Sanitized, consistent file naming — FIG-01 through FIG-N, jurisdiction-tagged drafts — ready for a filing system, human or electronic.',
      },
      {
        title: 'One click from review',
        body: 'Export sits at the end of the same pipeline that reviewed the draft — the package you download is the package the gate approved.',
      },
    ],
    stats: [
      { n: '2', l: 'formats per office — DOCX + PDF' },
      { n: '[0001]', l: 'paragraph numbering where required' },
      { n: '1', l: 'quality gate before anything ships' },
    ],
    pull: 'The exported document is the draft — same sections, same order, same source of truth. Not a lossy copy.',
    cta: { href: '/patents/draft/new', line: 'End at a filing package, not a formatting weekend' },
  },
]

export function getFeature(slug: string): Feature | undefined {
  return FEATURES.find((f) => f.slug === slug)
}

export function adjacentFeatures(slug: string): { prev?: Feature; next?: Feature } {
  const sorted = [...FEATURES].sort((a, b) => a.embodiment - b.embodiment)
  const i = sorted.findIndex((f) => f.slug === slug)
  if (i === -1) return {}
  return { prev: sorted[i - 1], next: sorted[i + 1] }
}
