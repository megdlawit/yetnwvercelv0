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

const BLOCK_COLORS = ['#16a34a', '#0f5e3a', '#38bdf8', '#f59e0b', '#a78bfa', '#34d399'];

/** Shade a hex colour: f > 0 lighter, f < 0 darker. */
function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c: number) => Math.round(f > 0 ? c + (255 - c) * f : c * (1 + f));
  return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

/**
 * The venue-building celebration: isometric blocks burst up and tumble like a
 * structure going up, and little blueprint plans (walls and a door swing)
 * float among them. Used when a venue, a floor or the editor tour is done.
 */
export function celebrateBuild(durationMs = 2800) {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '200' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  // Blocks fan out from the bottom centre and arc back down.
  const blocks = Array.from({ length: 70 }, (_, i) => ({
    x: innerWidth / 2 + rnd(-innerWidth * 0.18, innerWidth * 0.18), y: innerHeight + 20,
    vx: rnd(-7, 7), vy: -rnd(13, 22), size: rnd(9, 20), rot: rnd(0, Math.PI), vr: rnd(-0.08, 0.08),
    color: BLOCK_COLORS[i % BLOCK_COLORS.length], delay: rnd(0, 380),
  }));
  // Blueprint plan tiles drift upward and fade.
  const plans = Array.from({ length: 12 }, () => ({
    x: rnd(innerWidth * 0.1, innerWidth * 0.9), y: innerHeight + rnd(20, 160), vy: -rnd(1.4, 2.6),
    size: rnd(34, 58), rot: rnd(-0.4, 0.4), vr: rnd(-0.006, 0.006),
  }));

  // An isometric cube centred on (0, 0): top, left and right faces.
  const cube = (s: number, color: string) => {
    const h = s * 0.5;
    ctx.fillStyle = shade(color, 0.35);
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s, -h); ctx.lineTo(0, 0); ctx.lineTo(-s, -h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(-s, -h); ctx.lineTo(0, 0); ctx.lineTo(0, s); ctx.lineTo(-s, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(color, -0.3);
    ctx.beginPath(); ctx.moveTo(s, -h); ctx.lineTo(0, 0); ctx.lineTo(0, s); ctx.lineTo(s, h); ctx.closePath(); ctx.fill();
  };
  // A tiny floor plan: outline, an inner wall and a door swing.
  const plan = (s: number) => {
    ctx.strokeStyle = 'rgba(14, 116, 144, 0.85)'; ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(224, 242, 254, 0.75)';
    ctx.beginPath(); ctx.rect(-s / 2, -s / 2, s, s * 0.7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -s / 2); ctx.lineTo(0, s * 0.2 - s * 0.25); ctx.stroke();
    ctx.beginPath(); ctx.arc(-s / 2 + s * 0.18, s * 0.2, s * 0.18, -Math.PI / 2, 0); ctx.stroke();
  };

  const start = performance.now();
  const frame = (t: number) => {
    const elapsed = t - start;
    const fade = Math.max(0, 1 - Math.max(0, elapsed - durationMs * 0.6) / (durationMs * 0.4));
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = fade;
    for (const p of plans) {
      p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); plan(p.size); ctx.restore();
    }
    for (const b of blocks) {
      if (elapsed < b.delay) continue;
      b.vy += 0.42; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.rot += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot); cube(b.size, b.color); ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (elapsed < durationMs) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}
