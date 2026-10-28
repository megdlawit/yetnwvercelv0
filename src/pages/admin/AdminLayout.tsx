// The Yet New control center frame: the same sidebar, header and panels as an
// institution's dashboard, for the platform team — every institution, venue
// and person, the approvals, and the platform tools.

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShieldCheck, Building, Map as MapIcon, Users, History, Building2, Sparkles, Route, Layers, Code2,
  ChevronsLeft, ChevronsRight, Menu, LogOut, LayoutGrid, AlertTriangle, ExternalLink, Search,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/auth/AuthShell';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { useAdminQuery, type AdminOverview } from './useAdmin';

interface AdminValue { overview: AdminOverview | null; reloadOverview: () => void; needsMigration: boolean; query: string; setQuery: (q: string) => void }
const AdminCtx = createContext<AdminValue | null>(null);
export const useAdminConsole = () => {
  const v = useContext(AdminCtx);
  if (!v) throw new Error('useAdminConsole outside AdminLayout');
  return v;
};

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; badge?: (o: AdminOverview | null) => number };
const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Control center', items: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard },
    { to: '/admin/approvals', label: 'Approvals', icon: ShieldCheck, badge: o => (o ? o.institutions_pending + o.venues_pending + (o.verifications_pending ?? 0) : 0) },
    { to: '/admin/institutions', label: 'Institutions', icon: Building },
    { to: '/admin/venues', label: 'Venues', icon: MapIcon },
    { to: '/admin/users', label: 'People', icon: Users },
    { to: '/admin/activity', label: 'Activity', icon: History },
    { to: '/admin/insights', label: 'Insights', icon: BarChart3 },
  ] },
  { title: 'Platform tools', items: [
    { to: '/admin/tools/buildings', label: 'Buildings & floors', icon: Building2 },
    { to: '/admin/tools/pois', label: 'Points of interest', icon: Sparkles },
    { to: '/admin/tools/paths', label: 'Outdoor paths', icon: Route },
    { to: '/admin/tools/layers', label: 'Map layers', icon: Layers },
    { to: '/admin/tools/embed', label: 'Embed codes', icon: Code2 },
  ] },
];

const COLLAPSE_KEY = 'yetnew-admin-sidebar-collapsed';

export default function AdminLayout() {
  const overview = useAdminQuery<AdminOverview>('admin_overview');
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const [mobileNav, setMobileNav] = useState(false);
  const [query, setQuery] = useState('');
  const toggle = () => setCollapsed(c => { try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  const value: AdminValue = { overview: overview.data, reloadOverview: overview.reload, needsMigration: overview.needsMigration, query, setQuery };

  return (
    <AdminCtx.Provider value={value}>
      <div className="flex min-h-[100dvh] bg-muted/30 text-foreground">
        <aside className={cn('sticky top-0 hidden h-[100dvh] shrink-0 border-r bg-card transition-[width] duration-200 lg:block', collapsed ? 'w-[68px]' : 'w-64')}>
          <Sidebar collapsed={collapsed} onToggle={toggle} onNavigate={() => {}} overview={overview.data} />
        </aside>
        <Sheet open={mobileNav} onOpenChange={setMobileNav}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar collapsed={false} mobile onToggle={toggle} onNavigate={() => setMobileNav(false)} overview={overview.data} />
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 flex-1 flex-col">
          <Header onMenu={() => setMobileNav(true)} query={query} setQuery={setQuery} />
          {overview.needsMigration && (
            <p className="mx-4 mt-4 flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>The control center needs one database update: run <code className="font-mono">supabase/migrations/20261008110000_admin_control_center.sql</code> in the Supabase SQL editor, then reload.</span>
            </p>
          )}
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6"><Outlet /></main>
        </div>
      </div>
    </AdminCtx.Provider>
  );
}

function Sidebar({ collapsed, onToggle, onNavigate, overview, mobile = false }: {
  collapsed: boolean; onToggle: () => void; onNavigate: () => void; overview: AdminOverview | null; mobile?: boolean;
}) {
  const wrap = (label: string, el: ReactNode) => collapsed
    ? <Tooltip key={label}><TooltipTrigger asChild>{el}</TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>
    : el;
  const cls = (active: boolean) => cn('flex h-9 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
    collapsed && 'justify-center px-0', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground');
  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-16 items-center px-4', collapsed ? 'justify-center' : 'justify-between')}>
        <Link to="/admin" onClick={onNavigate} aria-label="Yet New control center" className="flex items-center gap-2">
          {collapsed ? <Logo className="[&>*:not(:first-child)]:hidden text-[0px]" /> : <Logo className="text-lg" />}
        </Link>
        {!mobile && !collapsed && <button onClick={onToggle} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Collapse sidebar"><ChevronsLeft className="h-4 w-4" /></button>}
      </div>
      {!collapsed && <p className="mx-4 -mt-1 mb-3 w-fit rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-bold text-violet-800 dark:bg-violet-950 dark:text-violet-300">Control center</p>}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Control center">
        {NAV.map(group => (
          <div key={group.title}>
            {!collapsed && <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">{group.title}</p>}
            <div className="space-y-0.5">
              {group.items.map(i => {
                const badge = i.badge?.(overview) ?? 0;
                return wrap(i.label, (
                  <NavLink key={i.to} to={i.to} end={i.to === '/admin'} onClick={onNavigate} className={({ isActive }) => cls(isActive)}>
                    <span className="relative"><i.icon className="h-[18px] w-[18px] shrink-0" />{collapsed && badge > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500" />}</span>
                    {!collapsed && <span className="flex-1">{i.label}</span>}
                    {!collapsed && badge > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-amber-950">{badge}</span>}
                  </NavLink>
                ));
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-1 border-t p-3">
        {collapsed && !mobile && <button onClick={onToggle} className={cn(cls(false), 'w-full')} aria-label="Expand sidebar"><ChevronsRight className="h-4 w-4" /></button>}
        {wrap('My institution dashboard', (
          <Link to="/dashboard" onClick={onNavigate} className={cls(false)}><LayoutGrid className="h-[18px] w-[18px] shrink-0" /> {!collapsed && 'Institution dashboard'}</Link>
        ))}
      </div>
    </div>
  );
}

function Header({ onMenu, query, setQuery }: { onMenu: () => void; query: string; setQuery: (q: string) => void }) {
  const { user, signOut } = useAdminAuth();
  const navigate = useNavigate();
  const initials = (user?.email ?? 'A').split('@')[0].slice(0, 2).toUpperCase();
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-5">
      <button onClick={onMenu} className="rounded-lg p-2 hover:bg-muted lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold leading-tight">Yet New</p>
        <p className="truncate text-[11px] leading-tight text-muted-foreground">Control center · all institutions</p>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <label className="hidden h-9 w-64 items-center gap-2 rounded-xl border bg-muted/40 px-3 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring md:flex">
          <Search className="h-4 w-4" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter institutions, venues, people…" className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
        </label>
        <Button variant="ghost" size="sm" asChild className="hidden h-9 rounded-xl sm:flex"><a href="/" target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" /> Visitor site</a></Button>
        <DropdownMenu>
          <DropdownMenuTrigger className="grid h-9 w-9 place-items-center rounded-full bg-violet-600 text-xs font-bold text-white" aria-label="Account">{initials}</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/dashboard')}><LayoutGrid className="mr-2 h-4 w-4" /> Institution dashboard</DropdownMenuItem>
            <DropdownMenuItem onSelect={async () => { await signOut(); navigate('/admin/login', { replace: true }); }}><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
