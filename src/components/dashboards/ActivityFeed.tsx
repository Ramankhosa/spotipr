'use client'

import { useState, useEffect, useCallback } from 'react'
import { FileText, Lightbulb, Search, Clock, Sparkles, AlertCircle } from 'lucide-react'

interface ActivityItem {
  id: string
  type: 'idea' | 'draft' | 'novelty' | 'reservation'
  title: string
  description: string
  timestamp: string
  metadata?: Record<string, any>
  kishoNote?: string
}

interface ActivityFeedProps {
  limit?: number
}

const typeIcons = {
  idea: Lightbulb,
  draft: FileText,
  novelty: Search,
  reservation: Clock
}

const typeStyles = {
  idea: 'bg-amber-50 border-amber-100 text-amber-600',
  draft: 'bg-ai-blue-50 border-ai-blue-100 text-ai-blue-600',
  novelty: 'bg-purple-50 border-purple-100 text-purple-600',
  reservation: 'bg-slate-50 border-slate-100 text-slate-500'
}

export default function ActivityFeed({ limit = 5 }: ActivityFeedProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchActivities = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const token = localStorage.getItem('auth_token')
      if (!token) {
        setError('Not authenticated')
        setLoading(false)
        return
      }

      const response = await fetch(`/api/dashboard/activity-feed?limit=${limit}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to fetch activities')
      }

      const data = await response.json()
      
      if (data.success && data.activities) {
        setActivities(data.activities)
      } else {
        setActivities([])
      }
    } catch (err) {
      console.error('Error fetching activity feed:', err)
      setError('Failed to load activities')
      setActivities([])
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (diffInSeconds < 60) return 'Just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse flex gap-4">
              <div className="w-10 h-10 bg-slate-100 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-100 rounded w-3/4" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
                <div className="h-12 bg-slate-50 rounded w-full mt-2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-3 text-slate-500">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8">
        <div className="text-center">
          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-sm font-medium text-slate-700 mb-1">No recent activity</h3>
          <p className="text-xs text-slate-500">
            Start a novelty search, create an idea, or begin drafting a patent to see your activity here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-0 overflow-hidden shadow-sm">
      <div className="divide-y divide-slate-100">
        {activities.map((activity, index) => {
          const Icon = typeIcons[activity.type]
          const style = typeStyles[activity.type]
          
          return (
            <div key={activity.id} className="group p-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className="relative shrink-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${style}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  
                  {/* Connector Line */}
                  {index < activities.length - 1 && (
                    <div className="absolute top-10 left-1/2 -translate-x-1/2 w-px h-12 bg-slate-100 group-hover:bg-slate-200 transition-colors md:block hidden" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-semibold text-ai-graphite-900 truncate pr-2">
                      {activity.title}
                    </h4>
                    <span className="text-xs font-mono text-slate-400 whitespace-nowrap">
                      {formatTimeAgo(activity.timestamp)}
                    </span>
                  </div>

                  <p className="text-sm text-slate-500 mb-3 leading-relaxed">
                    {activity.description}
                  </p>

                  {/* Kisho Insight Box */}
                  {activity.kishoNote && (
                    <div className="flex gap-3 bg-ai-blue-50/50 rounded-lg p-3 border border-ai-blue-100/50">
                      <Sparkles className="w-4 h-4 text-ai-blue-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-ai-blue-700/90 leading-relaxed font-medium">
                        {activity.kishoNote}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
