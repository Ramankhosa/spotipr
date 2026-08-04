'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  Connection,
  Node,
  Edge,
  NodeTypes,
  MarkerType,
} from '@xyflow/react'
import type { Node as ReactFlowNode } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  Plus,
  Play,
  Loader2,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Target,
  Layers,
  Zap,
  Search,
  FileText,
  ArrowRight,
  X,
  Settings,
  RefreshCw,
  Download,
  Edit3,
  ChevronLeft,
  ChevronDown,
  HelpCircle,
  LayoutGrid,
  Eye,
  EyeOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

// Import custom nodes
import SeedNode from './nodes/SeedNode'
import DimensionNode from './nodes/DimensionNode'
import OperatorNode from './nodes/OperatorNode'
import IdeaNode from './nodes/IdeaNode'
import CombineTray from './CombineTray'
import IdeaFramePanel from './IdeaFramePanel'
import IdeationHelpModal from './IdeationHelpModal'
import IdeationProcessingView from './IdeationProcessingView'
import ContradictionInsightPanel from './ContradictionInsightPanel'
import { layoutMindMap, layoutSignature } from './mindmap-layout'

interface IdeationWorkspaceProps {
  onExportToBank: () => void
  onRunNoveltySearch: (input: {
    title: string
    description: string
    sourceMetadata: {
      source: 'ideation'
      sessionId: string
      ideaFrameId: string
    }
  }) => void
}

// Session status stages (internal only - UI does NOT show these names per SRS)
type SessionStage = 
  | 'idle'                    // Initial - no session
  | 'seed_input'              // Editing seed (new or returning to edit)
  | 'grounding'               // Processing - semantic grounding (was normalizing)
  | 'clarifying'              // Input needed - questions from AI (BLOCKING)
  | 'framing'                 // Processing - inventive framing
  | 'discovering'             // Processing - dimension discovery
  | 'expanding'               // Processing - dimension expansion
  | 'exploring'               // Workspace - user explores mind map
  | 'generating'              // Processing - creating ideas
  | 'assessing'               // Processing - preliminary novelty assessment (LLM-only)
  | 'reviewing'               // Workspace - reviewing ideas

// Streaming idea interface for progressive display
interface StreamingIdea {
  id: string
  title: string
  problem: string
  principle: string
  status: 'generating' | 'ready' | 'checking_novelty' | 'verified'
  noveltyScore?: number
}

// Helper to determine which view to show
const isInputView = (stage: SessionStage) => 
  ['idle', 'seed_input', 'clarifying'].includes(stage)

const isProcessingView = (stage: SessionStage) =>
  ['grounding', 'framing', 'discovering', 'expanding', 'generating', 'assessing'].includes(stage)

const isWorkspaceView = (stage: SessionStage) =>
  ['exploring', 'reviewing'].includes(stage)

interface IdeationSession {
  id: string
  status: string
  seedText: string
  seedGoal?: string
  seedConstraints: string[]
  groundingContext?: any      // SEMANTIC_GROUNDING output
  inventiveFraming?: any      // INVENTIVE_FRAMING output
  primaryDimensions?: any[]   // DIMENSION_DISCOVERY output
}

// IdeaFrame data model per SRS Section 5
interface IdeaFrame {
  id: string
  title?: string
  status: string
  userRating?: number
  // Core fields from mechanism-pure generation
  coreMechanism: string
  inventiveLeap: string
  eliminatedAssumption: string
  contradictionResolved: string
  whyNotObvious: string
  mechanismBoundaryTest?: {
    whatItDoesNotSolve: string
    outOfScope?: string  // Legacy field for backward compatibility
    failureByDesign?: string  // New field: scenario where invention intentionally fails
  }
  // Preliminary novelty assessment (LLM-only, NO prior art)
  noveltyAssessment?: {
    originalityStrength: 'HIGH' | 'MEDIUM' | 'LOW'
    noveltyRiskLevel: 'LOW' | 'MODERATE' | 'HIGH'
    likelyExaminerObjection: string
    redundancyRisk: string
    strongestNovelAspect: string
    weakestNovelAspect: string
    improvementDirections: string[]
  }
  // Legacy fields for compatibility
  data?: any
}

const nodeTypes: NodeTypes = {
  seed: SeedNode,
  dimension: DimensionNode,
  operator: OperatorNode,
  idea: IdeaNode,
}

// Subtle edge colors that match family colors - same palette as DimensionNode
const FAMILY_EDGE_COLORS = [
  '#a8a29e', // stone
  '#94a3b8', // slate
  '#a1a1aa', // zinc
  '#a3a3a3', // neutral
  '#fbbf24', // amber (muted)
  '#34d399', // emerald (muted)
  '#38bdf8', // sky (muted)
  '#fb7185', // rose (muted)
  '#818cf8', // indigo (muted)
  '#2dd4bf', // teal (muted)
  '#fb923c', // orange (muted)
  '#22d3ee', // cyan (muted)
]

