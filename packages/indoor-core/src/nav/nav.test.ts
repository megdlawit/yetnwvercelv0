import { describe, expect, it, vi } from 'vitest';
import { fromPlan } from '../normalize';
import { pathFromNodes, pointAt } from '../path3d';
import { testVenueRows } from '../testVenue';
import { findRoute, nearestNode, unreachable } from './router';
import { buildSteps } from './steps';
import { floorName, formatDistance, stepText, t, STRINGS } from './i18n';
import { NavigationSession, type SessionState } from './session';
import { parseQrAnchor, PDRSource, SimulatedWalk, type Fix } from './positioning';

const venue = fromPlan(testVenueRows(), { wallHeight: 3 });

describe('findRoute', () => {
  it('takes the stairs by default (quicker), across floors', () => {
    const r = findRoute(venue, 'c', 'g')!;
    expect(r.nodeIds).toEqual(['c', 'h1', 'h2', 's0', 's1', 'g']);
    expect(r.floors).toEqual(['f0', 'f1']);
    expect(r.stepFree).toBe(false);
  });

  it('finds a step-free way by lift when asked', () => {
    const r = findRoute(venue, 'c', 'g', { stepFree: true })!;
    expect(r.nodeIds).toContain('lift0');
    expect(r.nodeIds).not.toContain('s0');
    expect(r.stepFree).toBe(true);
  });

  it('says there is no route when an edge is closed and nothing else goes there', () => {
    expect(findRoute(venue, 'c', 'g', { stepFree: true, avoid: new Set(['e-lift']) })).toBeNull();
  });

  it('starts from the path point nearest where someone stands, and spots unreachable ones', () => {
    expect(nearestNode(venue, 'f0', { x: 8.2, z: 6.3 })!.id).toBe('h1');
    expect(unreachable(venue, 'c')).toEqual([]);
  });
});

describe('buildSteps + i18n', () => {
  const r = findRoute(venue, 'c', 'g')!;
  const path = pathFromNodes(venue, r.nodeIds);
  const steps = buildSteps(venue, r, path);

  it('lists start, the stairs up to the first floor, a turn, and arrival', () => {
    // Off the top step (heading east), the gallery is back to the left: a 125° turn.
    expect(steps.map(s => s.kind)).toEqual(['start', 'stairs-up', 'sharp-left', 'arrive']);
    expect(steps[1]).toMatchObject({ floorId: 'f0', toFloorId: 'f1' });
    expect(steps[steps.length - 1].s).toBeCloseTo(path.length);
    // Distances add up to the whole route.
    expect(steps.reduce((a, s) => a + s.distance, 0)).toBeCloseTo(path.length);
  });

  it('words each step in English and Amharic', () => {
    const f = venue.floors;
    expect(stepText(steps[0], 'en', f)).toBe('Start at Café');
    expect(stepText(steps[0], 'am', f)).toBe('ከካፌ ይጀምሩ');
    expect(stepText(steps[1], 'en', f)).toBe('Take the stairs up to First');
    expect(stepText(steps[1], 'am', f)).toBe('በደረጃው ወደ አንደኛ ፎቅ ይውጡ');
    expect(stepText({ ...steps[2], landmark: { en: 'Gallery', am: 'ጋለሪ' } }, 'am', f)).toBe('ጋለሪ ጋ ሙሉ በሙሉ ወደ ግራ ይታጠፉ');
    expect(stepText({ ...steps[2], kind: 'right', landmark: null, door: true }, 'en', f)).toBe('Turn right through the door');
    expect(stepText(steps[3], 'en', f)).toBe('You have arrived at Gallery');
  });

  it('has every English key in Amharic too', () => {
    expect(Object.keys(STRINGS.en).filter(k => !(k in STRINGS.am))).toEqual([]);
  });

  it('formats distances and floors', () => {
    expect(formatDistance(12.4, 'en')).toBe('12 m');
    expect(formatDistance(47, 'am')).toBe('45 ሜትር');
    expect(formatDistance(1520, 'en')).toBe('1.5 km');
    expect(floorName({ id: 'x', name: { en: '' }, level: 2, order: 2, elevation: 7, ceilingHeight: 3 }, 'am')).toBe('2ኛ ፎቅ');
    expect(t('am', 'step.in', { distance: '10 ሜትር', instruction: 'ወደ ቀኝ ይታጠፉ' })).toBe('ከ10 ሜትር በኋላ ወደ ቀኝ ይታጠፉ');
  });
});

