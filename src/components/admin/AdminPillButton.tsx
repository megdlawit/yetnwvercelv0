import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { admin } from './adminTheme';

interface AdminPillButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  variant?: 'ghost' | 'solid' | 'danger';
}

const VARIANT_STYLE: Record<string, React.CSSProperties> = {
  ghost: { background: admin.surface, color: admin.text, border: `1px solid ${admin.border}` },
  solid: { background: admin.accent, color: 'white', border: '1px solid transparent' },
  danger: { background: admin.dangerSoft, color: admin.danger, border: `1px solid ${admin.dangerBorder}` },
};

const AdminPillButton: React.FC<AdminPillButtonProps> = ({
  icon: Icon, variant = 'ghost', className = '', children, ...props
}) => (
  <button
    {...props}
    className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-colors disabled:opacity-40 hover:brightness-[0.97] ${className}`}
    style={VARIANT_STYLE[variant]}
  >
    {Icon && <Icon className="h-3.5 w-3.5" />}
    {children}
  </button>
);

export default AdminPillButton;
