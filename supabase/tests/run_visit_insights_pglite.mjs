// Checks the insights migration (20261029090000_visit_insights.sql) on PGlite — real Postgres in
// WebAssembly, no Docker or Supabase project — after the trust migration it builds on: what visitors
// can record, what is never kept, who can read totals, and the purge.
//
//   npm install --no-save @electric-sql/pglite@0.5.8
//   node supabase/tests/run_visit_insights_pglite.mjs
//
// Just enough of Supabase is stood in for below (roles, auth.uid(), the venue tables and helpers).
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
import { readFileSync } from 'node:fs';

const dir = new URL('../migrations/', import.meta.url);
const migration = readFileSync(new URL('20261028090000_place_trust.sql', dir), 'utf8');
const insights = readFileSync(new URL('20261029090000_visit_insights.sql', dir), 'utf8');
const db = new PGlite();
const OWNER = '11111111-1111-1111-1111-111111111111', STRANGER = '22222222-2222-2222-2222-222222222222', ADMIN = '33333333-3333-3333-3333-333333333333';
const INST = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', LIVE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', DRAFT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

await db.exec(`
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create role anon nologin; create role authenticated nologin;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create table public.institutions(id uuid primary key, name text, kind text, status text default 'approved', owner_id uuid, created_at timestamptz default now());
create table public.institution_members(institution_id uuid, user_id uuid, role text);
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


let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failed++; };
const as = async (role, uid) => { await db.exec(`reset role; set test.uid = '${uid ?? ''}'; set role ${role};`); };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const throws = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const asSuper = () => db.exec(`reset role; set test.uid = '';`);
const rec = (b, visit, events, source = 'qr', device = 'phone') =>
  one(`select public.record_visit_events($1, $2, $3, $4, $5::jsonb) as n`, [b, visit, device, source, JSON.stringify(events)]);
const count = async (where = 'true') => { await asSuper(); return Number((await one(`select count(*) as n from public.visit_events where ${where}`)).n); };

// Visitors record events on a live venue.
await as('anon');
let r = await rec(LIVE, 'visit-aaaa-1', [
  { kind: 'visit' }, { kind: 'qr', place: 'n1', name: 'Main Entrance' }, { kind: 'place', place: 'n2', name: 'Lucy Café' },
  { kind: 'route', place: 'n2', name: 'Lucy Café' }, { kind: 'search', query: '  Toilet ', ok: true }, { kind: 'search', query: 'souvenirs', ok: false },
  { kind: 'search', query: 'abebe@example.com', ok: false }, { kind: 'search', query: '+251 911 234 567', ok: false },
  { kind: 'ask', query: 'my name is Abebe, where is the toilet', ok: true }, { kind: 'hack' }, 'not an object',
]);
check('anon records valid events (bad ones skipped)', r.n === 9, JSON.stringify(r));
check('searches kept lower case and trimmed', (await count(`query = 'toilet'`)) === 1);
check('an email or phone number in a search is not kept', (await count(`kind = 'search' and query is null`)) === 2);
check('what was said to Ask is never kept', (await count(`kind = 'ask' and query is not null`)) === 0);
check('ok is kept for search and ask', (await count(`kind = 'ask' and ok`)) === 1 && (await count(`kind = 'search' and ok = false`)) === 3);
check('no visitor id or IP column exists', !(await one(`select 1 as x from information_schema.columns where table_name = 'visit_events' and column_name in ('user_id','ip')`)));

await as('anon');
r = await rec(DRAFT, 'visit-aaaa-2', [{ kind: 'visit' }]);
check('nothing recorded for an unpublished venue', r.n === 0);
await as('anon');
r = await rec(LIVE, 'short', [{ kind: 'visit' }]);
check('a bad visit id is refused', r.n === 0);
await as('anon');
r = await rec(LIVE, 'visit-aaaa-3', Array.from({ length: 41 }, () => ({ kind: 'place' })));
check('more than 40 events at once is refused', r.n === 0);
await as('anon');
r = await rec(LIVE, 'visit-aaaa-4', [{ kind: 'visit' }], 'evil-source', 'toaster');
await asSuper();
let row = await one(`select source, device from public.visit_events where visit = 'visit-aaaa-4'`);
check('unknown source / device are cleaned', row.source === 'direct' && row.device === null, JSON.stringify(row));

// The team browsing its own map isn't counted.
await as('authenticated', OWNER);
r = await rec(LIVE, 'visit-owner-1', [{ kind: 'visit' }, { kind: 'route', place: 'n2' }]);
check("the venue's own team isn't counted", r.n === 0);
await as('authenticated', STRANGER);
r = await rec(LIVE, 'visit-strgr-1', [{ kind: 'visit' }, { kind: 'route', place: 'n9', name: 'Zoo' }], 'link', 'desktop');
check('a signed-in visitor (not the team) is counted', r.n === 2);

// Flood guard.
await asSuper();
await db.query(`insert into public.visit_events (building_id, kind, visit) select $1, 'place', 'visit-flood-1' from generate_series(1, 300)`, [LIVE]);
await as('anon');
r = await rec(LIVE, 'visit-flood-1', [{ kind: 'place' }]);
check('a visit flooding events is ignored', r.n === 0);
await asSuper();
await db.query(`delete from public.visit_events where visit = 'visit-flood-1'`);

// Nobody reads rows directly.
await as('anon');
check('anon cannot read visit_events', !!(await throws(`select * from public.visit_events`)));
await as('authenticated', OWNER);
check('the team cannot read rows directly either', !!(await throws(`select * from public.visit_events`)));
await as('anon');
check('anon cannot ask for insights', !!(await throws(`select public.venue_insights($1, now() - interval '7 days', now() + interval '1 minute')`, [LIVE])));

// A report, to see it counted.
await asSuper();
await db.query(`insert into public.place_reports (building_id, kind, place_name) values ($1, 'closed', 'Lucy Café')`, [LIVE]);

// The team's insights.
await as('authenticated', OWNER);
const ins = (await one(`select public.venue_insights($1, now() - interval '7 days', now() + interval '1 minute') as j`, [LIVE])).j;
check('totals: visits are distinct visits', ins.totals.visits === 3, JSON.stringify(ins.totals));
check('totals: routes, qr, searches, missed', ins.totals.routes === 2 && ins.totals.qr === 1 && ins.totals.searches === 4 && ins.totals.searches_missed === 3, JSON.stringify(ins.totals));
check('totals: asks and asks not understood', ins.totals.asks === 1 && ins.totals.asks_missed === 0);
check('reports counted', ins.reports.new === 1 && ins.reports.open === 1, JSON.stringify(ins.reports));
check('one row per day, 8 days', ins.days.length === 8, String(ins.days.length));
check('24 hours', ins.hours.length === 24);
check('top place is Lucy Café (view + route)', ins.top_places[0]?.name === 'Lucy Café' && ins.top_places[0].views === 1 && ins.top_places[0].routes === 1, JSON.stringify(ins.top_places));
check('missed searches list what wasn\'t found', ins.missed_searches.some(s => s.query === 'souvenirs'), JSON.stringify(ins.missed_searches));
check('sources by visit', ins.sources.qr === 1 && ins.sources.link === 1, JSON.stringify(ins.sources));
check('previous period is there', ins.previous.visits === 0);

await as('authenticated', STRANGER);
check("a stranger can't see a venue's insights", !!(await throws(`select public.venue_insights($1, now() - interval '7 days', now())`, [LIVE])));
await as('authenticated', OWNER);
check('a period over 400 days is refused', !!(await throws(`select public.venue_insights($1, now() - interval '500 days', now())`, [LIVE])));

// Yet New: every venue.
await as('authenticated', ADMIN);
const all = (await one(`select public.admin_insights(now() - interval '7 days', now() + interval '1 minute') as j`)).j;
const live = all.venues.find(v => v.id === LIVE);
check('admin: totals and a row per live venue', all.totals.visits === 3 && live?.visits === 3 && live.reports === 1, JSON.stringify(all).slice(0, 300));
check('admin: the draft venue without visits is not listed', !all.venues.some(v => v.id === DRAFT));
check('admin can see any venue insights', !!(await one(`select public.venue_insights($1, now() - interval '7 days', now()) as j`, [LIVE])).j);
await as('authenticated', OWNER);
check("a team can't see every venue", !!(await throws(`select public.admin_insights(now() - interval '7 days', now())`)));

// Purge.
await as('anon');
check('anon cannot purge', !!(await throws(`select public.purge_visit_events()`)));
await as('authenticated', OWNER);
check('a team cannot purge', !!(await throws(`select public.purge_visit_events()`)));
await asSuper();
await db.query(`insert into public.visit_events (building_id, kind, visit, created_at) values ($1, 'visit', 'visit-old-0001', now() - interval '401 days')`, [LIVE]);
await as('authenticated', ADMIN);
const purged = (await one(`select public.purge_visit_events() as n`)).n;
check('admin purges events older than 400 days only', purged === 1 && (await count()) > 0);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
