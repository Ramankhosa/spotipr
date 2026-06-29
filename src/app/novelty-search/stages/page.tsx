'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageLoadingBird } from '@/components/ui/loading-bird'

export default function LegacyNoveltyStagesPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/novelty-search') }, [router])
  return <PageLoadingBird message="Opening novelty search..." />
}
