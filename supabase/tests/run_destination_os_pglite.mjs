// Checks the Destination OS migration (20261031090000_destination_os.sql) on PGlite — real Postgres in
// WebAssembly, no Docker or Supabase project — after the migrations it builds on: who issues official
// notices and to which venues, what visitors and teams see, and the overview of overseen venues.
//
//   npm install --no-save @electric-sql/pglite@0.5.8
//   node supabase/tests/run_destination_os_pglite.mjs
//
// Just enough of Supabase is stood in for below (roles, auth.uid(), the venue tables and helpers).
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
import { readFileSync } from 'node:fs';

const dir = new URL('../migrations/', import.meta.url);
const migration = readFileSync(new URL('20261028090000_place_trust.sql', dir), 'utf8');
const insights = readFileSync(new URL('20261029090000_visit_insights.sql', dir), 'utf8');
const roles = readFileSync(new URL('20261030090000_roles_audit.sql', dir), 'utf8');
const destination = readFileSync(new URL('20261031090000_destination_os.sql', dir), 'utf8');
const db = new PGlite();
const OWNER = '11111111-1111-1111-1111-111111111111', STRANGER = '22222222-2222-2222-2222-222222222222', ADMIN = '33333333-3333-3333-3333-333333333333';
const INST = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', LIVE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', DRAFT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

await db.exec(`
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create table public.institutions(id uuid primary key, name text, kind text, status text default 'approved', owner_id uuid, logo_url text, created_at timestamptz default now());
create table public.institution_members(institution_id uuid, user_id uuid, role text not null default 'editor', primary key (institution_id, user_id));
create table public.platform_admins(user_id uuid primary key);
create table public.user_accounts(user_id uuid primary key, username text, display_name text);
create table public.buildings(id uuid primary key default gen_random_uuid(), name text, institution_id uuid, is_published boolean not null default false,
  home_rank int default 0, review_status text not null default 'none', review_requested_at timestamptz, review_note text, layout text default 'building',
  published_at timestamptz, origin_lat float8, updated_at timestamptz default now());
create table public.pois(id uuid primary key default gen_random_uuid(), building_id uuid references public.buildings(id), name text);
create table public.floors(id uuid primary key default gen_random_uuid(), building_id uuid);
create table public.nodes(id uuid primary key default gen_random_uuid(), building_id uuid, is_hallway boolean);
create table public.venue_activity(id bigserial primary key, building_id uuid, actor_id uuid, actor_name text, action text, object_type text, object_name text,
  count int default 1, created_at timestamptz default now());

create function public.user_is_platform_admin() returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $$;
create function public.user_can_edit_institution(inst uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from public.institutions i where i.id = inst and i.owner_id = auth.uid())
    or exists (select 1 from public.institution_members m where m.institution_id = inst and m.user_id = auth.uid()) or public.user_is_platform_admin()) $$;
create function public.user_can_edit_building(b uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.buildings bl where bl.id = b and
    (case when bl.institution_id is null then public.user_is_platform_admin() else public.user_can_edit_institution(bl.institution_id) end)) $$;
create function public.current_actor_name() returns text language sql stable as $$ select 'tester' $$;
create function public.admin_require() returns void language plpgsql stable security definer set search_path = public as $$
begin if not public.user_is_platform_admin() then raise exception 'Yet New team only' using errcode = '42501'; end if; end $$;
-- As in 20261008110000.
create function public.guard_review_columns() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.user_is_platform_admin() or current_setting('yetnew.review', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then new.review_status := 'none'; new.review_requested_at := null; new.review_note := null;
  else new.review_status := old.review_status; new.review_requested_at := old.review_requested_at; new.review_note := old.review_note; end if;
  return new;
end $$;
create trigger guard_review_columns before insert or update on public.buildings for each row execute function public.guard_review_columns();

alter table public.buildings enable row level security;
create policy "read" on public.buildings for select using (is_published or public.user_can_edit_building(id));
create policy "edit" on public.buildings for update to authenticated using (public.user_can_edit_building(id));
alter table public.pois enable row level security;
create policy "read" on public.pois for select using (true);
create policy "edit" on public.pois for update to authenticated using (public.user_can_edit_building(building_id));
grant select, update on public.buildings, public.pois to anon, authenticated;

insert into auth.users values ('${OWNER}'), ('${STRANGER}'), ('${ADMIN}');
insert into public.platform_admins values ('${ADMIN}');
insert into public.user_accounts values ('${OWNER}', 'owner', 'Owner Person');
insert into public.institutions(id, name, owner_id) values ('${INST}', 'Unity Park', '${OWNER}');
insert into public.buildings(id, name, institution_id, is_published) values ('${LIVE}', 'Unity Park', '${INST}', true), ('${DRAFT}', 'Annex', '${INST}', false);
`);

