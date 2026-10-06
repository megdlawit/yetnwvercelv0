import { useEffect, useRef } from 'react';

type Props = { onReveal?: () => void; onHero?: () => void; onDone?: () => void };

const W1 = 'Welcome to', W2 = 'Unity Park';
const TARGET: [string, boolean][] = [['Where do you', false], ['want to ', false], ['go?', true]];

const DISPLAY = "font-bricolage font-bold tracking-[-.032em] text-ink [font-variation-settings:'opsz'_96]";
const ITALIC = 'font-instrument font-normal italic tracking-[-.01em]';
const FOG = 'absolute rounded-full opacity-90 blur-[60px] will-change-transform';

/** Animated letters: each one is moved by CSS vars the animation loop writes (--y entrance, --px/--h push-aside). */
const LETTER =
  'inline-block opacity-0 transition-colors duration-[250ms] is-lit:text-[#6fd24e] ' +
  '[transform:translate(var(--px,0px),calc(var(--y,0px)_+_var(--h,0px)))]';

function Letters({ text, measure }: { text: string; measure?: boolean }) {
  return (
    <>
      {[...text].map((c, i) =>
        c === ' ' ? <span key={i} className="inline-block w-[.24em]" />
          : <span key={i} data-l="" className={measure ? 'inline-block' : LETTER}>{c}</span>)}
    </>
  );
}

/**
 * Intro: Hello → "Welcome to Unity Park" → a 3D navigation arrow launches through the words,
 * rewriting them into "Where do you want to go?" as it passes → the headline glides into the hero
 * while the map clears out of the fog.
 */
