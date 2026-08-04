import type { Metadata } from 'next'
import { WhitespaceStudyRouter } from '@/components/whitespace/WhitespaceStudyRouter'

export const metadata: Metadata = {
  title: 'Study · Whitespace Studio · PatentNest',
  description:
    'Review and correct the research scope, then map the field: how much has been filed, by whom, where, and how much of it we can actually read.',
}

export default function WhitespaceStudyPage({ params }: { params: { studyId: string } }) {
  return <WhitespaceStudyRouter studyId={params.studyId} />
}
