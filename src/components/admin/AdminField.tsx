import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { admin } from './adminTheme';

interface AdminFieldProps {
  label: string;
  icon?: LucideIcon;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

const AdminField: React.FC<AdminFieldProps> = ({ label, icon: Icon, required, hint, className = '', children }) => (
  <div className={`space-y-1.5 ${className}`}>
    <label className="flex items-center gap-1.5 text-xs font-medium px-0.5" style={{ color: admin.textMuted }}>
      {Icon && <Icon className="w-3.5 h-3.5" style={{ color: admin.textFaint }} />}
      {label}
      {required && <span style={{ color: admin.danger }}>*</span>}
    </label>
    {children}
    {hint && <p className="text-[11px] px-0.5" style={{ color: admin.textFaint }}>{hint}</p>}
  </div>
);

export const ADMIN_INPUT_CLS = 'h-10 rounded-lg text-sm border-[#EBE9E4] bg-white focus-visible:ring-1 focus-visible:ring-offset-0';
export const ADMIN_TEXTAREA_CLS = 'rounded-lg text-sm border-[#EBE9E4] bg-white focus-visible:ring-1 focus-visible:ring-offset-0';

export default AdminField;
