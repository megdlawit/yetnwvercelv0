import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAdminAuth } from '@/contexts/AdminAuthContext';

const RequireAdminAuth = ({ children }: { children: ReactNode }) => {
  const { session, loading } = useAdminAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: 'hsl(152 70% 22%)' }}
      >
        <div className="relative">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center animate-pulse"
            style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)' }}
          >
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
        </div>
        <p className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Checking your session…
        </p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
};

export default RequireAdminAuth;
