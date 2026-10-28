// Checks the roles and audit-log migration (20261030090000_roles_audit.sql) on PGlite — real Postgres
// in WebAssembly, no Docker or Supabase project — after the trust and insights migrations it builds
// on: viewers see but don't change, oversight, kinds of account, and an audit log nobody can edit.
//
//   npm install --no-save @electric-sql/pglite@0.5.8
//   node supabase/tests/run_roles_audit_pglite.mjs
//
// Just enough of Supabase is stood in for below (roles, auth.uid(), the venue tables and helpers).
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
import { readFileSync } from 'node:fs';

const dir = new URL('../migrations/', import.meta.url);
const migration = readFileSync(new URL('20261028090000_place_trust.sql', dir), 'utf8');
const insights = readFileSync(new URL('20261029090000_visit_insights.sql', dir), 'utf8');
const roles = readFileSync(new URL('20261030090000_roles_audit.sql', dir), 'utf8');
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
create table public.institutions(id uuid primary key, name text, kind text, status text default 'approved', owner_id uuid, created_at timestamptz default now());
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


let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failed++; };
const as = async (role, uid) => { await db.exec(`reset role; set test.uid = '${uid ?? ''}'; set role ${role};`); };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const throws = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const asSuper = () => db.exec(`reset role; set test.uid = '';`);

const VIEWER = '44444444-4444-4444-4444-444444444444', EDITOR = '55555555-5555-5555-5555-555555555555', GOV = '66666666-6666-6666-6666-666666666666';
const GOVI = 'dddddddd-dddd-dddd-dddd-dddddddddddd', SHOP = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
await asSuper();
await db.exec(`insert into auth.users values ('${VIEWER}'), ('${EDITOR}'), ('${GOV}');
  insert into public.user_accounts values ('${VIEWER}', 'viewer', 'Vera Viewer'), ('${EDITOR}', 'editor', 'Eddie Editor'), ('${GOV}', 'gov', 'Gov Officer');
  insert into public.institutions(id, name, owner_id) values ('${GOVI}', 'Addis Ababa Tourism', '${GOV}'), ('${SHOP}', 'Corner Shop', '${STRANGER}');
  insert into public.notes(building_id, body) values ('${DRAFT}', 'internal note');`);
await db.query(`select public.team_set_member($1, $2, $3, 'viewer')`, [OWNER, INST, VIEWER]);
await db.query(`select public.team_set_member($1, $2, $3, 'editor')`, [OWNER, INST, EDITOR]);

// Viewers see but don't change.
await as('authenticated', VIEWER);
check('viewer reads the unpublished venue', !!(await one(`select id from public.buildings where id = $1`, [DRAFT])));
await db.query(`update public.buildings set name = 'Hacked' where id = $1`, [DRAFT]);
await asSuper();
check('viewer cannot rename it', (await one(`select name from public.buildings where id = $1`, [DRAFT])).name === 'Annex');
await as('authenticated', VIEWER);
check('viewer reads a FOR ALL table through its view companion', (await all(`select * from public.notes`)).length === 1);
check('viewer cannot add to it', !!(await throws(`insert into public.notes(building_id, body) values ($1, 'x')`, [DRAFT])));
check('viewer reads insights', !!(await one(`select public.venue_insights($1, now() - interval '7 days', now()) as j`, [LIVE])).j);
check('viewer cannot publish', !!(await throws(`select public.archive_venue($1, true)`, [DRAFT])));
check('viewer is not counted as a visitor', (await one(`select public.record_visit_events($1, 'visit-viewer-01', 'phone', 'direct', '[{"kind":"visit"}]'::jsonb) as n`, [LIVE])).n === 0);
check('user_team_role says viewer', (await one(`select public.user_team_role($1) as r`, [INST])).r === 'viewer');

await as('authenticated', EDITOR);
await db.query(`update public.buildings set name = 'Annex West' where id = $1`, [DRAFT]);
await asSuper();
check('editor still edits', (await one(`select name from public.buildings where id = $1`, [DRAFT])).name === 'Annex West');

// Kinds of account: only Yet New sets them.
await as('authenticated', GOV);
await db.query(`update public.institutions set account_type = 'government' where id = $1`, [GOVI]);
await asSuper();
check("an owner can't make their institution a government account", (await one(`select account_type from public.institutions where id = $1`, [GOVI])).account_type === 'venue');
await as('authenticated', ADMIN);
check('oversight needs a government or destination account', !!(await throws(`select public.admin_set_oversight($1, $2, true)`, [GOVI, INST])));
await db.query(`select public.admin_set_account_type($1, 'government')`, [GOVI]);
await db.query(`select public.admin_set_oversight($1, $2, true, 'City pilot')`, [GOVI, INST]);
await as('authenticated', GOV);
check('government team sees the overseen unpublished venue', !!(await one(`select id from public.buildings where id = $1`, [DRAFT])));
check('…and its insights', !!(await one(`select public.venue_insights($1, now() - interval '7 days', now()) as j`, [LIVE])).j);
await db.query(`update public.buildings set name = 'Gov edit' where id = $1`, [DRAFT]);
await asSuper();
check('…but changes nothing', (await one(`select name from public.buildings where id = $1`, [DRAFT])).name === 'Annex West');
await as('authenticated', GOV);
check('user_team_role says oversight', (await one(`select public.user_team_role($1) as r`, [INST])).r === 'oversight');
await as('authenticated', OWNER);
check('the overseen owner sees who oversees them', (await all(`select * from public.oversight_grants`)).length === 1);
await as('authenticated', STRANGER);
check('others do not see the grant', (await all(`select * from public.oversight_grants`)).length === 0);
check('a stranger still sees nothing unpublished', !(await one(`select id from public.buildings where id = $1`, [DRAFT])));

