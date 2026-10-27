import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MapAssistant, { type MapAssistantProps } from './MapAssistant';
import { mapState } from '@/lib/assistant/testMap';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ actions: [], reply: null }), { status: 200 }));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  // jsdom has no layout: the chat scrolls its list and waits a frame between changes.
  Element.prototype.scrollTo = () => {};
});
afterEach(() => { vi.unstubAllGlobals(); fetchSpy.mockClear(); });

function setup(extra: Partial<MapAssistantProps> = {}) {
  const apply = vi.fn(async () => true);
  const s = mapState();
  const props: MapAssistantProps = {
    getState: () => ({ floorId: s.floorId, rows: s.rows, selection: s.selection, click: s.click, view: s.view }),
    apply, onHighlight: () => {}, undo: () => {}, health: [], selectedName: null, greeting: null,
    floorName: 'Floor 1', floors: ['Floor 1', 'Floor 2'], ...extra,
  };
  render(<MapAssistant {...props} />);
  const input = screen.getByLabelText('What would you like to change?') as HTMLInputElement;
  const send = async (text: string) => {
    fireEvent.change(input, { target: { value: text } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
  };
  return { apply, send };
}

describe('the floor editor chat', () => {
  it('reads past typos, says what it read, and never calls an outside service', async () => {
    const { send } = setup();
    await send('conect rom 1 and rom 2');
    await waitFor(() => expect(screen.getByRole('button', { name: /Apply/ })).toBeTruthy());
    await send('how r u');
    expect(screen.getByText(/I'm doing great/)).toBeTruthy();
    await send('flibber the wobble');
    expect(screen.getByText(/didn't quite get that|did you mean one of these/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers a greeting instantly, with suggestions, without asking the AI', async () => {
    const { send } = setup();
    await send('hey');
    expect(screen.getByText(/^Hi! I'm your map assistant\./)).toBeTruthy();
    expect(screen.getAllByRole('button').some(b => b.textContent === 'Fix everything')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers thanks and "what can you do?" instantly too', async () => {
    const { send } = setup();
    await send('thanks!');
    expect(screen.getByText(/You're welcome!/)).toBeTruthy();
    await send('what can you do?');
    expect(screen.getByText(/Connect places with walking paths/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does a request that starts with a greeting, and "yes" applies the preview', async () => {
    const { send, apply } = setup();
    await send('hi, connect Room 1 and Room 2');
    expect(fetchSpy).not.toHaveBeenCalled();                                  // understood locally, instantly
    await waitFor(() => expect(screen.getByRole('button', { name: /Apply/ })).toBeTruthy());
    await send('yes');
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Done — Room 1 is now connected to Room 2\./)).toBeTruthy());
  });

  it('"no" cancels the preview', async () => {
    const { send, apply } = setup();
    await send('connect Room 1 and Room 2');
    await waitFor(() => expect(screen.getByRole('button', { name: /Apply/ })).toBeTruthy());
    await send('no');
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText(/I left the map as it was/)).toBeTruthy();
  });

  it('a suggestion chip does what it says when tapped', async () => {
    const { send, apply } = setup();
    await send('hello');
    const fix = screen.getAllByRole('button').find(b => b.textContent === 'Fix everything')!;
    await act(async () => { fireEvent.click(fix); });
    expect(fetchSpy).not.toHaveBeenCalled();
    // "Fix everything" either previews or applies straight away; either way it's understood and acted on.
    await waitFor(() => expect(apply.mock.calls.length > 0 || !!screen.queryByRole('button', { name: /Apply/ })).toBe(true));
    // Let the request finish before the test ends (it updates state after applying).
    await waitFor(() => expect(screen.queryByText(/Working on it…|Thinking about that/)).toBeNull());
  });
});
