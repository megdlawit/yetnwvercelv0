/**
 * CreateProfilePrompt — Email-only sign-in via Supabase magic link (OTP).
 *
 * Flow:
 *   1. User enters email → supabase.auth.signInWithOtp()
 *   2. Supabase emails a magic link / 6-digit code
 *   3. Clicking the link returns them to the app and onAuthStateChange fires,
 *      which triggers fetchProfile → auto-creates the profile row.
 *
 * No password, no friction.
 */
import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Mail, MapPin, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { isValidEmail, normalizeEmail } from '@/lib/validation';

interface CreateProfilePromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CreateProfilePrompt: React.FC<CreateProfilePromptProps> = ({ open, onOpenChange }) => {
  const [email, setEmail]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const trimmed = normalizeEmail(email);
    if (!isValidEmail(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    // Flag this as an expected magic-link return so useUserProfile's global
    // auth listener knows to handle the SIGNED_IN event when it comes back
    // (and won't mistake some unrelated sign-in, like an admin logging in,
    // for this flow).
    try { sessionStorage.setItem('ethi_guest_magic_link_pending', '1'); } catch { /* ignore */ }
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        // Redirect back to the app root after clicking the magic link
        emailRedirectTo: window.location.origin,
      },
    });
    setSubmitting(false);

    if (otpErr) {
      try { sessionStorage.removeItem('ethi_guest_magic_link_pending'); } catch { /* ignore */ }
      setError(otpErr.message);
      return;
    }

    setSent(true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) { setEmail(''); setSent(false); setError(null); }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-sm"
        onPointerDownOutside={(e) => { if (submitting) e.preventDefault(); }}
      >
        <DialogHeader className="items-center pb-1">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2"
            style={{ background: 'hsl(152 68% 22% / 0.1)' }}
          >
            {sent
              ? <CheckCircle2 className="w-6 h-6" style={{ color: 'hsl(152 68% 22%)' }} />
              : <MapPin className="w-6 h-6" style={{ color: 'hsl(152 68% 22%)' }} />
            }
          </div>
          <DialogTitle className="text-xl font-bold">
            {sent ? 'Check your inbox' : 'Sign in to continue'}
          </DialogTitle>
          <DialogDescription className="text-center text-sm leading-snug">
            {sent
              ? `We sent a magic link to ${email}. Tap it to sign in — no password needed.`
              : 'Enter your email and we\'ll send you a one-tap sign-in link.'}
          </DialogDescription>
        </DialogHeader>

        {!sent && (
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label
                htmlFor="auth-email"
                className="text-xs font-semibold text-muted-foreground uppercase tracking-wide"
              >
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="auth-email"
                  type="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
                  disabled={submitting}
                  className="h-11 pl-9"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive font-medium px-1">{error}</p>
            )}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 pt-1">
          {sent ? (
            <Button
              variant="outline"
              className="w-full h-11"
              onClick={() => { setSent(false); setEmail(''); setError(null); }}
            >
              Use a different email
            </Button>
          ) : (
            <Button
              onClick={() => void handleSubmit()}
              disabled={submitting || !isValidEmail(email)}
              className="w-full h-11 font-bold text-sm"
              style={{ background: 'hsl(152 68% 22%)' }}
            >
              {submitting ? 'Sending…' : 'Send magic link'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateProfilePrompt;