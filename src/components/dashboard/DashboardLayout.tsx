// The institution's dashboard frame: sidebar, header (venue, search, preview,
// notifications, publish) and the page area. Everything inside works on the
// current venue of the current institution.

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Search, Eye, Bell, HelpCircle, ChevronsLeft, ChevronsRight, Menu, ChevronDown, Check, Plus, LogOut, KeyRound,
  ShieldCheck, Loader2, Globe, Building2, BookOpen, Upload, AlertTriangle, Trees, Sparkles, Lightbulb,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useVenue, type ActivityRow } from '@/components/venue/dashboard/useVenue';
import { venuePlaces } from '@/lib/venue/placeList';
import { describeActivity, timeAgo } from '@/lib/venue/activity';
import { INSTITUTION_KINDS, callAccounts, passwordProblem, isInstitutionKind, type InstitutionKind } from '@/lib/accounts';
import { Logo } from '@/components/auth/AuthShell';
import { DashboardContext, type DashboardValue } from './DashboardContext';
import GlobalSearch from './GlobalSearch';
import PublishDialog from './PublishDialog';
import { NAV } from './nav';
import GuidedTour from './GuidedTour';
import PageTip, { resetPageTips } from './PageTips';

const COLLAPSE_KEY = 'yetnew-sidebar-collapsed';

