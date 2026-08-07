'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import BackendActivityPanel from './BackendActivityPanel'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import plantumlEncoder from 'plantuml-encoder'
import SectionInstructionPopover from './SectionInstructionPopover'
import AllInstructionsModal from './AllInstructionsModal'
import WritingSamplesModal from './WritingSamplesModal'
import PersonaManager, { type PersonaSelection } from './PersonaManager'
// REMOVED: InlineSectionValidator - validation now handled by AI Review only
import type { ValidationIssue as UnifiedValidationIssue } from '@/types/validation'
import { isDrawingSectionKey } from '@/lib/figure-availability'
import { defaultLanguageForJurisdiction } from '@/lib/jurisdiction-language'
import { useToast } from '@/components/ui/toast'

// ============================================================================
// AI Review Issue Type
// ============================================================================

interface AIReviewIssue {
  id: string
  sectionKey: string
  sectionLabel: string
  type: 'error' | 'warning' | 'suggestion'
  category: 'consistency' | 'diagram' | 'completeness' | 'legal' | 'clarity' | 'translation'
  title: string
  description: string
  suggestion: string
  fixPrompt: string
  relatedSections?: string[]
  severity: number
}

interface ValidationIssue {
  sectionKey: string
  type: 'error' | 'warning' | 'info'
  rule: string
  message: string
  actual?: number
  limit?: number
}

interface DDEvidencePreviewItem {
  sourceId: string
  label: string
  kind: string
  excerpt: string
  role?: string
  confidence?: string
  reason?: string
  status: string
  included: boolean
  edited: boolean
  injectedText: string
  originalInjectedText: string
  controlsStale: boolean
}

type DDEvidenceCoveragePreset = 'lean' | 'balanced' | 'full' | 'custom'

interface DDEvidencePreview {
  status: 'ready' | 'failed' | 'missing'
  jurisdiction?: string
  inputHash?: string
  generatedAt?: string
  controlsStale?: boolean
  coveragePreset?: DDEvidenceCoveragePreset
  customIncludeInstruction?: string
  customIntegrationInstruction?: string
  includedSelectedCount?: number
  totalSelectedCount?: number
  selectedSources: DDEvidencePreviewItem[]
  guardrailSources: DDEvidencePreviewItem[]
  excludedSources: DDEvidencePreviewItem[]
  warnings: string[]
}

const DD_EVIDENCE_COVERAGE_STAGES: Array<{
  value: DDEvidenceCoveragePreset
  label: string
  help: string
}> = [
  { value: 'lean', label: 'Lean', help: 'Use only essential high-confidence support data.' },
  { value: 'balanced', label: 'Balanced', help: 'Use representative support data without overloading the section.' },
  { value: 'full', label: 'Full', help: 'Use all LLM-selected support data available for this section.' },
  { value: 'custom', label: 'Custom', help: 'Tell the drafting model what selected data to use and how to integrate it.' },
]

// ============================================================================
// Inline Diff View Component - Shows changes between original and revised text
// ============================================================================

function InlineDiffView({ original, revised }: { original: string; revised: string }) {
  // Simple word-level diff for highlighting changes
  const computeDiff = useMemo(() => {
    try {
      if (!original && !revised) return []
      if (!original) return [{ type: 'add' as const, text: revised }]
      if (!revised) return [{ type: 'remove' as const, text: original }]
      
      // Performance safeguard: for very long content, skip detailed diff
      const MAX_CHARS_FOR_DIFF = 30000
      if (original.length > MAX_CHARS_FOR_DIFF || revised.length > MAX_CHARS_FOR_DIFF) {
        return [{ 
          type: 'same' as const, 
          text: '⚠️ Content too long for detailed diff view. Please compare the Original and Revised panels above.' 
        }]
      }
      
      // If content is identical, show message
      if (original === revised) {
        return [{ type: 'same' as const, text: '(No changes - content is identical)' }]
      }
      
      // Split into words while preserving whitespace
      const originalWords = original.split(/(\s+)/)
      const revisedWords = revised.split(/(\s+)/)

      // Additional safeguard: limit word count for diff algorithm
      // Since split(/(\s+)/) creates ~2x elements (words + whitespace), use higher limit
      const MAX_ELEMENTS = 4000  // Allow up to ~2000 actual words
      if (originalWords.length > MAX_ELEMENTS || revisedWords.length > MAX_ELEMENTS) {
        return [{ 
          type: 'same' as const, 
          text: `⚠️ Content too complex for detailed diff (${originalWords.length} elements). Please compare the Original and Revised panels above.` 
        }]
      }
      
      const result: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = []
      
      // Simple LCS-based diff algorithm
      const lcs = (a: string[], b: string[]): number[][] => {
        const m = a.length, n = b.length
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
        
        for (let i = 1; i <= m; i++) {
          for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
              dp[i][j] = dp[i - 1][j - 1] + 1
            } else {
              dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
            }
          }
        }
        return dp
      }
      
      // Iterative backtrack to avoid stack overflow on large inputs
      const backtrackIterative = (dp: number[][], a: string[], b: string[]): void => {
        let i = a.length
        let j = b.length
        const stack: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = []
        
        while (i > 0 || j > 0) {
          if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
            stack.push({ type: 'same', text: a[i - 1] })
            i--
            j--
          } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            stack.push({ type: 'add', text: b[j - 1] })
            j--
          } else if (i > 0) {
            stack.push({ type: 'remove', text: a[i - 1] })
            i--
          }
        }
        
        // Reverse to get correct order
        while (stack.length > 0) {
          result.push(stack.pop()!)
        }
      }
      
      const dp = lcs(originalWords, revisedWords)
      backtrackIterative(dp, originalWords, revisedWords)
      
      // Merge consecutive same-type segments
      const merged: typeof result = []
      for (const segment of result) {
        if (merged.length > 0 && merged[merged.length - 1].type === segment.type) {
          merged[merged.length - 1].text += segment.text
        } else {
          merged.push({ ...segment })
        }
      }
      
      return merged
    } catch (error) {
      console.error('Diff computation failed:', error)
      // Fallback: show revised content without diff highlighting
      return [{ type: 'same' as const, text: '⚠️ Could not compute diff. Showing revised content in the panel above.' }]
    }
  }, [original, revised])
  
  if (computeDiff.length === 0) {
    return <span className="text-ai-graphite-400 italic">No changes detected</span>
  }
  
  return (
    <div className="text-sm leading-relaxed">
      {computeDiff.map((segment, idx) => {
        if (segment.type === 'same') {
          return <span key={idx} className="text-ai-graphite-700">{segment.text}</span>
        } else if (segment.type === 'add') {
          return (
            <span 
              key={idx} 
              className="bg-emerald-200 text-emerald-900 px-0.5 rounded"
              title="Added"
            >
              {segment.text}
            </span>
          )
        } else {
          return (
            <span 
              key={idx} 
              className="bg-red-200 text-red-900 line-through px-0.5 rounded"
              title="Removed"
            >
              {segment.text}
            </span>
          )
        }
      })}
    </div>
  )
}

// ============================================================================
// Comprehensive Validation Panel Component
// ============================================================================

interface ValidationPanelProps {
  sessionId: string
  jurisdiction: string
  patentId: string
  draft: Record<string, string>
  onFix: (sectionKey: string, fixedContent: string) => void
  onProceedToExport: () => void
  /** Callback to sync AI issues to inline section validators */
  onAIIssuesChange?: (issues: AIReviewIssue[]) => void
}

