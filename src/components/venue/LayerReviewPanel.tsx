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
import { AlertTriangle, Check, CheckCheck, ChevronDown, Info, Loader2, RotateCcw, Search, ShieldCheck, Sparkles, Undo2, X } from 'lucide-react';
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

/** Each label's colour, so a layer's kind reads at a glance (as on the map). */
const LABEL_DOT: Record<LayerLabel, string> = {
  wall: 'bg-slate-700 dark:bg-slate-300', door: 'bg-amber-500', window: 'bg-sky-400', stairs: 'bg-rose-500', elevator: 'bg-blue-600',
  restroom: 'bg-teal-500', room: 'bg-emerald-500', walkable: 'bg-lime-500', vegetation: 'bg-green-600', furniture: 'bg-orange-800/80 dark:bg-orange-400/80',
  text: 'bg-violet-500', dimension: 'bg-zinc-400', ignore: 'bg-muted-foreground/30', unknown: 'bg-destructive',
};
const Dot = ({ label, className }: { label: LayerLabel; className?: string }) => <span className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', LABEL_DOT[label], className)} />;

type Tab = 'todo' | 'all' | 'done';

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
  const [tab, setTab] = useState<Tab>('todo');
  const [closed, setClosed] = useState<Set<LayerLabel>>(new Set());
  // The layer list is for those who want it: by default one summary and one button.
  const [details, setDetails] = useState(false);
  const found = useMemo(() => summarise(rows), [rows]);
  const left = useMemo(() => blocking(rows, policy), [rows, policy]);
  const shown = useMemo(() => rows.filter(r => matches(r, query)
    && (tab === 'all' || (tab === 'done' ? !!r.confirmedVia : !r.confirmedVia))), [rows, query, tab]);
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
          {/ollama/i.test(error ?? '') ? (
            <span>The AI that reads the layers isn&apos;t running on this computer.
              <span className="block text-xs text-muted-foreground">Open the Ollama app (or run <code>ollama serve</code>), then Try again — or continue with the quick suggestions, sorted by the layers&apos; names.</span>
            </span>
          ) : (
            <span>{phase === 'unavailable' ? 'AI layer labeling is unavailable.' : 'AI layer labeling failed.'} <span className="block text-xs text-muted-foreground">{error}</span></span>
          )}
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
  const pct = rows.length ? Math.round((confirmed / rows.length) * 100) : 0;
  // The shown rows under their label; the group with the least sure layer first (rows come least confident first).
  const byLabel = [...new Set(shown.map(r => r.label))].map(label => ({ label, rows: shown.filter(r => r.label === label), group: labelGroups.find(g => g.label === label) }))
    .filter(g => g.rows.length);
  const tabs: [Tab, string, number][] = [['todo', 'Needs a look', rows.length - confirmed], ['all', 'All', rows.length], ['done', 'Done', confirmed]];
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

      {/* The summary: how far along, and what the drawing becomes. */}
      <div className={cn('space-y-3 rounded-2xl border p-4', left.length === 0 ? 'border-primary/30 bg-primary/5' : 'bg-card')}>
        <div className="flex items-start gap-3">
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', left.length === 0 ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
            {left.length === 0 ? <CheckCheck className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{left.length === 0 ? 'Layers confirmed — you can create the map' : 'We sorted your drawing’s layers'}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <Progress value={pct} className="h-1.5 flex-1" />
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{confirmed} of {rows.length} confirmed</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {found.kept.length ? found.kept.map(([label, n]) => (
            <span key={label} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs">
              <Dot label={label} /> {LAYER_LABEL_NAMES[label]} <span className="tabular-nums text-muted-foreground">{n}</span>
            </span>
          )) : <span className="text-xs text-muted-foreground">Nothing to draw yet</span>}
          {found.leftOut > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground"
              title="Notes, dimensions, elevations and other things that aren't part of the floor map">
              {found.leftOut} left out
            </span>
          )}
        </div>
        {found.unsure > 0 && left.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {found.unsure} layer{found.unsure === 1 ? '' : 's'} we weren&apos;t sure about — check {found.unsure === 1 ? 'it' : 'them'} below, or just check the preview.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {forBulk > 0 && (
            <Button onClick={() => setRows(rs => confirmBulk(rs, policy))}
              title="Confirms every remaining layer in one click. Recorded as a bulk confirmation, which is never used to train the model.">
              <CheckCheck className="mr-1.5 h-4 w-4" /> Looks right
            </Button>
          )}
          <Button variant={forBulk > 0 ? 'ghost' : 'outline'} size="sm" onClick={() => setDetails(d => !d)}>
            {details ? 'Hide the layers' : left.length === 0 ? 'Change a layer' : 'Check layers one by one'}
            <ChevronDown className={cn('ml-1 h-4 w-4 transition-transform', details && 'rotate-180')} />
          </Button>
        </div>
        {forBulk > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Confirms the {forBulk} remaining layer{forBulk === 1 ? '' : 's'}. Does the preview look like your building?{leftOut > 0 ? ` ${leftOut} layer${leftOut === 1 ? '' : 's'} nobody could identify will be left out.` : ''}
          </p>
        )}
      </div>

      {details && (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b p-2">
            <div className="flex rounded-lg bg-muted p-0.5 text-xs" role="tablist">
              {tabs.map(([id, label, n]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={cn('rounded-md px-2.5 py-1 font-medium transition-colors', tab === id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {label} <span className="tabular-nums text-muted-foreground">{n}</span>
                </button>
              ))}
            </div>
            {rows.length > 8 && (
              <div className="relative ml-auto min-w-[180px] flex-1 sm:max-w-[240px]">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search layers, blocks or text" className="h-8 pl-8 text-xs" />
              </div>
            )}
          </div>

          <div className="max-h-[46vh] overflow-auto">
            {byLabel.map(({ label, rows: list, group }) => {
              const isClosed = closed.has(label);
              return (
                <section key={label} className="border-b last:border-b-0">
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-muted/80 px-3 py-1.5 backdrop-blur">
                    <button type="button" onClick={() => setClosed(c => { const n = new Set(c); if (n.has(label)) n.delete(label); else n.add(label); return n; })}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-semibold" aria-expanded={!isClosed}>
                      <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', isClosed && '-rotate-90')} />
                      <Dot label={label} /> {LAYER_LABEL_NAMES[label]}
                      <span className="font-normal tabular-nums text-muted-foreground">{list.length}</span>
                    </button>
                    {group?.groupable && group.pending > 1 ? (
                      <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => setRows(rs => confirmGroup(rs, label, policy))}
                        title={group.samples.length ? `e.g. ${group.samples.join(', ')}` : undefined}>
                        <Check className="mr-1 h-3 w-3" /> Confirm all {group.pending}
                      </Button>
                    ) : group && !group.groupable && group.pending > 0 ? (
                      <span className="text-[10px] text-muted-foreground">confirm one by one</span>
                    ) : null}
                  </div>
                  {!isClosed && (
                    <ul className="divide-y">
                      {list.map(r => {
                        const own = alwaysConfirm(r.label, policy);
                        const open = left.some(b => b.name === r.name);
                        const changed = r.label !== r.aiLabel;
                        return (
                          <li key={r.name} className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2 text-xs sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]',
                            r.flagged && !r.confirmedVia && 'bg-amber-50/70 dark:bg-amber-950/20', r.confirmedVia && 'text-muted-foreground')}>
                            <span className="min-w-0">
                              <span className="block truncate font-mono text-[12px] text-foreground" title={r.name}>{r.name}</span>
                              <span className="block truncate text-[10px] text-muted-foreground" title={[contents(r), ...r.summary.blocks, ...r.summary.texts].join(' · ')}>
                                {contents(r)}{r.summary.blocks[0] ? ` · ${r.summary.blocks.slice(0, 2).join(', ')}` : ''}
                              </span>
                            </span>
                            <span className="order-last col-span-2 min-w-0 sm:order-none sm:col-span-1">
                              <span className="flex items-center gap-1.5 text-[11px]">
                                <span className="text-muted-foreground">AI:</span> <Dot label={r.aiLabel} className="h-2 w-2" /> {LAYER_LABEL_NAMES[r.aiLabel]}
                                {changed && <span className="rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">changed</span>}
                              </span>
                              {r.source === 'model' ? <Confidence value={r.confidence} />
                                : <span className="block text-[10px] text-muted-foreground">{r.source === 'rules' ? 'by the layer name' : 'empty layer'}</span>}
                              {r.ruleLabel && (
                                <span className="block text-[10px] text-amber-700 dark:text-amber-400" title={r.ruleReason}>Name says: {LAYER_LABEL_NAMES[r.ruleLabel]}</span>
                              )}
                            </span>
                            <span className="flex items-center justify-end gap-1.5">
                              <select value={r.label} aria-label={`Label for ${r.name}`}
                                title={own && !r.confirmedVia && r.label !== 'unknown' ? 'Needs its own check' : undefined}
                                onChange={e => setRows(rs => setLabel(rs, r.name, e.target.value as LayerLabel))}
                                className={cn('h-8 w-32 rounded-lg border bg-background px-2 text-xs text-foreground sm:w-36', r.label === 'unknown' && 'border-destructive text-destructive',
                                  own && !r.confirmedVia && r.label !== 'unknown' && 'border-amber-400')}>
                                {LAYER_LABELS.map(l => <option key={l} value={l}>{LAYER_LABEL_NAMES[l]}</option>)}
                              </select>
                              {r.confirmedVia ? (
                                <span className="inline-flex items-center gap-1 text-primary" title={VIA[r.confirmedVia]}>
                                  <Check className="h-4 w-4" />
                                  <button type="button" title="Undo" aria-label={`Undo confirmation of ${r.name}`} onClick={() => setRows(rs => unconfirmRow(rs, r.name))}
                                    className="rounded p-1 text-muted-foreground hover:bg-muted"><Undo2 className="h-3.5 w-3.5" /></button>
                                </span>
                              ) : canConfirm(r) ? (
                                <Button size="sm" variant={open ? 'default' : 'outline'} className="h-8 px-3 text-xs" onClick={() => setRows(rs => confirmRow(rs, r.name))}>
                                  Confirm
                                </Button>
                              ) : (
                                <span className="text-[11px] font-medium text-destructive">Choose a label</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
            {byLabel.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {query ? `No layers match “${query}”.` : tab === 'todo' ? 'Every layer is confirmed.' : 'Nothing here yet.'}
              </p>
            )}
          </div>
          <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Walkable is kept as a hint only — walkable paths are always built from the geometry.</p>
        </div>
      )}

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
