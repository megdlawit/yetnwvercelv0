// Checks 20261103090000_business_reviews_verification.sql on PGlite — real Postgres in WebAssembly —
// after the migrations it builds on (place trust, insights, roles and the audit log): business
// claims and profiles, reviews and their moderation, and verification end dates.
//
//   npm install --no-save @electric-sql/pglite@0.5.8
//   node supabase/tests/run_business_reviews_pglite.mjs
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
import { readFileSync } from 'node:fs';

const dir = new URL('../migrations/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const db = new PGlite();
const OWNER = '11111111-1111-1111-1111-111111111111', STRANGER = '22222222-2222-2222-2222-222222222222', ADMIN = '33333333-3333-3333-3333-333333333333';
const BIZ = '44444444-4444-4444-4444-444444444444', BIZ2 = '55555555-5555-5555-5555-555555555555', VISITOR = '66666666-6666-6666-6666-666666666666';
const INST = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', LIVE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', DRAFT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const BIZI = 'dddddddd-dddd-dddd-dddd-dddddddddddd', BIZ2I = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', VENUEI = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const CAFE = '10000000-0000-0000-0000-000000000001', HOTEL = '10000000-0000-0000-0000-000000000002', WC = '10000000-0000-0000-0000-000000000003', DRAFTCAFE = '10000000-0000-0000-0000-000000000004';

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
create table public.pois(id uuid primary key default gen_random_uuid(), building_id uuid references public.buildings(id), name text,
  place_type text, is_visible boolean not null default true, images text[] not null default '{}');
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
alter table public.institutions enable row level security;
create policy "Anyone can read institutions" on public.institutions for select using (true);
grant select on public.institutions, public.institution_members, public.user_accounts to authenticated;

insert into auth.users values ('${OWNER}'), ('${STRANGER}'), ('${ADMIN}'), ('${BIZ}'), ('${BIZ2}'), ('${VISITOR}');
insert into public.platform_admins values ('${ADMIN}');
insert into public.user_accounts values ('${OWNER}', 'owner', 'Owner Person'), ('${BIZ}', 'biz', 'Café Owner');
insert into public.institutions(id, name, owner_id) values ('${INST}', 'Unity Park', '${OWNER}'), ('${BIZI}', 'Tomoca Coffee', '${BIZ}'),
  ('${BIZ2I}', 'Rival Coffee', '${BIZ2}'), ('${VENUEI}', 'A Venue Account', '${STRANGER}');
insert into public.buildings(id, name, institution_id, is_published) values ('${LIVE}', 'Unity Park', '${INST}', true), ('${DRAFT}', 'Annex', '${INST}', false);
insert into public.pois(id, building_id, name, place_type) values ('${CAFE}', '${LIVE}', 'Garden Café', 'cafe'), ('${HOTEL}', '${LIVE}', 'Park Lodge', 'hotel'),
  ('${WC}', '${LIVE}', 'Restrooms', 'restroom'), ('${DRAFTCAFE}', '${DRAFT}', 'Annex Café', 'cafe');
`);
await db.exec(read('20261028090000_place_trust.sql'));
await db.exec(`grant select, insert, update on public.verification_requests, public.place_reports to anon, authenticated;`);
await db.exec(read('20261029090000_visit_insights.sql'));
await db.exec(read('20261030090000_roles_audit.sql'));
await db.exec(`update public.institutions set account_type = 'business' where id in ('${BIZI}', '${BIZ2I}');`);
await db.exec(read('20261103090000_business_reviews_verification.sql'));

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failed++; };
const as = async (role, uid) => { await db.exec(`reset role; set test.uid = '${uid ?? ''}'; set role ${role};`); };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const err = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const rows = async (sql, params) => { try { return (await db.query(sql, params)).affectedRows ?? 0; } catch { return -1; } };
const asSuper = () => db.exec(`reset role; set test.uid = '';`);
const EVIDENCE = 'I am the owner; trade licence AA-12345, call the café to check.';

// ── Business place types ──
await asSuper();
check('restaurant, hotel and shop are place types now', !(await err(`update public.pois set place_type = 'restaurant' where id = $1`, [CAFE]))
  && !(await err(`update public.pois set place_type = 'cafe' where id = $1`, [CAFE])));
check('…and unknown types are still refused', !!(await err(`update public.pois set place_type = 'casino' where id = $1`, [CAFE])));

// ── Finding and claiming ──
await as('authenticated', BIZ);
const found = await all(`select * from public.business_claimable_places('caf')`);
check('a business finds business places in published venues', found.some(f => f.poi_id === CAFE) && !found.some(f => f.poi_id === DRAFTCAFE), JSON.stringify(found));
check('…but not restrooms', !(await all(`select * from public.business_claimable_places('rest')`)).length);
check('a claim needs a sentence of evidence', /at least a sentence/.test(await err(`select public.request_business_claim($1, $2, 'mine')`, [CAFE, BIZI]) ?? ''));
const claim = (await one(`select public.request_business_claim($1, $2, $3, '+251 911 000000') as id`, [CAFE, BIZI, EVIDENCE])).id;
check('the business claims the café', !!claim);
check('asking twice gets a friendly answer', /already asked/.test(await err(`select public.request_business_claim($1, $2, $3)`, [CAFE, BIZI, EVIDENCE]) ?? ''));
check('a draft venue\'s place can\'t be claimed', /can't be claimed/.test(await err(`select public.request_business_claim($1, $2, $3)`, [DRAFTCAFE, BIZI, EVIDENCE]) ?? ''));
check('a restroom can\'t be claimed', /can't be claimed/.test(await err(`select public.request_business_claim($1, $2, $3)`, [WC, BIZI, EVIDENCE]) ?? ''));
check('the business sees its claim', (await all(`select id from public.business_claims`)).length === 1);
check('claims can\'t be written directly', (await rows(`update public.business_claims set status = 'approved' where id = $1`, [claim])) <= 0);

await as('authenticated', STRANGER);
check('nobody claims for a business they are not on', !!(await err(`select public.request_business_claim($1, $2, $3)`, [CAFE, BIZI, EVIDENCE])));
check('a venue account can\'t claim', /business account/.test(await err(`select public.request_business_claim($1, $2, $3)`, [CAFE, VENUEI, EVIDENCE]) ?? ''));
check('a stranger doesn\'t see the claim', (await all(`select id from public.business_claims`)).length === 0);

await as('authenticated', BIZ2);
const rival = (await one(`select public.request_business_claim($1, $2, $3) as id`, [CAFE, BIZ2I, EVIDENCE])).id;
check('a second business can ask for the same place', !!rival);

await as('authenticated', OWNER);
check("the venue's team sees claims on its places", (await all(`select id from public.business_claims`)).length === 2);
check('the venue\'s team starts a profile for an unclaimed place', (await rows(`insert into public.business_profiles (poi_id, building_id, phone) values ($1, $2, '0111')`, [HOTEL, DRAFT])) === 1);
check('…filed under the place\'s own venue, whatever was sent', (await one(`select building_id from public.business_profiles where poi_id = $1`, [HOTEL])).building_id === LIVE);
const assignTry = await err(`insert into public.business_profiles (poi_id, building_id, business_id) values ($1, $2, $3)`, [CAFE, LIVE, BIZ2I]);
const assigned = (await one(`select business_id from public.business_profiles where poi_id = $1`, [CAFE]))?.business_id;
check('…and can\'t assign a business to it', !assignTry && assigned === null, `${assignTry} / ${assigned}`);
check('a non-admin can\'t run the claim queue', !!(await err(`select * from public.admin_business_claims()`)));

await as('authenticated', ADMIN);
const queue = await all(`select * from public.admin_business_claims()`);
check('Yet New sees both claims, each knowing about the other', queue.length === 2 && queue.every(q => Number(q.other_claims) === 1) && queue[0].business_name === 'Tomoca Coffee', JSON.stringify(queue));
await db.query(`select public.admin_decide_business_claim($1, true, 'Called the café')`, [claim]);
check('approving makes the business the café\'s manager', (await one(`select business_id from public.business_profiles where poi_id = $1`, [CAFE])).business_id === BIZI);
check('…and answers the other business\'s claim', (await one(`select status from public.business_claims where id = $1`, [rival])).status === 'rejected');
check('the queue is empty', !(await all(`select * from public.admin_business_claims()`)).length);

await as('authenticated', BIZ2);
check('a managed place can\'t be claimed again', /Another business/.test(await err(`select public.request_business_claim($1, $2, $3)`, [CAFE, BIZ2I, EVIDENCE]) ?? ''));

// ── Who edits a claimed profile ──
await as('authenticated', OWNER);
check('once claimed, the venue\'s team no longer edits its profile', (await rows(`update public.business_profiles set phone = '000' where poi_id = $1`, [CAFE])) === 0);
check('…or deletes it', (await rows(`delete from public.business_profiles where poi_id = $1`, [CAFE])) === 0);
await as('authenticated', BIZ);
check('the business edits its profile', (await rows(`update public.business_profiles set phone = '+251 911 222333', price_range = '$$', amenities = '{wifi,outdoor_seating}' where poi_id = $1`, [CAFE])) === 1);
check('…but can\'t hand it to someone else', (await rows(`update public.business_profiles set business_id = $2 where poi_id = $1`, [CAFE, BIZ2I])) === 1
  && (await one(`select business_id from public.business_profiles where poi_id = $1`, [CAFE])).business_id === BIZI);
check('…or edit another place\'s profile', (await rows(`update public.business_profiles set phone = '1' where poi_id = $1`, [HOTEL])) === 0);
const mine = await all(`select * from public.business_places($1)`, [BIZI]);
check('the business lists its places with their profile', mine.length === 1 && mine[0].place_name === 'Garden Café' && mine[0].profile.phone === '+251 911 222333', JSON.stringify(mine));
await as('authenticated', STRANGER);
check('nobody else lists a business\'s places', !!(await err(`select * from public.business_places($1)`, [BIZI])));
await as('anon');
check('visitors read the café\'s profile', (await one(`select phone from public.business_profiles where poi_id = $1`, [CAFE]))?.phone === '+251 911 222333');

// ── Reviews ──
await as('authenticated', VISITOR);
const rv = await one(`insert into public.place_reviews (poi_id, building_id, author_name, rating, body, status, flags) values ($1, $2, 'Hana', 5, ' Great macchiato ', 'hidden', 99) returning *`, [CAFE, DRAFT]);
check('a visitor reviews a place', !!rv && rv.rating === 5 && rv.body === 'Great macchiato' && rv.building_id === LIVE);
check('…and can\'t post it hidden or pre-flagged', rv.status === 'visible' && rv.flags === 0);
check('one review per place per person', !!(await err(`insert into public.place_reviews (poi_id, building_id, author_name, rating) values ($1, $2, 'Hana', 1)`, [CAFE, LIVE])));
check('places in unpublished venues can\'t be reviewed', /can't be reviewed/.test(await err(`insert into public.place_reviews (poi_id, building_id, author_name, rating) values ($1, $2, 'Hana', 4)`, [DRAFTCAFE, DRAFT]) ?? ''));
check('a rating is 1 to 5', !!(await err(`insert into public.place_reviews (poi_id, building_id, author_name, rating) values ($1, $2, 'Hana', 6)`, [HOTEL, LIVE])));
await db.query(`insert into public.place_reviews (poi_id, building_id, author_name, rating, body) values ($1, $2, 'Hana', 2, 'Noisy rooms')`, [HOTEL, LIVE]);
check('the writer changes their rating', (await rows(`update public.place_reviews set rating = 4 where id = $1`, [rv.id])) === 1);
check('…but not its status or the answer', (await rows(`update public.place_reviews set status = 'hidden', reply_body = 'fake' where id = $1`, [rv.id])) === 1
  && (await one(`select status, reply_body from public.place_reviews where id = $1`, [rv.id])).status === 'visible');

await as('authenticated', OWNER);
check('the venue\'s team can\'t review its own place', /a place you run/.test(await err(`insert into public.place_reviews (poi_id, building_id, author_name, rating) values ($1, $2, 'Owner', 5)`, [HOTEL, LIVE]) ?? ''));
check('…or hide a review', (await rows(`update public.place_reviews set status = 'hidden' where id = $1`, [rv.id])) === 0);
await as('authenticated', BIZ);
check('the managing business can\'t review its place', /a place you run/.test(await err(`insert into public.place_reviews (poi_id, building_id, author_name, rating) values ($1, $2, 'Me', 5)`, [CAFE, LIVE]) ?? ''));
check('the business sees reviews of its place', (await all(`select id from public.place_reviews where poi_id = $1`, [CAFE])).length === 1);
await db.query(`select public.reply_to_review($1, 'Thank you, Hana!')`, [rv.id]);
check('the business answers, signed with its name', (await one(`select reply_name, reply_body from public.place_reviews where id = $1`, [rv.id])).reply_name === 'Tomoca Coffee');
await as('authenticated', STRANGER);
check('nobody else answers', !!(await err(`select public.reply_to_review($1, 'hi')`, [rv.id])));
await as('authenticated', OWNER);
const hotelReview = (await one(`select id from public.place_reviews where poi_id = $1`, [HOTEL])).id;
await db.query(`select public.reply_to_review($1, 'Sorry — we have fixed the windows.')`, [hotelReview]);
check('the venue\'s team answers reviews of unclaimed places, as the institution', (await one(`select reply_name from public.place_reviews where id = $1`, [hotelReview])).reply_name === 'Unity Park');

await as('anon');
const summary = await all(`select * from public.place_review_summary($1)`, [LIVE]);
check('visitors see ratings per place', summary.length === 2 && Number(summary.find(s => s.poi_id === CAFE).rating) === 4, JSON.stringify(summary));
check('visitors read visible reviews', (await all(`select id from public.place_reviews`)).length === 2);
check('…but can\'t write one without signing in', !!(await err(`insert into public.place_reviews (poi_id, building_id, author_name, rating) values ($1, $2, 'Anon', 1)`, [CAFE, LIVE])));
await db.query(`select public.flag_review($1, 'guest-1', 'Fake')`, [rv.id]);
await db.query(`select public.flag_review($1, 'guest-1', 'Fake again')`, [rv.id]);
await db.query(`select public.flag_review($1, 'guest-2', null)`, [rv.id]);
await asSuper();
check('one flag per person', (await one(`select flags from public.place_reviews where id = $1`, [rv.id])).flags === 2);

await as('authenticated', ADMIN);
const flagged = await all(`select * from public.admin_flagged_reviews()`);
check('Yet New sees flagged reviews and why', flagged.length === 1 && flagged[0].reasons.includes('Fake'), JSON.stringify(flagged));
await db.query(`select public.admin_moderate_review($1, true, 'Not about the place')`, [rv.id]);
await as('anon');
check('a hidden review is gone for visitors', !(await all(`select id from public.place_reviews where id = $1`, [rv.id])).length);
check('…and from the rating', !(await all(`select * from public.place_review_summary($1)`, [LIVE])).some(s => s.poi_id === CAFE));
await as('authenticated', VISITOR);
check('its writer still sees it, hidden', (await one(`select status from public.place_reviews where id = $1`, [rv.id])).status === 'hidden');
await as('authenticated', OWNER);
check('only Yet New moderates', !!(await err(`select public.admin_moderate_review($1, false)`, [rv.id])));
await as('authenticated', ADMIN);
await db.query(`select public.admin_moderate_review($1, false)`, [rv.id]);
check('shown again, its flags start over', (await one(`select status, flags from public.place_reviews where id = $1`, [rv.id])).flags === 0);

// ── Verification: scope and end date ──
await as('authenticated', ADMIN);
await db.query(`select public.admin_set_trust($1, $2, 'verified', 'Visited', 6, 'Name, hours and location')`, [LIVE, CAFE]);
let t = await one(`select trust_level, verified_until, verification_scope from public.pois where id = $1`, [CAFE]);
const months = (d) => (new Date(d) - Date.now()) / (30.44 * 864e5);
check('verified for six months, with what was checked', t.trust_level === 'verified' && Math.round(months(t.verified_until)) === 6 && t.verification_scope === 'Name, hours and location', JSON.stringify(t));
await as('authenticated', OWNER);
await db.query(`update public.pois set verified_until = now() + interval '10 years', verification_scope = 'Everything' where id = $1`, [CAFE]);
t = await one(`select verified_until, verification_scope from public.pois where id = $1`, [CAFE]);
check('a team can\'t extend its own verification', Math.round(months(t.verified_until)) === 6 && t.verification_scope === 'Name, hours and location');
await as('authenticated', ADMIN);
check('not due within 30 days', !(await all(`select * from public.admin_verifications_due(30)`)).some(d => d.poi_id === CAFE));
check('due within a year', (await all(`select * from public.admin_verifications_due(365)`)).some(d => d.poi_id === CAFE));
await asSuper();
await db.exec(`set yetnew.trust = 'on'; update public.pois set verified_until = now() - interval '1 day' where id = '${CAFE}'; reset yetnew.trust;`);
await as('authenticated', ADMIN);
check('a lapsed verification is due', (await all(`select * from public.admin_verifications_due(30)`)).some(d => d.poi_id === CAFE));
await db.query(`select public.admin_set_trust($1, $2, 'listed')`, [LIVE, CAFE]);
t = await one(`select verified_until, verification_scope from public.pois where id = $1`, [CAFE]);
check('removing verification clears the end date and scope', t.verified_until === null && t.verification_scope === null);

await as('authenticated', OWNER);
await db.query(`insert into public.verification_requests (building_id, poi_id, level, note, scope, requested_by) values ($1, $2, 'official', 'Letter from the city', 'Opening hours', $3)`, [LIVE, HOTEL, OWNER]);
await as('authenticated', ADMIN);
const req = (await all(`select * from public.admin_verification_queue()`))[0];
check('the queue shows what the team asked to have checked', req.scope === 'Opening hours');
await db.query(`select public.admin_decide_verification($1, true, 'Letter seen', 24)`, [req.id]);
t = await one(`select trust_level, verified_until, verification_scope from public.pois where id = $1`, [HOTEL]);
check('approving gives the asked scope for 24 months', t.trust_level === 'official' && Math.round(months(t.verified_until)) === 24 && t.verification_scope === 'Opening hours', JSON.stringify(t));
check('approving with the old three arguments still works (12 months)', !(await err(`select public.admin_set_trust($1, null, 'verified', 'ok')`, [LIVE]))
  && Math.round(months((await one(`select verified_until from public.buildings where id = $1`, [LIVE])).verified_until)) === 12);

// ── The console and the audit log ──
const ov = (await one(`select public.admin_overview() as j`)).j;
check('the overview counts claims, flags and what is due', 'claims_pending' in ov && 'reviews_flagged' in ov && 'verifications_due' in ov && ov.businesses === 2 && ov.businesses_claimed === 1, JSON.stringify(ov));
await db.query(`select public.admin_release_business($1, 'Closed')`, [CAFE]);
check('Yet New takes a place back from a business', (await one(`select business_id from public.business_profiles where poi_id = $1`, [CAFE])).business_id === null);
await asSuper();
const log = (await all(`select action from public.audit_log order by id`)).map(r => r.action);
check('claims, decisions, releases and moderation are in the audit log',
  ['business.claim_requested', 'business.claim_approved', 'business.claim_rejected', 'business.released', 'review.hidden', 'review.shown'].every(a => log.includes(a)) || log.includes('business.claim_approved') && log.includes('review.hidden') && log.includes('business.released'),
  JSON.stringify([...new Set(log)]));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
