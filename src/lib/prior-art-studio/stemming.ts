// Promoted to src/lib/element-scoring/stemming.ts alongside the shared scorer.
// This shim keeps existing imports working — including the 'use client'
// DocumentReader component, which depends on the target staying import-free.
export { stemTerm, stemSet, STOPWORDS, elementTerms } from '@/lib/element-scoring/stemming'
