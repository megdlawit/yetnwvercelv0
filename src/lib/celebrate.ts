// A short burst of confetti for milestones (finishing the tour, first
// publish). No library; skipped for people who prefer reduced motion.

const COLORS = ['#22c55e', '#0f5e3a', '#facc15', '#38bdf8', '#f97316', '#a78bfa'];

export function celebrate(durationMs = 2600) {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '200' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);

  const parts = Array.from({ length: 160 }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? -10 : innerWidth + 10, y: innerHeight * (0.55 + Math.random() * 0.3),
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 9), vy: -(10 + Math.random() * 12),
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      color: COLORS[i % COLORS.length],
    };
  });
  const start = performance.now();
  const frame = (t: number) => {
    const elapsed = t - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.38; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - elapsed / durationMs);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)));
      ctx.restore();
    }
    if (elapsed < durationMs) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}

// ── the venue-building celebration ───────────────────────────────────────────

interface Stack {
  bx: number; by: number;          // base centre on screen
  w: number; d: number;            // footprint along the two iso axes (px)
  floors: number; delay: number;
  plan: [number, number, number, number][]; // room lines on each floor, footprint units (-0.5…0.5)
  room: [number, number, number, number];   // the highlighted room on the top floor
  pin: boolean;
}

const ISO_C = Math.cos(Math.PI / 6), ISO_S = 0.5;
const SLAB_T = 7, FLOOR_GAP = 15;
const FLOOR_MS = 120, LAND_MS = 380;
const easeOutBack = (t: number) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * The venue-building celebration, in the app's own language: glass venues
 * assemble floor by floor from both sides of the screen (like the stacked
 * floors of the 3D view, each showing its plan), map pins drop onto them,
 * and a glowing walking route draws itself between them — a "you are here"
 * dot walks it to the destination pin. The middle stays clear for the
 * dialog. Used when a venue, a floor or a tour is done; skipped for people
 * who prefer reduced motion.
 */
