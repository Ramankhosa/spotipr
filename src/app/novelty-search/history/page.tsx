'use client'

import { Suspense, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import NoveltySearchHistory from '@/components/novelty-search/NoveltySearchHistory'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import { useAuth } from '@/lib/auth-context'

export default function NoveltySearchHistoryPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  useEffect(() => { if (!isLoading && !user) router.push('/login?redirect=/novelty-search/history') }, [isLoading, user, router])
  if (isLoading) return <PageLoadingBird message="Loading novelty search history..." />
  if (!user) return null
  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6"><div className="mx-auto max-w-7xl"><Suspense fallback={<PageLoadingBird message="Loading history..." />}><NoveltySearchHistory /></Suspense></div></main>
}
