// Add floors from the plans you have — all floors in one file (a sheet with
// several plans, or an IFC / 3D model with levels) or one file per floor —
// or an empty floor to draw by hand. Each floor found is reviewed (name,
// level, new floor or fill an empty one), then built and saved while the
// floors stack up into the building.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Layers, Files, FileStack, PenLine, UploadCloud, Loader2, Check, AlertTriangle, ArrowRight, X, Building2, Sparkles,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { celebrateBuild } from '@/lib/celebrate';
import { extOf } from '@/lib/cad/readFile';
import { buildPart, fillLevels, oneFloorPerFile, orderBasements, partsFromFile, type FloorPart } from '@/lib/cad/floorParts';
import { commitVenue } from '@/lib/cad/commitVenue';
import type { BuiltVenue } from '@/lib/cad/buildVenue';
import type { LayerMapping } from '@/lib/cad/types';

export interface ExistingFloor { id: string; name: string; level: number; hasMap: boolean }
type Mode = 'one' | 'many' | 'empty';
type Stage = 'choose' | 'analyzing' | 'review' | 'building' | 'done';
type Row = FloorPart & { include: boolean; level: number; target: string /* 'new' or an existing floor id */; built: BuiltVenue };
type Status = 'waiting' | 'building' | 'done' | 'error';

