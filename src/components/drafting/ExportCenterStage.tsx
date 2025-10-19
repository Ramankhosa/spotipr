'use client'

interface ExportCenterStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

export default function ExportCenterStage({ session, patent, onComplete, onRefresh }: ExportCenterStageProps) {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 7: Export Center</h2>
        <p className="text-gray-600">
          Export your complete patent annexure in various formats.
        </p>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <div className="flex items-center">
          <svg className="w-8 h-8 text-yellow-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <h3 className="text-lg font-medium text-yellow-800">Under Development</h3>
            <p className="text-yellow-700 mt-1">
              This stage is currently under development. Patent drafting workflow is complete.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-gray-200">
        <div className="flex justify-center">
          <div className="text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Drafting Complete!</h3>
            <p className="text-gray-600 mb-4">
              Your patent drafting session has been completed. Export functionality will be available soon.
            </p>
            <button
              onClick={() => window.location.href = '/dashboard'}
              className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
