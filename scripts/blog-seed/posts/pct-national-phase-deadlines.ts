import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'pct-national-phase-deadlines',
  categorySlug: 'filing-and-prosecution',
  publishedDaysAgo: 76,
  title: 'PCT national phase deadlines: the 30 and 31 month map',
  subtitle:
    'Which countries give you 30 months, which give 31, what entry actually requires, and what happens if you miss it.',
  excerpt:
    'The PCT buys you two and a half years to decide where you want patents. Here is the deadline for each major country, what you must file to enter, and the limited routes back if the date slips.',
  answerSummary:
    'PCT national phase entry is due 30 months from your earliest priority date in most countries, including the United States, China, Japan, Canada and Brazil. A group of major jurisdictions allows 31 months — the European Patent Office, India, Australia and South Korea among them. The deadline is calculated from the priority date, not the international filing date, and missing it generally abandons the application in that country.',
  keyTakeaways: [
    'The clock runs from the earliest priority date, not the PCT filing date — if you filed a provisional first, you have 30 or 31 months from the provisional, not from the international application.',
    'Most countries use 30 months; the EPO, India, Australia and South Korea are among those allowing 31.',
    'Entry is a filing, not a notification: you need the national fee, a translation where required, and usually a local agent, all on or before the date.',
    'Late entry is possible in some jurisdictions on a due-care or unintentional-delay standard, and Canada allows late entry up to 42 months on payment and a statement — but restoration is discretionary and never a plan.',
    'The national phase is where the money arrives. Entering five countries typically costs more than everything spent up to that point, which is exactly the decision the PCT exists to defer.',
    'Use the International Search Report and Written Opinion at ~16 months to prune the country list before you pay for it.',
  ],
  faqs: [
    {
      question: 'Is the PCT deadline calculated from the PCT filing date or the priority date?',
      answer:
        'From the earliest priority date claimed. If you filed a US provisional in January 2025 and a PCT application in January 2026, your 30-month deadline falls in July 2027 — thirty months from the provisional, not from the PCT filing. Miscalculating from the international filing date is one of the most common and most expensive errors in the whole system.',
    },
    {
      question: 'Do I have to enter every country at once?',
      answer:
        'Each designated office is independent. You can enter the United States on the last day of month 30 and the EPO in month 31, and simply not enter anywhere else. There is no penalty for entering fewer countries than you designated — designation is broad by default and costs nothing extra.',
    },
    {
      question: 'What happens if I miss the national phase deadline?',
      answer:
        'The application is generally treated as withdrawn in that country. Most PCT states provide a reinstatement or restoration mechanism, applied on either an "unintentional" or a stricter "due care" standard, usually within two months of removing the cause of non-compliance and no later than twelve months after the deadline. It is discretionary, costly, and the outcome is genuinely uncertain.',
    },
    {
      question: 'Does a PCT application ever become a patent by itself?',
      answer:
        'No. There is no such thing as an international patent. The PCT gives you a single application, a single search, an optional preliminary examination and a deferred decision — but every patent that results is granted by a national or regional office under its own law.',
    },
    {
      question: 'Should I file a PCT application at all, or file directly in each country?',
      answer:
        'Direct filing is cheaper and faster if you are certain about two or three markets. The PCT is worth its cost when you genuinely do not yet know where the commercial value is, or when you need the extra eighteen months to raise money or prove the market — you are buying optionality, and it is priced accordingly.',
    },
  ],
  focusKeyword: 'pct national phase',
  secondaryKeywords: [
    'pct national phase deadline',
    'pct 30 months',
    '31 month national phase countries',
    'pct national phase entry requirements',
    'missed pct deadline',
  ],
  tags: ['pct', 'deadlines', 'international-filing', 'strategy'],
  jurisdictions: ['PCT', 'US', 'EP', 'IN', 'CN', 'JP', 'KR', 'AU', 'CA', 'BR'],
  seoTitle: 'PCT national phase deadlines: 30 vs 31 months by country',
  seoDescription:
    'PCT national phase entry deadlines by country, what entry requires, how the date is calculated from priority, and the limited restoration routes if you miss it.',
  relatedSlugs: ['patent-cost', 'how-long-does-a-patent-take', 'provisional-vs-complete-specification'],
  content: `
<p>The PCT is often described as an international patent application. It is more accurately described as <strong>an option contract on patent rights</strong>: you pay once, and in exchange you get roughly two and a half years before you must decide which countries are worth paying for.</p>

<p>Everything about managing a PCT case comes down to one date, and that date is the thing people get wrong.</p>

<h2>When is the PCT national phase deadline?</h2>

<p>Thirty months from the <strong>earliest priority date</strong> in most countries, thirty-one in a significant minority.</p>

<p>The word doing the work is <em>priority</em>. Consider a typical sequence:</p>

<table>
  <thead>
    <tr><th>Event</th><th>Date</th><th>Month</th></tr>
  </thead>
  <tbody>
    <tr><td>US provisional filed</td><td>10 March 2025</td><td>Month 0 — <strong>the clock starts here</strong></td></tr>
    <tr><td>PCT application filed</td><td>9 March 2026</td><td>Month 12</td></tr>
    <tr><td>International Search Report</td><td>~July 2026</td><td>Month 16</td></tr>
    <tr><td>International publication</td><td>~September 2026</td><td>Month 18</td></tr>
    <tr><td><strong>30-month national phase deadline</strong></td><td><strong>10 September 2027</strong></td><td>Month 30</td></tr>
    <tr><td><strong>31-month deadline (EPO, India, AU, KR)</strong></td><td><strong>10 October 2027</strong></td><td>Month 31</td></tr>
  </tbody>
</table>

<p>Counting thirty months from the PCT filing date instead of the provisional gives you September 2028 — a year past the real deadline, by which point the application is long dead in every designated state. This single arithmetic error is responsible for a meaningful share of all restoration petitions.</p>

<h2>Which countries give 30 months and which give 31?</h2>

<table>
  <thead>
    <tr><th>Deadline</th><th>Jurisdictions (major)</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>30 months</strong></td>
      <td>United States · China · Japan · Canada · Brazil · Mexico · Russia · Singapore · Israel · South Africa</td>
    </tr>
    <tr>
      <td><strong>31 months</strong></td>
      <td>European Patent Office · India · Australia · South Korea · United Kingdom (national route) · New Zealand</td>
    </tr>
  </tbody>
</table>

<p>Two health warnings on that table. First, a handful of offices offer extensions on payment — China, for instance, allows a further period with a surcharge. Second, national time limits change, and they are only authoritative in one place: WIPO's <a href="https://www.wipo.int/pct/en/">PCT National Phase Entry guides</a> and each office's own rules. Diarise the earlier date, treat the extra month as a buffer you never use, and check the national chapter for any country you actually enter.</p>

<h2>What does entering the PCT national phase actually require?</h2>

<p>Entry is an act, not a notice. In each country you generally need, on or before the deadline:</p>

<ul>
  <li><strong>A request to enter</strong> on that office's form, referencing the international application number</li>
  <li><strong>The national fee</strong> — filing, and in some countries search and examination too</li>
  <li><strong>A translation</strong> of the application into the official language, certified where required. This is the largest single line item for Japan, China, Korea and Brazil, and typically the longest lead time</li>
  <li><strong>A local agent or address for service</strong> — mandatory in most jurisdictions for foreign applicants</li>
  <li><strong>A power of attorney</strong>, sometimes notarised or legalised, which can take weeks to obtain</li>
  <li><strong>Any amendments</strong> you wish to carry through under Article 19 or Article 34</li>
</ul>

<p>The practical consequence: <strong>national phase preparation starts at month 26, not month 30.</strong> A 12,000-word specification translated into Japanese, Chinese and Korean is six to eight weeks of work if nothing goes wrong. Instructing agents in the last fortnight is how good applications get filed with bad translations.</p>

<h2>What does it cost?</h2>

<p>Rough per-country ranges for entry alone, excluding later prosecution:</p>

<table>
  <thead>
    <tr><th>Jurisdiction</th><th>Typical entry cost</th><th>Main driver</th></tr>
  </thead>
  <tbody>
    <tr><td>United States</td><td>$2,500–$4,500</td><td>Official fees; no translation</td></tr>
    <tr><td>European Patent Office</td><td>€4,500–€7,000</td><td>Search/examination fees, claims fees</td></tr>
    <tr><td>India</td><td>₹40,000–₹1,00,000</td><td>Agent fees; low official fees</td></tr>
    <tr><td>China</td><td>$3,000–$5,000</td><td>Translation</td></tr>
    <tr><td>Japan</td><td>$4,000–$7,000</td><td>Translation</td></tr>
    <tr><td>South Korea</td><td>$3,000–$5,000</td><td>Translation</td></tr>
    <tr><td>Brazil</td><td>$2,000–$4,000</td><td>Translation, formalities</td></tr>
  </tbody>
</table>

<p>Five countries is therefore a $20,000–$30,000 month, arriving all at once, before a single examiner has read anything. That concentration is precisely why the country list deserves a real commercial decision rather than a default. Fuller cost context is in <a href="/blog/patent-cost">how much a patent costs</a>.</p>

<h2>How should you use the months before the deadline?</h2>

<p>The PCT hands you two genuinely useful pieces of information before you have to spend. Use both.</p>

<ol>
  <li><strong>Month 16 — the International Search Report and Written Opinion.</strong> A professional examiner's view of novelty and inventive step, months before national fees. A negative opinion is not fatal (national examiners are not bound by it) but it is the single best evidence you will have about what you are likely to get. Two X-category citations against your independent claim should change your budget.</li>
  <li><strong>Month 18 — publication.</strong> Your application becomes public and citable prior art, and competitors can see it. This is also when it starts working as a defensive publication regardless of whether you ever get a patent.</li>
  <li><strong>Month 19–22 — optional Chapter II demand.</strong> International preliminary examination lets you amend and argue, producing a more favourable preliminary report. Its popularity has fallen as national offices increasingly conduct their own examination anyway, but it can be worth it where a negative written opinion would otherwise chill national prosecution.</li>
  <li><strong>Month 24–26 — decide the country list, and instruct.</strong> Revenue by market, manufacturing locations, competitors' locations, and enforceability. Three markets you can afford to enforce beat seven you cannot.</li>
</ol>

<aside class="note"><strong>The most common national-phase mistake after the date itself:</strong> entering countries by aspiration rather than evidence. "We might expand to Japan" costs $5,000 now plus annuities for twenty years. Patents are only worth what you would spend to enforce them — and if you would not fund litigation in a country, ask what the patent there is actually doing.</aside>

<h2>What if you miss the PCT national phase deadline?</h2>

<p>You have options, none of them comfortable:</p>

<ul>
  <li><strong>Reinstatement of rights.</strong> Most offices allow restoration where the failure occurred despite due care, or (in some) where it was unintentional. Typically within two months of removing the cause and no more than twelve months after the deadline, with a fee. Standards vary sharply — the EPO's due-care test is genuinely demanding.</li>
  <li><strong>Canada's late entry route.</strong> Canada permits national phase entry up to 42 months from priority on payment of an additional fee and, for applications subject to the current rules, a statement that the failure was unintentional.</li>
  <li><strong>Third-party rights.</strong> Even where restoration succeeds, someone who began using the invention in good faith during the lapse may retain the right to continue.</li>
</ul>

<p>Restoration is a rescue, not a route. The systemic fix is dull and effective: record the priority date — not the filing date — in a docketing system the day the PCT is filed, set reminders at 24, 26, 28 and 29 months, and treat month 26 as the working deadline.</p>

<p>Each office also publishes its own PCT national phase requirements — the <a href="https://www.uspto.gov/patents/basics/international-protection/patent-cooperation-treaty">USPTO</a>, the <a href="https://www.epo.org/">EPO</a> as a designated Office, and the <a href="https://ipindia.gov.in/">Indian Patent Office</a> for the 31-month route into India.</p>

<h2>After PCT national phase entry</h2>

<p>Each national phase proceeds under local law, with local claim rules, local examination timelines and local office actions. The same PCT application will typically grant with different claims in different countries. Two things follow: India's Request for Examination clock and its 31-month examination deadline start applying (see <a href="/blog/how-long-does-a-patent-take">how long a patent takes</a>), and the first office action in each country will need a response written to that office's practice — covered in <a href="/blog/how-to-respond-to-an-office-action">responding to an office action</a>.</p>
`,
}
