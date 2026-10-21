import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { prepareLayerLabels, savePendingLabels } from './save';
import { confirmGroup, DEFAULT_POLICY, rowsFromResult } from './review';
import type { LabelResult } from './client';

const result: LabelResult = {
  model: { name: 'qwen2.5:3b', kind: 'baseline', reason: '' }, summarizer_version: 1, prompt_version: 3, seconds: 1,
  review: DEFAULT_POLICY,
  layers: [
    { name: 'A-WALL', label: 'wall', confidence: 0.99, needs_review: false, must_confirm: true, summary: { name: 'A-WALL', entity_counts: { LINE: 4 }, blocks: [], texts: [] } },
    { name: 'GRID', label: 'ignore', confidence: 0.9, needs_review: true, must_confirm: true, summary: { name: 'GRID', entity_counts: { LINE: 9 }, blocks: [], texts: [] } },
  ],
};

/** A fake Supabase client: storage and table writes fail as scripted, rows are kept by id. */
function fakeSupabase(script: { upload: (string | null)[]; upsert: (string | null)[] }) {
  const stored = new Map<string, unknown>();
  const files: string[] = [];
  const client = {
    storage: { from: () => ({ upload: vi.fn(async (path: string) => {
      const err = script.upload.shift() ?? null;
      if (!err || /exists/.test(err)) files.push(path);
      return { error: err ? { message: err } : null };
    }) }) },
    from: () => ({ upsert: vi.fn(async (rows: { id: string }[], opts: { onConflict: string; ignoreDuplicates: boolean }) => {
      expect(opts).toEqual({ onConflict: 'id', ignoreDuplicates: true });
      const err = script.upsert.shift() ?? null;
      if (!err) for (const r of rows) if (!stored.has(r.id)) stored.set(r.id, r);
      return { error: err ? { message: err } : null };
    }) }),
  };
  return { client: client as unknown as SupabaseClient<Database>, stored, files };
}

describe('saving layer labels', () => {
  const rows = confirmGroup(rowsFromResult(result.layers), 'wall', DEFAULT_POLICY);
  const pending = () => prepareLayerLabels({ buildingId: 'b1', fileName: 'Plan v2.dwg', source: new Blob(['0\nEOF']), rows, result });

  it('records how each layer was confirmed', () => {
    const p = pending();
    expect(p.sourcePath).toMatch(/^b1\/[0-9a-f-]{36}\/Plan v2\.dxf$/);
    expect(p.records.map(r => [r.layer_name, r.final_label, r.human_verified, r.confirmed_via])).toEqual([
      ['GRID', 'ignore', false, null], ['A-WALL', 'wall', true, 'group'],
    ]);
  });

  it('never credits the model with a label the name rules or an empty layer decided', () => {
    const decided = rowsFromResult([
      { ...result.layers[0], source: 'model' },
      { name: 'A-DOOR', label: 'door', confidence: null, needs_review: true, must_confirm: true, source: 'rules', summary: { name: 'A-DOOR', entity_counts: { INSERT: 2 }, blocks: [], texts: [] } },
      { name: 'Layer9', label: 'ignore', confidence: 1, needs_review: true, must_confirm: true, source: 'empty', summary: { name: 'Layer9', total: 0, entity_counts: {}, blocks: [], texts: [] } },
    ]);
    const p = prepareLayerLabels({ buildingId: 'b1', fileName: 'a.dxf', source: new Blob(['x']), rows: decided, result });
    const by = Object.fromEntries(p.records.map(r => [r.layer_name, [r.ai_model, r.ai_label, r.ai_confidence]]));
    expect(by).toEqual({ 'A-WALL': ['qwen2.5:3b', 'wall', 0.99], 'A-DOOR': ['rules', 'door', null], Layer9: ['empty-layer', 'ignore', null] });
  });

  it('reports a failure with what is left to do, and a retry stores everything exactly once', async () => {
    const { client, stored, files } = fakeSupabase({ upload: [null], upsert: ['network error'] });
    const first = await savePendingLabels(client, pending());
    expect(first.ok).toBe(false);
    expect(first.error).toMatch(/couldn't be saved: network error/);
    expect(first.pending.uploaded).toBe(true);           // the file went up; don't upload it again

    const again = await savePendingLabels(client, first.pending);
    expect(again).toMatchObject({ ok: true, saved: 2, error: null });
    expect(stored.size).toBe(2);
    expect(files).toHaveLength(1);

    expect(await savePendingLabels(client, first.pending)).toMatchObject({ ok: true, saved: 2 });
    expect(stored.size).toBe(2);                          // a second retry adds nothing
  });

  it('treats a file already stored by an earlier attempt as uploaded', async () => {
    const { client, stored } = fakeSupabase({ upload: ['The resource already exists'], upsert: [] });
    expect(await savePendingLabels(client, pending())).toMatchObject({ ok: true, saved: 2 });
    expect(stored.size).toBe(2);
  });

  it('explains a missing migration', async () => {
    const { client } = fakeSupabase({ upload: [null], upsert: ['relation "public.layer_labels" does not exist'] });
    const out = await savePendingLabels(client, pending());
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/needs migrations 20261010090000 and 20261010110000/);
  });
});
