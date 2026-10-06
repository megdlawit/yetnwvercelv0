import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, LogOut, ChevronDown } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { admin } from './adminTheme';

interface AdminHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** If provided, back button calls this instead of navigating */
  onBack?: () => void;
  /** Route to navigate back to. Defaults to "/" */
  backTo?: string;
  /** Secondary pill buttons rendered before the primary action */
  actions?: React.ReactNode;
  /** The emphasized CTA pinned to the end of the action row */
  primaryAction?: React.ReactNode;
  /** Extra content rendered below the action row (e.g. segmented tabs) */
  children?: React.ReactNode;
}

const AdminHeader: React.FC<AdminHeaderProps> = ({
  icon: Icon, title, subtitle, onBack, backTo = '/', actions, primaryAction, children,
}) => {
  const { user, signOut } = useAdminAuth();
  const navigate = useNavigate();

  const initials = (user?.email ?? 'A')
    .split('@')[0]
    .slice(0, 2)
    .toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    navigate('/admin/login', { replace: true });
  };

  const BackButton = (
    <button
      aria-label="Go back"
      onClick={onBack}
      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors hover:bg-black/[0.04]"
      style={{ border: `1px solid ${admin.border}`, background: admin.surface }}
    >
      <ArrowLeft className="w-4 h-4" style={{ color: admin.text }} />
    </button>
  );

  return (
    <div
      className="sticky top-0 z-40 px-6 pt-[max(env(safe-area-inset-top,0px),16px)] pb-4"
      style={{
        background: 'rgba(250, 249, 248, 0.82)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: `1px solid ${admin.border}`,
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {onBack ? BackButton : <Link to={backTo}>{BackButton}</Link>}
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: admin.iconBadge, border: `1px solid ${admin.iconBadgeBorder}` }}
            >
              <Icon className="w-4 h-4" style={{ color: admin.icon }} />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-tight tracking-tight truncate" style={{ color: admin.text }}>{title}</p>
              {subtitle && (
                <p className="text-xs mt-0.5 truncate" style={{ color: admin.textMuted }}>{subtitle}</p>
              )}
            </div>
          </div>
        </div>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-1.5 rounded-lg pl-1 pr-2 py-1 flex-shrink-0 transition-colors hover:bg-black/[0.04]"
              style={{ border: `1px solid ${admin.border}`, background: admin.surface }}
              aria-label="Account menu"
            >
              <span
                className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0"
                style={{ background: admin.accent }}
              >
                {initials}
              </span>
              <ChevronDown className="w-3.5 h-3.5 hidden sm:block" style={{ color: admin.textMuted }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
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

      {(actions || primaryAction) && (
        <div className="flex gap-2 flex-wrap items-center">
          {actions}
          {primaryAction && <div className="ml-auto flex gap-2">{primaryAction}</div>}
        </div>
      )}

      {children}
    </div>
  );
};

export default AdminHeader;
