import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { A, N, V, Z } from '../state';
import { PLACES, SUBS } from '../scene/places';
import { DEST, OUT_STAGES, P, POI, SEQ, TX } from '../scene/story';
import { fmtT, hasVoice, nDur } from '../voice';
import { createEngine } from '../scene/engine';
import { PICO } from './pico';
import { GoMark } from './GoMark';
import { Intro } from './Intro';
import { SlideGo } from './SlideGo';
import { HomeSearch } from './HomeSearch';
import {
  I_ARR, I_CLK, I_DOWN, I_EXP, I_HAND, I_INFO, I_MUSIC, I_MUTE, I_NAV, I_PAUSE, I_PLAY, I_SPK, I_UP, I_WALK, I_WALKER, I_X, Icon,
} from './icons';

/* ---------- shared class recipes ---------- */
const BTN = 'inline-flex cursor-pointer items-center gap-2.5 rounded-full border-0 px-[22px] py-[13px] text-[15px] font-semibold';
const BTN_D = `${BTN} bg-ink text-white`;
const BTN_L = `${BTN} bg-transparent text-ink shadow-[inset_0_0_0_1.5px_rgba(120,130,120,.35)]`;
const NUDGE = ' !animate-[nudge_1s_ease-in-out_infinite]';
const DOT_LIVE = 'h-[7px] w-[7px] flex-none animate-[pinglime_1.6s_infinite] rounded-full bg-lime';
const DOT_BLUE = 'h-[9px] w-[9px] flex-none animate-[pingblue_1.8s_infinite] rounded-full bg-navblue';
const GLASS = 'backdrop-blur-[14px]';
const WAVE_ON = '[&>i]:animate-[wv_1s_ease-in-out_infinite] [&>i]:opacity-90 [&>i:nth-child(3n)]:[animation-delay:-.3s] [&>i:nth-child(3n+1)]:[animation-delay:-.65s] [&>i:nth-child(4n)]:[animation-delay:-.15s]';
const WAVE_BAR = 'h-[30%] w-[3px] rounded-sm bg-ink opacity-35';
const CTL_BTN = 'grid h-[clamp(42px,2.8vw,48px)] w-[clamp(42px,2.8vw,48px)] cursor-pointer place-items-center rounded-full border-0 bg-white text-2xl font-normal leading-none text-ink shadow-[0_6px_20px_rgba(20,50,30,.14)] aria-pressed:bg-ink aria-pressed:text-white por:h-10 por:w-10 ph640:h-[34px] ph640:w-[34px] ls:h-[34px] ls:w-[34px]';

