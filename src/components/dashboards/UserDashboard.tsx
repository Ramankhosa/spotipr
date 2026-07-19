'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import InsightGrid from './InsightGrid'
import AISpotlight from './AISpotlight'
import ActivityFeed from './ActivityFeed'
import KishoWidget from './KishoWidget'
import LoadingBird from '../ui/loading-bird'
import { motion } from 'framer-motion'
import {
  Sparkles,
  Plus,
  Search,
  ScanSearch,
  Lightbulb,
  FileText,
  History,
  Files,
  ArrowRight,
  PenLine,
  FolderKanban
} from 'lucide-react'

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

interface DraftInProgress {
  id: string
  title: string
  status: string
  projectName: string
  updatedAt?: string
}

export default function UserDashboard() {
  const { user } = useAuth()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [projectsList, setProjectsList] = useState<any[]>([])
  const [ideaStats, setIdeaStats] = useState<IdeaBankStats | null>(null)
  const [noveltyHistory, setNoveltyHistory] = useState<NoveltySearchHistoryItem[]>([])
  const [commandText, setCommandText] = useState('')
  const userId = user?.user_id || user?.email

  const fetchDashboardData = useCallback(async () => {
    const authHeaders = {
      'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
    }

    // One fetch per endpoint, in parallel; results are shared with every widget below.
    const [ideaResult, projectsResult, noveltyResult] = await Promise.allSettled([
      fetch('/api/idea-bank/stats', { headers: authHeaders }),
      fetch('/api/projects', { headers: authHeaders }),
      fetch('/api/novelty-search/history', { headers: authHeaders })
    ])

    if (ideaResult.status === 'fulfilled' && ideaResult.value.ok) {
      const ideaData = await ideaResult.value.json()
      setIdeaStats(ideaData.stats || null)
    }

    if (projectsResult.status === 'fulfilled' && projectsResult.value.ok) {
      const projectsData = await projectsResult.value.json()
      setProjectsList(projectsData.projects || [])
    }

    if (noveltyResult.status === 'fulfilled' && noveltyResult.value.ok) {
      const noveltyData = await noveltyResult.value.json()
      setNoveltyHistory(noveltyData.history || [])
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const initialize = async () => {
      setIsLoading(true)
      try {
        await fetchDashboardData()
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    initialize()
    return () => {
      cancelled = true
    }
  }, [userId, fetchDashboardData])

  // Derived data — computed once, shared by the stat grid, resume list, and spotlight.
  const draftsInProgress = useMemo<DraftInProgress[]>(() => {
    const drafts: DraftInProgress[] = []
    for (const project of projectsList) {
      for (const patent of project.patents || []) {
        if (patent.status === 'DRAFT' || patent.status === 'IN_PROGRESS') {
          drafts.push({
            id: patent.id,
            title: patent.title || 'Untitled draft',
            status: patent.status,
            projectName: project.name,
            updatedAt: patent.updatedAt || patent.createdAt
          })
        }
      }
    }
    drafts.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    return drafts
  }, [projectsList])

  const latestNoveltySearch = noveltyHistory.length > 0 ? noveltyHistory[0] : null

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }, [])

  const firstName = useMemo(() => {
    const raw = user?.email?.split('@')[0] || ''
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : ''
  }, [user?.email])

  const goToDraft = () => {
    const query = commandText.trim()
      ? `?rawIdea=${encodeURIComponent(commandText.trim())}`
      : ''
    router.push(`/patents/draft/new${query}`)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingBird message="Loading your workspace..." useKishoFallback={true} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Subtle Background Grid */}
      <div className="absolute inset-0 pointer-events-none opacity-30" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>

      <main className="max-w-[1800px] mx-auto py-8 px-4 sm:px-6 lg:px-8 relative z-10">

        {/* Greeting + AI command bar */}
        <div className="mb-10">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6"
          >
            <h1 className="text-3xl font-bold text-foreground tracking-tight">
              {greeting}{firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="text-muted-foreground mt-1">
              What are you working on today?
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.5 }}
            className="rounded-2xl border border-border bg-card shadow-sm p-4 sm:p-5"
          >
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <Sparkles className="h-5 w-5" />
              </div>
              <input
                type="text"
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && commandText.trim()) goToDraft()
                }}
                placeholder="Describe your invention in a sentence — we'll take it from there…"
                aria-label="Describe your invention"
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              />
              <button
                onClick={goToDraft}
                disabled={!commandText.trim()}
                className="hidden sm:inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Start draft
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Or jump straight to:</span>
              <button
                onClick={goToDraft}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <PenLine className="h-3.5 w-3.5" /> Draft a patent
              </button>
              <button
                onClick={() => router.push('/novelty-search')}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <Search className="h-3.5 w-3.5" /> Check novelty
              </button>
              <button
                onClick={() => router.push('/idea-bank')}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <Lightbulb className="h-3.5 w-3.5" /> Save an idea
              </button>
            </div>
          </motion.div>
        </div>

        {/* Continue where you left off */}
        {draftsInProgress.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="mb-10"
          >
            <h2 className="text-lg font-semibold text-foreground mb-3">Continue where you left off</h2>
            <div className="rounded-xl border border-border bg-card shadow-sm divide-y divide-border overflow-hidden">
              {draftsInProgress.slice(0, 3).map((draft) => (
                <div key={draft.id} className="flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground truncate">{draft.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {draft.projectName}
                      <span className="mx-1.5">·</span>
                      {draft.status === 'IN_PROGRESS' ? 'In progress' : 'Draft'}
                    </div>
                  </div>
                  <button
                    onClick={() => router.push(`/patents/${draft.id}/draft`)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Resume
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10"
        >
          <button
            onClick={() => router.push('/patents/draft/new')}
            className="group flex flex-col items-start p-4 bg-card border border-border rounded-xl hover:border-primary/50 hover:shadow-md transition-all duration-200"
          >
            <div className="p-2 bg-accent rounded-lg text-accent-foreground mb-3 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Plus className="w-5 h-5" />
            </div>
            <span className="font-semibold text-foreground">New Draft</span>
            <span className="text-xs text-muted-foreground mt-1">Start a fresh application</span>
          </button>

          <button
            onClick={() => router.push('/patents/draft/batch')}
            className="group flex flex-col items-start p-4 bg-card border border-border rounded-xl hover:border-primary/50 hover:shadow-md transition-all duration-200"
          >
            <div className="p-2 bg-cyan-50 rounded-lg text-cyan-600 mb-3 group-hover:bg-cyan-600 group-hover:text-white transition-colors">
              <Files className="w-5 h-5" />
            </div>
            <span className="font-semibold text-foreground">Batch Drafting</span>
            <span className="text-xs text-muted-foreground mt-1">Upload many ideas</span>
          </button>

          <div className="group flex flex-col items-start p-4 bg-card border border-border rounded-xl hover:border-primary/50 hover:shadow-md transition-all duration-200">
            <button onClick={() => router.push('/novelty-search')} className="w-full text-left">
              <div className="p-2 bg-purple-50 rounded-lg text-purple-600 mb-3 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                <Search className="w-5 h-5" />
              </div>
              <span className="font-semibold text-foreground">Novelty Search</span>
              <span className="block text-xs text-muted-foreground mt-1">Check prior art</span>
            </button>
            <button onClick={() => router.push('/novelty-search/history')} className="mt-3 inline-flex items-center gap-1.5 border-t border-border pt-3 text-xs font-medium text-purple-700 hover:text-purple-900">
              <History className="h-3.5 w-3.5" /> Search History
            </button>
          </div>

          <button
            onClick={() => router.push('/prior-art-studio')}
            className="group flex flex-col items-start p-4 bg-card border border-border rounded-xl hover:border-primary/50 hover:shadow-md transition-all duration-200"
          >
            <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600 mb-3 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
              <ScanSearch className="w-5 h-5" />
            </div>
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              Advanced Search Studio
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800">
                New
              </span>
            </span>
            <span className="text-xs text-muted-foreground mt-1">Search 45M patents, your way</span>
          </button>

          <button
            onClick={() => router.push('/idea-bank')}
            className="group flex flex-col items-start p-4 bg-card border border-border rounded-xl hover:border-primary/50 hover:shadow-md transition-all duration-200"
          >
            <div className="p-2 bg-amber-50 rounded-lg text-amber-600 mb-3 group-hover:bg-amber-600 group-hover:text-white transition-colors">
              <Lightbulb className="w-5 h-5" />
            </div>
            <span className="font-semibold text-foreground">Idea Bank</span>
            <span className="text-xs text-muted-foreground mt-1">Capture and develop ideas</span>
          </button>

          <button
            onClick={() => router.push('/projects')}
            className="group flex flex-col items-start p-4 bg-card border border-border rounded-xl hover:border-primary/50 hover:shadow-md transition-all duration-200"
          >
            <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600 mb-3 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
              <FolderKanban className="w-5 h-5" />
            </div>
            <span className="font-semibold text-foreground">All Projects</span>
            <span className="text-xs text-muted-foreground mt-1">View portfolio</span>
          </button>
        </motion.div>

        {/* Projects scroller */}
        {projectsList.length > 0 && (
          <div className="mb-10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-foreground">Your projects</h2>
              <span className="text-xs text-muted-foreground">Scroll to browse</span>
            </div>
            <div className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="absolute inset-y-0 left-0 w-12 pointer-events-none bg-gradient-to-r from-white to-transparent opacity-0 group-hover:opacity-80 transition-opacity" />
              <div className="absolute inset-y-0 right-0 w-12 pointer-events-none bg-gradient-to-l from-white to-transparent opacity-0 group-hover:opacity-80 transition-opacity" />
              <div className="flex gap-3 px-4 py-3 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent scroll-smooth">
                {projectsList.map((project: any) => (
                  <div
                    key={project.id}
                    onClick={() => router.push(`/projects/${project.id}`)}
                    className="min-w-[220px] cursor-pointer rounded-lg border border-border bg-muted/50 hover:bg-card hover:border-primary/60 hover:shadow-md transition-all p-3"
                  >
                    <div className="text-sm font-semibold text-foreground truncate">{project.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-1 truncate">{project.applicantProfile?.applicantLegalName || 'No applicant set'}</div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{(project.patents || []).length} patents</span>
                      <span className="flex items-center gap-1 text-primary font-medium">
                        Open
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="space-y-8">

          {/* Stats Overview */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">At a glance</h2>
            <InsightGrid
              projectsCount={projectsList.length}
              draftsCount={draftsInProgress.length}
              ideaStats={ideaStats}
              noveltyHistory={noveltyHistory}
            />
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Activity */}
            <div className="lg:col-span-2">
              <h2 className="text-lg font-semibold text-foreground mb-4">Recent activity</h2>
              <ActivityFeed />
            </div>

            {/* Right Column: Suggested next step */}
            <div className="lg:col-span-1">
              <h2 className="text-lg font-semibold text-foreground mb-4">Suggested next step</h2>
              <AISpotlight
                draftsCount={draftsInProgress.length}
                latestDraft={draftsInProgress[0] || null}
                latestNoveltySearch={latestNoveltySearch}
                userReservations={ideaStats?.userReservations || 0}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Kisho Widget */}
      <KishoWidget />

    </div>
  )
}
