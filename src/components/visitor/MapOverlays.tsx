// Things that float over the map: the greeting when you walk into a place,
// "Museum · 8 min walk" nudges, locate / scan buttons, the "you're outside
// the venue" directions banner, and the QR scanner.

import { useEffect, useRef, useState } from 'react';
import { X, Footprints, LocateFixed, ScanLine, Loader2, Navigation, MapPinned, Sparkles, DoorOpen, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { QRScanner, type QRAnchorPayload } from '@/lib/QRScanner';
import type { GPSStatus } from '@/lib/geo/GPSPositioning';
import { CATEGORY_ICONS, type Place } from './types';

/** `placement`: 'opposite' keeps clear of the directions card (bottom on phones, top on desktop). */
export function GreetingCard({ place, message, onOpen, onClose, placement = 'top' }: { place: Place; message: string | null; onOpen: () => void; onClose: () => void; placement?: 'top' | 'opposite' }) {
  const Icon = CATEGORY_ICONS[place.category];
  return (
    <div className={cn('pointer-events-auto absolute inset-x-3 z-30 mx-auto max-w-sm animate-in fade-in slide-in-from-top-4 overflow-hidden rounded-3xl border bg-card shadow-2xl',
      placement === 'top' ? 'top-14' : 'top-14 md:bottom-6 md:top-auto')} role="status" aria-live="polite">
      <div className="flex gap-3 p-3">
        {place.images[0] ? <img src={place.images[0]} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
          : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-7 w-7" /></span>}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary"><Sparkles className="h-3 w-3" /> You're entering</p>
          <p className="truncate font-semibold">{place.name}</p>
          {message && <p className="line-clamp-2 text-xs text-muted-foreground">{message}</p>}
        </div>
        <button onClick={onClose} className="self-start rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Dismiss"><X className="h-4 w-4" /></button>
      </div>
      <button onClick={onOpen} className="w-full border-t py-2 text-sm font-medium text-primary hover:bg-muted">Learn more</button>
    </div>
  );
}

export function NearbyChip({ name, minutes, onOpen, onDismiss }: { name: string; minutes: number; onOpen: () => void; onDismiss: () => void }) {
  return (
    <div className="pointer-events-auto flex items-center overflow-hidden rounded-full border bg-card/95 text-xs shadow-lg backdrop-blur">
      <button onClick={onOpen} className="flex items-center gap-1.5 py-1.5 pl-3 pr-2 hover:bg-muted">
        <MapPinned className="h-3.5 w-3.5 text-primary" /> <span className="font-semibold">{name}</span> <span className="text-muted-foreground">· {minutes} min walk</span>
      </button>
      <button onClick={onDismiss} className="border-l px-2 py-1.5 text-muted-foreground hover:bg-muted" aria-label="Dismiss suggestion"><X className="h-3 w-3" /></button>
    </div>
  );
}

/** "Use my location" (GPS outdoors + steps and compass everywhere) and "Scan a QR code". */
export function LocateButtons({ tracking, gpsStatus, onLocate, onScan }: { tracking: boolean; gpsStatus: GPSStatus; onLocate: () => void; onScan: () => void }) {
  return (
    <div className="pointer-events-auto flex flex-col overflow-hidden rounded-2xl border bg-card/95 shadow-lg backdrop-blur">
      <button onClick={onLocate} title={tracking ? 'Following you — tap to stop' : 'Use my location'} aria-label="Use my location" aria-pressed={tracking}
        className={cn('grid h-10 w-10 place-items-center hover:bg-muted', tracking && 'text-sky-500')}>
        {gpsStatus === 'requesting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
      </button>
      <button onClick={onScan} title="Scan a QR code to set where you are" aria-label="Scan a QR code" className="grid h-10 w-10 place-items-center border-t hover:bg-muted">
        <ScanLine className="h-4 w-4" />
      </button>
    </div>
  );
}

export function OutsideBanner({ venueName, metres, minutes, loading, approximate, onShow, onClose }: {
  venueName: string; metres: number; minutes: number | null; loading: boolean; approximate: boolean;
  onShow: () => void; onClose: () => void;
}) {
  const far = metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
  return (
    <div className="pointer-events-auto absolute inset-x-3 top-14 z-20 mx-auto max-w-sm rounded-3xl border bg-card p-3 shadow-2xl">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-sky-500 text-white"><Footprints className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">You're {far} from {venueName}</p>
          <p className="text-xs text-muted-foreground">
            {loading ? 'Finding a walking route…' : minutes ? `About ${minutes} min on foot${approximate ? ' (straight line)' : ' along the streets'}` : ''}
          </p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Dismiss"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1 rounded-full" onClick={onShow} disabled={loading}><Navigation className="mr-1.5 h-4 w-4" /> Show the way</Button>
      </div>
    </div>
  );
}

/**
 * First thing on a phone (like the original app): how should we follow you?
 * Live location (GPS + steps + compass), the QR code at the gate, the main
 * entrance, or just look around.
 */
export function StartSheet({ venueName, entranceName, onLocate, onScan, onEntrance, onBrowse }: {
  venueName: string; entranceName: string | null; onLocate: () => void; onScan: () => void; onEntrance: () => void; onBrowse: () => void;
}) {
  const option = (Icon: typeof X, title: string, text: string, go: () => void, primary = false) => (
    <button onClick={go} className={cn('flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors', primary ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>
      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', primary ? 'bg-white/15' : 'bg-primary/10 text-primary')}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0"><span className="block font-semibold">{title}</span><span className={cn('block text-xs', primary ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{text}</span></span>
    </button>
  );
  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/35 p-3 backdrop-blur-[1px] md:items-center" role="dialog" aria-label="How should we guide you?">
      <div className="w-full max-w-sm animate-in slide-in-from-bottom-6 rounded-[1.75rem] border bg-card p-4 shadow-2xl">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg"><Footprints className="h-7 w-7" /></div>
        <h2 className="text-center text-lg font-bold">Welcome to {venueName}</h2>
        <p className="mb-4 text-center text-sm text-muted-foreground">How should we guide you? We count your steps and follow your direction, turn by turn.</p>
        <div className="space-y-2">
          {option(LocateFixed, 'Use my location', 'GPS outside, steps and compass inside', onLocate, true)}
          {option(ScanLine, 'Scan the QR code here', 'On the sign at the gate or entrance', onScan)}
          {entranceName && option(DoorOpen, `Start at ${entranceName}`, 'If you\'re standing at the entrance', onEntrance)}
          {option(Compass, 'Just look around', 'Explore the map first', onBrowse)}
        </div>
      </div>
    </div>
  );
}

/** Camera QR scanner. Codes printed from the dashboard open this venue at a spot. */
export function QrScanDialog({ open, onOpenChange, onResult }: { open: boolean; onOpenChange: (o: boolean) => void; onResult: (p: QRAnchorPayload) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    const scanner = new QRScanner();
    // the <video> mounts with the dialog
    const t = setTimeout(() => {
      if (!video.current) return;
      scanner.start(video.current, p => { onResult(p); onOpenChange(false); }, e => setError(e));
    }, 50);
    return () => { clearTimeout(t); scanner.stop(); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Scan a QR code</DialogTitle>
          <DialogDescription>Point your camera at a Yet New code on a sign or gate — we'll set where you are.</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-black">
          <video ref={video} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-10 rounded-2xl border-2 border-white/80" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
