// Entry points: the gates, entrances and car parks where visitors arrive.
// Each gets a QR code; scanning it starts the visitor at that spot.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { DoorOpen, SquareParking, Download, ExternalLink, Pencil, Plus, Printer, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { qrLink } from '@/lib/QRCodeGenerator';
import { PLACE_TYPES } from '@/lib/venue/places';
import { ENTRY_TYPES } from '@/lib/venue/health';
import { savePlace } from '@/components/venue/dashboard/placesApi';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import { PageHeader, Panel, StatusDot } from './ui';

export default function EntryPoints() {
  const { data, places, reload } = useDashboard();
  const navigate = useNavigate();
  const entries = places.filter(p => ENTRY_TYPES.includes(p.type) && p.nodeId && p.floorId);
  const candidates = places.filter(p => p.nodeId && !ENTRY_TYPES.includes(p.type));
  const floorName = new Map(data.floors.map(f => [f.id, f.name] as const));
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const [pick, setPick] = useState('');
  const [kind, setKind] = useState<'entrance' | 'parking'>('entrance');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all(entries.map(async p => [p.key, await QRCode.toDataURL(qrLink({ buildingId: data.building.id, nodeId: p.nodeId!, floorId: p.floorId! }), { width: 360, margin: 2 })] as const))
      .then(r => live && setQrs(Object.fromEntries(r))).catch(() => {});
    return () => { live = false; };
  }, [entries.map(p => p.key).join(), data.building.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    const p = candidates.find(c => c.key === pick);
    if (!p) return;
    setBusy(true);
    try { await savePlace(data.building.id, p, { place_type: kind }); toast.success(`${p.name} is now an entry point`); setPick(''); await reload(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  const download = (key: string, name: string) => {
    const a = document.createElement('a'); a.href = qrs[key]; a.download = `${data.building.name} - ${name}.png`.replace(/[\\/:*?"<>|]/g, ''); a.click();
  };

  return (
    <>
      <PageHeader title="Entry Points" description="Where visitors arrive. Print the QR code for each one: scanning it opens your venue with “You are here” set, so directions start from the gate."
        actions={<Button variant="outline" onClick={() => navigate('/dashboard/qr')}><Printer className="mr-1.5 h-4 w-4" /> Print all QR codes</Button>} />

      <Panel title="Add an entry point" icon={Plus} className="mb-6" bodyClassName="flex flex-wrap items-center gap-2 px-5 pb-5">
        <select value={pick} onChange={e => setPick(e.target.value)} className="h-10 min-w-[220px] flex-1 rounded-md border bg-background px-3 text-sm" aria-label="Place">
          <option value="">Choose a place on the map…</option>
          {candidates.map(p => <option key={p.key} value={p.key}>{p.name}{data.floors.length > 1 && p.floorId ? ` (${floorName.get(p.floorId)})` : ''}</option>)}
        </select>
        <div className="flex rounded-xl bg-muted p-0.5">
          {(['entrance', 'parking'] as const).map(k => (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${kind === k ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>
              {k === 'entrance' ? <DoorOpen className="h-3.5 w-3.5" /> : <SquareParking className="h-3.5 w-3.5" />} {PLACE_TYPES[k].label}
            </button>
          ))}
        </div>
        <Button onClick={add} disabled={!pick || busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Make entry point</Button>
        {!candidates.length && <p className="w-full text-xs text-muted-foreground">Name the gate or entrance as a place in the map editor first, then choose it here.</p>}
      </Panel>

      {entries.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {entries.map(p => {
            const Icon = PLACE_TYPES[p.type].icon;
            return (
              <article key={p.key} className="flex flex-col rounded-3xl border bg-card p-5 text-center">
                {qrs[p.key] ? <img src={qrs[p.key]} alt={`QR code for ${p.name}`} className="mx-auto w-40" /> : <div className="mx-auto h-40 w-40 animate-pulse rounded-xl bg-muted" />}
                <p className="mt-3 flex items-center justify-center gap-1.5 font-semibold"><Icon className="h-4 w-4" /> {p.name}</p>
                <p className="text-xs text-muted-foreground">Starting location: {p.floorId ? floorName.get(p.floorId) : '—'}</p>
                <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><StatusDot ok /> QR Active</p>
                <p className="text-[11px] text-muted-foreground">Scans: tracking coming soon</p>
                <div className="mt-4 flex justify-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => download(p.key, p.name)} disabled={!qrs[p.key]}><Download className="mr-1 h-3.5 w-3.5" /> PNG</Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={qrLink({ buildingId: data.building.id, nodeId: p.nodeId!, floorId: p.floorId! })} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" /> Test</a>
                  </Button>
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => navigate(`/dashboard/places?edit=${encodeURIComponent(p.key)}`)} aria-label={`Edit ${p.name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed py-14 text-center text-sm text-muted-foreground">No entry points yet — add your main entrance above.</div>
      )}
    </>
  );
}
