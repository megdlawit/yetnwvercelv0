// View Map: the visitor experience, live, inside the dashboard — on a
// desktop or phone-sized screen. Shows your latest edits (preview).

import { useState } from 'react';
import { Monitor, Smartphone, ExternalLink, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import { PageHeader } from './ui';

export default function ViewMapPage() {
  const { previewUrl, data } = useDashboard();
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [nonce, setNonce] = useState(0);
  return (
    <>
      <PageHeader title="View Map" description={`Your venue as visitors experience it — including changes you haven't published yet${data.unpublished ? ` (${data.unpublished})` : ''}.`}
        actions={<>
          <div className="flex rounded-xl bg-muted p-0.5">
            {([['desktop', Monitor], ['phone', Smartphone]] as const).map(([d, Icon]) => (
              <button key={d} onClick={() => setDevice(d)} aria-pressed={device === d} className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold capitalize', device === d ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
                <Icon className="h-3.5 w-3.5" /> {d}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={() => setNonce(n => n + 1)} aria-label="Reload"><RotateCw className="h-4 w-4" /></Button>
          <Button variant="outline" asChild><a href={previewUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" /> Open in new tab</a></Button>
        </>} />
      <div className={cn('mx-auto overflow-hidden bg-card shadow-lg', device === 'phone' ? 'h-[720px] w-[380px] rounded-[2.5rem] border-[12px] border-neutral-900' : 'h-[calc(100dvh-220px)] min-h-[520px] w-full rounded-3xl border')}>
        <iframe key={nonce} title="Visitor experience" src={previewUrl} className="h-full w-full border-0" />
      </div>
    </>
  );
}
