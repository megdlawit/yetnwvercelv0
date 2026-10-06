import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Building } from '@/data/types';
import {
  loadBuildings, saveBuilding, deleteBuilding as deleteLocalBuilding,
  createEmptyFloor, exportBuildingJSON, importBuildingJSON, validateBuilding,
  ValidationIssue, generateId,
} from '@/lib/BuildingStorage';
import { sampleBuilding } from '@/data/sampleBuilding';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import AdminHeader from '@/components/admin/AdminHeader';
import AdminPillButton from '@/components/admin/AdminPillButton';
import AdminDialogShell from '@/components/admin/AdminDialogShell';
import AdminFloorTemplateDialog from '@/components/admin/AdminFloorTemplateDialog';
import { getFloorTemplate } from '@/lib/floorTemplates';
import AdminField, { ADMIN_INPUT_CLS, ADMIN_TEXTAREA_CLS } from '@/components/admin/AdminField';
import { AdminButtonPrimary, AdminButtonGhost } from '@/components/admin/AdminButtons';
import { admin } from '@/components/admin/adminTheme';
import {
  Building2, Plus, Trash2, Download, Upload, Layers, AlertTriangle,
  CheckCircle, XCircle, Edit, MapPin, Loader2, Rocket, Globe, Sparkles,
  FileText, Crosshair, Compass, Ruler, LocateFixed, Code2, LayoutDashboard,
} from 'lucide-react';
import { toast } from 'sonner';
import BuildingEmbedPanel from '@/components/admin/BuildingEmbedPanel';

interface SupaBuilding {
  id: string;
  name: string;
  description: string;
  version: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  origin_lat: number | null;
  origin_lng: number | null;
  rotation_deg: number;
  meters_per_pixel: number;
}

interface SupaFloor {
  id: string;
  building_id: string;
  name: string;
  level: number;
  svg_url: string | null;
  created_at: string;
  updated_at: string;
}

interface AdminBuildingsProps {
  /** When embedded as a dashboard tab, switches to the POIs tab instead of routing. */
  onNavigateToPOIs?: () => void;
  /** When true, renders without its own page header (used inside AdminDashboard tabs). */
  embedded?: boolean;
}

