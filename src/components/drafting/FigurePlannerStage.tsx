'use client'

import { useState } from 'react'

interface FigurePlannerStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

type LLMFigure = {
  title: string
  purpose: string
  plantuml: string
}

export default function FigurePlannerStage({ session, patent, onComplete, onRefresh }: FigurePlannerStageProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [figures, setFigures] = useState<LLMFigure[]>([])
  const [error, setError] = useState<string | null>(null)
  const diagramSources = session?.diagramSources || []
  const figurePlans = session?.figurePlans || []
  const [isUploading, setIsUploading] = useState(false)
  const [uploaded, setUploaded] = useState<Record<number, boolean>>({})
  const [modifyIdx, setModifyIdx] = useState<number | null>(null)
  const [modifyText, setModifyText] = useState('')
  const [modifyFigNo, setModifyFigNo] = useState<number | null>(null)
  const [modifyTextSaved, setModifyTextSaved] = useState('')
  const [isViewing, setIsViewing] = useState(false)
  const [addCount, setAddCount] = useState(0)
  const [addInputs, setAddInputs] = useState<string[]>([])
  const [overrideCount, setOverrideCount] = useState(0)
  const [overrideInputs, setOverrideInputs] = useState<string[]>([])
  const [aiDecides, setAiDecides] = useState(true)
  const [userDecides, setUserDecides] = useState(false)

  const handleGenerateFromLLM = async () => {
    try {
      setIsGenerating(true)
      setError(null)

      // If user chose to decide and provided an override list, generate exactly those figures instead of auto list
      const overrideList = overrideInputs.filter(Boolean)
      if (userDecides && overrideCount > 0 && overrideList.length > 0) {
        const resp = await onComplete({
          action: 'add_figures_llm',
          sessionId: session?.id,
          instructionsList: overrideList
        })
        if (!resp) throw new Error('LLM did not return valid figure list')
        setOverrideCount(0)
        setOverrideInputs([])
        setFigures([])
        await onRefresh()
        return
      }

      // Build concise context to nudge LLM
      const components = session?.referenceMap?.components || []
      const numeralsPreview = components.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')

      const prompt = `You are generating PlantUML diagrams for a patent specification.
Return a JSON array of 3-5 simple, standard patent-style diagrams (no fancy rendering).
Each item must be: {"title":"Fig.X - title","purpose":"one-line purpose","plantuml":"@startuml...@enduml"}.
Rules:
- Use only components and numerals: ${numeralsPreview}.
- Prefer: Fig.1 block diagram (root modules), Fig.2 data/control flow, Fig.3 optional internal view for a selected module, timing only if short.
- Keep code minimal and syntactically valid PlantUML.
- Use labels with numerals exactly as assigned (e.g., C100), avoid undefined references.
 - Do NOT include !theme, !include, !import, skinparam, or other styling directives.
 - Do NOT include captions, figure numbers, or titles inside the PlantUML code.
Output: JSON only, no markdown fences.`

      const res = await onComplete({
        action: 'generate_diagrams_llm',
        sessionId: session?.id,
        prompt
      })

      if (!res || !Array.isArray(res.figures)) {
        throw new Error('LLM did not return valid figure list')
      }

      setFigures(res.figures)
      // Refresh to pull saved plans and sources immediately
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSavePlantUML = async (figure: LLMFigure, index: number) => {
    try {
      const resp = await onComplete({
        action: 'save_plantuml',
        sessionId: session?.id,
        figureNo: index + 1,
        title: figure.title,
        plantumlCode: figure.plantuml
      })

      if (resp?.diagramSource) {
        // ok
      }
    } catch (e) {
      setError('Failed to save PlantUML')
    }
  }

  const handleUploadImage = async (figureNo: number, file: File) => {
    try {
      setIsUploading(true)
      setError(null)
      const form = new FormData()
      form.append('file', file)
      const uploadResp = await fetch(`/api/projects/${patent.project.id}/patents/${patent.id}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: form
      })
      if (!uploadResp.ok) throw new Error('Upload failed')
      const uploadedMeta = await uploadResp.json()
      await onComplete({ action: 'upload_diagram', sessionId: session?.id, figureNo, filename: uploadedMeta.filename, checksum: uploadedMeta.checksum })
      setUploaded((prev) => ({ ...prev, [figureNo]: true }))
      await onRefresh()
    } catch (e) {
      setError('Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const handleViewImage = async (figureNo: number, filename?: string) => {
    if (!filename) return
    try {
      setIsViewing(true)
      setError(null)
      const url = `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(filename)}`
      const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } })
      if (!resp.ok) throw new Error('Failed to load image')
      const blob = await resp.blob()
      const blobUrl = URL.createObjectURL(blob)
      window.open(blobUrl, '_blank', 'noopener,noreferrer')
      // Optional: revoke later; leaving it for tab lifetime is fine
    } catch (e) {
      setError('Unable to open image')
    } finally {
      setIsViewing(false)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 3: Figure Planner</h2>
        <p className="text-gray-600">Generate simple PlantUML diagrams and upload rendered images.</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">{error}</div>
      )}

      <div className="flex items-center space-x-3 mb-4">
        <button
          onClick={handleGenerateFromLLM}
          disabled={isGenerating}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
        >
          {isGenerating ? 'Generating…' : 'Generate PlantUML (LLM)'}
        </button>
        <div className="flex items-center space-x-4">
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={aiDecides}
              onChange={(e) => { const v = e.target.checked; setAiDecides(v); setUserDecides(!v) }}
            />
            <span className="text-sm text-gray-700">Let AI decide number and type of images</span>
          </label>
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={userDecides}
              onChange={(e) => { const v = e.target.checked; setUserDecides(v); setAiDecides(!v) }}
            />
            <span className="text-sm text-gray-700">I will decide the number and type of images</span>
          </label>
        </div>
      </div>

      {userDecides && (
        <div className="mb-6 p-3 border rounded">
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-sm text-gray-700">How many images?</span>
            <input type="number" min={0} className="w-20 border rounded px-2 py-1 text-sm" value={overrideCount} onChange={(e) => { const n = Math.max(0, parseInt(e.target.value || '0', 10)); setOverrideCount(n); setOverrideInputs(Array.from({ length: n }, (_, i) => overrideInputs[i] || '')); }} />
          </div>
          {Array.from({ length: overrideCount }).map((_, i) => (
            <div key={i} className="mb-2">
              <label className="block text-xs text-gray-600">Figure {i + 1} description</label>
              <textarea className="w-full text-sm border rounded p-2" rows={2} value={overrideInputs[i] || ''} onChange={(e) => {
                const arr = [...overrideInputs]
                arr[i] = e.target.value
                setOverrideInputs(arr)
              }} />
            </div>
          ))}
          <p className="text-xs text-gray-500 mt-1">Tip: If you provide descriptions here, we will generate exactly these figures and skip the automatic set.</p>
        </div>
      )}

      {figures.length > 0 && (
        <div className="space-y-6">
          {figures.map((f, i) => (
            <div key={i} className="bg-white rounded-lg border p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-medium text-gray-900">{f.title || `Fig.${i + 1}`}</h3>
                  <p className="text-sm text-gray-600">{f.purpose}</p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleSavePlantUML(f, i)}
                    className="inline-flex items-center px-3 py-1 border border-gray-300 text-sm rounded text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Save PlantUML
                  </button>
                  <button
                    onClick={() => { setModifyIdx(i); setModifyText('') }}
                    className="inline-flex items-center px-3 py-1 border border-gray-300 text-sm rounded text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Modify
                  </button>
                </div>
              </div>
              <div className="relative">
                <textarea
                  className="w-full text-xs font-mono border rounded p-3 bg-gray-50"
                  rows={8}
                  readOnly
                  value={f.plantuml}
                />
                <button
                  onClick={() => navigator.clipboard.writeText(f.plantuml)}
                  className="absolute top-2 right-2 inline-flex items-center px-2 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50"
                >
                  Copy
                </button>
              </div>
              {modifyIdx === i && (
                <div className="mt-3 border-t pt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Describe changes for this figure</label>
                  <textarea className="w-full text-sm border rounded p-2" rows={3} value={modifyText} onChange={(e) => setModifyText(e.target.value)} />
                  <div className="mt-2 flex items-center space-x-2">
                    <button
                      onClick={async () => {
                        try {
                          const resp = await onComplete({ action: 'regenerate_diagram_llm', sessionId: session?.id, figureNo: i + 1, instructions: modifyText })
                          if (resp?.diagramSource?.plantumlCode) {
                            const updated = [...figures]
                            updated[i] = { ...updated[i], plantuml: resp.diagramSource.plantumlCode }
                            setFigures(updated)
                            setModifyIdx(null)
                            setModifyText('')
                            await onRefresh()
                          }
                        } catch (e) {
                          setError('Failed to modify diagram')
                        }
                      }}
                      className="inline-flex items-center px-3 py-1 border border-transparent text-sm rounded text-white bg-indigo-600 hover:bg-indigo-700"
                    >
                      Apply Changes
                    </button>
                    <button onClick={() => { setModifyIdx(null); setModifyText('') }} className="inline-flex items-center px-3 py-1 border border-gray-300 text-sm rounded text-gray-700 bg-white hover:bg-gray-50">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Persisted diagrams (codes + upload) */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Saved Diagrams</h3>
        {diagramSources.length === 0 ? (
          <div className="text-sm text-gray-600">No diagrams saved yet.</div>
        ) : (
          <div className="space-y-6">
            {diagramSources.map((d: any) => (
              <div key={d.figureNo} className="bg-white rounded-lg border p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center">
                    <h4 className="font-medium text-gray-900">{figurePlans.find((f: any) => f.figureNo === d.figureNo)?.title || `Figure ${d.figureNo}`} (Fig.{d.figureNo})</h4>
                    {(uploaded[d.figureNo] || d.imageUploadedAt) && (
                      <span className="ml-2 inline-flex items-center text-blue-600 text-xs">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.707a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                        <span className="ml-1">Uploaded</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => navigator.clipboard.writeText(d.plantumlCode)} className="inline-flex items-center px-2 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50">Copy</button>
                    <button onClick={() => { setModifyFigNo(d.figureNo); setModifyTextSaved('') }} className="inline-flex items-center px-2 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50">Modify</button>
                  </div>
                </div>
                <textarea className="w-full text-xs font-mono border rounded p-3 bg-gray-50" rows={8} readOnly value={d.plantumlCode} />
                {modifyFigNo === d.figureNo && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Describe changes for this figure</label>
                    <textarea className="w-full text-sm border rounded p-2" rows={3} value={modifyTextSaved} onChange={(e) => setModifyTextSaved(e.target.value)} />
                    <div className="mt-2 flex items-center space-x-2">
                      <button
                        onClick={async () => {
                          try {
                            const resp = await onComplete({ action: 'regenerate_diagram_llm', sessionId: session?.id, figureNo: d.figureNo, instructions: modifyTextSaved })
                            if (resp?.diagramSource?.plantumlCode) {
                              await onRefresh()
                              setModifyFigNo(null)
                              setModifyTextSaved('')
                            }
                          } catch (e) {
                            setError('Failed to modify diagram')
                          }
                        }}
                        className="inline-flex items-center px-3 py-1 border border-transparent text-xs rounded text-white bg-indigo-600 hover:bg-indigo-700"
                      >
                        Apply Changes
                      </button>
                      <button onClick={() => { setModifyFigNo(null); setModifyTextSaved('') }} className="inline-flex items-center px-3 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                )}
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Upload rendered image (PNG/SVG)</label>
                  <div className="flex items-center space-x-2">
                    <input type="file" accept=".png,.svg" disabled={isUploading} onChange={(e) => e.target.files && handleUploadImage(d.figureNo, e.target.files[0])} />
                    {(uploaded[d.figureNo] || d.imageUploadedAt) && d.imageFilename && (
                      <button
                        onClick={() => handleViewImage(d.figureNo, d.imageFilename)}
                        disabled={isViewing}
                        className="inline-flex items-center px-2 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        {isViewing ? 'Opening…' : 'View image'}
                      </button>
                    )}
          <button
                      onClick={async () => {
                        try {
                          await onComplete({ action: 'delete_figure', sessionId: session?.id, figureNo: d.figureNo })
                          await onRefresh()
                        } catch (e) {
                          setError('Failed to delete figure')
                        }
                      }}
                      className="inline-flex items-center px-2 py-1 text-xs border border-red-300 text-red-700 rounded bg-white hover:bg-red-50"
                    >
                      Delete
          </button>
        </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-6 p-3 border rounded">
        <div className="flex items-center space-x-2 mb-2">
          <label className="text-sm text-gray-700">Add new figures:</label>
          <input type="number" min={0} className="w-20 border rounded px-2 py-1 text-sm" value={addCount} onChange={(e) => { const n = Math.max(0, parseInt(e.target.value || '0', 10)); setAddCount(n); setAddInputs(Array.from({ length: n }, (_, i) => addInputs[i] || '')); }} />
          <button
            onClick={async () => {
              try {
                const instructionsList = addInputs.filter(Boolean)
                if (instructionsList.length === 0) return
                const resp = await onComplete({ action: 'add_figures_llm', sessionId: session?.id, instructionsList })
                if (resp?.created?.length) {
                  setAddCount(0)
                  setAddInputs([])
                  await onRefresh()
                }
              } catch (e) {
                setError('Failed to add figures')
              }
            }}
            className="inline-flex items-center px-3 py-1 border border-transparent text-xs rounded text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Generate
          </button>
        </div>
        {Array.from({ length: addCount }).map((_, i) => (
          <div key={i} className="mb-2">
            <label className="block text-xs text-gray-600">Figure {i + 1} description</label>
            <textarea className="w-full text-sm border rounded p-2" rows={2} value={addInputs[i] || ''} onChange={(e) => {
              const arr = [...addInputs]
              arr[i] = e.target.value
              setAddInputs(arr)
            }} />
          </div>
        ))}
        <p className="text-xs text-gray-500 mt-1">Tip: Provide all new images and details in one go for better consistency. We will inform the LLM about existing numerals, figures, and naming conventions to avoid hallucinations.</p>
      </div>
    </div>
  )
}