export function Intro({ onReveal, onHero, onDone }: Props) {
  const root = useRef<HTMLDivElement>(null), fogR = useRef<HTMLDivElement>(null), hello = useRef<HTMLDivElement>(null);
  const wel = useRef<HTMLDivElement>(null), whr = useRef<HTMLDivElement>(null), whS = useRef<HTMLDivElement>(null), mor = useRef<HTMLDivElement>(null);
  const svgR = useRef<SVGSVGElement>(null), glowBand = useRef<HTMLDivElement>(null), skip = useRef<HTMLDivElement>(null);
  const pathR = useRef<SVGPathElement>(null), tailR = useRef<SVGPathElement>(null), glowR = useRef<SVGPathElement>(null);
  const dotR = useRef<SVGGElement>(null), headR = useRef<SVGGElement>(null), arrowR = useRef<SVGGElement>(null), gradR = useRef<SVGLinearGradientElement>(null);
  const skipped = useRef(false);

  useEffect(() => {
    const fog = fogR.current!, hl = hello.current!, wl = wel.current!, wh = whr.current!, ws = whS.current!, mo = mor.current!, sv = svgR.current!;
    const path = pathR.current!, tail = tailR.current!, glow = glowR.current!, dot = dotR.current!, gr = gradR.current!, lg = glowBand.current!;
    const letters = [...wl.querySelectorAll<HTMLElement>('[data-l]')], done = letters.map(() => false);
    const tlet = [...ws.querySelectorAll<HTMLElement>('[data-l]')], mspans = [...mo.querySelectorAll<HTMLElement>('[data-m]')];
    const T = { hOut: 1050, wIn: 1300, nav0: 1850, nav1: 2950, move0: 1e9, rev0: 1e9, hero: 1e9, end: 1e9 };
    type Morph = { s: HTMLElement; to: [number, number, number]; ch: string; tr?: number; done: boolean };
    let raf = 0, tt = 0, last: number | null = null, revealed = false, heroed = false, built = false, L = 0, settled = false, swapped = false;
    let lx: [number, number, number][] = [], wb: DOMRect, tgt: { x: number; y: number; s: number }, M: Morph[] = [];
    const trig: (number | undefined)[] = letters.map(() => undefined);
    const ez = (u: number) => (u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2), eo = (u: number) => 1 - Math.pow(1 - u, 3);
    const c01 = (v: number) => Math.max(0, Math.min(1, v));

    /* size "Where do you want to go?" from the hero headline and remember where it must land */
    const place = () => {
      const hh = document.querySelector<HTMLElement>('[data-hero-title]'), W = window.innerWidth, H = window.innerHeight;
      const hf = hh ? parseFloat(getComputedStyle(hh).fontSize) : Math.min(94, Math.max(50, W * .052));
      const k = W <= 900 ? (H >= W ? 1.12 : 1.25) : 1.45, fs0 = hf * k;
      [wh, ws, mo].forEach(e => (e.style.fontSize = fs0 + 'px'));
      const r = wh.getBoundingClientRect(), left = (W - r.width) / 2, top = (H - r.height) / 2;
      [wh, ws].forEach(e => { e.style.left = left + 'px'; e.style.top = top + 'px'; });
      wb = wh.getBoundingClientRect();
      if (hh) { const hr = hh.getBoundingClientRect(); tgt = { x: hr.left, y: hr.top, s: hf / fs0 }; }
      else tgt = { x: Math.max(20, W * .034), y: H * .3, s: 1 / k };
    };
    const build = () => {
      place();
      const b = wl.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight, cx = b.left + b.width * .5;
      sv.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const d = `M ${cx - 30} ${H + 80} C ${cx - 30} ${H * .75}, ${cx + 18} ${b.bottom}, ${cx} ${b.top + b.height * .5} S ${cx - 14} ${b.top - H * .15}, ${cx + 40} ${-160}`;
      [path, tail, glow].forEach(p => p.setAttribute('d', d));
      L = path.getTotalLength();
      lx = letters.map(e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.height]; });
      M = mspans.map((s, i) => {
        const r = tlet[i].getBoundingClientRect();
        s.style.left = r.left + 'px'; s.style.top = r.top + 'px';
        return { s, to: [r.left + r.width / 2, r.top + r.height / 2, r.height], ch: tlet[i].textContent || '', done: false };
      });
      built = true;
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const nw = performance.now();
      if (last == null) last = nw;
      tt += Math.min(100, nw - last); last = nw;
      if (skipped.current && tt < T.nav1) { if (!built) build(); tt = T.nav1; }
      const t = tt;

      /* Hello */
      const hi = eo(c01(t / 480)), ho = ez(c01((t - T.hOut) / 320));
      hl.style.opacity = (hi * (1 - ho)).toFixed(3);
      hl.style.transform = `translate(-50%,-50%) translateY(${(1 - hi) * 24 - ho * 30}px) scale(${.96 + .04 * hi})`;
      hl.style.filter = `blur(${((1 - hi) * 10 + ho * 10).toFixed(1)}px)`;

      /* Welcome letters rise in */
      letters.forEach((e, i) => {
        if (done[i]) return;
        const u = eo(c01((t - T.wIn - i * 26) / 420));
        e.style.opacity = u.toFixed(3);
        e.style.setProperty('--y', ((1 - u) * 38).toFixed(1) + 'px');
        e.style.filter = u >= 1 ? 'none' : u <= 0 ? '' : `blur(${((1 - u) * 5).toFixed(1)}px)`;
        if (u >= 1) done[i] = true;
      });
      if (t >= T.wIn + 50 && !built) build();

      if (built) {
        /* the navigator */
        const u = c01((t - T.nav0) / (T.nav1 - T.nav0)), e = u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        const pos = e * L, TL = Math.min(L * .42, pos), fade = 1 - c01((t - T.nav1) / 350);
        const p = path.getPointAtLength(Math.max(0, pos)), p2 = path.getPointAtLength(Math.min(L, Math.max(0, pos) + 2));
        const ang = Math.atan2(p2.y - p.y, p2.x - p.x) * 180 / Math.PI + 90;
        dot.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(1.55)`);
        headR.current!.setAttribute('transform', `rotate(${ang.toFixed(1)})`);
        arrowR.current!.setAttribute('transform', `rotate(${ang.toFixed(1)})`);
        dot.style.opacity = String((t > T.nav0 ? 1 : 0) * fade);
        const pe = path.getPointAtLength(Math.max(0, pos - TL));
        gr.setAttribute('x1', String(p.x)); gr.setAttribute('y1', String(p.y)); gr.setAttribute('x2', String(pe.x)); gr.setAttribute('y2', String(pe.y + .01));
        [tail, glow].forEach(r => {
          r.style.strokeDasharray = `${TL.toFixed(1)} ${L + 10}`;
          r.style.strokeDashoffset = (-(pos - TL)).toFixed(1);
          r.style.opacity = String((t > T.nav0 ? 1 : 0) * fade);
        });
        lg.style.opacity = (t > T.nav0 ? Math.min(1, (t - T.nav0) / 220) * (1 - c01((t - T.nav1 + 450) / 500)) : 0).toFixed(3);
        lg.style.left = p.x + 'px';

        /* 1 · letters near the arrow get pushed aside and light up */
        const Wd = window.innerWidth, fin = t >= T.nav1 + 50;
        letters.forEach((le, i) => {
          if (trig[i] != null && t - trig[i]! > 40) return;
          const dx = lx[i][0] - p.x, dy = lx[i][1] - p.y;
          const act = t > T.nav0 ? Math.exp(-dy * dy / (2 * Math.pow(Wd * .07, 2))) : 0, near = Math.exp(-dx * dx / (2 * Math.pow(Wd * .09, 2)));
          le.style.setProperty('--px', (Math.sign(dx || 1) * act * near * Wd * .018).toFixed(1) + 'px');
          le.style.setProperty('--h', (-act * near * 16).toFixed(1) + 'px');
          le.classList.toggle('lit', act * near > .25);
        });
        /* 2 · each letter swaps the moment the arrow reaches it */
        if (t > T.nav0) {
          let all = true;
          letters.forEach((le, i) => {
            if (trig[i] == null && (fin || p.y <= lx[i][1] + lx[i][2] * .55 - Math.abs(lx[i][0] - p.x) * .22)) trig[i] = t;
            if (trig[i] == null) return;
            const v = ez(c01((t - trig[i]!) / 320));
            le.style.opacity = (1 - v).toFixed(3);
            le.style.setProperty('--h', (-v * lx[i][2] * .35).toFixed(1) + 'px');
          });
          M.forEach(m => {
            if (m.tr == null && (fin || p.y <= m.to[1] + m.to[2] * .55 - Math.abs(m.to[0] - p.x) * .22)) { m.tr = t + 50; m.s.textContent = m.ch; }
            if (m.tr == null) { all = false; return; }
            const uu = c01((t - m.tr) / 440), k = eo(uu);
            m.s.style.opacity = k.toFixed(3);
            m.s.style.transform = `translateY(${((1 - k) * m.to[2] * .4).toFixed(1)}px)`;
            if (uu > .55 && !m.done) { m.done = true; m.s.classList.add('fin'); }
            if (uu < 1) all = false;
          });
          if (all && !settled) { settled = true; T.move0 = t + 220; T.rev0 = T.move0 + 250; T.hero = T.move0 + 1000; T.end = T.hero + 500; }
        }
        /* 3 · hand over to the real headline, then glide it into the hero */
        if (settled && !swapped && t >= T.move0 - 140) { swapped = true; wh.style.opacity = '1'; }
        if (swapped) mo.style.opacity = (1 - c01((t - (T.move0 - 140)) / 140)).toFixed(3);
        const m = ez(c01((t - T.move0) / 1000));
        if (tgt && m > 0) {
          const s = 1 + (tgt.s - 1) * m;
          wh.style.transform = `translate(${((tgt.x - wb.left) * m).toFixed(1)}px,${((tgt.y - wb.top) * m).toFixed(1)}px) scale(${s.toFixed(4)})`;
        }
        if (t > T.hero) wh.style.opacity = (1 - c01((t - T.hero) / 320)).toFixed(3);
      }

      /* the map clears out of the fog */
      const r = ez(c01((t - T.rev0) / 1250)), R = r * 170;
      const por = window.innerWidth <= 900 && window.innerHeight >= window.innerWidth;
      const mk = r <= 0 ? 'none' : `radial-gradient(ellipse at ${por ? '50% 68%' : '62% 56%'}, transparent ${R.toFixed(1)}%, #000 ${(R + 38).toFixed(1)}%)`;
      fog.style.webkitMaskImage = mk; fog.style.maskImage = mk;
      if (t >= T.rev0 && !revealed) { revealed = true; onReveal?.(); }
      if (t >= T.hero - 60 && !heroed) { heroed = true; onHero?.(); }
      root.current!.style.pointerEvents = t > T.rev0 + 400 ? 'none' : '';
      if (skip.current && t > T.nav1) skip.current.style.opacity = (1 - c01((t - T.nav1) / 300)).toFixed(2);
      if (t >= T.end) { cancelAnimationFrame(raf); onDone?.(); }
    };

    // start only once the bundled fonts are ready, so letter measurements are right
    let started = false;
    const start = () => { if (started) return; started = true; tick(); };
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(start);
    const fallback = setTimeout(start, 1200);
    return () => { cancelAnimationFrame(raf); clearTimeout(fallback); };
  }, []);

  const morphSlots: JSX.Element[] = [];
  TARGET.forEach(([s, italic]) => [...s].forEach(ch => {
    if (ch !== ' ') morphSlots.push(
      <span key={morphSlots.length} data-m=""
        className={'absolute inline-block whitespace-pre text-[#5fd03e] opacity-0 transition-colors duration-[450ms] will-change-transform ' +
          (italic ? `${ITALIC} is-fin:text-leaf` : 'is-fin:text-ink')} />);
  }));

  return (
    <div ref={root} onClick={() => { skipped.current = true; }} aria-label="Welcome to Unity Park"
      className="fixed inset-0 z-50 cursor-pointer select-none overflow-hidden">
      {/* fog */}
      <div ref={fogR} className="absolute inset-0 overflow-hidden bg-[#f6f3ec]">
        <div className={`${FOG} left-[-12vw] top-[-10vh] h-[60vh] w-[70vw] animate-[fogA_14s_ease-in-out_infinite_alternate] bg-[radial-gradient(closest-side,#ffffff,rgba(255,255,255,0))]`} />
        <div className={`${FOG} -bottom-[20vh] -right-[20vw] h-[70vh] w-[80vw] animate-[fogB_16s_ease-in-out_infinite_alternate] bg-[radial-gradient(closest-side,#efe7d6,rgba(239,231,214,0))]`} />
        <div className={`${FOG} left-[30vw] top-[20vh] h-[50vh] w-[55vw] animate-[fogA_18s_ease-in-out_infinite_alternate-reverse] bg-[radial-gradient(closest-side,rgba(214,236,206,.75),rgba(214,236,206,0))]`} />
        <div className={`${FOG} -bottom-[10vh] left-[5vw] h-[45vh] w-[60vw] animate-[fogB_12s_ease-in-out_infinite_alternate-reverse] bg-[radial-gradient(closest-side,#fffaf0,rgba(255,250,240,0))]`} />
      </div>

      <div ref={hello} className="absolute left-1/2 top-1/2 text-center opacity-0">
        <b className={`block text-[clamp(72px,10vw,170px)] leading-none ${DISPLAY}`}>Hello</b>
        <span className="mt-2.5 block font-eth text-[clamp(18px,1.6vw,26px)] font-semibold text-[#6d8a73]">ሰላም</span>
      </div>

      <div ref={wel} className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-left text-[clamp(54px,7.4vw,132px)] leading-[.98] will-change-transform por:text-[clamp(40px,11vw,64px)] ${DISPLAY}`}>
        <div><Letters text={W1} /></div>
        <div className={`text-[1.08em] text-[#6cc04a] ${ITALIC}`}><Letters text={W2} /></div>
      </div>

      {/* invisible copy of the target headline, used only to measure where each letter lands */}
      <div ref={whS} aria-hidden="true" className={`invisible absolute left-0 top-0 whitespace-nowrap leading-[.95] por:text-center ${DISPLAY}`}>
        <div><Letters text="Where do you" measure /></div>
        <div><Letters text="want to " measure /><span className={`text-leaf ${ITALIC}`}><Letters text="go?" measure /></span></div>
      </div>
      <div ref={mor} aria-hidden="true" className={`pointer-events-none absolute left-0 top-0 h-0 w-0 leading-[.95] ${DISPLAY}`}>{morphSlots}</div>
      <div ref={whr} className={`absolute left-0 top-0 origin-top-left whitespace-nowrap leading-[.95] opacity-0 will-change-transform por:text-center ${DISPLAY}`}>
        <div>Where do you</div>
        <div>want to <span className={`text-leaf ${ITALIC}`}>go?</span></div>
      </div>

      {/* route + 3D navigation icon */}
      <svg ref={svgR} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] h-full w-full overflow-visible will-change-transform">
        <defs>
          <linearGradient ref={gradR} id="itailg" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0" stopColor="#2fbf3a" stopOpacity={1} /><stop offset=".55" stopColor="#3fdc2c" stopOpacity={.7} /><stop offset="1" stopColor="#3fdc2c" stopOpacity={0} />
          </linearGradient>
          <radialGradient id="ibeam" cx="50%" cy="100%" r="100%"><stop offset="0" stopColor="#2f6bff" stopOpacity={.45} /><stop offset="1" stopColor="#2f6bff" stopOpacity={0} /></radialGradient>
          <radialGradient id="ipuck" cx="38%" cy="30%" r="75%"><stop offset="0" stopColor="#ffffff" /><stop offset=".7" stopColor="#f1f4f8" /><stop offset="1" stopColor="#d6dde8" /></radialGradient>
          <linearGradient id="ileft" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8fb4ff" /><stop offset="1" stopColor="#4a7dff" /></linearGradient>
          <linearGradient id="iright" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2b5ff0" /><stop offset="1" stopColor="#1739a8" /></linearGradient>
          <filter id="ishadow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation={3.2} /></filter>
        </defs>
        <path ref={pathR} fill="none" className="stroke-none" />
        <path ref={glowR} fill="none" stroke="url(#itailg)" className="opacity-0 blur-[12px] [stroke-linecap:round] [stroke-width:40]" />
        <path ref={tailR} fill="none" stroke="url(#itailg)" className="opacity-0 [stroke-linecap:round] [stroke-width:12]" />
        <g ref={dotR} className="opacity-0">
          <ellipse cx={2} cy={9} rx={21} ry={17} fill="rgba(15,40,30,.32)" filter="url(#ishadow)" />
          <g ref={headR}>
            <path d="M0 0 L-34 -78 A86 86 0 0 1 34 -78 Z" fill="url(#ibeam)" />
            <circle r={30} className="origin-center animate-[inpulse_1s_ease-out_infinite] fill-[rgba(47,107,255,.18)] [transform-box:fill-box]" />
          </g>
          <circle cx={0} cy={3.2} r={19.5} fill="#b9c3d3" />
          <circle r={19.5} fill="url(#ipuck)" />
          <circle r={19.5} fill="none" stroke="rgba(255,255,255,.9)" strokeWidth={1} />
          <g ref={arrowR}>
            <path d="M0 -15 L12.5 11.5 L0 5 L-12.5 11.5 Z" fill="#1739a8" transform="translate(0 2.2)" opacity={.55} />
            <path d="M0 -15 L12.5 11.5 L0 5 L-12.5 11.5 Z" fill="none" stroke="#fff" strokeWidth={3.2} strokeLinejoin="round" />
            <path d="M0 -15 L0 5 L-12.5 11.5 Z" fill="url(#ileft)" />
            <path d="M0 -15 L12.5 11.5 L0 5 Z" fill="url(#iright)" />
            <path d="M0 -13 L-3.5 -4" stroke="rgba(255,255,255,.75)" strokeWidth={1.4} strokeLinecap="round" />
          </g>
        </g>
      </svg>
      <div ref={glowBand} className="pointer-events-none absolute bottom-[-120px] h-[62vh] w-[46vw] -translate-x-1/2 bg-[radial-gradient(ellipse_at_50%_100%,rgba(63,220,44,.45),rgba(63,220,44,.12)_40%,rgba(63,220,44,0)_70%)] opacity-0" />
      <div ref={skip} className="absolute bottom-7 left-1/2 -translate-x-1/2 animate-[fin_1s_1.2s_both] text-[11px] font-semibold uppercase tracking-[.16em] text-[#9aa19c]">Click to skip</div>
    </div>
  );
}

