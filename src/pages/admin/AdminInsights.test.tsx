import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./AdminLayout', () => ({ useAdminConsole: () => ({ query: '' }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(async () => ({
      data: {
        totals: { visits: 120, routes: 40, searches: 50, qr: 30, asks: 10, venues_with_visits: 2 },
        venues: [
          { id: 'a', name: 'Unity Park', published: true, trust_level: 'official', visits: 100, places: 300, searches: 40, searches_missed: 4, routes: 35, qr: 25, asks: 10, asks_missed: 1, reports: 4, reports_fixed: 3, median_hours_to_fix: 5 },
          { id: 'b', name: 'Entoto Park', published: true, trust_level: 'listed', visits: 20, places: 50, searches: 10, searches_missed: 0, routes: 5, qr: 5, asks: 0, asks_missed: 0, reports: 0, reports_fixed: 0, median_hours_to_fix: null },
        ],
      },
      error: null,
    })),
  },
}));

import AdminInsights from './AdminInsights';

describe('every venue’s insights', () => {
  it('shows totals and a row per venue, busiest first', async () => {
    render(<AdminInsights />);
    expect(await screen.findByText('Unity Park')).toBeTruthy();
    const rows = screen.getAllByRole('row').slice(1).map(r => r.textContent ?? '');
    expect(rows[0]).toContain('Unity Park');
    expect(rows[0]).toContain('90%');      // searches found
    expect(rows[0]).toContain('75%');      // reports fixed
    expect(rows[1]).toContain('Entoto Park');
    expect(rows[1]).toContain('—');        // nothing to fix yet
    expect(screen.getByText('Official', { exact: false })).toBeTruthy();
    expect(screen.getByText('2 venues visited')).toBeTruthy();
  });

  it('says to run the migration when it is missing', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { message: 'Could not find the function public.admin_insights' } } as never);
    render(<AdminInsights />);
    expect(await screen.findByText(/20261029090000_visit_insights/)).toBeTruthy();
  });
});
