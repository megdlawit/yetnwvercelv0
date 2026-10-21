/**
 * DocsShell — the /doc site's frame: a slim brand bar, the guide list on the
 * left, the page in the middle and "On this page" on the right (from the
 * page's own section headings), with previous / next at the bottom.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Building2, ShieldCheck, Smartphone, Code2, ArrowLeft, ArrowRight, Menu, X, Map as MapIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem { to: string; label: string; icon: typeof BookOpen; blurb: string }
const DOC_NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Start here', items: [{ to: '/doc', label: 'Introduction', icon: BookOpen, blurb: 'What Yet New is and how the pieces fit' }] },
  {
    title: 'Guides', items: [
      { to: '/doc/institutions', label: 'For institutions', icon: Building2, blurb: 'Build, publish and share your venue map' },
      { to: '/doc/admin', label: 'For platform admins', icon: ShieldCheck, blurb: 'Run the Yet New control center' },
      { to: '/doc/visitors', label: 'For visitors', icon: Smartphone, blurb: 'Find your way with the app' },
    ],
  },
  { title: 'Developers', items: [{ to: '/doc/api', label: 'API & embeds', icon: Code2, blurb: 'Put a venue map on another site or app' }] },
];
const FLAT = DOC_NAV.flatMap(g => g.items);

/** The page's h2 sections, and the one in view. */
function useOutline(pathname: string) {
  const [items, setItems] = React.useState<{ id: string; text: string }[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  React.useEffect(() => {
    const hs = [...document.querySelectorAll<HTMLHeadingElement>('main h2[id]')];
    // The heading's own words, without its "#" link.
    setItems(hs.map(h => ({ id: h.id, text: (h.textContent ?? '').replace(/#$/, '') })));
    if (!hs.length || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => {
      const vis = es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: '-80px 0px -65% 0px' });
    hs.forEach(h => io.observe(h));
    return () => io.disconnect();
  }, [pathname]);
  return { items, active };
}

const DocsShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname, hash } = useLocation();
  const [navOpen, setNavOpen] = React.useState(false);
  const { items, active } = useOutline(pathname);
  const i = FLAT.findIndex(n => n.to === pathname);
  const prev = i > 0 ? FLAT[i - 1] : null, next = i >= 0 && i < FLAT.length - 1 ? FLAT[i + 1] : null;

  React.useEffect(() => {
    setNavOpen(false);
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);

  const nav = (
    <nav className="space-y-6">
      {DOC_NAV.map(g => (
        <div key={g.title}>
          <p className="mb-1.5 px-3 text-[10.5px] font-bold uppercase tracking-[.14em] text-moss">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map(n => {
              const on = n.to === pathname;
              return (
                <li key={n.to}>
                  <Link to={n.to} className={cn('flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] transition-colors',
                    on ? 'bg-ink text-white' : 'text-ink/80 hover:bg-ink/[.06] hover:text-ink')}>
                    <n.icon className={cn('h-4 w-4 shrink-0', on ? 'text-lime' : 'text-moss')} />
                    <span className="font-semibold">{n.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="rounded-2xl border border-ink/10 bg-pcard p-3.5">
        <p className="text-[13px] font-semibold text-ink">Need a hand?</p>
        <p className="mt-0.5 text-xs leading-relaxed text-sub">Your venue's dashboard has a guided tour, and the map editor's assistant answers questions about your map.</p>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-paper font-inter text-ink">
      {/* Brand bar */}
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 lg:px-6">
          <button className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink/[.06] lg:hidden" onClick={() => setNavOpen(o => !o)} aria-label="Toggle navigation">
            {navOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link to="/doc" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-ink text-lime"><MapIcon className="h-4 w-4" /></span>
            <span className="font-bricolage text-[17px] font-bold">Yet New <span className="font-medium text-sub">Docs</span></span>
          </Link>
          <div className="ml-auto flex items-center gap-1.5 text-sm">
            <Link to="/" className="hidden rounded-full px-3 py-1.5 font-medium text-ink/75 hover:bg-ink/[.06] sm:block">Home</Link>
            <Link to="/dashboard" className="hidden rounded-full px-3 py-1.5 font-medium text-ink/75 hover:bg-ink/[.06] sm:block">Dashboard</Link>
            <Link to="/login" className="rounded-full bg-ink px-3.5 py-1.5 font-semibold text-white">Sign in</Link>
          </div>
        </div>
      </header>

      {navOpen && <div className="fixed inset-x-0 bottom-0 top-14 z-30 overflow-y-auto bg-paper px-4 py-5 lg:hidden">{nav}</div>}

      <div className="mx-auto flex max-w-[1400px] gap-10 px-4 lg:px-6">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto py-8 lg:block">{nav}</aside>

        <main className="min-w-0 flex-1 py-10 lg:py-12">
          <div className="max-w-3xl">
            {children}
            {(prev || next) && (
              <div className="mt-16 grid gap-3 border-t border-ink/10 pt-6 sm:grid-cols-2">
                {prev ? (
                  <Link to={prev.to} className="group rounded-2xl border border-ink/10 bg-pcard p-4 transition-colors hover:border-ink/25">
                    <span className="flex items-center gap-1 text-xs text-sub"><ArrowLeft className="h-3.5 w-3.5" /> Previous</span>
                    <span className="mt-1 block font-semibold">{prev.label}</span>
                  </Link>
                ) : <span />}
                {next && (
                  <Link to={next.to} className="group rounded-2xl border border-ink/10 bg-pcard p-4 text-right transition-colors hover:border-ink/25">
                    <span className="flex items-center justify-end gap-1 text-xs text-sub">Next <ArrowRight className="h-3.5 w-3.5" /></span>
                    <span className="mt-1 block font-semibold">{next.label}</span>
                  </Link>
                )}
              </div>
            )}
          </div>
        </main>

        {items.length > 1 && (
          <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto py-12 xl:block">
            <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[.14em] text-moss">On this page</p>
            <ul className="space-y-1 border-l border-ink/10">
              {items.map(it => (
                <li key={it.id}>
                  <a href={`#${it.id}`} className={cn('-ml-px block border-l-2 py-1 pl-3 text-[13px] leading-snug transition-colors',
                    active === it.id ? 'border-lime font-semibold text-ink' : 'border-transparent text-sub hover:text-ink')}>{it.text}</a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
};

export default DocsShell;
