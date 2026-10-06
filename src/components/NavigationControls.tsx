import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Navigation, Volume2, VolumeX, RotateCcw, X,
  CheckCircle, Circle, MapPin, Play,
  ChevronUp, ChevronDown, ArrowRight, ArrowLeft,
  MoveRight, CornerDownRight,
} from 'lucide-react';
import { Building, Floor, NavNode } from '@/data/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NavigationControlsProps {
  buildings: Building[];
  selectedBuildingId: string;
  selectedFloorId: string;
  startNodeId: string | null;
  endNodeId: string | null;
  currentFloor: Floor | null;
  onBuildingChange: (id: string) => void;
  onFloorChange: (id: string) => void;
  onStartChange: (nodeId: string) => void;
  onEndChange: (nodeId: string) => void;
  onNavigate: () => void;
  onClear: () => void;
  hasPath: boolean;
  distance: number | null;
  path?: NavNode[] | null;
  isNavigating?: boolean;
  isComplete?: boolean;
  currentNodeIndex?: number;
  onStartNav?: () => void;
  onReset?: () => void;
  voiceEnabled?: boolean;
  onToggleVoice?: () => void;
}

// ─── Direction logic ─────────────────────────────────────────────────────────

type TurnDir = 'straight' | 'left' | 'right' | 'start' | 'arrive';

interface Step {
  instruction: string;
  dir: TurnDir;
  distanceM: number;
}

function getTurn(prev: NavNode, cur: NavNode, next: NavNode): TurnDir {
  const dx1 = cur.x - prev.x, dy1 = cur.y - prev.y;
  const dx2 = next.x - cur.x, dy2 = next.y - cur.y;
  const cross = dx1 * dy2 - dy1 * dx2;
  const dot   = dx1 * dx2 + dy1 * dy2;
  if (Math.abs(cross) < 10 && dot > 0) return 'straight';
  return cross > 0 ? 'right' : 'left';
}

function nodeDist(a: NavNode, b: NavNode): number {
  return Math.round(Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) / 10);
}

function buildSteps(path: NavNode[]): Step[] {
  if (path.length < 2) return [];
  const steps: Step[] = [];

  steps.push({
    instruction: `Start at ${path[0].name || 'your location'}`,
    dir: 'start',
    distanceM: 0,
  });

  // Collapse hallway runs into turn instructions
  for (let i = 1; i < path.length - 1; i++) {
    const node = path[i];
    const dist  = nodeDist(path[i - 1], path[i]);

    if (!node.isHallway && node.name) {
      // Named room mid-path
      const dir = getTurn(path[i - 1], path[i], path[i + 1]);
      const verb = dir === 'left' ? 'Turn left' : dir === 'right' ? 'Turn right' : 'Continue straight';
      steps.push({ instruction: `${verb} to ${node.name}`, dir, distanceM: dist });
    } else {
      // Hallway node — emit a turn if direction changes significantly
      if (i >= 1 && i + 1 < path.length) {
        const dir = getTurn(path[i - 1], path[i], path[i + 1]);
        if (dir !== 'straight') {
          const verb = dir === 'left' ? 'Turn left' : 'Turn right';
          steps.push({ instruction: verb, dir, distanceM: dist });
        } else {
          steps.push({ instruction: 'Continue straight', dir: 'straight', distanceM: dist });
        }
      }
    }
  }

  steps.push({
    instruction: `Arrive at ${path[path.length - 1].name || 'destination'}`,
    dir: 'arrive',
    distanceM: nodeDist(path[path.length - 2], path[path.length - 1]),
  });

  return steps;
}

// ─── Step Icon ───────────────────────────────────────────────────────────────

const StepIcon: React.FC<{ dir: TurnDir; active?: boolean; done?: boolean }> = ({ dir, active, done }) => {
  const cls = `w-3.5 h-3.5 mt-0.5 shrink-0 transition-colors`;
  if (done) return <CheckCircle className={`${cls} text-primary`} />;
  if (dir === 'arrive') return <MapPin className={`${cls} ${active ? 'text-destructive animate-pulse' : 'text-muted-foreground/40'}`} />;
  if (dir === 'start')  return <div className={`w-2.5 h-2.5 mt-1 rounded-full border-2 shrink-0 ${active ? 'border-primary' : 'border-muted-foreground/30'}`} />;
  if (dir === 'left')   return <ArrowLeft  className={`${cls} ${active ? 'text-primary animate-pulse' : 'text-muted-foreground/30'}`} />;
  if (dir === 'right')  return <ArrowRight className={`${cls} ${active ? 'text-primary animate-pulse' : 'text-muted-foreground/30'}`} />;
  // straight
  return <MoveRight className={`${cls} ${active ? 'text-primary animate-pulse' : 'text-muted-foreground/30'}`} />;
};

