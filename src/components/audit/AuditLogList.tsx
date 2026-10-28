// The audit log as a list: newest first, filterable, a page at a time, exportable.
// One institution's entries (its owners and editors) or everything (Yet New).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, ScrollText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ACTOR_ROLES, AUDIT_GROUPS, auditGroup, describeAudit, type AuditEntry } from '@/lib/audit';
import { downloadText, toCsv } from '@/lib/analytics/insights';

const PAGE = 50;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function AuditLogList({ institutionId, fileName }: { institutionId: string | null; fileName: string }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<string>('all');
  const [search, setSearch] = useState('');

  const fetchPage = useCallback(async (before: number | null) => {
    const { data, error: e } = await supabase.rpc('audit_entries', { inst: institutionId, before_id: before, lim: PAGE });
    if (e) { setError(e.message); return [] as AuditEntry[]; }
    setError(null);
    const page = (data ?? []) as unknown as AuditEntry[];
    setMore(page.length === PAGE);
    return page;
  }, [institutionId]);

  useEffect(() => { setRows(null); void fetchPage(null).then(setRows); }, [fetchPage]);
  const loadMore = async () => {
    if (!rows?.length) return;
    setBusy(true);
    const page = await fetchPage(rows[rows.length - 1].id);
    setRows(r => [...(r ?? []), ...page]);
    setBusy(false);
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter(e => (group === 'all' || auditGroup(e.action) === group)
      && (!q || `${e.actor_name ?? ''} ${describeAudit(e)}`.toLowerCase().includes(q)));
  }, [rows, group, search]);

  const exportCsv = () => downloadText(fileName, toCsv(shown.map(e => ({
    when: new Date(e.created_at).toISOString(), who: e.actor_name ?? (e.actor_role === 'system' ? 'System' : 'Unknown'), role: ACTOR_ROLES[e.actor_role] ?? e.actor_role,
    what: describeAudit(e), action: e.action, details: JSON.stringify(e.details ?? {}),
  })), [{ key: 'when', label: 'When (UTC)' }, { key: 'who', label: 'Who' }, { key: 'role', label: 'Role' }, { key: 'what', label: 'What' }, { key: 'action', label: 'Action' }, { key: 'details', label: 'Details' }]));

  if (error && /audit_entries|schema cache|does not exist|function/i.test(error)) {
    return <p className="p-5 text-sm text-muted-foreground">Run the 20261030090000_roles_audit migration to turn on the audit log.</p>;
  }
  if (error) return <p className="p-5 text-sm text-destructive">{error}</p>;
  if (!rows) return <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {[['all', 'Everything'] as const, ...AUDIT_GROUPS].map(([id, label]) => (
            <button key={id} onClick={() => setGroup(id)} aria-pressed={group === id}
              className={cn('rounded-full border px-3 py-1 text-xs', group === id ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}>{label}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search names" className="h-8 w-44" />
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!shown.length}><Download className="mr-1.5 h-3.5 w-3.5" />CSV</Button>
        </div>
      </div>
      {!shown.length ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
          <ScrollText className="h-6 w-6" />
          {rows.length ? 'Nothing matches.' : 'Nothing recorded yet. Publishing, verification, team and access changes appear here.'}
        </div>
      ) : (
        <ol className="divide-y">
          {shown.map(e => (
            <li key={e.id} className="flex gap-3 px-4 py-3 text-sm">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary/60" aria-hidden />
              <div className="min-w-0 flex-1">
                <p>
                  <strong className="font-semibold">{e.actor_name ?? (e.actor_role === 'system' ? 'System' : 'Someone')}</strong>{' '}
                  <span className="rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground">{ACTOR_ROLES[e.actor_role] ?? e.actor_role}</span>{' '}
                  {describeAudit(e)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{when(e.created_at)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {more && (
        <div className="border-t p-3 text-center">
          <Button size="sm" variant="ghost" onClick={loadMore} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Show older</Button>
        </div>
      )}
      <p className="border-t px-4 py-2.5 text-[11px] text-muted-foreground">Entries are permanent: nobody, including Yet New, can change or delete them.</p>
    </div>
  );
}
