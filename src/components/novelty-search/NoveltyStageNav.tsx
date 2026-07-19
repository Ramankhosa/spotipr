'use client'

import React, { useCallback, useMemo, useState } from 'react'
import {
  AlertCircle,
  Check,
  FileText,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'

type StageTab = '1' | '2' | '3' | '4' | '5'
type StageStatus = 'completed' | 'in_progress' | 'pending' | 'failed' | 'blocked'

interface NoveltyStageNavProps {
  selectedStage: StageTab
  onStageSelect: (stage: StageTab) => void
  getStageStatus: (key: StageTab) => StageStatus
  isStageCompleted: (key: StageTab) => boolean
  onRunStage: (key: StageTab) => Promise<void>
  activeExecutionStage: string | null
  searchId: string | null
  overallProgress: number
  formTitle: string
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

interface StageConfig {
  key: StageTab
  label: string
  description: string
  icon: React.ElementType
  stageNumber: string | null
}

const STAGE_CONFIGS: StageConfig[] = [
  {
    key: '1',
    label: 'Idea Setup',
    description: 'Search inputs and extracted features',
    icon: Sparkles,
    stageNumber: null,
  },
  {
    key: '2',
    label: 'Search Results',
    description: 'Returned patents from search providers',
    icon: Search,
    stageNumber: '1',
  },
  {
    key: '3',
    label: 'Relevance Analysis',
    description: 'LLM gate over returned references',
    icon: Zap,
    stageNumber: '1.5',
  },
  {
    key: '4',
    label: 'Deep Analysis',
    description: 'Map features and assess top threats',
    icon: ShieldCheck,
    stageNumber: '3',
  },
  {
    key: '5',
    label: 'Consolidated Report',
    description: 'Create and share novelty assessment',
    icon: FileText,
    stageNumber: '4',
  },
]

function stageCircleClasses(status: StageStatus, isCurrent: boolean) {
  if (status === 'completed') return 'border-emerald-500 bg-emerald-500 text-white'
  if (status === 'in_progress') return 'border-ai-blue-500 bg-white text-ai-blue-600 ring-4 ring-ai-blue-100'
  if (status === 'failed') return 'border-rose-500 bg-rose-500 text-white'
  if (isCurrent) return 'border-ai-blue-500 bg-ai-blue-600 text-white'
  if (status === 'blocked') return 'border-slate-200 bg-slate-100 text-slate-400'
  return 'border-slate-300 bg-white text-slate-500'
}

function StageGlyph({ status, icon: Icon }: { status: StageStatus; icon: React.ElementType }) {
  if (status === 'completed') return <Check className="h-3.5 w-3.5" />
  if (status === 'in_progress') return <Loader2 className="h-3.5 w-3.5 animate-spin" />
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5" />
  return <Icon className="h-3.5 w-3.5" />
}

export default function NoveltyStageNav({
  selectedStage,
  onStageSelect,
  getStageStatus,
  isStageCompleted,
  onRunStage,
  activeExecutionStage,
  searchId,
  overallProgress,
  formTitle,
  collapsed = false,
  onToggleCollapsed,
}: NoveltyStageNavProps) {
  const [hoveredStage, setHoveredStage] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const completedCount = useMemo(
    () => STAGE_CONFIGS.filter(stage => isStageCompleted(stage.key)).length,
    [isStageCompleted],
  )

  const handleRunClick = useCallback(async (event: React.MouseEvent, stageKey: StageTab) => {
    event.stopPropagation()
    if (isRunning || activeExecutionStage) return

    setIsRunning(true)
    try {
      await onRunStage(stageKey)
    } finally {
      setIsRunning(false)
    }
  }, [activeExecutionStage, isRunning, onRunStage])

  const currentIndex = STAGE_CONFIGS.findIndex(stage => stage.key === selectedStage)
  const compactTitle = formTitle
    ? formTitle.substring(0, 32) + (formTitle.length > 32 ? '...' : '')
    : 'Patent novelty workflow'

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between gap-3'}`}>
          <div className={`flex min-w-0 items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-ai-blue-600 text-white">
              <Search className="h-4 w-4" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Novelty Search</div>
                <div className="truncate text-xs text-slate-500">{compactTitle}</div>
              </div>
            )}
          </div>

          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="hidden h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 xl:inline-flex"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          )}
        </div>

        {!collapsed && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Pipeline Progress
              </span>
              <span className="text-xs font-semibold text-slate-900">{overallProgress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-ai-blue-500 transition-all duration-300"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500">
              {completedCount} of {STAGE_CONFIGS.length} stages complete
            </div>
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-3 light-scrollbar">
        <div className="space-y-1">
          {STAGE_CONFIGS.map((stage, stageIndex) => {
            const status = getStageStatus(stage.key)
            const isCurrent = selectedStage === stage.key
            const isFailed = status === 'failed'
            const isBlocked = status === 'blocked'
            const canRun = searchId && stage.stageNumber && !isBlocked && !activeExecutionStage
            const showRun = (hoveredStage === stage.key || isFailed) && canRun && !collapsed

            return (
              <div
                key={stage.key}
                className="relative"
                onMouseEnter={() => setHoveredStage(stage.key)}
                onMouseLeave={() => setHoveredStage(null)}
              >
                {stageIndex < STAGE_CONFIGS.length - 1 && (
                  <div
                    className={`absolute top-9 h-5 w-px ${
                      collapsed ? 'left-1/2 -translate-x-1/2' : 'left-[17px]'
                    } ${status === 'completed' ? 'bg-emerald-300' : 'bg-slate-200'}`}
                  />
                )}

                <button
                  type="button"
                  onClick={() => onStageSelect(stage.key)}
                  title={collapsed ? `${stage.label}: ${stage.description}` : undefined}
                  className={`group relative flex w-full items-center rounded-lg border text-left transition-colors ${
                    collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
                  } ${
                    isCurrent
                      ? 'border-ai-blue-200 bg-ai-blue-50'
                      : 'border-transparent hover:bg-slate-50'
                  } ${isFailed ? 'ring-1 ring-rose-200' : ''}`}
                >
                  <span
                    className={`z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 ${stageCircleClasses(status, isCurrent)}`}
                  >
                    <StageGlyph status={status} icon={stage.icon} />
                  </span>

                  {!collapsed && (
                    <>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-sm font-medium ${
                            isFailed
                              ? 'text-rose-700'
                              : isCurrent
                                ? 'text-ai-blue-700'
                                : status === 'completed'
                                  ? 'text-slate-900'
                                  : 'text-slate-700'
                          }`}
                        >
                          {stage.label}
                        </span>
                        <span className="block truncate text-xs text-slate-500">{stage.description}</span>
                      </span>

                      {showRun && (
                        <span
                          onClick={(event) => handleRunClick(event, stage.key)}
                          className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border text-xs transition-colors ${
                            isFailed
                              ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
                              : 'border-ai-blue-200 bg-white text-ai-blue-600 hover:bg-ai-blue-50'
                          }`}
                          title={isFailed ? 'Retry stage' : 'Run stage'}
                          role="button"
                          tabIndex={0}
                        >
                          {isFailed ? <RotateCcw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </nav>

      <div className="border-t border-slate-200 p-3">
        {collapsed ? (
          <div className="text-center text-[11px] font-medium text-slate-500">
            {currentIndex + 1}/{STAGE_CONFIGS.length}
          </div>
        ) : (
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Stage {currentIndex + 1} of {STAGE_CONFIGS.length}</span>
            <span className="font-medium text-slate-700">{STAGE_CONFIGS[currentIndex]?.label}</span>
          </div>
        )}
      </div>
    </aside>
  )
}
