// @vitest-environment node
// Importing a DWG on the website: through private storage (cad-uploads), or straight to the
// converter while that bucket isn't set up yet.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';

const DXF = '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nA-WALL\n10\n0\n20\n0\n11\n5\n21\n0\n0\nENDSEC\n0\nEOF\n';
const state = { bucket: true, files: new Map<string, Blob>(), removed: [] as string[] };
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 'tok' } } }) },
    storage: {
      from: () => ({
        upload: async (p: string, b: Blob) => (state.bucket ? (state.files.set(p, b), { error: null }) : { error: { message: 'Bucket not found' } }),
        download: async (p: string) => ({ data: state.files.get(p) ?? null, error: state.files.has(p) ? null : { message: 'missing' } }),
        remove: async (ps: string[]) => { ps.forEach(p => { state.files.delete(p); state.removed.push(p); }); return { error: null }; },
      }),
    },
  },
}));

afterEach(() => { vi.unstubAllGlobals(); state.files.clear(); state.removed = []; state.bucket = true; });
const dwg = () => new File([new Uint8Array([65, 67, 49, 48, 51, 50])], 'plan.dwg');

describe('importing a DWG on the website', () => {
  it('goes through storage: uploaded to your folder, converted, read back gzipped, both files removed', async () => {
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const { storagePath } = JSON.parse(String(init.body));
      expect(storagePath).toMatch(/^u1\/[0-9a-f-]{36}\.dwg$/);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      const dxfPath = storagePath.replace(/\.dwg$/, '.dxf.gz');
      state.files.set(dxfPath, new Blob([gzipSync(Buffer.from(DXF))]));
      state.files.delete(storagePath);   // the converter removes the DWG
      return new Response(JSON.stringify({ dxfPath }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { readCadFile } = await import('./readFile');
    const d = await readCadFile(dwg());
    expect(d.format).toBe('dwg');
    expect(d.entities.filter(e => e.kind === 'LINE')).toHaveLength(1);
    expect(state.removed.some(p => p.endsWith('.dxf.gz'))).toBe(true);
    expect(state.files.size).toBe(0);
  });

  it('without the storage bucket yet, sends the DWG straight to the converter', async () => {
    state.bucket = false;
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ dxfText: DXF }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { readCadFile } = await import('./readFile');
    const d = await readCadFile(dwg());
    expect(d.entities).toHaveLength(1);
    expect((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'Content-Type': 'application/octet-stream' });
  });
});
