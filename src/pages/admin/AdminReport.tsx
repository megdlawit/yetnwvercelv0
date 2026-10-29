// The pilot KPI report across every venue on Yet New, for the Yet New team.

import PilotReport from '@/pages/destination/PilotReport';
import { Page } from './ui';

export default function AdminReport() {
  return (
    <Page title="Pilot report" subtitle="Every KPI across all venues for any period, compared with the period before. Print it or save it as a PDF for the partner.">
      <PilotReport overseer={null} title="All venues on Yet New" />
    </Page>
  );
}
