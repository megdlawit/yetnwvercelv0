import React from 'react';
import { POI, hasActivePromotions, getPOIIcon } from '@/data/poi';
import { NavNode } from '@/data/types';
import { ISO, poiImageUrl, toIso } from './floorMapIso';

interface FloorPhotoPinProps {
  poi: POI;
  node: NavNode;
  onClick: (poi: POI) => void;
  isNearby?: boolean;
  isSelected?: boolean;
}

const FloorPhotoPin: React.FC<FloorPhotoPinProps> = ({ poi, node, onClick, isNearby, isSelected }) => {
  const anchor = toIso(node.x, node.y, ISO.extrude + 2);

  // Sizes matching the outdoor VenueMapRenderer thumbnail style
  const baseSize = isSelected ? 60 : isNearby ? 54 : 48;
  const size = baseSize;
  const half = size / 2;
  const radius = size * 0.2;

  const img = poiImageUrl(poi.imageUrl, poi.subcategory);
  const hasPromo = hasActivePromotions(poi);
  const Icon = getPOIIcon(poi);

  // Card sits above the anchor point with a short tail
  const cardX = anchor.x - half;
  const cardY = anchor.y - size - 10;

  return (
    <g
      onClick={(e) => { e.stopPropagation(); onClick(poi); }}
      className="cursor-pointer"
      style={{ pointerEvents: 'all' }}
    >
      {/* Nearby pulse ring */}
      {isNearby && !isSelected && (
        <circle
          cx={anchor.x}
          cy={cardY + half}
          r={half + 10}
          fill="none"
          stroke="#22c55e"
          strokeWidth={2.5}
          opacity={0.5}
        >
          <animate attributeName="r" values={`${half + 8};${half + 18};${half + 8}`} dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Ground shadow ellipse */}
      <ellipse
        cx={anchor.x}
        cy={anchor.y + 3}
        rx={half * 0.55}
        ry={3}
        fill="rgba(0,0,0,0.12)"
      />

      {/* Pin tail */}
      <path
        d={`M ${anchor.x - 5} ${cardY + size + 1} L ${anchor.x} ${anchor.y + 1} L ${anchor.x + 5} ${cardY + size + 1} Z`}
        fill="white"
        stroke="#d8d0c4"
        strokeWidth={0.5}
      />

      {/* White card border (slightly larger) */}
      <rect
        x={cardX - 2.5}
        y={cardY - 2.5}
        width={size + 5}
        height={size + 5}
        rx={radius + 2}
        ry={radius + 2}
        fill="white"
        filter="url(#pinShadow)"
      />

      {/* Photo image */}
      <clipPath id={`pin-clip-${poi.id}`}>
        <rect x={cardX} y={cardY} width={size} height={size} rx={radius} ry={radius} />
      </clipPath>
      <image
        href={img}
        x={cardX}
        y={cardY}
        width={size}
        height={size}
        clipPath={`url(#pin-clip-${poi.id})`}
        preserveAspectRatio="xMidYMid slice"
      />

      {/* Selected highlight ring — green border */}
      {isSelected && (
        <rect
          x={cardX - 3}
          y={cardY - 3}
          width={size + 6}
          height={size + 6}
          rx={radius + 2.5}
          ry={radius + 2.5}
          fill="none"
          stroke="#1a7a45"
          strokeWidth={3}
        />
      )}

      {/* Featured border — orange */}
      {poi.isFeatured && !isSelected && (
        <rect
          x={cardX - 2.5}
          y={cardY - 2.5}
          width={size + 5}
          height={size + 5}
          rx={radius + 2}
          ry={radius + 2}
          fill="none"
          stroke="hsl(35 90% 50%)"
          strokeWidth={2.5}
        />
      )}

      {/* Promo badge — red dot top-right */}
      {hasPromo && (
        <g transform={`translate(${cardX + size - 6} ${cardY + 6})`}>
          <circle r={8} fill="#e53935" stroke="white" strokeWidth={1.5} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={7} fontWeight={800} fill="white">%</text>
        </g>
      )}

      {/* Small category icon badge — bottom-left of card */}
      <g transform={`translate(${cardX + 11} ${cardY + size - 11})`}>
        <circle r={10} fill="white" opacity={0.92} />
        <Icon width={12} height={12} x={-6} y={-6} color="#1a7a45" strokeWidth={2.2} />
      </g>
    </g>
  );
};

export default FloorPhotoPin;