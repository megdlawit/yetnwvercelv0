// Place and room names over the 3D scene, as HTML (crisp text in any
// language, Ethiopic included). Tags are the Indoor landmark tags: white,
// rounded, a dot in the place's colour, a bold name and an optional second
// line ("3 min walk"). They avoid each other: a lower-priority tag that
// would overlap one already shown waits until there is room.
//
// Styles are scoped to the viewer's root (.ivw-*), injected into it — no
// global CSS, safe inside any host page.

import * as THREE from 'three';

export interface LabelSpec {
  id: string;
  text: string;
  sub?: string | null;
  color?: string | null;
  /** Rooms are quieter than places. */
  kind: 'place' | 'room' | 'note';
  floorId: string;
  at: THREE.Vector3;
  /** Higher shows first when tags collide. */
  priority: number;
}

export const LABEL_CSS = `
.ivw-root{position:relative;overflow:hidden;font-family:'Indoor Inter',Inter,'Noto Sans Ethiopic',system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-tap-highlight-color:transparent}
.ivw-root canvas{display:block;width:100%;height:100%;touch-action:none;outline:none}
.ivw-labels{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.ivw-tag{position:absolute;left:0;top:0;display:flex;flex-direction:column;gap:1px;white-space:nowrap;border:0;margin:0;cursor:pointer;pointer-events:auto;
  border-radius:12px;padding:6px 12px 6px 10px;background:rgba(255,255,255,.95);color:#0f3d26;box-shadow:0 10px 24px rgba(20,40,25,.18);
  transform-origin:50% 100%;transition:opacity .2s,background .2s,color .2s;font:inherit;text-align:left;will-change:transform}
.ivw-tag b{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;line-height:1.2}
.ivw-tag i{width:8px;height:8px;border-radius:50%;flex:none;background:var(--c,#0f3d26)}
.ivw-tag small{font-size:10.5px;font-weight:600;line-height:1.2;color:#6b7168}
.ivw-tag:hover{background:#fff}
.ivw-tag.ivw-on{background:#0f3d26;color:#fff}
.ivw-tag.ivw-on small{color:rgba(255,255,255,.72)}
.ivw-tag.ivw-room{background:rgba(255,255,255,.72);box-shadow:none;padding:2px 8px;border-radius:8px;cursor:default;pointer-events:none}
.ivw-tag.ivw-room b{font-size:11px;font-weight:600;color:#3f4a43}
.ivw-tag.ivw-note{background:transparent;box-shadow:none;padding:0;pointer-events:none}
.ivw-tag.ivw-note b{font-size:11px;font-weight:600;color:#6b7168}
.ivw-tag:focus-visible{outline:3px solid #3ea44a;outline-offset:2px}
@media (max-width:640px){.ivw-tag small{display:none}.ivw-tag.ivw-on small{display:block}}
.ivw-walkbar{position:absolute;left:50%;top:var(--ivw-walkbar-top,14px);z-index:22;transform:translateX(-50%);width:min(620px,calc(100% - 28px));box-sizing:border-box;
  border-radius:22px;border:1px solid rgba(255,255,255,.8);background:rgba(255,253,248,.9);color:#0f3d26;padding:10px 12px 11px;
  box-shadow:0 16px 40px rgba(30,20,10,.16);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5);animation:ivw-in .35s both}
.ivw-walkbar[hidden]{display:none}
@keyframes ivw-in{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
.ivw-walkhead{display:flex;align-items:center;gap:8px;min-width:0}
.ivw-walkhead b{font-size:15px;font-weight:700;line-height:1.2;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ivw-walkhead small{flex:0 1 auto;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:600;color:#6b7168}
.ivw-walkbar .ivw-dot{width:9px;height:9px;border-radius:50%;background:#3fdc2c;flex:none;box-shadow:0 0 0 3px rgba(63,220,44,.25)}
.ivw-stop{flex:none;border:0;border-radius:999px;background:#0f3d26;color:#fff;font:inherit;font-size:12.5px;font-weight:700;padding:6px 14px;cursor:pointer}
.ivw-chips{display:flex;gap:6px;margin-top:9px;overflow-x:auto;scrollbar-width:none;padding-bottom:1px}
.ivw-chips::-webkit-scrollbar{display:none}
.ivw-chips button{flex:none;display:inline-flex;align-items:center;gap:6px;border:0;border-radius:999px;background:#fff;color:#0f3d26;font:inherit;font-size:13px;font-weight:600;
  padding:7px 12px 7px 10px;box-shadow:inset 0 0 0 1px rgba(15,61,38,.12);cursor:pointer;white-space:nowrap}
.ivw-chips button:hover{background:#0f3d26;color:#fff}
.ivw-chips button:hover small{color:rgba(255,255,255,.75)}
.ivw-chips button:disabled{opacity:.45;cursor:default}
.ivw-chips button i{width:8px;height:8px;border-radius:50%;flex:none}
.ivw-chips small{font-size:11px;font-weight:600;color:#6b7168}
.ivw-walkbar button:focus-visible{outline:3px solid #3ea44a;outline-offset:2px}
@media (prefers-reduced-motion:reduce){.ivw-tag{transition:none}}
`;

