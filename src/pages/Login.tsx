// Sign in with a username (or an older email account) and password.

import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AtSign, Lock } from 'lucide-react';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import AuthShell, { FIELD_CLS } from '@/components/auth/AuthShell';

export default function Login() {
  const { session, loading, signIn } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const target = location.state?.from && location.state.from !== '/admin' ? location.state.from : '/dashboard';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && session) return <Navigate to={target} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) { setError('Enter your username and password.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await signIn(identifier, password);
    setBusy(false);
    if (err) { setError(err); return; }
    navigate(target, { replace: true });
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage your digital venue."
      footer={<>New to Yet New? <Link to="/signup" className="font-semibold text-primary hover:underline">Create your institution's account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <label className="block space-y-1.5">
          <span className="px-0.5 text-xs font-bold text-foreground/80">Username</span>
          <span className="relative block">
            <AtSign className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} value={identifier} onChange={e => setIdentifier(e.target.value)}
              placeholder="unitypark" className={`${FIELD_CLS} pl-11`} aria-label="Username" />
          </span>
        </label>
        <label className="block space-y-1.5">
          <span className="px-0.5 text-xs font-bold text-foreground/80">Password</span>
          <span className="relative block">
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" className={`${FIELD_CLS} pl-11 pr-12`} aria-label="Password" />
            <button type="button" onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
        </label>
        {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
        </button>
        <p className="text-center text-xs text-muted-foreground">Forgot your password? Ask your team's owner to reset it from Team settings.</p>
      </form>
    </AuthShell>
  );
}
