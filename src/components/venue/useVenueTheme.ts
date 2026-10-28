// The venue's own theme (buildings.theme: Park, Heritage, Modern), for import
// screens that should look like the venue they build.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { themeOf, type VenueTheme } from '@/lib/venue/themes';

export function useVenueTheme(buildingId: string | null | undefined): VenueTheme {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!buildingId) return;
    let live = true;
    supabase.from('buildings').select('theme').eq('id', buildingId).maybeSingle()
      .then(({ data }) => { if (live) setId(data?.theme ?? null); });
    return () => { live = false; };
  }, [buildingId]);
  return themeOf(id);
}
