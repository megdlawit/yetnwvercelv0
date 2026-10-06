// The frame around sign-in and sign-up: the Yet New story on the left
// (desktop), the form on the right.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Map, Box, MapPin, Newspaper, Users, ArrowLeft } from 'lucide-react';

const STEPS = [
  { icon: Map, label: 'Your map' },
  { icon: Box, label: '3D world' },
  { icon: MapPin, label: 'Places' },
  { icon: Newspaper, label: 'Content' },
  { icon: Users, label: 'Visitors' },
];

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-black tracking-tight ${className}`}>
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-[hsl(133_60%_48%)] text-white shadow-[0_6px_18px_-6px_hsl(133_60%_30%/0.7)]">
        <Box className="h-4 w-4" />
      </span>
      Yet New
    </span>
  );
}

export default function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex bg-background">
      <aside className="hidden lg:flex lg:w-[46%] relative overflow-hidden flex-col justify-between p-12 text-white" style={{ background: 'hsl(152 70% 22%)' }}>
        <div className="pointer-events-none absolute -top-24 -right-16 h-96 w-96 rounded-full blur-3xl opacity-30" style={{ background: 'hsl(133 60% 48%)' }} />
        <div className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 -translate-x-1/3 translate-y-1/3 rounded-full blur-3xl opacity-20" style={{ background: 'hsl(133 60% 48%)' }} />
        <Logo className="relative text-xl" />
        <div className="relative max-w-md">
          <h1 className="text-4xl font-black leading-[1.1] tracking-tight">Bring the map you already have.</h1>
          <p className="mt-3 text-lg text-white/75">Yet New turns it into a digital world your visitors can explore.</p>
          <ol className="mt-10 flex flex-wrap items-center gap-2">
            {STEPS.map((s, i) => (
              <li key={s.label} className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold"><s.icon className="h-3.5 w-3.5" /> {s.label}</span>
                {i < STEPS.length - 1 && <span className="text-white/40">→</span>}
              </li>
            ))}
          </ol>
        </div>
        <Link to="/" className="relative flex w-fit items-center gap-2 text-xs font-semibold text-white/60 hover:text-white"><ArrowLeft className="h-4 w-4" /> Visitor app</Link>
      </aside>

      <main className="flex flex-1 flex-col">
        <div className="lg:hidden px-5 pt-6"><Logo className="text-lg" /></div>
        <div className="flex flex-1 items-center justify-center px-5 py-10">
          <div className="w-full max-w-sm">
            <h2 className="text-2xl font-black tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            <div className="mt-7">{children}</div>
            {footer && <div className="mt-8 text-center text-sm text-muted-foreground">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}

export const FIELD_CLS = 'w-full h-12 rounded-2xl px-4 text-sm font-medium bg-secondary/60 border border-border/60 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow';
