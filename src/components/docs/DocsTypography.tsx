/**
 * DocsTypography — shared content primitives for the /doc site.
 *
 * Kept deliberately simple (styled JSX components, not a markdown/MDX
 * pipeline) so doc pages are just plain React/TSX — no new build tooling,
 * no runtime markdown parser, easy for anyone on the team to add a page
 * to. Uses the same Notion-ish `admin` design tokens as the admin console
 * so the docs feel like part of the same product, not a bolted-on wiki.
 */
import React from 'react';
import { admin } from '@/components/admin/adminTheme';
import { Info, AlertTriangle, CheckCircle2 } from 'lucide-react';

export const DocsTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h1 className="text-3xl font-bold tracking-tight mb-1" style={{ color: admin.text }}>
    {children}
  </h1>
);

export const DocsDescription: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-base mb-8" style={{ color: admin.textMuted }}>
    {children}
  </p>
);

export const DocsH2: React.FC<{ children: React.ReactNode; id?: string }> = ({ children, id }) => (
  <h2 id={id} className="text-xl font-bold mt-10 mb-3 scroll-mt-20" style={{ color: admin.text }}>
    {children}
  </h2>
);

export const DocsH3: React.FC<{ children: React.ReactNode; id?: string }> = ({ children, id }) => (
  <h3 id={id} className="text-base font-bold mt-6 mb-2 scroll-mt-20" style={{ color: admin.text }}>
    {children}
  </h3>
);

export const DocsP: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-sm leading-relaxed mb-4" style={{ color: admin.text }}>
    {children}
  </p>
);

export const DocsInlineCode: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code
    className="text-[13px] px-1.5 py-0.5 rounded-md font-mono"
    style={{ background: admin.surfaceSunken, border: `1px solid ${admin.border}`, color: admin.text }}
  >
    {children}
  </code>
);

export const DocsList: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="space-y-1.5 mb-4 pl-1">{children}</ul>
);

export const DocsListItem: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="text-sm leading-relaxed flex gap-2" style={{ color: admin.text }}>
    <span className="select-none" style={{ color: admin.textFaint }}>·</span>
    <span>{children}</span>
  </li>
);

export const DocsCodeBlock: React.FC<{ children: string; language?: string }> = ({ children }) => (
  <pre
    className="text-[12.5px] leading-relaxed rounded-xl p-4 overflow-x-auto mb-4 font-mono"
    style={{ background: '#1B1B18', color: '#F2F1EC' }}
  >
    <code>{children.trim()}</code>
  </pre>
);

type CalloutTone = 'info' | 'warning' | 'success';

const CALLOUT_META: Record<CalloutTone, { icon: typeof Info; bg: string; border: string; iconColor: string }> = {
  info:    { icon: Info,         bg: admin.accentSofter, border: admin.accentBorder, iconColor: admin.accent },
  warning: { icon: AlertTriangle, bg: '#FBF3E5', border: '#F0DDB3', iconColor: '#9A6B12' },
  success: { icon: CheckCircle2, bg: '#EAF6EF', border: '#C7E8D3', iconColor: '#1E7A45' },
};

export const DocsCallout: React.FC<{ tone?: CalloutTone; title?: string; children: React.ReactNode }> = ({
  tone = 'info',
  title,
  children,
}) => {
  const meta = CALLOUT_META[tone];
  const Icon = meta.icon;
  return (
    <div
      className="rounded-xl p-4 mb-4 flex gap-3"
      style={{ background: meta.bg, border: `1px solid ${meta.border}` }}
    >
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: meta.iconColor }} />
      <div className="text-sm leading-relaxed" style={{ color: admin.text }}>
        {title && <p className="font-bold mb-1">{title}</p>}
        {children}
      </div>
    </div>
  );
};

export const DocsTable: React.FC<{ headers: string[]; rows: React.ReactNode[][] }> = ({ headers, rows }) => (
  <div className="mb-4 overflow-x-auto rounded-xl" style={{ border: `1px solid ${admin.border}` }}>
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr style={{ background: admin.sidebar }}>
          {headers.map((h) => (
            <th
              key={h}
              className="text-left font-semibold px-3 py-2 text-xs uppercase tracking-wide"
              style={{ color: admin.textMuted, borderBottom: `1px solid ${admin.border}` }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderTop: i > 0 ? `1px solid ${admin.border}` : undefined }}>
            {row.map((cell, j) => (
              <td key={j} className="px-3 py-2 align-top" style={{ color: admin.text }}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const DocsSection: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="max-w-3xl">{children}</div>
);
