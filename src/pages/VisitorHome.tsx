// The public home page: a published venue as a live 3D world you can turn
// and tap, then what to see, what's on and how to visit — all from the
// institution's published data. "Explore Map" grows the hero into the full
// visitor map (same venue, already loaded). ?v=<venue> picks the venue.

import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Map as MapIcon, Compass, CalendarDays, Home as HomeIcon, Box, Square, ArrowRight, Navigation, Telescope, X, MapPin, Clock,
  Accessibility, Bath, SquareParking, Info, Route, ChevronDown, Building2, Footprints, Loader2, Sparkles, LogIn, Globe2, ScanLine,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/auth/AuthShell';
import type { FloorLayer } from '@/components/venue/Venue3D';
import { themeOf, hexToHslVar } from '@/lib/venue/themes';
import { anchorOf } from '@/lib/venue/geoVenue';
import { indoorToGeo } from '@/lib/geo/GeoMath';
import { CONTENT_KINDS, openStatus, hoursSummary, type ContentKind } from '@/lib/venue/places';
import { ATTRACTION_TYPES } from '@/lib/venue/health';
import { VISITOR_CATEGORIES, recommend } from '@/lib/venue/discover';
import { slugify } from '@/lib/accounts';
import { usePublishedVenues, type PublishedVenue } from '@/components/visitor/usePublishedVenues';
import { useVisitorVenue, preloadVisitorVenue } from '@/components/visitor/useVisitorVenue';
import { contentWhen } from '@/components/visitor/ContentViews';
import PlanView from '@/components/visitor/PlanView';
import { CATEGORY_ICONS, PX_PER_METER, type Place } from '@/components/visitor/types';

const Venue3D = lazy(() => import('@/components/venue/Venue3D'));

export default function VisitorHome() {
  const venues = usePublishedVenues();
  const [params] = useSearchParams();
  const wanted = params.get('v');
  const featured = useMemo(() => {
    if (!venues?.length) return null;
    return venues.find(v => v.id === wanted || slugify(v.name) === wanted) ?? venues[0];
  }, [venues, wanted]);
  useEffect(() => { if (featured) preloadVisitorVenue(featured.id); }, [featured]);

  if (venues === null) return <div className="flex h-[100svh] items-center justify-center bg-[hsl(152_40%_96%)] text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>;
  if (!featured) return <NoVenues />;
  return <VenueHome key={featured.id} venue={featured} others={venues.filter(v => v.id !== featured.id)} />;
}

// ── A venue's home ───────────────────────────────────────────────────────────

