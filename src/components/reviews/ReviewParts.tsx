// Pieces every review screen shares — the visitor's place page, the venue team's Reviews page,
// the business portal and the console: stars, a star picker, the rating summary and one review.

import type { ReactNode } from 'react';
import { Star, MessageSquareReply } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sinceText } from '@/lib/venue/trust';
import { ratingText, reviewsText, starCounts, type ReviewRow } from '@/lib/venue/business';

export function Stars({ value, size = 14, className }: { value: number; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-px', className)} role="img" aria-label={`${ratingText(value)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star className="absolute inset-0 text-amber-300/60" style={{ width: size, height: size }} />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className="fill-amber-400 text-amber-400" style={{ width: size, height: size }} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

export function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const words = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map(i => (
          <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i === 1 ? '' : 's'}`} onClick={() => onChange(i)}
            className="rounded-lg p-0.5 transition-transform hover:scale-110 active:scale-95">
            <Star className={cn('h-8 w-8', i <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
          </button>
        ))}
      </div>
      <span className="text-sm font-medium text-muted-foreground">{words[value] ?? ''}</span>
    </div>
  );
}

/** Big average, stars, count, and a bar per star. */
export function RatingSummary({ reviews }: { reviews: Pick<ReviewRow, 'rating'>[] }) {
  const n = reviews.length;
  const avg = n ? reviews.reduce((a, r) => a + r.rating, 0) / n : 0;
  const counts = starCounts(reviews);
  return (
    <div className="flex items-center gap-4">
      <div className="text-center">
        <p className="text-4xl font-bold leading-none tabular-nums">{n ? ratingText(avg) : '–'}</p>
        <Stars value={avg} className="mt-1.5" />
        <p className="mt-1 text-[11px] text-muted-foreground">{reviewsText(n)}</p>
      </div>
      <div className="flex-1 space-y-1">
        {counts.map(c => (
          <div key={c.stars} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="w-2 tabular-nums">{c.stars}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-amber-400" style={{ width: n ? `${(c.count / n) * 100}%` : 0 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReviewCard({ r, mine, actions, children }: { r: ReviewRow; mine?: boolean; actions?: ReactNode; children?: ReactNode }) {
  return (
    <article className={cn('space-y-2 rounded-2xl p-3', mine ? 'bg-primary/5 ring-1 ring-primary/20' : 'bg-muted/40')}>
      <div className="flex items-start gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">{r.author_name.trim()[0]?.toUpperCase() ?? '?'}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{r.author_name}{mine && <span className="ml-1.5 text-[11px] font-normal text-primary">Your review</span>}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Stars value={r.rating} size={11} /> {sinceText(r.created_at)}</p>
        </div>
        {actions}
      </div>
      {r.body && <p className="whitespace-pre-line text-sm leading-relaxed">{r.body}</p>}
      {r.status === 'hidden' && (
        <p className="rounded-lg bg-amber-100 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Hidden by Yet New{r.hidden_reason ? `: ${r.hidden_reason}` : ''}. Only you{mine ? '' : ' and the team'} can see it.
        </p>
      )}
      {r.reply_body && (
        <div className="ml-4 rounded-xl border-l-2 border-primary/40 bg-card px-3 py-2">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-primary"><MessageSquareReply className="h-3 w-3" /> Answer from {r.reply_name ?? 'the team'}</p>
          <p className="mt-0.5 whitespace-pre-line text-sm">{r.reply_body}</p>
        </div>
      )}
      {children}
    </article>
  );
}
