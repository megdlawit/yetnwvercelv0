// The platform tools (buildings, POIs, outdoor paths, layers, commerce,
// embed codes) inside the control center.

import { useNavigate, useParams, Navigate } from 'react-router-dom';
import AdminBuildings from '@/pages/AdminBuildings';
import AdminPOIs from '@/pages/AdminPOIs';
import AdminVenuePaths from '@/pages/AdminVenuePaths';
import AdminLayersDashboard from '@/pages/Adminlayersdashboard';
import MerchantDashboard from '@/pages/MerchantDashboard';
import AdminEmbed from '@/pages/AdminEmbed';
import { PageHeader } from '@/pages/dashboard/ui';

const TOOLS: Record<string, { title: string; text: string }> = {
  buildings: { title: 'Buildings & floors', text: 'Every building and floor, directly.' },
  pois: { title: 'Points of interest', text: 'Places and promotions across all venues.' },
  paths: { title: 'Outdoor paths', text: 'Curated walking paths on the outdoor map.' },
  layers: { title: 'Map layers', text: 'Layers and live overlays on the outdoor map.' },
  commerce: { title: 'Commerce', text: 'How merchants and offers are doing.' },
  embed: { title: 'Embed codes', text: 'Codes partners use to put venues on their sites.' },
};

export default function AdminTools() {
  const { tool = '' } = useParams();
  const navigate = useNavigate();
  const meta = TOOLS[tool];
  if (!meta) return <Navigate to="/admin" replace />;
  return (
    <>
      <PageHeader title={meta.title} description={meta.text} />
      <div className="overflow-hidden rounded-3xl border bg-card">
        {tool === 'buildings' && <AdminBuildings onNavigateToPOIs={() => navigate('/admin/tools/pois')} embedded />}
        {tool === 'pois' && <AdminPOIs onNavigateToBuildings={() => navigate('/admin/tools/buildings')} embedded />}
        {tool === 'paths' && <AdminVenuePaths embedded />}
        {tool === 'layers' && <AdminLayersDashboard embedded />}
        {tool === 'commerce' && <MerchantDashboard embedded />}
        {tool === 'embed' && <div className="p-6"><AdminEmbed /></div>}
      </div>
    </>
  );
}
