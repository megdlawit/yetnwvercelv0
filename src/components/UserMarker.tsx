import React from 'react';

interface UserMarkerProps {
  x: number;
  y: number;
  heading?: number; // radians, 0=North
  isWalking?: boolean;
}

const UserMarker: React.FC<UserMarkerProps> = ({ x, y, heading, isWalking }) => {
  const rotDeg = heading != null ? (heading * 180) / Math.PI : 0;

  return (
    <g>
      {/* Outer glow ring */}
      <circle cx={x} cy={y} r={20} fill="hsl(217 91% 60% / 0.08)" stroke="none" />

      {/* Pulse ring — only when walking */}
      {isWalking && (
        <circle cx={x} cy={y} r={12} fill="hsl(217 91% 60% / 0.12)" stroke="none">
          <animate attributeName="r" from="12" to="28" dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.5" to="0" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Direction cone */}
      {heading != null && (
        <g transform={`rotate(${rotDeg}, ${x}, ${y})`}>
          <defs>
            <radialGradient id="cone-grad" cx="50%" cy="100%" r="100%">
              <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <path
            d={`M ${x} ${y - 26} L ${x - 10} ${y - 4} Q ${x} ${y - 12} ${x + 10} ${y - 4} Z`}
            fill="url(#cone-grad)"
            opacity={isWalking ? 0.9 : 0.4}
          >
            <animate attributeName="opacity" values={isWalking ? "0.6;0.9;0.6" : "0.35;0.45;0.35"} dur="2s" repeatCount="indefinite" />
          </path>
        </g>
      )}

      {/* Shadow */}
      <ellipse cx={x} cy={y + 2} rx={7} ry={3} fill="hsl(220 25% 10% / 0.15)" />

      {/* Main dot with gradient */}
      <defs>
        <radialGradient id="dot-grad" cx="35%" cy="35%">
          <stop offset="0%" stopColor="hsl(217 91% 72%)" />
          <stop offset="100%" stopColor="hsl(217 91% 50%)" />
        </radialGradient>
      </defs>
      <circle cx={x} cy={y} r={9} fill="url(#dot-grad)" stroke="white" strokeWidth={3}>
        {isWalking && (
          <animate attributeName="r" values="9;10;9" dur="0.6s" repeatCount="indefinite" />
        )}
      </circle>

      {/* Specular highlight */}
      <circle cx={x - 2.5} cy={y - 2.5} r={3} fill="white" opacity={0.6} />
    </g>
  );
};

export default UserMarker;
