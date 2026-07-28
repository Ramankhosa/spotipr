import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'types-of-patent-search',
  categorySlug: 'prior-art-search',
  publishedDaysAgo: 41,
  title: 'Patentability, FTO or invalidity: which patent search do you need?',
  subtitle:
    'Five searches, five different questions. Buying the wrong one is how companies end up with a clean report and an infringement letter.',
  excerpt:
    'A patentability search asks "can I patent this?". A freedom-to-operate search asks "can I sell this?". They use different databases, different scopes and different logic — and one cannot answer the other’s question.',
  answerSummary:
    'Use a patentability (novelty) search before filing, to see whether your invention is new. Use a freedom-to-operate search before launching a product, to see whether you infringe live patents in your markets. Use an invalidity search when you need to attack a specific patent. They are different searches: patentability looks at all disclosures worldwide regardless of expiry, while FTO looks only at in-force claims in your target countries.',
  keyTakeaways: [
    'A patentability search and a freedom-to-operate search answer opposite questions and cannot substitute for one another — a clean patentability report says nothing about whether your product infringes.',
    'Patentability considers every public disclosure ever made, anywhere, including expired patents; FTO considers only unexpired, in-force patents in the countries where you will make, use or sell.',
    'FTO reads granted claims against your actual product; patentability reads whole disclosures against your invention concept.',
    'Invalidity (or "knock-out") searches are the most exhaustive and expensive, because a single overlooked document undermines the whole exercise.',
    'A landscape search maps a whole technology area for strategic decisions — where to invest, who is filing, where the whitespace is — and is not a legal clearance of anything.',
    'Cost tracks scope, not effort: expect roughly $500–$1,500 for a knock-out search, $1,500–$3,000 for a full patentability search, and $5,000–$15,000+ for a defensible FTO across several markets.',
  ],
  faqs: [
    {
      question: 'If my patentability search came back clean, can I launch the product?',
      answer:
        'No, and this is the single most expensive misunderstanding in the field. A patentability search tells you your invention appears new enough to patent. Your product almost certainly also contains dozens of features you did not invent, any of which may be covered by someone else’s live patent. Clearance to sell requires a freedom-to-operate search against granted claims in your target markets.',
    },
    {
      question: 'Does an expired patent matter?',
      answer:
        'It depends entirely on the question. For patentability, yes — an expired patent is fully effective prior art and can destroy novelty. For freedom to operate, no — an expired patent cannot be infringed, and its disclosure is free for anyone to use. This asymmetry is why the two searches have different databases and different date filters.',
    },
    {
      question: 'How long is a freedom-to-operate search valid for?',
      answer:
        'Treat it as a snapshot with a short shelf life. Applications publish 18 months after filing, so on any given day there are pending applications you cannot see that may grant into claims covering your product. Best practice is an initial FTO before design freeze, an update before launch, and periodic monitoring of key competitors thereafter.',
    },
    {
      question: 'Can one search cover several countries?',
      answer:
        'For patentability, effectively yes — prior art is global, so one search serves every jurisdiction (subject to local grace-period differences). For FTO, no. Patents are national rights, so an FTO search must be run separately for each country where you will manufacture, import, sell or use, and the answer genuinely differs between them.',
    },
    {
      question: 'What is a knock-out search?',
      answer:
        'A quick, deliberately shallow search — typically two to four hours — whose only purpose is to find an obvious blocker before you spend real money. It is the cheapest useful search there is. It cannot tell you that something is patentable; it can only tell you when something clearly is not.',
    },
  ],
  focusKeyword: 'patent search',
  secondaryKeywords: [
    'types of patent search',
    'freedom to operate search',
    'patentability search',
    'invalidity search',
    'fto vs patentability',
    'patent landscape analysis',
  ],
  tags: ['prior-art', 'fto', 'search-strategy', 'due-diligence'],
  jurisdictions: ['US', 'EP', 'IN', 'PCT'],
  seoTitle: 'Which patent search do you need? Patentability vs FTO',
  seoDescription:
    'The five patent search types compared: what question each answers, which databases and date filters each uses, what each costs, and when in a project to run it.',
  relatedSlugs: ['how-to-do-a-prior-art-search', 'patent-cost', 'how-to-write-patent-claims'],
  content: `
<p>"Patent search" describes at least five different exercises that share a database and nothing else. They ask different questions, apply different date rules, look at different parts of the document, and cost between $500 and $50,000. Buying the wrong one is routine, and the failure mode is specific and painful: a company gets a clean patentability report, reads it as permission to launch, and receives a cease-and-desist eighteen months later.</p>

<h2>The five patent search types at a glance</h2>

<table>
  <thead>
    <tr><th>Search</th><th>Question it answers</th><th>Looks at</th><th>Scope</th><th>Typical cost</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Knock-out</strong></td>
      <td>Is there an obvious blocker?</td>
      <td>Everything, quickly</td>
      <td>Global, 2–4 hours</td>
      <td>$300–$1,500</td>
    </tr>
    <tr>
      <td><strong>Patentability / novelty</strong></td>
      <td>Can I patent this?</td>
      <td>Whole disclosures, any age</td>
      <td>Global, all time</td>
      <td>$1,500–$3,000</td>
    </tr>
    <tr>
      <td><strong>Freedom to operate</strong></td>
      <td>Can I sell this without infringing?</td>
      <td>Granted claims only</td>
      <td>Per country, in-force only</td>
      <td>$5,000–$15,000+</td>
    </tr>
    <tr>
      <td><strong>Invalidity</strong></td>
      <td>Can I kill this specific patent?</td>
      <td>Anything predating its priority</td>
      <td>Global, exhaustive</td>
      <td>$8,000–$50,000</td>
    </tr>
    <tr>
      <td><strong>Landscape</strong></td>
      <td>Who is doing what, and where is the gap?</td>
      <td>Aggregate filing data</td>
      <td>A technology field</td>
      <td>$5,000–$30,000</td>
    </tr>
  </tbody>
</table>

<h2>Patentability search — "is my invention new?"</h2>

<p><strong>Run it:</strong> before drafting, or during the provisional year at the latest.</p>

<p>A patentability search looks for anything, anywhere, published before your priority date that discloses your invention. It reads the <em>entire</em> document, not just the claims: a feature buried in paragraph 47 of an abandoned 1998 application destroys novelty exactly as effectively as a granted claim.</p>

<p>The two rules that catch people out:</p>

<ul>
  <li><strong>Expiry is irrelevant.</strong> A patent from 1974 is still prior art.</li>
  <li><strong>Geography is irrelevant.</strong> A Japanese utility model nobody has ever cited counts. So does a Portuguese-language thesis.</li>
</ul>

<p>The output should be a feature-by-feature matrix, not a pile of PDFs — which of your features each document discloses, so you can see immediately whether anything anticipates you outright and where your actual point of novelty lies. That matrix is the input to claim drafting; the method is in <a href="/blog/how-to-do-a-prior-art-search">how to run a prior-art search</a>.</p>

<h2>Freedom-to-operate search — "can I sell this?"</h2>

<p><strong>Run it:</strong> before design freeze, and again before launch.</p>

<p>FTO inverts nearly every rule of a patentability search:</p>

<table>
  <thead>
    <tr><th></th><th>Patentability</th><th>Freedom to operate</th></tr>
  </thead>
  <tbody>
    <tr><td>Subject</td><td>Your invention (the new bit)</td><td>Your whole product (every feature)</td></tr>
    <tr><td>Reads</td><td>Entire disclosure</td><td>Granted claims only</td></tr>
    <tr><td>Date filter</td><td>Anything before your priority date</td><td>Only patents still in force</td></tr>
    <tr><td>Geography</td><td>Worldwide</td><td>Only your target countries</td></tr>
    <tr><td>Includes expired patents?</td><td>Yes</td><td>No — expired means free to use</td></tr>
    <tr><td>Answer format</td><td>Novel / not novel</td><td>Risk assessment per claim, per country</td></tr>
  </tbody>
</table>

<p>The critical shift is from "my invention" to "my product". You invented one thing; you are shipping a hundred. The connector, the housing, the calibration routine, the update mechanism — each is somebody's patent somewhere, and infringement does not care that you invented the interesting part independently.</p>

<p>FTO also has to account for pending applications. Applications publish at 18 months, so there is always a submarine window of filings you cannot see. A good FTO report says so explicitly and flags applications whose claims, if granted as filed, would be a problem.</p>

<h2>Invalidity search — "can this patent be killed?"</h2>

<p><strong>Run it:</strong> when you have received an infringement allegation, are considering an opposition or IPR, or are performing acquisition due diligence.</p>

<p>Also called a validity search, and the most demanding patent search of the five. You have one target patent and one goal: find something published before <em>its</em> priority date that anticipates or renders obvious its claims. This is the most exhaustive search type because completeness is the whole point — the document you missed is the document the other side will find.</p>

<p>Expect non-English sources, obscure conference proceedings, product manuals, standards drafts and archived websites. Expect the search to cost more than the patentability search that produced the patent in the first place.</p>

<h2>Landscape analysis — "where is the whitespace?"</h2>

<p><strong>Run it:</strong> when setting R&D direction, evaluating a market, or preparing an investment case.</p>

<p>A landscape does not clear anything legally. It maps a field: who is filing, in which subdomains, at what rate, in which countries, and — the interesting part — which technically plausible combinations nobody has filed on. It is a strategy instrument, and it answers questions patentability and FTO cannot: is this field crowding? Is our main competitor pivoting? Where could we file that nobody has fenced off?</p>

<h2>Which do you need, and when?</h2>

<table>
  <thead>
    <tr><th>Your situation</th><th>The search</th></tr>
  </thead>
  <tbody>
    <tr><td>"I have an idea and £2,000 to spend"</td><td>Knock-out, then patentability if it survives</td></tr>
    <tr><td>"I am about to instruct an attorney to draft"</td><td>Patentability</td></tr>
    <tr><td>"We ship in six months"</td><td>Freedom to operate, in each launch market</td></tr>
    <tr><td>"We received a cease-and-desist"</td><td>Invalidity against the asserted claims, plus a non-infringement analysis</td></tr>
    <tr><td>"We are acquiring a company for its patents"</td><td>Invalidity on the key assets, plus landscape for context</td></tr>
    <tr><td>"Where should R&D go next?"</td><td>Landscape</td></tr>
    <tr><td>"An examiner cited three documents at us"</td><td>Targeted search around the cited art — see <a href="/blog/how-to-respond-to-an-office-action">responding to an office action</a></td></tr>
  </tbody>
</table>

<aside class="note"><strong>The sequencing that saves money.</strong> Knock-out before you invest attention. Patentability before you invest in drafting. FTO before you invest in tooling and inventory. Each search is cheap relative to the commitment it protects — and each is worthless if run after the commitment is already made.</aside>

<p>Official collections worth searching directly rather than through an aggregator include the <a href="https://ppubs.uspto.gov/pubwebapp/">USPTO</a>, the <a href="https://www.epo.org/">EPO</a> and <a href="https://www.wipo.int/patentscope/en/">WIPO PATENTSCOPE</a> — coverage and legal-status data differ between them, which matters most for freedom-to-operate work.</p>

<h2>What should a patent search report actually contain?</h2>

<p>Whoever runs it, insist on four things. Without them you have a bibliography, not a search:</p>

<ol>
  <li><strong>The search strategy itself</strong> — queries, classification codes, databases and date of execution. Without this, the search cannot be reproduced, extended or defended.</li>
  <li><strong>A feature matrix</strong> mapping documents against your features or claim elements, rather than a ranked list of "relevance".</li>
  <li><strong>Stated limits</strong> — languages covered, jurisdictions, date ranges, and what was deliberately excluded.</li>
  <li><strong>A conclusion in the searcher's own words</strong>, distinguishing what the documents show from what the searcher infers.</li>
</ol>

<p>And be clear about the boundary between a search and an opinion. A searcher finds documents. Whether those documents make your claim obvious is a legal judgement, and in most jurisdictions only a qualified attorney or agent should be giving it — particularly for FTO, where the answer carries litigation risk and, in some countries, privilege consequences.</p>
`,
}
