// Dashboard home, kept calm on purpose: what to do next, your venue, a few
// shortcuts, and what changed lately. Everything else is one click away in
// the sidebar.

import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Eye, Square, Box, Maximize2, Layers, MapPin, Newspaper, Globe, Activity, ArrowRight, Upload,
  Map as MapIcon, X, CalendarDays, QrCode, Route, Globe2,
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
import { Panel, StatusDot } from './ui';

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const ws = useWorkspace();
  const { data, places, editorUrl, previewUrl, openPublish } = useDashboard();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const b = data.building;
  const unreachable = useMemo(() => unreachablePlaces(data).length, [data]);
  const h = useMemo(() => venueHealth({
    counts: data.counts, rooms: data.rooms, edges: data.edges, places, unreachable,
    content: data.content, published: b.is_published, publishedAt: b.published_at ?? null,
  }), [data, places, unreachable, b]);
  const editor = editorUrl();
  const welcome = params.get('welcome') === '1';
  const lastChange = data.activity[0]?.created_at ?? b.updated_at;
  const first = ws.account.displayName.split(' ')[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{welcome ? `Welcome to Yet New, ${first}!` : `${greeting()}, ${first}`}</h1>
        <p className="mt-1 text-muted-foreground">Here's how {b.name} is doing.</p>
      </div>

      <NextStep h={h} editor={editor} onPublish={openPublish}
        onDismiss={welcome ? () => { params.delete('welcome'); setParams(params, { replace: true }); } : undefined} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <HeroVenue h={h} lastChange={lastChange} />
        <div className="space-y-4">
          <PublishCard onPublish={openPublish} />
          <div className="grid grid-cols-3 gap-3 lg:grid-cols-1" data-tour="quick-actions">
            <Shortcut icon={MapPin} label="Add a place" onClick={() => navigate('/dashboard/places?new=1')} />
            <Shortcut icon={CalendarDays} label="Add an event" onClick={() => navigate('/dashboard/events?new=1')} />
            <Shortcut icon={QrCode} label="Get QR codes" onClick={() => navigate('/dashboard/qr')} />
          </div>
        </div>
      </div>

      <RecentActivity />
    </div>
  );
}

type Health = ReturnType<typeof venueHealth<PlaceEntry<PoiRow>>>;

/** One thing to do next — not a checklist of six. */
function NextStep({ h, editor, onPublish, onDismiss }: { h: Health; editor: string | null; onPublish: () => void; onDismiss?: () => void }) {
  const navigate = useNavigate();
  const done = h.steps.filter(s => s.done).length;
  const next = h.steps.find(s => !s.done);
  if (!next) return null;
  const go = () => {
    if (next.id === 'map' || next.id === '3d') { if (editor) navigate(`${editor}${next.id === 'map' ? '?import=1' : ''}`); }
    else if (next.id === 'entrance') navigate('/dashboard/entry-points');
    else if (next.id === 'places') navigate('/dashboard/places');
    else if (next.id === 'content') navigate('/dashboard/stories?new=1');
    else onPublish();
  };
  return (
    <section data-tour="setup" className="relative flex flex-wrap items-center gap-4 rounded-3xl border bg-gradient-to-br from-primary/10 via-card to-card p-5">
      {onDismiss && <button onClick={onDismiss} className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Dismiss"><X className="h-4 w-4" /></button>}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Next step · {done} of {h.steps.length} done</p>
        <h2 className="mt-1 text-lg font-bold">{next.label}</h2>
        <p className="text-sm text-muted-foreground">{next.hint}</p>
        <div className="mt-3 h-1.5 max-w-sm overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${h.setupPct}%` }} /></div>
      </div>
      <Button size="lg" onClick={go} className="rounded-full">
        {next.id === 'map' ? <><Upload className="mr-1.5 h-4 w-4" /> Upload your map</> : next.id === 'publish' ? <><Globe className="mr-1.5 h-4 w-4" /> Publish</> : <>Let's do it <ArrowRight className="ml-1.5 h-4 w-4" /></>}
      </Button>
    </section>
  );
}

function Shortcut({ icon: Icon, label, onClick, disabled }: { icon: typeof MapPin; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-3 rounded-2xl border bg-card p-3 text-left text-sm font-semibold transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-40">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-[18px] w-[18px]" /></span>
      {label}
    </button>
  );
}

function PublishCard({ onPublish }: { onPublish: () => void }) {
  const { data, previewUrl } = useDashboard();
  const b = data.building;
  const pending = data.unpublished;
  const live = b.is_published && !!b.published_at;
  return (
    <Panel bodyClassName="p-5">
      <p className="flex items-center gap-2 text-lg font-bold"><StatusDot ok={b.is_published} /> {b.is_published ? 'Live for visitors' : 'Not live yet'}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {live && pending > 0 ? <><b className="text-foreground">{pending} change{pending === 1 ? '' : 's'}</b> waiting to go live.</> : b.is_published ? 'Visitors see the latest version.' : 'Only your team can see it.'}
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" asChild><a href={previewUrl} target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-4 w-4" /> Preview</a></Button>
        <Button className="flex-1" onClick={onPublish} variant={b.is_published && !pending ? 'outline' : 'default'}>Publish</Button>
      </div>
    </Panel>
  );
}

function HeroVenue({ h, lastChange }: { h: Health; lastChange: string }) {
  const { data, area, editorUrl } = useDashboard();
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
          <h2 className="text-lg font-bold">Your venue</h2>
          <p className="text-xs text-muted-foreground">What visitors see — drag to look around</p>
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
      <div ref={box} className="relative mx-3 flex-1 overflow-hidden rounded-2xl border bg-muted/40 fullscreen:m-0 fullscreen:rounded-none" style={{ minHeight: 380 }}>
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
      </div>
    </Panel>
  );
}

function RecentActivity() {
  const ws = useWorkspace();
  const { data } = useDashboard();
  const groups = useMemo(() => {
    const out: { day: string; items: typeof data.activity }[] = [];
    for (const a of data.activity.slice(0, 6)) {
      const d = dayLabel(a.created_at);
      if (out[out.length - 1]?.day === d) out[out.length - 1].items.push(a); else out.push({ day: d, items: [a] });
    }
    return out;
  }, [data]);
  const icon = (t: string) => ({ map: MapIcon, place: MapPin, floor: Layers, venue: Globe, event: CalendarDays, tour: Route } as Record<string, typeof MapPin>)[t] ?? Newspaper;
  return (
    <Panel title="Recent changes" icon={Activity} bodyClassName="px-5 pb-5">
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

