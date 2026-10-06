import React from 'react';
import { Loader2 } from 'lucide-react';
import { admin } from './adminTheme';

export const AdminButtonPrimary: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }> = ({
  className = '', children, loading, disabled, ...props
}) => (
  <button
    {...props}
    disabled={disabled || loading}
    className={`h-9 px-4 rounded-lg text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 transition-[filter] hover:brightness-95 ${className}`}
    style={{ background: admin.accent }}
  >
    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
    {children}
  </button>
);

export const AdminButtonGhost: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className = '', children, ...props
}) => (
  <button
    {...props}
    className={`h-9 px-4 rounded-lg text-[13px] font-medium transition-colors hover:bg-black/[0.04] ${className}`}
    style={{ background: admin.surface, color: admin.text, border: `1px solid ${admin.border}` }}
  >
    {children}
  </button>
);
