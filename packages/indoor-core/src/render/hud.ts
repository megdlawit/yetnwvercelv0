// The guidance HUD, framework-free, in the Indoor design: a frosted card
// with the next turn (icon, words, "then…", distance in serif), time and
// distance left, a floor indicator that flips as you climb, EN / አማ and
// voice switches — it turns ink as the turn comes close — and an arrival
// moment. Styles are scoped to the viewer's root (.ivw-*).

import type { Lang } from '../model';
import type { SessionState } from '../nav/session';
import type { StepKind } from '../nav/steps';
import { t } from '../nav/i18n';

export const HUD_CSS = `
.ivw-hud{position:absolute;left:50%;top:14px;z-index:20;width:min(440px,calc(100% - 28px));transform:translateX(-50%);box-sizing:border-box;
  border-radius:22px;border:1px solid rgba(255,255,255,.8);background:rgba(255,253,248,.84);color:#0f3d26;padding:11px 14px 12px;
  box-shadow:0 16px 40px rgba(30,20,10,.18);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5);
  transition:background .35s,color .35s,transform .35s;font-family:inherit}
.ivw-hud.ivw-near{background:rgba(15,61,38,.92);color:#fff;transform:translateX(-50%) scale(1.02)}
.ivw-hud.ivw-off{background:rgba(255,246,228,.94)}
.ivw-hud[hidden]{display:none}
.ivw-eyebrow{display:flex;align-items:center;gap:8px;margin-bottom:9px;font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#2f6b2f}
.ivw-near .ivw-eyebrow{color:rgba(255,255,255,.72)}
.ivw-dot{width:9px;height:9px;border-radius:50%;background:#2f6bff;flex:none;animation:ivw-ping 1.8s infinite}
@keyframes ivw-ping{0%{box-shadow:0 0 0 0 rgba(47,107,255,.5)}100%{box-shadow:0 0 0 10px rgba(47,107,255,0)}}
.ivw-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ivw-chip{flex:none;border-radius:999px;background:#0f3d26;color:#fff;padding:3px 8px;font-size:10px;letter-spacing:.08em;animation:ivw-flip .35s both}
.ivw-near .ivw-chip{background:rgba(255,255,255,.16)}
@keyframes ivw-flip{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}
.ivw-seg{display:inline-flex;border-radius:999px;background:rgba(15,61,38,.08);padding:2px;flex:none}
.ivw-near .ivw-seg{background:rgba(255,255,255,.14)}
.ivw-seg button,.ivw-round{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}
.ivw-seg button{border-radius:999px;padding:4px 9px;font-size:11px;font-weight:600;letter-spacing:0;text-transform:none}
.ivw-seg button[aria-pressed=true]{background:#0f3d26;color:#fff}
.ivw-near .ivw-seg button[aria-pressed=true]{background:#fff;color:#0f3d26}
.ivw-round{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:rgba(15,61,38,.08);flex:none}
.ivw-near .ivw-round{background:rgba(255,255,255,.14)}
.ivw-row{display:flex;align-items:center;gap:12px}
.ivw-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:15px;background:#0f3d26;color:#fff;flex:none;transition:background .3s,color .3s,transform .3s}
.ivw-near .ivw-icon{background:#3fdc2c;color:#0f3d26;transform:scale(1.04)}
.ivw-off .ivw-icon{background:#e08a1a}
.ivw-icon svg{width:22px;height:22px}
.ivw-text{flex:1;min-width:0}
.ivw-text b{display:block;font-size:19px;font-weight:600;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ivw-text small{display:block;margin-top:3px;font-size:12.5px;font-weight:500;color:#6b7168;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ivw-near .ivw-text small{color:rgba(255,255,255,.72)}
.ivw-dist{font-family:Newsreader,'Noto Sans Ethiopic',Georgia,serif;font-size:26px;font-weight:600;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums}
.ivw-bar{margin-top:11px;height:4px;border-radius:3px;background:rgba(15,61,38,.1);overflow:hidden}
.ivw-near .ivw-bar{background:rgba(255,255,255,.15)}
.ivw-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2fbf5a,#3fdc2c);transition:width .5s}
.ivw-foot{margin-top:8px;font-size:11.5px;font-weight:600;color:#6b7168;font-variant-numeric:tabular-nums}
.ivw-near .ivw-foot{color:rgba(255,255,255,.75)}
.ivw-arrive{position:absolute;inset:auto 14px 18px;z-index:21;margin:0 auto;max-width:420px;border-radius:22px;background:rgba(15,61,38,.94);color:#fff;
  padding:18px 18px 16px;box-shadow:0 18px 44px rgba(15,61,38,.35);animation:ivw-rise .5s cubic-bezier(.2,.9,.3,1.2) both;display:flex;align-items:center;gap:14px}
.ivw-arrive[hidden]{display:none}
.ivw-arrive .ivw-icon{background:#3fdc2c;color:#0f3d26}
.ivw-arrive b{display:block;font-family:Newsreader,'Noto Sans Ethiopic',Georgia,serif;font-size:26px;font-weight:600;line-height:1.1}
.ivw-arrive small{display:block;margin-top:2px;font-size:13px;color:rgba(255,255,255,.75)}
@keyframes ivw-rise{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
@media (max-width:480px){.ivw-text b{font-size:16px}.ivw-dist{font-size:21px}.ivw-icon{width:44px;height:44px}}
@media (prefers-reduced-motion:reduce){.ivw-hud,.ivw-icon,.ivw-bar i{transition:none}.ivw-dot,.ivw-chip,.ivw-arrive{animation:none}}
`;

