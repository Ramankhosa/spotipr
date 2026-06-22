'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import NoveltySearchWorkflow from '@/components/novelty-search/NoveltySearchWorkflow'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import { useAuth } from '@/lib/auth-context'

export default function LegacyNoveltyStagesPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  useEffect(() => { if (!isLoading && !user) router.push('/login') }, [isLoading, user, router])
  if (isLoading) return <PageLoadingBird message="Loading novelty workflow..." />
  if (!user) return null
  return <NoveltySearchWorkflow executionMode="legacy" />
}
