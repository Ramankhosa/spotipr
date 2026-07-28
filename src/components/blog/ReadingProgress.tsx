'use client'

// A cobalt hairline along the top of the viewport showing how far through the
// article you are — the same running-head idiom the landing page uses, so the
// blog reads as part of the same document system.

import { motion, useScroll, useSpring } from 'framer-motion'

export default function ReadingProgress() {
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 })

  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-lamp-600"
      style={{ scaleX: progress }}
    />
  )
}
