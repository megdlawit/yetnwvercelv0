// @vitest-environment node
// The DWG converter's storage route (api/dwg-convert.ts, viaStorage) with a stand-in for
// Supabase storage, on a real architect's DWG. Skipped where that drawing isn't present
// (it's private, in ml/data/shared/, not in git).
import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const DWG = 'ml/data/shared/BELAY G+4 MAY 10.dwg';
const files = new Map<string, Buffer>();
const removed: string[] = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        download: async (p: string) => (files.has(p) ? { data: new Blob([files.get(p)!]), error: null } : { data: null, error: { message: 'Object not found' } }),
        upload: async (p: string, body: Buffer) => { files.set(p, Buffer.from(body)); return { error: null }; },
        remove: async (ps: string[]) => { for (const p of ps) { files.delete(p); removed.push(p); } return { error: null }; },
      }),
    },
  }),
}));

function call(body: unknown, headers: Record<string, string> = { authorization: 'Bearer t', 'content-type': 'application/json' }) {
  return new Promise<{ status: number; json: { dxfPath?: string; error?: string } }>(resolve => {
    const res = { statusCode: 0, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; },
      end(s: string) { resolve({ status: this.statusCode, json: JSON.parse(s) }); } };
    void import('../../../api/dwg-convert').then(m => m.default({ method: 'POST', headers, body }, res));
  });
}

describe.skipIf(!existsSync(DWG))('converting a big DWG through storage', () => {
  it('reads the upload, writes the DXF back gzipped, and removes the DWG', async () => {
    process.env.SUPABASE_URL = 'http://supabase'; process.env.SUPABASE_ANON_KEY = 'anon';
    const user = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
    const path = `${user}/${id}.dwg`;
    files.set(path, readFileSync(DWG));
    const r = await call({ storagePath: path });
    expect(r.status).toBe(200);
    expect(r.json.dxfPath).toBe(`${user}/${id}.dxf.gz`);
    const dxf = gunzipSync(files.get(r.json.dxfPath)!).toString('utf8');
    expect(dxf).toMatch(/SECTION[\s\S]*ENTITIES/);
    expect(files.get(r.json.dxfPath)!.byteLength).toBeLessThan(dxf.length / 4);   // gzipped well
    expect(removed).toContain(path);
  }, 300_000);

  it('refuses without a sign-in or with a path that is not an upload', async () => {
    expect((await call({ storagePath: 'a/b.dwg' }, { 'content-type': 'application/json' })).status).toBe(401);
    expect((await call({ storagePath: '../secret.dwg' })).status).toBe(400);
  });
});
