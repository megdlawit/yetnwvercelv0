/**
 * EmailGateDialog — Shown once when a guest tries to save a place or view
 * their profile. Captures an email address and stores it on the profile row.
 * No magic link, no verification, no password — just identification.
 */
import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Mail, MapPin } from 'lucide-react';
import { isValidEmail, normalizeEmail } from '@/lib/validation';

interface EmailGateDialogProps {
  open: boolean;
  /** Called with the submitted email once validated. Return false to keep dialog open. */
  onSubmit: (email: string) => Promise<boolean>;
  /** Context hint shown in the description — e.g. "save this place" */
  reason?: string;
  /** Called when the user dismisses the gate (the X button) without
   *  submitting an email. FIX — this dialog used to have no way to close
   *  at all: onPointerDownOutside/onEscapeKeyDown both called
   *  preventDefault(), and <Dialog open={open}> was never given an
   *  onOpenChange, so the X button DialogContent always renders (it's
   *  baked into the shared component) visibly did nothing when clicked —
   *  Radix asks to close via onOpenChange, and there was nothing listening.
   *  Submitting a valid email is still the only way to complete whatever
   *  triggered the gate, but the person can now back out of it. */
  onCancel?: () => void;
}

const EmailGateDialog: React.FC<EmailGateDialogProps> = ({
  open,
  onSubmit,
  reason = 'save places',
  onCancel,
}) => {
  const [email, setEmail]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const trimmed = normalizeEmail(email);
    if (!isValidEmail(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    setSubmitting(true);
    const ok = await onSubmit(trimmed);
    setSubmitting(false);
    if (!ok) {
      setError('Something went wrong. Please try again.');
    }
    // On success the parent closes the dialog and proceeds.
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) onCancel?.(); }}
    >
      <DialogContent
        className="sm:max-w-sm"
        onPointerDownOutside={(e) => { if (!onCancel) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (!onCancel) e.preventDefault(); }}
      >
        <DialogHeader className="items-center pb-1">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2"
            style={{ background: 'hsl(152 68% 22% / 0.1)' }}
          >
            <MapPin className="w-6 h-6" style={{ color: 'hsl(152 68% 22%)' }} />
          </div>
          <DialogTitle className="text-xl font-bold text-center">
            One quick thing
          </DialogTitle>
          <DialogDescription className="text-center text-sm leading-snug">
            Enter your email to {reason}. We won't send you anything — it just
            keeps your saves linked to you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label
              htmlFor="gate-email"
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wide"
            >
              Email
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                id="gate-email"
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

        <DialogFooter className="pt-1">
          <Button
            onClick={() => void handleSubmit()}
            disabled={submitting || !isValidEmail(email)}
            className="w-full h-11 font-bold text-sm"
            style={{ background: 'hsl(152 68% 22%)' }}
          >
            {submitting ? 'Saving…' : 'Continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EmailGateDialog;