// Simple hash function to get consistent color index from family name
function getFamilyEdgeColor(family: string | undefined): string {
  if (!family) return '#94a3b8' // Default slate
  let hash = 0
  for (let i = 0; i < family.length; i++) {
    const char = family.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return FAMILY_EDGE_COLORS[Math.abs(hash) % FAMILY_EDGE_COLORS.length]
}

// Utility: Convert backend node type to React Flow node type
function getNodeType(type: string): string {
  const typeMap: Record<string, string> = {
    'SEED': 'seed',
    'DIMENSION_FAMILY': 'dimension',
    'DIMENSION_OPTION': 'dimension',
    'OPERATOR': 'operator',
    'IDEA': 'idea',
    'COMPONENT': 'dimension',
    'CONSTRAINT': 'dimension',
  }
  return typeMap[type] || 'dimension'
}

// Utility: Map session status to UI stage (per new pipeline)
function mapStatusToStage(status: string): SessionStage {
  const stageMap: Record<string, SessionStage> = {
    'SEED_INPUT': 'seed_input',
    'GROUNDING': 'grounding',
    'CLARIFYING': 'clarifying',
    'FRAMING': 'framing',
    'DISCOVERING': 'discovering',
    'EXPANDING': 'expanding',
    'EXPLORING': 'exploring',
    'GENERATING': 'generating',
    'ASSESSING': 'assessing',
    'REVIEWING': 'reviewing',
    'ARCHIVED': 'reviewing',
  }
  return stageMap[status] || 'exploring'
}

export default function IdeationWorkspace({ onExportToBank, onRunNoveltySearch }: IdeationWorkspaceProps) {
  const { toast } = useToast()

  // Session state
  const [sessions, setSessions] = useState<any[]>([])
  const [currentSession, setCurrentSession] = useState<IdeationSession | null>(null)
  const [stage, setStage] = useState<SessionStage>('idle')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Input state
  const [seedText, setSeedText] = useState('')
  const [seedGoal, setSeedGoal] = useState('')
  const [seedConstraints, setSeedConstraints] = useState<string[]>([])
  const [newConstraint, setNewConstraint] = useState('')
  
  // Clarifying questions state
  const [clarifyingAnswers, setClarifyingAnswers] = useState<Record<number, string>>({})
  
  // Edit mode - to preserve selections when regenerating
  const [preservedSelections, setPreservedSelections] = useState<Set<string>>(new Set())

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<ReactFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)

  // Selection state for combine tray
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set())
  
  // Collapsed nodes state
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())

  // Expanding nodes state for loading indicators
  const [expandingNodes, setExpandingNodes] = useState<Set<string>>(new Set())

  // Track newly added nodes for smooth animations
  const [newNodes, setNewNodes] = useState<Set<string>>(new Set())

  // Ideas panel size state
  const [ideasPanelWidth, setIdeasPanelWidth] = useState(384) // Default 24rem (w-96)
  
  // Idea frames
  const [ideaFrames, setIdeaFrames] = useState<IdeaFrame[]>([])
  const [selectedIdea, setSelectedIdea] = useState<IdeaFrame | null>(null)
  const [showIdeaPanel, setShowIdeaPanel] = useState(false)

  // Combine tray visibility
  const [showTray, setShowTray] = useState(false)

  // Workspace HUD visibility
  const [showMindMapPanel, setShowMindMapPanel] = useState(true)
  const [showSelectionPanel, setShowSelectionPanel] = useState(true)
  
  // Streaming ideas for progressive display during generation
  const [streamingIdeas, setStreamingIdeas] = useState<StreamingIdea[]>([])
  
  // Preliminary assessment progress state (LLM-only, no patent search)
  const [assessmentProgress, setAssessmentProgress] = useState<{
    currentStep: number
    totalSteps: number
    message: string
  } | undefined>(undefined)
  
  // Track which idea is being assessed
  const [assessingIdeaId, setAssessingIdeaId] = useState<string | null>(null)

  // Pipeline state (new SRS flow)
  const [inventiveFraming, setInventiveFraming] = useState<any>(null)
  const [feedbackLoopResults, setFeedbackLoopResults] = useState<any>(null)
  const [qualityMetrics, setQualityMetrics] = useState<any>(null)
  
  // Mechanism validation warning (single-mechanism enforcement)
  const [mechanismWarning, setMechanismWarning] = useState<string | null>(null)

  // Help modal state
  const [showHelp, setShowHelp] = useState(false)
  
  // Session restoration flag
  const [isRestoringSession, setIsRestoringSession] = useState(true)

  // ============================================
  // SESSION PERSISTENCE - Survive page refresh
  // ============================================
  const STORAGE_KEYS = {
    SESSION_ID: 'ideation_current_session_id',
    SELECTED_NODES: 'ideation_selected_nodes',
    COLLAPSED_NODES: 'ideation_collapsed_nodes',
  }

  // Persist selected nodes to localStorage
  const persistSelectedNodes = useCallback((nodeIds: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEYS.SELECTED_NODES, JSON.stringify(Array.from(nodeIds)))
    } catch (e) {
      console.warn('Failed to persist selected nodes:', e)
    }
  }, [])

  // Persist collapsed nodes to localStorage
  const persistCollapsedNodes = useCallback((nodeIds: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEYS.COLLAPSED_NODES, JSON.stringify(Array.from(nodeIds)))
    } catch (e) {
      console.warn('Failed to persist collapsed nodes:', e)
    }
  }, [])

  // Persist current session ID to localStorage
  const persistCurrentSession = useCallback((sessionId: string | null) => {
    try {
      if (sessionId) {
        localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId)
      } else {
        localStorage.removeItem(STORAGE_KEYS.SESSION_ID)
      }
    } catch (e) {
      console.warn('Failed to persist session ID:', e)
    }
  }, [])

  // Restore session state on component mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedSessionId = localStorage.getItem(STORAGE_KEYS.SESSION_ID)
        const savedSelectedNodes = localStorage.getItem(STORAGE_KEYS.SELECTED_NODES)
        const savedCollapsedNodes = localStorage.getItem(STORAGE_KEYS.COLLAPSED_NODES)

        if (savedSessionId) {
          console.log('[Session Restore] Found saved session:', savedSessionId)
          
          // Load the session
          const response = await fetch(`/api/idea-bank/ideation/${savedSessionId}`, {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
            },
          })

          if (response.ok) {
            const data = await response.json()
            
            // Restore session
            setCurrentSession(data.session)
            
            // Load graph nodes and edges
            if (data.graph) {
              const loadedNodes = data.graph.nodes.map((n: any) => ({
                id: n.id,
                type: getNodeType(n.type),
                position: n.position,
                data: {
                  ...n.data,
                  type: n.type,
                },
              }))
              setNodes(loadedNodes)
              setEdges(data.graph.edges.map((e: any) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                label: e.label,
                animated: e.animated,
                markerEnd: { type: MarkerType.ArrowClosed },
              })))

              // Restore collapsed nodes
              if (savedCollapsedNodes) {
                try {
                  const parsed = JSON.parse(savedCollapsedNodes)
                  setCollapsedNodes(new Set(parsed))
                } catch {
                  // Use default collapsing
                  const nodesWithChildren = new Set<string>()
                  loadedNodes.forEach((n: any) => {
                    const parentId = n.data?.parentId || n.data?.parentNodeId
                    if (parentId) nodesWithChildren.add(parentId)
                  })
                  const nodesToCollapse = loadedNodes
                    .filter((n: any) => nodesWithChildren.has(n.id) && n.type !== 'seed')
                    .map((n: any) => n.id)
                  setCollapsedNodes(new Set(nodesToCollapse))
                }
              }

              // Restore selected nodes
              if (savedSelectedNodes) {
                try {
                  const parsed = JSON.parse(savedSelectedNodes)
                  // Only restore selections that exist in current graph
                  const validSelections = parsed.filter((id: string) => 
                    loadedNodes.some((n: any) => n.id === id)
                  )
                  setSelectedNodes(new Set(validSelections))
                  if (validSelections.length > 0) {
                    setShowTray(true)
                  }
                } catch {
                  console.warn('Failed to parse saved selections')
                }
              }
            }

            // Load idea frames
            if (data.ideaFrames) {
              setIdeaFrames(data.ideaFrames)
            }

            // Set stage based on session status
            const restoredStage = mapStatusToStage(data.session.status)
            setStage(restoredStage)
            
            // Show tray if in exploring/reviewing stage
            if (['exploring', 'reviewing'].includes(restoredStage)) {
              setShowTray(true)
            }

            console.log('[Session Restore] Successfully restored session to stage:', restoredStage)
          } else {
            // Session not found or access denied - clear saved data
            console.log('[Session Restore] Session not found, clearing saved data')
            localStorage.removeItem(STORAGE_KEYS.SESSION_ID)
            localStorage.removeItem(STORAGE_KEYS.SELECTED_NODES)
            localStorage.removeItem(STORAGE_KEYS.COLLAPSED_NODES)
          }
        }
      } catch (e) {
        console.error('[Session Restore] Failed to restore session:', e)
      } finally {
        setIsRestoringSession(false)
      }
    }

    restoreSession()
  }, []) // Only run on mount

  // Persist session ID whenever it changes
  useEffect(() => {
    if (!isRestoringSession && currentSession) {
      persistCurrentSession(currentSession.id)
    }
  }, [currentSession?.id, isRestoringSession, persistCurrentSession])

  // Persist selections whenever they change
  useEffect(() => {
    if (!isRestoringSession) {
      persistSelectedNodes(selectedNodes)
    }
  }, [selectedNodes, isRestoringSession, persistSelectedNodes])

  // Persist collapsed nodes whenever they change
  useEffect(() => {
    if (!isRestoringSession) {
      persistCollapsedNodes(collapsedNodes)
    }
  }, [collapsedNodes, isRestoringSession, persistCollapsedNodes])

  // Auto-fit view when nodes change
  const fitViewToNodes = useCallback(() => {
    if (reactFlowInstance && nodes.length > 0) {
      setTimeout(() => {
        reactFlowInstance.fitView({
          padding: 0.2,
          duration: 300,
          maxZoom: 1.2,
        })
      }, 100)
    }
  }, [reactFlowInstance, nodes.length])

  // Auto-layout: re-flow the tree from the *measured* size of every card.
  // Dimension cards vary hugely in height (a "what if" move with IMPACT /
  // LEADS TO / TENSION is several times taller than a family card), so spacing
  // is derived from real rendered heights instead of a fixed row height.
  const autoLayoutNodes = useCallback(() => {
    setNodes(prev => layoutMindMap(prev, collapsedNodes))
  }, [collapsedNodes, setNodes])

  // Everything the layout depends on: which nodes exist, how tall each one
  // currently renders, and what is collapsed. Deliberately excludes positions —
  // otherwise the layout would keep re-triggering itself.
  const currentLayoutSignature = useMemo(
    () => layoutSignature(nodes, collapsedNodes),
    [nodes, collapsedNodes]
  )
  const appliedLayoutSignature = useRef<string | null>(null)

  // Re-flow whenever the structure or any card's measured height changes:
  // expanding a dimension, collapsing a branch, or a card growing when its
  // "add your direction" input opens all keep the siblings apart.
  useEffect(() => {
    if (nodes.length === 0) {
      appliedLayoutSignature.current = null
      return
    }
    if (appliedLayoutSignature.current === currentLayoutSignature) return

    // Small delay so a burst of measurements (a whole expansion arriving at
    // once) collapses into a single layout pass.
    const timer = setTimeout(() => {
      appliedLayoutSignature.current = currentLayoutSignature
      setNodes(prev => layoutMindMap(prev, collapsedNodes))
    }, 60)

    return () => clearTimeout(timer)
  }, [currentLayoutSignature, collapsedNodes, nodes.length, setNodes])

  // NOTE: Auto-layout can be triggered manually via button or on specific events

  // Keyboard shortcuts for help (?), ideas panel (i), and auto-layout (l)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return
      }

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowHelp(true)
      }
      if (e.key === 'i' && !e.ctrlKey && !e.metaKey && ideaFrames.length > 0) {
        e.preventDefault()
        setShowIdeaPanel(prev => !prev)
      }
      if (e.key === 'l' && !e.ctrlKey && !e.metaKey && nodes.length > 1) {
        e.preventDefault()
        autoLayoutNodes()
        // Fit view after layout
        setTimeout(() => {
          if (reactFlowInstance) {
            reactFlowInstance.fitView({ padding: 0.2, duration: 500 })
          }
        }, 100)
      }
      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showHelp, ideaFrames.length, nodes.length, autoLayoutNodes, reactFlowInstance])

  // History panel state - load on demand to reduce server load
  const [showHistory, setShowHistory] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)

  // Load sessions only when history panel is opened (on-demand)
  const loadSessions = async () => {
    if (sessionsLoaded) return // Don't reload if already loaded
    
    try {
      const response = await fetch('/api/idea-bank/ideation', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        setSessions(data.sessions || [])
        setSessionsLoaded(true)
      }
    } catch (e) {
      console.error('Failed to load sessions:', e)
    }
  }

  // Load sessions when history panel is opened
  useEffect(() => {
    if (showHistory && !sessionsLoaded) {
      loadSessions()
    }
  }, [showHistory, sessionsLoaded])

  const loadSession = async (sessionId: string, fitView: boolean = false, skipStageUpdate: boolean = false) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        setCurrentSession(data.session)
        
        // SRS Section 3.1 & 3.3: Map groundingContext and inventiveFraming from session
        // These are returned from the API with proper field names
        if (data.session.groundingContext || data.session.normalization) {
          // groundingContext is the SRS-compliant field name
          const grounding = data.session.groundingContext || data.session.normalization
          setCurrentSession(prev => prev ? { 
            ...prev, 
            groundingContext: grounding 
          } : null)
        }
        
        if (data.session.inventiveFraming || data.session.classification) {
          // inventiveFraming is the SRS-compliant field name  
          const framing = data.session.inventiveFraming || data.session.classification
          setInventiveFraming(framing)
          setCurrentSession(prev => prev ? { 
            ...prev, 
            inventiveFraming: framing 
          } : null)
        }
        
        // Load graph nodes and edges
        if (data.graph) {
          const loadedNodes = data.graph.nodes.map((n: any) => ({
            id: n.id,
            type: getNodeType(n.type),
            position: n.position,
            data: {
              ...n.data,
              type: n.type, // Include original type for DimensionNode to determine if expandable
            },
          }))
          setNodes(loadedNodes)
          setEdges(data.graph.edges.map((e: any) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label,
            animated: e.animated,
            markerEnd: { type: MarkerType.ArrowClosed },
          })))

          // By default, collapse all nodes that have children (show only top-level structure)
          const nodesWithChildren = new Set<string>()
          loadedNodes.forEach((n: any) => {
            const parentId = n.data?.parentId || n.data?.parentNodeId
            if (parentId) {
              nodesWithChildren.add(parentId)
            }
          })
          // Collapse all nodes that have children except the seed
          const nodesToCollapse = loadedNodes
            .filter((n: any) => nodesWithChildren.has(n.id) && n.type !== 'seed')
            .map((n: any) => n.id)
          setCollapsedNodes(new Set(nodesToCollapse))
        }

        // Load idea frames
        if (data.ideaFrames) {
          setIdeaFrames(data.ideaFrames)
        }

        // Set stage based on session status (unless explicitly skipped during generation flow)
        if (!skipStageUpdate) {
          setStage(mapStatusToStage(data.session.status))
        }

        // Auto-fit view after loading only if requested
        if (fitView) {
          setTimeout(() => fitViewToNodes(), 200)
        }
      }
    } catch (e) {
      setError('Failed to load session')
    } finally {
      setLoading(false)
    }
  }

  // Create new session
  const handleCreateSession = async () => {
    if (!seedText.trim()) return

    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/idea-bank/ideation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({
          seedText: seedText.trim(),
          seedGoal: seedGoal.trim() || undefined,
          seedConstraints: seedConstraints.filter(c => c.trim()),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setCurrentSession(data.session)
        setStage('seed_input')
        
        // Create seed node
        const seedNode: ReactFlowNode = {
          id: 'seed-root',
          type: 'seed',
          position: { x: 400, y: 100 },
          data: {
            title: seedText.slice(0, 100),
            description: seedText,
            state: 'EXPANDED',
          },
        }
        setNodes([seedNode])

        // Start semantic grounding (new pipeline)
        await handleSemanticGrounding(data.session.id)
      } else {
        const err = await response.json()
        setError(err.error || 'Failed to create session')
      }
    } catch (e) {
      setError('Failed to create session')
    } finally {
      setLoading(false)
    }
  }

  // Semantic Grounding (replaces normalize per SRS Section 3.1)
  const handleSemanticGrounding = async (sessionId: string) => {
    setStage('grounding')
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}/normalize`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setCurrentSession(prev => prev ? { ...prev, groundingContext: data.groundingContext } : null)
        
        // MANDATORY: Block if clarification questions exist (SRS Section 3.2)
        if (data.hasClarifications && data.groundingContext?.clarificationQuestions?.length > 0) {
          setStage('clarifying')
        } else {
          await handleInventiveFraming(sessionId)
        }
      } else {
        throw new Error('Semantic grounding failed')
      }
    } catch (e) {
      setError('Failed to analyze invention')
      setStage('seed_input')
    }
  }

  // Inventive Framing (SRS Section 3.3)
  const handleInventiveFraming = async (sessionId: string) => {
    setStage('framing')
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}/classify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setCurrentSession(prev => prev ? { ...prev, inventiveFraming: data.inventiveFraming } : null)
        setInventiveFraming(data.inventiveFraming)
        
        // Continue to dimension discovery
        await handleDimensionDiscovery(sessionId)
      } else {
        throw new Error('Inventive framing failed')
      }
    } catch (e) {
      setError('Failed to identify inventive tensions')
      setStage('seed_input')
    }
  }

  // Dimension Discovery (SRS Section 3.4 - replaces fixed dimension families)
  const handleDimensionDiscovery = async (sessionId: string) => {
    setStage('discovering')
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}/expand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ action: 'discover' }),
      })

      if (response.ok) {
        const data = await response.json()
        setCurrentSession(prev => prev ? { ...prev, primaryDimensions: data.primaryDimensions } : null)
        
        // Continue to dimension initialization
        await handleInitializeDimensions(sessionId)
      } else {
        throw new Error('Dimension discovery failed')
      }
    } catch (e) {
      setError('Failed to discover dimensions')
      setStage('seed_input')
    }
  }

  // Initialize dimensions
  const handleInitializeDimensions = async (sessionId: string) => {
    setStage('expanding')
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}/expand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ action: 'initialize' }),
      })

      if (response.ok) {
        // Reload full session to get updated graph
        await loadSession(sessionId, true) // Fit view when transitioning to exploration
        setStage('exploring')
        setShowTray(true)
        
        // Restore preserved selections if any
        if (preservedSelections.size > 0) {
          setSelectedNodes(preservedSelections)
          setPreservedSelections(new Set())
        }
      } else {
        throw new Error('Failed to initialize dimensions')
      }
    } catch (e) {
      setError('Failed to initialize dimensions')
    }
  }

  // Go back to edit seed (preserving current selections)
  const handleEditSeed = () => {
    // Preserve current selections for when we regenerate
    if (selectedNodes.size > 0) {
      setPreservedSelections(new Set(selectedNodes))
    }
    
    // Populate form with current session data
    if (currentSession) {
      setSeedText(currentSession.seedText)
      setSeedGoal(currentSession.seedGoal || '')
      setSeedConstraints(currentSession.seedConstraints || [])
    }
    
    // Go back to seed input
    setStage('seed_input')
    setShowTray(false)
    setShowIdeaPanel(false)
  }

  // Submit clarifying answers - MANDATORY per SRS Section 3.2
  // When user answers clarifying questions:
  // 1. Update seedText
  // 2. Re-run SEMANTIC_GROUNDING
  // 3. DELETE all downstream artifacts
  const handleSubmitClarifyingAnswers = async () => {
    if (!currentSession) return
    
    const questions = currentSession.groundingContext?.clarificationQuestions as string[] || []
    
    // If there are answers, update seed text with clarifications
    if (Object.keys(clarifyingAnswers).length > 0 && questions.length > 0) {
      const answersText = Object.entries(clarifyingAnswers)
        .map(([idx, answer]) => {
          const question = questions[parseInt(idx)]
          return question && answer ? `Q: ${question}\nA: ${answer}` : ''
        })
        .filter(Boolean)
        .join('\n\n')
      
      if (answersText) {
        // Update seed text with additional context from answers
        const updatedSeedText = seedText + '\n\nAdditional clarifications:\n' + answersText
        setSeedText(updatedSeedText)
        
        // Update session with new seed text
        try {
          await fetch(`/api/idea-bank/ideation/${currentSession.id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
            },
            body: JSON.stringify({ 
              seedText: updatedSeedText,
              // Clear all downstream artifacts per SRS
              clearDownstream: true 
            }),
          })
        } catch (e) {
          console.error('Failed to update session:', e)
        }
      }
    }
    
    // Clear answers and re-run semantic grounding from the start
    setClarifyingAnswers({})
    // Clear local state for downstream artifacts
    setInventiveFraming(null)
    setNodes([])
    setEdges([])
    setIdeaFrames([])
    
    // Re-run the pipeline from semantic grounding
    await handleSemanticGrounding(currentSession.id)
  }
  
  // Skip clarifications and proceed (with warning)
  const handleSkipClarifications = async () => {
    if (!currentSession) return
    setClarifyingAnswers({})
    await handleInventiveFraming(currentSession.id)
  }

  // Expand a node - SILK SMOOTH EXPANSION
  // userInput: Optional user-provided direction for the AI to consider with HIGH PRIORITY
  const handleExpandNode = async (nodeId: string, userInput?: string) => {
    if (!currentSession) return

    // Set expanding state for loading indicator
    setExpandingNodes(prev => new Set(prev).add(nodeId))

    try {
      const requestBody = { 
        action: 'expand', 
        nodeId,
        userInput: userInput?.trim() || undefined,  // Pass user input to API
      }
      console.log('[Expand] Sending request:', {
        url: `/api/idea-bank/ideation/${currentSession.id}/expand`,
        body: requestBody,
        hasUserInput: !!userInput,
        authToken: localStorage.getItem('auth_token') ? 'present' : 'MISSING',
      })
      
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/expand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(requestBody),
      })

      if (response.ok) {
        const data = await response.json()

        if (data.success && data.graph) {
          // SILK SMOOTH: Add new nodes and edges incrementally without page reload
          const newNodesForFlow = data.graph.nodes.map((n: any) => ({
            id: n.id,
            type: getNodeType(n.type),
            position: n.position,
            data: {
              ...n.data,
              type: n.type, // Include original type for DimensionNode
            },
          }))

          const newEdgesForFlow = data.graph.edges.map((e: any) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label,
            animated: e.animated,
            markerEnd: { type: MarkerType.ArrowClosed },
          }))

          // Add new nodes and edges to existing state - SILK SMOOTH
          // Combine all node updates in a single setState to avoid race conditions
          const newNodeIds = newNodesForFlow.map((n: any) => n.id)
          
          setNodes(prevNodes => {
            // First add the new nodes
            const withNewNodes = [...prevNodes, ...newNodesForFlow]
            // Then update the parent node state
            return withNewNodes.map(node =>
              node.id === nodeId
                ? { ...node, data: { ...node.data, state: 'EXPANDED' } }
                : node
            )
          })
          
          setEdges(prevEdges => [...prevEdges, ...newEdgesForFlow])

          // Remove the expanded node from collapsed nodes so its children become visible
          setCollapsedNodes(prev => {
            const next = new Set(prev)
            next.delete(nodeId)
            return next
          })

          // Mark new nodes for smooth animation
          setNewNodes(new Set(newNodeIds))

          // Clear animation flag after animation completes
          setTimeout(() => {
            setNewNodes(prev => {
              const next = new Set(prev)
              newNodeIds.forEach((id: string) => next.delete(id))
              return next
            })
          }, 600)

          // Subtle pan to show newly expanded children without losing context
          // Only pan if we have the react flow instance
          if (reactFlowInstance && newNodesForFlow.length > 0) {
            // Get the current viewport
            const viewport = reactFlowInstance.getViewport()
            
            // Find the average position of new nodes to pan toward them slightly
            const avgX = newNodesForFlow.reduce((sum: number, n: any) => sum + (n.position?.x || 0), 0) / newNodesForFlow.length
            const avgY = newNodesForFlow.reduce((sum: number, n: any) => sum + (n.position?.y || 0), 0) / newNodesForFlow.length
            
            // Calculate current center of viewport
            const viewportWidth = window.innerWidth * 0.6 // Approximate canvas width
            const viewportHeight = window.innerHeight - 80 // Canvas height
            const currentCenterX = (-viewport.x + viewportWidth / 2) / viewport.zoom
            const currentCenterY = (-viewport.y + viewportHeight / 2) / viewport.zoom
            
            // Only pan if children are significantly off-screen
            const dx = avgX - currentCenterX
            const dy = avgY - currentCenterY
            
            // If children are more than 300px away from center, pan slightly toward them
            if (Math.abs(dx) > 300 || Math.abs(dy) > 300) {
              // Pan just a bit (30%) toward the children, keeping user somewhat in context
              const panX = viewport.x - (dx * 0.3 * viewport.zoom)
              const panY = viewport.y - (dy * 0.15 * viewport.zoom) // Less vertical pan
              
              setTimeout(() => {
                reactFlowInstance.setViewport({
                  x: panX,
                  y: panY,
                  zoom: viewport.zoom,
                }, { duration: 400 })
              }, 100)
            }
          }
        } else {
          throw new Error(data.error || 'Expansion failed')
        }
      } else {
        // Try to get the actual error message from the response
        let errorMessage = 'Expansion request failed'
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || `Server error (${response.status})`
        } catch {
          errorMessage = `Server error (${response.status}): ${response.statusText}`
        }
        console.error('[Expand] Server error:', response.status, errorMessage)
        throw new Error(errorMessage)
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to expand node'
      setError(errorMsg)
      console.error('Expansion error:', e)
    } finally {
      // Clear expanding state
      setExpandingNodes(prev => {
        const next = new Set(prev)
        next.delete(nodeId)
        return next
      })
    }
  }

  // Toggle node selection
  const handleNodeSelect = (nodeId: string) => {
    setSelectedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  // Bucket type for multi-bucket generation
  interface IdeaBucket {
    id: string
    name: string
    dimensionIds: string[]
  }

  // Validate single-mechanism constraint (SRS Section 3.6)
  // Block generation if too many dimensions selected
  const validateSingleMechanism = (selectedDimensions: string[]): boolean => {
    if (selectedDimensions.length > 6) {
      // Set warning for CombineTray inline display
      setMechanismWarning('Too many dimensions selected (max 6). Please reduce your selection.')
      setError('Too many dimensions selected (max 6). Please reduce your selection to generate ideas with a single causal mechanism.')
      return false // Block generation
    }
    setMechanismWarning(null)
    return true
  }

  // Generate ideas - mechanism-pure per SRS Section 3.6
  // userGuidance: Optional user-provided guidance for the AI to follow with HIGH PRIORITY
  // SRS: TRIZ operators removed from pipeline
  const handleGenerateIdeas = async (
    count: number = 5, 
    intent: string = 'DIVERGENT', 
    buckets?: IdeaBucket[],
    userGuidance?: string
  ) => {
    if (!currentSession) return

    // Get selected dimension nodes from mind map
    const selectedNodeData = nodes.filter(n => selectedNodes.has(n.id))
    const dimensions = selectedNodeData.filter(n => 
      (n.data as any)?.type === 'DIMENSION_FAMILY' || (n.data as any)?.type === 'DIMENSION_OPTION'
    ).map(n => n.id)

    // Combine dimensions and other selected nodes, deduplicating to avoid false warnings
    // Previously this created duplicates when dimension nodes were selected (counted twice)
    const allDimensions = Array.from(new Set([...dimensions, ...Array.from(selectedNodes)]))

    // Validate single-mechanism constraint - block if too many dimensions
    if (!validateSingleMechanism(allDimensions)) {
      return // Stop generation if validation fails
    }

    setStage('generating')
    setLoading(true)
    
    // Initialize streaming ideas with placeholders
    const placeholderIdeas: StreamingIdea[] = Array.from({ length: count }, (_, i) => ({
      id: `generating-${i}`,
      title: '',
      problem: '',
      principle: '',
      status: 'generating' as const,
    }))
    setStreamingIdeas(placeholderIdeas)
    
    try {
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({
          recipe: {
            selectedDimensions: allDimensions,
            recipeIntent: intent,
            count,
            buckets: buckets || null,
            userGuidance: userGuidance?.trim() || undefined,
          },
          userGuidance: userGuidance?.trim() || undefined,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        
        // Store quality metrics
        setFeedbackLoopResults(data.feedbackLoop)
        setQualityMetrics(data.qualityMetrics)
        
        // Reload session to get idea frames (skip stage update to prevent resetting to exploring)
        await loadSession(currentSession.id, false, true)
        
        // Progressive reveal of actual ideas (simulated streaming effect)
        const newIdeaFrames = data.ideaFrames || []
        if (newIdeaFrames.length > 0) {
          for (let i = 0; i < newIdeaFrames.length; i++) {
            await new Promise(resolve => setTimeout(resolve, 300))
            const idea = newIdeaFrames[i]
            setStreamingIdeas(prev => {
              const updated = [...prev]
              if (updated[i]) {
                updated[i] = {
                  id: idea.id,
                  title: idea.coreMechanism || 'Mechanism-based Idea',
                  problem: '',
                  principle: idea.inventiveLeap || '',
                  status: 'ready',
                }
              }
              return updated
            })
          }
        }
        
        // Brief pause to show all ideas revealed
        await new Promise(resolve => setTimeout(resolve, 500))
        
        setStage('reviewing')
        setShowIdeaPanel(true)
      } else {
        throw new Error('Failed to generate ideas')
      }
    } catch (e) {
      setError('Failed to generate ideas')
      setStage('exploring')
    } finally {
      setLoading(false)
      setStreamingIdeas([])
    }
  }

  const buildNoveltyDisclosure = (idea: IdeaFrame) => {
    const sections = [
      `Generated ideation disclosure for novelty search.`,
      idea.coreMechanism ? `Core Mechanism:\n${idea.coreMechanism}` : '',
      idea.inventiveLeap ? `Inventive Leap:\n${idea.inventiveLeap}` : '',
      idea.whyNotObvious ? `Non-Obviousness Rationale:\n${idea.whyNotObvious}` : '',
      idea.eliminatedAssumption ? `Eliminated Assumption:\n${idea.eliminatedAssumption}` : '',
      idea.contradictionResolved ? `Contradiction Resolved:\n${idea.contradictionResolved}` : '',
      idea.mechanismBoundaryTest?.whatItDoesNotSolve
        ? `Boundary - Does Not Solve:\n${idea.mechanismBoundaryTest.whatItDoesNotSolve}`
        : '',
      idea.mechanismBoundaryTest?.failureByDesign
        ? `Failure By Design:\n${idea.mechanismBoundaryTest.failureByDesign}`
        : '',
      idea.mechanismBoundaryTest?.outOfScope
        ? `Out Of Scope:\n${idea.mechanismBoundaryTest.outOfScope}`
        : '',
    ]

    return sections.filter(Boolean).join('\n\n')
  }

  const handleRunNoveltySearch = async (ideaFrameId: string) => {
    if (!currentSession) return

    const idea = ideaFrames.find(frame => frame.id === ideaFrameId)
    if (!idea) {
      setError('Idea not found')
      return
    }

    onRunNoveltySearch({
      title: idea.title || idea.coreMechanism?.slice(0, 120) || 'Ideation-generated invention',
      description: buildNoveltyDisclosure(idea),
      sourceMetadata: {
        source: 'ideation',
        sessionId: currentSession.id,
        ideaFrameId,
      },
    })
  }

  // Export to idea bank (with optional selected improvement suggestions)
  const handleExportToBank = async (ideaFrameIds: string[], selectedSuggestions?: Record<string, string[]>) => {
    if (!currentSession || ideaFrameIds.length === 0) return

    try {
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ 
          ideaFrameIds,
          selectedSuggestions: selectedSuggestions || {},
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const suggestionsNote = selectedSuggestions && Object.keys(selectedSuggestions).length > 0
          ? ' (including selected improvement directions)'
          : ''
        toast({ title: `Successfully exported ${data.exportedCount} idea(s) to Idea Bank${suggestionsNote}!`, variant: 'success' })
        onExportToBank()
      }
    } catch (e) {
      setError('Failed to export to Idea Bank')
    }
  }

  // Delete an idea
  const handleDeleteIdea = async (ideaId: string) => {
    if (!currentSession) return

    try {
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/ideas/${ideaId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (response.ok) {
        // Remove the idea from local state
        setIdeaFrames(prev => prev.filter(idea => idea.id !== ideaId))
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to delete idea')
      }
    } catch (e) {
      setError('Failed to delete idea')
    }
  }

  // Handle edge connection
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({
      ...params,
      markerEnd: { type: MarkerType.ArrowClosed },
    }, eds)),
    [setEdges]
  )

  // Node click handler - single click to select
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    // Don't select seed nodes
    if (node.type === 'seed') return
    
    // Toggle selection
    setSelectedNodes(prev => {
      const next = new Set(prev)
      if (next.has(node.id)) {
        next.delete(node.id)
      } else {
        next.add(node.id)
      }
      return next
    })
  }, [])

  // Node double click to expand
  const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (node.data?.state === 'COLLAPSED') {
      handleExpandNode(node.id)
    }
  }, [currentSession])

  // Add constraint
  const handleAddConstraint = () => {
    if (newConstraint.trim()) {
      setSeedConstraints(prev => [...prev, newConstraint.trim()])
      setNewConstraint('')
    }
  }

  // Remove constraint
  const handleRemoveConstraint = (index: number) => {
    setSeedConstraints(prev => prev.filter((_, i) => i !== index))
  }

  // Reset workspace
  const handleReset = () => {
    // Clear persisted session data
    try {
      localStorage.removeItem(STORAGE_KEYS.SESSION_ID)
      localStorage.removeItem(STORAGE_KEYS.SELECTED_NODES)
      localStorage.removeItem(STORAGE_KEYS.COLLAPSED_NODES)
    } catch (e) {
      console.warn('Failed to clear session storage:', e)
    }
    
    setCurrentSession(null)
    setStage('idle')
    setSeedText('')
    setSeedGoal('')
    setSeedConstraints([])
    setNodes([])
    setEdges([])
    setSelectedNodes(new Set())
    setCollapsedNodes(new Set())
    setIdeaFrames([])
    setShowTray(false)
    setShowIdeaPanel(false)
    setError(null)
  }

  // ===== RESTORING SESSION VIEW =====
  // Shows while checking for and loading a saved session
  if (isRestoringSession) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <Loader2 className="w-8 h-8 animate-spin text-lamp-500 mx-auto mb-4" />
          <p className="text-slate-500">Restoring your session...</p>
        </motion.div>
      </div>
    )
  }

  // ===== INPUT VIEW =====
  // Shows for: idle, seed_input, clarifying stages
  if (isInputView(stage) || (!currentSession && stage !== 'grounding')) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-2xl"
        >
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-lamp-500 to-lamp-600 mb-4 shadow-lg shadow-lamp-500/25">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-slate-900 mb-2">
              Patent Ideation Engine
            </h2>
            <p className="text-slate-500 max-w-md mx-auto">
              Transform your invention concept into structured, patent-ready ideas 
              using AI-powered mind mapping and TRIZ operators.
            </p>
          </div>

          {/* Progress Indicator - NO stage names per SRS Section 4.1 */}
          {currentSession && (
            <div className="flex justify-center mb-6">
              <div className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-white border border-slate-200 shadow-sm">
                {[1, 2, 3, 4].map((dot, idx) => {
                  const currentIdx = stage === 'idle' || stage === 'seed_input' ? 0 :
                                   stage === 'clarifying' ? 0 :
                                   stage === 'grounding' || stage === 'framing' ? 1 :
                                   stage === 'discovering' || stage === 'expanding' ? 2 : 3
                  const isActive = idx === currentIdx
                  const isComplete = idx < currentIdx
                  
                  return (
                    <div key={idx} className="flex items-center">
                      <div className={`w-3 h-3 rounded-full transition-all
                        ${isComplete ? 'bg-green-500' : 
                          isActive ? 'bg-lamp-500 animate-pulse' : 
                          'bg-slate-200'}`}
                      />
                      {idx < 3 && <div className="w-6 h-0.5 bg-slate-200" />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Input Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 overflow-hidden">
            <div className="p-6 space-y-6">
              {/* Seed Input */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Describe Your Invention
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <Textarea
                  value={seedText}
                  onChange={(e) => setSeedText(e.target.value)}
                  placeholder="Example: A disposable syringe that prevents reuse by breaking the plunger after first use, using only mechanical means without electronics..."
                  rows={4}
                  className="w-full bg-slate-50 border-slate-200 focus:border-lamp-500 focus:ring-lamp-500/20 rounded-xl"
                  disabled={stage === 'clarifying'}
                />
                <p className="text-xs text-slate-400 mt-2">
                  Minimum 10 characters. Be specific about the problem and desired solution.
                </p>
              </div>

              {/* Goal Input */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Primary Goal
                  <span className="text-slate-400 text-xs ml-2">(optional)</span>
                </label>
                <Input
                  value={seedGoal}
                  onChange={(e) => setSeedGoal(e.target.value)}
                  placeholder="Example: Prevent needle reuse while keeping manufacturing cost under $0.10"
                  className="bg-slate-50 border-slate-200 focus:border-lamp-500 rounded-xl"
                  disabled={stage === 'clarifying'}
                />
              </div>

              {/* Constraints */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Constraints
                  <span className="text-slate-400 text-xs ml-2">(optional)</span>
                </label>
                <div className="flex gap-2 mb-2">
                  <Input
                    value={newConstraint}
                    onChange={(e) => setNewConstraint(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddConstraint()}
                    placeholder="Add a constraint (e.g., 'no electronics')"
                    className="bg-slate-50 border-slate-200 focus:border-lamp-500 rounded-xl"
                    disabled={stage === 'clarifying'}
                  />
                  <Button
                    onClick={handleAddConstraint}
                    variant="outline"
                    className="rounded-xl"
                    disabled={stage === 'clarifying'}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                {seedConstraints.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {seedConstraints.map((constraint, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="bg-lamp-50 text-lamp-700 hover:bg-lamp-100 cursor-pointer"
                        onClick={() => stage !== 'clarifying' && handleRemoveConstraint(i)}
                      >
                        {constraint}
                        {stage !== 'clarifying' && <X className="w-3 h-3 ml-1" />}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* ===== CLARIFYING QUESTIONS SECTION (MANDATORY BLOCKING) ===== */}
              {/* Per SRS Section 3.2: User cannot proceed unless they apply or explicitly skip */}
              {stage === 'clarifying' && (
                <div className="border-t border-slate-200 pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-lamp-100 flex items-center justify-center">
                      <HelpCircle className="w-4 h-4 text-lamp-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">Clarifications Needed</h3>
                      <p className="text-xs text-slate-500">Answer these questions to proceed (required)</p>
                    </div>
                  </div>
                  
                  {/* Display clarification questions from grounding context */}
                  {currentSession?.groundingContext?.clarificationQuestions && 
                   (currentSession.groundingContext.clarificationQuestions as string[]).length > 0 ? (
                    <div className="space-y-4">
                      {(currentSession.groundingContext.clarificationQuestions as string[]).map((question: string, idx: number) => (
                        <div key={idx} className="p-4 bg-lamp-50/50 rounded-xl border border-lamp-100">
                          <label className="block text-sm font-medium text-lamp-800 mb-2">
                            {question}
                          </label>
                          <Textarea
                            value={clarifyingAnswers[idx] || ''}
                            onChange={(e) => setClarifyingAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                            placeholder="Type your answer here..."
                            rows={2}
                            className="w-full bg-white border-lamp-200 focus:border-lamp-500 focus:ring-lamp-500/20 rounded-lg text-sm"
                          />
                        </div>
                      ))}
                      
                      {/* Ambiguity flags if any */}
                      {currentSession?.groundingContext?.ambiguityFlags?.length > 0 && (
                        <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                          <p className="text-xs font-medium text-amber-700 mb-1">⚠️ Ambiguities Detected:</p>
                          <ul className="text-xs text-amber-600 list-disc list-inside">
                            {(currentSession.groundingContext.ambiguityFlags as string[]).map((flag: string, i: number) => (
                              <li key={i}>{flag}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-50 rounded-xl text-center text-slate-500">
                      <p>No clarifications needed. Click continue to proceed.</p>
                    </div>
                  )}
                  
                  {/* Action Buttons - BLOCKING per SRS */}
                  <div className="flex gap-3 mt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStage('seed_input')
                        setClarifyingAnswers({})
                      }}
                      className="flex-1"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Edit Input
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleSkipClarifications}
                      className="flex-1 text-slate-500 hover:text-slate-700"
                    >
                      Skip (Not Recommended)
                    </Button>
                    <Button
                      onClick={handleSubmitClarifyingAnswers}
                      disabled={
                        (currentSession?.groundingContext?.clarificationQuestions as string[] || []).length > 0 &&
                        Object.keys(clarifyingAnswers).length === 0
                      }
                      className="flex-1 bg-lamp-500 hover:bg-lamp-600 text-white"
                    >
                      Apply Clarifications
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                  <button 
                    onClick={() => setError(null)}
                    className="ml-auto hover:bg-red-100 rounded p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Action Footer - Different states */}
            <div className="bg-slate-50 px-6 py-4 flex items-center justify-between border-t border-slate-100">
              <div className="text-sm text-slate-500">
                {currentSession ? (
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    Session Active
                  </span>
                ) : sessions.length > 0 ? (
                  <span>{sessions.length} previous session(s)</span>
                ) : (
                  <span>Ready to start</span>
                )}
              </div>
              
              {/* Main Action Buttons based on stage */}
              {stage === 'idle' || stage === 'seed_input' ? (
                <div className="flex gap-2">
                  {currentSession && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Resume to mind map if we have dimensions
                        if (nodes.length > 1) {
                          setStage('exploring')
                          setShowTray(true)
                        } else {
                          // Otherwise start fresh analysis
                          handleSemanticGrounding(currentSession.id)
                        }
                      }}
                      className="rounded-xl"
                    >
                      {nodes.length > 1 ? (
                        <>
                          <ArrowRight className="w-4 h-4 mr-2" />
                          Go to Mind Map
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Continue Analysis
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={handleCreateSession}
                    disabled={seedText.trim().length < 10 || loading}
                    className="bg-gradient-to-r from-lamp-500 to-lamp-600 hover:from-lamp-600 hover:to-lamp-700 text-white rounded-xl px-6 shadow-lg shadow-lamp-500/25"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : currentSession ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Restart Fresh
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Start Ideation
                      </>
                    )}
                  </Button>
                </div>
              ) : null /* Clarifying stage has its own buttons above */}
            </div>
          </div>

          {/* Previous Sessions - On Demand */}
          {!currentSession && (
            <div className="mt-6">
              {!showHistory ? (
                <button
                  onClick={() => setShowHistory(true)}
                  className="w-full text-center p-3 bg-slate-50 hover:bg-slate-100 rounded-xl border border-dashed border-slate-300 text-sm text-slate-600 transition-all"
                >
                  <FileText className="w-4 h-4 inline mr-2" />
                  View Previous Sessions
                </button>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-700">Previous Sessions</h3>
                    <button
                      onClick={() => setShowHistory(false)}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      Hide
                    </button>
                  </div>
                  {!sessionsLoaded ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="w-5 h-5 animate-spin text-lamp-500" />
                      <span className="ml-2 text-sm text-slate-500">Loading...</span>
                    </div>
                  ) : sessions.length > 0 ? (
                    <div className="space-y-2">
                      {sessions.slice(0, 5).map((session) => (
                        <button
                          key={session.id}
                          onClick={() => loadSession(session.id)}
                          className="w-full text-left p-3 bg-white rounded-xl border border-slate-200 hover:border-lamp-300 hover:shadow-md transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-900 truncate">
                              {session.seedText.slice(0, 50)}...
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {session.ideaCount} ideas
                            </Badge>
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            {new Date(session.createdAt).toLocaleDateString()}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 text-center p-4">No previous sessions found</p>
                  )}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    )
  }

  // ===== PROCESSING VIEW (Rich Animated Display) =====
  // Shows for: grounding, framing, discovering, expanding, generating, assessing stages
  // NOTE: UI must NOT show stage names per SRS Section 4.1
  if (isProcessingView(stage)) {
    return (
      <IdeationProcessingView
        stage={stage}
        seedText={currentSession?.seedText || seedText}
        onCancel={handleReset}
        streamingIdeas={streamingIdeas}
        assessmentProgress={assessmentProgress}
      />
    )
  }

  // ===== WORKSPACE VIEW (Mind Map) =====
  // Shows for: exploring, reviewing stages
  return (
    <div className="h-[calc(100vh-80px)] flex">
      {/* React Flow Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes
            .filter(n => {
              // Hide children of collapsed nodes - check entire ancestor chain
              const isAnyAncestorCollapsed = (nodeId: string, visited = new Set<string>()): boolean => {
                if (visited.has(nodeId)) return false
                visited.add(nodeId)
                
                const node = nodes.find(nd => nd.id === nodeId)
                if (!node) return false
                
                const parentId = ((node.data as any)?.parentId || (node.data as any)?.parentNodeId) as string | undefined
                if (!parentId) return false
                
                // If parent is collapsed, this node should be hidden
                if (collapsedNodes.has(parentId)) return true
                
                // Recursively check parent's ancestors
                return isAnyAncestorCollapsed(parentId, visited)
              }
              
              // Hide if any ancestor is collapsed
              if (isAnyAncestorCollapsed(n.id)) {
                return false
              }
              return true
            })
            .map(n => {
              const nodeElement = {
                ...n,
                data: {
                  ...n.data,
                  selected: selectedNodes.has(n.id),
                  collapsed: collapsedNodes.has(n.id),
                  hasChildren: nodes.some(child => {
                    const parentId = (child.data as any)?.parentId || (child.data as any)?.parentNodeId
                    return parentId === n.id
                  }),
                  expanding: expandingNodes.has(n.id),
                  isNew: newNodes.has(n.id),
                  onSelect: () => {
                    if (n.type !== 'seed') {
                      setSelectedNodes(prev => {
                        const next = new Set(prev)
                        if (next.has(n.id)) {
                          next.delete(n.id)
                        } else {
                          next.add(n.id)
                        }
                        return next
                      })
                    }
                  },
                  onExpand: (userInput?: string) => handleExpandNode(n.id, userInput),
                  onCollapse: () => {
                    setCollapsedNodes(prev => {
                      const next = new Set(prev)
                      if (next.has(n.id)) {
                        next.delete(n.id)
                      } else {
                        next.add(n.id)
                      }
                      return next
                    })
                  },
                },
              }

              return nodeElement
            })}
          edges={edges
            .filter(e => {
              // Hide edges to nodes that have any collapsed ancestor
              const isAnyAncestorCollapsed = (nodeId: string, visited = new Set<string>()): boolean => {
                if (visited.has(nodeId)) return false
                visited.add(nodeId)
                
                const node = nodes.find(nd => nd.id === nodeId)
                if (!node) return false
                
                const parentId = ((node.data as any)?.parentId || (node.data as any)?.parentNodeId) as string | undefined
                if (!parentId) return false
                
                if (collapsedNodes.has(parentId)) return true
                return isAnyAncestorCollapsed(parentId, visited)
              }
              
              if (isAnyAncestorCollapsed(e.target)) {
                return false
              }
              return true
            })
            .map(e => {
              // Animate edges between selected nodes
              const sourceSelected = selectedNodes.has(e.source)
              const targetSelected = selectedNodes.has(e.target)
              const bothSelected = sourceSelected && targetSelected
              
              // Get the target node's family for edge coloring
              const targetNode = nodes.find(n => n.id === e.target)
              const targetFamily = (targetNode?.data as any)?.family
              const familyEdgeColor = getFamilyEdgeColor(targetFamily)
              
              return {
                ...e,
                animated: bothSelected,
                style: bothSelected 
                  ? { stroke: '#8b5cf6', strokeWidth: 3 }
                  : sourceSelected || targetSelected
                    ? { stroke: '#a78bfa', strokeWidth: 2 }
                    : { stroke: familyEdgeColor, strokeWidth: 2, opacity: 0.7 },
                className: bothSelected ? 'animate-pulse' : '',
                markerEnd: { 
                  type: MarkerType.ArrowClosed, 
                  color: bothSelected ? '#8b5cf6' : sourceSelected || targetSelected ? '#a78bfa' : familyEdgeColor 
                },
              }
            })}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          nodeTypes={nodeTypes}
          onInit={(instance) => setReactFlowInstance(instance)}
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: false,
            style: { stroke: '#94a3b8', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
          }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className="bg-gradient-to-br from-slate-50 to-slate-100"
        >
          <Background color="#cbd5e1" gap={30} size={1} />
          <Controls 
            className="bg-white border border-slate-200 shadow-lg rounded-xl"
            showInteractive={false}
          />
          <MiniMap 
            className="bg-white border border-slate-200 shadow-lg rounded-xl"
            nodeColor={(node) => {
              if (selectedNodes.has(node.id)) return '#8b5cf6'
              if (node.type === 'seed') return '#06b6d4'
              if (node.type === 'operator') return '#f59e0b'
              // Use family color for dimension nodes
              const family = (node.data as any)?.family
              return getFamilyEdgeColor(family)
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
            position="bottom-left"
          />

          {/* Compact Control Panel */}
          {showMindMapPanel ? (
            <Panel position="top-left" className="m-3">
              <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 shadow-lg p-3 w-64">
                {/* Session Info */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-lamp-500 to-lamp-600 flex items-center justify-center">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <span className="text-sm font-semibold text-slate-700">Mind Map</span>
                      <p className="text-[10px] text-slate-400">{nodes.length} nodes</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowMindMapPanel(false)}
                    className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1"
                    title="Hide toolbar"
                  >
                    <EyeOff className="w-3 h-3" />
                    Hide
                  </button>
                </div>

                {/* Status indicator - NO stage names per SRS Section 4.1 */}
                <div className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium text-green-700">
                    {ideaFrames.length > 0 ? 'Ideas generated' : 'Ready to explore'}
                  </span>
                </div>

                {/* Invention Archetype (from dimension discovery) */}
                {currentSession?.primaryDimensions && (
                  <div className="flex items-center gap-1.5 flex-wrap mb-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-lamp-100 text-lamp-700">
                      {(currentSession as any).inventionArchetype?.replace(/_/g, ' ') || 'Custom Invention'}
                    </span>
                  </div>
                )}

                {/* Quick Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEditSeed}
                    className="flex-1 text-xs h-8 border-lamp-200 text-lamp-700 hover:bg-lamp-50"
                  >
                    <ChevronLeft className="w-3 h-3 mr-1" />
                    Edit Input
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    className="flex-1 text-xs h-8"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    New
                  </Button>
                </div>

                {/* Auto-Layout Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    autoLayoutNodes()
                    // Fit view after layout with a delay
                    setTimeout(() => {
                      if (reactFlowInstance) {
                        reactFlowInstance.fitView({ padding: 0.2, duration: 500 })
                      }
                    }, 100)
                  }}
                  className="w-full text-xs h-8 mt-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                >
                  <LayoutGrid className="w-3 h-3 mr-1" />
                  Auto-Layout (Fix Spacing)
                </Button>

                {/* Tips */}
                <div className="mt-2 p-2 bg-slate-50 rounded-lg text-[10px] text-slate-500">
                  💡 Click to select • Double-click to expand • Press 'l' to auto-layout • Press 'i' for ideas
                </div>
              </div>
            </Panel>
          ) : (
            <Panel position="top-left" className="m-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMindMapPanel(true)}
                className="text-xs h-8 bg-white/90"
              >
                <Eye className="w-3 h-3 mr-1" />
                Show Mind Map Panel
              </Button>
            </Panel>
          )}

          {/* Selection Panel - Compact floating widget */}
          {(stage === 'exploring' || stage === 'generating' || stage === 'reviewing') && (
            showSelectionPanel ? (
              <Panel position="top-right" className="m-3">
                <div className={`
                  bg-white/95 backdrop-blur-sm rounded-xl border shadow-lg p-3 w-48
                  transition-all duration-200
                  ${selectedNodes.size > 0 ? 'border-lamp-400' : 'border-slate-200'}
                `}>
                  {/* Selection Count */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-700">
                      {selectedNodes.size > 0 ? `${selectedNodes.size} Selected` : 'No Selection'}
                    </span>
                    <div className="flex items-center gap-2">
                      {selectedNodes.size > 0 && (
                        <button
                          onClick={() => setSelectedNodes(new Set())}
                          className="text-[10px] text-slate-400 hover:text-slate-600"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        onClick={() => setShowSelectionPanel(false)}
                        className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1"
                        title="Hide selection panel"
                      >
                        <EyeOff className="w-3 h-3" />
                        Hide
                      </button>
                    </div>
                  </div>
                  
                  {/* Selected Items Preview */}
                  {selectedNodes.size > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2 max-h-16 overflow-y-auto">
                      {Array.from(selectedNodes).slice(0, 4).map(nodeId => {
                        const node = nodes.find(n => n.id === nodeId)
                        return (
                          <span
                            key={nodeId}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-lamp-100 text-lamp-700 truncate max-w-[70px]"
                          >
                            {(node?.data as any)?.title || nodeId}
                          </span>
                        )
                      })}
                      {selectedNodes.size > 4 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          +{selectedNodes.size - 4}
                        </span>
                      )}
                    </div>
                  )}
                  
                  {/* Action Button */}
                  <Button
                    onClick={() => setShowTray(true)}
                    disabled={selectedNodes.size === 0}
                    className={`w-full h-8 text-xs ${
                      selectedNodes.size > 0
                        ? 'bg-lamp-500 hover:bg-lamp-600 text-white'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    {selectedNodes.size > 0 ? 'Generate Ideas' : 'Select Dimensions'}
                  </Button>

                  {/* Reopen Ideas Panel Button */}
                  {ideaFrames.length > 0 && !showIdeaPanel && (
                    <Button
                      onClick={() => setShowIdeaPanel(true)}
                      variant="outline"
                      className="w-full h-8 text-xs mt-2 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300"
                    >
                      <Lightbulb className="w-3 h-3 mr-1 text-emerald-600" />
                      View Ideas ({ideaFrames.length})
                    </Button>
                  )}
                </div>
              </Panel>
            ) : (
              <Panel position="top-right" className="m-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSelectionPanel(true)}
                  className="text-xs h-8 bg-white/90"
                >
                  <Eye className="w-3 h-3 mr-1" />
                  Show Selection Panel
                </Button>
              </Panel>
            )
          )}

          {/* Quick toggle to reopen Idea Recipe when hidden */}
          {!showTray && (stage === 'exploring' || stage === 'generating' || stage === 'reviewing') && (
            <Panel position="bottom-right" className="m-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTray(true)}
                className="text-xs h-8 bg-white/90"
              >
                <Eye className="w-3 h-3 mr-1" />
                Show Idea Recipe
              </Button>
            </Panel>
          )}
        </ReactFlow>

        {/* Loading Overlay - NO stage names per SRS */}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50"
            >
              <div className="text-center">
                <Loader2 className="w-12 h-12 animate-spin text-lamp-500 mx-auto mb-4" />
                <p className="text-slate-600 font-medium">
                  {stage === 'grounding' && 'Analyzing your invention...'}
                  {stage === 'framing' && 'Identifying inventive tensions...'}
                  {stage === 'discovering' && 'Discovering dimensions...'}
                  {stage === 'expanding' && 'Exploring possibilities...'}
                  {stage === 'generating' && 'Generating ideas...'}
                  {stage === 'assessing' && 'Assessing novelty...'}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Combine Tray Sidebar */}
      <AnimatePresence>
        {showTray && (
          <motion.div
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            className="w-80 border-l border-slate-200 bg-white overflow-hidden flex flex-col"
          >
            <CombineTray
              selectedNodes={selectedNodes}
              nodes={nodes}
              onGenerate={(count, intent, buckets, guidance) => 
                handleGenerateIdeas(count, intent, buckets, guidance)
              }
              onClear={() => {
                setSelectedNodes(new Set())
                setMechanismWarning(null)
              }}
              onRemoveNode={(nodeId) => {
                setSelectedNodes(prev => {
                  const next = new Set(prev)
                  next.delete(nodeId)
                  return next
                })
                setMechanismWarning(null)
              }}
              loading={loading}
              mechanismWarning={mechanismWarning}
              onClose={() => setShowTray(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ideas Panel */}
      <AnimatePresence>
        {showIdeaPanel && ideaFrames.length > 0 && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            className="border-l border-slate-200 bg-white overflow-hidden flex flex-col relative"
            style={{ width: `${ideasPanelWidth}px` }}
          >
            <IdeaFramePanel
              ideas={ideaFrames}
              onSelectIdea={(idea) => setSelectedIdea(idea)}
              onRunNoveltySearch={handleRunNoveltySearch}
              onExport={handleExportToBank}
              onClose={() => setShowIdeaPanel(false)}
              onDeleteIdea={handleDeleteIdea}
              feedbackLoopResults={feedbackLoopResults}
              qualityMetrics={qualityMetrics}
            />

            {/* Resize Handle */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1 bg-slate-200 hover:bg-lamp-400 cursor-col-resize transition-colors duration-200 group"
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
                const startWidth = ideasPanelWidth

                const handleMouseMove = (e: MouseEvent) => {
                  const deltaX = startX - e.clientX
                  const newWidth = Math.max(300, Math.min(800, startWidth + deltaX))
                  setIdeasPanelWidth(newWidth)
                }

                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove)
                  document.removeEventListener('mouseup', handleMouseUp)
                  document.body.style.cursor = ''
                  document.body.style.userSelect = ''
                }

                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
                document.body.style.cursor = 'col-resize'
                document.body.style.userSelect = 'none'
              }}
            >
              <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-0.5 h-8 bg-lamp-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Inventive Framing Insight Panel (replaces Contradiction Panel) */}
      {inventiveFraming && inventiveFraming.technicalContradictions?.length > 0 && (
        <ContradictionInsightPanel 
          data={inventiveFraming}
          onClose={() => setInventiveFraming(null)}
        />
      )}

      {/* Floating Help Button */}
      <button
        onClick={() => setShowHelp(true)}
        className="fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-gradient-to-br from-lamp-500 to-lamp-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
        title="Help (Press ? for keyboard shortcut)"
      >
        <HelpCircle className="w-6 h-6" />
      </button>

      {/* Help Modal */}
      <IdeationHelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  )
}
