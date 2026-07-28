import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'software-patent-eligibility',
  categorySlug: 'drafting-and-claims',
  publishedDaysAgo: 60,
  title: 'Are software patents allowed in 2026? US, EPO and India',
  subtitle:
    'The eligibility test in the US, Europe and India — and the drafting decisions that put an AI invention on the right side of it.',
  excerpt:
    'Software is patentable in all three major jurisdictions, but each applies a different filter: Alice/Mayo in the US, technical character at the EPO, and Section 3(k) in India. Here is what each actually requires and how to draft for all three.',
  answerSummary:
    'Yes — software and AI inventions are patentable in the US, Europe and India, but not when claimed as an abstract idea or algorithm alone. Each office asks a version of the same question: does the claim deliver a concrete technical improvement rather than a result? US practice applies the Alice/Mayo two-step, the EPO requires technical character and a technical contribution, and India requires a technical effect under Section 3(k). The drafting answer is the same everywhere: claim the implementation, not the objective.',
  keyTakeaways: [
    'No major jurisdiction bans software patents. All three bar the same thing: claiming an abstract idea, mathematical method or business method with no technical implementation.',
    'US practice runs the Alice/Mayo two-step, and the USPTO’s July 2024 guidance update confirmed that AI inventions are judged under the existing framework, with practical-application examples 47–49 to work from.',
    'The EPO does not ask whether the invention is software; it asks whether the claim has technical character and whether the distinguishing features make a technical contribution — non-technical features get no weight in the inventive-step analysis.',
    'India’s CRI Guidelines 2025, issued on 29 July 2025, made technical effect the anchor of Section 3(k) analysis and confirmed that novel hardware is not required — but business methods remain absolutely barred.',
    'The one drafting move that helps in all three offices is to state, in the specification, exactly what technical problem is solved and how — then to recite that mechanism in the claim.',
    'Improvements to how a computer works (memory use, latency, power, security, network efficiency) are the safest ground; improvements to what a business achieves are the hardest.',
  ],
  faqs: [
    {
      question: 'Can you patent an algorithm?',
      answer:
        'Not as pure mathematics. A mathematical method as such is excluded in every major jurisdiction. What is patentable is the application of that method to produce a specific technical effect — the same equation applied to control an industrial process, reduce memory consumption or improve signal quality can be claimed through the technical implementation that achieves it.',
    },
    {
      question: 'Can you patent a machine learning model?',
      answer:
        'You can patent the technical system that trains or applies it, and specific technical improvements in how it is trained, compressed, deployed or secured. What you cannot do is claim "a neural network that predicts X" and expect it to survive: that is a result plus a well-known tool. Both the USPTO’s 2024 AI guidance and India’s CRI Guidelines 2025 also expect a much fuller technical disclosure for AI cases than a generic architecture description.',
    },
    {
      question: 'Does adding "on a computer" make an abstract idea patentable?',
      answer:
        'No, and this is the specific holding of Alice v CLS Bank. Generic computer implementation of a known process is the paradigm case of ineligibility in the US, and the EPO and Indian offices reach the same conclusion by different routes. The computer has to be doing something technically different, not merely doing an old thing faster.',
    },
    {
      question: 'Is a business method patentable anywhere?',
      answer:
        'Pure business methods are barred outright in India under Section 3(k) and excluded as such at the EPO. In the US they are not categorically excluded, but after Alice they face the hardest version of the eligibility test and most fail. If your invention is genuinely a commercial process rather than a technical one, patents are usually the wrong instrument.',
    },
    {
      question: 'Should I file in the US, Europe or India first for a software invention?',
      answer:
        'Draft to the strictest standard you plan to face — usually the EPO’s technical-contribution requirement — because a specification written for it will generally satisfy the others, whereas the reverse is not true. Where to file first is a commercial question about markets and budget, but the drafting decision should be made once, at the start, for the whole family.',
    },
  ],
  focusKeyword: 'software patents',
  secondaryKeywords: [
    'software patent eligibility',
    'are software patents allowed',
    'ai patent eligibility',
    'alice test',
    'section 3(k) india',
    'epo technical effect',
  ],
  tags: ['eligibility', 'software', 'artificial-intelligence', 'india', 'epo'],
  jurisdictions: ['US', 'EP', 'IN'],
  seoTitle: 'Are software patents allowed in 2026? US, EPO and India',
  seoDescription:
    'Software and AI patent eligibility in the US, Europe and India: the Alice/Mayo test, EPO technical character, India’s Section 3(k) and CRI Guidelines 2025 — with drafting rules.',
  relatedSlugs: ['how-to-write-patent-claims', 'ai-patent-drafting', 'how-to-respond-to-an-office-action'],
  content: `
<p>"Are software patents allowed?" has a short answer — yes, everywhere that matters — and a long one that is worth considerably more, because what separates a granted software patent from a rejected one is almost never the technology. It is how the claim was written.</p>

<p>Three offices, three legal tests, one underlying question: <em>does this claim describe a technical way of doing something, or does it describe wanting something done?</em></p>

<h2>The United States: the Alice/Mayo two-step</h2>

<p>US eligibility runs through 35 U.S.C. §101 as interpreted in <em>Alice Corp. v CLS Bank</em> (2014) and applied through the USPTO's Patent Eligibility Guidance. Examiners work two steps:</p>

<ol>
  <li><strong>Step 2A:</strong> Is the claim directed to a judicial exception — an abstract idea, law of nature or natural phenomenon? Abstract ideas are grouped into mathematical concepts, methods of organising human activity, and mental processes. <em>Prong two</em> then asks whether the claim integrates that exception into a <strong>practical application</strong>.</li>
  <li><strong>Step 2B:</strong> If not, do the additional elements amount to significantly more than the exception itself — or just "apply it" on a generic computer?</li>
</ol>

<p>The whole game is prong two of step 2A. A claim that integrates the idea into a practical application never reaches step 2B, and integration usually means an improvement to the functioning of a computer or to another technology.</p>

<p>The USPTO's <a href="https://www.uspto.gov/patents/laws/examination-policy/subject-matter-eligibility">2024 Guidance Update</a>, effective 17 July 2024, addressed AI directly. It did not create a new test; it confirmed the existing framework applies and added worked Examples 47–49. Its practical message for drafters is three-fold:</p>

<ul>
  <li>Tie the AI concept to a <strong>particular field of use</strong> in the claim itself;</li>
  <li>Explain in the <strong>specification</strong>, technically, how the invention improves the technology;</li>
  <li>Recite <strong>non-abstract limitations that reflect that improvement</strong> — the improvement must appear in the claim, not only in the argument.</li>
</ul>

<p>Which is to say: an examiner cannot credit an improvement you only described in a response letter.</p>

<p>The current guidance is published by the <a href="https://www.uspto.gov/patents/laws/examination-policy/subject-matter-eligibility">USPTO</a>, and it is worth reading Examples 47–49 in full before drafting an AI case.</p>

<h2>Europe: are software patents allowed at the EPO?</h2>

<p>Article 52(2) EPC excludes mathematical methods, business methods and "programs for computers" — but only "as such". In practice the EPO applies a two-filter approach that is more predictable than the US test, if stricter.</p>

<ol>
  <li><strong>Technical character (a low bar).</strong> Any claim reciting a computer has technical character and passes Article 52. This filter excludes almost nothing.</li>
  <li><strong>Technical contribution in the inventive step analysis (the real test).</strong> Under the COMVIK approach, features that do not contribute to a technical effect are <em>ignored</em> when assessing inventive step. A brilliant, wholly novel business rule implemented on a standard computer contributes nothing technical — so the claim is obvious over a standard computer.</li>
</ol>

<p>The <a href="https://www.epo.org/">EPO</a>'s published practice recognises technical effects such as improved memory usage, reduced processing load, better security, more efficient data transmission, and control of a physical process. What it does not credit is a better commercial outcome. "Reduces customer churn" is not technical; "reduces cache misses by restructuring the index" is.</p>

<p>For AI specifically, the EPO treats a neural network as a mathematical method, becoming technical when applied to a technical purpose (classifying heart conditions from ECG data, controlling an X-ray machine) or when the implementation itself is technically adapted to the hardware.</p>

<h2>India: Section 3(k) and the CRI Guidelines 2025</h2>

<p>Software patents in India turn on one subsection. Section 3(k) of the Patents Act 1970, administered by the <a href="https://ipindia.gov.in/">Indian Patent Office</a>, excludes "a mathematical or business method or a computer programme per se or algorithms". The words "per se" have carried a decade of litigation, and the Indian Patent Office's <strong>Guidelines for Examination of Computer Related Inventions (CRI), issued 29 July 2025</strong>, consolidate that jurisprudence into a structured framework.</p>

<p>What the 2025 guidelines settle, for drafting purposes:</p>

<ul>
  <li><strong>Technical effect is the anchor.</strong> Across all four limbs of the exclusion, the question is whether there is a concrete, measurable improvement to an underlying technical system or process.</li>
  <li><strong>Novel hardware is not required.</strong> This resolves years of inconsistent examination in which applicants were pushed to recite bespoke hardware. Software running on a general-purpose computer can be patentable if it produces a technical effect.</li>
  <li><strong>Business methods remain absolutely barred</strong> — no technical-effect argument rescues them.</li>
  <li><strong>Algorithm claims must be technically enabled</strong>, not merely procedural: a flowchart of steps is not enough.</li>
  <li><strong>AI and ML face higher disclosure expectations</strong> than under the 2017 guidelines, with a dedicated section covering AI, machine learning, deep learning, blockchain and quantum computing.</li>
</ul>

<p>That last point matters more than it sounds. An Indian AI application that describes "a machine learning model trained on historical data" and nothing more now has a disclosure problem as well as an eligibility one.</p>

<h2>How the three tests compare</h2>

<table>
  <thead>
    <tr><th></th><th>United States</th><th>EPO</th><th>India</th></tr>
  </thead>
  <tbody>
    <tr><td>Legal hook</td><td>§101 + Alice/Mayo</td><td>Art. 52(2) + COMVIK</td><td>Section 3(k) + CRI Guidelines 2025</td></tr>
    <tr><td>Where it is decided</td><td>Eligibility, before novelty</td><td>Inside inventive step</td><td>Eligibility, at examination</td></tr>
    <tr><td>Key phrase</td><td>Practical application</td><td>Technical contribution</td><td>Technical effect</td></tr>
    <tr><td>Business methods</td><td>Not categorically barred, rarely survive</td><td>Excluded as such</td><td>Absolutely barred</td></tr>
    <tr><td>Needs special hardware?</td><td>No</td><td>No</td><td>No (confirmed 2025)</td></tr>
    <tr><td>Practical difficulty</td><td>Unpredictable across art units</td><td>Strict but consistent</td><td>Improving, historically variable</td></tr>
  </tbody>
</table>

<h2>Which software patents actually get granted?</h2>

<p>Across all three jurisdictions the same categories succeed, because they are technical by their nature:</p>

<ul>
  <li><strong>Improvements to computing itself</strong> — memory management, compression, scheduling, database indexing, compiler optimisation, cache behaviour.</li>
  <li><strong>Networking and communications</strong> — protocols, error correction, congestion control, latency reduction.</li>
  <li><strong>Security and cryptography</strong> — key management, attack detection, secure execution.</li>
  <li><strong>Signal and image processing</strong> — the maths applied to a real signal for a technical purpose.</li>
  <li><strong>Control of physical systems</strong> — robotics, manufacturing, vehicles, medical devices.</li>
  <li><strong>AI with a specified technical purpose</strong> — model deployment on constrained hardware, training efficiency, sensor fusion, technical anomaly detection.</li>
</ul>

<p>And the same categories fail: recommendation of products, pricing, scheduling of human activity, matching buyers and sellers, presenting information more attractively, and "doing an existing manual process, but on a computer".</p>

<h2>Six drafting rules that work in all three offices</h2>

<ol>
  <li><strong>Name the technical problem in the first page of the description.</strong> Not the business problem. "Existing on-device inference exceeds the 2 MB SRAM budget of the target microcontroller" is a technical problem; "retailers struggle to predict demand" is not.</li>
  <li><strong>Explain the mechanism, not the outcome.</strong> How does the invention solve it? Which step, which data structure, which arrangement?</li>
  <li><strong>Put the improvement in the claim.</strong> If the technical advance lives only in the description, examiners in all three offices will decline to credit it.</li>
  <li><strong>Quantify.</strong> Concrete figures — 40% fewer memory accesses, 12 ms lower latency, 8× smaller model — turn an assertion into evidence. Include the measurement conditions.</li>
  <li><strong>Recite the technical environment specifically.</strong> Not "a processor", but the constraint that makes the invention necessary: the sensor, the network, the memory limit, the real-time deadline.</li>
  <li><strong>Avoid results-language in claims.</strong> "Configured to optimise", "so as to improve efficiency" and similar phrasings attract eligibility and clarity objections simultaneously. Claim the structure that does the optimising. More on this in <a href="/blog/how-to-write-patent-claims">how to write patent claims</a>.</li>
</ol>

<aside class="note"><strong>If you get a rejection.</strong> Eligibility rejections are argued, not conceded. In the US, the response is usually to show integration into a practical application by pointing at claim limitations that reflect a technical improvement — sometimes with an amendment that pulls the improvement from the description into the claim. At the EPO the argument is that the distinguishing features produce a technical effect. In India it is that a technical effect exists under the CRI framework. In all three, the response is far stronger if the specification already said so. See <a href="/blog/how-to-respond-to-an-office-action">responding to an office action</a>.</aside>

<h2>The short version</h2>

<p>Software and AI are patentable everywhere that matters, provided you can answer one question in a sentence: <strong>what does a computer now do better, technically, that it could not do before?</strong> If the answer is about the machine, you have a patentable invention and a drafting job. If the answer is about the business, you have a product — and probably a different form of protection to consider.</p>
`,
}
