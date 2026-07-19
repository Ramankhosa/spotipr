import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.claude/**'],
    // Several large suites (novelty-search-service, novelty-attorney-report,
    // auto-patent-draft-batch, support-data-sources) exceed the 60s default
    // while Vite SSR-transforms their dependency graph, and fail to LOAD with
    // `Timeout calling "fetch"`. That reports as "5 suites failed" while the
    // test count still shows all-green — i.e. the cutover's own guardrail
    // tests were silently not running. Raise the transform/hook budget.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    poolOptions: { threads: { singleThread: false } },
    server: { deps: { inline: [/src\/lib\//] } },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})


