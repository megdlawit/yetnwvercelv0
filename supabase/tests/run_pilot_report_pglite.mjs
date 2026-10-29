// Checks the pilot report (20261101090000_pilot_report.sql) on PGlite — real Postgres in WebAssembly,
// no Docker or Supabase project — after the migrations it builds on: who can see it, what it counts,
// and that it covers only the venues an authority oversees.
//
//   npm install --no-save @electric-sql/pglite@0.5.8
//   node supabase/tests/run_pilot_report_pglite.mjs
//
// Just enough of Supabase is stood in for below (roles, auth.uid(), the venue tables and helpers).
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
import { readFileSync } from 'node:fs';

const dir = new URL('../migrations/', import.meta.url);
const migration = readFileSync(new URL('20261028090000_place_trust.sql', dir), 'utf8');
const insights = readFileSync(new URL('20261029090000_visit_insights.sql', dir), 'utf8');
const roles = readFileSync(new URL('20261030090000_roles_audit.sql', dir), 'utf8');
const destination = readFileSync(new URL('20261031090000_destination_os.sql', dir), 'utf8');
const report = readFileSync(new URL('20261101090000_pilot_report.sql', dir), 'utf8');
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
await db.exec(report);


let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failed++; };
const as = async (role, uid) => { await db.exec(`reset role; set test.uid = '${uid ?? ''}'; set role ${role};`); };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const throws = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const asSuper = () => db.exec(`reset role; set test.uid = '';`);

const GOV = '66666666-6666-6666-6666-666666666666', GOVVIEW = '77777777-7777-7777-7777-777777777777';
const GOVI = 'dddddddd-dddd-dddd-dddd-dddddddddddd', OTHER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', OTHERB = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
await asSuper();
await db.exec(`insert into auth.users values ('${GOV}'), ('${GOVVIEW}');
  insert into public.user_accounts values ('${GOV}', 'gov', 'Gov Officer'), ('${GOVVIEW}', 'govview', 'Gov Viewer');
  insert into public.institutions(id, name, owner_id) values ('${GOVI}', 'Addis Ababa Tourism', '${GOV}'), ('${OTHER}', 'Entoto Park', '${STRANGER}');
  insert into public.buildings(id, name, institution_id, is_published) values ('${OTHERB}', 'Entoto', '${OTHER}', true);
  update public.buildings set checked_at = now() - interval '10 days' where id = '${LIVE}';`);
await db.query(`select public.team_set_member($1, $2, $3, 'viewer')`, [GOV, GOVI, GOVVIEW]);
await as('authenticated', ADMIN);
await db.query(`select public.admin_set_account_type($1, 'government')`, [GOVI]);
await db.query(`select public.admin_set_oversight($1, $2, true)`, [GOVI, INST]);
await db.query(`select public.admin_set_trust($1, null, 'verified')`, [LIVE]);

// Visits on the overseen venue and on one that isn't.
await asSuper();
await db.exec(`
  insert into public.visit_events (building_id, kind, visit, ok, device) values
    ('${LIVE}', 'visit', 'visit-0000001', null, 'phone'), ('${LIVE}', 'route', 'visit-0000001', null, 'phone'), ('${LIVE}', 'qr', 'visit-0000001', null, 'phone'),
    ('${LIVE}', 'visit', 'visit-0000002', null, 'desktop'), ('${LIVE}', 'search', 'visit-0000002', false, 'desktop'), ('${LIVE}', 'search', 'visit-0000002', true, 'desktop'),
    ('${LIVE}', 'ask', 'visit-0000002', false, 'desktop'),
    ('${OTHERB}', 'visit', 'visit-0000003', null, 'phone'), ('${OTHERB}', 'route', 'visit-0000003', null, 'phone');
  -- Seeded with past dates and outcomes: the reports guard (rightly) would reset them.
  alter table public.place_reports disable trigger user;
  insert into public.place_reports (building_id, kind, place_name, status, resolved_at, created_at) values
    ('${LIVE}', 'safety', 'Stairs', 'fixed', now() - interval '1 day', now() - interval '3 days'),
    ('${LIVE}', 'closed', 'Café', 'fixed', now(), now() - interval '9 days'),
    ('${LIVE}', 'other', 'Gate', 'open', null, now() - interval '1 day'),
    ('${OTHERB}', 'other', 'Elsewhere', 'open', null, now() - interval '1 day');
  alter table public.place_reports enable trigger user;`);
await as('authenticated', GOV);
await db.query(`insert into public.official_notices (issuer_id, title, severity, all_venues) values ($1, 'Road closed', 'urgent', true)`, [GOVI]);

const reportFor = async (who) => (await one(`select public.pilot_report($1, now() - interval '30 days', now() + interval '1 minute') as j`, [who])).j;
const r = await reportFor(GOVI);
check('coverage: one institution, its two venues, one live and verified, checked recently', r.coverage.institutions === 1 && r.coverage.venues === 2 && r.coverage.live === 1 && r.coverage.trusted === 1 && r.coverage.checked_recently === 1, JSON.stringify(r.coverage));
check('use: only the overseen venues are counted', r.use.visits === 2 && r.use.routes === 1 && r.use.qr === 1, JSON.stringify(r.use));
check('use: searches and questions, found and understood', r.use.searches === 2 && r.use.searches_missed === 1 && r.use.asks === 1 && r.use.asks_missed === 1);
check('use: visits on phones', r.use.phone_visits === 1);
check('reports: new, fixed, safety, fixed within a week, open now', r.reports.new === 3 && r.reports.fixed === 2 && r.reports.safety === 1 && r.reports.fixed_within_7_days === 1 && r.reports.open_now === 1, JSON.stringify(r.reports));
check('reports: median time to fix', Number(r.reports.median_hours_to_fix) > 100 && Number(r.reports.median_hours_to_fix) < 200, String(r.reports.median_hours_to_fix));
check('notices issued in the period', r.notices.issued === 1 && r.notices.urgent === 1);
check('changes: the verification is counted', r.changes.verified === 1, JSON.stringify(r.changes));
check('weeks cover the period', r.weeks.length >= 5 && r.weeks.reduce((s, w) => s + w.visits, 0) >= 2, String(r.weeks.length));
check('per-venue rows, busiest first', r.venues[0].name === 'Unity Park' && r.venues[0].visits === 2 && r.venues[0].reports_fixed === 2, JSON.stringify(r.venues));

await as('authenticated', GOVVIEW);
check("the authority's viewer can read the report", !!(await reportFor(GOVI)));
await as('authenticated', OWNER);
check('a venue team cannot read the authority\'s report', !!(await throws(`select public.pilot_report($1, now() - interval '30 days', now())`, [GOVI])));
check('nor the whole-platform report', !!(await throws(`select public.pilot_report(null, now() - interval '30 days', now())`)));
await as('authenticated', STRANGER);
check('a stranger cannot', !!(await throws(`select public.pilot_report($1, now() - interval '30 days', now())`, [GOVI])));
await as('authenticated', ADMIN);
const all = await reportFor(null);
check('Yet New: the whole platform', all.use.visits === 3 && all.coverage.institutions === 2 && all.notices === null, JSON.stringify(all.coverage));
check('a period over 400 days is refused', !!(await throws(`select public.pilot_report(null, now() - interval '500 days', now())`)));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
