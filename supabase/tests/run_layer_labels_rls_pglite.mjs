// Runs supabase/tests/layer_labels_rls.sql (after both layer-label migrations) locally, without Docker or a
// Supabase project, on PGlite (real Postgres compiled to WebAssembly).
//
//   npm install --no-save @electric-sql/pglite@0.5.8
//   node supabase/tests/run_layer_labels_rls_pglite.mjs
//
// (Or point PGLITE_MODULE at an installed copy: PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js)
//
// The Supabase parts the migration touches are stood in for below: the
// anon/authenticated/service_role roles with Supabase's default grants,
// auth.users + auth.uid() (read from request.jwt.claims, like Supabase),
// storage.buckets/objects + storage.foldername, and the minimal venue tables.
// The access helpers (user_is_platform_admin, user_can_edit_institution,
// user_can_edit_building) are NOT copied: they are read from the repo's
// migration, so the test follows the real definitions.
//
// This checks the policies' logic. It does not replace running the same SQL
// file against the real database (see the header of layer_labels_rls.sql).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrations = join(root, 'supabase', 'migrations');

const spec = process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite';
const { PGlite } = await import(spec);

/** The last CREATE OR REPLACE FUNCTION public.<name> … $$; in a migration file. */
function functionFrom(file, name) {
  const sql = readFileSync(join(migrations, file), 'utf8');
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`, 'g');
  const all = sql.match(re);
  if (!all) throw new Error(`public.${name} not found in ${file}`);
  return all[all.length - 1];
}

const supabaseStandIn = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
                  (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text, owner uuid, created_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END $$;

GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth, storage TO anon, authenticated, service_role;
-- Supabase grants every new public table/function to the API roles by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE TABLE public.institution_members (
  institution_id uuid REFERENCES public.institutions(id), user_id uuid REFERENCES auth.users(id),
  role text NOT NULL DEFAULT 'editor'
);
CREATE TABLE public.buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  institution_id uuid REFERENCES public.institutions(id), is_published boolean DEFAULT false
);
CREATE TABLE public.platform_admins (user_id uuid PRIMARY KEY REFERENCES auth.users(id));

${functionFrom('20261002090000_institution_accounts.sql', 'user_is_platform_admin')}
${functionFrom('20261002090000_institution_accounts.sql', 'user_can_edit_institution')}
${functionFrom('20261002090000_institution_accounts.sql', 'user_can_edit_building')}
`;

const MIGRATIONS = ['20261010090000_layer_labels.sql', '20261010110000_layer_labels_consent.sql'];

const db = new PGlite();
try {
  await db.exec(supabaseStandIn);
  // Both migrations in order, twice: re-running them must not fail.
  for (let run = 0; run < 2; run++) {
    for (const file of MIGRATIONS) await db.exec(readFileSync(join(migrations, file), 'utf8'));
  }
  const results = await db.exec(readFileSync(join(root, 'supabase', 'tests', 'layer_labels_rls.sql'), 'utf8'));
  const passed = results.flatMap((r) => r.rows).find((row) => row.result);
  if (!passed) throw new Error('The test file did not reach its final check.');
  console.log(passed.result);
} catch (err) {
  console.error(err.message ?? err);
  process.exitCode = 1;
} finally {
  await db.close();
}