await db.exec(migration);
await db.exec(`grant select, insert, update on public.verification_requests, public.place_reports to anon, authenticated;`);
await db.exec(insights);
// A table with one FOR ALL policy (like several real ones), to see it split into read / change.
await db.exec(`create table public.notes(id serial primary key, building_id uuid, body text);
  alter table public.notes enable row level security;
  create policy "Editors manage notes" on public.notes for all to authenticated using (public.user_can_edit_building(building_id)) with check (public.user_can_edit_building(building_id));
  grant select, insert, update, delete on public.notes to authenticated; grant usage on sequence public.notes_id_seq to authenticated;
  grant select on public.institution_members, public.institutions, public.user_accounts to authenticated;
  -- As in 20260930090000: anyone reads institutions, owners update their own.
  alter table public.institutions enable row level security;
  create policy "Anyone can read institutions" on public.institutions for select using (true);
  create policy "Owners can update institutions" on public.institutions for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  grant update on public.institutions to authenticated;`);
await db.exec(roles);
await db.exec(destination);


let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failed++; };
const as = async (role, uid) => { await db.exec(`reset role; set test.uid = '${uid ?? ''}'; set role ${role};`); };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const throws = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const asSuper = () => db.exec(`reset role; set test.uid = '';`);

const GOV = '66666666-6666-6666-6666-666666666666', GOVVIEW = '77777777-7777-7777-7777-777777777777';
const GOVI = 'dddddddd-dddd-dddd-dddd-dddddddddddd', OTHER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', OTHERB = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
await asSuper();
await db.exec(`insert into auth.users values ('${GOV}'), ('${GOVVIEW}');
  insert into public.user_accounts values ('${GOV}', 'gov', 'Gov Officer'), ('${GOVVIEW}', 'govview', 'Gov Viewer');
  insert into public.institutions(id, name, owner_id) values ('${GOVI}', 'Addis Ababa Tourism', '${GOV}'), ('${OTHER}', 'Entoto Park', '${STRANGER}');
  insert into public.buildings(id, name, institution_id, is_published) values ('${OTHERB}', 'Entoto', '${OTHER}', true);
  insert into public.place_reports(building_id, kind, place_name) values ('${LIVE}', 'safety', 'Stairs'), ('${LIVE}', 'closed', 'Café');`);
await db.query(`select public.team_set_member($1, $2, $3, 'viewer')`, [GOV, GOVI, GOVVIEW]);

const issue = (fields) => {
  const f = { title: 'Road closed', body: 'Use the north gate', severity: 'urgent', all_venues: false, building_ids: [LIVE], starts_at: null, ends_at: null, ...fields };
  return db.query(`insert into public.official_notices (issuer_id, title, body, severity, all_venues, building_ids, starts_at, ends_at)
    values ($1, $2, $3, $4, $5, $6::uuid[], coalesce($7::timestamptz, now()), $8::timestamptz) returning id`,
    [f.issuer ?? GOVI, f.title, f.body, f.severity, f.all_venues, `{${f.building_ids.join(',')}}`, f.starts_at, f.ends_at]);
};
const tries = async (fields) => { try { return (await issue(fields)).rows[0].id; } catch (e) { return `ERR ${e.message}`; } };

// Only government / destination accounts, and only to venues they oversee.
await as('authenticated', GOV);
check('a plain venue account cannot issue notices', String(await tries({})).startsWith('ERR'));
await as('authenticated', ADMIN);
await db.query(`select public.admin_set_account_type($1, 'government')`, [GOVI]);
await as('authenticated', GOV);
check('not to a venue it does not oversee yet', String(await tries({})).startsWith('ERR'));
await as('authenticated', ADMIN);
await db.query(`select public.admin_set_oversight($1, $2, true)`, [GOVI, INST]);
await as('authenticated', GOV);
const urgent = await tries({});
check('the government issues a notice to an overseen venue', !String(urgent).startsWith('ERR'), urgent);
check('not to a venue of an institution it does not oversee', String(await tries({ building_ids: [OTHERB] })).startsWith('ERR'));
const later = await tries({ title: 'Holiday hours', severity: 'info', starts_at: new Date(Date.now() + 864e5).toISOString() });
const ended = await tries({ title: 'Old notice', severity: 'info', starts_at: new Date(Date.now() - 3 * 864e5).toISOString(), ends_at: new Date(Date.now() - 864e5).toISOString() });
const everywhere = await tries({ title: 'Heat advisory', severity: 'advisory', all_venues: true, building_ids: [] });
check('a notice to every overseen venue', !String(everywhere).startsWith('ERR'), everywhere);
check('a notice needs venues or "every venue"', String(await tries({ building_ids: [] })).startsWith('ERR'));
check('the issuer is the database\'s', (await one(`select created_by from public.official_notices where id = $1`, [urgent])).created_by === GOV);

