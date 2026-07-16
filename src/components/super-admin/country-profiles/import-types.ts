/**
 * Client-side mirrors of the import/readiness API payload shapes.
 * (Kept separate so client components never import server-only modules.)
 */

export interface ImportIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  sectionId?: string
  candidates?: string[]
  suggestion?: string
}

export interface DerivedMapping {
  countryCode: string
  structureId: string
  sectionKey: string
  supersetCode: string
  heading: string
  displayOrder: number
  isRequired: boolean
  isEnabled: boolean
}

export interface MappingUpdate {
  sectionKey: string
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export interface ImportPlan {
  countryCode: string
  countryName: { op: 'create' | 'update' | 'unchanged'; name: string; continent: string }
  profile: { op: 'create' | 'update' | 'unchanged'; fromVersion?: number; toVersion: number; status: string }
  mappings: {
    create: DerivedMapping[]
    update: MappingUpdate[]
    unchanged: string[]
    extra: string[]
  }
  prompts: { create: string[]; update: string[]; unchanged: string[]; skipped: string[] }
  styles: {
    diagramConfig: 'create' | 'update' | 'skip'
    diagramHints: number
    exportConfigs: Array<{ documentTypeId: string; op: 'create' | 'update' }>
    exportHeadings: number
    sectionValidations: Array<{ sectionKey: string; op: 'create' | 'update' }>
    crossValidations: Array<{ checkId: string; op: 'create' | 'update' }>
  }
  issues: ImportIssue[]
}

export interface ReadinessCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail?: string
}

export interface CountryReadiness {
  countryCode: string
  ready: boolean
  profileStatus: string | null
  checks: ReadinessCheck[]
}

export function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('auth_token') : ''}`
  }
}
