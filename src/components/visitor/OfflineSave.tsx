// "Save for offline" on a venue's map: download the venue before you go (business plan §23 — weak
// connectivity at parks, heritage sites and trails), see how big it is, update it when the venue
// publishes changes, remove it. With no connection, the map then opens from this copy.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CloudDownload, CloudOff, Check, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  listPackages, packageOutdated, removePackage, saveVenuePackage, sizeText, PACKAGES_CHANGED, type PackageSummary, type Progress as Step,
} from '@/lib/offline/venuePackage';

const dateText = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function useSavedPackage(venueId: string | undefined) {
  const [pack, setPack] = useState<PackageSummary | null>(null);
  const refresh = useCallback(async () => {
    if (venueId) {
      setPack((await listPackages()).find(p => p.venueId === venueId) ?? null);
    } else {
      setPack(null);
    }
  }, [venueId]);
  useEffect(() => {
    void refresh();
    const again = () => { void refresh(); };
    window.addEventListener(PACKAGES_CHANGED, again);
    return () => window.removeEventListener(PACKAGES_CHANGED, again);
  }, [refresh]);
  return pack;
}

export default function OfflineSave({ venueId, venueName, publishedAt, offlineSavedAt, className }: {
  venueId: string; venueName: string; publishedAt: string | null; offlineSavedAt?: string; className?: string;
}) {
  const pack = useSavedPackage(venueId);
  const [step, setStep] = useState<Step | null>(null);
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const outdated = !!pack && online && !offlineSavedAt && packageOutdated(pack, publishedAt);

  const save = async () => {
    setStep({ step: 'data', done: 0, total: 1 });
    try {
      const s = await saveVenuePackage(venueId, setStep);
      toast.success(`${venueName} is saved on this device (${sizeText(s.bytes)}). The map works without a connection now.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save for offline use');
    } finally {
      setStep(null);
    }
  };
  const remove = async () => {
    await removePackage(venueId);
    toast.success('Removed from this device');
  };

  const pct = step ? (step.step === 'data' ? 5 : 5 + Math.round((95 * step.done) / Math.max(1, step.total))) : 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn('pointer-events-auto relative grid h-10 w-10 place-items-center rounded-2xl', className)}
          aria-label={pack ? 'Saved for offline use' : 'Save for offline use'} title={pack ? 'Saved for offline use' : 'Save for offline use'}>
          {step ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : offlineSavedAt ? <CloudOff className="h-[18px] w-[18px]" /> : <CloudDownload className="h-[18px] w-[18px]" />}
          {pack && !step && <span className={cn('absolute right-1.5 top-1.5 h-2 w-2 rounded-full', outdated ? 'bg-amber-500' : 'bg-emerald-500')} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-semibold">{offlineSavedAt ? "You're offline" : 'Use this map offline'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {offlineSavedAt
              ? `Showing the copy of ${venueName} saved on ${dateText(offlineSavedAt)}. Directions, places, photos and notices work; reviews need a connection.`
              : 'Save the map, places, photos and the surrounding street map on this phone — for spots with weak signal.'}
          </p>
        </div>
        {step ? (
          <div className="space-y-1.5">
            <Progress value={pct} />
            <p className="text-xs text-muted-foreground">{step.step === 'data' ? 'Saving the map and places…' : `Saving photos and map tiles · ${step.done} of ${step.total}`}</p>
          </div>
        ) : pack ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs"><Check className="h-3.5 w-3.5 text-emerald-600" /> Saved {dateText(pack.savedAt)} · {sizeText(pack.bytes)}</p>
            {outdated && <p className="rounded-lg bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">{venueName} has changed since — update to get the latest.</p>}
            {online && !offlineSavedAt && (
              <div className="flex gap-2">
                <Button size="sm" variant={outdated ? 'default' : 'outline'} className="flex-1 rounded-xl" onClick={() => void save()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Update</Button>
                <Button size="sm" variant="ghost" className="rounded-xl text-destructive hover:text-destructive" onClick={() => void remove()}><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove</Button>
              </div>
            )}
          </div>
        ) : online ? (
          <Button className="w-full rounded-xl" onClick={() => void save()}><CloudDownload className="mr-1.5 h-4 w-4" /> Save for offline</Button>
        ) : (
          <p className="text-xs text-muted-foreground">Connect to the internet to save this venue.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
