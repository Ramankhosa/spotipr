import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'invention-disclosure-to-filing',
  categorySlug: 'drafting-and-claims',
  publishedDaysAgo: 37,
  title: 'From invention disclosure to filed application in 7 days',
  subtitle:
    'A realistic day-by-day workflow for a firm or in-house team using AI assistance honestly — where the week is actually spent, what stays human, and why the inventor’s calendar is the real bottleneck.',
  excerpt:
    'A candid day-by-day map from invention disclosure to filing: what each day produces, which steps AI genuinely compresses, why the Day 2 claim-scope decision stays human, and why the inventor’s calendar — not the drafting — is usually what stretches the schedule.',
  answerSummary:
    'A focused week from invention disclosure to filed application is achievable for a well-documented software or electronics invention — chemistry and biotech run longer. The shape: Day 0 intake and gap questions, Day 1 prior-art search, Day 2 the human-only claim-scope decision, Days 3–4 drafting with AI assistance, Day 5 consistency checks and full inventor review, Day 6 formalities and filing. The bottleneck is rarely drafting speed; it is the inventor’s calendar.',
  keyTakeaways: [
    'A focused week from invention disclosure to filed application is realistic for a well-documented software or electronics invention; chemistry and biotech routinely take longer because examples and data need verification that no schedule can compress.',
    'The quality of the invention disclosure sets the ceiling for the whole week: a disclosure that names the closest existing approaches and states what is different saves days of interview cycles.',
    'The claim-scope decision on Day 2 is the one step that cannot be delegated to AI, because it depends on what the prior art already covers — a judgement examiners in the US, India and every other office will test.',
    'AI assistance genuinely compresses description expansion, dependent-claim drafting and consistency checking — the volumetric middle of the week — and contributes nothing to the judgement at either end.',
    'The real constraint is usually the inventor’s calendar: the work needs roughly 2–4 hours of inventor time, but the intake interview and the full review must land on the right days for the schedule to hold.',
  ],
  faqs: [
    {
      question: 'How long does patent drafting usually take?',
      answer:
        'In conventional practice, first drafts commonly take a few weeks of calendar time — most of it queueing rather than working, since the active drafting hours are far fewer than the elapsed days. With a complete disclosure, a structured workflow and AI assistance on the volumetric steps, a focused week is achievable for software and electronics inventions. Chemistry and biotech run longer because experimental support has to be verified, and provisional deadlines can compress or extend any of this.',
    },
    {
      question: 'What should an invention disclosure form include?',
      answer:
        'Eight things: the problem being solved; the closest existing approaches the inventors know; the solution as actually built; what is different from the closest approach; alternatives considered and rejected; measured results, if any exist; sketches or block diagrams; and commercial context such as launch dates or past disclosures. The single highest-value field is "what is different" — it seeds the claim-scope decision, and a thoughtful answer there saves more time than anything else in the form.',
    },
    {
      question: 'Can AI draft the application straight from the disclosure?',
      answer:
        'It can produce a complete-looking document, which is precisely the danger. What it cannot do is decide claim scope, because that depends on prior art the model has not weighed and on commercial judgement it does not have. The honest division of labour: humans decide what to claim after a real search; AI expands the settled claims into a description, drafts dependent claims and runs consistency checks; humans review everything before filing.',
    },
    {
      question: 'How much inventor time does a filing actually need?',
      answer:
        'Commonly 2–4 hours in total for a well-documented invention: an intake interview of about an hour or two at the start, a short check-in when the claims exist, and a full review of the draft before filing. The hours are modest; the difficulty is that they must land on specific days. Booking the intake interview and the review session before drafting starts is the single best predictor that a one-week schedule holds.',
    },
    {
      question: 'Does the 7-day timeline work for chemistry or biotech inventions?',
      answer:
        'Usually not, and it is better to say so upfront than to miss a promised date. Chemistry and biotech applications lean on experimental support — examples, ranges, comparative data — and verifying that support against what was actually run in the lab has its own clock. The workflow shape still applies: the same intake, search, scope decision and review structure works; only the drafting and verification middle stretches, commonly by weeks rather than days.',
    },
  ],
  focusKeyword: 'invention disclosure',
  secondaryKeywords: [
    'invention disclosure form',
    'idf to patent application',
    'patent drafting workflow',
    'how long does patent drafting take',
  ],
  tags: ['workflow', 'drafting', 'practice-management', 'artificial-intelligence'],
  jurisdictions: ['IN', 'US', 'PCT'],
  seoTitle: 'From invention disclosure to filed application in 7 days',
  seoDescription:
    'A realistic day-by-day workflow from invention disclosure to filed application: where AI saves time, what stays human, and what slows the week down.',
  relatedSlugs: ['ai-patent-drafting', 'how-to-do-a-prior-art-search', 'patent-filing-forms-india'],
  content: `
<p>The distance between an invention disclosure and a filed patent application is usually measured in weeks, and most of those weeks are queue, not work. This article lays out a day-by-day workflow that compresses the queue: what has to happen, in what order, who does it, and where AI assistance honestly helps. One framing note before the schedule: a focused week is achievable for a well-documented software or electronics invention. Chemistry and biotech run longer, because examples and experimental data need verification that no schedule can compress. What follows is a description of how the work distributes — not a promise of a deadline.</p>

<h2>What does an invention disclosure need to contain?</h2>

<p>Everything downstream is throttled by the disclosure. A complete invention disclosure form saves days; a thin one converts drafting time into interview time. The fields that matter, and why each one matters later:</p>

<table>
  <thead>
    <tr><th>Disclosure field</th><th>Why it matters downstream</th></tr>
  </thead>
  <tbody>
    <tr><td>The problem being solved</td><td>Frames the technical problem — the anchor for the background section and, for software, for the eligibility story.</td></tr>
    <tr><td>Closest existing approaches the inventors know</td><td>The first prior-art leads. Inventors usually know the two nearest references better than any search will find them.</td></tr>
    <tr><td>The solution, as actually built</td><td>Becomes the worked embodiment — the spine of the whole specification.</td></tr>
    <tr><td>What is different from the closest approach</td><td>The candidate point of novelty. This one field does more to set claim scope than everything else combined.</td></tr>
    <tr><td>Alternatives considered and rejected</td><td>Dependent claims and fall-back positions, and evidence that the inventors explored the space.</td></tr>
    <tr><td>Measured results, if any</td><td>Support for advantages argued during prosecution. Real measurements only — an invented number is a liability, not filler.</td></tr>
    <tr><td>Sketches, block diagrams, screenshots</td><td>Seed the figures. A sketch that exists at disclosure becomes a figure with support behind it.</td></tr>
    <tr><td>Commercial context: launch dates, demos, past disclosures</td><td>Sets the real deadline. A conference talk next month matters more than any internal milestone.</td></tr>
  </tbody>
</table>

<h2>How does the 7-day workflow run?</h2>

<p>The swimlane below shows how the week distributes across three lanes: the attorney, the AI tooling, and the inventor. Two things to notice before the day-by-day detail: the inventor appears exactly twice, and the narrowest block on the chart — the claim-scope decision — is the one that cannot be delegated.</p>

<p>Three ground rules make the chart honest. "Day" means a working day on which this matter gets sustained attention, not a calendar promise — a crowded docket stretches the same sequence over two or three weeks without changing its shape. The lanes run in parallel where they can: search tooling works while the attorney reads, and drafting resumes while the inventors review. And the two inventor blocks are booked before Day 0 begins, because everything else in the week can flex and those two cannot.</p>

<figure><svg viewBox="0 0 760 300" role="img" aria-label="Seven-day swimlane chart with attorney, AI assistance and inventor lanes, showing the Day 2 claim-scope decision as human only" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif">
<title>Seven-day swimlane chart with attorney, AI assistance and inventor lanes, showing the Day 2 claim-scope decision as human only</title>
<text x="173" y="44" text-anchor="middle" font-size="13" fill="#667085">Day 0</text>
<text x="260" y="44" text-anchor="middle" font-size="13" fill="#667085">Day 1</text>
<text x="347" y="44" text-anchor="middle" font-size="13" fill="#667085">Day 2</text>
<text x="434" y="44" text-anchor="middle" font-size="13" fill="#667085">Day 3</text>
<text x="521" y="44" text-anchor="middle" font-size="13" fill="#667085">Day 4</text>
<text x="608" y="44" text-anchor="middle" font-size="13" fill="#667085">Day 5</text>
<text x="695" y="44" text-anchor="middle" font-size="13" fill="#667085">Day 6</text>
<line x1="130" y1="54" x2="130" y2="272" stroke="#e4e7ec" stroke-width="1"/>
<line x1="217" y1="54" x2="217" y2="272" stroke="#e4e7ec" stroke-width="1"/>
<line x1="304" y1="54" x2="304" y2="272" stroke="#e4e7ec" stroke-width="1"/>
<line x1="391" y1="54" x2="391" y2="272" stroke="#e4e7ec" stroke-width="1"/>
<line x1="478" y1="54" x2="478" y2="272" stroke="#e4e7ec" stroke-width="1"/>
<line x1="565" y1="54" x2="565" y2="272" stroke="#e4e7ec" stroke-width="1"/>
<line x1="652" y1="54" x2="652" y2="272" stroke="#e4e7ec" stroke-width="1"/>
<line x1="739" y1="54" x2="739" y2="272" stroke="#e4e7ec" stroke-width="1"/>
<text x="20" y="92" font-size="13" fill="#667085">Attorney</text>
<text x="20" y="162" font-size="13" fill="#667085">AI assist</text>
<text x="20" y="232" font-size="13" fill="#667085">Inventor</text>
<rect x="134" y="68" width="79" height="36" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="173" y="90" text-anchor="middle" font-size="13" fill="#344054">Intake</text>
<rect x="221" y="68" width="79" height="36" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="260" y="90" text-anchor="middle" font-size="13" fill="#344054">Prior art</text>
<rect x="308" y="62" width="79" height="48" rx="8" fill="#1d4ed8"/>
<text x="347" y="82" text-anchor="middle" font-size="13" font-weight="600" fill="#fff">Claim scope</text>
<text x="347" y="100" text-anchor="middle" font-size="13" fill="#fff" opacity="0.85">human only</text>
<rect x="395" y="68" width="79" height="36" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="434" y="90" text-anchor="middle" font-size="13" fill="#344054">Claims</text>
<rect x="482" y="68" width="79" height="36" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="521" y="90" text-anchor="middle" font-size="13" fill="#344054">Edit spec</text>
<rect x="569" y="68" width="79" height="36" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="608" y="90" text-anchor="middle" font-size="13" fill="#344054">Final pass</text>
<rect x="656" y="68" width="79" height="36" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="695" y="90" text-anchor="middle" font-size="13" fill="#344054">File</text>
<rect x="221" y="138" width="79" height="36" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="260" y="160" text-anchor="middle" font-size="13" fill="#344054">Search</text>
<rect x="395" y="138" width="79" height="36" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="434" y="160" text-anchor="middle" font-size="13" fill="#344054">Claim drafts</text>
<rect x="482" y="138" width="79" height="36" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="521" y="160" text-anchor="middle" font-size="13" fill="#344054">Spec, figures</text>
<rect x="569" y="138" width="79" height="36" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="608" y="160" text-anchor="middle" font-size="13" fill="#344054">Checks</text>
<rect x="134" y="208" width="79" height="36" rx="8" fill="#fff" stroke="#98a2b3"/>
<text x="173" y="230" text-anchor="middle" font-size="13" fill="#101828">Interview</text>
<rect x="569" y="208" width="79" height="36" rx="8" fill="#fff" stroke="#98a2b3"/>
<text x="608" y="230" text-anchor="middle" font-size="13" fill="#101828">Full review</text>
</svg><figcaption>Fig. 1 — The disclosure-to-filing week in three lanes. The Day 2 claim-scope decision is the shortest task in hours and the only one that cannot be delegated; the inventor’s two touchpoints are the intake interview and the full review.</figcaption></figure>

<h3>Day 0 — intake and gap questions</h3>

<p>Read the invention disclosure twice, then send the gap questions the same day: what is missing, what is ambiguous, and which "obvious" steps are actually where the invention lives. The intake interview that follows is commonly an hour or two, and it is the highest-leverage meeting of the week. Booking it late is the most common way a seven-day plan becomes a three-week plan. If several inventors are named, get them into the same interview: divergence about what is actually new surfaces cheaply in conversation and expensively in a half-drafted claim set.</p>

<h3>Day 1 — prior-art search and feature matrix</h3>

<p>A structured search — the method is in <a href="/blog/how-to-do-a-prior-art-search">how to do a prior-art search</a> — followed by a feature matrix: candidate claim elements down the side, the closest references across the top, a mark wherever a reference shows an element. Semantic tools such as a <a href="/novelty-search">novelty search</a> compress the retrieval and the first-pass reading of forty abstracts. Deciding which differences are technically meaningful stays human work.</p>

<h3>Day 2 — the claim-scope decision</h3>

<p>The shortest day in hours and the most important. With the matrix on the table, decide the minimum set of elements that is both novel over what the search found and commercially meaningful. This is the row of the workflow where AI contributes nothing — the same division of labour set out in <a href="/blog/ai-patent-drafting">our honest account of AI patent drafting</a>. If Day 2 is wrong, everything after it is beautifully formatted waste.</p>

<h3>Day 3 — claim set and inventor check-in</h3>

<p>Draft the independent claims around the decided scope; generate first-draft dependent claims from the feature list and cull them. Then a short inventor check-in — half an hour is commonly enough — to confirm the claims still describe the thing that was actually built, in the inventor’s own reading of them. Misunderstandings are cheap to fix today and expensive on Day 5.</p>

<h3>Day 4 — specification and drawings</h3>

<p>The volumetric day, and the one AI assistance genuinely compresses: expanding the settled claims and the worked embodiment into a full description with alternatives and definitions, and producing figures in which every claim element appears as a numbered part. The attorney edits rather than types. What matters in the output is internal consistency — claims, description and drawings sharing one vocabulary.</p>

<h3>Day 5 — consistency pass and full inventor review</h3>

<p>Machine checks first: antecedent basis, numeral consistency between text and figures, claim terms the description never defines. Then the full inventor read — the second of the two inventor touchpoints, commonly an hour or two. Brief the inventors on what to look for: technical wrongness, missing alternatives, overstated results. They are not there to review commas. And when the review surfaces a real problem — an embodiment that does not match the product, a result the data cannot support — treat it as a Day 2 problem wearing a Day 5 timestamp: fix the scope, not the wording.</p>

<h3>Day 6 — formalities and filing</h3>

<p>Forms, declarations, fees, the filing itself. None of it is intellectually hard; all of it delays a filing when it starts late. Indian filings carry their own forms and signatory requirements — <a href="/blog/patent-filing-forms-india">the Indian patent filing forms guide</a> covers them — and the PCT and US routes each publish their checklists on <a href="https://www.wipo.int/">wipo.int</a> and <a href="https://www.uspto.gov/">uspto.gov</a>. Start the formalities on Day 5, not on the morning of Day 6.</p>

<h2>Where does AI actually save the time?</h2>

<p>Three places, honestly: description expansion on Day 4, dependent-claim first drafts on Day 3, and the consistency checks on Day 5. Those are the volumetric middle of the week — the parts whose cost was always typing and cross-checking rather than judgement, and the reason the middle of the schedule holds. The same tooling helps with the Day 1 feature matrix, but there it assists the reading rather than replaces it: retrieval gets compressed, relevance judgement does not.</p>

<p>What AI does not compress: the Day 0 judgement about what is missing from an invention disclosure, and the Day 2 decision about scope. Those take the same thinking they always took. The honest change is that the hours recovered from typing can now be spent there — which is the only place they were ever worth spending.</p>

<h2>What slows the week down?</h2>

<ul>
  <li><strong>Inventor availability.</strong> The real bottleneck. The work needs perhaps 2–4 hours of inventor time in total, but those hours must land on specific days. Book the interview and the review before drafting starts.</li>
  <li><strong>Thin disclosures.</strong> An invention disclosure that answers "what is different?" with "it is better" adds an interview cycle before Day 1 can begin.</li>
  <li><strong>Multi-inventor disagreement.</strong> Three inventors, three views of what the invention is. Resolve it on Day 0, in one room — not by email across the week.</li>
  <li><strong>Chemistry and biotech verification.</strong> Examples, ranges and comparative data have to be checked against what was actually run in the lab. That verification has its own clock, and a filing that outruns it buys support problems no schedule justifies.</li>
</ul>

<h2>Should you file a provisional or a complete specification?</h2>

<p>A separate decision with its own trade-offs — <a href="/blog/provisional-vs-complete-specification">provisional vs complete specification</a> walks through them — but it interacts with the week. When the deadline is a demo or a paper, a provisional built on the same discipline secures a priority date without spending the claim-scope work prematurely; the deadlines that then start running are covered in that article. What a provisional is not is an excuse to skip Day 1 and Day 2: a provisional that cannot support the eventual claims buys a filing date and quietly loses it where it matters.</p>

<p>The honest summary of the week: the calendar time is mostly inventor availability and formalities; the intellectual time is Days 1 and 2; the typing time is where AI earns its keep. Improve the invention disclosure and everything downstream improves with it — which is why the best investment in a drafting workflow is usually a better disclosure form, not a faster drafting tool.</p>
`,
}
