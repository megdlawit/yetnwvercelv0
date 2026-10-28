// supabase/functions/institution-accounts/index.ts
//
// Creates and manages institution sign-ins (username + password). Needs the
// service role because Supabase only lets the server create confirmed users;
// every action checks the caller itself.
//
// POST { action, ... }
//   check_username     { username }                                → { available, problem? }
//   signup             { username, password, displayName, institution: { name, kind } }
//                      → creates the person, their institution and a first venue
//   create_institution { institution: { name, kind } }  (signed in, no institution yet)
//   add_member         { institutionId, username, password, displayName, role }   (owner)
//                      role: owner | editor | viewer (sees everything, changes nothing)
//   set_role           { institutionId, userId, role }                              (owner)
//   remove_member      { institutionId, userId }                                    (owner)
//
// Team changes go through public.team_set_member, naming the owner who made them, so the
// audit log records who did it (this function acts with the service key).
//   set_password       { institutionId, userId, password }                          (owner)

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  INSTITUTION_KINDS, isInstitutionKind, normalizeUsername, passwordProblem, slugify, usernameProblem, usernameToEmail,
  type InstitutionKind,
} from '../functions/_shared/accounts.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class Problem extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = (): SupabaseClient => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function caller(db: SupabaseClient, req: Request): Promise<string> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const { data } = token ? await db.auth.getUser(token) : { data: { user: null } };
  if (!data.user) throw new Problem('Please sign in again.', 401);
  return data.user.id;
}

async function isPlatformAdmin(db: SupabaseClient, userId: string) {
  const { data } = await db.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}

async function requireOwner(db: SupabaseClient, userId: string, institutionId: string) {
  if (await isPlatformAdmin(db, userId)) return;
  const { data: inst } = await db.from('institutions').select('owner_id').eq('id', institutionId).maybeSingle();
  if (inst?.owner_id === userId) return;
  const { data: m } = await db.from('institution_members').select('role').eq('institution_id', institutionId).eq('user_id', userId).maybeSingle();
  if (m?.role === 'owner') return;
  throw new Problem('Only the institution owner can manage the team.', 403);
}

/** owner | editor | viewer; anything else is an editor, as before viewers existed. */
const teamRole = (r: unknown): 'owner' | 'editor' | 'viewer' => (r === 'owner' || r === 'viewer' ? r : 'editor');

/** Adds, changes (role) or removes (null) a team member, naming who did it for the audit log. */
async function setMember(db: SupabaseClient, actor: string, institutionId: string, memberId: string, role: 'owner' | 'editor' | 'viewer' | null) {
  const { error } = await db.rpc('team_set_member', { actor, inst: institutionId, member: memberId, new_role: role });
  if (!error) return;
  // Before the roles migration runs (20261030090000), write the table directly as before.
  if (!/team_set_member|PGRST202|Could not find the function/i.test(`${error.code} ${error.message}`)) throw new Error(error.message);
  const q = role
    ? db.from('institution_members').upsert({ institution_id: institutionId, user_id: memberId, role: role === 'viewer' ? 'editor' : role })
    : db.from('institution_members').delete().eq('institution_id', institutionId).eq('user_id', memberId);
  const { error: e2 } = await q;
  if (e2) throw new Error(e2.message);
}

const need = (v: string | undefined) => {
  if (!v || !/^[0-9a-f-]{36}$/i.test(v)) throw new Problem('Missing or invalid id.');
  return v;
};

async function usernameTaken(db: SupabaseClient, username: string) {
  const { data } = await db.from('user_accounts').select('user_id').eq('username', username).maybeSingle();
  return !!data;
}

function checkPerson(username: string, password: string, displayName: string) {
  const problem = usernameProblem(username) ?? (passwordProblem(password) && `Password: ${passwordProblem(password)}`);
  if (problem) throw new Problem(problem);
  if (!displayName.trim()) throw new Problem('Please add your name.');
}

async function createPerson(db: SupabaseClient, rawUsername: string, password: string, displayName: string): Promise<string> {
  const username = normalizeUsername(rawUsername);
  if (await usernameTaken(db, username)) throw new Problem('That username is taken. Try another.', 409);
  const { data, error } = await db.auth.admin.createUser({
    email: usernameToEmail(username), password, email_confirm: true,
    user_metadata: { username, display_name: displayName.trim() },
  });
  if (error || !data.user) {
    throw new Problem(/already|registered|exists/i.test(error?.message ?? '') ? 'That username is taken. Try another.' : `Could not create the account: ${error?.message}`, 409);
  }
  const { error: accErr } = await db.from('user_accounts').insert({ user_id: data.user.id, username, display_name: displayName.trim() });
  if (accErr) { await db.auth.admin.deleteUser(data.user.id); throw new Problem(`Could not create the account: ${accErr.message}`, 500); }
  return data.user.id;
}

