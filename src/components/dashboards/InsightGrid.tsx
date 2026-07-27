'use client'

import { useRouter } from 'next/navigation'
import { FolderKanban, Lightbulb, FileText, Search, ArrowRight } from 'lucide-react'

interface IdeaBankStats {
  totalIdeas: number
  publicIdeas: number
  reservedIdeas: number
  userReservations: number
}

interface NoveltySearchHistoryItem {
  id: string
  title: string
  status: string
  createdAt: string
  completedAt?: string
  results?: any
}

interface InsightGridProps {
  projectsCount: number
  draftsCount: number
  ideaStats: IdeaBankStats | null
  noveltyHistory: NoveltySearchHistoryItem[]
}

// Pure presentation: all data arrives via props from UserDashboard's single fetch.
export default function InsightGrid({ projectsCount, draftsCount, ideaStats, noveltyHistory }: InsightGridProps) {
  const router = useRouter()

  const latestNovelty = (() => {
    if (noveltyHistory.length === 0) return null
    const latest = noveltyHistory[0]
    return {
      title: latest.title,
      patentCount: latest.results?.stage1?.patentCount || 0,
      completedAt: latest.completedAt
    }
  })()

  const cards = [
    {
      id: 'projects',
      icon: FolderKanban,
      title: 'Active Projects',
      value: projectsCount.toString(),
      label: projectsCount === 1 ? 'Project' : 'Projects',
      description: projectsCount > 0 ? 'Open a project to see its patents' : 'Create your first project',
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
      navigateTo: '/projects'
    },
    {
      id: 'ideas',
      icon: Lightbulb,
      title: 'Ideas Captured',
      value: ideaStats ? String(ideaStats.totalIdeas || 0) : '0',
      label: ideaStats?.totalIdeas === 1 ? 'Idea' : 'Ideas',
      description: ideaStats ? `${ideaStats.userReservations} reserved by you` : 'No ideas yet',
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
      navigateTo: '/idea-bank'
    },
    {
      id: 'drafts',
      icon: FileText,
      title: 'Drafts in Progress',
      value: draftsCount.toString(),
      label: draftsCount === 1 ? 'Draft' : 'Drafts',
      description: draftsCount > 0 ? 'Resume from your projects' : 'Start your first draft',
      color: 'text-primary',
      bgColor: 'bg-accent',
      navigateTo: draftsCount > 0 ? '/projects' : '/patents/draft/new'
    },
    {
      id: 'novelty',
      icon: Search,
      title: 'Novelty Searches',
      value: noveltyHistory.length.toString(),
      label: noveltyHistory.length === 1 ? 'Report' : 'Reports',
      description: latestNovelty ? `Latest: ${latestNovelty.patentCount} citations found` : 'No searches yet',
      color: 'text-lamp-600',
      bgColor: 'bg-lamp-50',
      navigateTo: '/novelty-search/history'
    }
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className="group relative bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md hover:border-primary/40 transition-all duration-300 cursor-pointer overflow-hidden text-left"
          onClick={() => router.push(card.navigateTo)}
        >
          <div className="relative z-10 flex flex-col h-full justify-between">
            <div className="flex justify-between items-start mb-4">
              <div className={`p-2.5 rounded-lg ${card.bgColor} ${card.color} transition-colors`}>
                <card.icon className="w-5 h-5" />
              </div>
              <div className="flex items-center text-slate-300 group-hover:text-primary transition-colors">
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>

            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl font-bold text-foreground tracking-tight tabular-nums">
                  {card.value}
                </span>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {card.label}
                </span>
              </div>
              <h3 className="text-sm font-medium text-foreground mb-1">
                {card.title}
              </h3>
              <p className="text-xs text-muted-foreground truncate">
                {card.description}
              </p>
            </div>
          </div>

          {/* Subtle colored glow on hover */}
          <div className={`absolute -bottom-10 -right-10 w-32 h-32 ${card.bgColor} rounded-full opacity-0 group-hover:opacity-50 transition-opacity duration-500 blur-2xl`} />
        </button>
      ))}
    </div>
  )
}