const AdminBuildings: React.FC<AdminBuildingsProps> = ({ onNavigateToPOIs, embedded = false }) => {
  const navigate = useNavigate();
  const [supaBuildings, setSupaBuildings] = useState<SupaBuilding[]>([]);
  const [floorsMap, setFloorsMap] = useState<Record<string, SupaFloor[]>>({});
  const [localBuildings, setLocalBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [embedBuildingId, setEmbedBuildingId] = useState<string | null>(null);
  const [editBuilding, setEditBuilding] = useState<SupaBuilding | null>(null);
  const [validationResult, setValidationResult] = useState<{ buildingId: string; issues: ValidationIssue[] } | null>(null);
  const [form, setForm] = useState({
    name: '', description: '',
    originLat: '', originLng: '', rotationDeg: '0', metersPerPixel: '1',
  });
  const [locating, setLocating] = useState(false);
  const [floorTemplateDialog, setFloorTemplateDialog] = useState<{ open: boolean; building: SupaBuilding | null }>({ open: false, building: null });
  const [creatingFloor, setCreatingFloor] = useState(false);

  const fetchFloors = useCallback(async (buildingIds: string[]) => {
    if (buildingIds.length === 0) { setFloorsMap({}); return; }
    const { data, error } = await supabase
      .from('floors')
      .select('*')
      .in('building_id', buildingIds)
      .order('level');
    if (error) {
      console.error('Failed to fetch floors:', error);
      toast.error('Failed to load floors');
      return;
    }
    const map: Record<string, SupaFloor[]> = {};
    for (const f of data || []) {
      if (!map[f.building_id]) map[f.building_id] = [];
      map[f.building_id].push(f);
    }
    setFloorsMap(map);
  }, []);

  const fetchBuildings = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('buildings')
      .select('*')
      .order('created_at');

    if (error) {
      console.error('Failed to fetch buildings:', error);
      toast.error('Failed to load buildings');
    } else {
      setSupaBuildings(data || []);
      await fetchFloors((data || []).map(b => b.id));
    }
    // Also load local buildings for node/edge data
    setLocalBuildings(loadBuildings());
    setLoading(false);
  }, [fetchFloors]);

  useEffect(() => { fetchBuildings(); }, [fetchBuildings]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    const { error } = await supabase.from('buildings').insert({
      name: form.name.trim(),
      description: form.description.trim(),
      version: 1,
      is_published: false,
    });
    if (error) {
      console.error('Create building error:', error);
      toast.error('Failed to create building');
      return;
    }
    setForm({ name: '', description: '', originLat: '', originLng: '', rotationDeg: '0', metersPerPixel: '1' });
    setCreateOpen(false);
    fetchBuildings();
    toast.success('Building created');
  };

  const handleUpdate = async () => {
    if (!editBuilding) return;
    const lat = form.originLat.trim() === '' ? null : Number(form.originLat);
    const lng = form.originLng.trim() === '' ? null : Number(form.originLng);
    if ((lat !== null && Number.isNaN(lat)) || (lng !== null && Number.isNaN(lng))) {
      toast.error('Latitude/longitude must be numbers');
      return;
    }
    const { error } = await supabase
      .from('buildings')
      .update({
        name: form.name.trim(),
        description: form.description.trim(),
        origin_lat: lat,
        origin_lng: lng,
        rotation_deg: Number(form.rotationDeg) || 0,
        meters_per_pixel: Number(form.metersPerPixel) || 1,
      })
      .eq('id', editBuilding.id);
    if (error) {
      console.error('Update building error:', error);
      toast.error('Failed to update building');
      return;
    }
    setEditBuilding(null);
    fetchBuildings();
    toast.success('Building updated');
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not available on this device');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(p => ({
          ...p,
          originLat: pos.coords.latitude.toFixed(7),
          originLng: pos.coords.longitude.toFixed(7),
        }));
        setLocating(false);
        toast.success('Anchor set to your current GPS position');
      },
      err => {
        console.error('Geolocation error:', err);
        toast.error('Could not get your location');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('buildings').delete().eq('id', id);
    if (error) {
      console.error('Delete building error:', error);
      toast.error('Failed to delete building');
      return;
    }
    fetchBuildings();
    toast.success('Building deleted');
  };

  // Local building lookup for node/edge data (not yet migrated)
  const getLocalBuilding = (supaId: string): Building | undefined => {
    return localBuildings.find(b => b.id === supaId || b.name === supaBuildings.find(s => s.id === supaId)?.name);
  };

  const handleAddFloor = (sb: SupaBuilding) => {
    setFloorTemplateDialog({ open: true, building: sb });
  };

  const handleCreateFloorFromTemplate = async (templateId: string) => {
    const sb = floorTemplateDialog.building;
    if (!sb) return;
    setCreatingFloor(true);

    const existing = floorsMap[sb.id] || [];
    const nextLevel = existing.length > 0 ? Math.max(...existing.map(f => f.level), 0) + 1 : 1;

    const { data: floorRow, error: floorError } = await supabase
      .from('floors')
      .insert({ building_id: sb.id, name: `Floor ${nextLevel}`, level: nextLevel, svg_url: null })
      .select()
      .maybeSingle();

    if (floorError || !floorRow) {
      console.error('Add floor error:', floorError);
      toast.error('Failed to add floor');
      setCreatingFloor(false);
      return;
    }

    const template = getFloorTemplate(templateId);
    if (template && template.nodes.length > 0) {
      const { data: nodeRows, error: nodesError } = await supabase
        .from('nodes')
        .insert(template.nodes.map(n => ({
          building_id: sb.id,
          floor_id: floorRow.id,
          name: n.name,
          x: n.x,
          y: n.y,
          is_hallway: n.isHallway,
          type: n.type,
        })))
        .select();

      if (nodesError || !nodeRows) {
        console.error('Add template nodes error:', nodesError);
        toast.error('Floor added, but the template layout failed to apply');
      } else {
        const keyToId = new Map(template.nodes.map((n, i) => [n.key, nodeRows[i]?.id]));
        const edgeRows = template.edges
          .map(e => ({
            building_id: sb.id,
            from_node: keyToId.get(e.from),
            to_node: keyToId.get(e.to),
            weight: 0,
          }))
          .filter(e => e.from_node && e.to_node);

        if (edgeRows.length > 0) {
          const { error: edgesError } = await supabase.from('edges').insert(edgeRows);
          if (edgesError) {
            console.error('Add template edges error:', edgesError);
            toast.error('Floor added, but some connections failed to apply');
          }
        }
      }
    }

    await fetchFloors(supaBuildings.map(b => b.id));
    setCreatingFloor(false);
    setFloorTemplateDialog({ open: false, building: null });
    toast.success(template && template.id !== 'blank' ? `Floor added from "${template.name}" template` : 'Floor added');
  };

  const handleDeleteFloor = async (sb: SupaBuilding, floorId: string) => {
    const existing = floorsMap[sb.id] || [];
    if (existing.length <= 1) { toast.error('Must have at least one floor'); return; }
    const { error } = await supabase.from('floors').delete().eq('id', floorId);
    if (error) {
      console.error('Delete floor error:', error);
      toast.error('Failed to delete floor');
      return;
    }
    await fetchFloors(supaBuildings.map(b => b.id));
    toast.success('Floor deleted');
  };

  const handlePublish = async (sb: SupaBuilding) => {
    // Check building has floors, nodes, edges
    const floors = floorsMap[sb.id] || [];
    if (floors.length === 0) {
      toast.error('Cannot publish: no floors');
      return;
    }

    // Check nodes exist
    const { count, error: countErr } = await supabase
      .from('nodes')
      .select('*', { count: 'exact', head: true })
      .eq('building_id', sb.id);

    if (countErr || !count || count === 0) {
      toast.error('Cannot publish: no nodes in building');
      return;
    }

    const newVersion = sb.version + 1;
    const { error } = await supabase
      .from('buildings')
      .update({
        version: newVersion,
        is_published: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sb.id);

    if (error) {
      console.error('Publish error:', error);
      toast.error('Failed to publish building');
      return;
    }

    fetchBuildings();
    toast.success(`Published v${newVersion}`, { description: 'Building is now live for navigation.' });
  };

  const handleUnpublish = async (sb: SupaBuilding) => {
    const { error } = await supabase
      .from('buildings')
      .update({ is_published: false })
      .eq('id', sb.id);

    if (error) {
      console.error('Unpublish error:', error);
      toast.error('Failed to unpublish');
      return;
    }
    fetchBuildings();
    toast.success('Building unpublished');
  };

  const handleExport = (sb: SupaBuilding) => {
    const local = getLocalBuilding(sb.id);
    if (!local) {
      toast.error('No local floor data to export');
      return;
    }
    exportBuildingJSON(local);
    toast.success('JSON exported');
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const result = importBuildingJSON(ev.target?.result as string);
        if (result) {
          // Create in Supabase
          const { data, error } = await supabase.from('buildings').insert({
            name: result.name,
            description: `Imported from ${result.address || ''}, ${result.city || ''}`.trim(),
            version: 1,
            is_published: false,
          }).select().maybeSingle();

          if (error || !data) {
            console.error('Import error:', error);
            toast.error('Failed to import building');
            return;
          }
          // Save floors locally with the new supabase ID
          result.id = data.id;
          saveBuilding(result);
          fetchBuildings();
          toast.success(`Imported "${result.name}"`);
        } else {
          toast.error('Invalid building JSON');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleLoadSample = async () => {
    const exists = supaBuildings.find(b => b.name === sampleBuilding.name);
    if (exists) { toast.info('Sample already loaded'); return; }
    const { data, error } = await supabase.from('buildings').insert({
      name: sampleBuilding.name,
      description: `${sampleBuilding.address}, ${sampleBuilding.city}`,
      version: 1,
      is_published: false,
    }).select().maybeSingle();

    if (error || !data) {
      console.error('Load sample error:', error);
      toast.error('Failed to load sample');
      return;
    }
    // Save floor data locally with supabase ID
    saveBuilding({ ...sampleBuilding, id: data.id });
    fetchBuildings();
    toast.success('Sample building loaded');
  };

  const handleValidate = (sb: SupaBuilding) => {
    const local = getLocalBuilding(sb.id);
    if (!local) {
      toast.error('No local floor data to validate');
      return;
    }
    const issues = validateBuilding(local);
    setValidationResult({ buildingId: sb.id, issues });
  };

  const getFloors = (sb: SupaBuilding) => {
    return floorsMap[sb.id] || [];
  };

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      {!embedded && (
        <AdminHeader
          icon={Building2}
          title="Building Manager"
          subtitle={`${supaBuildings.length} ${supaBuildings.length === 1 ? 'building' : 'buildings'}`}
          actions={
            <>
              {onNavigateToPOIs ? (
                <AdminPillButton icon={Sparkles} onClick={onNavigateToPOIs}>POIs</AdminPillButton>
              ) : (
                <Link to="/admin/pois"><AdminPillButton icon={Sparkles}>POIs</AdminPillButton></Link>
              )}
              <AdminPillButton icon={MapPin} onClick={handleLoadSample}>Load Sample</AdminPillButton>
              <AdminPillButton icon={Upload} onClick={handleImport}>Import</AdminPillButton>
            </>
          }
          primaryAction={
            <AdminPillButton
              icon={Plus}
              variant="solid"
              onClick={() => { setForm({ name: '', description: '', originLat: '', originLng: '', rotationDeg: '0', metersPerPixel: '1' }); setCreateOpen(true); }}
            >
              New Building
            </AdminPillButton>
          }
        />
      )}

      {embedded && (
        <div className="px-4 pt-5 flex gap-2 flex-wrap items-center">
          <div className="mr-auto">
            <p className="text-sm font-bold text-foreground">{supaBuildings.length} {supaBuildings.length === 1 ? 'building' : 'buildings'}</p>
          </div>
          <button onClick={handleLoadSample} className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold tap-scale" style={{ background: 'hsl(var(--muted))' }}>
            <MapPin className="h-3.5 w-3.5" /> Load Sample
          </button>
          <button onClick={handleImport} className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold tap-scale" style={{ background: 'hsl(var(--muted))' }}>
            <Upload className="h-3.5 w-3.5" /> Import
          </button>
          <button
            onClick={() => { setForm({ name: '', description: '', originLat: '', originLng: '', rotationDeg: '0', metersPerPixel: '1' }); setCreateOpen(true); }}
            className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold tap-scale text-white"
            style={{ background: 'hsl(152 70% 22%)' }}
          >
            <Plus className="h-3.5 w-3.5" /> New Building
          </button>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-20 text-muted-foreground">
            <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin" style={{ color: admin.icon }} />
            <p className="text-sm">Loading buildings...</p>
          </div>
        ) : supaBuildings.length === 0 ? (
          <div
            className="text-center py-16 px-6 rounded-2xl"
            style={{ background: 'hsl(var(--card))', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
              style={{ background: admin.iconBadge, border: `1px solid ${admin.iconBadgeBorder}` }}
            >
              <Building2 className="h-6 w-6" style={{ color: admin.icon }} />
            </div>
            <p className="text-sm font-semibold text-foreground">No buildings yet</p>
            <p className="text-xs text-muted-foreground mt-1">Create one or load the sample to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {supaBuildings.map(b => {
              const floors = getFloors(b);
              return (
                <div
                  key={b.id}
                  className="rounded-2xl overflow-hidden"
                  style={{ background: 'hsl(var(--card))', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
                >
                  <div className="p-4 pb-3 flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: admin.iconBadge, border: `1px solid ${admin.iconBadgeBorder}`, color: admin.icon }}
                      >
                        <Building2 className="h-4.5 w-4.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold leading-tight">{b.name}</p>
                          {b.is_published && (
                            <span
                              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: admin.iconBadge, color: admin.textMuted, border: `1px solid ${admin.iconBadgeBorder}` }}
                            >
                              <Globe className="h-3 w-3" style={{ color: admin.icon }} /> Live v{b.version}
                            </span>
                          )}
                          {b.origin_lat != null && b.origin_lng != null ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: admin.iconBadge, color: admin.textMuted, border: `1px solid ${admin.iconBadgeBorder}` }}
                            >
                              <Crosshair className="h-3 w-3" style={{ color: admin.icon }} /> Geo-anchored
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: admin.dangerSoft, color: admin.danger, border: `1px solid ${admin.dangerBorder}` }}
                            >
                              <AlertTriangle className="h-3 w-3" /> No GPS anchor
                            </span>
                          )}
                        </div>
                        {b.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{b.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => navigate(`/dashboard?venue=${b.id}`)}
                        className="h-8 rounded-full px-3 flex items-center gap-1.5 text-xs font-semibold tap-scale"
                        style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
                        title="Open this venue's dashboard"
                      >
                        <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
                      </button>
                      <button
                        onClick={() => setEmbedBuildingId(b.id)}
                        className="w-8 h-8 rounded-full flex items-center justify-center tap-scale"
                        style={{ background: 'hsl(var(--muted))' }}
                        aria-label="Get embed code"
                        title="Get embed code"
                      >
                        <Code2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => { setForm({ name: b.name, description: b.description || '', originLat: b.origin_lat != null ? String(b.origin_lat) : '', originLng: b.origin_lng != null ? String(b.origin_lng) : '', rotationDeg: String(b.rotation_deg ?? 0), metersPerPixel: String(b.meters_per_pixel ?? 1) }); setEditBuilding(b); }}
                        className="w-8 h-8 rounded-full flex items-center justify-center tap-scale"
                        style={{ background: 'hsl(var(--muted))' }}
                        aria-label="Edit building"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(b.id)}
                        className="w-8 h-8 rounded-full flex items-center justify-center tap-scale"
                        style={{ background: 'hsl(var(--destructive) / 0.10)', color: 'hsl(var(--destructive))' }}
                        aria-label="Delete building"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="px-4 pb-3">
                    <div className="space-y-1.5">
                      {floors.length === 0 && (
                        <p className="text-xs text-muted-foreground px-1">No floors yet</p>
                      )}
                      {floors.map(f => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
                          style={{ background: admin.surfaceSunken, border: `1px solid ${admin.border}` }}
                        >
                          <button
                            className="flex items-center gap-2 transition-colors flex-1 text-left"
                            style={{ color: admin.text }}
                            onClick={() => navigate(`/admin/floors/${b.id}/${f.id}/editor`)}
                          >
                            <Layers className="h-3.5 w-3.5" style={{ color: admin.icon }} />
                            <span className="font-semibold">{f.name}</span>
                            <span className="text-muted-foreground text-xs font-normal">Level {f.level}</span>
                          </button>
                          <button
                            onClick={() => handleDeleteFloor(b, f.id)}
                            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ color: 'hsl(var(--destructive))' }}
                            aria-label="Delete floor"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="px-4 pb-4 flex gap-2 flex-wrap">
                    <button
                      onClick={() => handleAddFloor(b)}
                      className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold tap-scale"
                      style={{ background: 'hsl(var(--muted))' }}
                    >
                      <Plus className="h-3 w-3" /> Floor
                    </button>
                    <button
                      onClick={() => handleExport(b)}
                      className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold tap-scale"
                      style={{ background: 'hsl(var(--muted))' }}
                    >
                      <Download className="h-3 w-3" /> Export
                    </button>
                    <button
                      onClick={() => handleValidate(b)}
                      className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold tap-scale"
                      style={{ background: 'hsl(var(--muted))' }}
                    >
                      <AlertTriangle className="h-3 w-3" /> Validate
                    </button>
                    {b.is_published ? (
                      <button
                        onClick={() => handleUnpublish(b)}
                        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold tap-scale ml-auto"
                        style={{ background: 'hsl(var(--destructive) / 0.10)', color: 'hsl(var(--destructive))' }}
                      >
                        <XCircle className="h-3 w-3" /> Unpublish
                      </button>
                    ) : (
                      <button
                        onClick={() => handlePublish(b)}
                        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold tap-scale ml-auto text-white"
                        style={{ background: 'hsl(152 70% 22%)' }}
                      >
                        <Rocket className="h-3 w-3" /> Publish
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Create dialog */}
      <AdminDialogShell
        open={createOpen}
        onOpenChange={setCreateOpen}
        icon={Building2}
        title="New Building"
        description="Add a building to start mapping floors and navigation."
        footer={
          <>
            <AdminButtonGhost onClick={() => setCreateOpen(false)}>Cancel</AdminButtonGhost>
            <AdminButtonPrimary onClick={handleCreate} disabled={!form.name.trim()}>Create building</AdminButtonPrimary>
          </>
        }
      >
        <AdminField label="Building name" icon={Building2} required>
          <Input
            className={ADMIN_INPUT_CLS}
            placeholder="e.g. Friendship Park Mall"
            value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          />
        </AdminField>
        <AdminField label="Description" icon={FileText} hint="Shown to visitors when they look up this building.">
          <Textarea
            className={ADMIN_TEXTAREA_CLS}
            placeholder="A short description of the building"
            rows={3}
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          />
        </AdminField>
      </AdminDialogShell>

      {/* Edit dialog */}
      <AdminDialogShell
        open={!!editBuilding}
        onOpenChange={v => !v && setEditBuilding(null)}
        icon={Edit}
        title="Edit Building"
        description="Update building metadata."
        footer={
          <>
            <AdminButtonGhost onClick={() => setEditBuilding(null)}>Cancel</AdminButtonGhost>
            <AdminButtonPrimary onClick={handleUpdate} disabled={!form.name.trim()}>Save changes</AdminButtonPrimary>
          </>
        }
      >
        <AdminField label="Building name" icon={Building2} required>
          <Input
            className={ADMIN_INPUT_CLS}
            placeholder="Building name"
            value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          />
        </AdminField>
        <AdminField label="Description" icon={FileText}>
          <Textarea
            className={ADMIN_TEXTAREA_CLS}
            placeholder="Description"
            rows={3}
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          />
        </AdminField>

        <div className="pt-2 mt-2 border-t border-border/60 space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground/75 px-0.5">
            <Crosshair className="w-3.5 h-3.5 text-muted-foreground" />
            GPS anchor
          </div>
          <p className="text-[11px] text-muted-foreground px-0.5 -mt-2">
            This is how the outdoor map knows where this building sits in the real world.
            Set it to the building's entrance coordinates so the app can geofence it and
            automatically switch to indoor mode when someone walks in.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <AdminField label="Latitude" icon={MapPin}>
              <Input
                className={ADMIN_INPUT_CLS}
                placeholder="e.g. 9.0192"
                inputMode="decimal"
                value={form.originLat}
                onChange={e => setForm(p => ({ ...p, originLat: e.target.value }))}
              />
            </AdminField>
            <AdminField label="Longitude" icon={MapPin}>
              <Input
                className={ADMIN_INPUT_CLS}
                placeholder="e.g. 38.7620"
                inputMode="decimal"
                value={form.originLng}
                onChange={e => setForm(p => ({ ...p, originLng: e.target.value }))}
              />
            </AdminField>
          </div>

          <AdminButtonGhost onClick={handleUseMyLocation} disabled={locating} className="w-full">
            {locating
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Getting your location…</>
              : <><LocateFixed className="w-3.5 h-3.5" /> Use my current GPS location</>}
          </AdminButtonGhost>

          <div className="grid grid-cols-2 gap-2">
            <AdminField label="Rotation (°)" icon={Compass} hint="Clockwise offset of the floor plan from true north.">
              <Input
                className={ADMIN_INPUT_CLS}
                placeholder="0"
                inputMode="decimal"
                value={form.rotationDeg}
                onChange={e => setForm(p => ({ ...p, rotationDeg: e.target.value }))}
              />
            </AdminField>
            <AdminField label="Meters / pixel" icon={Ruler} hint="Real-world scale of the floor plan image.">
              <Input
                className={ADMIN_INPUT_CLS}
                placeholder="1"
                inputMode="decimal"
                value={form.metersPerPixel}
                onChange={e => setForm(p => ({ ...p, metersPerPixel: e.target.value }))}
              />
            </AdminField>
          </div>
        </div>
      </AdminDialogShell>

      {/* Validation dialog */}
      <AdminDialogShell
        open={!!validationResult}
        onOpenChange={v => !v && setValidationResult(null)}
        icon={AlertTriangle}
        title="Validation Results"
        description={validationResult?.issues.length === 0 ? 'No issues found!' : `${validationResult?.issues.length} issue(s) detected.`}
      >
        <div className="max-h-64 overflow-y-auto space-y-2">
          {validationResult?.issues.length === 0 && (
            <div
              className="flex items-center gap-2 text-sm font-semibold rounded-2xl px-3.5 py-3"
              style={{ background: 'hsl(133 60% 45% / 0.10)', color: 'hsl(133 60% 28%)' }}
            >
              <CheckCircle className="h-4 w-4" /> Building graph is valid
            </div>
          )}
          {validationResult?.issues.map((issue, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-sm rounded-2xl px-3.5 py-3"
              style={{
                background: issue.type === 'error' ? 'hsl(var(--destructive) / 0.08)' : 'hsl(45 90% 50% / 0.10)',
                color: issue.type === 'error' ? 'hsl(var(--destructive))' : 'hsl(38 80% 35%)',
              }}
            >
              {issue.type === 'error' ? <XCircle className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      </AdminDialogShell>

      {/* Get embed code — Google-Maps-share-style, scoped to one building */}
      <AdminDialogShell
        open={!!embedBuildingId}
        onOpenChange={(v) => !v && setEmbedBuildingId(null)}
        icon={Code2}
        title="Get embed code"
        description={supaBuildings.find((b) => b.id === embedBuildingId)?.name}
        maxWidth="sm:max-w-lg"
      >
        {embedBuildingId && <BuildingEmbedPanel key={embedBuildingId} buildingId={embedBuildingId} />}
      </AdminDialogShell>

      {/* Add floor — template picker */}
      <AdminFloorTemplateDialog
        open={floorTemplateDialog.open}
        onOpenChange={(v) => !creatingFloor && setFloorTemplateDialog(p => ({ ...p, open: v }))}
        buildingName={floorTemplateDialog.building?.name}
        submitting={creatingFloor}
        onConfirm={handleCreateFloorFromTemplate}
      />
    </div>
  );
};

export default AdminBuildings;