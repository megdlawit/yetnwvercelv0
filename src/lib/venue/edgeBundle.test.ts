// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { readdirSync, readFileSync } from 'fs';

// Each deployed edge function must be one self-contained file (the Supabase
// dashboard uploads nothing else), generated from supabase/edge-src.
const names = readdirSync('supabase/edge-src').filter(f => f.endsWith('.ts')).map(f => f.slice(0, -3));

describe.each(names)('%s bundle', name => {
  const deployed = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');

  it('has no local imports left to resolve at deploy time', () => {
    const imports = [...deployed.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1]);
    expect(imports.every(i => i.startsWith('https://'))).toBe(true);
  });

  it('is up to date with its source (run `npm run build:edge`)', async () => {
    const r = await build({
      entryPoints: [`supabase/edge-src/${name}.ts`], bundle: true, format: 'esm', platform: 'neutral',
      target: 'es2022', write: false, external: ['https://*', 'npm:*', 'jsr:*'], legalComments: 'none',
    });
    expect(deployed.endsWith(r.outputFiles[0].text)).toBe(true);
  });
});
