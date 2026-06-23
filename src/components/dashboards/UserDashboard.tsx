'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { getRandomGreeting, getCurrentTimeString, getTimeSegment } from '@/lib/greetings'
import InsightGrid from './InsightGrid'
import AISpotlight from './AISpotlight'
import ActivityFeed from './ActivityFeed'
import KishoWidget from './KishoWidget'
import LoadingBird from '../ui/loading-bird'
import { motion } from 'framer-motion'
import { Sparkles, Plus, Search, Lightbulb, FileText, History, Files } from 'lucide-react'

interface DashboardStats {
  draftsCount: number
  ideaReservations: number
  latestNoveltySearch?: any
}

export default function UserDashboard() {
  const { user } = useAuth()
  const router = useRouter()
  const [greeting, setGreeting] = useState('')
  const [currentTime, setCurrentTime] = useState('')
  const currentTimeSegmentRef = useRef('')
  const [stats, setStats] = useState<DashboardStats>({
    draftsCount: 0,
    ideaReservations: 0,
    latestNoveltySearch: null
  })
  const [hoverTooltip, setHoverTooltip] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [idleMessage, setIdleMessage] = useState('')
  const [showIdleMessage, setShowIdleMessage] = useState(false)
  const [projectsList, setProjectsList] = useState<any[]>([])
  const projectsScrollRef = useRef<HTMLDivElement | null>(null)
  const userId = user?.user_id || user?.email

  // Idle detection and intelligence cues
  useEffect(() => {
    let idleTimer: NodeJS.Timeout
    let lastActivity = Date.now()

    const resetIdleTimer = () => {
      lastActivity = Date.now()
      setShowIdleMessage(false)
    }

    const checkIdle = () => {
      const now = Date.now()
      const idleTime = now - lastActivity

      if (idleTime > 3 * 60 * 1000 && !showIdleMessage) { // 3 minutes
        const messages = [
          "Still here? I'll autosave your work in 10 seconds.",
          "Taking a creative pause? Your ideas are safe with me.",
          "Daydreaming about inventions? That's how breakthroughs happen.",
          "Need a moment? Your workspace is always ready when you are."
        ]
        setIdleMessage(messages[Math.floor(Math.random() * messages.length)])
        setShowIdleMessage(true)

        // Auto-hide after 8 seconds
        setTimeout(() => setShowIdleMessage(false), 8000)
      }
    }

    // Set up event listeners for user activity
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart']
    events.forEach(event => {
      document.addEventListener(event, resetIdleTimer, true)
    })

    // Check for idle every 30 seconds
    idleTimer = setInterval(checkIdle, 30000)

    return () => {
      clearInterval(idleTimer)
      events.forEach(event => {
        document.removeEventListener(event, resetIdleTimer, true)
      })
    }
  }, [showIdleMessage])

  const fetchDashboardStats = useCallback(async () => {
    try {
      // Fetch idea bank stats
      const ideaResponse = await fetch('/api/idea-bank/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      let ideaReservations = 0
      if (ideaResponse.ok) {
        const ideaData = await ideaResponse.json()
        ideaReservations = ideaData.stats?.userReservations || 0
      }

      // Fetch projects to count drafts
      const projectsResponse = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      let draftsCount = 0
      if (projectsResponse.ok) {
        const projectsData = await projectsResponse.json()
        const projects = projectsData.projects || []
        setProjectsList(projects)

        // Count patents across all projects that are in draft status
        for (const project of projects) {
          if (project.patents) {
            draftsCount += project.patents.filter((patent: any) =>
              patent.status === 'DRAFT' || patent.status === 'IN_PROGRESS'
            ).length
          }
        }
      }

      // Fetch novelty search history
      const noveltyResponse = await fetch('/api/novelty-search/history', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      let latestNoveltySearch = null
      if (noveltyResponse.ok) {
        const noveltyData = await noveltyResponse.json()
        const history = noveltyData.history || []
        if (history.length > 0) {
          latestNoveltySearch = history[0]
        }
      }

      setStats({
        draftsCount,
        ideaReservations,
        latestNoveltySearch
      })
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error)
    }
  }, [])

  const initializeDashboard = useCallback(async () => {
    setIsLoading(true)

    // Set initial greeting and time
    const initialTimeSegment = getTimeSegment()
    currentTimeSegmentRef.current = initialTimeSegment
    setGreeting(getRandomGreeting())
    setCurrentTime(getCurrentTimeString())

    // Fetch dashboard stats
    await fetchDashboardStats()

    setIsLoading(false)
  }, [fetchDashboardStats])

  useEffect(() => {
    if (!userId) return
    initializeDashboard()
    const timeInterval = setInterval(() => {
      const newTime = getCurrentTimeString()
      const newTimeSegment = getTimeSegment()

      setCurrentTime(newTime)

      // Update greeting if time segment changed (morning/afternoon/evening)
      if (newTimeSegment !== currentTimeSegmentRef.current) {
        currentTimeSegmentRef.current = newTimeSegment
        setGreeting(getRandomGreeting())
      }
    }, 60000)

    return () => clearInterval(timeInterval)
  }, [userId, initializeDashboard])

  const handleCardHover = (cardType: string, message: string) => {
    setHoverTooltip(message)
  }



  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingBird message="Initializing workspace..." useKishoFallback={true} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Subtle Background Grid */}
      <div className="absolute inset-0 pointer-events-none opacity-30" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header Section */}
        <div className="mb-10">
           <motion.div 
             initial={{ opacity: 0, y: -10 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.5 }}
             className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8"
           >
             <div>
               <div className="flex items-center gap-2 text-sm font-mono text-ai-blue-600 mb-1">
                 <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                 SYSTEM ONLINE
               </div>
               <h1 className="text-3xl font-bold text-ai-graphite-900 tracking-tight">
                 {greeting}
               </h1>
               <p className="text-ai-graphite-500">
                 Ready to accelerate your invention cycle, {user?.email?.split('@')[0]}.
               </p>
             </div>

             <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm">
               <div className="text-right">
                 <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">Local Time</div>
                 <div className="text-sm font-semibold text-ai-graphite-800 font-mono">{currentTime}</div>
               </div>
             </div>
           </motion.div>

          {/* Quick Actions Bar */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="grid grid-cols-2 md:grid-cols-5 gap-4"
          >
             <button
                onClick={() => router.push('/patents/draft/new')}
                className="group flex flex-col items-start p-4 bg-white border border-slate-200 rounded-xl hover:border-ai-blue-500/50 hover:shadow-md hover:shadow-ai-blue-500/10 transition-all duration-200"
              >
                <div className="p-2 bg-ai-blue-50 rounded-lg text-ai-blue-600 mb-3 group-hover:bg-ai-blue-600 group-hover:text-white transition-colors">
                  <Plus className="w-5 h-5" />
                </div>
                <span className="font-semibold text-slate-900">New Draft</span>
                <span className="text-xs text-slate-500 mt-1">Start a fresh application</span>
              </button>

              <button
                onClick={() => router.push('/patents/draft/batch')}
                className="group flex flex-col items-start p-4 bg-white border border-slate-200 rounded-xl hover:border-cyan-500/50 hover:shadow-md hover:shadow-cyan-500/10 transition-all duration-200"
              >
                <div className="p-2 bg-cyan-50 rounded-lg text-cyan-600 mb-3 group-hover:bg-cyan-600 group-hover:text-white transition-colors">
                  <Files className="w-5 h-5" />
                </div>
                <span className="font-semibold text-slate-900">Batch Drafting</span>
                <span className="text-xs text-slate-500 mt-1">Upload many ideas</span>
              </button>

              <div className="group flex flex-col items-start p-4 bg-white border border-slate-200 rounded-xl hover:border-purple-500/50 hover:shadow-md hover:shadow-purple-500/10 transition-all duration-200">
                <button onClick={() => router.push('/novelty-search')} className="w-full text-left">
                <div className="p-2 bg-purple-50 rounded-lg text-purple-600 mb-3 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                  <Search className="w-5 h-5" />
                </div>
                <span className="font-semibold text-slate-900">Novelty Search</span>
                <span className="block text-xs text-slate-500 mt-1">Check prior art</span>
                </button>
                <button onClick={() => router.push('/novelty-search/history')} className="mt-3 inline-flex items-center gap-1.5 border-t border-slate-100 pt-3 text-xs font-medium text-purple-700 hover:text-purple-900">
                  <History className="h-3.5 w-3.5" /> Search History
                </button>
              </div>

              <button
                onClick={() => router.push('/idea-bank')}
                className="group flex flex-col items-start p-4 bg-white border border-slate-200 rounded-xl hover:border-amber-500/50 hover:shadow-md hover:shadow-amber-500/10 transition-all duration-200"
              >
                <div className="p-2 bg-amber-50 rounded-lg text-amber-600 mb-3 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                  <Lightbulb className="w-5 h-5" />
                </div>
                <span className="font-semibold text-slate-900">Idea Bank</span>
                <span className="text-xs text-slate-500 mt-1">Capture concepts</span>
              </button>

              <button
                onClick={() => router.push('/projects')}
                className="group flex flex-col items-start p-4 bg-white border border-slate-200 rounded-xl hover:border-emerald-500/50 hover:shadow-md hover:shadow-emerald-500/10 transition-all duration-200"
              >
                <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600 mb-3 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                  <FileText className="w-5 h-5" />
                </div>
                <span className="font-semibold text-slate-900">All Projects</span>
                <span className="text-xs text-slate-500 mt-1">View portfolio</span>
              </button>
           </motion.div>
        </div>

        {/* Projects scroller */}
        {projectsList.length > 0 && (
          <div className="mb-10">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold text-ai-graphite-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-ai-blue-500" />
                Your Projects
              </div>
              <span className="text-xs text-slate-500">Hover and scroll to browse</span>
            </div>
            <div
              ref={projectsScrollRef}
              onWheel={(e) => {
                if (projectsScrollRef.current) {
                  projectsScrollRef.current.scrollLeft += e.deltaY
                }
              }}
              className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="absolute inset-y-0 left-0 w-12 pointer-events-none bg-gradient-to-r from-white to-transparent opacity-0 group-hover:opacity-80 transition-opacity" />
              <div className="absolute inset-y-0 right-0 w-12 pointer-events-none bg-gradient-to-l from-white to-transparent opacity-0 group-hover:opacity-80 transition-opacity" />
              <div className="flex gap-3 px-4 py-3 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent scroll-smooth">
                {projectsList.map((project: any) => (
                  <div
                    key={project.id}
                    onClick={() => router.push(`/projects/${project.id}`)}
                    className="min-w-[220px] cursor-pointer rounded-lg border border-slate-200 bg-slate-50 hover:bg-white hover:border-ai-blue-500/60 hover:shadow-md transition-all p-3"
                  >
                    <div className="text-sm font-semibold text-slate-900 truncate">{project.name}</div>
                    <div className="text-[11px] text-slate-500 mt-1 truncate">{project.applicantProfile?.applicantLegalName || 'No applicant set'}</div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                      <span>{(project.patents || []).length} patents</span>
                      <span className="flex items-center gap-1 text-ai-blue-600">
                        <Lightbulb className="w-3 h-3" />
                        Open
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-ai-graphite-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-ai-blue-500" />
                System Status
              </h2>
            </div>
            <InsightGrid onCardHover={handleCardHover} />
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
             {/* Left Column: Activity */}
             <div className="lg:col-span-2">
               <h2 className="text-lg font-semibold text-ai-graphite-800 mb-4">Recent Transmissions</h2>
               <ActivityFeed />
             </div>

             {/* Right Column: AI Spotlight */}
             <div className="lg:col-span-1">
               <h2 className="text-lg font-semibold text-ai-graphite-800 mb-4">Intelligence Feed</h2>
               <AISpotlight
                draftsCount={stats.draftsCount}
                latestNoveltySearch={stats.latestNoveltySearch}
                userReservations={stats.ideaReservations}
              />
             </div>
          </div>
        </div>

        {/* Hover Tooltip (retained functionality) */}
        {hoverTooltip && (
          <div className="fixed top-20 right-6 bg-ai-graphite-900 text-white px-4 py-2 rounded-lg shadow-xl z-50 max-w-xs text-sm border border-ai-graphite-700">
            {hoverTooltip}
          </div>
        )}

        {/* Idle Message */}
        {showIdleMessage && (
          <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-ai-graphite-900/90 backdrop-blur-md border border-ai-blue-500/30 rounded-full px-6 py-3 shadow-2xl z-50 max-w-md animate-fade-in">
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-ai-blue-500 rounded-full animate-pulse" />
              <p className="text-white text-sm leading-none">
                {idleMessage}
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Kisho Widget */}
      <KishoWidget />

    </div>
  )
}
