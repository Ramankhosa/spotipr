import type { PostSeed } from '../types'

export const post: PostSeed = {
  slug: 'provisional-vs-complete-specification',
  categorySlug: 'patent-basics',
  publishedDaysAgo: 24,
  title: 'Provisional application or complete specification: which first?',
  subtitle:
    'What a provisional actually protects, when the twelve-month clock helps you, and the three mistakes that make a priority date worthless.',
  excerpt:
    'A provisional application is cheap insurance or an expensive illusion, depending entirely on what it discloses. Here is how to decide which application to file first — in the US and in India — and how to write a provisional that will still hold up a year later.',
  answerSummary:
    'File a provisional first when the invention is still evolving, you need a priority date before a disclosure or investor meeting, or you want twelve months to test the market. File a complete application first when the invention is settled and you want examination to start immediately. A provisional only protects what it actually describes — a two-page placeholder will not support the claims you file a year later.',
  keyTakeaways: [
    'A provisional application is never examined and never becomes a patent; it reserves a priority date for twelve months, after which it lapses unless you file a complete application claiming its benefit.',
    'Your provisional supports only what it discloses. Claims filed later that go beyond the provisional get the later date, and the year you waited becomes prior art against you.',
    'In India the equivalent is a provisional specification, and the complete specification must be filed within 12 months or the application is deemed abandoned — the same 12-month window governs a PCT or Paris Convention filing from that priority date.',
    'The twelve-month provisional year is also the window in which competitors can file. A provisional does not stop anyone else from filing; it only beats them on date for what you disclosed.',
    'The strongest reason to file a provisional is a hard external deadline — a conference presentation, a pitch, a product launch — where you need a date before you disclose.',
    'The strongest reason to skip it is a settled invention plus a desire for a granted patent sooner, since the provisional year is added to an already long examination queue.',
  ],
  faqs: [
    {
      question: 'Is a provisional patent application a patent?',
      answer:
        'No, and the phrase "provisional patent" is misleading. It is an application that establishes a priority date and is never examined, never published on its own, and never granted. It gives you the right to say "patent pending" and the right to claim its date in a later complete application filed within twelve months.',
    },
    {
      question: 'Can I file a provisional without claims?',
      answer:
        'In the US, yes — claims are not required in a provisional, though including at least one is good discipline because it forces you to articulate what you think the invention is. In India, a provisional specification also does not require claims. In both cases the description is what does the work: it must enable a skilled person to make and use the invention, and support whatever you later claim.',
    },
    {
      question: 'What happens if I miss the twelve-month deadline?',
      answer:
        'The provisional lapses and its priority date is lost. In the US there is a limited restoration route within a further two months where the delay was unintentional, at a fee. In India, failing to file the complete specification within twelve months means the application is deemed abandoned. Neither situation is one to plan around — diarise the date the moment you file.',
    },
    {
      question: 'Can I file more than one provisional and combine them?',
      answer:
        'Yes, and it is a common and sensible strategy for inventions that develop in stages. A later complete application can claim priority from several provisionals, with each feature getting the date of the provisional that first disclosed it. Keep clear records of what was in which filing, because that is exactly what will be examined if the priority claim is ever challenged.',
    },
    {
      question: 'Does a provisional protect me if someone copies my invention?',
      answer:
        'Not directly. You cannot sue on a provisional — there are no enforceable claims until a patent grants. What it does is secure your place in the queue: if a competitor files after your provisional date for the same invention, your earlier date is what defeats their application. Practical protection during the pending period comes from confidentiality, contracts and speed to market.',
    },
  ],
  focusKeyword: 'provisional application',
  secondaryKeywords: [
    'provisional patent application',
    'provisional specification india',
    'priority date',
    'do i need a provisional patent',
    'complete specification',
  ],
  tags: ['filing-strategy', 'provisional', 'india', 'uspto'],
  jurisdictions: ['US', 'IN', 'PCT'],
  seoTitle: 'Provisional application or complete specification: which first?',
  seoDescription:
    'When to file a provisional patent application versus a complete specification, what a priority date really protects, and how to write a provisional that holds up twelve months later.',
  relatedSlugs: ['patent-cost', 'how-long-does-a-patent-take', 'how-to-do-a-prior-art-search'],
  content: `
<p>The provisional application is the most misunderstood instrument in patent practice. It is sold as "cheap protection", which is half true, and treated as a placeholder you can fill in later, which is not true at all.</p>

<p>Here is the accurate mental model: <strong>a provisional is a dated, sealed envelope containing a technical disclosure.</strong> Twelve months later you may point at that envelope and say "this is when I had it". Whatever is inside the envelope, you get the early date for. Whatever is not inside, you do not. Nothing about the filing fee, the page count or your intentions changes that.</p>

<h2>What is a provisional application, exactly?</h2>

<p>In the US, a provisional application is a filing under 35 U.S.C. §111(b) that establishes a filing date without triggering examination. It is never examined, never published, and expires twelve months after filing. Its only function is to be claimed as priority by a later non-provisional application.</p>

<p>India has a closely equivalent instrument. Under the Patents Act 1970 you may file a <em>provisional specification</em> describing the invention, and you must follow it with a <em>complete specification</em> within twelve months — otherwise the application is deemed abandoned. Both routes rest on the same Paris Convention principle: twelve months of priority from your first filing anywhere.</p>

<table>
  <thead>
    <tr><th></th><th>Provisional</th><th>Complete / non-provisional</th></tr>
  </thead>
  <tbody>
    <tr><td>Examined?</td><td>Never</td><td>Yes</td></tr>
    <tr><td>Claims required?</td><td>No</td><td>Yes</td></tr>
    <tr><td>Published?</td><td>No (only via a later application)</td><td>At 18 months from priority</td></tr>
    <tr><td>Can become a patent?</td><td>No</td><td>Yes</td></tr>
    <tr><td>Life</td><td>12 months, then lapses</td><td>20 years from filing</td></tr>
    <tr><td>USPTO official fee (micro entity)</td><td>from $130</td><td>$664 at the filing stage</td></tr>
    <tr><td>India official fee (natural person / startup / small entity)</td><td>₹1,600</td><td>₹1,600 + ₹4,000 examination request</td></tr>
  </tbody>
</table>

<p>The governing rules are published by the <a href="https://www.uspto.gov/patents/basics/types-patent-applications/provisional-application-patent">USPTO</a> for a US provisional application and by the <a href="https://ipindia.gov.in/">Indian Patent Office</a> for a provisional specification. One useful property of a US provisional application: it is never published on its own, so it stays confidential unless a later application claiming it goes on to publish.</p>

<h2>When should you file a provisional application first?</h2>

<p>There are four situations where it is clearly the right call.</p>

<h3>You have a disclosure deadline you cannot move</h3>

<p>A conference paper, a demo day, a trade show, an investor meeting without an NDA, a journal submission. Public disclosure before filing destroys novelty in most of the world immediately — the US and India both offer a twelve-month grace period for the inventor's own disclosure, but Europe and China do not. If you are about to speak, file first. This is the strongest argument for a provisional and it is not really about cost at all; it is about the calendar.</p>

<h3>The invention is still moving</h3>

<p>If you expect the implementation to change materially over the next six months, a provisional lets you fix a date on what you have now and file the complete specification once the design has settled — optionally adding further provisionals along the way and claiming priority from all of them.</p>

<h3>You need to test the market before committing</h3>

<p>The complete application, examination request and prosecution are where the money goes. Twelve months of "patent pending" while you find out whether anyone will buy the thing is a legitimate and common use of the mechanism, particularly for solo inventors and pre-seed startups. Budget context is in <a href="/blog/patent-cost">how much a patent costs</a>.</p>

<h3>You want the priority date now and the search done properly later</h3>

<p>Filing a provisional does not excuse you from searching — but it does let you secure a date and then spend two or three months doing the prior-art work properly before you decide what to claim. Many of the best filings we see follow exactly this order.</p>

<h2>When should you skip it and file complete?</h2>

<ul>
  <li><strong>The invention is finished and documented.</strong> If the specification is going to say the same thing in twelve months, the provisional year buys nothing and costs a year of term at the far end.</li>
  <li><strong>You want a granted patent quickly.</strong> The queue is already 20–26 months at the USPTO. Adding twelve months means a grant in year four. If speed matters — a licensing conversation, an acquisition, an enforcement problem — file complete and consider accelerated examination. See <a href="/blog/how-long-does-a-patent-take">how long a patent takes</a>.</li>
  <li><strong>You are filing in India as your first filing and want the RFE clock to start.</strong> The 31-month examination request deadline runs from priority, so a provisional consumes twelve months of that window.</li>
  <li><strong>The budget difference is not decisive.</strong> The provisional saves official fees, but if your attorney drafts it properly — which is the only way it works — the drafting cost is most of the eventual cost anyway.</li>
</ul>

<h2>The three mistakes that make a provisional application worthless</h2>

<h3>1. Filing a description of the goal instead of the invention</h3>

<p>The most common failure by a wide margin. A provisional that says "a system that uses machine learning to detect fraud in real time" discloses an objective, not an invention. Twelve months later, when the complete application claims a specific architecture, that architecture was not in the envelope — so it gets the later date, and anything published in the intervening year is prior art against it.</p>

<p>The test is enablement: <strong>could a skilled engineer in your field build it from your document alone?</strong> If not, the priority claim will not hold where it matters.</p>

<h3>2. Assuming the provisional covers later improvements</h3>

<p>It does not. Priority is claim by claim, feature by feature. If the complete application claims a refinement you invented in month eight, that claim has the complete application's date. This is manageable — file a second provisional when the refinement appears — but only if you know it is happening.</p>

<h3>3. Treating the year as free time</h3>

<p>The provisional year is when your competitors are also filing, your own disclosures are accumulating, and your priority window for every other country is running. Twelve months from your provisional you must file not only the complete application but any PCT or foreign applications relying on that priority. Diarise it as a hard date the day you file.</p>

<aside class="note"><strong>India-specific trap.</strong> The complete specification in India must not go beyond the scope of the provisional's disclosure — new matter cannot claim the provisional date. In addition, if you are resident in India, you generally need a foreign filing licence (or must wait six weeks after an Indian filing) before filing abroad. Section 39 breaches are not fixable after the fact.</aside>

<h2>How do you write a provisional application that will hold up?</h2>

<p>Write it as though it were the complete specification, then stop before the claims. Concretely:</p>

<ol>
  <li><strong>Describe the problem and at least one full working embodiment</strong> — components, how they interact, materials, parameters, ranges, the sequence of operations.</li>
  <li><strong>Include the alternatives you can foresee.</strong> "In one embodiment X is a neural network; in another, a decision tree" costs one sentence and preserves scope you would otherwise lose.</li>
  <li><strong>Draw it.</strong> Figures cost nothing at the provisional stage and carry an enormous amount of disclosure.</li>
  <li><strong>Give numbers.</strong> Real values, tolerances, test results. Data in a provisional is often what rescues an inventive-step argument three years later.</li>
  <li><strong>Write at least one claim anyway.</strong> Not required, but the discipline of stating exactly what you think is new exposes the gaps in the description while there is still time to fill them.</li>
  <li><strong>Search before you finalise.</strong> Knowing the closest art changes what you emphasise. <a href="/blog/how-to-do-a-prior-art-search">How to run a prior-art search</a> covers the method.</li>
</ol>

<h2>The decision, in one line</h2>

<p>File a provisional if the calendar is forcing your hand or the invention is still moving — and write it as if it were the real thing. File complete if the invention is settled and you want the patent sooner. The one option that never works is filing a thin provisional to "reserve the idea": ideas are not what a priority date attaches to. Disclosure is.</p>
`,
}