function VenueHome({ venue, others }: { venue: PublishedVenue; others: PublishedVenue[] }) {
  const navigate = useNavigate();
  const v = useVisitorVenue(venue.id);
  const building = v.data?.building;
  const theme = themeOf(building?.theme ?? venue.theme);
  const themeVars = { '--primary': hexToHslVar(theme.accent), '--ring': hexToHslVar(theme.accent) } as CSSProperties;
  const [leaving, setLeaving] = useState(false);
  const mapUrl = (q = '') => `/venue/${venue.id}${q ? `?${q}` : ''}`;

  // "Explore Map": the hero grows to fill the screen, then the full map takes over (venue already in memory).
  const enterMap = (q = 'view=3d') => {
    setLeaving(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => navigate(mapUrl(q)), 520);
  };

  const places = v.places;
  const now = new Date();
  const featuredPlaces = useMemo(() => {
    const picks = places.filter(p => p.featured);
    return (picks.length >= 3 ? picks : recommend(places, { pxPerMeter: PX_PER_METER, limit: 8 })).slice(0, 8);
  }, [places]);
  const attractions = useMemo(() => places.filter(p => p.type ? ATTRACTION_TYPES.includes(p.type) : p.category === 'attractions' || p.category === 'gardens'), [places]);
  const content = v.data?.content ?? [];
  const events = content.filter(c => CONTENT_KINDS[c.kind as ContentKind]?.dated && (!c.ends_at || new Date(c.ends_at) >= now))
    .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''));
  const guides = content.filter(c => c.kind === 'guide' || c.kind === 'tour');
  const placeOfPoi = (poiId: string | null) => (poiId ? places.find(p => p.poiId === poiId) : undefined);

  return (
    <div className="min-h-[100svh] bg-background pb-16 text-foreground md:pb-0" style={themeVars}>
      <Header venue={venue} others={others} hidden={leaving} onMap={() => enterMap()} />

      <Hero venue={venue} data={v} theme={theme} leaving={leaving}
        onExploreMap={() => enterMap()} onAttractions={() => document.getElementById('attractions')?.scrollIntoView({ behavior: 'smooth' })}
        onOpenPlace={(id, how) => enterMap(how === 'navigate' ? `place=${id}&navigate=1&view=3d` : `place=${id}&view=3d`)} />

      <AnimatePresence>
        {!leaving && (
          <motion.main exit={{ opacity: 0, y: 30 }} transition={{ duration: 0.3 }} className="mx-auto max-w-6xl space-y-16 px-4 py-14 sm:px-6">
            {featuredPlaces.length > 0 && (
              <Section id="explore" kicker="Explore the venue" title={`What to see at ${venue.name}`}
                action={<Button variant="ghost" onClick={() => navigate(mapUrl('tab=explore'))}>All places <ArrowRight className="ml-1 h-4 w-4" /></Button>}>
                <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
                  {featuredPlaces.map(p => <PlaceTile key={p.id} p={p} onOpen={() => navigate(mapUrl(`place=${p.id}`))} />)}
                </div>
              </Section>
            )}

            {attractions.length > 0 && (
              <Section id="attractions" kicker="Discover attractions" title="Highlights not to miss"
                action={<Button variant="ghost" onClick={() => navigate(mapUrl('category=attractions'))}>View all attractions <ArrowRight className="ml-1 h-4 w-4" /></Button>}>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {attractions.slice(0, 6).map((p, i) => <AttractionTile key={p.id} p={p} big={i === 0} onOpen={() => navigate(mapUrl(`place=${p.id}`))} />)}
                </div>
              </Section>
            )}

            {events.length > 0 && (
              <Section id="events" kicker="What's happening" title="Events & announcements"
                action={<Button variant="ghost" onClick={() => navigate(mapUrl('events=1'))}>All events <ArrowRight className="ml-1 h-4 w-4" /></Button>}>
                <div className="grid gap-4 md:grid-cols-2">
                  {events.slice(0, 4).map(e => {
                    const at = placeOfPoi(e.poi_id);
                    return (
                      <article key={e.id} className="flex overflow-hidden rounded-3xl border bg-card shadow-sm">
                        {e.image_url ? <img src={e.image_url} alt="" loading="lazy" className="w-32 shrink-0 object-cover sm:w-40" />
                          : <div className="flex w-32 shrink-0 flex-col items-center justify-center bg-primary/10 text-primary sm:w-40"><CalendarDays className="h-7 w-7" />
                            {e.starts_at && <span className="mt-1 text-sm font-bold">{new Date(e.starts_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}</div>}
                        <div className="flex min-w-0 flex-1 flex-col p-4">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{CONTENT_KINDS[e.kind as ContentKind]?.label}</p>
                          <h3 className="mt-0.5 font-semibold leading-snug">{e.title}</h3>
                          {(e.starts_at || e.ends_at) && <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {contentWhen(e)}</p>}
                          {at && <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {at.name}</p>}
                          {e.summary && <p className="mt-1 line-clamp-2 text-sm">{e.summary}</p>}
                          <div className="mt-auto pt-3">
                            <Button size="sm" variant="outline" className="rounded-full" onClick={() => navigate(at ? mapUrl(`place=${at.id}`) : mapUrl('events=1'))}>
                              <MapPin className="mr-1 h-3.5 w-3.5" /> {at ? 'View location' : 'Details'}
                            </Button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </Section>
            )}

            <VisitInfo venueId={venue.id} places={places} anchorBuilding={building ?? null} guides={guides} mapUrl={mapUrl} />

            {others.length > 0 && (
              <Section id="venues" kicker="More on Yet New" title="Other places to explore">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {others.slice(0, 6).map(o => (
                    <Link key={o.id} to={`/visit?v=${o.id}`} onClick={() => window.scrollTo({ top: 0 })} className="group overflow-hidden rounded-3xl border bg-card shadow-sm">
                      <div className="relative h-36">
                        {o.cover ? <img src={o.cover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                          : <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${themeOf(o.theme).primary}, ${themeOf(o.theme).path})` }} />}
                      </div>
                      <div className="p-4">
                        <p className="font-semibold">{o.name}</p>
                        <p className="line-clamp-1 text-sm text-muted-foreground">{o.tagline ?? o.institution ?? 'Digital venue'}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </Section>
            )}

            <section className="overflow-hidden rounded-[2rem] text-white" style={{ background: `linear-gradient(120deg, ${theme.primary}, ${theme.route})` }}>
              <div className="grid items-center gap-6 p-8 md:grid-cols-[1fr_auto] md:p-12">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-white/70">Live navigation</p>
                  <h2 className="mt-1 text-2xl font-bold md:text-3xl">From the street to the room you're looking for</h2>
                  <p className="mt-2 max-w-xl text-white/85">Open the city map for GPS directions to the venue, then step inside — the map switches to indoor navigation with step tracking and QR check-points.</p>
                </div>
                <Button size="lg" variant="secondary" className="rounded-full" asChild><Link to="/explore"><Globe2 className="mr-2 h-5 w-5" /> Open the city map</Link></Button>
              </div>
            </section>
          </motion.main>
        )}
      </AnimatePresence>

      {!leaving && <Footer />}
      <BottomNav onMap={() => enterMap()} onExplore={() => navigate(mapUrl('tab=explore'))} onEvents={() => (events.length ? document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' }) : navigate(mapUrl('events=1')))} />
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header({ venue, others, hidden, onMap }: { venue: PublishedVenue; others: PublishedVenue[]; hidden: boolean; onMap: () => void }) {
  const [open, setOpen] = useState(false);
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > window.innerHeight * 0.6);
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  return (
    <header className={cn('fixed inset-x-0 top-0 z-40 transition-all duration-300', hidden && 'pointer-events-none -translate-y-full opacity-0',
      solid ? 'border-b bg-background/85 backdrop-blur-xl' : 'bg-gradient-to-b from-black/35 to-transparent')}>
      <div className={cn('mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6', !solid && 'text-white')}>
        <Link to="/" aria-label="Yet New home"><Logo className="text-lg" /></Link>
        <div className="relative ml-1">
          <button onClick={() => setOpen(o => !o)} className={cn('flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium', solid ? 'hover:bg-muted' : 'bg-white/15 backdrop-blur hover:bg-white/25')}
            aria-expanded={open} disabled={!others.length}>
            {venue.name} {others.length > 0 && <ChevronDown className="h-4 w-4" />}
          </button>
          {open && (
            <div className="absolute left-0 top-11 w-64 overflow-hidden rounded-2xl border bg-card p-1 text-foreground shadow-xl">
              {[venue, ...others].map(o => (
                <Link key={o.id} to={`/visit?v=${o.id}`} onClick={() => setOpen(false)} className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted', o.id === venue.id && 'font-semibold text-primary')}>
                  <Building2 className="h-4 w-4 shrink-0" /> <span className="truncate">{o.name}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <nav className="ml-auto hidden items-center gap-1 text-sm font-medium md:flex">
          {[['explore', 'Explore'], ['attractions', 'Attractions'], ['events', 'Events'], ['visit', 'Visit']].map(([id, label]) => (
            <button key={id} onClick={() => go(id)} className={cn('rounded-full px-3 py-1.5', solid ? 'hover:bg-muted' : 'hover:bg-white/15')}>{label}</button>
          ))}
          <Button size="sm" className="ml-2 rounded-full" onClick={onMap}><MapIcon className="mr-1.5 h-4 w-4" /> Explore Map</Button>
          <Link to="/login" className={cn('ml-1 rounded-full px-3 py-1.5 text-xs', solid ? 'text-muted-foreground hover:bg-muted' : 'text-white/80 hover:bg-white/15')}>For institutions</Link>
        </nav>
      </div>
    </header>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────

function Hero({ venue, data, theme, leaving, onExploreMap, onAttractions, onOpenPlace }: {
  venue: PublishedVenue; data: ReturnType<typeof useVisitorVenue>; theme: ReturnType<typeof themeOf>; leaving: boolean;
  onExploreMap: () => void; onAttractions: () => void; onOpenPlace: (id: string, how: 'explore' | 'navigate') => void;
}) {
  const d = data.data;
  const [view, setView] = useState<'3d' | '2d'>(venue.heroView === '2d' ? '2d' : '3d');
  const [picked, setPicked] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const ground = d?.floors[0] ?? null;
  const on = <T extends { floorId: string }>(xs: T[]) => (ground ? xs.filter(x => x.floorId === ground.id) : []);
  const floor = useMemo(() => {
    if (!d || !ground) return null;
    const nodes = on(d.nodes), ids = new Set(nodes.map(n => n.id));
    return { walls: on(d.walls), rooms: on(d.rooms), features: on(d.features), nodes, edges: d.edges.filter(e => ids.has(e.fromNodeId) && ids.has(e.toNodeId)) };
  }, [d, ground]); // eslint-disable-line react-hooks/exhaustive-deps
  const otherFloors = useMemo<FloorLayer[]>(() => (d ? d.floors.slice(1).map(f => ({
    id: f.id, name: f.name, level: f.level, walls: d.walls.filter(w => w.floorId === f.id), rooms: d.rooms.filter(r => r.floorId === f.id), features: d.features.filter(x => x.floorId === f.id),
  })) : []), [d]);
  const has3D = !!floor && floor.walls.length + floor.rooms.length > 0;
  // Only places visitors can open: hide hallway nodes and unnamed spots from the hero.
  const visibleNodes = useMemo(() => floor ? floor.nodes.filter(n => data.placeById.has(n.id)) : [], [floor, data.placeById]);
  const place = picked ? data.placeById.get(picked) ?? null : null;
  const counts = { places: data.places.length, attractions: data.places.filter(p => ['attractions', 'gardens'].includes(p.category)).length };
  const cover = venue.cover ?? data.places.find(p => p.images.length)?.images[0] ?? null;

  return (
    <motion.section className="relative h-[88svh] min-h-[560px] overflow-hidden md:h-[100svh]"
      animate={leaving ? { height: '100svh' } : {}} transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      style={{ background: `linear-gradient(160deg, ${theme.sky}, ${theme.ground})` }}>
      {/* the venue itself — beside the words on desktop, above them on phones, so labels never collide with the headline */}
      <div className={cn('absolute transition-all duration-500', leaving ? 'inset-0' : has3D ? 'inset-x-0 top-0 bottom-[44%] md:bottom-0 md:left-[38%]' : 'inset-0')}>
        {cover && !has3D && <img src={cover} alt="" className="h-full w-full object-cover" />}
        {has3D && floor && (view === '3d' ? (
          <Suspense fallback={cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Building the 3D world…</div>}>
            <Venue3D walls={floor.walls} rooms={floor.rooms} nodes={visibleNodes} edges={floor.edges} features={floor.features}
              level={ground?.level ?? 0} otherFloors={otherFloors} selectedNodeId={picked} pxPerMeter={PX_PER_METER} focusNonce={focus}
              onSelectNode={id => { setPicked(id); if (id) setFocus(n => n + 1); }} showPaths={false} theme={theme} cinematic chrome="minimal" className="h-full" />
          </Suspense>
        ) : (
          <div className="h-full pt-16">
            <PlanView floorId={ground!.id} data={{ walls: floor.walls, rooms: floor.rooms, features: floor.features, nodes: floor.nodes }}
              selected={picked} start={null} route={null} onSelect={id => setPicked(id)} places={data.places} here={null} follow={false}
              focus={place ? { x: place.x, y: place.y, nonce: focus } : null} />
          </div>
        ))}
        {!has3D && !cover && data.state === 'loading' && <div className="flex h-full items-center justify-center text-white/80"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading the venue…</div>}
      </div>

      {/* words over the world (they don't block turning it) */}
      <AnimatePresence>
        {!leaving && (
          <motion.div exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/60 via-black/10 to-transparent md:items-center md:bg-gradient-to-r md:from-black/55 md:via-black/15">
            <div className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6 md:pb-0">
              <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.7 }} className="max-w-xl text-white">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-white/75"><Sparkles className="h-3.5 w-3.5" /> {venue.institution ?? 'Digital venue'}</p>
                <h1 className="mt-2 text-4xl font-black leading-[1.05] tracking-tight drop-shadow sm:text-5xl md:text-6xl">Explore {venue.name}</h1>
                <p className="mt-3 text-base text-white/90 drop-shadow sm:text-lg">
                  {venue.tagline ?? venue.description ?? 'Discover attractions, gardens, museums, restaurants, events and places around you.'}
                </p>
                <div className="pointer-events-auto mt-6 flex flex-wrap gap-3">
                  <Button size="lg" className="rounded-full px-6 text-base shadow-xl" onClick={onExploreMap}><MapIcon className="mr-2 h-5 w-5" /> Explore Map</Button>
                  {counts.attractions > 0 && <Button size="lg" variant="secondary" className="rounded-full px-6 text-base" onClick={onAttractions}><Telescope className="mr-2 h-5 w-5" /> Discover Attractions</Button>}
                </div>
                <p className="mt-5 text-sm text-white/75">{counts.places} places · {counts.attractions} attractions{has3D ? ' · drag to look around, tap a place' : ''}</p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2D | 3D */}
      {has3D && !leaving && (
        <div className="absolute right-4 top-20 flex rounded-full border border-white/30 bg-black/30 p-0.5 text-xs font-semibold text-white backdrop-blur md:bottom-8 md:right-8 md:top-auto">
          {([['3d', Box, '3D'], ['2d', Square, '2D']] as const).map(([id, Icon, label]) => (
            <button key={id} onClick={() => setView(id)} aria-pressed={view === id} className={cn('flex items-center gap-1 rounded-full px-3 py-1.5', view === id ? 'bg-white text-black' : 'hover:bg-white/15')}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      )}
      {!leaving && (
        <button onClick={onAttractions} className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 animate-bounce text-white/80 md:block" aria-label="Scroll down"><ChevronDown className="h-6 w-6" /></button>
      )}

      {/* a tapped place */}
      <AnimatePresence>
        {place && !leaving && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="absolute inset-x-3 bottom-24 z-10 mx-auto max-w-sm overflow-hidden rounded-3xl border bg-card text-foreground shadow-2xl md:inset-x-auto md:bottom-auto md:right-8 md:top-24 md:w-80">
            {place.images[0] && <img src={place.images[0]} alt="" className="h-36 w-full object-cover" />}
            <button onClick={() => setPicked(null)} className="absolute right-2 top-2 rounded-full bg-black/45 p-1 text-white" aria-label="Close"><X className="h-4 w-4" /></button>
            <div className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{place.typeLabel ?? VISITOR_CATEGORIES[place.category].label}</p>
              <h3 className="text-lg font-semibold">{place.name}</h3>
              {openStatus(place.hours) && <p className="text-xs text-muted-foreground">{openStatus(place.hours)!.text}</p>}
              {place.description && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{place.description}</p>}
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="flex-1 rounded-full" onClick={() => onOpenPlace(place.id, 'explore')}><Telescope className="mr-1 h-4 w-4" /> Explore</Button>
                {place.navigable && <Button size="sm" variant="outline" className="flex-1 rounded-full" onClick={() => onOpenPlace(place.id, 'navigate')}><Navigation className="mr-1 h-4 w-4" /> Navigate</Button>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

function Section({ id, kicker, title, action, children }: { id: string; kicker: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <motion.section id={id} className="scroll-mt-20" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.5 }}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">{kicker}</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

function PlaceTile({ p, onOpen }: { p: Place; onOpen: () => void }) {
  const Icon = CATEGORY_ICONS[p.category];
  return (
    <button onClick={onOpen} className="group w-64 shrink-0 snap-start overflow-hidden rounded-3xl border bg-card text-left shadow-sm transition-shadow hover:shadow-lg sm:w-auto">
      <div className="relative h-40 overflow-hidden">
        {p.images[0] ? <img src={p.images[0]} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          : <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/25 to-primary/5"><Icon className="h-10 w-10 text-primary/60" /></div>}
      </div>
      <div className="p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{p.typeLabel ?? VISITOR_CATEGORIES[p.category].label}</p>
        <p className="font-semibold">{p.name}</p>
        <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">{p.description ?? (openStatus(p.hours)?.text ?? `On ${p.floorName || 'the map'}`)}</p>
        <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">Explore <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></span>
      </div>
    </button>
  );
}

function AttractionTile({ p, big, onOpen }: { p: Place; big: boolean; onOpen: () => void }) {
  const Icon = CATEGORY_ICONS[p.category];
  return (
    <button onClick={onOpen} className={cn('group relative overflow-hidden rounded-3xl text-left shadow-sm', big ? 'h-72 sm:col-span-2 lg:col-span-1 lg:row-span-2 lg:h-full' : 'h-56')}>
      {p.images[0] ? <img src={p.images[0]} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
        : <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary to-primary/50"><Icon className="h-16 w-16 text-white/30" /></div>}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/75">{p.typeLabel ?? VISITOR_CATEGORIES[p.category].label}</p>
        <p className="text-xl font-bold">{p.name}</p>
        {p.description && <p className="line-clamp-2 text-sm text-white/85">{p.description}</p>}
      </div>
    </button>
  );
}

function VisitInfo({ venueId, places, anchorBuilding, guides, mapUrl }: {
  venueId: string; places: Place[]; anchorBuilding: Parameters<typeof anchorOf>[0] | null; guides: { id: string; title: string; kind: string; summary: string | null }[];
  mapUrl: (q?: string) => string;
}) {
  const navigate = useNavigate();
  const entrance = places.find(p => p.category === 'entrances' && (p.access.stepFree || p.access.wheelchair)) ?? places.find(p => p.category === 'entrances');
  const hoursPlace = places.find(p => p.category === 'entrances' && p.hours) ?? places.find(p => p.type === 'info_desk' && p.hours);
  const anchor = anchorBuilding ? anchorOf(anchorBuilding) : null;
  const entranceGeo = anchor && entrance ? indoorToGeo(anchor, entrance.x, entrance.y) : null;
  const count = (c: string) => places.filter(p => p.category === c).length;
  const accessible = places.filter(p => p.access.wheelchair || p.access.stepFree).length;
  const facilities = [
    { icon: Bath, label: 'Restrooms', n: count('restrooms'), cat: 'restrooms' },
    { icon: SquareParking, label: 'Parking', n: count('parking'), cat: 'parking' },
    { icon: Info, label: 'Information', n: count('facilities'), cat: 'facilities' },
  ].filter(f => f.n > 0);

  return (
    <Section id="visit" kicker="Plan your visit" title="Good to know">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <InfoCard icon={Footprints} title="Getting here">
          {entrance ? <p>Enter at <b>{entrance.name}</b>. Scan the QR code at the gate and the map starts where you stand.</p> : <p>Scan a QR code at the gate and the map starts where you stand.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {entranceGeo && <Button size="sm" variant="outline" className="rounded-full" onClick={() => navigate(mapUrl('directions=1'))}><Navigation className="mr-1 h-3.5 w-3.5" /> Walking directions</Button>}
            {entrance && <Button size="sm" variant="outline" className="rounded-full" onClick={() => navigate(mapUrl(`entry=${entrance.id}`))}><ScanLine className="mr-1 h-3.5 w-3.5" /> Start at the gate</Button>}
          </div>
        </InfoCard>
        <InfoCard icon={Clock} title="Opening hours">
          {hoursPlace?.hours ? <><p className="font-medium text-foreground">{openStatus(hoursPlace.hours)?.text}</p><p>{hoursSummary(hoursPlace.hours)}</p>{hoursPlace.hours.note && <p>{hoursPlace.hours.note}</p>}</>
            : <p>Each place shows its own hours on the map.</p>}
        </InfoCard>
        <InfoCard icon={Accessibility} title="Accessibility">
          <p>{accessible ? `${accessible} place${accessible === 1 ? ' is' : 's are'} marked wheelchair-friendly or step-free.` : 'Ask staff about step-free access.'}</p>
          <p>Choose <b>Step-free route</b> in directions to avoid stairs and use lifts and ramps.</p>
        </InfoCard>
        <InfoCard icon={Info} title="Facilities">
          {facilities.length ? (
            <div className="flex flex-wrap gap-2">
              {facilities.map(f => (
                <button key={f.label} onClick={() => navigate(mapUrl(`category=${f.cat}`))} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm hover:bg-muted">
                  <f.icon className="h-3.5 w-3.5" /> {f.label} <span className="text-muted-foreground">{f.n}</span>
                </button>
              ))}
            </div>
          ) : <p>Find restrooms, parking and information on the map.</p>}
        </InfoCard>
      </div>
      {guides.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {guides.slice(0, 4).map(g => (
            <button key={g.id} onClick={() => navigate(mapUrl('tab=explore'))} className="flex items-center gap-3 rounded-2xl border bg-card p-4 text-left hover:bg-muted">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{g.kind === 'tour' ? <Route className="h-5 w-5" /> : <Compass className="h-5 w-5" />}</span>
              <span className="min-w-0"><span className="block font-semibold">{g.title}</span><span className="block truncate text-sm text-muted-foreground">{g.summary ?? CONTENT_KINDS[g.kind as ContentKind]?.label}</span></span>
            </button>
          ))}
        </div>
      )}
      <span className="sr-only">{venueId}</span>
    </Section>
  );
}

function InfoCard({ icon: Icon, title, children }: { icon: typeof Info; title: string; children: ReactNode }) {
  return (
    <div className="rounded-3xl border bg-card p-5">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <div className="mt-1 space-y-1 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Logo className="text-lg" />
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">Bring the map you already have. Yet New turns it into a digital world your visitors can explore.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-full" asChild><Link to="/signup">Create your digital venue</Link></Button>
          <Button variant="ghost" className="rounded-full" asChild><Link to="/login"><LogIn className="mr-1.5 h-4 w-4" /> Institution sign in</Link></Button>
          <Button variant="ghost" className="rounded-full" asChild><Link to="/explore"><Globe2 className="mr-1.5 h-4 w-4" /> City map</Link></Button>
        </div>
      </div>
    </footer>
  );
}

function BottomNav({ onMap, onExplore, onEvents }: { onMap: () => void; onExplore: () => void; onEvents: () => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Visitor">
      {([['Home', HomeIcon, () => window.scrollTo({ top: 0, behavior: 'smooth' }), true], ['Map', MapIcon, onMap, false], ['Explore', Compass, onExplore, false], ['Events', CalendarDays, onEvents, false]] as const).map(([label, Icon, go, active]) => (
        <button key={label} onClick={go} className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active ? 'text-primary' : 'text-muted-foreground')}>
          <Icon className="h-5 w-5" /> {label}
        </button>
      ))}
    </nav>
  );
}

function NoVenues() {
  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center gap-6 px-6 text-center" style={{ background: 'linear-gradient(160deg, hsl(152 40% 95%), hsl(152 30% 88%))' }}>
      <Logo className="text-2xl" />
      <h1 className="max-w-xl text-4xl font-black tracking-tight">Bring the map you already have.</h1>
      <p className="max-w-md text-muted-foreground">Yet New turns it into a digital world your visitors can explore. No venues are published yet.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button size="lg" className="rounded-full" asChild><Link to="/signup">Create your digital venue</Link></Button>
        <Button size="lg" variant="outline" className="rounded-full" asChild><Link to="/explore"><Globe2 className="mr-2 h-5 w-5" /> Open the city map</Link></Button>
      </div>
    </div>
  );
}
