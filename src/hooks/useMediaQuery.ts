'use client'

import { useEffect, useState } from 'react'

/**
 * Subscribe to a CSS media query from React.
 *
 * Always returns `false` on the server and for the first client render so
 * markup matches and hydration stays quiet; the real value lands in the
 * effect immediately after mount. Callers that branch on this should make
 * `false` the small-screen/safe branch.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)

    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** Tailwind `lg` and up — where a persistent left rail earns its width. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}
