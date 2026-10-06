// Image uploads for places, content and institution logos, into the
// `poi-media` storage bucket. Files go under inst/<institution id>/…, the only
// place an institution's team may write (migration 20261002090000).

import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'poi-media';
const MAX_MB = 8;

export async function uploadImage(file: File, folder: 'places' | 'content' | 'logo' | 'media', institutionId: string | null): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" isn't an image.`);
  if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Images must be under ${MAX_MB} MB.`);
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${institutionId ? `inst/${institutionId}/` : ''}${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(/row-level security|unauthorized|403/i.test(error.message) ? 'You don\'t have permission to upload here.' : `Upload failed: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
