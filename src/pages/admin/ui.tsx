// The control center's building blocks, in the institution dashboard's style: the same
// page titles, rounded panels, soft icon tiles, status chips and buttons, so the platform
// console and an institution's dashboard feel like one product.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, MoreHorizontal, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** A page: title, one line under it, and its main actions on the right. */
export function Page({ title, subtitle, actions, children }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-1 max-w-2xl text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** A panel, like the dashboard's: rounded card with an optional title row; rows inside get dividers. */
export function Group({ title, icon: Icon, action, footer, children, className, flush = false }: {
  title?: ReactNode; icon?: typeof Search; action?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string;
  /** No row dividers — for tables and custom content. */
  flush?: boolean;
}) {
  return (
    <section className={cn('overflow-hidden rounded-3xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]', className)}>
      {title || action ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">{Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}{title}</h2>
          {action}
        </div>
      ) : null}
      <div className={cn(flush ? '' : 'divide-y', title || action ? 'border-t' : '')}>{children}</div>
      {footer ? <p className="border-t px-5 py-3 text-xs text-muted-foreground">{footer}</p> : null}
    </section>
  );
}

/** One row of a panel. Pass `to` or `onClick` to make the whole row clickable (with a chevron). */
export function Row({ leading, title, subtitle, detail, trailing, to, onClick, chevron, wrap = false }: {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; detail?: ReactNode; trailing?: ReactNode;
  to?: string; onClick?: () => void; chevron?: boolean;
  /** Let a long title wrap instead of cutting it off. */
  wrap?: boolean;
}) {
  const showChevron = chevron ?? !!(to || onClick);
  const body = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-semibold', wrap ? '' : 'truncate')}>{title}</span>
        {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
        {detail ? <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
      {showChevron ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
    </>
  );
  const cls = 'flex w-full items-center gap-3 px-5 py-3 text-left';
  if (to) {
    return <Link to={to} className={cn(cls, 'transition-colors hover:bg-muted/40')}>{body}</Link>;
  } else if (onClick) {
    return <button type="button" onClick={onClick} className={cn(cls, 'transition-colors hover:bg-muted/40')}>{body}</button>;
  } else {
    return <div className={cn(cls, 'hover:bg-muted/40')}>{body}</div>;
  }
}

type Tone = 'primary' | 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray' | 'teal' | 'indigo';
const TONE_SOFT: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  blue: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  orange: 'bg-amber-400/20 text-amber-700 dark:text-amber-300',
  red: 'bg-red-500/10 text-red-700 dark:text-red-300',
  purple: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  gray: 'bg-muted text-muted-foreground',
  teal: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
  indigo: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
};

/** A soft rounded square with an icon in it, like the dashboard's shortcuts. */
export function IconTile({ icon: Icon, tone = 'primary', size = 36 }: { icon: typeof Search; tone?: Tone; size?: number }) {
  return (
    <span className={cn('grid place-items-center rounded-xl', TONE_SOFT[tone])} style={{ width: size, height: size }}>
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

/** A status chip with a dot: Live, Draft, Waiting… */
export function Pill({ tone = 'gray', children }: { tone?: 'gray' | 'green' | 'blue' | 'orange' | 'red' | 'purple'; children: ReactNode }) {
  const cls = {
    gray: 'bg-muted text-muted-foreground',
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    blue: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
    orange: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    purple: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  }[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{children}
    </span>
  );
}

/** A count badge, like the dashboard's unpublished-changes badge. */
export function Count({ n, attention = false }: { n: number; attention?: boolean }) {
  return (
    <span className={cn('rounded-full px-1.5 text-[11px] font-bold tabular-nums',
      attention ? 'bg-amber-400 text-amber-950' : 'bg-muted text-muted-foreground')}>{n}</span>
  );
}

/** A small switch between views, like the dashboard's World / 2D / 3D toggle. */
export function Segmented<T extends string | number>({ value, onChange, options, label }: {
  value: T; onChange: (v: NoInfer<T>) => void; options: readonly (readonly [NoInfer<T>, ReactNode])[]; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex max-w-full overflow-x-auto rounded-xl bg-muted p-0.5">
      {options.map(([v, text]) => {
        const on = v === value;
        return (
          <button key={String(v)} type="button" onClick={() => onChange(v)} aria-pressed={on}
            className={cn('shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
              on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** A search box. */
export function SearchField({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={cn('flex h-9 items-center gap-2 rounded-xl border bg-card px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring', className)}>
      <Search className="h-4 w-4 shrink-0" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
    </label>
  );
}

/** Filters (left) and search (right) above a list. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3">{children}</div>;
}

/** A number card: icon tile, big number, label. */
export function Metric({ label, value, caption, icon, onClick, attention = false }: {
  label: string; value: ReactNode; caption?: ReactNode; icon?: typeof Search; onClick?: () => void; attention?: boolean;
}) {
  const inner = (
    <>
      {icon ? <IconTile icon={icon} tone={attention ? 'orange' : 'primary'} /> : null}
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-none tabular-nums">{value}</span>
        <span className="mt-1 block text-xs font-medium text-muted-foreground">{label}</span>
        {caption ? <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{caption}</span> : null}
      </span>
    </>
  );
  const cls = cn('flex w-full items-start gap-3 rounded-2xl border bg-card p-4 text-left',
    attention && 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20');
  if (onClick) {
    return <button type="button" onClick={onClick} className={cn(cls, 'transition-colors hover:border-primary/40 hover:bg-primary/5')}>{inner}</button>;
  } else {
    return <div className={cls}>{inner}</div>;
  }
}

/** The ••• button that holds a row's less common actions. */
export function MoreMenu({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={label} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {title ? <DropdownMenuLabel className="truncate">{title}</DropdownMenuLabel> : null}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A quiet button (Preview, Decline). */
export function PlainButton({ children, onClick, disabled, tone = 'primary', href }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'primary' | 'red' | 'gray'; href?: string;
}) {
  const cls = cn('h-9 rounded-xl', tone === 'red' ? 'text-destructive hover:bg-destructive/10 hover:text-destructive' : tone === 'gray' ? 'text-muted-foreground' : '');
  if (href) {
    return <Button variant="ghost" size="sm" asChild className={cls}><a href={href} target="_blank" rel="noreferrer">{children}</a></Button>;
  } else {
    return <Button variant={tone === 'red' ? 'ghost' : 'outline'} size="sm" onClick={onClick} disabled={disabled} className={cls}>{children}</Button>;
  }
}

/** The one main action on a row (Approve, Publish). */
export function FilledButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <Button size="sm" onClick={onClick} disabled={disabled} className="h-9 rounded-xl">{children}</Button>;
}

/** Recent changes grouped by day, on a thin line — the same timeline as the dashboard home. */
export function Timeline({ groups }: { groups: { day: string; items: { id: string | number; icon: typeof Search; text: ReactNode; meta: ReactNode }[] }[] }) {
  return (
    <div className="space-y-4">
      {groups.map(g => (
        <div key={g.day}>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.day}</p>
          <ol className="relative space-y-3 border-l pl-5">
            {g.items.map(a => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[31px] grid h-5 w-5 place-items-center rounded-full border bg-card"><a.icon className="h-3 w-3 text-primary" /></span>
                <p className="text-sm">{a.text}</p>
                <p className="text-[11px] text-muted-foreground">{a.meta}</p>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
