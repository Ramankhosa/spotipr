'use client'

/**
 * Applicant profile — the project-level identity every filing form inherits.
 *
 * This page is reached from two directions: from the project workspace, and mid-task from a
 * patent's Filing tab when the applicant, signatory or address for service is still missing.
 * In the second case the attorney is in the middle of producing a bundle, so `?returnTo=`
 * carries the way back and both the header button and a successful save use it. Without it
 * a save used to land on the dashboard, which threw away whatever the attorney was doing.
 */

import { useState, useEffect, Suspense } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { ApplicantProfileForm } from '@/components/ApplicantProfileForm'

interface Project {
  id: string
  name: string
  applicantProfile?: {
    id: string
    applicantLegalName: string
    applicantCategory: string
    applicantNationality?: string
    signatoryName?: string
    signatoryDesignation?: string
    signatoryMobile?: string
    signatoryEmail?: string
    applicantAddressLine1: string
    applicantAddressLine2?: string
    applicantCity: string
    applicantState: string
    applicantCountryCode: string
    applicantPostalCode: string
    correspondenceName: string
    correspondenceEmail: string
    correspondencePhone: string
    correspondenceAddressLine1: string
    correspondenceAddressLine2?: string
    correspondenceCity: string
    correspondenceState: string
    correspondenceCountryCode: string
    correspondencePostalCode: string
    useAgent: boolean
    agentName?: string
    agentRegistrationNo?: string
    agentEmail?: string
    agentPhone?: string
    agentAddressLine1?: string
    agentAddressLine2?: string
    agentCity?: string
    agentState?: string
    agentCountryCode?: string
    agentPostalCode?: string
    defaultJurisdiction: string
    defaultRoute: string
    defaultLanguage: string
    defaultEntityStatusIn: string
  }
}

/**
 * Only same-origin, in-app paths are followed. A protocol-relative or absolute URL in the
 * query string would otherwise turn a save into an open redirect.
 */
function safeReturnTo(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

function ApplicantProfilePageInner() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const projectId = params?.projectId as string

  const [project, setProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const returnTo = safeReturnTo(searchParams?.get('returnTo') ?? null)
  const destination = returnTo || `/projects/${projectId}`
  const cameFromFiling = Boolean(returnTo?.includes('/filing'))

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
    }
  }, [authLoading, user, router])

  useEffect(() => {
    if (!authLoading && user && projectId) {
      const fetchProject = async () => {
        try {
          const response = await fetch(`/api/projects/${projectId}`, {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            }
          })
          if (response.ok) {
            const data = await response.json()
            setProject(data.project)
          } else if (response.status === 404) {
            router.push('/dashboard')
          }
        } catch (error) {
          console.error('Failed to fetch project:', error)
          router.push('/dashboard')
        } finally {
          setIsLoading(false)
        }
      }
      fetchProject()
    }
  }, [authLoading, user, projectId, router])

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gpt-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gpt-blue-600"></div>
      </div>
    )
  }

  if (!user || !project) {
    return null
  }

  return (
    <div className="min-h-screen bg-gpt-gray-50">
      <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-3xl font-bold text-gpt-gray-900">Applicant Profile</h1>
              <p className="mt-2 text-gpt-gray-600">
                Configure the applicant details for project: <span className="font-medium">{project.name}</span>
              </p>
              {cameFromFiling && (
                <p className="mt-3 inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  The filing forms print these details. Save and you will be taken straight back to the filing.
                </p>
              )}
            </div>
            <button
              onClick={() => router.push(destination)}
              className="inline-flex shrink-0 items-center gap-1.5 px-4 py-2 border border-gpt-gray-300 text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
            >
              <ArrowLeft className="w-4 h-4" />
              {cameFromFiling ? 'Back to filing' : 'Back to project'}
            </button>
          </div>
        </div>

        {/* Form */}
        <ApplicantProfileForm
          projectId={projectId}
          initialData={project.applicantProfile ? {
            ...project.applicantProfile,
            applicantCategory: project.applicantProfile.applicantCategory as any,
            defaultJurisdiction: project.applicantProfile.defaultJurisdiction as any,
            defaultRoute: project.applicantProfile.defaultRoute as any,
            defaultEntityStatusIn: project.applicantProfile.defaultEntityStatusIn as any,
          } : undefined}
          onSuccess={() => router.push(destination)}
        />
      </div>
    </div>
  )
}

export default function ApplicantProfilePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gpt-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gpt-blue-600"></div>
      </div>
    }>
      <ApplicantProfilePageInner />
    </Suspense>
  )
}
