import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY, aiContribution, blocking, bulkCount, confirmBulk, confirmGroup, confirmRow, groups, matches,
  bulkLeftOut, knownFromHints, rowsFromResult, setLabel, toMapping, unconfirmRow, withNameHints, withRuleHints, type AiLayer, type ReviewPolicy, type RuleHint,
} from './review';

const layer = (name: string, label: string, confidence: number | null, extra: Partial<AiLayer> = {}): AiLayer => ({
  name, label, confidence, needs_review: confidence === null || confidence < 0.7 || ['ignore', 'walkable', 'unknown'].includes(label),
  must_confirm: true, summary: { name, entity_counts: { LINE: 1 }, blocks: [], texts: [] }, ...extra,
});

const sample = () => rowsFromResult([
  layer('A-WALL', 'wall', 0.99), layer('S-COLS', 'wall', 0.95), layer('A-DOOR', 'door', 0.9),
  layer('WC', 'unknown', 0.3), layer('Defpoints', 'ignore', 0.87), layer('C-WALK', 'walkable', 0.99),
  layer('A-FLOR-STRS', 'wall', 0.39), layer('Layer3', 'ignore', null), layer('X', 'not-a-label', 0.9),
]);

describe('rules as a second opinion', () => {
  const hint = (category: RuleHint['category'], confidence: number): RuleHint => ({ category, confidence, reason: 'test' });
  const hinted = (hints: Record<string, RuleHint>, single: string | null = null) =>
    Object.fromEntries(withRuleHints(sample(), hints, 0.7, single).map(r => [r.name, r]));

  it('changes nothing when the rules agree (same category)', () => {
    const rows = sample();
    expect(withRuleHints(rows, { 'A-WALL': hint('walls', 0.92), 'Defpoints': hint('ignore', 0.9) }, 0.7)).toEqual(rows);
  });

  it('pre-selects a trusted rule over a confident AI, flags it and keeps what the AI said', () => {
    const r = hinted({ 'S-COLS': hint('stairs', 0.92) })['S-COLS'];
    expect(r).toMatchObject({ aiLabel: 'wall', label: 'stairs', ruleLabel: 'stairs', flagged: true, confirmedVia: null });
  });

  it('keeps a confident AI label over an unsure rule, but flags the disagreement', () => {
    const r = hinted({ 'A-DOOR': hint('furniture', 0.5) })['A-DOOR'];
    expect(r).toMatchObject({ label: 'door', ruleLabel: 'furniture', flagged: true });
  });

  it('uses the rule when the AI had no usable answer', () => {
    const h = hinted({ WC: hint('rooms', 0.6), 'A-FLOR-STRS': hint('stairs', 0.6), Layer3: hint('walls', 0.55) });
    expect([h.WC.label, h['A-FLOR-STRS'].label, h.Layer3.label]).toEqual(['room', 'stairs', 'wall']);
  });

  it('never fills in a weak rule guess, or replaces a label the rules have no word for', () => {
    const weak = hinted({ WC: hint('trees', 0.4) }).WC;
    expect(weak).toMatchObject({ label: 'unknown', ruleLabel: 'vegetation', flagged: true });
    const rows = rowsFromResult([layer('WC', 'restroom', 0.48)]);
    expect(withRuleHints(rows, { WC: hint('furniture', 0.8) }, 0.7)[0]).toMatchObject({ label: 'restroom', ruleLabel: 'furniture', flagged: true });
  });

  it('never lets the AI leave out the one layer that holds the whole plan', () => {
    const rows = rowsFromResult([layer('freecads.com', 'ignore', 0.99, { summary: { name: 'freecads.com', total: 8135, entity_counts: { LINE: 6628 }, blocks: [], texts: [] } })]);
    const hints = { 'freecads.com': hint('walls', 0.55) };
    expect(withRuleHints(rows, hints, 0.7, 'freecads.com')[0].label).toBe('wall');
    expect(withRuleHints(rows, hints, 0.7, null)[0].label).toBe('ignore');      // not a one-layer drawing: AI kept, row flagged
    const restroom = rowsFromResult([layer('freecads.com', 'restroom', 0.99)]);  // a whole plan isn't one restroom either
    expect(withRuleHints(restroom, hints, 0.7, 'freecads.com')[0].label).toBe('wall');
  });

  it('falls back to the name for layers the editor could not read', () => {
    const h = withNameHints(['DIM2', 'HACTH', 'A-WALL', 'Layer 7'], { 'A-WALL': hint('walls', 0.5) });
    expect(h.DIM2.category).toBe('ignore');
    expect(h.HACTH.category).toBe('ignore');
    expect(h['A-WALL'].confidence).toBe(0.5);                                   // the editor's own hint wins
    expect(h['Layer 7']).toBeUndefined();
  });

  it('sends only the rules it is sure about, so the model is asked about the rest', () => {
    expect(knownFromHints({ 'A-DOOR': hint('doors', 0.92), 'Layer 3': hint('walls', 0.55), DIM: hint('ignore', 0.92) }))
      .toEqual({ 'A-DOOR': 'door', DIM: 'ignore' });
  });

  it('starts an empty layer the AI could not name as ignore', () => {
    const rows = rowsFromResult([layer('TB_CORNERS', 'unknown', 0.99, { summary: { name: 'TB_CORNERS', total: 0, entity_counts: {}, blocks: [], texts: [] } })]);
    expect(withRuleHints(rows, {}, 0.7)[0]).toMatchObject({ label: 'ignore', aiLabel: 'unknown', confirmedVia: null });
  });

  it('pre-selecting never confirms: every row still needs its confirmation', () => {
    const rows = withRuleHints(sample(), { 'S-COLS': hint('stairs', 0.92), WC: hint('rooms', 0.5) }, 0.7);
    expect(rows.every(r => r.confirmedVia === null)).toBe(true);
    expect(blocking(rows, DEFAULT_POLICY).length).toBe(rows.length);
  });
});