await as('authenticated', ADMIN);
await db.query(`select public.admin_set_account_type($1, 'venue')`, [GOVI]);
await as('authenticated', GOV);
check('back to a venue account: oversight ends', !(await one(`select id from public.buildings where id = $1`, [DRAFT])));

// The audit log.
await as('authenticated', OWNER);
await db.query(`select public.archive_venue($1, true)`, [DRAFT]);
await as('authenticated', ADMIN);
await db.query(`select public.admin_set_trust($1, null, 'official', 'Ministry letter')`, [LIVE]);
await db.query(`select public.admin_suspend_venue($1, true, 'Unsafe stairs')`, [LIVE]);
await asSuper();
await db.query(`select public.team_set_member($1, $2, $3, 'editor')`, [OWNER, INST, VIEWER]);
await db.query(`select public.team_set_member($1, $2, $3, null)`, [OWNER, INST, EDITOR]);
await db.query(`insert into public.platform_admins values ($1)`, [GOV]);

const log = await all(`select * from public.audit_log order by id`);
const find = (action, extra = () => true) => log.find(e => e.action === action && extra(e));
const added = find('member.added', e => e.target_id === VIEWER);
check('member added: by the owner, named, with the role', added?.actor_id === OWNER && added.actor_role === 'owner' && added.target_name === 'Vera Viewer' && added.details.role === 'viewer', JSON.stringify(added));
check('role change logged from → to', find('member.role', e => e.target_id === VIEWER)?.details.role.to === 'editor');
check('member removed logged', !!find('member.removed', e => e.target_id === EDITOR));
check('account kind change logged by Yet New', find('institution.type')?.actor_role === 'yet_new');
check('oversight granted, on both sides', log.filter(e => e.action === 'oversight.granted').map(e => e.institution_id).sort().join() === [INST, GOVI].sort().join());
check('oversight ended when the kind changed', log.some(e => e.action === 'oversight.revoked'));
check('archive logged by the owner', find('venue.archived')?.actor_role === 'owner');
const trust = find('venue.trust');
check('trust change logged with from → to', trust?.actor_role === 'yet_new' && trust.details.trust_level.to === 'official' && trust.details.trust_level.from === 'listed', JSON.stringify(trust));
check('suspension logged with its note', find('venue.suspended')?.details.note === 'Unsafe stairs');
check('suspension also took it offline, logged', !!find('venue.unpublished', e => e.building_id === LIVE));
check('Yet New staff added logged', !!find('staff.added', e => e.target_id === GOV));
check('the editor\'s rename is not an audit event (it is in the activity feed)', !log.some(e => e.action === 'venue.updated'));

// Nobody edits the log.
check('even the database owner cannot change an entry', !!(await throws(`update public.audit_log set action = 'x' where id = $1`, [log[0].id])));
check('…or delete one', !!(await throws(`delete from public.audit_log where id = $1`, [log[0].id])));
check('…or empty it', !!(await throws(`truncate public.audit_log`)));
await as('authenticated', ADMIN);
check('Yet New cannot change it either', !!(await throws(`update public.audit_log set action = 'x'`)));
check('no one can write it directly', !!(await throws(`insert into public.audit_log(actor_role, action, target_type) values ('yet_new', 'x', 'y')`)));
check('audit_write is not callable', !!(await throws(`select public.audit_write('x', 'y', null, null, null, null)`)));

// Reading it.
await as('authenticated', OWNER);
const mine = await all(`select * from public.audit_entries($1)`, [INST]);
check('the owner reads their institution\'s log', mine.length > 5 && mine.every(e => e.institution_id === INST));
check('newest first', mine[0].id > mine[mine.length - 1].id);
check('paging with before_id', (await all(`select * from public.audit_entries($1, $2, 2)`, [INST, mine[0].id])).every(e => e.id < mine[0].id));
check('the owner cannot read everything', !!(await throws(`select * from public.audit_entries()`)));
check('the owner sees only their rows in the table', (await all(`select * from public.audit_log`)).every(e => e.institution_id === INST));
await as('authenticated', VIEWER);   // an editor now
check('editors read the log too', (await all(`select * from public.audit_entries($1)`, [INST])).length > 0);
await asSuper();
await db.query(`select public.team_set_member($1, $2, $3, 'viewer')`, [OWNER, INST, VIEWER]);
await as('authenticated', VIEWER);
check('viewers do not read the log', !!(await throws(`select * from public.audit_entries($1)`, [INST])));
await as('authenticated', STRANGER);
check('another institution's owner sees none of this one's entries', !!(await throws(`select * from public.audit_entries($1)`, [INST])) && (await all(`select * from public.audit_log`)).every(e => e.institution_id === SHOP));
await as('authenticated', ADMIN);
check('Yet New reads everything', (await all(`select * from public.audit_entries(null, null, 200)`)).length === log.length + 1);

// team_set_member is for the server only.
await as('authenticated', OWNER);
check('teams cannot call team_set_member', !!(await throws(`select public.team_set_member($1, $2, $3, 'owner')`, [OWNER, INST, STRANGER])));
await asSuper();
check('…even by the server', !!(await throws(`select public.team_set_member($1, $2, $3, 'boss')`, [OWNER, INST, STRANGER])));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
