// Create an institution account in two short steps: the place you run,
// then your sign-in. You land in your dashboard with a venue ready for a map.
// A business (hotel, restaurant, café, shop) signs up as a business account instead:
// no venue of its own; it claims its listing on Yet New Business (?type=business).

import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AtSign, Check, X, ArrowLeft, Trees, Landmark, Castle, GraduationCap, Hospital, ShoppingBag, Building2, Store } from 'lucide-react';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import AuthShell, { FIELD_CLS } from '@/components/auth/AuthShell';
import { cn } from '@/lib/utils';
import {
  INSTITUTION_KINDS, callAccounts, normalizeUsername, passwordProblem, slugify, usernameProblem, type InstitutionKind,
} from '@/lib/accounts';

const KIND_ICONS: Record<InstitutionKind, typeof Trees> = {
  park: Trees, museum: Landmark, heritage: Castle, campus: GraduationCap, hospital: Hospital, mall: ShoppingBag, other: Building2,
};

export default function Signup() {
  const { session, loading, signIn } = useAdminAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [business, setBusiness] = useState(params.get('type') === 'business');
  // Where a business goes after signing up: straight to claiming the place it came from, if any.
  const claim = params.get('claim');
  const businessHome = `/business?welcome=1${claim ? `&claim=${encodeURIComponent(claim)}` : ''}`;
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<InstitutionKind | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [touchedUsername, setTouchedUsername] = useState(false);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<{ for: string; available: boolean } | null>(null);

  // Suggest a username from the institution's name until they type their own.
  useEffect(() => {
    if (!touchedUsername) setUsername(slugify(name).replace(/-/g, '').slice(0, 30));
  }, [name, touchedUsername]);

  const u = normalizeUsername(username);
  const uProblem = u ? usernameProblem(u) : null;
  useEffect(() => {
    if (!u || uProblem) { setAvailability(null); return; }
    const t = setTimeout(() => {
      callAccounts<{ available: boolean }>('check_username', { username: u })
        .then(r => setAvailability({ for: u, available: r.available }))
        .catch(() => setAvailability(null));
    }, 400);
    return () => clearTimeout(t);
  }, [u, uProblem]);

  if (!loading && session && !busy) return <Navigate to={business ? businessHome : '/dashboard'} replace />;

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) { setError(business ? 'Add your business\'s name.' : 'Add your institution\'s name.'); return; }
    if (!business && !kind) { setError('Choose what kind of place you run.'); return; }
    setError(null); setStep(2);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const pProblem = passwordProblem(password);
    if (!displayName.trim()) { setError('Add your name.'); return; }
    if (uProblem) { setError(`Username: ${uProblem}`); return; }
    if (pProblem) { setError(`Password: ${pProblem}`); return; }
    if (availability?.for === u && !availability.available) { setError('That username is taken. Try another.'); return; }
    setBusy(true); setError(null);
    try {
      await callAccounts('signup', {
        username: u, password, displayName: displayName.trim(),
        institution: business ? { name: name.trim(), kind: 'other', accountType: 'business' } : { name: name.trim(), kind },
      });
      const { error: err } = await signIn(u, password);
      if (err) throw new Error(err);
      navigate(business ? businessHome : '/dashboard?welcome=1', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
      setBusy(false);
    }
  };

  const pProblem = password ? passwordProblem(password) : null;

  return (
    <AuthShell
      title={step === 1 ? (business ? 'Join Yet New Business' : 'Create your digital venue') : 'Create your sign-in'}
      subtitle={step === 1
        ? (business ? 'Step 1 of 2 · Manage how your hotel, restaurant, café or shop appears on venue maps.' : 'Step 1 of 2 · Tell us about the place you run.')
        : `Step 2 of 2 · How your team will sign in to ${name.trim() || (business ? 'your business' : 'your venue')}.`}
      footer={<>Already have an account? <Link to="/login" className="font-semibold text-primary hover:underline">Sign in</Link></>}>
      {step === 1 ? (
        <form onSubmit={next} className="space-y-5" noValidate>
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1" role="radiogroup" aria-label="What are you signing up">
            {([[false, Landmark, 'A venue I run'], [true, Store, 'A business']] as const).map(([b, Icon, label]) => (
              <button key={label} type="button" role="radio" aria-checked={business === b} onClick={() => { setBusiness(b); setError(null); }}
                className={cn('flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
                  business === b ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          <label className="block space-y-1.5">
            <span className="px-0.5 text-xs font-bold text-foreground/80">{business ? 'Business name' : 'Institution name'}</span>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder={business ? 'Tomoca Coffee' : 'Unity Park'} className={FIELD_CLS}
              aria-label={business ? 'Business name' : 'Institution name'} />
          </label>
          {business ? (
            <p className="rounded-2xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
              Next you'll find your place on a venue's map and ask to manage it. Yet New checks it's yours, then you keep your
              phone, prices and photos up to date and answer reviews. Listing is free.
            </p>
          ) : (
          <fieldset className="space-y-1.5">
            <legend className="px-0.5 pb-1.5 text-xs font-bold text-foreground/80">What kind of place is it?</legend>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(INSTITUTION_KINDS) as InstitutionKind[]).map(k => {
                const Icon = KIND_ICONS[k];
                return (
                  <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                    className={cn('flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                      kind === k ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 hover:bg-muted')}>
                    <Icon className="h-4 w-4 shrink-0" /> {INSTITUTION_KINDS[k].label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          )}
          {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <button type="submit" className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-sm hover:opacity-95">Continue</button>
        </form>
      ) : (
        <form onSubmit={create} className="space-y-4" noValidate>
          <label className="block space-y-1.5">
            <span className="px-0.5 text-xs font-bold text-foreground/80">Your name</span>
            <input autoFocus autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Sara Bekele" className={FIELD_CLS} aria-label="Your name" />
          </label>
          <label className="block space-y-1.5">
            <span className="px-0.5 text-xs font-bold text-foreground/80">Username</span>
            <span className="relative block">
              <AtSign className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input autoComplete="username" autoCapitalize="none" spellCheck={false} value={username}
                onChange={e => { setTouchedUsername(true); setUsername(e.target.value); }} className={`${FIELD_CLS} pl-11 pr-10`} aria-label="Username" />
              {u && !uProblem && availability?.for === u && (
                availability.available
                  ? <Check className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" aria-label="Available" />
                  : <X className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-destructive" aria-label="Taken" />
              )}
            </span>
            <span className={cn('block px-0.5 text-[11px]', uProblem || (availability?.for === u && !availability.available) ? 'text-destructive' : 'text-muted-foreground')}>
              {uProblem ?? (availability?.for === u ? (availability.available ? `@${u} is available` : `@${u} is taken`) : 'Your team signs in with this.')}
            </span>
          </label>
          <label className="block space-y-1.5">
            <span className="px-0.5 text-xs font-bold text-foreground/80">Password</span>
            <span className="relative block">
              <input type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className={`${FIELD_CLS} pr-12`} aria-label="Password" />
              <button type="button" onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
            <span className={cn('block px-0.5 text-[11px]', pProblem ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{pProblem ?? (password ? 'Looks good.' : 'At least 8 characters, letters and numbers.')}</span>
          </label>
          {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-sm hover:opacity-95 disabled:opacity-60">
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating your venue…</> : 'Create account'}
          </button>
          <button type="button" onClick={() => { setStep(1); setError(null); }} className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
        </form>
      )}
    </AuthShell>
  );
}
