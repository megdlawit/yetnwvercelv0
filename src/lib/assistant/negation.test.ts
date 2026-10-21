import { describe, expect, it } from 'vitest';
import { guardModelActions, parseIntent } from './intent';

describe('"don\'t connect" is never a connect', () => {
  it.each([
    ['X-Ray and Chapel shouldnt be connected', 'X-Ray', 'Chapel'], ["don't connect the lab and the chapel", 'the lab', 'the chapel'],
    ['no path between Lab and Chapel', 'Lab', 'Chapel'], ['there should be no route from Lab to Chapel', 'Lab', 'Chapel'],
    ['do not link Lab with Chapel', 'Lab', 'Chapel'], ['Lab and Chapel should not be linked', 'Lab', 'Chapel'],
  ])('%s → disconnect', (said, a, b) => {
    const out = parseIntent(said) as { op: string; a: string; b: string }[] | null;
    expect(out?.[0].op).toBe('disconnect');
    const bare = (x: string) => x.toLowerCase().replace(/^the /, '');
    expect([bare(out![0].a), bare(out![0].b)]).toEqual([bare(a), bare(b)]);
  });

  it('still connects when asked to', () => {
    expect(parseIntent('connect Lab and Chapel')?.[0]).toMatchObject({ op: 'connect' });
  });

  it('turns a model answer that would connect against the request into a question', () => {
    const wrong = [{ op: 'disconnect', a: 'Chapel' }, { op: 'connect', from: 'X-Ray', to: 'Chapel' }] as never;
    expect(guardModelActions("can you X-Ray and Chapel shouldn't be connected", wrong)).toMatchObject({ actions: [], reply: expect.stringMatching(/disconnect/) });
    // Ordinary requests that merely mention "no" or "not" are left alone.
    const fine = [{ op: 'connect', from: 'Lobby', to: 'Garden' }] as never;
    expect(guardModelActions('connect the lobby to the garden, the one with no stairs', fine).actions).toEqual(fine);
    expect(guardModelActions("connect lobby and garden, it's not far", fine).actions).toEqual(fine);
  });
});
