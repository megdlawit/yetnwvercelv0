// Checks 20261102090000_promotions_lockdown.sql on PGlite: visitors still read promotions, but only the
// venue's team (or Yet New) can add, change or delete them.
//
//   npm install --no-save @electric-sql/pglite@0.5.8
//   node supabase/tests/run_promotions_lockdown_pglite.mjs
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
import { readFileSync } from 'node:fs';

const dir = new URL('../migrations/', import.meta.url);
const original = readFileSync(new URL('20260423105948_8dd3aa34-03d5-403b-9581-a8aca024cd62.sql', dir), 'utf8');
const lockdown = readFileSync(new URL('20261102090000_promotions_lockdown.sql', dir), 'utf8');
const db = new PGlite();
const OWNER = '11111111-1111-1111-1111-111111111111', STRANGER = '22222222-2222-2222-2222-222222222222', ADMIN = '33333333-3333-3333-3333-333333333333';
const INST = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', VENUE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

await db.exec(`
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create role anon nologin; create role authenticated nologin;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create table public.institutions(id uuid primary key, name text, owner_id uuid);
create table public.platform_admins(user_id uuid primary key);
create table public.buildings(id uuid primary key, name text, institution_id uuid);
create function public.user_is_platform_admin() returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $$;
create function public.user_can_edit_building(b uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.user_is_platform_admin() or exists (select 1 from public.buildings bl join public.institutions i on i.id = bl.institution_id
    where bl.id = b and i.owner_id = auth.uid())) $$;
create function public.update_updated_at_column() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
insert into auth.users values ('${OWNER}'), ('${STRANGER}'), ('${ADMIN}');
insert into public.platform_admins values ('${ADMIN}');
insert into public.institutions values ('${INST}', 'Unity Park', '${OWNER}');
insert into public.buildings values ('${VENUE}', 'Unity Park', '${INST}');
`);
// pois and promotions as the original migration left them: the promotion policies are copied from it.
await db.exec(`
create table public.pois(id uuid primary key default gen_random_uuid(), building_id uuid, name text);
create table public.promotions(id uuid primary key default gen_random_uuid(), poi_id uuid not null references public.pois(id) on delete cascade, title text not null);
alter table public.promotions enable row level security;
${original.split('\n').filter(l => /CREATE POLICY ".*promotions" ON public\.promotions/.test(l)).join('\n')}
grant select, insert, update, delete on public.pois, public.promotions to anon, authenticated;
insert into public.pois(id, building_id, name) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '${VENUE}', 'Café');
insert into public.promotions(id, poi_id, title) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '10% off');
`);
const poi = 'dddddddd-dddd-dddd-dddd-dddddddddddd', promo = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

// Before the fix: anyone could write.
const tries0 = async (sql, params) => { try { return (await db.query(sql, params)).affectedRows ?? 0; } catch { return -1; } };
await db.exec(`set test.uid = ''; set role anon;`);
const holeBefore = (await tries0(`update public.promotions set title = title where id = $1`, [promo])) === 1;
await db.exec(`reset role;`);
await db.exec(lockdown);

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failed++; };
const as = async (role, uid) => { await db.exec(`reset role; set test.uid = '${uid ?? ''}'; set role ${role};`); };
const tries = async (sql, params) => { try { return (await db.query(sql, params)).affectedRows ?? 0; } catch { return -1; } };

check('before the fix, a signed-out visitor could change promotions (the hole)', holeBefore);

await as('anon');
check('visitors read promotions', (await db.query(`select id from public.promotions`)).rows.length === 1);
check('visitors cannot add promotions', (await tries(`insert into public.promotions (poi_id, title) values ($1, 'Free coffee')`, [poi])) <= 0);
check('visitors cannot change promotions', (await tries(`update public.promotions set title = 'Hacked' where id = $1`, [promo])) <= 0);
check('visitors cannot delete promotions', (await tries(`delete from public.promotions where id = $1`, [promo])) <= 0);

await as('authenticated', STRANGER);
check('another signed-in person cannot add', (await tries(`insert into public.promotions (poi_id, title) values ($1, 'Free coffee')`, [poi])) <= 0);
check('…or change', (await tries(`update public.promotions set title = 'Hacked' where id = $1`, [promo])) === 0);
check('…or delete', (await tries(`delete from public.promotions where id = $1`, [promo])) === 0);

await as('authenticated', OWNER);
check("the venue's team adds a promotion", (await tries(`insert into public.promotions (poi_id, title) values ($1, 'Free coffee')`, [poi])) === 1);
check('…changes it', (await tries(`update public.promotions set title = '15% off' where id = $1`, [promo])) === 1);
check('…and deletes it', (await tries(`delete from public.promotions where id = $1`, [promo])) === 1);

await as('authenticated', ADMIN);
check('Yet New manages any promotion', (await tries(`insert into public.promotions (poi_id, title) values ($1, 'Launch week')`, [poi])) === 1);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
