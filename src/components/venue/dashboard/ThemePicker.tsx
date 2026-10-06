// Dashboard → Theme: the look of the venue's 3D world and visitor map.

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { THEMES, themeOf, type ThemeId } from '@/lib/venue/themes';
import type { VenueData } from './useVenue';
import VenueViewer from './VenueViewer';

export default function ThemePicker({ data, onChanged }: { data: VenueData; onChanged: () => void }) {
  const saved = themeOf(data.building.theme).id;
  const [choice, setChoice] = useState<ThemeId>(saved);
  const [saving, setSaving] = useState(false);
  const floor = data.floors[0];

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('buildings').update({ theme: choice }).eq('id', data.building.id);
    setSaving(false);
    if (error) {
      toast.error(/theme/.test(error.message) ? 'Run migration 20260930170000_places_content_theme.sql in the Supabase SQL editor first.' : error.message);
      return;
    }
    toast.success(`${THEMES[choice].label} theme applied`);
    onChanged();
  };

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-3 gap-3">
        {Object.values(THEMES).map(t => (
          <button key={t.id} onClick={() => setChoice(t.id)} aria-pressed={choice === t.id}
            className={cn('relative rounded-2xl border-2 bg-card p-3 text-left transition-colors', choice === t.id ? 'border-primary' : 'border-transparent ring-1 ring-border hover:ring-primary/40')}>
            {/* A tiny plan drawn in the theme's colours */}
            <svg viewBox="0 0 120 64" className="w-full rounded-lg" style={{ background: t.ground }} aria-hidden>
              <rect x="14" y="10" width="54" height="40" fill={t.slab} stroke={t.wall} strokeWidth="3" />
              <rect x="76" y="18" width="30" height="26" fill={t.slab} stroke={t.wall} strokeWidth="3" />
              <path d="M41 50 V58 H91 V44" fill="none" stroke={t.path} strokeWidth="4" strokeLinecap="round" />
              <path d="M41 30 V50" fill="none" stroke={t.route} strokeWidth="3" strokeLinecap="round" />
              <circle cx="8" cy="54" r="5" fill={t.treeA} /><circle cx="112" cy="10" r="5" fill={t.treeB} /><circle cx="70" cy="6" r="4" fill={t.treeA} />
              <circle cx="41" cy="30" r="4" fill={t.primary} stroke="#fff" strokeWidth="1.5" />
            </svg>
            <div className="mt-3 flex items-center gap-2">
              <p className="font-semibold">{t.label}</p>
              {saved === t.id && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">Current</span>}
              {choice === t.id && <Check className="ml-auto h-4 w-4 text-primary" />}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
            <div className="mt-2 flex gap-1">
              {[t.primary, t.path, t.ground, t.wall, t.route].map(c => <span key={c} className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ background: c }} />)}
            </div>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving || choice === saved}>{saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Apply {THEMES[choice].label} theme</Button>
        {choice !== saved && <span className="text-xs text-muted-foreground">Previewing — visitors still see {THEMES[saved].label} until you apply.</span>}
      </div>

      <section className="rounded-2xl border bg-card overflow-hidden">
        <h2 className="font-semibold text-sm px-4 py-3 border-b">Live preview{floor ? ` · ${floor.name}` : ''}</h2>
        {floor
          ? <VenueViewer buildingId={data.building.id} floorId={floor.id} level={floor.level} theme={THEMES[choice]} mode="3d" className="h-[420px]" />
          : <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">Add a floor to preview the theme in 3D.</div>}
      </section>
      <p className="text-xs text-muted-foreground">The theme colours the 3D world and the visitor map's buttons and pins (in light mode).</p>
    </div>
  );
}
