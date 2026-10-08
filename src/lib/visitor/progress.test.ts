import { describe, expect, it } from 'vitest';
import { badgesOf, dailyStats, dayKey, levelOf, monthlyChallenge, streaks, thisWeek, totalsOf } from './progress';
import type { ActivityEntry, VisitEntry } from './visitorStore';

const today = new Date(2026, 9, 7, 15, 0); // Wed 7 Oct 2026
const daysAgo = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
const walk = (n: number, hour = 12, steps = 800): ActivityEntry => {
  const d = daysAgo(n); d.setHours(hour);
  return { id: `w${n}-${hour}`, kind: 'walk', at: d.toISOString(), title: 'Walk', placeId: `p${n}`, buildingId: n % 2 ? 'b1' : 'b2', venueName: null, steps };
};

describe('visitor progress', () => {
  it('keeps a streak alive through today until the day is over', () => {
    const steps = new Map([[dayKey(daysAgo(1)), 500], [dayKey(daysAgo(2)), 300], [dayKey(daysAgo(3)), 900], [dayKey(daysAgo(6)), 100]]);
    const days = dailyStats(steps, [], 30, today);
    expect(streaks(days)).toEqual({ current: 3, best: 3, activeToday: false });
    // Walking today extends it.
    const withToday = dailyStats(new Map([...steps, [dayKey(today), 50]]), [], 30, today);
    expect(streaks(withToday).current).toBe(4);
    // A visit counts as being active too.
    const visitOnly = dailyStats(new Map(), [walk(0, 10, 0)], 30, today);
    expect(visitOnly[visitOnly.length - 1].active).toBe(true);
  });

  it('levels up with experience, each level a little further', () => {
    expect(levelOf(0)).toMatchObject({ level: 1, title: 'Newcomer', into: 0, need: 250 });
    expect(levelOf(250).level).toBe(2);
    const l = levelOf(1000);
    expect(l.level).toBeGreaterThan(2);
    expect(l.progress).toBeGreaterThanOrEqual(0);
    expect(l.progress).toBeLessThan(1);
  });

  it('unlocks achievements from what the visitor has done', () => {
    const visits: VisitEntry[] = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: 'P', detail: '', imageUrl: null, category: 'x', buildingId: i < 3 ? 'b1' : `b${i}`, nodeId: null, venueName: null, count: 1, firstAt: '', lastAt: today.toISOString(), source: 'auto' }));
    const activity = [walk(0, 6), walk(1, 21)];
    const days = dailyStats(new Map([[dayKey(today), 1200]]), activity, 30, today);
    const t = totalsOf({ stepsWalked: 1200, saved: [], visits, activity, days });
    const on = new Set(badgesOf(t).filter(b => b.unlocked).map(b => b.def.id));
    expect(on).toEqual(new Set(['first-steps', 'explorer', 'on-the-move', 'venue-hopper', 'early-bird', 'night-owl']));
    expect(badgesOf(t).find(b => b.def.id === 'marathoner')!.progress).toBeCloseTo(1200 / 5000);
  });

  it('sums this week from Monday, and counts the month\'s places once each', () => {
    const steps = new Map([[dayKey(daysAgo(0)), 1000], [dayKey(daysAgo(2)), 2000], [dayKey(daysAgo(3)), 9999]]); // Wed, Mon, last Sun
    const w = thisWeek(dailyStats(steps, [], 14, today), today);
    expect(w.steps).toBe(3000);
    expect(w.week.find(d => d.today)!.label).toBe('W');
    expect(w.activeDays).toBe(2);
    const visits: VisitEntry[] = [{ id: 'a', name: 'A', detail: '', imageUrl: null, category: 'x', buildingId: null, nodeId: null, venueName: null, count: 3, firstAt: '', lastAt: today.toISOString(), source: 'auto' }];
    const c = monthlyChallenge(visits, [walk(1), { ...walk(1), id: 'again' }], today);
    expect(c.current).toBe(2); // 'a' and 'p1'
    expect(c.daysLeft).toBe(24);
    expect(c.title).toBe('October Explorer');
  });
});
