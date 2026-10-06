/**
 * DocsShell — layout for the /doc site. Sidebar nav + content column,
 * Notion/Gebeta-style: quiet neutral surfaces, one accent color reserved
 * for the active link and inline code/links.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, ShieldCheck, Code2, ArrowLeft, Menu, X } from 'lucide-react';
import { admin } from '@/components/admin/adminTheme';

interface NavItem {
  to: string;
  label: string;
  icon: typeof BookOpen;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [{ to: '/doc', label: 'Introduction', icon: BookOpen }],
  },
  {
    title: 'Guides',
    items: [{ to: '/doc/admin', label: 'Admin Guide', icon: ShieldCheck }],
  },
  {
    title: 'Reference',
    items: [{ to: '/doc/api', label: 'API & SDK', icon: Code2 }],
  },
];

const DocsShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  const isActive = (to: string) => (to === '/doc' ? location.pathname === '/doc' : location.pathname.startsWith(to));

  const sidebarContent = (
    <>
      <Link to="/" className="flex items-center gap-2 px-1 mb-6 group w-fit">
        <ArrowLeft className="w-3.5 h-3.5" style={{ color: admin.textMuted }} />
        <span className="text-xs font-semibold" style={{ color: admin.textMuted }}>Back to map</span>
      </Link>

      <div className="px-1 mb-6">
        <p className="text-sm font-bold" style={{ color: admin.text }}>Unity Park Docs</p>
      </div>

      <nav className="space-y-5">
        {NAV.map((group) => (
          <div key={group.title}>
            <p
              className="text-[11px] font-bold uppercase tracking-wider px-2 mb-1.5"
              style={{ color: admin.textFaint }}
            >
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileNavOpen(false)}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors"
                    style={{
                      background: active ? admin.activeNav : 'transparent',
                      color: admin.text,
                      fontWeight: active ? 600 : 500,
                    }}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: admin.icon }} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </>
  );

  return (
    <div className="min-h-screen flex" style={{ background: admin.canvas }}>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:block w-60 flex-shrink-0 px-4 py-6 sticky top-0 h-screen overflow-y-auto"
        style={{ background: admin.sidebar, borderRight: `1px solid ${admin.border}` }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile topbar */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3"
        style={{ background: admin.surface, borderBottom: `1px solid ${admin.border}` }}
      >
        <span className="text-sm font-bold" style={{ color: admin.text }}>Unity Park Docs</span>
        <button onClick={() => setMobileNavOpen((p) => !p)} aria-label="Toggle navigation">
          {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>
      {mobileNavOpen && (
        <div
          className="lg:hidden fixed top-[52px] left-0 right-0 bottom-0 z-30 px-4 py-4 overflow-y-auto"
          style={{ background: admin.sidebar }}
        >
          {sidebarContent}
        </div>
      )}

      {/* Content */}
      <main className="flex-1 min-w-0 px-6 py-10 lg:px-16 lg:py-14 pt-20 lg:pt-14">
        {children}
      </main>
    </div>
  );
};

export default DocsShell;