await as('authenticated', GOVVIEW);
check("the authority's viewers read its notices", (await all(`select id from public.official_notices`)).length === 4);
check('…but cannot issue', String(await tries({ title: 'From a viewer' })).startsWith('ERR'));
await as('authenticated', OWNER);
check('the venue team cannot edit a notice', (await db.query(`update public.official_notices set title = 'Changed' where id = $1`, [urgent])).affectedRows === 0);
await as('authenticated', GOV);
check('nobody deletes a notice', !!(await throws(`delete from public.official_notices where id = $1`, [urgent])));

// What visitors see.
await as('anon');
let seen = await all(`select * from public.venue_notices($1)`, [LIVE]);
check('visitors see live notices, urgent first, with the authority\'s name', seen.map(n => n.title).join() === 'Road closed,Heat advisory' && seen[0].issuer_name === 'Addis Ababa Tourism', JSON.stringify(seen.map(n => n.title)));
check('not scheduled or ended ones', !seen.some(n => n.title === 'Holiday hours' || n.title === 'Old notice'));
check('anon cannot ask for upcoming ones', (await all(`select * from public.venue_notices($1, true)`, [LIVE])).length === 2);
check('an unpublished venue shows visitors nothing', (await all(`select * from public.venue_notices($1)`, [DRAFT])).length === 0);
check('a venue not overseen gets nothing', (await all(`select * from public.venue_notices($1)`, [OTHERB])).length === 0);
await as('authenticated', OWNER);
check('the venue team sees upcoming ones too', (await all(`select * from public.venue_notices($1, true)`, [LIVE])).length === 3);
check('…and "every venue" notices on its unpublished venue', (await all(`select title from public.venue_notices($1)`, [DRAFT])).map(n => n.title).join() === 'Heat advisory');

// Withdrawing.
await as('authenticated', GOV);
await db.query(`update public.official_notices set withdrawn_at = now() where id = $1`, [urgent]);
await db.query(`update public.official_notices set withdrawn_at = null where id = $1`, [urgent]);
await as('anon');
check('withdrawn is gone for visitors, and stays withdrawn', !(await all(`select title from public.venue_notices($1)`, [LIVE])).some(n => n.title === 'Road closed'));

// The overview.
await as('authenticated', GOV);
const ov = (await one(`select public.destination_overview($1, now() - interval '30 days', now() + interval '1 minute') as j`, [GOVI])).j;
const live = ov.venues.find(v => v.id === LIVE);
check('overview lists the overseen institution and its venues', ov.institutions.length === 1 && ov.venues.length === 2, JSON.stringify(ov).slice(0, 200));
check('open reports and safety reports counted', live.open_reports === 2 && live.safety_reports === 1, JSON.stringify(live));
check('active notices counted per venue', live.notices === 1, String(live.notices));
check('other institutions\' venues are not in it', !ov.venues.some(v => v.id === OTHERB));
await as('authenticated', GOVVIEW);
check('the authority\'s viewer sees the overview', !!(await one(`select public.destination_overview($1, now() - interval '30 days', now()) as j`, [GOVI])).j);
await as('authenticated', OWNER);
check('an overseen venue team cannot see the authority\'s overview', !!(await throws(`select public.destination_overview($1, now() - interval '30 days', now())`, [GOVI])));
await as('authenticated', ADMIN);
check('Yet New sees any overview', !!(await one(`select public.destination_overview($1, now() - interval '30 days', now()) as j`, [GOVI])).j);

// Oversight ends: notices stop reaching.
await db.query(`select public.admin_set_oversight($1, $2, false)`, [GOVI, INST]);
await as('anon');
check('when oversight ends, its notices stop showing', (await all(`select * from public.venue_notices($1)`, [LIVE])).length === 0);

// Audit.
await asSuper();
const log = await all(`select action, institution_id, target_name from public.audit_log where target_type = 'notice' order by id`);
check('issuing and withdrawing are in the authority\'s audit log', log.some(e => e.action === 'notice.issued') && log.some(e => e.action === 'notice.withdrawn' && e.target_name === 'Road closed') && log.every(e => e.institution_id === GOVI), JSON.stringify(log));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
