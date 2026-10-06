// Dashboard → QR codes: one code per entrance, gate, parking area and
// attraction. Scanning opens the visitor map with that place as "You are
// here", so directions start from it. Print the sheet or download PNGs.

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Download, Printer, ExternalLink, Copy, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { qrLink } from '@/lib/QRCodeGenerator';
import { PLACE_TYPES } from '@/lib/venue/places';
import type { PlaceEntry } from '@/lib/venue/placeList';
import type { PoiRow, VenueData } from './useVenue';

const ORIGIN_KEY = 'venue-qr-origin';

function storedOrigin() {
  try { return localStorage.getItem(ORIGIN_KEY) || window.location.origin; } catch { return window.location.origin; }
}

export default function QrCodes({ data, places }: { data: VenueData; places: PlaceEntry<PoiRow>[] }) {
  const [showAll, setShowAll] = useState(false);
  const [origin, setOrigin] = useState(storedOrigin);
  const [images, setImages] = useState<Record<string, string>>({});
  const floorName = useMemo(() => new Map(data.floors.map(f => [f.id, f.name] as const)), [data.floors]);

  const onMap = places.filter(p => p.nodeId && p.floorId && p.visible);
  const list = showAll ? onMap : onMap.filter(p => PLACE_TYPES[p.type].qr);
  const cleanOrigin = origin.trim().replace(/\/+$/, '');
  const linkFor = (p: PlaceEntry<PoiRow>) => qrLink({ buildingId: data.building.id, nodeId: p.nodeId!, floorId: p.floorId! }, cleanOrigin);

  useEffect(() => {
    let live = true;
    Promise.all(list.map(async p => [p.key, await QRCode.toDataURL(linkFor(p), { width: 480, margin: 2, errorCorrectionLevel: 'M' })] as const))
      .then(pairs => { if (live) setImages(Object.fromEntries(pairs)); })
      .catch(err => console.error('QR generation failed:', err));
    return () => { live = false; };
  }, [list.map(p => p.key).join(), cleanOrigin]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveOrigin = (v: string) => { setOrigin(v); try { localStorage.setItem(ORIGIN_KEY, v); } catch { /* private mode */ } };
  const isLocal = /localhost|127\.0\.0\.1/.test(cleanOrigin);

  const download = (p: PlaceEntry<PoiRow>) => {
    const a = document.createElement('a');
    a.href = images[p.key]; a.download = `${data.building.name} - ${p.name}.png`.replace(/[\\/:*?"<>|]/g, '');
    a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="space-y-1.5 flex-1 min-w-[240px]">
          <label className="text-xs text-muted-foreground" htmlFor="qr-origin">Codes open this website</label>
          <Input id="qr-origin" value={origin} onChange={e => saveOrigin(e.target.value)} placeholder="https://your-site.vercel.app" />
        </div>
        <label className="flex items-center gap-2 text-sm h-10"><Switch checked={showAll} onCheckedChange={setShowAll} /> All places</label>
        <Button onClick={() => window.print()} disabled={!list.length}><Printer className="h-4 w-4 mr-1.5" /> Print sheet</Button>
      </div>
      {isLocal && (
        <p className="rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 print:hidden">
          These codes point to this computer ({cleanOrigin}), so phones can't open them. Enter your public site address above before printing.
        </p>
      )}
      <p className="text-xs text-muted-foreground print:hidden">
        {showAll ? 'Every visible place on the map.' : 'Entrances, gates, parking and attractions / cultural sites.'} Set a place's type under Places to add it here.
      </p>

      <div className="qr-sheet grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 print:grid-cols-3 print:gap-6">
        {list.map(p => {
          const Icon = PLACE_TYPES[p.type].icon;
          return (
            <figure key={p.key} className="rounded-2xl border bg-white text-black p-4 flex flex-col items-center text-center break-inside-avoid print:rounded-none print:border-black/40">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-black/60">{data.building.name}</p>
              {images[p.key] ? <img src={images[p.key]} alt={`QR code for ${p.name}`} className="w-full max-w-[200px] aspect-square" /> : <div className="w-full max-w-[200px] aspect-square bg-black/5 animate-pulse rounded" />}
              <figcaption className="space-y-0.5">
                <p className="font-semibold flex items-center justify-center gap-1.5"><Icon className="h-4 w-4" /> {p.name}</p>
                <p className="text-xs text-black/60">{p.typeLabel}{data.floors.length > 1 && p.floorId ? ` · ${floorName.get(p.floorId)}` : ''}</p>
                <p className="text-[11px] text-black/70 pt-1">Scan to see where you are and get directions</p>
              </figcaption>
              <div className="flex gap-1 pt-3 print:hidden">
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => download(p)} disabled={!images[p.key]} title="Download PNG" aria-label={`Download QR code for ${p.name}`}><Download className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="outline" className="h-8 w-8" title="Copy link" aria-label={`Copy link for ${p.name}`}
                  onClick={() => navigator.clipboard.writeText(linkFor(p)).then(() => toast.success('Link copied'), () => toast.error('Could not copy'))}><Copy className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="outline" className="h-8 w-8" asChild title="Test: open as a visitor who scanned it">
                  <a href={qrLink({ buildingId: data.building.id, nodeId: p.nodeId!, floorId: p.floorId! })} target="_blank" rel="noreferrer" aria-label={`Test the code for ${p.name}`}><ExternalLink className="h-3.5 w-3.5" /></a>
                </Button>
              </div>
            </figure>
          );
        })}
      </div>
      {!list.length && (
        <div className="rounded-2xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          <QrCode className="h-8 w-8 mx-auto mb-2 opacity-40" />
          No entrances, gates, parking or attractions on the map yet. Set place types under Places, or turn on “All places”.
        </div>
      )}
    </div>
  );
}
