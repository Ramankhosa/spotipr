import type { Metadata } from 'next'
import { WhitespaceStudiesApp } from '@/components/whitespace/WhitespaceStudiesApp'

export const metadata: Metadata = {
  title: 'Whitespace Studio · PatentNest',
  description:
    'Map a technology field, find where it is crowded and where it is not, and turn the openings into evidence-backed invention hypotheses that the system then tries to disprove.',
}

export default function WhitespacePage() {
  return <WhitespaceStudiesApp />
}
