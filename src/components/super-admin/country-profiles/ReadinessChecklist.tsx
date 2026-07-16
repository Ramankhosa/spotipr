'use client'

import { CountryReadiness, ReadinessCheck } from './import-types'

const STATUS_STYLES: Record<ReadinessCheck['status'], { icon: string; row: string; badge: string }> = {
  pass: { icon: '✓', row: 'border-green-200 bg-green-50', badge: 'bg-green-100 text-green-800' },
  warn: { icon: '!', row: 'border-yellow-200 bg-yellow-50', badge: 'bg-yellow-100 text-yellow-800' },
  fail: { icon: '✕', row: 'border-red-200 bg-red-50', badge: 'bg-red-100 text-red-800' }
}

interface ReadinessChecklistProps {
  readiness: CountryReadiness
  /** Optional links per check id, e.g. { prompts: '/super-admin/section-prompts?country=DE' } */
  fixLinks?: Record<string, string>
}

export function ReadinessChecklist({ readiness, fixLinks }: ReadinessChecklistProps) {
  const failures = readiness.checks.filter(c => c.status === 'fail').length
  const warnings = readiness.checks.filter(c => c.status === 'warn').length

  const defaultFixLinks: Record<string, string> = {
    prompts: `/super-admin/section-prompts?country=${readiness.countryCode}`,
    mappings: `/super-admin/jurisdictions/${readiness.countryCode}`,
    'core-sections': `/super-admin/jurisdictions/${readiness.countryCode}`,
    'superset-keys': `/super-admin/superset-sections`,
    'display-order': `/super-admin/jurisdictions/${readiness.countryCode}`,
    'export-config': `/super-admin/jurisdiction-styles`,
    'diagram-config': `/super-admin/jurisdiction-styles`,
    validations: `/super-admin/jurisdiction-styles`
  }
  const links = { ...defaultFixLinks, ...fixLinks }

  return (
    <div>
      <div className="mb-4 flex items-center space-x-3">
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
          readiness.ready ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {readiness.ready ? 'Ready for drafting' : `${failures} blocker${failures === 1 ? '' : 's'}`}
        </span>
        {warnings > 0 && (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
            {warnings} warning{warnings === 1 ? '' : 's'}
          </span>
        )}
        {readiness.profileStatus && (
          <span className="text-sm text-gray-500">Profile status: {readiness.profileStatus}</span>
        )}
      </div>

      <div className="space-y-2">
        {readiness.checks.map(check => {
          const style = STATUS_STYLES[check.status]
          return (
            <div key={check.id} className={`flex items-start p-3 border rounded-md ${style.row}`}>
              <span className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold mr-3 ${style.badge}`}>
                {style.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">{check.label}</div>
                {check.detail && <div className="text-sm text-gray-600 mt-0.5">{check.detail}</div>}
              </div>
              {check.status !== 'pass' && links[check.id] && (
                <a
                  href={links[check.id]}
                  className="ml-3 flex-shrink-0 text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  Fix →
                </a>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
