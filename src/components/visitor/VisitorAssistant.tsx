// "Ask": the visitor's conversation with the venue's guide. Typed in plain words
// ("where is room 12?", "how r u", "nearest toilet", "ሽንት ቤት የት ነው?") and answered
// right here on the phone (src/lib/assistant/visitor.ts) — nothing is sent anywhere.
// Answers act on the map: the place is shown, directions start, the floor changes.

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Sparkles, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { visitorReply, type VisitorAction, type VisitorContext, type VisitorMemory } from '@/lib/assistant/visitor';

interface Msg { id: number; who: 'me' | 'guide'; text: string; chips?: string[]; readAs?: string }

export default function VisitorAssistant({ context, onAction, onClose, className }: {
  context: VisitorContext;
  onAction: (a: VisitorAction) => void;
  onClose: () => void;
  className?: string;
}) {
  const ids = useRef(0);
  const [msgs, setMsgs] = useState<Msg[]>(() => [{
    id: 0, who: 'guide',
    text: `Hi! I’m ${context.venue}’s guide. Ask me where anything is, how to get there, or what’s on — in your own words.`,
    chips: starters(context),
  }]);
  const [text, setText] = useState('');
  const memory = useRef<VisitorMemory>({});
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(context);
  latest.current = context;

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [msgs]);

  const send = (raw?: string) => {
    const said = (raw ?? text).trim();
    if (!said) return;
    setText('');
    const r = visitorReply(said, latest.current, memory.current);
    memory.current = r.memory;
    setMsgs(m => [...m.slice(-40), { id: ++ids.current, who: 'me', text: said }, { id: ++ids.current, who: 'guide', text: r.text, chips: r.chips, readAs: r.readAs }]);
    r.actions.forEach(a => onAction(a));
  };

  const lastId = msgs[msgs.length - 1]?.id;
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.18 }}
      className={cn('flex flex-col overflow-hidden rounded-2xl border border-white/50 bg-card/95 shadow-2xl backdrop-blur-xl dark:border-white/10', className)}
      aria-label="Ask the guide">
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Ask {context.venue}</p>
          <p className="text-[11px] text-muted-foreground">Answers right on your phone</p>
        </div>
        <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
      </header>
      <div ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
        {msgs.map(m => (
          <div key={m.id} className={cn('flex flex-col', m.who === 'me' ? 'items-end' : 'items-start')}>
            <div className={cn('max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm leading-snug',
              m.who === 'me' ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted text-foreground')}>
              {m.readAs && <span className="mb-0.5 block text-[11px] italic text-muted-foreground">I read: “{m.readAs}”</span>}
              {m.text}
            </div>
            {m.chips?.length && m.id === lastId ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.chips.map(c => (
                  <button key={c} onClick={() => send(c)} className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10">{c}</button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <form onSubmit={e => { e.preventDefault(); send(); }} className="flex items-center gap-2 border-t border-border/60 p-2">
        <input ref={input} value={text} onChange={e => setText(e.target.value)} enterKeyHint="send" autoComplete="off"
          placeholder="Where is…? How do I get to…?" aria-label="Ask the guide"
          className="min-w-0 flex-1 rounded-full bg-muted px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40" />
        <button type="submit" disabled={!text.trim()} aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
      </form>
    </motion.section>
  );
}

/** Opening suggestions that fit this venue. */
function starters(ctx: VisitorContext): string[] {
  const out: string[] = [];
  if (ctx.places.some(p => p.category === 'restrooms')) out.push('Nearest toilet');
  const named = ctx.places.find(p => !['restrooms', 'parking', 'entrances', 'facilities'].includes(p.category) && !/^(small room|room) \d+$/i.test(p.name));
  if (named) out.push(`Where is ${named.name}?`);
  out.push('What can I see here?');
  return out;
}
