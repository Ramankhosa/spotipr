'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface Patent {
  id: string
  title: string
  status: string
  createdAt: string
  updatedAt: string
}

interface Project {
  id: string
  name: string
  applicantProfile?: {
    id: string
    applicantLegalName: string
  }
}

export default function ProjectPatentsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params.projectId as string
  const [project, setProject] = useState<Project | null>(null)
  const [patents, setPatents] = useState<Patent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasDraftSessions, setHasDraftSessions] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      fetchProjectAndPatents()
    }
  }, [authLoading, user, router, projectId])

  const fetchProjectAndPatents = async () => {
    try {
      // Fetch project details
      const projectResponse = await fetch(`/api/projects/${projectId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (projectResponse.ok) {
        const projectData = await projectResponse.json()
        setProject(projectData.project)
      }

      // Fetch patents for the project
      const patentsResponse = await fetch(`/api/projects/${projectId}/patents`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (patentsResponse.ok) {
        const patentsData = await patentsResponse.json()
        const list: Patent[] = patentsData.patents || []
        setPatents(list)

        // Probe drafting sessions per patent to toggle Resume button
        const sessionsMap: Record<string, boolean> = {}
        await Promise.all(
          list.map(async (p) => {
            try {
              const res = await fetch(`/api/patents/${p.id}/drafting`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
              })
              if (res.ok) {
                const data = await res.json()
                sessionsMap[p.id] = Array.isArray(data.sessions) && data.sessions.length > 0
              } else {
                sessionsMap[p.id] = false
              }
            } catch {
              sessionsMap[p.id] = false
            }
          })
        )
        setHasDraftSessions(sessionsMap)
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
      router.push('/dashboard')
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
      <div className="max-w-6xl mx-auto py-16 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center text-gpt-gray-600 hover:text-gpt-gray-900 mb-4"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gpt-gray-900">
                Patents for "{project.name}"
              </h1>
              <p className="mt-2 text-gpt-gray-600">
                Manage all patent applications in this project
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/patents/new`}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Patent
            </Link>
          </div>
        </div>

        {/* Patents List */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {patents.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="text-gpt-gray-500 mb-4">
                <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gpt-gray-900 mb-2">No patents yet</h3>
              <p className="text-gpt-gray-600 mb-6">
                Get started by creating your first patent application.
              </p>
              <Link
                href={`/projects/${projectId}/patents/new`}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500"
              >
                Create First Patent
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-gpt-gray-200">
              {patents.map((patent) => (
                <div key={patent.id} className="px-6 py-4 hover:bg-gpt-gray-50 transition-colors duration-150">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <div className={`w-3 h-3 rounded-full ${
                          patent.status === 'draft' ? 'bg-yellow-400' :
                          patent.status === 'completed' ? 'bg-green-400' : 'bg-gray-400'
                        }`}></div>
                        <Link
                          href={`/projects/${projectId}/patents/${patent.id}`}
                          className="text-lg font-medium text-gpt-gray-900 hover:text-gpt-blue-600 transition-colors"
                        >
                          {patent.title}
                        </Link>
                      </div>
                      <div className="mt-2 flex items-center space-x-4 text-sm text-gpt-gray-500">
                        <span>Status: <span className="capitalize font-medium">{patent.status}</span></span>
                        <span>Created: {new Date(patent.createdAt).toLocaleDateString()}</span>
                        <span>Last updated: {new Date(patent.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex space-x-3">
                      <Link
                        href={`/projects/${projectId}/patents/${patent.id}`}
                        className="inline-flex items-center px-3 py-2 border border-gpt-gray-300 text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                      >
                        View Details
                      </Link>
                      <Link
                        href={`/projects/${projectId}/patents/${patent.id}?tab=actions&action=prior-art-search`}
                        className="inline-flex items-center px-3 py-2 border border-gpt-gray-300 text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                        title="Open the Prior Art Search tools"
                      >
                        Prior Art Search
                      </Link>
                      <Link
                        href={`/patents/${patent.id}/draft`}
                        className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200"
                        title="Start a new drafting session (or continue)"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        Start Draft
                      </Link>
                      {hasDraftSessions[patent.id] && (
                        <Link
                          href={`/patents/${patent.id}/draft`}
                          className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200"
                          title="Resume the latest drafting session"
                        >
                          Resume Draft
                        </Link>
                      )}
                      <Link
                        href={`/projects/${projectId}/patents/${patent.id}`}
                        className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                      >
                        Edit Patent
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        {patents.length > 0 && (
          <div className="mt-8 grid md:grid-cols-3 gap-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center mb-4">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gpt-gray-900">Manage Collaborators</h3>
              </div>
              <p className="text-sm text-gpt-gray-600 mb-4">
                Add or remove team members from this project.
              </p>
              <Link
                href={`/projects/${projectId}/setup`}
                className="w-full inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700"
              >
                Manage Team
              </Link>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center mb-4">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gpt-gray-900">Applicant Profile</h3>
              </div>
              <p className="text-sm text-gpt-gray-600 mb-4">
                Set up organization details for patent filings.
              </p>
              <Link
                href={`/projects/${projectId}/applicant`}
                className="w-full inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700"
              >
                {project.applicantProfile ? 'Edit Profile' : 'Setup Profile'}
              </Link>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center mb-4">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mr-3">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gpt-gray-900">Project Settings</h3>
              </div>
              <p className="text-sm text-gpt-gray-600 mb-4">
                Configure project settings and preferences.
              </p>
              <Link
                href={`/projects/${projectId}/setup`}
                className="w-full inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-purple-600 hover:bg-purple-700"
              >
                Project Settings
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
