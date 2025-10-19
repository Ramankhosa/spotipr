'use client'

import { useState, useEffect } from 'react'

interface IdeaEntryStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

export default function IdeaEntryStage({ session, patent, onComplete, onRefresh }: IdeaEntryStageProps) {
  const [normalizedData, setNormalizedData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNormalized, setShowNormalized] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  // Editable fields
  const [problem, setProblem] = useState('')
  const [objectives, setObjectives] = useState('')
  const [logic, setLogic] = useState('')
  const [bestMethod, setBestMethod] = useState('')
  const [components, setComponents] = useState<any[]>([])

  // Use data from existing idea record
  const rawIdea = session?.ideaRecord?.rawInput || ''
  const title = session?.ideaRecord?.title || ''

  // Load normalized data on component mount
  useEffect(() => {
    if (session?.ideaRecord?.normalizedData) {
      setNormalizedData({
        normalizedData: session.ideaRecord.normalizedData,
        extractedFields: {
          problem: session.ideaRecord.problem,
          objectives: session.ideaRecord.objectives,
          components: session.ideaRecord.components,
          logic: session.ideaRecord.logic,
          inputs: session.ideaRecord.inputs,
          outputs: session.ideaRecord.outputs,
          variants: session.ideaRecord.variants,
          bestMethod: session.ideaRecord.bestMethod
        }
      })
      setShowNormalized(true)

      // Initialize editable state
      setProblem(session.ideaRecord.problem || '')
      setObjectives(session.ideaRecord.objectives || '')
      setLogic(session.ideaRecord.logic || '')
      setBestMethod(session.ideaRecord.bestMethod || '')
      setComponents(Array.isArray(session.ideaRecord.components) ? session.ideaRecord.components : [])
    }
  }, [session])

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      setError('File size must be less than 5MB')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      // Clean the content to remove BOM and normalize line endings
      const cleanContent = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

      if (cleanContent.length > 50000) {
        setError('File content exceeds 50,000 characters. Please reduce the file size or split into smaller sections.')
        return
      }

      if (cleanContent.length === 0) {
        setError('File appears to be empty or unreadable')
        return
      }

      setRawIdea(cleanContent)
      setError(null) // Clear any previous errors
    }

    reader.onerror = () => {
      setError('Failed to read file. Please check the file format and try again.')
    }

    reader.readAsText(file, 'UTF-8')
  }

  const canProceed = normalizedData && normalizedData.extractedFields

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 1: Idea Review</h2>
        <p className="text-gray-600">
          Review the AI-normalized structure of your invention idea.
        </p>
      </div>

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

      <div className="max-w-4xl mx-auto">
        {/* Original Input Display */}
        <div className="mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-3">Your Original Input</h3>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="mb-3">
              <span className="font-medium text-gray-700">Title:</span>
              <p className="mt-1 text-gray-900">{title}</p>
            </div>
            <div>
              <span className="font-medium text-gray-700">Description:</span>
              <div className="mt-1 max-h-32 overflow-y-auto bg-white p-3 rounded border text-sm text-gray-700">
                {rawIdea}
              </div>
            </div>
          </div>
        </div>

        {/* AI-Normalized Results */}
        {showNormalized && normalizedData && (
          <div className="bg-blue-50 rounded-lg p-6">
            <div className="flex items-center mb-4">
              <svg className="w-6 h-6 text-blue-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <h3 className="text-lg font-medium text-blue-900">AI-Normalized Structure</h3>
              <div className="ml-auto">
                <button
                  onClick={() => setIsEditing((v) => !v)}
                  className="inline-flex items-center px-3 py-1 border border-blue-300 text-sm font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50"
                >
                  {isEditing ? 'Stop Editing' : 'Edit'}
                </button>
              </div>
            </div>

            {/* Vertically stacked tiles for readability */}
            <div className="space-y-6">
              <div className="bg-white p-4 rounded border">
                <h4 className="font-medium text-blue-800 mb-2">Problem Statement</h4>
                {isEditing ? (
                  <textarea
                    className="w-full text-sm text-blue-700 bg-white p-3 rounded border"
                    rows={4}
                    value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                    onInput={(e: any) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }}
                  />
                ) : (
                  <p className="text-sm text-blue-700 bg-white p-3 rounded border whitespace-pre-wrap">
                    {problem || 'Not specified'}
                  </p>
                )}
              </div>

              <div className="bg-white p-4 rounded border">
                <h4 className="font-medium text-blue-800 mb-2">Objectives</h4>
                {isEditing ? (
                  <textarea
                    className="w-full text-sm text-blue-700 bg-white p-3 rounded border"
                    rows={3}
                    value={objectives}
                    onChange={(e) => setObjectives(e.target.value)}
                    onInput={(e: any) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }}
                  />
                ) : (
                  <p className="text-sm text-blue-700 bg-white p-3 rounded border whitespace-pre-wrap">
                    {objectives || 'Not specified'}
                  </p>
                )}
              </div>

              <div className="bg-white p-4 rounded border">
                <h4 className="font-medium text-blue-800 mb-2">Technical Logic</h4>
                {isEditing ? (
                  <textarea
                    className="w-full text-sm text-blue-700 bg-white p-3 rounded border"
                    rows={4}
                    value={logic}
                    onChange={(e) => setLogic(e.target.value)}
                    onInput={(e: any) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }}
                  />
                ) : (
                  <p className="text-sm text-blue-700 bg-white p-3 rounded border whitespace-pre-wrap">
                    {logic || 'Not specified'}
                  </p>
                )}
              </div>

              <div className="bg-white p-4 rounded border">
                <h4 className="font-medium text-blue-800 mb-2">Key Components ({components?.length || 0})</h4>
                <div>
                  {components?.length > 0 ? (
                    <ul className="text-sm text-blue-700 space-y-2">
                      {components.map((comp: any, idx: number) => (
                        <li key={idx} className="flex items-center space-x-2">
                          {isEditing ? (
                            <>
                              <input
                                className="flex-1 border rounded px-2 py-1"
                                value={comp.name || ''}
                                onChange={(e) => {
                                  const arr = [...components]
                                  arr[idx] = { ...arr[idx], name: e.target.value }
                                  setComponents(arr)
                                }}
                              />
                              <input
                                className="w-40 border rounded px-2 py-1"
                                value={comp.type || ''}
                                onChange={(e) => {
                                  const arr = [...components]
                                  arr[idx] = { ...arr[idx], type: e.target.value }
                                  setComponents(arr)
                                }}
                              />
                            </>
                          ) : (
                            <>
                              <span className="font-medium flex-1">{comp.name}</span>
                              <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded">
                                {(comp.type || '').toString().replace('_', ' ').toLowerCase()}
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-blue-600">No components identified</p>
                  )}
                </div>
              </div>

              <div className="bg-white p-4 rounded border">
                <h4 className="font-medium text-blue-800 mb-2">Best Method</h4>
                {isEditing ? (
                  <textarea
                    className="w-full text-sm text-blue-700 bg-white p-3 rounded border"
                    rows={3}
                    value={bestMethod}
                    onChange={(e) => setBestMethod(e.target.value)}
                    onInput={(e: any) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }}
                  />
                ) : (
                  <p className="text-sm text-blue-700 bg-white p-3 rounded border whitespace-pre-wrap">
                    {bestMethod || 'Not specified'}
                  </p>
                )}
              </div>
            </div>

            {isEditing && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={async () => {
                    try {
                      await onComplete({
                        action: 'update_idea_record',
                        sessionId: session?.id,
                        patch: {
                          problem,
                          objectives,
                          logic,
                          bestMethod,
                          components
                        }
                      })
                      setShowNormalized(true)
                      setIsEditing(false)
                      onRefresh()
                    } catch (err) {
                      console.error('Failed to save edits:', err)
                      setError('Failed to save edits')
                    }
                  }}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  Save Edits
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-8 pt-6 border-t border-gray-200">
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-600">
            Review the AI-normalized structure and proceed to component planning
          </div>
          <button
            onClick={async () => {
              try {
                await onComplete({
                  action: 'proceed_to_components',
                  sessionId: session?.id
                });
                onRefresh(); // Refresh to show new stage
              } catch (error) {
                console.error('Failed to proceed:', error);
              }
            }}
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Continue to Components
            <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
