import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import AdminHeader from '@/components/admin/AdminHeader';
import AdminPillButton from '@/components/admin/AdminPillButton';
import AdminDialogShell from '@/components/admin/AdminDialogShell';
import AdminField, { ADMIN_INPUT_CLS, ADMIN_TEXTAREA_CLS } from '@/components/admin/AdminField';
import { AdminButtonPrimary, AdminButtonGhost } from '@/components/admin/AdminButtons';
import { admin } from '@/components/admin/adminTheme';
import {
  Plus, Trash2, Edit, Sparkles, Tag, Loader2, MapPin, Star, TrendingUp,
  Image as ImageIcon, Music, Upload, X as XIcon, Megaphone, Percent, Palette,
} from 'lucide-react';
import { toast } from 'sonner';
import { POI_CATEGORY_META, POI_SUBCATEGORY_ICON, POICategory } from '@/data/poi';
import { landmarkFor, LANDMARK_LABELS } from '@/lib/landmarks/landmarks';
import type { LandmarkItem } from '@/components/landmarks/LandmarkMap';
import { cn } from '@/lib/utils';
import { Search, Megaphone as MegaphoneIcon, Layers3 } from 'lucide-react';

/** A category colour ('hsl(35 90% 55%)') as hex, for gradients and the 3D map. */
function toneHex(tone: string): string {
  const m = tone.match(/hsl\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%/);
  if (!m) return tone;
  const h = +m[1], s = +m[2] / 100, l = +m[3] / 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const c = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return `#${c(0)}${c(8)}${c(4)}`;
}

// three.js only loads with the map.
const LandmarkMap = lazy(() => import('@/components/landmarks/LandmarkMap'));

interface SupaBuilding { id: string; name: string; }
interface SupaFloor { id: string; building_id: string; name: string; level: number; }
interface SupaNode { id: string; building_id: string; floor_id: string; name: string; type: string; x: number; y: number; }
interface SupaPOI {
  id: string; node_id: string; building_id: string; name: string; description: string | null;
  category: string; subcategory: string | null; image_url: string | null; audio_url: string | null;
  is_featured: boolean; trigger_radius: number; is_search_popular: boolean;
}
interface SupaPromotion {
  id: string; poi_id: string; title: string; description: string | null; discount_text: string | null;
  badge_color: string | null; starts_at: string | null; ends_at: string | null; is_active: boolean;
}

const CATEGORIES: POICategory[] = ['retail', 'attraction', 'service', 'education'];
const SUBS_BY_CATEGORY: Record<POICategory, string[]> = {
  retail: ['shop', 'restaurant', 'cafe', 'bakery', 'boutique'],
  attraction: ['animal', 'exhibit', 'landmark', 'garden', 'fountain'],
  service: ['atm', 'info', 'restroom', 'charging', 'security'],
  education: ['classroom', 'lab', 'library', 'auditorium'],
};

const emptyPOIForm = {
  node_id: '', name: '', description: '', category: 'attraction' as POICategory,
  subcategory: '', image_url: '', audio_url: '', is_featured: false, trigger_radius: 5,
  is_search_popular: false,
};
const emptyPromoForm = {
  poi_id: '', title: '', description: '', discount_text: '',
  badge_color: 'primary', is_active: true,
};

const BUCKET = 'poi-media';

interface AdminPOIsProps {
  onNavigateToBuildings?: () => void;
  /** When true, renders without its own page header (used inside AdminDashboard tabs). */
  embedded?: boolean;
}

