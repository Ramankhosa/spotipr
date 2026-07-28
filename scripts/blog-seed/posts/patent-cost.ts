import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'patent-cost',
  categorySlug: 'patent-basics',
  featured: true,
  publishedDaysAgo: 4,
  title: 'How much does a patent cost in 2026?',
  subtitle:
    'Official fees, attorney fees, and the costs nobody quotes you up front — broken down for the USPTO, the Indian Patent Office, the EPO and the PCT.',
  excerpt:
    'A complete cost breakdown for getting and keeping a patent in 2026: what the patent office charges, what attorneys charge to draft and prosecute, what renewals cost over 20 years, and where budgets actually go wrong.',
  answerSummary:
    'A single US utility patent typically costs $10,000–$20,000 from drafting to grant for a mechanical or software invention, of which about $3,300 is USPTO fees for a large entity and roughly $700 for a micro entity. In India the same patent usually runs ₹60,000–₹2,00,000. Filing in several countries through the PCT commonly reaches $35,000–$60,000 by the time national phases are complete.',
  keyTakeaways: [
    'USPTO official fees at the filing stage in 2026 are $3,320 for a large entity, $1,660 for a small entity and $664 for a micro entity — the attorney fee is usually three to five times that.',
    'Attorney drafting fees, not government fees, dominate the cost of a patent in every jurisdiction; a well-drafted specification is where most of the budget goes and where most of the value is created.',
    'Indian official fees are an order of magnitude lower than US ones: ₹1,600 to e-file as a natural person, startup or small entity, and ₹4,000 to request examination.',
    'A patent is not a one-off purchase. US maintenance fees at 3.5, 7.5 and 11.5 years total roughly $14,500 for a large entity, and European validation and annuities can exceed the cost of prosecution.',
    'Going international through the PCT defers cost by 18 months but does not reduce it — the national phase is where the bill arrives, and it scales with the number of countries.',
    'The cheapest way to overspend is to file before searching: an application drafted around art you had not found is money spent on a claim you cannot keep.',
  ],
  faqs: [
    {
      question: 'Can I file a patent myself and skip the attorney fee?',
      answer:
        'Legally, yes — inventors may file pro se at the USPTO and file in their own name at most offices. In practice the specification and claims are a legal instrument written to be read by an examiner and, later, by a court, and self-drafted applications are frequently granted with claims so narrow that competitors design around them in an afternoon. A common middle path is to do the searching and disclosure work yourself and pay a professional for the claims and prosecution.',
    },
    {
      question: 'Why is a software patent more expensive than a mechanical one?',
      answer:
        'Two reasons. Drafting takes longer because the invention has to be described as a concrete technical implementation rather than as a result, which is the difference between surviving and failing a subject-matter eligibility challenge. And prosecution is longer: software applications draw more rejections on average, and each round of response is billable time.',
    },
    {
      question: 'What is the cheapest legitimate way to get a filing date?',
      answer:
        'A provisional application in the US (from $130 in official fees for a micro entity) or a provisional specification in India (₹1,600 for a natural person, startup or small entity) secures a priority date for twelve months. It is only as strong as what it discloses, though — a placeholder that does not describe the invention in enough detail will not support the claims you file later.',
    },
    {
      question: 'Do I have to pay for a patent in every country separately?',
      answer:
        'Yes. There is no world patent. The PCT gives you a single international application and up to 30 or 31 months before you must commit, but you then pay filing, translation and attorney fees in each country or region you enter. That is why most applicants narrow to two or three markets before the national phase.',
    },
    {
      question: 'How much should I budget for the whole 20-year life of a patent?',
      answer:
        'For a single US patent with no foreign filings, $25,000–$35,000 across the full term is a realistic planning figure for a large entity — prosecution plus the three maintenance fee payments. For a family covering the US, Europe and two other markets, six figures over 20 years is normal, mostly in European validation and annuities.',
    },
  ],
  focusKeyword: 'patent cost',
  secondaryKeywords: [
    'how much does a patent cost',
    'patent filing fees 2026',
    'uspto fees',
    'patent cost india',
    'pct filing cost',
  ],
  tags: ['costs', 'uspto', 'india', 'pct', 'budgeting'],
  jurisdictions: ['US', 'IN', 'EP', 'PCT'],
  seoTitle: 'How much does a patent cost in 2026? Full fee breakdown',
  seoDescription:
    'What a patent really costs in 2026: USPTO, Indian and EPO official fees, typical attorney fees, PCT costs and 20-year maintenance — with the numbers, by jurisdiction.',
  relatedSlugs: ['how-long-does-a-patent-take', 'provisional-vs-complete-specification', 'pct-national-phase-deadlines'],
  content: `
<p>Patent cost is the first question almost every inventor asks and the one that gets the least honest answer. Quotes range from "a few hundred dollars" (a provisional you filed yourself, which may protect nothing) to "six figures" (an international portfolio). Both are real numbers describing completely different purchases.</p>

<p>This article breaks the cost into the four buckets that actually appear on invoices — official fees, drafting, prosecution and renewals — for the four routes most applicants use. All figures were checked against official fee schedules in July 2026; offices adjust fees annually, so verify anything you are about to spend against the live schedule linked in each section.</p>

<h2>What does a patent cost end to end?</h2>

<p>The short version, for one patent of moderate complexity taken from disclosure to grant:</p>

<table>
  <thead>
    <tr><th>Route</th><th>Official fees</th><th>Professional fees</th><th>Typical total to grant</th></tr>
  </thead>
  <tbody>
    <tr><td>US utility (large entity)</td><td>~$5,100 incl. issue fee</td><td>$8,000–$15,000</td><td><strong>$13,000–$20,000</strong></td></tr>
    <tr><td>US utility (micro entity)</td><td>~$1,030 incl. issue fee</td><td>$6,000–$12,000</td><td><strong>$7,000–$13,000</strong></td></tr>
    <tr><td>India (natural person / startup / small entity)</td><td>₹6,000–₹10,000</td><td>₹50,000–₹1,90,000</td><td><strong>₹60,000–₹2,00,000</strong></td></tr>
    <tr><td>European patent (EPO, to grant)</td><td>~€5,500–€6,500</td><td>€6,000–€12,000</td><td><strong>€12,000–€18,000</strong></td></tr>
    <tr><td>PCT + three national phases</td><td>Varies by country</td><td>Varies by country</td><td><strong>$35,000–$60,000</strong></td></tr>
  </tbody>
</table>

<p>Two things fall out of that table immediately. First, government fees are the smaller half of the bill nearly everywhere except India. Second, the spread within each row is enormous, and it is driven almost entirely by how complex the invention is and how many rounds of argument the examiner puts you through.</p>

<h2>What are the official patent office fees in 2026?</h2>

<h3>United States (USPTO)</h3>

<p>The USPTO charges in three stages: filing, issue and maintenance. Entity size matters enormously — small and micro entity discounts are among the largest available at any patent office. As of the 2026 schedule:</p>

<table>
  <thead>
    <tr><th>Fee</th><th>Large entity</th><th>Small entity</th><th>Micro entity</th></tr>
  </thead>
  <tbody>
    <tr><td>Basic filing fee</td><td>$1,820</td><td>$910</td><td>$364</td></tr>
    <tr><td>Search fee</td><td>$700</td><td>$350</td><td>$140</td></tr>
    <tr><td>Examination fee</td><td>$800</td><td>$400</td><td>$160</td></tr>
    <tr><td><strong>Total at filing</strong></td><td><strong>$3,320</strong></td><td><strong>$1,660</strong></td><td><strong>$664</strong></td></tr>
    <tr><td>Issue fee (on allowance)</td><td>$1,820</td><td>$910</td><td>$364</td></tr>
  </tbody>
</table>

<p>To qualify as a <em>small entity</em> you generally need fewer than 500 employees and no obligation to assign to a large entity. <em>Micro entity</em> status adds an income cap and a limit on how many previous applications you have filed. Claiming a discount you are not entitled to is a serious problem, not a paperwork error — check the criteria in the <a href="https://www.uspto.gov/learning-and-resources/fees-and-payment/uspto-fee-schedule">USPTO fee schedule</a> before you claim it.</p>

<p>Then there are the fees nobody budgets for: excess claim fees beyond 20 claims (or 3 independent claims), extension of time fees when a response slips past its deadline, and the Request for Continued Examination fee when prosecution runs long. On a contested application these can add several thousand dollars.</p>

<h3>India (Indian Patent Office)</h3>

<p>India is the cheapest major jurisdiction to file in by a wide margin, and it has an unusually generous discount category: natural persons, startups, small entities and educational institutions all pay the same reduced rate.</p>

<table>
  <thead>
    <tr><th>Fee (e-filing)</th><th>Natural person / startup / small entity</th><th>Large entity</th></tr>
  </thead>
  <tbody>
    <tr><td>Application (up to 30 pages, 10 claims)</td><td>₹1,600</td><td>₹8,000</td></tr>
    <tr><td>Request for examination (Form 18)</td><td>₹4,000</td><td>₹20,000</td></tr>
    <tr><td>Early publication (Form 9, optional)</td><td>₹2,500</td><td>₹12,500</td></tr>
  </tbody>
</table>

<p>Note the paper-filing penalty: filing on paper costs 10% more than e-filing across the board, so essentially nobody files on paper. Excess page and excess claim fees apply above 30 pages and 10 claims respectively, which is a real constraint — an application translated from a US parent will often exceed both. Current amounts are published by the <a href="https://ipindia.gov.in/">Office of the Controller General of Patents, Designs and Trade Marks</a>.</p>

<p>The gap between official fees and professional fees is starkest here: ₹6,000 of government fees against ₹50,000–₹1,90,000 of attorney time is entirely normal. Anyone quoting you a total of ₹15,000 for a complete specification is quoting for a document, not for the work of making a defensible one.</p>

<h3>European Patent Office</h3>

<p>The EPO raised most fees on 1 April 2026 by roughly 5%. The headline numbers for a straightforward application:</p>

<table>
  <thead>
    <tr><th>Fee</th><th>Amount (from 1 April 2026)</th></tr>
  </thead>
  <tbody>
    <tr><td>European search fee</td><td>€1,595</td></tr>
    <tr><td>Examination fee</td><td>€2,010</td></tr>
    <tr><td>Designation fee (covers all states)</td><td>€720</td></tr>
    <tr><td>Grant fee</td><td>€1,135</td></tr>
    <tr><td>Excess claims fee (16th–50th claim, each)</td><td>€290</td></tr>
  </tbody>
</table>

<p>Add renewal fees payable to the EPO from the third year onwards, and — the part that surprises people — <strong>validation costs after grant</strong>. A European patent is not a single unitary right unless you opt into the Unitary Patent; classically you validate it country by country, each with its own translation and local agent fees. Validating in eight countries can cost more than the entire examination did. Current amounts are on the <a href="https://www.epo.org/">EPO</a> site.</p>

<h3>PCT (international application)</h3>

<p>The PCT is not a patent. It is an 18-month option to decide where you want patents, and it has its own fee layer: an international filing fee of CHF 1,330 for the first 30 pages (reduced by CHF 100–300 for electronic filing), a transmittal fee to your receiving office, and a search fee that varies by which International Searching Authority you choose — from roughly CHF 200 (some national offices) to over CHF 2,000 for the EPO. WIPO publishes the current <a href="https://www.wipo.int/pct/en/">PCT fee tables</a>, and applicants from certain countries qualify for a 90% reduction.</p>

<h2>What do attorneys actually charge?</h2>

<p>This is where the money goes. Typical 2026 ranges for drafting and filing a complete application:</p>

<table>
  <thead>
    <tr><th>Invention type</th><th>US attorney fee</th><th>Indian attorney fee</th></tr>
  </thead>
  <tbody>
    <tr><td>Simple mechanical / consumer product</td><td>$6,000–$9,000</td><td>₹40,000–₹70,000</td></tr>
    <tr><td>Electronics / moderate software</td><td>$9,000–$14,000</td><td>₹70,000–₹1,20,000</td></tr>
    <tr><td>Complex software, AI, biotech, chemistry</td><td>$12,000–$20,000+</td><td>₹1,20,000–₹2,50,000</td></tr>
  </tbody>
</table>

<p>Prosecution is billed on top, usually per office action. Budget $2,000–$4,000 per substantive US response and expect one to three of them; India's First Examination Report typically draws one substantive response costing ₹25,000–₹60,000. An application that sails through with a single easy amendment and one that grinds through three rejections and an appeal can differ by $15,000 on identical technology.</p>

<h2>What does it cost to keep a patent alive?</h2>

<p>Grant is not the end of the spending. Every major office charges to keep the right in force, and the fees escalate deliberately — the system is designed to make you abandon patents you are not using.</p>

<table>
  <thead>
    <tr><th>Jurisdiction</th><th>When</th><th>Approximate cost (large entity)</th></tr>
  </thead>
  <tbody>
    <tr><td>US</td><td>3.5 years</td><td>$2,150</td></tr>
    <tr><td>US</td><td>7.5 years</td><td>$4,040</td></tr>
    <tr><td>US</td><td>11.5 years</td><td>$8,280</td></tr>
    <tr><td>India</td><td>Annually from year 3</td><td>₹800–₹8,000 per year, rising with term</td></tr>
    <tr><td>Europe</td><td>Annually, per validated country</td><td>€100–€1,700 per country per year, rising</td></tr>
  </tbody>
</table>

<p>Small and micro entities pay substantially reduced US maintenance fees; the discount differs by fee type, so check the schedule rather than assuming a flat percentage. Miss a payment and the patent lapses — reinstatement is possible in limited circumstances and is never cheap.</p>

<h2>Where do patent budgets actually go wrong?</h2>

<p>In our experience of watching applications through the studio, overruns cluster in five places:</p>

<ul>
  <li><strong>Filing before searching.</strong> The single most expensive mistake. You pay to draft, file and prosecute an application around claims that a €0 database search would have shown were already taken. See <a href="/blog/how-to-do-a-prior-art-search">how to run a prior-art search properly</a>.</li>
  <li><strong>A weak provisional.</strong> A twelve-month priority date is worthless if the provisional does not actually describe what you later claim. You pay twice and get one filing date. We cover the trade-off in <a href="/blog/provisional-vs-complete-specification">provisional vs complete specification</a>.</li>
  <li><strong>Claim and page creep.</strong> Excess claim fees, excess page fees and multiple dependencies are individually small and collectively significant, especially when the same application is filed in five countries.</li>
  <li><strong>Filing everywhere.</strong> Entering seven national phases because the technology "could" sell everywhere. Most portfolios would be better served by three markets and a bigger drafting budget.</li>
  <li><strong>Translation.</strong> Japan, China, Korea, Brazil and much of Europe need certified translations, at $0.15–$0.35 per word for technical text. A 12,000-word specification is a $2,000–$4,000 line item per language.</li>
</ul>

<h2>How do you spend less without owning a weaker patent?</h2>

<p>Cost control in patents is almost entirely about sequencing — deciding things in the right order so you never pay to draft around art you have not read.</p>

<ol>
  <li><strong>Search before you draft.</strong> A structured novelty search costs a fraction of a drafting engagement and changes what gets drafted. It also tells you when to walk away, which is the largest saving available.</li>
  <li><strong>Claim your entity discount.</strong> If you qualify as a micro entity in the US, the filing-stage difference is $2,656 on one application.</li>
  <li><strong>Use the provisional year deliberately.</strong> Not as a delay tactic, but to test the market and refine the invention so the complete specification claims what you actually built.</li>
  <li><strong>Keep the claim set inside the free allowance.</strong> 20 claims / 3 independents in the US; 10 claims in India. Extra claims should earn their fee.</li>
  <li><strong>Narrow the country list before the national phase.</strong> The PCT exists to let you defer this decision until you have real commercial evidence. Use it that way — see <a href="/blog/pct-national-phase-deadlines">the national phase deadline map</a>.</li>
  <li><strong>Prepare the office action response properly the first time.</strong> A well-argued first response costs less than two mediocre ones. <a href="/blog/how-to-respond-to-an-office-action">Responding to an office action</a> covers the anatomy.</li>
</ol>

<aside class="note"><strong>A word on "cheap patents".</strong> Fixed-fee offers well below the ranges above exist, and some are honest — usually because the work is templated or offshored. What you are buying at that price is a filing, not a strategy. If the patent matters commercially, the drafting is not the place to economise; the country list is.</aside>

<h2>So what should you budget?</h2>

<p>If you need one number to take to a board meeting: <strong>$15,000 for a single US patent through to grant, $50,000 for a small international family covering the US, Europe and one other market, and 30–40% of that again across the following decade in renewals.</strong> For an India-first filing strategy, ₹1,50,000 for the first patent and ₹40,000–₹80,000 per year thereafter across a small portfolio is a realistic planning figure.</p>

<p>Whatever the number, spend it in the right order: understand the prior art, then draft narrowly enough to be granted and broadly enough to matter, then choose your countries with evidence rather than optimism.</p>
`,
}
