// CAD import: drop a file → automatic analysis → review (layer mapping,
// health check, units) → create the venue.
//
// Reading, classifying, cleaning and building all run in the browser, so
// every format goes through the same steps and nothing large is uploaded.
// Saving uses the signed-in user's Supabase session (RLS applies). The
// original file is only read, never changed.

import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { UploadCloud, FileCheck2, Check, Loader2, AlertTriangle, Box, X, Wand2, Info, Sparkles, PenTool, CheckCircle2 } from 'lucide-react';
import { celebrateBuild } from '@/lib/celebrate';
import { cn } from '@/lib/utils';

import { readCadFile, extOf } from '@/lib/cad/readFile';
import { classifyLayers, type LayerInfo } from '@/lib/cad/classify';
import { buildVenue, type BuiltVenue } from '@/lib/cad/buildVenue';
import { inferUnits, findDrawings, withinArea, quarterArcs, type DrawingArea } from '@/lib/cad/analyze';
import { commitVenue, walkableGraph, type CommitResult } from '@/lib/cad/commitVenue';
import type { PathGraphResult } from '@/lib/dxf/generatePathGraph';
import { CATEGORY_LABELS, type CadDrawing, type Category, type LayerMapping } from '@/lib/cad/types';

export interface ImportSummary extends CommitResult { format: string; health: BuiltVenue['health'] }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingId: string;
  floorId: string;
  pxPerMeter: number;
  onImported: (summary: ImportSummary) => Promise<void> | void;
  onViewIn3D: () => void;
  /** "Show me how to edit it" after the venue is created. */
  onStartTour?: () => void;
  /** The file holds several floors — import each as its own floor instead. */
  onImportAsFloors?: (file: File) => void;
}

const FORMATS: { ext: string; kind: 'cad' | 'ref' | 'export'; tip: string }[] = [
  { ext: 'DWG', kind: 'cad', tip: 'Editable CAD — converted to DXF automatically' },
  { ext: 'DXF', kind: 'cad', tip: 'Editable CAD — layers, blocks and text' },
  { ext: 'IFC', kind: 'cad', tip: 'BIM model — walls, spaces, doors and stairs by class' },
  { ext: 'SVG', kind: 'ref', tip: 'Vector drawing — groups become layers' },
  { ext: 'PDF', kind: 'ref', tip: 'Vector PDF — set the drawing scale' },
  { ext: 'OBJ', kind: 'ref', tip: '3D model — cut into a plan at 1 m' },
  { ext: 'GLB', kind: 'ref', tip: '3D model — cut into a plan at 1 m' },
  { ext: 'GLTF', kind: 'ref', tip: '3D model (single file) — cut into a plan at 1 m' },
  { ext: 'DGN', kind: 'export', tip: 'Export from MicroStation as DWG or DXF first' },
];

const ANALYSIS_STEPS = [
  'Reading CAD file', 'Detecting geometry, blocks and text', 'Detecting door swings', 'Detecting units and scale',
  'Detecting drawings on the sheet', 'Detecting layers', 'Detecting walls and rooms', 'Detecting doors, stairs and entrances',
] as const;

const UNIT_PRESETS: { label: string; perMeter: number }[] = [
  { label: 'Millimetres', perMeter: 1000 }, { label: 'Centimetres', perMeter: 100 }, { label: 'Metres', perMeter: 1 },
  { label: 'Inches', perMeter: 39.3701 }, { label: 'Feet', perMeter: 3.28084 },
];
const PDF_SCALES = [20, 50, 100, 200, 250, 500, 1000];
const PDF_POINTS_PER_METER = 72 / 0.0254;
const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

type Stage = 'pick' | 'analyzing' | 'review' | 'saving' | 'done';

type Units = { perMeter: number; source: 'file' | 'inferred' | 'assumed' | 'manual'; reason: string };

/**
 * Units for a drawing: 3D formats are metres by definition; for drawings the
 * geometry decides (door swings, plan size), since files often declare the
 * wrong unit or none at all.
 */
function detectUnits(d: CadDrawing, arcs: ReturnType<typeof quarterArcs>): Units {
  if (['ifc', 'obj', 'glb', 'gltf'].includes(d.format)) return { perMeter: 1, source: 'file', reason: `${d.format.toUpperCase()} models are in metres` };
  const g = inferUnits(d, arcs);
  if (g.source !== 'assumed' || d.format === 'dxf' || d.format === 'dwg') return { perMeter: g.perMeter, source: g.source, reason: g.reason };
  // No doors to measure: PDFs default to 1:100, other drawings to ~50 m across.
  if (d.format === 'pdf') return { perMeter: PDF_POINTS_PER_METER / 100, source: 'assumed', reason: 'assumed 1:100 — set the drawing scale' };
  const b = d.bounds;
  const longest = b ? Math.max(b.maxX - b.minX, b.maxY - b.minY) : 50;
  return { perMeter: Math.max(longest / 50, 1e-6), source: 'assumed', reason: 'assumed about 50 m across — set the scale' };
}

const tick = () => new Promise(r => setTimeout(r, 70));