// ─── Voice ───────────────────────────────────────────────────────────────────

function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0; u.lang = 'en-US';
  window.speechSynthesis.speak(u);
}

// ─── Component ───────────────────────────────────────────────────────────────

const NavigationControls: React.FC<NavigationControlsProps> = ({
  buildings, selectedBuildingId, selectedFloorId,
  startNodeId, endNodeId, currentFloor,
  onBuildingChange, onFloorChange, onStartChange, onEndChange,
  onNavigate, onClear, hasPath, distance,
  path, isNavigating = false, isComplete = false,
  currentNodeIndex = 0,
  onStartNav, onReset,
  voiceEnabled = true, onToggleVoice,
}) => {
  const building = buildings.find(b => b.id === selectedBuildingId);
  const [stepsOpen, setStepsOpen] = useState(true);
  const stepsRef = useRef<HTMLDivElement>(null);

  // All selectable rooms/nodes for the current building (all floors)
  const allRoomOptions = useMemo(() => {
    if (!building) return [];
    return building.floors.flatMap(floor =>
      floor.rooms.length > 0
        ? floor.rooms.map(r => ({ id: r.nodeId, name: r.name, floorName: floor.name }))
        : floor.nodes.filter(n => !n.isHallway && n.name).map(n => ({ id: n.id, name: n.name, floorName: floor.name }))
    );
  }, [building]);

  // Start options = current floor only
  const startOptions = useMemo(() => {
    if (!currentFloor) return [];
    return currentFloor.rooms.length > 0
      ? currentFloor.rooms.map(r => ({ id: r.nodeId, name: r.name, floorName: currentFloor.name }))
      : currentFloor.nodes.filter(n => !n.isHallway && n.name).map(n => ({ id: n.id, name: n.name, floorName: currentFloor.name }));
  }, [currentFloor]);

  const steps = useMemo(() => path && path.length >= 2 ? buildSteps(path) : [], [path]);
  const activeIdx = Math.min(currentNodeIndex + 1, steps.length - 1);
  const distanceM = distance !== null ? Math.round(distance / 10) : null;

  // Auto-speak active step
  const prevIdxRef = useRef(-1);
  useEffect(() => {
    if (!isNavigating || !voiceEnabled || steps.length === 0) return;
    if (activeIdx === prevIdxRef.current) return;
    prevIdxRef.current = activeIdx;
    speak(steps[activeIdx]?.instruction ?? '');
  }, [activeIdx, isNavigating, voiceEnabled, steps]);

  // Scroll active step into view
  useEffect(() => {
    if (!stepsRef.current) return;
    const el = stepsRef.current.querySelector('[data-active="true"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeIdx]);

  // ── LIVE NAVIGATION ───────────────────────────────────────────────────────
  if (isNavigating || isComplete) {
    const cur = steps[activeIdx];
    return (
      <div className="nav-card-elevated overflow-hidden space-y-0">

        {/* Green header */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: 'hsl(152 70% 22%)' }}>
          <div className="relative flex-shrink-0 w-5 h-5 flex items-center justify-center">
            <span className="absolute inset-0 rounded-full bg-white/25 animate-ping" />
            <Navigation className="relative w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/65 leading-none">
              {isComplete ? 'ARRIVED' : 'NAVIGATING'}
            </p>
            <p className="text-sm font-bold text-white mt-0.5 truncate">
              {isComplete ? '🎉 You have arrived!' : cur?.instruction ?? '…'}
            </p>
          </div>
          {onToggleVoice && (
            <button onClick={onToggleVoice}
              className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: voiceEnabled ? 'hsl(133 60% 48%)' : 'hsl(152 50% 32%)' }}>
              {voiceEnabled
                ? <Volume2 className="w-3.5 h-3.5 text-white" />
                : <VolumeX className="w-3.5 h-3.5 text-white/50" />}
            </button>
          )}
          {onReset && (
            <button onClick={onReset}
              className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'hsl(152 50% 32%)' }}>
              <RotateCcw className="w-3.5 h-3.5 text-white/75" />
            </button>
          )}
        </div>

        {/* Distance row */}
        {distanceM !== null && (
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30"
            style={{ background: 'hsl(150 15% 96%)' }}>
            <span className="text-xs text-muted-foreground font-medium">Total distance</span>
            <span className="text-base font-black text-foreground">
              {distanceM}<span className="text-xs font-semibold text-muted-foreground ml-0.5">m</span>
            </span>
          </div>
        )}

        {/* Turn-by-turn steps */}
        {steps.length > 0 && (
          <div className="px-3 pb-3">
            {/* Collapse toggle */}
            <button onClick={() => setStepsOpen(p => !p)}
              className="w-full flex items-center justify-between py-2.5 tap-scale">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <CornerDownRight className="w-3 h-3" />
                Directions
              </span>
              {stepsOpen
                ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>

            <AnimatePresence initial={false}>
              {stepsOpen && (
                <motion.div key="steps"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden">
                  <div ref={stepsRef}
                    className="space-y-0.5 max-h-[220px] overflow-y-auto scroll-touch">
                    {steps.map((step, i) => {
                      const isDone   = i < activeIdx;
                      const isActive = i === activeIdx && !isComplete;
                      const isFinal  = isComplete && i === steps.length - 1;
                      return (
                        <div key={i}
                          data-active={isActive || undefined}
                          className={`flex items-start gap-2.5 px-3 py-2 rounded-xl text-xs transition-all ${
                            isActive
                              ? 'bg-primary/10 text-foreground font-bold'
                              : isDone || isFinal
                              ? 'text-muted-foreground'
                              : 'text-muted-foreground/50'
                          }`}>
                          <StepIcon dir={step.dir} active={isActive} done={isDone || isFinal} />
                          <div className="flex-1 min-w-0 leading-snug">
                            {step.instruction}
                            {step.distanceM > 0 && (
                              <span className="ml-1.5 text-[10px] font-semibold text-muted-foreground/60">
                                ~{step.distanceM}m
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    );
  }

  // ── PLANNING VIEW ─────────────────────────────────────────────────────────
  return (
    <div className="nav-card-elevated space-y-4">
      <div>
        <h2 className="text-xl font-display font-bold text-foreground mb-0.5">Navigation</h2>
        <p className="text-sm text-muted-foreground">Choose start and destination</p>
      </div>

      {/* Building */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Building</label>
        <Select value={selectedBuildingId} onValueChange={onBuildingChange}>
          <SelectTrigger className="bg-background rounded-xl h-10 text-sm">
            <SelectValue placeholder="Select building" />
          </SelectTrigger>
          <SelectContent className="bg-popover z-50">
            {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Floor */}
      {building && building.floors.length > 1 && (
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Floor</label>
          <Select value={selectedFloorId} onValueChange={onFloorChange}>
            <SelectTrigger className="bg-background rounded-xl h-10 text-sm">
              <SelectValue placeholder="Select floor" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              {building.floors.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* From / To — selectable cards */}
      <div className="rounded-2xl border border-border/50 overflow-hidden">
        {/* From */}
        <div className="flex items-center gap-3 px-3 border-b border-border/30">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-primary flex-shrink-0" />
          <Select value={startNodeId ?? ''} onValueChange={onStartChange}>
            <SelectTrigger className="flex-1 h-11 border-0 bg-transparent text-sm p-0 focus:ring-0 [&>svg]:hidden">
              <SelectValue placeholder="Your location" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50 max-h-52">
              {startOptions.map(o => (
                <SelectItem key={o.id} value={o.id}>
                  <span className="flex items-center gap-1.5">
                    <span>{o.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Connector line */}
        <div className="flex gap-3 px-3">
          <div className="flex flex-col items-center" style={{ width: 10 }}>
            <div className="flex-1 w-px bg-border/60 my-0.5" style={{ minHeight: 6 }} />
          </div>
        </div>
        {/* To */}
        <div className="flex items-center gap-3 px-3">
          <MapPin className="w-3 h-3 text-destructive flex-shrink-0" />
          <Select value={endNodeId ?? ''} onValueChange={onEndChange}>
            <SelectTrigger className="flex-1 h-11 border-0 bg-transparent text-sm p-0 focus:ring-0 [&>svg]:hidden">
              <SelectValue placeholder="Destination" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50 max-h-52">
              {allRoomOptions.map(o => (
                <SelectItem key={o.id} value={o.id}>
                  <span className="flex items-center gap-1.5">
                    <span>{o.name}</span>
                    {o.floorName && (
                      <span className="text-[10px] text-muted-foreground">({o.floorName})</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Navigate + Clear */}
      <div className="flex gap-2">
        <button
          onClick={onNavigate}
          disabled={!startNodeId || !endNodeId || startNodeId === endNodeId}
          className="flex-1 h-12 rounded-2xl font-bold text-sm text-white disabled:opacity-30 tap-scale flex items-center justify-center gap-2 transition-all"
          style={{ background: 'hsl(152 70% 22%)' }}>
          <Navigation className="w-4 h-4" />
          Navigate
        </button>
        {hasPath && (
          <button onClick={onClear}
            className="h-12 w-12 rounded-2xl bg-muted/70 flex items-center justify-center border border-border/50 tap-scale">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Path info: distance + voice + start */}
      <AnimatePresence>
        {hasPath && distanceM !== null && (
          <motion.div key="path-info"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="space-y-3">
            {/* Distance + voice toggle */}
            <div className="flex items-center justify-between rounded-2xl px-4 py-3 border border-border/40"
              style={{ background: 'hsl(150 15% 95%)' }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Distance</p>
                <p className="text-2xl font-black text-foreground font-display leading-tight">
                  {distanceM}<span className="text-sm font-semibold text-muted-foreground ml-1">m</span>
                </p>
              </div>
              {onToggleVoice && (
                <button onClick={onToggleVoice}
                  className="w-11 h-11 rounded-2xl flex items-center justify-center border border-border/50 tap-scale"
                  style={{ background: voiceEnabled ? 'hsl(133 60% 48% / 0.12)' : 'hsl(150 15% 90%)' }}
                  title={voiceEnabled ? 'Voice on' : 'Voice off'}>
                  {voiceEnabled
                    ? <Volume2 className="w-5 h-5" style={{ color: 'hsl(133 60% 38%)' }} />
                    : <VolumeX className="w-5 h-5 text-muted-foreground" />}
                </button>
              )}
            </div>

            {/* Preview steps (collapsed by default in planning mode) */}
            {steps.length > 0 && (
              <div className="rounded-2xl border border-border/40 overflow-hidden">
                <button onClick={() => setStepsOpen(p => !p)}
                  className="w-full flex items-center justify-between px-4 py-3 tap-scale">
                  <span className="text-xs font-bold text-foreground flex items-center gap-2">
                    <CornerDownRight className="w-3.5 h-3.5 text-primary" />
                    Directions · {steps.length} steps
                  </span>
                  {stepsOpen
                    ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
                <AnimatePresence initial={false}>
                  {stepsOpen && (
                    <motion.div key="preview-steps"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden">
                      <div className="px-3 pb-3 space-y-0.5 max-h-[180px] overflow-y-auto scroll-touch border-t border-border/30">
                        {steps.map((step, i) => (
                          <div key={i}
                            className="flex items-start gap-2.5 px-3 py-1.5 rounded-xl text-xs text-muted-foreground">
                            <StepIcon dir={step.dir} />
                            <span className="flex-1 leading-snug">
                              {step.instruction}
                              {step.distanceM > 0 && (
                                <span className="ml-1.5 text-[10px] font-semibold text-muted-foreground/50">
                                  ~{step.distanceM}m
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Start walking */}
            {onStartNav && (
              <button onClick={onStartNav}
                className="w-full h-12 rounded-2xl font-bold text-sm text-white tap-scale flex items-center justify-center gap-2"
                style={{ background: 'hsl(133 60% 45%)' }}>
                <Play className="w-4 h-4" />
                Start Walking
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NavigationControls;