const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS: Record<string, string> = {
  start: svg('<path d="M3 11l19-9-9 19-2-8-8-2z"/>'),
  continue: svg('<path d="M12 20V4M6 10l6-6 6 6"/>'),
  left: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 015 5v6"/>'),
  right: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 00-5 5v6"/>'),
  'u-turn': svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-2"/>'),
  up: svg('<path d="M4 20h4v-4h4v-4h4V8h4"/><path d="M14 4h6v6"/>'),
  down: svg('<path d="M4 8h4v4h4v4h4v4h4"/><path d="M14 20h6v-6"/>'),
  lift: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 10l3-3 3 3M9 14l3 3 3-3"/>'),
  arrive: svg('<path d="M5 21V4h11l-2 4 2 4H5"/>'),
  reroute: svg('<path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 3v6h-6"/>'),
  voice: svg('<path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/>'),
  mute: svg('<path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
};

function iconFor(kind: StepKind | undefined): string {
  if (!kind) return ICONS.start;
  if (kind === 'arrive') return ICONS.arrive;
  if (kind === 'start') return ICONS.start;
  if (kind === 'continue') return ICONS.continue;
  if (kind === 'u-turn') return ICONS['u-turn'];
  if (kind.startsWith('elevator')) return ICONS.lift;
  if (kind.endsWith('-up')) return ICONS.up;
  if (kind.endsWith('-down')) return ICONS.down;
  return kind.includes('left') ? ICONS.left : kind.includes('right') ? ICONS.right : ICONS.continue;
}

export interface HudOptions {
  lang: Lang;
  voice: boolean;
  onLanguage?: (lang: Lang) => void;
  onVoice?: (on: boolean) => void;
}

export class GuidanceHUD {
  readonly el: HTMLDivElement;
  private arriveEl: HTMLDivElement;
  private refs: Record<string, HTMLElement> = {};
  private lastFloor = '';
  private total = 0;

  constructor(parent: HTMLElement, private opts: HudOptions) {
    if (!parent.querySelector('style[data-ivw-hud]')) {
      const st = document.createElement('style');
      st.dataset.ivwHud = '';
      st.textContent = HUD_CSS;
      parent.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.className = 'ivw-hud';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="ivw-eyebrow"><span class="ivw-dot"></span><span class="ivw-grow" data-r="to"></span><span data-r="floor"></span>
        <span class="ivw-seg" role="group" data-r="lang"><button data-l="en">EN</button><button data-l="am">አማ</button></span>
        <button class="ivw-round" data-r="voice"></button></div>
      <div class="ivw-row"><div class="ivw-icon" data-r="icon"></div><div class="ivw-text"><b data-r="text"></b><small data-r="then"></small></div><div class="ivw-dist" data-r="dist"></div></div>
      <div class="ivw-bar"><i data-r="bar"></i></div>
      <div class="ivw-foot" data-r="foot"></div>`;
    for (const n of this.el.querySelectorAll<HTMLElement>('[data-r]')) this.refs[n.dataset.r!] = n;
    this.refs.lang.addEventListener('click', e => {
      const l = (e.target as HTMLElement).dataset.l as Lang | undefined;
      if (l && l !== this.opts.lang) { this.opts.lang = l; this.opts.onLanguage?.(l); }
    });
    this.refs.voice.addEventListener('click', () => { this.opts.voice = !this.opts.voice; this.opts.onVoice?.(this.opts.voice); this.paintToggles(); });
    this.arriveEl = document.createElement('div');
    this.arriveEl.className = 'ivw-arrive';
    this.arriveEl.hidden = true;
    this.arriveEl.setAttribute('role', 'status');
    parent.appendChild(this.el);
    parent.appendChild(this.arriveEl);
    this.paintToggles();
  }

  setLang(lang: Lang) { this.opts.lang = lang; this.paintToggles(); }

  private paintToggles() {
    const L = this.opts.lang;
    this.refs.lang.setAttribute('aria-label', t(L, 'hud.language'));
    for (const b of this.refs.lang.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.l === L));
    this.refs.voice.innerHTML = this.opts.voice ? ICONS.voice : ICONS.mute;
    this.refs.voice.setAttribute('aria-label', this.opts.voice ? t(L, 'hud.voice-off') : t(L, 'hud.voice-on'));
  }

  update(s: SessionState) {
    const L = s.lang;
    if (s.status === 'idle') { this.el.hidden = true; this.arriveEl.hidden = true; this.total = 0; return; }
    this.paintToggles();
    if (s.status === 'arrived') {
      this.el.hidden = true;
      this.arriveEl.hidden = false;
      this.arriveEl.innerHTML = `<div class="ivw-icon">${ICONS.arrive}</div><div><b></b><small></small></div>`;
      this.arriveEl.querySelector('b')!.textContent = s.text.instruction;
      this.arriveEl.querySelector('small')!.textContent = s.text.then;
      return;
    }
    this.arriveEl.hidden = true;
    this.el.hidden = false;
    const near = s.status === 'navigating' && s.distanceToStep <= 8 && !!s.current && s.current.kind !== 'arrive';
    const off = s.status === 'rerouting' || s.status === 'no-route';
    this.el.classList.toggle('ivw-near', near);
    this.el.classList.toggle('ivw-off', off);
    const dest = s.destination ? (L === 'am' && s.destination.am ? s.destination.am : s.destination.en) : '';
    this.refs.to.textContent = dest ? t(L, 'hud.to', { place: dest }) : '';
    if (s.text.floor && s.text.floor !== this.lastFloor) {
      this.lastFloor = s.text.floor;
      this.refs.floor.innerHTML = '';
      const chip = document.createElement('span');
      chip.className = 'ivw-chip';
      chip.textContent = s.text.floor;
      this.refs.floor.appendChild(chip);
    }
    this.refs.icon.innerHTML = off ? ICONS.reroute : iconFor(s.current?.kind);
    this.refs.text.textContent = s.text.instruction;
    this.refs.then.textContent = s.text.then;
    this.refs.dist.textContent = s.text.distance;
    this.total = Math.max(this.total, s.remaining + s.progress);
    (this.refs.bar as HTMLElement).style.width = `${Math.round((this.total ? s.progress / this.total : 0) * 100)}%`;
    this.refs.foot.textContent = `${s.text.remaining} · ${s.text.eta}${s.stepFree ? ` · ${t(L, 'hud.step-free')}` : ''}`;
  }

  dispose() { this.el.remove(); this.arriveEl.remove(); }
}
