import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'how-to-write-patent-claims',
  categorySlug: 'drafting-and-claims',
  publishedDaysAgo: 51,
  title: 'How to write patent claims that survive examination',
  subtitle:
    'Claim anatomy, the comprising/consisting trap, antecedent basis, and how to build a claim ladder that gives you somewhere to retreat to.',
  excerpt:
    'Claims are the only part of a patent that defines what you own. Here is how they are built — preamble, transition, body — and the drafting decisions that determine whether yours survives the examiner and still means something afterwards.',
  answerSummary:
    'A patent claim has three parts: a preamble naming what the invention is, a transition word ("comprising" for open-ended scope), and a body listing the elements and how they relate. Write the independent claim with the fewest elements that are still novel, then add dependent claims that progressively narrow it. Every term must have antecedent basis and a clear meaning in the description.',
  keyTakeaways: [
    'Only the claims define the scope of a patent — the description supports and interprets them, but infringement is judged against claim language alone.',
    'Every element you add to an independent claim narrows it, because an infringer must have all of them; the shortest claim that is still novel is the strongest claim.',
    '"Comprising" is open-ended and means "including at least these elements"; "consisting of" closes the claim to exactly those elements and is almost always a mistake outside chemistry.',
    'Antecedent basis is not pedantry: introduce each element with "a", refer back with "the", and never let "the controller" appear before "a controller" has.',
    'Build a ladder — one broad independent claim plus dependent claims adding a distinct feature each — so that when the examiner rejects the top rung you have a prepared position to fall back to rather than an improvised one.',
    'Claim what the invention does technically, not what it achieves commercially; results-based language is the fastest route to an indefiniteness or eligibility rejection.',
  ],
  faqs: [
    {
      question: 'How many claims should a patent application have?',
      answer:
        'Enough to cover the invention at several levels of generality, and few enough to stay inside the free allowance. The USPTO includes 20 claims with 3 independents in the basic fee; India includes 10 claims. A typical well-drafted application uses 1–3 independent claims and 12–18 dependents, arranged so each dependent adds one distinct, separately arguable feature.',
    },
    {
      question: 'What is the difference between an independent and a dependent claim?',
      answer:
        'An independent claim stands alone and defines the invention on its own terms. A dependent claim refers back to another claim and adds a limitation, so it is automatically narrower and includes everything in the claim it depends from. Dependent claims are your insurance: if the independent claim falls to prior art, a dependent may still be allowable.',
    },
    {
      question: 'Should I file apparatus claims, method claims, or both?',
      answer:
        'Both, where the invention supports both, because they are infringed by different parties. An apparatus claim is infringed by whoever makes or sells the device; a method claim is infringed by whoever performs the steps — which may be your customer rather than your competitor. For software, add a computer-readable medium claim so the distributor of the software is covered too.',
    },
    {
      question: 'What does "means for" do to a claim?',
      answer:
        'In the US, functional "means for" language invokes 35 U.S.C. §112(f), which limits the claim to the specific structures disclosed in your description and their equivalents — far narrower than the words suggest. It is occasionally the right tool, but it is usually invoked accidentally by drafters who thought functional language would be broader. In India and Europe, purely functional claiming attracts its own objections.',
    },
    {
      question: 'Can I broaden my claims after filing?',
      answer:
        'Only within what your application already disclosed, and only within limited windows. You can never add new matter, so a feature that is not in the specification as filed can never be claimed. In the US, a broadening reissue is possible within two years of grant; otherwise the description you filed is a permanent ceiling on your scope. This is why the specification should describe more than you initially claim.',
    },
  ],
  focusKeyword: 'patent claims',
  secondaryKeywords: [
    'how to write patent claims',
    'patent claim drafting',
    'independent vs dependent claims',
    'claim structure',
    'antecedent basis',
    'comprising vs consisting',
  ],
  tags: ['drafting', 'claims', 'technique', 'uspto'],
  jurisdictions: ['US', 'EP', 'IN'],
  seoTitle: 'How to write patent claims that survive examination',
  seoDescription:
    'Patent claim drafting explained: preamble, transition and body, comprising vs consisting, antecedent basis, claim ladders, and the mistakes that draw §112 rejections.',
  relatedSlugs: ['software-patent-eligibility', 'how-to-do-a-prior-art-search', 'how-to-respond-to-an-office-action'],
  content: `
<p>Everything else in a patent application is context. The description teaches, the figures illustrate, the abstract summarises — but the <strong>claims</strong> are the property boundary, and they are the only text a court reads when deciding whether someone infringed. A brilliant description with weak claims is a technical paper with a filing fee.</p>

<p>This is how claims are built, and where they usually go wrong.</p>

<p>The formal requirements for patent claims are set out by each office: the <a href="https://www.uspto.gov/web/offices/pac/mpep/index.html">USPTO in the MPEP</a>, the <a href="https://www.epo.org/">EPO in its Guidelines for Examination</a>, and the <a href="https://ipindia.gov.in/">Indian Patent Office</a> under Section 10 of the Patents Act. What follows is the craft that sits on top of those rules.</p>

<h2>What are the parts of a patent claim?</h2>

<p>Every claim is one sentence with three parts.</p>

<blockquote>
<p><strong>1. A soil irrigation controller</strong> <em>(preamble)</em> <strong>comprising:</strong> <em>(transition)</em><br>
a sensor interface configured to receive moisture readings from a plurality of soil sensors;<br>
a network module configured to receive weather forecast data;<br>
a processor configured to generate an irrigation schedule from the moisture readings and the weather forecast data; and<br>
a valve driver configured to actuate an irrigation valve in accordance with the irrigation schedule,<br>
wherein the processor is configured to update the model locally using a measured soil response to a previous actuation. <em>(body)</em></p>
</blockquote>

<h3>The preamble</h3>

<p>Names what the invention is and, sometimes, its purpose. Keep it short and avoid smuggling limitations in. "A controller for use in commercial almond orchards" invites an argument about whether a competitor's domestic product falls outside your claim — say "a soil irrigation controller" instead.</p>

<h3>The transition</h3>

<p>One word that determines how much room the claim has:</p>

<table>
  <thead>
    <tr><th>Transition</th><th>Meaning</th><th>Use it when</th></tr>
  </thead>
  <tbody>
    <tr><td><code>comprising</code></td><td>Open-ended: includes at least these elements, extra elements do not avoid infringement</td><td>Nearly always</td></tr>
    <tr><td><code>consisting of</code></td><td>Closed: exactly these elements and nothing else</td><td>Chemical compositions where exclusion is the point</td></tr>
    <tr><td><code>consisting essentially of</code></td><td>These elements plus anything not materially affecting the invention</td><td>Rarely; it invites disputes about "materially"</td></tr>
  </tbody>
</table>

<p>A competitor who adds one extra component escapes a "consisting of" claim entirely. That is the whole difference, and it is a single word.</p>

<h3>The body</h3>

<p>The elements and — this is the part that gets skipped — <strong>how they relate to each other</strong>. A list of parts is not an invention. "A processor configured to generate an irrigation schedule <em>from the moisture readings and the weather forecast data</em>" claims a relationship; "a processor" claims a commodity.</p>

<h2>Why is the shortest claim the strongest?</h2>

<p>Because infringement requires <strong>every</strong> element. This is the single most counter-intuitive fact in patent drafting and it inverts the instinct of every engineer who has ever drafted their first claim.</p>

<p>A claim with four elements is infringed by anyone who has those four. Add a fifth — perhaps a lovely feature you are proud of — and a competitor who implements only the first four now infringes nothing. Every word you add is scope you give away.</p>

<p>So the discipline is: <strong>what is the minimum set of features that is (a) still novel over the prior art and (b) still describes something worth owning?</strong> That is your independent claim. Everything else goes in dependent claims, where it costs you nothing and buys you fallback positions.</p>

<p>This is also why claim drafting cannot be done before searching. You cannot find the shortest novel claim without knowing what the art already covers — see <a href="/blog/how-to-do-a-prior-art-search">how to run a prior-art search</a>.</p>

<h2>How do you build a claim ladder?</h2>

<p>Think of your claim set as a ladder you can climb down under fire. The examiner will reject the top rung; your job is to have prepared the rungs below rather than improvise them under a three-month deadline.</p>

<ol>
  <li><strong>Claim 1 — the broadest defensible position.</strong> Minimum novel element set.</li>
  <li><strong>Claims 2–8 — one distinct feature each.</strong> Not variations on a theme; genuinely different limitations, so a rejection that kills one does not kill all of them.</li>
  <li><strong>A dependent claim carrying your strongest technical differentiator</strong>, drafted so it could stand as an independent claim if the top rung falls.</li>
  <li><strong>Parallel independent claims in other statutory categories</strong> — method, system, computer-readable medium — because they catch different infringers.</li>
</ol>

<p>Bad ladders have dependents that all add flavours of the same idea ("wherein the sensor is capacitive", "wherein the sensor is resistive", "wherein the sensor is optical"). One piece of prior art disclosing "any suitable soil sensor" takes out the whole rung.</p>

<h2>What is antecedent basis and why do examiners care?</h2>

<p>Every element gets introduced once with an indefinite article and referred to thereafter with a definite one:</p>

<ul>
  <li>First mention: <strong>a</strong> processor, <strong>a</strong> plurality of soil sensors</li>
  <li>Every later mention: <strong>the</strong> processor, <strong>the</strong> plurality of soil sensors</li>
</ul>

<p>Write "the controller" when no controller has been introduced and you get an indefiniteness rejection under 35 U.S.C. §112(b) — a wholly avoidable round of prosecution, costing months and fees, for a grammatical slip. Related traps:</p>

<ul>
  <li><strong>Inconsistent naming.</strong> "A processor" in claim 1 and "the microprocessor" in claim 4 are, formally, two different things.</li>
  <li><strong>Implicit elements.</strong> "wherein the output signal is amplified" — amplified by what? Something must be claimed as doing it.</li>
  <li><strong>Relative terms without a reference.</strong> "substantially", "approximately", "high-speed" are definite only if the description gives them a boundary.</li>
</ul>

<h2>Which types of patent claims should you file?</h2>

<table>
  <thead>
    <tr><th>Type</th><th>Form</th><th>Who infringes</th></tr>
  </thead>
  <tbody>
    <tr><td>Apparatus / system</td><td>"A controller comprising…"</td><td>Whoever makes, sells or imports the device</td></tr>
    <tr><td>Method / process</td><td>"A method of irrigating, comprising the steps of…"</td><td>Whoever performs the steps — often the end user</td></tr>
    <tr><td>Computer-readable medium</td><td>"A non-transitory computer-readable medium storing instructions that…"</td><td>Whoever distributes the software</td></tr>
    <tr><td>Product-by-process</td><td>"A composite produced by the process of…"</td><td>Use only where the product cannot be defined structurally</td></tr>
  </tbody>
</table>

<p>For a connected product, the combination that matters is usually apparatus + method + medium. A competitor selling only the software escapes an apparatus-only claim set; a competitor selling only hardware escapes a method-only set.</p>

<aside class="note"><strong>Jurisdiction note.</strong> Claim conventions differ. The EPO expects a two-part form ("characterised in that") in many cases and applies strict rules on added matter and clarity. India examines under Section 10(4)(c) and has its own practice on omnibus claims, which are not permitted. Draft for your primary jurisdiction, then have the family adapted — a US claim set filed unchanged in Europe is a predictable source of objections.</aside>

<h2>The patent claims mistakes that cost the most</h2>

<ol>
  <li><strong>Claiming the result, not the mechanism.</strong> "A system that reduces water consumption by 30%" is not a claim; it is an advertisement. Claim the arrangement that produces the result.</li>
  <li><strong>Putting the invention only in the description.</strong> If your best feature appears in paragraph 60 but in no claim, you have published it for free. Disclosure without claiming is a gift to the field.</li>
  <li><strong>Over-limiting claim 1 out of caution.</strong> Drafters nervous about prior art sometimes load the independent claim with every feature. The application sails through examination and grants a patent nobody will ever infringe.</li>
  <li><strong>Accidental functional claiming.</strong> "Means for filtering" invokes §112(f) and quietly narrows you to the specific filter in your figures.</li>
  <li><strong>Forgetting the divided-infringement problem.</strong> A method claim whose steps are performed by two different parties (the device and a cloud server) can be effectively unenforceable. Draft the steps from the perspective of a single actor.</li>
  <li><strong>Claiming beyond the description.</strong> You can never add matter later. Whatever you might want to claim in five years must be in the specification you file today.</li>
</ol>

<h2>A working method for drafting a claim set</h2>

<ol>
  <li>Write the feature list from the search matrix — every technical feature, marked novel or known.</li>
  <li>Strike every feature that is not necessary for the invention to work. What remains is a candidate claim 1.</li>
  <li>Check that candidate against the closest prior art, element by element. If a single document has them all, strike the wrong feature — add back the smallest thing that distinguishes.</li>
  <li>Write it as one sentence: preamble, "comprising", elements with their relationships.</li>
  <li>Check antecedent basis line by line.</li>
  <li>Add dependent claims — one distinct feature each, in order of how confident you are that it is novel.</li>
  <li>Add parallel independent claims in the other statutory categories.</li>
  <li>Reread the description and confirm every claim term is defined and every claimed element is described. Any mismatch is a rejection waiting to happen.</li>
</ol>

<p>Software and AI inventions carry an additional constraint on top of all of this — the claim must recite a technical implementation, not an abstract idea. That is a subject of its own: see <a href="/blog/software-patent-eligibility">are software and AI inventions patentable?</a>. And if you are using drafting tools to accelerate any of this, <a href="/blog/ai-patent-drafting">what AI patent drafting does and does not do</a> covers where they help and where they quietly cost you scope.</p>
`,
}