describe('layer review', () => {
  it('lists rows lowest confidence first, rows without confidence before all', () => {
    expect(sample().map(r => r.name)).toEqual(['Layer3', 'X', 'WC', 'A-FLOR-STRS', 'Defpoints', 'A-DOOR', 'S-COLS', 'A-WALL', 'C-WALK']);
  });

  it('turns labels outside the list into unknown', () => {
    expect(sample().find(r => r.name === 'X')?.label).toBe('unknown');
  });

  it('confirms a group with a count and a sample, never ignore/walkable/unknown', () => {
    const rows = sample();
    const wall = groups(rows, DEFAULT_POLICY).find(g => g.label === 'wall');
    expect(wall).toEqual({ label: 'wall', count: 3, pending: 3, samples: ['A-FLOR-STRS', 'S-COLS', 'A-WALL'], groupable: true });
    const ignore = groups(rows, DEFAULT_POLICY).find(g => g.label === 'ignore');
    expect(ignore?.groupable).toBe(false);
    expect(ignore?.pending).toBe(0);

    const after = confirmGroup(rows, 'wall', DEFAULT_POLICY);
    expect(after.filter(r => r.label === 'wall').every(r => r.confirmedVia === 'group')).toBe(true);
    expect(confirmGroup(rows, 'ignore', DEFAULT_POLICY)).toEqual(rows);
  });

  it('Confirm all confirms every remaining row in one click, recorded as bulk', () => {
    const rows = confirmRow(sample(), 'A-DOOR');
    expect(bulkCount(rows, DEFAULT_POLICY)).toBe(8);                       // everything but A-DOOR
    expect(bulkLeftOut(rows)).toBe(2);                                     // WC, X: unknown, no rule
    const after = confirmBulk(rows, DEFAULT_POLICY);
    expect(after.find(r => r.name === 'A-DOOR')?.confirmedVia).toBe('individual'); // kept
    for (const n of ['A-WALL', 'Defpoints', 'C-WALK', 'Layer3']) expect(after.find(r => r.name === n)?.confirmedVia).toBe('bulk');
    // Nobody could name these: left out, visibly, instead of blocking.
    expect(after.find(r => r.name === 'WC')).toMatchObject({ label: 'ignore', aiLabel: 'unknown', confirmedVia: 'bulk', ruleReason: 'Not identified — left out' });
    expect(blocking(after, DEFAULT_POLICY)).toEqual([]);
  });

  it('Confirm all uses the rules for a row the AI could not name', () => {
    const rows = withRuleHints(sample(), { WC: { category: 'rooms', confidence: 0.5, reason: 'r' } }, 0.7);
    expect(confirmBulk(rows).find(r => r.name === 'WC')).toMatchObject({ label: 'room', confirmedVia: 'bulk' });
  });

  it('gates "Create venue" until every row is confirmed and nothing is unknown', () => {
    let rows = confirmGroup(confirmGroup(confirmGroup(sample(), 'wall', DEFAULT_POLICY), 'door', DEFAULT_POLICY), 'stairs', DEFAULT_POLICY);
    expect(blocking(rows, DEFAULT_POLICY).map(r => r.name).sort()).toEqual(['C-WALK', 'Defpoints', 'Layer3', 'WC', 'X']);
    rows = confirmRow(rows, 'WC');                       // unknown can't be confirmed
    expect(rows.find(r => r.name === 'WC')?.confirmedVia).toBeNull();
    rows = setLabel(rows, 'WC', 'restroom');             // choosing a label confirms it
    rows = setLabel(rows, 'X', 'furniture');
    for (const n of ['A-DOOR', 'C-WALK', 'Defpoints', 'Layer3']) rows = confirmRow(rows, n);
    expect(blocking(rows, DEFAULT_POLICY)).toEqual([]);
    rows = unconfirmRow(rows, 'A-DOOR');
    expect(blocking(rows, DEFAULT_POLICY).map(r => r.name)).toEqual(['A-DOOR']);
    expect(blocking(setLabel(rows, 'A-DOOR', 'unknown'), DEFAULT_POLICY).map(r => r.name)).toEqual(['A-DOOR']);
  });

  it('when relaxed, only flagged rows and always-confirm labels block', () => {
    const relaxed: ReviewPolicy = { ...DEFAULT_POLICY, confirm_all_layers: false };
    const rows = rowsFromResult([
      layer('A-WALL', 'wall', 0.99, { must_confirm: false }), layer('A-STRS', 'stairs', 0.4),
      layer('GRID', 'ignore', 0.99, { must_confirm: false }),
    ]);
    expect(blocking(rows, relaxed).map(r => r.name)).toEqual(['A-STRS', 'GRID']);
  });

  it('searches names, labels, blocks and texts', () => {
    const [row] = rowsFromResult([layer('I-FURN', 'furniture', 0.9, { summary: { name: 'I-FURN', entity_counts: {}, blocks: ['CHAIR-01'], texts: ['Café'] } })]);
    expect(['furn', 'FURNITURE', 'chair', 'café', ''].map(q => matches(row, q))).toEqual([true, true, true, true, true]);
    expect(matches(row, 'door')).toBe(false);
  });

  it('maps confirmed labels to editor categories; restroom rooms get their type, walkable is only a hint', () => {
    let rows = rowsFromResult([layer('WC', 'restroom', 0.9), layer('C-WALK', 'walkable', 0.9), layer('DIMS', 'dimension', 0.9), layer('?', 'unknown', 0.1)]);
    rows = setLabel(rows, 'DIMS', 'dimension');
    expect(toMapping(rows)).toEqual({
      mapping: { WC: 'rooms', 'C-WALK': 'ignore', DIMS: 'ignore' },
      roomTypes: { WC: 'restroom' },
    });
  });

  it('re-selecting the label a row already has does not confirm it', () => {
    const rows = sample();
    expect(setLabel(rows, 'A-WALL', 'wall')).toEqual(rows);
    expect(setLabel(rows, 'A-WALL', 'door').find(r => r.name === 'A-WALL')?.confirmedVia).toBe('individual');
  });

  it('lets AI labels into the import only when the review finished', () => {
    const rows = confirmBulk(sample(), DEFAULT_POLICY);
    for (const phase of ['off', 'starting', 'queued', 'running', 'failed', 'unavailable', 'skipped']) {
      expect(aiContribution(phase, rows)).toBeNull();
    }
    expect(aiContribution('done', [])).toBeNull();
    expect(aiContribution('done', rows)?.mapping['A-WALL']).toBe('walls');
  });
});
