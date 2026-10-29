// Answering reviews — for the business that manages a place and for the venue's team: a sheet
// with a place's reviews, and the answer box under each. Answers are public and signed with the
// business's or institution's name; only Yet New removes a review (business plan §21).

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Star } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { ReviewRow } from '@/lib/venue/business';
import { RatingSummary, ReviewCard } from './ReviewParts';

const Spinner = () => <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
const fail = (e: { message: string } | null | undefined) => toast.error(e?.message ?? 'Something went wrong');

/** A place's reviews with an answer box under each (also used by the venue team's Reviews page). */
export function ReviewsSheet({ place, editable, onClose }: { place: { poi_id: string; place_name: string } | null; editable: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const load = useCallback(async () => {
    if (place) {
      const { data } = await supabase.from('place_reviews').select('*').eq('poi_id', place.poi_id).order('created_at', { ascending: false }).limit(200);
      setRows(data ?? []);
    } else {
      setRows(null);
    }
  }, [place]);
  useEffect(() => { void load(); }, [load]);
  const visible = (rows ?? []).filter(r => r.status === 'visible');
  return (
    <Sheet open={!!place} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Star className="h-4 w-4 text-amber-500" /> Reviews of {place?.place_name}</SheetTitle>
          <SheetDescription>Thank people, answer questions, explain what you changed. Your answer shows under the review, with your name. Only Yet New can remove a review.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 py-5">
          {rows === null ? <Spinner /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No reviews yet.</p> : (
            <>
              {visible.length > 0 && <RatingSummary reviews={visible} />}
              {rows.map(r => <ReviewCard key={r.id} r={r}>{editable && r.status === 'visible' && <AnswerBox r={r} onSaved={() => void load()} />}</ReviewCard>)}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AnswerBox({ r, onSaved }: { r: ReviewRow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(r.reply_body ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('reply_to_review', { review: r.id, reply: value });
    setBusy(false);
    if (error) { fail(error); } else { toast.success(value.trim() ? 'Answer posted' : 'Answer removed'); setOpen(false); onSaved(); }
  };
  if (open) {
    return (
      <div className="space-y-2">
        <Textarea rows={3} maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="Your answer, shown publicly under the review" />
        <div className="flex justify-end gap-2">
          {r.reply_body && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save('')}>Remove answer</Button>}
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" disabled={busy || !text.trim()} onClick={() => void save(text)}>{busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Post answer</Button>
        </div>
      </div>
    );
  } else {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-semibold text-primary hover:underline">
        {r.reply_body ? 'Edit your answer' : 'Answer'}
      </button>
    );
  }
}
