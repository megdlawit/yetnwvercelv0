import type { ReactNode } from 'react';

type SvgProps = { d?: string; size?: number; stroke?: number; children?: ReactNode; className?: string };

/** Line icon on a 24×24 grid, drawn with the current text colour. */
export function Icon({ d, size = 20, stroke = 2, children, className }: SvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {children}
      {d && <path d={d} />}
    </svg>
  );
}

export const I_PLAY = (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
);
export const I_PAUSE = (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
);
export const I_X = <Icon d="M6 6l12 12M18 6L6 18" size={16} stroke={2.4} />;
export const I_ARR = <Icon d="M5 12h14M13 6l6 6-6 6" size={18} stroke={2.2} />;
export const I_NAV = <Icon d="M3 11l19-9-9 19-2-8-8-2z" size={18} />;
export const I_DOWN = <Icon d="M12 5v14M6 13l6 6 6-6" size={16} stroke={2.2} />;
export const I_UP = <Icon d="M12 19V5M6 11l6-6 6 6" size={18} stroke={2.2} />;
export const I_EXP = <Icon d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" size={14} stroke={2.2} />;
export const I_SPK = <Icon d="M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" size={15} />;
export const I_MUTE = <Icon d="M11 5L6 9H3v6h3l5 4V5zM16 9l5 6M21 9l-5 6" size={15} />;
export const I_WALK = <Icon d="M13 4.5a1.5 1.5 0 1 0 0-.01M9 21l2-6-2-3 3-3 3 3 3 1M11 15l-3 1" size={13} stroke={2.4} />;
export const I_CLK = <Icon d="M12 7v5l3 2" size={13} stroke={2.4}><circle cx={12} cy={12} r={9} /></Icon>;
export const I_HAND = <Icon d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1a1.5 1.5 0 0 1 3 0v2m0-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.3 14a1.5 1.5 0 0 1 2.4-1.8L9 14" size={16} />;
export const I_MUSIC = <Icon d="M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" size={20} />;
export const I_INFO = <Icon d="M12 8v.01M11 12h1v5h1" size={20} stroke={2.4}><circle cx={12} cy={12} r={9} /></Icon>;

/** Small walking figure used next to walk times. */
export const I_WALKER = (
  <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx={13} cy={4} r={2} /><path d="M9 21l2-6-2-3 3-3 3 3 3 1M11 15l-3 1" />
  </svg>
);