export function celebrateBuild(durationMs = 4600) {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = innerWidth, H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '200' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);

  const narrow = W < 700;
  const sc = Math.max(0.55, Math.min(1.15, Math.min(W / 1440, H / 860) * 1.05));
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const plan = (): [number, number, number, number][] => {
    const a = rnd(-0.2, 0.15), b = rnd(-0.15, 0.2);
    return [[a, -0.5, a, 0.5], [-0.5, b, a, b], [a, rnd(-0.3, 0.3), 0.5, rnd(-0.3, 0.3)]];
  };

  // Each side: a tall venue at the back, then smaller ones stepping toward the middle.
  const layout = narrow
    ? [{ x: 0.1, y: 205, w: 104, floors: 6 }, { x: 0.24, y: 125, w: 84, floors: 3 }]
    : [{ x: 0.07, y: 250, w: 132, floors: 7 }, { x: 0.165, y: 175, w: 108, floors: 5 }, { x: 0.245, y: 112, w: 88, floors: 3 }];
  const stacks: Stack[] = [];
  layout.forEach((l, i) => {
    for (const side of [-1, 1] as const) {
      const w = l.w * sc, d = l.w * sc * rnd(0.82, 1);
      stacks.push({
        bx: side === -1 ? W * l.x : W * (1 - l.x), by: H - l.y * sc, w, d, floors: l.floors,
        delay: i * 260 + (side === 1 ? 120 : 0), plan: plan(),
        room: [rnd(-0.45, 0), rnd(-0.45, 0), rnd(0.18, 0.3), rnd(0.18, 0.3)], pin: i === 0,
      });
    }
  });
  stacks.sort((a, b) => a.by - b.by); // back to front

  // The walking route: from the nearest venue on the left to the nearest on the right, zig-zagging along the iso grid like corridors.
  const fronts = [...stacks].sort((a, b) => b.by - a.by);
  const from = fronts.find(s => s.bx < W / 2)!, to = fronts.find(s => s.bx > W / 2)!;
  const S = { x: from.bx + (from.w / 2 - from.d / 2) * ISO_C, y: from.by + (from.w + from.d) / 2 * ISO_S + 8 * sc };
  const E = { x: to.bx + (to.w / 2 - to.d / 2) * ISO_C, y: to.by + (to.w + to.d) / 2 * ISO_S + 8 * sc };
  const route = [S];
  const pairs = narrow ? 2 : 4;
  for (let i = 0; i < pairs; i++) {
    const dx = (E.x - S.x) / pairs, dy = (E.y - S.y) / pairs;
    const a = (dx / ISO_C + dy / ISO_S) / 2, b = (dx / ISO_C - dy / ISO_S) / 2;
    const p = route[route.length - 1];
    const m = { x: p.x + a * ISO_C, y: p.y + a * ISO_S };
    route.push(m, { x: m.x + b * ISO_C, y: m.y - b * ISO_S });
  }
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y));
  const L = cum[cum.length - 1];
  const at = (len: number) => {
    let i = 1;
    while (i < route.length - 1 && cum[i] < len) i++;
    const k = clamp01((len - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]));
    return { x: route[i - 1].x + (route[i].x - route[i - 1].x) * k, y: route[i - 1].y + (route[i].y - route[i - 1].y) * k, i };
  };
  const lastLanding = Math.max(...stacks.map(s => s.delay + (s.floors - 1) * FLOOR_MS + LAND_MS));
  const ROUTE_START = Math.min(lastLanding - 200, 1500), ROUTE_MS = 1300;
  const ARRIVE = ROUTE_START + ROUTE_MS;

  const iso = (s: Stack, x: number, z: number, y: number) => ({ x: s.bx + (x * s.w - z * s.d) * ISO_C, y: s.by + (x * s.w + z * s.d) * ISO_S - y });
  const poly = (pts: { x: number; y: number }[]) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };

  /** One floor slab: glass top with its plan, two front faces, crisp edges. */
  const slab = (s: Stack, y: number, alpha: number, top: boolean) => {
    const t = SLAB_T * sc;
    const c = (x: number, z: number, yy: number) => iso(s, x, z, yy);
    ctx.globalAlpha = alpha;
    // Front faces (toward the viewer: +x and +z).
    ctx.fillStyle = 'rgba(15, 94, 58, 0.88)';
    poly([c(-0.5, 0.5, y + t), c(0.5, 0.5, y + t), c(0.5, 0.5, y), c(-0.5, 0.5, y)]); ctx.fill();
    ctx.fillStyle = 'rgba(10, 66, 41, 0.92)';
    poly([c(0.5, -0.5, y + t), c(0.5, 0.5, y + t), c(0.5, 0.5, y), c(0.5, -0.5, y)]); ctx.fill();
    // Glass top.
    const g = ctx.createLinearGradient(c(-0.5, -0.5, 0).x, c(-0.5, -0.5, y + t).y, c(0.5, 0.5, 0).x, c(0.5, 0.5, y + t).y);
    g.addColorStop(0, 'rgba(187, 247, 208, 0.55)'); g.addColorStop(1, 'rgba(34, 197, 94, 0.32)');
    ctx.fillStyle = g;
    poly([c(-0.5, -0.5, y + t), c(0.5, -0.5, y + t), c(0.5, 0.5, y + t), c(-0.5, 0.5, y + t)]); ctx.fill();
    if (top) {
      const [rx, rz, rw, rd] = s.room;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
      poly([c(rx, rz, y + t), c(rx + rw, rz, y + t), c(rx + rw, rz + rd, y + t), c(rx, rz + rd, y + t)]); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [x1, z1, x2, z2] of s.plan) { const p = c(x1, z1, y + t), q = c(x2, z2, y + t); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(220, 252, 231, 0.95)'; ctx.lineWidth = 1.3;
    poly([c(-0.5, -0.5, y + t), c(0.5, -0.5, y + t), c(0.5, 0.5, y + t), c(-0.5, 0.5, y + t)]); ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /** A map pin standing on a point, with its ripple. */
  const pin = (x: number, y: number, el: number, start: number, color: string, ripple: string, fade: number) => {
    const k = clamp01((el - start) / 520);
    if (k <= 0) return;
    const r = 11 * sc;
    if (k >= 0.55) {
      const rk = clamp01((el - start - 290) / 900);
      for (const off of [0, 0.35]) {
        const q = clamp01(rk - off);
        if (q <= 0 || q >= 1) continue;
        ctx.strokeStyle = ripple.replace('A', String(0.7 * (1 - q) * fade)); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y, r * (1 + q * 3.4), r * (1 + q * 3.4) * ISO_S, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    const drop = k < 0.55 ? (1 - easeOut(k / 0.55)) * -140 * sc : Math.sin(clamp01((k - 0.55) / 0.45) * Math.PI) * -7 * sc;
    const py = y + drop;
    ctx.globalAlpha = Math.min(1, k * 3) * fade;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.7, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, py);
    ctx.bezierCurveTo(x - r * 0.35, py - r * 0.9, x - r, py - r * 1.25, x - r, py - r * 2.05);
    ctx.arc(x, py - r * 2.05, r, Math.PI, 0);
    ctx.bezierCurveTo(x + r, py - r * 1.25, x + r * 0.35, py - r * 0.9, x, py);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, py - r * 2.05, r * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  };

  const start = performance.now();
  const frame = (now: number) => {
    const el = now - start;
    const out = clamp01((el - durationMs * 0.8) / (durationMs * 0.2));
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.translate(0, out * 40 * sc);
    const fade = 1 - out;

    // A faint iso grid along the bottom, like the plan's ground.
    const gridA = clamp01(el / 500) * fade;
    if (gridA > 0) {
      const top = H * 0.52, step = 44 * sc;
      const g = ctx.createLinearGradient(0, top, 0, H);
      g.addColorStop(0, 'rgba(15, 94, 58, 0)'); g.addColorStop(1, `rgba(15, 94, 58, ${0.16 * gridA})`);
      ctx.strokeStyle = g; ctx.lineWidth = 1;
      ctx.beginPath();
      const span = H - top;
      for (let x = -span * 2; x < W + span * 2; x += step / ISO_C) {
        ctx.moveTo(x, top); ctx.lineTo(x + span * ISO_C / ISO_S, H);
        ctx.moveTo(x, top); ctx.lineTo(x - span * ISO_C / ISO_S, H);
      }
      ctx.stroke();
    }

    // The route (under the venues' fronts but over the ground).
    const rk = clamp01((el - ROUTE_START) / ROUTE_MS);
    if (rk > 0) {
      const len = easeOut(rk) * L;
      const tip = at(len);
      const drawTo = () => { ctx.beginPath(); ctx.moveTo(route[0].x, route[0].y); for (let i = 1; i < tip.i; i++) ctx.lineTo(route[i].x, route[i].y); ctx.lineTo(tip.x, tip.y); };
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.globalAlpha = fade;
      drawTo(); ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)'; ctx.lineWidth = 14 * sc; ctx.stroke();
      drawTo(); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 4 * sc; ctx.stroke();
      if (rk >= 1) {
        drawTo(); ctx.setLineDash([3 * sc, 11 * sc]); ctx.lineDashOffset = -el / 28;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'; ctx.lineWidth = 2.4 * sc; ctx.stroke(); ctx.setLineDash([]);
      }
      // The walker: a "you are here" dot riding the tip.
      const halo = 9 * sc + Math.sin(el / 160) * 2.5 * sc;
      ctx.fillStyle = 'rgba(59, 130, 246, 0.25)'; ctx.beginPath(); ctx.arc(tip.x, tip.y, halo + 6 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(tip.x, tip.y, 8 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.arc(tip.x, tip.y, 5.6 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // The venues, back to front, floor by floor.
    for (const s of stacks) {
      for (let f = 0; f < s.floors; f++) {
        const k = clamp01((el - s.delay - f * FLOOR_MS) / LAND_MS);
        if (k <= 0) break;
        const y = f * (SLAB_T + FLOOR_GAP) * sc;
        const lift = (1 - easeOutBack(k)) * 70 * sc;
        // Glass mullions joining this floor to the one below.
        if (f > 0 && k > 0.6) {
          ctx.globalAlpha = 0.45 * fade * clamp01((k - 0.6) / 0.4);
          ctx.strokeStyle = 'rgba(187, 247, 208, 0.9)'; ctx.lineWidth = 1;
          ctx.beginPath();
          for (const [x, z] of [[-0.5, 0.5], [0.5, 0.5], [0.5, -0.5]] as const) {
            const a = iso(s, x, z, y), b = iso(s, x, z, y - FLOOR_GAP * sc);
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        slab(s, y + lift, Math.min(1, k * 2) * fade, f === s.floors - 1);
      }
      if (s.pin) {
        const topY = (s.floors - 1) * (SLAB_T + FLOOR_GAP) * sc + SLAB_T * sc;
        const c = iso(s, 0, 0, topY);
        pin(c.x, c.y, el, s.delay + (s.floors - 1) * FLOOR_MS + LAND_MS - 60, '#16a34a', 'rgba(34, 197, 94, A)', fade);
      }
    }

    // The destination: a pin where the route ends.
    if (el > ARRIVE - 80) {
      pin(E.x, E.y, el, ARRIVE - 80, '#0f5e3a', 'rgba(56, 189, 248, A)', fade);
    }
    ctx.restore();
    if (el < durationMs) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}