export default function App() {
  const [, setN] = useState(0);
  Z.bump = () => setN(n => n + 1);
  const mount = useRef<HTMLDivElement>(null);
  const Rf = useRef<any>({ lab: [], hs: {}, sub: {} }).current;
  // add ?nointro to the URL to jump straight to the hero (handy while developing)
  const skipIntro = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nointro');
  const [heroPre, setHeroPre] = useState(!skipIntro);
  const [introOn, setIntroOn] = useState(!skipIntro);
  const [active, setActive] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  Z.active = active; Z.all = all;
  A.pick = (i: number) => { Z.explored = true; Z.bump(); setActive(a => (a === i ? null : i)); };

  useEffect(() => {
    const dispose = createEngine(mount.current!, Rf);
    if (skipIntro && A.introReveal) A.introReveal();
    return dispose;
  }, []);
  useEffect(() => { A.focus && A.focus(active); }, [active]);

  /* ---------- derived ---------- */
  const L = TX[Z.lang], out = Z.mode !== 'in', st = Z.stage, beat = Z.beat;
  const cur = active !== null ? PLACES[active] : null;
  const nz = (k: string) => (Z.nudged && Z.nudgeKey === k ? NUDGE : '');
  const next = () => setActive(active === null ? 0 : (active + 1) % PLACES.length);
  const pos = SEQ.indexOf(st >= 0 && out ? SEQ[st] : beat), prog = Z.started || !out ? Math.max(0, (pos + 1) / SEQ.length) : 0;
  const hide = heroPre ? ' pointer-events-none opacity-0' : '';
  const picon = (k: string, sz = 19) => (
    <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PICO[k]} /></svg>
  );

  const langToggle = (big: boolean, key?: string) => (
    <div role="group" aria-label="Language"
      className={`inline-flex rounded-full bg-ink/[.08] tracking-normal group-[.near]/hud:bg-white/[.14] ${big ? 'p-1' : 'p-0.5'}${nz(key || 'lang-x')}`}>
      {['en', 'am'].map(l => (
        <button key={l} aria-pressed={Z.lang === l} onClick={() => A.setLang(l)}
          className={`cursor-pointer rounded-full border-0 font-semibold ${big ? 'px-[26px] py-2.5 text-base' : 'px-[9px] py-1 text-[11px]'} ${Z.lang === l ? 'bg-ink text-white group-[.near]/hud:bg-white group-[.near]/hud:text-ink' : 'bg-transparent text-inherit'}`}>
          {l === 'en' ? (big ? 'English' : 'EN') : big ? 'አማርኛ' : 'አማ'}
        </button>
      ))}
    </div>
  );

  /* ---------- indoor: suggested-destination card ---------- */
  const destCard = (key: string) => {
    const r = key === 'recep' ? P.r1 : P.r2, m = Math.round(r.L), s = m / 1.2;
    const chip = 'inline-flex items-center gap-1.5 rounded-full bg-ink/[.06] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#3f4a43]';
    return (
      <div className="mt-6 w-[min(380px,100%)] animate-[bubin_.55s_.15s_both] rounded-[20px] bg-pcard px-4 pb-3.5 pt-4 shadow-[0_16px_44px_rgba(30,20,10,.16)] por:mt-3.5 por:bg-white por:p-3 por:shadow-none">
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[.14em] text-moss"><span className={DOT_LIVE} />SUGGESTED NEXT</div>
        <div className="mt-1.5 font-news text-[23px] font-semibold leading-[1.15] text-ink">{DEST[key][Z.lang]}</div>
        <div className="mb-3.5 mt-2.5 flex flex-wrap gap-2">
          <span className={chip}>{I_WALK}{m + ' ' + L.m}</span>
          <span className={chip}>{I_CLK}{s < 60 ? L.lt1 : L.min(Math.round(s / 60))}</span>
          <span className={chip}>{key === 'recep' ? 'Ground floor' : 'Ground + upper floor'}</span>
        </div>
        <button onClick={A.navigate}
          className={'flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-[14px] border-0 bg-ink p-3.5 text-[15px] font-semibold text-white' + nz('nav')}>
          {I_NAV}{L.nav}
        </button>
        <div className="mt-2.5 text-center text-xs font-medium text-sub">{key === 'recep' ? '3 more rooms on this floor' : 'Recommended for your visit'}</div>
      </div>
    );
  };

  /* ---------- indoor: point-of-interest panel (gallery / audio / film) ---------- */
  const poiCard = () => {
    const id = Z.card, Pi = POI[id], lg = Z.lang;
    const h3 = 'mt-1.5 font-news font-semibold leading-[1.08] tracking-[-.015em]';
    const body = (title: boolean) => (
      <div className="px-5 pb-2 pt-1">
        {title && <h3 className={`${h3} text-[30px]`}>{Pi.t[lg]}</h3>}
        <p className="mt-3 text-[15px] leading-[1.6] text-[#4c5550]">{Pi.d[lg]}</p>
      </div>
    );
    const pbar = (ref: (e: HTMLElement | null) => void, extra = 'mx-5 mt-2.5') => (
      <div className={`h-1 overflow-hidden rounded-sm bg-ink/[.12] ${extra}`}><i ref={ref} className="block h-full w-0 bg-ink" /></div>
    );
    let mid: ReactNode;
    if (id === 'poi1') {
      const im: string[] = Z.imgs.poi1 || [];
      mid = (<>
        <div onClick={() => A.lb(Z.gi)} className="relative mx-3.5 aspect-[16/10] cursor-zoom-in overflow-hidden rounded-2xl bg-[#e9e1d0]">
          {im[Z.gi] && <img key={Z.gi} src={im[Z.gi]} alt={Pi.cap[lg][Z.gi]} className="block h-full w-full animate-[fin_.4s_both] object-cover" />}
          <span className="absolute left-2.5 top-2.5 rounded-full bg-black/45 px-[9px] py-[5px] text-[11px] font-semibold text-white backdrop-blur-sm">{Z.gi + 1} / {im.length}</span>
          <span className="absolute right-2.5 top-2.5 grid place-items-center rounded-full bg-black/45 p-[5px] text-white backdrop-blur-sm">{I_EXP}</span>
        </div>
        <div className="mx-3.5 mt-2.5 flex gap-2">
          {im.map((s, i) => (
            <button key={i} aria-label={Pi.cap[lg][i]} onClick={() => { Z.gi = i; Z.bump(); }}
              className={`aspect-[16/10] flex-1 cursor-pointer overflow-hidden rounded-[10px] border-0 bg-[#e9e1d0] p-0 transition-opacity duration-200 ${i === Z.gi ? 'opacity-100 outline outline-2 outline-offset-2 outline-ink' : 'opacity-[.55]'}`}>
              <img src={s} alt="" className="block h-full w-full object-cover" />
            </button>
          ))}
        </div>
        <div className="mx-4 mt-2 text-xs font-medium text-sub">{Pi.cap[lg][Z.gi]}</div>
        {body(true)}
      </>);
    } else if (id === 'poi2') {
      const lines: string[] = Pi.s[lg], noVoice = lg === 'am' && !hasVoice('am');
      const note = 'mx-5 mt-3 rounded-[10px] bg-[rgba(240,160,32,.12)] px-2.5 py-2 text-xs font-medium leading-[1.45] text-[#8a5a12]';
      mid = (<>
        <div className="flex items-center gap-3.5 px-5">
          <img src={Z.imgs.poi2} alt="" className="h-[92px] w-[92px] flex-none rounded-2xl bg-[#e9e1d0] object-cover" />
          <div><h3 className={`${h3} text-[25px]`}>{Pi.t[lg]}</h3><small className="mt-1 block text-xs font-semibold text-sub">{L.listen + ' · ' + fmtT(nDur())}</small></div>
        </div>
        <div className="mx-5 mt-[18px] flex items-center gap-3.5 rounded-[18px] bg-ink/5 px-3.5 py-3">
          <button aria-label={N.on ? 'Pause' : 'Play'} onClick={A.narToggle}
            className="grid h-[52px] w-[52px] flex-none cursor-pointer place-items-center rounded-full border-0 bg-ink text-white">{N.on ? I_PAUSE : I_PLAY}</button>
          <div className={`flex h-[30px] flex-1 items-center gap-[3px] ${N.on && !N.ducked ? WAVE_ON : ''}`}>
            {Array.from({ length: 26 }, (_, i) => <i key={i} className={`${WAVE_BAR} flex-1`} />)}
          </div>
          <span ref={e => { Rf.narT = e; }} className="whitespace-nowrap text-xs font-semibold tabular-nums text-[#3f4a43]" />
        </div>
        {pbar(e => { Rf.narBar = e; })}
        {!Z.voice && <div className={note}>Voice is muted — follow the transcript.</div>}
        {Z.voice && noVoice && <div className={note}>No Amharic voice is installed on this device — follow the transcript below.</div>}
        <div className="mx-5 mt-3.5 text-[14.5px] leading-[1.65] text-[#9aa19c]">
          {lines.map((s, i) => <span key={i} className={`transition-colors duration-300 ${i === N.i && N.on ? 'font-medium text-ink' : ''}`}>{s + ' '}</span>)}
        </div>
        {body(false)}
      </>);
    } else {
      mid = (<>
        <div className="relative mx-3.5 aspect-video overflow-hidden rounded-2xl bg-[#111]">
          <canvas width={448} height={252} ref={e => { Rf.vc = e; Rf.vcDirty = true; }} className="block h-full w-full" />
          <span className="absolute left-2.5 top-2.5 rounded-full bg-black/45 px-2 py-[5px] text-[9.5px] font-bold tracking-[.14em] text-white">FILM</span>
          {!V.playing && (
            <button aria-label="Play" onClick={A.vidToggle}
              className="absolute inset-0 m-auto grid h-16 w-16 cursor-pointer place-items-center rounded-full border-0 bg-white/90 text-ink shadow-[0_10px_30px_rgba(0,0,0,.35)]">{I_PLAY}</button>
          )}
          <div ref={e => { Rf.vsub = e; }} className="absolute bottom-2.5 left-3 right-3 text-center text-[13px] font-semibold leading-[1.35] text-white [text-shadow:0_1px_3px_rgba(0,0,0,.8)]" />
        </div>
        <div className="mx-[18px] mt-2.5 flex items-center gap-3">
          <button aria-label={V.playing ? 'Pause' : 'Play'} onClick={A.vidToggle}
            className="grid h-[34px] w-[34px] flex-none cursor-pointer place-items-center rounded-full border-0 bg-ink/[.08] text-ink">{V.playing ? I_PAUSE : I_PLAY}</button>
          {pbar(e => { Rf.vBar = e; }, 'm-0 flex-1')}
          <span ref={e => { Rf.vT = e; }} className="whitespace-nowrap text-xs font-semibold tabular-nums text-[#3f4a43]" />
        </div>
        {body(true)}
      </>);
    }
    return (
      <aside key={id} aria-label={Pi.t[lg]}
        className="absolute bottom-[clamp(14px,2vh,28px)] right-[clamp(14px,2vw,28px)] top-[clamp(82px,11vh,106px)] z-10 flex w-[min(400px,calc(100vw-28px))] animate-[poiin_.5s_cubic-bezier(.2,.8,.2,1)_both] flex-col overflow-auto overscroll-contain rounded-3xl bg-pcard shadow-[0_30px_80px_rgba(30,20,10,.32)] por:bottom-2 por:left-2 por:right-2 por:top-auto por:max-h-[74vh] por:w-auto por:animate-[poiup_.5s_cubic-bezier(.2,.8,.2,1)_both]">
        <div className="flex items-center gap-2 pb-3 pl-[18px] pr-3.5 pt-3.5">
          <span className="text-[10px] font-bold uppercase tracking-[.14em] text-moss">{Pi.kick[lg]}</span>
          <span className="flex-1" />
          {langToggle(false, 'lang-card')}
          <button aria-label="Close" onClick={A.closeCard} className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border-0 bg-ink/[.07] text-ink">{I_X}</button>
        </div>
        {mid}
        <div className="mt-auto flex gap-2.5 px-[18px] pb-[18px] pt-4">
          <button onClick={A.closeCard} className={`${BTN_D} flex-1 justify-center${nz('close')}`}>{L.cont}{I_ARR}</button>
        </div>
      </aside>
    );
  };

  /* ---------- status chip (GPS → indoor positioning) ---------- */
  const chip = 'absolute left-1/2 top-[clamp(86px,11.5vh,116px)] z-[5] flex -translate-x-1/2 animate-[fin_.4s_both] items-center gap-2.5 whitespace-nowrap rounded-full bg-white/80 px-4 py-[9px] text-[clamp(11.5px,.85vw,13px)] font-semibold tracking-[.02em] text-ink shadow-[0_8px_26px_rgba(20,50,30,.12)] backdrop-blur-md por:top-[76px]';
  const bars = (lit: number, weak: boolean) => (
    <span className="flex h-[15px] items-end gap-[3px]">
      {['h-[6px]', 'h-[10px]', 'h-[15px]'].map((hgt, i) => (
        <i key={i} className={`block w-1 rounded-sm ${hgt} ${i < lit ? (weak ? 'bg-[#f0a020]' : 'bg-[#2fbf5a]') : 'bg-[rgba(120,130,120,.3)]'}`} />
      ))}
    </span>
  );
  const status = out
    ? st >= 0 && Z.mode === 'out'
      ? <div role="status" className={chip}>{bars(3, false)}<span>GPS · Strong</span></div>
      : Z.mode === 'door'
        ? <div role="status" className={chip}>{bars(2, true)}<span>GPS fading · switching to indoor</span></div>
        : null
    : !Z.hud || !Z.route
      ? <div role="status" className={chip}><span className={DOT_BLUE} /><span>Indoor positioning · Live</span></div>
      : null;

  const toastCls = 'absolute left-1/2 top-[clamp(214px,27vh,250px)] z-[8] flex -translate-x-1/2 animate-[cin_.35s_both] items-center gap-[9px] whitespace-nowrap rounded-full px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_12px_30px_rgba(0,0,0,.25)] por:top-[200px]';
  const toast = !out && (Z.rr
    ? <div role="status" className={`${toastCls} bg-[#e08a1a]`}><span className="h-[13px] w-[13px] animate-[spin_.8s_linear_infinite] rounded-full border-2 border-white/35 border-t-white" />{L.rr}</div>
    : Z.off
      ? <div role="status" className={`${toastCls} bg-[#e08a1a]`}>{L.off}</div>
      : Z.duck
        ? <div role="status" className={`${toastCls} bg-[#1d1a14]`}>{I_PAUSE}{L.duck}</div>
        : null);

  const copyBase = 'pointer-events-none absolute left-[clamp(20px,3.4vw,58px)] top-[55%] z-[3] max-w-[min(560px,88vw)] -translate-y-1/2 [&>*]:pointer-events-auto';

  return (
    <div className="relative h-full overflow-hidden">
      {introOn && <Intro onReveal={() => A.introReveal && A.introReveal()} onHero={() => setHeroPre(false)} onDone={() => setIntroOn(false)} />}

      {/* 3D stage (three.js canvas is mounted here by the engine) */}
      <div ref={mount} className={`absolute inset-0 [&_canvas]:block [&_canvas]:h-full [&_canvas]:w-full [&_canvas]:touch-none ${out ? '[&_canvas]:cursor-grab' : '[&_canvas]:cursor-default'}`} />

      {/* page fades over the map */}
      {out
        ? <div className={`pointer-events-none absolute inset-0 z-[1] ${st >= 0
          ? 'bg-[linear-gradient(to_bottom,var(--bg),var(--bgt)_110px)]'
          : 'bg-[radial-gradient(ellipse_36%_64%_at_-2%_54%,var(--bg)_40%,var(--bgt)_100%),linear-gradient(to_bottom,var(--bg),var(--bgt)_90px)] por:bg-[linear-gradient(to_bottom,var(--bg)_0,var(--bg)_38%,var(--bgt)_62%)]'}`} />
        : <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_80%_75%_at_55%_52%,rgba(40,25,10,0)_55%,rgba(40,25,10,.26))]" />}
      {!out && Z.cap && <div key="fin" className="pointer-events-none absolute inset-0 z-[1] animate-[fin_.6s_both] bg-[radial-gradient(ellipse_48%_80%_at_-6%_55%,rgba(248,244,236,.93)_40%,rgba(248,244,236,0)_100%),linear-gradient(to_bottom,rgba(248,244,236,.85),rgba(248,244,236,0)_120px)] por:hidden" />}

      {/* landmark name tags (positioned every frame by the engine) */}
      {out && (
        <div className={`pointer-events-none absolute inset-0 z-[2] overflow-hidden transition-opacity [transition-duration:900ms]${hide}`}>
          {PLACES.map((p: any, i: number) => (
            <button key={p.n} ref={e => { Rf.lab[i] = e; }} aria-label={p.en}
              onClick={() => A.pick(i)} onMouseEnter={() => { Z.hov = i; }} onMouseLeave={() => { Z.hov = null; }}
              style={{ '--c': p.c, '--t': p.tc || '#fff', visibility: 'hidden' } as CSSProperties}
              className={`group/pin absolute left-0 top-0 z-[2] cursor-pointer border-0 bg-transparent p-0 text-left text-[clamp(13px,.95vw,15px)] font-extrabold leading-[1.12] text-ink transition-opacity [transition-duration:250ms] will-change-transform hover:!z-[9999] is-dim:opacity-40 is-hv:pointer-events-auto ${active === i ? 'on pointer-events-auto' : ''}`}>
              <span className="flex origin-left -translate-x-2 scale-[.96] flex-col gap-px whitespace-nowrap rounded-xl bg-white/95 py-[7px] pl-[11px] pr-[13px] opacity-0 shadow-[0_10px_24px_rgba(20,40,25,.18)] transition-[opacity,transform] duration-200 [transition-timing-function:cubic-bezier(.2,.9,.3,1.2)] group-hover/pin:translate-x-0 group-hover/pin:scale-100 group-hover/pin:opacity-100 group-[.hv]/pin:translate-x-0 group-[.hv]/pin:scale-100 group-[.hv]/pin:opacity-100 group-[.on]/pin:translate-x-0 group-[.on]/pin:scale-100 group-[.on]/pin:opacity-100">
                <b className="text-[13.5px] font-bold leading-[1.2] text-ink">{p.en.replace('Ethiopian ', '').replace('Unity ', '')}</b>
                <small className="flex items-center gap-1 text-[11px] font-semibold leading-[1.2] text-[#6b7168]">{I_WALKER}{p.mn} min walk</small>
              </span>
            </button>
          ))}
          {Object.entries(SUBS).flatMap(([pi, arr]: [string, any]) => arr.map(([l, px, py]: [string, number, number]) => (
            <span key={pi + l} ref={e => { Rf.sub[pi + l] = e; if (e) (e as any)._d = [pi, l, px, py]; }}
              style={{ '--c': PLACES[+pi].c, visibility: 'hidden' } as CSSProperties}
              className="pointer-events-none absolute left-0 top-0 z-[2] grid h-[22px] w-[22px] place-items-center rounded-[7px] bg-white text-[11.5px] font-bold leading-none text-ink shadow-[0_0_0_2px_var(--c),0_4px_10px_rgba(20,40,25,.25)] will-change-transform after:absolute after:left-1/2 after:top-full after:-ml-px after:h-2 after:w-0.5 after:bg-[var(--c)] after:content-['']">
              {l}
            </span>
          )))}
        </div>
      )}

      {out && st < 0 && Z.mode === 'out' && !cur && !Z.explored && (
        <div role="note"
          className={`pointer-events-none absolute bottom-[clamp(18px,4vh,40px)] left-[62%] z-[4] flex -translate-x-1/2 animate-[cin_.6s_.4s_both] items-center gap-2.5 rounded-full bg-ink/[.92] py-2.5 pl-3 pr-[18px] text-[13.5px] font-semibold text-white shadow-[0_12px_30px_rgba(15,61,38,.28)] transition-opacity [transition-duration:900ms] por:bottom-4 por:left-1/2 por:max-w-[calc(100vw-32px)] por:whitespace-nowrap por:py-2 por:pl-2.5 por:pr-3.5 por:text-xs p440:hidden ls:hidden${hide}`}>
          <span className="grid h-7 w-7 animate-[tap_1.6s_ease-in-out_infinite] place-items-center rounded-full bg-lime text-ink por:h-6 por:w-6">{I_HAND}</span>
          Drag to rotate · scroll to zoom · tap a landmark
        </div>
      )}

      {/* outdoor journey: navigator bubble */}
      {out && st >= 0 && Z.mode === 'out' && (
        <div ref={e => { Rf.bubble = e; }} style={{ visibility: 'hidden' }} className="pointer-events-none absolute left-0 top-0 z-[6] flex flex-col items-center will-change-transform">
          <div key={'s' + st} className="pointer-events-auto w-[clamp(240px,19vw,290px)] animate-[bubin_.5s_cubic-bezier(.2,.8,.2,1)_both] rounded-[18px] border border-white/80 bg-white/60 px-4 pb-3.5 pt-[13px] shadow-[0_18px_44px_rgba(15,61,38,.2),inset_0_1px_0_rgba(255,255,255,.95)] backdrop-blur-[18px] backdrop-saturate-[1.6]">
            <div className="flex items-center gap-[7px] text-[9.5px] font-bold tracking-[.16em] text-ink">
              <span className={DOT_LIVE} />MENELIK II PALACE
              <span ref={e => { Rf.eta = e; }} className="ml-auto rounded-full bg-ink/[.07] px-2 py-[3px] text-[11px] font-semibold tracking-normal text-[#3d4a42] tabular-nums" />
            </div>
            <div className="mt-[9px] font-news text-[27px] font-semibold leading-[1.02] tracking-[-.015em] text-ink">{OUT_STAGES[st].t}</div>
            <div className="mt-[3px] text-[13px] font-medium leading-[1.4] text-[#46544b]">{OUT_STAGES[st].s}</div>
            <div className="mt-[11px] flex gap-1">
              {[0, 1, 2, 3].map(i => <i key={i} className={`h-[3px] flex-1 rounded-sm transition-colors [transition-duration:400ms] ${i <= st ? 'bg-ink' : 'bg-ink/[.13]'}`} />)}
            </div>
            {st < 3
              ? <em className="mt-[9px] flex animate-[hint_1.8s_ease-in-out_infinite] items-center gap-1.5 text-[11.5px] font-medium not-italic text-[#5b665f]">Scroll to keep moving{I_DOWN}</em>
              : <button onClick={A.stepInside} className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-ink px-4 py-[11px] text-sm font-semibold text-white">Step inside{I_ARR}</button>}
          </div>
          <div className="h-[30px] w-0.5 rounded-sm bg-[linear-gradient(rgba(255,255,255,.95),rgba(255,255,255,.1))] after:-ml-[3px] after:mt-7 after:block after:h-2 after:w-2 after:rounded-full after:bg-white after:shadow-[0_0_0_3px_rgba(47,107,255,.35)] after:content-['']" />
        </div>
      )}
      {out && st >= 2 && Z.mode === 'out' && (
        <div ref={e => { Rf.pal = e; }} className="pointer-events-none invisible absolute left-0 top-0 z-[2] whitespace-nowrap rounded-full bg-ink px-3 py-[7px] text-[12.5px] font-semibold leading-none text-white shadow-[0_6px_18px_rgba(20,50,30,.18)] will-change-transform">Menelik II Palace</div>
      )}

      {status}

      {/* indoor: turn-by-turn HUD (state classes near/off/done/pause/side are toggled by the engine) */}
      {!out && Z.hud && Z.route && (
        <div ref={e => { Rf.hud = e; }} role="status" aria-live="polite"
          className="group/hud absolute left-1/2 top-[clamp(82px,11vh,106px)] z-[8] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 animate-[hudin_.5s_both] rounded-[22px] border border-white/80 bg-[rgba(255,253,248,.8)] px-3.5 pb-3 pt-[11px] text-ink shadow-[0_16px_40px_rgba(30,20,10,.18)] backdrop-blur-[18px] backdrop-saturate-150 transition-[background,color,transform,left] [transition-duration:350ms] is-side:left-[clamp(16px,2.5vw,40px)] is-side:translate-x-0 is-near:scale-[1.035] is-near:bg-ink/[.92] is-near:text-white is-off:bg-[rgba(255,246,228,.92)] por:top-[72px] por:is-side:hidden">
          <div className="mb-[9px] flex items-center gap-2 text-[9.5px] font-bold tracking-[.14em] text-moss group-[.near]/hud:text-white/70">
            <span className={DOT_BLUE} />{L.pos}<span className="flex-1" />
            {langToggle(false, 'lang')}
            <button aria-label={Z.voice ? 'Mute voice guidance' : 'Unmute voice guidance'} onClick={A.voice}
              className="grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-full border-0 bg-ink/[.08] text-inherit group-[.near]/hud:bg-white/[.14]">{Z.voice ? I_SPK : I_MUTE}</button>
          </div>
          <div className="flex items-center gap-3">
            <div ref={e => { Rf.hIco = e; }}
              className="grid h-12 w-12 flex-none place-items-center rounded-[15px] bg-ink text-white transition-[background,color,transform] duration-300 group-[.done]/hud:bg-lime group-[.done]/hud:text-ink group-[.near]/hud:scale-[1.06] group-[.near]/hud:bg-lime group-[.near]/hud:text-ink group-[.off]/hud:bg-[#e08a1a] group-[.pause]/hud:bg-ink/[.12] group-[.pause]/hud:text-ink [&.spin_svg]:animate-spin" />
            <div className="min-w-0 flex-1">
              <b ref={e => { Rf.hTx = e; }} className="block truncate text-[19px] font-semibold leading-[1.15] por:text-base" />
              <small ref={e => { Rf.hSub = e; }} className="mt-[3px] block truncate text-[12.5px] font-medium text-sub group-[.near]/hud:text-white/70" />
            </div>
            <div ref={e => { Rf.hD = e; }} className="whitespace-nowrap font-news text-[26px] font-semibold leading-none tabular-nums por:text-[21px]" />
          </div>
          <div className="mt-[11px] h-1 overflow-hidden rounded-sm bg-ink/10"><i ref={e => { Rf.hBar = e; }} className="block h-full w-0 bg-[linear-gradient(90deg,#2fbf5a,#3fdc2c)]" /></div>
        </div>
      )}

      {/* indoor: point-of-interest hotspots */}
      {!out && ['poi1', 'poi2', 'poi3'].map(id => (Z.hs === id && !Z.card ? (
        <button key={id} ref={e => { Rf.hs[id] = e; }} onClick={() => A.openPoi(id)}
          className="invisible absolute left-0 top-0 z-[6] flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 will-change-transform">
          <span className={"relative grid h-12 w-12 place-items-center rounded-full bg-white/90 text-ink shadow-[0_0_0_3px_var(--lime),0_12px_26px_rgba(0,0,0,.28)] before:absolute before:-inset-[3px] before:animate-[ring_2.2s_infinite] before:rounded-full before:border-2 before:border-lime before:content-[''] after:absolute after:-inset-[3px] after:animate-[ring_2.2s_1.1s_infinite] after:rounded-full after:border-2 after:border-lime after:content-['']" + nz(id)}>
            {POI[id].ic === '▶' ? I_PLAY : POI[id].ic === '♪' ? I_MUSIC : I_INFO}
          </span>
          <span className="whitespace-nowrap rounded-full bg-ink px-3.5 py-[9px] text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(0,0,0,.2)]">{L[POI[id].lab]}</span>
        </button>
      ) : null))}
      {!out && (Z.preview || Z.route) && (
        <div ref={e => { Rf.dl = e; }} className="pointer-events-none invisible absolute left-0 top-0 z-[5] flex items-center gap-2 whitespace-nowrap rounded-full bg-white py-[7px] pl-[9px] pr-3 text-[12.5px] font-semibold text-ink shadow-[0_8px_20px_rgba(20,50,30,.2)] will-change-transform">
          <i className="h-2.5 w-2.5 rounded-full bg-lime shadow-[0_0_0_3px_rgba(63,220,44,.3)]" />{DEST[Z.preview ? Z.preview.k : Z.route.dest][Z.lang]}
        </div>
      )}
      <div ref={e => { Rf.door = e; }} className="pointer-events-none absolute inset-0 z-[7] opacity-0" />

      {/* header */}
      <header className={`pointer-events-none absolute inset-x-0 top-0 z-[12] flex items-center justify-between px-[clamp(18px,2.5vw,42px)] py-[clamp(14px,2.6vh,26px)] transition-opacity [transition-duration:900ms] [&>*]:pointer-events-auto por:px-4 por:py-3.5 p360:p-3 ls:px-[18px] ls:py-2.5${hide}`}>
        <a href="#" className="flex items-center gap-3.5 text-[clamp(24px,2.6vw,34px)] font-bold tracking-[-.03em] text-ink no-underline por:gap-2.5 por:text-2xl p360:gap-2 p360:text-xl ls:text-[22px]">
          <span className="grid h-[clamp(40px,3vw,50px)] w-[clamp(40px,3vw,50px)] place-items-center rounded-xl bg-ink text-2xl font-bold tracking-[-.04em] text-white por:h-[38px] por:w-[38px] por:text-xl p360:h-8 p360:w-8 p360:rounded-[9px] p360:text-[17px] ls:h-[34px] ls:w-[34px] ls:text-lg">in</span>
          Indoor
        </a>
        <nav className="flex gap-[clamp(20px,3vw,50px)] mx900:hidden">
          {['How it works', 'For venues', 'For businesses', 'Use cases', 'Resources'].map(t => (
            <a key={t} href="#" className="text-[clamp(14px,1vw,17px)] font-medium text-ink no-underline">{t}</a>
          ))}
        </nav>
        <a href="#" className="flex items-center gap-3 rounded-full bg-ink px-[clamp(22px,1.8vw,30px)] py-[clamp(12px,1.6vh,16px)] text-[clamp(14px,1vw,17px)] font-medium text-white no-underline por:px-4 por:py-2.5 por:text-[13px] p360:gap-2 p360:px-3 p360:py-2 p360:text-xs ls:px-4 ls:py-[9px] ls:text-[13px]">
          Talk to us<Icon d="M5 12h14M13 6l6 6-6 6" />
        </a>
      </header>

      {/* hero / place card */}
      {out && st < 0 && Z.mode === 'out' && (
        <div className={`${copyBase} por:left-4 por:right-4 por:top-[84px] por:max-w-none por:translate-y-0 p360:left-3 p360:right-3 p360:top-[68px] ph640:top-16 ls:top-[56%] ls:max-w-[46vw]`}>
          {cur ? (
            <div key={'d' + cur.n} role="status" style={{ '--c': cur.c, '--t': cur.tc || '#fff' } as CSSProperties}
              className="w-[min(390px,86vw)] animate-[cin2_.35s_both] rounded-[18px] bg-white px-7 py-[26px] shadow-[0_18px_50px_rgba(20,50,30,.14)] por:w-full por:p-[18px] ls:w-[min(340px,44vw)] ls:px-[18px] ls:py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-[46px] w-[46px] flex-none place-items-center rounded-[14px] bg-[var(--c)] text-[var(--t)] shadow-[0_8px_18px_rgba(20,40,25,.18)]">{picon(cur.ic, 22)}</span>
                <div>
                  <div className="text-xs font-semibold tracking-[.14em] text-moss">{cur.cat}</div>
                  <div className="mt-0.5 font-extrabold text-sub">{cur.am}</div>
                </div>
              </div>
              <h2 className="mb-0.5 mt-2 font-news text-[38px] font-semibold leading-none tracking-[-.03em] por:text-3xl ls:text-[26px]">{cur.en}</h2>
              <p className="mb-4 mt-0 text-[15px] leading-[1.55] text-sub ls:mb-2.5 ls:text-[13px]">{cur.blurb}</p>
              {cur.sub.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-1.5 ls:hidden">
                  {cur.sub.slice(0, 9).map((t: string) => <span key={t} className="rounded-lg bg-ink/[.06] px-[9px] py-[5px] text-[11.5px] font-semibold text-[#3f4a43]">{t}</span>)}
                </div>
              )}
              <span className="mb-[18px] inline-flex items-center gap-1.5 rounded-full bg-[rgba(80,190,90,.16)] px-3.5 py-[7px] text-[13px] font-semibold text-ink">{I_WALKER}{cur.mn} min walk from the main entrance</span>
              <div className="flex flex-wrap gap-2.5">
                {cur.n === 4
                  ? <button className={BTN_D} onClick={() => { setActive(null); A.begin(); }}>Navigate here{I_ARR}</button>
                  : <button className={BTN_D} onClick={next}>Next stop{I_ARR}</button>}
                <button className={BTN_L} onClick={() => setActive(null)}>All places</button>
              </div>
            </div>
          ) : (
            <div data-hero="" key={'hero' + heroPre}
              className={`max-w-[540px] por:flex por:max-w-none por:flex-col por:items-center por:text-center ${heroPre ? 'invisible' : ''}`}>
              <h1 data-hero-title=""
                className={`m-0 mt-[clamp(18px,3vh,28px)] font-bricolage text-[clamp(50px,5.2vw,94px)] font-bold leading-[.95] tracking-[-.032em] text-ink [font-variation-settings:'opsz'_96] por:inline-block por:text-[clamp(38px,10.5vw,60px)] ph640:!mt-0 ph640:!text-[clamp(28px,9.4vw,40px)] p380:text-4xl ls:mt-0 ls:text-[clamp(30px,6.4vh,44px)] ${heroPre ? 'animate-[hin_.8s_.08s_both]' : ''}`}>
                Where do you<br />want to <span aria-label="go?" className="inline-block"><GoMark /></span>
              </h1>
              <div className="mt-2.5 animate-[hin_.8s_.14s_both] font-eth text-[clamp(15px,1.15vw,18px)] font-semibold leading-[1.3] text-[#6d8a73] por:hidden ls:hidden">የት መሄድ ይፈልጋሉ?</div>
              <p className="mt-[clamp(16px,2.4vh,22px)] max-w-[440px] animate-[hin_.8s_.2s_both] text-[clamp(15px,1.08vw,17.5px)] leading-[1.6] text-[#59615b] por:hidden ls:hidden">
                Ten destinations across the historic palace grounds — royal halls, gardens and wildlife. Start at the palace, or wander the map yourself.
              </p>
              <div className="mt-[clamp(24px,4vh,38px)] flex animate-[hin_.8s_.26s_both] items-center gap-[18px] por:mt-5 por:w-full por:flex-col por:gap-1.5 ph640:mt-3 ph640:gap-0.5 ls:mt-4 ls:gap-3">
                <SlideGo label="Slide to start your journey" onDone={() => { setActive(null); A.begin(); }} />
                <button onClick={() => { A.zoom(-30); Z.explored = true; Z.bump(); }}
                  className="cursor-pointer border-0 bg-[linear-gradient(#0f3d26,#0f3d26)] bg-[length:100%_1.5px] bg-[position:0_100%] bg-no-repeat px-0.5 py-2.5 text-[15px] font-semibold text-ink transition-[background-size] duration-300 hover:bg-[length:0_1.5px] hover:bg-[position:100%_100%] por:text-sm ph640:py-1.5 ph640:text-[13px]">
                  Explore the map
                </button>
              </div>
              <HomeSearch className="mt-[clamp(14px,2.4vh,22px)] animate-[hin_.8s_.32s_both] por:mx-auto ph640:mt-2.5" />
            </div>
          )}
        </div>
      )}

      {/* indoor story caption */}
      {!out && Z.cap && (
        <div key={'c' + beat}
          className={`${copyBase} animate-[capin_.7s_both] por:bottom-3 por:left-3 por:right-3 por:top-auto por:max-w-none por:translate-y-0 por:animate-[cin2_.5s_both] por:rounded-[20px] por:bg-[rgba(255,253,248,.9)] por:px-[18px] por:py-4 por:shadow-[0_14px_40px_rgba(30,20,10,.18)] por:${GLASS}`}>
          <div className="mb-[clamp(14px,2.4vh,24px)] text-[clamp(14px,1.1vw,19px)] font-medium tracking-[.18em] text-moss por:mb-2 por:text-xs">{Z.cap.eye || 'MENELIK II PALACE'}</div>
          <h1 className="m-0 font-news text-[clamp(34px,3.6vw,62px)] font-semibold leading-[1.04] tracking-[-.02em] text-ink por:text-[clamp(26px,7.5vw,36px)]">{Z.cap.h}</h1>
          {Z.cap.p && <p className="mt-[22px] max-w-[430px] text-[clamp(16px,1.2vw,20px)] leading-[1.55] text-sub por:mt-2 por:text-sm">{Z.cap.p}</p>}
          {Z.cap.dest && destCard(Z.cap.dest)}
          {Z.cap.btn && <button className={BTN_D + nz('up')} style={{ marginTop: 22 }} onClick={A.upstairs}>{L.upstairs}{I_UP}</button>}
          {Z.cap.end && (
            <div className="mt-[26px] flex flex-wrap items-center gap-3.5">
              <span className="text-[11px] font-semibold tracking-[.14em] text-sub">END OF THIS SECTION</span>
              <button className={BTN_L} onClick={A.replay}>Replay journey ↻</button>
            </div>
          )}
        </div>
      )}

      {!out && Z.coach && !Z.card && (
        <div key={'co' + beat} className="absolute bottom-[clamp(22px,5vh,48px)] left-1/2 z-[8] max-w-[min(420px,calc(100vw-32px))] -translate-x-1/2 animate-[cin_.5s_both] rounded-[20px] border border-white/80 bg-[rgba(255,253,248,.86)] px-5 py-3.5 text-center shadow-[0_16px_40px_rgba(30,20,10,.18)] backdrop-blur-[16px]">
          <b className="block font-news text-[22px] font-semibold leading-[1.15] text-ink">{Z.coach.h}</b>
          <span className="mt-1 block text-[13.5px] font-medium text-sub">{Z.coach.p}</span>
        </div>
      )}
      {toast}
      {!out && beat === 'lang' && (
        <div className="absolute bottom-[clamp(22px,5vh,48px)] left-1/2 z-[8] w-[min(380px,calc(100vw-32px))] -translate-x-1/2 animate-[cin_.5s_both] rounded-[22px] bg-pcard px-5 pb-5 pt-[18px] text-center shadow-[0_22px_60px_rgba(30,20,10,.25)]">
          <div className="text-[10px] font-bold tracking-[.16em] text-moss">LANGUAGE · ቋንቋ</div>
          <b className="mt-1.5 block font-news text-[26px] font-semibold leading-[1.15]">
            {Z.langDone ? (Z.lang === 'am' ? 'ተቀይሯል። እንቀጥል።' : 'English it is. Let’s continue.') : 'Prefer Amharic?'}
          </b>
          <span className="mb-4 mt-1.5 block text-[13.5px] font-medium text-sub">Directions, stories and exhibits switch instantly.</span>
          {langToggle(true, 'lang')}
        </div>
      )}
      {!out && Z.card && poiCard()}
      {!out && Z.lb != null && Z.imgs.poi1 && (
        <div role="dialog" aria-label="Image viewer" onClick={A.lbClose}
          className="absolute inset-0 z-20 flex animate-[fin_.3s_both] flex-col items-center justify-center gap-3.5 bg-[rgba(14,12,9,.92)] p-5">
          <img src={Z.imgs.poi1[Z.lb]} alt={POI.poi1.cap[Z.lang][Z.lb]} onClick={e => e.stopPropagation()} className="max-h-[78vh] max-w-[min(1100px,92vw)] rounded-xl shadow-[0_30px_80px_rgba(0,0,0,.5)]" />
          <div className="text-sm font-medium text-[#e8e2d6]">{POI.poi1.cap[Z.lang][Z.lb] + '  ·  ' + (Z.lb + 1) + ' / 3'}</div>
          <button aria-label="Previous" onClick={e => { e.stopPropagation(); A.lbStep(-1); }} className="absolute left-5 top-1/2 h-12 w-12 -translate-y-1/2 cursor-pointer rounded-full border-0 bg-white/[.12] text-[22px] text-white">‹</button>
          <button aria-label="Next" onClick={e => { e.stopPropagation(); A.lbStep(1); }} className="absolute right-5 top-1/2 h-12 w-12 -translate-y-1/2 cursor-pointer rounded-full border-0 bg-white/[.12] text-[22px] text-white">›</button>
          <button aria-label="Close" className="absolute right-5 top-5 h-11 w-11 cursor-pointer rounded-full border-0 bg-white/[.12] text-xl text-white">✕</button>
        </div>
      )}
      {!out && (N.on || N.ducked) && Z.card !== 'poi2' && (
        <div className={`absolute bottom-[clamp(16px,3vh,32px)] left-[clamp(16px,2.5vw,40px)] z-[8] flex max-w-[calc(100vw-32px)] animate-[cin2_.4s_both] items-center gap-3 rounded-[18px] bg-[rgba(255,253,248,.88)] py-2.5 pl-3.5 pr-3 shadow-[0_12px_30px_rgba(30,20,10,.16)] por:bottom-auto por:top-[200px] ${GLASS}`}>
          <span className={`flex h-5 items-center gap-0.5 ${N.on && !N.ducked ? WAVE_ON : ''}`}>{[0, 1, 2, 3, 4].map(i => <i key={i} className={WAVE_BAR} />)}</span>
          <div>
            <b className="block text-[13px] font-semibold">{POI.poi2.t[Z.lang]}</b>
            <small className="block text-[11.5px] font-medium text-sub">{N.ducked ? L.duck : L.nowp}</small>
          </div>
          <button aria-label="Pause story" onClick={A.narToggle} className="grid h-[34px] w-[34px] flex-none cursor-pointer place-items-center rounded-full border-0 bg-ink text-white">{I_PAUSE}</button>
        </div>
      )}
      {!out && Z.showFloor && (
        <div aria-label="Floor" className="absolute bottom-[clamp(20px,5vh,56px)] left-[clamp(20px,3.4vw,58px)] z-[8] flex animate-[cin2_.4s_both] flex-col-reverse gap-1.5 text-[10.5px] font-bold tracking-[.14em] por:bottom-auto por:left-3.5 por:top-[200px]">
          {[0, 1].map(f => {
            const on = Z.floor === f, nxt = f === 1 && !on && (beat === 'eggup' || beat === 'climb');
            return <span key={f} className={`rounded-full px-3 py-[7px] text-center transition-colors [transition-duration:400ms] ${on ? 'bg-ink text-white' : nxt ? 'bg-white/75 text-ink shadow-[inset_0_0_0_1.5px_var(--lime)]' : 'bg-white/75 text-sub'}`}>{f ? L.upper : L.ground}</span>;
          })}
        </div>
      )}
      {!out && Z.wait === 'scroll' && !Z.card && (
        <button onClick={A.advance}
          className="absolute bottom-[clamp(20px,4vh,40px)] left-1/2 z-[8] flex -translate-x-1/2 animate-[cin_.5s_both] cursor-pointer items-center gap-2.5 rounded-full border-0 bg-[rgba(255,253,248,.82)] px-[18px] py-[11px] text-[13.5px] font-semibold text-ink shadow-[0_10px_26px_rgba(30,20,10,.14)] backdrop-blur-md [&_svg]:animate-[hint_1.6s_ease-in-out_infinite]">
          Scroll to continue{I_DOWN}
        </button>
      )}

      {/* map controls */}
      {out && st < 0 && Z.mode === 'out' && (
        <div className={`absolute bottom-[clamp(90px,19vh,200px)] right-[clamp(14px,1.6vw,28px)] z-[4] flex flex-col gap-3 transition-opacity [transition-duration:900ms] por:bottom-4 por:right-3 por:gap-2 ph640:bottom-2.5 ph640:right-2.5 ph640:gap-1.5 ls:bottom-3 ls:gap-1.5${hide}`}>
          <button aria-label="Reset view" onClick={A.reset} className={`${CTL_BTN} relative ph700:hidden`}>
            <span ref={e => { Rf.comp = e; }} className="relative grid place-items-center transition-transform duration-200">
              <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l3.2 9H8.8z" fill="#d9483b" /><path d="M12 21l-3.2-9h6.4z" fill="#b9c0bb" /></svg>
              <b className="absolute -top-[13px] text-[8.5px] font-bold text-ink">N</b>
            </span>
          </button>
          <button aria-label="Zoom in" onClick={() => A.zoom(-12)} className={CTL_BTN}>+</button>
          <button aria-label="Zoom out" onClick={() => A.zoom(12)} className={CTL_BTN}>−</button>
          <button aria-label="Recenter" onClick={() => { A.reset(); setActive(null); }} className={CTL_BTN}>
            <Icon d="M12 2v3M12 19v3M2 12h3M19 12h3"><circle cx={12} cy={12} r={7} /><circle cx={12} cy={12} r={2.5} /></Icon>
          </button>
          <button aria-label="Show all names" aria-pressed={all} onClick={() => setAll(!all)} className={`${CTL_BTN} ph700:hidden`}><Icon d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" /></button>
          <button aria-label="Next stop" onClick={next} className={`${CTL_BTN} ph700:hidden`}><Icon d="M3 11l19-9-9 19-2-8-8-2z" /></button>
        </div>
      )}

      {/* journey progress */}
      <div className={`pointer-events-none absolute right-3.5 top-1/2 z-[4] h-[120px] w-[3px] -translate-y-1/2 overflow-hidden rounded-[3px] bg-ink/15 transition-opacity [transition-duration:900ms] por:hidden ls:hidden${hide}`}>
        <i style={{ height: prog * 100 + '%' }} className="block w-full bg-ink transition-[height] [transition-duration:600ms]" />
      </div>
    </div>
  );
}