const AdminPOIs: React.FC<AdminPOIsProps> = ({ onNavigateToBuildings, embedded = false }) => {
  const [buildings, setBuildings] = useState<SupaBuilding[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [floors, setFloors] = useState<SupaFloor[]>([]);
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const [nodes, setNodes] = useState<SupaNode[]>([]);
  const [pois, setPois] = useState<SupaPOI[]>([]);
  const [promos, setPromos] = useState<SupaPromotion[]>([]);
  const [walls, setWalls] = useState<{ floor_id: string; x1: number; y1: number; x2: number; y2: number }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const [poiDialog, setPoiDialog] = useState<{ open: boolean; editing: SupaPOI | null }>({ open: false, editing: null });
  const [poiForm, setPoiForm] = useState(emptyPOIForm);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);

  const [promoDialog, setPromoDialog] = useState<{ open: boolean; editing: SupaPromotion | null; poiId: string }>({
    open: false, editing: null, poiId: '',
  });
  const [promoForm, setPromoForm] = useState(emptyPromoForm);

  // Initial: load buildings
  useEffect(() => {
    supabase.from('buildings').select('id, name').order('name').then(({ data, error }) => {
      if (error) { toast.error('Failed to load buildings'); return; }
      setBuildings(data || []);
      if ((data || []).length && !selectedBuildingId) setSelectedBuildingId(data![0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = useCallback(async (bid: string) => {
    if (!bid) return;
    setLoading(true);
    const [floorsRes, nodesRes, poisRes, wallsRes] = await Promise.all([
      supabase.from('floors').select('*').eq('building_id', bid).order('level'),
      supabase.from('nodes').select('*').eq('building_id', bid).order('name'),
      supabase.from('pois').select('*').eq('building_id', bid).order('name'),
      supabase.from('walls').select('floor_id,x1,y1,x2,y2').eq('building_id', bid),
    ]);
    setWalls((wallsRes.data ?? []) as { floor_id: string; x1: number; y1: number; x2: number; y2: number }[]);
    if (floorsRes.error || nodesRes.error || poisRes.error) {
      toast.error('Failed to load data');
      setLoading(false);
      return;
    }
    setFloors(floorsRes.data || []);
    setNodes(nodesRes.data || []);
    setPois(poisRes.data || []);
    const poiIds = (poisRes.data || []).map(p => p.id);
    if (poiIds.length) {
      const { data: promoData, error: promoErr } = await supabase
        .from('promotions').select('*').in('poi_id', poiIds);
      if (!promoErr) setPromos(promoData || []);
    } else {
      setPromos([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (selectedBuildingId) fetchAll(selectedBuildingId); }, [selectedBuildingId, fetchAll]);

  const nodeById = useMemo(() => {
    const m = new Map<string, SupaNode>();
    nodes.forEach(n => m.set(n.id, n));
    return m;
  }, [nodes]);

  const floorById = useMemo(() => {
    const m = new Map<string, SupaFloor>();
    floors.forEach(f => m.set(f.id, f));
    return m;
  }, [floors]);

  const promosByPoi = useMemo(() => {
    const m = new Map<string, SupaPromotion[]>();
    promos.forEach(p => {
      const arr = m.get(p.poi_id) ?? [];
      arr.push(p);
      m.set(p.poi_id, arr);
    });
    return m;
  }, [promos]);

  const filteredPois = useMemo(() => {
    if (floorFilter === 'all') return pois;
    return pois.filter(p => {
      const node = nodeById.get(p.node_id);
      return node?.floor_id === floorFilter;
    });
  }, [pois, floorFilter, nodeById]);

  // Nodes available to attach a POI to (excluding ones already used unless editing)
  const availableNodes = useMemo(() => {
    const used = new Set(pois.map(p => p.node_id));
    return nodes.filter(n => !used.has(n.id) || (poiDialog.editing && poiDialog.editing.node_id === n.id));
  }, [nodes, pois, poiDialog.editing]);

  // ── POI handlers ────────────────────────────────────────────────
  const openCreatePOI = () => {
    setPoiForm({ ...emptyPOIForm });
    setPoiDialog({ open: true, editing: null });
  };
  const openEditPOI = (p: SupaPOI) => {
    setPoiForm({
      node_id: p.node_id,
      name: p.name,
      description: p.description ?? '',
      category: (p.category as POICategory) || 'attraction',
      subcategory: p.subcategory ?? '',
      image_url: p.image_url ?? '',
      audio_url: p.audio_url ?? '',
      is_featured: p.is_featured,
      trigger_radius: p.trigger_radius,
      is_search_popular: p.is_search_popular,
    });
    setPoiDialog({ open: true, editing: p });
  };

  const submitPOI = async () => {
    if (!poiForm.name.trim() || !poiForm.node_id) {
      toast.error('Name and node are required');
      return;
    }
    const payload = {
      building_id: selectedBuildingId,
      node_id: poiForm.node_id,
      name: poiForm.name.trim(),
      description: poiForm.description.trim(),
      category: poiForm.category,
      subcategory: poiForm.subcategory.trim(),
      image_url: poiForm.image_url.trim() || null,
      audio_url: poiForm.audio_url.trim() || null,
      is_featured: poiForm.is_featured,
      trigger_radius: poiForm.trigger_radius,
      is_search_popular: poiForm.is_search_popular,
    };
    let error;
    if (poiDialog.editing) {
      ({ error } = await supabase.from('pois').update(payload).eq('id', poiDialog.editing.id));
    } else {
      ({ error } = await supabase.from('pois').insert(payload));
    }
    if (error) {
      console.error('POI save error:', error);
      toast.error('Failed to save POI');
      return;
    }
    toast.success(poiDialog.editing ? 'POI updated' : 'POI created');
    setPoiDialog({ open: false, editing: null });
    fetchAll(selectedBuildingId);
  };

  const deletePOI = async (p: SupaPOI) => {
    if (!confirm(`Delete POI "${p.name}" and all its promotions?`)) return;
    // Delete promotions first
    await supabase.from('promotions').delete().eq('poi_id', p.id);
    const { error } = await supabase.from('pois').delete().eq('id', p.id);
    if (error) { toast.error('Failed to delete POI'); return; }
    toast.success('POI deleted');
    fetchAll(selectedBuildingId);
  };

  // ── Media upload (image / audio) ───────────────────────────────────
  // Requires the `poi-media` storage bucket to exist in Supabase with
  // anon INSERT/SELECT/UPDATE/DELETE policies. Run the SQL migration
  // 20260617090000_poi_media_storage_bucket.sql against your live project
  // if uploads fail with a row-level security violation.
  const uploadFile = async (
    file: File,
    kind: 'image' | 'audio',
    setBusy: (v: boolean) => void,
    setUrl: (url: string) => void
  ) => {
    const maxSizeMB = kind === 'image' ? 8 : 20;
    if (file.size > maxSizeMB * 1024 * 1024) {
      toast.error(`${kind === 'image' ? 'Image' : 'Audio'} must be under ${maxSizeMB}MB`);
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split('.').pop() || (kind === 'image' ? 'jpg' : 'mp3');
      const path = `${kind}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { cacheControl: '3600', upsert: false });

      if (uploadError) {
        console.error('[AdminPOIs] upload failed:', uploadError);
        // Surface the raw Supabase error so it's easy to diagnose RLS issues
        toast.error(`Upload failed: ${uploadError.message}`);
        return;
      }

      const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      setUrl(publicData.publicUrl);
      toast.success(`${kind === 'image' ? 'Image' : 'Audio'} uploaded`);
    } finally {
      setBusy(false);
    }
  };

  // ── Promotion handlers ─────────────────────────────────────────
  const openCreatePromo = (poiId: string) => {
    setPromoForm({ ...emptyPromoForm, poi_id: poiId });
    setPromoDialog({ open: true, editing: null, poiId });
  };
  const openEditPromo = (pr: SupaPromotion) => {
    setPromoForm({
      poi_id: pr.poi_id,
      title: pr.title,
      description: pr.description ?? '',
      discount_text: pr.discount_text ?? '',
      badge_color: pr.badge_color ?? 'primary',
      is_active: pr.is_active,
    });
    setPromoDialog({ open: true, editing: pr, poiId: pr.poi_id });
  };

  const submitPromo = async () => {
    if (!promoForm.title.trim()) { toast.error('Title is required'); return; }
    const payload = {
      poi_id: promoForm.poi_id,
      title: promoForm.title.trim(),
      description: promoForm.description.trim(),
      discount_text: promoForm.discount_text.trim(),
      badge_color: promoForm.badge_color,
      is_active: promoForm.is_active,
    };
    let error;
    if (promoDialog.editing) {
      ({ error } = await supabase.from('promotions').update(payload).eq('id', promoDialog.editing.id));
    } else {
      ({ error } = await supabase.from('promotions').insert(payload));
    }
    if (error) { toast.error('Failed to save promotion'); return; }
    toast.success(promoDialog.editing ? 'Promotion updated' : 'Promotion created');
    setPromoDialog({ open: false, editing: null, poiId: '' });
    fetchAll(selectedBuildingId);
  };

  const deletePromo = async (pr: SupaPromotion) => {
    if (!confirm(`Delete promotion "${pr.title}"?`)) return;
    const { error } = await supabase.from('promotions').delete().eq('id', pr.id);
    if (error) { toast.error('Failed to delete promotion'); return; }
    toast.success('Promotion deleted');
    fetchAll(selectedBuildingId);
  };

  // ── The map: each place as its landmark, on the floor's plan ──
  const shownPois = filteredPois.filter(p => !query.trim() || `${p.name} ${p.subcategory ?? ''} ${p.category}`.toLowerCase().includes(query.trim().toLowerCase()));
  const mapFloor = floorFilter !== 'all' ? floorFilter : floors[0]?.id ?? null;
  const mapItems = useMemo<LandmarkItem[]>(() => shownPois.flatMap(p => {
    const n = nodeById.get(p.node_id);
    if (!n) return [];
    const meta = POI_CATEGORY_META[(p.category as POICategory) || 'attraction'];
    return [{ id: p.id, name: p.name, x: n.x, y: n.y, color: toneHex(meta.tone), kind: landmarkFor(p), sub: p.subcategory || meta.label }];
  }), [shownPois, nodeById]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapWalls = useMemo(() => walls.filter(w => w.floor_id === mapFloor), [walls, mapFloor]);
  const selected = selectedId ? pois.find(p => p.id === selectedId) ?? null : null;
  const stats = [
    { label: 'Places', value: pois.length, icon: Sparkles },
    { label: 'Featured', value: pois.filter(p => p.is_featured).length, icon: Star },
    { label: 'With offers', value: pois.filter(p => (promosByPoi.get(p.id) ?? []).length).length, icon: MegaphoneIcon },
    { label: 'With photos', value: pois.filter(p => p.image_url).length, icon: ImageIcon },
  ];

  return (
    <div className="min-h-full bg-background">
      {!embedded && (
        <AdminHeader
          icon={Sparkles}
          title="Points of interest"
          subtitle={`${filteredPois.length} ${filteredPois.length === 1 ? 'place' : 'places'}`}
          onBack={onNavigateToBuildings}
          backTo="/admin"
          primaryAction={<AdminPillButton icon={Plus} variant="solid" onClick={openCreatePOI} disabled={!selectedBuildingId || availableNodes.length === 0}>New place</AdminPillButton>}
        />
      )}

      <div className="space-y-4 p-4 sm:p-5">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedBuildingId} onValueChange={v => { setSelectedBuildingId(v); setFloorFilter('all'); setSelectedId(null); }}>
            <SelectTrigger className="h-10 w-56 rounded-xl"><MapPin className="mr-1.5 h-4 w-4 text-muted-foreground" /><SelectValue placeholder="Choose a venue" /></SelectTrigger>
            <SelectContent>{buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
            {[{ id: 'all', name: 'All floors' }, ...floors.map(fl => ({ id: fl.id, name: fl.name }))].map(fl => (
              <button key={fl.id} onClick={() => setFloorFilter(fl.id)}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors', floorFilter === fl.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {fl.id === 'all' ? <span className="flex items-center gap-1"><Layers3 className="h-3.5 w-3.5" /> All floors</span> : fl.name}
              </button>
            ))}
          </div>
          <label className="ml-auto flex h-10 w-60 items-center gap-2 rounded-xl border bg-card px-3 text-sm focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search places…" className="min-w-0 flex-1 bg-transparent outline-none" />
          </label>
          {embedded && (
            <Button onClick={openCreatePOI} disabled={!selectedBuildingId || availableNodes.length === 0} className="h-10 rounded-xl">
              <Plus className="mr-1.5 h-4 w-4" /> New place
            </Button>
          )}
        </div>

        {/* Numbers */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map(st => (
            <div key={st.label} className="flex items-center gap-3 rounded-2xl border bg-card p-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><st.icon className="h-4 w-4" /></span>
              <span><span className="block text-xl font-black leading-none tabular-nums">{st.value}</span><span className="text-[11px] text-muted-foreground">{st.label}</span></span>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* The 3D landmark map */}
          <div className="relative">
            <Suspense fallback={<div className="flex h-[560px] items-center justify-center rounded-3xl bg-muted/50 text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Building the 3D map…</div>}>
              <LandmarkMap items={mapItems} walls={mapWalls} selectedId={selectedId} onSelect={setSelectedId} className="h-[560px] border"
                emptyText={loading ? 'Loading…' : 'Add a place and it rises here as its landmark'} />
            </Suspense>
            {selected && (
              <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-10 flex items-center gap-3 rounded-2xl border bg-card/95 p-3 shadow-lg backdrop-blur sm:right-auto sm:w-[380px]">
                {selected.image_url
                  ? <img src={selected.image_url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                  : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl text-white" style={{ background: toneHex(POI_CATEGORY_META[(selected.category as POICategory) || 'attraction'].tone) }}><Sparkles className="h-6 w-6" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{selected.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{LANDMARK_LABELS[landmarkFor(selected)]} landmark · {nodeById.get(selected.node_id)?.name || 'no point'}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => openEditPOI(selected)}><Edit className="mr-1 h-3.5 w-3.5" /> Edit</Button>
              </div>
            )}
          </div>

          {/* The list */}
          <div className="h-[560px] space-y-2 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading places…</div>
            ) : shownPois.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 rounded-3xl border border-dashed px-6 text-center">
                <Sparkles className="h-6 w-6 text-primary" />
                <p className="text-sm font-semibold">No places here yet</p>
                <p className="text-xs text-muted-foreground">{nodes.length === 0 ? 'Add places in the map editor first.' : availableNodes.length === 0 ? 'Every point already has a place.' : 'Press New place to add one.'}</p>
              </div>
            ) : shownPois.map(p => {
              const node = nodeById.get(p.node_id);
              const floor = node ? floorById.get(node.floor_id) : null;
              const meta = POI_CATEGORY_META[(p.category as POICategory) || 'attraction'];
              const Icon = POI_SUBCATEGORY_ICON[p.subcategory?.toLowerCase() ?? ''] || meta.icon;
              const poiPromos = promosByPoi.get(p.id) ?? [];
              const on = selectedId === p.id;
              return (
                <div key={p.id} onClick={() => setSelectedId(on ? null : p.id)}
                  className={cn('cursor-pointer rounded-2xl border bg-card p-3 transition-all hover:shadow-md', on && 'border-primary/60 ring-2 ring-primary/20')}>
                  <div className="flex items-start gap-3">
                    {p.image_url
                      ? <img src={p.image_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                      : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white shadow-sm" style={{ background: `linear-gradient(145deg, ${toneHex(meta.tone)}, ${toneHex(meta.tone)}cc)` }}><Icon className="h-5 w-5" /></span>}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                        <span className="truncate">{p.name}</span>
                        {p.is_featured && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Featured" />}
                        {p.is_search_popular && <TrendingUp className="h-3.5 w-3.5 text-sky-600" aria-label="Popular" />}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{meta.label}{p.subcategory ? ` · ${p.subcategory}` : ''} · {node?.name || 'no point'}{floor ? ` · ${floor.name}` : ''}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: `${toneHex(meta.tone)}1f`, color: toneHex(meta.tone) }}>{LANDMARK_LABELS[landmarkFor(p)]}</span>
                        {poiPromos.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">{poiPromos.length} offer{poiPromos.length > 1 ? 's' : ''}</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-0.5" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditPOI(p)} aria-label={`Edit ${p.name}`}><Edit className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deletePOI(p)} aria-label={`Delete ${p.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  {on && (
                    <div className="mt-3 space-y-1.5 border-t pt-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Tag className="h-3 w-3" /> Offers</span>
                        <Button variant="outline" size="sm" className="h-7 rounded-lg" onClick={() => openCreatePromo(p.id)}><Plus className="mr-1 h-3 w-3" /> Add offer</Button>
                      </div>
                      {poiPromos.length === 0 ? <p className="text-xs italic text-muted-foreground">No offers yet.</p> : poiPromos.map(pr => (
                        <div key={pr.id} className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 font-medium"><span className="truncate">{pr.title}</span>{pr.discount_text && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">{pr.discount_text}</span>}{!pr.is_active && <span className="text-[10px] text-muted-foreground">Inactive</span>}</span>
                          </span>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditPromo(pr)}><Edit className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deletePromo(pr)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* POI Dialog */}
      <AdminDialogShell
        open={poiDialog.open}
        onOpenChange={(v) => !v && setPoiDialog({ open: false, editing: null })}
        icon={Sparkles}
        title={poiDialog.editing ? 'Edit POI' : 'New POI'}
        description="POIs attach to a navigation node and provide context, media and offers."
        maxWidth="sm:max-w-lg"
        footer={
          <>
            <AdminButtonGhost onClick={() => setPoiDialog({ open: false, editing: null })}>Cancel</AdminButtonGhost>
            <AdminButtonPrimary onClick={submitPOI}>{poiDialog.editing ? 'Save changes' : 'Create POI'}</AdminButtonPrimary>
          </>
        }
      >
        <AdminField label="Attach to node" icon={MapPin} required>
          <Select value={poiForm.node_id} onValueChange={(v) => setPoiForm(p => ({ ...p, node_id: v }))}>
            <SelectTrigger className={ADMIN_INPUT_CLS}><SelectValue placeholder="Select a node" /></SelectTrigger>
            <SelectContent>
              {availableNodes.map(n => {
                const fl = floorById.get(n.floor_id);
                return (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name || '(unnamed)'} — {fl?.name ?? 'floor?'} · {n.type}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </AdminField>

        <AdminField label="Name" icon={Sparkles} required>
          <Input
            className={ADMIN_INPUT_CLS}
            value={poiForm.name}
            onChange={e => setPoiForm(p => ({ ...p, name: e.target.value }))}
            placeholder="e.g. Habesha Coffee Shop"
          />
        </AdminField>

        <AdminField label="Description">
          <Textarea
            className={ADMIN_TEXTAREA_CLS}
            value={poiForm.description}
            onChange={e => setPoiForm(p => ({ ...p, description: e.target.value }))}
            rows={3}
            placeholder="What makes this place worth a stop?"
          />
        </AdminField>

        <div className="grid grid-cols-2 gap-3">
          <AdminField label="Category" icon={Tag}>
            <Select value={poiForm.category} onValueChange={(v) => setPoiForm(p => ({ ...p, category: v as POICategory, subcategory: '' }))}>
              <SelectTrigger className={ADMIN_INPUT_CLS}><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => {
                  const CatIcon = POI_CATEGORY_META[c].icon;
                  return (
                    <SelectItem key={c} value={c}>
                      <span className="flex items-center gap-1.5">
                        <CatIcon className="w-3.5 h-3.5" /> {POI_CATEGORY_META[c].label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </AdminField>
          <AdminField label="Subcategory">
            <Select value={poiForm.subcategory || 'none'} onValueChange={(v) => setPoiForm(p => ({ ...p, subcategory: v === 'none' ? '' : v }))}>
              <SelectTrigger className={ADMIN_INPUT_CLS}><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {SUBS_BY_CATEGORY[poiForm.category].map(s => {
                  const SubIcon = POI_SUBCATEGORY_ICON[s];
                  return (
                    <SelectItem key={s} value={s}>
                      <span className="flex items-center gap-1.5">
                        {SubIcon && <SubIcon className="w-3.5 h-3.5" />} {s}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </AdminField>
        </div>

        {/* Media section */}
        <div className="rounded-2xl p-4 space-y-4" style={{ background: 'hsl(var(--secondary) / 0.5)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Media</p>

          <AdminField label="Image" icon={ImageIcon}>
            {poiForm.image_url ? (
              <div className="relative rounded-2xl overflow-hidden border border-border/50">
                <img src={poiForm.image_url} alt="POI preview" className="w-full h-32 object-cover" />
                <button
                  type="button"
                  onClick={() => setPoiForm(p => ({ ...p, image_url: '' }))}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center"
                  aria-label="Remove image"
                >
                  <XIcon className="h-3 w-3 text-white" />
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border h-20 cursor-pointer text-muted-foreground hover:bg-background/60 hover:border-primary/40 transition-colors">
                {uploadingImage ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ImageIcon className="h-4 w-4" />
                    <span className="text-xs font-semibold">Choose image</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingImage}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) void uploadFile(file, 'image', setUploadingImage, (url) => setPoiForm(p => ({ ...p, image_url: url })));
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            <Input
              value={poiForm.image_url}
              onChange={e => setPoiForm(p => ({ ...p, image_url: e.target.value }))}
              placeholder="Or paste an image URL"
              className={`${ADMIN_INPUT_CLS} mt-2 text-xs`}
            />
          </AdminField>

          <AdminField label="Audio" icon={Music}>
            {poiForm.audio_url ? (
              <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-background px-3 py-2">
                <Music className="h-4 w-4 text-primary flex-shrink-0" />
                <audio src={poiForm.audio_url} controls className="flex-1 h-8" />
                <button
                  type="button"
                  onClick={() => setPoiForm(p => ({ ...p, audio_url: '' }))}
                  className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0"
                  aria-label="Remove audio"
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border h-12 cursor-pointer text-muted-foreground hover:bg-background/60 hover:border-primary/40 transition-colors">
                {uploadingAudio ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    <span className="text-xs font-semibold">Choose audio</span>
                  </>
                )}
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  disabled={uploadingAudio}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) void uploadFile(file, 'audio', setUploadingAudio, (url) => setPoiForm(p => ({ ...p, audio_url: url })));
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            <Input
              value={poiForm.audio_url}
              onChange={e => setPoiForm(p => ({ ...p, audio_url: e.target.value }))}
              placeholder="Or paste an audio URL"
              className={`${ADMIN_INPUT_CLS} mt-2 text-xs`}
            />
          </AdminField>
        </div>

        <div className="grid grid-cols-2 gap-3 items-end">
          <AdminField label="Trigger radius (m)">
            <Input
              type="number"
              min={1}
              max={50}
              className={ADMIN_INPUT_CLS}
              value={poiForm.trigger_radius}
              onChange={e => setPoiForm(p => ({ ...p, trigger_radius: Math.max(1, Number(e.target.value) || 5) }))}
            />
          </AdminField>
          <div className="flex items-center gap-2.5 h-11 rounded-2xl px-3.5" style={{ background: 'hsl(var(--secondary) / 0.5)' }}>
            <Switch id="featured" checked={poiForm.is_featured} onCheckedChange={(v) => setPoiForm(p => ({ ...p, is_featured: v }))} />
            <Label htmlFor="featured" className="text-xs font-semibold cursor-pointer">Featured (auto-trigger)</Label>
          </div>
          <div className="flex items-center gap-2.5 h-11 rounded-2xl px-3.5 col-span-2" style={{ background: 'hsl(var(--secondary) / 0.5)' }}>
            <Switch id="search-popular" checked={poiForm.is_search_popular} onCheckedChange={(v) => setPoiForm(p => ({ ...p, is_search_popular: v }))} />
            <Label htmlFor="search-popular" className="text-xs font-semibold cursor-pointer">Popular in search (shown as a suggestion before typing)</Label>
          </div>
        </div>
      </AdminDialogShell>

      {/* Promotion Dialog */}
      <AdminDialogShell
        open={promoDialog.open}
        onOpenChange={(v) => !v && setPromoDialog({ open: false, editing: null, poiId: '' })}
        icon={Megaphone}
        title={promoDialog.editing ? 'Edit Promotion' : 'New Promotion'}
        description="Offers are surfaced when users approach the POI during navigation."
        footer={
          <>
            <AdminButtonGhost onClick={() => setPromoDialog({ open: false, editing: null, poiId: '' })}>Cancel</AdminButtonGhost>
            <AdminButtonPrimary onClick={submitPromo}>{promoDialog.editing ? 'Save changes' : 'Create promotion'}</AdminButtonPrimary>
          </>
        }
      >
        <AdminField label="Title" icon={Tag} required>
          <Input
            className={ADMIN_INPUT_CLS}
            value={promoForm.title}
            onChange={e => setPromoForm(p => ({ ...p, title: e.target.value }))}
            placeholder="e.g. Buy 1 Get 1"
          />
        </AdminField>
        <AdminField label="Description">
          <Textarea
            className={ADMIN_TEXTAREA_CLS}
            value={promoForm.description}
            onChange={e => setPromoForm(p => ({ ...p, description: e.target.value }))}
            rows={2}
            placeholder="Short detail shown with the offer"
          />
        </AdminField>
        <div className="grid grid-cols-2 gap-3">
          <AdminField label="Discount text" icon={Percent}>
            <Input
              className={ADMIN_INPUT_CLS}
              value={promoForm.discount_text}
              onChange={e => setPromoForm(p => ({ ...p, discount_text: e.target.value }))}
              placeholder="-20%"
            />
          </AdminField>
          <AdminField label="Badge color" icon={Palette}>
            <Select value={promoForm.badge_color} onValueChange={(v) => setPromoForm(p => ({ ...p, badge_color: v }))}>
              <SelectTrigger className={ADMIN_INPUT_CLS}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="primary">Primary</SelectItem>
                <SelectItem value="destructive">Destructive</SelectItem>
                <SelectItem value="secondary">Secondary</SelectItem>
                <SelectItem value="accent">Accent</SelectItem>
              </SelectContent>
            </Select>
          </AdminField>
        </div>
        <div className="flex items-center gap-2.5 h-11 rounded-2xl px-3.5" style={{ background: 'hsl(var(--secondary) / 0.5)' }}>
          <Switch id="active" checked={promoForm.is_active} onCheckedChange={(v) => setPromoForm(p => ({ ...p, is_active: v }))} />
          <Label htmlFor="active" className="text-xs font-semibold cursor-pointer">Active</Label>
        </div>
      </AdminDialogShell>
    </div>
  );
};

export default AdminPOIs;