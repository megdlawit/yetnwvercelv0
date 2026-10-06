// "Where are you?" — set your starting point in one tap: scan the nearest QR
// code, say you're at the entrance, or search and pick the spot you're at.
// A bottom sheet on phones, a centred dialog on larger screens.

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, X, Search, ScanLine, DoorOpen, ChevronRight, Navigation } from 'lucide-react';
import { Building } from '@/data/types';

interface ManualLocationModalProps {
  open: boolean;
  buildings: Building[];
  selectedBuildingId: string;
  selectedFloorId: string;
  onClose: () => void;
  onConfirm: (buildingId: string, floorId: string, nodeId: string) => void;
  /** Offer "Scan a QR code" (the most accurate way to say where you are). */
  onScanQR?: () => void;
  /** Where they're heading, if they picked that first ("…then we'll take you to the Café"). */
  destinationName?: string | null;
  /** …and that place isn't offered as a starting spot. */
  destinationNodeId?: string | null;
}

interface Spot { nodeId: string; floorId: string; floorName: string; name: string }

const ENTRANCE = /entrance|entry|gate|main door|lobby|reception/i;

const ManualLocationModal: React.FC<ManualLocationModalProps> = ({
  open, buildings, selectedBuildingId, selectedFloorId, onClose, onConfirm, onScanQR, destinationName, destinationNodeId,
}) => {
  const [buildingId, setBuildingId] = useState(selectedBuildingId);
  const [floorFilter, setFloorFilter] = useState<string | 'all'>('all');
  const [query, setQuery] = useState('');
  const building = buildings.find(b => b.id === buildingId) ?? buildings.find(b => b.id === selectedBuildingId) ?? buildings[0];

  // Every named spot: rooms (by their path point) and named places on the paths.
  const spots = useMemo<Spot[]>(() => {
    if (!building) return [];
    const out: Spot[] = [];
    for (const f of building.floors) {
      const seen = new Set<string>();
      for (const r of f.rooms) {
        if (!r.nodeId || !r.name?.trim() || seen.has(r.nodeId)) continue;
        seen.add(r.nodeId); out.push({ nodeId: r.nodeId, floorId: f.id, floorName: f.name, name: r.name.trim() });
      }
      for (const n of f.nodes) {
        if (n.isHallway || !n.name?.trim() || seen.has(n.id)) continue;
        seen.add(n.id); out.push({ nodeId: n.id, floorId: f.id, floorName: f.name, name: n.name.trim() });
      }
    }
    return out
      .filter(sp => sp.nodeId !== destinationNodeId)
      .sort((a, b) => Number(ENTRANCE.test(b.name)) - Number(ENTRANCE.test(a.name)) || a.name.localeCompare(b.name));
  }, [building, destinationNodeId]);

  const entrance = spots.find(s => ENTRANCE.test(s.name));
  const q = query.trim().toLowerCase();
  const shown = spots.filter(s => (floorFilter === 'all' || s.floorId === floorFilter) && (!q || s.name.toLowerCase().includes(q)));
  const multiFloor = (building?.floors.length ?? 0) > 1;
  const pick = (s: Spot) => building && onConfirm(building.id, s.floorId, s.nodeId);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Where are you?"
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-border/30 bg-card shadow-2xl sm:max-w-md sm:rounded-[28px]"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="h-1.5 w-12 rounded-full bg-muted-foreground/20" />
            </div>

            {/* header */}
            <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
                  <MapPin className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-black leading-tight text-foreground">Where are you?</h3>
                  <p className="text-xs text-muted-foreground">
                    {destinationName ? <>Pick your spot — then we'll guide you to <b className="text-foreground">{destinationName}</b>.</> : 'Pick your spot to start from here.'}
                  </p>
                </div>
              </div>
              <button onClick={onClose} aria-label="Close"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/70 hover:bg-muted">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            {/* the quickest ways */}
            <div className="grid grid-cols-2 gap-2 px-5 pb-3">
              {onScanQR && (
                <button onClick={onScanQR}
                  className="flex items-center gap-2.5 rounded-2xl bg-primary px-3 py-3 text-left text-primary-foreground shadow-md transition-transform active:scale-[0.98]">
                  <ScanLine className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-bold leading-tight">Scan a QR code<span className="block text-[11px] font-medium opacity-80">Most accurate</span></span>
                </button>
              )}
              {entrance && (
                <button onClick={() => pick(entrance)}
                  className={`flex items-center gap-2.5 rounded-2xl border bg-card px-3 py-3 text-left transition-colors hover:bg-muted active:scale-[0.98] ${onScanQR ? '' : 'col-span-2'}`}>
                  <DoorOpen className="h-5 w-5 shrink-0 text-emerald-600" />
                  <span className="min-w-0 text-sm font-bold leading-tight">I'm at the entrance<span className="block truncate text-[11px] font-medium text-muted-foreground">{entrance.name}</span></span>
                </button>
              )}
            </div>

            {/* venue (only when there's a choice) */}
            {buildings.length > 1 && (
              <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-5 pb-2">
                {buildings.map(b => (
                  <button key={b.id} onClick={() => { setBuildingId(b.id); setFloorFilter('all'); }}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${b.id === building?.id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>
                    {b.name}
                  </button>
                ))}
              </div>
            )}

            {/* search + floors */}
            <div className="space-y-2 px-5 pb-2">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search for the spot you're at…" aria-label="Search for your spot"
                  className="h-11 w-full rounded-2xl border border-border/60 bg-muted/50 pl-10 pr-3 text-sm outline-none focus:border-primary/50 focus:bg-card focus:ring-2 focus:ring-primary/15" />
              </div>
              {multiFloor && (
                <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
                  {[{ id: 'all', name: 'All floors' }, ...building!.floors].map(f => (
                    <button key={f.id} onClick={() => setFloorFilter(f.id)}
                      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${floorFilter === f.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* every spot — one tap sets it */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
              {shown.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">No spot called “{query}”. Try another name, or scan a QR code.</p>
              ) : shown.map(s => (
                <button key={`${s.floorId}:${s.nodeId}`} onClick={() => pick(s)}
                  className="group flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-muted active:bg-muted">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${ENTRANCE.test(s.name) ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-primary/10 text-primary'}`}>
                    {ENTRANCE.test(s.name) ? <DoorOpen className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{s.name}</span>
                    {multiFloor && <span className="block text-[11px] text-muted-foreground">{s.floorName}</span>}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    <Navigation className="h-3 w-3" /> I'm here
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ManualLocationModal;