interface Item { spec: LabelSpec; el: HTMLButtonElement; w: number; h: number; shown: boolean }

export class LabelLayer {
  readonly root: HTMLDivElement;
  private items = new Map<string, Item>();
  private selected: string | null = null;
  private v = new THREE.Vector3();

  constructor(parent: HTMLElement, private onPick: (id: string) => void) {
    this.root = document.createElement('div');
    this.root.className = 'ivw-labels';
    parent.appendChild(this.root);
  }

  set(specs: LabelSpec[]) {
    const keep = new Set(specs.map(s => s.id));
    for (const [id, it] of this.items) if (!keep.has(id)) { it.el.remove(); this.items.delete(id); }
    for (const spec of specs) {
      let it = this.items.get(spec.id);
      if (!it) {
        const el = document.createElement('button');
        el.type = 'button';
        el.addEventListener('click', e => { e.stopPropagation(); const cur = this.items.get(spec.id); if (cur?.spec.kind === 'place') this.onPick(cur.spec.id); });
        this.root.appendChild(el);
        it = { spec, el, w: 0, h: 0, shown: false };
        this.items.set(spec.id, it);
      }
      it.spec = spec;
      const el = it.el;
      el.className = `ivw-tag${spec.kind === 'room' ? ' ivw-room' : spec.kind === 'note' ? ' ivw-note' : ''}${this.selected === spec.id ? ' ivw-on' : ''}`;
      el.setAttribute('aria-label', spec.sub ? `${spec.text}, ${spec.sub}` : spec.text);
      el.tabIndex = spec.kind === 'place' ? 0 : -1;
      el.style.setProperty('--c', spec.color ?? '#0f3d26');
      el.replaceChildren();
      const b = document.createElement('b');
      if (spec.kind === 'place') b.appendChild(document.createElement('i'));
      b.appendChild(document.createTextNode(spec.text));
      el.appendChild(b);
      if (spec.sub) { const s = document.createElement('small'); s.textContent = spec.sub; el.appendChild(s); }
      it.w = 0; // re-measure
    }
  }

  select(id: string | null) {
    this.selected = id;
    for (const [k, it] of this.items) it.el.classList.toggle('ivw-on', k === id);
  }

  /** Place every tag on screen; hide those off-screen, behind, on hidden floors, or crowded out. */
  update(camera: THREE.Camera, width: number, height: number, floorVisible: (floorId: string) => number, inView?: (at: THREE.Vector3) => boolean) {
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const order = [...this.items.values()].sort((a, b) => (b.spec.id === this.selected ? 1e9 : b.spec.priority) - (a.spec.id === this.selected ? 1e9 : a.spec.priority));
    for (const it of order) {
      const vis = floorVisible(it.spec.floorId);
      this.v.copy(it.spec.at).project(camera);
      const onScreen = vis > 0.05 && this.v.z < 1 && this.v.z > -1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      if (!onScreen || (inView && it.spec.id !== this.selected && !inView(it.spec.at))) { this.hide(it); continue; }
      if (!it.w) { it.w = it.el.offsetWidth || 80; it.h = it.el.offsetHeight || 24; }
      const x = ((this.v.x + 1) / 2) * width, y = ((1 - this.v.y) / 2) * height;
      const r = { x0: x - it.w / 2, y0: y - it.h - 6, x1: x + it.w / 2, y1: y - 6 };
      const pad = it.spec.kind === 'room' ? 2 : 4;
      const clash = it.spec.id !== this.selected && placed.some(p => r.x0 < p.x1 + pad && r.x1 > p.x0 - pad && r.y0 < p.y1 + pad && r.y1 > p.y0 - pad);
      if (clash) { this.hide(it); continue; }
      placed.push(r);
      it.el.style.transform = `translate(${Math.round(r.x0)}px, ${Math.round(r.y0)}px)`;
      it.el.style.opacity = String(Math.min(1, vis));
      it.el.style.visibility = 'visible';
      it.el.style.zIndex = String(it.spec.id === this.selected ? 10000 : Math.round(1000 - this.v.z * 500));
      it.shown = true;
    }
  }

  private hide(it: Item) {
    if (!it.shown && it.el.style.visibility === 'hidden') return;
    it.el.style.visibility = 'hidden';
    it.shown = false;
  }

  dispose() { this.root.remove(); this.items.clear(); }
}
