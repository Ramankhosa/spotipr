import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'patent-whitespace-analysis',
  categorySlug: 'prior-art-search',
  publishedDaysAgo: 29,
  title: 'Patent whitespace analysis: find what nobody has claimed',
  subtitle:
    'A reproducible, claim-level method for finding real gaps in a patent landscape — and for telling a genuine opening from a cell that is empty for a reason.',
  excerpt:
    'Most whitespace maps count abstracts, which measures where people write, not what claims cover. Here is a defensible six-step method: a claim-level census, demand signals that separate real gaps from dead cells, and a worked hypothetical.',
  answerSummary:
    'Patent whitespace analysis locates areas of real technical and commercial activity where patent claim coverage is thin. Done defensibly, it is a claim-level census across a problems-by-approaches matrix, followed by demand-signal checks and a targeted patentability search on each candidate gap. Most published whitespace maps count abstracts instead of claims, which measures where applicants write rather than what is protected — the difference between a genuine gap and a vanity heatmap.',
  keyTakeaways: [
    'Patent whitespace is thin claim coverage in areas of real technical and commercial activity — not merely the empty cells on a landscape chart.',
    'Most published whitespace maps count abstracts or classification codes, which measures where applicants write rather than what their claims protect; a defensible analysis censuses independent claims.',
    'Every sparse cell has three possible explanations — genuine gap, impossible, or worthless — and only demand signals from papers, products and standards activity separate them.',
    'Claim coverage is jurisdiction-specific: a cell dense with US claims can be open at the EPO or in India, so census the offices where you would actually file.',
    'A candidate gap is a hypothesis until a targeted patentability search validates it, and every validated gap needs a written decision: file, publish defensively, or ignore.',
  ],
  faqs: [
    {
      question: 'What is the difference between patent landscape analysis and whitespace analysis?',
      answer:
        'A patent landscape analysis describes what exists: who files, where, in which technologies, trending in which direction. Whitespace analysis asks the inverse question — where credible technical and commercial activity is not matched by claim coverage. A landscape is the natural first step, but whitespace work adds two things a landscape lacks: a claim-level census instead of document counts, and validation of each candidate gap against demand signals and a targeted patentability search.',
    },
    {
      question: 'Can a whitespace analysis tell me what to invent?',
      answer:
        'No — it tells you where an invention would be valuable if you can make one. The analysis locates cells where demand exists and claims are thin; whether you can produce something novel and inventive in that cell is a separate engineering question, and the result still has to clear a patentability search. Treat the output as a targeting brief for R&D and filing strategy, not as a list of free inventions waiting to be collected.',
    },
    {
      question: 'Does an empty cell in the matrix mean the idea is patentable?',
      answer:
        'No. Prior art is not limited to patents: an academic paper, a conference demo, a shipped product or any other public disclosure can defeat novelty even where no claims exist. An empty cell means nobody has fenced the area with claims — someone may still have published the idea, or the cell may be empty because the approach fails. That is why every candidate gap gets a dedicated patentability search before any filing decision.',
    },
    {
      question: 'Which jurisdictions should a whitespace census cover?',
      answer:
        'The offices where you would actually file or actually face competitors — for most technology companies that starts with the US, the EPO and increasingly India. Claim coverage differs materially between them: the same family often carries broad claims in one office and narrow ones in another, and eligibility practice changes which software claims survive at all. A census that pools every jurisdiction into one count hides exactly the openings you are looking for.',
    },
    {
      question: 'Should expired and abandoned patents be included in the census?',
      answer:
        'Yes, separately marked. Expired and lapsed families are free to build on — their teaching remains prior art but no longer blocks practice — and a cluster of early, abandoned filings in a sparse cell is a demand signal in itself: the idea may have arrived before its market rather than being wrong. Live claims answer the freedom-to-operate question; dead ones answer the timing question. A census that drops them loses both answers.',
    },
  ],
  focusKeyword: 'patent whitespace analysis',
  secondaryKeywords: [
    'patent landscape analysis',
    'patent white space mapping',
    'technology gap analysis patents',
    'find unpatented ideas',
  ],
  tags: ['whitespace', 'landscape', 'strategy', 'searching'],
  jurisdictions: ['US', 'EP', 'IN'],
  seoTitle: 'Patent whitespace analysis: find what nobody has claimed',
  seoDescription:
    'A reproducible method for patent whitespace analysis: claim-level coverage census, demand signals that separate real gaps from dead cells, and a worked example.',
  relatedSlugs: ['how-to-do-a-prior-art-search', 'types-of-patent-search', 'granted-software-patent-claims-india'],
  content: `
<p>Every technology landscape deck ends the same way: a heatmap, an empty region, and an arrow labelled opportunity. Most of those maps are built by counting abstracts, which measures where people write, not what their claims cover — and the gap between those two things is where consulting money goes to die. Patent whitespace analysis, done defensibly, is different work: a claim-level census of a technology space, crossed with evidence of real demand, that tells you where protection is thin and whether the thinness means anything. This article sets out that method end to end, in a form you can reproduce and audit.</p>

<h2>What is patent whitespace analysis?</h2>

<p>Whitespace is not the empty part of a chart. It is the set of areas where real technical and commercial activity exists but claim coverage is thin — problems people demonstrably care about, addressed by approaches nobody has effectively fenced. The distinction matters because any honest technology matrix is mostly empty cells, and almost all of them are empty for a good reason. Patent whitespace analysis is the discipline of finding the exceptions: cells that are empty and shouldn’t be.</p>

<p>The output is not a heatmap either. It is a short list of candidate gaps, each carrying the evidence for why the cell is genuinely open and a decision attached: file into it, publish defensively to keep it open, or ignore it.</p>

<h2>Why are most whitespace maps misleading?</h2>

<p>Because they count the wrong thing. The typical patent landscape analysis buckets documents by classification code or abstract keywords, then shades cells by count. That measures drafting fashion — where applicants position their language — not protection. A cell can show two hundred documents whose claims, read closely, all cover one narrow mechanism and leave the rest of the cell open; another can show a dozen documents whose independent claims blanket it completely. Abstract-counting calls the first cell crowded and the second sparse, and is wrong both times.</p>

<p>White space read off a document-count heatmap also produces two systematic false positives. Empty-because-impossible: nobody has claimed the cell because physics, cost or regulation kills it. Empty-because-worthless: the cell is achievable and nobody wants what is in it. Both look identical to a genuine gap on the map, and no amount of colour grading fixes that — only demand evidence from outside the patent corpus does. Any patent white space mapping exercise that never leaves the patent database cannot tell these three cases apart, which is why so many landscape reports end careers rather than start products.</p>

<h2>How do you run a defensible whitespace analysis?</h2>

<p>A defensible patent whitespace analysis runs in six steps, each checkable by a sceptical colleague:</p>

<ol>
  <li><strong>Define the domain and build a two-axis taxonomy.</strong> Rows are the problems the industry is actually trying to solve; columns are the technical approaches available to solve them. Four to eight of each, sourced from engineers and product roadmaps rather than from classification labels — the taxonomy is where most analyses silently fail, because a lazy taxonomy reproduces the classification scheme and finds nothing the scheme doesn’t already show.</li>
  <li><strong>Build a query set per cell.</strong> Combine classification codes — CPC, maintained jointly by the <a href="https://www.epo.org/">EPO</a> and the USPTO, and the IPC administered by <a href="https://www.wipo.int/">WIPO</a> — with keyword variants and semantic queries, so each cell is found by meaning as well as vocabulary. The mechanics are the same as in <a href="/blog/how-to-do-a-prior-art-search">a prior-art search</a>, run once per cell instead of once per invention.</li>
  <li><strong>Census claim-level coverage, not abstract mentions.</strong> For each cell, the question is how many patent families have at least one independent claim that actually covers the cell’s combination — not how many documents mention it somewhere. This is slower, and it is the entire point. Coverage is also jurisdiction-specific: a cell dense with US claims can be open in Europe or India, and claim style differs by office — see <a href="/blog/granted-software-patent-claims-india">what granted software claims in India look like</a> for how differently the same protection reads.</li>
  <li><strong>Separate true gaps from dead cells with demand signals.</strong> For each sparse cell, look outside the patent corpus: research papers, shipping products, standards-body activity, regulatory pressure. Activity without matching claims is the signature of a real gap; silence everywhere is a dead cell.</li>
  <li><strong>Validate each candidate with a targeted patentability search.</strong> A sparse census cell is a hypothesis, not a result — the cell may be covered by claims your queries missed, or by non-patent prior art. Run a focused <a href="/blog/types-of-patent-search">patentability search</a> on the specific combination before anyone spends money on it.</li>
  <li><strong>Decide, in writing.</strong> For each validated gap: file (you can practise and claim it), publish defensively (you want it to stay unowned), or ignore (real, but not yours to win). A whitespace analysis without decisions attached is a poster.</li>
</ol>

<p>One disclosure, since we sell in this category: the claim-level census above is what our <a href="/whitespace">whitespace tool</a> runs against real claim corpora. The method works by hand — the tool changes what the census costs, not the logic.</p>

<h2>A worked example — explicitly hypothetical</h2>

<p>Everything in this section is invented to show the method; the matrix, the counts and the gap are illustrative, not a report on the real EV battery landscape. Suppose the domain is EV battery thermal management. Rows — the problems: cell balancing under load, thermal runaway detection, fast-charge heat rejection, cold-start performance. Columns — the approaches: immersion cooling, phase-change materials, predictive ML control, refrigerant loops.</p>

<p>Suppose the census comes back as in Fig. 1. The fast-charge row is dense everywhere — heat rejection at charging speed is where the filing arms race lives — and predictive ML control is well covered down the whole column. One cell stands out: cold-start performance crossed with phase-change materials is nearly empty at claim level, while the demand check from step 4 finds thermal-modelling papers on pre-conditioning and product teams shipping resistive pre-heaters they publicly complain about. Activity without claims: a candidate gap.</p>

<p>Step 5 is what separates the analysis from the poster. A targeted patentability search on that one combination might find the cell genuinely open; might surface a lapsed early family whose teaching is now free to build on but bars the broadest claim; or might turn up an academic disclosure that kills novelty for the obvious formulation and pushes you toward a narrower, better invention. In the hypothetical, all three endings are useful — which is exactly why you validate before spending.</p>

<figure><svg viewBox="0 0 760 470" role="img" aria-label="Hypothetical whitespace matrix crossing four battery thermal management problems with four cooling approaches, with one sparsely claimed cell outlined as a candidate gap" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif"><title>Hypothetical whitespace matrix crossing four battery thermal management problems with four cooling approaches, with one sparsely claimed cell outlined as a candidate gap</title>
<text x="240" y="34" font-size="13" fill="#344054" text-anchor="middle">Immersion</text><text x="240" y="50" font-size="13" fill="#344054" text-anchor="middle">cooling</text>
<text x="385" y="34" font-size="13" fill="#344054" text-anchor="middle">Phase-change</text><text x="385" y="50" font-size="13" fill="#344054" text-anchor="middle">materials</text>
<text x="530" y="34" font-size="13" fill="#344054" text-anchor="middle">Predictive</text><text x="530" y="50" font-size="13" fill="#344054" text-anchor="middle">ML control</text>
<text x="675" y="34" font-size="13" fill="#344054" text-anchor="middle">Refrigerant</text><text x="675" y="50" font-size="13" fill="#344054" text-anchor="middle">loops</text>
<text x="158" y="102" font-size="13" fill="#344054" text-anchor="end">Cell balancing</text>
<text x="158" y="166" font-size="13" fill="#344054" text-anchor="end">Thermal runaway</text><text x="158" y="182" font-size="13" fill="#344054" text-anchor="end">detection</text>
<text x="158" y="246" font-size="13" fill="#344054" text-anchor="end">Fast-charge heat</text>
<text x="158" y="310" font-size="13" fill="#344054" text-anchor="end">Cold-start</text><text x="158" y="326" font-size="13" fill="#344054" text-anchor="end">performance</text>
<rect x="170" y="66" width="140" height="64" rx="8" fill="#e4e7ec" stroke="#e4e7ec"/><circle cx="228" cy="98" r="4" fill="#667085"/><circle cx="240" cy="98" r="4" fill="#667085"/><circle cx="252" cy="98" r="4" fill="#667085"/>
<rect x="315" y="66" width="140" height="64" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="385" cy="98" r="4" fill="#98a2b3"/>
<rect x="460" y="66" width="140" height="64" rx="8" fill="#e4e7ec" stroke="#e4e7ec"/><circle cx="512" cy="98" r="4" fill="#667085"/><circle cx="524" cy="98" r="4" fill="#667085"/><circle cx="536" cy="98" r="4" fill="#667085"/><circle cx="548" cy="98" r="4" fill="#667085"/>
<rect x="605" y="66" width="140" height="64" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="675" cy="98" r="4" fill="#98a2b3"/>
<rect x="170" y="138" width="140" height="64" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="234" cy="170" r="4" fill="#98a2b3"/><circle cx="246" cy="170" r="4" fill="#98a2b3"/>
<rect x="315" y="138" width="140" height="64" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="385" cy="170" r="4" fill="#98a2b3"/>
<rect x="460" y="138" width="140" height="64" rx="8" fill="#e4e7ec" stroke="#e4e7ec"/><circle cx="512" cy="170" r="4" fill="#667085"/><circle cx="524" cy="170" r="4" fill="#667085"/><circle cx="536" cy="170" r="4" fill="#667085"/><circle cx="548" cy="170" r="4" fill="#667085"/>
<rect x="605" y="138" width="140" height="64" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="675" cy="170" r="4" fill="#98a2b3"/>
<rect x="170" y="210" width="140" height="64" rx="8" fill="#e4e7ec" stroke="#e4e7ec"/><circle cx="222" cy="242" r="4" fill="#667085"/><circle cx="234" cy="242" r="4" fill="#667085"/><circle cx="246" cy="242" r="4" fill="#667085"/><circle cx="258" cy="242" r="4" fill="#667085"/>
<rect x="315" y="210" width="140" height="64" rx="8" fill="#e4e7ec" stroke="#e4e7ec"/><circle cx="373" cy="242" r="4" fill="#667085"/><circle cx="385" cy="242" r="4" fill="#667085"/><circle cx="397" cy="242" r="4" fill="#667085"/>
<rect x="460" y="210" width="140" height="64" rx="8" fill="#e4e7ec" stroke="#e4e7ec"/><circle cx="512" cy="242" r="4" fill="#667085"/><circle cx="524" cy="242" r="4" fill="#667085"/><circle cx="536" cy="242" r="4" fill="#667085"/><circle cx="548" cy="242" r="4" fill="#667085"/>
<rect x="605" y="210" width="140" height="64" rx="8" fill="#e4e7ec" stroke="#e4e7ec"/><circle cx="663" cy="242" r="4" fill="#667085"/><circle cx="675" cy="242" r="4" fill="#667085"/><circle cx="687" cy="242" r="4" fill="#667085"/>
<rect x="170" y="282" width="140" height="64" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="240" cy="314" r="4" fill="#98a2b3"/>
<rect x="315" y="282" width="140" height="64" rx="8" fill="#fff" stroke="#1d4ed8" stroke-width="2"/><text x="385" y="318" font-size="13" fill="#1d4ed8" text-anchor="middle">candidate gap</text>
<rect x="460" y="282" width="140" height="64" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="524" cy="314" r="4" fill="#98a2b3"/><circle cx="536" cy="314" r="4" fill="#98a2b3"/>
<rect x="605" y="282" width="140" height="64" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/><circle cx="675" cy="314" r="4" fill="#98a2b3"/>
<rect x="170" y="366" width="22" height="14" rx="4" fill="#e4e7ec"/><text x="200" y="378" font-size="13" fill="#344054">dense claim coverage (dots ≈ relative family count)</text>
<rect x="170" y="392" width="22" height="14" rx="4" fill="#f7f8fa" stroke="#e4e7ec"/><text x="200" y="404" font-size="13" fill="#344054">thin coverage</text>
<rect x="170" y="418" width="22" height="14" rx="4" fill="#fff" stroke="#1d4ed8" stroke-width="2"/><text x="200" y="430" font-size="13" fill="#344054">candidate gap — verify with a patentability search</text>
<text x="40" y="458" font-size="13" fill="#98a2b3">Hypothetical data, invented to illustrate the method — not a census of the real EV battery landscape.</text>
</svg><figcaption>Fig. 1 — A hypothetical whitespace matrix for EV battery thermal management: problems (rows) crossed with technical approaches (columns). Shading shows claim-level coverage from the census; the outlined cell is the candidate gap that goes to validation. Illustrative only.</figcaption></figure>

<h2>What signals separate a real gap from a worthless one?</h2>

<table>
  <thead>
    <tr><th>Signal</th><th>Looks like a true gap</th><th>Looks like a false signal</th></tr>
  </thead>
  <tbody>
    <tr><td>Research papers</td><td>Active publication on the cell’s approach, with no matching claims</td><td>No papers either — nobody can make it work</td></tr>
    <tr><td>Products</td><td>Products ship using workarounds, or rely on trade secrecy</td><td>No product interest at any price point</td></tr>
    <tr><td>Standards activity</td><td>Working-group drafts reference the approach; claims haven’t followed</td><td>The standard has already settled on a rival approach</td></tr>
    <tr><td>Patent history</td><td>Early families lapsed — the idea may have been early, not wrong</td><td>Dense, live, recently filed coverage in adjacent cells aimed this way</td></tr>
    <tr><td>Regulation</td><td>New rules push the industry toward the approach</td><td>Rules effectively prohibit the approach</td></tr>
  </tbody>
</table>

<p>No single row settles it. A candidate gap should show two or three entries from the middle column before it earns the cost of a patentability search — one signal alone is how you end up filing into a cell the industry walked away from in 2015.</p>

<h2>How often should you rerun the analysis?</h2>

<p>Landscapes move underneath you. Publication lags filing by up to eighteen months, so today’s census is blind to a year and a half of filings by construction; classification schemes churn as offices reclassify; and a competitor’s continuation practice can fill a cell between two board meetings. Treat any patent whitespace analysis as a dated snapshot: rerun the census on the cells you care about before any filing decision that relies on it, and rebuild the taxonomy itself when the industry’s problem list changes — in fast-moving domains, that is roughly yearly. A map older than that is a historical document, not a strategy input.</p>

<p>The consulting version of patent whitespace analysis sells certainty in colour. The defensible version delivers less and is worth more: a short list of verified openings, the evidence trail behind each, and a decision on every line. The test to apply to any whitespace map — ours included — is simple: can it show you the claims it counted? If it cannot, it counted something else.</p>
`,
}
