/**
 * AdminDashboard — unified admin shell with sidebar navigation.
 * Tabs: Buildings · POIs · Paths · Layers · Commerce
 * Route: /admin
 *
 * Layout direction: a persistent Notion-style sidebar for navigation, with
 * an Apple-style blurred topbar over the active section's content. Colors
 * and spacing come from adminTheme.ts, kept separate from the app-wide
 * (consumer-facing) design tokens.
 */
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2, Sparkles, Wallet, Layers, Route, ChevronDown, LogOut, ArrowLeft, Code2,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { admin } from '@/components/admin/adminTheme';
import AdminBuildings from './AdminBuildings';
import AdminPOIs from './AdminPOIs';
import AdminVenuePaths from './AdminVenuePaths';
import MerchantDashboard from './MerchantDashboard';
import AdminLayersDashboard from './Adminlayersdashboard';
import AdminEmbed from './AdminEmbed';

type AdminTab = 'buildings' | 'pois' | 'paths' | 'layers' | 'commerce' | 'embed';

const TABS: { id: AdminTab; label: string; icon: typeof Building2 }[] = [
  { id: 'buildings', label: 'Buildings', icon: Building2 },
  { id: 'pois',      label: 'POIs',      icon: Sparkles  },
  { id: 'paths',     label: 'Paths',     icon: Route     },
  { id: 'layers',    label: 'Layers',    icon: Layers    },
  { id: 'commerce',  label: 'Commerce',  icon: Wallet    },
  { id: 'embed',     label: 'Embed',     icon: Code2     },
];

const TAB_META: Record<AdminTab, string> = {
  buildings: 'Buildings & floors',
  pois: 'Points of interest & promotions',
  paths: 'Curated outdoor walking paths',
  layers: 'Map layers & live overlays',
  commerce: 'Merchant performance',
  embed: 'Partner embed codes',
};

const NavRow: React.FC<{
  active: boolean; label: string; icon: typeof Building2; onClick: () => void;
}> = ({ active, label, icon: Icon, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors text-left"
    style={{
      background: active ? admin.activeNav : 'transparent',
      color: admin.text,
      fontWeight: active ? 600 : 500,
    }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = admin.hover; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
  >
    <Icon className="w-4 h-4 flex-shrink-0" style={{ color: admin.icon }} strokeWidth={active ? 2.25 : 2} />
    {label}
  </button>
);

const AdminDashboard: React.FC = () => {
  const [tab, setTab] = useState<AdminTab>('buildings');
  const { user, signOut } = useAdminAuth();
  const navigate = useNavigate();

  const initials = (user?.email ?? 'A').split('@')[0].slice(0, 2).toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen" style={{ background: admin.canvas }}>
      {/* ── Sidebar (desktop) ── */}
      <aside
        className="hidden md:flex w-60 flex-shrink-0 flex-col h-screen sticky top-0 px-3 py-4"
        style={{ background: admin.sidebar, borderRight: `1px solid ${admin.border}` }}
      >
        <div className="flex items-center gap-2.5 px-2 py-1.5 mb-5">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: admin.iconBadge, border: `1px solid ${admin.iconBadgeBorder}` }}
          >
            <Layers className="w-3.5 h-3.5" style={{ color: admin.icon }} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-tight truncate" style={{ color: admin.text }}>Admin Console</p>
            <p className="text-[11px] leading-tight truncate" style={{ color: admin.textFaint }}>Unity Park</p>
          </div>
        </div>

        <p className="px-2.5 mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: admin.textFaint }}>
          Workspace
        </p>
        <nav className="space-y-0.5 flex-1 overflow-y-auto">
          {TABS.map(({ id, label, icon }) => (
            <NavRow key={id} active={tab === id} label={label} icon={icon} onClick={() => setTab(id)} />
          ))}
        </nav>

        <div className="pt-3 mt-3 space-y-2" style={{ borderTop: `1px solid ${admin.border}` }}>
          <Link
            to="/"
            className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] font-medium transition-colors"
            style={{ color: admin.textMuted }}
            onMouseEnter={(e) => { e.currentTarget.style.background = admin.hover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <ArrowLeft className="w-3.5 h-3.5" style={{ color: admin.icon }} /> Back to app
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-black/[0.035]"
                aria-label="Account menu"
              >
                <span
                  className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0"
                  style={{ background: admin.accent }}
                >
                  {initials}
                </span>
                <span className="text-[12.5px] font-medium truncate flex-1 text-left" style={{ color: admin.text }}>
                  {user?.email ?? 'Admin'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: admin.textFaint }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <p className="text-xs text-muted-foreground">Signed in as</p>
                <p className="text-sm font-semibold truncate">{user?.email ?? 'Admin'}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive cursor-pointer">
                <LogOut className="w-4 h-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* ── Content column ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile tab strip (sidebar is hidden below md) */}
        <div
          className="md:hidden sticky top-0 z-40 flex gap-1 px-3 py-2.5 overflow-x-auto no-scrollbar"
          style={{
            background: 'rgba(250, 249, 248, 0.9)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            borderBottom: `1px solid ${admin.border}`,
          }}
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap flex-shrink-0"
                style={{
                  background: active ? admin.activeNav : 'transparent',
                  color: admin.text,
                  fontWeight: active ? 600 : 500,
                }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color: admin.icon }} /> {label}
              </button>
            );
          })}
        </div>

        {/* Section topbar (desktop) */}
        <div
          className="hidden md:block sticky top-0 z-30 px-6 py-4"
          style={{
            background: 'rgba(250, 249, 248, 0.82)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            borderBottom: `1px solid ${admin.border}`,
          }}
        >
          <p className="text-[15px] font-semibold leading-tight" style={{ color: admin.text }}>
            {TABS.find(t => t.id === tab)?.label}
          </p>
          <p className="text-xs mt-0.5" style={{ color: admin.textMuted }}>{TAB_META[tab]}</p>
        </div>

        <main className="flex-1 min-w-0">
          {tab === 'buildings' && <AdminBuildings onNavigateToPOIs={() => setTab('pois')} embedded />}
          {tab === 'pois'      && <AdminPOIs onNavigateToBuildings={() => setTab('buildings')} embedded />}
          {tab === 'paths'     && <AdminVenuePaths embedded />}
          {tab === 'layers'    && <AdminLayersDashboard embedded />}
          {tab === 'commerce'  && <MerchantDashboard embedded />}
          {tab === 'embed'     && <div className="p-6"><AdminEmbed /></div>}
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
