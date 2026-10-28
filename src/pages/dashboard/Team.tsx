// Team: the people who manage this institution's venues. Owners add
// teammates with a username and password, reset passwords and remove people.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { UserPlus, Loader2, KeyRound, Trash2, Crown, Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import { callAccounts, normalizeUsername, passwordProblem, usernameProblem } from '@/lib/accounts';
import { PageHeader, Panel } from './ui';

interface Member { userId: string; role: string; username: string | null; displayName: string }
type TeamRole = 'owner' | 'editor' | 'viewer';
const ROLES: { id: TeamRole; label: string; hint: string }[] = [
  { id: 'owner', label: 'Owner', hint: 'everything, and manages the team' },
  { id: 'editor', label: 'Editor', hint: 'edits maps, places and content, publishes' },
  { id: 'viewer', label: 'Viewer', hint: 'sees the dashboard, insights and reports; changes nothing' },
];

export default function Team() {
  const ws = useWorkspace();
  const { canManageTeam } = useDashboard();
  const inst = ws.institution!;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<Member | null>(null);

  const load = useCallback(async () => {
    const { data: rows } = await supabase.from('institution_members').select('user_id, role').eq('institution_id', inst.id);
    const ids = [...new Set([...(rows ?? []).map(r => r.user_id), ...(inst.owner_id ? [inst.owner_id] : [])])];
    const { data: accounts } = ids.length ? await supabase.from('user_accounts').select('user_id, username, display_name').in('user_id', ids) : { data: [] };
    const acc = new Map((accounts ?? []).map(a => [a.user_id, a] as const));
    setMembers(ids.map(id => ({
      userId: id,
      role: id === inst.owner_id ? 'owner' : rows?.find(r => r.user_id === id)?.role ?? 'editor',
      username: acc.get(id)?.username ?? null,
      displayName: acc.get(id)?.display_name || (id === ws.account.userId ? ws.account.displayName : 'Team member'),
    })).sort((a, b) => ROLES.findIndex(r => r.id === a.role) - ROLES.findIndex(r => r.id === b.role) || a.displayName.localeCompare(b.displayName)));
  }, [inst.id, inst.owner_id, ws.account]);
  useEffect(() => { load(); }, [load]);

  const changeRole = async (m: Member, role: TeamRole) => {
    try { await callAccounts('set_role', { institutionId: inst.id, userId: m.userId, role }); toast.success(`${m.displayName} is ${role === 'owner' ? 'an owner' : `a ${role}`} now`); load(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not change the role'); }
  };

  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.displayName} from ${inst.name}? They won't be able to sign in to this dashboard any more.`)) return;
    try { await callAccounts('remove_member', { institutionId: inst.id, userId: m.userId }); toast.success(`${m.displayName} removed`); load(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not remove'); }
  };

  return (
    <>
      <PageHeader title="Team" description={`The people who manage ${inst.name}. Everyone signs in with their own username and password.`}
        actions={canManageTeam && <Button onClick={() => setAdding(true)}><UserPlus className="mr-1.5 h-4 w-4" /> Add teammate</Button>} />
      <Panel bodyClassName="divide-y">
        {members === null && <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading team…</p>}
        {members?.map(m => (
          <div key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary">{m.displayName.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{m.displayName}{m.userId === ws.account.userId && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}</span>
              <span className="block truncate text-xs text-muted-foreground">{m.username ? `@${m.username}` : 'Email sign-in'}</span>
            </span>
            {canManageTeam && m.userId !== ws.account.userId && m.userId !== inst.owner_id ? (
              <select value={m.role} onChange={e => changeRole(m, e.target.value as TeamRole)} aria-label={`${m.displayName}'s role`}
                className="h-8 rounded-full border bg-background px-2.5 text-xs font-medium">
                {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize">{m.role === 'owner' && <Crown className="h-3 w-3 text-amber-500" />}{m.role}</span>
            )}
            {canManageTeam && m.userId !== ws.account.userId && (
              <>
                {m.username && <Button size="sm" variant="ghost" onClick={() => setResetting(m)}><KeyRound className="mr-1 h-3.5 w-3.5" /> Reset password</Button>}
                {m.userId !== inst.owner_id && <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(m)} aria-label={`Remove ${m.displayName}`}><Trash2 className="h-4 w-4" /></Button>}
              </>
            )}
          </div>
        ))}
      </Panel>
      <ul className="mt-3 space-y-0.5 text-xs text-muted-foreground">
        {ROLES.map(r => <li key={r.id}><strong className="font-semibold text-foreground">{r.label}</strong> — {r.hint}.</li>)}
      </ul>
      {!canManageTeam && <p className="mt-2 text-xs text-muted-foreground">Only owners can add or remove teammates and change roles.</p>}
      <AddMember open={adding} onOpenChange={setAdding} institutionId={inst.id} onAdded={load} />
      <ResetPassword member={resetting} onClose={() => setResetting(null)} institutionId={inst.id} />
    </>
  );
}

function suggestPassword() {
  const words = ['park', 'lake', 'tree', 'gate', 'hill', 'sun', 'river', 'stone', 'bird', 'leaf'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function AddMember({ open, onOpenChange, institutionId, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; institutionId: string; onAdded: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(suggestPassword);
  const [role, setRole] = useState<TeamRole>('editor');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ username: string; password: string } | null>(null);
  const u = normalizeUsername(username);
  const problem = !displayName.trim() ? 'Add their name.' : usernameProblem(u) ?? (passwordProblem(password) && `Password: ${passwordProblem(password)}`);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    try {
      await callAccounts('add_member', { institutionId, username: u, password, displayName: displayName.trim(), role });
      setDone({ username: u, password }); onAdded();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not add'); }
    finally { setBusy(false); }
  };
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) { setDone(null); setDisplayName(''); setUsername(''); setPassword(suggestPassword()); setRole('editor'); }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {done ? (
          <>
            <DialogHeader><DialogTitle>Teammate added</DialogTitle><DialogDescription>Share these sign-in details with them. They can change the password after signing in.</DialogDescription></DialogHeader>
            <div className="my-4 space-y-1 rounded-2xl bg-muted p-4 font-mono text-sm">
              <p>Sign in at: {window.location.origin}/login</p><p>Username: {done.username}</p><p>Password: {done.password}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => navigator.clipboard.writeText(`Sign in at ${window.location.origin}/login\nUsername: ${done.username}\nPassword: ${done.password}`).then(() => toast.success('Copied'))}><Copy className="mr-1.5 h-4 w-4" /> Copy</Button>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader><DialogTitle>Add a teammate</DialogTitle><DialogDescription>They'll sign in with this username and password.</DialogDescription></DialogHeader>
            <div className="space-y-3 py-5">
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Name</Label><Input autoFocus value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Abebe Kebede" /></div>
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Username</Label><Input value={username} onChange={e => setUsername(e.target.value)} placeholder="abebe.k" autoCapitalize="none" />
                {u && usernameProblem(u) && <p className="text-xs text-destructive">{usernameProblem(u)}</p>}</div>
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Password</Label><Input value={password} onChange={e => setPassword(e.target.value)} />
                {passwordProblem(password) && <p className="text-xs text-amber-700">{passwordProblem(password)}</p>}</div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Role</Label>
                <select value={role} onChange={e => setRole(e.target.value as TeamRole)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  {ROLES.map(r => <option key={r.id} value={r.id}>{r.label} — {r.hint}</option>)}
                </select>
              </div>
            </div>
            <DialogFooter><Button type="submit" disabled={busy || !!problem}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Add teammate</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResetPassword({ member, onClose, institutionId }: { member: Member | null; onClose: () => void; institutionId: string }) {
  const [password, setPassword] = useState(suggestPassword);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!member || passwordProblem(password)) return;
    setBusy(true);
    try {
      await callAccounts('set_password', { institutionId, userId: member.userId, password });
      toast.success(`New password set for ${member.displayName}: ${password}`, { duration: 15000 });
      onClose(); setPassword(suggestPassword());
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not reset'); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={!!member} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={save}>
          <DialogHeader><DialogTitle>Reset {member?.displayName}'s password</DialogTitle><DialogDescription>Give them the new password; they can change it after signing in.</DialogDescription></DialogHeader>
          <div className="space-y-1.5 py-5"><Input value={password} onChange={e => setPassword(e.target.value)} aria-label="New password" />
            {passwordProblem(password) && <p className="text-xs text-amber-700">{passwordProblem(password)}</p>}</div>
          <DialogFooter><Button type="submit" disabled={busy || !!passwordProblem(password)}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Set password</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
