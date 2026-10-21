// "Ask your map": the floor editor's conversation bar. People say what they
// want ("Connect Room 1 and Room 2", "Add a restroom here", "Fix
// everything") and the map does it — with a preview for bigger changes, an
// Undo after every one, and the map health always in view.
//
// Understanding is local first (src/lib/assistant/intent.ts); anything it
// doesn't recognise goes to the free local assistant (ml/ service, a local model)
// when it runs, else to /api/map-assistant (Claude) when that's set up.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, ChevronUp, Loader2, Sparkles, Undo2, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { guardModelActions, parseIntent, type MapAction } from '@/lib/assistant/intent';
import { smallTalk, smallTalkKind } from '@/lib/assistant/smalltalk';
import { knowledge } from '@/lib/assistant/knowledge';
import { labelerUrl } from '@/lib/cad/layerLabels/client';
import { brief, plan, suggestions, type Chip, type HealthItem, type Highlight, type MapState, type Plan, type Thing } from '@/lib/assistant/engine';

type BaseState = Omit<MapState, 'last' | 'lastChange'>;

interface Msg {
  id: number;
  who: 'me' | 'map';
  text: string;
  tone?: Plan['tone'];
  chips?: Chip[];
  details?: string[];
  /** Waiting for Apply / Cancel. */
  preview?: Plan;
  /** This message made a change that Undo can take back. */
  undoable?: boolean;
}

export interface MapAssistantProps {
  /** The map right now (null while loading). */
  getState: () => BaseState | null;
  /** Writes a plan's change / edit to the map. True when it worked. */
  apply: (p: Plan) => Promise<boolean>;
  /** What to draw on the map: a preview, or a flash after a change. */
  onHighlight: (h: (Highlight & { mode: 'preview' | 'flash' }) | null) => void;
  undo: () => void;
  health: HealthItem[];
  /** The selected thing's name, for "Ask about Room 2…". */
  selectedName: string | null;
  /** A message from the map itself (after an import). */
  greeting: { key: number; reply: string; chips: Chip[] } | null;
  floorName: string;
  floors: string[];
  /** Something said from elsewhere in the editor (a side panel button). */
  ask?: { key: number; text: string } | null;
}

const HINTS = ['Connect Room 1 and Room 2', 'Add a 6 by 4 m meeting room here', 'Make the walls 3 m high', 'Show it in 3D', 'How far is the entrance from the café?', 'Rotate this 90 degrees', 'Make room 3 a restroom', 'Fix everything'];
/** Edits that only change what's on screen (or can't be taken back from here). */
const NOT_UNDOABLE = new Set(['undo', 'redo', 'show', 'view', 'fit', 'floor', 'setting', 'tool', 'select_all', 'select_none', 'open', 'publish']);
const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 30)));
/** How long to wait for the AI (the free local model is slow on a laptop CPU). */
const AI_TIMEOUT_MS = 120_000;

/** fetch with a time limit. */
async function fetchWithin(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { window.clearTimeout(t); }
}

