'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'

interface Project {
  id: string
  name: string
  applicantProfile?: {
    applicantLegalName: string
  }
}

export default function NewPatentDraftPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [patentTitle, setPatentTitle] = useState('')
  const [rawIdea, setRawIdea] = useState('')
  const [areaOfInvention, setAreaOfInvention] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      fetchProjects()
    }
  }, [authLoading, user, router])

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setProjects(data.projects || [])
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['text/plain']
    if (!allowedTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.txt')) {
      setError('Please upload a plain text (.txt) file. Word documents (.docx) are not supported yet.')
      return
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      setError('File size must be less than 5MB')
      return
    }

    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const content = e.target?.result as string

        if (!content) {
          setError('File appears to be empty')
          return
        }

        // Clean the content to remove BOM and normalize line endings
        const cleanContent = content
          .replace(/^\uFEFF/, '') // Remove BOM
          .replace(/\r\n/g, '\n') // Normalize Windows line endings
          .replace(/\r/g, '\n')   // Normalize Mac line endings
          .trim() // Remove leading/trailing whitespace

        if (cleanContent.length === 0) {
          setError('File appears to be empty or contains no readable text')
          return
        }

    if (cleanContent.length > 5000) {
      setError('File content exceeds 5,000 characters. Please reduce the file size or split into smaller sections.')
      return
    }

        // Basic validation - check if content looks like text
        const nonPrintableChars = (cleanContent.match(/[^\x20-\x7E\n\t]/g) || []).length
        const nonPrintableRatio = nonPrintableChars / cleanContent.length

        if (nonPrintableRatio > 0.1 && cleanContent.length > 100) {
          setError('File appears to contain binary data or is not a plain text file. Please use a .txt file.')
          return
        }

        setRawIdea(cleanContent)
        setError(null)

      } catch (error) {
        console.error('File processing error:', error)
        setError('Failed to process file. Please check the file format and try again.')
      }
    }

    reader.onerror = () => {
      setError('Failed to read file. Please check the file format and try again.')
    }

    reader.onabort = () => {
      setError('File reading was aborted. Please try again.')
    }

    // Read as text with UTF-8 encoding
    reader.readAsText(file, 'UTF-8')
  }

  const handleCreateDraft = async () => {
    if (!selectedProject || !patentTitle.trim()) {
      setError('Please select a project and enter a patent title')
      return
    }

    if (!rawIdea.trim()) {
      setError('Please provide an invention description or upload a file')
      return
    }

    if (rawIdea.length > 5000) {
      setError('Description exceeds 5,000 character limit. Please shorten your text.')
      return
    }

    // Validate title length
    const titleWords = patentTitle.trim().split(/\s+/).length
    if (titleWords > 15) {
      setError('Title must be 15 words or less')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      // First create a basic patent record
      const patentResponse = await fetch(`/api/projects/${selectedProject}/patents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          title: patentTitle.trim(),
          description: 'Created for patent drafting workflow'
        })
      })

      if (!patentResponse.ok) {
        throw new Error('Failed to create patent')
      }

      const patentData = await patentResponse.json()
      const patentId = patentData.patent.id

      // Start drafting session and normalize idea
      const draftingResponse = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'start_session'
        })
      })

      if (!draftingResponse.ok) {
        throw new Error('Failed to start drafting session')
      }

      // Normalize the idea
      const normalizeResponse = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'normalize_idea',
          sessionId: (await draftingResponse.json()).session.id,
          rawIdea: rawIdea.trim(),
          title: patentTitle.trim(),
          areaOfInvention: areaOfInvention.trim() || undefined
        })
      })

      if (!normalizeResponse.ok) {
        throw new Error('Failed to normalize idea')
      }

      // Redirect to the drafting page (already on component planner stage)
      router.push(`/patents/${patentId}/draft`)

    } catch (error) {
      console.error('Failed to create patent draft:', error)
      setError(error instanceof Error ? error.message : 'Failed to start patent draft. Please try again.')
    } finally {
      setIsCreating(false)
    }
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-16 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Start Patent Drafting</h1>
            <p className="text-lg text-gray-600">
              Enter your invention details and let AI create a complete patent draft
            </p>
          </div>
        </div>

        {/* Main Form */}
        <div className="bg-white rounded-lg shadow-sm p-8">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {/* Project Selection */}
            <div>
              <label htmlFor="project" className="block text-sm font-medium text-gray-700 mb-2">
                Select Project <span className="text-red-500">*</span>
              </label>
              <select
                id="project"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              >
                <option value="">Choose a project...</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {project.applicantProfile && ` - ${project.applicantProfile.applicantLegalName}`}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-sm text-gray-500">
                The patent will be associated with this project
              </p>
            </div>

            {/* Patent Title */}
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                Patent Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="title"
                value={patentTitle}
                onChange={(e) => setPatentTitle(e.target.value)}
                placeholder="Enter a descriptive title for your patent"
                className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
              <p className="mt-1 text-sm text-gray-500">
                {patentTitle.trim().split(/\s+/).length} words (max 15) • This will be the title of your patent application
              </p>
            </div>

            {/* Fields of Invention (optional) */}
            <div>
              <label htmlFor="area" className="block text-sm font-medium text-gray-700 mb-2">
                Fields of invention (optional)
              </label>
              <input
                type="text"
                id="area"
                value={areaOfInvention}
                onChange={(e) => setAreaOfInvention(e.target.value)}
                placeholder="e.g., AI; IoT; Medical device; Genetics; Materials; Nanotech"
                className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                maxLength={120}
              />
              <p className="mt-1 text-sm text-gray-500">
                We’ll inject this into the prompt so the AI uses domain‑specific expertise. Separate multiple areas with commas/semicolons.
              </p>
            </div>

            {/* Invention Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Invention Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="description"
                value={rawIdea}
                onChange={(e) => setRawIdea(e.target.value)}
                rows={8}
                placeholder="Describe your invention in detail. Include the problem it solves, how it works, key components, advantages, and any specific embodiments..."
                className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-vertical"
                required
              />
              <p className={`mt-1 text-sm ${rawIdea.length > 5000 ? 'text-red-600' : rawIdea.length > 4500 ? 'text-orange-600' : 'text-gray-500'}`}>
                {rawIdea.length} characters (max 5,000)
                {rawIdea.length > 4500 && rawIdea.length <= 5000 && ' - Approaching limit'}
                {rawIdea.length > 5000 && ' - Exceeds limit!'}
              </p>
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Or upload a text file
              </label>
              <input
                type="file"
                accept=".txt"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
              <p className="mt-1 text-sm text-gray-500">
                Supported format: .txt files only (max 5MB, 5,000 characters)
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Note: Word documents (.docx) and PDFs are not supported yet. To convert:
              </p>
              <ul className="mt-1 text-xs text-gray-400 list-disc list-inside">
                <li>In Word: File → Save As → Plain Text (.txt)</li>
                <li>In Google Docs: File → Download → Plain text (.txt)</li>
              </ul>
              <p className="mt-1 text-xs text-blue-600">
                💡 Tip: If you upload a file, it will replace any text you've entered above
              </p>
            </div>

            {/* Info Cards */}
            <div className="grid md:grid-cols-3 gap-4 mt-8">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <h3 className="text-sm font-medium text-blue-800">AI-Powered</h3>
                </div>
                <p className="text-sm text-blue-700">
                  Advanced AI analyzes your invention and structures it for patent drafting
                </p>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <svg className="w-5 h-5 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-sm font-medium text-green-800">IPO Compliant</h3>
                </div>
                <p className="text-sm text-green-700">
                  Generates complete Indian patent annexures following IPO Form-2 requirements
                </p>
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <svg className="w-5 h-5 text-purple-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  <h3 className="text-sm font-medium text-purple-800">8-Stage Process</h3>
                </div>
                <p className="text-sm text-purple-700">
                  Step-by-step workflow from idea to complete patent draft with figure integration
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
              <Link
                href="/dashboard"
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Cancel
              </Link>
              <button
                onClick={handleCreateDraft}
                disabled={isCreating || !selectedProject || !patentTitle.trim()}
                className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-3"></div>
                    Creating...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Create Patent Draft
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Projects List */}
        {projects.length === 0 && (
          <div className="mt-8 text-center">
            <p className="text-gray-600 mb-4">
              You need to create a project first before starting patent drafting.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Create Project
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
