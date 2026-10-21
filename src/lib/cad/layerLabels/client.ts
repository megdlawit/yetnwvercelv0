// Talks to the layer-labeling service (ml/server): submit a DXF as a job,
// poll its progress, cancel it. The service runs locally next to Ollama;
// requests carry the signed-in user's Supabase token (the service checks it
// when YETNEW_REQUIRE_AUTH=1, and jobs belong to that user).

import type { AiLayer, ReviewPolicy } from './review';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface LabelResult {
  model: { name: string; kind: 'baseline' | 'finetuned'; reason: string };
  summarizer_version: number;
  prompt_version: number;
  seconds: number;
  review: ReviewPolicy;
  layers: AiLayer[];
  /** How the drawing uses layers (older services don't send it). */
  drawing?: DrawingShape;
}

export interface DrawingShape {
  layers_used: number;
  entities: number;
  largest_layer: string | null;
  largest_layer_share: number;
  /** (Almost) everything on one layer: layer labels can't separate walls from furniture. */
  single_layer: boolean;
}

export interface LabelJob {
  id: string;
  file_name: string;
  status: JobStatus;
  done: number;
  total: number | null;
  error: string | null;
  queue_position: number;
  result?: LabelResult;
}

/** The service is not running / not reachable (as opposed to answering with an error). */
export class LabelerUnavailable extends Error {}

/**
 * Where the service is: VITE_LAYER_LABELER_URL, or the local default during
 * development. null = AI labeling is off for this build.
 */
export function labelerUrl(): string | null {
  const env = import.meta.env.VITE_LAYER_LABELER_URL as string | undefined;
  if (env) return env.replace(/\/+$/, '');
  return import.meta.env.DEV ? 'http://127.0.0.1:8787' : null;
}

async function call<T>(base: string, path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new LabelerUnavailable('The layer-labeling service isn\'t running. Start it with `python -m server` in the ml folder (see ml/README.md).');
  }
  const body = (await resp.json().catch(() => ({}))) as { detail?: unknown };
  if (!resp.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : `The labeling service answered ${resp.status}.`;
    throw new Error(detail);
  }
  return body as T;
}

/** `known`: layers the editor's rules are sure about — the service doesn't ask the model about them. */
export function startJob(base: string, file: Blob, fileName: string, token: string | null, signal?: AbortSignal,
                         known?: Record<string, string>): Promise<LabelJob> {
  const form = new FormData();
  form.append('file', file, fileName);
  if (known && Object.keys(known).length) form.append('known', JSON.stringify(known));
  return call<LabelJob>(base, '/jobs', token, { method: 'POST', body: form, signal });
}

export function getJob(base: string, id: string, token: string | null, signal?: AbortSignal): Promise<LabelJob> {
  return call<LabelJob>(base, `/jobs/${encodeURIComponent(id)}`, token, { signal });
}

export function cancelJob(base: string, id: string, token: string | null): Promise<LabelJob> {
  return call<LabelJob>(base, `/jobs/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
}

export const isFinished = (s: JobStatus) => s === 'done' || s === 'failed' || s === 'cancelled';

/** Polls until the job finishes; `onUpdate` sees every state. Stops (throws AbortError) when `signal` aborts. */
export async function pollJob(
  base: string, id: string, token: string | null, onUpdate: (job: LabelJob) => void, signal: AbortSignal, everyMs = 1500,
): Promise<LabelJob> {
  for (;;) {
    const job = await getJob(base, id, token, signal);
    onUpdate(job);
    if (isFinished(job.status)) return job;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, everyMs);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  }
}
