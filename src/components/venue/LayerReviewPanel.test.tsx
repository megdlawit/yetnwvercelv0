import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import LayerReviewPanel from './LayerReviewPanel';
import { DEFAULT_POLICY, rowsFromResult, type ReviewRow } from '@/lib/cad/layerLabels/review';
import type { LayerLabeling } from '@/lib/cad/layerLabels/useLayerLabeling';
import type { LabelResult } from '@/lib/cad/layerLabels/client';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/cad/layerLabels/consent', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cad/layerLabels/consent')>()),
  loadConsent: async () => ({ accepted: null, decidedAt: null, noticeVersion: null, canDecide: false, unavailable: true }),
}));

const result: LabelResult = {
  model: { name: 'qwen2.5:3b', kind: 'baseline', reason: '' }, summarizer_version: 1, prompt_version: 3, seconds: 1,
  review: DEFAULT_POLICY,
  layers: [
    { name: 'A-WALL', label: 'wall', confidence: 0.99, needs_review: false, must_confirm: true, summary: { name: 'A-WALL', entity_counts: { LINE: 4 }, blocks: [], texts: [] } },
    { name: 'A-DOOR', label: 'door', confidence: 0.6, needs_review: true, must_confirm: true, summary: { name: 'A-DOOR', entity_counts: { INSERT: 2 }, blocks: ['DR-900'], texts: [] } },
  ],
};

/** The panel with real review state, as the import dialog holds it. */
function Harness({ onRows }: { onRows: (rows: ReviewRow[]) => void }) {
  const [rows, setRowsState] = useState(() => rowsFromResult(result.layers));
  onRows(rows);
  const labeling: LayerLabeling = {
    phase: 'done', job: null, error: null, result, policy: DEFAULT_POLICY, rows,
    setRows: update => setRowsState(update), retry: () => {}, skip: () => {},
  };
  return <LayerReviewPanel labeling={labeling} buildingId="b1" />;
}

function setup({ details = true } = {}) {
  let latest: ReviewRow[] = [];
  render(<Harness onRows={r => { latest = r; }} />);
  // The layer list is behind "Check layers one by one"; most tests are about the list.
  if (details) fireEvent.click(screen.getByRole('button', { name: 'Check layers one by one' }));
  return { rows: () => latest, select: (name: string) => screen.getByLabelText(`Label for ${name}`) as HTMLSelectElement };
}

describe('LayerReviewPanel: simple by default', () => {
  it('shows what was found in plain words and one button, with the layer list closed', () => {
    const { rows } = setup({ details: false });
    expect(screen.getByText(/We sorted your drawing/)).toBeTruthy();
    expect(screen.queryByLabelText('Label for A-WALL')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }));
    expect(rows().every(r => r.confirmedVia !== null)).toBe(true);
    expect(screen.getByText(/Layers confirmed/)).toBeTruthy();
  });
});

describe('LayerReviewPanel: only an active selection confirms a layer', () => {
  it('shows the AI suggestion pre-filled without confirming anything', () => {
    const { rows, select } = setup();
    expect(select('A-WALL').value).toBe('wall');
    expect(select('A-DOOR').value).toBe('door');
    expect(rows().every(r => r.confirmedVia === null)).toBe(true);
    expect(screen.queryByText('Confirmed')).toBeNull();
  });

  it('opening, focusing, clicking or leaving the dropdown confirms nothing', () => {
    const { rows, select } = setup();
    const s = select('A-DOOR');
    fireEvent.focus(s);
    fireEvent.mouseDown(s);
    fireEvent.click(s);
    fireEvent.keyDown(s, { key: 'ArrowDown' });
    fireEvent.keyUp(s, { key: 'ArrowDown' });
    fireEvent.blur(s);
    expect(rows().every(r => r.confirmedVia === null)).toBe(true);
  });

  it('re-selecting the suggested label confirms nothing', () => {
    const { rows, select } = setup();
    fireEvent.change(select('A-WALL'), { target: { value: 'wall' } });
    expect(rows().find(r => r.name === 'A-WALL')?.confirmedVia).toBeNull();
  });

  it('choosing a different label is an individual confirmation of that row only', () => {
    const { rows, select } = setup();
    fireEvent.change(select('A-DOOR'), { target: { value: 'window' } });
    expect(rows().find(r => r.name === 'A-DOOR')).toMatchObject({ label: 'window', confirmedVia: 'individual' });
    expect(rows().find(r => r.name === 'A-WALL')?.confirmedVia).toBeNull();
  });

  it('the Confirm button confirms individually; Confirm all is recorded as bulk', () => {
    const { rows } = setup();
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]);   // least confident first: A-DOOR
    expect(rows().find(r => r.name === 'A-DOOR')?.confirmedVia).toBe('individual');
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }));   // one click for the rest
    expect(rows().find(r => r.name === 'A-WALL')?.confirmedVia).toBe('bulk');
  });

  it('explains single-layer drawings in plain words', () => {
    function One() {
      const [rows, setRowsState] = useState(() => rowsFromResult(result.layers.slice(0, 1)));
      const single = { ...result, drawing: { layers_used: 1, entities: 8135, largest_layer: 'freecads.com', largest_layer_share: 1, single_layer: true } };
      const labeling: LayerLabeling = { phase: 'done', job: null, error: null, result: single, policy: DEFAULT_POLICY, rows,
        setRows: u => setRowsState(u), retry: () => {}, skip: () => {} };
      return <LayerReviewPanel labeling={labeling} buildingId="b1" />;
    }
    render(<One />);
    expect(screen.getByRole('note').textContent).toMatch(/Everything in this drawing is on one layer.*freecads\.com.*can.t tell walls from doors or furniture/);
  });

  it('shows no such note for a layered drawing', () => {
    setup();
    expect(screen.queryByRole('note')).toBeNull();
  });
});
