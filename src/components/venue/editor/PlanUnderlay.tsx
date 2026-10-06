// The floor plan underlay in the editor: upload a plan (image or the first
// page of a PDF), see it under the drawing, fade it, move it, lock it, and
// calibrate it — click two points whose real distance you know, type the
// metres, and the plan snaps to scale (and straight, if you say the line
// runs left–right or up–down). Every change is undoable.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ImageUp, Lock, LockOpen, Move, Ruler, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { calibrate, imageSize, initialPlacement, parseUnderlay, pdfPageToPng, type Align, type Pt, type Underlay } from './underlay';

type Mode = 'idle' | 'pick-a' | 'pick-b' | 'confirm' | 'move';

interface History { push: (c: { label: string; undo: () => Promise<void> | void; redo: () => Promise<void> | void }) => void }

const MIGRATION_HINT = 'Run the floor plan underlay migration (20261006100000) to keep plans under your drawing.';

export function useUnderlay(buildingId: string | undefined, floorId: string | undefined, history: History, content: () => { minX: number; minY: number; maxX: number; maxY: number } | null) {
  const [u, setU] = useState<Underlay | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [marks, setMarks] = useState<Pt[]>([]);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ from: Pt; start: Underlay } | null>(null);

  // Load this floor's underlay (and a signed link to the private file).
  useEffect(() => {
    let live = true;
    setU(null); setUrl(null); setMode('idle'); setMarks([]);
    if (!floorId) return;
    (async () => {
      const { data, error } = await supabase.from('floors').select('*').eq('id', floorId).maybeSingle();
      if (!live || error || !data) return;
      const parsed = parseUnderlay((data as { plan_underlay?: unknown }).plan_underlay);
      setU(parsed);
      if (parsed) {
        const signed = await supabase.storage.from('floor-plans').createSignedUrl(parsed.path, 60 * 60 * 6);
        if (live) setUrl(signed.data?.signedUrl ?? null);
      }
    })();
    return () => { live = false; };
  }, [floorId]);

  const write = useCallback(async (next: Underlay | null) => {
    const { error } = await supabase.from('floors').update({ plan_underlay: next as unknown as Json }).eq('id', floorId!);
    if (error) throw new Error(/plan_underlay/.test(error.message) ? MIGRATION_HINT : error.message);
    setU(next);
  }, [floorId]);

  /** Save a change with undo. */
  const change = useCallback(async (next: Underlay | null, label: string) => {
    const before = u;
    try {
      await write(next);
      history.push({ label, undo: () => write(before), redo: () => write(next) });
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save the plan'); }
  }, [u, write, history]);

  const upload = useCallback(async (file: File) => {
    if (!buildingId || !floorId) return;
    setBusy(true);
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const img = isPdf ? await pdfPageToPng(file) : { blob: file as Blob, ...(await imageSize(file)) };
      const ext = isPdf ? 'png' : (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${buildingId}/${floorId}/plan-${Date.now()}.${ext}`;
      const up = await supabase.storage.from('floor-plans').upload(path, img.blob, { contentType: isPdf ? 'image/png' : file.type || 'image/png', upsert: false });
      if (up.error) throw new Error(/bucket/i.test(up.error.message) ? MIGRATION_HINT : up.error.message);
      const signed = await supabase.storage.from('floor-plans').createSignedUrl(path, 60 * 60 * 6);
      setUrl(signed.data?.signedUrl ?? null);
      const place = initialPlacement(img.width, img.height, content());
      await change({ path, width: img.width, height: img.height, ...place, opacity: 0.5, visible: true, locked: false }, 'Add floor plan');
      setMode('pick-a');
      setMarks([]);
      toast.success('Plan added — click two points you know the distance between to set its scale');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the plan');
    } finally { setBusy(false); }
  }, [buildingId, floorId, change, content]);

  /** A click on the drawing while calibrating or moving. */
  const pick = useCallback((p: Pt) => {
    if (mode === 'pick-a') { setMarks([p]); setMode('pick-b'); }
    else if (mode === 'pick-b') { setMarks(m => [m[0], p]); setMode('confirm'); }
  }, [mode]);

  const apply = useCallback(async (metres: number, align: Align) => {
    if (!u || marks.length < 2) return;
    await change({ ...u, ...calibrate(u, marks[0], marks[1], metres, align) }, 'Calibrate plan');
    setMode('idle'); setMarks([]);
  }, [u, marks, change]);

  const dragStart = useCallback((p: Pt) => { if (u && mode === 'move') drag.current = { from: p, start: u }; }, [u, mode]);
  const dragMove = useCallback((p: Pt) => {
    const d = drag.current;
    if (!d) return;
    setU({ ...d.start, x: d.start.x + p.x - d.from.x, y: d.start.y + p.y - d.from.y });
  }, []);
  const dragEnd = useCallback(async () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !u) return;
    const next = u, before = d.start;
    try { await write(next); history.push({ label: 'Move plan', undo: () => write(before), redo: () => write(next) }); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not move the plan'); }
  }, [u, write, history]);

  return { u, url, mode, setMode, marks, setMarks, busy, upload, change, pick, apply, dragStart, dragMove, dragEnd };
}

export type UnderlayState = ReturnType<typeof useUnderlay>;

/** The plan image, drawn under everything in the editor's SVG. */
export function UnderlayImage({ s, k }: { s: UnderlayState; k: number }) {
  const { u, url, marks } = s;
  if (!u || !url || !u.visible) return null;
  return (
    <g pointerEvents="none">
      <g transform={`translate(${u.x} ${u.y}) rotate(${u.rotationDeg}) scale(${u.scale})`}>
        <image href={url} x={0} y={0} width={u.width} height={u.height} opacity={u.opacity} preserveAspectRatio="none" style={{ imageRendering: 'auto' }} />
      </g>
      {marks.map((m, i) => (
        <g key={i} transform={`translate(${m.x} ${m.y})`}>
          <circle r={7 * k} fill="#0f3d26" stroke="#fff" strokeWidth={2 * k} />
          <text y={3.5 * k} textAnchor="middle" fontSize={9 * k} fontWeight={700} fill="#fff">{i ? 'B' : 'A'}</text>
        </g>
      ))}
      {marks.length === 2 && <line x1={marks[0].x} y1={marks[0].y} x2={marks[1].x} y2={marks[1].y} stroke="#0f3d26" strokeWidth={2 * k} strokeDasharray={`${6 * k} ${4 * k}`} />}
    </g>
  );
}

/** Catches clicks and drags on the drawing while picking calibration points or moving the plan. */
export function UnderlayOverlay({ s, toEditor }: { s: UnderlayState; toEditor: (clientX: number, clientY: number) => Pt }) {
  const { mode } = s;
  if (mode !== 'pick-a' && mode !== 'pick-b' && mode !== 'move') return null;
  return (
    <div className={cn('absolute inset-0 z-20', mode === 'move' ? 'cursor-move' : 'cursor-crosshair')}
      onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); const p = toEditor(e.clientX, e.clientY); if (mode === 'move') s.dragStart(p); else s.pick(p); }}
      onPointerMove={e => { if (mode === 'move') s.dragMove(toEditor(e.clientX, e.clientY)); }}
      onPointerUp={() => { if (mode === 'move') s.dragEnd(); }}>
      <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-ink/[.92] px-3.5 py-1.5 font-inter text-xs font-semibold text-white shadow">
        {mode === 'pick-a' ? 'Click the first point you know (A)' : mode === 'pick-b' ? 'Now click the second point (B)' : 'Drag to move the plan · Esc when done'}
      </div>
    </div>
  );
}

/** The left-panel section: add, show, fade, lock, move, calibrate, remove. */
export function UnderlayPanel({ s, sectionTitle }: { s: UnderlayState; sectionTitle: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [metres, setMetres] = useState('');
  const [align, setAlign] = useState<Align>('horizontal');
  const { u } = s;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && s.mode !== 'idle') { s.setMode('idle'); s.setMarks([]); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [s]);
  const len = s.marks.length === 2 ? Math.hypot(s.marks[1].x - s.marks[0].x, s.marks[1].y - s.marks[0].y) / 40 : 0;

  return (
    <section className="p-3 border-b" data-tour="editor-underlay">
      <h4 className={cn(sectionTitle, 'mb-2')}>Floor plan underlay</h4>
      <input ref={file} type="file" accept="image/*,.pdf,application/pdf" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) s.upload(f); e.target.value = ''; }} />
      {!u ? (
        <>
          <p className="mb-2 text-[11px] text-muted-foreground">Trace over a scan or PDF page of the plan: walls, doors, rooms and stairs line up with the real building.</p>
          <Button size="sm" variant="outline" className="w-full" disabled={s.busy} onClick={() => file.current?.click()}>
            {s.busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageUp className="mr-1.5 h-3.5 w-3.5" />} Add a plan (image or PDF)
          </Button>
        </>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={u.visible ? 'Hide plan' : 'Show plan'} onClick={() => s.change({ ...u, visible: !u.visible }, u.visible ? 'Hide plan' : 'Show plan')}>
              {u.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </Button>
            <input type="range" min={0.1} max={1} step={0.05} defaultValue={u.opacity} key={`op-${u.opacity}`} aria-label="Plan opacity" className="min-w-0 flex-1 accent-[#0f3d26]"
              onPointerUp={e => s.change({ ...u, opacity: Number((e.target as HTMLInputElement).value) }, 'Fade plan')}
              onKeyUp={e => s.change({ ...u, opacity: Number((e.target as HTMLInputElement).value) }, 'Fade plan')} />
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={u.locked ? 'Unlock plan' : 'Lock plan'} onClick={() => s.change({ ...u, locked: !u.locked }, u.locked ? 'Unlock plan' : 'Lock plan')}>
              {u.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" variant={s.mode === 'pick-a' || s.mode === 'pick-b' || s.mode === 'confirm' ? 'default' : 'outline'} disabled={u.locked}
              onClick={() => { s.setMarks([]); s.setMode(s.mode === 'idle' || s.mode === 'move' ? 'pick-a' : 'idle'); }}>
              <Ruler className="mr-1.5 h-3.5 w-3.5" /> Set scale
            </Button>
            <Button size="sm" variant={s.mode === 'move' ? 'default' : 'outline'} disabled={u.locked} onClick={() => s.setMode(s.mode === 'move' ? 'idle' : 'move')}>
              <Move className="mr-1.5 h-3.5 w-3.5" /> Move
            </Button>
          </div>
          {s.mode === 'confirm' && (
            <form className="space-y-2 rounded-lg border bg-muted/40 p-2.5" onSubmit={e => { e.preventDefault(); const m = Number(metres.replace(',', '.')); if (m > 0) { s.apply(m, align); setMetres(''); } }}>
              <label className="block text-[11px] text-muted-foreground">Real distance from A to B (metres)
                <Input autoFocus inputMode="decimal" className="mt-1 h-8 text-xs" placeholder={`now ${len.toFixed(2)} m`} value={metres} onChange={e => setMetres(e.target.value)} />
              </label>
              <label className="block text-[11px] text-muted-foreground">The line A–B runs
                <select value={align} onChange={e => setAlign(e.target.value as Align)} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs text-foreground">
                  <option value="horizontal">Left to right (straighten the plan)</option>
                  <option value="vertical">Top to bottom (straighten the plan)</option>
                  <option value="as-drawn">As it is (scale only)</option>
                </select>
              </label>
              <div className="flex gap-1.5">
                <Button size="sm" type="submit" className="flex-1" disabled={!(Number(metres.replace(',', '.')) > 0)}>Apply</Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => { s.setMode('idle'); s.setMarks([]); }}>Cancel</Button>
              </div>
            </form>
          )}
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {((u.width * u.scale) / 40).toFixed(1)} × {((u.height * u.scale) / 40).toFixed(1)} m · {u.rotationDeg.toFixed(1)}°
          </p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" disabled={s.busy} onClick={() => file.current?.click()}>Replace</Button>
            <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs text-destructive hover:text-destructive" onClick={() => s.change(null, 'Remove plan')}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
