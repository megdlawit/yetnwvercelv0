// Dashboard home: "What is happening with my digital venue?"
// Build → Manage → Publish → Experience, all from one page.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  PenTool, Eye, Plus, Landmark, CalendarDays, QrCode, Square, Box, Maximize2, Layers, CheckCircle2, Circle, AlertTriangle,
  MapPin, DoorOpen, Newspaper, Globe, Activity, HeartPulse, Smartphone, ArrowRight, Upload, Map as MapIcon, Sparkles, X,
  Users, BookOpen, Compass, Megaphone, Images, Route, Globe2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import VenueViewer from '@/components/venue/dashboard/VenueViewer';
import VenueWorld from '@/components/venue/dashboard/VenueWorld';
import { anchorOf } from '@/lib/venue/geoVenue';
import { unreachablePlaces, type PoiRow } from '@/components/venue/dashboard/useVenue';
import type { PlaceEntry } from '@/lib/venue/placeList';
import { venueHealth } from '@/lib/venue/health';
import { describeActivity, dayLabel, timeAgo } from '@/lib/venue/activity';
import { themeOf } from '@/lib/venue/themes';
import { PLACE_TYPES } from '@/lib/venue/places';
import { qrLink } from '@/lib/QRCodeGenerator';
import { Panel, StatusDot } from './ui';

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const ws = useWorkspace();
  const { data, places, area, editorUrl, previewUrl, openPublish } = useDashboard();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const b = data.building;
  const theme = themeOf(b.theme);
  const unreachable = useMemo(() => unreachablePlaces(data).length, [data]);
  const h = useMemo(() => venueHealth({
    counts: data.counts, rooms: data.rooms, edges: data.edges, places, unreachable,
    content: data.content, published: b.is_published, publishedAt: b.published_at ?? null,
  }), [data, places, unreachable, b]);
  const editor = editorUrl();
  const welcome = params.get('welcome') === '1';
  const lastChange = data.activity[0]?.created_at ?? b.updated_at;

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{welcome ? `Welcome to Yet New, ${ws.account.displayName.split(' ')[0]}!` : `${greeting()}, ${ws.institution?.name} Team`}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your digital venue, visitor experience, and spatial content from one place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => editor && navigate(editor)} disabled={!editor} data-tour="edit-map"><PenTool className="mr-1.5 h-4 w-4" /> Edit Map</Button>
          <Button variant="outline" asChild><a href={previewUrl} target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-4 w-4" /> Preview Visitor Experience</a></Button>
          <Button variant="outline" onClick={() => navigate('/dashboard/places?new=1')}><Plus className="mr-1.5 h-4 w-4" /> Add Place</Button>
          <Button variant="outline" onClick={() => navigate('/dashboard/attractions?new=1')}><Landmark className="mr-1.5 h-4 w-4" /> Add Attraction</Button>
        </div>
      </div>

      <Pipeline h={h} published={b.is_published} contentCount={data.content.length} />

      {h.setupPct < 100 && <SetupChecklist h={h} editor={editor} onPublish={openPublish} welcome={welcome} onDismissWelcome={() => { params.delete('welcome'); setParams(params, { replace: true }); }} />}

      {/* Hero + status */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <HeroVenue h={h} lastChange={lastChange} />
        <div className="space-y-6">
          <Panel title="Venue Status" icon={Activity} bodyClassName="px-5 pb-5">
            <ul className="space-y-2.5 text-sm">
              <StatusRow label="Map" value={h.hasMap ? 'Ready' : 'Not uploaded'} ok={h.hasMap} />
              <StatusRow label="3D World" value={h.hasMap ? 'Generated' : 'Waiting for map'} ok={h.hasMap} />
              <StatusRow label="Places" value={String(places.length)} ok={places.length > 0} />
              <StatusRow label="Areas" value={String(data.counts.rooms)} ok={data.counts.rooms > 0} />
              <StatusRow label="Entry Points" value={String(h.entryPoints.length)} ok={h.entryPoints.length > 0} />
              <StatusRow label="Content" value={`${h.contentPct}%`} ok={h.contentPct >= 60} warn={h.contentPct > 0} />
              <StatusRow label="Visitor Experience" value={b.is_published ? (data.unpublished ? `Published · ${data.unpublished} pending` : 'Published') : 'Not published'} ok={b.is_published && !data.unpublished} warn={b.is_published} />
            </ul>
            <div className="mt-4 rounded-2xl bg-muted/60 p-3">
              <div className="flex items-center justify-between text-xs font-semibold"><span>Setup complete</span><span>{h.setupPct}%</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${h.setupPct}%` }} /></div>
            </div>
          </Panel>
          <PublishCard onPublish={openPublish} />
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat to="/dashboard/places" icon={MapPin} label="Places" value={places.length} sub="Attractions, facilities, cafés and more" />
        <Stat to="/dashboard/areas" icon={Square} label="Areas" value={data.counts.rooms} sub={`Rooms, gardens and sections on ${data.floors.length} ${data.floors.length === 1 ? area.one.toLowerCase() : area.many.toLowerCase()}`} />
        <Stat to="/dashboard/entry-points" icon={DoorOpen} label="Entry Points" value={h.entryPoints.length} sub="QR-enabled visitor entries" />
        <Stat to="/dashboard/attractions" icon={Landmark} label="Attractions" value={h.attractions.length} sub={`${h.attractions.filter(a => a.visible).length} visible to visitors`} />
        <Stat to="/dashboard/events" icon={CalendarDays} label="Events" value={h.upcomingEvents.length} sub="Upcoming and running" />
        <Stat to="/dashboard/places" icon={Sparkles} label="Content" value={`${h.contentPct}%`} sub="Places with descriptions and photos" />
      </div>

      <QuickActions editor={editor} previewUrl={previewUrl} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <RecentActivity />
        <MapHealth h={h} unreachable={unreachable} editor={editor} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <VisitorPreview previewUrl={previewUrl} />
        <div className="space-y-6">
          <EntryPoints entries={h.entryPoints} />
          <ContentOverview attractions={h.attractions.length} />
        </div>
      </div>

      <PlacesOverview />
      <MapEditorEntry editor={editor} />
    </div>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

type Health = ReturnType<typeof venueHealth<PlaceEntry<PoiRow>>>;

function Pipeline({ h, published, contentCount }: { h: Health; published: boolean; contentCount: number }) {
  const { places } = useDashboard();
  const steps = [
    { icon: MapIcon, label: 'Map', done: h.hasMap },
    { icon: Box, label: '3D World', done: h.hasMap },
    { icon: MapPin, label: 'Places', done: places.length > 0 },
    { icon: Newspaper, label: 'Content', done: contentCount > 0 },
    { icon: Users, label: 'Visitor Experience', done: published },
  ];
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-3xl border bg-card px-4 py-3 text-sm">
      <span className="mr-2 shrink-0 text-xs font-bold uppercase tracking-wider text-muted-foreground">Your venue, digitized</span>
      {steps.map((s, i) => (
        <div key={s.label} className="flex shrink-0 items-center gap-1">
          <span className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium', s.done ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
            <s.icon className="h-4 w-4" /> {s.label} {s.done && <CheckCircle2 className="h-3.5 w-3.5" />}
          </span>
          {i < steps.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground/50" />}
        </div>
      ))}
    </div>
  );
}

function SetupChecklist({ h, editor, onPublish, welcome, onDismissWelcome }: { h: Health; editor: string | null; onPublish: () => void; welcome: boolean; onDismissWelcome: () => void }) {
  const navigate = useNavigate();
  const done = h.steps.filter(s => s.done).length;
  const next = h.steps.find(s => !s.done);
  const go = (id: string) => {
    if (id === 'map' || id === '3d') { if (editor) navigate(`${editor}${id === 'map' ? '?import=1' : ''}`); }
    else if (id === 'entrance') navigate('/dashboard/entry-points');
    else if (id === 'places') navigate('/dashboard/places');
    else if (id === 'content') navigate('/dashboard/stories?new=1');
    else onPublish();
  };
  return (
    <section data-tour="setup" className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
      {welcome && <button onClick={onDismissWelcome} className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Dismiss"><X className="h-4 w-4" /></button>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{h.hasMap ? 'Your digital venue is taking shape' : 'Set up your digital venue'}</h2>
          <p className="text-sm text-muted-foreground">{done} of {h.steps.length} complete{next ? ` · Next: ${next.label.toLowerCase()}` : ''}</p>
        </div>
        {next && <Button onClick={() => go(next.id)}>{next.id === 'map' ? <><Upload className="mr-1.5 h-4 w-4" /> Upload Map</> : <>Continue Setup <ArrowRight className="ml-1.5 h-4 w-4" /></>}</Button>}
      </div>
      <ol className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {h.steps.map((s, i) => (
          <li key={s.id}>
            <button onClick={() => go(s.id)} className={cn('flex h-full w-full items-start gap-2.5 rounded-2xl border bg-background/70 p-3 text-left transition-colors hover:border-primary/40',
              s === next && 'border-primary/50 ring-2 ring-primary/15')}>
              {s.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/50" />}
              <span>
                <span className={cn('block text-sm font-semibold', s.done && 'text-muted-foreground line-through decoration-1')}>{i + 1}. {s.label}</span>
                <span className="block text-[11px] text-muted-foreground">{s.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function HeroVenue({ h, lastChange }: { h: Health; lastChange: string }) {
  const { data, area, editorUrl, previewUrl } = useDashboard();
  const navigate = useNavigate();
  const placed = !!anchorOf(data.building);
  const [mode, setMode] = useState<'world' | '2d' | '3d'>(placed ? 'world' : '3d');
  const [floorId, setFloorId] = useState(data.floors[0]?.id ?? null);
  const box = useRef<HTMLDivElement>(null);
  const floor = data.floors.find(f => f.id === floorId) ?? data.floors[0];
  const editor = editorUrl(floor?.id);
  const b = data.building;

  return (
    <Panel className="flex flex-col" bodyClassName="flex flex-1 flex-col" tour="hero">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-lg font-bold">Your Digital Venue</h2>
          <p className="text-xs text-muted-foreground">{themeOf(b.theme).label} theme · the same model powers the 2D plan, the 3D world and the visitor app</p>
        </div>
        <div className="flex items-center gap-2">
          {data.floors.length > 1 && (
            <label className="flex items-center gap-1.5 rounded-xl border px-2 py-1 text-xs">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <select value={floor?.id ?? ''} onChange={e => setFloorId(e.target.value)} className="bg-transparent outline-none" aria-label={area.one}>
                {data.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          )}
          <div className="flex rounded-xl bg-muted p-0.5" role="tablist" aria-label="View">
            {([...(placed ? ['world' as const] : []), '2d' as const, '3d' as const]).map(m => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                className={cn('flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold', mode === m ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
                {m === '2d' ? <Square className="h-3.5 w-3.5" /> : m === '3d' ? <Box className="h-3.5 w-3.5" /> : <Globe2 className="h-3.5 w-3.5" />} {m === 'world' ? 'World' : m.toUpperCase()}
              </button>
            ))}
          </div>
          <button onClick={() => box.current?.requestFullscreen?.()} className="rounded-xl border p-1.5 text-muted-foreground hover:bg-muted" aria-label="Fullscreen"><Maximize2 className="h-4 w-4" /></button>
        </div>
      </div>
      <div ref={box} className="relative mx-3 flex-1 overflow-hidden rounded-2xl border bg-muted/40 fullscreen:m-0 fullscreen:rounded-none" style={{ minHeight: 420 }}>
        {h.hasMap && mode === 'world' ? (
          <VenueWorld building={b} groundFloorId={[...data.floors].sort((x, y) => x.level - y.level)[0]?.id ?? null} floors={data.floors.length}
            onEnter={id => { if (id === b.id) setMode('3d'); }} className="absolute inset-0" />
        ) : h.hasMap ? (
          <VenueViewer key={`${mode}-${floor?.id}`} buildingId={b.id} floorId={floor?.id ?? null} level={floor?.level ?? 0} theme={themeOf(b.theme)} mode={mode === 'world' ? '3d' : mode} className="absolute inset-0" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-primary/10 text-primary"><Upload className="h-7 w-7" /></span>
            <h3 className="text-xl font-bold">Create Your Digital Venue</h3>
            <p className="max-w-md text-sm text-muted-foreground">Upload your existing map or floor plan — CAD (DXF, DWG export, IFC), PDF or an image — and we'll turn it into an interactive digital world.</p>
            <div className="flex gap-2">
              <Button onClick={() => editor && navigate(`${editor}?import=1`)} disabled={!editor}><Upload className="mr-1.5 h-4 w-4" /> Upload Map</Button>
              <Button variant="outline" asChild><Link to="/doc/admin">View Example</Link></Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-3">
          <span>Last updated {timeAgo(lastChange)}</span>
          <span className="flex items-center gap-1.5"><StatusDot ok={b.is_published} /> {b.is_published ? 'Published' : 'Draft'}</span>
          {h.hasMap && !placed && <Link to="/dashboard/settings#location" className="flex items-center gap-1 font-medium text-primary hover:underline"><Globe2 className="h-3.5 w-3.5" /> Place on the world map</Link>}
        </span>
        <span className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => editor && navigate(editor)} disabled={!editor}><PenTool className="mr-1.5 h-3.5 w-3.5" /> Edit Map</Button>
          <Button size="sm" variant="outline" asChild><a href={previewUrl} target="_blank" rel="noreferrer"><MapIcon className="mr-1.5 h-3.5 w-3.5" /> View Map</a></Button>
        </span>
      </div>
    </Panel>
  );
}

function StatusRow({ label, value, ok, warn }: { label: string; value: string; ok: boolean; warn?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-semibold">
        {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : warn ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <Circle className="h-4 w-4 text-muted-foreground/50" />}
        {value}
      </span>
    </li>
  );
}

function PublishCard({ onPublish }: { onPublish: () => void }) {
  const { data, previewUrl } = useDashboard();
  const b = data.building;
  const pending = data.unpublished;
  const live = b.is_published && !!b.published_at;
  return (
    <Panel bodyClassName="p-5">
      {live && pending > 0 ? (
        <>
          <p className="flex items-center gap-2 text-sm font-bold text-amber-700 dark:text-amber-400"><span className="h-2 w-2 rounded-full bg-amber-500" /> Changes Ready to Publish</p>
          <p className="mt-1 text-sm text-muted-foreground">You have <b className="text-foreground">{pending} change{pending === 1 ? '' : 's'}</b> visitors can't see yet.</p>
          <Button className="mt-4 w-full" onClick={onPublish}>Review &amp; Publish</Button>
        </>
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your Digital Venue</p>
          <p className="mt-1 flex items-center gap-2 text-lg font-bold"><StatusDot ok={b.is_published} /> {b.is_published ? 'Published' : 'Not published yet'}</p>
          <p className="text-xs text-muted-foreground">
            {b.published_at ? `Last published ${new Date(b.published_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}` : b.is_published ? 'Publish once more to start tracking changes' : 'Only your team can see it'}
          </p>
          {b.is_published && (
            <ul className="mt-3 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              {['3D map', 'Search', 'Navigation', 'Attractions', 'Events', 'Visitor information'].map(x => <li key={x} className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" /> {x}</li>)}
            </ul>
          )}
          <div className="mt-4 flex gap-2">
            <Button variant="outline" className="flex-1" asChild><a href={previewUrl} target="_blank" rel="noreferrer">Preview</a></Button>
            <Button className="flex-1" onClick={onPublish}>{b.is_published ? 'Publish Changes' : 'Publish'}</Button>
          </div>
        </>
      )}
    </Panel>
  );
}

function Stat({ to, icon: Icon, label, value, sub }: { to: string; icon: typeof MapPin; label: string; value: number | string; sub: string }) {
  return (
    <Link to={to} className="group rounded-3xl border bg-card p-4 transition-colors hover:border-primary/40">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className="grid h-7 w-7 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>{label}</span>
      <span className="mt-2 block text-3xl font-bold tabular-nums">{value}</span>
      <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>
    </Link>
  );
}

function QuickActions({ editor, previewUrl }: { editor: string | null; previewUrl: string }) {
  const navigate = useNavigate();
  const actions = [
    { icon: PenTool, title: 'Edit Map', text: 'Modify the 2D plan and 3D digital world.', run: () => editor && navigate(editor) },
    { icon: MapPin, title: 'Add Place', text: 'A restaurant, restroom, entrance, parking…', run: () => navigate('/dashboard/places?new=1') },
    { icon: Landmark, title: 'Add Attraction', text: 'A visitor attraction with images and information.', run: () => navigate('/dashboard/attractions?new=1') },
    { icon: CalendarDays, title: 'Add Event', text: 'Publish an upcoming event.', run: () => navigate('/dashboard/events?new=1') },
    { icon: QrCode, title: 'Create QR Code', text: 'An entry QR code for a gate or entrance.', run: () => navigate('/dashboard/entry-points') },
    { icon: Eye, title: 'Preview Experience', text: 'See the venue exactly as visitors see it.', run: () => window.open(previewUrl, '_blank') },
  ];
  return (
    <section data-tour="quick-actions">
      <h2 className="mb-3 text-sm font-semibold">Quick Actions</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {actions.map(a => (
          <button key={a.title} onClick={a.run} className="group rounded-3xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm"><a.icon className="h-5 w-5" /></span>
            <span className="mt-3 block font-semibold">{a.title}</span>
            <span className="block text-xs text-muted-foreground">{a.text}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RecentActivity() {
  const ws = useWorkspace();
  const { data } = useDashboard();
  const groups = useMemo(() => {
    const out: { day: string; items: typeof data.activity }[] = [];
    for (const a of data.activity.slice(0, 14)) {
      const d = dayLabel(a.created_at);
      if (out[out.length - 1]?.day === d) out[out.length - 1].items.push(a); else out.push({ day: d, items: [a] });
    }
    return out;
  }, [data]);
  const icon = (t: string) => ({ map: MapIcon, place: MapPin, floor: Layers, venue: Globe, event: CalendarDays, tour: Route } as Record<string, typeof MapPin>)[t] ?? Newspaper;
  return (
    <Panel title="Recent Activity" icon={Activity} bodyClassName="px-5 pb-5">
      {groups.length ? (
        <div className="space-y-4">
          {groups.map(g => (
            <div key={g.day}>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.day}</p>
              <ol className="relative space-y-3 border-l pl-5">
                {g.items.map(a => {
                  const Icon = icon(a.object_type);
                  return (
                    <li key={a.id} className="relative">
                      <span className="absolute -left-[31px] grid h-5 w-5 place-items-center rounded-full border bg-card"><Icon className="h-3 w-3 text-primary" /></span>
                      <p className="text-sm">{describeActivity(a, ws.account.userId)}</p>
                      <p className="text-[11px] text-muted-foreground">{timeAgo(a.created_at)}</p>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">{data.missing.includes('venue_activity') ? 'Activity appears after the database update.' : 'Changes your team makes will show up here.'}</p>
      )}
    </Panel>
  );
}

function MapHealth({ h, unreachable, editor }: { h: Health; unreachable: number; editor: string | null }) {
  const navigate = useNavigate();
  const { data } = useDashboard();
  const rows = [
    { label: 'Spatial Model', ok: h.hasMap && h.pathsReady, value: !h.hasMap ? 'No map yet' : h.pathsReady ? 'Healthy' : 'Needs paths' },
    { label: 'CAD Import', ok: h.imported, value: h.imported ? 'Converted' : 'None — drawn by hand', neutral: !h.imported },
    { label: '2D Map', ok: h.hasMap, value: h.hasMap ? 'Ready' : 'Waiting' },
    { label: '3D World', ok: h.hasMap, value: h.hasMap ? 'Generated' : 'Waiting' },
    { label: 'World Map', ok: !!anchorOf(data.building), value: anchorOf(data.building) ? 'Placed' : 'Not placed', neutral: !anchorOf(data.building), to: '/dashboard/settings#location' },
  ];
  return (
    <Panel title="Map Health" icon={HeartPulse} bodyClassName="px-5 pb-5">
      <ul className="space-y-2.5 text-sm">
        {rows.map(r => (
          <li key={r.label} className="flex items-center justify-between">
            {'to' in r && r.to && !r.ok ? <Link to={r.to} className="text-primary hover:underline">{r.label}</Link> : <span className="text-muted-foreground">{r.label}</span>}
            <span className="flex items-center gap-1.5 font-semibold">{r.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : r.neutral ? <Circle className="h-4 w-4 text-muted-foreground/50" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />} {r.value}</span>
          </li>
        ))}
        <li className="flex items-center justify-between">
          <span className="text-muted-foreground">Unresolved Objects</span>
          <span className={cn('font-bold tabular-nums', h.unresolved ? 'text-amber-600' : 'text-emerald-600')}>{h.unresolved}</span>
        </li>
      </ul>
      {h.unresolved > 0 && (
        <div className="mt-4 rounded-2xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">{h.unresolved} object{h.unresolved === 1 ? ' needs' : 's need'} review before publishing</p>
          <ul className="mt-1 space-y-0.5">
            {h.unnamedAreas > 0 && <li>· {h.unnamedAreas} area{h.unnamedAreas === 1 ? ' has' : 's have'} no name</li>}
            {unreachable > 0 && <li>· {unreachable} place{unreachable === 1 ? '' : 's'} can't be reached by the paths</li>}
            {h.offMap > 0 && <li>· {h.offMap} place{h.offMap === 1 ? ' isn\'t' : 's aren\'t'} on the map</li>}
          </ul>
        </div>
      )}
      <Button variant="outline" className="mt-4 w-full" onClick={() => editor && navigate(editor)} disabled={!editor}>Review Map</Button>
    </Panel>
  );
}

function VisitorPreview({ previewUrl }: { previewUrl: string }) {
  const [show, setShow] = useState(false);
  return (
    <Panel title="See What Visitors See" icon={Smartphone} bodyClassName="px-5 pb-5">
      <div className="mx-auto w-[260px] rounded-[2.2rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-xl">
        <div className="relative h-[480px] overflow-hidden rounded-[1.6rem] bg-background">
          {show
            ? <iframe title="Visitor experience" src={previewUrl} className="absolute left-0 top-0 h-[600px] w-[325px] origin-top-left scale-[0.8] border-0" />
            : (
              <button onClick={() => setShow(true)} className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-b from-primary/15 to-background px-6 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground"><Smartphone className="h-6 w-6" /></span>
                <span className="text-sm font-semibold">Load the live preview</span>
                <span className="text-xs text-muted-foreground">Map, search, categories, place details and navigation — exactly as visitors get them.</span>
              </button>
            )}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Button asChild><a href={previewUrl} target="_blank" rel="noreferrer">Open Visitor Experience</a></Button>
        <Button variant="outline" onClick={() => setShow(true)} disabled={show}>Preview on Mobile</Button>
      </div>
    </Panel>
  );
}

function EntryPoints({ entries }: { entries: Health['entryPoints'] }) {
  const { data } = useDashboard();
  const navigate = useNavigate();
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const shown = entries.slice(0, 4);
  useEffect(() => {
    let live = true;
    Promise.all(shown.map(async p => [p.key, await QRCode.toDataURL(qrLink({ buildingId: data.building.id, nodeId: p.nodeId!, floorId: p.floorId! }), { width: 160, margin: 1 })] as const))
      .then(r => live && setQrs(Object.fromEntries(r))).catch(() => {});
    return () => { live = false; };
  }, [shown.map(p => p.key).join(), data.building.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Panel title="Visitor Entry Points" icon={DoorOpen} action={<Button size="sm" variant="ghost" onClick={() => navigate('/dashboard/entry-points')}>Manage Entry Points <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>} bodyClassName="px-5 pb-5">
      {shown.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {shown.map(p => (
            <div key={p.key} className="rounded-2xl border p-3 text-center">
              {qrs[p.key] ? <img src={qrs[p.key]} alt={`QR code for ${p.name}`} className="mx-auto h-20 w-20" /> : <div className="mx-auto h-20 w-20 animate-pulse rounded bg-muted" />}
              <p className="mt-2 truncate text-sm font-semibold">{p.name}</p>
              <p className="flex items-center justify-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400"><StatusDot ok /> QR Active</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No entry points yet. Mark a gate, entrance or parking area so visitors can scan in and start from there.
          <div className="mt-3"><Button size="sm" onClick={() => navigate('/dashboard/entry-points')}><Plus className="mr-1 h-3.5 w-3.5" /> Add entry point</Button></div>
        </div>
      )}
    </Panel>
  );
}

function ContentOverview({ attractions }: { attractions: number }) {
  const { data, places } = useDashboard();
  const navigate = useNavigate();
  const n = (k: string) => data.content.filter(c => c.kind === k).length;
  const media = places.reduce((s, p) => s + (p.poi?.images?.length ?? (p.poi?.image_url ? 1 : 0)), 0) + data.content.filter(c => c.image_url).length;
  const items = [
    { icon: Landmark, label: 'Attractions', value: attractions, to: '/dashboard/attractions' },
    { icon: BookOpen, label: 'Stories', value: n('story') + n('educational'), to: '/dashboard/stories' },
    { icon: CalendarDays, label: 'Events', value: n('event'), to: '/dashboard/events' },
    { icon: Compass, label: 'Visitor Guides', value: n('guide'), to: '/dashboard/guides' },
    { icon: Megaphone, label: 'Announcements', value: n('announcement'), to: '/dashboard/announcements' },
    { icon: Images, label: 'Media', value: media, to: '/dashboard/media' },
  ];
  return (
    <Panel title="Content" icon={Newspaper} action={<Button size="sm" variant="ghost" onClick={() => navigate('/dashboard/stories')}>Manage Content <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>} bodyClassName="px-5 pb-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map(i => (
          <Link key={i.label} to={i.to} className="flex items-center gap-3 rounded-2xl border p-3 hover:border-primary/40">
            <i.icon className="h-5 w-5 text-primary" />
            <span><span className="block text-xl font-bold tabular-nums leading-none">{i.value}</span><span className="text-xs text-muted-foreground">{i.label}</span></span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function PlacesOverview() {
  const { data, places } = useDashboard();
  const navigate = useNavigate();
  const floorName = new Map(data.floors.map(f => [f.id, f.name] as const));
  const shown = [...places].sort((a, b) => Number(!!(b.poi?.images?.length || b.poi?.image_url)) - Number(!!(a.poi?.images?.length || a.poi?.image_url)) || Number(b.featured) - Number(a.featured)).slice(0, 5);
  return (
    <Panel title="Places" icon={MapPin} action={<Button size="sm" variant="ghost" onClick={() => navigate('/dashboard/places')}>View All Places <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>} bodyClassName="px-5 pb-5">
      {shown.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {shown.map(p => {
            const Icon = PLACE_TYPES[p.type].icon, img = p.poi?.images?.[0] || p.poi?.image_url;
            return (
              <button key={p.key} onClick={() => navigate(`/dashboard/places?edit=${encodeURIComponent(p.key)}`)} className="overflow-hidden rounded-2xl border text-left transition-shadow hover:shadow-md">
                {img ? <img src={img} alt="" className="h-28 w-full object-cover" /> : <div className="flex h-28 items-center justify-center bg-gradient-to-br from-primary/15 to-primary/5"><Icon className="h-8 w-8 text-primary/60" /></div>}
                <div className="p-3">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{p.typeLabel}{p.floorId && data.floors.length > 1 ? ` · ${floorName.get(p.floorId)}` : ''}</p>
                  <p className="mt-1 flex items-center gap-1 text-[11px]"><StatusDot ok={p.visible} /> {p.visible ? 'Visible' : 'Hidden'}</p>
                </div>
              </button>
            );
          })}
        </div>
      ) : <p className="py-6 text-center text-sm text-muted-foreground">Places appear here once your map has named places.</p>}
    </Panel>
  );
}

function MapEditorEntry({ editor }: { editor: string | null }) {
  const { data } = useDashboard();
  const navigate = useNavigate();
  const floor = data.floors[0];
  const theme = themeOf(data.building.theme);
  return (
    <Panel bodyClassName="grid gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex flex-col justify-center gap-3 p-6">
        <h2 className="text-xl font-bold">Manage Your Spatial Model</h2>
        <p className="text-sm text-muted-foreground">Edit your venue in 2D, explore it in 3D, and keep both views synchronized. Select something in one view and it's highlighted in the other.</p>
        <ul className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
          {['Walls & rooms', 'Doors & paths', 'Places & entrances', 'Measure & label', 'Walk & fly in 3D', 'Floors & zones'].map(x => <li key={x} className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-primary" /> {x}</li>)}
        </ul>
        <Button className="w-fit" onClick={() => editor && navigate(editor)} disabled={!editor}><PenTool className="mr-1.5 h-4 w-4" /> Open Map Editor</Button>
      </div>
      <div className="grid h-[300px] grid-cols-2 gap-px bg-border">
        {(['2d', '3d'] as const).map(m => (
          <div key={m} className="relative bg-muted/40">
            <span className="absolute left-3 top-3 z-10 rounded-full bg-card/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider shadow">{m === '2d' ? '2D Plan' : '3D World'}</span>
            <VenueViewer buildingId={data.building.id} floorId={floor?.id ?? null} level={floor?.level ?? 0} theme={theme} mode={m} className="absolute inset-0" emptyText="Upload a plan to see it here." />
          </div>
        ))}
      </div>
    </Panel>
  );
}