describe('NavigationSession', () => {
  const run = (opts: { detour?: boolean; lang?: 'en' | 'am' } = {}) => {
    const states: SessionState[] = [];
    const speaker = { say: vi.fn(), hush: vi.fn() };
    const nav = new NavigationSession(venue, { lang: opts.lang ?? 'en', speaker: speaker as never, onChange: s => states.push(s) });
    expect(nav.start('c', 'g')).toBe(true);
    const walk = new SimulatedWalk(nav.state.path!, opts.detour ? { detour: { atS: 6, metres: 8, offset: 6 } } : {});
    let clock = 0;
    walk.start(fix => nav.update({ ...fix, t: clock }));
    walk.stop(); // drive it by hand
    for (let i = 0; i < 400 && nav.state.status !== 'arrived'; i++) {
      clock += 250;
      if (nav.state.status === 'navigating' && walk.done === false) walk.advance(0.25);
      // After a reroute, walk the new route from where the visitor is.
      if (opts.detour && nav.state.status === 'navigating' && nav.state.path !== (walk as unknown as { path: unknown }).path) walk.follow(nav.state.path!);
    }
    return { nav, states, said: speaker.say.mock.calls.map(c => c[0] as string) };
  };

  it('walks the route: floor flips on the stairs, turns are announced, and it arrives', () => {
    const { nav, states, said } = run();
    expect(nav.state.status).toBe('arrived');
    expect(new Set(states.map(s => s.floorId))).toEqual(new Set(['f0', 'f1']));
    expect(states.some(s => s.climbing)).toBe(true);
    expect(said[0]).toBe('Starting your route to Gallery');
    expect(said.some(x => /stairs up to First/.test(x))).toBe(true);
    expect(said.some(x => /sharp left/i.test(x))).toBe(true);
    expect(said[said.length - 1]).toBe('You have arrived at Gallery');
    // Time left only ever goes down.
    const secs = states.filter(s => s.status === 'navigating').map(s => s.seconds);
    expect(secs.every((x, i) => i === 0 || x <= secs[i - 1] + 1e-6)).toBe(true);
  });

  it('notices a wrong turn and finds a new way', () => {
    const { nav, said } = run({ detour: true });
    expect(said).toContain("You're off the route — finding a new way");
    expect(said).toContain('New route found');
    expect(nav.state.status).toBe('arrived');
  });

  it('speaks and shows Amharic', () => {
    const { nav, said } = run({ lang: 'am' });
    expect(said[0]).toBe('ወደ ጋለሪ የሚወስደውን መንገድ እንጀምራለን'.replace('ጋለሪ', 'Gallery'));
    expect(nav.state.text.instruction).toBe('ደርሰዋል');
  });

  it('re-plans step-free from where the visitor is', () => {
    const nav = new NavigationSession(venue, {});
    nav.start('c', 'g');
    nav.setStepFree(true);
    expect(nav.state.route!.nodeIds).toContain('lift0');
    expect(nav.state.route!.stepFree).toBe(true);
  });
});

describe('positioning', () => {
  it('reads QR anchors: links, ethi: codes, ids and names', () => {
    expect(parseQrAnchor(venue, 'https://app.example/venue/b1?entry=entrance')!.at).toEqual(venue.nodes.find(n => n.id === 'e')!.at);
    expect(parseQrAnchor(venue, 'ethi:node/g')!.floorId).toBe('f1');
    expect(parseQrAnchor(venue, 'c')!.source).toBe('qr');
    expect(parseQrAnchor(venue, 'nowhere')).toBeNull();
  });

  it('PDR: each step moves one stride the way the compass points', () => {
    const fixes: Fix[] = [];
    const pdr = new PDRSource({ floorId: 'f0', at: { x: 0, z: 0 }, source: 'qr', t: 0 }, { stride: 0.7 });
    (pdr as unknown as { emit: (f: Fix) => void }).emit = f => fixes.push(f);
    pdr.onCompass(90); // facing east = plan +x
    let t = 0;
    for (let i = 0; i < 3; i++) for (const m of [9.8, 12.5, 12.5, 9.0, 9.0]) pdr.onAccel(m, (t += 100));
    expect(fixes.length).toBe(3);
    expect(fixes[2].at.x).toBeCloseTo(2.1, 5);
    expect(fixes[2].at.z).toBeCloseTo(0, 5);
  });

  it('a simulated walk goes up the stairs with the route', () => {
    const r = findRoute(venue, 'c', 'g')!;
    const path = pathFromNodes(venue, r.nodeIds);
    const w = new SimulatedWalk(path);
    const fixes: Fix[] = [];
    w.start(f => fixes.push(f)); w.stop();
    while (!w.done) w.advance(0.5);
    expect(fixes[fixes.length - 1].floorId).toBe('f1');
    expect(Math.max(...fixes.map(f => f.y ?? 0))).toBeCloseTo(3.5);
    expect(pointAt(path, path.length).floorId).toBe('f1');
  });
});
