'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import Stage4ResultsDisplay from './Stage4ResultsDisplay';
import NoveltyStageNav from './NoveltyStageNav';
import NoveltyFloatingButtons from './NoveltyFloatingButtons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { 
  Loader2, 
  Search, 
  FileText, 
  AlertCircle, 
  CheckCircle, 
  XCircle, 
  FolderOpen, 
  Check, 
  Eye, 
  Zap,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  Menu,
  SlidersHorizontal,
  X
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  NOVELTY_AUTO_STOP_MESSAGES,
  buildNoveltyAutoStageState,
  getNextNoveltyAutoStage,
} from '@/lib/novelty-auto-stage';
import {
  DEFAULT_STAGE1_RESULT_FILTERS,
  STAGE1_PAGE_SIZE,
  filterAndPaginateStage1Results,
  getStage1FilterOptions,
  getStage1MatchedItems,
  getStage1PatentNumber,
  getStage1Providers,
  getRawStage1SearchResults,
  getStage1ScorePercent,
  type Stage1ResultFilters,
} from '@/lib/novelty-stage1-results';
import {
  buildIpIndiaSearchUrl,
  normalizeIpIndiaApplicationNumbers,
} from '@/lib/ipindia-assistant';

// Local string constants for UI mapping
const NoveltySearchStatus = {
  PENDING: 'PENDING',
  STAGE_0_COMPLETED: 'STAGE_0_COMPLETED',
  STAGE_1_COMPLETED: 'STAGE_1_COMPLETED',
  STAGE_3_5_COMPLETED: 'STAGE_3_5_COMPLETED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

const NoveltySearchStage = {
  STAGE_0: 'STAGE_0',
  STAGE_1: 'STAGE_1',
  STAGE_3_5: 'STAGE_3_5',
  STAGE_4: 'STAGE_4',
} as const;

// Stage constants for UI display
const STAGE_LABELS = {
  PENDING: 'Idea Setup',
  STAGE_0_COMPLETED: 'Idea Setup',
  STAGE_1_COMPLETED: 'Relevance Analysis',
  STAGE_3_5_COMPLETED: 'Deep Analysis',
  COMPLETED: 'Consolidated Report'
};

const STAGE_PROGRESS = {
  PENDING: 0,
  STAGE_0_COMPLETED: 20,
  STAGE_1_COMPLETED: 40,
  STAGE_3_5_COMPLETED: 70,
  COMPLETED: 100
};

const STAGE_ORDER = ['PENDING', 'STAGE_0_COMPLETED', 'STAGE_1_COMPLETED', 'STAGE_3_5_COMPLETED', 'COMPLETED'];

const visibleStatusForReport = (status: string | undefined, quote?: string) => {
  if ((status === 'Present' || status === 'Partial') && quote) return status;
  if (status === 'Unknown') return 'Unknown';
  return 'Absent';
};

const crispRemarkForStatus = (status: string | undefined) => {
  if (status === 'Present') {
    return 'This feature is disclosed in the reviewed citation record; consider narrowing claims if it is central.';
  }
  if (status === 'Partial') {
    return 'Related disclosure exists, but the full feature is not mapped; differentiate using the missing element.';
  }
  return 'This feature is not expressly taught in the reviewed citation record and may support differentiation against this reference.';
};

const cleanReviewText = (value: any) => String(value || '').replace(/\battorney review\b/gi, 'review').trim();

interface Project {
  id: string;
  name: string;
  createdAt: string;
  patents?: { id: string }[];
  collaborators?: { id: string }[];
}

interface NoveltySearchWorkflowProps {
  patentId?: string;
  projectId?: string;
  onComplete?: (searchId: string) => void;
  initialSearchId?: string;
  initialTitle?: string;
  initialDescription?: string;
  ideaId?: string;
  executionMode?: 'legacy';
}

interface SearchState {
  searchId: string | null;
  status: string | null;
  currentStage: string | null;
  results: any;
  error: string | null;
  isLoading: boolean;
}

// Stage tab types
const STAGE_TABS = ['1','2','3','4','5'] as const;
type StageTab = (typeof STAGE_TABS)[number];

const STAGE_TAB_LABELS: Record<StageTab, string> = {
  '1': 'Idea Setup',
  '2': 'Search Results',
  '3': 'Relevance Analysis',
  '4': 'Deep Analysis',
  '5': 'Consolidated Report'
};

const STAGE_RUN_LABELS: Record<StageTab, string> = {
  '1': 'Start Novelty Search',
  '2': 'Search Patents',
  '3': 'Run LLM Relevance',
  '4': 'Run Deep Analysis',
  '5': 'Generate Report'
};

type NoveltyPatentSearchMode = 'intelligent' | 'manual';
type NoveltySearchSourceMode = 'INDIAN_ONLY' | 'PQAI_ONLY' | 'PQAI_PLUS_INDIAN';
type NoveltySearchPath = 'manual' | 'intelligent';

type ManualPatentSearchFields = {
  anyText: string;
  title: string;
  abstract: string;
  patentText: string;
  applicant: string;
  inventor: string;
  publicationNumber: string;
  applicationNumber: string;
  classifications: string;
  filingFrom: string;
  filingTo: string;
  publicationFrom: string;
  publicationTo: string;
  numberOfPagesMin: string;
  numberOfPagesMax: string;
  numberOfClaimsMin: string;
  numberOfClaimsMax: string;
  sourcePdfName: string;
  excludeTerms: string;
};

type ManualSearchState = {
  isLoading: boolean;
  error: string | null;
  hasSearched: boolean;
  results: any[];
  providerStats: any[];
  warnings: string[];
  queryPlan: any | null;
};

const defaultManualPatentSearchFields: ManualPatentSearchFields = {
  anyText: '',
  title: '',
  abstract: '',
  patentText: '',
  applicant: '',
  inventor: '',
  publicationNumber: '',
  applicationNumber: '',
  classifications: '',
  filingFrom: '',
  filingTo: '',
  publicationFrom: '',
  publicationTo: '',
  numberOfPagesMin: '',
  numberOfPagesMax: '',
  numberOfClaimsMin: '',
  numberOfClaimsMax: '',
  sourcePdfName: '',
  excludeTerms: '',
};

const manualSearchFieldLabels: Record<keyof ManualPatentSearchFields, string> = {
  anyText: 'Any text',
  title: 'Patent title',
  abstract: 'Abstract',
  patentText: 'Patent text',
  applicant: 'Applicant',
  inventor: 'Inventor',
  publicationNumber: 'Publication no.',
  applicationNumber: 'Application no.',
  classifications: 'IPC/CPC',
  filingFrom: 'Filing from',
  filingTo: 'Filing to',
  publicationFrom: 'Published from',
  publicationTo: 'Published to',
  numberOfPagesMin: 'Pages min',
  numberOfPagesMax: 'Pages max',
  numberOfClaimsMin: 'Claims min',
  numberOfClaimsMax: 'Claims max',
  sourcePdfName: 'Source PDF',
  excludeTerms: 'Excluded terms',
};

function AutoResizeTextarea({
  value,
  onChange,
  className = '',
  minHeight = 38,
  maxHeight = 112,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minHeight?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    const next = Math.min(Math.max(node.scrollHeight, minHeight), maxHeight);
    node.style.height = `${next}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [maxHeight, minHeight]);

  useEffect(() => {
    resize();
  }, [resize, value]);

  return (
    <textarea
      {...props}
      ref={ref}
      value={value}
      onChange={(event) => {
        onChange?.(event);
        requestAnimationFrame(resize);
      }}
      style={{ minHeight, maxHeight, ...(props.style || {}) }}
      className={`w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-5 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 ${className}`}
    />
  );
}

function splitManualValues(value: string) {
  return value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean);
}

function numberValue(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function listPatentText(value: unknown, limit = 4) {
  if (!value) return '';
  const values = Array.isArray(value)
    ? value.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        return String(record.name || record.applicant || record.value || '').trim();
      }
      return String(item || '').trim();
    })
    : typeof value === 'object'
      ? Object.values(value as Record<string, unknown>).map(item => String(item || '').trim())
      : [String(value)];
  return values.filter(Boolean).slice(0, limit).join(', ');
}

function displayInternationalPatentText(value: unknown) {
  return String(value || '')
    .replace(/PQAI_API_TOKEN/gi, 'international patent search token')
    .replace(/PQAI_TOKEN/gi, 'international patent search token')
    .replace(/Stored PQAI International Corpus/gi, 'Stored international patent corpus')
    .replace(/PQAI Global Patent Search/gi, 'International patent search')
    .replace(/PQAI API/gi, 'International patent search')
    .replace(/PQAI patent corpus/gi, 'International patent corpus')
    .replace(/\bpqai-corpus\b/gi, 'Stored international patents')
    .replace(/\bPQAI\b/gi, 'International patents')
    .replace(/\bpqai\b/gi, 'International patents');
}

function displayPatentProviderLabel(value: unknown) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase();
  if (normalized === 'pqai') return 'International patents';
  if (normalized === 'pqai-corpus') return 'Stored international patents';
  return displayInternationalPatentText(raw);
}

type LiveStageProgress = {
  stage?: string;
  status?: string;
  analyzedPatents?: number;
  totalPatents?: number;
  processedBatches?: number;
  batchCount?: number;
  failedBatches?: number;
  percent?: number;
  message?: string;
};

function getLiveStageProgress(results: any, stageNumber?: string | null): LiveStageProgress | null {
  if (!results || !stageNumber) return null;
  if (stageNumber === '1.5' || stageNumber === '2') {
    const gate = results?.aiRelevance || results?.stage1?.aiRelevance;
    return gate?.progress || null;
  }
  if (stageNumber === '3' || stageNumber === '3.5' || stageNumber === '3.5a' || stageNumber === '3.5b' || stageNumber === '3.5c') {
    return results?.stage35?.progress || results?.stage3_5?.progress || results?.progress || null;
  }
  return null;
}

function formatLiveProgressMessage(progress: LiveStageProgress | null, fallback: string) {
  if (!progress) return fallback;
  const analyzed = Number(progress.analyzedPatents || 0);
  const total = Number(progress.totalPatents || 0);
  const batches = Number(progress.batchCount || 0);
  const processedBatches = Number(progress.processedBatches || 0);
  const batchSuffix = batches > 0 ? ` Batch ${Math.min(processedBatches, batches)} of ${batches}.` : '';
  if (total > 0) {
    return `${progress.message || `${analyzed} of ${total} patents analyzed.`}${batchSuffix}`;
  }
  return progress.message || fallback;
}

export default function NoveltySearchWorkflow({
  patentId,
  projectId: initialProjectId,
  onComplete,
  initialSearchId,
  initialTitle,
  initialDescription,
  ideaId,
  executionMode
}: NoveltySearchWorkflowProps) {
  const [activeSearchPath, setActiveSearchPath] = useState<NoveltySearchPath>(
    initialSearchId || initialTitle || initialDescription ? 'intelligent' : 'manual'
  );
  const [formData, setFormData] = useState<{
    title: string;
    inventionDescription: string;
    jurisdiction: string;
    searchSourceMode: NoveltySearchSourceMode;
    llmExpansion: boolean;
    searchMode: NoveltyPatentSearchMode;
  }>({
    title: initialTitle || '',
    inventionDescription: initialDescription || '',
    jurisdiction: 'IN',
    searchSourceMode: 'INDIAN_ONLY',
    llmExpansion: true,
    searchMode: 'intelligent'
  });
  
  useEffect(() => {
    if (initialTitle || initialDescription) {
      setActiveSearchPath('intelligent');
      setFormData(prev => ({
        ...prev,
        title: initialTitle || prev.title,
        inventionDescription: initialDescription || prev.inventionDescription
      }));
    }
  }, [initialTitle, initialDescription]);

  const [searchState, setSearchState] = useState<SearchState>({
    searchId: null,
    status: null,
    currentStage: null,
    results: null,
    error: null,
    isLoading: false
  });

  const [stageProgress, setStageProgress] = useState({
    stage0: 0,
    stage1: 0,
    stage3_5: 0,
    stage4: 0
  });

  const [completedStages, setCompletedStages] = useState<string[]>([]);
  const [selectedStageTab, setSelectedStageTab] = useState<StageTab>('1');
  const [activeExecutionStage, setActiveExecutionStage] = useState<string | null>(null);
  const [deepAnalysisView, setDeepAnalysisView] = useState<'matrix' | 'remarks'>('matrix');
  const [stage1Filters, setStage1Filters] = useState<Stage1ResultFilters>({ ...DEFAULT_STAGE1_RESULT_FILTERS });
  const [stage1Page, setStage1Page] = useState(1);

  // Map stage tab keys to execution stage numbers
  const stageNumberByKey: Record<StageTab, string | null> = {
    '1': null,
    '2': '1',
    '3': '1.5',
    '4': '3',
    '5': '4'
  };

  // Evidence panel state (Stage 3.5 matrix cell details)
  const [selectedEvidence, setSelectedEvidence] = useState<null | {
    pn: string;
    patentTitle?: string;
    feature: string;
    status: string;
    quote?: string;
    reason?: string;
    field?: string;
    extentScore?: number;
    confidence?: number;
    featureId?: string;
    userDisclosure?: string;
    patentDisclosure?: string;
    evidenceSource?: string;
    attorneyRemark?: string;
    noveltyImpact?: string;
    claimReviewNote?: string;
    crispRemark?: string;
    professionalRemark?: string;
    link?: string;
  }>(null);

  // Stage simulation states
  const [isStage1Simulating, setIsStage1Simulating] = useState(false);
  const [stage1Message, setStage1Message] = useState('');
  const [isStage35Simulating, setIsStage35Simulating] = useState(false);
  const [stage35Message, setStage35Message] = useState('');
  const [isStage35aSimulating, setIsStage35aSimulating] = useState(false);
  const [stage35aMessage, setStage35aMessage] = useState('');

  // Stage 0 editing state
  const [isEditingStage0, setIsEditingStage0] = useState(false);
  const [editedSearchQuery, setEditedSearchQuery] = useState('');
  const [editedFeatures, setEditedFeatures] = useState<string[]>([]);
  const [editingFeatureIndex, setEditingFeatureIndex] = useState<number | null>(null);
  const [newFeatureText, setNewFeatureText] = useState('');
  const [autoMode, setAutoMode] = useState(false);
  const [stage0Approved, setStage0Approved] = useState(false);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestSearchStateRef = useRef<SearchState | null>(null);
  const autoStageStateRef = useRef<ReturnType<typeof buildNoveltyAutoStageState> | null>(null);
  const stage0ApprovedRef = useRef(false);
  const isAutoRunningRef = useRef(false);
  const [isFileProcessing, setIsFileProcessing] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [manualSearchFields, setManualSearchFields] = useState<ManualPatentSearchFields>(defaultManualPatentSearchFields);
  const [showMoreManualFilters, setShowMoreManualFilters] = useState(false);
  const [manualSearchState, setManualSearchState] = useState<ManualSearchState>({
    isLoading: false,
    error: null,
    hasSearched: false,
    results: [],
    providerStats: [],
    warnings: [],
    queryPlan: null,
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Progress messages
  const stage35Messages = [
    'Comparing invention features with patent disclosures...',
    'Analyzing technical differences...',
    'Evaluating novelty impact...',
    'Reviewing prior art citations...',
    'Preparing assessment data...'
  ];

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId || '');
  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 1279px)');
    const syncSidebar = () => setIsSidebarCollapsed(mediaQuery.matches);
    syncSidebar();
    mediaQuery.addEventListener('change', syncSidebar);
    return () => mediaQuery.removeEventListener('change', syncSidebar);
  }, []);

  useEffect(() => {
    latestSearchStateRef.current = searchState;
  }, [searchState]);

  useEffect(() => {
    stage0ApprovedRef.current = stage0Approved;
  }, [stage0Approved]);

  useEffect(() => {
    setStage1Page(1);
  }, [searchState.results]);

  const manualSearchFilters = useMemo(() => ({
    anyTextContains: splitManualValues(manualSearchFields.anyText),
    titleContains: splitManualValues(manualSearchFields.title),
    abstractContains: splitManualValues(manualSearchFields.abstract),
    patentTextContains: splitManualValues(manualSearchFields.patentText),
    publicationNumber: manualSearchFields.publicationNumber.trim() || undefined,
    applicationNumber: manualSearchFields.applicationNumber.trim() || undefined,
    applicants: splitManualValues(manualSearchFields.applicant),
    inventors: splitManualValues(manualSearchFields.inventor),
    classifications: splitManualValues(manualSearchFields.classifications),
    filingDateFrom: manualSearchFields.filingFrom || undefined,
    filingDateTo: manualSearchFields.filingTo || undefined,
    publicationDateFrom: manualSearchFields.publicationFrom || undefined,
    publicationDateTo: manualSearchFields.publicationTo || undefined,
    numberOfPagesMin: numberValue(manualSearchFields.numberOfPagesMin),
    numberOfPagesMax: numberValue(manualSearchFields.numberOfPagesMax),
    numberOfClaimsMin: numberValue(manualSearchFields.numberOfClaimsMin),
    numberOfClaimsMax: numberValue(manualSearchFields.numberOfClaimsMax),
    sourcePdfName: manualSearchFields.sourcePdfName.trim() || undefined,
    excludeTerms: splitManualValues(manualSearchFields.excludeTerms),
  }), [manualSearchFields]);

  const manualSearchHasCriteria = useMemo(() => Object.values(manualSearchFilters).some(value => (
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ''
  )), [manualSearchFilters]);

  const manualSearchSummary = useMemo(() => {
    const labels: Array<[keyof ManualPatentSearchFields, string]> = [
      ['anyText', 'Any text'],
      ['title', 'Patent title'],
      ['abstract', 'Abstract'],
      ['patentText', 'Patent text'],
      ['applicant', 'Applicant'],
      ['inventor', 'Inventor'],
      ['publicationNumber', 'Publication number'],
      ['applicationNumber', 'Application number'],
      ['classifications', 'IPC/CPC'],
      ['filingFrom', 'Filing from'],
      ['filingTo', 'Filing to'],
      ['publicationFrom', 'Published from'],
      ['publicationTo', 'Published to'],
      ['sourcePdfName', 'Source PDF'],
      ['numberOfClaimsMin', 'Claims min'],
      ['numberOfClaimsMax', 'Claims max'],
      ['numberOfPagesMin', 'Pages min'],
      ['numberOfPagesMax', 'Pages max'],
      ['excludeTerms', 'Excluded terms'],
    ];

    return labels
      .map(([field, label]) => {
        const value = manualSearchFields[field].trim();
        return value ? `${label}: ${value}` : '';
      })
      .filter(Boolean)
      .join('; ');
  }, [manualSearchFields]);

  const manualActiveChips = useMemo(() => {
    return (Object.keys(manualSearchFields) as Array<keyof ManualPatentSearchFields>)
      .map(field => {
        const value = manualSearchFields[field].trim();
        if (!value) return null;
        const shortValue = value.length > 42 ? `${value.slice(0, 39)}...` : value;
        return { field, label: manualSearchFieldLabels[field], value: shortValue };
      })
      .filter(Boolean) as Array<{ field: keyof ManualPatentSearchFields; label: string; value: string }>;
  }, [manualSearchFields]);

  const updateManualSearchField = (field: keyof ManualPatentSearchFields, value: string) => {
    setManualSearchFields(prev => ({ ...prev, [field]: value }));
  };

  const updateStage1Filter = useCallback((field: keyof Stage1ResultFilters, value: string) => {
    setStage1Filters(prev => ({ ...prev, [field]: value } as Stage1ResultFilters));
    setStage1Page(1);
  }, []);

  const clearStage1Filters = useCallback(() => {
    setStage1Filters({ ...DEFAULT_STAGE1_RESULT_FILTERS });
    setStage1Page(1);
  }, []);

  // Load existing search if provided
  useEffect(() => {
    if (!initialSearchId) return;
    setActiveSearchPath('intelligent');

    const authToken = localStorage.getItem('auth_token');
    if (!authToken) {
      setSearchState(prev => ({
        ...prev,
        error: 'Authentication token missing. Please log in again.'
      }));
      return;
    }

    const loadExistingSearch = async () => {
      try {
        setSearchState(prev => ({
          ...prev,
          searchId: initialSearchId,
          isLoading: true,
          error: null
        }));

        const response = await fetch(`/api/novelty-search/${initialSearchId}`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
          cache: 'no-store'
        });

        const data = await response.json();

        if (response.ok && data.search) {
          const search = data.search;
          const nextSearchState = {
            ...(latestSearchStateRef.current || searchState),
            searchId: initialSearchId,
            status: search.status,
            currentStage: search.currentStage,
            results: search.results,
            isLoading: false
          };
          latestSearchStateRef.current = nextSearchState;
          const nextAutoState = buildNoveltyAutoStageState(nextSearchState, stage0ApprovedRef.current);
          autoStageStateRef.current = nextAutoState;
          if (nextAutoState.stage0Approved) {
            stage0ApprovedRef.current = true;
            setStage0Approved(true);
          }
          setSearchState(prev => ({
            ...prev,
            ...nextSearchState
          }));

          const completed: string[] = [];
          if (search.stage0CompletedAt) completed.push('stage0');
          if (search.stage1CompletedAt) completed.push('stage1');
          if (search.stage35CompletedAt) completed.push('stage3_5');
          if (search.stage4CompletedAt) completed.push('stage4');

          setCompletedStages(completed);
          setStageProgress(prev => {
            const next = { ...prev };
            completed.forEach(stage => {
              (next as any)[stage] = 100;
            });
            return next;
          });
        } else {
          setSearchState(prev => ({
            ...prev,
            error: data.error || 'Failed to load search status',
            isLoading: false
          }));
        }
      } catch (error) {
        console.error('[Init] Failed to load existing novelty search:', error);
        setSearchState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to load search status',
          isLoading: false
        }));
      }
    };

    loadExistingSearch();
  }, [initialSearchId]);

  // Helper function to get current stage display info
  const getCurrentStageInfo = useCallback(() => {
    const currentStatus = searchState.status || 'PENDING';
    return {
      label: STAGE_LABELS[currentStatus as keyof typeof STAGE_LABELS] || 'Start Search',
      progress: STAGE_PROGRESS[currentStatus as keyof typeof STAGE_PROGRESS] || 0
    };
  }, [searchState.status]);

  // Helper: has Stage 1.5 (AI Relevance) been computed
  const hasStage15 = useCallback((): boolean => {
    const r: any = searchState.results || {};
    const gate = r?.aiRelevance || r?.stage1?.aiRelevance;
    return !!(gate && (Array.isArray(gate.accepted) || Array.isArray(gate.component) || Array.isArray(gate.borderline) || Array.isArray(gate.rejected)));
  }, [searchState.results]);

  const hasStage15Results = useMemo(() => hasStage15(), [hasStage15]);

  const stage0Snapshot = useMemo(() => {
    const root: any = searchState.results || {};
    const s0 = root.stage0 || root;
    const features = Array.isArray(s0?.inventionFeatures) ? s0.inventionFeatures.length : 0;
    return {
      hasQuery: !!s0?.searchQuery,
      featuresCount: features,
    };
  }, [searchState.results]);

  const stage1Results = useMemo(() => {
    return getRawStage1SearchResults(searchState.results);
  }, [searchState.results]);

  const hasStage1Results = stage1Results.length > 0;
  const hasStage2Results = hasStage1Results;
  const hasStage3Results = hasStage15Results;

  const aiRelevantPatentNumbers = useMemo(() => {
    const root: any = searchState.results || {};
    const aiRel = root?.aiRelevance || root?.stage1?.aiRelevance || {};
    return normalizeIpIndiaApplicationNumbers([
      ...(Array.isArray(aiRel.accepted) ? aiRel.accepted : []),
      ...(Array.isArray(aiRel.component) ? aiRel.component : []),
      ...(Array.isArray(aiRel.borderline) ? aiRel.borderline : []),
    ]);
  }, [searchState.results]);

  const openIpIndiaForPatentNumbers = useCallback(async (patentNumbers: string[]) => {
    const searchUrl = buildIpIndiaSearchUrl(patentNumbers);
    if (!searchUrl) {
      window.alert('No valid Indian patent application numbers are available for IP India search.');
      return;
    }

    const applicationNumbers = normalizeIpIndiaApplicationNumbers(patentNumbers);
    try {
      await navigator.clipboard?.writeText(applicationNumbers.join('\n'));
    } catch {
      // Clipboard access is best-effort; the extension payload is still enough.
    }

    const authToken = localStorage.getItem('auth_token');
    if (authToken) {
      window.postMessage({
        type: 'PATENTNEST_IPINDIA_SESSION',
        token: authToken,
        appOrigin: window.location.origin,
      }, window.location.origin);
    }

    window.open(searchUrl, '_blank', 'noopener,noreferrer');
  }, []);

  const hasStage35MappingResults = useMemo(() => {
    const root: any = searchState.results || {};
    const carrier = root.stage35 || root.stage3_5 || root;
    const featureMap = carrier?.feature_map || root.feature_map;
    return Array.isArray(featureMap) && featureMap.length > 0;
  }, [searchState.results]);

  const hasStage35AggregationResults = useMemo(() => {
    const root: any = searchState.results || {};
    const container = root.stage4 || root;
    return !!(container?.per_patent_coverage || container?.per_feature_uniqueness || container?.feature_coverage_summary);
  }, [searchState.results]);

  const hasStage35cResults = useMemo(() => {
    const root: any = searchState.results || {};
    const container = root.stage4 || root;
    const remarks = Array.isArray(container?.per_patent_remarks) ? container.per_patent_remarks : [];
    if (remarks.length === 0) return false;
    if (container?.stage35c_complete === true || container?.per_patent_remarks_source === 'stage35c') return true;
    if (container?.per_patent_remarks_source === 'stage35b_deterministic' || container?.per_patent_remarks_source === 'stage4_deterministic_fallback') return false;
    return remarks.some((remark: any) => (
      remark?.detailedAnalysis ||
      typeof remark?.relevance === 'number' ||
      typeof remark?.novelty_threat === 'string'
    ));
  }, [searchState.results]);

  const hasStage35Results = hasStage35MappingResults && hasStage35AggregationResults && hasStage35cResults;

  const hasStage4Results = useMemo(() => {
    const root: any = searchState.results || {};
    const report = root.stage4 || root;
    return !!(report.executive_summary || report.concluding_remarks || report.final_assessment || report.report_metadata);
  }, [searchState.results]);

  const autoStageState = useMemo(() => buildNoveltyAutoStageState({
    status: searchState.status,
    currentStage: searchState.currentStage,
    results: searchState.results,
  }, stage0Approved), [searchState.currentStage, searchState.results, searchState.status, stage0Approved]);

  useEffect(() => {
    autoStageStateRef.current = autoStageState;
    if (!stage0Approved && autoStageState.stage0Approved) {
      stage0ApprovedRef.current = true;
      setStage0Approved(true);
    }
  }, [autoStageState, stage0Approved]);

  const stage0ApprovedForUi = autoStageState.stage0Approved;

  const markStage0Approved = useCallback(() => {
    stage0ApprovedRef.current = true;
    setStage0Approved(true);
  }, []);

  // Auto-navigate to appropriate tab when status changes
  useEffect(() => {
    const s = searchState.status;
    if (!s) return;
    if (s === NoveltySearchStatus.PENDING) { setSelectedStageTab('1'); return; }
    if (s === NoveltySearchStatus.STAGE_0_COMPLETED) { setSelectedStageTab('1'); return; }
    if (s === NoveltySearchStatus.STAGE_1_COMPLETED) {
      setSelectedStageTab(hasStage15Results ? '3' : '2');
      return;
    }
    if (s === NoveltySearchStatus.STAGE_3_5_COMPLETED) {
      setSelectedStageTab('4');
      return;
    }
    if (s === NoveltySearchStatus.COMPLETED) { setSelectedStageTab('5'); return; }
  }, [hasStage15Results, searchState.status]);

  const runningStageKey = useMemo<StageTab | null>(() => {
    if (!activeExecutionStage) return null;
    if (activeExecutionStage === '1') return '2';
    if (activeExecutionStage === '1.5' || activeExecutionStage === '2') return '3';
    if (activeExecutionStage === '3' || activeExecutionStage.startsWith('3.5')) return '4';
    if (activeExecutionStage === '4' || activeExecutionStage === '5') return '5';
    return null;
  }, [activeExecutionStage]);

  const failedStageKey = useMemo<StageTab | null>(() => {
    if (searchState.status !== NoveltySearchStatus.FAILED) return null;
    switch (searchState.currentStage) {
      case NoveltySearchStage.STAGE_0: return '1';
      case NoveltySearchStage.STAGE_1: return hasStage1Results ? '3' : '2';
      case NoveltySearchStage.STAGE_3_5: return '4';
      case NoveltySearchStage.STAGE_4: return '5';
      default: return selectedStageTab;
    }
  }, [hasStage1Results, searchState.status, searchState.currentStage, selectedStageTab]);

  const isStageCompleted = useCallback((key: StageTab) => {
    switch (key) {
      case '1':
        return stage0Snapshot.hasQuery || stage0Snapshot.featuresCount > 0 || !!searchState.searchId;
      case '2':
        return hasStage2Results;
      case '3':
        return hasStage3Results;
      case '4':
        return hasStage35Results || searchState.status === NoveltySearchStatus.STAGE_3_5_COMPLETED;
      case '5':
        return hasStage4Results || searchState.status === NoveltySearchStatus.COMPLETED;
      default:
        return false;
    }
  }, [hasStage2Results, hasStage3Results, hasStage35Results, hasStage4Results, searchState.searchId, searchState.status, stage0Snapshot.featuresCount, stage0Snapshot.hasQuery]);

  const getStageStatus = useCallback((key: StageTab): 'completed' | 'in_progress' | 'pending' | 'failed' | 'blocked' => {
    if (runningStageKey === key || (searchState.isLoading && selectedStageTab === key)) return 'in_progress';
    if (failedStageKey === key) return 'failed';
    if (isStageCompleted(key)) return 'completed';
    const idx = STAGE_TABS.indexOf(key);
    const prevKey = idx > 0 ? STAGE_TABS[idx - 1] : null;
    if (prevKey && !isStageCompleted(prevKey)) return 'blocked';
    return 'pending';
  }, [failedStageKey, isStageCompleted, runningStageKey, searchState.isLoading, selectedStageTab]);

  const stageGuard = useCallback((key: StageTab): string | null => {
    if (key === '1') {
      if (searchState.searchId) return 'Idea setup already generated. Edit or proceed to Search Results.';
      if (!formData.title.trim() || !formData.inventionDescription.trim()) return 'Add title and invention description to start the search.';
      return null;
    }
    if (!searchState.searchId) return 'Start the novelty search from Idea Setup first.';
    if (key === '2') return null;
    if (key === '3') return hasStage2Results ? null : 'Run Patent Search before AI relevance analysis.';
    if (key === '4') return hasStage3Results ? null : 'Run AI relevance analysis before Deep Analysis.';
    if (key === '5') return hasStage35Results ? null : 'Run Deep Analysis before generating the report.';
    return null;
  }, [formData.inventionDescription, formData.title, hasStage2Results, hasStage3Results, hasStage35Results, searchState.searchId]);

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });

      if (response.ok) {
        const data = await response.json();
        const userProjects = data.projects || [];
        setProjects(userProjects);

        if (!initialProjectId && userProjects.length > 0) {
          const defaultProject = userProjects.find((p: Project) => p.name === 'Default Project');
          if (defaultProject) {
            setSelectedProjectId(defaultProject.id);
          } else {
            setSelectedProjectId(userProjects[0].id);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const allowedExtensions = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.xlsx', '.doc', '.docx', '.pdf'];
    const lowerName = file.name.toLowerCase();
    if (!allowedExtensions.some(ext => lowerName.endsWith(ext))) {
      setSearchState(prev => ({ ...prev, error: 'Unsupported file type. Upload .txt, .md, .csv, .tsv, .xlsx, .doc, .docx, or text-based .pdf files.' }));
      input.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setSearchState(prev => ({ ...prev, error: 'File size must be less than 5MB.' }));
      input.value = '';
      return;
    }

    setIsFileProcessing(true);
    setUploadedFileName(null);
    setSearchState(prev => ({ ...prev, error: null }));
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/patent-search/ingest-file', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: form
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to extract file text.');
      setFormData(prev => ({ ...prev, inventionDescription: data.textContent || prev.inventionDescription }));
      setUploadedFileName(data.fileName || file.name);
    } catch (error) {
      setSearchState(prev => ({ ...prev, error: error instanceof Error ? error.message : 'Failed to extract file text.' }));
    } finally {
      setIsFileProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startNoveltySearch = async () => {
    if (!formData.title.trim() || !formData.inventionDescription.trim()) {
      setSearchState(prev => ({ ...prev, error: 'Title and invention description are required' }));
      return;
    }

    const validProjectId = selectedProjectId && projects.find(p => p.id === selectedProjectId) ? selectedProjectId : null;
    const requestTitle = formData.title.trim();
    const requestDescription = formData.inventionDescription.trim();

    setSearchState({ ...searchState, isLoading: true, error: null });

    try {
      const authToken = localStorage.getItem('auth_token');
      const response = await fetch('/api/novelty-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          executionMode,
          patentId,
          projectId: validProjectId,
          ...formData,
          searchMode: 'intelligent',
          title: requestTitle,
          inventionDescription: requestDescription,
          config: {
            jurisdiction: formData.jurisdiction,
            searchSource: {
              mode: formData.searchSourceMode,
              searchMode: 'intelligent',
              llmExpansion: formData.llmExpansion,
              filters: {}
            },
            stage4: {
              reportFormat: 'JSON',
              includeExecutiveSummary: true,
              includeTechnicalDetails: true,
              colorCoding: true,
              modelPreference: 'gemini-2.5-flash-lite'
            }
          }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start novelty search');
      }

      const initialSearchState = {
        searchId: data.searchId,
        status: data.status,
        currentStage: data.currentStage,
        results: data.results,
      };

      setStageProgress(prev => ({ ...prev, stage0: 100 }));

      const nextSearchState = {
        ...searchState,
        ...initialSearchState,
        isLoading: false
      };
      latestSearchStateRef.current = nextSearchState;
      autoStageStateRef.current = buildNoveltyAutoStageState(nextSearchState, stage0ApprovedRef.current);
      setSearchState(prev => ({
        ...prev,
        ...initialSearchState,
        isLoading: false
      }));

    } catch (error) {
      setSearchState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to start search',
        isLoading: false
      }));
    }
  };

  const runManualPatentSearch = async () => {
    if (!manualSearchHasCriteria) {
      setManualSearchState(prev => ({
        ...prev,
        error: 'Enter at least one patent field before searching.',
        hasSearched: false,
      }));
      return;
    }

    setManualSearchState(prev => ({
      ...prev,
      isLoading: true,
      error: null,
      hasSearched: true,
    }));

    try {
      const authToken = localStorage.getItem('auth_token');
      const response = await fetch('/api/patent-search/advanced', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          searchMode: 'manual',
          query: '',
          title: '',
          inventionText: '',
          filters: manualSearchFilters,
          sourceMode: formData.searchSourceMode,
          jurisdictions: [formData.jurisdiction],
          llmExpansion: false,
          limit: 60,
          sort: 'relevance',
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Manual patent search failed.');
      }

      setManualSearchState({
        isLoading: false,
        error: null,
        hasSearched: true,
        results: Array.isArray(data.results) ? data.results : [],
        providerStats: Array.isArray(data.providerStats) ? data.providerStats : [],
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        queryPlan: data.queryPlan || null,
      });
    } catch (error) {
      setManualSearchState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Manual patent search failed.',
      }));
    }
  };

  const executeStage = async (stageNumber: string, body?: Record<string, any>) => {
    setActiveExecutionStage(stageNumber);
    const searchId = latestSearchStateRef.current?.searchId || searchState.searchId;
    if (!searchId) {
      setActiveExecutionStage(null);
      return false;
    }

    setSearchState(prev => ({ ...prev, isLoading: true, error: null }));

    if (stageNumber === '1') {
      setIsStage1Simulating(true);
      const searchMessages = [
        'Searching selected patent sources...',
        'Retrieving provider-ranked records...',
        'Merging duplicate publications...',
        'Preparing raw search results...'
      ];
      for (let i = 0; i < searchMessages.length; i++) {
        setStage1Message(searchMessages[i]);
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
      setStage1Message('Finalizing search results...');
    } else if (stageNumber === '1.5' || stageNumber === '2') {
      setIsStage1Simulating(true);
      const relevanceMessages = [
        'Reviewing top provider-ranked candidates...',
        'Comparing candidates against the invention features...',
        'Separating direct, component, borderline, and rejected patents...',
        'Preparing relevance analysis...'
      ];
      for (let i = 0; i < relevanceMessages.length; i++) {
        setStage1Message(relevanceMessages[i]);
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
      setStage1Message('Finalizing relevance analysis...');
    } else if (stageNumber === '3' || stageNumber === '3.5') {
      setIsStage35Simulating(true);
      setStage35Message(stageNumber === '3' ? 'Mapping features and generating patent remarks...' : stage35Messages[0]);
    } else if (stageNumber === '3.5a') {
      setIsStage35aSimulating(true);
      const root: any = searchState.results || {};
      const aiRel = root?.aiRelevance || root?.stage1?.aiRelevance || {};
      const acceptedCount = Array.isArray(aiRel.accepted) ? aiRel.accepted.length : 0;
      const componentCount = Array.isArray(aiRel.component) ? aiRel.component.length : 0;
      const borderlineCount = Array.isArray(aiRel.borderline) ? aiRel.borderline.length : 0;
      const stage35aMessages = [
        acceptedCount === 0 && (componentCount > 0 || borderlineCount > 0)
          ? 'No direct high-confidence matches; selecting component/borderline references...'
          : 'Selecting top patents by relevance...',
        'Applying patent selection limits...',
        'Canonicalizing patents for feature mapping...',
        'Mapping invention features to patent evidence...',
        'Computing coverage and extracting references...'
      ];
      setStage35aMessage(stage35aMessages[0]);
      for (let i = 1; i < stage35aMessages.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        setStage35aMessage(stage35aMessages[i]);
      }
    } else if (stageNumber === '3.5b') {
      setIsStage35Simulating(true);
      setStage35Message('Aggregating coverage and computing novelty metrics...');
    } else if (stageNumber === '3.5c') {
      setIsStage35Simulating(true);
      setStage35Message('Generating patent-by-patent remarks...');
    }

    const stageKey = (stageNumber === '3' || stageNumber === '3.5' || stageNumber === '3.5a' || stageNumber === '3.5b' || stageNumber === '3.5c')
      ? 'stage3_5'
      : (stageNumber === '2' || stageNumber === '1' || stageNumber === '1.5')
        ? 'stage1'
        : `stage${stageNumber}`;
    const shouldPollLiveProgress = stageNumber === '1.5' || stageNumber === '2' || stageNumber === '3' || stageNumber === '3.5' || stageNumber === '3.5a';
    let progressPollTimer: number | null = null;

    const applyLiveProgress = (results: any) => {
      const progress = getLiveStageProgress(results, stageNumber);
      if (!progress) return;
      const percent = typeof progress.percent === 'number' ? progress.percent : undefined;
      if (typeof percent === 'number') {
        setStageProgress(prev => ({ ...prev, [stageKey]: Math.max(0, Math.min(99, percent)) }));
      }
      const message = formatLiveProgressMessage(progress, '');
      if (!message) return;
      if (stageNumber === '1.5' || stageNumber === '2') {
        setStage1Message(message);
      } else {
        setStage35Message(message);
        setStage35aMessage(message);
      }
    };

    const pollLiveProgress = async () => {
      try {
        const response = await fetch(`/api/novelty-search/${searchId}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
          cache: 'no-store'
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.search) return;
        const nextSearchState = {
          ...(latestSearchStateRef.current || searchState),
          status: body.search.status,
          currentStage: body.search.currentStage,
          results: body.search.results,
          isLoading: true,
          error: null
        };
        latestSearchStateRef.current = nextSearchState;
        autoStageStateRef.current = buildNoveltyAutoStageState(nextSearchState, stage0ApprovedRef.current);
        setSearchState(prev => ({
          ...prev,
          ...nextSearchState
        }));
        applyLiveProgress(body.search.results);
      } catch {
        // Progress polling is best-effort; the stage POST remains the source of truth.
      }
    };

    if (shouldPollLiveProgress) {
      progressPollTimer = window.setInterval(pollLiveProgress, 2500);
      window.setTimeout(pollLiveProgress, 800);
    }

    try {
      let fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      };

      const response = await fetch(`/api/novelty-search/${searchId}/stage/${stageNumber}`, fetchOptions);

      const rawBody = await response.text();
      let data: any = null;
      try {
        data = rawBody ? JSON.parse(rawBody) : null;
      } catch (parseError) {
        console.warn(`[Execution] Non-JSON response for stage ${stageNumber}:`, rawBody?.slice(0, 500));
      }

      if (!response.ok || !data) {
        const timeoutHint = response.status === 504
          ? 'Stage timed out before the server could respond. Please retry in a moment.'
          : undefined;
        const baseError = data?.error || data?.message || timeoutHint || `Failed to execute stage ${stageNumber}`;
        throw new Error(`${baseError}${response.status ? ` (status ${response.status})` : ''}`);
      }

      if (stageNumber === '1') {
        const items = Array.isArray(data?.results?.retrievalCandidates)
          ? data.results.retrievalCandidates
          : (Array.isArray(data?.results?.stage1?.retrievalCandidates) ? data.results.stage1.retrievalCandidates : []);
        setStage1Message(`Search complete. Retrieved ${items.length} candidate patent${items.length !== 1 ? 's' : ''}.`);
        await new Promise(resolve => setTimeout(resolve, 1800));
      } else if (stageNumber === '1.5' || stageNumber === '2') {
        const aiRel = data?.results?.aiRelevance || data?.results?.stage1?.aiRelevance || {};
        const acc = Array.isArray(aiRel.accepted) ? aiRel.accepted.length : 0;
        const cmp = Array.isArray(aiRel.component) ? aiRel.component.length : 0;
        const bor = Array.isArray(aiRel.borderline) ? aiRel.borderline.length : 0;
        const rej = Array.isArray(aiRel.rejected) ? aiRel.rejected.length : 0;
        setStage1Message(`Relevance analysis complete. Direct ${acc}, component ${cmp}, borderline ${bor}, rejected ${rej}.`);
        await new Promise(resolve => setTimeout(resolve, 2500));
      }

      setStageProgress(prev => ({ ...prev, [stageKey]: 100 }));

      // Refresh full aggregated results
      let effectiveStatus = data.status;
      let effectiveCurrentStage = data.currentStage;
      let effectiveResults = data.results;

      try {
        const fullRes = await fetch(`/api/novelty-search/${searchId}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
          cache: 'no-store'
        });
        const fullRaw = await fullRes.text();
        let fullJson: any = null;
        try {
          fullJson = fullRaw ? JSON.parse(fullRaw) : null;
        } catch {
          console.warn('[Execution] Non-JSON response while refreshing:', fullRaw?.slice(0, 500));
        }
        if (fullRes.ok && fullJson?.success !== false && fullJson?.search) {
          effectiveStatus = fullJson.search.status;
          effectiveCurrentStage = fullJson.search.currentStage;
          effectiveResults = fullJson.search.results;
        }
      } catch {}

      const nextSearchState = {
        ...(latestSearchStateRef.current || searchState),
        status: effectiveStatus,
        currentStage: effectiveCurrentStage,
        results: effectiveResults,
        isLoading: false
      };
      latestSearchStateRef.current = nextSearchState;
      autoStageStateRef.current = buildNoveltyAutoStageState(nextSearchState, stage0ApprovedRef.current);
      setSearchState(prev => ({
        ...prev,
        ...nextSearchState
      }));

      if (effectiveStatus === NoveltySearchStatus.COMPLETED && onComplete) {
        onComplete(data.searchId);
      }

      return true;
    } catch (error) {
      console.error(`[Execution] Error executing stage ${stageNumber}:`, error);
      const nextSearchState = {
        ...(latestSearchStateRef.current || searchState),
        error: error instanceof Error ? error.message : `Failed to execute stage ${stageNumber}`,
        isLoading: false
      };
      latestSearchStateRef.current = nextSearchState;
      setSearchState(prev => ({
        ...prev,
        ...nextSearchState
      }));
      return false;
    } finally {
      if (progressPollTimer !== null) {
        window.clearInterval(progressPollTimer);
      }
      if (stageNumber === '1' || stageNumber === '1.5' || stageNumber === '2') {
        setIsStage1Simulating(false);
      } else if (stageNumber === '3' || stageNumber === '3.5' || stageNumber === '3.5b' || stageNumber === '3.5c') {
        setIsStage35Simulating(false);
      } else if (stageNumber === '3.5a') {
        setIsStage35aSimulating(false);
      }
      setActiveExecutionStage(null);
    }
  };

  // Run all remaining stages automatically (for auto mode after approval)
  const runAllRemainingStages = useCallback(async () => {
    const searchId = latestSearchStateRef.current?.searchId || searchState.searchId;
    if (!searchId || isAutoRunningRef.current) return;

    isAutoRunningRef.current = true;
    setIsAutoRunning(true);
    latestSearchStateRef.current = {
      ...(latestSearchStateRef.current || searchState),
      error: null
    };
    setSearchState(prev => ({ ...prev, error: null }));

    try {
      for (let index = 0; index < 6; index += 1) {
        const snapshot = autoStageStateRef.current || buildNoveltyAutoStageState(
          latestSearchStateRef.current || searchState,
          stage0ApprovedRef.current
        );
        const action = getNextNoveltyAutoStage(snapshot);
        if (action.type === 'stop') {
          if (action.reason === 'NO_PATENTS') {
            latestSearchStateRef.current = {
              ...(latestSearchStateRef.current || searchState),
              error: NOVELTY_AUTO_STOP_MESSAGES.NO_PATENTS
            };
            setSearchState(prev => ({
              ...prev,
              error: NOVELTY_AUTO_STOP_MESSAGES.NO_PATENTS
            }));
          }
          break;
        }

        try {
          console.log(`[Auto] Running stage ${action.stageNumber}...`);
          setSelectedStageTab(action.visibleTab);
          const ok = await executeStage(action.stageNumber);
          if (!ok) break;
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          console.error(`[Auto] Stage ${action.stageNumber} failed:`, err);
          break;
        }
      }
    } finally {
      isAutoRunningRef.current = false;
      setIsAutoRunning(false);
    }
  }, [executeStage, searchState]);

  const runStageForKey = useCallback(async (stageKey: StageTab, advance?: boolean) => {
    if (isAutoRunningRef.current) return;

    const guardMsg = stageGuard(stageKey);
    if (guardMsg) {
      setSearchState(prev => ({ ...prev, error: guardMsg }));
      setSelectedStageTab(stageKey);
      return;
    }

    if (stageKey === '1') {
      await startNoveltySearch();
      if (advance) setSelectedStageTab('2');
      return;
    }

    const stageNumber = stageNumberByKey[stageKey];
    if (!stageNumber) return;

    setSelectedStageTab(stageKey);
    setActiveExecutionStage(stageNumber);
    try {
      await executeStage(stageNumber);
      if (advance) {
        const idx = STAGE_TABS.indexOf(stageKey);
        const next = idx >= 0 && idx < STAGE_TABS.length - 1 ? STAGE_TABS[idx + 1] : null;
        if (next) setSelectedStageTab(next);
      }
    } finally {
      setActiveExecutionStage(null);
    }
  }, [stageGuard, stageNumberByKey]);

  const handlePrevNav = useCallback(() => {
    const idx = STAGE_TABS.indexOf(selectedStageTab);
    if (idx <= 0) return;
    setSelectedStageTab(STAGE_TABS[idx - 1]);
  }, [selectedStageTab]);

  const handleNextNav = useCallback(() => {
    const idx = STAGE_TABS.indexOf(selectedStageTab);
    if (idx < 0 || idx >= STAGE_TABS.length - 1) return;
    const next = STAGE_TABS[idx + 1];
    const guardMsg = stageGuard(next);
    if (guardMsg) {
      setSearchState(prev => ({ ...prev, error: guardMsg }));
      return;
    }
    setSelectedStageTab(next);
  }, [selectedStageTab, stageGuard]);

  const handleRunCurrent = useCallback(async () => {
    await runStageForKey(selectedStageTab);
  }, [runStageForKey, selectedStageTab]);

  const handleReviewMoreCandidates = async () => {
    await executeStage('1.5', { appendNextBatch: true });
  };

  // Stage 0 editing functions
  const startEditingStage0 = () => {
    const s0 = (searchState.results?.stage0) || (searchState.results as any) || {};
    if (s0) {
      setEditedSearchQuery(s0.searchQuery || '');
      setEditedFeatures([...(s0.inventionFeatures || [])]);
      setIsEditingStage0(true);
    }
  };

  const saveStage0Edits = async () => {
    if (!searchState.searchId) return;

    try {
      const response = await fetch(`/api/novelty-search/${searchState.searchId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          stage: 'stage0',
          searchQuery: editedSearchQuery,
          inventionFeatures: editedFeatures
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to save Stage 0 edits: ${response.status} ${errorText}`);
      }

      const currentState = latestSearchStateRef.current || searchState;
      const currentResults = currentState.results || {};
      const approvedStage0 = {
        ...(currentResults?.stage0 || currentResults),
        searchQuery: editedSearchQuery,
        inventionFeatures: editedFeatures
      };
      const nextResults = {
        stage0: approvedStage0,
        searchQuery: editedSearchQuery,
        inventionFeatures: editedFeatures
      };
      const nextState = {
        ...currentState,
        status: NoveltySearchStatus.STAGE_0_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_1,
        results: nextResults,
      };
      latestSearchStateRef.current = nextState;
      autoStageStateRef.current = buildNoveltyAutoStageState(nextState, true);
      setSearchState(prev => ({
        ...prev,
        status: NoveltySearchStatus.STAGE_0_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_1,
        results: nextResults,
      }));
      setCompletedStages(['stage0']);
      setStageProgress({ stage0: 100, stage1: 0, stage3_5: 0, stage4: 0 });

      markStage0Approved();
      setIsEditingStage0(false);
    } catch (error) {
      console.error('Save Stage 0 edits error:', error);
      setSearchState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to save edits'
      }));
    }
  };

  const cancelStage0Edits = () => {
    setIsEditingStage0(false);
    setEditingFeatureIndex(null);
    setNewFeatureText('');
  };

  const addFeature = () => {
    if (newFeatureText.trim()) {
      setEditedFeatures([...editedFeatures, newFeatureText.trim()]);
      setNewFeatureText('');
    }
  };

  const removeFeature = (index: number) => {
    setEditedFeatures(editedFeatures.filter((_, i) => i !== index));
  };

  const startEditingFeature = (index: number) => {
    setEditingFeatureIndex(index);
  };

  // Compute navigation state
  const currentStageInfo = getCurrentStageInfo();
  const idx = STAGE_TABS.indexOf(selectedStageTab);
  const prevStage = idx > 0 ? STAGE_TABS[idx - 1] : null;
  const nextStage = idx >= 0 && idx < STAGE_TABS.length - 1 ? STAGE_TABS[idx + 1] : null;
  const currentGuard = stageGuard(selectedStageTab);
  const canRunCurrent = (!currentGuard) && !searchState.isLoading && !activeExecutionStage && !isAutoRunning && (selectedStageTab === '1' || !!stageNumberByKey[selectedStageTab]);
  const isFailedCurrent = failedStageKey === selectedStageTab;

  // Calculate overall progress
  const overallProgress = useMemo(() => {
    const completedCount = STAGE_TABS.filter(key => isStageCompleted(key)).length;
    return Math.round((completedCount / STAGE_TABS.length) * 100);
  }, [isStageCompleted]);

  const renderSearchPathTabs = () => (
    <div className="mb-5 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
      <div className="grid gap-1 sm:grid-cols-2" role="tablist" aria-label="Novelty search paths">
        <button
          type="button"
          role="tab"
          aria-selected={activeSearchPath === 'manual'}
          onClick={() => {
            setActiveSearchPath('manual');
            setFormData(prev => ({ ...prev, searchMode: 'manual' }));
          }}
          className={`flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
            activeSearchPath === 'manual'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Manual Search
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSearchPath === 'intelligent'}
          onClick={() => {
            setActiveSearchPath('intelligent');
            setFormData(prev => ({ ...prev, searchMode: 'intelligent' }));
          }}
          className={`flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
            activeSearchPath === 'intelligent'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <Search className="h-4 w-4" />
          Intelligent Novelty Search
        </button>
      </div>
    </div>
  );

  const renderManualInput = (
    field: keyof ManualPatentSearchFields,
    label: string,
    placeholder: string,
    multiline = false
  ) => (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-slate-600">{label}</Label>
      {multiline ? (
        <AutoResizeTextarea
          value={manualSearchFields[field]}
          onChange={(event) => updateManualSearchField(field, event.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <Input
          value={manualSearchFields[field]}
          onChange={(event) => updateManualSearchField(field, event.target.value)}
          placeholder={placeholder}
          className="h-[38px] rounded-lg border-slate-200 bg-white text-sm focus:border-indigo-500 focus:ring-indigo-500/20"
        />
      )}
    </div>
  );

  const renderManualResults = () => {
    const results = manualSearchState.results;
    const plan = manualSearchState.queryPlan || {};
    const requestedProviders = manualSearchState.providerStats.filter((stat: any) => stat.requested);
    const totalProviderResults = requestedProviders.reduce((sum: number, stat: any) => sum + Number(stat.resultCount || 0), 0);

    if (manualSearchState.isLoading) {
      return (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="flex items-center gap-3 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
            <div>
              <div className="text-sm font-medium text-slate-900">Searching patent records</div>
              <div className="text-xs text-slate-500">Manual mode uses exact filters and disables LLM expansion.</div>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (manualSearchState.error) {
      return (
        <Alert variant="destructive" className="rounded-lg">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{displayInternationalPatentText(manualSearchState.error)}</AlertDescription>
        </Alert>
      );
    }

    if (!manualSearchState.hasSearched) return null;

    return (
      <div className="space-y-4">
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg font-semibold text-slate-900">Manual Search Results</CardTitle>
                <CardDescription>
                  {results.length} merged result{results.length !== 1 ? 's' : ''} from {requestedProviders.length || manualSearchState.providerStats.length || 0} provider{(requestedProviders.length || manualSearchState.providerStats.length) !== 1 ? 's' : ''}.
                </CardDescription>
              </div>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                LLM expansion off
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs font-medium uppercase text-slate-500">Returned</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{results.length}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs font-medium uppercase text-slate-500">Provider hits</div>
                <div className="mt-1 text-2xl font-semibold text-indigo-600">{totalProviderResults}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs font-medium uppercase text-slate-500">Matched fields</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-600">
                  {new Set(results.flatMap((result: any) => result.matchedFields || [])).size}
                </div>
              </div>
            </div>

            {manualSearchState.providerStats.length > 0 && (
              <div className="grid gap-2 md:grid-cols-2">
                {manualSearchState.providerStats.map((stat: any) => (
                  <div key={stat.providerId || stat.label} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium text-slate-800">{displayPatentProviderLabel(stat.label || stat.providerId)}</div>
                      {stat.error && <div className="text-xs text-rose-600">{displayInternationalPatentText(stat.error)}</div>}
                    </div>
                    <Badge variant="outline" className={stat.requested ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500'}>
                      {stat.resultCount || 0} results
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {(plan.searchQuery || plan.fieldFilters) && (
              <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">Query plan and filters</summary>
                <div className="mt-3 grid gap-3 text-xs text-slate-600 md:grid-cols-2">
                  <div>
                    <div className="font-medium text-slate-800">Search query</div>
                    <div className="mt-1 rounded-md bg-white p-2">{plan.searchQuery || 'Field-only search'}</div>
                  </div>
                  <div>
                    <div className="font-medium text-slate-800">Field filters</div>
                    <pre className="mt-1 max-h-36 overflow-auto rounded-md bg-white p-2 text-[11px]">{JSON.stringify(plan.fieldFilters || manualSearchFilters, null, 2)}</pre>
                  </div>
                </div>
              </details>
            )}

            {manualSearchState.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-sm font-medium text-amber-900">Search warnings</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">
                  {manualSearchState.warnings.map((warning, index) => <li key={index}>{displayInternationalPatentText(warning)}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {results.length === 0 ? (
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardContent className="py-10 text-center">
              <Search className="mx-auto mb-3 h-9 w-9 text-slate-300" />
              <div className="text-sm font-medium text-slate-800">No matching patent records</div>
              <p className="mt-1 text-sm text-slate-500">Broaden a field, remove date limits, or switch sources.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {results.map((result: any, index: number) => {
              const patentNumber = result.publicationNumber || result.pn || result.publication_number || result.patent_number || 'Unknown';
              const title = result.title || result.invention_title || patentNumber;
              const abstract = result.abstract || result.snippet || '';
              const relevanceScore = typeof result.relevanceScore === 'number'
                ? result.relevanceScore
                : (typeof result.score === 'number' ? result.score : 0);
              const matchedFields = Array.isArray(result.matchedFields) ? result.matchedFields : [];
              const matchReasons = Array.isArray(result.matchReasons) ? result.matchReasons : [];
              const sourceProviders = Array.isArray(result.sourceProviders)
                ? result.sourceProviders
                : [result.sourceProvider || result.providerId].filter(Boolean);
              const applicants = listPatentText(result.applicants, 4);
              const classifications = Array.isArray(result.classifications) ? result.classifications.join(', ') : '';
              const href = result.link || result.sourceUrl || `https://patents.google.com/patent/${encodeURIComponent(patentNumber)}`;

              return (
                <Card key={`${patentNumber}-${index}`} className="border border-slate-200 bg-white shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline">
                            {patentNumber}
                          </a>
                          {sourceProviders.map((provider: string) => (
                            <Badge key={provider} variant="outline" className="border-slate-200 bg-slate-50 text-[11px] text-slate-600">
                              {displayPatentProviderLabel(provider)}
                            </Badge>
                          ))}
                        </div>
                        <h3 className="mt-1 line-clamp-2 text-sm font-medium text-slate-900">{title}</h3>
                      </div>
                      <Badge variant="outline" className="w-fit border-indigo-200 bg-indigo-50 text-indigo-700">
                        {Math.round(relevanceScore * 100)}% match
                      </Badge>
                    </div>

                    {abstract && <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{abstract}</p>}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {matchedFields.slice(0, 6).map((field: string) => (
                        <Badge key={field} variant="outline" className="border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700">
                          {field}
                        </Badge>
                      ))}
                      {matchReasons.slice(0, 2).map((reason: string, reasonIndex: number) => (
                        <Badge key={`${reason}-${reasonIndex}`} variant="outline" className="border-slate-200 bg-white text-[11px] text-slate-600">
                          {displayInternationalPatentText(reason)}
                        </Badge>
                      ))}
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
                      {applicants && <div><span className="font-medium text-slate-700">Applicant:</span> {applicants}</div>}
                      {result.publicationDate && <div><span className="font-medium text-slate-700">Published:</span> {String(result.publicationDate).slice(0, 10)}</div>}
                      {classifications && <div><span className="font-medium text-slate-700">IPC/CPC:</span> {classifications}</div>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderManualSearch = () => (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-xl font-semibold text-slate-900">Manual Patent Search</CardTitle>
              <CardDescription className="mt-1 text-slate-500">
                Deterministic fielded lookup. It does not create a novelty run and does not use LLM.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => {
                setManualSearchFields(defaultManualPatentSearchFields);
                setManualSearchState({
                  isLoading: false,
                  error: null,
                  hasSearched: false,
                  results: [],
                  providerStats: [],
                  warnings: [],
                  queryPlan: null,
                });
              }}
            >
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="manualJurisdiction" className="text-xs font-medium text-slate-600">Jurisdiction</Label>
              <select
                id="manualJurisdiction"
                value={formData.jurisdiction}
                onChange={(event) => {
                  const jurisdiction = event.target.value;
                  setFormData(prev => ({
                    ...prev,
                    jurisdiction,
                    searchSourceMode: jurisdiction === 'IN' ? 'INDIAN_ONLY' : 'PQAI_ONLY'
                  }));
                }}
                className="h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="IN">India (IN)</option>
                <option value="US">United States (US)</option>
                <option value="EP">European Patent (EP)</option>
                <option value="WO">PCT (WO)</option>
                <option value="AU">Australia (AU)</option>
                <option value="*">Global / International patents</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="manualSource" className="text-xs font-medium text-slate-600">Search source</Label>
              <select
                id="manualSource"
                value={formData.searchSourceMode}
                onChange={(event) => setFormData(prev => ({ ...prev, searchSourceMode: event.target.value as NoveltySearchSourceMode }))}
                className="h-[38px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="INDIAN_ONLY">Indian database only</option>
                <option value="PQAI_ONLY">International patents only</option>
                <option value="PQAI_PLUS_INDIAN">International patents + Indian database</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {renderManualInput('anyText', 'Any text', 'Keywords across patent fields', true)}
            {renderManualInput('title', 'Patent title', 'Title keywords', true)}
            {renderManualInput('abstract', 'Abstract', 'Abstract keywords', true)}
            {renderManualInput('publicationNumber', 'Publication no.', 'IN2024...', false)}
            {renderManualInput('applicant', 'Applicant', 'Company or assignee', false)}
            {renderManualInput('classifications', 'IPC/CPC', 'A61B, G06F...', false)}
          </div>

          {manualActiveChips.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {manualActiveChips.map(chip => (
                <button
                  key={chip.field}
                  type="button"
                  onClick={() => updateManualSearchField(chip.field, '')}
                  className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  <span>{chip.label}: {chip.value}</span>
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowMoreManualFilters(prev => !prev)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {showMoreManualFilters ? 'Hide advanced filters' : 'Advanced filters'}
            </button>
          </div>

          {showMoreManualFilters && (
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-3">
              {renderManualInput('inventor', 'Inventor', 'Inventor name', false)}
              {renderManualInput('applicationNumber', 'Application no.', 'Application number', false)}
              {renderManualInput('sourcePdfName', 'Source PDF', 'PDF filename', false)}
              {renderManualInput('patentText', 'Patent text', 'Claims/specification text', true)}
              {renderManualInput('excludeTerms', 'Exclude terms', 'Comma-separated terms', true)}
              <div className="grid grid-cols-2 gap-2">
                {renderManualInput('filingFrom', 'Filing from', '', false)}
                {renderManualInput('filingTo', 'Filing to', '', false)}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {renderManualInput('publicationFrom', 'Published from', '', false)}
                {renderManualInput('publicationTo', 'Published to', '', false)}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {renderManualInput('numberOfClaimsMin', 'Claims min', '0', false)}
                {renderManualInput('numberOfClaimsMax', 'Claims max', '100', false)}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {renderManualInput('numberOfPagesMin', 'Pages min', '0', false)}
                {renderManualInput('numberOfPagesMax', 'Pages max', '500', false)}
              </div>
            </div>
          )}

          <Button
            type="button"
            onClick={runManualPatentSearch}
            disabled={manualSearchState.isLoading || !manualSearchHasCriteria}
            className="h-11 w-full rounded-lg bg-indigo-600 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {manualSearchState.isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching patents...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Search Patents
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {renderManualResults()}
    </motion.div>
  );

  // ============================================================================
  // RENDER FORM (Initial State)
  // ============================================================================
  const renderForm = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200 pb-5">
          <div>
            <CardTitle className="text-xl font-semibold text-slate-900">
              New Intelligent Novelty Search
            </CardTitle>
            <CardDescription className="mt-1 text-slate-500">
              Provide a disclosure so the system can generate a query plan, find prior art, map features, and build a novelty report.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Idea Bank Banner */}
          {ideaId && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="rounded-lg border border-indigo-200 bg-indigo-50 p-4"
            >
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-indigo-600" />
                <div>
                  <p className="text-sm font-medium text-indigo-900">Loaded from Idea Bank</p>
                  <p className="text-xs text-indigo-700">The title and description have been pre-filled from your reserved idea.</p>
                </div>
              </div>
            </motion.div>
          )}

          <div className="max-w-xl">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Project</Label>
              <div className="flex min-h-[72px] items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-slate-200">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-900">{selectedProject?.name || 'Loading...'}</div>
                  <div className="text-xs text-slate-500">
                    {selectedProject?.name === 'Default Project' ? 'Quick drafts and searches' : 'Selected project'}
                  </div>
                </div>
                {selectedProject?.name === 'Default Project' && (
                  <Badge variant="secondary" className="border-indigo-200 bg-indigo-50 text-xs font-medium text-indigo-700">Default</Badge>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-5 border-t border-slate-200 pt-6">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Invention Disclosure</h3>
                <p className="mt-1 text-sm text-slate-500">Used to extract search terms and novelty features.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title" className="text-sm font-medium text-slate-700">Invention Title</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Enter a clear, concise title for your invention"
                  className="h-11 rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description" className="text-sm font-medium text-slate-700">Invention Description</Label>
                <Textarea
                  id="description"
                  value={formData.inventionDescription}
                  onChange={(e) => setFormData(prev => ({ ...prev, inventionDescription: e.target.value }))}
                  placeholder="Describe the problem, core mechanism, operating steps, and key technical features."
                  rows={8}
                  className="rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-slate-700">Disclosure File</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.markdown,.csv,.tsv,.xlsx,.doc,.docx,.pdf"
                  onChange={handleFileUpload}
                  disabled={isFileProcessing}
                  className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 disabled:opacity-50"
                />
                <p className="text-xs text-slate-500">Text-based PDF, DOC/DOCX, spreadsheet, CSV, Markdown, or TXT. Upload replaces the description text.</p>
                {isFileProcessing && <p className="text-xs text-indigo-600">Extracting readable text...</p>}
                {uploadedFileName && <p className="text-xs text-emerald-600">Extracted text from {uploadedFileName}.</p>}
              </div>
            </div>

          <div className="space-y-5 border-t border-slate-200 pt-6">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Search Configuration</h3>
              <p className="mt-1 text-sm text-slate-500">Control the corpus and query expansion behavior.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="jurisdiction" className="text-sm font-medium text-slate-700">Jurisdiction</Label>
                <select
                  id="jurisdiction"
                  value={formData.jurisdiction}
                  onChange={(e) => {
                    const jurisdiction = e.target.value;
                    setFormData(prev => ({
                      ...prev,
                      jurisdiction,
                      searchSourceMode: jurisdiction === 'IN' ? 'INDIAN_ONLY' : 'PQAI_ONLY'
                    }));
                  }}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="IN">India (IN)</option>
                  <option value="US">United States (US)</option>
                  <option value="EP">European Patent (EP)</option>
                  <option value="WO">PCT (WO)</option>
                  <option value="AU">Australia (AU)</option>
                  <option value="*">Global / International patents</option>
                </select>
              </div>

            <div className="space-y-2">
              <Label htmlFor="searchSource" className="text-sm font-medium text-slate-700">Search Source</Label>
              <select
                id="searchSource"
                value={formData.searchSourceMode}
                onChange={(e) => setFormData(prev => ({ ...prev, searchSourceMode: e.target.value as NoveltySearchSourceMode }))}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="INDIAN_ONLY">Indian database only</option>
                <option value="PQAI_ONLY">International patents only</option>
                <option value="PQAI_PLUS_INDIAN">International patents + Indian database</option>
              </select>
            </div>
            <label className="flex h-11 items-center justify-between self-end rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
              <span>LLM query extraction</span>
              <input
                type="checkbox"
                checked={formData.llmExpansion}
                onChange={(e) => setFormData(prev => ({ ...prev, llmExpansion: e.target.checked }))}
                className="h-4 w-4"
              />
            </label>
            </div>
          </div>

          {/* Error Display */}
          <AnimatePresence>
            {searchState.error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Alert variant="destructive" className="rounded-lg">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{displayInternationalPatentText(searchState.error)}</AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Start Button */}
          <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
            <Button
              onClick={startNoveltySearch}
              disabled={searchState.isLoading}
              className="h-12 w-full rounded-lg bg-indigo-600 text-base font-medium text-white shadow-sm hover:bg-indigo-700"
            >
              {searchState.isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Starting novelty search...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-5 w-5" />
                  Start Novelty Search
                  <ArrowRight className="ml-2 h-5 w-5" />
                </>
              )}
            </Button>
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );

  // ============================================================================
  // RENDER PROGRESS (Active State)
  // ============================================================================
  const renderProgress = () => {
    const liveProgress = getLiveStageProgress(searchState.results, activeExecutionStage);
    const fallbackMessage = stage1Message || stage35Message || stage35aMessage;
    const progressMessage = formatLiveProgressMessage(liveProgress, fallbackMessage);
    const hasLiveProgress = typeof liveProgress?.percent === 'number';
    const progressWidth = Math.max(6, Math.min(100, Number(liveProgress?.percent ?? 35)));

    return (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Status Card */}
          <Card className="overflow-hidden border border-slate-200 bg-white shadow-sm">
            <div className="h-1 bg-indigo-500" />
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    searchState.status === NoveltySearchStatus.COMPLETED
                      ? 'bg-emerald-500'
                      : searchState.status === NoveltySearchStatus.FAILED
                      ? 'bg-rose-500'
                      : 'bg-indigo-600'
                  }`}>
                    {searchState.status === NoveltySearchStatus.COMPLETED ? (
                      <CheckCircle className="h-5 w-5 text-white" />
                    ) : searchState.status === NoveltySearchStatus.FAILED ? (
                      <XCircle className="h-5 w-5 text-white" />
                    ) : searchState.isLoading ? (
                      <Loader2 className="h-5 w-5 text-white animate-spin" />
                    ) : (
                      <Search className="h-5 w-5 text-white" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{STAGE_TAB_LABELS[selectedStageTab]}</div>
                    <div className="text-xs text-slate-500">Search ID: {searchState.searchId?.slice(0, 12)}...</div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {stage0ApprovedForUi && (selectedStageTab !== '1' || hasStage1Results || isAutoRunning) && (
                    <Badge variant="outline" className="text-xs border-slate-200 bg-white text-slate-600">
                      {isAutoRunning ? 'Auto running' : autoMode ? 'Auto mode' : 'Manual mode'}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      searchState.status === NoveltySearchStatus.COMPLETED
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : searchState.status === NoveltySearchStatus.FAILED
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    }`}
                  >
                    {currentStageInfo.progress}% Complete
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Processing Messages */}
          <AnimatePresence>
            {(isStage1Simulating || isStage35Simulating || isStage35aSimulating) && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <Card className="overflow-hidden border border-slate-200 bg-white shadow-sm">
                  <div className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-slate-900 mb-1">
                          {activeExecutionStage === '1' ? 'Patent Search' :
                           activeExecutionStage === '1.5' || activeExecutionStage === '2' ? 'LLM Relevance Analysis' :
                           isStage35aSimulating ? 'Feature Mapping' : 'Deep Analysis'}
                        </div>
                        <div className="text-sm text-slate-700">
                          {progressMessage}
                        </div>
                        <div className="mt-3 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full bg-indigo-500"
                            initial={{ width: hasLiveProgress ? '6%' : '0%' }}
                            animate={{ width: hasLiveProgress ? `${progressWidth}%` : '100%' }}
                            transition={hasLiveProgress ? { duration: 0.35, ease: 'easeOut' } : { duration: 10, ease: 'linear' }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Display */}
          <AnimatePresence>
            {searchState.error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Alert variant="destructive" className="rounded-lg border-rose-200 bg-rose-50">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{displayInternationalPatentText(searchState.error)}</AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
    );
  };

  // ============================================================================
  // RENDER STAGE CONTENT
  // ============================================================================
  const renderStageContent = () => {
    switch (selectedStageTab) {
      case '1':
        return renderStage0Content();
      case '2':
        return renderStage2Content();
      case '3':
        return renderStage15Content();
      case '4':
        return renderStage3Content();
      case '5':
        return renderStage4Content();
      default:
        return null;
    }
  };

  // Stage 0 Content
  const renderStage0Content = () => {
    const s0 = (searchState.results as any)?.stage0 || (searchState.results as any) || {};
    const hasS0 = !!(s0.searchQuery || (Array.isArray(s0.inventionFeatures) && s0.inventionFeatures.length > 0));

    if (!hasS0) return null;

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500">
                  <CheckCircle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">Idea Setup & Query Generation</CardTitle>
                  <CardDescription>
                    {isEditingStage0 ? 'Edit search query and features before proceeding' : 'Search query and feature extraction completed'}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {searchState.status === NoveltySearchStatus.STAGE_0_COMPLETED && (
                  <Badge className={stage0ApprovedForUi ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>
                    {stage0ApprovedForUi ? 'Approved' : 'Awaiting approval'}
                  </Badge>
                )}
                {!isEditingStage0 && searchState.status === NoveltySearchStatus.STAGE_0_COMPLETED && (
                  <Button onClick={startEditingStage0} variant="outline" size="sm" className="rounded-lg">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isEditingStage0 ? (
              <div className="space-y-6">
                <div>
                  <Label className="text-sm font-medium text-slate-700 mb-2">Search Query</Label>
                  <Textarea
                    value={editedSearchQuery}
                    onChange={(e) => setEditedSearchQuery(e.target.value)}
                    placeholder="Enter search query..."
                    className="min-h-[80px] rounded-lg"
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium text-slate-700 mb-2">
                    Invention Features ({editedFeatures.length})
                  </Label>
                  <div className="space-y-2 mb-4">
                    {editedFeatures.map((feature: string, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 rounded-lg border bg-slate-50 p-3">
                        <span className="text-xs font-mono bg-indigo-100 text-indigo-700 px-2 py-1 rounded-lg">{idx + 1}</span>
                        {editingFeatureIndex === idx ? (
                          <Input
                            value={feature}
                            onChange={(e) => {
                              const updated = [...editedFeatures];
                              updated[idx] = e.target.value;
                              setEditedFeatures(updated);
                            }}
                            onBlur={() => setEditingFeatureIndex(null)}
                            className="flex-1 rounded-lg"
                            autoFocus
                          />
                        ) : (
                          <span className="text-sm text-slate-700 flex-1">{feature}</span>
                        )}
                        <div className="flex gap-1">
                          <Button onClick={() => startEditingFeature(idx)} variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                          <Button onClick={() => removeFeature(idx)} variant="ghost" size="sm" className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600">
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Input
                      value={newFeatureText}
                      onChange={(e) => setNewFeatureText(e.target.value)}
                      placeholder="Add new feature..."
                      onKeyPress={(e) => { if (e.key === 'Enter') addFeature(); }}
                            className="rounded-lg"
                    />
                    <Button onClick={addFeature} disabled={!newFeatureText.trim()} variant="outline" size="sm" className="rounded-lg">
                      Add
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button onClick={cancelStage0Edits} variant="outline" className="rounded-lg">Cancel</Button>
                  <Button onClick={saveStage0Edits} className="rounded-lg bg-emerald-600 hover:bg-emerald-700" disabled={!editedSearchQuery.trim() || editedFeatures.length === 0}>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Save & Approve
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-slate-900 mb-3">Search Query</h4>
                  <div className="rounded-lg border bg-slate-50 p-4">
                    <p className="text-sm text-slate-700">"{s0.searchQuery}"</p>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium text-slate-900 mb-3">
                    Extracted Features ({Array.isArray(s0.inventionFeatures) ? s0.inventionFeatures.length : 0})
                  </h4>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {Array.isArray(s0.inventionFeatures) && s0.inventionFeatures.map((feature: string, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border">
                        <span className="text-xs font-mono bg-indigo-100 text-indigo-700 px-2 py-1 rounded">{idx + 1}</span>
                        <span className="text-sm text-slate-700">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {!isEditingStage0 && searchState.status === NoveltySearchStatus.STAGE_0_COMPLETED && (
              <div className="mt-6 border-t border-slate-200 pt-5">
                {!stage0ApprovedForUi ? (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      className="rounded-lg bg-indigo-600 hover:bg-indigo-700"
                      disabled={isAutoRunning}
                      onClick={markStage0Approved}
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Approve Search Terms
                    </Button>
                  </div>
                ) : !hasStage1Results ? (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-indigo-950">Choose execution mode</div>
                        <div className="mt-1 text-xs leading-5 text-indigo-800">
                          Run every remaining stage automatically, or continue manually and trigger each stage yourself.
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-lg border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                          disabled={isAutoRunning}
                          onClick={() => {
                            setAutoMode(false);
                            setSelectedStageTab('2');
                          }}
                        >
                          Manual Stage-by-Stage
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-lg bg-indigo-600 hover:bg-indigo-700"
                          disabled={isAutoRunning}
                          onClick={async () => {
                            setAutoMode(true);
                            setSelectedStageTab('2');
                            await runAllRemainingStages();
                          }}
                        >
                          <Zap className="mr-2 h-4 w-4" />
                          Auto-Run Remaining Stages
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end">
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      Search terms approved
                    </Badge>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // Stage 2 Content - raw provider search results
  const renderStage2Content = () => {
    if (!hasStage1Results) {
      return (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Patent Search Not Started</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Search selected patent providers first. These returned records are shown separately before any LLM relevance analysis.
            </p>
            {canRunCurrent && selectedStageTab === '2' && (
              <Button onClick={handleRunCurrent} className="mt-6 rounded-lg bg-indigo-600 hover:bg-indigo-700">
                <Search className="w-4 h-4 mr-2" />
                Search Patents
              </Button>
            )}
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-6">
        {renderStage1Content()}
      </div>
    );
  };

  // Legacy Stage 1 Content, now shown inside Stage 2
  const renderStage1Content = () => {
    const root: any = (searchState.results as any) || {};
    const stage1Container: any = root.stage1 || root;
    const aiRel = stage1Container.aiRelevance || root.aiRelevance || null;
    const pqaiResults = getRawStage1SearchResults(root);
    const candidateCount = pqaiResults.length;
    const retrievedCount = Number(stage1Container.retrievedCount ?? aiRel?.retrievedCount ?? candidateCount) || 0;
    const reviewedCount = Number(stage1Container.reviewedCount ?? aiRel?.reviewedCount ?? aiRel?.consideredCount ?? 0) || 0;
    const gateErrorCount = Number(stage1Container.gateErrorCount ?? aiRel?.gateErrorCount ?? 0) || 0;
    const unreviewedCount = Number(
      stage1Container.unreviewedCount ??
      aiRel?.unreviewedCount ??
      Math.max(0, retrievedCount - reviewedCount - gateErrorCount)
    ) || 0;
    const hasStage1 = pqaiResults.length > 0;
    const hasCandidatePool = candidateCount > 0;
    const hasGate = Boolean(aiRel && (Array.isArray(aiRel.accepted) || Array.isArray(aiRel.borderline) || Array.isArray(aiRel.rejected)));

    if (!hasStage1 && !hasCandidatePool) {
      return (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Patent Search Not Started</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Execute the patent search to find relevant prior art from the selected search source.
            </p>
            {canRunCurrent && selectedStageTab === '2' && (
              <Button onClick={handleRunCurrent} className="mt-6 rounded-lg bg-indigo-600 hover:bg-indigo-700">
                <Search className="w-4 h-4 mr-2" />
                Search Patents
              </Button>
            )}
          </CardContent>
        </Card>
      );
    }

    if (!hasStage1) {
      return (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">No Patent Candidates Returned</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              The selected patent sources did not return candidate records for this query.
            </p>
            <div className="mt-3 text-xs text-slate-500">
              {retrievedCount} retrieved · {reviewedCount} reviewed
              {gateErrorCount > 0 ? ` · ${gateErrorCount} gate error${gateErrorCount !== 1 ? 's' : ''}` : ''}
              {unreviewedCount > 0 ? ` · ${unreviewedCount} unreviewed` : ''}
            </div>
            {hasGate && stage1Container.hasMoreCandidates && (
              <Button onClick={handleReviewMoreCandidates} className="mt-6 rounded-lg bg-indigo-600 hover:bg-indigo-700" disabled={Boolean(activeExecutionStage) || searchState.isLoading}>
                <Search className="w-4 h-4 mr-2" />
                Review More Candidates
              </Button>
            )}
            {!hasGate && hasCandidatePool && canRunCurrent && selectedStageTab === '2' && (
              <Button onClick={() => executeStage('1.5')} className="mt-6 rounded-lg bg-indigo-600 hover:bg-indigo-700" disabled={Boolean(activeExecutionStage) || searchState.isLoading}>
                <Search className="w-4 h-4 mr-2" />
                Run AI Relevance
              </Button>
            )}
          </CardContent>
        </Card>
      );
    }

    const highRelevanceCount = pqaiResults.filter((p: any) => getStage1ScorePercent(p) >= 70).length;
    const avgRelevance = pqaiResults.length > 0
      ? pqaiResults.reduce((avg: number, p: any) => avg + getStage1ScorePercent(p), 0) / pqaiResults.length
      : 0;
    const providerStats = Array.isArray(stage1Container.providerStats) ? stage1Container.providerStats : [];
    const searchWarnings = Array.isArray(stage1Container.searchWarnings) ? stage1Container.searchWarnings : [];
    const queryPlan = stage1Container.queryPlan || null;
    const filterOptions = getStage1FilterOptions(pqaiResults);
    const pagedResults = filterAndPaginateStage1Results(pqaiResults, stage1Filters, stage1Page, STAGE1_PAGE_SIZE);
    const filteredIpIndiaNumbers = normalizeIpIndiaApplicationNumbers(
      pagedResults.allItems.map(({ result }) => getStage1PatentNumber(result))
    );
    const hasActiveStage1Filters = Object.entries(stage1Filters).some(([key, value]) => {
      if (key === 'sort') return value !== DEFAULT_STAGE1_RESULT_FILTERS.sort;
      return typeof value === 'string' && value.trim().length > 0;
    });
    const selectClass = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600">
                <Search className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">Patent Search Results</CardTitle>
                <CardDescription>Raw provider-ranked records before LLM relevance filtering</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-slate-900">{pqaiResults.length}</div>
                <div className="text-xs font-medium text-slate-500">Returned Patents</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-emerald-600">{highRelevanceCount}</div>
                <div className="text-xs font-medium text-slate-500">At Least 70% Search Score</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-indigo-600">{avgRelevance.toFixed(0)}%</div>
                <div className="text-xs font-medium text-slate-500">Avg Search Score</div>
              </div>
            </div>

            <div className="mb-6 flex flex-col gap-3 rounded-lg border border-indigo-100 bg-indigo-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-indigo-950">Next: Relevance Analysis</div>
                <div className="text-xs text-indigo-800">
                  Review these returned patents, then run the LLM relevance gate to separate direct, component, borderline, and rejected records.
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                className="w-fit rounded-lg bg-indigo-600 hover:bg-indigo-700"
                onClick={() => setSelectedStageTab('3')}
              >
                Relevance Analysis
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>

            {(queryPlan || providerStats.length > 0 || searchWarnings.length > 0) && (
              <div className="mb-6 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                {queryPlan && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-slate-900">Query plan</div>
                    <div className="mt-2 rounded-md bg-white p-3 text-sm text-slate-700">
                      {queryPlan.searchQuery || queryPlan.normalizedQuery || 'Provider search query unavailable'}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Array.isArray(queryPlan.inventionFeatures) && queryPlan.inventionFeatures.slice(0, 6).map((feature: string) => (
                        <Badge key={feature} variant="outline" className="border-indigo-200 bg-indigo-50 text-[11px] text-indigo-700">
                          {feature}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      LLM expanded in Stage 1: {queryPlan.llmExpanded ? 'Yes' : 'No'}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {providerStats.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="mb-2 text-sm font-semibold text-slate-900">Provider stats</div>
                      <div className="space-y-2">
                        {providerStats.map((stat: any) => (
                          <div key={stat.providerId || stat.label} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs">
                            <span className="font-medium text-slate-700">{displayPatentProviderLabel(stat.label || stat.providerId)}</span>
                            <span className={stat.error ? 'text-rose-600' : 'text-slate-600'}>
                              {stat.error ? displayInternationalPatentText(stat.error) : `${stat.resultCount || 0} results`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {searchWarnings.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <div className="font-semibold">Search warnings</div>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {searchWarnings.map((warning: string, index: number) => <li key={index}>{displayInternationalPatentText(warning)}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-slate-500" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Filter returned patents</div>
                    <div className="text-xs text-slate-500">
                      {filterOptions.providers.length} provider{filterOptions.providers.length !== 1 ? 's' : ''} and {filterOptions.matchedItems.length} matched item{filterOptions.matchedItems.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit rounded-lg"
                    onClick={() => openIpIndiaForPatentNumbers(filteredIpIndiaNumbers)}
                    disabled={filteredIpIndiaNumbers.length === 0}
                    title="Open IP India Public Search and preload filtered Indian application numbers"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    IP India Search
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit rounded-lg"
                    onClick={clearStage1Filters}
                    disabled={!hasActiveStage1Filters}
                  >
                    Clear filters
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <div className="xl:col-span-2">
                  <Label htmlFor="stage1-keyword" className="text-xs font-medium text-slate-600">Keyword</Label>
                  <Input
                    id="stage1-keyword"
                    value={stage1Filters.keyword}
                    onChange={(event) => updateStage1Filter('keyword', event.target.value)}
                    placeholder="Patent no., title, applicant..."
                    className="mt-1 h-10 rounded-lg"
                  />
                </div>
                <div>
                  <Label htmlFor="stage1-provider" className="text-xs font-medium text-slate-600">Provider</Label>
                  <select
                    id="stage1-provider"
                    value={stage1Filters.provider}
                    onChange={(event) => updateStage1Filter('provider', event.target.value)}
                    className={`${selectClass} mt-1`}
                  >
                    <option value="">All providers</option>
                    {filterOptions.providers.map(provider => (
                      <option key={provider} value={provider}>{displayPatentProviderLabel(provider)}</option>
                    ))}
                  </select>
                </div>
                <div className="xl:col-span-2">
                  <Label htmlFor="stage1-matched-item" className="text-xs font-medium text-slate-600">Matched item</Label>
                  <select
                    id="stage1-matched-item"
                    value={stage1Filters.matchedItem}
                    onChange={(event) => updateStage1Filter('matchedItem', event.target.value)}
                    className={`${selectClass} mt-1`}
                  >
                    <option value="">All matched items</option>
                    {filterOptions.matchedItems.map(item => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="stage1-min-score" className="text-xs font-medium text-slate-600">Min score</Label>
                  <select
                    id="stage1-min-score"
                    value={stage1Filters.minScore}
                    onChange={(event) => updateStage1Filter('minScore', event.target.value)}
                    className={`${selectClass} mt-1`}
                  >
                    <option value="">All scores</option>
                    <option value="40">&gt;= 40%</option>
                    <option value="60">&gt;= 60%</option>
                    <option value="70">&gt;= 70%</option>
                    <option value="80">&gt;= 80%</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="stage1-year-from" className="text-xs font-medium text-slate-600">Published from</Label>
                  <Input
                    id="stage1-year-from"
                    type="number"
                    value={stage1Filters.publicationYearFrom}
                    onChange={(event) => updateStage1Filter('publicationYearFrom', event.target.value)}
                    placeholder="YYYY"
                    className="mt-1 h-10 rounded-lg"
                  />
                </div>
                <div>
                  <Label htmlFor="stage1-year-to" className="text-xs font-medium text-slate-600">Published to</Label>
                  <Input
                    id="stage1-year-to"
                    type="number"
                    value={stage1Filters.publicationYearTo}
                    onChange={(event) => updateStage1Filter('publicationYearTo', event.target.value)}
                    placeholder="YYYY"
                    className="mt-1 h-10 rounded-lg"
                  />
                </div>
                <div className="md:col-span-2 xl:col-span-2">
                  <Label htmlFor="stage1-sort" className="text-xs font-medium text-slate-600">Sort</Label>
                  <select
                    id="stage1-sort"
                    value={stage1Filters.sort}
                    onChange={(event) => updateStage1Filter('sort', event.target.value)}
                    className={`${selectClass} mt-1`}
                  >
                    <option value="original">Original rank</option>
                    <option value="score_desc">Score high to low</option>
                    <option value="newest">Newest publication</option>
                    <option value="oldest">Oldest publication</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600">
                Showing {pagedResults.startIndex}-{pagedResults.endIndex} of {pagedResults.totalItems} filtered patents ({pqaiResults.length} returned · {reviewedCount} reviewed · {retrievedCount} retrieved{gateErrorCount > 0 ? ` · ${gateErrorCount} gate error${gateErrorCount !== 1 ? 's' : ''}` : ''}{unreviewedCount > 0 ? ` · ${unreviewedCount} unreviewed` : ''})
              </div>
              <div className="text-xs text-slate-500">
                {STAGE1_PAGE_SIZE} patents per page
              </div>
            </div>

            {/* Patent List */}
            {pagedResults.totalItems === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
                <Search className="mx-auto mb-3 h-9 w-9 text-slate-300" />
                <div className="text-sm font-medium text-slate-800">No patents match the current filters</div>
                {hasActiveStage1Filters && (
                  <Button type="button" variant="outline" size="sm" className="mt-4 rounded-lg" onClick={clearStage1Filters}>
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
              {pagedResults.items.map(({ result: r, originalIndex }, pageIndex) => {
                const patentNumber = getStage1PatentNumber(r);
                const title = r.title || r.invention_title || patentNumber;
                const abstract = r.abstract || r.snippet || '';
                const pubDate = r.publicationDate || r.publication_date || r.year || '';
                const relevanceScore = getStage1ScorePercent(r);
                const href = r.link || r.sourceUrl || `https://patents.google.com/patent/${encodeURIComponent(patentNumber)}`;
                const applicants = listPatentText(r.applicants, 6);
                const inventors = listPatentText(r.inventors, 6);
                const classifications = Array.isArray(r.classifications) ? r.classifications.join(', ') : '';
                const sourcePdf = r.sourcePdfName ? `${r.sourcePdfName}${r.sourcePageNumber ? ` page ${r.sourcePageNumber}` : ''}` : '';
                const matchedItems = getStage1MatchedItems(r);
                const sourceProviders = getStage1Providers(r);

                return (
                  <motion.div
                    key={`${patentNumber}-${originalIndex}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(pageIndex, 10) * 0.015 }}
                    className="rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:bg-slate-50"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                        {originalIndex + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <a className="font-medium text-indigo-700 hover:underline text-sm" target="_blank" rel="noreferrer" href={href}>
                            {title}
                          </a>
                          <Badge variant="outline" className="text-xs bg-indigo-50 text-indigo-700 border-indigo-200 flex-shrink-0">
                            {Math.round(relevanceScore)}%
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {patentNumber} {pubDate && `- ${String(pubDate).slice(0, 10)}`}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Provider: {sourceProviders.map(displayPatentProviderLabel).join(', ') || 'patent-search'}
                        </div>
                        {matchedItems.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {matchedItems.slice(0, 8).map((item: string) => (
                              <Badge key={item} variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                                {item}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {abstract && (
                          <div className="mt-3">
                            <div className="text-xs font-semibold uppercase text-slate-500">Abstract</div>
                            <p className="mt-1 text-xs leading-5 text-slate-600">{abstract}</p>
                          </div>
                        )}
                        <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <summary className="cursor-pointer text-xs font-medium text-slate-700">Patent details</summary>
                          <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                            {r.applicationNumber && <div><span className="font-medium text-slate-800">Application:</span> {r.applicationNumber}</div>}
                            {r.filingDate && <div><span className="font-medium text-slate-800">Filed:</span> {String(r.filingDate).slice(0, 10)}</div>}
                            {pubDate && <div><span className="font-medium text-slate-800">Published:</span> {String(pubDate).slice(0, 10)}</div>}
                            {sourcePdf && <div><span className="font-medium text-slate-800">Source:</span> {sourcePdf}</div>}
                            {classifications && <div className="md:col-span-2"><span className="font-medium text-slate-800">IPC/CPC:</span> {classifications}</div>}
                            {applicants && <div className="md:col-span-2"><span className="font-medium text-slate-800">Applicants:</span> {applicants}</div>}
                            {inventors && <div className="md:col-span-2"><span className="font-medium text-slate-800">Inventors:</span> {inventors}</div>}
                            {(r.numberOfPages || r.numberOfClaims) && (
                              <div>
                                <span className="font-medium text-slate-800">Counts:</span>
                                {r.numberOfPages ? ` ${r.numberOfPages} pages` : ''}
                                {r.numberOfClaims ? ` / ${r.numberOfClaims} claims` : ''}
                              </div>
                            )}
                          </div>
                        </details>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              </div>
            )}

            {pagedResults.totalItems > 0 && (
              <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-600">
                  Page {pagedResults.currentPage} of {pagedResults.totalPages}
                </div>
                <div className="flex items-center gap-2">
                  {stage1Container.hasMoreCandidates && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      onClick={handleReviewMoreCandidates}
                      disabled={Boolean(activeExecutionStage) || searchState.isLoading}
                    >
                      Review More Candidates
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => setStage1Page(Math.max(1, pagedResults.currentPage - 1))}
                    disabled={pagedResults.currentPage <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => setStage1Page(Math.min(pagedResults.totalPages, pagedResults.currentPage + 1))}
                    disabled={pagedResults.currentPage >= pagedResults.totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // Stage 1.5 Content
  const renderStage15Content = () => {
    const aiRel = (searchState.results as any)?.aiRelevance || (searchState.results as any)?.stage1?.aiRelevance;
    
    if (!aiRel) {
      return (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <Zap className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">AI Relevance Not Computed</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Run AI relevance filtering to categorize patents by their relevance to your invention.
            </p>
            {canRunCurrent && selectedStageTab === '3' && (
              <Button onClick={handleRunCurrent} className="mt-6 rounded-lg bg-indigo-600 hover:bg-indigo-700">
                <Zap className="w-4 h-4 mr-2" />
                Run LLM Relevance
              </Button>
            )}
          </CardContent>
        </Card>
      );
    }

    const acc = Array.isArray(aiRel.accepted) ? aiRel.accepted.length : 0;
    const cmp = Array.isArray(aiRel.component) ? aiRel.component.length : 0;
    const bor = Array.isArray(aiRel.borderline) ? aiRel.borderline.length : 0;
    const rej = Array.isArray(aiRel.rejected) ? aiRel.rejected.length : 0;
    const total = acc + cmp + bor + rej;
    const nonDirectOnly = acc === 0 && (cmp > 0 || bor > 0);

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">AI Relevance Analysis</CardTitle>
                  <CardDescription>
                    Candidate gate over top provider-ranked results
                    {typeof aiRel.consideredCount === 'number' && typeof aiRel.totalCandidates === 'number'
                      ? ` (${aiRel.consideredCount} of ${aiRel.totalCandidates} reviewed)`
                      : ''}
                  </CardDescription>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-lg"
                  onClick={() => openIpIndiaForPatentNumbers(aiRelevantPatentNumbers)}
                  disabled={aiRelevantPatentNumbers.length === 0}
                  title="Open IP India Public Search and preload direct/component/borderline application numbers"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  IP India Search
                </Button>
                <div className="text-xs text-slate-500">
                  Thresholds: High {(aiRel.thresholds?.high ?? 0.6)}, Medium {(aiRel.thresholds?.medium ?? 0.4)}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-4 mb-6">
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-emerald-600">{acc}</div>
                <div className="text-xs font-medium text-slate-500">Direct</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-sky-600">{cmp}</div>
                <div className="text-xs font-medium text-slate-500">Component</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-amber-600">{bor}</div>
                <div className="text-xs font-medium text-slate-500">Borderline</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-rose-600">{rej}</div>
                <div className="text-xs font-medium text-slate-500">Rejected</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-indigo-600">{total}</div>
                <div className="text-xs font-medium text-slate-500">Total</div>
              </div>
            </div>

            {nonDirectOnly && (
              <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                No direct high-confidence patents were accepted. Deep Analysis will map component and/or borderline references so the report still captures partial prior-art evidence instead of stopping here.
              </div>
            )}

            <div className="grid md:grid-cols-3 gap-6">
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  Direct Patents
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {Array.isArray(aiRel.accepted) && aiRel.accepted.slice(0, 10).map((pn: string, i: number) => (
                    <div key={i} className="text-xs text-slate-700 p-2 bg-emerald-50 rounded">{pn}</div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-sky-500" />
                  Component / Feature-Level Patents
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {Array.isArray(aiRel.component) && aiRel.component.slice(0, 10).map((pn: string, i: number) => (
                    <div key={i} className="text-xs text-slate-700 p-2 bg-sky-50 rounded">{pn}</div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  Borderline Patents
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {Array.isArray(aiRel.borderline) && aiRel.borderline.slice(0, 10).map((pn: string, i: number) => (
                    <div key={i} className="text-xs text-slate-700 p-2 bg-amber-50 rounded">{pn}</div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // Stage 3 Content - Deep Analysis (feature matrix + patent remarks)
  const renderStage3Content = () => {
    if (!hasStage35MappingResults && !hasStage35AggregationResults && !hasStage35cResults) {
      return (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Deep Analysis Not Started</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Run Deep Analysis to map features against prior art and generate per-patent threat remarks.
            </p>
            {canRunCurrent && selectedStageTab === '4' && (
              <Button onClick={handleRunCurrent} className="mt-6 rounded-lg bg-indigo-600 hover:bg-indigo-700">
                <FileText className="w-4 h-4 mr-2" />
                Run Deep Analysis
              </Button>
            )}
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setDeepAnalysisView('matrix')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              deepAnalysisView === 'matrix' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Feature Matrix
          </button>
          <button
            type="button"
            onClick={() => setDeepAnalysisView('remarks')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              deepAnalysisView === 'remarks' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Patent Remarks
          </button>
        </div>
        {deepAnalysisView === 'matrix' ? renderStage35Content() : renderStage35cContent()}
      </div>
    );
  };

  // Legacy Stage 3.5 Content, now shown inside Stage 3
  const renderStage35Content = () => {
    const stage35Any: any = (searchState.results as any)?.stage35;
    const topFeatureMap = (searchState.results as any)?.feature_map;
    const items = Array.isArray(stage35Any?.feature_map) ? stage35Any.feature_map : (Array.isArray(topFeatureMap) ? topFeatureMap : []);

    if (items.length === 0) {
      return (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Feature Analysis Not Started</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Run feature analysis to map your invention features to prior art evidence.
            </p>
          </CardContent>
        </Card>
      );
    }

    const presentSum = items.reduce((sum: number, p: any) => sum + (p.coverage?.present || 0), 0);
    const partialSum = items.reduce((sum: number, p: any) => sum + (p.coverage?.partial || 0), 0);
    const absentSum = items.reduce((sum: number, p: any) => sum + (p.coverage?.absent || 0), 0);

    // Extract features from Stage 0 or from the feature_map items
    const s0 = (searchState.results as any)?.stage0 || (searchState.results as any) || {};
    const featuresFromS0: string[] = Array.isArray(s0.inventionFeatures) ? s0.inventionFeatures : [];
    const featuresFromMaps: string[] = Array.from(new Set(
      items.flatMap((p: any) => Array.isArray(p?.feature_analysis) ? p.feature_analysis.map((c: any) => c.feature).filter(Boolean) : [])
    ));
    const features: string[] = (featuresFromS0 && featuresFromS0.length > 0) ? featuresFromS0 : featuresFromMaps;

    // Limit for readability
    const visiblePatents = items.slice(0, 20);
    const visibleFeatures = features.slice(0, 18);
    const cellsForPatent = (patent: any) => Array.isArray(patent.feature_analysis)
      ? patent.feature_analysis
      : [
        ...(Array.isArray(patent.present) ? patent.present : []),
        ...(Array.isArray(patent.partial) ? patent.partial : []),
        ...(Array.isArray(patent.absent) ? patent.absent : [])
      ];
    const stage4Any: any = (searchState.results as any)?.stage4 || {};
    const perPatentRemarks: any[] = Array.isArray(stage4Any?.per_patent_remarks) ? stage4Any.per_patent_remarks : [];
    const canonPn = (value: any) => {
      const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const kindSuffixMatch = compact.match(/^(.+\d)[A-Z]\d?$/);
      return kindSuffixMatch?.[1] || compact;
    };
    const comparisonRowFor = (pn: string, feature: string) => {
      const remark = perPatentRemarks.find((item: any) => canonPn(item?.pn || item?.patent_number) === canonPn(pn));
      const rows = Array.isArray(remark?.comparison_rows) ? remark.comparison_rows : [];
      return rows.find((row: any) => String(row?.feature || '').toLowerCase() === String(feature || '').toLowerCase()) || null;
    };
    const featureSignals = features.map(feature => {
      const cells = items.flatMap((patent: any) => cellsForPatent(patent).filter((cell: any) => cell?.feature === feature));
      const present = cells.filter((cell: any) => cell.status === 'Present').length;
      const partial = cells.filter((cell: any) => cell.status === 'Partial').length;
      const unknownOrWeak = cells.filter((cell: any) => cell.status === 'Unknown' || (!cell.quote && !cell.evidence && cell.status !== 'Absent')).length;
      return { feature, present, partial, unknownOrWeak };
    });
    const fullyCoveredFeatures = featureSignals.filter(signal => signal.present > 0).map(signal => signal.feature).slice(0, 8);
    const uniqueFeatures = featureSignals.filter(signal => signal.present === 0 && signal.partial === 0).map(signal => signal.feature).slice(0, 8);
    const weakEvidenceFeatures = featureSignals.filter(signal => signal.unknownOrWeak > 0 || (signal.present === 0 && signal.partial > 0)).map(signal => signal.feature).slice(0, 8);
    const blockingReferences = [...items]
      .map((patent: any) => {
        const cells = cellsForPatent(patent);
        const present = cells.filter((cell: any) => cell.status === 'Present').length;
        const partial = cells.filter((cell: any) => cell.status === 'Partial').length;
        const score = Number(patent.coverage?.coverage_score ?? ((present + partial * 0.5) / Math.max(features.length, 1)));
        return {
          pn: patent.pn || patent.publicationNumber || patent.patent_number || patent.publication_number || 'N/A',
          title: patent.title,
          present,
          partial,
          score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const getStatusClass = (status: string | undefined) => {
      switch (status) {
        case 'Present': return 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100';
        case 'Partial': return 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100';
        case 'Absent': return 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100';
        default: return 'bg-slate-50 text-slate-600 border-slate-200';
      }
    };
    const scoreValue = (value: any) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return undefined;
      return Math.max(0, Math.min(1, n > 1 && n <= 100 ? n / 100 : n));
    };
    const textSpecificityScore = (value: string) => {
      const tokens = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length > 3 && !['patent', 'feature', 'disclosure', 'supporting', 'available', 'identified'].includes(token));
      return Math.min(1, Array.from(new Set(tokens)).length / 28);
    };
    const featureOverlapScore = (feature: string, disclosure: string) => {
      const text = String(disclosure || '').toLowerCase();
      const tokens = Array.from(new Set(String(feature || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length > 3)));
      if (tokens.length === 0) return 0;
      return tokens.filter(token => text.includes(token)).length / tokens.length;
    };
    const defaultExtentScore = (status: string, feature: string, patentDisclosure = '', quote = '', confidence?: number) => {
      const evidenceText = [patentDisclosure, quote].filter(Boolean).join(' ');
      const specificity = textSpecificityScore(evidenceText);
      const overlap = featureOverlapScore(feature, evidenceText);
      const rowConfidence = typeof confidence === 'number' ? confidence : 0.5;
      const raw = status === 'Present'
        ? 0.70 + overlap * 0.18 + specificity * 0.08 + rowConfidence * 0.04
        : status === 'Partial'
          ? 0.32 + overlap * 0.24 + specificity * 0.12 + rowConfidence * 0.06
          : status === 'Absent'
            ? 0.04 + Math.min(overlap, 0.5) * 0.12
            : 0.14 + overlap * 0.12 + specificity * 0.08;
      return Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;
    };

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">Feature Analysis</CardTitle>
                <CardDescription>AI-powered feature-to-patent mapping with evidence extraction</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-slate-900">{items.length}</div>
                <div className="text-xs font-medium text-slate-500">Patents Analyzed</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-emerald-600">{presentSum}</div>
                <div className="text-xs font-medium text-slate-500">Present Features</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-amber-600">{partialSum}</div>
                <div className="text-xs font-medium text-slate-500">Partial Features</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                <div className="text-3xl font-bold text-rose-600">{absentSum}</div>
                <div className="text-xs font-medium text-slate-500">Absent Features</div>
              </div>
            </div>

            <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-base font-semibold text-slate-900">Novelty Signals</h4>
                  <p className="mt-1 text-sm text-slate-500">Deterministic summary from feature mapping evidence.</p>
                </div>
                <div className="text-xs text-slate-500">
                  {stage1Results.length} searched, {items.length} mapped, {features.length} feature{features.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-sm font-semibold text-slate-900">Closest blocking references</div>
                  <div className="mt-2 space-y-2">
                    {blockingReferences.length > 0 ? blockingReferences.map((ref, index) => (
                      <div key={`${ref.pn}-${index}`} className="rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                        <div className="font-medium text-slate-900">{ref.pn}</div>
                        {ref.title && <div className="mt-0.5 line-clamp-1 text-slate-500">{ref.title}</div>}
                        <div className="mt-1 text-slate-500">{ref.present} present, {ref.partial} partial features</div>
                      </div>
                    )) : <div className="text-xs text-slate-500">No blocking reference identified from mapped evidence.</div>}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <div className="text-sm font-semibold text-emerald-950">Covered by prior art</div>
                    <div className="mt-2 space-y-1 text-xs text-emerald-900">
                      {fullyCoveredFeatures.length > 0 ? fullyCoveredFeatures.map(feature => <div key={feature} className="line-clamp-2">{feature}</div>) : <div>No fully covered features found.</div>}
                    </div>
                  </div>
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                    <div className="text-sm font-semibold text-indigo-950">Still unique</div>
                    <div className="mt-2 space-y-1 text-xs text-indigo-900">
                      {uniqueFeatures.length > 0 ? uniqueFeatures.map(feature => <div key={feature} className="line-clamp-2">{feature}</div>) : <div>No unique feature signal yet.</div>}
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="text-sm font-semibold text-amber-950">Weak evidence areas</div>
                    <div className="mt-2 space-y-1 text-xs text-amber-900">
                      {weakEvidenceFeatures.length > 0 ? weakEvidenceFeatures.map(feature => <div key={feature} className="line-clamp-2">{feature}</div>) : <div>No full-text review flags.</div>}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                Recommended next actions: review the closest references, strengthen claim language around unique features, and rerun with broader source coverage if weak-evidence areas are important.
              </div>
            </div>

            {/* Detailed Feature-Patent Matrix */}
            <div className="mt-6">
              <h4 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span>Feature-Patent Matrix</span>
                <span className="text-xs font-normal text-slate-500">
                  (Click any cell to view evidence)
                </span>
              </h4>

              {features.length === 0 ? (
                <p className="text-sm text-slate-500">No feature mapping data available to display.</p>
              ) : (
                <div className="overflow-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        <th className="sticky left-0 z-20 w-48 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left font-semibold text-slate-700">
                          Patent
                        </th>
                        {visibleFeatures.map((f: string, idx: number) => (
                          <th key={idx} className="px-2 py-3 text-left font-medium text-slate-700 border-b border-slate-200 min-w-[120px] max-w-[160px]">
                            <div className="flex items-start gap-1">
                              <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">
                                {idx + 1}
                              </span>
                              <span className="text-xs leading-tight break-words line-clamp-2" title={f}>{f}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {visiblePatents.map((patent: any, rowIdx: number) => {
                        const pn = patent.pn || patent.publicationNumber || patent.patent_number || patent.publication_number || 'N/A';
                        const cellsArray = Array.isArray(patent.feature_analysis)
                          ? patent.feature_analysis
                          : [
                              ...(Array.isArray(patent.present) ? patent.present : []),
                              ...(Array.isArray(patent.partial) ? patent.partial : []),
                              ...(Array.isArray(patent.absent) ? patent.absent : [])
                            ];
                        const featureToStatus = new Map<string, string>();
                        for (const c of cellsArray) {
                          if (c && typeof c.feature === 'string' && c.feature) {
                            featureToStatus.set(c.feature, c.status || 'Unknown');
                          }
                        }

                        return (
                          <tr key={rowIdx} className="hover:bg-slate-50/50 transition-colors">
                            <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3 py-3 align-top">
                              <div className="flex items-start gap-2">
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 text-xs font-bold flex-shrink-0">
                                  {rowIdx + 1}
                                </span>
                                <div>
                                  <div className="font-medium text-slate-900 text-xs">{pn}</div>
                                  {patent.title && (
                                    <div className="text-[10px] text-slate-500 mt-0.5 max-w-[140px] truncate" title={patent.title}>
                                      {patent.title}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            {visibleFeatures.map((f: string, colIdx: number) => {
                              const rawStatus = featureToStatus.get(f) || 'Absent';
                              // Find full cell object for tooltip/details
                              const cellObj = (() => {
                                const byExact = cellsArray.find((c: any) => c && typeof c.feature === 'string' && c.feature === f);
                                if (byExact) return byExact;
                                const byLower = cellsArray.find((c: any) => c && typeof c.feature === 'string' && c.feature.toLowerCase() === f.toLowerCase());
                                return byLower || null;
                              })();

                              const comparisonRow = comparisonRowFor(pn, f);
                              const quote = comparisonRow?.evidence_quote
                                ? String(comparisonRow.evidence_quote)
                                : ((cellObj && (cellObj.quote || cellObj.evidence)) ? String(cellObj.quote || cellObj.evidence) : '');
                              const status = visibleStatusForReport(rawStatus, quote);
                              const reason = cellObj && cellObj.reason ? String(cellObj.reason) : '';
                              const field = comparisonRow?.evidence_source
                                ? String(comparisonRow.evidence_source)
                                : (cellObj && (cellObj.evidence_source || cellObj.field) ? String(cellObj.evidence_source || cellObj.field) : undefined);
                              const confidence = scoreValue(comparisonRow?.confidence ?? cellObj?.confidence);
                              const featureId = comparisonRow?.feature_id || cellObj?.feature_id || `KF${colIdx + 1}`;
                              const userDisclosure = comparisonRow?.user_invention_disclosure || cellObj?.user_invention_disclosure;
                              const patentDisclosure = comparisonRow?.patent_disclosure || cellObj?.patent_disclosure;
                              const extentScore = scoreValue(comparisonRow?.extent_score ?? comparisonRow?.extentScore ?? cellObj?.extent_score ?? cellObj?.extentScore)
                                ?? defaultExtentScore(status, f, patentDisclosure || quote || reason, quote, confidence);
                              const attorneyRemark = comparisonRow?.attorney_remark || cellObj?.attorney_remark;
                              const noveltyImpact = comparisonRow?.novelty_impact || cellObj?.novelty_impact;
                              const claimReviewNote = comparisonRow?.claim_review_note || cellObj?.claim_review_note;
                              const crispRemark = cleanReviewText(comparisonRow?.crisp_remark || cellObj?.crisp_remark) || crispRemarkForStatus(status);
                              const professionalRemark = cleanReviewText(comparisonRow?.professional_remark || cellObj?.professional_remark) || crispRemark;
                              const link = (patent.link || (pn && `https://patents.google.com/patent/${pn}`)) as string | undefined;

                              const tooltip = (() => {
                                if (professionalRemark) {
                                  return professionalRemark.length > 180 ? professionalRemark.slice(0, 177) + '...' : professionalRemark;
                                }
                                 if (status === 'Present' || status === 'Partial') {
                                  const snip = quote ? (quote.length > 160 ? quote.slice(0, 157) + '...' : quote) : 'No evidence provided';
                                  const fld = field ? ` (${field})` : '';
                                  return `${status}${fld}: "${snip}"`;
                                }
                                if (status === 'Absent') {
                                  const r = reason || 'No direct supporting citation evidence';
                                  return `${status}: ${r}`;
                                }
                                return 'Unknown: No analysis available';
                              })();

                              return (
                                <td key={colIdx} className="px-2 py-2 align-middle">
                                  <button
                                    type="button"
                                    title={tooltip}
                                    onClick={() => setSelectedEvidence({
                                      pn,
                                      patentTitle: patent.title,
                                      feature: f,
                                      status,
                                      quote: quote || undefined,
                                      reason: reason || undefined,
                                      field,
                                      extentScore,
                                      confidence,
                                      featureId,
                                      userDisclosure,
                                      patentDisclosure,
                                      evidenceSource: field,
                                      attorneyRemark,
                                      noveltyImpact,
                                      claimReviewNote,
                                      crispRemark,
                                      professionalRemark,
                                      link
                                    })}
                                    className={`
                                      w-full cursor-pointer rounded-md border px-2 py-1.5 text-center
                                      text-[10px] font-medium transition-all duration-150
                                      ${getStatusClass(status)}
                                    `}
                                  >
                                    <span className="block">
                                      {status === 'Present' ? 'Present' :
                                       status === 'Partial' ? 'Partial' :
                                       status === 'Unknown' ? 'Review' : 'Absent'}
                                    </span>
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  
                  {/* Table Footer with Legend */}
                  {(items.length > visiblePatents.length || features.length > visibleFeatures.length) && (
                    <div className="p-3 text-xs text-slate-500 border-t bg-slate-50">
                      Showing {visiblePatents.length}/{items.length} patents and {visibleFeatures.length}/{features.length} features.
                    </div>
                  )}
                  <div className="p-3 text-xs text-slate-600 flex items-center gap-4 border-t bg-white">
                    <span className="font-medium text-slate-700">Legend:</span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded bg-rose-500"></span>
                      Present
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded bg-amber-500"></span>
                      Partial
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded bg-emerald-500"></span>
                      Absent
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Per-Patent Remarks from Stage 3.5a (if available) */}
            {Array.isArray(items) && items.some((p: any) => p.remarks) && (
              <div className="mt-6">
                <h4 className="font-semibold text-slate-900 mb-3">Per-Patent Remarks</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {items
                    .filter((p: any) => p.remarks)
                    .map((p: any, idx: number) => (
                      <div key={p.pn || idx} className="rounded-lg border bg-slate-50 p-3">
                        <div className="flex items-start gap-2">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-600 text-white text-xs font-bold flex-shrink-0">
                            {idx + 1}
                          </span>
                          <div className="flex-1">
                            <div className="text-xs font-semibold text-slate-900">{p.pn || 'Unknown PN'}</div>
                            {p.title && (
                              <div className="text-[10px] text-slate-600 truncate" title={p.title}>{p.title}</div>
                            )}
                            <div className="mt-1.5 text-xs text-slate-700 whitespace-pre-wrap">{p.remarks}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // Stage 3.5c Content - Detailed Prior Art Analysis with Novelty Lines
  const renderStage35cContent = () => {
    const root: any = (searchState.results as any) || {};
    const container = root.stage4 || root;
    const remarks: any[] = Array.isArray(container?.per_patent_remarks) ? container.per_patent_remarks : [];

    if (remarks.length === 0) {
      return (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Patent Remarks Not Generated</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Generate patent-by-patent analysis to create detailed prior art assessment for inventor review.
            </p>
          </CardContent>
        </Card>
      );
    }

    // Helper to get novelty line color and width based on threat level and relevance
    const getNoveltyLineStyle = (patent: any) => {
      const relevance = typeof patent.relevance === 'number' ? patent.relevance : 0.5;
      const threat = patent.novelty_threat || patent.decision || 'unknown';
      
      // Color based on novelty threat level
      const threatColors: Record<string, string> = {
        anticipates: 'bg-red-500',
        obvious: 'bg-orange-400',
        adjacent: 'bg-yellow-400',
        remote: 'bg-emerald-400',
        novel: 'bg-emerald-500',
        partial_novelty: 'bg-amber-400',
        unknown: 'bg-slate-300'
      };
      
      const color = threatColors[threat] || threatColors.unknown;
      const width = Math.round(relevance * 100);
      
      return { color, width, relevance };
    };

    // Helper to get threat label
    const getThreatLabel = (threat: string) => {
      const labels: Record<string, { text: string; color: string }> = {
        anticipates: { text: 'High Risk - Anticipates', color: 'text-red-600 bg-red-50 border-red-200' },
        obvious: { text: 'Moderate Risk - Obviousness', color: 'text-orange-600 bg-orange-50 border-orange-200' },
        adjacent: { text: 'Low Risk - Adjacent Art', color: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
        remote: { text: 'Minimal Risk - Remote', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
        novel: { text: 'Novel', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
        partial_novelty: { text: 'Partial Novelty', color: 'text-amber-600 bg-amber-50 border-amber-200' }
      };
      return labels[threat] || { text: 'Unassessed', color: 'text-slate-500 bg-slate-50 border-slate-200' };
    };

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">Detailed Prior Art Analysis</CardTitle>
                  <CardDescription>{remarks.length} patents analyzed for inventor review</CardDescription>
                </div>
              </div>
              {/* Legend */}
              <div className="hidden md:flex items-center gap-4 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <span className="text-slate-500">Anticipates</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-orange-400"></div>
                  <span className="text-slate-500">Obvious</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                  <span className="text-slate-500">Adjacent</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                  <span className="text-slate-500">Remote/Novel</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100">
              {remarks.map((patent: any, idx: number) => {
                const lineStyle = getNoveltyLineStyle(patent);
                const threatInfo = getThreatLabel(patent.novelty_threat || patent.decision);
                const detailed = patent.detailedAnalysis || {};
                const relevantParts = Array.isArray(detailed.relevant_parts) ? detailed.relevant_parts : [];
                const irrelevantParts = Array.isArray(detailed.irrelevant_parts) ? detailed.irrelevant_parts : [];
                const noveltyComparison = detailed.novelty_comparison || '';
                const comparisonRows = Array.isArray(patent.comparison_rows) ? patent.comparison_rows : [];

                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="bg-white hover:bg-slate-50/50 transition-colors"
                  >
                    {/* Novelty Line Indicator - Horizontal colored line at top */}
                    <div className="h-1.5 bg-slate-100 relative overflow-hidden">
                      <div 
                        className={`h-full ${lineStyle.color} transition-all duration-500`}
                        style={{ width: `${lineStyle.width}%` }}
                      />
                    </div>
                    
                    <div className="p-5">
                      {/* Header Row */}
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0">
                            {idx + 1}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <a 
                                href={`https://patents.google.com/patent/${(patent.pn || '').replace(/\s+/g, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-sm font-semibold text-slate-900 hover:text-indigo-600 transition-colors"
                              >
                                {patent.pn || 'Unknown PN'}
                              </a>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${threatInfo.color}`}>
                                {threatInfo.text}
                              </span>
                            </div>
                            {patent.title && (
                              <p className="text-sm text-slate-600 mt-1 line-clamp-2">{patent.title}</p>
                            )}
                          </div>
                        </div>
                        
                        {/* Relevance Score */}
                        <div className="text-right flex-shrink-0">
                          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Relevance</div>
                          <div className="text-lg font-bold text-slate-900">{Math.round(lineStyle.relevance * 100)}%</div>
                        </div>
                      </div>

                      {/* Summary */}
                      {(patent.summary || patent.remarks) && (
                        <div className="mb-4 p-3 bg-slate-50 rounded-lg">
                          <p className="text-sm text-slate-700">{patent.summary || patent.remarks}</p>
                        </div>
                      )}

                      {/* Detailed Analysis Section */}
                      {(relevantParts.length > 0 || irrelevantParts.length > 0 || noveltyComparison || comparisonRows.length > 0) && (
                        <details className="group">
                          <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5 select-none">
                            <span>View Detailed Analysis</span>
                            <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </summary>
                          
                          <div className="mt-4 space-y-4">
                            {/* Overlapping Elements */}
                            {relevantParts.length > 0 && (
                              <div className="rounded-lg border border-red-100 bg-red-50/30 p-3">
                                <div className="flex items-center gap-2 text-xs font-medium text-red-700 mb-2">
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                  <span>Overlapping Elements (Action Required)</span>
                                </div>
                                <ul className="space-y-1.5">
                                  {relevantParts.map((part: string, i: number) => (
                                    <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                                      <span className="mt-0.5 flex-shrink-0 text-red-400">-</span>
                                      <span>{part}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Your Differentiators */}
                            {irrelevantParts.length > 0 && (
                              <div className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
                                <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 mb-2">
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                  </svg>
                                  <span>Your Differentiators (Claim Focus Points)</span>
                                </div>
                                <ul className="space-y-1.5">
                                  {irrelevantParts.map((part: string, i: number) => (
                                    <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                                      <span className="mt-0.5 flex-shrink-0 text-emerald-500">+</span>
                                      <span>{part}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Novelty Comparison */}
                            {noveltyComparison && (
                              <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-3">
                                <div className="flex items-center gap-2 text-xs font-medium text-blue-700 mb-2">
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                                  </svg>
                                  <span>Novelty Assessment</span>
                                </div>
                                <p className="text-xs text-slate-700">{noveltyComparison}</p>
                              </div>
                            )}

                            {comparisonRows.length > 0 && (
                              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="min-w-full text-xs">
                                  <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                      <th className="px-3 py-2 text-left font-semibold">KF</th>
                                      <th className="px-3 py-2 text-left font-semibold">Feature</th>
                                      <th className="px-3 py-2 text-left font-semibold">Patent disclosure</th>
                                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                                      <th className="px-3 py-2 text-left font-semibold">Remark</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {comparisonRows.map((row: any, rowIndex: number) => {
                                      const quote = String(row.evidence_quote || row.quote || '').trim();
                                      const status = visibleStatusForReport(row.status, quote);
                                      const professionalRemark = cleanReviewText(row.professional_remark || row.crisp_remark) || crispRemarkForStatus(status);
                                      return (
                                        <tr key={`${row.feature || rowIndex}-${rowIndex}`}>
                                          <td className="px-3 py-2 align-top font-semibold text-indigo-700">{row.feature_id || `KF${rowIndex + 1}`}</td>
                                          <td className="px-3 py-2 align-top text-slate-700">{row.feature}</td>
                                          <td className="px-3 py-2 align-top text-slate-700">
                                            <div>{row.patent_disclosure || '-'}</div>
                                            {quote && (
                                              <div className="mt-1 text-[11px] text-slate-500">
                                                Supporting passage: {quote}
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-3 py-2 align-top">
                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${getThreatLabel(status === 'Present' ? 'anticipates' : status === 'Partial' ? 'partial_novelty' : 'remote').color}`}>
                                              {status}
                                            </span>
                                          </td>
                                          <td className="px-3 py-2 align-top text-slate-700">{professionalRemark}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </details>
                      )}

                      {/* Feature Summary Row */}
                      {(patent.overlap_features?.length > 0 || patent.missing_features?.length > 0) && (
                        <div className="mt-4 flex flex-wrap gap-3 text-[10px]">
                          {patent.overlap_features?.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">Overlapping:</span>
                              <span className="font-medium text-red-600">{patent.overlap_features.length} feature(s)</span>
                            </div>
                          )}
                          {patent.missing_features?.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">Unique to invention:</span>
                              <span className="font-medium text-emerald-600">{patent.missing_features.length} feature(s)</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // Stage 4 Content
  const renderStage4Content = () => {
    const root: any = (searchState.results as any) || {};
    const r = root.stage4 || root;

    if (!r || !hasStage4Results) {
      return (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Final Report Not Generated</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Generate the final novelty assessment report with comprehensive analysis and recommendations.
            </p>
            {canRunCurrent && selectedStageTab === '5' && (
              <Button onClick={handleRunCurrent} className="mt-6 rounded-lg bg-indigo-600 hover:bg-indigo-700">
                <FileText className="w-4 h-4 mr-2" />
                Generate Report
              </Button>
            )}
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        <Stage4ResultsDisplay
          stage4Results={r}
          searchId={searchState.searchId as any}
          onRerun={async () => {
            await executeStage('4');
          }}
          hideIdeaBank={true}
          hidePerPatentRemarks={false}
          hideConsolidatedButton={false}
        />

        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Report actions</div>
              <div className="text-xs text-slate-500">Open the consolidated report for sharing, printing, or saving as PDF.</div>
            </div>
            <Link
              href={`/novelty-search/${searchState.searchId}/consolidated`}
              target="_blank"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Eye className="h-4 w-4" />
              View Full Report
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ============================================================================
  // MAIN RENDER
  // ============================================================================
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex min-h-[calc(100vh-7.5rem)]">
        {activeSearchPath === 'intelligent' && (
          <div className={`${isSidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-[260px]'} hidden flex-shrink-0 transition-all duration-200 lg:block`}>
            <NoveltyStageNav
              selectedStage={selectedStageTab}
              onStageSelect={setSelectedStageTab}
              getStageStatus={getStageStatus}
              isStageCompleted={isStageCompleted}
              onRunStage={runStageForKey}
              activeExecutionStage={activeExecutionStage || (isAutoRunning ? 'auto' : null)}
              searchId={searchState.searchId}
              overallProgress={overallProgress}
              formTitle={formData.title}
              collapsed={isSidebarCollapsed}
              onToggleCollapsed={() => setIsSidebarCollapsed(prev => !prev)}
            />
          </div>
        )}

        <main className="min-w-0 flex-1">
          {activeSearchPath === 'intelligent' && (
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700"
              aria-label="Open workflow navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="text-sm font-medium text-slate-900">{STAGE_TAB_LABELS[selectedStageTab]}</div>
            <div className="h-9 w-9" />
          </div>
          )}

          <div className={`mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 ${activeSearchPath === 'manual' ? 'max-w-6xl' : selectedStageTab === '2' ? 'max-w-7xl' : 'max-w-5xl'}`}>
            {renderSearchPathTabs()}
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-500">Novelty Search Workflow</div>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                    {activeSearchPath === 'manual' ? 'Manual Patent Search' : STAGE_TAB_LABELS[selectedStageTab]}
                  </h1>
                  <div className="mt-1 text-sm text-slate-500">
                    {activeSearchPath === 'manual'
                      ? 'Fielded lookup using exact patent metadata and text filters'
                      : `Stage ${idx + 1} of ${STAGE_TABS.length}`}
                  </div>
                </div>
                {activeSearchPath === 'intelligent' && searchState.searchId && (
                  <Badge variant="outline" className="hidden border-slate-200 bg-white text-slate-600 sm:inline-flex">
                    Search {searchState.searchId.slice(0, 10)}
                  </Badge>
                )}
              </div>
            </motion.div>

            <AnimatePresence mode="wait">
              {activeSearchPath === 'manual' ? (
                <motion.div key="manual" exit={{ opacity: 0, x: -20 }}>
                  {renderManualSearch()}
                </motion.div>
              ) : !searchState.searchId ? (
                <motion.div key="form" exit={{ opacity: 0, x: -20 }}>
                  {renderForm()}
                </motion.div>
              ) : (
                <motion.div key="workflow" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                  {renderProgress()}
                  {renderStageContent()}
                  <NoveltyFloatingButtons
                    onPrevious={prevStage ? handlePrevNav : null}
                    onNext={nextStage ? handleNextNav : null}
                    onRunCurrent={canRunCurrent ? handleRunCurrent : null}
                    previousLabel={prevStage ? STAGE_TAB_LABELS[prevStage] : undefined}
                    nextLabel={nextStage ? STAGE_TAB_LABELS[nextStage] : undefined}
                    currentStageLabel={STAGE_RUN_LABELS[selectedStageTab]}
                    isRunning={!!activeExecutionStage || isAutoRunning}
                    isFailed={isFailedCurrent}
                    disabled={searchState.isLoading || isAutoRunning}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      <AnimatePresence>
        {activeSearchPath === 'intelligent' && isMobileNavOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
            onClick={() => setIsMobileNavOpen(false)}
          >
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="h-full w-[280px] bg-white shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">Workflow</div>
                <button
                  type="button"
                  onClick={() => setIsMobileNavOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
                  aria-label="Close workflow navigation"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <NoveltyStageNav
                selectedStage={selectedStageTab}
                onStageSelect={(stage) => {
                  setSelectedStageTab(stage);
                  setIsMobileNavOpen(false);
                }}
                getStageStatus={getStageStatus}
                isStageCompleted={isStageCompleted}
                onRunStage={runStageForKey}
                activeExecutionStage={activeExecutionStage || (isAutoRunning ? 'auto' : null)}
                searchId={searchState.searchId}
                overallProgress={overallProgress}
                formTitle={formData.title}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={!!selectedEvidence} onOpenChange={(open) => { if (!open) setSelectedEvidence(null); }}>
        {selectedEvidence && (
          <DialogContent className="left-auto right-0 top-0 h-full max-w-xl translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-l border-slate-200 p-0 sm:rounded-none">
            <DialogHeader className="border-b border-slate-200 px-6 py-5 text-left">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div>
                  <DialogTitle className="text-lg font-semibold text-slate-900">Evidence Detail</DialogTitle>
                  <DialogDescription className="mt-1">
                    Patent {selectedEvidence.pn}{selectedEvidence.patentTitle ? ` - ${selectedEvidence.patentTitle}` : ''}
                  </DialogDescription>
                </div>
                <Badge className={`font-medium ${
                  selectedEvidence.status === 'Present' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                  selectedEvidence.status === 'Partial' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                  'bg-rose-50 text-rose-700 border-rose-200'
                }`}>
                  {selectedEvidence.status}
                </Badge>
              </div>
            </DialogHeader>

            <div className="space-y-6 px-6 py-5">
              <section>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Feature</div>
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                  {selectedEvidence.featureId && (
                    <div className="mb-1 text-xs font-semibold text-indigo-600">{selectedEvidence.featureId}</div>
                  )}
                  {selectedEvidence.feature}
                </div>
              </section>

              {(selectedEvidence.userDisclosure || selectedEvidence.patentDisclosure) && (
                <section className="grid gap-3">
                  {selectedEvidence.userDisclosure && (
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Submitted User Idea</div>
                      <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
                        {selectedEvidence.userDisclosure}
                      </div>
                    </div>
                  )}
                  {selectedEvidence.patentDisclosure && (
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Identified Patent Disclosure</div>
                      <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
                        {selectedEvidence.patentDisclosure}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {(selectedEvidence.status === 'Present' || selectedEvidence.status === 'Partial') && selectedEvidence.quote && (
                <section>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Supporting Passage</div>
                  <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
                    "{selectedEvidence.quote}"
                  </div>
                </section>
              )}

              {(selectedEvidence.professionalRemark || selectedEvidence.crispRemark) && (
                <section>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Professional Remark</div>
                  <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm leading-6 text-indigo-950">
                    {selectedEvidence.professionalRemark || selectedEvidence.crispRemark}
                  </div>
                </section>
              )}

              <div className="flex items-center justify-between border-t border-slate-200 pt-4">
                {selectedEvidence.link ? (
                  <a
                    href={selectedEvidence.link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View patent
                  </a>
                ) : (
                  <span />
                )}
                <Button variant="outline" onClick={() => setSelectedEvidence(null)} className="rounded-lg">
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
