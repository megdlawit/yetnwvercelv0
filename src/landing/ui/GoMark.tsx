import { useEffect, useRef } from 'react';
import { RM } from '../scene/util';

const ROUTE_D = 'M -2.0,11.0 C -1.2,12.2 0.3,17.0 3.0,18.4 C 5.7,19.8 10.3,20.1 14.0,19.4 C 17.7,18.7 22.5,16.4 25.0,14.0 C 27.5,11.6 29.4,7.7 29.2,5.0 C 29.0,2.3 26.4,-0.5 24.0,-2.4 C 21.6,-4.3 17.6,-5.0 15.0,-6.4 C 12.4,-7.8 9.2,-9.4 8.4,-11.0 C 7.6,-12.6 9.2,-14.6 10.4,-16.0 C 11.6,-17.4 15.5,-18.4 15.6,-19.6 C 15.7,-20.8 12.1,-20.9 11.0,-23.0 C 9.9,-25.1 8.5,-28.5 8.8,-32.0 C 9.1,-35.5 10.8,-41.0 13.0,-44.0 C 15.2,-47.0 18.7,-48.8 22.0,-50.0 C 25.3,-51.2 29.7,-50.2 33.0,-51.0 C 36.3,-51.8 38.7,-55.5 42.0,-55.0 C 45.3,-54.5 52.4,-52.2 53.0,-48.0 C 53.6,-43.8 47.0,-35.7 45.6,-30.0 C 44.2,-24.3 43.3,-18.8 44.4,-14.0 C 45.5,-9.2 48.7,-2.5 52.0,-1.2 C 55.3,0.1 60.5,-2.9 64.0,-6.0 C 67.5,-9.1 71.1,-14.8 73.0,-20.0 C 74.9,-25.2 75.8,-32.5 75.6,-37.0 C 75.4,-41.5 70.9,-43.8 72.0,-47.0 C 73.1,-50.2 78.5,-53.7 82.0,-56.0 C 85.5,-58.3 90.0,-58.3 93.0,-61.0 C 96.0,-63.7 97.3,-69.8 100.0,-72.0 C 102.7,-74.2 106.5,-75.3 109.0,-74.0 C 111.5,-72.7 114.9,-68.1 115.2,-64.4 C 115.5,-60.7 113.4,-55.9 111.0,-52.0 C 108.6,-48.1 103.4,-44.3 101.0,-41.0 C 98.6,-37.7 97.6,-35.4 96.4,-32.0 C 95.2,-28.6 94.4,-23.9 93.6,-20.4 C 92.8,-16.9 92.3,-13.7 91.6,-11.0 C 90.9,-8.3 89.9,-5.5 89.6,-4.4';

/**
 * The animated "go?" in the headline: a route traced through the letters,
 * a navigator with a green tail driving it, and the destination pin as the dot of the "?".
 */
export function GoMark() {
  const svg = useRef<SVGSVGElement>(null);
  const text = useRef<SVGTextElement>(null);
  const route = useRef<SVGPathElement>(null);
  const run = useRef<SVGPathElement>(null);
  const glow = useRef<SVGPathElement>(null);
  const car = useRef<SVGGElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const pin = useRef<SVGCircleElement>(null);

  // size the svg to the rendered glyphs, once fonts are ready
  useEffect(() => {
    const fit = () => {
      const sv = svg.current, t = text.current;
      if (!sv || !t) return;
      let b: DOMRect;
      try { b = t.getBBox(); } catch { return; }
      if (!b.width) return;
      sv.setAttribute('viewBox', `${(b.x - 2).toFixed(1)} -82 ${(b.width + 4).toFixed(1)} 108`);
      sv.style.width = (1.08 * (b.width + 4) / 108).toFixed(3) + 'em';
    };
    fit();
    const a = setTimeout(fit, 400), b = setTimeout(fit, 1500);
    document.fonts?.ready.then(fit);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);

  // drive the navigator + tail along the route
  useEffect(() => {
    if (RM) return;
    let raf = 0;
    const T0 = performance.now(), DUR = 3400, HOLD = 700, CYC = DUR + HOLD, TAIL = 60;
    const ez = (u: number) => (u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = route.current;
      if (!p || !car.current) return;
      const t = (performance.now() - T0) % CYC, u = Math.min(1, t / DUR), e = ez(u), h = t > DUR ? (t - DUR) / HOLD : -1;
      const pt = p.getPointAtLength(e * p.getTotalLength());
      car.current.setAttribute('transform', `translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)})`);
      const fade = h < 0 ? 1 : Math.max(0, 1 - h * 1.6), pos = e * 360, tl = Math.min(TAIL, pos) * fade;
      for (const r of [run.current, glow.current]) {
        if (!r) continue;
        r.style.strokeDasharray = `${tl.toFixed(2)} 1000`;
        r.style.strokeDashoffset = (-(pos - tl)).toFixed(2);
      }
      car.current.style.opacity = String(h < 0 ? 1 : Math.max(0, 1 - h * 2.2));
      if (h >= 0) {
        ring.current!.style.opacity = (1 - h).toFixed(2);
        ring.current!.setAttribute('r', (5.4 + h * 9).toFixed(2));
        pin.current!.setAttribute('r', (5.4 + Math.sin(Math.min(1, h * 2.2) * Math.PI) * 1.4).toFixed(2));
      } else {
        ring.current!.style.opacity = '0';
        pin.current!.setAttribute('r', '5.4');
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg ref={svg} viewBox="0 -82 150 108" preserveAspectRatio="xMinYMid meet" aria-hidden="true"
      className="inline-block h-[1.08em] w-[1.45em] overflow-visible align-[-.26em]">
      <defs>
        <mask id="gomask" maskUnits="userSpaceOnUse" x={-40} y={-120} width={240} height={180}>
          <rect x={-40} y={-120} width={240} height={180} fill="#fff" />
          <circle cx={89.6} cy={-4.4} r={6.6} fill="#000" />
        </mask>
      </defs>
      <text ref={text} x={0} y={0} mask="url(#gomask)"
        className="fill-leaf font-instrument text-[100px] font-normal italic tracking-[-1px]">go?</text>
      <path ref={route} d={ROUTE_D} pathLength={360} fill="none"
        className="animate-[grflow_1.2s_linear_infinite] stroke-[#2f7d3a] opacity-90 [stroke-dasharray:.1_5.5] [stroke-linecap:round] [stroke-width:2.2]" />
      <path ref={glow} d={ROUTE_D} pathLength={360}
        className="fill-none stroke-lime opacity-35 [stroke-dasharray:0_400] [stroke-linecap:round] [stroke-width:9]" />
      <path ref={run} d={ROUTE_D} pathLength={360}
        className="fill-none stroke-[#1fb33a] [stroke-dasharray:0_400] [stroke-linecap:round] [stroke-width:4]" />
      <g transform="translate(89.6 -4.4)">
        <circle ref={ring} r={5.4} className="fill-none stroke-lime opacity-0 [stroke-width:2]" />
        <circle ref={pin} r={5.4} className="fill-ink" />
        <circle r={2.2} className="fill-lime" />
      </g>
      <g ref={car} transform="translate(-2 11)">
        <circle r={5} className="fill-white stroke-navblue [stroke-width:2.4]" />
        <circle r={2.9} className="fill-navblue" />
      </g>
    </svg>
  );
}