function ValidationPanel({ 
  sessionId, 
  jurisdiction, 
  patentId, 
  draft, 
  onFix,
  onProceedToExport,
  onAIIssuesChange 
}: ValidationPanelProps) {
  const { toast } = useToast()
  // ============================================================================
  // Celebration Messages - Shown when user achieves 100 score
  // Varies by day of week and time of day to avoid repetition
  // ============================================================================
  const CELEBRATION_MESSAGES = [
    // Morning messages (6am - 12pm)
    { time: 'morning', day: 0, emoji: '☕', title: "Perfect Score!", message: "Time for that coffee! You've earned every sip. ☕✨" },
    { time: 'morning', day: 1, emoji: '🌅', title: "Flawless!", message: "Monday morning perfection! Now go flex to your colleagues. 💪" },
    { time: 'morning', day: 2, emoji: '🥐', title: "100% Achieved!", message: "Croissant break? This patent is chef's kiss! 👨‍🍳" },
    { time: 'morning', day: 3, emoji: '🚀', title: "Mission Complete!", message: "Midweek magic! Houston, we have a perfect patent. 🌟" },
    
    // Afternoon messages (12pm - 6pm)
    { time: 'afternoon', day: 0, emoji: '🍕', title: "Nailed It!", message: "Pizza party time! This draft is 100% delicious. 🎉" },
    { time: 'afternoon', day: 1, emoji: '🎯', title: "Bullseye!", message: "Target acquired and destroyed! Go grab an ice cream. 🍦" },
    { time: 'afternoon', day: 4, emoji: '🏆', title: "Champion!", message: "Thursday thunder! You're officially a patent superhero. 🦸" },
    { time: 'afternoon', day: 5, emoji: '🎸', title: "Rock Star!", message: "Friday vibes! Drop the mic and start the weekend early. 🎤" },
    
    // Evening messages (6pm - 10pm)
    { time: 'evening', day: 2, emoji: '🌙', title: "Perfect!", message: "Evening excellence! Netflix & celebrate? You deserve it. 📺" },
    { time: 'evening', day: 3, emoji: '🍷', title: "Masterpiece!", message: "Pour yourself something nice. This draft is *chef's kiss*. 🤌" },
    { time: 'evening', day: 6, emoji: '🎮', title: "Victory!", message: "Weekend warrior! Time to game - you've conquered patents! 🕹️" },
    
    // Late night messages (10pm - 6am)
    { time: 'night', day: 4, emoji: '🦉', title: "Night Owl Win!", message: "Burning the midnight oil paid off! Now get some sleep, genius. 😴" },
    { time: 'night', day: 5, emoji: '⭐', title: "Stellar!", message: "Late night legends get perfect scores. Sweet dreams! 🌠" },
  ]

  // Get celebration message based on current day and time
  const getCelebrationMessage = useCallback(() => {
    const now = new Date()
    const hour = now.getHours()
    const day = now.getDay() // 0 = Sunday, 6 = Saturday
    
    let timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'
    if (hour >= 6 && hour < 12) timeOfDay = 'morning'
    else if (hour >= 12 && hour < 18) timeOfDay = 'afternoon'
    else if (hour >= 18 && hour < 22) timeOfDay = 'evening'
    else timeOfDay = 'night'
    
    // Find message matching time and day, or fallback to time match
    let msg = CELEBRATION_MESSAGES.find(m => m.time === timeOfDay && m.day === day)
    if (!msg) msg = CELEBRATION_MESSAGES.find(m => m.time === timeOfDay)
    if (!msg) msg = CELEBRATION_MESSAGES[0] // Ultimate fallback

    return msg
  }, [CELEBRATION_MESSAGES])

  // Numerical validation state
  const [numericIssues, setNumericIssues] = useState<ValidationIssue[]>([])
  const [numericLoading, setNumericLoading] = useState(false)
  
  // AI Review state
  const [aiIssues, setAiIssues] = useState<AIReviewIssue[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSummary, setAiSummary] = useState<{
    totalIssues: number
    errors: number
    warnings: number
    suggestions: number
    overallScore: number
    recommendation: string
  } | null>(null)
  
  // Celebration state
  const [showCelebration, setShowCelebration] = useState(false)
  const [celebrationMessage, setCelebrationMessage] = useState(getCelebrationMessage())
  const prevScoreRef = useRef<number | null>(null)
  const celebrationEligibleRef = useRef(false)
  const [currentReviewId, setCurrentReviewId] = useState<string | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(false)
  
  // Fix state
  const [fixingIssue, setFixingIssue] = useState<string | null>(null)
  const [ignoredIssues, setIgnoredIssues] = useState<Set<string>>(new Set())
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set())
  
  // Fix preview state - shows diff before applying
  const [pendingFix, setPendingFix] = useState<{
    issue: AIReviewIssue
    sectionKey: string
    originalContent: string
    fixedContent: string
  } | null>(null)
  
  // Last review timestamps
  const [lastNumericCheck, setLastNumericCheck] = useState<string | null>(null)
  const [lastAICheck, setLastAICheck] = useState<string | null>(null)
  
  // Category filter state - filter issues by type or category
  const [filterType, setFilterType] = useState<'all' | 'error' | 'warning' | 'suggestion'>('all')
  const [filterCategory, setFilterCategory] = useState<string>('all')

  // Load existing reviews on mount/jurisdiction change
  useEffect(() => {
    const loadExistingReviews = async () => {
      if (!sessionId || !jurisdiction || !patentId) return
      setLoadingExisting(true)
      try {
        const res = await fetch(`/api/patents/${patentId}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'get_ai_reviews',
            sessionId,
            jurisdiction
          })
        })
        const data = await res.json()
        if (data.success && data.latest?.[jurisdiction.toUpperCase()]) {
          const latestReview = data.latest[jurisdiction.toUpperCase()]
          const issues = latestReview.issues || []
          // Restore review state
          prevScoreRef.current = latestReview.summary?.overallScore ?? null
          celebrationEligibleRef.current = false
          setAiIssues(issues)
          setAiSummary(latestReview.summary || null)
          setCurrentReviewId(latestReview.id)
          setLastAICheck(new Date(latestReview.reviewedAt).toLocaleTimeString())
          // Restore ignored and applied fixes
          const ignored = new Set<string>(
            Array.isArray(latestReview.ignoredIssues) ? latestReview.ignoredIssues : []
          )
          setIgnoredIssues(ignored)
          const applied = new Set<string>(
            Array.isArray(latestReview.appliedFixes) 
              ? latestReview.appliedFixes.map((f: any) => f.issueId)
              : []
          )
          setAppliedFixes(applied)
          // Sync AI issues to inline section validators
          onAIIssuesChange?.(issues)
        }
      } catch (err) {
        console.error('Failed to load existing reviews:', err)
      } finally {
        setLoadingExisting(false)
      }
    }

    loadExistingReviews()
  }, [sessionId, jurisdiction, patentId, onAIIssuesChange])

  // Run numerical validation
  const runNumericValidation = useCallback(async () => {
    if (!sessionId || !jurisdiction || !patentId) return
    setNumericLoading(true)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'validate_draft',
          sessionId,
          jurisdiction,
          draft
        })
      })
      const data = await res.json()
      if (data.issues) {
        setNumericIssues(data.issues)
        setLastNumericCheck(new Date().toLocaleTimeString())
      }
    } catch (err) {
      console.error('Numeric validation error:', err)
    } finally {
      setNumericLoading(false)
    }
  }, [sessionId, jurisdiction, patentId, draft])

  // Track if AI review is a Pro feature (for UI display)
  const [aiReviewUpgradeRequired, setAiReviewUpgradeRequired] = useState(false)

  // Run AI review
  const runAIReview = useCallback(async () => {
    if (!sessionId || !jurisdiction || !patentId) return
    setAiLoading(true)
    setAiReviewUpgradeRequired(false)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'run_ai_review',
          sessionId,
          jurisdiction,
          draft
        })
      })
      const data = await res.json()
      if (data.success) {
        const issues = data.issues || []
        celebrationEligibleRef.current = true
        setAiIssues(issues)
        setAiSummary(data.summary || null)
        setCurrentReviewId(data.reviewId || null)
        setLastAICheck(new Date().toLocaleTimeString())
        // Reset ignored/applied for new review
        setIgnoredIssues(new Set())
        setAppliedFixes(new Set())
        // Sync AI issues to inline section validators
        onAIIssuesChange?.(issues)
      } else if (data.upgradeRequired) {
        // Pro feature - show upgrade message
        setAiReviewUpgradeRequired(true)
        setAiSummary({
          overallScore: 85, // Minimum baseline score
          totalIssues: 0,
          errors: 0,
          warnings: 0,
          suggestions: 0,
          recommendation: 'AI Review is a Pro feature. Upgrade your plan to access AI-powered patent review with comprehensive analysis of claims consistency, diagram alignment, and legal compliance.'
        })
      } else {
        toast({ title: 'AI Review failed', description: data.error || 'Unknown error', variant: 'error' })
      }
    } catch (err) {
      console.error('AI review error:', err)
      toast({ title: 'Failed to run AI review', description: 'Please try again.', variant: 'error' })
    } finally {
      setAiLoading(false)
    }
  }, [sessionId, jurisdiction, patentId, draft, onAIIssuesChange])

  // Generate fix preview for an AI issue (shows diff before applying)
  const generateFixPreview = useCallback(async (issue: AIReviewIssue) => {
    if (!sessionId || !jurisdiction || !patentId) return
    setFixingIssue(issue.id)
    try {
      // Get related content if needed
      const relatedContent: Record<string, string> = {}
      if (issue.relatedSections) {
        for (const key of issue.relatedSections) {
          if (draft[key]) relatedContent[key] = draft[key]
        }
      }

      const originalContent = draft[issue.sectionKey] || ''

      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'apply_ai_fix',
          sessionId,
          jurisdiction,
          sectionKey: issue.sectionKey,
          issue,
          currentContent: originalContent,
          relatedContent,
          previewOnly: true // Signal that we want preview, not direct apply
        })
      })
      const data = await res.json()
      if (data.success && data.fixedContent) {
        // Show the diff preview instead of applying immediately
        setPendingFix({
          issue,
          sectionKey: issue.sectionKey,
          originalContent,
          fixedContent: data.fixedContent
        })
      } else if (data.upgradeRequired) {
        toast({ title: 'AI Fix is a Pro feature', description: 'Please upgrade your plan to apply AI-suggested fixes automatically.', variant: 'warning' })
      } else {
        toast({ title: 'Failed to generate fix', description: data.error || 'Unknown error', variant: 'error' })
      }
    } catch (err) {
      console.error('Generate fix preview error:', err)
      toast({ title: 'Failed to generate fix preview', description: 'Please try again.', variant: 'error' })
    } finally {
      setFixingIssue(null)
    }
  }, [sessionId, jurisdiction, patentId, draft])

  // Approve and apply the pending fix
  const approveFix = useCallback(() => {
    if (!pendingFix) return
    
    const { issue, sectionKey, fixedContent } = pendingFix
    
    // Apply the fix
    onFix(sectionKey, fixedContent)
    
    // Track the applied fix locally
    setAppliedFixes(prev => new Set([...Array.from(prev), issue.id]))
    celebrationEligibleRef.current = true
    
    // Remove the fixed issue from the list and recalculate score
    // Note: onAIIssuesChange is called via useEffect below to avoid render-phase setState
    setAiIssues(prev => {
      const remaining = prev.filter(i => i.id !== issue.id)
      const totalBeforeFix = prev.length
      
      // Count remaining issues by type
      const errors = remaining.filter(i => i.type === 'error').length
      const warnings = remaining.filter(i => i.type === 'warning').length  
      const suggestions = remaining.filter(i => i.type === 'suggestion').length
      
      // Adaptive scoring: 85-90 with issues, scales to 100 as issues are fixed
      const FLOOR_SCORE = 85
      const CEILING_WITH_ISSUES = 90
      const PERFECT_SCORE = 100
      
      let newScore: number
      if (remaining.length === 0) {
        // All issues resolved - perfect score
        newScore = PERFECT_SCORE
      } else {
        // Calculate severity-based base score (85-90)
        const severityWeight = errors * 3 + warnings * 2 + suggestions * 1
        const maxSeverityWeight = 15
        const qualityFactor = Math.max(0, 1 - (severityWeight / maxSeverityWeight))
        const baseScore = FLOOR_SCORE + (qualityFactor * (CEILING_WITH_ISSUES - FLOOR_SCORE))
        
        // Scale towards 100 based on resolution progress
        const resolvedCount = totalBeforeFix - remaining.length
        const resolvedRatio = totalBeforeFix > 0 ? resolvedCount / totalBeforeFix : 0
        newScore = Math.round(baseScore + ((PERFECT_SCORE - baseScore) * resolvedRatio))
        newScore = Math.max(FLOOR_SCORE, Math.min(PERFECT_SCORE - 1, newScore)) // Cap at 99 if issues remain
      }
      
      // Update summary with new counts and score
      setAiSummary(prevSummary => prevSummary ? {
        ...prevSummary,
        totalIssues: remaining.length,
        errors,
        warnings,
        suggestions,
        overallScore: newScore,
        recommendation: remaining.length === 0 
          ? 'All issues resolved! Draft is ready for export.'
          : `${remaining.length} issue${remaining.length !== 1 ? 's' : ''} remaining. Keep fixing to reach 100.`
      } : null)
      
      return remaining
    })
    
    // Clear the pending fix
    setPendingFix(null)
  }, [pendingFix, onFix])

  // Reject the pending fix
  const rejectFix = useCallback(() => {
    setPendingFix(null)
  }, [])

  // Ignore an issue (persists to backend)
  const ignoreIssue = useCallback(async (issueId: string) => {
    // Update local state immediately
    setIgnoredIssues(prev => new Set(Array.from(prev).concat(issueId)))
    
    // Persist to backend
    try {
      await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'ignore_ai_issue',
          sessionId,
          jurisdiction,
          issueId,
          reviewId: currentReviewId
        })
      })
    } catch (err) {
      console.error('Failed to persist ignored issue:', err)
      // Local state already updated, so user experience is smooth
    }
  }, [sessionId, jurisdiction, patentId, currentReviewId])

  // REMOVED: Auto-run numeric validation - now handled by AI Review only
  // Deterministic validation was causing delays and excessive refreshes

  // Sync AI issues to parent when they change (avoids render-phase setState)
  // This handles cases like approveFix where issues are filtered
  const aiIssuesRef = useRef(aiIssues)
  const aiIssuesSignatureRef = useRef<string>(JSON.stringify(aiIssues))
  useEffect(() => {
    // Only sync if the issue set truly changed (not just reference or same length)
    const signature = JSON.stringify(
      aiIssues.map(i => ({
        id: i.id,
        type: i.type,
        category: i.category,
        sectionKey: i.sectionKey,
        title: i.title,
        description: i.description
      }))
    )
    if (signature !== aiIssuesSignatureRef.current) {
      onAIIssuesChange?.(aiIssues)
      aiIssuesSignatureRef.current = signature
    }
    aiIssuesRef.current = aiIssues
  }, [aiIssues, onAIIssuesChange])

  // Trigger celebration when score reaches 100
  useEffect(() => {
    const currentScore = aiSummary?.overallScore ?? null
    const previousScore = prevScoreRef.current
    prevScoreRef.current = currentScore

    // Only celebrate when an in-session AI review/fix reaches 100.
    // Existing saved 100-score reviews should not replay on page load.
    if (currentScore === 100 && previousScore !== 100 && celebrationEligibleRef.current) {
      celebrationEligibleRef.current = false
      setCelebrationMessage(getCelebrationMessage())
      setShowCelebration(true)
      // Auto-hide after 5 seconds
      const timer = setTimeout(() => setShowCelebration(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [aiSummary?.overallScore, getCelebrationMessage])

  // Calculate counts
  const numericErrorCount = numericIssues.filter(i => i.type === 'error').length
  const numericWarningCount = numericIssues.filter(i => i.type === 'warning').length
  const allActiveAiIssues = aiIssues.filter(i => !ignoredIssues.has(i.id) && !appliedFixes.has(i.id))
  const aiErrorCount = allActiveAiIssues.filter(i => i.type === 'error').length
  const aiWarningCount = allActiveAiIssues.filter(i => i.type === 'warning').length
  const aiSuggestionCount = allActiveAiIssues.filter(i => i.type === 'suggestion').length
  const fixedCount = appliedFixes.size
  const totalErrors = numericErrorCount + aiErrorCount
  const totalWarnings = numericWarningCount + aiWarningCount
  
  // Apply filters to AI issues
  const activeAiIssues = allActiveAiIssues.filter(i => {
    if (filterType !== 'all' && i.type !== filterType) return false
    if (filterCategory !== 'all' && i.category !== filterCategory) return false
    return true
  })
  
  // Get unique categories for filter dropdown
  const uniqueCategories = Array.from(new Set(allActiveAiIssues.map(i => i.category)))
  
  // Group issues by category for organized display
  const issuesByCategory = activeAiIssues.reduce((acc, issue) => {
    if (!acc[issue.category]) acc[issue.category] = []
    acc[issue.category].push(issue)
    return acc
  }, {} as Record<string, typeof activeAiIssues>)

  const figureIssueGuidance = useMemo(() => {
    const figureCodePattern = /\bfig(?:\.|ure)?\.?\s*(\d{1,3})\b/i
    const plantumlPattern = /plantuml|@startuml|@enduml/i

    const flagged = allActiveAiIssues.find(issue => {
      if (issue.category !== 'diagram') return false
      const combined = `${issue.title} ${issue.description} ${issue.suggestion} ${issue.fixPrompt}`
      return figureCodePattern.test(combined) || plantumlPattern.test(combined)
    })

    if (!flagged) return null

    const match = figureCodePattern.exec(`${flagged.title} ${flagged.description} ${flagged.suggestion} ${flagged.fixPrompt}`)
    return {
      figureLabel: match ? match[0].replace(/\s+/g, ' ').toUpperCase() : null
    }
  }, [allActiveAiIssues])

  // Category icons and colors
  const getCategoryStyle = (category: string) => {
    switch (category) {
      case 'consistency': return { icon: '🔗', bg: 'bg-ai-blue-50', border: 'border-ai-blue-200', text: 'text-ai-blue-700' }
      case 'diagram': return { icon: '📊', bg: 'bg-ai-blue-50', border: 'border-ai-blue-200', text: 'text-ai-blue-700' }
      case 'completeness': return { icon: '📋', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' }
      case 'legal': return { icon: '⚖️', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' }
      case 'clarity': return { icon: '💡', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' }
      case 'translation': return { icon: '🌐', bg: 'bg-ai-blue-50', border: 'border-ai-blue-200', text: 'text-ai-blue-700' }
      default: return { icon: '📝', bg: 'bg-paper-100', border: 'border-paper-300', text: 'text-ai-graphite-700' }
    }
  }

  return (
    <div className="space-y-6">
      {/* Unified Intelligence Dashboard */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700/50 overflow-hidden">
        {/* Top Bar - Title & Score */}
        <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-lamp-500 to-ai-blue-600 flex items-center justify-center shadow-lg">
              <span className="text-xl">🔬</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Draft Intelligence</h3>
              <p className="text-slate-400 text-xs">{jurisdiction} • Patent Quality Analysis</p>
            </div>
          </div>
          
          {/* Score Ring */}
          <div className="flex items-center gap-4">
            {aiSummary ? (
              <div className="relative">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-700" />
                  <circle 
                    cx="18" cy="18" r="15" fill="none" strokeWidth="2" strokeLinecap="round"
                    stroke={aiSummary.overallScore >= 90 ? '#10b981' : aiSummary.overallScore >= 80 ? '#f59e0b' : '#ef4444'}
                    strokeDasharray={`${aiSummary.overallScore * 0.94} 100`}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-lg font-bold ${
                    aiSummary.overallScore >= 90 ? 'text-emerald-400' :
                    aiSummary.overallScore >= 80 ? 'text-amber-400' : 'text-red-400'
                  }`}>{aiSummary.overallScore}</span>
                </div>
              </div>
            ) : (
              <div className="text-center px-4 py-2 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="text-slate-500 text-xs">Run AI Review</div>
                <div className="text-slate-400 text-xs">for score</div>
              </div>
            )}
          </div>
        </div>

        {/* AI Summary - if available */}
        {aiSummary?.recommendation && (
          <div className="px-6 py-3 bg-slate-800/30 border-b border-slate-700/50">
            <div className="flex items-start gap-2">
              <span className="text-lamp-400 mt-0.5">💡</span>
              <p className="text-sm text-slate-300 leading-relaxed">{aiSummary.recommendation}</p>
            </div>
          </div>
        )}

        {/* Stats Grid - Clickable Filters */}
        <div className="p-4">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
            <button
              onClick={() => setFilterType(filterType === 'error' ? 'all' : 'error')}
              className={`group relative rounded-xl p-3 text-center transition-all ${
                filterType === 'error' 
                  ? 'bg-red-500/20 ring-2 ring-red-500/50' 
                  : 'bg-slate-800/50 hover:bg-slate-700/50'
              }`}
            >
              <div className="text-2xl font-bold text-red-400">{totalErrors}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Errors</div>
              {filterType === 'error' && <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
            </button>
            
            <button
              onClick={() => setFilterType(filterType === 'warning' ? 'all' : 'warning')}
              className={`group relative rounded-xl p-3 text-center transition-all ${
                filterType === 'warning' 
                  ? 'bg-amber-500/20 ring-2 ring-amber-500/50' 
                  : 'bg-slate-800/50 hover:bg-slate-700/50'
              }`}
            >
              <div className="text-2xl font-bold text-amber-400">{totalWarnings}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Warnings</div>
              {filterType === 'warning' && <div className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />}
            </button>
            
            <button
              onClick={() => setFilterType(filterType === 'suggestion' ? 'all' : 'suggestion')}
              className={`group relative rounded-xl p-3 text-center transition-all ${
                filterType === 'suggestion' 
                  ? 'bg-ai-blue-500/20 ring-2 ring-ai-blue-500/50' 
                  : 'bg-slate-800/50 hover:bg-slate-700/50'
              }`}
            >
              <div className="text-2xl font-bold text-ai-blue-400">{aiSuggestionCount}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Suggestions</div>
              {filterType === 'suggestion' && <div className="absolute -top-1 -right-1 w-2 h-2 bg-ai-blue-500 rounded-full animate-pulse" />}
            </button>
            
            <div className="rounded-xl p-3 text-center bg-slate-800/50">
              <div className="text-2xl font-bold text-emerald-400">{fixedCount}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Fixed</div>
            </div>
            
            <div className="rounded-xl p-3 text-center bg-slate-800/50">
              <div className="text-2xl font-bold text-slate-500">{ignoredIssues.size}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Ignored</div>
            </div>
          </div>
          
          {/* Filter Indicator */}
          {filterType !== 'all' && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs">
              <span className="text-slate-500">Showing</span>
              <span className={`font-medium px-2 py-0.5 rounded ${
                filterType === 'error' ? 'bg-red-500/20 text-red-400' :
                filterType === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                'bg-ai-blue-500/20 text-ai-blue-400'
              }`}>{activeAiIssues.length} {filterType}s</span>
              <button onClick={() => setFilterType('all')} className="text-slate-500 hover:text-white">✕</button>
            </div>
          )}
        </div>

        {/* Category Breakdown - Mini Pills */}
        {uniqueCategories.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-1.5 justify-center">
            {uniqueCategories.map(cat => {
              const style = getCategoryStyle(cat)
              const count = allActiveAiIssues.filter(i => i.category === cat).length
              return (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(filterCategory === cat ? 'all' : cat)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all ${
                    filterCategory === cat
                      ? `${style.bg} ${style.text} ring-1 ${style.border}`
                      : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'
                  }`}
                >
                  <span>{style.icon}</span>
                  <span className="capitalize">{cat}</span>
                  <span className="opacity-60">({count})</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Action Bar */}
        <div className="px-4 pb-4 flex items-center gap-2">
          <button
            onClick={runNumericValidation}
            disabled={numericLoading}
            className="flex-1 px-3 py-2.5 bg-slate-700/50 text-white rounded-lg font-medium hover:bg-slate-600/50 disabled:opacity-50 flex items-center justify-center gap-2 text-sm border border-slate-600/50 transition-all"
          >
            {numericLoading ? (
              <><span className="animate-spin">⏳</span> Checking...</>
            ) : (
              <><span>📏</span> Numeric Check</>
            )}
          </button>
          
          <button
            onClick={runAIReview}
            disabled={aiLoading}
            className="flex-1 px-3 py-2.5 bg-gradient-to-r from-lamp-600 to-ai-blue-600 text-white rounded-lg font-medium hover:from-lamp-500 hover:to-ai-blue-500 disabled:opacity-50 flex items-center justify-center gap-2 text-sm shadow-lg transition-all"
          >
            {aiLoading ? (
              <><span className="animate-spin">⏳</span> Analyzing...</>
            ) : (
              <><span>🤖</span> AI Review</>
            )}
          </button>

          <button
            onClick={onProceedToExport}
            className={`flex-1 px-3 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 text-sm transition-all ${
              totalErrors > 0 
                ? 'bg-amber-600/80 hover:bg-amber-500 text-white' 
                : 'bg-gradient-to-r from-emerald-600 to-ai-blue-600 hover:from-emerald-500 hover:to-ai-blue-500 text-white shadow-lg'
            }`}
          >
            <span>📄</span>
            {totalErrors > 0 ? 'Export Anyway' : 'Export'}
            <span>→</span>
          </button>
        </div>

        {/* Status Footer */}
        <div className="px-4 pb-3 flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-700/30 pt-2">
          <div className="flex items-center gap-3">
            {loadingExisting && <span className="text-ai-blue-400 animate-pulse">● Loading review...</span>}
            {lastNumericCheck && <span>📏 {lastNumericCheck}</span>}
            {lastAICheck && <span>🤖 {lastAICheck}</span>}
          </div>
          {currentReviewId && <span className="font-mono text-slate-600">ID: {currentReviewId.slice(0, 8)}</span>}
        </div>
      </div>

      {/* Numeric Validation Results */}
      {numericIssues.length > 0 && (
        <div className="bg-white rounded-xl border border-paper-300 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-paper-100 border-b border-paper-300">
            <h4 className="font-semibold text-ai-graphite-900 flex items-center gap-2">
              <span>📏</span> Numeric Validation
              <span className="text-xs font-normal text-ai-graphite-500 ml-2">
                Word limits, character counts, claim numbers
              </span>
            </h4>
          </div>
          <div className="divide-y divide-paper-200">
            {numericIssues.map((issue, idx) => (
              <div 
                key={idx} 
                className={`px-6 py-4 flex items-start gap-4 ${
                  issue.type === 'error' ? 'bg-red-50/50' : 
                  issue.type === 'warning' ? 'bg-amber-50/50' : 'bg-ai-blue-50/50'
                }`}
              >
                <div className="mt-0.5">
                  {issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️'}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-ai-graphite-900 capitalize">{issue.sectionKey}</div>
                  <div className="text-sm text-ai-graphite-600">{issue.message}</div>
                  {issue.actual !== undefined && issue.limit !== undefined && (
                    <div className="text-xs text-ai-graphite-500 mt-1">
                      Current: <strong>{issue.actual}</strong> | Limit: <strong>{issue.limit}</strong>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fix Preview Modal - Shows diff before applying */}
      {pendingFix && (
        <div 
          className="bg-white rounded-xl border-2 border-emerald-300 shadow-lg overflow-hidden animate-in slide-in-from-top-2 duration-300"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fix-preview-title"
          tabIndex={-1}
          onKeyDown={(e) => { if (e.key === 'Escape') rejectFix() }}
        >
          <div className="px-6 py-4 bg-gradient-to-r from-emerald-50 to-ai-blue-50 border-b border-emerald-200">
            <div className="flex items-center justify-between">
              <div>
                <h4 id="fix-preview-title" className="font-semibold text-ai-graphite-900 flex items-center gap-2">
                  <span>🔍</span> Review Proposed Changes
                </h4>
                <p className="text-sm text-ai-graphite-600 mt-1">
                  Section: <strong>{pendingFix.issue.sectionLabel}</strong> • Issue: {pendingFix.issue.title}
                </p>
              </div>
              <button
                onClick={rejectFix}
                className="p-2 text-ai-graphite-400 hover:text-ai-graphite-600 hover:bg-paper-200 rounded-lg"
                title="Close preview (Esc)"
                aria-label="Close preview"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          
          <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            {/* Issue being fixed */}
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <div className="text-xs font-medium text-amber-700 mb-1">💡 Issue Being Fixed</div>
              <p className="text-sm text-amber-800">{pendingFix.issue.description}</p>
            </div>
            
            {/* Inline diff - highlight changes - MAIN VIEW */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-lamp-600 px-2 py-0.5 bg-lamp-100 rounded">CHANGES HIGHLIGHTED</span>
                <span className="text-xs text-ai-graphite-500">Added text in green, removed in red • ~300 words visible</span>
              </div>
              <div className="bg-white border border-paper-300 rounded-lg p-5 min-h-[400px] max-h-[500px] overflow-y-auto shadow-inner">
                <div className="text-sm leading-relaxed">
                  <InlineDiffView original={pendingFix.originalContent} revised={pendingFix.fixedContent} />
                </div>
              </div>
            </div>
            
            {/* Side-by-side diff view - Collapsible */}
            <details className="group">
              <summary className="cursor-pointer text-xs text-ai-graphite-500 hover:text-ai-graphite-700 flex items-center gap-2 py-2">
                <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                View side-by-side comparison (Original vs Revised)
              </summary>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
                {/* Original Content */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-red-600 px-2 py-0.5 bg-red-100 rounded">ORIGINAL</span>
                    <span className="text-xs text-ai-graphite-500">Before fix</span>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 min-h-[300px] max-h-[450px] overflow-y-auto">
                    <pre className="text-sm text-ai-graphite-700 whitespace-pre-wrap font-mono leading-relaxed">
                      {pendingFix.originalContent || <span className="text-ai-graphite-400 italic">No content</span>}
                    </pre>
                  </div>
                </div>
                
                {/* Fixed Content */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-emerald-600 px-2 py-0.5 bg-emerald-100 rounded">REVISED</span>
                    <span className="text-xs text-ai-graphite-500">After fix</span>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 min-h-[300px] max-h-[450px] overflow-y-auto">
                    <pre className="text-sm text-ai-graphite-700 whitespace-pre-wrap font-mono leading-relaxed">
                      {pendingFix.fixedContent || <span className="text-ai-graphite-400 italic">No content</span>}
                    </pre>
                  </div>
                </div>
              </div>
            </details>
          </div>
          
          {/* Action buttons */}
          <div className="px-6 py-4 bg-paper-100 border-t border-paper-300 flex items-center justify-between">
            <p className="text-xs text-ai-graphite-500">
              Review the changes carefully before applying. This will update the draft section.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={rejectFix}
                className="px-4 py-2 bg-white text-ai-graphite-700 text-sm font-medium rounded-lg border border-paper-400 hover:bg-paper-100 flex items-center gap-2"
              >
                <span>✕</span> Reject
              </button>
              <button
                onClick={approveFix}
                className="px-6 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 flex items-center gap-2 shadow-sm"
              >
                <span>✓</span> Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {figureIssueGuidance && (
        <div className="bg-ai-blue-50 border border-ai-blue-200 rounded-xl px-4 py-3 flex items-start gap-3 text-sm text-ai-blue-900 mb-4">
          <span className="text-lg">🎨</span>
          <div className="space-y-1">
            <div className="font-semibold text-ai-blue-900">
              Figure flagged{figureIssueGuidance.figureLabel ? ` (${figureIssueGuidance.figureLabel})` : ''}
            </div>
            <p className="text-ai-blue-800">
              Go to the Figures section and ask Kisho to update the diagram, using these review remarks as the input so the figure aligns with the draft.
            </p>
          </div>
        </div>
      )}

      {/* AI Review Issues List */}
      {allActiveAiIssues.length > 0 && (
        <div className="bg-white rounded-xl border border-paper-300 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-paper-100 border-b border-paper-300 flex items-center justify-between">
            <h4 className="font-medium text-ai-graphite-700 text-sm flex items-center gap-2">
              📋 Issues List
              <span className="text-xs font-normal text-ai-graphite-400">
                {activeAiIssues.length} of {allActiveAiIssues.length} shown
              </span>
            </h4>
            {(filterType !== 'all' || filterCategory !== 'all') && (
              <button 
                onClick={() => { setFilterType('all'); setFilterCategory('all') }}
                className="text-xs text-lamp-600 hover:text-lamp-700"
              >
                Clear all filters
              </button>
            )}
          </div>
          
          <div className="divide-y divide-paper-200">
            {activeAiIssues.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <div className="text-4xl mb-2">🔍</div>
                <div className="text-ai-graphite-600 font-medium">No {filterType !== 'all' ? filterType + 's' : 'issues'} to show</div>
                <button
                  onClick={() => { setFilterType('all'); setFilterCategory('all') }}
                  className="text-sm text-lamp-600 hover:text-lamp-700 mt-2"
                >
                  Clear filters
                </button>
              </div>
            ) : activeAiIssues.map((issue) => {
              const style = getCategoryStyle(issue.category)
              const isFixing = fixingIssue === issue.id
              
              return (
                <div key={issue.id} className={`px-6 py-5 ${style.bg}`}>
                  <div className="flex items-start gap-4">
                    {/* Severity indicator */}
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-2xl">{style.icon}</span>
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map(n => (
                          <div 
                            key={n}
                            className={`w-1.5 h-1.5 rounded-full ${
                              n <= issue.severity 
                                ? issue.type === 'error' ? 'bg-red-500' 
                                  : issue.type === 'warning' ? 'bg-amber-500' 
                                  : 'bg-ai-blue-500'
                                : 'bg-gray-300'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Issue content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${style.bg} ${style.text} border ${style.border}`}>
                          {issue.category}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                          issue.type === 'error' ? 'bg-red-100 text-red-700 border border-red-200' :
                          issue.type === 'warning' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                          'bg-ai-blue-100 text-ai-blue-700 border border-ai-blue-200'
                        }`}>
                          {issue.type}
                        </span>
                        <span className="text-xs text-ai-graphite-500">
                          Section: <strong>{issue.sectionLabel}</strong>
                        </span>
                      </div>
                      
                      <h5 className="font-semibold text-ai-graphite-900 mb-1">{issue.title}</h5>
                      <p className="text-sm text-ai-graphite-700 mb-2">{issue.description}</p>
                      
                      <div className="bg-white/80 rounded-lg p-3 border border-paper-300">
                        <div className="text-xs font-medium text-ai-graphite-500 mb-1">💡 Suggestion</div>
                        <p className="text-sm text-ai-graphite-700">{issue.suggestion}</p>
                      </div>

                      {issue.relatedSections && issue.relatedSections.length > 0 && (
                        <div className="text-xs text-ai-graphite-500 mt-2">
                          Related sections: {issue.relatedSections.join(', ')}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => generateFixPreview(issue)}
                        disabled={isFixing || pendingFix !== null}
                        className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                      >
                        {isFixing ? (
                          <><span className="animate-spin">⏳</span> Generating...</>
                        ) : (
                          <><span>🔧</span> Preview Fix</>
                        )}
                      </button>
                      <button
                        onClick={() => ignoreIssue(issue.id)}
                        className="px-4 py-2 bg-paper-200 text-ai-graphite-600 text-sm font-medium rounded-lg hover:bg-paper-300 flex items-center gap-2 whitespace-nowrap"
                      >
                        <span>🚫</span> Ignore
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* All Clear State */}
      {numericIssues.length === 0 && activeAiIssues.length === 0 && (lastNumericCheck || lastAICheck) && (
        <div className="bg-gradient-to-r from-emerald-50 to-ai-blue-50 rounded-xl border border-emerald-200 p-8 text-center">
          <div className="text-5xl mb-4">✨</div>
          <h4 className="text-xl font-semibold text-emerald-800 mb-2">All Clear!</h4>
          <p className="text-emerald-700">
            No issues found. Your draft is ready for export.
          </p>
          <button
            onClick={onProceedToExport}
            className="mt-6 px-8 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 shadow-lg inline-flex items-center gap-2"
          >
            <span>📄</span> Export Draft <span>→</span>
          </button>
        </div>
      )}

      {/* Initial State */}
      {numericIssues.length === 0 && activeAiIssues.length === 0 && !lastNumericCheck && !lastAICheck && (
        <div className="bg-paper-100 rounded-xl border border-paper-300 p-8 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h4 className="text-lg font-semibold text-ai-graphite-700 mb-2">Ready to Review</h4>
          <p className="text-ai-graphite-600 text-sm mb-4">
            Run validation checks to ensure your draft meets all requirements.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={runNumericValidation}
              disabled={numericLoading}
              className="px-4 py-2 bg-white border border-paper-400 text-ai-graphite-700 rounded-lg hover:bg-paper-100 flex items-center gap-2 text-sm"
            >
              📏 Numeric Checks
            </button>
            <button
              onClick={runAIReview}
              disabled={aiLoading}
              className="px-4 py-2 bg-lamp-600 text-white rounded-lg hover:bg-lamp-700 flex items-center gap-2 text-sm"
            >
              🤖 AI Review
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* 🎉 CELEBRATION OVERLAY - Shows when user achieves 100 score */}
      {/* ================================================================== */}
      {showCelebration && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setShowCelebration(false)}
          style={{ 
            background: 'radial-gradient(ellipse at center, rgba(16, 185, 129, 0.1) 0%, transparent 70%)'
          }}
        >
          {/* Confetti particles animation */}
          <div className="absolute inset-0 overflow-hidden">
            {[...Array(50)].map((_, i) => (
              <div
                key={i}
                className="absolute animate-confetti"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `-20px`,
                  width: `${8 + Math.random() * 8}px`,
                  height: `${8 + Math.random() * 8}px`,
                  background: ['#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6', '#14b8a6'][Math.floor(Math.random() * 6)],
                  borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                  animationDelay: `${Math.random() * 3}s`,
                  animationDuration: `${3 + Math.random() * 2}s`,
                }}
              />
            ))}
          </div>

          {/* Celebration Card */}
          <div 
            className="relative bg-gradient-to-br from-emerald-600 via-emerald-500 to-ai-blue-500 rounded-3xl shadow-2xl p-8 max-w-md mx-4 transform animate-celebrate-bounce pointer-events-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowCelebration(false)}
              aria-label="Close celebration"
              className="absolute right-4 top-4 z-10 rounded-full bg-white/20 p-2 text-white/80 transition-colors hover:bg-white/30 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/70"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Glow effect */}
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/20 to-transparent" />
            
            {/* Star burst background */}
            <div className="absolute inset-0 flex items-center justify-center opacity-20">
              <div className="text-[200px] animate-spin-slow">✦</div>
            </div>
            
            {/* Content */}
            <div className="relative text-center">
              {/* Trophy/Emoji */}
              <div className="text-7xl mb-4 animate-bounce">
                {celebrationMessage.emoji}
              </div>
              
              {/* Score badge */}
              <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur rounded-full px-4 py-1 mb-4">
                <span className="text-white/80 text-sm font-medium">Score</span>
                <span className="text-2xl font-bold text-white">100</span>
                <span className="text-yellow-300">⭐</span>
              </div>
              
              {/* Title */}
              <h2 className="text-3xl font-bold text-white mb-2 drop-shadow-lg">
                {celebrationMessage.title}
              </h2>
              
              {/* Message */}
              <p className="text-lg text-white/90 mb-6 leading-relaxed">
                {celebrationMessage.message}
              </p>
              
              {/* Dismiss hint */}
              <div className="text-white/60 text-xs">
                Click outside or close to dismiss - Auto-hides in 5 seconds
              </div>
            </div>
            
            {/* Decorative corner elements */}
            <div className="absolute top-4 left-4 text-2xl opacity-60">🎊</div>
            <div className="absolute top-4 right-4 text-2xl opacity-60">🎉</div>
            <div className="absolute bottom-4 left-4 text-2xl opacity-60">✨</div>
            <div className="absolute bottom-4 right-4 text-2xl opacity-60">🌟</div>
          </div>
        </div>
      )}

      {/* Celebration CSS Animations */}
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes celebrate-bounce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-confetti {
          animation: confetti-fall linear forwards;
        }
        .animate-celebrate-bounce {
          animation: celebrate-bounce 2s ease-in-out infinite;
        }
        .animate-spin-slow {
          animation: spin-slow 20s linear infinite;
        }
      `}</style>
    </div>
  )
}

// ============================================================================
// Simple Validation Report (Legacy - kept for backwards compatibility)
// ============================================================================

interface ValidationReportProps {
  sessionId: string
  jurisdiction: string
  patentId: string
  draft: Record<string, string>
}

function ValidationReport({ sessionId, jurisdiction, patentId, draft }: ValidationReportProps) {
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [lastChecked, setLastChecked] = useState<string | null>(null)

  const runValidation = useCallback(async () => {
    if (!sessionId || !jurisdiction || !patentId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'validate_draft',
          sessionId,
          jurisdiction,
          draft
        })
      })
      const data = await res.json()
      if (data.issues) {
        setIssues(data.issues)
        setLastChecked(new Date().toLocaleTimeString())
      }
    } catch (err) {
      console.error('Validation error:', err)
    } finally {
      setLoading(false)
    }
  }, [sessionId, jurisdiction, patentId, draft])

  useEffect(() => {
    if (Object.keys(draft).length > 0) {
      runValidation()
    }
  }, [jurisdiction])

  const errorCount = issues.filter(i => i.type === 'error').length
  const warningCount = issues.filter(i => i.type === 'warning').length

  return (
    <div className="bg-white border border-paper-300 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-ai-graphite-900">Validation Report</h4>
        <button
          onClick={runValidation}
          disabled={loading}
          className="text-sm text-ai-blue-600 hover:text-ai-blue-800 flex items-center gap-1"
        >
          {loading ? (
            <>
              <span className="animate-spin">⏳</span> Checking...
            </>
          ) : (
            <>
              🔍 Run Validation
            </>
          )}
        </button>
      </div>

      {lastChecked && (
        <div className="text-xs text-ai-graphite-500 mb-4">Last checked: {lastChecked}</div>
      )}

      {/* Summary */}
      <div className="flex gap-4 mb-4">
        <div className={`px-3 py-2 rounded-lg text-sm ${errorCount > 0 ? 'bg-red-50 text-red-700' : 'bg-paper-100 text-ai-graphite-600'}`}>
          {errorCount} Error{errorCount !== 1 ? 's' : ''}
        </div>
        <div className={`px-3 py-2 rounded-lg text-sm ${warningCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-paper-100 text-ai-graphite-600'}`}>
          {warningCount} Warning{warningCount !== 1 ? 's' : ''}
        </div>
        {errorCount === 0 && warningCount === 0 && issues.length === 0 && (
          <div className="px-3 py-2 rounded-lg text-sm bg-emerald-50 text-emerald-700">
            ✅ No issues found
          </div>
        )}
      </div>

      {/* Issues List */}
      {issues.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {issues.map((issue, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg text-sm ${
                issue.type === 'error'
                  ? 'bg-red-50 border border-red-100'
                  : issue.type === 'warning'
                    ? 'bg-amber-50 border border-amber-100'
                    : 'bg-ai-blue-50 border border-ai-blue-100'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5">
                  {issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️'}
                </span>
                <div>
                  <div className="font-medium capitalize">{issue.sectionKey}</div>
                  <div className="text-ai-graphite-700">{issue.message}</div>
                  {issue.actual !== undefined && issue.limit !== undefined && (
                    <div className="text-xs text-ai-graphite-500 mt-1">
                      Current: {issue.actual} | Limit: {issue.limit}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Export Button Component
// ============================================================================

interface ExportButtonProps {
  sessionId: string
  jurisdiction: string
  patentId: string
  disabled?: boolean
}

/**
 * Two ways out of the drafting workspace:
 *
 *   draft   — the specification exactly as drafted, figures inline. What you want while the
 *             draft is still being reviewed.
 *   bundle  — the filing set: specification with the figures LIFTED OUT into a separate
 *             Drawings annexure, plus Form 1 and Form 5, zipped. What you file.
 *
 * The specification in bundle mode goes through the identical renderer — same margins,
 * fonts, paragraph numbering and section breaks — it simply has no figure pages.
 */
type ExportScope = 'draft' | 'bundle'

function ExportButton({ sessionId, jurisdiction, patentId, disabled }: ExportButtonProps) {
  const { toast } = useToast()
  const [exporting, setExporting] = useState(false)
  const [exportFormat, setExportFormat] = useState<'docx' | 'pdf'>('docx')
  const [exportScope, setExportScope] = useState<ExportScope>('draft')
  const [showSuccess, setShowSuccess] = useState(false)

  const handleExport = async () => {
    if (!sessionId || !jurisdiction || !patentId) {
      toast({ title: 'Missing required information for export', description: 'Please ensure you have a valid session and jurisdiction.', variant: 'warning' })
      return
    }

    // Check for unsupported format
    if (exportFormat === 'pdf') {
      toast({ title: 'PDF export is coming soon!', description: 'Please use MS Word (.docx) format for now.' })
      return
    }

    setExporting(true)
    setShowSuccess(false)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: exportScope === 'bundle' ? 'export_bundle' : 'export_docx',
          sessionId,
          jurisdiction,
          format: exportFormat
        })
      })

      if (!res.ok) {
        let errorMsg = 'Unknown error'
        try {
          const error = await res.json()
          errorMsg = error.error || error.message || errorMsg
        } catch {
          errorMsg = `Server error (${res.status})`
        }
        toast({ title: 'Export failed', description: errorMsg, variant: 'error' })
        return
      }

      // Check content type to ensure we got a file
      const contentType = res.headers.get('content-type')
      const expected = exportScope === 'bundle' ? 'application/zip' : 'application/vnd.openxmlformats'
      if (!contentType?.includes(expected)) {
        // Might be an error response
        const errorText = await res.text()
        toast({ title: 'Export failed', description: `Invalid response format. ${errorText.substring(0, 100)}`, variant: 'error' })
        return
      }

      // Download the file
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stamp = new Date().toISOString().split('T')[0]
      const disposition = res.headers.get('Content-Disposition') || ''
      const named = disposition.match(/filename="([^"]+)"/)?.[1]
      a.download = named || (exportScope === 'bundle'
        ? `filing_bundle_${jurisdiction}_${stamp}.zip`
        : `patent_draft_${jurisdiction}_${stamp}.docx`)
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      // Show success feedback
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 3000)

      if (exportScope === 'bundle') {
        const included = res.headers.get('X-Bundle-Documents') || ''
        const formsSkipped = res.headers.get('X-Bundle-Forms-Skipped') || ''
        const figuresSkipped = res.headers.get('X-Bundle-Figures-Skipped') || ''
        if (formsSkipped) {
          // The specification and drawings are still valid — say plainly what is missing
          // rather than failing an export the attorney can otherwise use. The same list is
          // written into the zip, so it survives the toast being dismissed.
          const reasons = formsSkipped.split(' | ').filter(Boolean)
          toast({
            title: 'Form 1 and Form 5 are not in this bundle',
            description: `${reasons.length} item${reasons.length === 1 ? '' : 's'} still needed: ${reasons.slice(0, 2).join('; ')}${reasons.length > 2 ? `; and ${reasons.length - 2} more` : ''}. Open the Filing tab to complete them.`,
            variant: 'warning',
            duration: 12000,
            action: {
              label: 'Open Filing tab',
              onClick: () => { window.location.href = `/patents/${patentId}/filing` }
            }
          })
        } else {
          toast({
            title: 'Filing bundle downloaded',
            description: included.split(',').filter(Boolean).join('  ·  '),
            variant: 'success'
          })
        }
        if (figuresSkipped) {
          toast({ title: 'Some figures could not be read', description: figuresSkipped, variant: 'warning' })
        }
      }
    } catch (err) {
      console.error('Export error:', err)
      toast({ title: 'Export failed', description: `${err instanceof Error ? err.message : 'Network error'}. Please check your connection and try again.`, variant: 'error' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <select
        value={exportFormat}
        onChange={(e) => setExportFormat(e.target.value as 'docx' | 'pdf')}
        className="px-3 py-2 border border-paper-400 rounded-lg text-sm bg-white"
      >
        <option value="docx">MS Word (.docx)</option>
        <option value="pdf">PDF (coming soon)</option>
      </select>

      <select
        value={exportScope}
        onChange={(e) => setExportScope(e.target.value as ExportScope)}
        className="px-3 py-2 border border-paper-400 rounded-lg text-sm bg-white"
        title={exportScope === 'bundle'
          ? 'Specification with the figures moved into a separate Drawings annexure, plus Form 1 and Form 5'
          : 'The specification on its own, figures inline'}
      >
        <option value="draft">Draft only (figures inline)</option>
        <option value="bundle">Complete filing bundle (.zip)</option>
      </select>

      <button
        onClick={handleExport}
        disabled={disabled || exporting}
        className={`px-6 py-3 rounded-lg font-medium flex items-center gap-2 shadow-lg transition-all ${
          showSuccess
            ? 'bg-emerald-500 text-white'
            : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60'
        }`}
      >
        {exporting ? (
          <>
            <span className="animate-spin">⏳</span>
            {exportScope === 'bundle' ? 'Building bundle...' : 'Exporting...'}
          </>
        ) : showSuccess ? (
          <>
            <span>✅</span>
            Downloaded!
          </>
        ) : (
          <>
            <span>📄</span>
            {exportScope === 'bundle' ? `Export ${jurisdiction} Filing Bundle` : `Export ${jurisdiction} Draft`}
          </>
        )}
      </button>
    </div>
  )
}

type SectionConfig = {
  keys: string[]
  label: string
  description?: string
  constraints?: string[]
  required?: boolean
}

interface AnnexureDraftStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

interface CountryOption {
  code: string
  label: string
  description: string
  languages: string[]
}

const displayName: Record<string, string> = {
  title: 'Title',
  abstract: 'Abstract',
  fieldOfInvention: 'Field of Invention',
  crossReference: 'Cross-Reference to Related Applications',
  background: 'Background',
  objectsOfInvention: 'Objects of the Invention',
  summary: 'Summary',
  briefDescriptionOfDrawings: 'Brief Description of Drawings',
  detailedDescription: 'Detailed Description',
  bestMethod: 'Best Method',
  industrialApplicability: 'Industrial Applicability',
  claims: 'Claims',
  listOfNumerals: 'List of Reference Numerals',
  // PCT/JP specific
  technicalProblem: 'Technical Problem',
  technicalSolution: 'Technical Solution',
  advantageousEffects: 'Advantageous Effects'
}

const fallbackSections: SectionConfig[] = [
  { keys: ['title', 'abstract'], label: 'Title + Abstract' },
  { keys: ['fieldOfInvention'], label: 'Technical Field' },
  { keys: ['background'], label: 'Background' },
  { keys: ['summary', 'briefDescriptionOfDrawings'], label: 'Summary + Brief Description' },
  { keys: ['detailedDescription', 'bestMethod'], label: 'Detailed Description + Best Mode' },
  { keys: ['industrialApplicability'], label: 'Industrial Applicability' },
  { keys: ['claims', 'listOfNumerals'], label: 'Claims + List of Reference Numerals' }
]

export default function AnnexureDraftStage({ session, patent, onComplete, onRefresh }: AnnexureDraftStageProps) {
  const { toast } = useToast()
  const figuresSkipped = !!session?.figuresSkipped
  const [generated, setGenerated] = useState<Record<string, string>>({})
  const [debugSteps, setDebugSteps] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [usePersonaStyle, setUsePersonaStyle] = useState<boolean>(false) // OFF by default
  const [styleAvailable, setStyleAvailable] = useState<boolean | null>(null)
  const [showWritingSamplesModal, setShowWritingSamplesModal] = useState(false)
  const [showPersonaManager, setShowPersonaManager] = useState(false)
  const [personaSelection, setPersonaSelection] = useState<PersonaSelection | undefined>(undefined)
  const [currentKeys, setCurrentKeys] = useState<string[] | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({})
  const [regenRemarks, setRegenRemarks] = useState<Record<string, string>>({})
  const [regenOpen, setRegenOpen] = useState<Record<string, boolean>>({})
  const [sectionLoading, setSectionLoading] = useState<Record<string, boolean>>({})
  const [autoMode, setAutoMode] = useState<boolean>(false)
  const [autoModeRunning, setAutoModeRunning] = useState<boolean>(false)
  const [autoModeProgress, setAutoModeProgress] = useState<{ current: number; total: number; currentSection: string } | null>(null)
  // Ref for immediate cancellation check (state updates are async, refs are sync)
  const autoModeCancelledRef = useRef<boolean>(false)
  const [activeJurisdiction, setActiveJurisdiction] = useState<string>(() => (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN'))
  const [sourceOfTruth, setSourceOfTruth] = useState<string>(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const list = Array.isArray(session?.draftingJurisdictions) && session.draftingJurisdictions.length > 0
      ? session.draftingJurisdictions.map((c: string) => (c || '').toUpperCase())
      : ['IN']
    const preferred = status?.__sourceOfTruth ? String(status.__sourceOfTruth).toUpperCase() : ''
    if (preferred && list.includes(preferred)) return preferred
    const active = session?.activeJurisdiction ? String(session.activeJurisdiction).toUpperCase() : ''
    if (active && list.includes(active)) return active
    return list[0] || 'IN'
  })
  const [languageByCode, setLanguageByCode] = useState<Record<string, string>>({})
  const [availableCountries, setAvailableCountries] = useState<CountryOption[]>([])
  const [availableCountriesError, setAvailableCountriesError] = useState<string | null>(null)
  const [selectedAddCode, setSelectedAddCode] = useState<string>('')
  const [addingJurisdiction, setAddingJurisdiction] = useState<boolean>(false)
  const [deletingJurisdiction, setDeletingJurisdiction] = useState<string | null>(null)
  const [sectionConfigs, setSectionConfigs] = useState<SectionConfig[] | null>(null)
  const [profileLoading, setProfileLoading] = useState<boolean>(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [usingFallback, setUsingFallback] = useState<boolean>(false)
  const visibleSectionConfigs = useMemo(() => {
    const source = sectionConfigs || fallbackSections
    if (!figuresSkipped) return source
    return source
      .map(section => {
        const keys = section.keys.filter(key => !isDrawingSectionKey(key))
        return {
          ...section,
          keys,
          label: keys.length === 1 ? (displayName[keys[0]] || section.label) : section.label
        }
      })
      .filter(section => section.keys.length > 0)
  }, [sectionConfigs, figuresSkipped])
  
  // Activity Panel Visibility
  const [showActivity, setShowActivity] = useState(true)
  
  // Prompt injection info (used internally, debug panel removed)
  const [promptInjectionInfo, setPromptInjectionInfo] = useState<Record<string, { B: boolean; T: boolean; U: boolean; source: string | null; key: string; strategy: string }>>({})

  // Text Formatting
  const [showFormatting, setShowFormatting] = useState(false)
  const [fontFamily, setFontFamily] = useState('serif')
  const [fontSize, setFontSize] = useState('15px')
  
  // User Instructions
  const [userInstructions, setUserInstructions] = useState<Record<string, Record<string, any>>>({}) // { jurisdiction: { sectionKey: instruction } }
  const [instructionPopoverKey, setInstructionPopoverKey] = useState<string | null>(null)
  const [showAllInstructionsModal, setShowAllInstructionsModal] = useState(false)
  const [lineHeight, setLineHeight] = useState('1.7')

  // Help panel state
  const [showHelpPanel, setShowHelpPanel] = useState(false)

  // DD User Data (Detailed Description section only - sidecar storage)
  const [ddUserData, setDdUserData] = useState<string>('')
  // Toggle defaults are set dynamically based on drafting type (see useEffect below)
  const [ddUserDataToggles, setDdUserDataToggles] = useState<Record<string, boolean>>({})
  const [ddUserDataLoading, setDdUserDataLoading] = useState(false)
  const [ddUserDataSaving, setDdUserDataSaving] = useState(false)
  const [ddUserDataSaved, setDdUserDataSaved] = useState(false) // For save confirmation feedback
  const [ddUserDataExpanded, setDdUserDataExpanded] = useState(false)
  const [ddEvidencePreview, setDdEvidencePreview] = useState<DDEvidencePreview | null>(null)
  const [ddEvidenceGuardrailsExpanded, setDdEvidenceGuardrailsExpanded] = useState(false)
  const [ddEvidenceJurisdiction, setDdEvidenceJurisdiction] = useState<string>(() => ((session as any)?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN').toUpperCase())
  const [ddEvidenceSearch, setDdEvidenceSearch] = useState('')
  const [ddEvidenceSaving, setDdEvidenceSaving] = useState(false)
  const [ddEvidenceExpandedSources, setDdEvidenceExpandedSources] = useState<Record<string, boolean>>({})
  const [ddEvidenceEditingSourceId, setDdEvidenceEditingSourceId] = useState<string | null>(null)
  const [ddEvidenceEditDraft, setDdEvidenceEditDraft] = useState('')
  const [ddCustomInstructionsOpen, setDdCustomInstructionsOpen] = useState(false)
  const [ddCustomIncludeDraft, setDdCustomIncludeDraft] = useState('')
  const [ddCustomIntegrationDraft, setDdCustomIntegrationDraft] = useState('')
  const [ddCoverageTooltipStage, setDdCoverageTooltipStage] = useState<DDEvidenceCoveragePreset | null>(null)
  const ddCustomIncludeRef = useRef<HTMLTextAreaElement | null>(null)
  const DD_USER_DATA_MAX_SIZE = 50 * 1024 // 50KB

  // Add Component Numbers to Claims
  const [addingComponentNumbers, setAddingComponentNumbers] = useState(false)
  const [componentNumbersAdded, setComponentNumbersAdded] = useState(false)
  // Helper: safely extract components array from referenceMap (supports nested format)
  const extractComponentsFromReferenceMap = (referenceMap: any): any[] => {
    if (!referenceMap?.components) return []
    if (referenceMap.components.components && Array.isArray(referenceMap.components.components)) {
      return referenceMap.components.components
    }
    if (Array.isArray(referenceMap.components)) {
      return referenceMap.components
    }
    return []
  }

  // Confirmation modal state for clear/delete actions
  const [confirmationModal, setConfirmationModal] = useState<{
    isOpen: boolean
    type: 'clear' | 'delete'
    jurisdiction: string
    inputValue: string
  }>({ isOpen: false, type: 'clear', jurisdiction: '', inputValue: '' })

  // Inline Section Validation - AI Review issues only (deterministic validation removed)
  const [inlineValidationIssues, setInlineValidationIssues] = useState<Record<string, UnifiedValidationIssue[]>>({})

  // Handle AI Review issues sync to inline validators
  const handleAIIssuesChange = useCallback((aiIssues: AIReviewIssue[]) => {
    // Convert AI Review issues to ValidationIssue format and group by section
    const issuesBySection: Record<string, UnifiedValidationIssue[]> = {}
    
    for (const issue of aiIssues) {
      const sectionKey = issue.sectionKey
      if (!issuesBySection[sectionKey]) {
        issuesBySection[sectionKey] = []
      }
      
      // Map AI issue type to validation severity
      const severityMap: Record<string, 'error' | 'warning' | 'notice'> = {
        'error': 'error',
        'warning': 'warning',
        'suggestion': 'notice'
      }
      
      // Convert to ValidationIssue format
      // Store original fixPrompt in metadata for API compatibility
      const validationIssue: UnifiedValidationIssue = {
        id: issue.id,
        sectionId: issue.sectionKey,
        severity: severityMap[issue.type] || 'notice',
        code: `ai_${issue.category}_${issue.id.substring(0, 8)}`,
        message: `${issue.title}${issue.description ? ': ' + issue.description : ''}`,
        suggestedFix: issue.suggestion || issue.fixPrompt || '',
        category: issue.category as UnifiedValidationIssue['category'],
        relatedSections: issue.relatedSections,
        isFixed: false,
        isIgnored: false,
        // Store original AI issue properties needed for API fix
        metadata: {
          fixPrompt: issue.fixPrompt,
          sectionKey: issue.sectionKey,
          sectionLabel: issue.sectionLabel,
          title: issue.title,
          description: issue.description,
          suggestion: issue.suggestion,
          originalType: issue.type,
          originalSeverity: issue.severity
        }
      }
      
      issuesBySection[sectionKey].push(validationIssue)
    }
    
    // Update inline validation issues (merge with existing, replacing AI issues)
    setInlineValidationIssues(prev => {
      const updated: Record<string, UnifiedValidationIssue[]> = {}
      
      // Collect all unique section keys
      const prevKeys = Object.keys(prev)
      const newKeys = Object.keys(issuesBySection)
      const allSectionKeys: string[] = []
      const seenKeys: Record<string, boolean> = {}
      
      for (const key of prevKeys) {
        if (!seenKeys[key]) {
          seenKeys[key] = true
          allSectionKeys.push(key)
        }
      }
      for (const key of newKeys) {
        if (!seenKeys[key]) {
          seenKeys[key] = true
          allSectionKeys.push(key)
        }
      }
      
      // For each section, keep non-AI issues and add new AI issues
      for (const sectionKey of allSectionKeys) {
        const existingIssues = prev[sectionKey] || []
        const newAIIssues = issuesBySection[sectionKey] || []
        
        // Filter out old AI issues (they start with 'ai-' or have code starting with 'ai_')
        const nonAIIssues = existingIssues.filter(issue => 
          !issue.id.startsWith('ai-') && !issue.code.startsWith('ai_')
        )
        
        // Combine non-AI issues with new AI issues
        updated[sectionKey] = [...nonAIIssues, ...newAIIssues]
      }
      
      return updated
    })
  }, [])

  // REMOVED: validateSection function - deterministic validation now handled by AI Review only
  // This reduces delays and prevents excessive API calls

  // Data for figures - use frozen sequence if available (includes both diagrams and sketches)
  const figurePlans = useMemo(() => Array.isArray(session?.figurePlans) ? session.figurePlans : [], [session?.figurePlans])
  const diagramSources = useMemo(() => Array.isArray(session?.diagramSources) ? session.diagramSources : [], [session?.diagramSources])
  const sketchRecords = useMemo(() => Array.isArray(session?.sketchRecords) ? session.sketchRecords.filter((s: any) => s.status === 'SUCCESS') : [], [session?.sketchRecords])
  const figureSequence = useMemo(() => Array.isArray((session as any)?.figureSequence) ? (session as any).figureSequence : [], [session])
  const figureSequenceFinalized = (session as any)?.figureSequenceFinalized || false

  // Get preferred language for figures based on current jurisdiction
  const preferredFigureLanguage = useMemo(() => {
    const code = (activeJurisdiction || '').toUpperCase()
    const status = (session as any)?.jurisdictionDraftStatus || {}
    
    // Check language mode
    const languageMode = status.__languageMode
    if (languageMode === 'individual_english_figures') {
      // In this mode, figures are always in English
      return 'en'
    }
    
    // Check for jurisdiction-specific language
    const jurisdictionLang = languageByCode[code] || status[code]?.language
    if (jurisdictionLang) return jurisdictionLang
    
    // Check for common language
    if (status.__figuresLanguage) return status.__figuresLanguage
    if (status.__commonLanguage) return status.__commonLanguage
    
    return 'en' // Default fallback
  }, [activeJurisdiction, languageByCode, session])

  // Helper to find the best diagram source for a figureNo based on language preference
  // Priority: 1) Exact language match, 2) English fallback
  const findBestDiagramSource = useCallback((figureNo: number): any => {
    // First try to find diagram in preferred language
    let source = diagramSources.find((d: any) => 
      d.figureNo === figureNo && d.language === preferredFigureLanguage
    )
    
    // Fallback to English if no translation exists
    if (!source) {
      source = diagramSources.find((d: any) => 
        d.figureNo === figureNo && (!d.language || d.language === 'en')
      )
    }
    
    // Ultimate fallback - any diagram with this figureNo
    if (!source) {
      source = diagramSources.find((d: any) => d.figureNo === figureNo)
    }
    
    return source
  }, [diagramSources, preferredFigureLanguage])

  // Build unified figures list using frozen sequence (matches export logic)
  // Returns { figures, hasAppended, missingCount } for warning computation
  // Now uses language-aware diagram selection based on active jurisdiction
  const figuresData = useMemo(() => {
    if (figuresSkipped) {
      return { figures: [], hasAppended: false, missingCount: 0 }
    }

    const buildSketchImageUrl = (sketch: any): string | null => {
      const raw = typeof sketch?.imagePath === 'string'
        ? sketch.imagePath
        : typeof sketch?.imageUrl === 'string'
          ? sketch.imageUrl
          : null

      if (raw && (raw.startsWith('/api/') || raw.startsWith('http://') || raw.startsWith('https://'))) {
        return raw
      }

      const projectId = patent?.project?.id
      const patentId = patent?.id

      const filename = (typeof sketch?.imageFilename === 'string' && sketch.imageFilename.trim())
        ? sketch.imageFilename.trim()
        : (() => {
            const candidate = typeof raw === 'string' ? raw : ''
            const noQuery = candidate.split('?')[0]?.split('#')[0] || ''
            const normalized = noQuery.replace(/\\/g, '/')
            const last = normalized.split('/').pop()
            return last && last.trim() ? last.trim() : null
          })()

      if (filename && projectId && patentId) {
        return `/api/projects/${projectId}/patents/${patentId}/upload?filename=${encodeURIComponent(filename)}`
      }

      return raw
    }

    const figures: Array<{
      figureNo: number
      title: string
      type: 'diagram' | 'sketch'
      imageUrl: string | null
      sourceId: string
      isNew?: boolean
      displayLanguage?: string // Track which language version is displayed
    }> = []
    let hasAppended = false
    let missingCount = 0

    if (figureSequenceFinalized && figureSequence.length > 0) {
      // Use the finalized figure sequence (includes both diagrams and sketches in user-defined order)
      const sequencedSourceIds = new Set(figureSequence.map((s: any) => s.sourceId))
      
      for (const seqItem of figureSequence) {
        if (seqItem.type === 'diagram') {
          const plan = figurePlans.find((f: any) => f.id === seqItem.sourceId)
          // Use language-aware diagram source selection
          const source = plan ? findBestDiagramSource(plan.figureNo) : null
          if (plan) {
            let imgUrl: string | null = null
            if (source?.imageFilename) {
              imgUrl = `/api/projects/${patent?.project?.id ?? ''}/patents/${patent?.id ?? ''}/upload?filename=${encodeURIComponent(source.imageFilename)}`
            } else if (source?.plantuml) {
              try {
                const encoded = plantumlEncoder.encode(source.plantuml)
                imgUrl = `https://www.plantuml.com/plantuml/img/${encoded}`
              } catch (e) {
                console.error('Failed to encode plantuml', e)
              }
            }
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: plan.title || `Figure ${seqItem.finalFigNo}`,
              type: 'diagram',
              imageUrl: imgUrl,
              sourceId: seqItem.sourceId,
              // Track which language version is being displayed
              displayLanguage: source?.language || 'en'
            })
          } else {
            // Diagram was deleted after freezing
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: `Missing Diagram (Source ID: ${seqItem.sourceId})`,
              type: 'diagram',
              imageUrl: null,
              sourceId: seqItem.sourceId
            })
            missingCount++
          }
        } else if (seqItem.type === 'sketch') {
          const sketch = sketchRecords.find((s: any) => s.id === seqItem.sourceId)
          if (sketch) {
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: sketch.title || `Figure ${seqItem.finalFigNo}`,
              type: 'sketch',
              imageUrl: buildSketchImageUrl(sketch),
              sourceId: seqItem.sourceId
            })
          } else {
            // Sketch was deleted after freezing
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: `Missing Sketch (Source ID: ${seqItem.sourceId})`,
              type: 'sketch',
              imageUrl: null,
              sourceId: seqItem.sourceId
            })
            missingCount++
          }
        }
      }

      // Auto-append new diagrams added after sequence was finalized
      figurePlans.forEach((plan: any) => {
        if (!sequencedSourceIds.has(plan.id)) {
          // Use language-aware diagram source selection
          const source = findBestDiagramSource(plan.figureNo)
          let imgUrl: string | null = null
          if (source?.imageFilename) {
            imgUrl = `/api/projects/${patent?.project?.id ?? ''}/patents/${patent?.id ?? ''}/upload?filename=${encodeURIComponent(source.imageFilename)}`
          } else if (source?.plantuml) {
            try {
              const encoded = plantumlEncoder.encode(source.plantuml)
              imgUrl = `https://www.plantuml.com/plantuml/img/${encoded}`
            } catch (e) {
              console.error('Failed to encode plantuml', e)
            }
          }
          figures.push({
            figureNo: figures.length + 1,
            title: plan.title || `Figure ${figures.length + 1}`,
            type: 'diagram',
            imageUrl: imgUrl,
            sourceId: plan.id,
            isNew: true,
            displayLanguage: source?.language || 'en'
          })
          hasAppended = true
        }
      })

      // Auto-append new sketches added after sequence was finalized
      sketchRecords.forEach((sketch: any) => {
        if (!sequencedSourceIds.has(sketch.id)) {
          figures.push({
            figureNo: figures.length + 1,
            title: sketch.title || `Figure ${figures.length + 1}`,
            type: 'sketch',
            imageUrl: buildSketchImageUrl(sketch),
            sourceId: sketch.id,
            isNew: true
          })
          hasAppended = true
        }
      })
    } else {
      // Fallback: use figurePlans sorted by figureNo, then append sketches
      const sortedPlans = [...figurePlans].sort((a: any, b: any) => a.figureNo - b.figureNo)
      for (const plan of sortedPlans) {
        // Use language-aware diagram source selection
        const source = findBestDiagramSource(plan.figureNo)
        let imgUrl: string | null = null
        if (source?.imageFilename) {
          imgUrl = `/api/projects/${patent?.project?.id ?? ''}/patents/${patent?.id ?? ''}/upload?filename=${encodeURIComponent(source.imageFilename)}`
        } else if (source?.plantuml) {
          try {
            const encoded = plantumlEncoder.encode(source.plantuml)
            imgUrl = `https://www.plantuml.com/plantuml/img/${encoded}`
          } catch (e) {
            console.error('Failed to encode plantuml', e)
          }
        }
        figures.push({
          figureNo: plan.figureNo,
          title: plan.title || `Figure ${plan.figureNo}`,
          type: 'diagram',
          imageUrl: imgUrl,
          sourceId: plan.id,
          displayLanguage: source?.language || 'en'
        })
      }
      // Append sketches after diagrams
      const maxFigNo = figures.length > 0 ? Math.max(...figures.map(f => f.figureNo)) : 0
      sketchRecords.forEach((sketch: any, index: number) => {
        figures.push({
          figureNo: maxFigNo + index + 1,
          title: sketch.title || `Figure ${maxFigNo + index + 1}`,
          type: 'sketch',
          imageUrl: buildSketchImageUrl(sketch),
          sourceId: sketch.id
        })
      })
    }

    return { figures, hasAppended, missingCount }
  }, [figuresSkipped, figurePlans, diagramSources, sketchRecords, figureSequence, figureSequenceFinalized, patent, findBestDiagramSource])

  // Extract figures and warning state from memoized data
  const unifiedFigures = figuresData.figures
  const sequenceOutdated = figuresData.hasAppended || figuresData.missingCount > 0
  const sequenceWarningMessage = figuresData.hasAppended 
    ? `${figuresData.figures.filter(f => f.isNew).length} new figure(s) added after freezing - appended at end. Consider reordering in Planner stage.`
    : figuresData.missingCount > 0
      ? `${figuresData.missingCount} figure(s) deleted after freezing. Consider reordering in Planner stage.`
      : ''

  const copySection = async (key: string) => {
    try {
      const text = generated?.[key] || ''
      if (!text) return
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1200)
    } catch {}
  }

  const availableJurisdictions: string[] = useMemo(() => {
    const list = Array.isArray(session?.draftingJurisdictions) && session.draftingJurisdictions.length > 0
      ? session.draftingJurisdictions
      : []
    return list.map((c: string) => (c || '').toUpperCase())
  }, [session?.draftingJurisdictions])

  const latestDrafts = useMemo(() => {
    const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : []
    const map: Record<string, any> = {}
    drafts.forEach((d: any) => {
      const code = (d?.jurisdiction || 'IN').toUpperCase()
      if (!map[code] || (d.version || 0) > (map[code].version || 0)) {
        map[code] = d
      }
    })
    return map
  }, [session?.annexureDrafts])
  const isMultiJurisdiction = availableJurisdictions.length > 1

  const ddEvidenceJurisdictionOptions = useMemo(() => {
    const options = isMultiJurisdiction ? ['REFERENCE', ...availableJurisdictions] : availableJurisdictions
    const normalized = options.map(code => (code || '').toUpperCase()).filter(Boolean)
    return normalized.length ? Array.from(new Set(normalized)) : [activeJurisdiction || 'IN']
  }, [isMultiJurisdiction, availableJurisdictions, activeJurisdiction])

  useEffect(() => {
    if (!ddEvidenceJurisdictionOptions.length) return
    if (!ddEvidenceJurisdictionOptions.includes(ddEvidenceJurisdiction)) {
      setDdEvidenceJurisdiction(ddEvidenceJurisdictionOptions[0])
    }
  }, [ddEvidenceJurisdictionOptions, ddEvidenceJurisdiction])

  const addableCountries = useMemo(
    () => availableCountries.filter(c => !availableJurisdictions.includes(c.code)),
    [availableCountries, availableJurisdictions]
  )

  const persistStageState = async (opts: {
    jurisdictions?: string[]
    active?: string
    source?: string
    languageMap?: Record<string, string>
  }) => {
    if (!session?.id) return
    const nextJurisdictions = opts.jurisdictions || availableJurisdictions
    const payload: any = {
      action: 'set_stage',
      sessionId: session.id,
      stage: session?.status || 'ANNEXURE_DRAFT',
      draftingJurisdictions: nextJurisdictions,
      activeJurisdiction: opts.active || activeJurisdiction,
      languageByJurisdiction: opts.languageMap || languageByCode,
      sourceOfTruth: opts.source || sourceOfTruth
    }
    await onComplete(payload)
    await onRefresh()
  }

  const persistPersonaConfig = async (enabled: boolean, selection?: PersonaSelection) => {
    if (!session?.id) return null
    const response = await onComplete({
      action: 'update_persona_config',
      sessionId: session.id,
      enabled,
      personaSelection: selection
    })
    if (response?.error) throw new Error(response.error)
    setUsePersonaStyle(Boolean(response?.usePersonaStyle))
    setPersonaSelection(response?.personaSelection?.primaryPersonaId ? response.personaSelection : selection)
    return response
  }

  const formatPersonaCoverageWarning = (warnings: any[]) => {
    const lines = (Array.isArray(warnings) ? warnings : [])
      .map((warning: any) => {
        const fallback = warning?.fallback === 'personal_sample'
          ? 'your default style will be used instead'
          : 'this section will use the standard voice'
        return `- ${warning?.sectionKey || 'section'}: ${fallback}`
      })
      .join('\n')

    return `This persona has not been taught every section you are about to generate.\n\n${lines || '- One or more sections have no sample in this persona.'}\n\nGenerate anyway? You can add the missing samples on the Writing Personas page and regenerate later.`
  }

  const generateSectionsWithPersonaHandling = async (payload: any) => {
    let response = await onComplete(payload)
    if (response?.code === 'PERSONA_COVERAGE_WARNING') {
      const confirmed = window.confirm(formatPersonaCoverageWarning(response.personaWarnings || []))
      if (!confirmed) return { cancelled: true }
      response = await onComplete({ ...payload, acceptPersonaWarnings: true })
    }
    if (response?.error) throw new Error(response.error)
    return response
  }

  const handleStyleToggle = async () => {
    try {
      if (usePersonaStyle) {
        await persistPersonaConfig(false, personaSelection)
        return
      }
      if (!personaSelection?.primaryPersonaId) {
        setShowPersonaManager(true)
        return
      }
      await persistPersonaConfig(true, personaSelection)
    } catch (error) {
      console.error('Failed to update persona style:', error)
      toast({ title: error instanceof Error ? error.message : 'Failed to update persona style.', variant: 'error' })
    }
  }

  const handleSourceChange = async (code: string) => {
    const normalized = (code || '').toUpperCase()
    setSourceOfTruth(normalized)
    const reordered = [normalized, ...availableJurisdictions.filter(c => c !== normalized)]
    await persistStageState({ source: normalized, jurisdictions: reordered })
  }

  const handleLanguageChange = async (code: string, lang: string) => {
    const normalized = (code || '').toUpperCase()
    setLanguageByCode(prev => ({ ...prev, [normalized]: lang }))
    await persistStageState({ languageMap: { ...languageByCode, [normalized]: lang } })
  }

  const handleAddJurisdiction = async () => {
    if (!selectedAddCode || !session?.id) return
    if (availableJurisdictions.includes(selectedAddCode)) return
    try {
      setAddingJurisdiction(true)
      const country = availableCountries.find(c => c.code === selectedAddCode)
      const preferredLang = languageByCode[selectedAddCode]
        || (country ? defaultLanguageForJurisdiction(selectedAddCode, country.languages) : '')
      const nextLanguageMap = preferredLang ? { ...languageByCode, [selectedAddCode]: preferredLang } : { ...languageByCode }
      setLanguageByCode(nextLanguageMap)
      const nextList = [...availableJurisdictions, selectedAddCode]
      await persistStageState({
        jurisdictions: nextList,
        active: selectedAddCode,
        source: sourceOfTruth || nextList[0],
        languageMap: nextLanguageMap
      })
      setActiveJurisdiction(selectedAddCode)
    } finally {
      setAddingJurisdiction(false)
    }
  }

  const handleDeleteDraft = async (code: string, removeFromList: boolean = false) => {
    if (!session?.id) return
    const normalized = (code || '').toUpperCase()
    try {
      setDeletingJurisdiction(normalized)
      await onComplete({
        action: 'delete_annexure_draft',
        sessionId: session.id,
        jurisdiction: normalized,
        removeFromList
      })
      // Optimistically update local active/source to reflect removal/clear
      const remaining = removeFromList
        ? availableJurisdictions.filter(c => c !== normalized)
        : availableJurisdictions
      if (removeFromList && remaining.length > 0) {
        const next = remaining[0]
        setActiveJurisdiction(next)
        setSourceOfTruth(prev => (remaining.includes(prev) ? prev : next))
      }
      // Clear the generated state for the deleted jurisdiction to prevent stale data
      if (activeJurisdiction === normalized) {
        setGenerated({})
      }
      await onRefresh()
    } finally {
      setDeletingJurisdiction(null)
    }
  }

  // Initialize from latest saved draft for the active jurisdiction
  useEffect(() => {
    const code = (activeJurisdiction || '').toUpperCase()
    const latest = latestDrafts[code]

    if (latest) {
      // Get extraSections from dedicated column OR legacy validationReport location
      const extraSections = (latest as any).extraSections || (latest.validationReport as any)?.extraSections || {}
      
      // For REFERENCE drafts, section content is stored in _rawDraft
      const rawDraft = extraSections._rawDraft || {}
      const isReference = code === 'REFERENCE'
      
      const initial: Record<string, string> = {
        // Legacy columns (dedicated DB fields)
        // For REFERENCE: prefer rawDraft content, fallback to DB columns
        title: isReference ? (rawDraft.title || latest.title || '') : (latest.title || ''),
        fieldOfInvention: isReference ? (rawDraft.fieldOfInvention || latest.fieldOfInvention || '') : (latest.fieldOfInvention || ''),
        background: isReference ? (rawDraft.background || latest.background || '') : (latest.background || ''),
        summary: isReference ? (rawDraft.summary || latest.summary || '') : (latest.summary || ''),
        briefDescriptionOfDrawings: isReference ? (rawDraft.briefDescriptionOfDrawings || latest.briefDescriptionOfDrawings || '') : (latest.briefDescriptionOfDrawings || ''),
        detailedDescription: isReference ? (rawDraft.detailedDescription || latest.detailedDescription || '') : (latest.detailedDescription || ''),
        bestMethod: isReference ? (rawDraft.bestMode || rawDraft.bestMethod || latest.bestMethod || '') : (latest.bestMethod || ''),
        industrialApplicability: isReference ? (rawDraft.industrialApplicability || latest.industrialApplicability || '') : (latest.industrialApplicability || ''),
        claims: isReference ? (rawDraft.claims || latest.claims || '') : (latest.claims || ''),
        abstract: isReference ? (rawDraft.abstract || latest.abstract || '') : (latest.abstract || ''),
        listOfNumerals: isReference ? (rawDraft.listOfNumerals || latest.listOfNumerals || '') : (latest.listOfNumerals || ''),
        // Extra sections (JSON column for scalable storage)
        // For REFERENCE: prefer rawDraft, then extraSections
        crossReference: isReference ? (rawDraft.crossReference || extraSections.crossReference || '') : (extraSections.crossReference || ''),
        preamble: isReference ? (rawDraft.preamble || extraSections.preamble || '') : (extraSections.preamble || ''),
        objectsOfInvention: isReference ? (rawDraft.objectsOfInvention || extraSections.objectsOfInvention || '') : (extraSections.objectsOfInvention || ''),
        technicalProblem: isReference ? (rawDraft.technicalProblem || extraSections.technicalProblem || '') : (extraSections.technicalProblem || ''),
        technicalSolution: isReference ? (rawDraft.technicalSolution || extraSections.technicalSolution || '') : (extraSections.technicalSolution || ''),
        advantageousEffects: isReference ? (rawDraft.advantageousEffects || extraSections.advantageousEffects || '') : (extraSections.advantageousEffects || ''),
        modeOfCarryingOut: isReference ? (rawDraft.modeOfCarryingOut || extraSections.modeOfCarryingOut || '') : (extraSections.modeOfCarryingOut || '')
      }
      if (figuresSkipped) {
        initial.briefDescriptionOfDrawings = ''
      }
      setGenerated(initial)
    } else {
      setGenerated({})
    }
  }, [latestDrafts, activeJurisdiction, figuresSkipped])

  useEffect(() => {
    const savedPersonaSelection = (session as any)?.personaSelection as PersonaSelection | undefined
    const savedPersonaEnabled = Boolean((session as any)?.usePersonaStyle ?? (session as any)?.personaStyleEnabled)
    setPersonaSelection(savedPersonaSelection?.primaryPersonaId ? savedPersonaSelection : undefined)
    setUsePersonaStyle(Boolean(savedPersonaEnabled && savedPersonaSelection?.primaryPersonaId))
  }, [session])

  // Sync active jurisdiction when session updates
  useEffect(() => {
    const nextJurisdiction = session?.activeJurisdiction || session?.draftingJurisdictions?.[0]
    if (nextJurisdiction && nextJurisdiction !== activeJurisdiction) {
      setActiveJurisdiction(nextJurisdiction)
    }
  }, [session?.activeJurisdiction, session?.draftingJurisdictions])

  // Keep source-of-truth in sync
  useEffect(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const preferred = status?.__sourceOfTruth ? String(status.__sourceOfTruth).toUpperCase() : ''
    const fallbackActive = session?.activeJurisdiction ? String(session.activeJurisdiction).toUpperCase() : ''
    const resolved = preferred && availableJurisdictions.includes(preferred)
      ? preferred
      : (fallbackActive && availableJurisdictions.includes(fallbackActive)
        ? fallbackActive
        : (availableJurisdictions[0] || sourceOfTruth))
    setSourceOfTruth(resolved || 'IN')
  }, [session?.jurisdictionDraftStatus, session?.activeJurisdiction, availableJurisdictions, sourceOfTruth])

  // Load available country profiles
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        setAvailableCountriesError(null)
        const res = await fetch('/api/country-profiles', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          }
        })
        if (!res.ok) throw new Error(`Failed to load country profiles (${res.status})`)
        const data = await res.json()
        const countries: CountryOption[] = Array.isArray(data?.countries) ? data.countries.map((meta: any) => ({
          code: (meta.code || '').toUpperCase(),
          label: `${meta.name || meta.code} (${(meta.code || '').toUpperCase()})`,
          description: `${meta.office || 'Patent Office'} format. Languages: ${(meta.languages || []).join(', ') || 'N/A'}. Applications: ${(meta.applicationTypes || []).join(', ') || 'N/A'}.`,
          languages: meta.languages || []
        })) : []
        countries.sort((a, b) => a.label.localeCompare(b.label))
        setAvailableCountries(countries)
      } catch (err) {
        console.error('Failed to load country profiles (Annexure stage)', err)
        setAvailableCountriesError('Failed to load jurisdiction catalog. You can still draft with existing selections.')
      }
    }
    fetchCountries()
  }, [])

  // Maintain language preferences
  useEffect(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    setLanguageByCode(prev => {
      const next: Record<string, string> = {}
      availableJurisdictions.forEach(code => {
        const saved = status?.[code]?.language
        const country = availableCountries.find(c => c.code === code)
        // Never country.languages[0] — that list is an unordered catalogue of
        // accepted languages (PCT starts with Arabic), not a preference order.
        const defaultLang = country ? defaultLanguageForJurisdiction(code, country.languages) : ''
        next[code] = saved || prev[code] || defaultLang
      })
      return next
    })
  }, [session?.jurisdictionDraftStatus, availableCountries, availableJurisdictions])

  // Load user instructions for the session
  useEffect(() => {
    const loadUserInstructions = async () => {
      if (!session?.id || !patent?.id) return
      try {
        const res = await fetch(`/api/patents/${patent.id}/drafting/user-instructions?sessionId=${session.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        })
        if (res.ok) {
          const data = await res.json()
          setUserInstructions(data.grouped || {})
        }
      } catch (err) {
        console.error('Failed to load user instructions:', err)
      }
    }
    loadUserInstructions()
  }, [session?.id, patent?.id])

  // Compute default DD user data toggles based on drafting type
  // DEFAULT: All toggles OFF - user must explicitly enable after providing data
  const getDefaultDdToggles = useCallback(() => {
    if (isMultiJurisdiction) {
      // Multi-jurisdiction: Default all to OFF (including REFERENCE)
      return { REFERENCE: false }
    } else if (availableJurisdictions.length === 1) {
      // Single jurisdiction: Default to OFF
      return { [availableJurisdictions[0]]: false }
    }
    return {}
  }, [isMultiJurisdiction, availableJurisdictions])

  // Set default toggles when jurisdictions change (if no saved data exists)
  useEffect(() => {
    // Only set defaults if toggles are empty (no saved data loaded yet)
    if (Object.keys(ddUserDataToggles).length === 0 && availableJurisdictions.length > 0) {
      setDdUserDataToggles(getDefaultDdToggles())
    }
  }, [availableJurisdictions, getDefaultDdToggles, ddUserDataToggles])

  // Load DD User Data (sidecar for detailedDescription sections)
  useEffect(() => {
    const loadDDUserData = async () => {
      if (!session?.id || !patent?.id) return
      setDdUserDataLoading(true)
      try {
        const res = await fetch(
          `/api/patents/${patent.id}/drafting/dd-user-data?sessionId=${session.id}&sectionKey=detailedDescription&jurisdiction=${encodeURIComponent(ddEvidenceJurisdiction)}`,
          { headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` } }
        )
        if (res.ok) {
          const data = await res.json()
          setDdEvidencePreview(data.evidencePreview || null)
          if (data.data) {
            setDdUserData(data.data.userData || '')
            // Use saved toggles if they exist, otherwise use defaults based on drafting type
            const savedToggles = data.data.jurisdictionToggles
            if (savedToggles && Object.keys(savedToggles).length > 0) {
              setDdUserDataToggles(savedToggles)
            } else {
              setDdUserDataToggles(getDefaultDdToggles())
            }
          } else {
            // No saved data - set defaults
            setDdUserDataToggles(getDefaultDdToggles())
          }
        } else {
          // Error loading - set defaults
          setDdUserDataToggles(getDefaultDdToggles())
          setDdEvidencePreview(null)
        }
      } catch (err) {
        console.error('Failed to load DD user data:', err)
        setDdUserDataToggles(getDefaultDdToggles())
        setDdEvidencePreview(null)
      } finally {
        setDdUserDataLoading(false)
      }
    }
    loadDDUserData()
  }, [session?.id, patent?.id, getDefaultDdToggles, ddEvidenceJurisdiction])

  useEffect(() => {
    if (ddCustomInstructionsOpen) return
    setDdCustomIncludeDraft(ddEvidencePreview?.customIncludeInstruction || '')
    setDdCustomIntegrationDraft(ddEvidencePreview?.customIntegrationInstruction || '')
  }, [
    ddCustomInstructionsOpen,
    ddEvidencePreview?.customIncludeInstruction,
    ddEvidencePreview?.customIntegrationInstruction,
  ])

  useEffect(() => {
    if (!ddCustomInstructionsOpen) return
    const timer = window.setTimeout(() => ddCustomIncludeRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [ddCustomInstructionsOpen])

  // Save DD User Data handler
  const handleSaveDDUserData = useCallback(async () => {
    if (!session?.id || !patent?.id) return
    
    // Validate non-empty data
    const trimmedData = ddUserData.trim()
    if (!trimmedData) {
      toast({ title: 'User data cannot be empty', description: 'Please enter some data or delete the existing record.', variant: 'warning' })
      return
    }
    
    // Check size limit
    const dataSize = new TextEncoder().encode(trimmedData).length
    if (dataSize > DD_USER_DATA_MAX_SIZE) {
      toast({ title: `User data exceeds maximum size of ${DD_USER_DATA_MAX_SIZE / 1024}KB (current: ${Math.round(dataSize / 1024)}KB)`, variant: 'warning' })
      return
    }
    
    setDdUserDataSaving(true)
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting/dd-user-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          sessionId: session.id,
          sectionKey: 'detailedDescription',
          userData: trimmedData,
          jurisdictionToggles: ddUserDataToggles
        })
      })
      if (!res.ok) {
        const err = await res.json()
        toast({ title: err.error || 'Failed to save user data', variant: 'error' })
      } else {
        // Update local state with trimmed data
        setDdUserData(trimmedData)
        // Show save confirmation
        setDdUserDataSaved(true)
        setTimeout(() => setDdUserDataSaved(false), 3000) // Hide after 3 seconds
        console.log('[DD User Data] Saved successfully')
      }
    } catch (err) {
      console.error('Failed to save DD user data:', err)
      toast({ title: 'Failed to save user data', variant: 'error' })
    } finally {
      setDdUserDataSaving(false)
    }
  }, [session?.id, patent?.id, ddUserData, ddUserDataToggles, DD_USER_DATA_MAX_SIZE])

  // Delete DD User Data handler
  const handleDeleteDDUserData = useCallback(async () => {
    if (!session?.id || !patent?.id) return
    if (!confirm('Are you sure you want to delete the user data? This cannot be undone.')) return
    
    setDdUserDataSaving(true)
    try {
      const res = await fetch(
        `/api/patents/${patent.id}/drafting/dd-user-data?sessionId=${session.id}&sectionKey=detailedDescription`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        }
      )
      if (res.ok) {
        setDdUserData('')
        setDdUserDataToggles(getDefaultDdToggles())
      }
    } catch (err) {
      console.error('Failed to delete DD user data:', err)
    } finally {
      setDdUserDataSaving(false)
    }
  }, [session?.id, patent?.id])

  const ddManualInjectedTargets = useMemo(
    () => Object.entries(ddUserDataToggles).filter(([, enabled]) => enabled).map(([code]) => code),
    [ddUserDataToggles]
  )
  const ddManualInjectionEnabled = ddUserData.trim().length > 0 && ddManualInjectedTargets.length > 0
  const ddAutoIncludedCount = ddEvidencePreview?.selectedSources?.filter(item => item.included).length || 0
  const ddGuardrailIncludedCount = ddEvidencePreview?.guardrailSources?.filter(item => item.included).length || 0
  const ddAnyInjectionEnabled = ddAutoIncludedCount > 0 || ddGuardrailIncludedCount > 0 || ddManualInjectionEnabled
  const ddCoveragePreset: DDEvidenceCoveragePreset = ddEvidencePreview?.coveragePreset || 'full'
  const ddCoverageStageIndex = Math.max(0, DD_EVIDENCE_COVERAGE_STAGES.findIndex(stage => stage.value === ddCoveragePreset))
  const ddCoverageFillPercent = DD_EVIDENCE_COVERAGE_STAGES.length > 1
    ? (ddCoverageStageIndex / (DD_EVIDENCE_COVERAGE_STAGES.length - 1)) * 100
    : 0
  const ddHasCustomInstructions = !!(
    ddEvidencePreview?.customIncludeInstruction ||
    ddEvidencePreview?.customIntegrationInstruction
  )
  const ddEvidenceFilteredSelectedSources = useMemo(() => {
    const items = ddEvidencePreview?.selectedSources || []
    const query = ddEvidenceSearch.trim().toLowerCase()
    if (!query) return items
    return items.filter(item =>
      item.sourceId.toLowerCase().includes(query) ||
      item.label.toLowerCase().includes(query) ||
      item.kind.toLowerCase().includes(query) ||
      (item.role || '').toLowerCase().includes(query)
    )
  }, [ddEvidencePreview?.selectedSources, ddEvidenceSearch])

  const patchDDEvidenceControls = useCallback(async (patch: Record<string, unknown>) => {
    if (!session?.id || !patent?.id) return
    setDdEvidenceSaving(true)
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting/dd-user-data`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          sessionId: session.id,
          sectionKey: 'detailedDescription',
          jurisdiction: ddEvidenceJurisdiction,
          ...patch,
        })
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error || 'Failed to save Detailed Description evidence controls', variant: 'error' })
        return
      }
      setDdEvidencePreview(data.evidencePreview || null)
      setDdUserDataSaved(true)
      setTimeout(() => setDdUserDataSaved(false), 2500)
    } catch (err) {
      console.error('Failed to save DD evidence controls:', err)
      toast({ title: 'Failed to save Detailed Description evidence controls', variant: 'error' })
    } finally {
      setDdEvidenceSaving(false)
    }
  }, [session?.id, patent?.id, ddEvidenceJurisdiction])

  const handleSelectDDEvidenceCoveragePreset = useCallback((coveragePreset: DDEvidenceCoveragePreset) => {
    if (coveragePreset === 'custom') {
      setDdCustomIncludeDraft(ddEvidencePreview?.customIncludeInstruction || '')
      setDdCustomIntegrationDraft(ddEvidencePreview?.customIntegrationInstruction || '')
      setDdCustomInstructionsOpen(true)
      void patchDDEvidenceControls({ coveragePreset: 'custom' })
      return
    }
    setDdCustomInstructionsOpen(false)
    void patchDDEvidenceControls({ coveragePreset })
  }, [
    ddEvidencePreview?.customIncludeInstruction,
    ddEvidencePreview?.customIntegrationInstruction,
    patchDDEvidenceControls,
  ])

  const handleSaveDDEvidenceCustomInstructions = useCallback(() => {
    void patchDDEvidenceControls({
      coveragePreset: 'custom',
      customIncludeInstruction: ddCustomIncludeDraft.trim(),
      customIntegrationInstruction: ddCustomIntegrationDraft.trim(),
    })
    setDdCustomInstructionsOpen(false)
  }, [ddCustomIncludeDraft, ddCustomIntegrationDraft, patchDDEvidenceControls])

  const handleClearDDEvidenceCustomInstructions = useCallback(() => {
    setDdCustomIncludeDraft('')
    setDdCustomIntegrationDraft('')
    void patchDDEvidenceControls({
      coveragePreset: 'custom',
      customIncludeInstruction: '',
      customIntegrationInstruction: '',
    })
  }, [patchDDEvidenceControls])

  const handleToggleDDEvidenceSource = useCallback((sourceId: string, included: boolean) => {
    if (!ddEvidencePreview) return
    const excludedSelectedSourceIds = ddEvidencePreview.selectedSources
      .filter(item => item.sourceId === sourceId ? !included : !item.included)
      .map(item => item.sourceId)
    setDdCustomInstructionsOpen(false)
    void patchDDEvidenceControls({ coveragePreset: 'custom', excludedSelectedSourceIds })
  }, [ddEvidencePreview, patchDDEvidenceControls])

  const handleToggleDDGuardrailSource = useCallback((sourceId: string, included: boolean) => {
    if (!ddEvidencePreview) return
    const excludedGuardrailSourceIds = ddEvidencePreview.guardrailSources
      .filter(item => item.sourceId === sourceId ? !included : !item.included)
      .map(item => item.sourceId)
    void patchDDEvidenceControls({ excludedGuardrailSourceIds })
  }, [ddEvidencePreview, patchDDEvidenceControls])

  const handleSelectAllDDEvidence = useCallback(() => {
    setDdCustomInstructionsOpen(false)
    void patchDDEvidenceControls({ coveragePreset: 'full' })
  }, [patchDDEvidenceControls])

  const handleUnselectAllDDEvidence = useCallback(() => {
    setDdCustomInstructionsOpen(false)
    void patchDDEvidenceControls({
      coveragePreset: 'custom',
      excludedSelectedSourceIds: (ddEvidencePreview?.selectedSources || []).map(item => item.sourceId),
    })
  }, [ddEvidencePreview?.selectedSources, patchDDEvidenceControls])

  const handleResetDDEvidenceControls = useCallback(() => {
    setDdCustomInstructionsOpen(false)
    setDdCustomIncludeDraft('')
    setDdCustomIntegrationDraft('')
    void patchDDEvidenceControls({
      coveragePreset: 'full',
      excludedGuardrailSourceIds: [],
      removeSourceTextOverrideIds: (ddEvidencePreview?.selectedSources || [])
        .filter(item => item.edited)
        .map(item => item.sourceId),
      customIncludeInstruction: '',
      customIntegrationInstruction: '',
    })
  }, [ddEvidencePreview?.selectedSources, patchDDEvidenceControls])

  const startEditingDDEvidenceSource = useCallback((item: DDEvidencePreviewItem) => {
    setDdEvidenceEditingSourceId(item.sourceId)
    setDdEvidenceEditDraft(item.edited ? item.injectedText : item.originalInjectedText)
  }, [])

  const handleSaveDDEvidenceOverride = useCallback(() => {
    if (!ddEvidenceEditingSourceId) return
    const text = ddEvidenceEditDraft.trim()
    if (!text) {
      toast({ title: 'Injected text override cannot be empty', description: 'Use Reset to original instead.', variant: 'warning' })
      return
    }
    void patchDDEvidenceControls({
      sourceTextOverrides: {
        [ddEvidenceEditingSourceId]: { text },
      },
    })
    setDdEvidenceEditingSourceId(null)
    setDdEvidenceEditDraft('')
  }, [ddEvidenceEditingSourceId, ddEvidenceEditDraft, patchDDEvidenceControls])

  const handleResetDDEvidenceOverride = useCallback((sourceId: string) => {
    void patchDDEvidenceControls({ removeSourceTextOverrideIds: [sourceId] })
    setDdEvidenceEditingSourceId(null)
    setDdEvidenceEditDraft('')
  }, [patchDDEvidenceControls])

  // Keep add-jurisdiction dropdown updated
  useEffect(() => {
    const addable = availableCountries.filter(c => !availableJurisdictions.includes(c.code))
    if (!selectedAddCode || !addable.find(c => c.code === selectedAddCode)) {
      setSelectedAddCode(addable[0]?.code || '')
    }
  }, [availableCountries, availableJurisdictions, selectedAddCode])

  useEffect(() => {
    if (!selectedAddCode) return
    const country = availableCountries.find(c => c.code === selectedAddCode)
    if (!country) return
    setLanguageByCode(prev => {
      if (prev[selectedAddCode]) return prev
      if (!country.languages?.length) return prev
      const lang = defaultLanguageForJurisdiction(selectedAddCode, country.languages)
      if (!lang) return prev
      return { ...prev, [selectedAddCode]: lang }
    })
  }, [selectedAddCode, availableCountries])

  // Load country profile to drive section layout
  // For REFERENCE pseudo-country, pass the selected jurisdictions to get dynamic optimized sections
  useEffect(() => {
    const loadProfile = async () => {
      if (!activeJurisdiction) return
      setProfileLoading(true)
      setProfileError(null)
      try {
        // Build URL with jurisdictions param for REFERENCE profile optimization
        let url = `/api/country-profiles/${activeJurisdiction}`
        
        // For REFERENCE profile, append selected jurisdictions to optimize the section list
        if (activeJurisdiction.toUpperCase() === 'REFERENCE') {
          const jurisdictions = (session?.draftingJurisdictions || [])
            .filter((j: string) => j && j.toUpperCase() !== 'REFERENCE')
          if (jurisdictions.length > 0) {
            url += `?jurisdictions=${jurisdictions.join(',')}`
          }
        }
        
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          }
        })
        if (!res.ok) {
          let msg = `Failed to load country profile (${res.status})`
          try {
            const body = await res.json()
            if (body?.error) msg = String(body.error)
          } catch {
            // ignore parse errors; keep generic message
          }
          throw new Error(msg)
        }
        const data = await res.json()
        const profile = data?.profile
        const variant = profile?.structure?.variants?.find((v: any) => v.id === profile?.structure?.defaultVariant) || profile?.structure?.variants?.[0]
        const sections: SectionConfig[] = []
        const canonicalMap: Record<string, string> = {
          title: 'title',
          technical_field: 'fieldOfInvention',
          field_of_invention: 'fieldOfInvention',
          fieldofinvention: 'fieldOfInvention',
          field: 'fieldOfInvention',
          cross_reference: 'crossReference',
          crossreference: 'crossReference',
          background: 'background',
          background_art: 'background',
          objects: 'objectsOfInvention',
          objects_of_invention: 'objectsOfInvention',
          objectsofinvention: 'objectsOfInvention',
          // Direct camelCase mappings for canonical keys returned from API
          objectsOfInvention: 'objectsOfInvention',
          fieldOfInvention: 'fieldOfInvention',
          crossReference: 'crossReference',
          briefDescriptionOfDrawings: 'briefDescriptionOfDrawings',
          detailedDescription: 'detailedDescription',
          bestMethod: 'bestMethod',
          industrialApplicability: 'industrialApplicability',
          listOfNumerals: 'listOfNumerals',
          technicalProblem: 'technicalProblem',
          technicalSolution: 'technicalSolution',
          advantageousEffects: 'advantageousEffects',
          summary_of_invention: 'summary',
          summary: 'summary',
          brief_drawings: 'briefDescriptionOfDrawings',
          brief_description_of_drawings: 'briefDescriptionOfDrawings',
          briefdescriptionofdrawings: 'briefDescriptionOfDrawings',
          description: 'detailedDescription',
          detailed_description: 'detailedDescription',
          detaileddescription: 'detailedDescription',
          best_mode: 'bestMethod',
          best_method: 'bestMethod',
          bestmethod: 'bestMethod',
          industrial_applicability: 'industrialApplicability',
          industrialapplicability: 'industrialApplicability',
          utility: 'industrialApplicability',
          claims: 'claims',
          abstract: 'abstract',
          reference_numerals: 'listOfNumerals',
          reference_signs: 'listOfNumerals',
          list_of_numerals: 'listOfNumerals',
          listofnumerals: 'listOfNumerals',
          // PCT/JP specific
          technical_problem: 'technicalProblem',
          technicalproblem: 'technicalProblem',
          technical_solution: 'technicalSolution',
          technicalsolution: 'technicalSolution',
          advantageous_effects: 'advantageousEffects',
          advantageouseffects: 'advantageousEffects'
        }
        const promptSections = profile?.prompts?.sections || {}
        
        // ============================================================================
        // SECTIONS NOW COME EXCLUSIVELY FROM CountrySectionMapping TABLE
        // This is the single source of truth for which sections appear per jurisdiction
        // Configured via: /super-admin/jurisdiction-config
        // ============================================================================
        
        if (Array.isArray(profile?.sectionMappings) && profile.sectionMappings.length > 0) {
          // Build sections ONLY from CountrySectionMapping table entries
          // Filter out N/A, Implicit, and disabled sections
          const applicableMappings = profile.sectionMappings.filter((mapping: any) => 
            mapping.sectionKey && 
            mapping.heading && 
            mapping.heading !== '(N/A)' && 
            mapping.heading !== '(Implicit)' &&
            mapping.heading !== '(Recommended/NA)' &&
            mapping.heading !== '(Include in Detailed Desc)' &&
            mapping.isEnabled !== false
          )
          const { ensureDisplayOrder } = await import('@/lib/section-display-order')
          
          // Sort by resolved displayOrder (DB source of truth; country override or superset-inherited)
          // This ensures the visible numbering matches the rendered order.
          const mappingsWithOrder = applicableMappings.map((m: any) => ({
            mapping: m,
            order: ensureDisplayOrder(m.displayOrder, `${activeJurisdiction}:${String(m.sectionKey)}`)
          }))
          mappingsWithOrder.sort((a: any, b: any) => a.order - b.order)
          
          for (const { mapping, order: displayOrder } of mappingsWithOrder) {
            const sectionKey = mapping.sectionKey
            
            // Resolve to canonical internal key using the mapping
            const canonicalKey = canonicalMap[sectionKey] || canonicalMap[sectionKey.toLowerCase()] || sectionKey
            
            // Skip sections that don't resolve to a known canonical key (prevents prompt loading errors)
            if (!canonicalKey) {
              console.warn(`[AnnexureDraftStage] Skipping unmapped section: ${sectionKey}`)
              continue
            }
            
            sections.push({
              keys: [canonicalKey],
              label: mapping.heading, // Patent section headings should be titles only (no numeric prefixes)
              description: promptSections?.[canonicalKey]?.description || promptSections?.[sectionKey]?.description || '',
              constraints: promptSections?.[canonicalKey]?.constraints || promptSections?.[sectionKey]?.constraints || [],
              required: mapping.isRequired ?? true
            })
          }
          
          console.log(`[AnnexureDraftStage] Loaded ${sections.length} sections from CountrySectionMapping for ${activeJurisdiction}`)
        } else {
          // No CountrySectionMapping found - this jurisdiction is not configured
          console.error(`[AnnexureDraftStage] No CountrySectionMapping found for ${activeJurisdiction}. Configure via /super-admin/jurisdiction-config`)
        }
        
        if (sections.length > 0) {
          setSectionConfigs(sections)
          setUsingFallback(false)
          setProfileError(null)
        } else {
          // CRITICAL: Do not use fallback - CountrySectionMapping is the single source of truth
          // Show error so admin knows to configure the jurisdiction
          setSectionConfigs([])
          setUsingFallback(true)
          setProfileError(`No sections configured for ${activeJurisdiction}. Please configure via /super-admin/jurisdiction-config`)
        }
      } catch (err) {
        console.error('Failed to load jurisdiction profile', err)
        // Database is the only source of truth for section ordering; do not fall back.
        setProfileError(err instanceof Error ? err.message : 'Failed to load country-specific sections. Please try again or contact support.')
        setSectionConfigs([])
        setUsingFallback(true)
      } finally {
        setProfileLoading(false)
      }
    }
    loadProfile()
  }, [activeJurisdiction, session?.draftingJurisdictions])

  const handleJurisdictionChange = async (code: string) => {
    const normalized = (code || '').toUpperCase()
    setActiveJurisdiction(normalized)
    if (!session?.id) return
    try {
      await persistStageState({ active: normalized })
    } catch (err) {
      console.error('Failed to persist jurisdiction change', err)
    }
  }

  // Multi-jurisdiction: Generate Reference Draft (superset sections)
  const [generatingReference, setGeneratingReference] = useState(false)
  const [translating, setTranslating] = useState<string | null>(null)

  const handleGenerateReferenceDraft = async (forceRegenerate = false) => {
    if (!session?.id || generatingReference) return
    
    // Check if regenerating existing reference draft
    if (session?.referenceDraftComplete && !forceRegenerate) {
      const confirmed = confirm(
        '⚠️ Regenerating Reference Draft\n\n' +
        'This will replace your existing reference draft. ' +
        'Existing translations for other jurisdictions will become outdated and may need to be regenerated.\n\n' +
        'Do you want to continue?'
      )
      if (!confirmed) return
    }
    
    setGeneratingReference(true)
    setShowActivity(true)
    try {
      const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'generate_reference_draft',
          sessionId: session.id
        })
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Reference draft generation failed:', data.error)
        toast({ title: 'Failed to generate reference draft', description: data.error || 'Unknown error', variant: 'error' })
        return
      }
      // Refresh to get updated session with reference draft
      await onRefresh()
      if (data.draft) {
        setGenerated(data.draft)
        toast({ title: 'Reference draft generated successfully!', description: 'You can now translate to other jurisdictions.', variant: 'success' })
      }
    } catch (err) {
      console.error('Reference draft generation error:', err)
      toast({ title: 'Failed to generate reference draft', description: err instanceof Error ? err.message : 'Network error', variant: 'error' })
    } finally {
      setGeneratingReference(false)
    }
  }

  // Multi-jurisdiction: Translate Reference Draft to a jurisdiction
  const handleTranslateToJurisdiction = async (targetJurisdiction: string) => {
    if (!session?.id || translating) return
    const code = targetJurisdiction.toUpperCase()
    
    // Validate jurisdiction exists in available list
    if (!availableJurisdictions.includes(code) && code !== 'REFERENCE') {
      toast({ title: `Invalid jurisdiction: ${code}`, description: 'Please select a valid jurisdiction.', variant: 'warning' })
      return
    }
    
    setTranslating(code)
    setShowActivity(true)
    try {
      const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'translate_to_jurisdiction',
          sessionId: session.id,
          targetJurisdiction: code
        })
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Translation failed:', data.error)
        toast({ title: `Translation failed for ${code}`, description: data.error || 'Unknown error', variant: 'error' })
        return
      }
      
      // Check for high fallback rate warning
      if (data.warning) {
        console.warn('[Translation] Warning:', data.warning)
      }
      
      // Refresh to get updated session with translated draft
      await onRefresh()
      
      // Build comprehensive success message
      let message = ''

      // Add fallback warning if applicable
      if (data.warning) {
        message += `${data.warning}`
      }

      // Add validation issues if any
      if (data.validation?.issues?.length > 0) {
        const errorCount = data.validation.issues.filter((i: any) => i.type === 'error').length
        const warnCount = data.validation.issues.filter((i: any) => i.type === 'warning').length
        if (errorCount > 0 || warnCount > 0) {
          message += `${message ? ' ' : ''}Validation Report: ${errorCount} error(s), ${warnCount} warning(s). Please review the Validation section.`
        }
      }

      toast({ title: `Translation to ${code} complete!`, description: message || undefined, variant: 'success' })
      
      // Switch to translated jurisdiction
      if (data.draft) {
        setGenerated(data.draft)
        setActiveJurisdiction(code)
      }
    } catch (err) {
      console.error('Translation error:', err)
      toast({ title: 'Translation failed', description: `${err instanceof Error ? err.message : 'Network error'}. Please try again.`, variant: 'error' })
    } finally {
      setTranslating(null)
    }
  }

  // Add component numbers (reference numerals) to claims
  // This surgically inserts component numerals from the Component Planner into claims
  // Uses the claims content currently displayed in the Annexure Draft
  // (either from refinement stage or preliminary claims, depending on user workflow)
  const handleAddComponentNumbersToClaims = async () => {
    if (!session?.id || addingComponentNumbers) return
    
    // Check if component numbers are available (handles nested referenceMap storage)
    const components = extractComponentsFromReferenceMap((session as any)?.referenceMap)
    if (components.length === 0) {
      toast({ title: 'No component numbers available', description: 'Please finalize components in the Component Planner stage first.', variant: 'warning' })
      return
    }
    
    // Get claims content currently displayed in the Annexure Draft
    // This automatically uses either refined claims or preliminary claims
    const claimsContent = generated?.claims || ''
    if (!claimsContent.trim()) {
      toast({ title: 'No claims content available', description: 'Claims must be present before adding component numbers.', variant: 'warning' })
      return
    }
    
    setAddingComponentNumbers(true)
    setComponentNumbersAdded(false)
    
    try {
      const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'add_component_numbers_to_claims',
          sessionId: session.id,
          jurisdiction: activeJurisdiction,
          claimsContent: claimsContent // Pass the actual claims displayed in Annexure
        })
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to add component numbers')
      }
      
      if (data.success && data.claims) {
        // Update local state with the new claims containing component numbers
        setGenerated(prev => ({ ...prev, claims: data.claims }))
        setComponentNumbersAdded(true)
        
        // Also refresh to ensure database is in sync
        await onRefresh()
        
        // Show success with details about what was done
        const draftNote = data.draftUpdated ? ' Draft saved.' : ''
        toast({ title: `Successfully added reference numerals from ${data.componentsUsed} components!${draftNote}`, variant: 'success' })
      }
    } catch (err) {
      console.error('Add component numbers error:', err)
      toast({ title: 'Failed to add component numbers', description: err instanceof Error ? err.message : 'Unknown error', variant: 'error' })
    } finally {
      setAddingComponentNumbers(false)
    }
  }

  const handleGenerate = async (keys: string[], skipRefresh = false) => {
    if (loading) return
    setLoading(true)
    setShowActivity(true)
    setCurrentKeys(keys)
    try {
      const sections = keys.filter(Boolean).filter(key => !figuresSkipped || !isDrawingSectionKey(key))
      if (sections.length === 0) {
        setLoading(false)
        setCurrentKeys(null)
        return
      }
      
      const isReference = activeJurisdiction.toUpperCase() === 'REFERENCE'
      
      // For REFERENCE jurisdiction, use generate_reference_section for proper persistence
      // Handle both single and multi-key by looping
      if (isReference) {
        const generatedContent: Record<string, string> = {}
        const debugStepsCollected: any[] = []
        
        for (const sectionKey of sections) {
          const result = await generateSingleSection(sectionKey, true)
          
          if (result.success && result.content) {
            generatedContent[sectionKey] = result.content
            debugStepsCollected.push({ step: `generate_${sectionKey}`, status: 'done' })
          } else {
            // If generation fails, throw error with context
            throw new Error(`Failed to generate ${displayName[sectionKey] || sectionKey}: ${result.error || 'Unknown error'}`)
          }
        }
        
        // Update state with all generated content
        setGenerated(prev => ({ ...prev, ...generatedContent }))
        setDebugSteps(debugStepsCollected)
        
        // REMOVED: onRefresh() - content is already persisted by API, local state is updated
        // Avoiding refresh reduces delay and prevents UI flicker
      } else {
        // Standard generation for non-REFERENCE jurisdictions
        const res = await generateSectionsWithPersonaHandling({
          action: 'generate_sections',
          sessionId: session?.id,
          sections,
          usePersonaStyle,
          personaSelection, // Pass selected personas for multi-persona style support
          jurisdiction: activeJurisdiction
        })
        if (res?.cancelled) return
        const incoming = res?.generated || {}
        const filtered: Record<string, string> = {}
        Object.entries(incoming).forEach(([k, v]) => {
          if (typeof v === 'string' && v.trim()) filtered[k] = v.trim()
        })
        setGenerated(prev => ({ ...prev, ...filtered }))
        setDebugSteps(res?.debugSteps || [])
        
        // Extract B+T+U prompt injection info from debug steps
        const steps = res?.debugSteps || []
        const injectionInfo: Record<string, any> = {}
        steps.forEach((step: any) => {
          if (step.step?.startsWith('build_prompt_') && step.meta?.promptInjection) {
            const sectionKey = step.step.replace('build_prompt_', '')
            injectionInfo[sectionKey] = step.meta.promptInjection
          }
        })
        if (Object.keys(injectionInfo).length > 0) {
          setPromptInjectionInfo(prev => ({ ...prev, ...injectionInfo }))
        }
        
        // REMOVED: onRefresh() - content is already persisted via onComplete, local state is updated
        // Avoiding refresh reduces delay and prevents UI flicker
      }
    } catch (error) {
      console.error('Generation failed:', error)
      toast({ title: 'Generation failed', description: `${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`, variant: 'error' })
      setDebugSteps([{ step: 'error', status: 'fail', meta: { error: error instanceof Error ? error.message : String(error) } }])
    } finally {
      setLoading(false)
      // Optionally hide activity after a delay
      // setTimeout(() => setShowActivity(false), 5000)
    }
  }
  
  // Helper function to generate a single section (used by auto-mode)
  const generateSingleSection = async (
    sectionKey: string,
    isReference: boolean,
    options: { suppressRefresh?: boolean } = {}
  ): Promise<{ success: boolean; content?: string; error?: string; cancelled?: boolean }> => {
    try {
      if (isReference) {
        // Use REFERENCE-specific API
        const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'generate_reference_section',
            sessionId: session?.id,
            sectionKey
          })
        })
        const data = await res.json()
        if (!res.ok) {
          return { success: false, error: data.error || 'Failed to generate section' }
        }
        if (data.success && data.content) {
          return { success: true, content: data.content }
        }
        return { success: false, error: 'No content returned' }
      } else {
        // Standard generation
        const res = await generateSectionsWithPersonaHandling({
          action: 'generate_sections',
          sessionId: session?.id,
          sections: [sectionKey],
          usePersonaStyle,
          personaSelection, // Pass selected personas for multi-persona style support
          jurisdiction: activeJurisdiction,
          suppressRefresh: options.suppressRefresh === true
        })
        if (res?.cancelled) {
          return { success: false, cancelled: true, error: 'Generation cancelled' }
        }
        const incoming = res?.generated || {}
        const value = typeof incoming?.[sectionKey] === 'string' ? incoming[sectionKey].trim() : ''
        if (value) {
          return { success: true, content: value }
        }
        return { success: false, error: 'No content returned' }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Pre-check function to identify all warnings before starting auto-generation
  const checkAutoModeWarnings = async (sectionsToCheck: string[]): Promise<{ warnings: Array<{ section: string; type: 'priorArt' | 'figures' | 'components'; message: string; impact: string }>; errors: string[] }> => {
    try {
      const isReference = activeJurisdiction.toUpperCase() === 'REFERENCE'
      
      // Consolidated API call - same endpoint for both REFERENCE and regular jurisdictions
      const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'check_warnings',
          sessionId: session?.id,
          sections: sectionsToCheck,
          // Only include jurisdiction for non-REFERENCE drafts
          ...(isReference ? {} : { jurisdiction: activeJurisdiction })
        })
      })
      
      const data = await res.json()
      if (res.ok && data.warnings) {
        return { warnings: data.warnings, errors: [] }
      }
      return { warnings: [], errors: [] }
    } catch (err) {
      console.warn('Failed to check warnings:', err)
      return { warnings: [], errors: [] }
    }
  }

  // State for auto-mode warning modal
  const [autoModeWarningModal, setAutoModeWarningModal] = useState<{
    show: boolean
    warnings: Array<{ section: string; type: 'priorArt' | 'figures' | 'components'; message: string; impact: string }>
    pendingSections: string[]
  }>({ show: false, warnings: [], pendingSections: [] })

  // Start auto-generation after user confirms in the modal
  const startAutoGeneration = async (pendingSections: string[]) => {
    setAutoModeWarningModal({ show: false, warnings: [], pendingSections: [] })
    
    // Reset cancellation flag
    autoModeCancelledRef.current = false
    setAutoModeRunning(true)
    setShowActivity(true)
    
    const isReference = activeJurisdiction.toUpperCase() === 'REFERENCE'
    let successCount = 0
    let failedSection: string | null = null
    let failedError: string | null = null
    
    try {
      for (let i = 0; i < pendingSections.length; i++) {
        // Check if auto-mode was cancelled (using ref for immediate check)
        if (autoModeCancelledRef.current) {
          console.log('[AutoMode] Cancelled by user')
          break
        }
        
        const sectionKey = pendingSections[i]
        const sectionLabel = displayName[sectionKey] || sectionKey
        
        setAutoModeProgress({
          current: i + 1,
          total: pendingSections.length,
          currentSection: sectionLabel
        })
        
        setCurrentKeys([sectionKey])
        setSectionLoading(prev => ({ ...prev, [sectionKey]: true }))
        setDebugSteps([{ step: `llm_call_${sectionKey}`, status: 'running' }])
        
        // First attempt
        let result = await generateSingleSection(sectionKey, isReference, { suppressRefresh: true })
        if (result.cancelled) {
          autoModeCancelledRef.current = true
          setSectionLoading(prev => ({ ...prev, [sectionKey]: false }))
          break
        }
        
        // If failed, retry once
        if (!result.success) {
          console.log(`[AutoMode] First attempt failed for ${sectionKey}, retrying...`)
          setDebugSteps([{ step: `retry_${sectionKey}`, status: 'running' }])
          
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          // Check cancellation before retry
          if (autoModeCancelledRef.current) {
            setSectionLoading(prev => ({ ...prev, [sectionKey]: false }))
            break
          }
          
          result = await generateSingleSection(sectionKey, isReference, { suppressRefresh: true })
          if (result.cancelled) {
            autoModeCancelledRef.current = true
            setSectionLoading(prev => ({ ...prev, [sectionKey]: false }))
            break
          }
        }
        
        setSectionLoading(prev => ({ ...prev, [sectionKey]: false }))
        
        if (result.success && result.content) {
          setGenerated(prev => ({ ...prev, [sectionKey]: result.content! }))
          setDebugSteps([{ step: `llm_call_${sectionKey}`, status: 'ok' }])
          successCount++
        } else {
          // Failed after retry - stop auto-mode and notify user
          console.error(`[AutoMode] Failed to generate ${sectionKey} after retry:`, result.error)
          setDebugSteps([{ step: `generate_${sectionKey}`, status: 'fail', meta: { error: result.error } }])
          failedSection = sectionLabel
          failedError = result.error || 'Unknown error'
          break // Stop the loop
        }
        
        // Small delay between sections to avoid overwhelming the API
        if (i < pendingSections.length - 1 && !autoModeCancelledRef.current) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
      
      // Final refresh to ensure all content is persisted
      await onRefresh()
      
      // Show appropriate message based on outcome
      if (autoModeCancelledRef.current) {
        toast({ title: 'Auto-generation stopped', description: `${successCount} of ${pendingSections.length} section(s) were generated and saved.` })
      } else if (failedSection) {
        toast({
          title: 'Auto-generation stopped due to error',
          description: `Failed section: ${failedSection}. Error: ${failedError}. ` +
            `${successCount} of ${pendingSections.length} section(s) were generated before the error.`,
          variant: 'error'
        })
      } else {
        // Success - show different message based on jurisdiction
        if (successCount > 0) {
          if (isReference) {
            toast({
              title: 'Reference Draft Complete!',
              description: `${successCount} section(s) have been generated and saved. ` +
                `Other jurisdictions (${availableJurisdictions.join(', ')}) are now unlocked for translation.`,
              variant: 'success'
            })
          } else {
            toast({ title: 'Auto-generation complete!', description: `${successCount} section(s) have been generated and saved.`, variant: 'success' })
          }
        }
      }
    } catch (error) {
      console.error('[AutoMode] Unexpected error:', error)
      toast({ title: 'Auto-generation failed unexpectedly', description: `${error instanceof Error ? error.message : 'Unknown error'}. ${successCount} section(s) were generated before the error.`, variant: 'error' })
    } finally {
      setAutoModeRunning(false)
      setAutoModeProgress(null)
      setCurrentKeys(null)
      // Reset cancellation flag
      autoModeCancelledRef.current = false
    }
  }

  // Auto-mode: Generate all sections sequentially without user interaction
  const handleAutoGenerateAll = async () => {
    if (autoModeRunning || loading) return

    if (visibleSectionConfigs.length === 0) return

    // Get all section keys that don't have content yet
    const pendingSections = visibleSectionConfigs
      .map(s => s.keys[0])
      .filter(key => key && !generated?.[key]?.trim())

    if (pendingSections.length === 0) {
      toast({ title: 'All sections already have content', description: 'Use the regenerate option to update individual sections.' })
      return
    }

    // Pre-check for warnings before starting auto-generation
    setLoading(true)
    const { warnings } = await checkAutoModeWarnings(pendingSections)
    setLoading(false)

    // Show warning modal with all warnings before proceeding
    setAutoModeWarningModal({
      show: true,
      warnings,
      pendingSections
    })
  }
  
  // Stop auto-mode immediately
  const handleStopAutoMode = () => {
    autoModeCancelledRef.current = true // Immediate flag for sync check
    setAutoMode(false)
  }

  const handleApproveSave = async (keys: string[]) => {
    const patch: Record<string, string> = {}
    for (const k of keys) if (generated?.[k]) patch[k] = generated[k]
    if (Object.keys(patch).length === 0) return
    await onComplete({ action: 'save_sections', sessionId: session?.id, patch })
    // REMOVED: onRefresh() - content is already persisted via onComplete
  }

  const handleDeleteSectionContent = async (key: string, confirmFirst = true) => {
    if (!session?.id) return
    if (confirmFirst && !confirm(`Delete "${displayName[key] || key}" section content?\n\nThis will clear the generated content. You can regenerate it later.`)) {
      return
    }

    const previousValue = generated?.[key] || editDrafts?.[key] || ''
    setGenerated(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setEditDrafts(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })

    try {
      const response = await onComplete({
        action: 'autosave_sections',
        sessionId: session.id,
        patch: { [key]: null },
        suppressRefresh: true
      })
      if (response?.error) throw new Error(response.error)
      if (editingKey === key) setEditingKey(null)
    } catch (error) {
      if (previousValue) setGenerated(prev => ({ ...prev, [key]: previousValue }))
      toast({ title: 'Failed to delete section', description: error instanceof Error ? error.message : 'Unknown error', variant: 'error' })
    }
  }

  const handleAutosaveSection = async (key: string) => {
    const value = (editDrafts?.[key] ?? generated?.[key] ?? '').trim()
    if (!value) {
      await handleDeleteSectionContent(key, false)
      return
    }
    setGenerated(prev => ({ ...prev, [key]: value }))
    await onComplete({ action: 'autosave_sections', sessionId: session?.id, patch: { [key]: value } })
    setEditingKey(null)
  }

  const handleRegenerateSection = async (key: string) => {
    if (sectionLoading[key]) return
    setSectionLoading(prev => ({ ...prev, [key]: true }))
    setShowActivity(true)
    try {
      const isReference = activeJurisdiction.toUpperCase() === 'REFERENCE'
      
      if (isReference) {
        // Use REFERENCE-specific API for proper persistence
        const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'generate_reference_section',
            sessionId: session?.id,
            sectionKey: key
          })
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Failed to regenerate section')
        }
        if (data.success && data.content) {
          setGenerated(prev => ({ ...prev, [key]: data.content }))
        }
        setDebugSteps([{ step: `regenerate_${key}`, status: 'done' }])
        // REMOVED: onRefresh() - content is already persisted by API, local state is updated
      } else {
        // Standard regeneration for non-REFERENCE jurisdictions
        const instructions: Record<string, string> = {}
        if (regenRemarks[key]) instructions[key] = regenRemarks[key]
        const res = await generateSectionsWithPersonaHandling({
          action: 'generate_sections',
          sessionId: session?.id,
          sections: [key],
          instructions,
          usePersonaStyle,
          personaSelection, // Pass selected personas for multi-persona style support
          jurisdiction: activeJurisdiction
        })
        if (res?.cancelled) return
        const incoming = res?.generated || {}
        const value = typeof incoming?.[key] === 'string' ? incoming[key].trim() : ''
        if (value) setGenerated(prev => ({ ...prev, [key]: value }))
        setDebugSteps(res?.debugSteps || [])
        
        // Extract B+T+U prompt injection info from debug steps
        const steps = res?.debugSteps || []
        const injectionInfo: Record<string, any> = {}
        steps.forEach((step: any) => {
          if (step.step?.startsWith('build_prompt_') && step.meta?.promptInjection) {
            const sectionKey = step.step.replace('build_prompt_', '')
            injectionInfo[sectionKey] = step.meta.promptInjection
          }
        })
        if (Object.keys(injectionInfo).length > 0) {
          setPromptInjectionInfo(prev => ({ ...prev, ...injectionInfo }))
        }
        
        // REMOVED: onRefresh() - content is already persisted via onComplete, local state is updated
      }
      
      setRegenOpen(prev => ({ ...prev, [key]: false }))
      setRegenRemarks(prev => ({ ...prev, [key]: '' }))
    } catch (error) {
      console.error('Regeneration failed:', error)
      toast({ title: 'Regeneration failed', description: `${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`, variant: 'error' })
      setDebugSteps([{ step: 'error', status: 'fail', meta: { error: error instanceof Error ? error.message : String(error) } }])
    } finally {
      setSectionLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  // If no jurisdictions are available, show a message instead of defaulting to IN
  if (availableJurisdictions.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="text-ai-graphite-500 mb-4">
          <svg className="mx-auto h-12 w-12 text-ai-graphite-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-ai-graphite-900 mb-2">No Jurisdictions Available</h3>
        <p className="text-ai-graphite-500 mb-4">All patent jurisdictions have been removed from this drafting session.</p>
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-ai-blue-600 hover:bg-ai-blue-700"
        >
          Go Back
        </button>
      </div>
    )
  }

  // Tooltip wrapper component for hover explanations
  const Tooltip = ({ children, content, position = 'bottom' }: { children: React.ReactNode; content: string; position?: 'top' | 'bottom' | 'left' | 'right' }) => (
    <div className="relative group/tooltip inline-flex">
      {children}
      <div className={`absolute z-50 invisible group-hover/tooltip:visible opacity-0 group-hover/tooltip:opacity-100 transition-all duration-200 pointer-events-none
        ${position === 'bottom' ? 'top-full mt-2 left-1/2 -translate-x-1/2' : ''}
        ${position === 'top' ? 'bottom-full mb-2 left-1/2 -translate-x-1/2' : ''}
        ${position === 'left' ? 'right-full mr-2 top-1/2 -translate-y-1/2' : ''}
        ${position === 'right' ? 'left-full ml-2 top-1/2 -translate-y-1/2' : ''}
      `}>
        <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-xl max-w-xs whitespace-normal leading-relaxed">
          {content}
          <div className={`absolute w-2 h-2 bg-slate-900 transform rotate-45
            ${position === 'bottom' ? '-top-1 left-1/2 -translate-x-1/2' : ''}
            ${position === 'top' ? '-bottom-1 left-1/2 -translate-x-1/2' : ''}
            ${position === 'left' ? '-right-1 top-1/2 -translate-y-1/2' : ''}
            ${position === 'right' ? '-left-1 top-1/2 -translate-y-1/2' : ''}
          `} />
        </div>
      </div>
    </div>
  )

  // Check if delete is allowed (only when more than one jurisdiction)
  const canDeleteJurisdiction = availableJurisdictions.filter(j => j !== 'REFERENCE').length > 1

  return (
    <div className="pb-24 pt-8 bg-[#F5F6F7] min-h-screen relative">
      {/* Confirmation Modal for Clear/Delete Actions */}
      {confirmationModal.isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setConfirmationModal({ isOpen: false, type: 'clear', jurisdiction: '', inputValue: '' })
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2 rounded-full ${confirmationModal.type === 'delete' ? 'bg-red-100' : 'bg-amber-100'}`}>
                {confirmationModal.type === 'delete' ? (
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ai-graphite-900">
                  {confirmationModal.type === 'delete' ? 'Delete Jurisdiction Draft' : 'Clear Draft Content'}
                </h3>
                <p className="text-sm text-ai-graphite-500">
                  {confirmationModal.type === 'delete' 
                    ? `This will permanently remove ${confirmationModal.jurisdiction} from your drafting session.`
                    : `This will clear all generated content for ${confirmationModal.jurisdiction}.`
                  }
                </p>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-ai-graphite-700 mb-2">
                Type <span className="font-bold text-ai-graphite-900">"{confirmationModal.type === 'delete' ? 'DELETE' : 'CLEAR'}"</span> to confirm:
              </label>
              <input
                type="text"
                value={confirmationModal.inputValue}
                onChange={(e) => setConfirmationModal(prev => ({ ...prev, inputValue: e.target.value.toUpperCase() }))}
                className="w-full px-3 py-2 border border-paper-400 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                placeholder={confirmationModal.type === 'delete' ? 'Type DELETE' : 'Type CLEAR'}
                autoFocus
              />
            </div>
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmationModal({ isOpen: false, type: 'clear', jurisdiction: '', inputValue: '' })}
                className="px-4 py-2 text-sm font-medium text-ai-graphite-700 bg-paper-200 rounded-lg hover:bg-paper-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const expectedValue = confirmationModal.type === 'delete' ? 'DELETE' : 'CLEAR'
                  if (confirmationModal.inputValue === expectedValue) {
                    try {
                      await handleDeleteDraft(confirmationModal.jurisdiction, confirmationModal.type === 'delete')
                      setConfirmationModal({ isOpen: false, type: 'clear', jurisdiction: '', inputValue: '' })
                    } catch (error) {
                      console.error('Action failed:', error)
                      toast({ title: `Failed to ${confirmationModal.type} draft`, description: 'Please try again.', variant: 'error' })
                    }
                  }
                }}
                disabled={confirmationModal.inputValue !== (confirmationModal.type === 'delete' ? 'DELETE' : 'CLEAR')}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  confirmationModal.type === 'delete' 
                    ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-400' 
                    : 'bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400'
                }`}
              >
                {confirmationModal.type === 'delete' ? 'Delete Jurisdiction' : 'Clear Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help Panel - Fixed position in corner */}
      {showHelpPanel && (
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-40 sm:w-80 bg-white rounded-xl shadow-2xl border border-paper-300 overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
          <div className="bg-gradient-to-r from-ai-blue-600 to-ai-blue-600 px-4 py-3 flex items-center justify-between">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Drafting Help
            </h3>
            <button onClick={() => setShowHelpPanel(false)} className="text-white/80 hover:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-4 max-h-96 overflow-y-auto text-sm space-y-4">
            <div>
              <h4 className="font-semibold text-ai-graphite-900 mb-1">📝 Style</h4>
              <p className="text-ai-graphite-600 text-xs">Turn this on to draft in your own voice instead of the default one. It only changes the writing — never the technical substance.</p>
            </div>
            <div>
              <h4 className="font-semibold text-ai-graphite-900 mb-1">👤 Persona</h4>
              <p className="text-ai-graphite-600 text-xs">Which saved style to write in. A persona only has an effect once it has writing samples — add them on the Writing Personas page.</p>
            </div>
            <div>
              <h4 className="font-semibold text-ai-graphite-900 mb-1">✍️ Default style</h4>
              <p className="text-ai-graphite-600 text-xs">Samples that belong to you rather than to a persona. They fill in for any section the selected persona has not been taught.</p>
            </div>
            <div>
              <h4 className="font-semibold text-ai-graphite-900 mb-1">🚀 Auto Mode</h4>
              <p className="text-ai-graphite-600 text-xs">Automatically generate all sections sequentially. Great for initial drafts.</p>
            </div>
            <div>
              <h4 className="font-semibold text-ai-graphite-900 mb-1">🌍 Multi-Jurisdiction</h4>
              <p className="text-ai-graphite-600 text-xs">Draft for multiple countries. The Reference Draft is your master template that gets translated to country-specific versions.</p>
            </div>
            <div>
              <h4 className="font-semibold text-ai-graphite-900 mb-1">🔬 AI Review</h4>
              <p className="text-ai-graphite-600 text-xs">After generating, run AI Review to check for consistency, completeness, and patent-specific issues.</p>
            </div>
            <div className="pt-2 border-t border-paper-200">
              <p className="text-ai-graphite-400 text-xs">Hover over any control for more details.</p>
            </div>
          </div>
        </div>
      )}

      {/* Top Controls Bar - Redesigned */}
      <div className="max-w-[850px] mx-auto mb-6 px-2 sm:px-8">
        {/* Header Row */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-ai-graphite-900">Annexure Draft</h2>
            <p className="text-sm text-ai-graphite-500">Review and edit your patent application.</p>
          </div>
          
          {/* Help Button */}
          <Tooltip content="Open the help guide to learn about all the drafting tools and features available." position="left">
            <button
              onClick={() => setShowHelpPanel(!showHelpPanel)}
              className={`p-2.5 rounded-full transition-all duration-200 ${
                showHelpPanel 
                  ? 'bg-ai-blue-100 text-ai-blue-700 ring-2 ring-ai-blue-300' 
                  : 'bg-white border border-paper-300 text-ai-graphite-500 hover:bg-paper-100 hover:text-ai-blue-600 shadow-sm'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </Tooltip>
        </div>

        {/* Controls Row - Organized into logical groups */}
        <div className="bg-white rounded-xl border border-paper-300 shadow-sm p-3">
          <div className="flex flex-wrap items-center gap-3">
            
            {/* Group 1: Writing Style Controls */}
            <div className="flex items-center gap-2 pr-3 border-r border-paper-300">
              <Tooltip content="Draft in your own voice: the selected persona's samples set the tone, terminology, and structure. Substance is unaffected." position="bottom">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                  usePersonaStyle ? 'bg-emerald-50' : 'bg-paper-100'
                }`}>
                  <button
                    onClick={() => { void handleStyleToggle() }}
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      usePersonaStyle ? 'bg-emerald-500' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      usePersonaStyle ? 'left-4' : 'left-0.5'
                    }`} />
                  </button>
                  <span className={`text-xs font-medium ${usePersonaStyle ? 'text-emerald-700' : 'text-ai-graphite-500'}`}>
                    Style
                  </span>
                </div>
              </Tooltip>

              <Tooltip content="Which saved writing style to draft in. A persona has an effect only once it holds writing samples." position="bottom">
                <button
                  onClick={() => setShowPersonaManager(true)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                    personaSelection?.primaryPersonaName
                      ? 'bg-ai-blue-50 border-ai-blue-200 text-ai-blue-700'
                      : 'bg-white border-paper-300 text-ai-graphite-600 hover:bg-paper-100'
                  }`}
                >
                  <span>👤</span>
                  <span className="font-medium">
                    {personaSelection?.primaryPersonaName || 'Persona'}
                  </span>
                  {personaSelection?.secondaryPersonaNames?.length ? (
                    <span className="text-[10px] bg-ai-blue-200 text-ai-blue-700 px-1 rounded">+{personaSelection.secondaryPersonaNames.length}</span>
                  ) : null}
                </button>
              </Tooltip>

              <Tooltip content="Your own samples, not tied to any persona. They fill in for sections the selected persona has not been taught." position="bottom">
                <button
                  onClick={() => setShowWritingSamplesModal(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-white border border-paper-300 text-ai-graphite-600 hover:bg-paper-100 transition-colors"
                >
                  <span>✍️</span>
                  <span className="font-medium">Default style</span>
                </button>
              </Tooltip>
            </div>

            {/* Group 2: Generation Controls */}
            <div className="flex items-center gap-2 pr-3 border-r border-paper-300">
              <Tooltip content="Enable Auto Mode to generate all draft sections automatically in sequence. Perfect for creating a complete first draft quickly." position="bottom">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                  autoModeRunning ? 'bg-amber-50' : autoMode ? 'bg-emerald-50' : 'bg-paper-100'
                }`}>
                  <button
                    onClick={() => setAutoMode(!autoMode)}
                    disabled={autoModeRunning}
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      autoMode ? 'bg-emerald-500' : 'bg-gray-300'
                    } ${autoModeRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      autoMode ? 'left-4' : 'left-0.5'
                    }`} />
                  </button>
                  <span className={`text-xs font-medium ${autoMode ? 'text-emerald-700' : 'text-ai-graphite-500'}`}>
                    {autoModeRunning ? '⏳ Running...' : 'Auto'}
                  </span>
                </div>
              </Tooltip>

              {autoMode && !autoModeRunning && (
                <Tooltip content="Start generating all remaining sections automatically." position="bottom">
                  <button
                    onClick={handleAutoGenerateAll}
                    disabled={loading}
                    className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors disabled:opacity-50"
                  >
                    Generate All
                  </button>
                </Tooltip>
              )}

              {autoModeRunning && (
                <>
                  {autoModeProgress && (
                    <div className="flex items-center gap-2 px-2 py-1 rounded bg-ai-blue-50 border border-ai-blue-100">
                      <div className="w-2 h-2 rounded-full bg-ai-blue-500 animate-pulse" />
                      <span className="text-xs font-medium text-ai-blue-700">
                        {autoModeProgress.current}/{autoModeProgress.total}
                      </span>
                      <span className="text-xs text-ai-blue-600 max-w-[100px] truncate">
                        {autoModeProgress.currentSection}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={handleStopAutoMode}
                    className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium transition-colors"
                  >
                    Stop
                  </button>
                </>
              )}
            </div>

            {/* Group 3: Draft Management */}
            <div className="flex items-center gap-2 pr-3 border-r border-paper-300">
              <Tooltip content="Clear all generated content for the current jurisdiction while keeping it in your drafting list." position="bottom">
                <button
                  type="button"
                  onClick={() => setConfirmationModal({ isOpen: true, type: 'clear', jurisdiction: activeJurisdiction, inputValue: '' })}
                  disabled={loading || deletingJurisdiction === activeJurisdiction || autoModeRunning}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-paper-300 bg-white text-ai-graphite-600 hover:bg-paper-100 disabled:opacity-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span className="font-medium">Clear</span>
                </button>
              </Tooltip>

              <Tooltip content={canDeleteJurisdiction 
                ? "Permanently delete this jurisdiction and remove it from your drafting session." 
                : "Cannot delete - you must have at least one jurisdiction in your drafting session."
              } position="bottom">
                <button
                  type="button"
                  onClick={() => canDeleteJurisdiction && setConfirmationModal({ isOpen: true, type: 'delete', jurisdiction: activeJurisdiction, inputValue: '' })}
                  disabled={loading || deletingJurisdiction === activeJurisdiction || autoModeRunning || !canDeleteJurisdiction}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
                    canDeleteJurisdiction
                      ? 'border-red-200 bg-white text-red-600 hover:bg-red-50'
                      : 'border-paper-300 bg-paper-100 text-ai-graphite-400 cursor-not-allowed'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="font-medium">Delete</span>
                </button>
              </Tooltip>
            </div>

            {/* Group 4: Tools */}
            <div className="flex items-center gap-2">
              <Tooltip content="Add custom instructions for specific sections to guide the AI's output for this draft." position="bottom">
                <button
                  onClick={() => setShowAllInstructionsModal(true)}
                  className={`p-2 rounded-lg border transition-colors relative ${
                    Object.keys(userInstructions).length > 0
                      ? 'bg-lamp-50 border-lamp-200 text-lamp-700'
                      : 'bg-white border-paper-300 text-ai-graphite-500 hover:bg-paper-100'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  {Object.keys(userInstructions).length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-lamp-500 rounded-full text-[9px] text-white flex items-center justify-center font-medium">
                      {Object.values(userInstructions).reduce((sum, j) => sum + Object.keys(j).length, 0)}
                    </span>
                  )}
                </button>
              </Tooltip>

              <Tooltip content="Customize the font family, size, and line spacing of the draft preview." position="bottom">
                <div className="relative">
                  <button
                    onClick={() => setShowFormatting(!showFormatting)}
                    className={`p-2 rounded-lg border transition-colors ${
                      showFormatting
                        ? 'bg-ai-blue-50 border-ai-blue-200 text-ai-blue-700'
                        : 'bg-white border-paper-300 text-ai-graphite-500 hover:bg-paper-100'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                  </button>

                  {/* Formatting Panel */}
                  {showFormatting && (
                    <div className="absolute right-0 mt-2 w-64 bg-white border border-paper-300 rounded-xl shadow-xl z-50 p-4">
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium text-ai-graphite-700 mb-2">Font Family</label>
                          <select
                            value={fontFamily}
                            onChange={(e) => setFontFamily(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-paper-300 rounded-lg focus:ring-ai-blue-500 focus:border-ai-blue-500"
                          >
                            <option value="serif">Serif (Times New Roman)</option>
                            <option value="sans-serif">Sans Serif (Arial)</option>
                            <option value="monospace">Monospace (Courier)</option>
                            <option value="Georgia, serif">Georgia</option>
                            <option value="system-ui, sans-serif">System UI</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-ai-graphite-700 mb-2">Font Size</label>
                          <select
                            value={fontSize}
                            onChange={(e) => setFontSize(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-paper-300 rounded-lg focus:ring-ai-blue-500 focus:border-ai-blue-500"
                          >
                            <option value="12px">Small (12px)</option>
                            <option value="14px">Medium (14px)</option>
                            <option value="15px">Default (15px)</option>
                            <option value="16px">Large (16px)</option>
                            <option value="18px">Extra Large (18px)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-ai-graphite-700 mb-2">Line Spacing</label>
                          <select
                            value={lineHeight}
                            onChange={(e) => setLineHeight(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-paper-300 rounded-lg focus:ring-ai-blue-500 focus:border-ai-blue-500"
                          >
                            <option value="1.3">Compact (1.3)</option>
                            <option value="1.5">Normal (1.5)</option>
                            <option value="1.7">Relaxed (1.7)</option>
                            <option value="1.9">Spacious (1.9)</option>
                            <option value="2.1">Very Spacious (2.1)</option>
                          </select>
                        </div>

                        <div className="flex justify-end pt-2 border-t border-paper-200">
                          <button
                            onClick={() => setShowFormatting(false)}
                            className="px-3 py-1.5 text-xs font-medium text-ai-blue-600 hover:text-ai-blue-800 transition-colors"
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </Tooltip>
            </div>

            {/* Active Jurisdiction Badge */}
            {activeJurisdiction && (
              <div className="ml-auto">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200">
                  <span className="text-xs text-slate-500">Drafting:</span>
                  <span className="text-xs font-semibold text-slate-700">{activeJurisdiction}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isMultiJurisdiction && (
        <div className="max-w-[850px] mx-auto mb-8 px-2 sm:px-8">
          <div className="border border-paper-300 rounded-lg bg-white shadow-sm p-4">
            <div className="text-xs font-semibold text-ai-graphite-500 uppercase mb-2">
              Multi-Jurisdiction Filing
              {!session?.referenceDraftComplete && (
                <span className="ml-2 text-amber-600 font-normal normal-case">
                  ⚠️ Generate Reference Draft first
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* Reference Draft Tab - Always first in multi-jurisdiction mode */}
              <button
                onClick={() => handleJurisdictionChange('REFERENCE')}
                className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                  activeJurisdiction === 'REFERENCE'
                    ? 'bg-ai-blue-50 border-ai-blue-200 text-ai-blue-700'
                    : 'bg-white border-paper-300 text-ai-graphite-600 hover:bg-paper-100'
                }`}
              >
                📝 Reference Draft
                {session?.referenceDraftComplete && (
                  <span className="ml-1.5 text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded">✓</span>
                )}
              </button>
              
              {/* Country jurisdiction tabs - exclude REFERENCE as it has its own dedicated tab above */}
              {availableJurisdictions
                .filter(code => code !== 'REFERENCE')
                .map((code) => {
                const isLocked = !session?.referenceDraftComplete
                const hasTranslation = latestDrafts[code]?.version > 0
                
                return (
                <button
                  key={code}
                    onClick={() => !isLocked && handleJurisdictionChange(code)}
                    disabled={isLocked}
                  className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                      isLocked
                        ? 'bg-paper-200 border-paper-300 text-ai-graphite-400 cursor-not-allowed'
                        : code === activeJurisdiction
                      ? 'bg-ai-blue-50 border-ai-blue-200 text-ai-blue-700'
                      : 'bg-white border-paper-300 text-ai-graphite-600 hover:bg-paper-100'
                  }`}
                    title={isLocked ? 'Complete Reference Draft first' : `Draft for ${code}`}
                  >
                    {isLocked && '🔒 '}{code}
                    {hasTranslation && !isLocked && (
                      <span className="ml-1.5 text-[10px] bg-ai-blue-100 text-ai-blue-700 px-1 rounded">v{latestDrafts[code]?.version}</span>
                    )}
                </button>
                )
              })}
            </div>
            
            {/* Translation hint */}
            {session?.referenceDraftComplete && activeJurisdiction !== 'REFERENCE' && (
              <div className="mt-3 text-xs text-ai-graphite-500 bg-ai-blue-50 border border-ai-blue-100 rounded p-2">
                💡 <strong>Translation Mode:</strong> Content will be translated from Reference Draft with temp=0 for consistency.
              </div>
            )}
            
            {/* Action buttons for multi-jurisdiction - same UI pattern as other jurisdictions */}
            <div className="mt-4 flex flex-wrap gap-2">
              {activeJurisdiction === 'REFERENCE' && session?.referenceDraftComplete && (
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm flex items-center gap-2">
                    ✅ Reference Draft Complete
                  </span>
                </div>
              )}
              
              {activeJurisdiction !== 'REFERENCE' && session?.referenceDraftComplete && (
                <button
                  onClick={() => handleTranslateToJurisdiction(activeJurisdiction)}
                  disabled={!!translating}
                  className="px-4 py-2 bg-ai-blue-600 text-white rounded-lg font-medium hover:bg-ai-blue-700 disabled:opacity-60 flex items-center gap-2"
                >
                  {translating === activeJurisdiction ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Translating to {activeJurisdiction}...
                    </>
                  ) : (
                    <>
                      <span>🔄</span>
                      Translate to {activeJurisdiction}
                    </>
                  )}
                </button>
              )}
              
              {/* Translate All button */}
              {activeJurisdiction === 'REFERENCE' && session?.referenceDraftComplete && availableJurisdictions.length > 0 && (
                <button
                  onClick={async () => {
                    for (const code of availableJurisdictions) {
                      if (!latestDrafts[code]?.version) {
                        await handleTranslateToJurisdiction(code)
                      }
                    }
                  }}
                  disabled={!!translating}
                  className="px-4 py-2 bg-ai-blue-600 text-white rounded-lg font-medium hover:bg-ai-blue-700 disabled:opacity-60 flex items-center gap-2"
                >
                  {translating ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Translating {translating}...
                    </>
                  ) : (
                    <>
                      <span>🌐</span>
                      Translate All ({availableJurisdictions.filter(c => !latestDrafts[c]?.version).length} remaining)
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The "Paper" Document */}
      <div className="max-w-[850px] mx-auto bg-white shadow-[0_4px_24px_rgba(0,0,0,0.06)] min-h-[70vh] sm:min-h-[1100px] px-4 py-8 sm:px-10 sm:py-12 lg:px-[60px] lg:py-[60px] relative border border-paper-200">

        {profileLoading && (
          <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 text-ai-graphite-500">
               <span className="animate-spin h-4 w-4 border-2 border-ai-blue-500 border-t-transparent rounded-full"></span>
               Loading template...
            </div>
          </div>
        )}

        {profileError && (
          <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
            <div className="font-semibold">Jurisdiction configuration error</div>
            <div className="text-sm mt-1">
              {profileError}
            </div>
            <div className="text-sm mt-2">
              Fix this in <a className="underline" href="/super-admin/jurisdiction-config">/super-admin/jurisdiction-config</a> (ensure every mapped section has a positive, unique display order).
            </div>
          </div>
        )}

        <div className="space-y-10">
            {visibleSectionConfigs.map((section, idx) => {
              const isGeneratingThis = loading && currentKeys?.join('|') === section.keys.join('|')
              const isRegeneratingThis = section.keys.some(k => sectionLoading[k])
              const isWorking = isGeneratingThis || isRegeneratingThis
              const hasContent = section.keys.some(k => generated?.[k])

              return (
              <div key={section.keys.join('|') || idx} className="group relative hover:bg-paper-100/30 transition-colors -mx-4 px-4 py-2 rounded-lg">
                {/* Section actions. On desktop they float in the margin and
                    reveal on hover; touch devices have no hover, so below lg
                    they sit inline above the section and stay visible. */}
                <div className={`mb-3 flex justify-end lg:absolute lg:-right-4 lg:top-0 lg:mb-0 lg:block lg:transform lg:translate-x-full lg:pl-2 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity ${isWorking ? 'lg:opacity-100' : ''}`}>
                   <div className="inline-flex flex-row lg:flex-col gap-1 bg-white border border-paper-300 shadow-sm rounded-md p-1">
                      {!hasContent ? (
                         <button
                           disabled={loading || autoModeRunning}
                           onClick={() => autoMode && !autoModeRunning ? handleAutoGenerateAll() : handleGenerate(section.keys)}
                           className="p-2 text-ai-blue-600 hover:bg-ai-blue-50 rounded-md"
                           title={autoMode ? "Generate all pending sections" : "Generate"}
                         >
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                         </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleApproveSave(section.keys)}
                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-md"
                            title="Save"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" /></svg>
                          </button>
                          <button
                             onClick={() => {
                               const key = section.keys[0] // Default to first key for simple edit trigger
                               setEditingKey(editingKey === key ? null : key)
                               setEditDrafts(prev => ({ ...prev, [key]: generated?.[key] || '' }))
                             }}
                             className="p-2 text-ai-graphite-500 hover:bg-paper-200 rounded-md"
                             title="Edit"
                          >
                             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                        </>
                      )}
                   </div>
                </div>

                {/* Section Header */}
                <div className="flex items-baseline justify-between mb-4">
                  <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-ai-graphite-900 uppercase tracking-wide">
                    {section.label || section.keys.map(k => displayName[k] || k).join(' / ')}
                  </h3>
                    {/* Per-section instruction controls */}
                    {(() => {
                      const key = section.keys[0]
                      const jurisdictionInstr = userInstructions[activeJurisdiction]?.[key]
                      const globalInstr = userInstructions['*']?.[key]
                      const hasInstruction = jurisdictionInstr || globalInstr
                      const activeInstr = jurisdictionInstr || globalInstr
                      const isActive = activeInstr?.isActive !== false
                      
                      return (
                        <div className="relative flex items-center gap-1">
                          {hasInstruction && (
                            <span
                              className={`text-[10px] px-2 py-1 rounded-full ${
                                isActive
                                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                  : 'bg-amber-100 text-amber-700 border border-amber-200'
                              }`}
                              title={isActive ? 'Instruction is active' : 'Instruction is saved but inactive'}
                            >
                              {isActive ? 'INSTR ON' : 'INSTR OFF'}
                            </span>
                          )}
                          {/* Quick toggle button - only show if instruction exists */}
                          {hasInstruction && (
                            <button
                              onClick={async () => {
                                const instr = jurisdictionInstr || globalInstr
                                if (!instr) return
                                const newStatus = !isActive
                                try {
                                  await fetch(`/api/patents/${patent?.id}/drafting/user-instructions`, {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                                    },
                                    body: JSON.stringify({
                                      sessionId: session?.id,
                                      sectionKey: key,
                                      jurisdiction: instr.jurisdiction || (jurisdictionInstr ? activeJurisdiction : '*'),
                                      instruction: instr.instruction,
                                      emphasis: instr.emphasis,
                                      avoid: instr.avoid,
                                      style: instr.style,
                                      wordCount: instr.wordCount,
                                      isActive: newStatus
                                    })
                                  })
                                  // Update local state
                                  const jur = jurisdictionInstr ? activeJurisdiction : '*'
                                  setUserInstructions(prev => ({
                                    ...prev,
                                    [jur]: {
                                      ...(prev[jur] || {}),
                                      [key]: { ...instr, isActive: newStatus }
                                    }
                                  }))
                                } catch (err) {
                                  console.error('Failed to toggle instruction:', err)
                                }
                              }}
                              className={`p-1 rounded transition-colors ${
                                isActive 
                                  ? 'text-emerald-600 hover:bg-emerald-50' 
                                  : 'text-ai-graphite-400 hover:bg-paper-200'
                              }`}
                              title={isActive ? 'Click to disable instruction' : 'Click to enable instruction'}
                            >
                              {isActive ? (
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor">
                                  <circle cx="10" cy="10" r="7" strokeWidth="1.5" />
                                </svg>
                              )}
                            </button>
                          )}
                          
                          {/* Edit/Add instruction button */}
                          <button
                            onClick={() => setInstructionPopoverKey(instructionPopoverKey === key ? null : key)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              hasInstruction
                                ? isActive
                                  ? 'text-lamp-600 bg-lamp-50 hover:bg-lamp-100'
                                  : 'text-ai-graphite-400 bg-paper-200 hover:bg-paper-300 line-through'
                                : 'text-ai-graphite-400 hover:text-ai-graphite-600 hover:bg-paper-200'
                            }`}
                            title={
                              hasInstruction 
                                ? isActive 
                                  ? `Custom instruction for ${jurisdictionInstr ? activeJurisdiction : 'all jurisdictions'} (active)`
                                  : `Custom instruction (disabled)`
                                : 'Add custom instruction'
                            }
                          >
                            <svg className="w-4 h-4" fill={hasInstruction ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                            </svg>
                          </button>
                          
                          {/* Instruction Popover */}
                          {instructionPopoverKey === key && (
                            <SectionInstructionPopover
                              sectionKey={key}
                              sectionLabel={section.label || displayName[key] || key}
                              sessionId={session?.id || ''}
                              patentId={patent?.id || ''}
                              activeJurisdiction={activeJurisdiction}
                              existingInstruction={jurisdictionInstr || null}
                              globalInstruction={globalInstr || null}
                              onSave={(instr) => {
                                const jur = instr.jurisdiction || '*'
                                setUserInstructions(prev => ({
                                  ...prev,
                                  [jur]: {
                                    ...(prev[jur] || {}),
                                    [key]: instr.instruction ? instr : undefined
                                  }
                                }))
                              }}
                              onClose={() => setInstructionPopoverKey(null)}
                            />
                          )}
                        </div>
                      )
                    })()}
                  </div>
                  {/* Activity Panel Injection */}
                  {isWorking && showActivity && (
                      <div className="ml-4 transform scale-90 origin-right">
                        <BackendActivityPanel
                          isVisible={true}
                          onClose={() => setShowActivity(false)}
                          steps={(Array.isArray(debugSteps) ? debugSteps : []).map((s: any) => ({
                            id: String(s.step || ''),
                            state: s.status === 'fail'
                              ? 'error'
                              : (s.status === 'done' ? 'ok' : (s.status || 'running'))
                          }))}
                        />
                      </div>
                  )}
                </div>

                {/* DD User Data Panel - Only for detailedDescription sections */}
                {section.keys.includes('detailedDescription') && (
                  <div className="mb-4 border border-amber-200 rounded-lg bg-amber-50/50 overflow-hidden">
                    <button
                      onClick={() => setDdUserDataExpanded(!ddUserDataExpanded)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-amber-100/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <svg className={`w-4 h-4 text-amber-600 transform transition-transform ${ddUserDataExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span className="text-sm font-medium text-amber-800">Detailed Description Data</span>
                        {ddUserData && (
                          <span className="text-xs px-2 py-0.5 bg-amber-200 text-amber-800 rounded-full">
                            user {Math.round(new TextEncoder().encode(ddUserData).length / 1024)}KB
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {ddEvidencePreview?.selectedSources?.length ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            ddAutoIncludedCount > 0
                              ? 'bg-ai-blue-100 text-ai-blue-700'
                              : 'bg-paper-200 text-ai-graphite-500'
                          }`}>
                            Auto sources: {ddAutoIncludedCount}/{ddEvidencePreview.selectedSources.length}
                          </span>
                        ) : null}
                        {ddEvidencePreview?.guardrailSources?.length ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            ddGuardrailIncludedCount > 0
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-paper-200 text-ai-graphite-500'
                          }`}>
                            Guardrails: {ddGuardrailIncludedCount}/{ddEvidencePreview.guardrailSources.length}
                          </span>
                        ) : null}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          ddManualInjectionEnabled
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-paper-200 text-ai-graphite-500'
                        }`}>
                          Additional: {ddManualInjectionEnabled ? ddManualInjectedTargets.join(', ') : 'Off'}
                        </span>
                      </div>
                    </button>
                    
                    {ddUserDataExpanded && (
                      <div className="px-4 pb-4 border-t border-amber-200">
                        <div className="mt-3 rounded-md border border-ai-blue-200 bg-white p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-slate-800">Auto-selected source support</div>
                              <div className="text-xs text-slate-500">
                                {ddEvidencePreview?.status === 'ready'
                                  ? `${ddAutoIncludedCount} / ${ddEvidencePreview.selectedSources.length} support item${ddEvidencePreview.selectedSources.length === 1 ? '' : 's'} will be injected`
                                  : ddEvidencePreview?.status === 'failed'
                                    ? 'Selection fell back to safe filtering'
                                    : 'Evidence pack has not been generated yet'}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {ddEvidenceJurisdictionOptions.length > 1 && (
                                <select
                                  value={ddEvidenceJurisdiction}
                                  onChange={(e) => setDdEvidenceJurisdiction(e.target.value)}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                                  disabled={ddEvidenceSaving}
                                >
                                  {ddEvidenceJurisdictionOptions.map(code => (
                                    <option key={code} value={code}>{code}</option>
                                  ))}
                                </select>
                              )}
                              {ddEvidencePreview?.status && (
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  ddEvidencePreview.status === 'ready'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : ddEvidencePreview.status === 'failed'
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-paper-200 text-ai-graphite-600'
                                }`}>
                                  {ddEvidencePreview.status}
                                </span>
                              )}
                            </div>
                          </div>

                          {ddEvidencePreview?.controlsStale ? (
                            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                              Evidence changed. Review controls before applying previous edits.
                            </div>
                          ) : null}

                          {ddEvidencePreview?.warnings?.length ? (
                            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                              {ddEvidencePreview.warnings[0]}
                            </div>
                          ) : null}

                          {!ddAnyInjectionEnabled ? (
                            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                              No Detailed Description data is currently selected for prompt injection.
                            </div>
                          ) : null}

                          {ddEvidencePreview?.selectedSources?.length ? (
                            <>
                              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <div className="text-xs font-medium text-slate-800">LLM-selected data amount</div>
                                    <div className="text-[11px] text-slate-500">
                                      {ddAutoIncludedCount} / {ddEvidencePreview.selectedSources.length} selected support item{ddEvidencePreview.selectedSources.length === 1 ? '' : 's'} will be injected
                                    </div>
                                  </div>
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                    ddCoveragePreset === 'custom'
                                      ? 'bg-lamp-100 text-lamp-700'
                                      : 'bg-ai-blue-100 text-ai-blue-700'
                                  }`}>
                                    {DD_EVIDENCE_COVERAGE_STAGES.find(stage => stage.value === ddCoveragePreset)?.label || 'Full'}
                                  </span>
                                </div>
                                <div className="relative mt-4" role="group" aria-label="Detailed Description data amount">
                                  <div className="absolute left-3 right-3 top-3 h-1 rounded-full bg-slate-200">
                                    <div
                                      className="h-1 rounded-full bg-ai-blue-500 transition-all"
                                      style={{ width: `${ddCoverageFillPercent}%` }}
                                    />
                                  </div>
                                  <div className="relative grid grid-cols-4 gap-2">
                                    {DD_EVIDENCE_COVERAGE_STAGES.map((stage, index) => {
                                      const active = stage.value === ddCoveragePreset
                                      const reached = index <= ddCoverageStageIndex
                                      const tooltipPosition = index === 0
                                        ? 'left-0'
                                        : index === DD_EVIDENCE_COVERAGE_STAGES.length - 1
                                          ? 'right-0'
                                          : 'left-1/2 -translate-x-1/2'
                                      return (
                                        <button
                                          key={stage.value}
                                          type="button"
                                          onClick={() => handleSelectDDEvidenceCoveragePreset(stage.value)}
                                          onMouseEnter={() => setDdCoverageTooltipStage(stage.value)}
                                          onMouseLeave={() => setDdCoverageTooltipStage(current => current === stage.value ? null : current)}
                                          onFocus={() => setDdCoverageTooltipStage(stage.value)}
                                          onBlur={() => setDdCoverageTooltipStage(current => current === stage.value ? null : current)}
                                          disabled={ddEvidenceSaving}
                                          title={stage.help}
                                          aria-pressed={active}
                                          className="relative flex min-w-0 flex-col items-center gap-1 rounded px-1 pb-1 text-center disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          <span className={`z-10 flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors ${
                                            active
                                              ? 'border-ai-blue-600 bg-ai-blue-600 text-white'
                                              : reached
                                                ? 'border-ai-blue-500 bg-white text-ai-blue-700'
                                                : 'border-slate-300 bg-white text-slate-500'
                                          }`}>
                                            {index + 1}
                                          </span>
                                          <span className={`text-[11px] font-medium ${active ? 'text-slate-900' : 'text-slate-600'}`}>{stage.label}</span>
                                          <span
                                            role="tooltip"
                                            className={`pointer-events-none absolute bottom-full z-20 mb-2 w-48 rounded border border-slate-200 bg-white px-2 py-1 text-left text-[11px] font-normal text-slate-700 shadow-lg transition-opacity ${
                                              ddCoverageTooltipStage === stage.value ? 'opacity-100' : 'opacity-0'
                                            } ${tooltipPosition}`}
                                          >
                                            {stage.help}
                                          </span>
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                                {ddCoveragePreset === 'custom' && (
                                  <div className="mt-3 rounded border border-lamp-200 bg-white p-3">
                                    {ddCustomInstructionsOpen ? (
                                      <div className="grid gap-3">
                                        <label className="grid gap-1">
                                          <span className="text-xs font-medium text-slate-700">What should be included?</span>
                                          <textarea
                                            ref={ddCustomIncludeRef}
                                            value={ddCustomIncludeDraft}
                                            onChange={(e) => setDdCustomIncludeDraft(e.target.value)}
                                            rows={3}
                                            className="w-full rounded border border-lamp-200 bg-white p-2 text-xs text-slate-800 focus:border-lamp-500 focus:ring-lamp-500"
                                            placeholder="Topics, experiments, results, embodiments, source labels, or examples to prioritize..."
                                            disabled={ddEvidenceSaving}
                                          />
                                        </label>
                                        <label className="grid gap-1">
                                          <span className="text-xs font-medium text-slate-700">How should it be added?</span>
                                          <textarea
                                            value={ddCustomIntegrationDraft}
                                            onChange={(e) => setDdCustomIntegrationDraft(e.target.value)}
                                            rows={3}
                                            className="w-full rounded border border-lamp-200 bg-white p-2 text-xs text-slate-800 focus:border-lamp-500 focus:ring-lamp-500"
                                            placeholder="Drafting style, density, emphasis, ordering, or exclusions..."
                                            disabled={ddEvidenceSaving}
                                          />
                                        </label>
                                        <div className="flex flex-wrap justify-end gap-2">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setDdCustomIncludeDraft(ddEvidencePreview?.customIncludeInstruction || '')
                                              setDdCustomIntegrationDraft(ddEvidencePreview?.customIntegrationInstruction || '')
                                              setDdCustomInstructionsOpen(false)
                                            }}
                                            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                            disabled={ddEvidenceSaving}
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="button"
                                            onClick={handleClearDDEvidenceCustomInstructions}
                                            className="rounded border border-lamp-200 px-2 py-1 text-xs text-lamp-700 hover:bg-lamp-50"
                                            disabled={ddEvidenceSaving || (!ddCustomIncludeDraft.trim() && !ddCustomIntegrationDraft.trim() && !ddHasCustomInstructions)}
                                          >
                                            Clear
                                          </button>
                                          <button
                                            type="button"
                                            onClick={handleSaveDDEvidenceCustomInstructions}
                                            className="rounded bg-lamp-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                                            disabled={ddEvidenceSaving}
                                          >
                                            Save custom instructions
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0 text-xs text-slate-600">
                                          {ddHasCustomInstructions ? (
                                            <>
                                              <div className="font-medium text-slate-800">Custom instructions saved</div>
                                              {ddEvidencePreview.customIncludeInstruction && (
                                                <div className="mt-1 truncate">Include: {ddEvidencePreview.customIncludeInstruction}</div>
                                              )}
                                              {ddEvidencePreview.customIntegrationInstruction && (
                                                <div className="mt-1 truncate">Integrate: {ddEvidencePreview.customIntegrationInstruction}</div>
                                              )}
                                            </>
                                          ) : (
                                            <div>Custom source selection is active. Add attorney instructions to guide how the selected data is used.</div>
                                          )}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setDdCustomIncludeDraft(ddEvidencePreview?.customIncludeInstruction || '')
                                            setDdCustomIntegrationDraft(ddEvidencePreview?.customIntegrationInstruction || '')
                                            setDdCustomInstructionsOpen(true)
                                          }}
                                          className="rounded border border-lamp-200 px-2 py-1 text-xs font-medium text-lamp-700 hover:bg-lamp-50"
                                          disabled={ddEvidenceSaving}
                                        >
                                          {ddHasCustomInstructions ? 'Edit instructions' : 'Add instructions'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <button type="button" onClick={handleSelectAllDDEvidence} disabled={ddEvidenceSaving} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Select all</button>
                                  <button type="button" onClick={handleUnselectAllDDEvidence} disabled={ddEvidenceSaving} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Unselect all</button>
                                  <button type="button" onClick={handleResetDDEvidenceControls} disabled={ddEvidenceSaving} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Reset auto-selection</button>
                                </div>
                                <input
                                  value={ddEvidenceSearch}
                                  onChange={(e) => setDdEvidenceSearch(e.target.value)}
                                  placeholder="Search source ID, label, role, kind"
                                  className="min-w-[220px] rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                />
                              </div>
                              {ddAutoIncludedCount === 0 && (
                                <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                                  No positive source support is selected for injection. The Detailed Description may have less claim support.
                                </div>
                              )}
                              <div className="mt-3 grid gap-2">
                                {ddEvidenceFilteredSelectedSources.map(item => (
                                  <div key={item.sourceId} className={`rounded border p-2 ${item.included ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white opacity-70'}`}>
                                    <div className="flex items-start gap-2">
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-ai-blue-600"
                                        checked={item.included}
                                        disabled={ddEvidenceSaving}
                                        onChange={(e) => handleToggleDDEvidenceSource(item.sourceId, e.target.checked)}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-mono text-[11px] text-slate-500">{item.sourceId}</span>
                                          <span className="text-xs font-medium text-slate-800">{item.label}</span>
                                          {item.role && <span className="text-[11px] px-1.5 py-0.5 rounded bg-ai-blue-100 text-ai-blue-700">{item.role.replace(/_/g, ' ')}</span>}
                                          {item.confidence && <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{item.confidence}</span>}
                                          {!item.included && <span className="text-[11px] px-1.5 py-0.5 rounded bg-paper-200 text-ai-graphite-600">excluded</span>}
                                          {item.edited && <span className="text-[11px] px-1.5 py-0.5 rounded bg-lamp-100 text-lamp-700">edited</span>}
                                          {item.controlsStale && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">stale</span>}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-600">{item.excerpt}</div>
                                        {item.reason && <div className="mt-1 text-[11px] text-slate-500">{item.reason}</div>}
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            onClick={() => setDdEvidenceExpandedSources(prev => ({ ...prev, [item.sourceId]: !prev[item.sourceId] }))}
                                            className="text-xs font-medium text-ai-blue-700 hover:text-ai-blue-900"
                                          >
                                            {ddEvidenceExpandedSources[item.sourceId] ? 'Hide injected data' : 'View injected data'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => startEditingDDEvidenceSource(item)}
                                            className="text-xs font-medium text-slate-700 hover:text-slate-900"
                                          >
                                            Edit injected text
                                          </button>
                                          {item.edited && (
                                            <button
                                              type="button"
                                              onClick={() => handleResetDDEvidenceOverride(item.sourceId)}
                                              className="text-xs font-medium text-rose-600 hover:text-rose-800"
                                            >
                                              Reset to original
                                            </button>
                                          )}
                                        </div>
                                        {ddEvidenceExpandedSources[item.sourceId] && (
                                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-700">{item.injectedText || item.originalInjectedText}</pre>
                                        )}
                                        {ddEvidenceEditingSourceId === item.sourceId && (
                                          <div className="mt-2 rounded border border-lamp-200 bg-lamp-50 p-2">
                                            <div className="mb-1 text-[11px] font-medium text-lamp-800">Prompt-only edit. Original source data is unchanged.</div>
                                            <div className="mb-1 text-[11px] text-slate-600">Original source data</div>
                                            <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600">{item.originalInjectedText}</pre>
                                            <div className="mb-1 text-[11px] text-slate-600">Injected text override</div>
                                            <textarea
                                              value={ddEvidenceEditDraft}
                                              onChange={(e) => setDdEvidenceEditDraft(e.target.value)}
                                              rows={5}
                                              className="w-full rounded border border-lamp-300 bg-white p-2 text-xs text-slate-800"
                                            />
                                            <div className="mt-2 flex justify-end gap-2">
                                              <button type="button" onClick={() => { setDdEvidenceEditingSourceId(null); setDdEvidenceEditDraft('') }} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700">Cancel</button>
                                              <button type="button" onClick={() => handleResetDDEvidenceOverride(item.sourceId)} className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700">Reset to original</button>
                                              <button type="button" onClick={handleSaveDDEvidenceOverride} disabled={ddEvidenceSaving} className="rounded bg-lamp-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">Save override</button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {!ddEvidenceFilteredSelectedSources.length && (
                                  <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-500">No source support matches the search.</div>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="mt-3 text-xs text-slate-500">No auto-selected source support is available yet.</div>
                          )}

                          {(ddEvidencePreview?.guardrailSources?.length || ddEvidencePreview?.excludedSources?.length) ? (
                            <div className="mt-3 border-t border-slate-200 pt-2">
                              <button
                                type="button"
                                onClick={() => setDdEvidenceGuardrailsExpanded(prev => !prev)}
                                className="text-xs font-medium text-slate-600 hover:text-slate-900"
                              >
                                {ddEvidenceGuardrailsExpanded ? 'Hide' : 'Show'} guardrails and exclusions
                              </button>
                              {ddEvidenceGuardrailsExpanded && (
                                <div className="mt-2 grid gap-2">
                                  {(ddEvidencePreview.guardrailSources || []).map(item => (
                                    <div key={`${item.sourceId}-guardrail`} className="rounded border border-slate-200 bg-white p-2">
                                      <label className="flex items-start gap-2">
                                        <input
                                          type="checkbox"
                                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-ai-blue-600"
                                          checked={item.included}
                                          disabled={ddEvidenceSaving}
                                          onChange={(e) => handleToggleDDGuardrailSource(item.sourceId, e.target.checked)}
                                        />
                                        <span className="min-w-0 flex-1">
                                          <span className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-[11px] text-slate-500">{item.sourceId}</span>
                                            <span className="text-xs font-medium text-slate-700">{item.label}</span>
                                            {!item.included && <span className="text-[11px] px-1.5 py-0.5 rounded bg-paper-200 text-ai-graphite-600">excluded</span>}
                                          </span>
                                          {item.reason && <span className="mt-1 block text-[11px] text-slate-500">{item.reason}</span>}
                                        </span>
                                      </label>
                                    </div>
                                  ))}
                                  {(ddEvidencePreview.excludedSources || []).slice(0, 8).map(item => (
                                    <div key={`${item.sourceId}-excluded`} className="rounded border border-slate-200 bg-paper-100 p-2">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-[11px] text-slate-500">{item.sourceId}</span>
                                        <span className="text-xs font-medium text-slate-700">{item.label}</span>
                                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-paper-200 text-ai-graphite-600">not eligible</span>
                                      </div>
                                      {item.reason && <div className="mt-1 text-[11px] text-slate-500">{item.reason}</div>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-3 mb-2 p-3 bg-amber-100/50 rounded-md border border-amber-200">
                          <p className="text-xs text-amber-800">
                            <strong>Legal Notice:</strong> Data entered here is for illustrative purposes only. 
                            It is NON-LIMITING and will not establish thresholds, ranges, or requirements. 
                            It will be injected with a legal wrapper when generating the Detailed Description.
                          </p>
                        </div>
                        
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-medium text-amber-800">Additional user data</div>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            ddManualInjectionEnabled
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-paper-200 text-ai-graphite-500'
                          }`}>
                            {ddManualInjectionEnabled
                              ? `Additional data included for ${ddManualInjectedTargets.join(', ')}`
                              : 'Additional data not included'}
                          </span>
                        </div>
                        <textarea
                          className="w-full border border-amber-300 rounded-md p-3 text-sm focus:ring-amber-500 focus:border-amber-500 bg-white resize-none"
                          rows={6}
                          placeholder="Paste experimental data, measurements, or test observations here (max 50KB)..."
                          value={ddUserData}
                          onChange={(e) => setDdUserData(e.target.value)}
                          disabled={ddUserDataLoading || ddUserDataSaving}
                        />
                        
                        {/* Additional user data include toggle */}
                        <div className="mt-4 p-3 bg-paper-100 rounded-lg border border-paper-300">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium text-ai-graphite-700">Include additional user data</div>
                              <div className="text-xs text-ai-graphite-500">Only controls the pasted text below. Auto-selected source support is controlled above.</div>
                            </div>
                            {/* Slider Toggle */}
                            <button
                              type="button"
                              onClick={() => {
                                // Determine current manual-data state - is ANY jurisdiction enabled?
                                const isCurrentlyEnabled = Object.values(ddUserDataToggles).some(v => v === true)
                                
                                if (isCurrentlyEnabled) {
                                  // Disable all
                                  const allOff: Record<string, boolean> = {}
                                  if (isMultiJurisdiction) {
                                    allOff['REFERENCE'] = false
                                    availableJurisdictions.forEach(code => { allOff[code] = false })
                                  } else {
                                    availableJurisdictions.forEach(code => { allOff[code] = false })
                                  }
                                  setDdUserDataToggles(allOff)
                                } else {
                                  // Enable - auto-select based on active jurisdiction
                                  const autoSelect: Record<string, boolean> = {}
                                  if (isMultiJurisdiction) {
                                    // Multi-jurisdiction: Enable REFERENCE by default
                                    autoSelect['REFERENCE'] = true
                                    availableJurisdictions.forEach(code => { autoSelect[code] = false })
                                  } else {
                                    // Single-jurisdiction: Enable the active/only jurisdiction
                                    availableJurisdictions.forEach(code => { 
                                      autoSelect[code] = (code === activeJurisdiction)
                                    })
                                  }
                                  setDdUserDataToggles(autoSelect)
                                }
                              }}
                              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
                                Object.values(ddUserDataToggles).some(v => v === true)
                                  ? 'bg-amber-600'
                                  : 'bg-gray-300'
                              }`}
                              disabled={ddUserDataLoading || ddUserDataSaving || !ddUserData.trim()}
                              title={!ddUserData.trim() ? 'Enter additional data before including it' : ''}
                            >
                              <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                  Object.values(ddUserDataToggles).some(v => v === true)
                                    ? 'translate-x-5'
                                    : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                          
                          {/* Jurisdiction Selection - Only show when enabled */}
                          {Object.values(ddUserDataToggles).some(v => v === true) && (
                            <div className="mt-3 pt-3 border-t border-paper-300">
                              <span className="text-xs text-ai-graphite-600 block mb-2">Select jurisdictions for additional data:</span>
                              <div className="flex flex-wrap gap-2">
                                {isMultiJurisdiction ? (
                                  // Multi-jurisdiction mode: Show REFERENCE first, then individual jurisdictions
                                  ['REFERENCE', ...availableJurisdictions].map(code => (
                                    <label 
                                      key={code} 
                                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer transition-all ${
                                        ddUserDataToggles[code]
                                          ? code === 'REFERENCE' 
                                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                            : 'bg-ai-blue-100 text-ai-blue-800 border border-ai-blue-300'
                                          : 'bg-paper-200 text-ai-graphite-600 border border-paper-300 hover:bg-paper-300'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={ddUserDataToggles[code] || false}
                                        onChange={(e) => setDdUserDataToggles(prev => ({ ...prev, [code]: e.target.checked }))}
                                        className="sr-only"
                                      />
                                      {ddUserDataToggles[code] && (
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                      )}
                                      <span className={code === 'REFERENCE' ? 'font-medium' : ''}>{code}</span>
                                    </label>
                                  ))
                                ) : (
                                  // Single-jurisdiction mode: Show only that jurisdiction
                                  availableJurisdictions.map(code => (
                                    <label 
                                      key={code} 
                                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer transition-all ${
                                        ddUserDataToggles[code]
                                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                          : 'bg-paper-200 text-ai-graphite-600 border border-paper-300 hover:bg-paper-300'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={ddUserDataToggles[code] || false}
                                        onChange={(e) => setDdUserDataToggles(prev => ({ ...prev, [code]: e.target.checked }))}
                                        className="sr-only"
                                      />
                                      {ddUserDataToggles[code] && (
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                      )}
                                      <span className="font-medium">{code}</span>
                                    </label>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div className="mt-3 flex items-center justify-between">
                          {/* Save confirmation indicator */}
                          <div className="flex items-center gap-2">
                            {ddUserDataSaved && (
                              <span className="flex items-center gap-1.5 text-xs text-emerald-600 animate-in fade-in duration-300">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Saved successfully
                              </span>
                            )}
                          </div>
                          
                          <div className="flex gap-2">
                            {ddUserData && (
                              <button
                                onClick={handleDeleteDDUserData}
                                disabled={ddUserDataSaving}
                                className="px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded border border-rose-200 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            )}
                            <button
                              onClick={handleSaveDDUserData}
                              disabled={ddUserDataSaving || ddUserDataLoading}
                              className="px-4 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded shadow-sm disabled:opacity-50 flex items-center gap-2"
                            >
                              {ddUserDataSaving && <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full"></span>}
                              {ddUserDataSaving ? 'Saving...' : 'Save Additional Data'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Content Area */}
                <div className="text-ai-graphite-800 text-justify">
                  {!hasContent && !isWorking ? (
                    <div 
                      onClick={() => {
                        if (autoModeRunning) return // Don't allow clicks during auto-mode
                        // When auto-mode is ON, clicking ANY section triggers full auto-generation from the first pending section
                        if (autoMode) {
                          handleAutoGenerateAll()
                        } else {
                          handleGenerate(section.keys)
                        }
                      }}
                      className={`border-2 border-dashed border-paper-200 rounded-lg p-8 text-center hover:border-ai-blue-100 hover:bg-ai-blue-50/30 transition-all cursor-pointer group/empty ${autoModeRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                       <div className="text-ai-graphite-400 group-hover/empty:text-ai-blue-400 font-medium mb-1">
                         {autoMode ? 'Auto-generate pending sections' : 'Section not generated'}
                       </div>
                       <div className="text-xs text-gray-300 group-hover/empty:text-ai-blue-300">
                         {autoMode ? 'Click to start from first pending section' : 'Click to draft with AI'}
                       </div>
                    </div>
                  ) : (
                    <div>
                      {section.keys.map(keyName => (
                        <div key={keyName} className="mb-6 last:mb-0">
                          {section.keys.length > 1 && (
                             <h4 className="text-xs font-bold text-ai-graphite-400 uppercase tracking-wider mb-2 mt-4">{displayName[keyName] || keyName}</h4>
                          )}
                          
                          {/* Toolbar for each section text */}
                          {generated?.[keyName] && (
                             <div className="flex items-center justify-end gap-1 mb-2">
                               <button
                                 onClick={() => copySection(keyName)}
                                 className="p-1.5 rounded text-ai-graphite-400 hover:text-ai-graphite-700 hover:bg-paper-200 transition-colors"
                                 title={copiedKey === keyName ? "Copied" : "Copy to clipboard"}
                               >
                                  {copiedKey === keyName ? (
                                    <svg className="w-4 h-4 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  ) : (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      {/* Standard copy icon - two overlapping rectangles */}
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                  )}
                               </button>
                               <div className="relative">
                                 <button
                                   onClick={() => !sectionLoading[keyName] && setRegenOpen(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                                   className={`p-1.5 rounded transition-colors ${
                                     regenOpen[keyName] 
                                       ? 'text-ai-blue-600 bg-ai-blue-100' 
                                       : 'text-ai-graphite-400 hover:text-ai-blue-600 hover:bg-ai-blue-50'
                                   }`}
                                   title="Regenerate / Refine"
                                   disabled={sectionLoading[keyName]}
                                 >
                                   {/* Regeneration icon - circular arrows for iteration/refinement */}
                                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                 </button>
                                 
                                 {/* Chat Bubble Popup - appears below regenerate button */}
                                 {regenOpen[keyName] && (
                                   <div className="absolute right-0 top-full mt-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                                     {/* Speech bubble pointer */}
                                     <div className="absolute -top-2 right-3 w-4 h-4 bg-white border-l border-t border-paper-300 transform rotate-45"></div>
                                     
                                     <div className="w-[min(20rem,calc(100vw-2rem))] bg-white rounded-2xl shadow-xl border border-paper-300 overflow-hidden">
                                       {/* Header */}
                                       <div className="bg-gradient-to-r from-ai-blue-500 to-ai-blue-600 px-4 py-3 flex items-center gap-2">
                                         <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                                           <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                           </svg>
                                         </div>
                                         <span className="text-white text-sm font-medium">Ask PatentNest</span>
                                         <button 
                                           onClick={() => setRegenOpen(prev => ({ ...prev, [keyName]: false }))}
                                           className="ml-auto text-white/70 hover:text-white transition-colors"
                                         >
                                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                           </svg>
                                         </button>
                                       </div>
                                       
                                       {/* Body */}
                                      <div className="p-4">
                                        <textarea
                                          className="w-full border border-paper-300 rounded-xl px-3 py-2.5 text-sm focus:border-ai-blue-400 focus:ring-1 focus:ring-ai-blue-400 bg-paper-100 resize-none placeholder-gray-400"
                                          value={regenRemarks[keyName] || ''}
                                          onChange={(e) => setRegenRemarks(prev => ({ ...prev, [keyName]: e.target.value }))}
                                          placeholder="How should I improve this section? (optional)"
                                          rows={2}
                                          autoFocus
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                              e.preventDefault()
                                              handleRegenerateSection(keyName)
                                              setRegenOpen(prev => ({ ...prev, [keyName]: false }))
                                            }
                                            if (e.key === 'Escape') {
                                              setRegenOpen(prev => ({ ...prev, [keyName]: false }))
                                            }
                                          }}
                                        />
                                        
                                        {/* Quick suggestions */}
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                          {/* Regenerate button - primary action */}
                                          <button
                                            onClick={() => {
                                              setRegenRemarks(prev => ({ ...prev, [keyName]: '' }))
                                              handleRegenerateSection(keyName)
                                              setRegenOpen(prev => ({ ...prev, [keyName]: false }))
                                            }}
                                            className="text-[11px] px-2.5 py-1 rounded-full bg-ai-blue-100 text-ai-blue-700 hover:bg-ai-blue-200 transition-colors font-medium flex items-center gap-1"
                                          >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                            </svg>
                                            Regenerate
                                          </button>
                                          {['More concise', 'More detail', 'Simpler language', 'Add technical depth', 'Fix grammar'].map(suggestion => (
                                            <button
                                              key={suggestion}
                                              onClick={() => setRegenRemarks(prev => ({ ...prev, [keyName]: suggestion }))}
                                              className="text-[11px] px-2.5 py-1 rounded-full bg-paper-200 text-ai-graphite-600 hover:bg-ai-blue-100 hover:text-ai-blue-700 transition-colors"
                                            >
                                              {suggestion}
                                            </button>
                                          ))}
                                        </div>
                                        
                                        {/* Send button */}
                                        <div className="mt-3 flex justify-end">
                                          <button 
                                            onClick={() => {
                                              handleRegenerateSection(keyName)
                                              setRegenOpen(prev => ({ ...prev, [keyName]: false }))
                                            }} 
                                            disabled={sectionLoading[keyName]}
                                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                                              !sectionLoading[keyName]
                                                ? 'bg-ai-blue-600 text-white hover:bg-ai-blue-700 shadow-sm'
                                                : 'bg-paper-200 text-ai-graphite-400 cursor-not-allowed'
                                            }`}
                                          >
                                            {sectionLoading[keyName] ? (
                                              <>
                                                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
                                                Refining...
                                              </>
                                            ) : (
                                              <>
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                                </svg>
                                                {regenRemarks[keyName]?.trim() ? 'Send' : 'Regenerate'}
                                              </>
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                     </div>
                                   </div>
                                 )}
                               </div>
                               <button
                                 onClick={() => { setEditingKey(editingKey === keyName ? null : keyName); setEditDrafts(prev => ({ ...prev, [keyName]: generated?.[keyName] || '' })) }}
                                 className={`p-1.5 rounded transition-colors ${editingKey === keyName ? 'text-ai-blue-600 bg-ai-blue-50' : 'text-ai-graphite-400 hover:text-ai-graphite-700 hover:bg-paper-200'}`}
                                 title="Edit"
                               >
                                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                               </button>
                                {/* Delete section button */}
                                <button
                                  onClick={() => handleDeleteSectionContent(keyName)}
                                  className="p-1.5 rounded text-ai-graphite-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                  title="Delete section"
                                >
                                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                 </svg>
                               </button>
                             </div>
                          )}

                          {/* Add Component Numbers to Claims - only visible when:
                              1. We're in the claims section
                              2. Claims have actual content (not just empty string)
                              3. Components are available from Component Planner stage */}
                            {keyName === 'claims' && generated?.claims?.trim() && extractComponentsFromReferenceMap((session as any)?.referenceMap).length > 0 && (
                            <div className="mb-4 p-3 bg-gradient-to-r from-lamp-50 to-ai-blue-50 border border-lamp-200 rounded-lg">
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-lamp-100 flex items-center justify-center flex-shrink-0">
                                    <svg className="w-4 h-4 text-lamp-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                                    </svg>
                                  </div>
                                  <div>
                                    <p className="text-sm font-medium text-lamp-800">Add Component Numbers</p>
                                    <p className="text-xs text-lamp-600">
                                      {componentNumbersAdded 
                                        ? '✓ Component numbers have been added to claims' 
                                        : `Insert reference numerals from ${extractComponentsFromReferenceMap((session as any)?.referenceMap).length} components`
                                      }
                                    </p>
                                  </div>
                                </div>
                                <button
                                  onClick={handleAddComponentNumbersToClaims}
                                  disabled={addingComponentNumbers || componentNumbersAdded}
                                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                                    addingComponentNumbers 
                                      ? 'bg-lamp-200 text-lamp-500 cursor-wait'
                                      : componentNumbersAdded
                                        ? 'bg-green-100 text-green-700 cursor-default'
                                        : 'bg-lamp-600 text-white hover:bg-lamp-700 shadow-sm'
                                  }`}
                                >
                                  {addingComponentNumbers ? (
                                    <>
                                      <span className="animate-spin h-4 w-4 border-2 border-lamp-400 border-t-transparent rounded-full"></span>
                                      Adding...
                                    </>
                                  ) : componentNumbersAdded ? (
                                    <>
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      Added
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                      </svg>
                                      Add Numbers
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                          
                          {editingKey === keyName ? (
                            <div className="relative">
                              <textarea
                                className="w-full border-0 bg-paper-100 p-4 rounded-md text-ai-graphite-800 focus:ring-1 focus:ring-ai-blue-200 resize-none text-justify"
                                style={{
                                  fontFamily,
                                  fontSize,
                                  lineHeight
                                }}
                                value={editDrafts[keyName] ?? generated[keyName] ?? ''}
                                onChange={(e) => setEditDrafts(prev => ({ ...prev, [keyName]: e.target.value }))}
                                rows={Math.max(6, (generated[keyName] || '').split('\n').length)}
                                autoFocus
                              />
                              <div className="flex justify-end gap-2 mt-2">
                                <button onClick={() => setEditingKey(null)} className="text-xs text-ai-graphite-500 hover:text-ai-graphite-700 px-3 py-1">Cancel</button>
                                <button onClick={() => handleAutosaveSection(keyName)} className="text-xs bg-ai-blue-600 text-white px-3 py-1 rounded shadow-sm hover:bg-ai-blue-700">Save</button>
                              </div>
                            </div>
                          ) : (
                            <div className="relative">
                              <div className="whitespace-pre-wrap text-justify"
                                   style={{
                                     fontFamily,
                                     fontSize,
                                     lineHeight
                                   }}>
                                {generated[keyName] || (isWorking ? <span className="text-gray-300 animate-pulse">Drafting content...</span> : '')}
                              </div>


                              {/* REMOVED: InlineSectionValidator - validation now handled by AI Review only */}
                              {/* Deterministic validation was causing delays and excessive refreshes */}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )})}

            {/* Drawings Section */}
            {!figuresSkipped && (
            <div className="group relative hover:bg-paper-100/30 transition-colors -mx-4 px-4 py-2 rounded-lg mt-16 break-before-page">
               <div className="flex items-baseline justify-between mb-8">
                  <h3 className="text-lg font-bold text-ai-graphite-900 uppercase tracking-wide">
                    Drawings
                  </h3>
               </div>
               
               {/* Warning when figures have been added/deleted after freezing the sequence */}
               {sequenceOutdated && figureSequenceFinalized && (
                 <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                   <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                   </svg>
                   <div>
                     <p className="text-sm text-amber-800 font-medium">Figure sequence may be outdated</p>
                     <p className="text-xs text-amber-700 mt-0.5">{sequenceWarningMessage}</p>
                   </div>
                 </div>
               )}

               <div className="space-y-16">
                 {unifiedFigures.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-paper-200 rounded-lg">
                      <div className="text-ai-graphite-400 font-medium mb-1">No figures defined</div>
                      <div className="text-xs text-gray-300">Define figures in the Planner stage to see them here.</div>
                    </div>
                 ) : (
                   unifiedFigures.map((figure) => (
                     <div key={`${figure.type}-${figure.sourceId}`} className="flex flex-col items-center break-inside-avoid">
                       <div className="w-full max-w-3xl bg-white border border-paper-300 shadow-sm rounded-lg overflow-hidden min-h-[400px] flex items-center justify-center bg-paper-100/50 p-4">
                          {figure.imageUrl ? (
                            <img 
                              src={figure.imageUrl} 
                              alt={`Figure ${figure.figureNo}`}
                              className="max-w-full max-h-[600px] object-contain mix-blend-multiply"
                              loading="lazy"
                              onError={(e) => {
                                // Hide broken image and show placeholder instead
                                const target = e.currentTarget
                                target.style.display = 'none'
                                const placeholder = target.nextElementSibling as HTMLElement
                                if (placeholder) placeholder.style.display = 'flex'
                              }}
                            />
                          ) : null}
                          <div 
                            className="text-center p-8 text-ai-graphite-400 flex-col items-center"
                            style={{ display: figure.imageUrl ? 'none' : 'flex' }}
                          >
                            <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            <span className="text-sm font-medium">Figure {figure.figureNo}</span>
                            <span className="text-xs opacity-75 mt-1">
                              {figure.title.startsWith('Missing') ? figure.title : (figure.type === 'sketch' ? 'Sketch pending' : 'Draft pending')}
                            </span>
                          </div>
                       </div>
                       <div className="mt-4 text-center max-w-xl">
                         <div className="font-bold text-ai-graphite-900 uppercase tracking-widest text-sm flex items-center justify-center gap-2 flex-wrap">
                           FIG. {figure.figureNo}
                           {figure.type === 'sketch' && (
                             <span className="text-xs font-normal text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Sketch</span>
                           )}
                           {figure.isNew && <span className="text-xs font-normal text-ai-blue-600 bg-ai-blue-50 px-1.5 py-0.5 rounded">New</span>}
                           {/* Show fallback indicator if using English when a different language is preferred */}
                           {figure.type === 'diagram' && 
                            figure.displayLanguage === 'en' && 
                            preferredFigureLanguage !== 'en' && (
                             <span 
                               className="text-xs font-normal text-ai-graphite-500 bg-paper-200 px-1.5 py-0.5 rounded"
                               title={`No translation available for ${preferredFigureLanguage}. Using English version.`}
                             >
                               EN (no {preferredFigureLanguage.toUpperCase()} translation)
                             </span>
                           )}
                         </div>
                         {figure.title && <div className="text-sm text-ai-graphite-600 mt-1">{figure.title}</div>}
                       </div>
                     </div>
                   ))
                 )}
               </div>
            </div>
            )}
           
            {/* Validation & Export Section (Multi-jurisdiction - including Reference Draft) */}
            {isMultiJurisdiction && (
              (activeJurisdiction === 'REFERENCE' && session?.referenceDraftComplete) ||
              (activeJurisdiction !== 'REFERENCE' && latestDrafts[activeJurisdiction]?.version > 0)
            ) && (
              <div className="mt-16 border-t pt-8">
                <ValidationPanel
                  sessionId={session?.id || ''}
                  jurisdiction={activeJurisdiction}
                  patentId={patent?.id || ''}
                  draft={generated}
                  onFix={(sectionKey, fixedContent) => {
                    // Apply the fix to the generated content
                    setGenerated(prev => ({ ...prev, [sectionKey]: fixedContent }))
                    // Mark as needing save
                    setEditDrafts(prev => ({ ...prev, [sectionKey]: fixedContent }))
                  }}
                  onProceedToExport={() => {
                    // Scroll to export section or show export modal
                    const exportSection = document.getElementById('export-section')
                    if (exportSection) {
                      exportSection.scrollIntoView({ behavior: 'smooth' })
                    }
                  }}
                  onAIIssuesChange={handleAIIssuesChange}
                />
                
                {/* Export Section */}
                <div id="export-section" className="mt-8 bg-white rounded-xl border border-paper-300 p-6">
                  <h4 className="font-semibold text-ai-graphite-900 mb-4">Export Options</h4>
                  <ExportButton
                    sessionId={session?.id || ''}
                    jurisdiction={activeJurisdiction}
                    patentId={patent?.id || ''}
                    disabled={false}
                  />
                </div>
              </div>
            )}
            
            {/* Validation & Export Section (Single jurisdiction) */}
            {!isMultiJurisdiction && Object.keys(generated).length > 0 && (
              <div className="mt-16 border-t pt-8">
                <ValidationPanel
                  sessionId={session?.id || ''}
                  jurisdiction={activeJurisdiction}
                  patentId={patent?.id || ''}
                  draft={generated}
                  onFix={(sectionKey, fixedContent) => {
                    setGenerated(prev => ({ ...prev, [sectionKey]: fixedContent }))
                    setEditDrafts(prev => ({ ...prev, [sectionKey]: fixedContent }))
                  }}
                  onProceedToExport={() => {
                    const exportSection = document.getElementById('export-section-single')
                    if (exportSection) {
                      exportSection.scrollIntoView({ behavior: 'smooth' })
                    }
                  }}
                  onAIIssuesChange={handleAIIssuesChange}
                />
                
                {/* Export Section */}
                <div id="export-section-single" className="mt-8 bg-white rounded-xl border border-paper-300 p-6">
                  <h4 className="font-semibold text-ai-graphite-900 mb-4">Export Options</h4>
                  <ExportButton
                    sessionId={session?.id || ''}
                    jurisdiction={activeJurisdiction}
                    patentId={patent?.id || ''}
                    disabled={false}
                  />
                </div>
              </div>
            )}
        </div>
    </div>

      {/* All Instructions Modal */}
      {showAllInstructionsModal && (
        <AllInstructionsModal
          sessionId={session?.id || ''}
          patentId={patent?.id || ''}
          activeJurisdiction={activeJurisdiction}
          availableJurisdictions={availableJurisdictions}
          sectionLabels={displayName}
          onClose={() => setShowAllInstructionsModal(false)}
          onUpdate={() => {
            // Refresh instructions
            fetch(`/api/patents/${patent?.id}/drafting/user-instructions?sessionId=${session?.id}`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
            })
              .then(res => res.json())
              .then(data => setUserInstructions(data.grouped || {}))
              .catch(console.error)
          }}
        />
      )}

      {/* Persona Manager Modal */}
      {showPersonaManager && (
        <PersonaManager
          isOpen={showPersonaManager}
          onClose={() => setShowPersonaManager(false)}
          showSelector={true}
          jurisdiction={activeJurisdiction}
          currentSelection={personaSelection}
          onSelectPersona={(selection) => {
            void (async () => {
              try {
                if (selection.primaryPersonaId) {
                  await persistPersonaConfig(true, selection)
                } else {
                  await persistPersonaConfig(false, selection)
                }
              } catch (error) {
                console.error('Failed to save persona selection:', error)
                toast({ title: error instanceof Error ? error.message : 'Failed to save persona selection.', variant: 'error' })
              }
            })()
          }}
        />
      )}

      {/* Writing Samples Modal */}
      {showWritingSamplesModal && (
        <WritingSamplesModal
          onClose={() => setShowWritingSamplesModal(false)}
          onUpdate={() => {
            // Could refresh any UI state related to samples
          }}
        />
      )}

      {/* Auto-Generation Warning Modal */}
      {autoModeWarningModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-paper-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-ai-blue-500 to-lamp-600 flex items-center justify-center text-white text-xl">
                  🚀
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-ai-graphite-900">Auto-Generate Mode</h3>
                  <p className="text-sm text-ai-graphite-500">{autoModeWarningModal.pendingSections.length} section(s) to generate</p>
                </div>
              </div>
              <button 
                onClick={() => setAutoModeWarningModal({ show: false, warnings: [], pendingSections: [] })}
                className="p-2 rounded-lg hover:bg-paper-200 transition-colors text-ai-graphite-400 hover:text-ai-graphite-600"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-4 overflow-y-auto flex-1">
              {/* Sections List */}
              <div className="mb-4">
                <h4 className="text-sm font-medium text-ai-graphite-700 mb-2">Sections to generate:</h4>
                <div className="flex flex-wrap gap-2">
                  {autoModeWarningModal.pendingSections.map(key => (
                    <span key={key} className="px-2.5 py-1 bg-paper-200 text-ai-graphite-700 rounded-lg text-xs font-medium">
                      {displayName[key] || key}
                    </span>
                  ))}
                </div>
              </div>

              {/* Warnings */}
              {autoModeWarningModal.warnings.length > 0 && (
                <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-amber-600 text-lg">⚠️</span>
                    <h4 className="text-sm font-semibold text-amber-800">Missing Context Detected</h4>
                  </div>
                  <p className="text-xs text-amber-700 mb-3">
                    The following context is missing and may reduce generation quality:
                  </p>
                  <div className="space-y-3">
                    {autoModeWarningModal.warnings.map((w, idx) => (
                      <div key={idx} className="bg-white/60 rounded-lg p-3 border border-amber-100">
                        <div className="flex items-start gap-2">
                          <span className="text-amber-500 mt-0.5">
                            {w.type === 'priorArt' ? '📚' : w.type === 'figures' ? '🖼️' : '🔧'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-ai-graphite-800">{displayName[w.section] || w.section}</span>
                              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded uppercase">
                                {w.type === 'priorArt' ? 'Prior Art' : w.type === 'figures' ? 'Figures' : 'Components'}
                              </span>
                            </div>
                            <p className="text-xs text-ai-graphite-600 mt-1">{w.message}</p>
                            <p className="text-xs text-amber-700 mt-1.5 italic">Impact: {w.impact}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-amber-700 mt-3 pt-3 border-t border-amber-200">
                    💡 You can add this context now by closing this dialog and using the context panels, or continue with potentially reduced quality.
                  </p>
                </div>
              )}

              {/* No Warnings */}
              {autoModeWarningModal.warnings.length === 0 && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-600 text-lg">✅</span>
                    <p className="text-sm text-emerald-800 font-medium">All required context is available</p>
                  </div>
                  <p className="text-xs text-emerald-700 mt-2">
                    The AI has access to all the context it needs for optimal generation quality.
                  </p>
                </div>
              )}

              {/* Info */}
              <div className="mt-4 p-3 bg-paper-100 rounded-lg text-xs text-ai-graphite-600">
                <p>• Sections will be generated one by one in sequence</p>
                <p>• You can cancel at any time using the Stop button</p>
                <p>• Failed sections will be retried once automatically</p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-paper-200 flex items-center justify-end gap-3">
              <button
                onClick={() => setAutoModeWarningModal({ show: false, warnings: [], pendingSections: [] })}
                className="px-4 py-2 text-sm font-medium text-ai-graphite-700 bg-paper-200 hover:bg-paper-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => startAutoGeneration(autoModeWarningModal.pendingSections)}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors flex items-center gap-2 ${
                  autoModeWarningModal.warnings.length > 0
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : 'bg-ai-blue-600 hover:bg-ai-blue-700'
                }`}
              >
                {autoModeWarningModal.warnings.length > 0 ? (
                  <>
                    <span>Continue Anyway</span>
                    <span className="text-xs opacity-75">({autoModeWarningModal.warnings.length} warning{autoModeWarningModal.warnings.length > 1 ? 's' : ''})</span>
                  </>
                ) : (
                  <>
                    <span>Start Generation</span>
                    <span>→</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
