import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import PatentNestNav from '@/components/patentnest/PatentNestNav'
import FeatureDetail from '@/components/patentnest/FeatureDetail'
import NoveltyDetail from '@/components/patentnest/NoveltyDetail'
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

  // The novelty pipeline gets the flagship treatment: staged walkthrough,
  // evidence-grounding and feature-mapping deep dives, comparative example.
  const Body = feature.slug === 'novelty-assessment' ? NoveltyDetail : FeatureDetail

  return (
    <div className="min-h-screen bg-paper-200 font-sans text-ai-graphite-900 antialiased selection:bg-brass-600/20">
      <PatentNestNav />
      <Body feature={feature} prev={prev} next={next} />
      <PaperFooter />
    </div>
  )
}
