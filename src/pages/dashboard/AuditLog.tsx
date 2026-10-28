// The institution's audit log: who published, verified, suspended, added or removed people,
// changed roles or gave oversight — permanent, for owners and editors.

import { ScrollText } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import AuditLogList from '@/components/audit/AuditLogList';
import { PageHeader, Panel } from './ui';

export default function AuditLog() {
  const ws = useWorkspace();
  const { canEdit } = useDashboard();
  const inst = ws.institution!;
  return (
    <>
      <PageHeader title="Audit log" description={`Who changed what matters at ${inst.name}: going live or offline, verification, suspension, the team and its roles, and who oversees you. Entries can't be changed or deleted.`} />
      <Panel title="Changes" icon={ScrollText}>
        {canEdit ? <AuditLogList institutionId={inst.id} fileName={`${inst.name} audit log.csv`} />
          : <p className="p-5 text-sm text-muted-foreground">The audit log is for this institution’s owners and editors.</p>}
      </Panel>
    </>
  );
}
