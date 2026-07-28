import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'how-to-do-a-prior-art-search',
  categorySlug: 'prior-art-search',
  publishedDaysAgo: 33,
  title: 'How to do a patent prior art search (step by step)',
  subtitle:
    'A repeatable method for finding what already exists — using free databases, classification codes and citation trails — before you spend money on drafting.',
  excerpt:
    'The search method professionals actually use: decompose the invention into features, build synonym sets, work the CPC classification, follow citations both ways, and know when a free search has reached its limit.',
  answerSummary:
    'To run a prior art search, break your invention into its essential technical features, build a synonym set for each, search full text in Google Patents, Espacenet and the USPTO databases, then switch to CPC classification codes to catch documents that use different words. Follow citations forward and backward from the closest hits. A competent first-pass search takes four to eight hours and costs nothing but time.',
  keyTakeaways: [
    'Prior art is anything made available to the public anywhere before your filing date — patents, applications, papers, product manuals, YouTube videos, GitHub repositories and conference posters all count.',
    'Keyword search alone finds perhaps half of the relevant art, because patent attorneys deliberately use unusual vocabulary; classification search (CPC) is what finds the rest.',
    'Search by feature combination, not by product name. The question is never "has anyone made my product" but "has anyone disclosed this combination of technical features".',
    'The closest prior art is usually found by following citations from a moderately relevant patent, not from the initial keyword query.',
    'A free search is enough to make a go/no-go decision and to shape claim drafting; it is not enough for a freedom-to-operate opinion or a validity challenge.',
    'Document every query, database and date as you go — examiners, investors and, later, courts all ask what you looked at and when.',
  ],
  faqs: [
    {
      question: 'Is a prior art search legally required before filing?',
      answer:
        'No jurisdiction requires you to search before filing. However, in the US you have a duty of candour: anything material to patentability that you actually know about must be disclosed to the USPTO in an Information Disclosure Statement. That duty covers what you know, not what you failed to look for, but concealing known art can render a granted patent unenforceable.',
    },
    {
      question: 'Does my own published paper count as prior art against me?',
      answer:
        'Usually yes, unless a grace period applies. The US and India both give inventors a twelve-month grace period for their own disclosures; the EPO and China do not, so a paper published before filing generally destroys European novelty outright. Search your own publications, theses and conference abstracts first — self-collision is more common than people expect.',
    },
    {
      question: 'How far back should a prior art search go?',
      answer:
        'There is no cut-off. A 1974 patent that has long expired is still perfectly good prior art against a 2026 application — expiry affects enforceability, not disclosure. In mature mechanical fields the closest art is frequently decades old.',
    },
    {
      question: 'What is the difference between a search and a patentability opinion?',
      answer:
        'A search produces documents. An opinion is a professional judgement, usually written by a patent attorney or agent, on whether your invention is novel and inventive over those documents and what claim scope is realistically available. The search is the input; the opinion is what you actually make a filing decision on.',
    },
    {
      question: 'Can AI tools replace a manual prior art search?',
      answer:
        'They change the economics of the first pass substantially — semantic search finds conceptually similar documents that share no keywords, which is exactly where manual searching is weakest. What they do not replace is the judgement about which differences are technically meaningful, which is the part that determines whether a claim survives examination.',
    },
  ],
  focusKeyword: 'prior art search',
  secondaryKeywords: [
    'how to do a patent search',
    'patent search free',
    'google patents search',
    'espacenet',
    'cpc classification search',
  ],
  tags: ['prior-art', 'search-technique', 'novelty', 'free-tools'],
  jurisdictions: ['US', 'EP', 'IN', 'PCT'],
  seoTitle: 'How to do a patent prior art search — step by step guide',
  seoDescription:
    'A repeatable prior art search method using Google Patents, Espacenet and CPC classification: decompose features, build synonyms, follow citations, and know when to stop.',
  relatedSlugs: ['types-of-patent-search', 'patent-cost', 'how-to-write-patent-claims'],
  content: `
<p>Most patent money is wasted before a word is drafted, in the gap between "I think this is new" and "I have checked". A structured search closes that gap in a day or two and changes one of three things: whether you file at all, what you claim, or how you argue inventive step when the examiner cites something you had already seen and already have an answer for.</p>

<p>This is the method, in the order professionals run it.</p>

<h2>What counts as prior art in a prior art search?</h2>

<p>Broader than most inventors assume. Prior art is <strong>anything made available to the public, anywhere in the world, in any language, before your priority date.</strong> That includes:</p>

<ul>
  <li>Granted patents and published applications — from any country, expired or not, granted or abandoned</li>
  <li>Journal papers, conference proceedings, theses, preprints</li>
  <li>Product manuals, datasheets, catalogues, standards documents</li>
  <li>Websites, blog posts, forum threads, YouTube videos with a verifiable date</li>
  <li>Public GitHub repositories and their commit history</li>
  <li>Public use or sale of the product itself</li>
  <li><strong>Your own disclosures</strong>, subject to grace periods that exist in the US and India but not in Europe or China</li>
</ul>

<p>A published patent application that was later abandoned is still fully effective prior art. So is a patent in Japanese that nobody has ever cited. The system does not care whether the disclosure succeeded commercially; it cares whether it was available.</p>

<h2>Step 1 of the prior art search — decompose the invention into features</h2>

<p>Before touching a database, write your invention as a list of technical features and mark which are essential. Not "a smart irrigation controller", but:</p>

<ol>
  <li>A soil moisture sensor array</li>
  <li>Transmitting readings over a low-power wide-area network</li>
  <li>A model predicting irrigation need from readings <em>and</em> weather forecast data</li>
  <li>Valve actuation scheduled from the prediction</li>
  <li><strong>The distinguishing feature:</strong> the model retrains locally on the controller using observed soil response, without sending data to a server</li>
</ol>

<p>This list is the search plan. Features 1–4 individually are certainly known — searching for them wastes the day. The searches that matter are combinations, and above all combinations involving feature 5. If you cannot identify a feature 5, you have a search problem <em>and</em> a patentability problem, and it is better to discover that now.</p>

<h2>Step 2 — Build synonym sets</h2>

<p>Patent drafters choose unusual words deliberately: your "drone" is somebody's "unmanned aerial vehicle", "rotorcraft" or "autonomous aerial platform". Build three to six alternatives per feature before searching, including:</p>

<ul>
  <li>The formal/academic term, the industry term, and the marketing term</li>
  <li>The generic form the drafter would have used to broaden the claim ("fastener" for "screw", "processing unit" for "GPU")</li>
  <li>The functional description ("means for retaining", "component configured to hold")</li>
  <li>British and American spellings</li>
</ul>

<h2>Step 3 — Run the keyword pass</h2>

<p>Three free databases, in this order:</p>

<table>
  <thead>
    <tr><th>Database</th><th>Best for</th><th>Note</th></tr>
  </thead>
  <tbody>
    <tr><td><a href="https://patents.google.com/">Google Patents</a></td><td>Fast full-text search across 100+ offices, machine-translated</td><td>Start here. Full text of most jurisdictions, plus non-patent literature via Scholar.</td></tr>
    <tr><td><a href="https://worldwide.espacenet.com/">Espacenet</a> (EPO)</td><td>Rigorous classification search and family data</td><td>The professional tool. Its classification browser is better than anything else free.</td></tr>
    <tr><td><a href="https://ppubs.uspto.gov/pubwebapp/">USPTO Patent Public Search</a></td><td>Authoritative US text and file histories</td><td>Read the prosecution history of close hits — the examiner already did some of your work.</td></tr>
  </tbody>
</table>

<p>WIPO's <a href="https://www.wipo.int/patentscope/en/">PATENTSCOPE</a> covers PCT applications and many national collections, and the <a href="https://www.epo.org/">EPO</a> publishes the classification definitions you will need in step 4. For Indian filings add <a href="https://ipindiaservices.gov.in/publicsearch/">IP India's public search</a>, which covers Indian applications not always well indexed elsewhere.</p>

<p>Search feature combinations with boolean operators, two or three features at a time, cycling through synonyms. Keep every query in a spreadsheet with date, database, and hit count. You will run 30–60 queries and you will not remember which by hour three.</p>

<h2>Step 4 — Switch to classification, which is where the real art is</h2>

<p>This is the step amateurs skip and it is the step that finds the killer document. Every patent is classified under the <strong>Cooperative Patent Classification</strong> (CPC), a hierarchical scheme assigned by examiners based on technical content, not vocabulary. It cuts straight through the synonym problem.</p>

<p>The method:</p>

<ol>
  <li>Find two or three patents from your keyword pass that are genuinely close.</li>
  <li>Read their CPC codes — typically several, e.g. <code>A01G25/16</code> (automatic watering control) or <code>G06N3/08</code> (neural network learning methods).</li>
  <li>Look those codes up in Espacenet's classification browser to see the sibling and parent groups. The definitions are worth reading in full.</li>
  <li>Search <em>within</em> those codes with far looser keywords — or simply browse. A group of 400 documents is a readable afternoon, and it is where the art that shares no vocabulary with you is hiding.</li>
  <li>Search the intersection of two codes when your invention sits between fields (irrigation control ∩ machine learning is a much smaller and much more relevant set than either alone).</li>
</ol>

<h2>Step 5 — Follow the citation trails in both directions</h2>

<p>Take your five closest documents and mine their citations:</p>

<ul>
  <li><strong>Backward citations</strong> — what the applicant and examiner cited. This is a curated bibliography of the field assembled by someone who had the same problem you do.</li>
  <li><strong>Forward citations</strong> — later patents citing this one. This is how you find what happened next, and it is usually where the closest art to a 2026 invention lives.</li>
  <li><strong>Same-family members</strong> — the same invention filed in other countries, sometimes with different claims and always with different examiners' search reports.</li>
  <li><strong>Same assignee, same inventor</strong> — companies patent in clusters, and inventors repeat themselves.</li>
</ul>

<p>In our experience this step, not the keyword pass, produces the document that ends up shaping the claims.</p>

<h2>Step 6 — Search the non-patent literature</h2>

<p>For software, AI and biotech, the closest art is frequently not a patent at all. Check Google Scholar, arXiv, IEEE Xplore, PubMed, relevant standards bodies, GitHub (with commit dates), and product documentation from the obvious commercial players. A dated arXiv preprint is prior art exactly as a granted patent is.</p>

<h2>Step 7 — Read properly, and record what the prior art search found</h2>

<p>Do not read only the abstract. For each close document:</p>

<ul>
  <li><strong>Read claim 1</strong> — that is what was actually granted, and it is often much narrower than the title suggests.</li>
  <li><strong>Read the description for your feature</strong>, even if it is not claimed. Disclosure defeats novelty whether or not it was claimed.</li>
  <li><strong>Note the date and jurisdiction.</strong></li>
  <li><strong>Record precisely which of your features it discloses</strong>, feature by feature, in a matrix: documents down the side, your features across the top.</li>
</ul>

<p>That matrix is the deliverable. Read across a row: if any single document has ticks in every column, you have a novelty problem. If two obvious-to-combine documents together cover every column, you have an inventive-step problem. If every document is missing feature 5, you have found your claim — and you already know what the examiner will cite.</p>

<aside class="note"><strong>When a free search is not enough.</strong> A self-run search is sufficient to decide whether to proceed and to shape claim drafting. It is not sufficient for a freedom-to-operate clearance (which needs live claims analysed against your actual product in specific markets) or for an invalidity challenge (which needs exhaustive, defensible coverage). <a href="/blog/types-of-patent-search">The different search types</a> explains what each one is for and what each costs.</aside>

<h2>How do you know when to stop?</h2>

<p>Three honest stopping conditions:</p>

<ol>
  <li><strong>Saturation.</strong> Your last ten queries and three classification browses returned nothing you had not already seen. This is the real signal.</li>
  <li><strong>Decision reached.</strong> You found art that plainly anticipates the invention. Stop — you have just saved a five-figure drafting bill, which is the search paying for itself.</li>
  <li><strong>Diminishing returns against the stakes.</strong> Four to eight hours is proportionate for a first filing decision. If the programme is worth millions, hand it to a professional searcher and pay for exhaustiveness.</li>
</ol>

<p>Whatever you find, keep the record. When the examiner's search report arrives eighteen months later citing three documents, the applicants who respond quickly and cheaply are the ones who already read two of them — and who drafted the claims knowing they existed. That is what <a href="/blog/how-to-write-patent-claims">claim drafting</a> looks like when it is done in the right order.</p>
`,
}
