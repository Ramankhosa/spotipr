#!/usr/bin/env node
/**
 * Route + auth linter.
 *
 * Catches the two failure modes TypeScript cannot see, because both are strings
 * at compile time and only break at runtime, in the browser, for a signed-in user:
 *
 *   1. A link or router.push() to an app route that was never written (404).
 *   2. A client component calling an authenticated API with a bare fetch(), i.e.
 *      no Authorization header — which surfaces to the user as a bogus
 *      "session expired" message while they are perfectly well logged in.
 *
 * Run: npm run check:routes   (exits 1 on findings)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', '__tests__'])

/** Links we knowingly do not serve from the app router. */
const IGNORED_LINKS = new Set([])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(full, out)
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const files = walk(SRC)
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/')
const lineOf = (src, index) => src.slice(0, index).split('\n').length

// --------------------------------------------------------------- route tables
const apiRoutes = new Map()
const pageRoutes = []

for (const file of files) {
  const r = rel(file)
  const apiMatch = r.match(/^src\/app\/(api\/.*)\/route\.tsx?$/)
  if (apiMatch) {
    const src = fs.readFileSync(file, 'utf8')
    // A route that only reads the token opportunistically (public form that
    // attributes a submission when signed in) is not an authenticated route.
    const requiresAuth = /authenticateUser\(|getServerSession\(|requireAuth\(/.test(src)
    apiRoutes.set('/' + apiMatch[1], { requiresAuth })
    continue
  }
  const pageMatch = r.match(/^src\/app\/(.*)\/page\.tsx?$/)
  if (pageMatch) pageRoutes.push('/' + pageMatch[1].replace(/\/\([^/)]+\)/g, ''))
  else if (/^src\/app\/page\.tsx?$/.test(r)) pageRoutes.push('/')
}

const toRegex = route =>
  new RegExp(
    '^' +
      route
        .replace(/\[\[\.\.\.[^\]]+\]\]/g, '.*')
        .replace(/\[\.\.\.[^\]]+\]/g, '.+')
        .replace(/\[[^\]]+\]/g, '[^/]+')
        .replace(/\//g, '\\/') +
      '\\/?$'
  )

const pageMatchers = pageRoutes.map(toRegex)
const apiMatchers = [...apiRoutes.keys()].map(route => ({ route, re: toRegex(route) }))

/**
 * Removes `${...}` interpolations, counting braces so that a nested expression
 * — `${q ? `?${q}` : ''}` — is dropped whole rather than cut at its first `?`.
 * Returns the literal text with each interpolation replaced by `replacement`.
 */
function stripInterpolations(raw, replacement) {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < raw.length && depth > 0) {
        if (raw[i] === '{') depth++
        else if (raw[i] === '}') depth--
        i++
      }
      i--
      out += replacement
    } else {
      out += raw[i]
    }
  }
  return out
}

/**
 * An interpolation may stand for a path segment (`/study/${id}`) or for a query
 * string (`/draft/new${query}`), so a link counts as live if either reading
 * resolves to a real page.
 */
function pageExists(raw) {
  const candidates = [stripInterpolations(raw, 'x'), stripInterpolations(raw, '')]
  return candidates.some(candidate => {
    const url = candidate.split('?')[0].split('#')[0]
    return url && pageMatchers.some(re => re.test(url))
  })
}

/** Longest declared API route matching a fetch path. */
function resolveApi(url) {
  const segments = url.split('/').filter(Boolean)
  let best = null
  for (const [route, info] of apiRoutes) {
    const routeSegments = route.split('/').filter(Boolean)
    if (routeSegments.length > segments.length) continue
    const matches = routeSegments.every((s, i) => s.startsWith('[') || s === segments[i])
    if (matches && (!best || routeSegments.length > best.length)) {
      best = { route, info, length: routeSegments.length }
    }
  }
  return best
}

// ------------------------------------------------------------------- findings
const deadLinks = []
const unauthenticatedFetches = []

const LINK_PATTERNS = [
  /href=["'](\/[^"'#?]*)["']/g,
  /href=\{`(\/[^`]*)`\}/g,
  /router\.(?:push|replace)\(\s*["'](\/[^"'#?]*)["']/g,
  /router\.(?:push|replace)\(\s*`(\/[^`]*)`/g,
  /\bredirect\(\s*["'](\/[^"'#?]*)["']/g,
]

for (const file of files) {
  const r = rel(file)
  if (r.startsWith('src/app/api/')) continue
  const src = fs.readFileSync(file, 'utf8')

  // 1. dead internal links
  for (const pattern of LINK_PATTERNS) {
    for (const match of src.matchAll(pattern)) {
      const raw = match[1]
      if (raw.startsWith('//') || raw.startsWith('/api/')) continue
      if (/\.[a-z0-9]{2,5}$/i.test(raw)) continue // static asset
      if (IGNORED_LINKS.has(raw)) continue
      if (pageExists(raw)) continue
      if (fs.existsSync(path.join(ROOT, 'public', raw.split('?')[0]))) continue
      deadLinks.push(`${r}:${lineOf(src, match.index)}  ${raw}`)
    }
  }

  // 2. client fetches to authenticated APIs with no token
  if (!/^['"]use client['"]/m.test(src)) continue
  const sendsToken = /Authorization|auth_token|authHeaders|credentials:\s*['"]include/.test(src)
  if (sendsToken) continue
  for (const match of src.matchAll(/fetch\(\s*[`'"](\/api\/[^`'"$)]*)/g)) {
    const resolved = resolveApi(match[1].split('?')[0])
    if (!resolved?.info.requiresAuth) continue
    unauthenticatedFetches.push(`${r}:${lineOf(src, match.index)}  ${match[1]}  → ${resolved.route}`)
  }
}

const unique = list => [...new Set(list)].sort()
const dead = unique(deadLinks)
const unauth = unique(unauthenticatedFetches)

console.log(`Checked ${pageRoutes.length} pages and ${apiRoutes.size} API routes.`)

if (unauth.length) {
  console.log('\nClient fetch to an authenticated API without a token (renders as "session expired"):')
  for (const line of unauth) console.log('  ' + line)
}
if (dead.length) {
  console.log('\nLinks to routes that do not exist (404 on click):')
  for (const line of dead) console.log('  ' + line)
}

if (!dead.length && !unauth.length) {
  console.log('No dead internal links, no unauthenticated client fetches.')
  process.exit(0)
}
process.exit(1)
