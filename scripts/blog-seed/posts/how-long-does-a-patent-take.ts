import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'how-long-does-a-patent-take',
  categorySlug: 'patent-basics',
  publishedDaysAgo: 13,
  title: 'How long does it take to get a patent?',
  subtitle:
    'A stage-by-stage timeline for the USPTO, the Indian Patent Office and the EPO — and the levers that genuinely make it faster.',
  excerpt:
    'From filing to grant, where the months actually go: examination queues, office action rounds, and the acceleration programmes that cut years off the wait in each jurisdiction.',
  answerSummary:
    'Most patents take two to four years from filing to grant. At the USPTO in 2026, the first examination report arrives about 20–26 months after filing and total pendency averages roughly 26 months. India runs 2–4 years on the ordinary route but 1–2 years with expedited examination. Acceleration programmes — Track One, PPH, expedited examination — can compress this to under 12 months.',
  keyTakeaways: [
    'The single longest phase is waiting in the examination queue before anyone reads your application — around 20–26 months at the USPTO in 2026, and 12–24 months in India on the ordinary route.',
    'Total US pendency averages about 26 months, but that average hides wide variation: software and AI applications routinely take 3–4 years because they draw more rejections.',
    'Every substantive office action adds roughly 4–8 months, because you get 3–6 months to respond and the examiner then takes months to consider it.',
    'You control the start of the clock, not its speed: filing a provisional adds up to 12 months before examination even begins.',
    'Acceleration is real and often cheap relative to its value — USPTO Track One targets a final decision in about 12 months, and India’s Rule 24C expedited route can bring a First Examination Report in 1–3 months.',
    'In India, examination does not start until you request it, and the deadline is 31 months from priority for applications filed on or after 15 March 2024.',
  ],
  faqs: [
    {
      question: 'When can I say "patent pending"?',
      answer:
        'From the moment you have a filed application with a filing date — including a US provisional or an Indian provisional specification. It is a factual statement about your filing status, not a grant of rights, and it does not let you sue anyone. Using it without a live application is a false marking offence in most jurisdictions.',
    },
    {
      question: 'Does a patent take longer if it is more complex?',
      answer:
        'Usually, but the driver is the technology area rather than complexity as such. Applications assigned to crowded art units — software, telecommunications, AI, business methods — sit in longer queues and receive more rejections, each of which adds months. A mechanical application in an uncrowded art unit can be granted in half the time on identical drafting quality.',
    },
    {
      question: 'Can I sell or license a patent application before it is granted?',
      answer:
        'Yes. Applications are property and can be assigned, licensed or used as security before grant. Buyers will discount for uncertainty, since the granted claims may end up narrower than the ones filed, but pending applications are traded routinely — particularly after the first office action, when the likely scope is clearer.',
    },
    {
      question: 'What is the fastest anyone can get a patent?',
      answer:
        'Under a year is achievable but unusual. USPTO Track One prioritised examination targets a final disposition in about twelve months for an additional official fee, and applications that are allowed on the first action can grant in six to nine months. In India, a startup or small entity using Rule 24C expedited examination can receive a First Examination Report within one to three months and reach grant inside 12–18 months.',
    },
    {
      question: 'Does the 20-year term start at filing or at grant?',
      answer:
        'At filing — specifically, from the earliest non-provisional filing date, not from grant. A slow examination therefore eats into your enforceable term. The US partially compensates for office delay through Patent Term Adjustment, and some jurisdictions offer extensions for pharmaceutical regulatory delay, but as a rule every year in the queue is a year off the commercial life.',
    },
  ],
  focusKeyword: 'how long does a patent take',
  secondaryKeywords: [
    'patent timeline',
    'uspto pendency 2026',
    'time to get a patent in india',
    'expedited patent examination',
    'track one prioritized examination',
  ],
  tags: ['timelines', 'uspto', 'india', 'prosecution'],
  jurisdictions: ['US', 'IN', 'EP', 'PCT'],
  seoTitle: 'How long does it take to get a patent? 2026 timelines',
  seoDescription:
    'Patent timelines for 2026: USPTO first action at 20–26 months, India 2–4 years, EPO 3–5 years — plus the acceleration routes that cut the wait to under a year.',
  relatedSlugs: ['patent-cost', 'provisional-vs-complete-specification', 'how-to-respond-to-an-office-action'],
  content: `
<p>"Two to four years" is the honest headline answer, and it is unsatisfying because it hides the thing you actually need to know: <em>where</em> the time goes. Almost none of it is examination. Most of it is queueing.</p>

<p>Understanding which months are queue, which are your own response time and which are examiner deliberation is what lets you plan a product launch, a funding round or a licensing conversation around a patent rather than in spite of one.</p>

<h2>What does the timeline look like stage by stage?</h2>

<p>A typical US utility application with no acceleration and one round of rejection:</p>

<table>
  <thead>
    <tr><th>Stage</th><th>Elapsed time</th><th>Who controls it</th></tr>
  </thead>
  <tbody>
    <tr><td>Drafting and filing</td><td>3–8 weeks</td><td>You and your attorney</td></tr>
    <tr><td>Formalities check</td><td>1–3 months</td><td>The office</td></tr>
    <tr><td>Publication at 18 months from priority</td><td>Month 18</td><td>Automatic</td></tr>
    <tr><td><strong>Waiting for the first office action</strong></td><td><strong>20–26 months</strong></td><td>The queue</td></tr>
    <tr><td>Preparing and filing your response</td><td>1–3 months (deadline 3, extendable to 6)</td><td>You</td></tr>
    <tr><td>Examiner considers the response</td><td>2–5 months</td><td>The office</td></tr>
    <tr><td>Allowance and issue</td><td>2–4 months</td><td>The office</td></tr>
    <tr><td><strong>Total</strong></td><td><strong>~30–40 months</strong></td><td></td></tr>
  </tbody>
</table>

<p>The USPTO's own published figures for 2026 put first-action pendency at roughly 20–26 months depending on technology centre, with average total pendency around 26 months and more than 800,000 applications waiting for a first action. Live figures are on the <a href="https://www.uspto.gov/dashboard/patents/pendency.html">USPTO patents pendency dashboard</a>, which is worth checking for your specific art unit rather than relying on the global average.</p>

<h2>Why does the first office action take so long?</h2>

<p>Because examination is queue-based and the queue is long. Applications are assigned to an art unit by technology, and each examiner works through their docket largely in order. Nothing happens to your application in months 3 through 20 — no one has opened it.</p>

<p>This has a practical consequence that surprises most first-time applicants: <strong>filing faster does not get you examined faster.</strong> It gets you an earlier priority date, which matters enormously for novelty, but the queue position is what it is. The only ways to move up the queue are the formal acceleration programmes below.</p>

<h2>How long does a patent take in India?</h2>

<p>India's timeline has a structural difference that catches foreign applicants out: <strong>examination is not automatic</strong>. Nothing happens until you file a Request for Examination, and the deadline is 31 months from the priority date for applications filed on or after 15 March 2024 (it was 48 months before that). Miss it and the application is deemed withdrawn.</p>

<table>
  <thead>
    <tr><th>Stage</th><th>Ordinary route</th><th>Expedited (Rule 24C)</th></tr>
  </thead>
  <tbody>
    <tr><td>Request for examination deadline</td><td colspan="2">31 months from priority</td></tr>
    <tr><td>First Examination Report issues</td><td>12–24 months after request</td><td>1–3 months after request</td></tr>
    <tr><td>Deadline to put the application in order</td><td colspan="2">6 months from FER, extendable by 3</td></tr>
    <tr><td>Typical time to grant</td><td>2–4 years</td><td>1–2 years</td></tr>
  </tbody>
</table>

<p>The statutory framework and current forms are published by the <a href="https://ipindia.gov.in/">Indian Patent Office</a>. Expedited examination under Rule 24C is available to a useful list of applicants: startups recognised by DPIIT, small entities, female applicants, government departments, applicants who chose India as their International Searching Authority, and applicants under a Patent Prosecution Highway arrangement. The fee is higher, but for a startup the difference between a 3-year and a 15-month grant is often worth far more than the fee.</p>

<h2>How long does the EPO take?</h2>

<p>A European application typically reaches grant in three to five years, and the <a href="https://www.epo.org/">EPO</a> publishes its own timeliness data. The search report and written opinion arrive relatively early — often within six to twelve months of filing — which is genuinely useful, because you get a substantive read on patentability long before you have committed to the expensive part.</p>

<p>Examination proper begins after you request it and pay the examination fee following publication. The EPO's PACE programme allows free acceleration of search or examination, and applicants often use the early search opinion to decide whether to accelerate or to let the timeline run while the market develops.</p>

<h2>What does the PCT route do to the clock?</h2>

<p>The PCT is a deliberate delay mechanism, and that is its value. An international application buys you until 30 or 31 months from priority before you must enter national phases and start paying national fees. You get an International Search Report at roughly 16 months — a genuinely informative early read — and publication at 18 months.</p>

<p>What it does <em>not</em> do is shorten anything. National examination begins after national phase entry, so a PCT route to a granted US patent is typically 12–18 months longer than filing directly. That trade — time for optionality — is the whole point. The deadline map is in <a href="/blog/pct-national-phase-deadlines">PCT national phase deadlines</a>.</p>

<h2>What actually makes a patent grant faster?</h2>

<h3>Formal acceleration programmes</h3>

<ul>
  <li><strong>USPTO Track One.</strong> Prioritised examination targeting final disposition within about twelve months, for an additional official fee, limited to 4 claims independent / 30 total. The most reliable acceleration available anywhere.</li>
  <li><strong>Patent Prosecution Highway (PPH).</strong> If one office has allowed claims, another office in the PPH network will examine corresponding claims out of turn, for free. Chronically underused. If you have an allowance anywhere, ask about PPH everywhere else.</li>
  <li><strong>India Rule 24C expedited examination.</strong> FER in 1–3 months for eligible applicants (startups, small entities, female applicants, PPH cases and others).</li>
  <li><strong>EPO PACE.</strong> Free request for accelerated search or examination.</li>
  <li><strong>Age or health based acceleration.</strong> The USPTO will advance an application out of turn if an inventor is over 65 or in poor health, at no fee.</li>
</ul>

<h3>Drafting and prosecution choices</h3>

<p>These matter more than applicants expect, because each avoided rejection is roughly half a year:</p>

<ul>
  <li><strong>Search first, then claim.</strong> Claims drafted around the art you already found get rejected less. This is the highest-leverage acceleration available and it costs a fraction of a Track One fee — see <a href="/blog/how-to-do-a-prior-art-search">how to run a prior-art search</a>.</li>
  <li><strong>Keep the claim set tight.</strong> Restriction requirements — where the examiner says you have claimed several inventions and must pick one — add a full round for nothing.</li>
  <li><strong>Interview the examiner.</strong> A 30-minute call after a first rejection routinely resolves disagreements that would otherwise take two written rounds.</li>
  <li><strong>Respond completely the first time.</strong> A response that argues only the easiest rejection guarantees a second action. <a href="/blog/how-to-respond-to-an-office-action">Responding to an office action</a> covers what a complete response contains.</li>
</ul>

<aside class="note"><strong>Filing a provisional first adds up to a year.</strong> That is often the right trade — it buys time to test the market and refine the invention — but be clear that you are choosing it. If speed to grant is the goal, file a complete application and consider Track One. The trade-off is set out in <a href="/blog/provisional-vs-complete-specification">provisional vs complete specification</a>.</aside>

<h2>Does a slow grant cost you anything?</h2>

<p>Yes, in three ways. The 20-year term runs from filing, so queue time is term you do not get to enforce — the US Patent Term Adjustment system gives some of it back when the delay is the office's fault, but not all. You cannot sue for infringement until the patent grants, so a competitor copying you during pendency is a problem you can only address retrospectively (and in some jurisdictions, through provisional rights based on the published application). And commercially, a pending application is a weaker asset in a funding or licensing conversation than a granted one.</p>

<p>None of that argues for rushing a bad application through. It argues for filing something well drafted, based on a real search, and accelerating it deliberately when the commercial case justifies the fee.</p>
`,
}
