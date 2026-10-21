// "Review layers": the AI's suggestion for every CAD layer, for the admin to
// confirm before the venue is created. Rows are listed least confident first;
// flagged rows are highlighted. Layers can be confirmed one by one, by label
// group (with a count and examples), or all at once ("bulk", recorded as
// such). ignore / walkable / unknown always need their own confirmation.
// The rules live in lib/cad/layerLabels/review.ts.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, Check, CheckCheck, Info, Loader2, RotateCcw, Search, ShieldCheck, Sparkles, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

import { LAYER_LABELS, LAYER_LABEL_NAMES, type LayerLabel } from '@/lib/cad/layerLabels/labels';
import {
  alwaysConfirm, blocking, bulkCount, bulkLeftOut, canConfirm, confirmBulk, confirmGroup, confirmRow, groups, matches, setLabel, unconfirmRow,
  type ConfirmedVia, type ReviewRow,
} from '@/lib/cad/layerLabels/review';
import type { LayerLabeling } from '@/lib/cad/layerLabels/useLayerLabeling';
import { TRAINING_NOTICE, loadConsent, recordConsent, type ConsentState } from '@/lib/cad/layerLabels/consent';

const VIA: Record<ConfirmedVia, string> = { individual: 'Confirmed', group: 'Confirmed (group)', bulk: 'Confirmed (all)' };

function contents(r: ReviewRow) {
  const counts = Object.entries(r.summary.entity_counts).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(' · ');
  return counts || 'empty';
}

