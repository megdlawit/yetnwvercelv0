// Visitor reviews on a place's page (business plan §21): the rating, what visitors wrote and the
// answers, and writing your own. Writing needs a confirmed email — one sign-in link, then the
// review posts itself — so ratings come from real people. Reviews are visitor opinions and are
// labelled so, apart from the venue's official information.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Flag, Loader2, MailCheck, MessageSquarePlus, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isValidEmail } from '@/lib/validation';
import { REVIEW_MAX, REVIEW_NAME_MAX, reviewProblem, type ReviewRow } from '@/lib/venue/business';
import { postReview, saveReviewDraft, sendReviewLink, startVisitorSession } from '@/lib/visitor/reviewDraft';
import { RatingSummary, ReviewCard, StarPicker } from '@/components/reviews/ReviewParts';

/** Fired when a review is posted anywhere (also by the draft poster after a sign-in link). */
export const REVIEW_POSTED = 'yetnew-review-posted';
const PAGE = 20;

function guestId(): string {
  try {
    const id = localStorage.getItem('ethi_guest_id') ?? crypto.randomUUID();
    localStorage.setItem('ethi_guest_id', id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export default function PlaceReviews({ poiId, venueId, placeName, published, previewing = false, onChanged }: {
  poiId: string; venueId: string; placeName: string; published: boolean;
  /** The venue's team on its preview: reviews show, but the team doesn't review its own places. */
  previewing?: boolean; onChanged?: () => void;
}) {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [missing, setMissing] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const load = useCallback(async () => {
    const [{ data: auth }, res] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('place_reviews').select('*').eq('poi_id', poiId).order('created_at', { ascending: false }).limit(200),
    ]);
    setMe(auth.user?.id ?? null);
    setMissing(!!res.error && /place_reviews|schema cache|does not exist/i.test(res.error.message));
    setRows(res.data ?? []);
  }, [poiId]);

  useEffect(() => { setRows(null); setLimit(PAGE); void load(); }, [load]);
  useEffect(() => {
    const again = () => { void load(); onChanged?.(); };
    window.addEventListener(REVIEW_POSTED, again);
    return () => window.removeEventListener(REVIEW_POSTED, again);
  }, [load, onChanged]);

  const visible = (rows ?? []).filter(r => r.status === 'visible');
  const mine = (rows ?? []).find(r => r.user_id === me) ?? null;
  const others = (rows ?? []).filter(r => r !== mine && r.status === 'visible');

  const flag = async (r: ReviewRow) => {
    const { error } = await supabase.rpc('flag_review', { review: r.id, flagger: guestId(), reason: null });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Thanks — Yet New will look at this review.');
    }
  };

  if (missing || !published) {
    return null;
  } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return <p className="rounded-2xl bg-muted/40 p-3 text-center text-xs text-muted-foreground">Visitor reviews show when you're back online.</p>;
  } else {
    return (
      <section className="space-y-3" aria-label="Visitor reviews">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Visitor reviews</p>
          {previewing ? (
            <span className="text-[11px] text-muted-foreground">Answer them in your dashboard → Reviews</span>
          ) : (
            <Button size="sm" variant={mine ? 'ghost' : 'outline'} className="h-8 rounded-full" onClick={() => setWriting(true)}>
              {mine ? <><Pencil className="mr-1 h-3.5 w-3.5" /> Edit yours</> : <><MessageSquarePlus className="mr-1 h-3.5 w-3.5" /> Write a review</>}
            </Button>
          )}
        </div>
        {rows === null ? (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="rounded-2xl bg-muted/40 p-3 text-center text-sm text-muted-foreground">No reviews yet. Been here? Be the first to say how it was.</p>
        ) : (
          <>
            {visible.length > 0 && <RatingSummary reviews={visible} />}
            {mine && <ReviewCard r={mine} mine />}
            {others.slice(0, limit).map(r => (
              <ReviewCard key={r.id} r={r} actions={
                <button onClick={() => void flag(r)} className="rounded-lg p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground" title="Report this review" aria-label="Report this review">
                  <Flag className="h-3.5 w-3.5" />
                </button>
              } />
            ))}
            {others.length > limit && <Button variant="ghost" size="sm" className="w-full" onClick={() => setLimit(l => l + PAGE)}>Show more reviews</Button>}
          </>
        )}
        <p className="text-[11px] text-muted-foreground">Reviews are visitors' own opinions, not checked by Yet New or the venue.</p>
        <WriteReview open={writing} onClose={() => setWriting(false)} poiId={poiId} venueId={venueId} placeName={placeName} signedIn={!!me} existing={mine}
          onPosted={() => { setWriting(false); void load(); onChanged?.(); }} />
      </section>
    );
  }
}

