'use client'

// Minimal document-style nav for the /patentnest landing page. Paper glass once
// scrolled, with a thin brass reading-progress rule along the top edge — the
// page reads like a document, so the nav behaves like its running head.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { useAuth } from '@/lib/auth-context'
import { cn } from '@/lib/utils'

const BRASS = '#8a6a1f'

export default function PatentNestNav() {
  const { user } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 })

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-colors duration-300',
        scrolled
          ? 'border-b border-ai-graphite-900/10 bg-[#faf9f7]/85 backdrop-blur-md'
          : 'border-b border-transparent bg-transparent'
      )}
    >
      {/* reading progress */}
      <motion.div
        className="absolute inset-x-0 top-0 h-[2px] origin-left"
        style={{ scaleX: progress, backgroundColor: BRASS }}
        aria-hidden
      />

      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/patentnest" className="flex items-baseline gap-0.5">
          <span className="font-serif text-xl font-semibold tracking-tight text-ai-graphite-900">
            PatentNest
          </span>
          <span className="font-mono text-xs" style={{ color: BRASS }}>
            .ai
          </span>
        </Link>

        <div className="hidden items-center gap-8 text-sm text-ai-graphite-600 md:flex">
          <Link href="/patentnest#background" className="transition-colors hover:text-ai-graphite-900">The problem</Link>
          <Link href="/patentnest#studio" className="transition-colors hover:text-ai-graphite-900">The studio</Link>
          <Link href="/patentnest#embodiments" className="transition-colors hover:text-ai-graphite-900">Features</Link>
          <Link href="/patentnest#claims" className="transition-colors hover:text-ai-graphite-900">Claims</Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-5">
          {user ? (
            <Link
              href="/dashboard"
              className="rounded-lg bg-ai-graphite-900 px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:bg-ai-graphite-800 active:scale-[0.98]"
            >
              Open studio
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden text-sm font-medium text-ai-graphite-600 transition-colors hover:text-ai-graphite-900 sm:block"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-ai-graphite-900 px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:bg-ai-graphite-800 active:scale-[0.98]"
              >
                Start application
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