export default function AddFloorsDialog({ open, onOpenChange, buildingId, floors, area = { one: 'Floor', many: 'Floors' }, pxPerMeter = 40, initialFile, initialMapping, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingId: string;
  floors: ExistingFloor[];
  /** "Floor"/"Floors" for buildings, "Zone"/"Zones" for outdoor sites. */
  area?: { one: string; many: string };
  pxPerMeter?: number;
  /** Opened from the single-floor import with a file that holds several floors. */
  initialFile?: File | null;
  /** The layer mapping reviewed there (AI labels confirmed) — used for every floor of that file. */
  initialMapping?: LayerMapping;
  onDone: (created: { id: string; name: string }[]) => void | Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>('choose');
  const [mode, setMode] = useState<Mode>('one');
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [error, setError] = useState<string | null>(null);
  const [emptyName, setEmptyName] = useState('');
  const [created, setCreated] = useState<{ id: string; name: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const one = area.one.toLowerCase(), many = area.many.toLowerCase();

  const reset = () => { setStage('choose'); setFiles([]); setRows([]); setStatus({}); setError(null); setCreated([]); setEmptyName(''); };
  const close = (v: boolean) => { onOpenChange(v); if (!v) reset(); };

  // Opened with a file that holds several floors: go straight to finding them.
  const startedWith = useRef<File | null>(null);
  useEffect(() => {
    if (!open || !initialFile || startedWith.current === initialFile) return;
    startedWith.current = initialFile;
    setMode('one'); setFiles([initialFile]);
    void analyze([initialFile], 'one');
  }, [open, initialFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (list: FileList | File[] | null) => {
    const picked = [...(list ?? [])].filter(f => extOf(f.name) !== 'dgn');
    if (!picked.length) return;
    setError(null);
    setFiles(mode === 'one' ? picked.slice(0, 1) : picked);
  };

  const analyze = async (fs: File[], m: Mode) => {
    setStage('analyzing'); setError(null);
    try {
      // The reviewed mapping belongs to the file it was reviewed on.
      const perFile: { name: string; parts: FloorPart[] }[] = [];
      for (const f of fs) perFile.push({ name: f.name, parts: await partsFromFile(f, { mapping: f === initialFile ? initialMapping : undefined }) });
      // One file per floor: each file is the floor it's named after (its other drawings listed, off).
      const found = m === 'many' && fs.length > 1 ? oneFloorPerFile(perFile) : perFile.flatMap(x => x.parts);
      if (!found.length) throw new Error('No floor plans were found in that file.');
      const atLevel = (lvl: number) => floors.find(fl => fl.level === lvl);
      // Levels from the drawing's titles; the rest in order.
      // One file per floor: basements are ordered across the files (a semi-basement above them).
      const levelled = fillLevels(orderBasements(found)).sort((a, b) => Number(b.include !== false) - Number(a.include !== false) || a.level - b.level);
      const taken = new Set<string>();
      setRows(levelled.map(p => {
        const include = p.include ?? true;
        const same = atLevel(p.level);
        // The floor at the same level is filled — or replaced, when importing the building again:
        // never a second "Ground floor". (A plan that's off doesn't claim it.)
        const target = include && same && !taken.has(same.id) ? same.id : 'new';
        if (target !== 'new') taken.add(target);
        return {
          ...p, include, target,
          built: buildPart(p, pxPerMeter, p.file === initialFile?.name ? initialMapping : undefined),
        };
      }));
      setStage('review');
    } catch (err) {
      console.error('Floor import analysis failed:', err);
      setError(err instanceof Error ? err.message : 'Could not read that file.');
      setStage('choose');
    }
  };

  const update = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const chosen = rows.filter(r => r.include);

  // Levels must stay unique across the building.
  const clash = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of chosen) {
      const sameTarget = r.target !== 'new' && chosen.find(c => c !== r && c.target === r.target);
      if (sameTarget) { out[r.key] = `“${sameTarget.name}” goes into the same ${one}`; continue; }
      if (r.target !== 'new') continue;
      const existing = floors.find(fl => fl.level === r.level && !chosen.some(c => c.target === fl.id));
      const twin = chosen.find(c => c !== r && c.target === 'new' && c.level === r.level);
      if (existing) out[r.key] = `Level ${r.level} is already “${existing.name}”`;
      else if (twin) out[r.key] = `Two new ${many} at level ${r.level}`;
    }
    return out;
  }, [chosen, floors, many, one]);

  const build = async () => {
    setStage('building'); setError(null);
    const ordered = [...chosen].sort((a, b) => a.level - b.level);
    setStatus(Object.fromEntries(ordered.map(r => [r.key, 'waiting'])));
    const made: { id: string; name: string }[] = [];
    for (const r of ordered) {
      setStatus(s => ({ ...s, [r.key]: 'building' }));
      try {
        let floorId = r.target;
        if (floorId === 'new') {
          const { data, error: e } = await supabase.from('floors').insert({ building_id: buildingId, name: r.name.trim() || `${area.one} ${r.level}`, level: r.level }).select('id').single();
          if (e || !data) throw new Error(e?.message ?? 'Could not add the floor');
          floorId = data.id;
        }
        await Promise.all([
          commitVenue(supabase, buildingId, floorId, r.built, `${r.drawing.format}-import`, pxPerMeter),
          new Promise(res => setTimeout(res, 550)), // let each floor land
        ]);
        made.push({ id: floorId, name: r.name.trim() || `${area.one} ${r.level}` });
        setStatus(s => ({ ...s, [r.key]: 'done' }));
      } catch (err) {
        console.error('Adding floor failed:', err);
        setStatus(s => ({ ...s, [r.key]: 'error' }));
        setError(`${r.name}: ${err instanceof Error ? err.message : 'saving failed'}`);
      }
    }
    setCreated(made);
    if (made.length) celebrateBuild();
    setStage('done');
    await onDone(made);
  };

  const addEmpty = async () => {
    const level = floors.length ? Math.max(...floors.map(f => f.level)) + 1 : 0;
    const name = emptyName.trim() || (level === 0 ? `Ground ${one}` : `${area.one} ${level}`);
    const { data, error: e } = await supabase.from('floors').insert({ building_id: buildingId, name, level }).select('id').single();
    if (e || !data) { toast.error(e?.message ?? 'Could not add it'); return; }
    toast.success(`${name} added`);
    close(false);
    await onDone([{ id: data.id, name }]);
  };

  const stackRows = stage === 'building' || stage === 'done'
    ? [...chosen].sort((a, b) => a.level - b.level).filter(r => status[r.key] === 'done' || status[r.key] === 'building')
    : [...chosen].sort((a, b) => a.level - b.level);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={cn('max-h-[92vh] overflow-y-auto', stage === 'review' || stage === 'building' || stage === 'done' ? 'max-w-4xl' : 'max-w-2xl')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            {stage === 'done' ? `${created.length} ${created.length === 1 ? one : many} added` : stage === 'building' ? `Building your ${many}…` : stage === 'review' ? `We found ${chosen.length} ${chosen.length === 1 ? one : many}` : `Add ${many}`}
          </DialogTitle>
          <DialogDescription>
            {stage === 'review' ? `Check each ${one}'s name and level. Nothing is saved until you add them.`
              : stage === 'building' ? `Each ${one} gets its walls, rooms, doors and walkable paths, then lands on the building.`
              : stage === 'done' ? 'Directions now cross between them by stairs and lifts. Open any one in the map editor to fine-tune it.'
              : `Bring the plans you already have — however they're saved.`}
          </DialogDescription>
        </DialogHeader>

        {stage === 'choose' && (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                ['one', FileStack, `Several ${many} in one file`, `A sheet with every plan, or an IFC / 3D model with levels — we find each ${one}.`],
                ['many', Files, `One file per ${one}`, `Pick them all at once — each file becomes a ${one}.`],
                ['empty', PenLine, `An empty ${one}`, 'Start blank and draw it by hand.'],
              ] as const).map(([id, Icon, label, sub]) => (
                <button key={id} type="button" onClick={() => { setMode(id); setFiles([]); setError(null); }} aria-pressed={mode === id}
                  className={cn('rounded-2xl border p-3 text-left transition-all', mode === id ? 'border-primary bg-primary/10 shadow-sm' : 'hover:bg-muted')}>
                  <Icon className="h-5 w-5 text-primary" />
                  <span className="mt-1.5 block text-sm font-semibold">{label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{sub}</span>
                </button>
              ))}
            </div>

            {mode === 'empty' ? (
              <div className="flex gap-2">
                <Input value={emptyName} onChange={e => setEmptyName(e.target.value)} placeholder={`e.g. ${area.one} 2`} onKeyDown={e => e.key === 'Enter' && addEmpty()} aria-label={`New ${one} name`} />
                <Button onClick={addEmpty}><Check className="mr-1.5 h-4 w-4" /> Add {one}</Button>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => inputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files); }}
                  className={cn('w-full rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors', dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40')}>
                  <UploadCloud className="mx-auto mb-2 h-9 w-9 text-muted-foreground" />
                  {files.length ? (
                    <p className="text-sm font-medium">{files.map(f => f.name).join(', ')}</p>
                  ) : (
                    <p className="text-sm font-medium">{mode === 'one' ? 'Drop the file with your plans' : `Drop one file for each ${one}`}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">DWG · DXF · IFC · SVG · PDF · OBJ · GLB — {files.length ? 'click to choose again' : <span className="font-medium text-primary">or browse</span>}</p>
                </button>
                <input ref={inputRef} type="file" multiple={mode === 'many'} className="hidden" onChange={e => { pick(e.target.files); e.target.value = ''; }} />
                {mode === 'many' && files.length > 0 && (
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {files.map(f => (
                      <li key={f.name} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs">
                        <Building2 className="h-3.5 w-3.5 text-primary" /><span className="flex-1 truncate">{f.name}</span>
                        <button onClick={() => setFiles(fs => fs.filter(x => x !== f))} aria-label={`Remove ${f.name}`}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {error && <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs"><X className="h-4 w-4 shrink-0 text-destructive" /> {error}</div>}
          </div>
        )}

        {stage === 'analyzing' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <FloorStack rows={[]} pending={Math.max(files.length, 2)} />
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Reading {files.length > 1 ? `${files.length} files` : files[0]?.name} and finding each {one}…</p>
          </div>
        )}

        {(stage === 'review' || stage === 'building' || stage === 'done') && (
          <div className="grid gap-4 md:grid-cols-[1fr_240px]">
            <ul className="space-y-2">
              {rows.map((r, i) => {
                const st = status[r.key];
                const firstOff = stage === 'review' && !r.include && (i === 0 || rows[i - 1].include);
                const locked = stage !== 'review';
                return (<Fragment key={r.key}>
                  {firstOff && <li className="pt-2 text-xs font-medium text-muted-foreground">Also on the sheet — not added (tick to add)</li>}
                  <li className={cn('flex gap-3 rounded-2xl border p-2.5 transition-all', !r.include && 'opacity-50', st === 'building' && 'border-primary/50 bg-primary/5', st === 'done' && 'border-primary/30')}>
                    <PlanThumb venue={r.built} />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Input value={r.name} disabled={locked} onChange={e => update(r.key, { name: e.target.value })} className="h-8 text-sm font-medium" aria-label={`${area.one} name`} />
                        <label className="flex items-center gap-1 text-xs text-muted-foreground">Level
                          <Input type="number" value={r.level} disabled={locked} onChange={e => update(r.key, { level: Math.round(Number(e.target.value)) })} className="h-8 w-16 text-sm" aria-label={`${area.one} level`} />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{r.file} · {r.origin}{r.note ? ` · ${r.note}` : ''}</span>
                        <span>· {r.built.walls.length} walls · {r.built.rooms.length} rooms · {r.built.features.filter(f => f.kind === 'door').length} doors</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={r.target} disabled={locked} onChange={e => update(r.key, { target: e.target.value })} className="h-7 rounded-md border bg-background px-2 text-xs" aria-label={`Where ${r.name} goes`}>
                          <option value="new">New {one}</option>
                          {floors.map(fl => <option key={fl.id} value={fl.id}>{fl.hasMap ? 'Replaces' : 'Goes into'} “{fl.name}”</option>)}
                        </select>
                        {!locked && r.target !== 'new' && floors.find(fl => fl.id === r.target)?.hasMap && <span className="text-[11px] text-amber-700 dark:text-amber-400">its current map is replaced</span>}
                        {!locked && clash[r.key] && r.include && <span className="flex items-center gap-1 text-[11px] text-destructive"><AlertTriangle className="h-3 w-3" /> {clash[r.key]}</span>}
                        {!locked && r.built.health.unitsSuspect && <span className="flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle className="h-3 w-3" /> check the units in the single-{one} import</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end justify-between">
                      {stage === 'review' ? (
                        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={r.include} onChange={e => update(r.key, { include: e.target.checked })} className="accent-[hsl(var(--primary))]" /> Add</label>
                      ) : st === 'done' ? <Check className="h-5 w-5 text-primary animate-in zoom-in-50" />
                        : st === 'building' ? <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        : st === 'error' ? <AlertTriangle className="h-5 w-5 text-destructive" />
                        : r.include ? <span className="h-5 w-5 rounded-full border" /> : null}
                    </div>
                  </li>
                </Fragment>);
              })}
              {error && <li className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">{error}</li>}
            </ul>
            <aside className="space-y-2">
              <div className="rounded-2xl border bg-gradient-to-b from-sky-50 to-emerald-50 p-2 dark:from-slate-900 dark:to-emerald-950/30">
                <FloorStack rows={stackRows} pending={stage === 'building' ? chosen.length - stackRows.length : 0} />
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                {stage === 'review' ? `Your building — ${chosen.length} ${chosen.length === 1 ? one : many}, stacked by level` : stage === 'building' ? `${Object.values(status).filter(s => s === 'done').length} of ${chosen.length} built` : 'All in place'}
              </p>
            </aside>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {stage === 'choose' && mode !== 'empty' && (
            <Button onClick={() => analyze(files, mode)} disabled={!files.length}><Sparkles className="mr-1.5 h-4 w-4" /> Find the {many}</Button>
          )}
          {stage === 'review' && (
            <>
              <Button variant="outline" onClick={reset}>Start over</Button>
              <Button onClick={build} disabled={!chosen.length || Object.keys(clash).some(k => chosen.some(c => c.key === k))}>
                <Layers className="mr-1.5 h-4 w-4" /> Add {chosen.length} {chosen.length === 1 ? one : many}
              </Button>
            </>
          )}
          {stage === 'done' && <Button onClick={() => close(false)}>Done <ArrowRight className="ml-1.5 h-4 w-4" /></Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A plan's walls and rooms, small. */
function PlanThumb({ venue }: { venue: BuiltVenue }) {
  const pts = venue.walls.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]);
  if (!pts.length) return <div className="grid h-16 w-20 shrink-0 place-items-center rounded-xl bg-muted text-[10px] text-muted-foreground">no walls</div>;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX || 1, h = Math.max(...ys) - minY || 1;
  const pad = Math.max(w, h) * 0.06, sw = Math.max(w, h) / 70;
  return (
    <svg viewBox={`${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`} className="h-16 w-20 shrink-0 rounded-xl border bg-muted/30">
      {venue.rooms.map((r, i) => <polygon key={i} points={r.polygon.map(p => `${p.x},${p.y}`).join(' ')} fill="hsl(var(--primary) / 0.12)" />)}
      <path d={venue.walls.map(s => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`).join('')} stroke="hsl(var(--foreground))" strokeWidth={sw} fill="none" strokeLinecap="round" />
    </svg>
  );
}

const SLAB_COLORS = ['#0f5e3a', '#16a34a', '#0ea5e9', '#6366f1', '#f59e0b', '#db2777'];

/**
 * The building as a stack of floors: each floor a slab with its plan drawn
 * on top, in isometric, stacked by level. New floors drop onto the stack.
 */
function FloorStack({ rows, pending }: { rows: { key: string; level: number; built: BuiltVenue; name: string }[]; pending: number }) {
  const W = 180, GAP = 26;
  const total = rows.length + pending;
  const H = 120 + Math.max(total - 1, 0) * GAP;
  // Plan coordinates → a unit square → isometric.
  const iso = (u: number, v: number) => ({ x: W / 2 + (u - v) * 70, y: (u + v) * 35 });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[220px]">
      <style>{`
        @keyframes fs-drop { from { transform: translateY(-36px); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes fs-pulse { 0%,100% { opacity: .35 } 50% { opacity: .75 } }
      `}</style>
      {[...Array(total)].map((_, i) => {
        const row = rows[i];
        const top = H - 86 - i * GAP;
        const color = SLAB_COLORS[i % SLAB_COLORS.length];
        const slab = [iso(0, 0), iso(1, 0), iso(1, 1), iso(0, 1)];
        const pts = row ? row.built.walls.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]) : [];
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        const minX = Math.min(...xs, 0), minY = Math.min(...ys, 0), span = Math.max(Math.max(...xs, 1) - minX, Math.max(...ys, 1) - minY) || 1;
        const n = (x: number, y: number) => iso(0.08 + ((x - minX) / span) * 0.84, 0.08 + ((y - minY) / span) * 0.84);
        return (
          <g key={row?.key ?? `p${i}`} transform={`translate(0 ${top})`}>
            <g style={row ? { animation: 'fs-drop .5s cubic-bezier(.3,.8,.3,1.2) both' } : { animation: 'fs-pulse 1.2s ease-in-out infinite' }}>
              {/* slab thickness */}
              <path d={`M${slab[3].x} ${slab[3].y} L${slab[2].x} ${slab[2].y} L${slab[2].x} ${slab[2].y + 6} L${slab[3].x} ${slab[3].y + 6} Z`} fill={row ? color : '#cbd5e1'} opacity={0.85} />
              <path d={`M${slab[2].x} ${slab[2].y} L${slab[1].x} ${slab[1].y} L${slab[1].x} ${slab[1].y + 6} L${slab[2].x} ${slab[2].y + 6} Z`} fill={row ? color : '#cbd5e1'} opacity={0.6} />
              {/* top with the plan */}
              <path d={`M${slab.map(p => `${p.x} ${p.y}`).join(' L')} Z`} fill={row ? 'white' : '#e2e8f0'} stroke={row ? color : '#cbd5e1'} strokeWidth={1.2} />
              {row && <path d={row.built.walls.map(w => { const a = n(w.x1, w.y1), b = n(w.x2, w.y2); return `M${a.x} ${a.y}L${b.x} ${b.y}`; }).join('')} stroke="#1f2937" strokeWidth={0.9} fill="none" strokeLinecap="round" />}
              {row && <text x={iso(1, 0).x + 4} y={iso(1, 0).y + 4} fontSize={8} className="fill-muted-foreground font-semibold">{row.level}</text>}
            </g>
          </g>
        );
      })}
    </svg>
  );
}
