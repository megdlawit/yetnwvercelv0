import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Code2 } from 'lucide-react';
import DocsShell from '@/components/docs/DocsShell';
import { admin } from '@/components/admin/adminTheme';
import {
  DocsTitle, DocsDescription, DocsH2, DocsP, DocsList, DocsListItem,
  DocsInlineCode, DocsSection,
} from '@/components/docs/DocsTypography';

const CARDS = [
  { to: '/doc/admin', icon: ShieldCheck, title: 'Admin Guide', desc: 'Manage buildings, POIs, walking paths, layers, and commerce.' },
  { to: '/doc/api', icon: Code2, title: 'API & SDK', desc: 'Embed the venue map elsewhere — iframe, script tag, or React — with a partner API key.' },
];

const DocsIntro: React.FC = () => (
  <DocsShell>
    <DocsSection>
      <DocsTitle>Introduction</DocsTitle>
      <DocsDescription>
        Getting started with Unity Park Navigator
      </DocsDescription>

      <DocsP>
        Welcome! Unity Park Navigator is the indoor + outdoor wayfinding
        platform behind this map — building &amp; floor management, POIs and
        promotions, curated walking paths, live map layers, and a partner
        SDK for embedding the map elsewhere. This is documentation for the
        people running the platform (admins) and the people building on top
        of it (developers), not for end users navigating the map itself.
      </DocsP>

      <DocsH2>Setting up</DocsH2>
      <DocsP>
        Admin access is provisioned directly (not self-service) — ask
        whoever manages the project for an account, then sign in at{' '}
        <DocsInlineCode>/admin/login</DocsInlineCode>. If you're integrating
        the map into a separate app instead, you'll need a partner API key —
        see the <Link to="/doc/api" className="underline">API &amp; SDK</Link>{' '}
        guide for how that's issued.
      </DocsP>

      <DocsH2>Key features</DocsH2>
      <DocsList>
        <DocsListItem><strong>Buildings &amp; floors</strong>: geo-anchored floor plans with per-floor SVG layouts.</DocsListItem>
        <DocsListItem><strong>POIs &amp; promotions</strong>: searchable points of interest, indoor or outdoor, with optional discount badges.</DocsListItem>
        <DocsListItem><strong>Walking paths</strong>: a curated outdoor node/path graph that powers real turn-by-turn routing.</DocsListItem>
        <DocsListItem><strong>Layers</strong>: base map style switching plus custom overlays and georeferenced image drapes.</DocsListItem>
        <DocsListItem><strong>API &amp; SDK</strong>: a scoped, revocable way for partner apps to render the same venue map without touching your database directly.</DocsListItem>
      </DocsList>

      <div className="grid sm:grid-cols-2 gap-3 mt-8">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.to}
              to={c.to}
              className="rounded-xl p-4 transition-colors"
              style={{ border: `1px solid ${admin.border}`, background: admin.surface }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
                style={{ background: admin.accentSofter }}
              >
                <Icon className="w-4 h-4" style={{ color: admin.accent }} />
              </div>
              <p className="text-sm font-bold mb-1" style={{ color: admin.text }}>{c.title}</p>
              <p className="text-xs" style={{ color: admin.textMuted }}>{c.desc}</p>
            </Link>
          );
        })}
      </div>
    </DocsSection>
  </DocsShell>
);

export default DocsIntro;
