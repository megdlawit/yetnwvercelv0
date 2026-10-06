// Undo/redo for editors whose every action is already persisted to Supabase.
//
// Each command carries its own async undo/redo, so undoing reverses the
// database write too, not just local state. Commands run one at a time:
// a second Ctrl+Z while the first is still talking to Supabase is ignored
// rather than interleaved, which would otherwise apply them out of order.

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

export interface EditorCommand {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const LIMIT = 100;

export function useEditorHistory() {
  const past = useRef<EditorCommand[]>([]);
  const future = useRef<EditorCommand[]>([]);
  const busy = useRef(false);
  const [, bump] = useState(0);
  const rerender = () => bump(n => n + 1);

  const push = useCallback((cmd: EditorCommand) => {
    past.current = [...past.current.slice(-(LIMIT - 1)), cmd];
    future.current = [];
    rerender();
  }, []);

  const step = useCallback(async (from: typeof past, to: typeof past, dir: 'undo' | 'redo') => {
    if (busy.current) return;
    const cmd = from.current[from.current.length - 1];
    if (!cmd) return;
    busy.current = true;
    try {
      await cmd[dir]();
      from.current = from.current.slice(0, -1);
      to.current = [...to.current, cmd];
      toast(`${dir === 'undo' ? 'Undid' : 'Redid'}: ${cmd.label}`);
    } catch (err) {
      console.error(`${dir} failed:`, err);
      // The database and local state may now disagree about this command;
      // dropping the whole history is safer than replaying stale steps.
      past.current = [];
      future.current = [];
      toast.error(`Couldn't ${dir} "${cmd.label}" — history cleared. Reload if the map looks wrong.`);
    } finally {
      busy.current = false;
      rerender();
    }
  }, []);

  const undo = useCallback(() => step(past, future, 'undo'), [step]);
  const redo = useCallback(() => step(future, past, 'redo'), [step]);
  const clear = useCallback(() => { past.current = []; future.current = []; rerender(); }, []);

  return {
    push, undo, redo, clear,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    undoLabel: past.current[past.current.length - 1]?.label,
    redoLabel: future.current[future.current.length - 1]?.label,
  };
}
