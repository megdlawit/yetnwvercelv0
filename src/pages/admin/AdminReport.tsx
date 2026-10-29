// The pilot KPI report across every venue on Yet New, for the Yet New team.

import { PageHeader } from '@/pages/dashboard/ui';
import PilotReport from '@/pages/destination/PilotReport';

export default function AdminReport() {
  return (
    <>
      <PageHeader title="Pilot report" description="Every KPI of the pilot across all venues, for any period, compared with the period before — with each KPI's definition. Print it or save it as PDF for the partner. Each authority has the same report for its own venues in Destination OS." />
      <PilotReport overseer={null} title="All venues on Yet New" />
    </>
  );
}
