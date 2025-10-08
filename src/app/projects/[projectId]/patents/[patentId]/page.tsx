'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import RichTextEditor from '@/components/patents/RichTextEditor'
import FileUpload from '@/components/patents/FileUpload'
import PriorArtSearch from '@/components/prior-art/PriorArtSearch'

interface Patent {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

interface Project {
  id: string
  name: string
}

interface AnnexureVersion {
  id: string
  html: string
  textPlain: string
  rev: number
  createdAt: string
}

type TabType = 'annexure' | 'actions'
type InputMode = 'paste' | 'upload'
type ActionTabType = 'prior-art-search' | 'ai-patent-drafting'

export default function PatentDetailPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params.projectId as string
  const patentId = params.patentId as string

  const [patent, setPatent] = useState<Patent | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('annexure')
  const [activeActionTab, setActiveActionTab] = useState<ActionTabType>('prior-art-search')
  const [inputMode, setInputMode] = useState<InputMode>('paste')
  const [editorContent, setEditorContent] = useState('')
  const [latestAnnexure, setLatestAnnexure] = useState<AnnexureVersion | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      fetchPatent()
      fetchLatestAnnexure()
    }
  }, [authLoading, user, router, projectId, patentId])

  const fetchPatent = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/patents/${patentId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setPatent(data.patent)
        setProject(data.project)
      } else if (response.status === 404) {
        router.push(`/projects/${projectId}/setup`)
      } else {
        console.error('Failed to fetch patent')
        router.push(`/projects/${projectId}/setup`)
      }
    } catch (error) {
      console.error('Failed to fetch patent:', error)
      router.push(`/projects/${projectId}/setup`)
    }
  }

  const fetchLatestAnnexure = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/patents/${patentId}/annexure`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        if (data.annexure) {
          setLatestAnnexure(data.annexure)
          setEditorContent(data.annexure.html)
          setLastSaved(new Date(data.annexure.createdAt))
        }
      }
    } catch (error) {
      console.error('Failed to fetch annexure:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleEditorChange = (html: string) => {
    setEditorContent(html)
    setHasUnsavedChanges(true)
  }

  const handleFileProcessed = (result: { html: string; textContent: string; fileName: string; fileSize: number; warning?: string }) => {
    setEditorContent(result.html)
    setHasUnsavedChanges(true)
    // Show warning if present
    if (result.warning) {
      alert(result.warning)
    }
  }

  const handleSave = async () => {
    if (!editorContent.trim()) {
      alert('Please add some content before saving')
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/patents/${patentId}/annexure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          html: editorContent,
          textPlain: editorContent.replace(/<[^>]*>/g, ''), // Strip HTML for plain text
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setLatestAnnexure(data.annexureVersion)
        setHasUnsavedChanges(false)
        setLastSaved(new Date())
        alert('Annexure saved successfully!')
      } else {
        const error = await response.json()
        alert(`Save failed: ${error.error}`)
      }
    } catch (error) {
      console.error('Save error:', error)
      alert('Failed to save annexure')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDownload = () => {
    if (!editorContent.trim()) {
      alert('Please add some content before downloading')
      return
    }

    // Create HTML content with basic styling
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${patent?.title || 'Patent Annexure'}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      line-height: 1.6;
    }
    h1, h2, h3 {
      color: #333;
      margin-top: 30px;
      margin-bottom: 15px;
    }
    p {
      margin-bottom: 15px;
    }
    ul, ol {
      margin-bottom: 15px;
      padding-left: 30px;
    }
    .header {
      border-bottom: 2px solid #333;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .title {
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 10px;
    }
    .project {
      font-style: italic;
      color: #666;
      margin-bottom: 5px;
    }
    .date {
      font-size: 12px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">${patent?.title || 'Patent Annexure'}</div>
    <div class="project">Project: ${project?.name || 'Unknown'}</div>
    <div class="date">Downloaded on: ${new Date().toLocaleDateString()}</div>
  </div>
  <div class="content">
    ${editorContent}
  </div>
</body>
</html>`

    // Create and download the file
    const blob = new Blob([htmlContent], { type: 'text/html' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.style.display = 'none'
    a.href = url
    a.download = `${patent?.title.replace(/[^a-zA-Z0-9]/g, '_') || 'patent'}_annexure.html`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!user || !patent || !project) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href={`/projects/${projectId}/patents`}
            className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Patents
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{patent.title}</h1>
              <p className="mt-2 text-gray-600">Project: {project.name}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Patent ID: {patent.id}</p>
              {lastSaved && (
                <p className="text-xs text-gray-400">
                  Last saved: {lastSaved.toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6">
          <nav className="flex space-x-8" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('annexure')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'annexure'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Annexure
            </button>
            <button
              onClick={() => setActiveTab('actions')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'actions'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Actions
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'annexure' && (
          <div className="space-y-6">
            {/* Input Mode Toggle */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center space-x-4 mb-6">
                <span className="text-sm font-medium text-gray-700">Add content by:</span>
                <div className="flex rounded-lg border border-gray-300 p-1">
                  <button
                    onClick={() => setInputMode('paste')}
                    className={`px-4 py-2 text-sm font-medium rounded-md ${
                      inputMode === 'paste'
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Pasting Text
                  </button>
                  <button
                    onClick={() => setInputMode('upload')}
                    className={`px-4 py-2 text-sm font-medium rounded-md ${
                      inputMode === 'upload'
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Uploading File
                  </button>
                </div>
              </div>

              {/* Input Area */}
              {inputMode === 'paste' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Paste your patent content below:
                  </label>
                  <RichTextEditor
                    content={editorContent}
                    onChange={handleEditorChange}
                    placeholder="Paste your patent description, claims, or other content here..."
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Upload a document to convert:
                  </label>
                  <FileUpload
                    onFileProcessed={handleFileProcessed}
                    projectId={projectId}
                    patentId={patentId}
                  />
                  {editorContent && (
                    <div className="mt-6">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Converted content (edit as needed):
                      </label>
                      <RichTextEditor
                        content={editorContent}
                        onChange={handleEditorChange}
                        placeholder="Your converted content will appear here..."
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !hasUnsavedChanges}
                    className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSaving ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Saving...
                      </>
                    ) : (
                      'Save'
                    )}
                  </button>

                  {hasUnsavedChanges && (
                    <span className="text-sm text-orange-600 font-medium">
                      You have unsaved changes
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    onClick={handleDownload}
                    disabled={!editorContent.trim()}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download HTML
                  </button>
                </div>
              </div>

              {latestAnnexure && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <p className="text-sm text-gray-600">
                    Current version: {latestAnnexure.rev} (saved {new Date(latestAnnexure.createdAt).toLocaleString()})
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'actions' && (
          <div className="space-y-6">
            {/* Action Sub-tabs */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <nav className="flex space-x-8" aria-label="Action Tabs">
                <button
                  onClick={() => setActiveActionTab('prior-art-search')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeActionTab === 'prior-art-search'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Prior Art Search
                </button>
                <button
                  onClick={() => setActiveActionTab('ai-patent-drafting')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeActionTab === 'ai-patent-drafting'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  AI Patent Drafting
                </button>
              </nav>
            </div>

            {/* Action Sub-tab Content */}
            {activeActionTab === 'prior-art-search' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <PriorArtSearch patentId={patentId} projectId={projectId} />
              </div>
            )}

            {activeActionTab === 'ai-patent-drafting' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="text-center py-12">
                  <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <h3 className="mt-2 text-sm font-medium text-gray-900">AI Patent Drafting</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Use AI to help draft and refine your patent claims and descriptions.
                  </p>
                  <div className="mt-6">
                    <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700">
                      Start AI Drafting
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
