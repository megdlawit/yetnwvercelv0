// Runs one AI layer-labeling job for the import dialog: submit the DXF,
// follow its progress, turn the result into review rows. Closing the dialog,
// choosing another file or skipping cancels the job, so the service deletes
// the upload straight away — and nothing that arrives afterwards is applied:
// once skipped, no AI label can reach the import.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LabelerUnavailable, cancelJob, isFinished, labelerUrl, pollJob, startJob, type LabelJob, type LabelResult } from './client';
import { DEFAULT_POLICY, knownFromHints, rowsFromResult, withNameHints, withRuleHints, type ReviewPolicy, type ReviewRow, type RuleHint } from './review';

export type LabelingPhase = 'off' | 'starting' | 'queued' | 'running' | 'done' | 'failed' | 'unavailable' | 'skipped';

export interface LabelSource {
  blob: Blob;
  fileName: string;
  /** The editor's rule-based suggestion per layer, compared with the AI's (withRuleHints). */
  hints?: Record<string, RuleHint>;
}

export interface LayerLabeling {
  phase: LabelingPhase;
  job: LabelJob | null;
  error: string | null;
  result: LabelResult | null;
  policy: ReviewPolicy;
  rows: ReviewRow[];
  setRows: (update: (rows: ReviewRow[]) => ReviewRow[]) => void;
  retry: () => void;
  /** Stop waiting for the AI and review with the rule-based suggestions instead. */
  skip: () => void;
}

const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null;

interface Run { abort: AbortController; jobId: string | null }

export function useLayerLabeling(source: LabelSource | null): LayerLabeling {
  const base = labelerUrl();
  const [phase, setPhase] = useState<LabelingPhase>('off');
  const [job, setJob] = useState<LabelJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LabelResult | null>(null);
  const [rows, setRowsState] = useState<ReviewRow[]>([]);
  const [attempt, setAttempt] = useState(0);
  const run = useRef<Run | null>(null);

  /** Ends the current run: no more updates from it, and its job is cancelled on the service. */
  const stop = useCallback(() => {
    const cur = run.current;
    run.current = null;
    if (!cur) return;
    cur.abort.abort();
    if (cur.jobId && base) {
      const id = cur.jobId;
      void token().then(t => cancelJob(base, id, t)).catch(() => { /* already finished, or the service is gone */ });
    }
  }, [base]);

  useEffect(() => {
    setJob(null); setError(null); setResult(null); setRowsState([]);
    if (!source || !base) { setPhase('off'); return; }
    const me: Run = { abort: new AbortController(), jobId: null };
    run.current = me;
    const live = () => run.current === me && !me.abort.signal.aborted;
    setPhase('starting');
    (async () => {
      try {
        const t = await token();
        const started = await startJob(base, source.blob, source.fileName, t, me.abort.signal, source.hints ? knownFromHints(source.hints) : undefined);
        me.jobId = started.id;
        if (!live()) { void cancelJob(base, started.id, t).catch(() => {}); return; }
        const final = await pollJob(base, started.id, t, j => {
          if (live()) { setJob(j); if (!isFinished(j.status)) setPhase(j.status === 'queued' ? 'queued' : 'running'); }
        }, me.abort.signal);
        if (!live()) return; // skipped or closed while the last answer was on its way
        run.current = null;
        if (final.status === 'done' && final.result) {
          setResult(final.result);
          const shape = final.result.drawing;
          const hints = source.hints ? withNameHints(final.result.layers.map(l => l.name), source.hints) : {};
          setRowsState(withRuleHints(rowsFromResult(final.result.layers), hints,
            final.result.review?.threshold ?? DEFAULT_POLICY.threshold, shape?.single_layer ? shape.largest_layer : null));
          setPhase('done');
        } else if (final.status === 'cancelled') {
          setPhase('skipped');
        } else {
          setError(final.error ?? 'Labeling failed.');
          setPhase('failed');
        }
      } catch (err) {
        if (!live() || (err instanceof DOMException && err.name === 'AbortError')) return;
        run.current = null;
        setError(err instanceof Error ? err.message : 'Labeling failed.');
        setPhase(err instanceof LabelerUnavailable ? 'unavailable' : 'failed');
      }
    })();
    return () => { if (run.current === me) stop(); else me.abort.abort(); };
  }, [source, base, attempt, stop]);

  const setRows = useCallback((update: (rows: ReviewRow[]) => ReviewRow[]) => setRowsState(update), []);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  const skip = useCallback(() => {
    stop();
    setResult(null); setRowsState([]); setPhase('skipped');
  }, [stop]);

  return { phase, job, error, result, policy: result?.review ?? DEFAULT_POLICY, rows, setRows, retry, skip };
}
