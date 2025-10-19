'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface Collaborator {
  id: string
  role: string
  user: {
    id: string
    name: string | null
    email: string
  }
}

interface ApplicantProfile {
  id: string
  applicantLegalName: string
  applicantAddress: string | null
  applicantPhone: string | null
  applicantEmail: string | null
}

interface Patent {
  id: string
  title: string
  status: string
  createdAt: string
}

interface Project {
  id: string
  name: string
  createdAt: string
  applicantProfile?: ApplicantProfile
  collaborators?: Collaborator[]
  patents?: Patent[]
}

export default function ProjectDashboardPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params.projectId as string
  const [project, setProject] = useState<Project | null>(null)
  const [patents, setPatents] = useState<Patent[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      fetchProject()
      fetchPatents()
    }
  }, [authLoading, user, router, projectId])

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
      } else {
        console.error('Failed to fetch project')
        router.push('/dashboard')
      }
    } catch (error) {
      console.error('Failed to fetch project:', error)
      router.push('/dashboard')
    }
  }

  const fetchPatents = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/patents`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setPatents(data.patents || [])
      }
    } catch (error) {
      console.error('Failed to fetch patents:', error)
    } finally {
      setIsLoading(false)
    }
  }

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
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gpt-gray-900">{project.name}</h1>
              <p className="text-gpt-gray-600 mt-2">
                Created {new Date(project.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex space-x-3">
              <Link
                href={`/projects/${projectId}/setup`}
                className="inline-flex items-center px-4 py-2 border border-gpt-gray-300 text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Manage Project
              </Link>
              <Link
                href={`/projects/${projectId}/patents/new`}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-green-600 hover:bg-gpt-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-green-500 transition-all duration-200"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add Patent
              </Link>
              {!project.applicantProfile && (
                <Link
                  href={`/projects/${projectId}/applicant`}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                  title="Set up organization details for patent filings"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Add Profile
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gpt-blue-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-gpt-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gpt-gray-600">Patents</p>
                <p className="text-2xl font-semibold text-gpt-gray-900">{patents.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gpt-green-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-gpt-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gpt-gray-600">Collaborators</p>
                <p className="text-2xl font-semibold text-gpt-gray-900">{project.collaborators?.length || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gpt-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-gpt-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gpt-gray-600">Applicant Profile</p>
                <p className="text-2xl font-semibold text-gpt-gray-900">{project.applicantProfile ? 'Set' : 'Not Set'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="space-y-8">
          {/* Patents Section */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="px-6 py-4 border-b border-gpt-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gpt-gray-900">Patents</h2>
                <Link
                  href={`/projects/${projectId}/patents/new`}
                  className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  New Patent
                </Link>
              </div>
              {/* Quick actions for the most recent patent */}
              {patents.length > 0 && (
                <div className="mt-3 flex items-center space-x-2 text-sm">
                  <span className="text-gpt-gray-600">Quick actions:</span>
                  <Link
                    href={`/projects/${projectId}/patents/${patents[0].id}?tab=actions&action=prior-art-search`}
                    className="inline-flex items-center px-2.5 py-1 border border-gpt-gray-300 rounded text-gpt-gray-700 bg-white hover:bg-gpt-gray-50"
                  >
                    Prior Art Search
                  </Link>
                  <Link
                    href={`/patents/${patents[0].id}/draft`}
                    className="inline-flex items-center px-2.5 py-1 border border-transparent rounded text-white bg-indigo-600 hover:bg-indigo-700"
                  >
                    Start Draft
                  </Link>
                  <Link
                    href={`/patents/${patents[0].id}/draft`}
                    className="inline-flex items-center px-2.5 py-1 border border-transparent rounded text-white bg-gpt-blue-600 hover:bg-gpt-blue-700"
                  >
                    Resume Draft
                  </Link>
                </div>
              )}
            </div>

            <div className="p-6">
              {patents.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-gpt-gray-400 mb-4">
                    <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gpt-gray-900 mb-2">No patents yet</h3>
                  <p className="text-gpt-gray-600 mb-4">
                    Start by creating your first patent application.
                  </p>
                  <Link
                    href={`/projects/${projectId}/patents/new`}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500"
                  >
                    Create First Patent
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {patents.slice(0, 5).map((patent) => (
                    <div key={patent.id} className="flex items-center justify-between p-4 border border-gpt-gray-200 rounded-lg hover:bg-gpt-gray-50 transition-colors">
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gpt-gray-900">{patent.title}</h4>
                        <p className="text-xs text-gpt-gray-500">
                          Status: {patent.status} • Created {new Date(patent.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/projects/${projectId}/patents/${patent.id}`}
                          className="inline-flex items-center px-3 py-1 border border-gpt-gray-300 text-sm font-medium rounded text-gpt-gray-700 bg-white hover:bg-gpt-gray-50"
                        >
                          View
                        </Link>
                        <Link
                          href={`/projects/${projectId}/patents/${patent.id}?tab=actions&action=prior-art-search`}
                          className="inline-flex items-center px-3 py-1 border border-gpt-gray-300 text-sm font-medium rounded text-gpt-gray-700 bg-white hover:bg-gpt-gray-50"
                        >
                          Prior Art
                        </Link>
                        <Link
                          href={`/patents/${patent.id}/draft`}
                          className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
                        >
                          Start Draft
                        </Link>
                        <Link
                          href={`/patents/${patent.id}/draft`}
                          className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded text-white bg-gpt-blue-600 hover:bg-gpt-blue-700"
                        >
                          Resume
                        </Link>
                      </div>
                    </div>
                  ))}
                  {patents.length > 5 && (
                    <div className="text-center pt-4">
                      <Link
                        href={`/projects/${projectId}/patents`}
                        className="text-gpt-blue-600 hover:text-gpt-blue-800 text-sm font-medium"
                      >
                        View all {patents.length} patents →
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Collaborators Section */}
        {project.collaborators && project.collaborators.length > 0 && (
          <div className="mt-8 bg-white rounded-lg shadow-sm">
            <div className="px-6 py-4 border-b border-gpt-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gpt-gray-900">
                  Collaborators ({project.collaborators.length})
                </h2>
                <Link
                  href={`/projects/${projectId}/setup`}
                  className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded text-gpt-blue-600 hover:text-gpt-blue-800"
                >
                  Manage
                </Link>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {project.collaborators.map((collaborator) => (
                  <div key={collaborator.id} className="flex items-center p-3 bg-gpt-gray-50 rounded-lg">
                    <div className="w-8 h-8 bg-gpt-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      {collaborator.user.name?.charAt(0) || collaborator.user.email.charAt(0) || 'U'}
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gpt-gray-900">
                        {collaborator.user.name || collaborator.user.email}
                      </p>
                      <p className="text-xs text-gpt-gray-500">{collaborator.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Back to Dashboard */}
        <div className="mt-8 text-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
