// "Business details" in the place editor, for cafés, restaurants, hotels and shops: the venue's team
// can start a listing (phone, prices) so visitors can reach the business before it joins. Once a
// business has claimed the place (business plan §18.1), the business keeps these details and
// the team only sees who manages it.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BadgeCheck, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PRICE_RANGES, isPriceRange, type BusinessProfileRow, type PriceRange } from '@/lib/venue/business';

export default function BusinessSection({ poiId }: { poiId: string | null }) {
  const [row, setRow] = useState<BusinessProfileRow | null | undefined>(undefined);
  const [manager, setManager] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [f, setF] = useState({ phone: '', whatsapp: '', website: '', booking_note: '', price_range: '' as PriceRange | '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (poiId) {
      const { data, error } = await supabase.from('business_profiles').select('*').eq('poi_id', poiId).maybeSingle();
      setMissing(!!error && /business_profiles|schema cache|does not exist/i.test(error.message));
      setRow(data ?? null);
      setF({ phone: data?.phone ?? '', whatsapp: data?.whatsapp ?? '', website: data?.website ?? '', booking_note: data?.booking_note ?? '',
        price_range: isPriceRange(data?.price_range) ? data.price_range : '' });
      if (data?.business_id) {
        const { data: inst } = await supabase.from('institutions').select('name').eq('id', data.business_id).maybeSingle();
        setManager(inst?.name ?? 'a business');
      } else {
        setManager(null);
      }
    } else {
      setRow(null);
    }
  }, [poiId]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (poiId) {
      setBusy(true);
      const blank = (v: string) => v.trim() || null;
      const patch = { phone: blank(f.phone), whatsapp: blank(f.whatsapp), website: blank(f.website), booking_note: blank(f.booking_note), price_range: f.price_range || null };
      // building_id is set by the database from the place; it's only here to satisfy the insert's shape.
      const { error } = row
        ? await supabase.from('business_profiles').update(patch).eq('poi_id', poiId)
        : await supabase.from('business_profiles').insert({ poi_id: poiId, building_id: '00000000-0000-0000-0000-000000000000', ...patch });
      setBusy(false);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success('Business details saved — visitors see them now');
        void load();
      }
    } else {
      // a new place: saved first, then its business details
    }
  };

  if (missing) {
    return null;
  } else if (!poiId) {
    return <p className="text-xs text-muted-foreground">Save the place first, then add how visitors can reach the business.</p>;
  } else if (row === undefined) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  } else if (manager) {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span><b>Managed by {manager}.</b> The business keeps its phone, prices and amenities up to date and answers its reviews on Yet New Business. You still own the place on your map.</span>
      </p>
    );
  } else {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">How visitors reach this business. When the business joins Yet New Business and its claim is approved, it takes these over.</p>
        <div className="grid grid-cols-2 gap-2">
          <Input value={f.phone} maxLength={40} onChange={e => setF(x => ({ ...x, phone: e.target.value }))} placeholder="Phone" aria-label="Phone" />
          <Input value={f.whatsapp} maxLength={40} onChange={e => setF(x => ({ ...x, whatsapp: e.target.value }))} placeholder="WhatsApp" aria-label="WhatsApp" />
          <Input value={f.website} maxLength={300} onChange={e => setF(x => ({ ...x, website: e.target.value }))} placeholder="Website" aria-label="Website" />
          <Input value={f.booking_note} maxLength={300} onChange={e => setF(x => ({ ...x, booking_note: e.target.value }))} placeholder="e.g. Call to book" aria-label="Booking" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(PRICE_RANGES) as PriceRange[]).map(r => (
            <button key={r} type="button" aria-pressed={f.price_range === r} onClick={() => setF(x => ({ ...x, price_range: x.price_range === r ? '' : r }))}
              className={cn('rounded-full border px-2.5 py-1 text-xs', f.price_range === r ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}>
              {r} {PRICE_RANGES[r]}
            </button>
          ))}
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save business details
          </Button>
        </div>
      </div>
    );
  }
}
