import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { I_ARR } from './icons';

type Props = { label: string; onDone: () => void };

/** "Slide to start" control: drag the knob ~80% of the way (or press Enter / → on it) to start. */
export function SlideGo({ label, onDone }: Props) {
  const track = useRef<HTMLDivElement>(null), xr = useRef(0), start = useRef(0);
  const [x, setX] = useState(0), [drag, setDrag] = useState(false), [done, setDone] = useState(false);
  const max = () => (track.current ? track.current.clientWidth - 62 : 200);
  const finish = () => {
    setDone(true); setX(max());
    setTimeout(() => { onDone(); setDone(false); xr.current = 0; setX(0); }, 260);
  };
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (done) return;
    e.preventDefault(); e.stopPropagation();
    start.current = e.clientX - xr.current; setDrag(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const v = Math.max(0, Math.min(max(), e.clientX - start.current));
    xr.current = v; setX(v);
  };
  const up = () => {
    if (!drag) return;
    setDrag(false);
    if (xr.current > max() * .82) finish(); else { xr.current = 0; setX(0); }
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); finish(); }
  };
  const p = max() ? x / max() : 0;
  const spring = 'duration-[350ms] ease-[cubic-bezier(.2,.9,.3,1.2)]';

  return (
    <div ref={track}
      className="relative h-[60px] w-[clamp(290px,22vw,340px)] touch-none select-none overflow-hidden rounded-full bg-ink shadow-[0_14px_30px_rgba(15,61,38,.28),inset_0_1px_0_rgba(255,255,255,.1)] por:h-14 por:w-[min(340px,100%)] ph640:h-12 ls:h-[50px] ls:w-[250px]">
      <i style={{ width: x + 58 + 'px' }}
        className={`absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,rgba(63,220,44,0),rgba(63,220,44,.35))] ${drag ? '' : `transition-[width] ${spring}`}`} />
      <span style={{ opacity: 1 - p * 1.3 }}
        className="pointer-events-none absolute inset-0 flex animate-[sgshine_2.6s_linear_infinite] items-center justify-center gap-2.5 bg-[linear-gradient(90deg,#fff_0%,#fff_40%,#9dffb0_50%,#fff_60%,#fff_100%)] bg-[length:250%_100%] bg-clip-text pl-[52px] text-[15px] font-semibold tracking-[-.01em] text-transparent por:pl-[46px] por:text-sm ph640:pl-10 ph640:text-[13px] p380:text-[13px] ls:pl-10 ls:text-[13px]">
        {label}
        <b className="animate-[sgchev_1.4s_ease-in-out_infinite] text-base font-bold tracking-[-2px] text-lime [-webkit-text-fill-color:#3fdc2c]">›››</b>
      </span>
      <button type="button" aria-label="Slide to start your journey (or press Enter)"
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        className={`absolute left-1.5 top-1.5 grid h-12 w-12 touch-none place-items-center rounded-full border-0 text-ink shadow-[0_6px_14px_rgba(0,0,0,.25)] por:h-11 por:w-11 ph640:left-[5px] ph640:top-[5px] ph640:h-[38px] ph640:w-[38px] ls:h-[38px] ls:w-[38px] ${done ? 'bg-white' : 'bg-lime'} ${drag ? 'cursor-grabbing' : `cursor-grab animate-[sgnudge_2.6s_ease-in-out_1.2s_infinite] transition-transform ${spring}`}`}>
        {I_ARR}
      </button>
    </div>
  );
}
