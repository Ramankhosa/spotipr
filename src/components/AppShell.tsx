'use client'

// Persistent app chrome for authenticated pages: a collapsible left sidebar
// (every tool one click away) and a breadcrumb strip on deep routes.
// Marketing/auth pages and immersive workspaces render without the shell.
//
// Below md the sidebar has no room, so the same nav is served as a slide-over
// drawer opened from the breadcrumb strip — otherwise phone users would have
// no way to reach any tool.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import {
  LayoutDashboard,
  FolderKanban,
  PenLine,
  Search,
  FileSearch,
  ScanSearch,
  Compass,
  Lightbulb,
  Feather,
  Scale,
  Users,
  Building2,
  BadgeCheck,
  BarChart3,
  ShieldCheck,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  X
} from 'lucide-react'

const PUBLIC_PREFIXES = [
  '/patentnest', '/classic-home',
  '/pricing', '/contact', '/terms', '/privacy', '/blog',
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
  'prior-art-studio': 'Advanced Search Studio',
  whitespace: 'Whitespace Studio',
  scope: 'Scope',
  clusters: 'Technology areas',
  opportunities: 'Opportunities',
  opportunity: 'Opportunity',
  'office-actions': 'FER Response',
  setup: 'Setup',
  applicant: 'Applicant',
  subscription: 'Subscription',
  'tenant-admin': 'Organization',
  'super-admin': 'Admin',
  users: 'Users',
  teams: 'Teams',
  'firm-profile': 'Firm Profile',
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
  /^\/prior-art-studio$/,
  /^\/office-actions$/,
  /^\/patents\/draft\/batch$/,
  /^\/patents\/draft\/batch\/history$/,
  /^\/tenant-admin\/(users|teams|analytics|firm-profile)$/
]

function segmentLabel(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment]
  // Dynamic ids (cuid/uuid-ish) get shortened rather than dumped in full.
  if (segment.length > 12) return `${segment.slice(0, 8)}…`
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

// The strip does double duty: breadcrumbs everywhere, plus the nav trigger on
// phones/tablets where the sidebar is hidden. It therefore renders whenever a
// trigger is needed, even on shallow routes with nothing to breadcrumb.
function TopStrip({ pathname, onOpenNav }: { pathname: string; onOpenNav?: () => void }) {
  const segments = pathname.split('/').filter(Boolean)
  const crumbs = segments.length >= 2
    ? segments.map((segment, index) => {
        const path = '/' + segments.slice(0, index + 1).join('/')
        return {
          label: segmentLabel(segment),
          path,
          isLast: index === segments.length - 1,
          isLink: index < segments.length - 1 && LINKABLE_PATTERNS.some(p => p.test(path))
        }
      })
    : []

  if (!crumbs.length && !onOpenNav) return null

  return (
    <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-6 md:static md:bg-card/70 md:px-6 md:backdrop-blur-none">
      {onOpenNav && (
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation menu"
          className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}
      {crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="rail-x flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            {crumbs.map((crumb, index) => (
              <li key={crumb.path} className="flex items-center gap-1.5">
                {index > 0 && <span aria-hidden="true" className="text-muted-foreground/40">/</span>}
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
      ) : (
        <span className="text-xs font-semibold text-foreground md:hidden">Menu</span>
      )}
    </div>
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
  { label: 'Advanced Search Studio', href: '/prior-art-studio', icon: ScanSearch },
  { label: 'Whitespace Studio', href: '/whitespace', icon: Compass },
  { label: 'FER Response', href: '/office-actions', icon: Scale },
  { label: 'Idea Bank', href: '/idea-bank', icon: Lightbulb },
  { label: 'Writing Personas', href: '/personas', icon: Feather }
]

const TENANT_ADMIN_NAV: NavItem[] = [
  { label: 'Firm Profile', href: '/tenant-admin/firm-profile', icon: BadgeCheck },
  { label: 'Users', href: '/tenant-admin/users', icon: Users },
  { label: 'Teams', href: '/tenant-admin/teams', icon: Building2 },
  { label: 'Usage Analytics', href: '/tenant-admin/analytics', icon: BarChart3 }
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/'
  const { user } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

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

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

  // Navigating away should dismiss the drawer, and the page behind it must not
  // scroll while it's open.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!mobileNavOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [mobileNavOpen])

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

  // The drawer reuses the rail's items but always shows labels and never
  // collapses — a phone menu has the room and needs the words.
  const renderItem = (item: NavItem, variant: 'rail' | 'drawer' = 'rail') => {
    const isRail = variant === 'rail'
    const iconOnly = isRail && collapsed
    const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
    return (
      <Link
        key={item.href}
        href={item.href}
        title={iconOnly ? item.label : undefined}
        onClick={isRail ? undefined : closeMobileNav}
        className={`flex items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
          isRail ? 'py-2' : 'py-2.5'
        } ${
          active
            ? 'bg-accent text-accent-foreground font-semibold'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        } ${iconOnly ? 'justify-center px-2' : ''}`}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!iconOnly && <span className="truncate">{item.label}</span>}
      </Link>
    )
  }

  const sectionLabel = (label: string) => (
    <div className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
  )

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {!hideSidebar && (
        <aside
          className={`hidden md:flex flex-col shrink-0 border-r border-border bg-card transition-[width] duration-200 ${
            collapsed ? 'w-14' : 'w-56'
          }`}
        >
          <div className="sticky top-0 flex max-h-screen flex-col gap-1 overflow-y-auto p-2 pt-4">
            {MAIN_NAV.map(item => renderItem(item))}

            {isTenantAdmin && (
              <>
                {!collapsed && (
                  <div className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Organization
                  </div>
                )}
                {collapsed && <div className="my-2 border-t border-border" />}
                {TENANT_ADMIN_NAV.map(item => renderItem(item))}
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

      {/* Mobile/tablet drawer — same destinations as the rail above. */}
      {!hideSidebar && mobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]"
            onClick={closeMobileNav}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col border-r border-border bg-card shadow-2xl animate-slide-in-left"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Navigate</span>
              <button
                type="button"
                onClick={closeMobileNav}
                aria-label="Close navigation menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="safe-bottom flex-1 space-y-1 overflow-y-auto p-2">
              {MAIN_NAV.map(item => renderItem(item, 'drawer'))}

              {isTenantAdmin && (
                <>
                  {sectionLabel('Organization')}
                  {TENANT_ADMIN_NAV.map(item => renderItem(item, 'drawer'))}
                </>
              )}

              {isSuperAdmin && (
                <>
                  {sectionLabel('Platform')}
                  {renderItem({ label: 'Admin Console', href: '/dashboard', icon: ShieldCheck, exact: true }, 'drawer')}
                </>
              )}
            </nav>
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <TopStrip pathname={pathname} onOpenNav={hideSidebar ? undefined : () => setMobileNavOpen(true)} />
        {children}
      </div>
    </div>
  )
}
