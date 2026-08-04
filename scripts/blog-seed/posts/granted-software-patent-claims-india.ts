// TODO: strengthen with claim-level statistics from the PatentNest Indian corpus before major promotion.

import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'granted-software-patent-claims-india',
  categorySlug: 'drafting-and-claims',
  publishedDaysAgo: 2,
  featured: true,
  title: 'What granted software patent claims in India look like',
  subtitle:
    'Granted Indian software claims follow a recognisable pattern: a technical preamble, device-level steps, the effect in the claim body, and a method mirrored by a system claim. Here is the anatomy.',
  excerpt:
    'Read enough granted Indian software patents and a pattern emerges: computer-implemented method claims paired with system claims, technical preambles, device-level language and lean claim sets. An anatomy of what actually grants, with the case law behind it.',
  answerSummary:
    'Granted software patent claims in India are typically computer-implemented method claims paired with a system claim reciting a processor, memory and configured-to modules. The preamble names the technical field and often the technical problem; the technical effect appears in the claim body; language stays device-level rather than business-level; and claim sets are lean. Computer-readable-medium claims are routinely objected to under Section 3(k) and commonly dropped during Indian prosecution.',
  keyTakeaways: [
    'In India, the software claims that grant are almost always computer-implemented method claims mirrored by a system claim built from a processor, memory and configured-to modules.',
    'Granted Indian claims put the technical effect in the claim body itself — a pattern the Delhi High Court reinforced in Ferid Allani (2019) and Microsoft v. Assistant Controller (2023).',
    'India charges official excess-claim fees for each claim above ten, which keeps Indian claim sets lean and makes every dependent claim earn its place.',
    'Computer-readable-medium (Beauregard-style) claims are routinely objected to in India as a computer programme per se and are commonly dropped during prosecution.',
    'Granted Indian software claims speak at device level — processor, cache, sensor, signal — and avoid the business vocabulary (customer, order, price) that invites Section 3(k) objections.',
  ],
  faqs: [
    {
      question: 'Are computer-readable-medium claims allowed in India?',
      answer:
        'Rarely in practice. Beauregard-style claims to a computer-readable medium storing instructions are routinely objected to in India as claims to a computer programme per se under Section 3(k), and applicants commonly drop them during prosecution rather than contest the point. The method and system claims carry the application. If CRM coverage matters to your global strategy, keep those claims in the priority filing and expect to delete them in the Indian national phase.',
    },
    {
      question: 'How many claims should an Indian software application have?',
      answer:
        'There is no fixed rule, but India charges official excess-claim fees for each claim above ten, and Indian practice has adapted to the constraint: lean sets in which one method claim and one system claim carry the independents and each dependent claim adds a single defensible limitation. Long US-style claim sets translate into fees without adding much prosecution value in India. Trim before filing rather than during examination.',
    },
    {
      question: 'Do granted Indian software claims use means-plus-function language?',
      answer:
        'Seldom. Modern Indian software drafting has settled on configured-to phrasing — a processor configured to perform stated operations — rather than means-for language. Configured-to claims map cleanly onto the method claim they mirror, keep the vocabulary at device level, and avoid the interpretive uncertainty that means-plus-function language carries across jurisdictions. If you are adapting a US-origin specification for India, converting means-for elements to configured-to modules is a standard localisation step.',
    },
    {
      question: 'Why do granted Indian claims pair a method with a system claim?',
      answer:
        'The pairing serves prosecution and enforcement at once. During examination, the system claim — a processor, memory and configured-to modules — grounds the invention in hardware context, which helps against Section 3(k) objections aimed at software as such. After grant, the method claim reads on the process and the system claim on the apparatus, giving complementary infringement positions. Indian practice treats the mirrored pair as the standard architecture for computer-implemented inventions.',
    },
    {
      question: 'Can I copy a granted US software claim into an Indian application?',
      answer:
        'Not safely without rework. US-origin claim sets often include computer-readable-medium claims that attract Section 3(k) objections in India, claim counts that trigger Indian excess-claim fees above ten claims, and functional language that Indian examiners read as claiming a result. The standard localisation pass deletes or converts the CRM claims, trims the set, moves the technical effect into the claim body, and shifts vocabulary from business terms to device terms. Ferid Allani and Microsoft v. Assistant Controller reward that substance-first framing.',
    },
  ],
  focusKeyword: 'software patent claims',
  secondaryKeywords: [
    'granted software patents india',
    'patent claim examples india',
    'indian patent claims structure',
    'computer implemented invention claims',
  ],
  tags: ['india', 'claims', 'software-patents', 'analysis'],
  jurisdictions: ['IN'],
  seoTitle: 'What granted software patent claims in India look like',
  seoDescription:
    'What granted software patent claims in India have in common: structure, method+system pairing, device-level language, and the case law behind the pattern.',
  relatedSlugs: ['software-patents-in-india-section-3k', 'how-to-write-patent-claims', 'ai-patent-drafting'],
  content: `
<p>There is no shortage of advice about what Indian software claims should look like. There is much less about what the claims that actually grant do look like. Read enough allowed files, though, and the pattern is hard to miss: the software patent claims that survive Indian examination share a structure, a vocabulary and a shape — and the refusals share a different one. This article describes that pattern element by element, so you can draft toward it deliberately rather than discover it through two rounds of objections.</p>

<p>A caution before the anatomy: what follows are practice observations, grounded in the reported case law and in how prosecution before the Indian Patent Office commonly runs. They are qualitative patterns, not statistics. Treat them as a drafting compass, not a dataset.</p>

<h2>What do granted software patent claims in India have in common?</h2>

<p>Across technical fields — telecom, embedded systems, image processing, security — the granted software patent claims share five traits:</p>

<ul>
  <li><strong>Method + system pairing.</strong> The independent claims are typically a computer-implemented method mirrored by a system claim — a processor, a memory, and modules configured to perform the method’s steps.</li>
  <li><strong>A technical preamble.</strong> The preamble states the technical field and, in the stronger grants, the technical problem: a method of reducing handover latency in a cellular network, not a method of improving user satisfaction.</li>
  <li><strong>The effect inside the claim.</strong> The technical effect — bounded memory, fewer round trips, earlier error detection — appears in the claim body, usually in a wherein clause, not only in the description.</li>
  <li><strong>Lean claim sets.</strong> India charges official excess-claim fees for each claim above ten, and Indian practice has internalised the constraint: tight sets in which each dependent claim adds one defensible limitation.</li>
  <li><strong>Device-level vocabulary.</strong> Granted claims talk about processors, caches, sensors, packets and signals. Refused claims talk about customers, orders, offers and prices.</li>
</ul>

<h2>How is a granted Indian software claim structured?</h2>

<p>Here is the skeleton, element by element, using a hypothetical claim written for this article. Figure 1 shows the same anatomy visually.</p>

<ol>
  <li><strong>Preamble:</strong> "A computer-implemented method of reducing memory consumption during real-time video analysis on an embedded device, the method comprising:" — technical field, technical problem and device context, all stated before the first step.</li>
  <li><strong>Actor-anchored steps:</strong> each step names a device-level actor — "receiving, by a processor of the embedded device, a stream of video frames from a camera sensor". The actor is a component, not a person or a business role.</li>
  <li><strong>Technical operations:</strong> the verbs do engineering work — extracting, quantising, caching, discarding, transmitting. Results-only verbs such as improving and optimising are absent from the steps.</li>
  <li><strong>The wherein clause:</strong> "wherein frames are discarded from the buffer after feature extraction such that peak memory usage remains within a fixed budget of the device" — the technical effect, stated as a claim limitation rather than a promise in the description.</li>
</ol>

<p>The dependent claims follow the same discipline. Each one adds a single technical limitation — a particular quantisation scheme, a cache-eviction rule, a threshold tied to a hardware property — rather than a list of loosely related variations. Because every claim above ten carries an official fee in India, a dependent claim that would not survive as an amendment target during prosecution rarely earns its slot in the filed set.</p>

<figure><svg viewBox="0 0 760 440" role="img" aria-label="Anatomy of a granted-style Indian software claim, annotated element by element" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif"><title>Anatomy of a granted-style Indian software claim, annotated element by element</title>
<rect x="24" y="24" width="440" height="392" rx="8" fill="#fff" stroke="#e4e7ec"/>
<text x="48" y="60" font-size="14" font-weight="600" fill="#101828">1. A computer-implemented method of reducing</text>
<text x="48" y="80" font-size="14" font-weight="600" fill="#101828">memory consumption during real-time video</text>
<text x="48" y="100" font-size="14" font-weight="600" fill="#101828">analysis on an embedded device, comprising:</text>
<text x="64" y="140" font-size="14" fill="#344054">receiving, by a processor of the device, video</text>
<text x="64" y="160" font-size="14" fill="#344054">frames from a camera sensor;</text>
<text x="64" y="196" font-size="14" fill="#344054">extracting a feature vector from each frame</text>
<text x="64" y="216" font-size="14" fill="#344054">in a streaming pipeline;</text>
<text x="64" y="252" font-size="14" fill="#344054">discarding each frame from the buffer after</text>
<text x="64" y="272" font-size="14" fill="#344054">extraction; and</text>
<text x="64" y="308" font-size="14" fill="#344054">transmitting the feature vectors to a classifier,</text>
<text x="64" y="344" font-size="14" fill="#344054">wherein peak memory usage remains within</text>
<text x="64" y="364" font-size="14" fill="#344054">a fixed budget of the device.</text>
<circle cx="464" cy="76" r="3" fill="#1d4ed8"/>
<line x1="464" y1="76" x2="492" y2="76" stroke="#1d4ed8"/>
<text x="500" y="72" font-size="13" font-weight="600" fill="#101828">Preamble</text>
<text x="500" y="89" font-size="13" fill="#667085">technical field and problem</text>
<circle cx="464" cy="146" r="3" fill="#1d4ed8"/>
<line x1="464" y1="146" x2="492" y2="146" stroke="#1d4ed8"/>
<text x="500" y="142" font-size="13" font-weight="600" fill="#101828">Device-level actor</text>
<text x="500" y="159" font-size="13" fill="#667085">processor, sensor — not user</text>
<circle cx="464" cy="206" r="3" fill="#1d4ed8"/>
<line x1="464" y1="206" x2="492" y2="206" stroke="#1d4ed8"/>
<text x="500" y="202" font-size="13" font-weight="600" fill="#101828">Technical operation</text>
<text x="500" y="219" font-size="13" fill="#667085">mechanism verbs, no outcomes</text>
<circle cx="464" cy="350" r="3" fill="#1d4ed8"/>
<line x1="464" y1="350" x2="492" y2="350" stroke="#1d4ed8"/>
<text x="500" y="346" font-size="13" font-weight="600" fill="#101828">Technical effect</text>
<text x="500" y="363" font-size="13" fill="#667085">recited as a wherein limitation</text>
</svg><figcaption>Fig. 1 — Anatomy of a granted-style Indian software claim. The claim is hypothetical, drafted for this article.</figcaption></figure>

<h2>Which claim formats grant, and which get objected to?</h2>

<p>Format matters in India more than newcomers expect, because Section 3(k) objections attach to form as well as substance. The table reflects common treatment in Indian prosecution; individual outcomes vary with the invention and the examiner.</p>

<table>
  <thead>
    <tr><th>Claim format</th><th>Typical treatment in India</th></tr>
  </thead>
  <tbody>
    <tr><td>Computer-implemented method</td><td>The workhorse. Grants when the technical problem, solution and effect are in the claim</td></tr>
    <tr><td>System (processor + memory + configured-to modules)</td><td>Grants alongside the method claim it mirrors; rarely stands alone</td></tr>
    <tr><td>Computer-readable medium (Beauregard-style)</td><td>Routinely objected to as a computer programme per se; commonly dropped during prosecution</td></tr>
    <tr><td>Use claim ("use of a neural network to…")</td><td>Disfavoured in Indian practice; usually recast as a method claim</td></tr>
    <tr><td>Means-plus-function</td><td>Rare in modern Indian software drafting; configured-to language has displaced it</td></tr>
  </tbody>
</table>

<p>The CRM row deserves emphasis because it surprises applicants arriving from US practice, where the format is standard. In India it is treated as claiming the program itself and tends to draw the objection regardless of how technical the stored instructions are. Most applicants delete CRM claims in the first response rather than fight for them. Verify the current examination position on <a href="https://www.ipindia.gov.in/">ipindia.gov.in</a>, as the guidance on computer-related inventions has been revised more than once.</p>

<h2>What language shows up in refused claims?</h2>

<p>Refusals have a vocabulary of their own. Three habits recur in software patent claims that do not survive Indian examination:</p>

<ul>
  <li><strong>Business nouns in the steps.</strong> Customer, order, price, offer, loyalty, discount. Each one signals that the claimed contribution lives in commerce rather than engineering, and each is an invitation to the business-method limb of Section 3(k).</li>
  <li><strong>Results-only verbs.</strong> Optimising delivery, improving accuracy, maximising engagement — steps that state the goal and skip the mechanism. An examiner reads these as claiming the result itself, which no office allows.</li>
  <li><strong>"Based on AI" hand-waving.</strong> Using machine learning, based on artificial intelligence, leveraging a neural network — phrases that name a technology instead of reciting what it does in the system. They do no eligibility work and invite the algorithm-per-se objection.</li>
</ul>

<p>None of these habits is fatal in a specification — the description can and should explain the commercial context. They become fatal when they migrate into the claims, because the claims are where Section 3(k) is applied.</p>

<h2>How should this change how you draft?</h2>

<p>Work backwards from the granted pattern instead of forwards from the disclosure. Before writing software patent claims for an Indian filing, fix four decisions: the technical problem the preamble will name; the device-level actors that will anchor each step; the wherein clause that will carry the effect; and the ten claims that matter most, because the excess-claim fee makes every claim above ten a purchase. Then draft the method claim, mirror it as a system claim, and stop.</p>

<p>Two companion pieces go deeper: <a href="/blog/software-patents-in-india-section-3k">software patents in India: claims that survive Section 3(k)</a> covers the eligibility law and rewrites refused-style claims into allowable ones, and <a href="/blog/how-to-write-patent-claims">how to write patent claims</a> covers claim mechanics generally. If AI is drafting your first version, the failure modes described in <a href="/blog/ai-patent-drafting">AI patent drafting: what it does well, and where it fails</a> apply with extra force here — models trained on US-style corpora reproduce exactly the formats and phrasing India objects to.</p>

<figure><svg viewBox="0 0 760 420" role="img" aria-label="Method claim and system claim shown side by side with arrows mapping corresponding elements" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif"><title>Method claim and system claim shown side by side with arrows mapping corresponding elements</title>
<defs><marker id="arrow-pair" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1d4ed8"/></marker></defs>
<rect x="24" y="40" width="330" height="356" rx="8" fill="#fff" stroke="#e4e7ec"/>
<text x="189" y="74" text-anchor="middle" font-size="15" font-weight="600" fill="#101828">Claim 1 — method</text>
<rect x="40" y="96" width="298" height="56" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="56" y="120" font-size="13" fill="#344054">receiving a stream of events</text>
<text x="56" y="138" font-size="13" fill="#344054">at a processor</text>
<rect x="40" y="168" width="298" height="56" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="56" y="192" font-size="13" fill="#344054">extracting a feature vector</text>
<text x="56" y="210" font-size="13" fill="#344054">from each event</text>
<rect x="40" y="240" width="298" height="56" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="56" y="264" font-size="13" fill="#344054">discarding raw events</text>
<text x="56" y="282" font-size="13" fill="#344054">after extraction</text>
<rect x="40" y="312" width="298" height="56" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="56" y="336" font-size="13" fill="#344054">wherein memory stays within</text>
<text x="56" y="354" font-size="13" fill="#344054">a fixed budget</text>
<rect x="406" y="40" width="330" height="356" rx="8" fill="#fff" stroke="#e4e7ec"/>
<text x="571" y="74" text-anchor="middle" font-size="15" font-weight="600" fill="#101828">Claim 8 — system</text>
<rect x="422" y="96" width="298" height="56" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="438" y="120" font-size="13" fill="#344054">a processor configured to</text>
<text x="438" y="138" font-size="13" fill="#344054">receive the stream of events</text>
<rect x="422" y="168" width="298" height="56" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="438" y="192" font-size="13" fill="#344054">an extraction module configured</text>
<text x="438" y="210" font-size="13" fill="#344054">to extract the feature vector</text>
<rect x="422" y="240" width="298" height="56" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="438" y="264" font-size="13" fill="#344054">a buffer manager configured to</text>
<text x="438" y="282" font-size="13" fill="#344054">discard raw events</text>
<rect x="422" y="312" width="298" height="56" rx="8" fill="#f7f8fa" stroke="#e4e7ec"/>
<text x="438" y="336" font-size="13" fill="#344054">a memory sized such that usage</text>
<text x="438" y="354" font-size="13" fill="#344054">stays within the fixed budget</text>
<line x1="338" y1="124" x2="418" y2="124" stroke="#1d4ed8" marker-end="url(#arrow-pair)"/>
<line x1="338" y1="196" x2="418" y2="196" stroke="#1d4ed8" marker-end="url(#arrow-pair)"/>
<line x1="338" y1="268" x2="418" y2="268" stroke="#1d4ed8" marker-end="url(#arrow-pair)"/>
<line x1="338" y1="340" x2="418" y2="340" stroke="#1d4ed8" marker-end="url(#arrow-pair)"/>
</svg><figcaption>Fig. 2 — The method + system mirror: each method step corresponds to a configured-to element in the system claim.</figcaption></figure>

<h2>What role does the case law play?</h2>

<p>Three Delhi High Court decisions frame modern Indian practice. <em>Ferid Allani v. Union of India</em> (2019) established that a claim demonstrating a technical effect or technical contribution is patentable even when implemented in software — the foundation the granted pattern rests on. <em>Microsoft Technology Licensing v. Assistant Controller of Patents</em> (2023) reversed refusals where the claims made a technical contribution, pushing examination toward substance over form. <em>Lava v. Ericsson</em> (2024) upheld telecom claims drafted at the implementation level — claims that look exactly like the anatomy described above, with device-level actors and the effect in the body.</p>

<p>None of these decisions changed what granted claims look like; they ratified it. The pattern existed in allowed files first, and the courts have progressively aligned examination with it. For the statutory text and current examination guidance, go to <a href="https://www.ipindia.gov.in/">ipindia.gov.in</a>; for comparative material on how other offices treat computer-implemented inventions, <a href="https://www.wipo.int/">wipo.int</a> is the neutral starting point.</p>

<p>The honest caveat is the one from the top: these are qualitative patterns from practice and case law, not measured claim statistics. They are still the closest thing to a map that Indian software prosecution offers. Study granted claims in your own technical field — <a href="/patent-search">patent search</a> will surface them — and let the files that survived examination teach you what software patent claims in India actually need to say.</p>
`,
}
