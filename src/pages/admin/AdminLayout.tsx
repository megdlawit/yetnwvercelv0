// The Yet New control center frame — built like an institution's dashboard: a collapsible
// sidebar with one big action (Approvals) and six sections, a header, and simple tabs
// inside a section. Only the platform team sees it.

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShieldCheck, Building, Map as MapIcon, Users, History, Wrench,
  ChevronsLeft, ChevronsRight, Menu, LogOut, LayoutGrid, AlertTriangle, Eye, Bell, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/auth/AuthShell';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { useAdminQuery, type AdminOverview } from './useAdmin';

interface AdminValue { overview: AdminOverview | null; reloadOverview: () => void; needsMigration: boolean }
const AdminCtx = createContext<AdminValue | null>(null);
export const useAdminConsole = () => {
  const v = useContext(AdminCtx);
  if (v) {
    return v;
  } else {
    throw new Error('useAdminConsole outside AdminLayout');
  }
};

export const waitingCount = (o: AdminOverview | null) => (o ? o.institutions_pending + o.venues_pending + (o.verifications_pending ?? 0) : 0);

/** The sidebar: six sections; related pages are tabs inside a section. */
interface Section { label: string; icon: typeof MapIcon; tabs: { label: string; to: string }[] }
export const SECTIONS: Section[] = [
  { label: 'Home', icon: LayoutDashboard, tabs: [{ label: 'Overview', to: '/admin' }, { label: 'Insights', to: '/admin/insights' }, { label: 'Pilot report', to: '/admin/report' }] },
  { label: 'Institutions', icon: Building, tabs: [{ label: 'Institutions', to: '/admin/institutions' }] },
  { label: 'Venues', icon: MapIcon, tabs: [{ label: 'Venues', to: '/admin/venues' }] },
  { label: 'People', icon: Users, tabs: [{ label: 'People', to: '/admin/users' }] },
  { label: 'Activity', icon: History, tabs: [{ label: 'Recent changes', to: '/admin/activity' }, { label: 'Audit log', to: '/admin/audit' }] },
  { label: 'Tools', icon: Wrench, tabs: [
    { label: 'Buildings & floors', to: '/admin/tools/buildings' }, { label: 'Points of interest', to: '/admin/tools/pois' },
    { label: 'Outdoor paths', to: '/admin/tools/paths' }, { label: 'Map layers', to: '/admin/tools/layers' }, { label: 'Embed codes', to: '/admin/tools/embed' },
  ] },
];

function sectionOf(pathname: string): Section | undefined {
  const p = pathname.replace(/\/$/, '') || '/admin';
  return SECTIONS.find(s => s.tabs.some(t => t.to === p));
}

const COLLAPSE_KEY = 'yetnew-admin-sidebar-collapsed';