function Confidence({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[11px] text-muted-foreground">no score</span>;
  return (
    <span className="inline-flex items-center gap-1.5" title="How sure the model was of its own suggestion">
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full', value >= 0.8 ? 'bg-primary' : value >= 0.55 ? 'bg-amber-500' : 'bg-destructive/70')} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="w-8 tabular-nums text-[11px]">{Math.round(value * 100)}%</span>
    </span>
  );
}

export default function LayerReviewPanel({ labeling, buildingId }: { labeling: LayerLabeling; buildingId: string }) {
  const { phase, job, error, result, policy, rows, setRows } = labeling;
  const [query, setQuery] = useState('');
  // The layer list is for those who want it: by default one summary and one button.
  const [details, setDetails] = useState(false);
  const found = useMemo(() => summarise(rows), [rows]);
  const shown = useMemo(() => rows.filter(r => matches(r, query)), [rows, query]);
  const left = useMemo(() => blocking(rows, policy), [rows, policy]);
  const labelGroups = useMemo(() => groups(rows, policy), [rows, policy]);
  const forBulk = bulkCount(rows, policy);
  const leftOut = bulkLeftOut(rows);
  const confirmed = rows.filter(r => r.confirmedVia).length;

  if (phase === 'starting' || phase === 'queued' || phase === 'running') {
    const total = job?.total ?? 0;
    return (
      <div className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {phase === 'starting' ? 'Sending the drawing to the layer labeler…'
            : phase === 'queued' ? `Waiting for the labeler${job?.queue_position ? ` — ${job.queue_position} ahead of you` : ''}…`
            : total ? `Labeling layers — ${job?.done ?? 0} of ${total}` : 'Reading the drawing…'}
        </div>
        <Progress value={total ? ((job?.done ?? 0) / total) * 100 : 0} className="h-1.5" />
        <p className="text-xs text-muted-foreground">
          This runs on a local model and can take a few minutes for large drawings. You can keep checking the health tab meanwhile.
        </p>
        <Button variant="ghost" size="sm" onClick={labeling.skip}>Skip — use the quick suggestions instead</Button>
      </div>
    );
  }

  if (phase === 'unavailable' || phase === 'failed') {
    return (
      <div className="space-y-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
        <p className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>{phase === 'unavailable' ? 'AI layer labeling is unavailable.' : 'AI layer labeling failed.'} <span className="block text-xs text-muted-foreground">{error}</span></span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={labeling.retry}><RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Try again</Button>
          <Button size="sm" variant="ghost" onClick={labeling.skip}>Continue with the quick suggestions</Button>
        </div>
      </div>
    );
  }

  if (phase !== 'done' || !result) return null;

  if (rows.length === 0) {
    return <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">This drawing has no layers to review.</div>;
  }

  const shape = result.drawing;
  return (
    <div className="space-y-3">
      {shape?.single_layer && (
        <div role="note" className="flex gap-2 rounded-xl border border-sky-300/60 bg-sky-50 px-3 py-2.5 text-sm dark:bg-sky-950/20">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <span>
            {shape.layers_used === 1 ? 'Everything in this drawing is on one layer' : 'Almost everything in this drawing is on one layer'}
            {shape.largest_layer ? <> (<span className="font-mono">{shape.largest_layer}</span>)</> : null}, so these labels can&apos;t tell
            walls from doors or furniture. That&apos;s normal for drawings downloaded from the web or exported from other apps.
            <span className="block text-xs text-muted-foreground">
              Label that layer as what most of it is (usually walls), create the venue, then fix the rest in the editor — or ask
              whoever made the drawing for the original file with its layers.
            </span>
          </span>
        </div>
      )}
      <div className={cn('space-y-2.5 rounded-xl border p-3 text-sm', left.length === 0 ? 'border-primary/30 bg-primary/5' : 'bg-card')}>
        {left.length === 0
          ? <p className="flex items-center gap-2 font-medium text-primary"><CheckCheck className="h-4 w-4" /> Layers confirmed — you can create the map.</p>
          : <p className="font-medium">We sorted your drawing&apos;s layers</p>}
        <p className="text-xs leading-relaxed">
          <span className="text-muted-foreground">Found: </span>
          {found.kept.length ? found.kept.map(([label, n], i) => (
            <span key={label}>{i > 0 && ' · '}<b>{LAYER_LABEL_NAMES[label]}</b> ({n})</span>
          )) : 'nothing to draw yet'}
          {found.leftOut > 0 && <span className="block text-muted-foreground">{found.leftOut} layer{found.leftOut === 1 ? '' : 's'} left out — notes, dimensions, elevations and other things that aren&apos;t part of the floor map.</span>}
        </p>
        {found.unsure > 0 && left.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {found.unsure} layer{found.unsure === 1 ? '' : 's'} we weren&apos;t sure about {found.unsure === 1 ? 'is' : 'are'} marked in “Check layers one by one” — or just check the preview.
          </p>
        )}
        {forBulk > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setRows(rs => confirmBulk(rs, policy))}
              title="Confirms every remaining layer in one click. Recorded as a bulk confirmation, which is never used to train the model.">
              <CheckCheck className="mr-1.5 h-4 w-4" /> Looks right
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Does the preview look like your building?{leftOut > 0 ? ` ${leftOut} layer${leftOut === 1 ? '' : 's'} nobody could identify will be left out.` : ''}
            </span>
          </div>
        )}
        <button type="button" onClick={() => setDetails(d => !d)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {details ? 'Hide the layer list' : left.length === 0 ? 'Change a layer' : 'Check layers one by one'}
        </button>
      </div>

      {details && (<>
      <div className="flex flex-wrap gap-1.5">
        {labelGroups.map(g => (
          <div key={g.label} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs', !g.groupable && 'border-dashed')}>
            <span>
              <span className="font-medium">{LAYER_LABEL_NAMES[g.label]}</span> · {g.count} layer{g.count === 1 ? '' : 's'}
              {g.groupable && g.pending > 0 && <span className="block max-w-[220px] truncate text-[10px] text-muted-foreground" title={g.samples.join(', ')}>e.g. {g.samples.join(', ')}</span>}
              {!g.groupable && <span className="block text-[10px] text-muted-foreground">confirm one by one</span>}
            </span>
            {g.groupable && g.pending > 0 && (
              <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => setRows(rs => confirmGroup(rs, g.label, policy))}>
                Confirm {g.pending}
              </Button>
            )}
          </div>
        ))}
      </div>

      {rows.length > 8 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search layers, labels, blocks or text" className="h-8 pl-8 text-xs" />
        </div>
      )}

      <div className="max-h-[46vh] overflow-auto rounded-xl border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/90 text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 text-left font-medium">CAD layer</th>
              <th className="px-2 py-2 text-left font-medium">AI suggestion</th>
              <th className="px-2 py-2 text-left font-medium">Label</th>
              <th className="px-3 py-2 text-right font-medium">Confirmation</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map(r => {
              const own = alwaysConfirm(r.label, policy);
              const open = left.some(b => b.name === r.name);
              return (
                <tr key={r.name} className={cn(r.flagged && !r.confirmedVia && 'bg-amber-50/70 dark:bg-amber-950/20')}>
                  <td className="max-w-[200px] px-3 py-1.5">
                    <span className="block truncate font-mono" title={r.name}>{r.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground" title={[contents(r), ...r.summary.blocks, ...r.summary.texts].join(' · ')}>
                      {contents(r)}{r.summary.blocks[0] ? ` · ${r.summary.blocks.slice(0, 2).join(', ')}` : ''}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="block">{LAYER_LABEL_NAMES[r.aiLabel]}</span>
                    {r.source === 'model' ? <Confidence value={r.confidence} />
                      : <span className="block text-[10px] text-muted-foreground">{r.source === 'rules' ? 'by the layer name' : 'empty layer'}</span>}
                    {r.ruleLabel && (
                      <span className="mt-0.5 block text-[10px] text-amber-700 dark:text-amber-400" title={r.ruleReason}>
                        Rules say: {LAYER_LABEL_NAMES[r.ruleLabel]}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={r.label} aria-label={`Label for ${r.name}`}
                      onChange={e => setRows(rs => setLabel(rs, r.name, e.target.value as LayerLabel))}
                      className={cn('rounded-md border bg-background px-2 py-1 text-xs', r.label === 'unknown' && 'border-destructive text-destructive')}>
                      {LAYER_LABELS.map(l => <option key={l} value={l}>{LAYER_LABEL_NAMES[l]}</option>)}
                    </select>
                    {own && !r.confirmedVia && r.label !== 'unknown' && <span className="mt-0.5 block text-[10px] text-amber-700 dark:text-amber-400">needs its own check</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {r.confirmedVia ? (
                      <span className="inline-flex items-center gap-1.5 text-primary">
                        <Check className="h-3.5 w-3.5" /> {VIA[r.confirmedVia]}
                        <button type="button" title="Undo" aria-label={`Undo confirmation of ${r.name}`} onClick={() => setRows(rs => unconfirmRow(rs, r.name))}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted"><Undo2 className="h-3 w-3" /></button>
                      </span>
                    ) : canConfirm(r) ? (
                      <Button size="sm" variant={open ? 'default' : 'outline'} className="h-6 px-2 text-[11px]" onClick={() => setRows(rs => confirmRow(rs, r.name))}>
                        Confirm
                      </Button>
                    ) : (
                      <span className="text-[11px] text-destructive">Choose a label</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No layers match “{query}”.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {confirmed} of {rows.length} confirmed · Walkable is kept as a hint only — walkable paths are always built from the geometry.
      </p>
      </>)}

      <TrainingConsent buildingId={buildingId} />
    </div>
  );
}

/** What the layers become, in plain words: kinds with their layer counts, and how many are left out. */
function summarise(rows: ReviewRow[]) {
  const has = (r: ReviewRow) => (r.summary.total ?? Object.values(r.summary.entity_counts).reduce((a, b) => a + b, 0)) > 0;
  const content = rows.filter(has);
  const out = new Set<LayerLabel>(['ignore', 'dimension', 'unknown']);
  const counts = new Map<LayerLabel, number>();
  for (const r of content) if (!out.has(r.label)) counts.set(r.label, (counts.get(r.label) ?? 0) + 1);
  const order = LAYER_LABELS as readonly LayerLabel[];
  return {
    kept: [...counts.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])),
    leftOut: content.filter(r => out.has(r.label)).length,
    unsure: rows.filter(r => r.ruleLabel && !r.confirmedVia).length,
  };
}

/** The training notice: the venue's current decision; owners can change it. */
function TrainingConsent({ buildingId }: { buildingId: string }) {
  const [state, setState] = useState<ConsentState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadConsent(supabase, buildingId).then(s => { if (live) { setState(s); setOpen(s.canDecide && s.accepted === null); } });
    return () => { live = false; };
  }, [buildingId]);

  if (!state || state.unavailable) return null;

  const decide = async (accepted: boolean) => {
    setBusy(true); setError(null);
    try {
      await recordConsent(supabase, buildingId, accepted);
      setState(await loadConsent(supabase, buildingId));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your choice.');
    } finally {
      setBusy(false);
    }
  };

  const status = state.accepted === true ? 'Allowed' : state.accepted === false ? 'Not allowed' : 'Not decided (not used)';
  return (
    <div className="rounded-xl border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1"><span className="font-medium">{TRAINING_NOTICE.title}</span> · this venue: <b>{status}</b>
          {!state.canDecide && <span className="block text-muted-foreground">Only your institution's owner can change this.</span>}
        </span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Read more'}</Button>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 text-muted-foreground">
          {TRAINING_NOTICE.body.map(p => <p key={p}>{p}</p>)}
          {state.canDecide && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" disabled={busy || state.accepted === true} onClick={() => decide(true)}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />} Allow
              </Button>
              <Button size="sm" variant="outline" disabled={busy || state.accepted === false} onClick={() => decide(false)}>
                <X className="mr-1.5 h-3.5 w-3.5" /> {state.accepted ? 'Withdraw permission' : "Don't allow"}
              </Button>
            </div>
          )}
          {error && <p className="text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
