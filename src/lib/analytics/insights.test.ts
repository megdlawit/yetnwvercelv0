import { describe, expect, it } from 'vitest';
import { change, hoursText, percent, period, toCsv } from './insights';

describe('insights sums', () => {
  it('compares with the period before', () => {
    expect(change(150, 100)).toBe(50);
    expect(change(50, 100)).toBe(-50);
    expect(change(10, 0)).toBeNull();
  });

  it('gives shares and times plainly', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(1, 0)).toBeNull();
    expect(hoursText(null)).toBe('—');
    expect(hoursText(0.4)).toBe('under 1 h');
    expect(hoursText(5.2)).toBe('5 h');
    expect(hoursText(72)).toBe('3 days');
  });

  it('covers the last n days', () => {
    const p = period(7, new Date('2026-10-29T12:00:00Z'));
    expect(p.since).toBe('2026-10-22T12:00:00.000Z');
    expect(new Date(p.until).getTime()).toBeGreaterThan(new Date('2026-10-29T12:00:00Z').getTime());
  });

  it('writes CSV that spreadsheets read', () => {
    const csv = toCsv([{ name: 'Unity Park, Addis', visits: 12 }, { name: 'He said "hi"', visits: null }],
      [{ key: 'name', label: 'Venue' }, { key: 'visits', label: 'Visits' }]);
    expect(csv).toBe('Venue,Visits\n"Unity Park, Addis",12\n"He said ""hi""",');
  });
});
