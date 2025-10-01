'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface Project {
  id: string
  name: string
  createdAt: string
  collaborators?: {
    id: string
    role: string
    user: {
      id: string
      name: string | null
      email: string
    }
  }[]
}

export default function NewPatentPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params.projectId as string
  const [project, setProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [patentTitle, setPatentTitle] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      fetchProject()
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
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreatePatent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patentTitle.trim()) return

    setIsCreating(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/patents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ title: patentTitle.trim() }),
      })

      if (response.ok) {
        const data = await response.json()
        router.push(`/projects/${projectId}/patents/${data.patent.id}`)
      } else {
        const error = await response.text()
        console.error('Failed to create patent:', error)
        alert('Failed to create patent. Please try again.')
      }
    } catch (error) {
      console.error('Failed to create patent:', error)
      alert('Failed to create patent.')
    } finally {
      setIsCreating(false)
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
      <div className="max-w-3xl mx-auto py-16 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href={`/projects/${projectId}/setup`}
            className="inline-flex items-center text-gpt-gray-600 hover:text-gpt-gray-900 mb-4"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Project Setup
          </Link>
          <h1 className="text-3xl font-bold text-gpt-gray-900">
            Add Patent to "{project.name}"
          </h1>
          <p className="mt-2 text-gpt-gray-600">
            Create your first patent application for this project.
          </p>
        </div>

        {/* Patent Creation Form */}
        <div className="bg-white rounded-lg shadow-sm p-8">
          <form onSubmit={handleCreatePatent} className="space-y-6">
            <div>
              <label htmlFor="patentTitle" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Patent Title *
              </label>
              <input
                id="patentTitle"
                type="text"
                value={patentTitle}
                onChange={(e) => setPatentTitle(e.target.value)}
                placeholder="Enter your patent title"
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              <p className="mt-2 text-sm text-gpt-gray-500">
                This will be the title of your patent application.
              </p>
            </div>

            <div className="flex justify-end space-x-3">
              <Link
                href={`/projects/${projectId}/setup`}
                className="inline-flex items-center px-4 py-2 border border-gpt-gray-300 text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-gray-500 transition-all duration-200"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={isCreating || !patentTitle.trim()}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {isCreating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Creating Patent...
                  </>
                ) : (
                  'Create Patent'
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Info Section */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800">
                What happens next?
              </h3>
              <div className="mt-2 text-sm text-blue-700">
                <p>
                  After creating your patent, you'll be able to:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>Add invention details and description</li>
                  <li>Upload patent drawings and figures</li>
                  <li>Generate patent claims</li>
                  <li>Prepare for filing</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
