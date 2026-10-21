// Saves the reviewed layer labels of one import (table layer_labels) and the
// original drawing (private bucket cad-sources, at <building>/<import>/<file>.dxf).
// Runs with the signed-in user's session, so RLS decides what is allowed.
//
// Saving happens after the venue is created and may fail on its own (network,
// missing migration). It never fails silently: the dialog shows the error
// with a Retry. Retrying is safe — every row's id and the file's path are
// fixed when the payload is prepared, rows already stored are skipped
// (ON CONFLICT DO NOTHING) and a file already uploaded counts as uploaded.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, TablesInsert } from '@/integrations/supabase/types';
import type { LabelResult } from './client';
import type { ReviewRow } from './review';

const CHUNK = 500;

export interface PendingLabels {
  importId: string;
  sourcePath: string;
  source: Blob;
  records: TablesInsert<'layer_labels'>[];
  /** The drawing is already in storage (from an earlier attempt). */
  uploaded: boolean;
}

/** ok: everything stored. Otherwise `error` says what failed and `pending` is what a retry needs. */
export interface SaveOutcome { ok: boolean; saved: number; error: string | null; pending: PendingLabels }

const dxfName = (name: string) => `${(name.replace(/\.[^.]+$/, '').replace(/[^\w.\- ()]/g, '_').slice(0, 100) || 'drawing')}.dxf`;

/** Everything one save needs, with stable ids so a retry writes the same rows. */
export function prepareLayerLabels(o: { buildingId: string; fileName: string; source: Blob; rows: ReviewRow[]; result: LabelResult }): PendingLabels {
  const importId = crypto.randomUUID();
  const sourcePath = `${o.buildingId}/${importId}/${dxfName(o.fileName)}`;
  const records = o.rows.map(r => ({
    id: crypto.randomUUID(),
    building_id: o.buildingId,
    import_id: importId,
    file_name: o.fileName,
    source_path: sourcePath,
    layer_name: r.name,
    layer_summary: r.summary as unknown as Json,
    summarizer_version: o.result.summarizer_version,
    prompt_version: o.result.prompt_version,
    // Rows the name rules decided (the model wasn't asked) or empty layers are never credited to the model.
    ai_model: r.source === 'rules' ? 'rules' : r.source === 'empty' ? 'empty-layer' : o.result.model.name,
    ai_label: r.aiLabel,
    ai_confidence: r.source === 'model' ? r.confidence : null,
    final_label: r.label === 'unknown' ? null : r.label,
    human_verified: r.confirmedVia !== null && r.label !== 'unknown',
    confirmed_via: r.label === 'unknown' ? null : r.confirmedVia,
  }));
  return { importId, sourcePath, source: o.source, records, uploaded: false };
}

const explain = (message: string) => (/layer_labels|schema cache|does not exist|bucket not found/i.test(message)
  ? `${message} — the database needs migrations 20261010090000 and 20261010110000.`
  : message);

export async function savePendingLabels(supabase: SupabaseClient<Database>, pending: PendingLabels): Promise<SaveOutcome> {
  let p = pending;
  try {
    if (!p.uploaded) {
      const up = await supabase.storage.from('cad-sources').upload(p.sourcePath, p.source, { contentType: 'application/dxf', upsert: false });
      // An earlier attempt may have stored it before failing later.
      if (up.error && !/exists|duplicate/i.test(up.error.message)) {
        return { ok: false, saved: 0, error: `The original drawing couldn't be stored: ${explain(up.error.message)}`, pending: p };
      }
      p = { ...p, uploaded: true };
    }
    for (let i = 0; i < p.records.length; i += CHUNK) {
      const { error } = await supabase.from('layer_labels')
        .upsert(p.records.slice(i, i + CHUNK), { onConflict: 'id', ignoreDuplicates: true });
      if (error) return { ok: false, saved: 0, error: `The layer labels couldn't be saved: ${explain(error.message)}`, pending: p };
    }
    return { ok: true, saved: p.records.length, error: null, pending: p };
  } catch (err) {
    return { ok: false, saved: 0, error: `The layer labels couldn't be saved: ${err instanceof Error ? err.message : 'network error'}`, pending: p };
  }
}
