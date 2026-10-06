/**
 * adminTheme — design tokens for the admin console.
 *
 * Direction: Notion's structure (quiet neutral surfaces, hairline borders,
 * a calm left sidebar, generous whitespace) crossed with Apple's chrome
 * (system typography, soft blur on sticky bars, restrained color used only
 * for the one thing that matters on a screen). Kept entirely separate from
 * the app-wide CSS variables in index.css — those power the consumer-facing
 * map app and should stay untouched. The admin console gets its own,
 * self-contained palette here instead.
 */

export const admin = {
  // Surfaces
  canvas: '#FAFAF9',      // page background — warm, near-white
  sidebar: '#F7F6F3',     // one shade off canvas, gives the sidebar depth without a hard line
  surface: '#FFFFFF',     // cards, dialogs, inputs
  surfaceSunken: '#FAFAF8', // subtly recessed surface (e.g. table stripes, code-ish blocks)

  // Borders
  border: '#EBE9E4',
  borderStrong: '#DDDAD3',

  // Text
  text: '#1B1B18',
  textMuted: '#84817A',
  textFaint: '#B3B0A8',

  // Brand accent — reserved for primary CTAs only, not decorative icons.
  accent: 'hsl(152 70% 22%)',
  accentSoft: 'hsl(152 70% 22% / 0.08)',
  accentSofter: 'hsl(152 70% 22% / 0.05)',
  accentBorder: 'hsl(152 70% 22% / 0.18)',

  // Icons — Notion-style: one neutral tone everywhere, color only for actions.
  icon: '#84817A',
  iconBadge: 'rgba(55, 53, 47, 0.06)',
  iconBadgeBorder: 'rgba(55, 53, 47, 0.09)',

  // Interactive states
  hover: 'rgba(55, 53, 47, 0.04)',
  activeNav: 'rgba(55, 53, 47, 0.06)',

  // Status
  danger: '#E5484D',
  dangerSoft: '#E5484D14',
  dangerBorder: '#E5484D33',

  // Shadows — soft and low, never the punchy colored glow the consumer app uses
  shadowSm: '0 1px 2px rgba(20, 20, 15, 0.04)',
  shadowMd: '0 1px 3px rgba(20, 20, 15, 0.06), 0 1px 2px rgba(20, 20, 15, 0.04)',
  shadowLg: '0 4px 16px rgba(20, 20, 15, 0.08), 0 1px 2px rgba(20, 20, 15, 0.04)',

  radius: {
    sm: '8px',
    md: '10px',
    lg: '14px',
    xl: '18px',
  },
} as const;
