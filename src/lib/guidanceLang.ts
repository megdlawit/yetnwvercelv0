// The visitor's guidance language (English / Amharic) and the bridge from
// the navigation brain's instructions to the shared engine's wording
// (@ethi/indoor-core i18n). English keeps the brain's own tested text;
// Amharic is worded from keys.

import { useCallback, useEffect, useState } from 'react';
import { floorName, formatDistance, stepAhead, stepText, t, type IndoorFloor, type Lang, type Step, type StepKind, type Text2 } from '@ethi/indoor-core';
import type { UnifiedInstruction, UnifiedInstructionType } from '@/lib/InstructionEngine';

export type { Lang } from '@ethi/indoor-core';

const KEY = 'ethi_lang';

export function readLang(): Lang {
  try { return localStorage.getItem(KEY) === 'am' ? 'am' : 'en'; } catch { return 'en'; }
}

/** The guidance language, remembered on this device; every hook instance stays in sync. */
export function useGuidanceLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>(readLang);
  useEffect(() => {
    const on = (e: Event) => setLang((e as CustomEvent<Lang>).detail);
    window.addEventListener('ethi-lang', on);
    return () => window.removeEventListener('ethi-lang', on);
  }, []);
  const set = useCallback((l: Lang) => {
    try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent('ethi-lang', { detail: l }));
  }, []);
  return [lang, set];
}

/** What the wording needs to know about the venue. */
export interface LangContext {
  node: (id: string) => { name: Text2 | null; floorId: string } | null;
  floor: (id: string) => IndoorFloor | undefined;
  floors: IndoorFloor[];
  destination?: Text2 | null;
}

const KINDS: Partial<Record<UnifiedInstructionType, StepKind>> = {
  START: 'start', STRAIGHT: 'continue', LEFT: 'left', RIGHT: 'right', SLIGHT_LEFT: 'slight-left', SLIGHT_RIGHT: 'slight-right',
  STAIRS_UP: 'stairs-up', STAIRS_DOWN: 'stairs-down', ELEVATOR_UP: 'elevator-up', ELEVATOR_DOWN: 'elevator-down', ARRIVE: 'arrive',
};

/** The node an indoor instruction happens at (ids look like "indoor-<nodeId>-<TYPE>"). */
const nodeOf = (inst: UnifiedInstruction) => {
  const m = /^indoor-(.+)-[A-Z_]+$/.exec(inst.id);
  return m ? m[1] : null;
};

/** The brain's instruction as a core step (kind, landmark, floor reached). */
export function toStep(inst: UnifiedInstruction, ctx: LangContext): Step | null {
  const kind = KINDS[inst.type];
  if (!kind) return null;
  const node = nodeOf(inst);
  const n = node ? ctx.node(node) : null;
  const climb = kind.endsWith('-up') || kind.endsWith('-down');
  return {
    kind, s: 0, distance: inst.distanceM, floorId: n?.floorId ?? '', at: { x: 0, z: 0 },
    toFloorId: climb ? n?.floorId : undefined,
    landmark: !climb && kind !== 'arrive' && kind !== 'start' ? n?.name ?? null : null,
    place: kind === 'arrive' ? ctx.destination ?? n?.name ?? null : kind === 'start' ? n?.name ?? null : null,
  };
}

/** The instruction's text in the visitor's language. */
export function localizeInstruction(inst: UnifiedInstruction, lang: Lang, ctx: LangContext): string {
  if (lang === 'en') return inst.text;
  if (inst.type === 'ENTER_BUILDING') return t(lang, 'nav.gps-lost');
  if (inst.type === 'EXIT_BUILDING') return t(lang, 'nav.now-outside');
  const step = toStep(inst, ctx);
  return step ? stepText(step, lang, ctx.floors) : inst.text;
}

/**
 * An announcement in Amharic, from the brain's message key (null: no
 * Amharic wording for it — the caller speaks the English).
 */
export function localizeAnnouncement(key: string | undefined, lang: Lang, ctx: LangContext & { instruction?: UnifiedInstruction | null; distanceM?: number; english: string }): string | null {
  if (lang === 'en' || !key) return null;
  const k = key;
  if (k === 'nav-start') return t(lang, 'nav.start', { place: name(ctx.destination, lang) || t(lang, 'step.arrive.plain') });
  if (k.startsWith('turn')) {
    const inst = ctx.instruction;
    if (!inst) return null;
    const step = toStep(inst, ctx);
    if (!step) return localizeInstruction(inst, lang, ctx);
    const d = ctx.distanceM ?? 0;
    return d <= 5 || step.kind === 'arrive' || step.kind === 'start' ? stepText(step, lang, ctx.floors) : stepAhead(step, d, lang, ctx.floors);
  }
  if (k.startsWith('floor:')) {
    const f = ctx.floor(k.slice(6));
    const lift = /elevator|lift/i.test(ctx.english), up = /\bup\b/i.test(ctx.english);
    return t(lang, `step.${lift ? 'elevator' : 'stairs'}-${up ? 'up' : 'down'}`, { floor: floorName(f, lang) });
  }
  if (k.startsWith('reroute') || k === 'offroute') return t(lang, 'nav.off-route');
  if (k.startsWith('arrive')) return ctx.destination ? t(lang, 'step.arrive', { place: name(ctx.destination, lang) }) : t(lang, 'step.arrive.plain');
  if (k === 'env:indoor') return t(lang, 'nav.gps-lost');
  if (k === 'env:outdoor') return t(lang, 'nav.now-outside');
  if (k === 'env:transition') return t(lang, 'nav.approaching-entrance');
  return null;
}

/** "12 m" in the visitor's language. */
export const distanceIn = (m: number, lang: Lang) => formatDistance(m, lang);

const name = (x: Text2 | null | undefined, lang: Lang) => (x ? (lang === 'am' && x.am ? x.am : x.en) : '');