export default function AdminLayout() {
  const overview = useAdminQuery<AdminOverview>('admin_overview');
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const [mobileNav, setMobileNav] = useState(false);
  const toggle = () => setCollapsed(c => { try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  const value: AdminValue = { overview: overview.data, reloadOverview: overview.reload, needsMigration: overview.needsMigration };
  const sidebar = (mobile: boolean) => (
    <Sidebar collapsed={!mobile && collapsed} mobile={mobile} onToggle={toggle} onNavigate={() => setMobileNav(false)} overview={overview.data} />
  );

  return (
    <AdminCtx.Provider value={value}>
      <div className="flex min-h-[100dvh] bg-muted/30 text-foreground">
        <aside className={cn('sticky top-0 hidden h-[100dvh] shrink-0 border-r bg-card transition-[width] duration-200 lg:block print:!hidden', collapsed ? 'w-[68px]' : 'w-64')}>
          {sidebar(false)}
        </aside>
        <Sheet open={mobileNav} onOpenChange={setMobileNav}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {sidebar(true)}
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 flex-1 flex-col">
          <Header onMenu={() => setMobileNav(true)} overview={overview.data} />
          {overview.needsMigration ? (
            <p className="mx-4 mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 print:hidden">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>The control center needs one database update: run <code className="font-mono">supabase/migrations/20261008110000_admin_control_center.sql</code> in the Supabase SQL editor, then reload.</span>
            </p>
          ) : null}
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 print:p-0">
            <SectionTabs />
            <Outlet />
          </main>
        </div>
      </div>
    </AdminCtx.Provider>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ collapsed, mobile, onToggle, onNavigate, overview }: {
  collapsed: boolean; mobile: boolean; onToggle: () => void; onNavigate: () => void; overview: AdminOverview | null;
}) {
  const { pathname } = useLocation();
  const current = sectionOf(pathname);
  const waiting = waitingCount(overview);
  const onApprovals = pathname.startsWith('/admin/approvals');
  const item = (label: string, el: ReactNode) => (collapsed
    ? <Tooltip key={label}><TooltipTrigger asChild>{el}</TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>
    : el);
  const cls = (active: boolean) => cn('flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors',
    collapsed && 'justify-center px-0', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground');

  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-16 items-center px-4', collapsed ? 'justify-center' : 'justify-between')}>
        <Link to="/admin" onClick={onNavigate} aria-label="Yet New control center">
          {collapsed ? <Logo className="[&>*:not(:first-child)]:hidden text-[0px]" /> : <Logo className="text-lg" />}
        </Link>
        {!mobile && !collapsed ? <button onClick={onToggle} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Collapse sidebar"><ChevronsLeft className="h-4 w-4" /></button> : null}
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Control center">
        {item(`Approvals${waiting ? ` (${waiting})` : ''}`, (
          <Link to="/admin/approvals" onClick={onNavigate} aria-current={onApprovals ? 'page' : undefined}
            className={cn('relative flex h-11 w-full items-center gap-3 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90',
              collapsed && 'justify-center px-0', onApprovals && 'ring-2 ring-primary/30 ring-offset-2 ring-offset-card')}>
            <ShieldCheck className="h-[18px] w-[18px] shrink-0" />
            {!collapsed ? <span className="flex-1">Approvals</span> : null}
            {waiting > 0 && !collapsed ? <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-amber-950">{waiting}</span> : null}
            {waiting > 0 && collapsed ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-400" /> : null}
          </Link>
        ))}
        <div className="space-y-1">
          {SECTIONS.map(s => {
            const active = current?.label === s.label;
            return item(s.label, (
              <Link key={s.label} to={s.tabs[0].to} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cls(active)}>
                <s.icon className="h-5 w-5 shrink-0" /> {!collapsed ? s.label : null}
              </Link>
            ));
          })}
        </div>
      </nav>
      <div className="space-y-1 border-t p-3">
        {collapsed && !mobile ? <button onClick={onToggle} className={cn(cls(false), 'h-9 w-full')} aria-label="Expand sidebar"><ChevronsRight className="h-4 w-4" /></button> : null}
        {item('Institution dashboard', (
          <Link to="/dashboard" onClick={onNavigate} className={cn('flex items-center gap-3 rounded-xl p-2 hover:bg-muted', collapsed && 'justify-center')}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-600 text-white"><ShieldCheck className="h-4 w-4" /></span>
            {!collapsed ? (
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">Yet New team</span>
                <span className="block truncate text-[11px] text-muted-foreground">Control center · all institutions</span>
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header({ onMenu, overview }: { onMenu: () => void; overview: AdminOverview | null }) {
  const navigate = useNavigate();
  const waiting = waitingCount(overview);
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-5 print:hidden">
      <button onClick={onMenu} className="rounded-lg p-2 hover:bg-muted lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      <div className="min-w-0 px-2">
        <p className="truncate text-sm font-bold leading-tight">Control center</p>
        <p className="truncate text-[11px] leading-tight text-muted-foreground">Yet New · all institutions</p>
      </div>
      <span className="hidden items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-300 sm:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-500" /> Platform admin
      </span>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" asChild className="hidden h-9 rounded-xl sm:flex">
          <a href="/" target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-4 w-4" /> Visitor site</a>
        </Button>
        <Waiting overview={overview} />
        <AccountMenu />
        <Button onClick={() => navigate('/admin/approvals')} className="ml-1 h-9 rounded-xl" variant={waiting ? 'default' : 'outline'}>
          <ShieldCheck className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">Review</span>
          {waiting > 0 ? <span className="ml-2 rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-amber-950">{waiting}</span> : null}
        </Button>
      </div>
    </header>
  );
}

/** The bell: what's waiting for a decision. */
function Waiting({ overview: o }: { overview: AdminOverview | null }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const waiting = waitingCount(o);
  const lines: [number, string, string][] = o ? [
    [o.institutions_pending, 'new institution', 'new institutions'],
    [o.venues_pending, 'venue wants to publish', 'venues want to publish'],
    [o.verifications_pending ?? 0, 'verification request', 'verification requests'],
  ] : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button aria-label="Waiting for you" className="relative grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground">
          <Bell className="h-[18px] w-[18px]" />
          {waiting > 0 ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500" /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-4 py-3 text-sm font-semibold">Waiting for your decision</p>
        {waiting ? (
          <ul className="py-1">
            {lines.filter(([n]) => n > 0).map(([n, one, many]) => (
              <li key={one}>
                <button onClick={() => { setOpen(false); navigate('/admin/approvals'); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted">
                  <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-amber-950">{n}</span> {n === 1 ? one : many}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground"><Check className="h-4 w-4 text-emerald-600" /> All caught up</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function AccountMenu() {
  const { user, signOut } = useAdminAuth();
  const navigate = useNavigate();
  const meta = (user?.user_metadata ?? {}) as { display_name?: string; full_name?: string };
  const name = meta.display_name || meta.full_name || (user?.email ?? 'Admin').split('@')[0];
  const initials = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || 'A';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Account" className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{initials}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate">{name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{user?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/dashboard')}><LayoutGrid className="mr-2 h-4 w-4" /> Institution dashboard</DropdownMenuItem>
        <DropdownMenuItem asChild><a href="/" target="_blank" rel="noreferrer"><Eye className="mr-2 h-4 w-4" /> Visitor site</a></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={async () => { await signOut(); navigate('/admin/login', { replace: true }); }}><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The pages inside the current section, as simple tabs. */
function SectionTabs() {
  const s = sectionOf(useLocation().pathname);
  if (s && s.tabs.length > 1) {
    return (
      <nav aria-label={s.label} className="mx-auto -mt-1 mb-5 flex max-w-6xl gap-1 overflow-x-auto border-b print:hidden">
        {s.tabs.map(t => (
          <NavLink key={t.to} to={t.to} end
            className={({ isActive }) => cn('-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
    );
  } else {
    return null;
  }
}
