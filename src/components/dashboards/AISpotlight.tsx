'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, ArrowRight, Sparkles } from 'lucide-react'

interface LatestDraft {
  id: string
  title: string
}

interface AISpotlightProps {
  draftsCount: number
  latestDraft?: LatestDraft | null
  latestNoveltySearch?: any
  userReservations: number
}

export default function AISpotlight({ draftsCount, latestDraft, latestNoveltySearch, userReservations }: AISpotlightProps) {
  const router = useRouter()
  const [isVisible, setIsVisible] = useState(true)

  // Deterministic priority: unfinished work first, then fresh results, then a starting point.
  const suggestion = (() => {
    if (draftsCount > 0 && latestDraft) {
      return {
        title: 'Pick up your draft',
        message: `"${latestDraft.title}" is waiting${draftsCount > 1 ? `, along with ${draftsCount - 1} other draft${draftsCount > 2 ? 's' : ''}` : ''}. Continue where you left off.`,
        actions: [
          { label: 'Continue drafting', action: () => router.push(`/patents/${latestDraft.id}/draft`) },
          { label: 'View all projects', action: () => router.push('/projects') }
        ]
      }
    }

    if (latestNoveltySearch) {
      const patentCount = latestNoveltySearch.patentCount || latestNoveltySearch.results?.stage1?.patentCount || 0
      if (patentCount > 0) {
        const title = latestNoveltySearch.title ?? 'Untitled search'
        return {
          title: 'Your novelty results are in',
          message: `"${title.length > 40 ? `${title.substring(0, 40)}…` : title}" found ${patentCount} citation${patentCount === 1 ? '' : 's'}. Review the report to decide your next step.`,
          actions: [
            { label: 'View report', action: () => router.push(`/novelty-search/${latestNoveltySearch.id}/pdf`) },
            { label: 'New search', action: () => router.push('/novelty-search') }
          ]
        }
      }
    }

    if (userReservations > 0) {
      return {
        title: 'You have reserved ideas',
        message: `${userReservations} idea${userReservations === 1 ? ' is' : 's are'} reserved by you. Run a novelty check or turn one into a draft.`,
        actions: [
          { label: 'Open idea bank', action: () => router.push('/idea-bank') },
          { label: 'Start a draft', action: () => router.push('/patents/draft/new') }
        ]
      }
    }

    return {
      title: 'Start with your idea',
      message: 'Describe your invention and we’ll structure it, check the prior art, and draft the application with you.',
      actions: [
        { label: 'Start a draft', action: () => router.push('/patents/draft/new') },
        { label: 'Run a novelty check', action: () => router.push('/novelty-search') }
      ]
    }
  })()

  if (!isVisible) return null

  return (
    <div className="relative bg-card border border-border rounded-xl p-6 shadow-sm overflow-hidden">
      {/* Decorative Elements */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-accent rounded-bl-full opacity-50 pointer-events-none" />

      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="w-5 h-5" />
          <h3 className="font-semibold text-sm uppercase tracking-wider">Suggestion</h3>
        </div>
        <button
          onClick={() => setIsVisible(false)}
          aria-label="Dismiss suggestion"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <h4 className="text-lg font-bold text-foreground mb-2">
        {suggestion.title}
      </h4>

      <p className="text-muted-foreground text-sm leading-relaxed mb-6">
        {suggestion.message}
      </p>

      <div className="flex flex-col gap-3">
        {suggestion.actions.map((action, index) => (
          <button
            key={index}
            onClick={action.action}
            className={`
              w-full flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200
              ${index === 0
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm hover:shadow-md'
                : 'bg-muted/50 text-foreground hover:bg-muted border border-border'
              }
            `}
          >
            {action.label}
            {index === 0 && <ArrowRight className="w-4 h-4" />}
          </button>
        ))}
      </div>
    </div>
  )
}
