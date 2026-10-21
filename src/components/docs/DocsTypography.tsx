/**
 * DocsTypography — the /doc site's building blocks. Plain TSX components (no
 * MDX pipeline), in the Yet New look: forest-green ink on paper, bright-green
 * accents, Bricolage headings.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Info, AlertTriangle, CheckCircle2, Lightbulb, ChevronDown, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export const DocsEyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mb-2 text-[11px] font-bold uppercase tracking-[.16em] text-moss">{children}</p>
);

export const DocsTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h1 className="font-bricolage text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[40px]">{children}</h1>
);

export const DocsDescription: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mb-10 mt-3 text-[17px] leading-relaxed text-sub">{children}</p>
);

export const DocsH2: React.FC<{ children: React.ReactNode; id?: string }> = ({ children, id }) => (
  <h2 id={id} className="group mb-3 mt-14 scroll-mt-20 font-bricolage text-[24px] font-bold tracking-[-0.01em] text-ink">
    {children}
    {id && <a href={`#${id}`} className="ml-2 text-lime opacity-0 transition-opacity group-hover:opacity-100" aria-label="Link to this section">#</a>}
  </h2>
);

export const DocsH3: React.FC<{ children: React.ReactNode; id?: string }> = ({ children, id }) => (
  <h3 id={id} className="mb-2 mt-8 scroll-mt-20 text-[17px] font-bold text-ink">{children}</h3>
);

export const DocsP: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mb-4 text-[15px] leading-[1.7] text-ink/85">{children}</p>
);

export const DocsInlineCode: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="rounded-md border border-ink/10 bg-ink/[.05] px-1.5 py-0.5 font-mono text-[13px] text-ink">{children}</code>
);

export const DocsKbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="rounded-md border border-ink/15 border-b-2 bg-pcard px-1.5 py-0.5 font-mono text-[12px] text-ink">{children}</kbd>
);

export const DocsList: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="mb-5 space-y-2 pl-1">{children}</ul>
);

export const DocsListItem: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex gap-3 text-[15px] leading-[1.65] text-ink/85">
    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
    <span>{children}</span>
  </li>
);

/** Numbered steps. */
export const DocsSteps: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ol className="mb-6 space-y-0 [counter-reset:step]">{children}</ol>
);
export const DocsStep: React.FC<{ title: React.ReactNode; children?: React.ReactNode }> = ({ title, children }) => (
  <li className="relative pb-5 pl-11 [counter-increment:step] before:absolute before:left-0 before:top-0 before:grid before:h-7 before:w-7 before:place-items-center before:rounded-full before:bg-ink before:text-[13px] before:font-bold before:text-lime before:content-[counter(step)] after:absolute after:bottom-1 after:left-[13px] after:top-9 after:w-px after:bg-ink/15 last:after:hidden">
    <p className="pt-0.5 text-[15px] font-semibold text-ink">{title}</p>
    {children && <div className="mt-1 text-[14.5px] leading-[1.65] text-ink/80 [&_p]:mb-2">{children}</div>}
  </li>
);

export const DocsCodeBlock: React.FC<{ children: string; language?: string }> = ({ children, language }) => (
  <div className="mb-5 overflow-hidden rounded-2xl bg-[#0c2a1b] shadow-[0_10px_30px_rgba(15,61,38,.18)]">
    {language && <div className="border-b border-white/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-lime/80">{language}</div>}
    <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed text-[#e9f3ea]"><code>{children.trim()}</code></pre>
  </div>
);

type CalloutTone = 'info' | 'warning' | 'success' | 'tip';
const CALLOUT: Record<CalloutTone, { icon: typeof Info; box: string; icon2: string }> = {
  info:    { icon: Info,          box: 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30', icon2: 'text-sky-700' },
  warning: { icon: AlertTriangle, box: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30', icon2: 'text-amber-700' },
  success: { icon: CheckCircle2,  box: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30', icon2: 'text-emerald-700' },
  tip:     { icon: Lightbulb,     box: 'border-lime/40 bg-lime/10', icon2: 'text-moss' },
};

export const DocsCallout: React.FC<{ tone?: CalloutTone; title?: string; children: React.ReactNode }> = ({ tone = 'info', title, children }) => {
  const m = CALLOUT[tone];
  return (
    <div className={cn('mb-5 flex gap-3 rounded-2xl border p-4', m.box)}>
      <m.icon className={cn('mt-0.5 h-[18px] w-[18px] shrink-0', m.icon2)} />
      <div className="min-w-0 text-[14.5px] leading-relaxed text-ink/85 [&_ul]:mb-0">
        {title && <p className="mb-1 font-bold text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
};

export const DocsTable: React.FC<{ headers: string[]; rows: React.ReactNode[][] }> = ({ headers, rows }) => (
  <div className="mb-6 overflow-x-auto rounded-2xl border border-ink/10 bg-pcard">
    <table className="w-full border-collapse text-[14px]">
      <thead>
        <tr className="bg-ink/[.04]">
          {headers.map(h => <th key={h} className="border-b border-ink/10 px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-sub">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={i > 0 ? 'border-t border-ink/[.07]' : undefined}>
            {row.map((cell, j) => <td key={j} className={cn('px-4 py-2.5 align-top leading-relaxed text-ink/85', j === 0 && 'font-medium text-ink')}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** A grid of linked cards. */
export const DocsCards: React.FC<{ children: React.ReactNode; cols?: 2 | 3 }> = ({ children, cols = 2 }) => (
  <div className={cn('mb-8 grid gap-3', cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>{children}</div>
);
export const DocsCard: React.FC<{ to?: string; icon?: React.ElementType; title: string; children: React.ReactNode }> = ({ to, icon: Icon, title, children }) => {
  const body = (
    <>
      {Icon && <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-ink text-lime"><Icon className="h-5 w-5" /></span>}
      <p className="flex items-center gap-1 font-semibold text-ink">{title}{to && <ArrowRight className="h-4 w-4 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />}</p>
      <p className="mt-1 text-[13.5px] leading-relaxed text-sub">{children}</p>
    </>
  );
  const cls = 'group block rounded-2xl border border-ink/10 bg-pcard p-4 transition-all';
  return to ? <Link to={to} className={cn(cls, 'hover:-translate-y-0.5 hover:border-ink/25 hover:shadow-[0_12px_30px_rgba(15,61,38,.10)]')}>{body}</Link> : <div className={cls}>{body}</div>;
};

/** A collapsible question. */
export const DocsFaq: React.FC<{ q: string; children: React.ReactNode }> = ({ q, children }) => (
  <details className="group mb-2 rounded-2xl border border-ink/10 bg-pcard px-4 py-3 open:pb-4">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
      {q}<ChevronDown className="h-4 w-4 shrink-0 text-sub transition-transform group-open:rotate-180" />
    </summary>
    <div className="mt-2 text-[14.5px] leading-relaxed text-ink/80 [&_p]:mb-2">{children}</div>
  </details>
);

/** A row of plain-word "→" stages. */
export const DocsFlow: React.FC<{ steps: { title: string; text: string }[] }> = ({ steps }) => (
  <div className="mb-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
    {steps.map((s, i) => (
      <div key={s.title} className="relative rounded-2xl border border-ink/10 bg-pcard p-4">
        <span className="text-[11px] font-bold text-moss">0{i + 1}</span>
        <p className="mt-1 font-semibold text-ink">{s.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-sub">{s.text}</p>
      </div>
    ))}
  </div>
);

export const DocsSection: React.FC<{ children: React.ReactNode }> = ({ children }) => <div>{children}</div>;
