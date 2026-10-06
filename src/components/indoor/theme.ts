/**
 * The Indoor design language (the landing page's prototype), shared by the
 * visitor map: glass cards, ink pills, round white controls and live dots.
 * Colours and fonts come from tailwind.config.ts (ink, sub, paper, pcard,
 * lime, moss, navblue; font-inter, font-news, font-bricolage).
 */

const BTN = 'inline-flex cursor-pointer items-center justify-center gap-2.5 rounded-full border-0 px-[22px] py-[13px] text-[15px] font-semibold';
/** Solid ink pill: the main action ("Navigate here →"). */
export const BTN_D = `${BTN} bg-ink text-white`;
/** Outline pill: the secondary action. */
export const BTN_L = `${BTN} bg-transparent text-ink shadow-[inset_0_0_0_1.5px_rgba(120,130,120,.35)]`;

/** Pinging live dots. */
export const DOT_LIVE = 'h-[7px] w-[7px] flex-none animate-[pinglime_1.6s_infinite] rounded-full bg-lime';
export const DOT_BLUE = 'h-[9px] w-[9px] flex-none animate-[pingblue_1.8s_infinite] rounded-full bg-navblue';

/** Round white map control; aria-pressed turns it ink. */
export const CTL_BTN = 'grid h-11 w-11 lg:h-12 lg:w-12 cursor-pointer place-items-center rounded-full border-0 bg-white text-ink shadow-[0_6px_20px_rgba(20,50,30,.14)] transition-transform active:scale-95 aria-pressed:bg-ink aria-pressed:text-white disabled:opacity-40';

/** Frosted glass card (the HUD, the search pill, docks). */
export const GLASS = 'border border-white/80 bg-[rgba(255,253,248,.8)] shadow-[0_16px_40px_rgba(30,20,10,.18)] backdrop-blur-[18px] backdrop-saturate-150';

/** Small caps eyebrow over a title. */
export const EYEBROW = 'text-[9.5px] font-bold uppercase tracking-[.14em] text-moss';

/** Soft chip (distance, time, floor). */
export const CHIP = 'inline-flex items-center gap-1.5 rounded-full bg-ink/[.06] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#3f4a43]';

/** Floor pills: inactive / active. */
export const FLOOR_PILL = 'rounded-full px-3 py-[7px] text-[13px] font-semibold transition-colors';
export const FLOOR_PILL_ON = 'bg-ink text-white';
export const FLOOR_PILL_OFF = 'bg-white/90 text-ink hover:bg-white';

/** The progress fill on the HUD. */
export const PROGRESS_FILL = 'bg-[linear-gradient(90deg,#2fbf5a,#3fdc2c)]';
