import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { signInEmail } from '@/lib/accounts';

interface AdminAuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    // Guards against the initial getSession() call resolving *after*
    // onAuthStateChange has already fired (e.g. right after a fresh
    // sign-in). Without this, a slow/late getSession() response can
    // overwrite a valid session with a stale `null`, which looks like
    // "login succeeds, dashboard flashes, then instantly logs out".
    let authEventReceived = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted || authEventReceived) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventReceived = true;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  /** `identifier` is a username or (older accounts) an email address. */
  const signIn = async (identifier: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: signInEmail(identifier), password });
    if (error && /invalid login credentials/i.test(error.message)) return { error: 'Wrong username or password.' };
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AdminAuthContext.Provider value={{ session, user: session?.user ?? null, loading, signIn, signOut }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error('useAdminAuth must be used within AdminAuthProvider');
  }
  return ctx;
}
