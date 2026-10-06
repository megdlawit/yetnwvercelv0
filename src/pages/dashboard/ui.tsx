// Building blocks shared by the dashboard pages.

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 print:hidden">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, icon: Icon, action, children, className, bodyClassName, tour }: {
  title?: ReactNode; icon?: typeof import('lucide-react').Map; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
  /** Marks this panel for the guided tour. */
  tour?: string;
}) {
  return (
    <section data-tour={tour} className={cn('overflow-hidden rounded-3xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]', className)}>
      {title && (
        <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">{Icon && <Icon className="h-4 w-4 text-muted-foreground" />}{title}</h2>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return <span className={cn('inline-block h-2 w-2 rounded-full', ok ? 'bg-emerald-500' : warn ? 'bg-amber-500' : 'bg-muted-foreground/40')} />;
}
