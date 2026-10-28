// "Report a problem": a visitor tells the venue's team something on the map is
// wrong, closed, blocked or unsafe. It lands in the team's Reports page
// (place_reports, migration 20261028090000). No account needed.

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { REPORT_KINDS, type ReportKind } from '@/lib/venue/trust';

export interface ReportTarget { buildingId: string; poiId?: string | null; nodeId?: string | null; name: string }

export default function ReportProblem({ target, published, onClose }: { target: ReportTarget | null; published: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => { setKind(null); setMessage(''); setContact(''); onClose(); };

  const send = async () => {
    if (!target || !kind) return;
    setBusy(true);
    // No .select(): visitors may file a report but not read reports back.
    const { error } = await supabase.from('place_reports').insert({
      building_id: target.buildingId, poi_id: target.poiId ?? null, node_id: target.nodeId ?? null, place_name: target.name.slice(0, 200),
      kind, message: message.trim().slice(0, 1000) || null, contact: contact.trim().slice(0, 200) || null,
    });
    setBusy(false);
    if (error) {
      toast.error(/place_reports|schema cache/i.test(error.message) ? "Reporting isn't available here yet — please tell staff." : error.message);
      return;
    }
    toast.success("Thanks — the venue's team will look at it.");
    close();
  };

  return (
    <Dialog open={!!target} onOpenChange={o => { if (!o) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>{target ? `About ${target.name}. ` : ''}The venue's team sees this and fixes the map.</DialogDescription>
        </DialogHeader>
        {!published ? (
          <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">This is a preview. Reports open once the venue is published.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What's wrong">
              {(Object.keys(REPORT_KINDS) as ReportKind[]).map(k => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                  className={cn('rounded-xl border p-2.5 text-left', kind === k ? 'border-primary bg-primary/10' : 'hover:bg-muted')}>
                  <span className="block text-sm font-semibold">{REPORT_KINDS[k].label}</span>
                  {REPORT_KINDS[k].hint && <span className="block text-[11px] leading-snug text-muted-foreground">{REPORT_KINDS[k].hint}</span>}
                </button>
              ))}
            </div>
            <Textarea rows={3} maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} placeholder="What did you see? (optional)" />
            <Input maxLength={200} value={contact} onChange={e => setContact(e.target.value)} placeholder="Phone or email, if you'd like an answer (optional)" />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          {published && <Button onClick={() => void send()} disabled={!kind || busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Send report</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