function WriteReview({ open, onClose, poiId, venueId, placeName, signedIn, existing, onPosted }: {
  open: boolean; onClose: () => void; poiId: string; venueId: string; placeName: string; signedIn: boolean; existing: ReviewRow | null; onPosted: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // Only when a quiet visitor session isn't available: confirm an email instead.
  const [needEmail, setNeedEmail] = useState(false);

  useEffect(() => {
    if (open) {
      setRating(existing?.rating ?? 0); setBody(existing?.body ?? ''); setName(existing?.author_name ?? ''); setSent(false);
    } else {
      // closed: keep what was typed until it opens again
    }
  }, [open, existing]);

  const problem = reviewProblem(rating, name, body);
  const post = async () => {
    const e = await postReview({ poiId, venueId, rating, body, authorName: name });
    setBusy(false);
    if (e) {
      toast.error(e);
    } else {
      toast.success(existing ? 'Your review is updated' : 'Thanks — your review is posted');
      onPosted();
    }
  };
  const submit = async () => {
    setBusy(true);
    if (signedIn) {
      await post();
    } else if (!needEmail) {
      if (await startVisitorSession()) {
        await post();
      } else {
        setBusy(false);
        setNeedEmail(true);
      }
    } else if (!isValidEmail(email.trim())) {
      setBusy(false);
      toast.error('Please enter a valid email address.');
    } else {
      saveReviewDraft({ poiId, venueId, placeName, rating, body, authorName: name });
      const e = await sendReviewLink(email, venueId, poiId);
      setBusy(false);
      if (e) {
        toast.error(/rate limit/i.test(e) ? 'Too many emails were sent just now. Please try again in a few minutes.' : e);
      } else {
        setSent(true);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit your review' : `Review ${placeName}`}</DialogTitle>
          <DialogDescription>Your first name, stars and words are shown to everyone.</DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <MailCheck className="h-10 w-10 text-primary" />
            <p className="font-semibold">Check your email</p>
            <p className="max-w-xs text-sm text-muted-foreground">Open the link we sent to {email.trim()} on this device. Your review posts as soon as you're back — it's saved here meanwhile.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <StarPicker value={rating} onChange={setRating} />
            <Textarea rows={4} maxLength={REVIEW_MAX} value={body} onChange={e => setBody(e.target.value)} placeholder="What was it like? (optional)" />
            <Input maxLength={REVIEW_NAME_MAX} value={name} onChange={e => setName(e.target.value)} placeholder="Your name, as shown (e.g. Hana)" aria-label="Your name" />
            {!signedIn && needEmail && (
              <div className="space-y-1">
                <Input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Your email" aria-label="Your email" />
                <p className="text-[11px] text-muted-foreground">We'll send a sign-in link once to confirm it's you. After that you can review straight away.</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{sent ? 'Close' : 'Cancel'}</Button>
          {!sent && (
            <Button onClick={() => void submit()} disabled={!!problem || busy} title={problem ?? undefined}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{signedIn || !needEmail ? (existing ? 'Save' : 'Post review') : 'Send link & post'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