export default function CadImportDialog({ open, onOpenChange, buildingId, floorId, pxPerMeter, onImported, onViewIn3D, onStartTour, onImportAsFloors }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [stage, setStage] = useState<Stage>('pick');
  const [done, setDone] = useState(0);            // analysis steps completed
  const [error, setError] = useState<string | null>(null);
  // The whole file, the drawings found on it, and which one is imported.
  const [sheet, setSheet] = useState<CadDrawing | null>(null);
  const [areas, setAreas] = useState<DrawingArea[]>([]);
  const [areaIdx, setAreaIdx] = useState(0);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [mapping, setMapping] = useState<LayerMapping>({});
  const [units, setUnits] = useState<Units>({ perMeter: 1000, source: 'assumed', reason: '' });
  const [fix, setFix] = useState({ gaps: true, overlaps: true, rooms: true, floating: false });
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  // "Fix automatically" plays a short fixing pass so the change is visible.
  const [fixing, setFixing] = useState(false);
  const [justFixed, setJustFixed] = useState(false);
  // Create venue: build steps shown while it saves (see BUILD_STEPS).
  const [buildStep, setBuildStep] = useState(0);
  // The walkable paths being built (drawn by the build animation, then saved).
  const [paths, setPaths] = useState<PathGraphResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setStage('pick'); setDone(0); setError(null); setSheet(null); setAreas([]); setAreaIdx(0); setSummary(null); setJustFixed(false); setBuildStep(0); setPaths(null); };
  const drawing = useMemo(() => (sheet ? withinArea(sheet, areas.length > 1 ? areas[areaIdx] ?? null : null) : null), [sheet, areas, areaIdx]);
  const close = (v: boolean) => { onOpenChange(v); if (!v) { reset(); setFile(null); } };

  const pick = (f: File | null) => {
    setError(null);
    if (f && extOf(f.name) === 'dgn') {
      setError('DGN files can\'t be read directly. In MicroStation choose File → Export → DWG or DXF, then import that file.');
      return;
    }
    setFile(f);
  };

  const analyze = async (f: File) => {
    setStage('analyzing'); setDone(0); setError(null);
    try {
      // Each step below is the real work, run in order; tick() lets the list repaint.
      const d = await readCadFile(f);
      setDone(1); await tick();
      setDone(2); await tick();                                   // entities, blocks (exploded) and text are read
      const arcs = quarterArcs(d.entities);
      setDone(3); await tick();
      const u = detectUnits(d, arcs);
      setUnits(u); setDone(4); await tick();
      const found = ['ifc', 'obj', 'glb', 'gltf'].includes(d.format) ? [] : findDrawings(d, u.perMeter, arcs);
      const area = withinArea(d, found.length > 1 ? found[0] : null);
      setDone(5); await tick();
      const ls = classifyLayers(area);
      const m = Object.fromEntries(ls.map(l => [l.name, l.suggested]));
      setDone(6); await tick();
      buildVenue(area, m, { unitsPerMeter: u.perMeter, pxPerMeter, flipY: d.flipY, fix }); // walls, rooms, doors…
      setDone(7); await tick(); setDone(8); await tick();
      setSheet(d); setAreas(found); setAreaIdx(0); setLayers(ls); setMapping(m);
      setStage('review');
    } catch (err) {
      console.error('CAD analysis failed:', err);
      setError(err instanceof Error ? err.message : 'Could not read this file.');
      setStage('pick');
    }
  };

  const switchLevel = (i: number) => {
    if (!sheet?.atLevel) return;
    const d = sheet.atLevel(i);
    const ls = classifyLayers(d);
    setSheet(d); setLayers(ls);
    setMapping(prev => Object.fromEntries(ls.map(l => [l.name, prev[l.name] ?? l.suggested])));
  };

  const switchArea = (i: number) => {
    if (!sheet) return;
    const ls = classifyLayers(withinArea(sheet, areas[i] ?? null));
    setAreaIdx(i); setLayers(ls);
    setMapping(prev => Object.fromEntries(ls.map(l => [l.name, prev[l.name] ?? l.suggested])));
  };

  // Live preview of what will be created; deferred so typing a scale stays smooth.
  const deferred = useDeferredValue({ drawing, mapping, units, fix });
  const built = useMemo(() => deferred.drawing
    ? buildVenue(deferred.drawing, deferred.mapping, { unitsPerMeter: deferred.units.perMeter, pxPerMeter, flipY: deferred.drawing.flipY, fix: deferred.fix })
    : null, [deferred, pxPerMeter]);
  // The same build with every fix off: what's wrong with the drawing as it is.
  const raw = useMemo(() => deferred.drawing
    ? buildVenue(deferred.drawing, deferred.mapping, { unitsPerMeter: deferred.units.perMeter, pxPerMeter, flipY: deferred.drawing.flipY, fix: { gaps: false, overlaps: false, rooms: false, floating: false }, detect: { rooms: false } })
    : null, [deferred.drawing, deferred.mapping, deferred.units, pxPerMeter]);

  const save = async () => {
    if (!drawing || !built) return;
    setStage('saving'); setError(null); setBuildStep(0); setPaths(null);
    await tick();
    // The walkable paths, worked out once: drawn by the animation, then saved.
    const graph = walkableGraph(built, pxPerMeter);
    setPaths(graph);
    // Walk through the build steps while the venue is written; the last one
    // completes only when the save really has.
    const at = STEP_MS.map((_, i) => STEP_MS.slice(0, i + 1).reduce((x, y) => x + y, 0));
    const timers = at.slice(0, -1).map((t, i) => setTimeout(() => setBuildStep(i + 1), t));
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Sign in as this venue\'s owner first.');
      const [result] = await Promise.all([
        commitVenue(supabase, buildingId, floorId, built, `${drawing.format}-import`, pxPerMeter, graph),
        new Promise(r => setTimeout(r, at[at.length - 1])),
      ]);
      setBuildStep(BUILD_STEPS.length);
      await new Promise(r => setTimeout(r, 450));
      celebrateBuild();
      const s: ImportSummary = { ...result, format: drawing.format.toUpperCase(), health: built.health, warnings: [...built.warnings, ...result.warnings] };
      setSummary(s);
      setStage('done');
      await onImported(s);
    } catch (err) {
      console.error('Saving import failed:', err);
      setError(err instanceof Error ? err.message : 'Saving failed.');
      setStage('review');
    } finally {
      timers.forEach(clearTimeout);
    }
  };

  // Fix everything: a short visible pass, then every fix switched on.
  const fixAll = async () => {
    setFixing(true); setJustFixed(false);
    await new Promise(r => setTimeout(r, 900));
    setFix({ gaps: true, overlaps: true, rooms: true, floating: true });
    setFixing(false); setJustFixed(true);
  };

  const issues = raw && built ? [
    { key: 'gaps' as const, count: raw.health.gaps, left: fix.gaps ? Math.max(0, built.health.gaps - built.health.gapsFixed) : raw.health.gaps,
      label: 'wall gaps', done: 'closed', fixLabel: 'Close gaps under 30 cm' },
    { key: 'overlaps' as const, count: raw.health.overlaps ?? 0, left: fix.overlaps ? 0 : raw.health.overlaps ?? 0,
      label: 'overlapping walls', done: 'merged', fixLabel: 'Merge overlapping walls' },
    { key: 'rooms' as const, count: raw.health.unclosedRooms, left: fix.rooms ? built.health.unclosedRooms : raw.health.unclosedRooms,
      label: 'unclosed rooms', done: 'closed', fixLabel: 'Close rooms that almost close' },
    { key: 'floating' as const, count: raw.health.floating, left: fix.floating ? 0 : raw.health.floating,
      label: 'floating objects', done: 'removed', fixLabel: 'Remove objects far outside the building' },
  ] : [];
  const issueCount = issues.reduce((s, i) => s + i.count, 0);
  const leftCount = issues.reduce((s, i) => s + i.left, 0);
  // What a click on "Fix automatically" can still change.
  const canFix = issues.some(i => i.count > 0 && !fix[i.key]);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={cn(stage === 'review' ? 'max-w-4xl' : stage === 'saving' || stage === 'done' ? 'max-w-2xl' : 'max-w-xl', 'max-h-[92vh] overflow-y-auto')}>
        <DialogHeader>
          <DialogTitle>
            {stage === 'done' ? 'Your digital venue is ready' : stage === 'saving' ? 'Building your digital venue…' : stage === 'review' ? 'Review your map' : stage === 'analyzing' ? 'Analyzing your map…' : 'Import your existing map'}
          </DialogTitle>
          <DialogDescription>
            {stage === 'saving' ? 'Hang tight — your plan is turning into a walkable, 3D venue.'
              : stage === 'review' ? 'Check what each layer becomes and what we cleaned up. Nothing is saved until you create the venue.'
              : stage === 'done' ? 'Walls, rooms, objects and walkable paths were created. See them in 2D and 3D.'
              : 'Bring the map you already have — no redrawing.'}
          </DialogDescription>
        </DialogHeader>

        {stage === 'pick' && (
          <div className="space-y-4">
            <button type="button" onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0] ?? null); }}
              className={cn('w-full rounded-xl border-2 border-dashed px-6 py-9 text-center transition-colors',
                dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40')}>
              {file ? (
                <>
                  <FileCheck2 className="h-9 w-9 mx-auto mb-2 text-primary" />
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{(file.size / 1024).toFixed(0)} KB · click to choose another file</p>
                </>
              ) : (
                <>
                  <UploadCloud className="h-9 w-9 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop your CAD file here</p>
                  <p className="text-xs text-muted-foreground mt-0.5">or <span className="text-primary font-medium">browse files</span></p>
                </>
              )}
            </button>
            {/* No `accept` filter: OSes register inconsistent MIME types for CAD
                files, which hid them in the picker. The extension decides. */}
            <input ref={inputRef} type="file" className="hidden" onChange={e => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }} />

            <div className="space-y-1.5">
              {(['cad', 'ref', 'export'] as const).map(kind => (
                <div key={kind} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-28 text-[11px] text-muted-foreground">
                    {kind === 'cad' ? 'Editable CAD' : kind === 'ref' ? 'Drawings & models' : 'Export first'}
                  </span>
                  {FORMATS.filter(f => f.kind === kind).map(f => (
                    <span key={f.ext} title={f.tip}
                      className={cn('rounded-md border px-2 py-0.5 text-[11px] font-medium',
                        kind === 'export' ? 'border-dashed text-muted-foreground' : kind === 'cad' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted/50')}>
                      {f.ext}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Your original file will never be modified.</p>
            {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs flex gap-2"><X className="h-4 w-4 text-destructive shrink-0" /> {error}</div>}
          </div>
        )}

        {stage === 'analyzing' && (
          <ul className="space-y-2 py-1">
            {ANALYSIS_STEPS.map((label, i) => (
              <li key={label} className={cn('flex items-center gap-2.5 text-sm', i > done && 'text-muted-foreground/50')}>
                {i < done ? <Check className="h-4 w-4 text-primary" /> : i === done ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <span className="h-4 w-4 rounded-full border" />}
                {label}
              </li>
            ))}
            <li className={cn('pt-2 text-sm font-medium', done < ANALYSIS_STEPS.length && 'text-muted-foreground/50')}>Creating your digital venue…</li>
          </ul>
        )}

        {stage === 'saving' && built && <BuildAnimation venue={built} step={buildStep} paths={paths} />}

        {stage === 'review' && drawing && built && raw && (
          <div className="grid md:grid-cols-[1fr_300px] gap-4">
            <Tabs defaultValue="health" className="min-w-0">
              <TabsList>
                <TabsTrigger value="health">Health check {issueCount > 0 && <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 text-[10px] text-amber-700 dark:text-amber-400">{issueCount}</span>}</TabsTrigger>
                <TabsTrigger value="layers">Layers ({layers.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="health" className="space-y-3">
                <ul className="rounded-xl border divide-y text-sm">
                  <li className="flex items-center gap-2.5 px-3 py-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span className="flex-1">
                      Units: {units.source === 'manual' ? 'set by you' : UNIT_PRESETS.find(p => Math.abs(p.perMeter - units.perMeter) < 1e-6)?.label.toLowerCase() ?? `1 m = ${units.perMeter.toPrecision(3)} drawing units`}
                      {units.source !== 'manual' && <span className={cn('block text-xs', units.source === 'assumed' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
                        {units.source === 'inferred' ? 'Worked out from the drawing: ' : units.source === 'assumed' ? 'Assumed: ' : ''}{units.reason}
                      </span>}
                    </span>
                  </li>
                  {[
                    [built.walls.length, 'walls'], [built.rooms.length, built.health.roomsFromWalls ? 'rooms (traced from the walls)' : 'rooms'],
                    [built.features.filter(f => f.kind === 'door').length, 'doors'],
                    [built.features.filter(f => f.kind === 'stairs').length, 'stairs'],
                    [built.features.filter(f => f.kind === 'elevator').length, 'elevators'],
                    [built.features.filter(f => f.kind === 'entrance').length, 'entrances'],
                    [built.features.filter(f => f.kind === 'tree').length, 'trees'],
                    [built.features.filter(f => f.kind === 'furniture' || f.kind === 'bench').length, 'furniture'],
                  ].filter(([n], i) => i < 2 || (n as number) > 0).map(([n, what]) => (
                    <li key={what as string} className="flex items-center gap-2.5 px-3 py-2">
                      <Check className="h-4 w-4 text-primary shrink-0" /> <span>{n} {what} detected</span>
                    </li>
                  ))}
                  {raw.health.duplicates + raw.health.tiny > 0 && (
                    <li className="flex items-center gap-2.5 px-3 py-2 text-muted-foreground">
                      <Wand2 className="h-4 w-4 shrink-0" /> Cleaned up {raw.health.duplicates} duplicate lines and {raw.health.tiny} fragments shorter than 2.5 cm
                    </li>
                  )}
                  {issues.filter(i => i.count > 0).map(i => {
                    const fixedN = i.count - i.left;
                    return (
                      <li key={i.key} className={cn('flex items-center gap-2.5 px-3 py-2 transition-colors duration-500', fixing && !fix[i.key] && 'bg-primary/5')}>
                        {fixing && !fix[i.key] ? <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                          : i.left === 0 ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0 animate-in zoom-in-50 duration-300" />
                          : <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />}
                        <span className="flex-1">
                          {i.left === 0 ? <><span className="line-through decoration-primary/60 text-muted-foreground">{i.count} {i.label}</span> <span className="font-medium text-primary">— {i.done}</span></>
                            : fixedN > 0 ? <>{fixedN} of {i.count} {i.label} {i.done} · <span className="text-amber-700 dark:text-amber-400">{i.left} need fixing in the editor</span></>
                            : <>{i.count} {i.label}</>}
                        </span>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="hidden sm:inline">{i.fixLabel}</span> <Switch checked={fix[i.key]} onCheckedChange={v => { setJustFixed(false); setFix(p => ({ ...p, [i.key]: v })); }} aria-label={i.fixLabel} />
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {issueCount > 0 && (
                  <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors duration-500',
                    leftCount === 0 ? 'border-primary/30 bg-primary/5' : 'border-amber-300/60 bg-amber-50 dark:bg-amber-950/20')}>
                    {leftCount === 0 ? (
                      <span className="flex flex-1 items-center gap-2 font-medium text-primary">
                        <Sparkles className={cn('h-4 w-4', justFixed && 'animate-bounce')} />
                        {justFixed ? `Done — all ${issueCount} problems fixed. Your map is clean.` : `All ${issueCount} problems fixed automatically.`}
                      </span>
                    ) : (
                      <span className="flex-1">
                        <b>{leftCount}</b> problem{leftCount > 1 ? 's' : ''} left{issueCount - leftCount > 0 ? ` · ${issueCount - leftCount} fixed` : ''}.
                        {!canFix && <span className="block text-xs text-muted-foreground">These can't be fixed automatically — finish them in the editor after creating the venue.</span>}
                      </span>
                    )}
                    {canFix && (
                      <Button size="sm" onClick={fixAll} disabled={fixing}>
                        {fixing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1.5" />}
                        {fixing ? 'Fixing…' : 'Fix automatically'}
                      </Button>
                    )}
                  </div>
                )}
                {built.warnings.map((w, i) => (
                  <p key={i} className="text-xs flex gap-1.5 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /> {w}</p>
                ))}
                {drawing.notes.map((n, i) => (
                  <p key={i} className="text-xs flex gap-1.5 text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {n}</p>
                ))}
              </TabsContent>

              <TabsContent value="layers">
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr><th className="text-left font-medium px-3 py-2">CAD layer</th><th className="text-left font-medium px-2 py-2">Contents</th><th className="text-left font-medium px-2 py-2">Yet New object</th><th className="text-right font-medium px-3 py-2">Confidence</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {layers.map(l => {
                        const c = l.counts;
                        const contents = [
                          c.lines + c.open && `${c.lines + c.open} lines`, c.closed && `${c.closed} shapes`, c.texts && `${c.texts} text`,
                          c.inserts && `${c.inserts} blocks`, c.circles + c.arcs && `${c.circles + c.arcs} arcs`,
                        ].filter(Boolean).join(' · ') || 'empty';
                        const changed = mapping[l.name] !== l.suggested;
                        return (
                          <tr key={l.name} className={cn(mapping[l.name] === 'ignore' && 'text-muted-foreground')}>
                            <td className="px-3 py-1.5 font-mono max-w-[160px] truncate" title={l.name}>{l.name}</td>
                            <td className="px-2 py-1.5 text-muted-foreground">{contents}{l.blocks[0] && <span className="block text-[10px]">{l.blocks.join(', ')}</span>}</td>
                            <td className="px-2 py-1.5">
                              <select value={mapping[l.name]} title={l.reason}
                                onChange={e => setMapping(p => ({ ...p, [l.name]: e.target.value as Category }))}
                                className="rounded-md border bg-background px-2 py-1 text-xs">
                                {CATEGORIES.map(cat => <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-1.5 text-right" title={l.reason}>
                              {changed ? <span className="text-primary font-medium">You set</span> : (
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="h-1.5 w-10 rounded-full bg-muted overflow-hidden"><span className={cn('block h-full', l.confidence >= 0.8 ? 'bg-primary' : l.confidence >= 0.55 ? 'bg-amber-500' : 'bg-muted-foreground/40')} style={{ width: `${l.confidence * 100}%` }} /></span>
                                  <span className="tabular-nums w-8">{Math.round(l.confidence * 100)}%</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">Hover a suggestion to see why it was chosen. Layers set to Ignore aren't imported.</p>
              </TabsContent>
            </Tabs>

            <aside className="space-y-3">
              <ImportPreview venue={built} />
              <div className="space-y-2 rounded-xl border p-3">
                {drawing.format === 'pdf' ? (
                  <label className="block text-xs">
                    <span className="text-muted-foreground">Drawing scale</span>
                    <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                      value={Math.round(PDF_POINTS_PER_METER / units.perMeter)}
                      onChange={e => setUnits({ perMeter: PDF_POINTS_PER_METER / Number(e.target.value), source: 'manual', reason: '' })}>
                      {PDF_SCALES.map(n => <option key={n} value={n}>1:{n}</option>)}
                    </select>
                  </label>
                ) : drawing.unitsPerMeter === 1 && drawing.format !== 'dxf' && drawing.format !== 'dwg' ? (
                  <p className="text-xs text-muted-foreground">Units: metres ({drawing.format.toUpperCase()})</p>
                ) : (
                  <label className="block text-xs">
                    <span className="text-muted-foreground">Drawing units</span>
                    <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                      value={UNIT_PRESETS.find(u => Math.abs(u.perMeter - units.perMeter) < 1e-6)?.perMeter ?? 'custom'}
                      onChange={e => e.target.value !== 'custom' && setUnits({ perMeter: Number(e.target.value), source: 'manual', reason: '' })}>
                      {UNIT_PRESETS.map(u => <option key={u.label} value={u.perMeter}>{u.label}</option>)}
                      <option value="custom">Custom scale…</option>
                    </select>
                    <span className="mt-2 flex items-center gap-1.5 text-muted-foreground">1 m =
                      <Input type="number" className="h-7 text-xs" value={+units.perMeter.toPrecision(5)}
                        onChange={e => Number(e.target.value) > 0 && setUnits({ perMeter: Number(e.target.value), source: 'manual', reason: '' })} />
                      units</span>
                  </label>
                )}
                <p className="text-[11px] text-muted-foreground">Plan size: {built.health.extentM.w.toFixed(1)} × {built.health.extentM.h.toFixed(1)} m</p>
                {onImportAsFloors && file && (areas.length > 1 || (drawing.levels?.length ?? 0) > 1) && (
                  <button type="button" onClick={() => { const f = file; close(false); onImportAsFloors(f); }}
                    className="w-full rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2 text-left text-xs font-medium text-primary hover:bg-primary/10">
                    This file holds {Math.max(areas.length, drawing.levels?.length ?? 0)} plans — import each as its own floor →
                  </button>
                )}
                {areas.length > 1 && (
                  <label className="block text-xs">
                    <span className="text-muted-foreground">This file has {areas.length} drawings — import</span>
                    <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={areaIdx}
                      onChange={e => switchArea(Number(e.target.value))}>
                      {areas.map((a, i) => <option key={i} value={i}>{a.label}</option>)}
                    </select>
                  </label>
                )}
                {drawing.levels && drawing.levels.length > 1 && (
                  <label className="block text-xs">
                    <span className="text-muted-foreground">Level</span>
                    <select className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={drawing.level ?? 0}
                      onChange={e => switchLevel(Number(e.target.value))}>
                      {drawing.levels.map((lv, i) => <option key={i} value={i}>{lv.name} (+{lv.elevation.toFixed(1)} m)</option>)}
                    </select>
                  </label>
                )}
              </div>
              {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">{error}</div>}
            </aside>
          </div>
        )}

        {stage === 'done' && summary && built && (
          <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
            <BuildAnimation venue={built} step={BUILD_STEPS.length} paths={paths} compact />
          <ul className="rounded-xl border divide-y text-sm">
            {[
              ['Imported from', summary.format],
              ['Walls', String(summary.walls)], ['Rooms', String(summary.rooms)],
              ['Objects', `${summary.features} (doors, stairs, trees, furniture…)`],
              ['Walkable paths', `${summary.nodes} points · ${summary.edges} connections`],
              ...(summary.health.gapsFixed || summary.health.overlapsMerged || summary.health.roomsClosed
                ? [['Fixed', `${summary.health.gapsFixed} gaps · ${summary.health.overlapsMerged} overlaps · ${summary.health.roomsClosed} rooms closed`]] : []),
            ].map(([k, v]) => (
              <li key={k} className="flex items-start gap-2.5 px-3 py-2">
                <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <span className="w-32 shrink-0 text-muted-foreground">{k}</span><span>{v}</span>
              </li>
            ))}
            {summary.warnings.map((w, i) => (
              <li key={i} className="flex gap-2.5 px-3 py-2 text-xs"><AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" /> {w}</li>
            ))}
          </ul>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {stage === 'pick' && (
            <Button onClick={() => file && analyze(file)} disabled={!file}><UploadCloud className="h-4 w-4 mr-1.5" /> Analyze</Button>
          )}
          {stage === 'review' && (
            <>
              <Button variant="outline" onClick={reset}>Choose another file</Button>
              <Button onClick={save} disabled={fixing || !built || built.walls.length === 0}>
                <Sparkles className="h-4 w-4 mr-1.5" /> Create venue
              </Button>
            </>
          )}
          {stage === 'done' && (
            <>
              <Button variant="ghost" onClick={() => close(false)}>Done</Button>
              <Button variant="outline" onClick={() => { close(false); onViewIn3D(); }}><Box className="h-4 w-4 mr-1.5" /> View in 3D</Button>
              {onStartTour && <Button onClick={() => { close(false); onStartTour(); }}><PenTool className="h-4 w-4 mr-1.5" /> Show me how to edit it</Button>}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const BUILD_STEPS = ['Laying the walls', 'Shaping the rooms', 'Placing doors, stairs and objects', 'Building walkable paths', 'Raising it into 3D'] as const;
/** How long each build step plays (ms); the paths get the most time. */
const STEP_MS = [1100, 650, 650, 1700, 1300] as const;
const PATH_COLOR = 'hsl(199 89% 48%)';

/** Draw order for the paths: outward from the entrance (or a door), like they're being walked. */
function pathWave(venue: BuiltVenue, g: PathGraphResult) {
  const n = g.nodes.length;
  const adj: number[][] = g.nodes.map(() => []);
  for (const e of g.edges) { adj[e.from].push(e.to); adj[e.to].push(e.from); }
  const start = venue.features.find(f => f.kind === 'entrance') ?? venue.features.find(f => f.kind === 'door');
  const order = g.nodes.map((_, i) => i);
  if (start) order.sort((a, b) => Math.hypot(g.nodes[a].x - start.x, g.nodes[a].y - start.y) - Math.hypot(g.nodes[b].x - start.x, g.nodes[b].y - start.y));
  const depth = new Array<number>(n).fill(-1);
  let max = 1;
  for (const s of order) {
    if (depth[s] >= 0 || !adj[s].length) continue;
    depth[s] = 0;
    const q = [s];
    for (let h = 0; h < q.length; h++) {
      for (const m of adj[q[h]]) if (depth[m] < 0) { depth[m] = depth[q[h]] + 1; max = Math.max(max, depth[m]); q.push(m); }
    }
  }
  return { depth: depth.map(d => Math.max(0, d)), max };
}

/**
 * The plan building itself, on a blueprint: walls sweep in, rooms fill,
 * objects pop in, then the real walkable paths grow out from the entrance
 * and start to flow — and finally the plan tilts up and its walls rise into
 * 3D. Paced by `step` (which part of BUILD_STEPS is under way).
 */
function BuildAnimation({ venue, step, paths, compact = false }: { venue: BuiltVenue; step: number; paths: PathGraphResult | null; compact?: boolean }) {
  const pts = [...venue.walls.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]), ...venue.rooms.flatMap(r => r.polygon)];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs, 0), minY = Math.min(...ys, 0), w = (Math.max(...xs, 1) - minX) || 1, h = (Math.max(...ys, 1) - minY) || 1;
  const pad = Math.max(w, h) * 0.06, sw = Math.max(w, h) / 260;
  const viewBox = `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;
  const objects = venue.features.filter(f => f.kind !== 'label');
  const counts = [venue.walls.length, venue.rooms.length, objects.length, paths?.edges.length ?? 0];
  const shown = (i: number) => step > i || (step === i && !compact);
  const raised = !compact && step >= 4;
  const anim = (a: string) => (compact ? undefined : a);

  // Walls sweep in diagonally across the plan.
  const wallOrder = useMemo(() => {
    const rank = venue.walls.map((s, i) => ({ i, k: (s.x1 + s.x2) / 2 - minX + ((s.y1 + s.y2) / 2 - minY) }));
    rank.sort((a, b) => a.k - b.k);
    const at = new Array<number>(venue.walls.length);
    rank.forEach((r, n) => { at[r.i] = n / Math.max(1, rank.length - 1); });
    return at;
  }, [venue.walls, minX, minY]);
  const wave = useMemo(() => (paths ? pathWave(venue, paths) : null), [venue, paths]);
  const PATH_S = 1.15; // seconds for the paths to reach the far end
  const edgeDelay = (a: number, b: number) => (wave ? (Math.min(wave.depth[a], wave.depth[b]) / wave.max) * PATH_S : 0);
  const layers = venue.walls.length > 1500 ? 4 : 10;

  const walls = (color: string, width: number, animate: boolean) => venue.walls.map((s, i) => (
    <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} pathLength={1} strokeDasharray={animate ? 1 : undefined} stroke={color} strokeWidth={width} strokeLinecap="round"
      style={animate ? { animation: anim(`build-draw .5s ease-out ${(wallOrder[i] * 0.9).toFixed(3)}s both`) } : undefined} />
  ));

  return (
    <div className={cn('space-y-4', compact && 'space-y-0')}>
      <style>{`
        @keyframes build-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
        @keyframes build-fill { from { opacity: 0 } to { opacity: 1 } }
        @keyframes build-pop { 0% { transform: scale(0); opacity: 0 } 70% { transform: scale(1.35) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes build-ring { 0% { transform: scale(.6); opacity: .9 } 100% { transform: scale(2.6); opacity: 0 } }
        @keyframes build-flow { from { stroke-dashoffset: 0 } to { stroke-dashoffset: ${-sw * 6} } }
        @keyframes build-up { from { transform: translateZ(0); opacity: 0 } }
        @keyframes build-scan { from { transform: translateX(-30%) } to { transform: translateX(330%) } }
      `}</style>
      <div className={cn('relative overflow-hidden rounded-2xl border bg-[#0b2540] dark:bg-[#071a2e]', compact ? 'aspect-square' : 'aspect-[16/9]')}>
        <div className="absolute inset-0" style={{ perspective: '1100px' }}>
          <div className="absolute inset-0" style={{
            transformStyle: 'preserve-3d', transformOrigin: '50% 55%',
            transform: raised ? 'rotateX(50deg) rotateZ(-16deg) scale(.86)' : 'none',
            transition: 'transform 1.1s cubic-bezier(.3,.7,.3,1)',
          }}>
            <svg viewBox={viewBox} className="absolute inset-0 h-full w-full">
              <defs>
                <pattern id="build-grid" width={Math.max(w, h) / 24} height={Math.max(w, h) / 24} patternUnits="userSpaceOnUse">
                  <path d={`M ${Math.max(w, h) / 24} 0 L 0 0 0 ${Math.max(w, h) / 24}`} fill="none" stroke="rgb(125 211 252 / .14)" strokeWidth={sw * 0.5} />
                </pattern>
              </defs>
              <rect x={minX - pad * 4} y={minY - pad * 4} width={w + pad * 8} height={h + pad * 8} fill="url(#build-grid)" />
              {shown(1) && venue.rooms.map((r, i) => (
                <polygon key={i} points={r.polygon.map(p => `${p.x},${p.y}`).join(' ')} fill="rgb(52 211 153 / .16)" stroke="rgb(52 211 153 / .45)" strokeWidth={sw}
                  style={{ animation: anim(`build-fill .5s ease-out ${Math.min(i * 0.05, 0.5)}s both`) }} />
              ))}
              {shown(0) && walls('#e0f2fe', sw * 1.8, true)}

              {/* The walkable paths, grown from the entrance outward, then flowing. */}
              {shown(3) && paths && paths.edges.map((e, i) => {
                const a = paths.nodes[e.from], b = paths.nodes[e.to];
                if (!a || !b) return null;
                const d = edgeDelay(e.from, e.to).toFixed(3);
                return (
                  <g key={i}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} pathLength={1} strokeDasharray={1} stroke={PATH_COLOR} strokeOpacity={0.3} strokeWidth={sw * 4.5} strokeLinecap="round"
                      style={{ animation: anim(`build-draw .35s ease-out ${d}s both`) }} />
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} pathLength={1} strokeDasharray={1} stroke="#7dd3fc" strokeWidth={sw * 1.6} strokeLinecap="round"
                      style={{ animation: anim(`build-draw .35s ease-out ${d}s both`) }} />
                    {!compact && (
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeDasharray={`${sw * 1.5} ${sw * 4.5}`} stroke="#ffffff" strokeWidth={sw * 1.1} strokeLinecap="round"
                        style={{ animation: `build-fill .2s ease-out ${(+d + 0.35).toFixed(3)}s both, build-flow 1.1s linear ${(+d + 0.35).toFixed(3)}s infinite` }} />
                    )}
                  </g>
                );
              })}
              {shown(3) && paths && paths.nodes.map((p, i) => (p.isHallway ? null : (
                <g key={i}>
                  {!compact && (
                    <circle cx={p.x} cy={p.y} r={sw * 3} fill="none" stroke="#7dd3fc" strokeWidth={sw * 0.8}
                      style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: `build-ring 1.2s ease-out ${((wave?.depth[i] ?? 0) / (wave?.max ?? 1) * PATH_S + 0.3).toFixed(3)}s both` }} />
                  )}
                  <circle cx={p.x} cy={p.y} r={sw * 2.4} fill="#38bdf8" stroke="#e0f2fe" strokeWidth={sw * 0.6}
                    style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: anim(`build-pop .4s ease-out ${((wave?.depth[i] ?? 0) / (wave?.max ?? 1) * PATH_S + 0.25).toFixed(3)}s both`) }} />
                </g>
              )))}

              {shown(2) && objects.map((o, i) => (
                <circle key={i} cx={o.x} cy={o.y} r={sw * 3.2} fill={FEATURE_COLORS[o.kind] ?? '#64748b'}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: anim(`build-pop .45s ease-out ${Math.min(i * 0.04, 0.6)}s both`) }} />
              ))}
            </svg>
            {/* Raising it into 3D: the walls stack up, layer by layer. */}
            {raised && Array.from({ length: layers }, (_, k) => (
              <svg key={k} viewBox={viewBox} className="absolute inset-0 h-full w-full pointer-events-none"
                style={{ transform: `translateZ(${((k + 1) * 34) / layers}px)`, animation: `build-up .8s cubic-bezier(.3,.7,.3,1) ${(0.3 + k * 0.05).toFixed(2)}s both` }}>
                {walls(k === layers - 1 ? '#ffffff' : 'rgb(125 211 252 / .55)', sw * (k === layers - 1 ? 2.2 : 2), false)}
              </svg>
            ))}
          </div>
        </div>
        {!compact && step < 3 && (
          <div className="pointer-events-none absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-sky-300/25 to-transparent" style={{ animation: 'build-scan 1.5s ease-in-out infinite' }} />
        )}
      </div>
      {!compact && (
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {BUILD_STEPS.map((label, i) => (
            <li key={label} className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-300',
              i < step ? 'bg-primary/10 text-foreground' : i === step ? 'bg-muted font-medium' : 'text-muted-foreground/60')}>
              {i < step ? <Check className="h-4 w-4 text-primary animate-in zoom-in-50" /> : i === step ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <span className="h-4 w-4 rounded-full border" />}
              <span className="flex-1">{label}</span>
              {i < 4 && i < step && <span className="text-xs tabular-nums text-muted-foreground">{counts[i]}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const FEATURE_COLORS: Record<string, string> = {
  door: '#d97706', window: '#38bdf8', stairs: '#e05a47', elevator: '#3b6fe0', entrance: '#16a34a',
  tree: '#22a35a', bench: '#8a6a4c', furniture: '#a1887f', landmark: '#9333ea', label: '#64748b',
};

function ImportPreview({ venue }: { venue: BuiltVenue }) {
  const pts = [...venue.walls.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]), ...venue.rooms.flatMap(r => r.polygon)];
  if (!pts.length) return <div className="aspect-[4/3] rounded-xl border bg-muted/40 flex items-center justify-center text-xs text-muted-foreground">Nothing to preview yet</div>;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX || 1, h = Math.max(...ys) - minY || 1;
  const pad = Math.max(w, h) * 0.04;
  const sw = Math.max(w, h) / 300;
  return (
    <svg viewBox={`${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`} className="w-full aspect-[4/3] rounded-xl border bg-muted/30">
      {venue.rooms.map((r, i) => <polygon key={i} points={r.polygon.map(p => `${p.x},${p.y}`).join(' ')} fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary) / 0.4)" strokeWidth={sw} />)}
      <path d={venue.walls.map(s => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`).join('')} stroke="hsl(var(--foreground))" strokeWidth={sw * 1.6} fill="none" strokeLinecap="round" />
      {venue.features.filter(f => f.kind !== 'label').map((f, i) => <circle key={i} cx={f.x} cy={f.y} r={sw * 3} fill={FEATURE_COLORS[f.kind]} />)}
    </svg>
  );
}
