// A business place's own details on its page (business plan §18): how to reach it, prices,
// amenities, and who manages the listing. Visitors contact the business directly — Yet New
// takes no bookings or payments. An unclaimed business place invites its owner to claim it.

import { Link } from 'react-router-dom';
import { Phone, MessageCircle, Globe, Mail, BadgeCheck, Store, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AMENITIES, PRICE_RANGES, mailHref, telHref, websiteHref, websiteLabel, whatsappHref, type BusinessInfo,
} from '@/lib/venue/business';

export default function PlaceBusiness({ info, poiId, claimable }: {
  info: BusinessInfo | null | undefined; poiId?: string;
  /** A business place nobody manages yet, in a published venue. */
  claimable: boolean;
}) {
  const tel = telHref(info?.phone), wa = whatsappHref(info?.whatsapp ?? null), web = websiteHref(info?.website), mail = mailHref(info?.email);
  const contacts = [
    tel && { href: tel, label: 'Call', icon: Phone, cls: 'bg-emerald-600 text-white hover:bg-emerald-700' },
    wa && { href: wa, label: 'WhatsApp', icon: MessageCircle, cls: 'bg-[#25D366] text-white hover:brightness-95' },
    web && { href: web, label: websiteLabel(web), icon: Globe, cls: 'bg-muted hover:bg-muted/70' },
    mail && { href: mail, label: 'Email', icon: Mail, cls: 'bg-muted hover:bg-muted/70' },
  ].filter((c): c is { href: string; label: string; icon: typeof Phone; cls: string } => !!c);

  if (info) {
    return (
      <div className="space-y-3">
        {contacts.length > 0 && (
          <div className={cn('grid gap-2', contacts.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
            {contacts.map(c => (
              <a key={c.label} href={c.href} target={c.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
                className={cn('flex min-w-0 items-center justify-center gap-1.5 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors', c.cls)}>
                <c.icon className="h-4 w-4 shrink-0" /> <span className="truncate">{c.label}</span>
              </a>
            ))}
          </div>
        )}
        {info.about && <p className="whitespace-pre-line text-[15px] leading-relaxed">{info.about}</p>}
        {(info.priceRange || info.priceNote || info.bookingNote) && (
          <div className="flex gap-3 rounded-2xl bg-muted/50 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="space-y-0.5 text-sm">
              {info.priceRange && <p className="font-semibold">{info.priceRange} <span className="font-normal text-muted-foreground">· {PRICE_RANGES[info.priceRange]}</span></p>}
              {info.priceNote && <p className="text-xs text-muted-foreground">{info.priceNote}</p>}
              {info.bookingNote && <p className="text-xs text-muted-foreground">{info.bookingNote}</p>}
            </div>
          </div>
        )}
        {info.amenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {info.amenities.map(a => <span key={a} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{AMENITIES[a]}</span>)}
          </div>
        )}
        {info.claimed && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" /> Details kept up to date by the business itself
          </p>
        )}
        {!info.claimed && claimable && poiId && <ClaimLink poiId={poiId} />}
      </div>
    );
  } else if (claimable && poiId) {
    return <ClaimLink poiId={poiId} />;
  } else {
    return null;
  }
}

function ClaimLink({ poiId }: { poiId: string }) {
  return (
    <Link to={`/business?claim=${encodeURIComponent(poiId)}`}
      className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline">
      <Store className="h-3.5 w-3.5" /> Is this your business? Manage it on Yet New Business
    </Link>
  );
}
