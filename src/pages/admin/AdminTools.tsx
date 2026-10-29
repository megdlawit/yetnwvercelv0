// The platform tools (buildings, POIs, outdoor paths, layers and embed codes) inside the
// control center. They're the tabs of the Tools section.

import { useNavigate, useParams, Navigate } from 'react-router-dom';
import AdminBuildings from '@/pages/AdminBuildings';
import AdminPOIs from '@/pages/AdminPOIs';
import AdminVenuePaths from '@/pages/AdminVenuePaths';
import AdminLayersDashboard from '@/pages/Adminlayersdashboard';
import AdminEmbed from '@/pages/AdminEmbed';
import { Page } from './ui';

const TOOLS: Record<string, { title: string; text: string }> = {
  buildings: { title: 'Buildings & floors', text: 'Every building and floor, directly.' },
  pois: { title: 'Points of interest', text: 'Places and promotions across all venues.' },
  paths: { title: 'Outdoor paths', text: 'Curated walking paths on the outdoor map.' },
  layers: { title: 'Map layers', text: 'Buildings, parking, walkways and events on every visitor’s outdoor map — saved as you go.' },
  embed: { title: 'Embed codes', text: 'Codes partners use to put venues on their sites.' },
};

/** /admin/tools opens the first tool. */
export function ToolsHome() {
  return <Navigate to="/admin/tools/buildings" replace />;
}

export default function AdminTools() {
  const { tool = '' } = useParams();
  const navigate = useNavigate();
  const meta = TOOLS[tool];
  if (meta) {
    return (
      <Page title={meta.title} subtitle={meta.text}>
        <div className="overflow-hidden rounded-3xl border bg-card">
          {tool === 'buildings' ? <AdminBuildings onNavigateToPOIs={() => navigate('/admin/tools/pois')} embedded /> : null}
          {tool === 'pois' ? <AdminPOIs onNavigateToBuildings={() => navigate('/admin/tools/buildings')} embedded /> : null}
          {tool === 'paths' ? <AdminVenuePaths embedded /> : null}
          {tool === 'layers' ? <AdminLayersDashboard embedded /> : null}
          {tool === 'embed' ? <div className="p-6"><AdminEmbed /></div> : null}
        </div>
      </Page>
    );
  } else {
    return <Navigate to="/admin/tools/buildings" replace />;
  }
}
