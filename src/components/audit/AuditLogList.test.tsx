import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const e = (id: number, action: string, actor_name: string, actor_role: string, target_name: string, details = {}) => ({
  id, created_at: '2026-10-30T09:00:00Z', actor_id: 'u', actor_name, actor_role, action, target_type: 'venue', target_id: 't', target_name, institution_id: 'i', building_id: 'b', details,
});
const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import AuditLogList from './AuditLogList';

describe('the audit log list', () => {
  it('lists entries in plain words and filters them', async () => {
    rpc.mockResolvedValueOnce({ data: [
      e(3, 'venue.published', 'Abebe', 'owner', 'Unity Park'),
      e(2, 'member.added', 'Abebe', 'owner', 'Vera', { role: 'viewer' }),
      e(1, 'venue.trust', 'Selam', 'yet_new', 'Unity Park', { trust_level: { from: 'listed', to: 'verified' } }),
    ], error: null });
    render(<AuditLogList institutionId="i" fileName="x.csv" />);
    expect(await screen.findByText(/published Unity Park for visitors/)).toBeTruthy();
    expect(screen.getByText(/added Vera to the team as a viewer/)).toBeTruthy();
    expect(screen.getByText('Yet New')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('audit_entries', { inst: 'i', before_id: null, lim: 50 });

    fireEvent.click(screen.getByRole('button', { name: 'Team & access' }));
    expect(screen.queryByText(/published Unity Park/)).toBeNull();
    expect(screen.getByText(/added Vera/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Everything' }));
    fireEvent.change(screen.getByPlaceholderText('Search names'), { target: { value: 'selam' } });
    expect(screen.getByText(/changed Unity Park from listed to verified/)).toBeTruthy();
    expect(screen.queryByText(/added Vera/)).toBeNull();
  });

  it('says to run the migration when it is missing', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Could not find the function public.audit_entries' } });
    render(<AuditLogList institutionId={null} fileName="x.csv" />);
    expect(await screen.findByText(/20261030090000_roles_audit/)).toBeTruthy();
  });
});
