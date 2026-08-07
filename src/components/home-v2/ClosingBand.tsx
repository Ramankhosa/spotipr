'use client'

// Closing ask: the one cobalt field on the page. Both public entry points live
// here side by side — request a trial (reviewed by a person, /free-trial) and
// talk to us (/contact) — repeating the hero's primary action rather than
// introducing a third one.

import Link from 'next/link'
import { ArrowRight, MessagesSquare } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import Reveal from './Reveal'

export default function ClosingBand() {
  const { user } = useAuth()

  return (
    <section className="mx-auto max-w-[1240px] px-5 pt-24 sm:px-8 lg:pt-28">
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl bg-lamp-600 px-8 py-14 sm:px-14">
          {/* faint blueprint rules */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage:
                'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
              backgroundSize: '54px 54px',
            }}
          />

          <div className="relative max-w-[46ch]">
            <h2 className="text-[clamp(24px,2.9vw,34px)] font-semibold leading-[1.2] tracking-[-0.022em] text-white">
              Your invention deserves clarity.
              <br />
              Your patent deserves strength.
            </h2>
            <p className="mt-4 text-[15.5px] text-lamp-100">
              Bring one live disclosure and see the whole record come together.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={user ? '/login' : '/free-trial'}
                className="group inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3.5 text-[15px] font-medium text-lamp-700 transition-all duration-150 hover:bg-lamp-50 active:scale-[0.985]"
              >
                {user ? 'Start with my invention' : 'Request a free trial'}
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 rounded-lg border border-white/40 px-6 py-3.5 text-[15px] font-medium text-white transition-all duration-150 hover:border-white/70 hover:bg-white/10 active:scale-[0.985]"
              >
                <MessagesSquare className="h-4 w-4" />
                Talk to us
              </Link>
            </div>

            {!user && (
              <p className="mt-5 text-[13px] text-lamp-100/85">
                Trial requests are reviewed by a person, usually within one business day.
                No card, no auto-renewal.
              </p>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  )
}
