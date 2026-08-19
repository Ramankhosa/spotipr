import type { Metadata } from 'next'
import Link from 'next/link'
import WorkspaceNav from '@/components/home-v2/WorkspaceNav'
import WorkspaceFooter from '@/components/home-v2/WorkspaceFooter'
import DeveloperPortrait from '@/components/home-v2/DeveloperPortrait'

export const metadata: Metadata = {
  title: 'Developers — PatentNest.ai',
  description:
    'The people behind PatentNest.ai — the patent intelligence workspace for search, drafting, and prosecution.',
}

// Credits page for the people who build PatentNest. Linked from the homepage
// footer ("Developers", Company column). Uses the same Cobalt & Oxford shell as
// the homepage: #f6f8fd ground, white cards on paper-300 hairlines, lamp-600 as
// the only saturated colour.
//
// Portraits live in /public/images/developers. DeveloperPortrait falls back to
// initials when the file is missing, so adding a person never 404s the page.
const PEOPLE: {
  name: string
  title: string
  org: string
  location: string
  photo: string
  bio: string
}[] = [
  {
    name: 'Dr. Ramandeep Singh',
    title: 'Professor & Deputy Dean',
    org: 'Division of Research & Development, Lovely Professional University',
    location: 'Punjab, India',
    photo: '/images/developers/ramandeep-singh.jpg',
    bio: 'Leads the design and engineering of the PatentNest patent intelligence workspace — prior-art search over the Indian corpus, claim engineering, specification drafting, and office-action response.',
  },
]

export default function DevelopersPage() {
  return (
    <div className="min-h-screen bg-[#f6f8fd] font-sans text-ai-graphite-900 antialiased selection:bg-lamp-600 selection:text-white">
      <WorkspaceNav />
      <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-14 sm:px-8 lg:pt-20">
        <header className="max-w-[68ch]">
          <p className="mb-3 flex items-center gap-3 text-[11.5px] font-medium uppercase tracking-[0.16em] text-lamp-600">
            <span className="h-px w-7 bg-lamp-600/50" />
            Developers
          </p>
          <h1 className="text-[clamp(28px,3.5vw,40px)] font-semibold leading-[1.1] tracking-[-0.026em]">
            The people behind <span className="text-lamp-600">PatentNest</span>
          </h1>
          <p className="mt-5 text-[16px] leading-[1.62] text-paper-600">
            PatentNest is built by researchers and engineers working at the intersection of
            intellectual property practice and applied machine learning.
          </p>
        </header>

        <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PEOPLE.map((p) => (
            <li
              key={p.name}
              className="rounded-xl border border-paper-300 bg-white p-6 transition-colors hover:border-lamp-300"
            >
              <DeveloperPortrait name={p.name} src={p.photo} />
              <h2 className="mt-5 text-[17px] font-semibold tracking-[-0.015em] text-ai-graphite-900">
                {p.name}
              </h2>
              <p className="mt-1 text-[13.5px] font-medium text-lamp-600">{p.title}</p>
              <p className="mt-1.5 text-[13px] leading-[1.55] text-paper-600">{p.org}</p>
              <p className="mt-0.5 text-[12.5px] text-paper-500">{p.location}</p>
              <p className="mt-4 border-t border-paper-200 pt-4 text-[13.5px] leading-[1.6] text-ai-graphite-700">
                {p.bio}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-12 border-t border-paper-300 pt-6">
          <Link
            href="/developers/patent-api"
            className="text-[13.5px] font-medium text-lamp-600 hover:text-lamp-700"
          >
            Developer documentation for the Patent Intelligence API &rarr;
          </Link>
        </div>
      </main>
      <WorkspaceFooter />
    </div>
  )
}
