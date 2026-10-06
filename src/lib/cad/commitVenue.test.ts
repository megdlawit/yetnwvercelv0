import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { commitVenue } from './commitVenue';
import type { BuiltVenue } from './buildVenue';

// A database from before migration 20260930150000: no map_features table, no rooms.polygon.
function oldDatabase() {
  const calls: string[] = [];
  const missing = { message: "Could not find the table 'public.map_features' in the schema cache" };
  const from = (table: string) => {
    let op = 'select', cols = '';
    let payload: unknown;
    const q = {
      select(c = '*') { if (op === 'select') cols = c; return q; },
      delete() { op = 'delete'; return q; },
      insert(rows: unknown) { op = 'insert'; payload = rows; return q; },
      eq() { return q; }, neq() { return q; }, in() { return q; }, limit() { return q; },
      then(resolve: (r: unknown) => void) {
        calls.push(`${op} ${table}`);
        const broken = table === 'map_features' || (table === 'rooms' && op === 'select' && cols.includes('polygon'));
        if (broken) return resolve({ data: null, error: missing });
        if (op === 'insert') {
          if (table === 'rooms' && (payload as Record<string, unknown>[]).some(r => 'polygon' in r)) {
            return resolve({ data: null, error: { message: "column 'polygon' does not exist" } });
          }
          return resolve({ data: (payload as unknown[]).map((_, i) => ({ id: `${table}-${i}` })), error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return q;
  };
  return { client: { from } as unknown as SupabaseClient<Database>, calls };
}

const venue: BuiltVenue = {
  walls: [{ x1: 0, y1: 0, x2: 400, y2: 0 }, { x1: 400, y1: 0, x2: 400, y2: 240 }, { x1: 400, y1: 240, x2: 0, y2: 240 }, { x1: 0, y1: 240, x2: 0, y2: 0 }],
  rooms: [{ name: 'Hall', polygon: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 240 }, { x: 100, y: 300 }, { x: 0, y: 240 }], x: 0, y: 0, width: 200, height: 300 }],
  features: [{ kind: 'door', x: 100, y: 0, rotationDeg: 0 }],
  health: {} as BuiltVenue['health'],
  warnings: [],
};

describe('saving an import to a database without the newest migration', () => {
  it('checks first, skips what the database lacks, and says so', async () => {
    const { client, calls } = oldDatabase();
    const r = await commitVenue(client, 'b1', 'f1', venue, 'dxf-import');

    // the capability checks happen before anything is deleted
    const firstDelete = calls.findIndex(c => c.startsWith('delete'));
    expect(calls.indexOf('select map_features')).toBeLessThan(firstDelete);
    expect(calls).not.toContain('delete map_features');
    expect(calls).not.toContain('insert map_features');

    expect(r.walls).toBe(4);
    expect(r.rooms).toBe(1);
    expect(r.features).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/1 objects .* weren't saved.*20260930150000/);
    expect(r.warnings.join(' ')).toMatch(/Room shapes were saved as rectangles/);
  });
});
