import React from 'react';
import { Room } from '@/data/types';
import { ISO, blockDetails, cornersPath, isoRectCorners, toIso } from './floorMapIso';

interface FloorIsoBlockProps {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
  label?: string;
  highlight?: 'start' | 'end' | 'none';
  onClick?: () => void;
}

export const FloorIsoBlock: React.FC<FloorIsoBlockProps> = ({
  x, y, w, h, id, label, highlight = 'none', onClick,
}) => {
  const d = ISO.extrude;
  const top = isoRectCorners(x, y, w, h, d);
  const base = isoRectCorners(x, y, w, h, 0);
  const left = [base[3], base[0], top[0], top[3]];
  const right = [base[1], base[2], top[2], top[1]];

  const topFill = highlight === 'start'
    ? '#c8e0d4'           // soft green-tinted for start
    : highlight === 'end'
      ? '#f0d8c8'         // warm peach for destination
      : ISO.blockTop;     // default warm grey
  const sideFill = highlight !== 'none' ? ISO.blockSide : ISO.blockSideDark;

  const details = blockDetails(x, y, w, h, id);

  return (
    <g onClick={onClick} className={onClick ? 'cursor-pointer' : undefined}>
      <path d={cornersPath(left)} fill={sideFill} stroke="none" />
      <path d={cornersPath(right)} fill={ISO.blockSide} stroke="none" />
      <path d={cornersPath(top)} fill={topFill} stroke={ISO.corridorEdge} strokeWidth={1} />

      {details.map((s, i) => {
        const p = toIso(s.x, s.y, d + 1);
        if (s.type === 'rect') {
          const p2 = toIso(s.x + (s.w ?? 12), s.y + (s.h ?? 10), d + 1);
          return (
            <rect
              key={i}
              x={p.x}
              y={p.y}
              width={Math.max(4, p2.x - p.x)}
              height={Math.max(3, p2.y - p.y)}
              rx={2}
              fill={ISO.blockDetail}
              opacity={0.55}
            />
          );
        }
        return <circle key={i} cx={p.x} cy={p.y} r={s.r ?? 5} fill={ISO.blockDetail} opacity={0.5} />;
      })}

      {label && (
        <text
          x={toIso(x + w / 2, y + h / 2, d + 2).x}
          y={toIso(x + w / 2, y + h / 2, d + 2).y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={9}
          fontWeight={700}
          fill="#5a5a62"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {label.length > 14 ? `${label.slice(0, 13)}…` : label}
        </text>
      )}
    </g>
  );
};

export function roomToBlock(room: Room) {
  return { x: room.x, y: room.y, w: room.width, h: room.height, id: room.id, label: room.name };
}