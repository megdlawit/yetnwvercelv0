// Every audit-log entry on the platform, for the Yet New team (and the pilot's oversight report).

import { ScrollText } from 'lucide-react';
import AuditLogList from '@/components/audit/AuditLogList';
import { PageHeader, Panel } from '@/pages/dashboard/ui';

export default function AdminAudit() {
  return (
    <>
      <PageHeader title="Audit log" description="Every change to access, trust and visibility across the platform — by venue teams and by Yet New. Permanent: entries can't be changed or deleted, by anyone." />
      <Panel title="All changes" icon={ScrollText}>
        <AuditLogList institutionId={null} fileName="Yet New audit log.csv" />
      </Panel>
    </>
  );
}
