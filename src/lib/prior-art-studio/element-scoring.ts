// Promoted to src/lib/element-scoring/scorer.ts so the novelty pipeline's
// Stage 1.7 feature prescreen shares ONE scorer (and one set of dtype-dependent
// absolute floors) with the studio. This shim keeps every existing import path
// — including the vi.mock('./element-scoring') in start-run-concurrency.test.ts
// — working unchanged. Add new code THERE, not here.
export { scoreElements } from '@/lib/element-scoring/scorer'
