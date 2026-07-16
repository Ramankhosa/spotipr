import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import PatentNestNav from '@/components/patentnest/PatentNestNav'
import FeatureDetail from '@/components/patentnest/FeatureDetail'
import PaperFooter from '@/components/patentnest/PaperFooter'
import { FEATURES, getFeature, adjacentFeatures } from '@/lib/patentnest/features'

// One detail page per embodiment (feature) of the /patentnest landing page,
// generated from the features.ts registry. Same paper/ink/brass document
// language as the homepage; the global Header stays hidden for /patentnest/*
// (see components/ConditionalHeader.tsx).

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }))
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const feature = getFeature(params.slug)
  if (!feature) return {}
  return {
    title: `${feature.name} — PatentNest.ai`,
    description: feature.card.tagline,
  }
}

export default function FeaturePage({ params }: { params: { slug: string } }) {
  const feature = getFeature(params.slug)
  if (!feature) notFound()

  const { prev, next } = adjacentFeatures(feature.slug)

  return (
    <div className="min-h-screen bg-[#faf9f7] font-sans text-ai-graphite-900 antialiased selection:bg-[#8a6a1f]/20">
      <PatentNestNav />
      <FeatureDetail feature={feature} prev={prev} next={next} />
      <PaperFooter />
    </div>
  )
}