export default function DashboardLayout() {
  const ws = useWorkspace();
  const { data, error, loading, reload } = useVenue(ws.venueId);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const [mobileNav, setMobileNav] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const { user } = useAdminAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [tourOpen, setTourOpen] = useState(false);
  const tourKey = `yetnew-tour-done-${user?.id}`;

  // First visit: open the welcome tour once the home page has loaded.
  const ready = !!data && data.building.id === ws.venueId;
  useEffect(() => {
    if (!ready || !user || location.pathname !== '/dashboard') return;
    let done = user.user_metadata?.onboarded === true;
    try { done = done || localStorage.getItem(tourKey) === '1'; } catch { /* ignore */ }
    if (!done) { const t = setTimeout(() => setTourOpen(true), 700); return () => clearTimeout(t); }
  }, [ready, user, location.pathname, tourKey]);

  const closeTour = () => {
    setTourOpen(false);
    try { localStorage.setItem(tourKey, '1'); } catch { /* ignore */ }
    if (user?.user_metadata?.onboarded !== true) supabase.auth.updateUser({ data: { onboarded: true } }).catch(() => {});
  };
  const startTour = () => {
    if (location.pathname !== '/dashboard') navigate('/dashboard');
    setTimeout(() => setTourOpen(true), 400);
  };

  const toggleCollapsed = () => setCollapsed(c => { try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* ignore */ } return !c; });

  const value = useMemo<DashboardValue | null>(() => {
    if (!data || data.building.id !== ws.venueId) return null;
    const site = data.building.layout === 'site';
    return {
      data, reload,
      places: venuePlaces(data.nodes, data.rooms, data.pois),
      area: site ? { one: 'Zone', many: 'Zones' } : { one: 'Floor', many: 'Floors' },
      editorUrl: (floorId?: string) => {
        const f = floorId ?? data.floors[0]?.id;
        return f ? `/admin/floors/${data.building.id}/${f}/editor` : null;
      },
      previewUrl: `/venue/${data.building.id}?preview=1`,
      canManageTeam: ws.institution?.role === 'owner' || ws.isPlatformAdmin,
      openPublish: () => setPublishOpen(true),
    };
  }, [data, reload, ws.venueId, ws.institution, ws.isPlatformAdmin]);

  if (ws.loading) return <FullScreen><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></FullScreen>;
  if (!ws.institution) return <CreateInstitution />;
  if (!ws.venueId) return <NoVenue />;

  const sidebar = (mobile: boolean) => (
    <Sidebar collapsed={!mobile && collapsed} onToggle={toggleCollapsed} onNavigate={() => setMobileNav(false)} value={value} mobile={mobile} />
  );

  return (
    <div className="flex min-h-[100dvh] bg-muted/30 text-foreground">
      <aside className={cn('sticky top-0 hidden h-[100dvh] shrink-0 border-r bg-card transition-[width] duration-200 lg:block print:hidden', collapsed ? 'w-[68px]' : 'w-64')}>
        {sidebar(false)}
      </aside>
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebar(true)}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header value={value} onMenu={() => setMobileNav(true)} onSearch={() => setSearchOpen(true)} onPublish={() => setPublishOpen(true)} onTour={startTour} />
        {ws.needsMigration && (
          <p className="mx-4 mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 print:hidden">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Accounts, publishing and activity need one database update: run <code className="font-mono">supabase/migrations/20261002090000_institution_accounts.sql</code> in the Supabase SQL editor.
          </p>
        )}
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 print:p-0">
          {value ? (
            <DashboardContext.Provider value={value}>
              <PageTip hidden={tourOpen} />
              <Outlet />
              <GuidedTour open={tourOpen} firstName={ws.account.displayName.split(' ')[0]} hasMap={value.data.counts.walls + value.data.counts.rooms > 0}
                onClose={closeTour} onUploadMap={() => { const u = value.editorUrl(); if (u) navigate(`${u}?import=1`); }} />
              <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
              <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} data={value.data} me={ws.account.userId} onDone={reload} />
            </DashboardContext.Provider>
          ) : error && !loading ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center"><AlertTriangle className="h-8 w-8 text-amber-500" /><p className="text-sm">{error}</p><Button variant="outline" onClick={reload}>Try again</Button></div>
          ) : (
            <div className="flex items-center justify-center py-32 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your venue…</div>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ collapsed, onToggle, onNavigate, value, mobile }: {
  collapsed: boolean; onToggle: () => void; onNavigate: () => void; value: DashboardValue | null; mobile: boolean;
}) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const editor = value?.editorUrl() ?? null;

  const item = (label: string, Icon: typeof Search, el: ReactNode) => collapsed ? (
    <Tooltip key={label}><TooltipTrigger asChild>{el}</TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>
  ) : el;
  const cls = (active: boolean) => cn('flex h-9 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
    collapsed && 'justify-center px-0', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground');

  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-16 items-center px-4', collapsed ? 'justify-center' : 'justify-between')}>
        <Link to="/dashboard" onClick={onNavigate} aria-label="Yet New dashboard">{collapsed ? <Logo className="[&>*:not(:first-child)]:hidden text-[0px]" /> : <Logo className="text-lg" />}</Link>
        {!mobile && !collapsed && <button onClick={onToggle} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Collapse sidebar"><ChevronsLeft className="h-4 w-4" /></button>}
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Dashboard" data-tour={mobile ? undefined : 'sidebar'}>
        {NAV.map(group => (
          <div key={group.title}>
            {!collapsed && <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">{group.title}</p>}
            <div className="space-y-0.5">
              {group.items.map(i => {
                const label = i.label === 'Floors' ? value?.area.many ?? 'Floors' : i.label;
                if (i.editor) {
                  return item(label, i.icon, (
                    <button key={label} disabled={!editor} onClick={() => { onNavigate(); if (editor) navigate(editor); }} className={cn(cls(false), 'w-full disabled:opacity-40')}>
                      <i.icon className="h-[18px] w-[18px] shrink-0" /> {!collapsed && label}
                    </button>
                  ));
                }
                return item(label, i.icon, (
                  <NavLink key={label} to={i.to!} end={i.to === '/dashboard'} onClick={onNavigate} className={({ isActive }) => cls(isActive)}>
                    <i.icon className="h-[18px] w-[18px] shrink-0" /> {!collapsed && label}
                  </NavLink>
                ));
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t p-3 space-y-1">
        {collapsed && !mobile && <button onClick={onToggle} className={cls(false) + ' w-full'} aria-label="Expand sidebar"><ChevronsRight className="h-4 w-4" /></button>}
        <Link to="/dashboard/settings" onClick={onNavigate} className={cn('flex items-center gap-3 rounded-xl p-2 hover:bg-muted', collapsed && 'justify-center')}>
          <InstitutionMark name={ws.institution?.name ?? ''} logo={ws.institution?.logo_url} />
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{ws.institution?.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{ws.institution?.role === 'admin' ? 'Yet New support' : ws.institution?.role === 'owner' ? 'Owner' : 'Editor'}</span>
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}

export function InstitutionMark({ name, logo, size = 32 }: { name: string; logo?: string | null; size?: number }) {
  return logo
    ? <img src={logo} alt="" className="shrink-0 rounded-lg object-cover" style={{ width: size, height: size }} />
    : <span className="grid shrink-0 place-items-center rounded-lg bg-primary/15 text-xs font-bold text-primary" style={{ width: size, height: size }}>{initials(name)}</span>;
}
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

// ── Header ───────────────────────────────────────────────────────────────────

function Header({ value, onMenu, onSearch, onPublish, onTour }: { value: DashboardValue | null; onMenu: () => void; onSearch: () => void; onPublish: () => void; onTour: () => void }) {
  const ws = useWorkspace();
  const b = value?.data.building;
  const pending = value?.data.unpublished ?? 0;
  const needsFirstPublish = !!b && (!b.is_published || !b.published_at);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-5 print:hidden">
      <button onClick={onMenu} className="rounded-lg p-2 hover:bg-muted lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      <VenueSwitcher />
      {b && (
        <span className={cn('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:flex',
          b.is_published ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-muted text-muted-foreground')}>
          <span className={cn('h-1.5 w-1.5 rounded-full', b.is_published ? 'bg-emerald-500' : 'bg-muted-foreground/60')} />
          {b.is_published ? 'Published' : 'Draft'}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button onClick={onSearch} data-tour="search" className="hidden h-9 w-56 items-center gap-2 rounded-xl border bg-muted/40 px-3 text-sm text-muted-foreground hover:bg-muted md:flex">
          <Search className="h-4 w-4" /> Search venue… <kbd className="ml-auto rounded border bg-background px-1.5 text-[10px]">Ctrl K</kbd>
        </button>
        <IconButton label="Search" onClick={onSearch} className="md:hidden" tour="search"><Search className="h-[18px] w-[18px]" /></IconButton>
        {value && (
          <Button variant="ghost" size="sm" asChild className="hidden h-9 rounded-xl sm:flex" data-tour="preview">
            <a href={value.previewUrl} target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-4 w-4" /> Preview</a>
          </Button>
        )}
        <Notifications activity={value?.data.activity ?? []} />
        <HelpMenu onTour={onTour} />
        <AccountMenu />
        {b && (
          <Button onClick={onPublish} data-tour="publish" className="ml-1 h-9 rounded-xl" variant={pending || needsFirstPublish ? 'default' : 'outline'}>
            <Globe className="mr-1.5 h-4 w-4" />
            <span className="hidden sm:inline">{b.is_published ? 'Publish Changes' : 'Publish'}</span>
            {b.is_published && pending > 0 && (
              <span className="ml-2 rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-amber-950" title={`${pending} unpublished change${pending === 1 ? '' : 's'}`}>{pending}</span>
            )}
          </Button>
        )}
      </div>
      {ws.isPlatformAdmin && ws.institution?.role === 'admin' && (
        <span className="absolute left-1/2 top-full -translate-x-1/2 rounded-b-lg bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white">Support view · {ws.institution.name}</span>
      )}
    </header>
  );
}

function IconButton({ label, onClick, children, className, tour }: { label: string; onClick?: () => void; children: ReactNode; className?: string; tour?: string }) {
  return <button onClick={onClick} aria-label={label} data-tour={tour} title={label} className={cn('relative grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground', className)}>{children}</button>;
}

function VenueSwitcher() {
  const ws = useWorkspace();
  const [adding, setAdding] = useState(false);
  const venue = ws.venues.find(v => v.id === ws.venueId);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger data-tour="venue" className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1 text-left hover:bg-muted">
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold leading-tight">{venue?.name ?? 'Venue'}</span>
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">Digital Venue · {ws.institution?.name}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Venues of {ws.institution?.name}</DropdownMenuLabel>
          {ws.venues.map(v => (
            <DropdownMenuItem key={v.id} onSelect={() => ws.setVenueId(v.id)}>
              {v.layout === 'site' ? <Trees className="mr-2 h-4 w-4" /> : <Building2 className="mr-2 h-4 w-4" />}
              <span className="flex-1 truncate">{v.name}</span>
              {v.id === ws.venueId && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAdding(true)}><Plus className="mr-2 h-4 w-4" /> Add a venue</DropdownMenuItem>
          {ws.institutions.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Switch institution</DropdownMenuLabel>
              {ws.institutions.slice(0, 12).map(i => (
                <DropdownMenuItem key={i.id} onSelect={() => ws.setInstitutionId(i.id)}>
                  <span className="flex-1 truncate">{i.name}</span>
                  {i.role === 'admin' && <span className="text-[10px] text-muted-foreground">support</span>}
                  {i.id === ws.institution?.id && <Check className="ml-1 h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <NewVenueDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}

export function NewVenueDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<'building' | 'site'>(() => (isInstitutionKind(ws.institution?.kind) ? INSTITUTION_KINDS[ws.institution!.kind as InstitutionKind].layout : 'building'));
  const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!ws.institution || name.trim().length < 2) return;
    setBusy(true);
    const { data, error } = await supabase.from('buildings')
      .insert({ name: name.trim(), institution_id: ws.institution.id, is_published: false, version: 1, layout })
      .select('id').single();
    if (!error && data) await supabase.from('floors').insert({ building_id: data.id, name: layout === 'site' ? 'Entire site' : 'Ground floor', level: 0 });
    setBusy(false);
    if (error || !data) { toast.error(error?.message ?? 'Could not create the venue'); return; }
    toast.success(`${name.trim()} created`);
    onOpenChange(false); setName('');
    await ws.reload();
    ws.setVenueId(data.id);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create}>
          <DialogHeader>
            <DialogTitle>Add a venue</DialogTitle>
            <DialogDescription>Another building, park or site your institution runs. Each venue has its own map and visitor experience.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. National Museum building" aria-label="Venue name" />
            <div className="grid grid-cols-2 gap-2">
              {([['building', Building2, 'A building', 'With floors'], ['site', Trees, 'An outdoor site', 'With zones']] as const).map(([id, Icon, label, sub]) => (
                <button key={id} type="button" onClick={() => setLayout(id)} aria-pressed={layout === id}
                  className={cn('rounded-xl border p-3 text-left', layout === id ? 'border-primary bg-primary/10' : 'hover:bg-muted')}>
                  <Icon className="h-5 w-5 text-primary" /><span className="mt-1 block text-sm font-semibold">{label}</span><span className="block text-xs text-muted-foreground">{sub}</span>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter><Button type="submit" disabled={busy || name.trim().length < 2}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Create venue</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Notifications({ activity }: { activity: ActivityRow[] }) {
  const ws = useWorkspace();
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem('yetnew-notifications-seen') ?? ''; } catch { return ''; } });
  const others = activity.filter(a => a.actor_id !== ws.account.userId).slice(0, 15);
  const unread = others.filter(a => a.created_at > seen).length;
  const markSeen = useCallback(() => {
    const now = new Date().toISOString(); setSeen(now);
    try { localStorage.setItem('yetnew-notifications-seen', now); } catch { /* ignore */ }
  }, []);
  return (
    <Popover onOpenChange={o => !o && markSeen()}>
      <PopoverTrigger asChild>
        <button aria-label="Notifications" className="relative grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground">
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-4 py-3 text-sm font-semibold">What your team changed</p>
        <ul className="max-h-80 overflow-y-auto">
          {others.map(a => (
            <li key={a.id} className={cn('px-4 py-2.5 text-sm', a.created_at > seen && 'bg-primary/5')}>
              <p>{describeActivity(a, ws.account.userId)}</p>
              <p className="text-[11px] text-muted-foreground">{timeAgo(a.created_at)}</p>
            </li>
          ))}
          {!others.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing new from your team.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function HelpMenu({ onTour }: { onTour: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button aria-label="Help" data-tour="help" className="hidden h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground sm:grid"><HelpCircle className="h-[18px] w-[18px]" /></button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-sm font-semibold">How Yet New works</p>
        <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li><b className="text-foreground">1. Build</b> — upload your map (CAD, PDF, image) in the Map Editor; we turn it into a 3D world.</li>
          <li><b className="text-foreground">2. Manage</b> — name places, add photos, hours, events and stories.</li>
          <li><b className="text-foreground">3. Publish</b> — visitors see your changes when you press Publish Changes.</li>
          <li><b className="text-foreground">4. Experience</b> — share the link or print QR codes for your gates.</li>
        </ol>
        <div className="mt-4 space-y-1 border-t pt-3">
          <button onClick={() => { setOpen(false); onTour(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-muted"><Sparkles className="h-4 w-4 text-primary" /> Take the tour again</button>
          <button onClick={() => { resetPageTips(); setOpen(false); location.reload(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-muted"><Lightbulb className="h-4 w-4 text-primary" /> Show page tips again</button>
          <Link to="/doc" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-muted"><BookOpen className="h-4 w-4 text-primary" /> Read the guide</Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AccountMenu() {
  const ws = useWorkspace();
  const { signOut } = useAdminAuth();
  const navigate = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Account" className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {initials(ws.account.displayName)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>
            <span className="block truncate">{ws.account.displayName}</span>
            {ws.account.username && <span className="block truncate text-xs font-normal text-muted-foreground">@{ws.account.username}</span>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate('/dashboard/team')}><Building2 className="mr-2 h-4 w-4" /> {ws.institution?.name} team</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPwOpen(true)}><KeyRound className="mr-2 h-4 w-4" /> Change password</DropdownMenuItem>
          {ws.isPlatformAdmin && <DropdownMenuItem onSelect={() => navigate('/admin')}><ShieldCheck className="mr-2 h-4 w-4" /> Platform console</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={async () => { await signOut(); navigate('/login', { replace: true }); }}><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePassword open={pwOpen} onOpenChange={setPwOpen} />
    </>
  );
}

function ChangePassword({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = pw ? passwordProblem(pw) : null;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw || problem) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Password changed'); setPw(''); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={save}>
          <DialogHeader><DialogTitle>Change your password</DialogTitle><DialogDescription>You'll use it next time you sign in.</DialogDescription></DialogHeader>
          <div className="space-y-1.5 py-5">
            <Input type="password" autoComplete="new-password" autoFocus value={pw} onChange={e => setPw(e.target.value)} placeholder="New password" aria-label="New password" />
            <p className={cn('text-xs', problem ? 'text-amber-700' : 'text-muted-foreground')}>{problem ?? 'At least 8 characters, letters and numbers.'}</p>
          </div>
          <DialogFooter><Button type="submit" disabled={busy || !pw || !!problem}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── First-run screens ────────────────────────────────────────────────────────

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-muted/30 px-6 text-center">{children}</div>;
}

/** Signed in, but not part of any institution yet (e.g. an older email account). */
function CreateInstitution() {
  const ws = useWorkspace();
  const { signOut } = useAdminAuth();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<InstitutionKind>('park');
  const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await callAccounts('create_institution', { institution: { name, kind } }); await ws.reload(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not create the institution'); }
    finally { setBusy(false); }
  };
  return (
    <FullScreen>
      <Logo className="text-xl" />
      <form onSubmit={create} className="w-full max-w-sm space-y-4 rounded-3xl border bg-card p-6 text-left shadow-sm">
        <div>
          <h1 className="text-xl font-bold">Set up your institution</h1>
          <p className="text-sm text-muted-foreground">You're signed in, but not part of an institution yet. Create one, or ask an owner to add you to their team.</p>
        </div>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Institution name" aria-label="Institution name" />
        <select value={kind} onChange={e => setKind(e.target.value as InstitutionKind)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" aria-label="Kind">
          {(Object.keys(INSTITUTION_KINDS) as InstitutionKind[]).map(k => <option key={k} value={k}>{INSTITUTION_KINDS[k].label}</option>)}
        </select>
        <Button type="submit" className="w-full" disabled={busy || name.trim().length < 2}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Create institution</Button>
        <button type="button" onClick={() => signOut()} className="w-full text-center text-xs text-muted-foreground hover:underline">Sign out</button>
      </form>
    </FullScreen>
  );
}

function NoVenue() {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  return (
    <FullScreen>
      <Logo className="text-xl" />
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-bold">Create your digital venue</h1>
        <p className="text-sm text-muted-foreground">{ws.institution?.name} has no venues yet. Add one, then upload your existing map or floor plan and we'll turn it into an interactive digital world.</p>
        <Button onClick={() => setOpen(true)}><Upload className="mr-1.5 h-4 w-4" /> Create a venue</Button>
      </div>
      <NewVenueDialog open={open} onOpenChange={setOpen} />
    </FullScreen>
  );
}
