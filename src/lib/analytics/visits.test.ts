import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanQuery, createVisitRecorder, deviceKind, doNotTrack, type VisitEvent } from './visits';

describe('counting visits, privately', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps searches short and drops anything personal', () => {
    expect(cleanQuery('  Lucy   CAFÉ ')).toBe('lucy café');
    expect(cleanQuery('abebe@example.com')).toBeNull();
    expect(cleanQuery('call me +251 911 234 567')).toBeNull();
    expect(cleanQuery('x')).toBeNull();
    expect(cleanQuery('room 12')).toBe('room 12');
    expect(cleanQuery('a'.repeat(80))).toHaveLength(60);
  });

  it('respects Do Not Track and Global Privacy Control', () => {
    expect(doNotTrack({ doNotTrack: '1' } as Navigator)).toBe(true);
    expect(doNotTrack({ globalPrivacyControl: true } as never)).toBe(true);
    expect(doNotTrack({ doNotTrack: '0' } as Navigator)).toBe(false);
  });

  it('knows phones from desktops', () => {
    expect(deviceKind(390, true)).toBe('phone');
    expect(deviceKind(820, true)).toBe('tablet');
    expect(deviceKind(1440, false)).toBe('desktop');
  });

  it('sends events together after a moment, never the words said to Ask', () => {
    vi.useFakeTimers();
    const sent: VisitEvent[][] = [];
    const r = createVisitRecorder({ buildingId: 'b', source: 'qr', enabled: true, delayMs: 1000, send: async (_b, _v, _d, _s, e) => { sent.push(e); } });
    r.track({ kind: 'visit' });
    r.track({ kind: 'ask', query: 'my name is Abebe', ok: true });
    r.track({ kind: 'search', query: 'Toilet', ok: true });
    r.track({ kind: 'search', query: 'abebe@example.com', ok: false });
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([[{ kind: 'visit' }, { kind: 'ask', ok: true }, { kind: 'search', query: 'toilet', ok: true }]]);
    r.dispose();
  });

  it('sends nothing when off (previews, do not track)', () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const r = createVisitRecorder({ buildingId: 'b', source: 'direct', enabled: false, send });
    r.track({ kind: 'visit' });
    vi.advanceTimersByTime(10000);
    r.dispose();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends what is waiting when the page is hidden', () => {
    const send = vi.fn(async () => undefined);
    const r = createVisitRecorder({ buildingId: 'b', source: 'direct', enabled: true, send, delayMs: 60000 });
    r.track({ kind: 'route', place: 'n1', name: 'Café' });
    window.dispatchEvent(new Event('pagehide'));
    expect(send).toHaveBeenCalledTimes(1);
    r.dispose();
  });
});