/** An institution, its owner, and a first venue ready for a map upload. */
async function createInstitution(db: SupabaseClient, ownerId: string, name: string, kind: InstitutionKind) {
  const clean = name.trim();
  if (clean.length < 2) throw new Problem('Please add your institution\'s name.');
  const meta = INSTITUTION_KINDS[kind];
  let slug = slugify(clean);
  const { data: clash } = await db.from('institutions').select('id').eq('slug', slug).maybeSingle();
  if (clash) slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;

  const { data: inst, error } = await db.from('institutions').insert({ name: clean, slug, kind, owner_id: ownerId }).select('id').single();
  if (error || !inst) throw new Problem(`Could not create the institution: ${error?.message}`, 500);
  const undo = async () => { await db.from('institutions').delete().eq('id', inst.id); };

  const { error: mErr } = await db.from('institution_members').insert({ institution_id: inst.id, user_id: ownerId, role: 'owner' });
  const { data: venue, error: vErr } = await db.from('buildings')
    .insert({ name: clean, institution_id: inst.id, is_published: false, version: 1, layout: meta.layout, theme: meta.theme })
    .select('id').single();
  if (mErr || vErr || !venue) { await undo(); throw new Problem(`Could not set up the venue: ${(mErr ?? vErr)?.message}`, 500); }
  const { error: fErr } = await db.from('floors').insert({ building_id: venue.id, name: meta.firstArea, level: 0 });
  if (fErr) { await undo(); throw new Problem(`Could not set up the venue: ${fErr.message}`, 500); }
  return { institutionId: inst.id, venueId: venue.id };
}

interface Body {
  action?: string; username?: string; password?: string; displayName?: string; role?: string;
  institution?: { name?: string; kind?: unknown }; institutionId?: string; userId?: string;
}

async function handle(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as Body;
  const db = admin();

  switch (body.action) {
    case 'check_username': {
      const username = normalizeUsername(String(body.username ?? ''));
      const problem = usernameProblem(username);
      return json({ available: !problem && !(await usernameTaken(db, username)), problem });
    }

    case 'signup': {
      const { username = '', password = '', displayName = '', institution = {} } = body;
      checkPerson(username, password, displayName);
      if (!isInstitutionKind(institution.kind)) throw new Problem('Choose what kind of place you run.');
      if (String(institution.name ?? '').trim().length < 2) throw new Problem('Please add your institution\'s name.');
      const userId = await createPerson(db, username, password, displayName);
      try {
        const created = await createInstitution(db, userId, String(institution.name), institution.kind);
        return json({ ok: true, ...created });
      } catch (err) {
        await db.auth.admin.deleteUser(userId);
        throw err;
      }
    }

    case 'create_institution': {
      const userId = await caller(db, req);
      const { institution = {} } = body;
      if (!isInstitutionKind(institution.kind)) throw new Problem('Choose what kind of place you run.');
      return json({ ok: true, ...(await createInstitution(db, userId, String(institution.name ?? ''), institution.kind)) });
    }

    case 'set_role': {
      const userId = await caller(db, req);
      const institutionId = need(body.institutionId), memberId = need(body.userId);
      await requireOwner(db, userId, institutionId);
      const role = teamRole(body.role);
      if (memberId === userId && role !== 'owner') throw new Problem("You can't change your own role.");
      const { data: inst } = await db.from('institutions').select('owner_id').eq('id', institutionId).maybeSingle();
      if (inst?.owner_id === memberId) throw new Problem("The institution's main owner stays an owner.");
      const { data: m } = await db.from('institution_members').select('user_id').eq('institution_id', institutionId).eq('user_id', memberId).maybeSingle();
      if (!m) throw new Problem("That person isn't on this team.", 404);
      await setMember(db, userId, institutionId, memberId, role);
      return json({ ok: true });
    }

    case 'add_member': {
      const userId = await caller(db, req);
      const { username = '', password = '', displayName = '', role = 'editor' } = body;
      const institutionId = need(body.institutionId);
      await requireOwner(db, userId, institutionId);
      checkPerson(username, password, displayName);
      const memberId = await createPerson(db, username, password, displayName);
      try { await setMember(db, userId, institutionId, memberId, teamRole(role)); }
      catch (err) { await db.auth.admin.deleteUser(memberId); throw new Problem(`Could not add to the team: ${(err as Error).message}`, 500); }
      return json({ ok: true, userId: memberId, username: normalizeUsername(username) });
    }

    case 'remove_member': {
      const userId = await caller(db, req);
      const institutionId = need(body.institutionId), memberId = need(body.userId);
      await requireOwner(db, userId, institutionId);
      if (memberId === userId) throw new Problem('You can\'t remove yourself.');
      const { data: inst } = await db.from('institutions').select('owner_id').eq('id', institutionId).maybeSingle();
      if (inst?.owner_id === memberId) throw new Problem('The institution\'s main owner can\'t be removed.');
      await setMember(db, userId, institutionId, memberId, null);
      // Accounts made for this team only (not used anywhere else) are deleted entirely.
      const [{ count: otherTeams }, { count: owned }, admin_] = await Promise.all([
        db.from('institution_members').select('user_id', { count: 'exact', head: true }).eq('user_id', memberId),
        db.from('institutions').select('id', { count: 'exact', head: true }).eq('owner_id', memberId),
        isPlatformAdmin(db, memberId),
      ]);
      if (!otherTeams && !owned && !admin_) await db.auth.admin.deleteUser(memberId);
      return json({ ok: true });
    }

    case 'set_password': {
      const userId = await caller(db, req);
      const institutionId = need(body.institutionId), memberId = need(body.userId);
      const { password = '' } = body;
      await requireOwner(db, userId, institutionId);
      const problem = passwordProblem(password);
      if (problem) throw new Problem(`Password: ${problem}`);
      const { data: m } = await db.from('institution_members').select('user_id').eq('institution_id', institutionId).eq('user_id', memberId).maybeSingle();
      if (!m) throw new Problem('That person isn\'t on this team.', 404);
      const { error } = await db.auth.admin.updateUserById(memberId, { password });
      if (error) throw new Problem(error.message, 500);
      return json({ ok: true });
    }

    default:
      throw new Problem('Unknown action.');
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    return await handle(req);
  } catch (err) {
    if (err instanceof Problem) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
