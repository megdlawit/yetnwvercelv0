import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { LabelJob } from './client';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));

const calls = vi.hoisted(() => ({
  start: [] as ((job: LabelJob) => void)[],
  poll: [] as ((job: LabelJob) => void)[],
  cancelled: [] as string[],
}));

vi.mock('./client', async importOriginal => ({
  ...(await importOriginal<typeof import('./client')>()),
  labelerUrl: () => 'http://labeler',
  startJob: () => new Promise<LabelJob>(resolve => calls.start.push(resolve)),
  pollJob: () => new Promise<LabelJob>(resolve => calls.poll.push(resolve)),
  cancelJob: async (_base: string, id: string) => { calls.cancelled.push(id); return {} as LabelJob; },
}));

const { useLayerLabeling } = await import('./useLayerLabeling');

const job = (status: LabelJob['status'], extra: Partial<LabelJob> = {}): LabelJob => ({
  id: 'job-1', file_name: 'a.dxf', status, done: 0, total: 1, error: null, queue_position: 0, ...extra,
});
const done = job('done', {
  result: {
    model: { name: 'm', kind: 'baseline', reason: '' }, summarizer_version: 1, prompt_version: 3, seconds: 1,
    review: { confirm_all_layers: true, threshold: 0.7, always_confirm: ['ignore', 'walkable', 'unknown'] },
    layers: [{ name: 'A-WALL', label: 'wall', confidence: 0.9, needs_review: false, must_confirm: true, summary: { name: 'A-WALL', entity_counts: {}, blocks: [], texts: [] } }],
  },
});
const source = { blob: new Blob(['0\nEOF']), fileName: 'a.dxf' };

afterEach(() => { calls.start.length = 0; calls.poll.length = 0; calls.cancelled.length = 0; });

describe('useLayerLabeling', () => {
  it('turns a finished job into review rows', async () => {
    const { result } = renderHook(() => useLayerLabeling(source));
    await waitFor(() => expect(calls.start).toHaveLength(1));
    await act(async () => { calls.start[0](job('queued')); });
    await waitFor(() => expect(calls.poll).toHaveLength(1));
    await act(async () => { calls.poll[0](done); });
    expect(result.current.phase).toBe('done');
    expect(result.current.rows.map(r => r.name)).toEqual(['A-WALL']);
  });

  it('after skipping, a result that still arrives is ignored and the job is cancelled', async () => {
    const { result } = renderHook(() => useLayerLabeling(source));
    await waitFor(() => expect(calls.start).toHaveLength(1));
    await act(async () => { calls.start[0](job('queued')); });
    await waitFor(() => expect(calls.poll).toHaveLength(1));
    act(() => result.current.skip());
    await act(async () => { calls.poll[0](done); });      // the last answer was already on its way
    expect(result.current.phase).toBe('skipped');
    expect(result.current.rows).toEqual([]);
    expect(result.current.result).toBeNull();
    await waitFor(() => expect(calls.cancelled).toEqual(['job-1']));
  });

  it('skipping before the job was even accepted cancels it once it is', async () => {
    const { result } = renderHook(() => useLayerLabeling(source));
    await waitFor(() => expect(calls.start).toHaveLength(1));
    act(() => result.current.skip());
    await act(async () => { calls.start[0](job('queued')); });
    expect(result.current.phase).toBe('skipped');
    expect(calls.poll).toHaveLength(0);
    await waitFor(() => expect(calls.cancelled).toEqual(['job-1']));
  });
});
