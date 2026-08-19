'use client'

import { useState } from 'react'

// Square portrait for the /developers credits page. Falls back to the person's
// initials on a cobalt-tinted plate when the image file is absent or fails to
// load, so listing someone before their photo lands never shows a broken image.
export default function DeveloperPortrait({ name, src }: { name: string; src: string }) {
  const [failed, setFailed] = useState(false)

  const initials = name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  if (failed) {
    return (
      <div
        aria-hidden
        className="flex h-[120px] w-[120px] items-center justify-center rounded-xl border border-paper-300 bg-lamp-50 text-[30px] font-semibold tracking-[-0.02em] text-lamp-600"
      >
        {initials}
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- needs an onError fallback
    <img
      src={src}
      alt={name}
      width={120}
      height={120}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-[120px] w-[120px] rounded-xl border border-paper-300 object-cover object-top"
    />
  )
}
