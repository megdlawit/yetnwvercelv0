import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import VisitorAssistant from './VisitorAssistant';
import type { VisitorContext } from '@/lib/assistant/visitor';

const ctx: VisitorContext = {
  venue: 'Unity Museum',
  floors: [{ id: 'g', name: 'Ground floor', level: 0 }, { id: 'f1', name: '1st floor', level: 1 }],
  places: [
    { id: 'r12', name: 'Room 12', category: 'attractions', floorId: 'f1', floorName: '1st floor', floorLevel: 1, x: 0, y: 0, navigable: true },
    { id: 'wc', name: 'Ladies Toilet', category: 'restrooms', floorId: 'g', floorName: 'Ground floor', floorLevel: 0, x: 0, y: 0, navigable: true },
  ],
  content: [], floorId: 'g', here: null,
};

describe('Ask, on the visitor map', () => {
  it('answers in plain words and shows the place on the map', async () => {
    Element.prototype.scrollTo = () => {};
    const onAction = vi.fn();
    render(<VisitorAssistant context={ctx} onAction={onAction} onClose={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Ask the guide' });
    fireEvent.change(input, { target: { value: 'wher is rom 12' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
    expect(onAction).toHaveBeenCalledWith({ op: 'show', placeId: 'r12' });
    expect(screen.getByText(/Room 12, on the 1st floor/)).toBeTruthy();
    expect(screen.getByText(/I read: “where is room 12”/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Take me there' })); });
    expect(onAction).toHaveBeenLastCalledWith({ op: 'route', placeId: 'r12', fromId: null });
  });
});
