// The editor's "3D" fields — what the 3D world and turn-by-turn guidance
// need beyond the 2D shape: wall thickness / height / material; doors,
// arches and windows (size, sill); stairs and lifts (which floors, steps,
// landing, step-free); rooms (Amharic name, floor finish, ceiling); and the
// floor itself (height above ground, ceiling height, Amharic name).
//
// Values are the rows' own columns (20261006090000); blank = the default.

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type Extra = Record<string, unknown>;
type Patch = (patch: Extra, label: string) => void;

const box = 'rounded-lg border p-3 space-y-2.5';
const lbl = 'block text-[11px] text-muted-foreground';
const sel = 'mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs text-foreground';

function Num({ label, value, placeholder, step = 0.1, min, onCommit }: { label: string; value: unknown; placeholder?: string; step?: number; min?: number; onCommit: (v: number | null) => void }) {
  const v = typeof value === 'number' ? value : null;
  return (
    <label className={lbl}>{label}
      <Input type="number" step={step} min={min} className="mt-1 h-8 text-xs" placeholder={placeholder} defaultValue={v ?? ''} key={`${label}-${v}`}
        onBlur={e => {
          const raw = e.target.value.trim();
          const n = raw === '' ? null : Number(raw);
          if (n !== null && !Number.isFinite(n)) return;
          if (n !== v) onCommit(n);
        }}
        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

function Text({ label, value, placeholder, onCommit, dir }: { label: string; value: unknown; placeholder?: string; onCommit: (v: string | null) => void; dir?: 'ltr' | 'auto' }) {
  const v = typeof value === 'string' ? value : '';
  return (
    <label className={lbl}>{label}
      <Input className="mt-1 h-8 text-xs" dir={dir} placeholder={placeholder} defaultValue={v} key={`${label}-${v}`} lang="am"
        onBlur={e => { const n = e.target.value.trim(); if (n !== v) onCommit(n || null); }}
        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

export function WallFields({ x, onPatch, ceiling }: { x: Extra; onPatch: Patch; ceiling: number }) {
  return (
    <section className={box}>
      <h4 className="text-[10px] font-bold uppercase tracking-[.14em] text-moss">3D wall</h4>
      <div className="grid grid-cols-2 gap-2">
        <Num label="Thickness m" value={x.thickness_m} placeholder="0.18" step={0.01} min={0.03} onCommit={v => onPatch({ thickness_m: v }, 'Wall thickness')} />
        <Num label="Height m" value={x.height_m} placeholder={ceiling.toFixed(1)} min={0.3} onCommit={v => onPatch({ height_m: v }, 'Wall height')} />
      </div>
      <label className={lbl}>Material
        <select className={sel} value={(x.material as string) ?? 'plaster'} onChange={e => onPatch({ material: e.target.value }, 'Wall material')}>
          {['plaster', 'brick', 'concrete', 'glass', 'wood', 'stone'].map(m => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
        </select>
      </label>
    </section>
  );
}

export function OpeningFields({ kind, x, onPatch, anchored }: { kind: 'door' | 'arch' | 'window'; x: Extra; onPatch: Patch; anchored: boolean }) {
  return (
    <section className={box}>
      <h4 className="text-[10px] font-bold uppercase tracking-[.14em] text-moss">Opening in 3D</h4>
      <p className={cn('text-[11px]', anchored ? 'text-muted-foreground' : 'text-amber-600')}>
        {anchored ? 'Cut into the wall it sits on.' : 'Not on a wall yet — drag it onto one to cut an opening.'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Num label="Height m" value={x.height_m} placeholder={kind === 'window' ? '1.2' : kind === 'arch' ? '2.3' : '2.1'} min={0.2} onCommit={v => onPatch({ height_m: v }, 'Opening height')} />
        {kind === 'window' && <Num label="Sill m" value={x.sill_m} placeholder="0.9" min={0} onCommit={v => onPatch({ sill_m: v }, 'Window sill')} />}
      </div>
    </section>
  );
}

export function ConnectorFields({ kind, x, onPatch, floors, floorId }: { kind: 'stairs' | 'elevator'; x: Extra; onPatch: Patch; floors: { id: string; name: string; level: number }[]; floorId: string }) {
  const others = floors.filter(f => f.id !== floorId);
  const here = floors.find(f => f.id === floorId);
  const above = [...floors].sort((a, b) => a.level - b.level).find(f => here && f.level > here.level);
  return (
    <section className={box}>
      <h4 className="text-[10px] font-bold uppercase tracking-[.14em] text-moss">{kind === 'stairs' ? 'Stairs' : 'Lift'} between floors</h4>
      <label className={lbl}>Goes to
        <select className={sel} value={(x.to_floor_id as string) ?? ''} onChange={e => onPatch({ to_floor_id: e.target.value || null }, 'Stairs destination')}>
          <option value="">{above ? `The floor above (${above.name})` : 'No floor above — add one'}</option>
          {others.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      {kind === 'stairs' && (
        <div className="grid grid-cols-2 gap-2">
          <Num label="Steps" value={x.step_count} placeholder="auto" step={1} min={2} onCommit={v => onPatch({ step_count: v == null ? null : Math.round(v) }, 'Step count')} />
          <label className={lbl}>Landing
            <select className={sel} value={(x.landing as string) ?? ''} onChange={e => onPatch({ landing: e.target.value || null }, 'Stairs landing')}>
              <option value="">Auto</option><option value="none">None</option><option value="mid">Half way</option><option value="top">At the top</option>
            </select>
          </label>
        </div>
      )}
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" className="accent-[#0f3d26]" checked={x.accessible == null ? kind === 'elevator' : !!x.accessible}
          onChange={e => onPatch({ accessible: e.target.checked }, 'Step-free')} />
        Step-free (wheelchairs, prams)
      </label>
      <p className="text-[11px] text-muted-foreground">It climbs along its depth; turn it so the arrow in 2D points up the stairs.</p>
    </section>
  );
}

export function RoomFields({ x, onPatch }: { x: Extra; onPatch: Patch }) {
  return (
    <section className={box}>
      <h4 className="text-[10px] font-bold uppercase tracking-[.14em] text-moss">3D & languages</h4>
      <Text label="Name in Amharic" value={x.name_am} placeholder="ለምሳሌ፦ ካፌ" onCommit={v => onPatch({ name_am: v }, 'Amharic name')} />
      <label className={lbl}>Floor finish
        <select className={sel} value={(x.floor_material as string) ?? 'tile'} onChange={e => onPatch({ floor_material: e.target.value }, 'Floor finish')}>
          {['tile', 'wood', 'carpet', 'concrete', 'stone', 'marble', 'grass'].map(m => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" className="accent-[#0f3d26]" checked={x.has_ceiling !== false} onChange={e => onPatch({ has_ceiling: e.target.checked }, 'Ceiling')} />
        Has a ceiling (off for courtyards and atriums)
      </label>
    </section>
  );
}

export function FloorFields({ x, onPatch, level }: { x: Extra; onPatch: Patch; level: number }) {
  return (
    <section className={box}>
      <h4 className="text-[10px] font-bold uppercase tracking-[.14em] text-moss">This floor in 3D</h4>
      <div className="grid grid-cols-2 gap-2">
        <Num label="Height above ground m" value={x.elevation_m} placeholder={(level * 3.5).toFixed(1)} onCommit={v => onPatch({ elevation_m: v }, 'Floor height')} />
        <Num label="Ceiling height m" value={x.ceiling_height_m} placeholder="2.8" min={2} onCommit={v => onPatch({ ceiling_height_m: v }, 'Ceiling height')} />
      </div>
      <Text label="Floor name in Amharic" value={x.name_am} placeholder="ለምሳሌ፦ አንደኛ ፎቅ" onCommit={v => onPatch({ name_am: v }, 'Amharic floor name')} />
    </section>
  );
}
