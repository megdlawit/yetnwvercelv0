import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { admin } from './adminTheme';

interface AdminDialogShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: LucideIcon;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
}

const AdminDialogShell: React.FC<AdminDialogShellProps> = ({
  open, onOpenChange, icon: Icon, title, description, footer, children, maxWidth = 'sm:max-w-md',
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      className={`${maxWidth} max-h-[88vh] overflow-y-auto rounded-2xl p-0 gap-0`}
      style={{ border: `1px solid ${admin.border}`, boxShadow: admin.shadowLg }}
    >
      <div
        className="px-6 pt-5 pb-4"
        style={{ borderBottom: `1px solid ${admin.border}` }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: admin.iconBadge, border: `1px solid ${admin.iconBadgeBorder}` }}
          >
            <Icon className="w-4 h-4" style={{ color: admin.icon }} />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-tight" style={{ color: admin.text }}>{title}</p>
            {description && (
              <p className="text-xs mt-0.5" style={{ color: admin.textMuted }}>{description}</p>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">{children}</div>

      {footer && (
        <div className="px-6 pb-5 pt-1 flex justify-end gap-2" style={{ borderTop: `1px solid ${admin.border}` }}>
          {footer}
        </div>
      )}
    </DialogContent>
  </Dialog>
);

export default AdminDialogShell;
