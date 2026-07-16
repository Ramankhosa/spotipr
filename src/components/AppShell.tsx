'use client'

// Persistent app chrome for authenticated pages: a collapsible left sidebar
// (every tool one click away) and a breadcrumb strip on deep routes.
// Marketing/auth pages and immersive workspaces render without the shell.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import {
  LayoutDashboard,
  FolderKanban,
  PenLine,
  Search,
  FileSearch,
  Lightbulb,
  Feather,
  Users,
  Building2,
  BarChart3,
  ShieldCheck,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react'

const PUBLIC_PREFIXES = [
  '/patentnest',
  '/pricing', '/contact', '/terms', '/privacy',
  '/login', '/register', '/forgot-password', '/reset-password', '/verify-email',
  '/institutional-access', '/unsubscribed', '/clear-cookies', '/share',
  '/developers', '/test', '/test-gif', '/email-drafting/download'
]

// Routes with their own full-height chrome (stage rail / full-screen overlay).
const IMMERSIVE_PATTERNS = [
  /^\/patents\/[^/]+\/draft/,
  /^\/idea-bank/
]

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  projects: 'Projects',
  new: 'New',
  patents: 'Patents',
  draft: 'Draft',
  batch: 'Batch drafting',
  history: 'History',
  download: 'Download',
  'novelty-search': 'Novelty Search',
  report: 'Report',
  consolidated: 'Consolidated report',
  pdf: 'PDF',
  stages: 'Stages',
  'idea-bank': 'Idea Bank',
  personas: 'Writing Personas',
  'patent-search': 'Prior-art Search',
  setup: 'Setup',
  applicant: 'Applicant',
  subscription: 'Subscription',
  'tenant-admin': 'Organization',
  'super-admin': 'Admin',
  users: 'Users',
  teams: 'Teams',
  analytics: 'Analytics',
  'email-drafting': 'Email Drafting',
  requests: 'Requests',
  'ati-management': 'ATI Tokens'
}

// Only crumbs that resolve to real pages become links.
const LINKABLE_PATTERNS = [
  /^\/dashboard$/,
  /^\/projects$/,
  /^\/projects\/[^/]+$/,
  /^\/projects\/[^/]+\/patents$/,
  /^\/novelty-search$/,
  /^\/novelty-search\/history$/,
  /^\/idea-bank$/,
  /^\/personas$/,
  /^\/patent-search$/,
  /^\/patents\/draft\/batch$/,
  /^\/patents\/draft\/batch\/history$/,
  /^\/tenant-admin\/(users|teams|analytics)$/
]

function segmentLabel(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment]
  // Dynamic ids (cuid/uuid-ish) get shortened rather than dumped in full.
  if (segment.length > 12) return `${segment.slice(0, 8)}…`
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null

  const crumbs = segments.map((segment, index) => {
    const path = '/' + segments.slice(0, index + 1).join('/')
    return {
      label: segmentLabel(segment),
      path,
      isLast: index === segments.length - 1,
      isLink: index < segments.length - 1 && LINKABLE_PATTERNS.some(p => p.test(path))
    }
  })

  return (
    <nav aria-label="Breadcrumb" className="border-b border-border bg-white/60 px-4 sm:px-6 py-2">
      <ol className="flex items-center gap-1.5 text-xs text-muted-foreground overflow-x-auto whitespace-nowrap">
        {crumbs.map((crumb, index) => (
          <li key={crumb.path} className="flex items-center gap-1.5">
            {index > 0 && <span aria-hidden="true" className="text-slate-300">/</span>}
            {crumb.isLink ? (
              <Link href={crumb.path} className="hover:text-primary transition-colors">
                {crumb.label}
              </Link>
            ) : (
              <span className={crumb.isLast ? 'font-semibold text-foreground' : undefined} aria-current={crumb.isLast ? 'page' : undefined}>
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

interface NavItem {
  label: string
  href: string
  icon: typeof Search
  exact?: boolean
}

const MAIN_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, exact: true },
  { label: 'Projects', href: '/projects', icon: FolderKanban },
  { label: 'New Draft', href: '/patents/draft/new', icon: PenLine },
  { label: 'Novelty Search', href: '/novelty-search', icon: Search },
  { label: 'Prior-art Search', href: '/patent-search', icon: FileSearch },
  { label: 'Idea Bank', href: '/idea-bank', icon: Lightbulb },
  { label: 'Writing Personas', href: '/personas', icon: Feather }
]

const TENANT_ADMIN_NAV: NavItem[] = [
  { label: 'Users', href: '/tenant-admin/users', icon: Users },
  { label: 'Teams', href: '/tenant-admin/teams', icon: Building2 },
  { label: 'Usage Analytics', href: '/tenant-admin/analytics', icon: BarChart3 }
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/'
  const { user } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('app_sidebar_collapsed')
    if (saved === '0' || saved === '1') {
      setCollapsed(saved === '1')
      return
    }
    // No saved preference yet: keep the sidebar as a slim icon rail on smaller
    // screens so the main content keeps its width; expand only on large displays.
    setCollapsed(window.innerWidth < 1440)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      localStorage.setItem('app_sidebar_collapsed', prev ? '0' : '1')
      return !prev
    })
  }

  const isTenantAdmin = user?.roles?.includes('OWNER') || user?.roles?.includes('ADMIN')
  const isSuperAdmin = user?.roles?.includes('SUPER_ADMIN')

  const shellMode = useMemo(() => {
    if (pathname === '/') return 'none'
    if (PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`))) return 'none'
    if (IMMERSIVE_PATTERNS.some(p => p.test(pathname))) return 'none'
    return 'shell'
  }, [pathname])

  // Super-admin home renders its own grouped sidebar — don't double up.
  const hideSidebar = isSuperAdmin && pathname === '/dashboard'

  if (!user || shellMode === 'none') {
    return <>{children}</>
  }

  const renderItem = (item: NavItem) => {
    const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
          active
            ? 'bg-accent text-accent-foreground font-semibold'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        } ${collapsed ? 'justify-center px-2' : ''}`}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    )
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {!hideSidebar && (
        <aside
          className={`hidden md:flex flex-col shrink-0 border-r border-border bg-white transition-[width] duration-200 ${
            collapsed ? 'w-14' : 'w-56'
          }`}
        >
          <div className="sticky top-0 flex max-h-screen flex-col gap-1 overflow-y-auto p-2 pt-4">
            {MAIN_NAV.map(renderItem)}

            {isTenantAdmin && (
              <>
                {!collapsed && (
                  <div className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Organization
                  </div>
                )}
                {collapsed && <div className="my-2 border-t border-border" />}
                {TENANT_ADMIN_NAV.map(renderItem)}
              </>
            )}

            {isSuperAdmin && (
              <>
                {!collapsed && (
                  <div className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Platform
                  </div>
                )}
                {collapsed && <div className="my-2 border-t border-border" />}
                {renderItem({ label: 'Admin Console', href: '/dashboard', icon: ShieldCheck, exact: true })}
              </>
            )}

            <div className="mt-auto pt-4">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${
                  collapsed ? 'justify-center px-2' : ''
                }`}
              >
                {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
                {!collapsed && <span>Collapse</span>}
              </button>
            </div>
          </div>
        </aside>
      )}

      <div className="min-w-0 flex-1">
        <Breadcrumbs pathname={pathname} />
        {children}
      </div>
    </div>
  )
}
