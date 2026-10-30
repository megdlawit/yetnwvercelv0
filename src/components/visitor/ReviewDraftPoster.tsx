// Posts a review the visitor wrote before confirming their email, once they're back signed in —
// wherever the sign-in link landed them. Renders nothing.

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { clearReviewDraft, loadReviewDraft, postReview } from '@/lib/visitor/reviewDraft';
import { REVIEW_POSTED } from './PlaceReviews';

export default function ReviewDraftPoster() {
  const posting = useRef(false);

  useEffect(() => {
    const tryPost = async () => {
      const draft = loadReviewDraft();
      const { data } = await supabase.auth.getSession();
      if (draft && data.session && !posting.current) {
        posting.current = true;
        const error = await postReview(draft);
        // Posted or refused, the draft has done its job: no retry loop on every page.
        clearReviewDraft();
        posting.current = false;
        if (error) {
          toast.error(`Your review of ${draft.placeName} couldn't be posted: ${error}`);
        } else {
          toast.success(`Thanks — your review of ${draft.placeName} is posted`);
          window.dispatchEvent(new Event(REVIEW_POSTED));
        }
      } else {
        // nothing waiting, or not signed in yet
      }
    };
    void tryPost();
    const { data: sub } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN') {
        void tryPost();
      } else {
        // other auth events don't post anything
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return null;
}
