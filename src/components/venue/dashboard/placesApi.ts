// Writing place details. A place on the map gets its `pois` row the first time
// anything about it is saved.

import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { PLACE_TYPES, type PlaceType } from '@/lib/venue/places';
import type { PlaceEntry } from '@/lib/venue/placeList';
import type { PoiRow } from './useVenue';

export type PoiPatch = TablesUpdate<'pois'>;

const migrationHint = (msg: string) =>
  /column|schema cache|place_type|is_visible|navigable/i.test(msg)
    ? `${msg} — run migration 20260930170000_places_content_theme.sql in the Supabase SQL editor.`
    : msg;

/** Keep the older `category` / `image_url` columns in step for the existing app and partner API. */
export function withLegacy(patch: PoiPatch): PoiPatch {
  const out = { ...patch };
  if (patch.place_type) out.category = PLACE_TYPES[patch.place_type as PlaceType].legacy;
  if (patch.images) out.image_url = patch.images[0] ?? null;
  return out;
}

export async function savePlace(buildingId: string, entry: PlaceEntry<PoiRow>, patch: PoiPatch): Promise<PoiRow> {
  const body = withLegacy(patch);
  const q = entry.poi
    ? supabase.from('pois').update(body).eq('id', entry.poi.id).select('*').single()
    : supabase.from('pois').insert({
      building_id: buildingId, node_id: entry.nodeId, floor_id: entry.floorId,
      place_type: entry.type, category: PLACE_TYPES[entry.type].legacy, ...body, name: body.name ?? entry.name,
    }).select('*').single();
  const { data, error } = await q;
  if (error) throw new Error(migrationHint(error.message));
  return data;
}

export async function createPlace(buildingId: string, fields: PoiPatch & { name: string }): Promise<PoiRow> {
  const { data, error } = await supabase.from('pois').insert({ ...withLegacy(fields), building_id: buildingId, name: fields.name }).select('*').single();
  if (error) throw new Error(migrationHint(error.message));
  return data;
}

export async function deletePlaceDetails(poiId: string) {
  const { error } = await supabase.from('pois').delete().eq('id', poiId);
  if (error) throw new Error(error.message);
}
