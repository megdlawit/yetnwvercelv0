/**
 * POIMarker — SVG marker for a POI on the map. Featured POIs get a glowing
 * pulse ring and promotional badges show a small "%" tag.
 */

import React from 'react';
import { Flame } from 'lucide-react';
import { POI, getPOIIcon, hasActivePromotions, POI_CATEGORY_META } from '@/data/poi';
import { NavNode } from '@/data/types';

interface POIMarkerProps {
  poi: POI;
  node: NavNode;
  onClick: (poi: POI) => void;
  /** When true, the user is currently within the panel-visible radius. */
  isNearby?: boolean;
}

const POIMarker: React.FC<POIMarkerProps> = ({ poi, node, onClick, isNearby = false }) => {
  const meta = POI_CATEGORY_META[poi.category];
  const Icon = getPOIIcon(poi);
  const hasPromo = hasActivePromotions(poi);
  const showOfferNearby = hasPromo && isNearby;

  return (
    <g
      onClick={(e) => { e.stopPropagation(); onClick(poi); }}
      className="cursor-pointer"
      style={{ pointerEvents: 'all' }}
    >
      {/* Featured pulse ring */}
      {poi.isFeatured && (
        <circle cx={node.x} cy={node.y} r={14} fill={meta.tone} opacity={0.2}>
          <animate attributeName="r" values="12;20;12" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0.05;0.3" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Pin shadow */}
      <ellipse cx={node.x} cy={node.y + 14} rx={7} ry={2} fill="black" opacity={0.18} />

      {/* Pin body */}
      <circle
        cx={node.x}
        cy={node.y}
        r={11}
        fill={meta.tone}
        stroke="white"
        strokeWidth={2.5}
        opacity={0.95}
      />

      {/* Icon */}
      <g transform={`translate(${node.x - 6.5} ${node.y - 6.5})`} style={{ pointerEvents: 'none' }}>
        <Icon width={13} height={13} color="white" strokeWidth={2.4} />
      </g>

      {/* Promotion badge */}
      {hasPromo && (
        <g style={{ pointerEvents: 'none' }}>
          <circle cx={node.x + 9} cy={node.y - 9} r={5.5} fill="hsl(var(--destructive))" stroke="white" strokeWidth={1.5} />
          <text x={node.x + 9} y={node.y - 6.5} textAnchor="middle" fontSize={6.5} fontWeight={800} fill="white">
            %
          </text>
        </g>
      )}

      {/* "Offer nearby" floating tag — only when user is in nearby radius */}
      {showOfferNearby && (
        <g style={{ pointerEvents: 'none' }}>
          <rect
            x={node.x - 24}
            y={node.y - 30}
            width={48}
            height={12}
            rx={6}
            fill="hsl(var(--destructive))"
            opacity={0.95}
          >
            <animate attributeName="opacity" values="0.95;0.6;0.95" dur="1.6s" repeatCount="indefinite" />
          </rect>
          <g transform={`translate(${node.x - 19} ${node.y - 26.5})`}>
            <Flame width={7} height={7} color="white" strokeWidth={3} />
          </g>
          <text
            x={node.x + 3}
            y={node.y - 21.5}
            textAnchor="middle"
            fontSize={7}
            fontWeight={800}
            fill="white"
          >
            OFFER
          </text>
        </g>
      )}
    </g>
  );
};

export default POIMarker;