export default function MapAssistant(props: MapAssistantProps) {
  const { getState, apply, onHighlight, undo, health, selectedName, greeting } = props;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [focused, setFocused] = useState(false);
  const [showDetails, setShowDetails] = useState<number | null>(null);
  const [earlier, setEarlier] = useState(false);
  const [hint, setHint] = useState(0);
  // Waiting on the AI (not the instant local understanding): say so, it can take a while.
  const [thinking, setThinking] = useState(false);
  const last = useRef<Thing | null>(null);
  const lastChange = useRef<MapState['lastChange']>(null);
  const queue = useRef<MapAction[]>([]);
  const ids = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<number>();

  const say = (m: Omit<Msg, 'id'>) => setMsgs(p => [...p.slice(-30), { ...m, id: ++ids.current }]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs]);
  useEffect(() => { const t = setInterval(() => setHint(h => (h + 1) % HINTS.length), 4200); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!greeting) return;
    setOpen(true);
    say({ who: 'map', text: greeting.reply, chips: greeting.chips, tone: 'ok' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greeting?.key]);
  const submitRef = useRef<(raw?: string) => Promise<void>>();
  useEffect(() => {
    if (props.ask) void submitRef.current?.(props.ask.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.ask?.key]);
  // "/" focuses the bar, like a search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)))) return;
      e.preventDefault(); inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pending = msgs.find(m => m.preview);
  const latestUndoable = [...msgs].reverse().find(m => m.undoable)?.id ?? null;

  const flash = (h?: Highlight) => {
    window.clearTimeout(flashTimer.current);
    if (!h || (!h.route.length && !h.removed.length && !h.spots.length)) { onHighlight(null); return; }
    onHighlight({ ...h, mode: 'flash' });
    flashTimer.current = window.setTimeout(() => onHighlight(null), 2600);
  };

  const state = (): MapState | null => {
    const s = getState();
    return s ? { ...s, last: last.current, lastChange: lastChange.current } : null;
  };

  /** Carries out understood requests one by one; stops at a preview. */
  const run = async (actions: MapAction[]) => {
    queue.current = actions;
    while (queue.current.length) {
      const a = queue.current.shift()!;
      const s = state();
      if (!s) { say({ who: 'map', text: 'The map is still loading — try again in a moment.', tone: 'info' }); return; }
      let p: Plan;
      try { p = plan(a, s); } catch (err) {
        console.error('assistant plan failed', err);
        say({ who: 'map', text: "Something went wrong working that out. Try saying it another way.", tone: 'warn' });
        queue.current = []; return;
      }
      if (p.mention !== undefined) last.current = p.mention;
      if (p.confirm && p.change) {
        onHighlight(p.highlight ? { ...p.highlight, mode: 'preview' } : null);
        say({ who: 'map', text: p.reply, tone: p.tone, preview: p, details: p.details });
        return; // the rest waits for Apply
      }
      if (p.change || p.edit) {
        const ok = await apply(p);
        if (!ok) { say({ who: 'map', text: "I couldn't save that change. Check your connection and try again.", tone: 'warn' }); queue.current = []; return; }
        if (p.edit?.op === 'undo') lastChange.current = null;
        else if (p.change) lastChange.current = { label: p.label ?? '', edges: p.change.edges.map(e => e.id) };
        flash(p.highlight);
        say({ who: 'map', text: p.done ?? p.reply, tone: p.tone, chips: queue.current.length ? undefined : p.chips, details: p.details, undoable: !p.edit || !NOT_UNDOABLE.has(p.edit.op) });
        await nextFrame();
      } else {
        if (p.highlight) flash(p.highlight);
        say({ who: 'map', text: p.reply, tone: p.tone, chips: p.chips, details: p.details });
        if (p.tone === 'warn' || p.tone === 'info') { queue.current = []; return; }
      }
    }
  };

  const decide = async (m: Msg, yes: boolean) => {
    setMsgs(p => p.map(x => (x.id === m.id ? { ...x, preview: undefined } : x)));
    onHighlight(null);
    const p = m.preview!;
    if (!yes) { queue.current = []; say({ who: 'map', text: 'Okay — I left the map as it was.', tone: 'info' }); return; }
    setBusy(true);
    try {
      const ok = await apply(p);
      if (!ok) { say({ who: 'map', text: "I couldn't save that change. Check your connection and try again.", tone: 'warn' }); return; }
      lastChange.current = p.change ? { label: p.label ?? '', edges: p.change.edges.map(e => e.id) } : null;
      flash(p.highlight);
      say({ who: 'map', text: p.done ?? 'Done.', tone: 'ok', chips: p.chips, undoable: !p.edit || !NOT_UNDOABLE.has(p.edit.op) });
      await nextFrame();
      if (queue.current.length) await run(queue.current);
    } finally { setBusy(false); }
  };

  const askClaude = async (said: string): Promise<{ actions: MapAction[]; reply: string | null } | null> => {
    const s = getState();
    try {
      const { data } = await supabase.auth.getSession();
      const names = s ? [...new Set(s.rows.rooms.filter(r => r.floor_id === s.floorId).map(r => r.name).concat(s.rows.nodes.filter(n => n.floor_id === s.floorId && !n.is_hallway).map(n => n.name)).filter((x): x is string => !!x))] : [];
      // The whole picture (kinds, sizes, positions, paths, health) and the last few turns, so follow-ups make sense.
      let mapBrief = '';
      try { const full = state(); if (full) mapBrief = brief(full); } catch (err) { console.error('map brief failed', err); }
      const history = msgs.slice(-10).map(m => ({ who: m.who, text: m.text.slice(0, 400) }));
      const init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
        body: JSON.stringify({ text: said, history, context: { floor: props.floorName, floors: props.floors, places: names, selection: selectedName, last: last.current?.name ?? null, brief: mapBrief } }),
      };
      // The free local assistant first (a local model; same request and answer), then Claude if it isn't running.
      const local = labelerUrl();
      if (local) {
        try {
          const r = await fetchWithin(`${local}/assistant`, init, AI_TIMEOUT_MS);
          if (r.ok) return await r.json();
        } catch { /* not running or too slow: try the Claude route */ }
      }
      const r = await fetchWithin('/api/map-assistant', init, AI_TIMEOUT_MS);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };

  const submit = async (raw?: string) => {
    const said = (raw ?? text).trim();
    if (!said || busy) return;
    // A chip that ends in a space ("Connect ", "Rename it to ") is a sentence to finish.
    if (raw && /\s$/.test(raw)) { setText(raw); inputRef.current?.focus(); return; }
    setText('');
    setOpen(true);
    // "yes" / "ok" / "apply" or "no" / "cancel" answer the change that's waiting for Apply.
    const kind = smallTalkKind(said);
    if (pending && (kind === 'yes' || kind === 'no' || (kind === 'ack' && /^(ok|okay|k|fine|alright)$/i.test(said.trim())))) {
      say({ who: 'me', text: said });
      await decide(pending, kind !== 'no');
      return;
    }
    if (pending) { setMsgs(p => p.map(x => (x.preview ? { ...x, preview: undefined } : x))); onHighlight(null); queue.current = []; }
    say({ who: 'me', text: said });
    // Greetings, thanks, "what can you do?": answered right away, never sent to the AI.
    const chat = smallTalk(said, state());
    if (chat) { say({ who: 'map', text: chat.reply, tone: 'info', chips: chat.chips.length ? chat.chips : undefined }); return; }
    // "What's a room?", "how do I publish?": what Yet New is and does, answered from what it really does.
    const known = knowledge(said);
    if (known) { say({ who: 'map', text: known.reply, tone: 'info', chips: known.chips.length ? known.chips : undefined }); return; }
    setBusy(true);
    try {
      let actions = parseIntent(said);
      if (!actions) {
        setThinking(true);
        const ai = await askClaude(said).finally(() => setThinking(false));
        // Never the opposite of what was asked ("don't connect…" answered with a connect).
        const guarded = ai?.actions?.length ? guardModelActions(said, ai.actions) : null;
        if (guarded && !guarded.actions.length) { say({ who: 'map', text: guarded.reply!, tone: 'info' }); return; }
        if (ai?.actions?.length) {
          actions = ai.actions;
          // An answer that comes with actions ("There are 3 — here's the nearest") is said first.
          if (ai.reply) say({ who: 'map', text: ai.reply, tone: 'info' });
        }
        else {
          const s = state();
          say({ who: 'map', text: ai?.reply ?? "I didn't quite get that. You can say things like \"Connect Room 1 and Room 2\", \"Add a restroom here\" or \"Fix everything\".", tone: 'info', chips: s ? suggestions(s) : undefined });
          return;
        }
      }
      await run(actions);
    } finally { setBusy(false); }
  };

  submitRef.current = submit;
  const needs = health.length;
  const showList = open && msgs.length > 0;
  const chipsFor = focused && !msgs.length && !text ? (() => { const s = state(); return s ? suggestions(s) : []; })() : null;
  const placeholder = useMemo(() => (selectedName ? `Ask about ${selectedName}…` : focused ? `e.g. "${HINTS[hint]}"` : 'What would you like to change?'), [selectedName, hint, focused]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center px-3">
      <div data-wheel-own data-tour="map-assistant" className="pointer-events-auto flex w-full max-w-[620px] flex-col gap-2" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
        {showList && (
          <div ref={listRef} className="ma-in max-h-[30vh] space-y-2 overflow-y-auto rounded-2xl border bg-card/95 p-2.5 shadow-xl backdrop-blur" aria-live="polite">
            {!earlier && msgs.length > 3 && (
              <button onClick={() => setEarlier(true)} className="mx-auto block rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted">Show earlier ({msgs.length - 3})</button>
            )}
            {(earlier ? msgs : msgs.slice(-3)).map(m => (
              <div key={m.id} className={cn('flex', m.who === 'me' ? 'justify-end' : 'justify-start')}>
                <div className={cn('ma-in max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-snug',
                  m.who === 'me' ? 'bg-primary text-primary-foreground rounded-br-md'
                    : m.tone === 'warn' ? 'bg-amber-500/10 text-foreground ring-1 ring-amber-500/30 rounded-bl-md'
                      : 'bg-muted text-foreground rounded-bl-md')}>
                  <p className="whitespace-pre-line">{m.who === 'map' && m.tone === 'ok' && !m.preview && <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-emerald-600" />}{m.text}</p>
                  {m.preview && (
                    <div className="mt-2 flex gap-1.5">
                      <button onClick={() => void decide(m, true)} disabled={busy}
                        className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50">
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Apply
                      </button>
                      <button onClick={() => void decide(m, false)} disabled={busy}
                        className="inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-xs font-medium hover:bg-muted">
                        <X className="h-3.5 w-3.5" /> Cancel
                      </button>
                    </div>
                  )}
                  {(m.chips?.length || (m.undoable && m.id === latestUndoable) || m.details?.length) ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {m.undoable && m.id === latestUndoable && (
                        <button onClick={() => { undo(); lastChange.current = null; setMsgs(p => p.map(x => (x.id === m.id ? { ...x, undoable: false } : x))); }}
                          className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-muted">
                          <Undo2 className="h-3 w-3" /> Undo
                        </button>
                      )}
                      {m.chips?.map(c => (
                        <button key={c.label} onClick={() => void submit(c.say)}
                          className="rounded-full border border-primary/30 bg-background px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10">{c.label}</button>
                      ))}
                      {!!m.details?.length && (
                        <button onClick={() => setShowDetails(d => (d === m.id ? null : m.id))} className="px-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline">
                          {showDetails === m.id ? 'Hide details' : 'Advanced details'}
                        </button>
                      )}
                    </div>
                  ) : null}
                  {showDetails === m.id && m.details && (
                    <ul className="mt-1 space-y-0.5 rounded-lg bg-background/70 p-1.5 font-mono text-[10.5px] text-muted-foreground">{m.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  )}
                </div>
              </div>
            ))}
            {busy && !pending && (
              <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {thinking ? 'Thinking about that — this can take up to a minute…' : 'Working on it…'}
              </div>
            )}
          </div>
        )}

        {chipsFor && chipsFor.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {chipsFor.map(c => (
              <button key={c.label} onMouseDown={e => e.preventDefault()} onClick={() => void submit(c.say)}
                className="rounded-full border bg-card/95 px-3 py-1 text-xs font-medium shadow-sm backdrop-blur hover:bg-muted">{c.label}</button>
            ))}
          </div>
        )}

        <form onSubmit={e => { e.preventDefault(); void submit(); }}
          className="flex items-center gap-1.5 rounded-full border bg-card/95 p-1.5 pl-2 shadow-xl ring-1 ring-primary/10 backdrop-blur focus-within:ring-2 focus-within:ring-primary/40">
          <button type="button" onClick={() => void submit(needs ? "What's wrong?" : 'Map health')} title={needs ? 'See what needs attention' : 'Map health'}
            className={cn('flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              needs ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400')}>
            {needs ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{needs ? `${needs} need${needs === 1 ? 's' : ''} attention` : 'Map health'}</span>
            <span className="sm:hidden">{needs || '✓'}</span>
          </button>
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <input ref={inputRef} value={text} onChange={e => setText(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            placeholder={placeholder} aria-label="What would you like to change?" disabled={busy && !!pending}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground/80" />
          {needs > 0 && !text && (
            <button type="button" onClick={() => void submit('Fix everything')}
              className="hidden shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium hover:bg-muted md:block">Fix everything</button>
          )}
          {msgs.length > 0 && (
            <button type="button" onClick={() => setOpen(o => !o)} aria-label={open ? 'Hide conversation' : 'Show conversation'}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}</button>
          )}
          <button type="submit" disabled={!text.trim() || busy} aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-opacity disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}
