import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'software-patents-in-india-section-3k',
  categorySlug: 'drafting-and-claims',
  publishedDaysAgo: 5,
  title: 'Software patents in India: claims that survive Section 3(k)',
  subtitle:
    'Section 3(k) excludes computer programmes per se, not software inventions. A drafting guide to the technical-effect standard, with before-and-after claim rewrites and the Delhi High Court cases that set the frame.',
  excerpt:
    'India refuses computer programmes per se, not software inventions. A practical drafting guide to Section 3(k): what a technical effect is, what examiners object to, and two before-and-after claim rewrites showing the difference between refused and allowable.',
  answerSummary:
    'Software patents in India are refused when they claim a computer programme, algorithm or business method as such, and allowed when the claim recites a technical solution to a technical problem. Section 3(k) excludes programs per se only. Delhi High Court decisions — Ferid Allani (2019), Microsoft (2023), Lava v. Ericsson (2024) — confirm that claims demonstrating a technical effect or technical contribution are patentable, so drafting, not subject matter, usually decides the outcome.',
  keyTakeaways: [
    'Section 3(k) of India’s Patents Act excludes mathematical methods, business methods, algorithms and computer programmes per se — the per se qualifier, added deliberately in the 2002 amendment, is why applied software inventions remain patentable in India.',
    'In India, a claim survives Section 3(k) when it recites a technical effect — reduced latency, lower memory or bandwidth use, improved security or better hardware utilisation — rather than a business outcome.',
    'The Delhi High Court held in Ferid Allani (2019) that an invention demonstrating a technical effect or technical contribution is patentable in India even when it is implemented in software.',
    'Indian examiners routinely object to claims whose novelty lives in a business rule or an algorithm as such; the standard fix is to redraft around where and how the computation runs, filed as a method and system pair.',
    'The Indian CRI Guidelines no longer demand novel hardware — the 2017 revision removed the 2016 requirement — but examiners still assess the substance of the claim, so verify the current guidelines on ipindia.gov.in before filing.',
  ],
  faqs: [
    {
      question: 'Are software patents allowed in India?',
      answer:
        'Yes, with a qualifier. Section 3(k) of the Patents Act excludes mathematical methods, business methods, algorithms and computer programmes per se — the program as such. Inventions that use software to deliver a technical effect, such as reduced latency, lower memory use or improved security, are patentable, and the Delhi High Court confirmed this in Ferid Allani (2019). In practice, eligibility in India turns on how the claim is drafted rather than on the field of the invention.',
    },
    {
      question: 'What does per se mean in Section 3(k)?',
      answer:
        'The phrase limits the exclusion to computer programmes as such — claims to the program itself. It was added deliberately in the 2002 amendment, and the recorded legislative intent was that combinations and applications of computer programs — a program working with hardware to produce a technical result — should remain patentable in India. A claim to a method or system that uses software is therefore assessed on its technical contribution, not excluded automatically.',
    },
    {
      question: 'Do I need novel hardware to patent software in India?',
      answer:
        'No. The 2016 CRI Guidelines did direct examiners to look for novel hardware, but the 2017 revision removed that requirement, and examiners now assess the substance of the claim — its technical contribution — rather than demanding new physical components. Standard hardware running an inventive process can be patentable. The guidelines have been revisited over the years, so check the current version on ipindia.gov.in before relying on any summary, including this one.',
    },
    {
      question: 'Can I patent an AI or machine learning model in India?',
      answer:
        'A model as such — an architecture, a training objective or a set of weights — sits close to the mathematical-method and algorithm exclusions of Section 3(k) and is difficult to claim in India. Applied AI fares better: claims tied to a technical deployment, such as on-device quantised inference, latency-bounded classification or model-driven control of physical equipment, can demonstrate the technical effect that Indian examination looks for. Draft toward the application, not the mathematics.',
    },
    {
      question: 'What happens if my claim is refused under Section 3(k)?',
      answer:
        'A Section 3(k) objection in a first examination report is common and survivable. The usual response is amendment before argument: recast business steps as technical ones, recite where the computation happens, and move the technical effect into the claim body. If the Controller maintains the refusal, an appeal lies to the High Court, and the Delhi High Court has reversed such refusals — notably in Microsoft v. Assistant Controller (2023) — where the claims made a genuine technical contribution.',
    },
  ],
  focusKeyword: 'software patents in india',
  secondaryKeywords: [
    'section 3(k) patents act',
    'computer related inventions india',
    'cri guidelines',
    'software patent claims india',
  ],
  tags: ['india', 'software-patents', 'claims', 'eligibility'],
  jurisdictions: ['IN'],
  seoTitle: 'Software patents in India: claims that survive Section 3(k)',
  seoDescription:
    'A practical guide to software patents in India: what Section 3(k) excludes, what counts as a technical effect, and how to redraft claims that survive examination.',
  relatedSlugs: ['granted-software-patent-claims-india', 'software-patent-eligibility', 'how-to-write-patent-claims'],
  content: `
<p>Software patents in India sit under a statutory exclusion that most other major offices do not have: Section 3(k) of the Patents Act, 1970, which bars "a mathematical or business method or a computer programme per se or algorithms". Read carelessly, that looks like a ban. Read the way the Delhi High Court has been reading it, it is a drafting test — and one that well-prepared applications pass regularly.</p>

<p>This is the India-specific deep dive. For how the same invention fares across the USPTO, the EPO and other offices, see the multi-office overview in <a href="/blog/software-patent-eligibility">are software and AI inventions patentable?</a>. Here we stay inside Indian practice: what the exclusion actually covers, what examiners accept as a technical effect, and how software patents in India are drafted so the objection never issues.</p>

<h2>What does Section 3(k) actually exclude?</h2>

<p>The operative words are "per se". They were added deliberately during the 2002 amendment, and the legislative intent recorded at the time was narrow: computer programmes as such should not be patentable, but their combinations and applications in other fields could be. A claim to the program itself — a sequence of instructions, however clever — is excluded. A claim to a device, system or method that uses a program to produce a technical result is not automatically excluded, and never was.</p>

<p>Practice under the exclusion has moved. The 2016 Computer Related Inventions (CRI) Guidelines told examiners to look for novel hardware, which would have shut out almost all software inventions. The 2017 revision removed that requirement, and examiners were directed to assess the substance of the claim instead — what it contributes, not what physical box it names. The guidelines have been revisited since, so verify the current version on <a href="https://www.ipindia.gov.in/">ipindia.gov.in</a> before relying on any summary, including this one.</p>

<p>The upshot: nobody drafting software patents in India today should be arguing about whether the field is patentable. The argument is always about whether this claim, as worded, recites something more than the excluded categories.</p>

<h2>What counts as a technical effect in India?</h2>

<p>The anchor case is <em>Ferid Allani v. Union of India</em> (Delhi High Court, 2019): an invention that demonstrates a "technical effect" or "technical contribution" is patentable even if it is implemented entirely in software. The court did not hand down an exhaustive list, but examination practice and the case law since have made the pattern clear enough to draft against.</p>

<p>Effects that carry weight in Indian examination:</p>

<ul>
  <li>Reduced latency, memory footprint, bandwidth or power consumption</li>
  <li>Improved security — of the device, the channel or the stored data</li>
  <li>Better utilisation of existing hardware: cache behaviour, scheduling, load distribution</li>
  <li>Improved signal processing, compression or error correction</li>
</ul>

<p>Outcomes that do not carry weight on their own:</p>

<ul>
  <li>More sales, better conversion, lower cost — commercial results, not technical ones</li>
  <li>A better user experience, unless it is restated in technical terms</li>
  <li>Automation of a process a business previously did manually, with nothing technical changed in how it runs</li>
</ul>

<p>Two later Delhi High Court decisions hardened the frame. <em>Microsoft Technology Licensing v. Assistant Controller of Patents</em> (2023) reversed refusals where the claims made a technical contribution, criticising form-over-substance rejection. <em>Lava v. Ericsson</em> (2024) upheld telecom claims drafted at the implementation level. The direction of travel is consistent: substance decides, and the reasoning tracks the technical-effect approach familiar from the <a href="https://www.epo.org/">EPO</a>.</p>

<h2>How do you draft claims that survive?</h2>

<p>Four habits separate the applications that clear Section 3(k) at first examination from the ones that spend years in objection cycles.</p>

<ol>
  <li><strong>Anchor the claim to a technical problem and its technical solution.</strong> Before any claim language, write one sentence: the technical problem is X, and the mechanism that solves it is Y. If X is a business problem, stop and find the technical one underneath — there usually is one, because something in the system was too slow, too large, too power-hungry or too insecure.</li>
  <li><strong>Pair a method claim with a system claim.</strong> The method claim carries the steps; the system claim recites a processor, memory and modules configured to perform them. The pairing survives examination better than either claim alone and gives you enforcement options later. Our companion piece on <a href="/blog/how-to-write-patent-claims">how to write patent claims</a> covers the mechanics.</li>
  <li><strong>Say where the computation happens when it matters.</strong> On the edge device, in the cache layer, before transmission — location and ordering are often exactly where the technical effect comes from, and reciting them is what separates an applied method from an algorithm as such.</li>
  <li><strong>Keep business outcomes out of the claim.</strong> Revenue, engagement and conversion belong in the background of the specification, if anywhere. The moment a claim step exists only to achieve a commercial result, the business-method limb of Section 3(k) is available to the examiner.</li>
</ol>

<figure><svg viewBox="0 0 760 480" role="img" aria-label="Decision flowchart showing how a claim is tested against Section 3(k) of the Indian Patents Act" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif"><title>Decision flowchart showing how a claim is tested against Section 3(k) of the Indian Patents Act</title>
<defs><marker id="arrow-3k" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1d4ed8"/></marker></defs>
<rect x="180" y="24" width="320" height="44" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="340" y="51" text-anchor="middle" font-size="15" font-weight="600" fill="#101828">Claimed subject matter</text>
<line x1="340" y1="68" x2="340" y2="98" stroke="#1d4ed8" marker-end="url(#arrow-3k)"/>
<rect x="120" y="102" width="440" height="48" rx="8" fill="#fff" stroke="#e4e7ec"/>
<text x="340" y="131" text-anchor="middle" font-size="15" fill="#101828">Is it a business method as such?</text>
<line x1="560" y1="126" x2="594" y2="126" stroke="#1d4ed8" marker-end="url(#arrow-3k)"/>
<text x="577" y="118" text-anchor="middle" font-size="13" fill="#667085">yes</text>
<rect x="598" y="102" width="138" height="48" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="667" y="122" text-anchor="middle" font-size="13" fill="#667085">Refused under</text>
<text x="667" y="140" text-anchor="middle" font-size="13" fill="#667085">Section 3(k)</text>
<line x1="340" y1="150" x2="340" y2="182" stroke="#1d4ed8" marker-end="url(#arrow-3k)"/>
<text x="352" y="170" font-size="13" fill="#667085">no</text>
<rect x="120" y="186" width="440" height="62" rx="8" fill="#fff" stroke="#e4e7ec"/>
<text x="340" y="212" text-anchor="middle" font-size="15" fill="#101828">Does it solve a technical problem</text>
<text x="340" y="232" text-anchor="middle" font-size="15" fill="#101828">with a technical solution?</text>
<line x1="560" y1="217" x2="594" y2="217" stroke="#1d4ed8" marker-end="url(#arrow-3k)"/>
<text x="577" y="209" text-anchor="middle" font-size="13" fill="#667085">no</text>
<rect x="598" y="190" width="138" height="58" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="667" y="212" text-anchor="middle" font-size="13" fill="#667085">Refused — no</text>
<text x="667" y="229" text-anchor="middle" font-size="13" fill="#667085">technical</text>
<text x="667" y="246" text-anchor="middle" font-size="13" fill="#667085">contribution</text>
<line x1="340" y1="248" x2="340" y2="280" stroke="#1d4ed8" marker-end="url(#arrow-3k)"/>
<text x="352" y="268" font-size="13" fill="#667085">yes</text>
<rect x="120" y="284" width="440" height="62" rx="8" fill="#fff" stroke="#e4e7ec"/>
<text x="340" y="310" text-anchor="middle" font-size="15" fill="#101828">Is the technical effect recited in the claim,</text>
<text x="340" y="330" text-anchor="middle" font-size="15" fill="#101828">not only in the description?</text>
<line x1="560" y1="315" x2="594" y2="315" stroke="#1d4ed8" marker-end="url(#arrow-3k)"/>
<text x="577" y="307" text-anchor="middle" font-size="13" fill="#667085">no</text>
<rect x="598" y="288" width="138" height="58" rx="8" fill="#fff" stroke="#1d4ed8" stroke-dasharray="4 3"/>
<text x="667" y="310" text-anchor="middle" font-size="13" fill="#1d4ed8">Redraft: move the</text>
<text x="667" y="327" text-anchor="middle" font-size="13" fill="#1d4ed8">effect into the</text>
<text x="667" y="344" text-anchor="middle" font-size="13" fill="#1d4ed8">claim, then retest</text>
<line x1="340" y1="346" x2="340" y2="378" stroke="#1d4ed8" marker-end="url(#arrow-3k)"/>
<text x="352" y="366" font-size="13" fill="#667085">yes</text>
<rect x="120" y="382" width="440" height="62" rx="8" fill="#fff" stroke="#1d4ed8" stroke-width="1.5"/>
<text x="340" y="408" text-anchor="middle" font-size="15" font-weight="600" fill="#1d4ed8">Survives Section 3(k) —</text>
<text x="340" y="428" text-anchor="middle" font-size="15" font-weight="600" fill="#1d4ed8">file as a method + system pair</text>
</svg><figcaption>Fig. 1 — The examiner’s path through Section 3(k), reduced to the three questions that decide most software claims in India.</figcaption></figure>

<h2>What does a rewrite look like in practice?</h2>

<p>Both examples below are hypothetical, written for this article — not claims from real files. The pattern they show, though, is the everyday work of prosecuting software patents in India.</p>

<h3>Example A: recommendation engine</h3>

<blockquote><p><strong>Before (would attract Section 3(k)):</strong> "A method of increasing purchases, comprising: analysing a user’s browsing history using an algorithm; and recommending products the user is likely to buy."</p></blockquote>

<p>Every load-bearing word is commercial. The claimed contribution is a business outcome — more purchases — achieved by an unspecified algorithm: squarely both the business-method and algorithm limbs of the exclusion.</p>

<blockquote><p><strong>After (technical framing):</strong> "A method of reducing content-delivery latency in a recommendation system, comprising: precomputing, at an edge server, a ranked subset of content items for a user segment; storing the subset in an edge cache keyed by segment identifier; and serving a request from the edge cache without a round trip to an origin server when the segment identifier matches."</p></blockquote>

<p>Same underlying product. The claim now solves a technical problem (latency) by a technical mechanism (edge precomputation and caching), with the effect visible in the claim itself (no origin round trip). Whether it is novel is a separate question for the search — but Section 3(k) no longer has an easy grip on it.</p>

<h3>Example B: machine-learning fraud detection</h3>

<blockquote><p><strong>Before:</strong> "A method of detecting fraudulent transactions, comprising: applying artificial intelligence to transaction data; and flagging transactions that are likely to be fraudulent."</p></blockquote>

<blockquote><p><strong>After:</strong> "A method of classifying transaction events on a memory-constrained payment terminal, comprising: extracting a fixed-length feature vector from each event in a streaming pipeline that discards raw event data after extraction; and executing a quantised classification model over the feature vector within a bounded memory budget of the terminal, wherein classification completes before the transaction authorisation response is transmitted."</p></blockquote>

<p>The rewrite commits to an architecture: streaming feature extraction, bounded memory, quantised inference, a timing constraint tied to the hardware. Those commitments narrow the claim — that is the price — but they are also what makes it patentable subject matter in India rather than artificial intelligence as hand-waving.</p>

<h2>What do examiners object to, and how do you respond?</h2>

<p>Most first examination reports raise Section 3(k) in one of four shapes. Each has a standard redraft response.</p>

<table>
  <thead>
    <tr><th>Objection trigger</th><th>What it looks like in the claim</th><th>Redraft strategy</th></tr>
  </thead>
  <tbody>
    <tr><td>Algorithm per se</td><td>Steps are pure computation with no device, data source or effect recited</td><td>Recite the hardware context, the physical origin of the data, and the technical effect of the result</td></tr>
    <tr><td>Business method</td><td>A claim step exists only to achieve a commercial outcome</td><td>Delete or recast the step; move the commercial context into the description</td></tr>
    <tr><td>Mental act</td><td>Steps a person could perform in their head or on paper</td><td>Tie the steps — honestly — to scale, timing or data volumes only a machine can handle</td></tr>
    <tr><td>Presentation of information</td><td>The novelty lives in what is displayed, not how</td><td>Claim the generation or transmission mechanism, not the displayed content</td></tr>
  </tbody>
</table>

<p>Responding to these objections in argument alone rarely works while the claim text stays the same. Amend first, argue second — and see <a href="/blog/how-to-respond-to-an-office-action">how to respond to an office action</a> for the general craft of examination responses.</p>

<h2>What about AI and machine learning inventions?</h2>

<p>AI claims face Section 3(k) with an extra twist: a trained model is, at bottom, a mathematical function. Claims to a model as such — an architecture, a training objective, a set of weights — sit close to the mathematical-method and algorithm limbs, and prosecution is difficult. Applied claims fare much better, and it helps to split the invention along the train/infer boundary:</p>

<ul>
  <li><strong>Training-side claims</strong> work when training itself has a technical character — reduced training compute, a data pipeline that bounds memory, distributed training that cuts communication overhead.</li>
  <li><strong>Inference-side claims</strong> work when the deployment is technical — on-device quantised inference, latency-bounded classification in a signalling path, model-driven control of physical equipment.</li>
</ul>

<p>In both cases the drafting rule is the one this whole article turns on: the claim must recite the technical setting and the technical effect, not merely name the model. "Based on machine learning" is a phrase examiners have seen thousands of times, and it does no eligibility work. As filings multiply, software patents in India are increasingly AI patents, and scrutiny of that phrase has only tightened.</p>

<h2>Where does this leave software patents in India?</h2>

<p>In a better place than the folklore suggests. The statute excludes less than it appears to; the Delhi High Court has said so repeatedly; and the recurring failure mode is drafting — claims that lead with the business and bury the engineering. Get the technical problem-and-solution frame right, pair the method with a system, keep the effect inside the claim, and Section 3(k) becomes an objection you answer once rather than a wall you hit twice a year.</p>

<p>Before you draft, know what the closest art already covers: run a <a href="/novelty-search">novelty search</a> against the claim you intend to file, and read our companion analysis of <a href="/blog/granted-software-patent-claims-india">what granted software patent claims in India look like</a> to see the same pattern from the allowed side.</p>
`,
}
